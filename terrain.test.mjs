import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {decodeTerrarium,fetchTerrain,geoTiff,terrainPlan,previewFromGeoTiff} from './terrain.mjs';
import {validateAOI} from './geo.mjs';

test('terrain budget accepts a 10 km² polygon and writes a georeferenced float DEM',()=>{
  const aoi=validateAOI({type:'Polygon',coordinates:[[[73.84,18.51],[73.87,18.51],[73.87,18.54],[73.84,18.54],[73.84,18.51]]]});
  const plan=terrainPlan(aoi);assert.ok(aoi.areaKm2>=10);assert.ok(plan.tileCount<=24);
  const png=tileFixture();
  const values=decodeTerrarium(png);assert.equal(values.length,65536);assert.equal(values[0],100.25);
  const tif=geoTiff(new Float32Array([100.25,-9999,101,102]),2,2,{...plan,x0:plan.x0,y0:plan.y0});
  assert.equal(tif.subarray(0,4).toString('hex'),'49492a00');
  assert.equal(tif.readUInt16LE(8),15);
  assert.ok(tif.includes(Buffer.from([0xaf,0x87,3,0]))); // GeoKeyDirectoryTag 34735
  assert.ok(tif.includes(Buffer.from('-9999\0')));
  assert.equal(tif.readFloatLE(tif.length-16),100.25);
  assert.deepEqual(previewFromGeoTiff(tif,{west:73,east:74,north:19,south:18}).values,[100.3,null,101,102]);
  const larger=geoTiff(new Float32Array(300*260).fill(125),300,260,plan);
  const preview=previewFromGeoTiff(larger,{west:73,east:74,north:19,south:18});
  assert.equal(preview.width,256);assert.equal(preview.height,256);assert.equal(preview.values.length,256*256);
});
test('terrain retry uses saved tiles without a network request',async()=>{
  const aoi=validateAOI({type:'Polygon',coordinates:[[[73.855,18.52],[73.856,18.52],[73.856,18.521],[73.855,18.521],[73.855,18.52]]]});
  let reads=0;
  const result=await fetchTerrain(aoi,new AbortController().signal,()=>{},
    {readTile:async()=>{reads++;return {bytes:tileFixture(),source:'srtm/N18E073.tif'};},saveTile:()=>{throw new Error('Unexpected network download');}});
  assert.equal(reads,terrainPlan(aoi).tileCount);
  assert.deepEqual(result.metadata.sourceTiles,['srtm/N18E073.tif']);
  assert.equal(result.metadata.elevationMinMeters,100.25);
});
function tileFixture(){
  const row=Buffer.alloc(1+256*3);for(let x=0;x<256;x++){row[1+x*3]=128;row[2+x*3]=100;row[3+x*3]=64;}
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr()),chunk('IDAT',deflateSync(Buffer.concat(Array(256).fill(row)))),chunk('IEND',Buffer.alloc(0))]);
}
function ihdr(){const b=Buffer.alloc(13);b.writeUInt32BE(256,0);b.writeUInt32BE(256,4);b[8]=8;b[9]=2;return b;}
function chunk(type,data){const head=Buffer.alloc(8),crc=Buffer.alloc(4);head.writeUInt32BE(data.length);head.write(type,4);return Buffer.concat([head,data,crc]);}
