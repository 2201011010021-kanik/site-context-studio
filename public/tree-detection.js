// A conservative colour proposal pass, not a trained tree classifier.
export function proposeTrees({data,width,height},bounds,{minPixels=5,maxPixels=1800}={}){
  const mask=new Uint8Array(width*height),seen=new Uint8Array(width*height),result=[];
  for(let i=0;i<mask.length;i++){
    const r=data[i*4],g=data[i*4+1],b=data[i*4+2];
    mask[i]=data[i*4+3]>200&&g>45&&g>r*1.16&&g>b*1.12&&g-r>17?1:0;
  }
  for(let start=0;start<mask.length;start++){
    if(!mask[start]||seen[start])continue;
    const queue=[start];seen[start]=1;let size=0,sumX=0,sumY=0,xmin=width,xmax=0,ymin=height,ymax=0;
    for(let head=0;head<queue.length;head++){
      const index=queue[head],x=index%width,y=Math.floor(index/width);size++;sumX+=x;sumY+=y;
      xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);
      for(const neighbor of [x>0?index-1:-1,x<width-1?index+1:-1,y>0?index-width:-1,y<height-1?index+width:-1]){
        if(neighbor>=0&&mask[neighbor]&&!seen[neighbor]){seen[neighbor]=1;queue.push(neighbor);}
      }
    }
    const bw=xmax-xmin+1,bh=ymax-ymin+1;
    if(size<minPixels||size>maxPixels||Math.max(bw,bh)/Math.max(1,Math.min(bw,bh))>2.5||size/(bw*bh)<.25)continue;
    const x=sumX/size,y=sumY/size;
    result.push([bounds.west+(x+.5)/width*(bounds.east-bounds.west),bounds.north-(y+.5)/height*(bounds.north-bounds.south)]);
    if(result.length>=500)break;
  }
  return result;
}
