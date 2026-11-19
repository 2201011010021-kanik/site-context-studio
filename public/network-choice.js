// Length weighted local edge betweenness on the connected, mapped road graph.
// This is an exploratory 800 m network proxy, not angular segment choice or observed trips.
export async function localRoadChoice(roads,{radius=800,maxOrigins=96}={}){
  const features=roads||[],vertices=[],adj=[],edges=[],nodes=new Map();
  const valid=p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]);
  const latitude=features.flatMap(f=>f.geometry?.type==='LineString'?[f.geometry.coordinates?.[0]]:[]).filter(valid)[0]?.[1]||23;
  const mx=111320*Math.cos(latitude*Math.PI/180),my=110574;
  const node=p=>{const x=p[0]*mx,y=p[1]*my,key=`${Math.round(x/4)},${Math.round(y/4)}`;
    if(!nodes.has(key)){nodes.set(key,vertices.length);vertices.push([x,y]);adj.push([]);}return nodes.get(key);};
  for(let fi=0;fi<features.length;fi++){
    const g=features[fi].geometry||{},paths=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
    for(const path of paths)for(let i=1;i<(path?.length||0);i++){
      const a=path[i-1],b=path[i];if(!valid(a)||!valid(b))continue;
      const u=node(a),v=node(b);if(u===v)continue;
      const length=Math.hypot((a[0]-b[0])*mx,(a[1]-b[1])*my);
      if(length<.5||length>radius*2)continue;
      const index=edges.length;edges.push({u,v,length,feature:fi,score:0});adj[u].push(index);adj[v].push(index);
    }
  }
  if(edges.length>30000||vertices.length>20000)return {status:'too_large',reason:'Road graph exceeds the browser analysis limit.',segments:edges.length};
  if(edges.length<2)return {status:'unavailable',reason:'At least two connected mapped road segments are needed.',segments:edges.length};
  const starts=[];for(let i=0;i<Math.min(maxOrigins,vertices.length);i++)starts.push(Math.floor((i+.5)*vertices.length/Math.min(maxOrigins,vertices.length)));
  let reached=0;
  for(let originIndex=0;originIndex<starts.length;originIndex++){
    const start=starts[originIndex],distance=new Float64Array(vertices.length).fill(Infinity),paths=new Float64Array(vertices.length),dependencies=new Float64Array(vertices.length),prior=new Map(),order=[],heap=[];
    const push=(v,d)=>{heap.push([d,v]);let i=heap.length-1;while(i){const parent=(i-1)>>1;if(heap[parent][0]<=heap[i][0])break;[heap[parent],heap[i]]=[heap[i],heap[parent]];i=parent;}};
    const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){heap[0]=last;for(let i=0;;){const left=i*2+1,right=left+1;if(left>=heap.length)break;const k=right<heap.length&&heap[right][0]<heap[left][0]?right:left;if(heap[i][0]<=heap[k][0])break;[heap[i],heap[k]]=[heap[k],heap[i]];i=k;}}return first;};
    distance[start]=0;paths[start]=1;push(start,0);
    while(heap.length){const [d,u]=pop();if(d>distance[u]+1e-6)continue;if(d>radius)break;order.push(u);
      for(const ei of adj[u]){const edge=edges[ei],v=edge.u===u?edge.v:edge.u,nd=d+edge.length;
        if(nd>radius||nd>distance[v]+1e-6)continue;
        if(nd<distance[v]-1e-6){distance[v]=nd;paths[v]=paths[u];prior.set(v,[[u,ei]]);push(v,nd);}
        else{paths[v]+=paths[u];prior.get(v)?.push([u,ei]);}
      }
    }
    reached+=order.length-1;
    for(let i=order.length-1;i>=0;i--){const v=order[i];for(const [u,ei] of prior.get(v)||[]){const portion=paths[v]?(paths[u]/paths[v])*(1+dependencies[v]):0;dependencies[u]+=portion;edges[ei].score+=portion;}}
    if(originIndex%8===7)await new Promise(resolve=>setTimeout(resolve,0));
  }
  const featureScores=new Float64Array(features.length),max=Math.max(...edges.map(e=>e.score),0);
  for(const e of edges)featureScores[e.feature]=Math.max(featureScores[e.feature],max?e.score/max:0);
  return {status:'ready',radius,segments:edges.length,nodes:vertices.length,origins:starts.length,meanReach:Math.round(reached/starts.length),
    maxRaw:Math.round(max),scores:Array.from(featureScores,s=>Number(s.toFixed(4))),
    method:'Length weighted shortest path edge betweenness within 800 m of sampled mapped junctions; endpoints snapped to a 4 m grid. No crossing, sidewalk, turn-angle or pedestrian-access validation. Scores are relative to this capture and are not measured footfall, traffic or angular segment choice.'};
}
