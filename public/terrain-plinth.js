// Each edge shared by two surface triangles is internal. The remaining edges
// trace the DEM's actual valid footprint, including clipped and missing cells.
export function surfaceBoundaryEdges(triangles){
  const edges=new Map();
  for(let i=0;i<triangles.length;i+=3)for(const [a,b] of [[triangles[i],triangles[i+1]],[triangles[i+1],triangles[i+2]],[triangles[i+2],triangles[i]]]){
    const key=a<b?`${a}:${b}`:`${b}:${a}`;
    if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);
  }
  return [...edges.values()];
}
