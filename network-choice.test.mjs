import test from 'node:test';
import assert from 'node:assert/strict';
import {localRoadChoice} from './public/network-choice.js';

test('local road choice favors connected through streets and isolates disconnected roads',async()=>{
  const point=(x,y=23)=>[72+x*.001,y];
  const street=(id,a,b)=>({type:'Feature',properties:{id},geometry:{type:'LineString',coordinates:[point(a),point(b)]}});
  const result=await localRoadChoice([street('outer-west',0,1),street('middle-west',1,2),street('middle-east',2,3),street('outer-east',3,4),street('isolated',10,11)]);
  assert.equal(result.status,'ready');
  assert.equal(result.segments,5);
  assert.ok(result.scores[1]>result.scores[0]);
  assert.ok(result.scores[2]>result.scores[3]);
  assert.ok(result.scores[4]<result.scores[1]);
  assert.match(result.method,/not measured footfall/);
});
