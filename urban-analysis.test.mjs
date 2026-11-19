import test from 'node:test';
import assert from 'node:assert/strict';
import {clippedArea,urbanGeometry,localWalkReach,planSightlines,studyBoundary,pointInsidePolygon,segmentInsidePolygon} from './public/urban-analysis.js';

const centre=[72.57397,23.02476];
const east=metres=>centre[0]+metres/(111320*Math.cos(centre[1]*Math.PI/180));
const north=metres=>centre[1]+metres/110574;
const position=(x,y)=>[east(x),north(y)];
const square={type:'Polygon',coordinates:[[position(-500,-500),position(500,-500),position(500,500),position(-500,500),position(-500,-500)]]};
const building=(id,minX,minY,maxX,maxY)=>({type:'Feature',properties:{id,layer:'buildings'},geometry:{type:'Polygon',coordinates:[[position(minX,minY),position(maxX,minY),position(maxX,maxY),position(minX,maxY),position(minX,minY)]]}});
const street=(id,a,b)=>({type:'Feature',properties:{id,layer:'roads',kind:'road'},geometry:{type:'LineString',coordinates:[position(...a),position(...b)]}});

test('built coverage clips mapped polygons to the selected boundary',()=>{
  const partial=building('edge',450,-50,550,50),area=clippedArea(partial,square);
  assert.ok(Math.abs(area-5000)<25,`expected approximately 5000 m², got ${area}`);
  const stats=urbanGeometry({buildings:[partial],roads:[],landuse:[]},square);
  assert.ok(stats.coveragePercent>.49&&stats.coveragePercent<.51);
  assert.equal(stats.recordedCount,0);
});

test('concave captured polygon controls coverage, connected routes, viewpoint and ray boundaries',()=>{
  const polygon={type:'Polygon',coordinates:[[position(-500,-500),position(500,-500),position(500,500),position(100,500),position(100,100),position(-500,100),position(-500,-500)]]};
  const boundary=studyBoundary(polygon);
  assert.ok(Math.abs(boundary.areaM2-760000)<25);
  assert.ok(pointInsidePolygon(position(400,400),polygon));
  assert.equal(pointInsidePolygon(position(-250,350),polygon),false);
  const excluded=building('outside-notch',-300,180,-200,280),part=building('corner',50,50,150,150);
  assert.equal(clippedArea(excluded,polygon),0);
  assert.ok(Math.abs(clippedArea(part,polygon)-7500)<25);
  const report=urbanGeometry({buildings:[excluded,part],roads:[street('crosses-notch',[-400,300],[400,300])]},polygon);
  assert.ok(Math.abs(report.roadM-300)<1);
  assert.ok(Math.abs(report.coveragePercent-7500/760000*100)<.01);
  const reach=localWalkReach([street('crosses-notch',[-400,300],[400,300])],polygon);
  assert.equal(reach.segments,1);
  assert.equal(planSightlines([],polygon,{viewpoint:position(-250,350)}).status,'unavailable');
  const rays=planSightlines([],polygon,{viewpoint:position(0,0)});
  assert.equal(rays.status,'ready');
  assert.ok(rays.lines[0].properties.distance_m<105);
});

test('a road crossing a polygon notch yields two disconnected inside segments',()=>{
  const u={type:'Polygon',coordinates:[[position(-500,-500),position(500,-500),position(500,500),position(200,500),position(200,-100),position(-200,-100),position(-200,500),position(-500,500),position(-500,-500)]]};
  const intervals=segmentInsidePolygon(position(-400,250),position(400,250),u);
  assert.equal(intervals.length,2);
  assert.ok(Math.abs(intervals.reduce((sum,[a,b])=>sum+(b-a)*800,0)-400)<1);
  assert.ok(Math.abs(urbanGeometry({buildings:[],landuse:[],roads:[street('u',[-400,250],[400,250])]},u).roadM-400)<1);
});

test('walking reach follows connected mapped roads and keeps isolated roads unavailable',()=>{
  const roads=[street('first',[0,0],[200,0]),street('second',[200,0],[400,0]),street('third',[400,0],[500,0]),street('isolated',[-400,200],[-300,200])];
  const reach=localWalkReach(roads,square);
  assert.equal(reach.status,'ready');
  assert.ok(reach.roadsWithin10>reach.roadsWithin5);
  assert.equal(reach.minutesByRoad[3],null);
  assert.match(reach.method,/not a walkability score/);
});

test('plan sightlines stop at footprints and reject viewpoints inside a building',()=>{
  const obstruction=building('obstruction',70,-30,100,30),result=planSightlines([obstruction],square);
  assert.equal(result.status,'ready');
  assert.ok(result.unblocked<result.rays);
  assert.equal(result.lines[18].properties.blocked,true);
  assert.equal(result.lines[0].properties.blocked,false);
  assert.equal(planSightlines([obstruction],square,{viewpoint:position(85,0)}).status,'unavailable');
});
