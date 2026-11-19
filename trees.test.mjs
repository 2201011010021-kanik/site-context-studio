import test from 'node:test';
import assert from 'node:assert/strict';
import {mappedTrees} from './trees.mjs';
import {makeDXF} from './geo.mjs';

test('tree nodes are clipped to polygon, attributed, and exported as DXF points',()=>{
  const polygon={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]};
  const features=mappedTrees([
    {type:'node',id:1,lon:1,lat:1,tags:{natural:'tree',species:'Ficus'}},
    {type:'node',id:2,lon:3,lat:1,tags:{natural:'tree'}},
    {type:'node',id:3,lon:1,lat:1,tags:{natural:'rock'}}
  ],polygon);
  assert.equal(features.length,1);
  assert.equal(features[0].properties.species,'Ficus');
  assert.match(makeDXF({trees:features},{origin:[0,0],scaleX:1,scaleY:1}),/POINT\n8\nTREES/);
});
