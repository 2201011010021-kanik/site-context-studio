#!/usr/bin/env python3
"""Fetch intersecting Overture features from the latest public release."""
import json
import os
import re
import sys
from pathlib import Path
from urllib.request import urlopen

import fsspec
from aiohttp import ClientError
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as fs
import pyarrow.parquet as pq
from shapely.geometry import mapping, shape
from shapely.wkb import loads as wkb_loads

TYPES = [('building', 'buildings'), ('segment', 'roads'), ('water', 'water'), ('land_use', 'landuse')]
MAX_FEATURES = 150_000
MAX_CATALOG_BYTES = 64 * 1024 * 1024


def collection_catalog(release):
    """Read one immutable release catalog once, then reuse it for later layers."""
    cache_dir = Path(os.environ.get('OVERTURE_CATALOG_CACHE_DIR') or Path(__file__).resolve().parent / '.local' / 'overture-catalog')
    cache_file = cache_dir / f'{release}.parquet'
    try:
        if cache_file.is_file():
            return pq.read_table(cache_file)
    except (OSError, pa.ArrowException):
        pass  # A partial or damaged cache is replaced from the public catalog.

    with urlopen(f'https://stac.overturemaps.org/{release}/collections.parquet', timeout=35) as response:
        payload = response.read(MAX_CATALOG_BYTES + 1)
    if len(payload) > MAX_CATALOG_BYTES:
        raise ValueError('Overture catalog exceeds the local size limit.')
    catalog = pq.read_table(pa.BufferReader(payload))
    temporary = None
    try:
        cache_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = cache_dir / f'{release}.{os.getpid()}.tmp'
        with open(temporary, 'xb') as output:
            os.chmod(temporary, 0o600)
            output.write(payload)
        os.replace(temporary, cache_file)
    except OSError:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
    return catalog


def asset_paths(assets, release, provider):
    prefix = (f'https://overturemapswestus2.blob.core.windows.net/release/{release}/'
              if provider == 'azure' else f's3://overturemaps-us-west-2/release/{release}/')
    paths = []
    for asset in assets:
        href = asset[provider]['href'] if provider == 'azure' else asset[provider]['alternate']['s3']['href']
        if not isinstance(href, str) or not href.startswith(prefix) or not href.endswith('.parquet') or '..' in href:
            raise ValueError('Overture catalog contains an unexpected data address.')
        paths.append(href if provider == 'azure' else href[5:])
    return paths


def collect(dataset, bbox_filter, polygon, layer, remaining):
    fields = [name for name in ('id', 'geometry', 'sources', 'height', 'num_floors', 'subtype', 'class',
                                'roof_shape', 'roof_height', 'roof_material', 'facade_material', 'min_height')
              if name in dataset.schema.names]
    features = []
    for batch in dataset.to_batches(columns=fields, filter=bbox_filter, batch_size=512):
        for row in batch.to_pylist():
            if layer == 'roads' and row.get('subtype') not in ('road', 'path'):
                continue
            geom = wkb_loads(row['geometry'])
            if not geom.intersects(polygon):
                continue
            parts = list(geom.geoms) if geom.geom_type in ('MultiPolygon', 'MultiLineString') else [geom]
            for i, part in enumerate(parts):
                if part.geom_type not in ('Polygon', 'LineString') or not part.intersects(polygon):
                    continue
                height, floors = row.get('height'), row.get('num_floors')
                method = 'recorded' if height and height > 0 else 'floor_estimate' if floors and floors > 0 else 'unknown'
                height_m = round(float(height), 1) if method == 'recorded' else round(float(floors) * 3.2, 1) if method == 'floor_estimate' else None
                sources = row.get('sources') or []
                identifier = str(row['id'])
                properties = {'id': f'overture-{layer}-{identifier}-{i}', 'source': 'Overture Maps Foundation',
                              'source_id': identifier, 'source_datasets': [s.get('dataset') for s in sources if s.get('dataset')],
                              'layer': layer, 'kind': row.get('class') or row.get('subtype') or layer,
                              'num_floors': float(floors) if layer == 'buildings' and floors and floors > 0 else None,
                              'height_m': height_m if layer == 'buildings' else None,
                              'height_method': method if layer == 'buildings' else 'unknown'}
                if layer == 'buildings':
                    for key in ('roof_shape', 'roof_height', 'roof_material', 'facade_material', 'min_height'):
                        value = row.get(key)
                        if value is not None:
                            properties[key] = value
                features.append({'type': 'Feature', 'geometry': mapping(part), 'properties': properties})
                if len(features) > remaining:
                    raise ValueError('Selection exceeds 150,000 mapped features; choose a smaller area.')
    return features


def fetch(request):
    bounds = request['bounds']
    if len(bounds) != 4 or not all(isinstance(x, (float, int)) for x in bounds):
        raise ValueError('Invalid bounding box')
    polygon = shape(request['polygon'])
    if not polygon.is_valid or polygon.is_empty:
        raise ValueError('Invalid site polygon')
    selected = request.get('layers') or [name for _, name in TYPES]
    if not isinstance(selected, list) or not selected or any(name not in dict(TYPES).values() for name in selected):
        raise ValueError('Select at least one valid data layer.')
    release = request.get('release')
    if release is None:
        with urlopen('https://stac.overturemaps.org/catalog.json', timeout=25) as response:
            release = json.load(response)['latest']
    if not isinstance(release, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}\.\d+', release):
        raise ValueError('Invalid release identifier')
    catalog = collection_catalog(release)
    # Anonymous public HTTPS ranges use the system proxy; no cloud credentials are read.
    http = fs.PyFileSystem(fs.FSSpecHandler(fsspec.filesystem('http', client_kwargs={'trust_env': True},
                                                            block_size=1024 * 1024)))
    s3 = None
    west, south, east, north = bounds
    bbox_filter = ((pc.field('bbox', 'xmin') < east) & (pc.field('bbox', 'xmax') > west) &
                   (pc.field('bbox', 'ymin') < north) & (pc.field('bbox', 'ymax') > south))
    layers = {name: [] for _, name in TYPES}
    for kind, layer in TYPES:
        if layer not in selected:
            continue
        matches = catalog.filter((pc.field('collection') == kind) & (pc.field('type') == 'Feature') & bbox_filter)
        assets = matches.column('assets').to_pylist()
        if assets:
            try:
                paths = asset_paths(assets, release, 'azure')
                data = ds.dataset(paths, filesystem=http, format='parquet')
                features = collect(data, bbox_filter, polygon, layer, min(MAX_FEATURES, request.get('remaining', MAX_FEATURES)) - sum(map(len, layers.values())))
            except (OSError, ClientError, TimeoutError) as primary_error:
                print(f'Azure {layer} read failed; trying S3: {str(primary_error)[:160]}', file=sys.stderr, flush=True)
                if s3 is None:
                    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
                    s3 = fs.S3FileSystem(anonymous=True, region='us-west-2', proxy_options=proxy,
                                         connect_timeout=20, request_timeout=35)
                paths = asset_paths(assets, release, 'aws')
                data = ds.dataset(paths, filesystem=s3, format='parquet')
                features = collect(data, bbox_filter, polygon, layer, min(MAX_FEATURES, request.get('remaining', MAX_FEATURES)) - sum(map(len, layers.values())))
            layers[layer] = features
        print(f'Loaded {layer}: {len(layers[layer])}', file=sys.stderr, flush=True)
    return {'layers': layers, 'release': release,
            'sources': {name: 'Overture Maps Foundation (ODbL 1.0)' for _, name in TYPES}}


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--self-test']:
            print(json.dumps({'ok': True, 'pyarrow': pa.__version__}))
            sys.exit(0)
        print(json.dumps(fetch(json.load(sys.stdin)), separators=(',', ':')))
    except Exception as error:
        print(f'Online Overture query failed: {str(error)[:500]}', file=sys.stderr)
        sys.exit(1)
