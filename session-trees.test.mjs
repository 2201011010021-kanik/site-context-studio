import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createMemoryCaptureStore} from './capture-store.mjs';
import * as geo from './geo.mjs';
import {pack} from './server.mjs';
import {addBrowserTrees} from './public/tree-export.js';

test('session store keeps terrain only in memory and clears it on removal',async()=>{
  const store=createMemoryCaptureStore(),id=randomUUID(),bytes=Buffer.from('II*\0image');
  await store.saveTerrain(id,bytes);await store.saveTerrainTile(id,'14-1-2',bytes,'source');
  assert.equal(await store.readTerrain(id),bytes);
  assert.equal((await store.readTerrainTile(id,'14-1-2')).source,'source');
  assert.deepEqual(await store.load(),[]);
  await store.remove(id);assert.equal(await store.readTerrainTile(id,'14-1-2'),null);
  await assert.rejects(store.readTerrain(id),{code:'ENOENT'});
});

test('browser adds reviewed tree dots to 2D GIS and symbolic 3D in the downloaded ZIP',async()=>{
  const polygon={type:'Polygon',coordinates:[[[72,23],[72.01,23],[72.01,23.01],[72,23.01],[72,23]]]};
  const job={polygon,aoi:geo.validateAOI(polygon),id:randomUUID(),layers:{buildings:[],roads:[],water:[],landuse:[],trees:[]},retrievedAt:'2026-11-03T00:00:00Z'};
  const original=pack(job,{scenario:{},layers:{trees:true}});
  const tree={type:'Feature',geometry:{type:'Point',coordinates:[72.005,23.005]},properties:{id:'image-proposal-0',layer:'trees',source:'Imagery proposal'}};
  const result=await addBrowserTrees(new Blob([original]),[tree],polygon,{scenario:{},layers:{trees:true}},null,geo);
  const buffer=Buffer.from(await result.arrayBuffer());
  const file=name=>{let offset=0;while(buffer.readUInt32LE(offset)===0x04034b50){const size=buffer.readUInt32LE(offset+18),label=buffer.subarray(offset+30,offset+30+buffer.readUInt16LE(offset+26)).toString(),start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28);if(label===name)return buffer.subarray(start,start+size).toString();offset=start+size;}throw Error('Missing '+name);};
  assert.equal(JSON.parse(file('site_layers.geojson')).features[0].properties.id,tree.properties.id);
  assert.match(file('site_layers.dxf'),/POINT\n8\nTREES/);
  assert.match(file('site_massing.dae'),/tree_0/);
  assert.equal(JSON.parse(file('provenance.json')).layers.trees,1);
});
