import {studyBoundary} from './urban-analysis.js';

// Clip the DEM grid against the drawn polygon instead of using its pixel mask as
// the cut line. Return geographic coordinates so the browser and DAE share it.
export function clippedTerrainSurface(terrain,polygon){
  const {width,height,west,east,north,south,values}=terrain;
  const valid=values.filter(Number.isFinite);
  if(width<2||height<2||!valid.length)return {vertices:[],outline:[],minimum:0,maximum:0};
  let minimum=Infinity,maximum=-Infinity;for(const value of valid){minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);}
  const boundary=studyBoundary(polygon),ring=polygon.coordinates[0].slice(0,-1);
  const grid=([lon,lat])=>[(lon-west)/(east-west)*width,(north-lat)/(north-south)*height];
  const location=([x,y])=>[west+x/width*(east-west),north-y/height*(north-south)];
  const ringGrid=ring.map(grid),heightCache=new Map();
  const elevation=(x,y)=>{
    const key=Math.round(x*1e7)+','+Math.round(y*1e7);
    if(heightCache.has(key))return heightCache.get(key);
    const sx=Math.max(0,Math.min(width-1,x-.5)),sy=Math.max(0,Math.min(height-1,y-.5));
    const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
    let sum=0,weight=0;
    for(const [px,py,w] of [[ix,iy,(1-fx)*(1-fy)],[Math.min(width-1,ix+1),iy,fx*(1-fy)],[ix,Math.min(height-1,iy+1),(1-fx)*fy],[Math.min(width-1,ix+1),Math.min(height-1,iy+1),fx*fy]]){
      const value=values[py*width+px];if(Number.isFinite(value)){sum+=value*w;weight+=w;}
    }
    if(!weight){
      for(let radius=1;radius<=Math.max(width,height)&&!weight;radius*=2){
        let nearest=Infinity;
        for(let py=Math.max(0,Math.floor(sy-radius));py<=Math.min(height-1,Math.ceil(sy+radius));py++)for(let px=Math.max(0,Math.floor(sx-radius));px<=Math.min(width-1,Math.ceil(sx+radius));px++){
          const value=values[py*width+px],distance=(px-sx)**2+(py-sy)**2;
          if(Number.isFinite(value)&&distance<nearest){nearest=distance;sum=value;weight=1;}
        }
      }
    }
    const result=weight?sum/weight:minimum;heightCache.set(key,result);return result;
  };
  const point=p=>{const [lon,lat]=location(p);return [lon,lat,elevation(p[0],p[1])-minimum];};
  const clip=(triangle,face,orientation)=>{
    let output=triangle;
    for(let side=0;side<3;side++){
      const a=face[side],b=face[(side+1)%3],measure=p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
      const input=output;output=[];
      for(let i=0;i<input.length;i++){
        const p=input[i],q=input[(i+1)%input.length],d=measure(p),e=measure(q),inside=d*orientation>=-1e-8,next=e*orientation>=-1e-8;
        if(inside!==next){const t=d/(d-e);output.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
        if(next)output.push(q);
      }if(output.length<3)break;
    }return output;
  };
  const vertices=[];
  for(const faceIds of boundary.faces){
    const face=faceIds.map(i=>ringGrid[i]),orient=Math.sign((face[1][0]-face[0][0])*(face[2][1]-face[0][1])-(face[1][1]-face[0][1])*(face[2][0]-face[0][0]));
    const x0=Math.max(0,Math.floor(Math.min(...face.map(p=>p[0])))),x1=Math.min(width-1,Math.ceil(Math.max(...face.map(p=>p[0])))-1);
    const y0=Math.max(0,Math.floor(Math.min(...face.map(p=>p[1])))),y1=Math.min(height-1,Math.ceil(Math.max(...face.map(p=>p[1])))-1);
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const triangle of [[[x,y],[x+1,y],[x,y+1]],[[x+1,y],[x+1,y+1],[x,y+1]]]){
      const clipped=clip(triangle,face,orient);
      for(let i=1;i<clipped.length-1;i++){
        const first=clipped[0],a=clipped[i],b=clipped[i+1];
        if(Math.abs((a[0]-first[0])*(b[1]-first[1])-(a[1]-first[1])*(b[0]-first[0]))<1e-9)continue;
        vertices.push(point(first),point(b),point(a));
      }
    }
  }
  const outline=[];
  for(let i=0;i<ringGrid.length;i++){
    const a=ringGrid[i],b=ringGrid[(i+1)%ringGrid.length];
    const steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/1.5));
    for(let j=0;j<steps;j++)outline.push(point([a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps]));
  }
  return {vertices,outline,minimum,maximum};
}
