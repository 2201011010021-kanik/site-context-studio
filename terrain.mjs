import {inflateSync} from 'node:zlib';
import {pointInside} from './geo.mjs';

const radius=6378137,halfWorld=Math.PI*radius,nodata=-9999;
const pixel=(lon,lat,z)=>{
  const side=256*2**z,rad=Math.PI/180;
  return [(lon+180)/360*side,(1-Math.asinh(Math.tan(Math.max(-85,Math.min(85,lat))*rad))/Math.PI)/2*side];
};
const longitude=(x,z)=>x/(256*2**z)*360-180;
const latitude=(y,z)=>Math.atan(Math.sinh(Math.PI*(1-2*y/(256*2**z))))*180/Math.PI;

export function terrainPlan(aoi){
  const [west,south,east,north]=aoi.bounds;
  for(let z=14;z>=8;z--){
    const [left,top]=pixel(west,north,z),[right,bottom]=pixel(east,south,z);
    const x0=Math.floor(left),x1=Math.ceil(right),y0=Math.floor(top),y1=Math.ceil(bottom);
    const tileCount=(Math.floor((x1-1)/256)-Math.floor(x0/256)+1)*(Math.floor((y1-1)/256)-Math.floor(y0/256)+1);
    if((x1-x0)*(y1-y0)<=1024*1024&&tileCount<=24)return {z,x0,x1,y0,y1,tileCount,pixelSizeMeters:2*halfWorld/(256*2**z)};
  }
  throw new Error('Terrain area exceeds the 24-tile or one-million-pixel budget. Select a smaller area.');
}

export function decodeTerrarium(png){
  if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Terrain provider returned an invalid PNG.');
  let width=0,height=0,channels=0,compressed=[];
  for(let at=8;at+12<=png.length;){
    const length=png.readUInt32BE(at),type=png.toString('ascii',at+4,at+8),end=at+12+length;
    if(end>png.length)throw new Error('Incomplete terrain PNG.');
    if(type==='IHDR'){
      width=png.readUInt32BE(at+8);height=png.readUInt32BE(at+12);
      if(width!==256||height!==256||png[at+16]!==8||![2,6].includes(png[at+17])||png[at+20]!==0)throw new Error('Unexpected terrain PNG format.');
      channels=png[at+17]===6?4:3;
    }
    if(type==='IDAT')compressed.push(png.subarray(at+8,at+8+length));
    at=end;if(type==='IEND')break;
  }
  if(!channels||!compressed.length)throw new Error('Terrain PNG has no pixel data.');
  const raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:256*(1+256*channels)});
  const stride=width*channels;if(raw.length!==height*(stride+1))throw new Error('Invalid terrain pixel length.');
  const out=new Float32Array(width*height),prev=Buffer.alloc(stride);let offset=0;
  for(let y=0;y<height;y++){
    const filter=raw[offset++],row=Buffer.alloc(stride);
    if(filter>4)throw new Error('Unknown terrain PNG filter.');
    for(let i=0;i<stride;i++){
      const a=i>=channels?row[i-channels]:0,b=prev[i],c=i>=channels?prev[i-channels]:0;
      const predictor=filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):0;
      row[i]=(raw[offset++]+predictor)&255;
    }
    for(let x=0;x<width;x++){
      const i=x*channels;out[y*width+x]=row[i]*256+row[i+1]+row[i+2]/256-32768;
    }
    row.copy(prev);
  }
  return out;
}
function paeth(a,b,c){const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;}

export function geoTiff(values,width,height,plan){
  const scale=plan.pixelSizeMeters,minX=-halfWorld+plan.x0*scale,maxY=halfWorld-plan.y0*scale;
  const pixelScale=Buffer.alloc(24),tiepoint=Buffer.alloc(48),keys=Buffer.alloc(40);
  [scale,scale,0].forEach((v,i)=>pixelScale.writeDoubleLE(v,i*8));
  [0,0,0,minX,maxY,0].forEach((v,i)=>tiepoint.writeDoubleLE(v,i*8));
  [1,1,0,4,1024,0,1,1,1025,0,1,1,3072,0,1,3857,3076,0,1,9001].forEach((v,i)=>keys.writeUInt16LE(v,i*2));
  const tags=[
    [256,4,width],[257,4,height],[258,3,32],[259,3,1],[262,3,1],[273,4,null],[277,3,1],
    [278,4,height],[279,4,width*height*4],[284,3,1],[339,3,3],
    [33550,12,pixelScale],[33922,12,tiepoint],[34735,3,keys],[42113,2,Buffer.from('-9999\0')]
  ].sort((a,b)=>a[0]-b[0]);
  const ifdSize=2+tags.length*12+4;let cursor=8+ifdSize;
  const extras=[];
  for(const tag of tags){if(Buffer.isBuffer(tag[2])){
    const alignment=tag[1]===12?8:tag[1]===3?2:1;cursor=Math.ceil(cursor/alignment)*alignment;
    tag[3]=cursor;extras.push({offset:cursor,data:tag[2]});cursor+=tag[2].length;
  }}
  const dataOffset=(cursor+3)&~3;tags.find(tag=>tag[0]===273)[2]=dataOffset;
  const buffer=Buffer.alloc(dataOffset+width*height*4);buffer.write('II',0);buffer.writeUInt16LE(42,2);buffer.writeUInt32LE(8,4);
  buffer.writeUInt16LE(tags.length,8);
  for(let i=0;i<tags.length;i++){
    const [id,type,value,offset]=tags[i],at=10+i*12;
    buffer.writeUInt16LE(id,at);buffer.writeUInt16LE(type,at+2);
    buffer.writeUInt32LE(Buffer.isBuffer(value)?value.length/(type===12?8:type===3?2:1):1,at+4);
    if(Buffer.isBuffer(value))buffer.writeUInt32LE(offset,at+8);
    else if(type===3)buffer.writeUInt16LE(value,at+8);
    else buffer.writeUInt32LE(value,at+8);
  }
  for(const {offset,data} of extras)data.copy(buffer,offset);
  for(let i=0;i<values.length;i++)buffer.writeFloatLE(values[i],dataOffset+i*4);
  return buffer;
}

export function previewFromGeoTiff(buffer,bounds){
  if(buffer.toString('ascii',0,2)!=='II'||buffer.readUInt16LE(2)!==42)throw new Error('Saved terrain is not the expected GeoTIFF.');
  const ifd=buffer.readUInt32LE(4),count=buffer.readUInt16LE(ifd);
  const tag=id=>{for(let i=0;i<count;i++){const at=ifd+2+i*12;if(buffer.readUInt16LE(at)===id)return buffer.readUInt32LE(at+8);}throw new Error('Saved terrain is missing a required TIFF tag.');};
  const width=tag(256),height=tag(257),offset=tag(273),bytes=tag(279);
  if(!width||!height||width*height>1000000||bytes!==width*height*4||offset+bytes>buffer.length)throw new Error('Saved terrain grid is invalid.');
  const previewWidth=Math.min(256,width),previewHeight=Math.min(256,height),values=[];
  for(let y=0;y<previewHeight;y++)for(let x=0;x<previewWidth;x++){
    const index=Math.floor((y+.5)*height/previewHeight)*width+Math.floor((x+.5)*width/previewWidth);
    const value=buffer.readFloatLE(offset+index*4);
    values.push(value===-9999?null:Math.round(value*10)/10);
  }
  return {width:previewWidth,height:previewHeight,values,west:bounds.west,east:bounds.east,north:bounds.north,south:bounds.south};
}

export async function fetchTerrain(aoi,signal,onProgress=()=>{},{readTile,saveTile}={}){
  const plan=terrainPlan(aoi),width=plan.x1-plan.x0,height=plan.y1-plan.y0;
  const values=new Float32Array(width*height).fill(nodata),sources=new Set();let completed=0;
  const xStart=Math.floor(plan.x0/256),xEnd=Math.floor((plan.x1-1)/256);
  const yStart=Math.floor(plan.y0/256),yEnd=Math.floor((plan.y1-1)/256);
  for(let ty=yStart;ty<=yEnd;ty++)for(let tx=xStart;tx<=xEnd;tx++){
    if(signal.aborted)throw new Error('Terrain download cancelled.');
    const key=`${plan.z}-${tx}-${ty}`;
    let saved=await readTile?.(key),tile,source=saved?.source||null;
    if(saved)try{if(saved.bytes.length>1024*1024)throw new Error('Oversize tile');tile=decodeTerrarium(saved.bytes);}catch{saved=null;}
    if(!saved){
      const url=`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${plan.z}/${tx}/${ty}.png`;
      const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
      if(!response.ok)throw new Error(`Terrain tile unavailable (HTTP ${response.status}).`);
      const length=Number(response.headers.get('content-length')||0);
      if(length>1024*1024)throw new Error('Terrain tile exceeds the size limit.');
      const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>1024*1024)throw new Error('Terrain tile exceeds the size limit.');
      tile=decodeTerrarium(bytes);source=response.headers.get('x-amz-meta-x-imagery-sources');
      await saveTile?.(key,bytes,source);
    }
    if(source)sources.add(source);
    const minX=Math.max(plan.x0,tx*256),maxX=Math.min(plan.x1,(tx+1)*256);
    const minY=Math.max(plan.y0,ty*256),maxY=Math.min(plan.y1,(ty+1)*256);
    for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++){
      const lon=longitude(x+.5,plan.z),lat=latitude(y+.5,plan.z);
      if(pointInside([lon,lat],aoi.ring))values[(y-plan.y0)*width+x-plan.x0]=tile[(y-ty*256)*256+x-tx*256];
    }
    onProgress(++completed,plan.tileCount);
  }
  let elevationMinMeters=Infinity,elevationMaxMeters=-Infinity;
  for(const value of values)if(value!==nodata){elevationMinMeters=Math.min(elevationMinMeters,value);elevationMaxMeters=Math.max(elevationMaxMeters,value);}
  if(!Number.isFinite(elevationMinMeters))throw new Error('No terrain pixels overlap this boundary.');
  const previewWidth=Math.min(256,width),previewHeight=Math.min(256,height),preview=[];
  for(let y=0;y<previewHeight;y++)for(let x=0;x<previewWidth;x++){
    const sample=values[Math.floor((y+.5)*height/previewHeight)*width+Math.floor((x+.5)*width/previewWidth)];
    preview.push(sample===nodata?null:Math.round(sample*10)/10);
  }
  const retrievedAt=new Date().toISOString();
  return {tiff:geoTiff(values,width,height,plan),preview:{width:previewWidth,height:previewHeight,values:preview,
    west:longitude(plan.x0,plan.z),east:longitude(plan.x1,plan.z),north:latitude(plan.y0,plan.z),south:latitude(plan.y1,plan.z)},
    metadata:{provider:'Mapzen Terrain Tiles on AWS',url:'https://registry.opendata.aws/terrain-tiles/',format:'Terrarium PNG decoded to float32 GeoTIFF',crs:'EPSG:3857',width,height,pixelSizeMeters:plan.pixelSizeMeters,
      zoom:plan.z,tileCount:plan.tileCount,sourceTiles:[...sources],elevationMinMeters,elevationMaxMeters,retrievedAt,
      attribution:'Terrain Tiles (Mapzen, a Linux Foundation project); source-specific credits: https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
      limitation:'Terrain elevation is a bare-earth DEM from mixed sources; output pixel spacing is not source accuracy or a site survey.'}};
}
