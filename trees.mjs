export function pointInPolygon([x,y],geometry){
  const inside=ring=>{let result=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)result=!result;
  }return result;};
  const polygons=geometry.type==='MultiPolygon'?geometry.coordinates:geometry.coordinates?[geometry.coordinates]:[];
  return polygons.some(rings=>inside(rings[0])&&!rings.slice(1).some(inside));
}
export function mappedTrees(elements,polygon,remaining=150000){
  const features=[];
  for(const node of elements){
    if(node.type!=='node'||node.tags?.natural!=='tree'||!Number.isFinite(node.lon)||!Number.isFinite(node.lat)||!pointInPolygon([node.lon,node.lat],polygon))continue;
    features.push({type:'Feature',geometry:{type:'Point',coordinates:[node.lon,node.lat]},properties:{id:`osm-tree-${node.id}`,source_id:`node/${node.id}`,source:'OpenStreetMap',layer:'trees',kind:node.tags.species||node.tags.genus||'Mapped tree',species:node.tags.species||null,diameter_crown_m:null}});
    if(features.length>remaining)throw new Error('Selection exceeds the capture feature limit; choose a smaller area.');
  }
  return features;
}
