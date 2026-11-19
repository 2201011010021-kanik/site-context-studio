import {surfaceBoundaryEdges} from './public/terrain-plinth.js';
import {clippedTerrainSurface} from './public/terrain-surface.js';

const RAD = Math.PI / 180;
export const round = (n, places = 6) => Number(n.toFixed(places));

export function validateAOI(input) {
  const ring = input?.type === 'Polygon' ? input.coordinates?.[0] : null;
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > 101) throw new Error('Draw a polygon with 3–100 points.');
  const points = ring.map(p => {
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 85) throw new Error('Invalid polygon coordinates.');
    return [p[0], p[1]];
  });
  if (points[0][0] !== points.at(-1)[0] || points[0][1] !== points.at(-1)[1]) throw new Error('Close the polygon before fetching data.');
  const bounds = points.reduce((b, [x,y]) => [Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)], [Infinity,Infinity,-Infinity,-Infinity]);
  const lat = (bounds[1]+bounds[3])/2;
  const scaleX = 111320 * Math.cos(lat*RAD), scaleY = 110574;
  let area = 0;
  for(let i=0;i<points.length-1;i++) area += (points[i][0]-points[0][0])*(points[i+1][1]-points[0][1])-(points[i+1][0]-points[0][0])*(points[i][1]-points[0][1]);
  const areaKm2 = Math.abs(area*scaleX*scaleY/2)/1e6;
  if (areaKm2 < .0001) throw new Error('The selected area is too small.');
  for(let i=0;i<points.length-1;i++)for(let j=i+1;j<points.length-1;j++){
    if(j===i+1||(i===0&&j===points.length-2))continue;
    if(segmentsMeet(points[i],points[i+1],points[j],points[j+1]))throw new Error('The selected boundary crosses itself. Redraw it without crossing edges.');
  }
  return {ring:points,bounds,areaKm2:round(areaKm2,3),origin:[bounds[0],bounds[1]],scaleX,scaleY};
}

export function planTiles(aoi,{edgeKm=3,maxTiles=12}={}){
  const [west,south,east,north]=aoi.bounds;
  const stepX=edgeKm*1000/aoi.scaleX,stepY=edgeKm*1000/aoi.scaleY;
  const columns=Math.max(1,Math.ceil((east-west)/stepX)),rows=Math.max(1,Math.ceil((north-south)/stepY));
  if(columns*rows>maxTiles*100)throw new Error(`This selection needs too many requests for the configured map data service. Use a regional extract or a dedicated provider.`);
  const tiles=[];
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const w=west+x*(east-west)/columns,e=west+(x+1)*(east-west)/columns;
    const s=south+y*(north-south)/rows,n=south+(y+1)*(north-south)/rows;
    const rect=[[w,s],[e,s],[e,n],[w,n],[w,s]];
    if(!intersectsAOI(rect,aoi.ring,true))continue;
    tiles.push([w,s,e,n]);
    if(tiles.length>maxTiles)throw new Error(`This boundary needs more than ${maxTiles} map requests. The shared public data service cannot safely process it in one job. Configure a dedicated data provider for a larger download.`);
  }
  return tiles;
}

export function mergeLayers(target,part){
  for(const key of ['buildings','roads','water','landuse']){
    const seen=new Set(target[key].map(f=>f.properties.id));
    for(const feature of part[key])if(!seen.has(feature.properties.id)){target[key].push(feature);seen.add(feature.properties.id);}
  }
  return target;
}

export function pointInside(p, ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i], b=ring[j];
    if(((a[1]>p[1]) !== (b[1]>p[1])) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
function orient(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function onSegment(a,b,p){return Math.min(a[0],b[0])-1e-10<=p[0] && p[0]<=Math.max(a[0],b[0])+1e-10 && Math.min(a[1],b[1])-1e-10<=p[1] && p[1]<=Math.max(a[1],b[1])+1e-10;}
function segmentsMeet(a,b,c,d){const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);if(o1*o2<0&&o3*o4<0)return true;return (Math.abs(o1)<1e-16&&onSegment(a,b,c))||(Math.abs(o2)<1e-16&&onSegment(a,b,d))||(Math.abs(o3)<1e-16&&onSegment(c,d,a))||(Math.abs(o4)<1e-16&&onSegment(c,d,b));}
export function intersectsAOI(coords, ring, closed=false){
  if(coords.some(p=>pointInside(p,ring)) || (closed&&ring.some(p=>pointInside(p,coords))))return true;
  for(let i=0;i<coords.length-1;i++)for(let j=0;j<ring.length-1;j++)if(segmentsMeet(coords[i],coords[i+1],ring[j],ring[j+1]))return true;
  return false;
}
function numHeight(tags){
  const raw = String(tags.height||'').trim().replace(/\s*m(?:eters?)?$/i,'');
  const h = Number(raw);
  if(raw && Number.isFinite(h) && h>0 && h<500)return {height_m:round(h,1),height_method:'recorded'};
  const levels=Number(tags['building:levels']);
  if(Number.isFinite(levels)&&levels>0&&levels<100)return {height_m:round(levels*3.2,1),height_method:'floor_estimate'};
  return {height_m:null,height_method:'unknown'};
}
function classify(tags){if(tags.building)return 'buildings';if(tags.highway)return 'roads';if(tags.waterway||tags.natural==='water'||tags.water)return 'water';if(tags.landuse)return 'landuse';return null;}
export function fromOverpass(payload, aoi) {
  if (!Array.isArray(payload?.elements)) throw new Error('Data provider returned an unexpected response.');
  const layers={buildings:[],roads:[],water:[],landuse:[]};
  for(const el of payload.elements){
    if(el.type!=='way'||!Array.isArray(el.geometry)||el.geometry.length<2)continue;
    const tags=el.tags||{},layer=classify(tags);if(!layer)continue;
    const coords=el.geometry.map(p=>[p.lon,p.lat]);
    const closed=coords.length>3 && coords[0][0]===coords.at(-1)[0] && coords[0][1]===coords.at(-1)[1];
    if(!intersectsAOI(coords,aoi.ring,closed))continue;
    if(layer==='buildings'&&!closed)continue;
    const properties={id:`osm-way-${el.id}`,source:'OpenStreetMap',source_id:`way/${el.id}`,layer,name:tags.name||null,kind:tags.building||tags.highway||tags.waterway||tags.natural||tags.landuse||'',...layer==='buildings'?numHeight(tags):{}};
    layers[layer].push({type:'Feature',geometry:{type:closed&&layer!=='roads'?'Polygon':'LineString',coordinates:closed&&layer!=='roads'?[coords]:coords},properties});
  }
  return layers;
}
function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
export function applyScenario(layers,{enabled=false,min=6,max=18,seed=1}={}) {
  min=Number(min);max=Number(max);seed=Number(seed);
  if(!Number.isFinite(min)||!Number.isFinite(max)||min<2||max>150||max<min||!Number.isInteger(seed))throw new Error('Set a valid height range and whole-number seed.');
  return {...layers,buildings:layers.buildings.map(f=>{
    const p={...f.properties};if(p.height_m===null&&enabled){p.height_m=round(min+(hash(`${p.id}:${seed}`)/4294967295)*(max-min),1);p.height_method='scenario';p.scenario=`${min}–${max} m; seed ${seed}`;}
    return {...f,properties:p};
  })};
}
export function featureCollection(layers,selected=['buildings','roads','water']) {return {type:'FeatureCollection',features:selected.flatMap(x=>layers[x]||[])};}
export function localPoint(p,aoi){return [(p[0]-aoi.origin[0])*aoi.scaleX,(p[1]-aoi.origin[1])*aoi.scaleY];}
function xml(s){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
function triangulate(pts){
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const signed=pts.reduce((s,p,i)=>{const q=pts[(i+1)%pts.length];return s+p[0]*q[1]-q[0]*p[1];},0);
  const direction=Math.sign(signed);if(!direction)return [];
  const indices=pts.map((_,i)=>i),faces=[];
  for(let attempts=0;indices.length>3&&attempts<pts.length*pts.length;attempts++){
    let clipped=false;
    for(let i=0;i<indices.length;i++){
      const a=indices[(i+indices.length-1)%indices.length],b=indices[i],c=indices[(i+1)%indices.length];
      if(cross(pts[a],pts[b],pts[c])*direction<=1e-8)continue;
      const contains=indices.some(j=>j!==a&&j!==b&&j!==c&&[
        cross(pts[a],pts[b],pts[j])*direction,
        cross(pts[b],pts[c],pts[j])*direction,
        cross(pts[c],pts[a],pts[j])*direction
      ].every(x=>x>=-1e-8));
      if(contains)continue;
      faces.push([a,b,c]);indices.splice(i,1);clipped=true;break;
    }
    if(!clipped)break;
  }
  if(indices.length===3)faces.push(indices);
  return indices.length===3?faces:[];
}
export function makeDXF(layers,aoi){
  const out=['0','SECTION','2','HEADER','9','$INSUNITS','70','6','0','ENDSEC','0','SECTION','2','ENTITIES'];
  for(const [layer,features] of Object.entries(layers))for(const f of features){if(f.geometry.type==='Point'){const [x,y]=localPoint(f.geometry.coordinates,aoi);out.push('0','POINT','8',layer.toUpperCase(),'10',x.toFixed(3),'20',y.toFixed(3));continue;}const closed=f.geometry.type==='Polygon';const coords=closed?f.geometry.coordinates[0].slice(0,-1):f.geometry.coordinates;if(coords.length<2)continue;
    out.push('0','LWPOLYLINE','8',layer.toUpperCase(),'90',String(coords.length),'70',closed?'1':'0');
    for(const p of coords){const [x,y]=localPoint(p,aoi);out.push('10',x.toFixed(3),'20',y.toFixed(3));}
  }
  out.push('0','ENDSEC','0','EOF');return out.join('\n')+'\n';
}
export function makeDAE(buildings,aoi,terrain=null,trees=[]){
  const geometries=[],nodes=[];let idx=0;
  const elevations=terrain?.values?.filter(Number.isFinite)||[],base=elevations.length?elevations.reduce((min,value)=>Math.min(min,value),Infinity):0;
  const sample=point=>{
    if(!terrain||!elevations.length)return 0;
    const x=Math.max(0,Math.min(terrain.width-1,(point[0]-terrain.west)/(terrain.east-terrain.west)*terrain.width-.5));
    const y=Math.max(0,Math.min(terrain.height-1,(terrain.north-point[1])/(terrain.north-terrain.south)*terrain.height-.5));
    const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(terrain.width-1,x0+1),y1=Math.min(terrain.height-1,y0+1);
    const samples=[[x0,y0,(1-(x-x0))*(1-(y-y0))],[x1,y0,(x-x0)*(1-(y-y0))],[x0,y1,(1-(x-x0))*(y-y0)],[x1,y1,(x-x0)*(y-y0)]];
    let sum=0,weight=0;for(const [ix,iy,w] of samples){const v=terrain.values[iy*terrain.width+ix];if(Number.isFinite(v)){sum+=v*w;weight+=w;}}
    return weight?sum/weight-base:0;
  };
  if(elevations.length){
    const surface=clippedTerrainSurface(terrain,{type:'Polygon',coordinates:[aoi.ring]});
    const positions=surface.vertices.flatMap(([lon,lat,height])=>[...localPoint([lon,lat],aoi),height]);
    const triangles=surface.vertices.map((_,i)=>i);
    if(triangles.length){
      geometries.push('<geometry id="terrain" name="Terrain preview mesh"><mesh><source id="terrain_position"><float_array id="terrain_array" count="'+positions.length+'">'+positions.map(v=>v.toFixed(3)).join(' ')+'</float_array><technique_common><accessor source="#terrain_array" count="'+positions.length/3+'" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="terrain_vertices"><input semantic="POSITION" source="#terrain_position"/></vertices><triangles material="terrain" count="'+triangles.length/3+'"><input semantic="VERTEX" source="#terrain_vertices" offset="0"/><p>'+triangles.join(' ')+'</p></triangles></mesh></geometry>');
      nodes.push('<node id="terrain_node" name="Terrain"><instance_geometry url="#terrain"><bind_material><technique_common><instance_material symbol="terrain" target="#terrain_material"/></technique_common></bind_material></instance_geometry></node>');
      const span=Math.max((terrain.east-terrain.west)*aoi.scaleX,(terrain.north-terrain.south)*aoi.scaleY,40);
      let peak=base;for(const elevation of elevations)if(elevation>peak)peak=elevation;
      const minZ=-Math.max(32,Math.min(105,span*.055),(peak-base)*.22);
      const cutPositions=positions.map((value,i)=>i%3===2?minZ:value),cutTriangles=[];
      const count=positions.length/3;
      for(let i=0;i<triangles.length;i+=3)cutTriangles.push(count+triangles[i+2],count+triangles[i+1],count+triangles[i]);
      const combined=positions.concat(cutPositions),start=combined.length/3;
      for(const [lon,lat,height] of surface.outline){const [x,y]=localPoint([lon,lat],aoi);combined.push(x,y,height,x,y,minZ);}
      for(let i=0;i<surface.outline.length;i++){const a=start+i*2,b=start+((i+1)%surface.outline.length)*2;cutTriangles.push(a,b,b+1,a,b+1,a+1);}
      geometries.push('<geometry id="terrain_cut" name="Solid terrain cut"><mesh><source id="terrain_cut_position"><float_array id="terrain_cut_array" count="'+combined.length+'">'+combined.map(v=>v.toFixed(3)).join(' ')+'</float_array><technique_common><accessor source="#terrain_cut_array" count="'+combined.length/3+'" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="terrain_cut_vertices"><input semantic="POSITION" source="#terrain_cut_position"/></vertices><triangles material="terrain_cut" count="'+cutTriangles.length/3+'"><input semantic="VERTEX" source="#terrain_cut_vertices" offset="0"/><p>'+cutTriangles.join(' ')+'</p></triangles></mesh></geometry>');
      nodes.push('<node id="terrain_cut_node" name="Solid terrain cut"><instance_geometry url="#terrain_cut"><bind_material><technique_common><instance_material symbol="terrain_cut" target="#terrain_cut_material"/></technique_common></bind_material></instance_geometry></node>');
    }
  }else{
    const footprint=aoi.ring.slice(0,-1).map(point=>localPoint(point,aoi));
    const surface=triangulate(footprint).flat();
    if(surface.length){
      const span=Math.max((aoi.bounds[2]-aoi.bounds[0])*aoi.scaleX,(aoi.bounds[3]-aoi.bounds[1])*aoi.scaleY,40);
      const bottom=-Math.max(32,Math.min(105,span*.055));
      const top=footprint.flatMap(([x,y])=>[x,y,0]),cut=footprint.flatMap(([x,y])=>[x,y,bottom]);
      const faces=[];for(let i=0;i<surface.length;i+=3)faces.push(footprint.length+surface[i+2],footprint.length+surface[i+1],footprint.length+surface[i]);
      for(const [a,b] of surfaceBoundaryEdges(surface))faces.push(a,b,footprint.length+b,a,footprint.length+b,footprint.length+a);
      const geometry=(id,vertices,indices,material)=>`<geometry id="${id}" name="Level site base"><mesh><source id="${id}_position"><float_array id="${id}_array" count="${vertices.length}">${vertices.map(v=>v.toFixed(3)).join(' ')}</float_array><technique_common><accessor source="#${id}_array" count="${vertices.length/3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="${id}_vertices"><input semantic="POSITION" source="#${id}_position"/></vertices><triangles material="${material}" count="${indices.length/3}"><input semantic="VERTEX" source="#${id}_vertices" offset="0"/><p>${indices.join(' ')}</p></triangles></mesh></geometry>`;
      geometries.push(geometry('terrain',top,surface,'terrain'),geometry('terrain_cut',top.concat(cut),faces,'terrain_cut'));
      for(const id of ['terrain','terrain_cut'])nodes.push(`<node id="${id}_node" name="${id==='terrain'?'Level ground':'Solid terrain cut'}"><instance_geometry url="#${id}"><bind_material><technique_common><instance_material symbol="${id}" target="#${id}_material"/></technique_common></bind_material></instance_geometry></node>`);
    }
  }
  for(const f of buildings){const height=f.properties.height_m;if(f.geometry.type!=='Polygon')continue;
    const ring=f.geometry.coordinates[0].slice(0,-1);if(ring.length<3||ring.length>1000)continue;
    const pts=ring.map(p=>localPoint(p,aoi));const n=pts.length;
    const z=sample(ring[0]),raised=Number.isFinite(height)&&height>0;
    const positions=pts.flatMap(([x,y])=>[x,y,z]).concat(raised?pts.flatMap(([x,y])=>[x,y,z+height]):[]);
    const triangles=[];for(const [a,b,c] of triangulate(pts)){if(raised)triangles.push(a,c,b,n+a,n+b,n+c);else triangles.push(a,b,c);}
    if(raised)for(let j=0;j<n;j++){let k=(j+1)%n;triangles.push(j,k,n+k,j,n+k,n+j);}
    if(!triangles.length)continue;
    const id=`building_${idx++}`, color=!raised?'unknown':f.properties.height_method==='recorded'?'observed':f.properties.height_method==='scenario'?'scenario':'estimate';
    geometries.push(`<geometry id="${id}" name="${xml(f.properties.id)}"><mesh><source id="${id}_position"><float_array id="${id}_array" count="${positions.length}">${positions.map(v=>v.toFixed(3)).join(' ')}</float_array><technique_common><accessor source="#${id}_array" count="${positions.length/3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="${id}_vertices"><input semantic="POSITION" source="#${id}_position"/></vertices><triangles material="${color}" count="${triangles.length/3}"><input semantic="VERTEX" source="#${id}_vertices" offset="0"/><p>${triangles.join(' ')}</p></triangles></mesh></geometry>`);
    nodes.push(`<node id="${id}_node" name="${xml(f.properties.id)}"><instance_geometry url="#${id}"><bind_material><technique_common><instance_material symbol="${color}" target="#${color}_material"/></technique_common></bind_material></instance_geometry></node>`);
  }
  if(trees.length){
    const v=[-2,-2,1,2,-2,1,2,2,1,-2,2,1,0,0,5],f=[0,1,4,1,2,4,2,3,4,3,0,4];
    geometries.push(`<geometry id="tree_marker"><mesh><source id="tree_pos"><float_array id="tree_array" count="15">${v.join(' ')}</float_array><technique_common><accessor source="#tree_array" count="5" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="tree_verts"><input semantic="POSITION" source="#tree_pos"/></vertices><triangles material="tree" count="4"><input semantic="VERTEX" source="#tree_verts" offset="0"/><p>${f.join(' ')}</p></triangles></mesh></geometry>`);
    for(let i=0;i<trees.length;i++){const point=trees[i].geometry?.coordinates;if(trees[i].geometry?.type!=='Point'||!point?.every(Number.isFinite))continue;const [x,y]=localPoint(point,aoi),z=sample(point);nodes.push(`<node id="tree_${i}" name="Symbolic tree"><translate>${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}</translate><instance_geometry url="#tree_marker"><bind_material><technique_common><instance_material symbol="tree" target="#tree_material"/></technique_common></bind_material></instance_geometry></node>`);}
  }
  const mats=[['observed','0.26 0.34 0.33 1'],['estimate','0.55 0.57 0.52 1'],['scenario','0.93 0.56 0.26 1'],['unknown','0.62 0.67 0.64 1'],['terrain','0.75 0.79 0.69 1'],['terrain_cut','0.55 0.45 0.34 1'],['tree','0.20 0.48 0.30 1']];
  return `<?xml version="1.0" encoding="utf-8"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><contributor><author>Site Context Studio</author></contributor><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset><library_effects>${mats.map(([id,c])=>`<effect id="${id}_effect"><profile_COMMON><technique sid="common"><lambert><diffuse><color>${c}</color></diffuse></lambert></technique></profile_COMMON></effect>`).join('')}</library_effects><library_materials>${mats.map(([id])=>`<material id="${id}_material" name="${id}"><instance_effect url="#${id}_effect"/></material>`).join('')}</library_materials><library_geometries>${geometries.join('')}</library_geometries><library_visual_scenes><visual_scene id="scene">${nodes.join('')}</visual_scene></library_visual_scenes><scene><instance_visual_scene url="#scene"/></scene></COLLADA>`;
}
export function makeZip(entries){
  const chunks=[],central=[];let offset=0;
  for(const [name,data] of Object.entries(entries)){
    const bytes=Buffer.from(data),label=Buffer.from(name),crc=crc32(bytes);
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);h.writeUInt32LE(bytes.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(label.length,26);chunks.push(h,label,bytes);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(bytes.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(label.length,28);c.writeUInt32LE(offset,42);central.push(c,label);offset+=h.length+label.length+bytes.length;
  }
  const middle=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(middle.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,middle,end]);
}
function crc32(buf){let crc=-1;for(const b of buf){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^-1)>>>0;}
