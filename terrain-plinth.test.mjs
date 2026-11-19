import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceBoundaryEdges} from './public/terrain-plinth.js';
import {clippedTerrainSurface} from './public/terrain-surface.js';
import {pointInsidePolygon} from './public/urban-analysis.js';

test('terrain cut follows the valid surface rather than an outer rectangular grid',()=>{
  const trianglePairs=[0,3,1,1,3,4,1,4,2,2,4,5,3,6,4,4,6,7];
  const edges=surfaceBoundaryEdges(trianglePairs);
  assert.equal(edges.length,8);
  assert.ok(edges.some(edge=>edge.includes(5)));
  assert.ok(edges.some(edge=>edge.includes(7)));
  assert.ok(!edges.some(edge=>edge.includes(8)));
  assert.deepEqual(surfaceBoundaryEdges([0,2,1,0,3,2]).length,4);
});

test('DEM top and cut outline meet the exact drawn polygon even with masked outer pixels',()=>{
  const polygon={type:'Polygon',coordinates:[[[72,23],[72.004,23],[72.004,23.004],[72.002,23.002],[72,23.004],[72,23]]]};
  const terrain={west:71.999,east:72.005,south:22.999,north:23.005,width:6,height:6,values:Array(36).fill(100)};
  terrain.values[0]=null;terrain.values[1]=null;
  const {vertices,outline}=clippedTerrainSurface(terrain,polygon);
  assert.ok(vertices.length>30);
  assert.ok(outline.length>5);
  for(const point of vertices){const ring=polygon.coordinates[0];
    const onEdge=ring.slice(1).some((p,i)=>{const a=ring[i],t=Math.max(0,Math.min(1,((point[0]-a[0])*(p[0]-a[0])+(point[1]-a[1])*(p[1]-a[1]))/((p[0]-a[0])**2+(p[1]-a[1])**2)));return Math.hypot(a[0]+t*(p[0]-a[0])-point[0],a[1]+t*(p[1]-a[1])-point[1])<1e-8;});
    assert.ok(pointInsidePolygon(point,polygon)||onEdge);
  }
  assert.deepEqual(outline[0].slice(0,2),polygon.coordinates[0][0]);
  assert.ok(outline.every(p=>p[2]===0));
});
