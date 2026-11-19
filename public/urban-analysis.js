// Estimates from mapped geometry inside the captured study polygon.
// These do not represent a surveyed block, verified public access, or observed trips.
const polygons=g=>g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];
const paths=g=>g?.type==='LineString'?[g.coordinates]:g?.type==='MultiLineString'?g.coordinates:[];
const good=p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]);
const signedArea=ring=>ring.reduce((total,p,i)=>{const next=ring[(i+1)%ring.length];return total+p[0]*next[1]-next[0]*p[1];},0)/2;
export function studyBoundary(polygon){
  const ps=polygon.coordinates[0],lon=ps.map(p=>p[0]),lat=ps.map(p=>p[1]);
  const west=Math.min(...lon),east=Math.max(...lon),south=Math.min(...lat),north=Math.max(...lat);
  const cx=(west+east)/2,cy=(south+north)/2,mx=111320*Math.cos(cy*Math.PI/180),my=110574;
  const project=p=>[(p[0]-cx)*mx,(p[1]-cy)*my],ring=ps.slice(0,-1).map(project);
  const areaM2=Math.abs(signedArea(ring));
  const center=ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length],cross=p[0]*q[1]-q[0]*p[1];sum[0]+=(p[0]+q[0])*cross;sum[1]+=(p[1]+q[1])*cross;return sum;},[0,0]);
  const orientation=Math.sign(signedArea(ring));
  const centroid=areaM2?[cx+center[0]/(6*signedArea(ring)*mx),cy+center[1]/(6*signedArea(ring)*my)]:[cx,cy];
  let origin=centroid;if(!pointInsidePolygon(origin,polygon)){
    const faces=triangulate(ring);const first=faces[0]?.map(i=>ring[i]);
    origin=first?[cx+first.reduce((s,p)=>s+p[0],0)/(3*mx),cy+first.reduce((s,p)=>s+p[1],0)/(3*my)]:ps[0];
  }
  return {west,east,south,north,cx,cy,mx,my,width:(east-west)*mx,height:(north-south)*my,project,ring,areaM2,origin,orientation,faces:triangulate(ring)};
}
export function pointInsidePolygon(point,polygon){
  const ring=polygon?.coordinates?.[0];if(!good(point)||!ring?.length)return false;
  let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;
}
function triangulate(points){
  const direction=Math.sign(signedArea(points)),indices=points.map((_,i)=>i),faces=[];
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if(!direction)return [];
  for(let attempts=0;indices.length>3&&attempts<points.length*points.length;attempts++){
    let found=false;for(let i=0;i<indices.length;i++){
      const a=indices[(i+indices.length-1)%indices.length],b=indices[i],c=indices[(i+1)%indices.length];
      if(cross(points[a],points[b],points[c])*direction<=1e-7)continue;
      if(indices.some(j=>j!==a&&j!==b&&j!==c&&[cross(points[a],points[b],points[j]),cross(points[b],points[c],points[j]),cross(points[c],points[a],points[j])].every(v=>v*direction>=-1e-7)))continue;
      faces.push([a,b,c]);indices.splice(i,1);found=true;break;
    }if(!found)break;
  }if(indices.length===3)faces.push(indices);
  return indices.length===3?faces:[];
}
function clippedRing(ring,bounds){
  const source=ring.filter(good).map(bounds.project);if(source.length<3)return 0;
  let total=0;
  for(const face of bounds.faces){let points=source;
    const triangle=face.map(i=>bounds.ring[i]);
    for(let side=0;side<3;side++){const a=triangle[side],b=triangle[(side+1)%3],output=[];
      const measure=p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
    for(let i=0;i<points.length;i++){
      const p=points[i],q=points[(i+1)%points.length],d=measure(p),e=measure(q),pin=d*bounds.orientation>=-1e-7,qin=e*bounds.orientation>=-1e-7;
      if(pin!==qin){const t=d/(d-e);output.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
      if(qin)output.push(q);
    }points=output;if(points.length<3)break;
    }if(points.length>=3)total+=Math.abs(signedArea(points));
  }return total;
}
export function clippedArea(feature,polygon,bounds=studyBoundary(polygon)){
  let area=0;
  for(const rings of polygons(feature.geometry)){
    if(!rings[0])continue;area+=clippedRing(rings[0],bounds);
    for(const hole of rings.slice(1))area-=clippedRing(hole,bounds);
  }
  return Math.max(0,area);
}
export const isMappedGreen=feature=>/park|garden|recreation|green|forest|grass|open.space|playground/i.test(String(feature?.properties?.kind||''));
export const isMappedCycle=feature=>/cycleway|bicycle|cycling|bike/i.test(String(feature?.properties?.kind||''));

function clipSegment(a,c,b){
  const p=b.project(a),q=b.project(c),dx=q[0]-p[0],dy=q[1]-p[1],cuts=[0,1];
  for(let i=0;i<b.ring.length;i++){
    const u=b.ring[i],v=b.ring[(i+1)%b.ring.length],sx=v[0]-u[0],sy=v[1]-u[1],det=dx*sy-dy*sx;
    if(Math.abs(det)<1e-10)continue;
    const px=u[0]-p[0],py=u[1]-p[1],t=(px*sy-py*sx)/det,s=(px*dy-py*dx)/det;
    if(t>0&&t<1&&s>=0&&s<=1)cuts.push(t);
  }
  cuts.sort((x,y)=>x-y);const intervals=[];
  for(let i=1;i<cuts.length;i++){const lo=cuts[i-1],hi=cuts[i];if(hi-lo<1e-9)continue;
    const mid=(lo+hi)/2,point=[p[0]+dx*mid,p[1]+dy*mid];
    let inside=false;for(let j=0,k=b.ring.length-1;j<b.ring.length;k=j++){
      const u=b.ring[j],v=b.ring[k];if((u[1]>point[1])!==(v[1]>point[1])&&point[0]<(v[0]-u[0])*(point[1]-u[1])/(v[1]-u[1])+u[0])inside=!inside;
    }if(inside)intervals.push([lo,hi]);
  }return intervals;
}
export function segmentInsidePolygon(a,c,polygon,bounds=studyBoundary(polygon)){return clipSegment(a,c,bounds);}
function clippedLength(road,b){
  let total=0;
  for(const line of paths(road.geometry))for(let i=1;i<(line?.length||0);i++){
    if(!good(line[i-1])||!good(line[i]))continue;
    const [a,c]=line.slice(i-1,i+1),length=Math.hypot((a[0]-c[0])*b.mx,(a[1]-c[1])*b.my);
    for(const [lo,hi] of clipSegment(a,c,b))total+=length*(hi-lo);
  }
  return total;
}

export function urbanGeometry(layers,polygon){
  const b=studyBoundary(polygon),buildings=layers.buildings||[],landuse=layers.landuse||[],roads=layers.roads||[];
  const builtM2=buildings.reduce((sum,f)=>sum+clippedArea(f,polygon,b),0);
  const parks=landuse.filter(isMappedGreen),greenM2=parks.reduce((sum,f)=>sum+clippedArea(f,polygon,b),0);
  const recorded=buildings.filter(f=>f.properties?.height_method==='recorded'&&f.properties.height_m>0);
  const floorEstimates=buildings.filter(f=>f.properties?.height_method==='floor_estimate'&&f.properties.height_m>0);
  const cycle=roads.filter(isMappedCycle),cycleM=cycle.reduce((sum,f)=>sum+clippedLength(f,b),0);
  const lengthM=roads.reduce((sum,f)=>sum+clippedLength(f,b),0);
  return {areaM2:b.areaM2,buildingCount:buildings.length,builtM2,coveragePercent:b.areaM2?builtM2/b.areaM2*100:0,
    recordedCount:recorded.length,floorEstimateCount:floorEstimates.length,
    recordedMeanM:recorded.length?recorded.reduce((sum,f)=>sum+f.properties.height_m,0)/recorded.length:null,
    greenCount:parks.length,greenM2,cycleCount:cycle.length,cycleM,roadCount:roads.length,roadM:lengthM,
    limitations:['Footprints and green areas are clipped to the selected polygon but overlapping polygons are not dissolved.',
      'Mapped green spaces are candidates; public access and tree canopy are unverified.',
      'Only explicitly tagged cycle routes count; absence does not mean no cycle access.']};
}

// Reaches junctions via mapped road segments within the captured polygon.
export function localWalkReach(roads,polygon,{speedMps=1.25,maxMinutes=15}={}){
  const b=studyBoundary(polygon),vertices=[],adj=[],nodes=new Map(),edges=[];
  const getNode=point=>{const xy=b.project(point),key=`${Math.round(xy[0]/4)},${Math.round(xy[1]/4)}`;
    if(!nodes.has(key)){nodes.set(key,vertices.length);vertices.push(xy);adj.push([]);}return nodes.get(key);};
  for(let i=0;i<roads.length;i++)for(const line of paths(roads[i].geometry))for(let j=1;j<(line?.length||0);j++){
    const a=line[j-1],c=line[j];if(!good(a)||!good(c))continue;
    for(const [lo,hi] of clipSegment(a,c,b)){
      const at=t=>[a[0]+(c[0]-a[0])*t,a[1]+(c[1]-a[1])*t],u=getNode(at(lo)),v=getNode(at(hi));if(u===v)continue;
      const length=Math.hypot((a[0]-c[0])*b.mx,(a[1]-c[1])*b.my)*(hi-lo);if(length<.5||length>1500)continue;
      adj[u].push([v,length]);adj[v].push([u,length]);edges.push({u,v,feature:i});
    }
  }
  const empty=(reason)=>({status:'unavailable',reason,minutesByRoad:roads.map(()=>null),junctions:vertices.length,segments:edges.length});
  if(!vertices.length||!edges.length)return empty('No connected mapped road segments inside this boundary.');
  const centre=b.project(b.origin);let source=0,nearest=Infinity;vertices.forEach(([x,y],i)=>{const d=Math.hypot(x-centre[0],y-centre[1]);if(d<nearest){nearest=d;source=i;}});
  if(nearest>180)return empty(`The nearest mapped road junction is ${Math.round(nearest)} m from the polygon centre.`);
  if(vertices.length>20000||edges.length>30000)return empty('Mapped road graph exceeds the browser analysis limit.');
  const distances=new Float64Array(vertices.length).fill(Infinity),queue=[[nearest,source]];distances[source]=nearest;
  const push=item=>{queue.push(item);for(let n=queue.length-1;n>0;){const parent=(n-1)>>1;if(queue[parent][0]<=queue[n][0])break;[queue[parent],queue[n]]=[queue[n],queue[parent]];n=parent;}};
  const pop=()=>{const first=queue[0],last=queue.pop();if(queue.length){queue[0]=last;for(let i=0;;){const left=i*2+1,right=left+1;if(left>=queue.length)break;const k=right<queue.length&&queue[right][0]<queue[left][0]?right:left;if(queue[i][0]<=queue[k][0])break;[queue[i],queue[k]]=[queue[k],queue[i]];i=k;}}return first;};
  while(queue.length){const [distance,u]=pop();if(distance>distances[u]+1e-6)continue;if(distance>maxMinutes*60*speedMps)break;
    for(const [v,length] of adj[u]){const nd=distance+length;if(nd<distances[v]&&nd<=maxMinutes*60*speedMps){distances[v]=nd;push([nd,v]);}}
  }
  const minutesByRoad=roads.map(()=>null);
  for(const {u,v,feature} of edges){const minutes=Math.min(distances[u],distances[v])/(60*speedMps);
    if(minutes<=maxMinutes)minutesByRoad[feature]=Math.min(minutesByRoad[feature]??Infinity,minutes);
  }
  const accessible=threshold=>minutesByRoad.filter(v=>v!==null&&v<=threshold).length;
  return {status:'ready',junctions:vertices.length,segments:edges.length,nearestM:Math.round(nearest),minutesByRoad,
    roadsWithin5:accessible(5),roadsWithin10:accessible(10),roadsWithin15:accessible(15),
    method:'Length weighted shortest routes on mapped road centreline vertices from an interior point near the polygon centre, with 4 m endpoint snapping and assumed 1.25 m/s walking speed. Roads outside the captured polygon, crossings, access and slope are not represented. This is reachable mapped network, not a walkability score or true isochrone polygon.'};
}

export function planSightlines(buildings,polygon,{viewpoint=null,rays=72}={}){
  const b=studyBoundary(polygon),origin=viewpoint||b.origin,start=b.project(origin);
  if(!pointInsidePolygon(origin,polygon))return {status:'unavailable',reason:'Choose a viewpoint inside the drawn boundary.',lines:[]};
  const outlines=buildings.flatMap(f=>polygons(f.geometry).map(r=>r[0]?.filter(good).map(b.project)).filter(r=>r?.length>=3));
  const inside=ring=>{let on=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],c=ring[j];if((a[1]>start[1])!==(c[1]>start[1])&&start[0]<(c[0]-a[0])*(start[1]-a[1])/(c[1]-a[1])+a[0])on=!on;
  }return on;};
  if(outlines.some(inside))return {status:'unavailable',reason:'The viewpoint falls inside a mapped building. Choose an open point.',lines:[]};
  const cross=(a,c)=>a[0]*c[1]-a[1]*c[0],lines=[];let unblocked=0,sum=0;
  for(let i=0;i<rays;i++){
    const angle=2*Math.PI*i/rays,direction=[Math.sin(angle),Math.cos(angle)];
    let edge=Infinity;
    for(let k=0;k<b.ring.length;k++){const a=b.ring[k],c=b.ring[(k+1)%b.ring.length],segment=[c[0]-a[0],c[1]-a[1]],denom=direction[0]*segment[1]-direction[1]*segment[0];
      if(Math.abs(denom)<1e-10)continue;const gap=[a[0]-start[0],a[1]-start[1]],hit=(gap[0]*segment[1]-gap[1]*segment[0])/denom,along=(gap[0]*direction[1]-gap[1]*direction[0])/denom;
      if(hit>1e-8&&along>=0&&along<=1)edge=Math.min(edge,hit);
    }
    const outer=Math.min(edge,700);let distance=outer,blocked=false;
    for(const ring of outlines)for(let n=0;n<ring.length;n++){
      const a=ring[n],c=ring[(n+1)%ring.length],segment=[c[0]-a[0],c[1]-a[1]],denom=cross(direction,segment);
      if(Math.abs(denom)<1e-10)continue;
      const gap=[a[0]-start[0],a[1]-start[1]],hit=cross(gap,segment)/denom,along=cross(gap,direction)/denom;
      if(hit>=0&&hit<distance&&along>=0&&along<=1){distance=hit;blocked=true;}
    }
    if(!blocked)unblocked++;sum+=distance;
    const end=[origin[0]+direction[0]*distance/b.mx,origin[1]+direction[1]*distance/b.my];
    lines.push({type:'Feature',geometry:{type:'LineString',coordinates:[origin,end]},properties:{layer:'sightline',blocked,distance_m:Math.round(distance),azimuth_degrees:Math.round(i*360/rays)}});
  }
  return {status:'ready',viewpoint:origin,lines,rays,unblocked,openPercent:Math.round(unblocked/rays*100),meanDistanceM:Math.round(sum/rays),
    method:'Horizontal rays from the chosen viewpoint to the first mapped building footprint or study boundary, sampled every 5° and capped at 700 m. Buildings are treated as opaque in plan. Height, terrain, vegetation, gates, windows and unrecorded buildings are excluded. This is not sky-view factor or a pedestrian eye-level survey.'};
}
