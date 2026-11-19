import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {validateAOI} from './geo.mjs';
import {extractLocalContext} from './offline-extract.mjs';

const index=new URL('./local-data/site-context.gpkg',import.meta.url);
test('real regional index preserves distinct source features and confidence', {skip:!existsSync(index)}, async()=>{
  const aoi=validateAOI({type:'Polygon',coordinates:[[[72.57,23.02],[72.58,23.02],[72.58,23.03],[72.57,23.03],[72.57,23.02]]]});
  const {layers}=await extractLocalContext(index.pathname,aoi);
  assert.ok(layers.buildings.length>1000);
  assert.ok(layers.roads.length>50);
  assert.equal(layers.water.length,3);
  for(const layer of Object.values(layers))assert.equal(new Set(layer.map(f=>f.properties.id)).size,layer.length);
  assert.ok(layers.buildings.every(f=>Number.isFinite(f.properties.confidence)&&f.properties.source_id!=='undefined'));
  assert.ok(layers.water.every(f=>f.geometry.coordinates[0][0][0]>72&&f.geometry.coordinates[0][0][1]>22));
});
