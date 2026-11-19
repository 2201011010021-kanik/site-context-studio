import test from 'node:test';
import assert from 'node:assert/strict';
import {squareAt,resizeRectangle,rectangleDimensions} from './public/area-shapes.js';
import {validateAOI} from './geo.mjs';

test('one map click creates a square that can be captured as a site polygon', () => {
  const corners = squareAt([23.02,72.57]);
  const {width,height} = rectangleDimensions(corners);
  assert.ok(Math.abs(width - height) < 1);
  const ring = [...corners,corners[0]].map(([lat,lng]) => [lng,lat]);
  assert.ok(validateAOI({type:'Polygon',coordinates:[ring]}).areaKm2 > .1);
});

test('dragging any corner resizes a rectangle while the opposite corner stays fixed', () => {
  const start = squareAt([23.02,72.57]);
  for (let corner = 0; corner < 4; corner++) {
    const opposite = start[(corner+2)%4];
    const next = resizeRectangle(start,corner,[start[corner][0]+(corner<2?.001:-.001),start[corner][1]+(corner===0||corner===3?-.002:.002)]);
    assert.deepEqual(next[(corner+2)%4],opposite);
    assert.equal(next[0][0],next[1][0]);
    assert.equal(next[2][0],next[3][0]);
    assert.equal(next[0][1],next[3][1]);
    assert.equal(next[1][1],next[2][1]);
    const ring=[...next,next[0]].map(([lat,lng])=>[lng,lat]);
    assert.ok(validateAOI({type:'Polygon',coordinates:[ring]}).areaKm2 > .01);
  }
});

test('handles cannot cross the opposite corner and collapse the selected area', () => {
  const corners = squareAt([23.02,72.57]);
  const next = resizeRectangle(corners,0,[22.9,73]);
  const {width,height} = rectangleDimensions(next);
  assert.ok(width >= 11.9 && height >= 11.9);
  assert.deepEqual(next[2],corners[2]);
});
