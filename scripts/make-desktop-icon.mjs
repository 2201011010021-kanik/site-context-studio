import {mkdir,writeFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';

const points=[[7,10],[19,5],[30,12],[27,26],[13,31],[5,22],[7,10]];
const inner=[[[7,10],[14,21]],[[14,21],[27,26]],[[19,5],[14,21]],[[14,21],[13,31]]];
const lines=[...points.slice(1).map((point,i)=>[points[i],point]),...inner];
const distance=(x,y,[[ax,ay],[bx,by]])=>{
  const t=Math.max(0,Math.min(1,((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)));
  return Math.hypot(x-ax-t*(bx-ax),y-ay-t*(by-ay));
};
const inside=(x,y)=>{
  if(x<2||x>34||y<2||y>34)return false;
  const cx=Math.max(8,Math.min(28,x)),cy=Math.max(8,Math.min(28,y));
  return Math.hypot(x-cx,y-cy)<=6;
};
const makePng=size=>{
const raw=Buffer.alloc(size*(1+size*4));
for(let y=0;y<size;y++){
  const row=y*(1+size*4);
  for(let x=0;x<size;x++){
    let covered=0,white=0;
    for(let sy=0;sy<4;sy++)for(let sx=0;sx<4;sx++){
      const px=(x+(sx+.5)/4)*36/size,py=(y+(sy+.5)/4)*36/size;
      if(!inside(px,py))continue;
      covered++;
      if(lines.some(line=>distance(px,py,line)<.85))white++;
    }
    const offset=row+1+x*4,mix=covered?white/covered:0;
    raw[offset]=Math.round(39+(255-39)*mix);
    raw[offset+1]=Math.round(88+(255-88)*mix);
    raw[offset+2]=Math.round(246+(255-246)*mix);
    raw[offset+3]=Math.round(covered*255/16);
  }
}
const crc=bytes=>{
  let value=0xffffffff;
  for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^(value&1?0xedb88320:0);}
  return (value^0xffffffff)>>>0;
};
const chunk=(type,data)=>{
  const name=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);
  length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([name,data])));
  return Buffer.concat([length,name,data,checksum]);
};
const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
};
const png=makePng(256);
const icoHeader=Buffer.alloc(22);icoHeader.writeUInt16LE(1,2);icoHeader.writeUInt16LE(1,4);icoHeader.writeUInt16LE(1,10);icoHeader.writeUInt16LE(32,12);icoHeader.writeUInt32LE(png.length,14);icoHeader.writeUInt32LE(22,18);
await mkdir('build',{recursive:true});
await writeFile('build/icon.ico',Buffer.concat([icoHeader,png]));
await writeFile('build/icon.png',makePng(512));
