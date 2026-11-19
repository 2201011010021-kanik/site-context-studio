import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAOI,planTiles,mergeLayers,fromOverpass,applyScenario,featureCollection,makeDXF,makeDAE,makeZip} from './geo.mjs';
import {pack} from './server.mjs';
import {createOverpassClient} from './overpass-client.mjs';
import {makeIllustration} from './public/illustration.js';

const ring=[[72.5700,23.0200],[72.5720,23.0200],[72.5720,23.0220],[72.5700,23.0220],[72.5700,23.0200]];
const aoi=validateAOI({type:'Polygon',coordinates:[ring]});
const fixture={elements:[
  {type:'way',id:1,tags:{building:'residential',height:'11 m'},geometry:[{lon:72.5703,lat:23.0203},{lon:72.5706,lat:23.0203},{lon:72.5706,lat:23.0206},{lon:72.5703,lat:23.0206},{lon:72.5703,lat:23.0203}]},
  {type:'way',id:2,tags:{building:'yes'},geometry:[{lon:72.5710,lat:23.0203},{lon:72.5713,lat:23.0203},{lon:72.5713,lat:23.0206},{lon:72.5710,lat:23.0206},{lon:72.5710,lat:23.0203}]},
  {type:'way',id:3,tags:{highway:'residential'},geometry:[{lon:72.5695,lat:23.021},{lon:72.5725,lat:23.021}]},
  {type:'way',id:4,tags:{landuse:'residential'},geometry:[{lon:72.5701,lat:23.0201},{lon:72.5718,lat:23.0201},{lon:72.5718,lat:23.0218},{lon:72.5701,lat:23.0218},{lon:72.5701,lat:23.0201}]},
  {type:'way',id:5,tags:{building:'yes'},geometry:[{lon:72.58,lat:23.03},{lon:72.581,lat:23.03},{lon:72.581,lat:23.031},{lon:72.58,lat:23.031},{lon:72.58,lat:23.03}]}
]};

test('validates a small site and rejects crossed boundaries',()=>{
  assert.ok(aoi.areaKm2>.01&&aoi.areaKm2<5);
  assert.throws(()=>validateAOI({type:'Polygon',coordinates:[[[0,0],[.01,0],[0,.01],[.01,.01],[0,0]]]}),/crosses itself|too small/);
});

test('accepts areas larger than 5 km² and plans deduplicated sequential tiles',()=>{
  const big=validateAOI({type:'Polygon',coordinates:[[[72.57,23.02],[72.61,23.02],[72.61,23.05],[72.57,23.05],[72.57,23.02]]]});
  assert.ok(big.areaKm2>5);
  const tiles=planTiles(big,{maxTiles:12});assert.ok(tiles.length>1&&tiles.length<=12);
  assert.throws(()=>planTiles(big,{maxTiles:1}),/more than 1 map requests/);
  const part=fromOverpass(fixture,aoi),merged={buildings:[],roads:[],water:[],landuse:[]};
  mergeLayers(merged,part);mergeLayers(merged,part);
  assert.equal(merged.buildings.length,2);
  assert.equal(merged.roads.length,1);
});

test('filters intersecting ways and preserves measured versus invented heights',()=>{
  const layers=fromOverpass(fixture,aoi);
  assert.equal(layers.buildings.length,2);
  assert.equal(layers.roads.length,1);
  assert.equal(layers.landuse.length,1);
  assert.equal(layers.buildings[0].properties.height_method,'recorded');
  const first=applyScenario(layers,{enabled:true,min:6,max:18,seed:1});
  const second=applyScenario(layers,{enabled:true,min:6,max:18,seed:1});
  assert.equal(first.buildings[0].properties.height_m,11);
  assert.equal(first.buildings[1].properties.height_m,second.buildings[1].properties.height_m);
  assert.equal(first.buildings[1].properties.height_method,'scenario');
  assert.equal(layers.buildings[1].properties.height_m,null);
  assert.equal(featureCollection(first).features.length,3);
  assert.match(makeDXF({buildings:first.buildings,roads:first.roads},aoi),/\$INSUNITS\n70\n6/);
  const dae=makeDAE(first.buildings,aoi);
  assert.match(dae,/<triangles material="scenario" count="12">/);
  assert.match(dae,/<geometry id="terrain_cut" name="Level site base"/);
  assert.match(dae,/<up_axis>Z_UP<\/up_axis>/);
});

test('writes a standard ZIP with each provenance and geometry entry',()=>{
  const zip=makeZip({'site_layers.geojson':'{}','provenance.json':'{"source":"OSM"}'});
  assert.equal(zip.readUInt32LE(0),0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length-14),2);
});

test('terrain and all valid building footprints share a model, with unknown heights flat',()=>{
  const layers=fromOverpass(fixture,aoi);
  const terrain={width:3,height:3,west:72.5700,east:72.5720,south:23.0200,north:23.0220,values:[105,106,107,103,104,105,100,101,102]};
  const dae=makeDAE(layers.buildings,aoi,terrain);
  assert.match(dae,/<geometry id="terrain"/);
  assert.match(dae,/<triangles material="terrain" count="\d+"/);
  assert.match(dae,/<geometry id="terrain_cut" name="Solid terrain cut"/);
  assert.match(dae,/<triangles material="terrain_cut" count="\d+"/);
  assert.match(dae,/<geometry id="building_1"/);
  assert.match(dae,/<triangles material="unknown" count="2"/);
  assert.match(dae,/<up_axis>Z_UP<\/up_axis>/);
});

test('illustration draws captured layers and escapes user labels',()=>{
  const layers=fromOverpass(fixture,aoi),polygon={type:'Polygon',coordinates:[ring]};
  const svg=makeIllustration({polygon,layers,options:{labels:[{text:'Site <one> & more',x:.5,y:.5}],visible:{water:false,contours:false}}});
  assert.match(svg,/<g id="buildings"/);assert.match(svg,/<g id="roads"/);
  assert.doesNotMatch(svg,/<g id="water"/);
  assert.match(svg,/Site &lt;one&gt; &amp; more/);
  assert.doesNotMatch(svg,/id="trees"/);
  const top=makeIllustration({polygon,layers,options:{view:'Top',preset:'Clay'}});
  assert.match(top,/fill="#edeae2"/);
  const heavy=makeIllustration({polygon,layers,options:{strokeWeight:2}});
  assert.match(heavy,/id="roads"[^>]+stroke-width="4.00"/);
  assert.match(heavy,/id="buildings"[^>]+stroke-width="1.50"/);
});

test('package obeys selected layers and includes attribution and assumptions',()=>{
  const layers=fromOverpass(fixture,aoi);
  const zip=pack({polygon:{type:'Polygon',coordinates:[ring]},aoi,layers,retrievedAt:'2026-10-31T00:00:00.000Z'},
    {layers:{buildings:false,roads:true,water:false,landuse:true},scenario:{enabled:true,min:6,max:18,seed:2}});
  const entries={};let offset=0;
  while(zip.readUInt32LE(offset)===0x04034b50){
    const size=zip.readUInt32LE(offset+18),nameLength=zip.readUInt16LE(offset+26),name=zip.subarray(offset+30,offset+30+nameLength).toString();
    entries[name]=zip.subarray(offset+30+nameLength,offset+30+nameLength+size).toString();offset+=30+nameLength+size;
  }
  const data=JSON.parse(entries['site_layers.geojson']);
  const manifest=JSON.parse(entries['provenance.json']);
  assert.deepEqual(data.features.map(f=>f.properties.layer).sort(),['landuse','roads']);
  assert.deepEqual(manifest.layers,{roads:1,landuse:1});
  const analysis=JSON.parse(entries['site_analysis.json']);
  assert.equal(analysis.footprintCount,0);
  assert.equal(analysis.otherMappedFeatures.roads,1);
  assert.equal(analysis.recordedHeightMedianM,null);
  assert.ok(!entries['site_massing.dae'].includes('<geometry id="building_'));
  assert.match(entries['README.txt'],/OpenStreetMap contributors/);
});

test('bounded failover validates data, opens and recovers circuits, and serves labelled cache',async()=>{
  let clock=100000,calls=[],first='bad',second='good';
  const good=()=>new Response(JSON.stringify({elements:fixture.elements}),{status:200});
  const fetcher=async url=>{calls.push(url);const mode=url.endsWith('/a')?first:second;
    if(mode==='bad')return new Response('Gateway timeout',{status:504});
    if(mode==='invalid')return new Response('{"wrong":[]}',{status:200});
    if(mode==='timeout')throw new DOMException('Timed out','AbortError');
    if(mode==='disconnect')throw new TypeError('Network failed');
    if(mode==='rate')return new Response('',{status:429,headers:{'Retry-After':'17'}});
    return good();
  };
  const client=createOverpassClient({providers:['https://test.invalid/a','https://test.invalid/b'],fetcher,now:()=>clock,pause:async()=>{},cacheTtlMs:1000,staleTtlMs:200000,logger:()=>{}});
  const other=[...aoi.bounds];other[0]+=.001;
  const r=await client.request(aoi.bounds);assert.equal(r.endpoint,'https://test.invalid/b');assert.equal(r.cacheStatus,'live');assert.equal(calls.length,2);
  const cached=await client.request(aoi.bounds);assert.equal(cached.cacheStatus,'fresh');assert.equal(calls.length,2);
  clock+=2000;first='invalid';second='bad';const stale=await client.request(aoi.bounds);
  assert.equal(stale.cacheStatus,'stale');assert.equal(stale.cacheAgeSeconds,2);
  calls=[];await assert.rejects(()=>client.request(other),error=>error.status===503&&error.diagnostics.some(x=>x.code==='CIRCUIT_OPEN'));
  assert.equal(calls.length,1);
  calls=[];await assert.rejects(()=>client.request(other),error=>error.status===503&&error.diagnostics.every(x=>x.code==='CIRCUIT_OPEN'));
  assert.equal(calls.length,0);
  clock+=61000;first='good';second='bad';const recovered=await client.request(other);
  assert.equal(recovered.endpoint,'https://test.invalid/a');assert.equal(client.snapshot()[0].failures,0);
  first='rate';calls=[];await assert.rejects(()=>client.request([...other.slice(0,1),other[1]+.001,...other.slice(2)]),error=>error.status===429&&error.retryAfterSeconds===17);
  assert.equal(calls.length,1);
});

test('rejects invalid data, complete outage and a real abort without inventing features',async()=>{
  const bounds=aoi.bounds,providers=['https://test.invalid/a','https://test.invalid/b'];
  for(const mode of ['504','disconnect','timeout','invalid']){
    const client=createOverpassClient({providers,fetcher:async()=>{
      if(mode==='504')return new Response('',{status:504});
      if(mode==='invalid')return new Response('{"elements":null}',{status:200});
      throw mode==='timeout'?new DOMException('Timeout','AbortError'):new TypeError('Network failed');
    },pause:async()=>{},logger:()=>{}});
    await assert.rejects(()=>client.request(bounds),error=>error.status===503&&error.diagnostics.length>=2);
  }
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>createOverpassClient({providers}).request(bounds,controller.signal),error=>error.code==='CANCELLED');
});
