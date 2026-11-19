import test from 'node:test';
import assert from 'node:assert/strict';
import {siteInsights,lineInsideMeters} from './site-insights.mjs';

test('summarizes height evidence without turning missing or invalid data into measurements', () => {
  const building = (height_m, height_method) => ({properties:{height_m,height_method}});
  const result = siteInsights({buildings:[building(9,'recorded'),building(15,'recorded'),building(6.4,'floor_estimate'),building(null,'unknown'),building(0,'recorded')],roads:[{},{}]}, {id:'capture-1',release:'2026-10-21.0'});
  assert.deepEqual(result.heightEvidence,{recorded:2,floor_estimate:1,unknown:2});
  assert.equal(result.recordedHeightMedianM,12);
  assert.equal(result.footprintCount,5);
  assert.equal(result.otherMappedFeatures.roads,2);
  assert.equal(result.release,'2026-10-21.0');
  assert.equal(siteInsights({buildings:[]}).recordedHeightMedianM,null);
});

test('clips road centreline segments to a concave site rather than counting full features',()=>{
  const ring=[[0,0],[.01,0],[.01,.01],[.006,.01],[.006,.004],[.004,.004],[.004,.01],[0,.01],[0,0]];
  const across=[[-.005,.006],[.015,.006]];
  const measured=lineInsideMeters(across,ring);
  assert.ok(measured>850&&measured<900); // 0.008 degrees inside the two arms
  const roads=[{geometry:{type:'LineString',coordinates:across},properties:{kind:'residential'}},
    {geometry:{type:'LineString',coordinates:[[.02,.02],[.03,.03]]},properties:{kind:'service'}}];
  const report=siteInsights({buildings:[],roads},{polygon:{type:'Polygon',coordinates:[ring]}});
  assert.equal(report.movement.mappedSegmentCount,2);
  assert.equal(report.movement.segmentsInsideBoundary,1);
  assert.ok(report.movement.lengthKm>.85&&report.movement.lengthKm<.9);
  assert.deepEqual(report.movement.byKind.map(x=>x.kind),['residential']);
});
