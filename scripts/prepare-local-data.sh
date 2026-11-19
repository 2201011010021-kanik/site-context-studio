#!/bin/zsh
set -euo pipefail

project_dir=${0:A:h:h}
source_dir=${1:-'/Volumes/New Volume/ALL_MOBILITY_EXHIBITION_DATA/BASE_DATA_FOLDER'}
region=${2:-}
ogr=/Applications/QGIS.app/Contents/MacOS/ogr2ogr
export GDAL_DATA=/Applications/QGIS.app/Contents/Resources/qgis/gdal
export PROJ_DATA=/Applications/QGIS.app/Contents/Resources/qgis/proj
if [[ -n "$region" ]]; then
  [[ "$region" =~ '^[a-z0-9][a-z0-9_-]*$' ]] || { print -u2 'Region name must use lowercase letters, numbers, hyphens or underscores.'; exit 1; }
  target_dir="$project_dir/local-data/regions"
  target="$target_dir/$region.gpkg"
  coverage="$target_dir/$region.json"
else
  target_dir="$project_dir/local-data"
  target="$target_dir/site-context.gpkg"
  coverage="$target_dir/coverage.json"
fi
temp="$target_dir/${region:-site-context}-building.gpkg"

[[ -x "$ogr" ]] || { print -u2 'QGIS ogr2ogr was not found in /Applications/QGIS.app'; exit 1; }
for name in BUILDINGS ROAD_NETWORK WATER_BODIES; do
  [[ -f "$source_dir/$name.geojson" ]] || { print -u2 "Missing $source_dir/$name.geojson"; exit 1; }
done
mkdir -p "$target_dir"
rm -f "$temp"
print 'Indexing precise building footprints (one-time local preparation)…'
"$ogr" -f GPKG "$temp" "$source_dir/BUILDINGS.geojson" -nln buildings -lco SPATIAL_INDEX=YES -t_srs EPSG:4326
print 'Adding mapped roads and water…'
"$ogr" -f GPKG -update "$temp" "$source_dir/ROAD_NETWORK.geojson" -nln roads -lco SPATIAL_INDEX=YES -t_srs EPSG:4326
"$ogr" -f GPKG -update "$temp" "$source_dir/WATER_BODIES.geojson" -nln water -lco SPATIAL_INDEX=YES -t_srs EPSG:4326
mv -f "$temp" "$target"
STUDIO_INDEX="$target" STUDIO_COVERAGE="$coverage" python3 - <<'PY'
import json, os, sqlite3
connection = sqlite3.connect(os.environ['STUDIO_INDEX'])
rows = connection.execute('SELECT table_name,min_x,min_y,max_x,max_y FROM gpkg_contents').fetchall()
bounds = {name:[west,south,east,north] for name,west,south,east,north in rows}
counts = {name:connection.execute('SELECT COUNT(*) FROM '+name).fetchone()[0] for name in bounds}
with open(os.environ['STUDIO_COVERAGE'], 'w') as output:
    json.dump({'bounds':bounds,'counts':counts}, output, indent=2)
print('Indexed features:', counts)
PY
print "Local spatial index ready: $target"
print 'Site Context Studio will use these real files for covered areas without Overpass.'
