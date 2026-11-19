import {spawn} from 'node:child_process';
import {stat} from 'node:fs/promises';
import {fromOverpass,mergeLayers,intersectsAOI} from './geo.mjs';

const binary='/Applications/QGIS.app/Contents/MacOS/ogr2ogr';
const gdalData='/Applications/QGIS.app/Contents/Resources/qgis/gdal';

async function layer(path,name,where,bounds,signal){
  const args=['-f','GeoJSON','/vsistdout/',path,'-spat',...bounds.map(String),'-lco','RFC7946=YES'];
  if(['buildings','roads','water'].includes(name))args.push('-sql',`SELECT fid AS source_fid, * FROM ${name}`);
  else args.push(name);
  if(where)args.push('-where',where);
  const raw=await new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{env:{...process.env,GDAL_DATA:gdalData,PROJ_DATA:'/Applications/QGIS.app/Contents/Resources/qgis/proj'},stdio:['ignore','pipe','pipe']});
    const parts=[];let size=0,errors='';
    const stop=()=>child.kill();signal.addEventListener('abort',stop,{once:true});
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>25000000)child.kill();else parts.push(chunk);});
    child.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-2000);});
    child.on('error',reject);
    child.on('close',code=>{
      signal.removeEventListener('abort',stop);
      if(signal.aborted)return reject(new Error('Extraction cancelled.'));
      if(size>25000000)return reject(new Error('The local extract returned too much data for one area. Choose a smaller boundary.'));
      if(code!==0)return reject(new Error(`Could not read the local GIS data: ${errors.trim()||'QGIS conversion failed.'}`));
      resolve(Buffer.concat(parts).toString());
    });
  });
  const data=JSON.parse(raw);if(!Array.isArray(data.features))throw new Error('The local GIS data returned invalid GeoJSON.');
  return data.features;
}

export async function extractLocalContext(path,aoi,signal=new AbortController().signal){
  const file=await stat(path);if(!file.isFile()||!path.endsWith('.gpkg'))throw new Error('The local site context index is missing or invalid.');
  const layers={buildings:[],roads:[],water:[],landuse:[]};
  for(const name of ['buildings','roads','water']){
    const features=await layer(path,name,null,aoi.bounds,signal);
    for(const feature of features){
      const p=feature.properties||{},geometry=feature.geometry||{};
      const shapes=geometry.type==='MultiPolygon'?geometry.coordinates.map(poly=>({type:'Polygon',coordinates:poly})):
        geometry.type==='MultiLineString'?geometry.coordinates.map(line=>({type:'LineString',coordinates:line})):[geometry];
      for(let i=0;i<shapes.length;i++){
        const shape=shapes[i],ring=shape.type==='Polygon'?shape.coordinates?.[0]:shape.coordinates;
        if(!Array.isArray(ring)||ring.length<2||!intersectsAOI(ring,aoi.ring,shape.type==='Polygon'))continue;
        const id=name==='buildings'?`open-buildings-${p.source_fid}-${i}`:`local-${name}-${p.source_fid}-${i}`;
        const properties=name==='buildings'?{id,source:'Local BUILDINGS.geojson (Open Buildings-style)',source_id:String(p.source_fid),layer:name,kind:'building',name:null,confidence:p.confidence??null,area_m2:p.area_in_meters??null,height_m:null,height_method:'unknown'}:
          {id,source:`Local ${name==='roads'?'ROAD_NETWORK':'WATER_BODIES'}.geojson (OSM-style)`,source_id:String(p.osm_id||''),layer:name,kind:p.fclass||name,name:p.name||null};
        layers[name].push({type:'Feature',geometry:shape,properties});
      }
    }
  }
  if(Object.values(layers).every(items=>items.length===0))throw new Error('No mapped features from the local files intersect this boundary. Check the dataset coverage.');
  return {layers,extractFileModifiedAt:file.mtime.toISOString(),sources:{buildings:'Local BUILDINGS.geojson (Open Buildings-style; original source and license unverified)',roads:'Local ROAD_NETWORK.geojson (OSM-style; original source unverified)',water:'Local WATER_BODIES.geojson (OSM-style; original source unverified)'}};
}

export async function extractLocalOSM(path,aoi,signal=new AbortController().signal){
  const file=await stat(path);if(!file.isFile()||!/\.(osm|pbf)$/i.test(path))throw new Error('Set OSM_EXTRACT_PATH to a local .osm or .osm.pbf file.');
  const [polygons,lines]=await Promise.all([
    layer(path,'multipolygons',"building IS NOT NULL OR landuse IS NOT NULL OR natural = 'water'",aoi.bounds,signal),
    layer(path,'lines','highway IS NOT NULL OR waterway IS NOT NULL',aoi.bounds,signal)
  ]);
  const layers={buildings:[],roads:[],water:[],landuse:[]};
  for(const feature of [...polygons,...lines]){
    const p=feature.properties||{},tags={...p};
    for(const match of String(p.other_tags||'').matchAll(/"([^"]+)"=>"([^"]*)"/g))tags[match[1]]=match[2];
    const geom=feature.geometry,polys=geom?.type==='MultiPolygon'?geom.coordinates:geom?.type==='Polygon'?[geom.coordinates]:geom?.type==='LineString'?[[geom.coordinates]]:[];
    for(let i=0;i<polys.length;i++){
      const coords=polys[i]?.[0];if(!Array.isArray(coords)||coords.length<2)continue;
      const id=p.osm_way_id||p.osm_id||feature.id;
      const part=fromOverpass({elements:[{type:'way',id:`${id}-${i}`,tags,geometry:coords.map(([lon,lat])=>({lon,lat}))}]},aoi);
      mergeLayers(layers,part);
    }
  }
  if(Object.values(layers).every(items=>items.length===0))throw new Error('No mapped buildings, roads, water, or land use were found in this extract for the boundary. Check the file coverage.');
  return {layers,extractFileModifiedAt:file.mtime.toISOString()};
}
