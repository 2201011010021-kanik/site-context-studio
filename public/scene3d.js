import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {surfaceBoundaryEdges} from './terrain-plinth.js';
import {clippedTerrainSurface} from './terrain-surface.js';
import {studyBoundary,segmentInsidePolygon,pointInsidePolygon} from './urban-analysis.js';

export function showScene(container,{polygon,buildings=[],roads=[],water=[],landuse=[],trees=[],terrain=null,mode='context',roadScores=null,sightlines=[],reliefScale=3,visibility={},editorFrame=false,onProgress=()=>{},onTerrainInfo=()=>{},onSelect=()=>{},onGroundSelect=()=>{}}){
  const points=polygon.coordinates[0],xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const west=Math.min(...xs),east=Math.max(...xs),south=Math.min(...ys),north=Math.max(...ys);
  const midLon=(west+east)/2,midLat=(south+north)/2;
  const scaleX=111320*Math.cos(midLat*Math.PI/180),scaleY=110574;
  const coord=([lon,lat])=>[(lon-midLon)*scaleX,-(lat-midLat)*scaleY];
  const site=studyBoundary(polygon);
  const siteTriangles=site.faces.map(ids=>ids.map(index=>coord(points[index])));
  const clipToSite=(triangle,face)=>{
    let result=triangle;
    const sign=Math.sign((face[1][0]-face[0][0])*(face[2][1]-face[0][1])-(face[1][1]-face[0][1])*(face[2][0]-face[0][0]));
    for(let edge=0;edge<3;edge++){
      const a=face[edge],b=face[(edge+1)%3],measure=p=>((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))*sign;
      const input=result;result=[];
      for(let i=0;i<input.length;i++){
        const p=input[i],q=input[(i+1)%input.length],d=measure(p),e=measure(q),inside=d>=-1e-7,next=e>=-1e-7;
        if(inside!==next){const t=d/(d-e);result.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
        if(next)result.push(q);
      }if(result.length<3)break;
    }return result;
  };
  const scene=new THREE.Scene();scene.background=new THREE.Color('#ffffff');
  const groups=Object.fromEntries(['buildings','roads','water','landuse','trees','contours'].map(name=>[name,new THREE.Group()]));
  for(const [name,group] of Object.entries(groups)){group.visible=visibility[name]!==false;scene.add(group);}
  scene.add(new THREE.HemisphereLight(0xffffff,0x849481,2));
  const sun=new THREE.DirectionalLight(0xffffff,2.3);sun.position.set(-250,600,400);scene.add(sun);
  let baseElevation=Infinity,maxElevation=-Infinity;
  if(terrain)for(const value of terrain.values)if(Number.isFinite(value)){baseElevation=Math.min(baseElevation,value);maxElevation=Math.max(maxElevation,value);}
  if(!Number.isFinite(baseElevation)){baseElevation=0;maxElevation=0;}
  const displayScale=terrain?Math.max(1,Math.min(8,reliefScale)):1;
  const sample=([lon,lat])=>{
    if(!terrain)return 0;
    const x=Math.max(0,Math.min(terrain.width-1,(lon-terrain.west)/(terrain.east-terrain.west)*terrain.width-.5));
    const y=Math.max(0,Math.min(terrain.height-1,(terrain.north-lat)/(terrain.north-terrain.south)*terrain.height-.5));
    const x0=Math.floor(x),x1=Math.min(terrain.width-1,x0+1),y0=Math.floor(y),y1=Math.min(terrain.height-1,y0+1);
    const entries=[[x0,y0,(1-(x-x0))*(1-(y-y0))],[x1,y0,(x-x0)*(1-(y-y0))],[x0,y1,(1-(x-x0))*(y-y0)],[x1,y1,(x-x0)*(y-y0)]];
    let sum=0,weight=0;
    for(const [ix,iy,w] of entries){const v=terrain.values[iy*terrain.width+ix];if(Number.isFinite(v)){sum+=v*w;weight+=w;}}
    return weight?(sum/weight-baseElevation)*displayScale:0;
  };
  const materials={recorded:new THREE.MeshStandardMaterial({color:'#49765e',roughness:1}),floor_estimate:new THREE.MeshStandardMaterial({color:'#7d9c95',roughness:1}),scenario:new THREE.MeshStandardMaterial({color:'#d89360',roughness:1}),unknown:new THREE.MeshStandardMaterial({color:'#a6b0ac',side:THREE.DoubleSide,roughness:1}),road:new THREE.LineBasicMaterial({color:mode==='roads'?'#bd6846':'#526961'}),boundary:new THREE.LineBasicMaterial({color:'#e99c54'}),water:new THREE.LineBasicMaterial({color:'#6a9ea9'}),landuse:new THREE.LineBasicMaterial({color:'#86a677',transparent:true,opacity:.75}),contour:new THREE.LineBasicMaterial({color:'#8b674e',transparent:true,opacity:.85}),terrain:new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1}),ground:new THREE.MeshStandardMaterial({color:'#d3dcd0',side:THREE.DoubleSide})};
  const modelSpan=Math.max((east-west)*scaleX,(north-south)*scaleY,40);
  const makePlinth=(positions,indices,outline=null)=>{
    if(!indices.length)return;
    const base=-Math.max(32,Math.min(105,modelSpan*.055),(maxElevation-baseElevation)*displayScale*.22);
    const boundary=outline?outline.map((point,i)=>[point,outline[(i+1)%outline.length]]):surfaceBoundaryEdges(indices).map(([a,b])=>[positions.slice(a*3,a*3+3),positions.slice(b*3,b*3+3)]),faces=[],colors=[],seams=[];
    const shades=['#b7a48b','#a18b72','#988168','#a58b70','#92775e','#80664f','#745941'];
    const bottom=new THREE.BufferGeometry(),underside=[];
    for(let i=0;i<indices.length;i+=3)for(const at of [indices[i+2],indices[i+1],indices[i]])underside.push(positions[at*3],base,positions[at*3+2]);
    bottom.setAttribute('position',new THREE.Float32BufferAttribute(underside,3));bottom.computeVertexNormals();
    scene.add(new THREE.Mesh(bottom,new THREE.MeshStandardMaterial({color:'#745941',side:THREE.DoubleSide,roughness:1})));
    const addFace=(a,b,c,d,color)=>{
      faces.push(...a,...b,...c,...a,...c,...d);
      const shade=new THREE.Color(color);for(let i=0;i<6;i++)colors.push(shade.r,shade.g,shade.b);
    };
    for(const [a,b] of boundary){
      for(let layer=0;layer<shades.length;layer++){
        const upper=layer?base+(shades.length-layer)*(0-base)/shades.length:null;
        const lower=base+(shades.length-layer-1)*(0-base)/shades.length;
        const u1=[a[0],upper??a[1],a[2]],u2=[b[0],upper??b[1],b[2]];
        const l1=[a[0],lower,a[2]],l2=[b[0],lower,b[2]];
        addFace(u1,l1,l2,u2,shades[layer]);
        if(layer<shades.length-1)seams.push(...l1,...l2);
      }
    }
    if(!faces.length)return;
    const wall=new THREE.BufferGeometry();wall.setAttribute('position',new THREE.Float32BufferAttribute(faces,3));wall.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));wall.computeVertexNormals();
    scene.add(new THREE.Mesh(wall,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1})));
    const lines=new THREE.BufferGeometry();lines.setAttribute('position',new THREE.Float32BufferAttribute(seams,3));
    scene.add(new THREE.LineSegments(lines,new THREE.LineBasicMaterial({color:'#e3d0ab',transparent:true,opacity:.36})));
  };
  let terrainSurface=null;
  if(terrain){
    const surface=clippedTerrainSurface(terrain,polygon);
    const positions=[],colors=[],indices=[];
    const low=new THREE.Color('#d4dfc3'),high=new THREE.Color('#8d9d8b');
    for(const [lon,lat,height] of surface.vertices){
      const [x,z]=coord([lon,lat]);positions.push(x,height*displayScale,z);
      const shade=low.clone().lerp(high,height/Math.max(1,maxElevation-baseElevation));
      colors.push(shade.r,shade.g,shade.b);
    }
    for(let i=0;i<positions.length/3;i++)indices.push(i);
    const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geom.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geom.computeVertexNormals();
    const range=maxElevation-baseElevation;
    terrainSurface=new THREE.Mesh(geom,materials.terrain);scene.add(terrainSurface);
    const outline=surface.outline.map(([lon,lat,height])=>{const [x,z]=coord([lon,lat]);return [x,height*displayScale,z];});
    makePlinth(positions,indices,outline);
    const steps=[1,2,5,10,20,50,100,200,500,1000];
    const interval=range>.5?(steps.find(step=>step>=range/10)||1000):0;
    onTerrainInfo(interval);
    if(interval){
      const contourPoints=[];
      const at=(x,y)=>terrain.values[y*terrain.width+x];
      const point=(x,y,level)=>{const lon=terrain.west+(x+.5)/terrain.width*(terrain.east-terrain.west),lat=terrain.north-(y+.5)/terrain.height*(terrain.north-terrain.south);const [px,pz]=coord([lon,lat]);return [px,(level-baseElevation)*displayScale+.65,pz];};
      for(let y=0;y<terrain.height-1;y++)for(let x=0;x<terrain.width-1;x++){
        const values=[at(x,y),at(x+1,y),at(x+1,y+1),at(x,y+1)];if(values.some(v=>!Number.isFinite(v)))continue;
        const lo=Math.max(Math.ceil(Math.min(...values)/interval)*interval,Math.ceil(baseElevation/interval)*interval);
        const hi=Math.min(Math.max(...values),maxElevation);
        for(let level=lo;level<=hi;level+=interval){
          const edges=[];
          for(const [a,b] of [[0,1],[1,2],[2,3],[3,0]]){
            const va=values[a],vb=values[b];if(!(va<=level&&level<vb||vb<=level&&level<va))continue;
            const corners=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]],t=(level-va)/(vb-va);
            edges.push(point(corners[a][0]+(corners[b][0]-corners[a][0])*t,corners[a][1]+(corners[b][1]-corners[a][1])*t,level));
          }
          for(let i=1;i<edges.length;i+=2)contourPoints.push(...edges[i-1],...edges[i]);
        }
      }
      if(contourPoints.length){const line=new THREE.BufferGeometry();line.setAttribute('position',new THREE.Float32BufferAttribute(contourPoints,3));groups.contours.add(new THREE.LineSegments(line,materials.contour));}
    }
  }else{
    onTerrainInfo(0);
    const plane=new THREE.ShapeGeometry((()=>{const shape=new THREE.Shape();points.slice(0,-1).forEach((p,i)=>{const [x,z]=coord(p);if(i)shape.lineTo(x,-z);else shape.moveTo(x,-z);});shape.closePath();return shape;})());
    plane.rotateX(-Math.PI/2);const ground=new THREE.Mesh(plane,materials.ground);ground.position.y=-.3;scene.add(ground);
    const p=plane.getAttribute('position'),positions=[];for(let i=0;i<p.count;i++)positions.push(p.getX(i),-.3,p.getZ(i));
    const indices=plane.getIndex()?Array.from(plane.getIndex().array):Array.from({length:p.count},(_,i)=>i);
    makePlinth(positions,indices);
  }
  const ringsOf=geometry=>geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];
  const shapeOf=rings=>{
    const shape=new THREE.Shape();
    rings.forEach((ring,index)=>{const path=index?new THREE.Path():shape;
      ring.slice(0,-1).forEach((point,i)=>{const [x,z]=coord(point);if(i)path.lineTo(x,-z);else path.moveTo(x,-z);});
      if(index)shape.holes.push(path);
    });return shape;
  };
  const drawAreas=(features,group,fill)=>{
    for(const feature of features)for(const rings of ringsOf(feature.geometry)){
      if(!rings?.[0]||rings[0].length<4)continue;
      try{
        const source=new THREE.ShapeGeometry(shapeOf(rings));source.rotateX(-Math.PI/2);
        const coords=source.getAttribute('position'),index=source.getIndex(),vertices=[];
        for(let i=0;i<(index?index.count:coords.count);i+=3){
          const triangle=[0,1,2].map(j=>{const n=index?index.getX(i+j):i+j;return [coords.getX(n),coords.getZ(n)];});
          for(const face of siteTriangles){const region=clipToSite(triangle,face);
            for(let j=1;j<region.length-1;j++)for(const [x,z] of [region[0],region[j],region[j+1]])vertices.push(x,sample([midLon+x/scaleX,midLat-z/scaleY])+.32,z);
          }
        }
        source.dispose();if(!vertices.length)continue;
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();
        const kind=String(feature.properties?.kind||'').toLowerCase();
        const color=fill==='water'?'#72b5c6':/residen|housing/.test(kind)?'#d8ad7f':/commercial|retail|business/.test(kind)?'#d99391':/industrial|manufactur/.test(kind)?'#a18bad':/park|green|forest|recreation|garden/.test(kind)?'#8aba87':/school|education|hospital|civic|institution/.test(kind)?'#88aac8':'#b4bca6';
        const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,transparent:true,opacity:fill==='water'?.6:mode==='landuse'?.76:.34,side:THREE.DoubleSide,depthWrite:false}));
        mesh.userData.source=feature.properties?.source||null;group.add(mesh);
      }catch{ /* The original feature remains available in the GIS export. */ }
    }
  };
  const landuseShown=mode==='publicspaces'?landuse.filter(f=>/park|garden|recreation|green|forest|grass|open.space|playground/i.test(String(f.properties?.kind||''))):landuse;
  drawAreas(landuseShown,groups.landuse,'landuse');
  drawAreas(water,groups.water,'water');
  const drawLines=(features,material,group,kind,offset)=>{
    let lines=[];
    const flush=()=>{if(!lines.length)return;const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));group.add(new THREE.LineSegments(geometry,material));lines=[];};
    for(const feature of features){
      const geometry=feature.geometry;
      const paths=kind==='road'?(geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:[]):ringsOf(geometry).flat();
      for(const path of paths)if(Array.isArray(path))for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i];if(!a||!b||![a[0],a[1],b[0],b[1]].every(Number.isFinite))continue;
        for(const [lo,hi] of segmentInsidePolygon(a,b,polygon,site)){
          const at=t=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],start=at(lo),end=at(hi);
          const [ax,az]=coord(start),[bx,bz]=coord(end);lines.push(ax,sample(start)+offset,az,bx,sample(end)+offset,bz);
          if(lines.length>=120000)flush();
        }
      }
    }
    flush();
  };
  drawLines(landuseShown,materials.landuse,groups.landuse,'polygon',1.1);
  drawLines(water,materials.water,groups.water,'polygon',1.3);
  if(mode==='choice'&&roadScores?.length===roads.length){
    const colors=['#626faf','#e7c873','#ed9660','#d44f3f'],buckets=[[],[],[],[]];
    roads.forEach((feature,i)=>{const score=roadScores[i]||0;buckets[score>.65?3:score>.35?2:score>.12?1:0].push(feature);});
    buckets.forEach((features,i)=>{if(features.length)drawLines(features,new THREE.LineBasicMaterial({color:colors[i],linewidth:1}),groups.roads,'road',1.5+i*.08);});
  }else if((mode==='reach'||mode==='cycling')&&roadScores?.length===roads.length){
    const colors=mode==='reach'?['#687581','#8f79be','#eabf62','#2db77c']:['#819088','#819088','#819088','#35c88b'],buckets=[[],[],[],[]];
    roads.forEach((feature,i)=>{const value=roadScores[i]||0;buckets[value>.85?3:value>.45?2:value>.15?1:0].push(feature);});
    buckets.forEach((features,i)=>{if(features.length)drawLines(features,new THREE.LineBasicMaterial({color:colors[i],transparent:true,opacity:i?1:.4}),groups.roads,'road',1.5+i*.08);});
  }else drawLines(roads,materials.road,groups.roads,'road',1.5);
  if(sightlines.length){const segments=[[],[]];for(const f of sightlines){const coords=f.geometry?.coordinates;if(!Array.isArray(coords)||coords.length<2)continue;
      const a=coords[0],b=coords[coords.length-1];if(!a?.every(Number.isFinite)||!b?.every(Number.isFinite))continue;
      const [ax,az]=coord(a),[bx,bz]=coord(b);segments[f.properties?.blocked?1:0].push(ax,sample(a)+3,az,bx,sample(b)+3,bz);
    }
    for(let i=0;i<segments.length;i++)if(segments[i].length){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(segments[i],3));
      const lines=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:i?'#f39569':'#36d3a0',transparent:true,opacity:.95,depthTest:false}));lines.renderOrder=8;scene.add(lines);
    }
  }
  if(trees.length){const radius=mode==='trees'?3.2:2,mesh=new THREE.InstancedMesh(new THREE.SphereGeometry(radius,5,4),new THREE.MeshStandardMaterial({color:mode==='trees'?'#43c473':'#418668'}),trees.length);const transform=new THREE.Object3D();let count=0;for(const tree of trees){const point=tree.geometry?.coordinates;if(tree.geometry?.type!=='Point'||!point?.every(Number.isFinite)||!pointInsidePolygon(point,polygon))continue;const [x,z]=coord(point);transform.position.set(x,sample(point)+radius,z);transform.updateMatrix();mesh.setMatrixAt(count++,transform.matrix);}mesh.count=count;groups.trees.add(mesh);}
  let active=true,frameId=0,buildFrameId=0,processed=0,drawn=0,skipped=0,selection=null;
  function buildBatch(){
    if(!active)return;
    const grouped=new Map(),end=Math.min(buildings.length,processed+160);
    for(let n=processed;n<end;n++){
      const feature=buildings[n],known=Number.isFinite(feature.height)&&feature.height>0;
      const method=known&&materials[feature.method]?feature.method:known?'floor_estimate':'unknown';
      let added=false;
      for(const rings of ringsOf(feature.geometry)){
        if(!rings?.[0]||rings[0].length<4)continue;
        let geometry;
        try{
          geometry=known?new THREE.ExtrudeGeometry(shapeOf(rings),{depth:feature.height,bevelEnabled:false,curveSegments:1}):new THREE.ShapeGeometry(shapeOf(rings));
          geometry.rotateX(-Math.PI/2);
          const position=geometry.getAttribute('position'),indices=geometry.getIndex();
          if(!position||position.count<3)continue;
          const batch=grouped.get(method)||{vertices:[],ranges:[]};grouped.set(method,batch);
          const vertices=batch.vertices;
          const offset=sample(rings[0][0])+(known?.55:.8);
          for(let i=0;i<(indices?indices.count:position.count);i++){
            const at=indices?indices.getX(i):i;
            vertices.push(position.getX(at),position.getY(at)+offset,position.getZ(at));
          }
          batch.ranges.push({end:vertices.length/3,feature});
          added=true;
        }catch{ /* Malformed source geometry stays in the export and is counted as excluded here. */ }
        finally{geometry?.dispose();}
      }
      if(added)drawn++;else skipped++;
    }
    for(const [method,{vertices,ranges}] of grouped){
      if(!vertices.length)continue;
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();
      const mesh=new THREE.Mesh(geometry,materials[method]);mesh.userData.ranges=ranges;groups.buildings.add(mesh);
    }
    processed=end;onProgress({drawn,processed,skipped});
    if(processed<buildings.length)buildFrameId=requestAnimationFrame(buildBatch);
  }
  if(buildings.length)buildFrameId=requestAnimationFrame(buildBatch);else onProgress({drawn:0,processed:0,skipped:0});
  const minX=(west-midLon)*scaleX,maxX=(east-midLon)*scaleX,minZ=-(north-midLat)*scaleY,maxZ=-(south-midLat)*scaleY;
  const boundary=[];for(let i=1;i<points.length;i++)for(const p of [points[i-1],points[i]]){
    const [x,z]=coord(p);boundary.push(x,sample(p)+1.1,z);
  }
  const boundaryGeometry=new THREE.BufferGeometry();boundaryGeometry.setAttribute('position',new THREE.Float32BufferAttribute(boundary,3));
  scene.add(new THREE.LineSegments(boundaryGeometry,materials.boundary));
  const bounds=Math.max(maxX-minX,maxZ-minZ,40),focusX=(minX+maxX)/2,focusZ=(minZ+maxZ)/2;
  const editingFrame=new THREE.Group(),layerGuides=new THREE.Group();
  if(editorFrame){
    const tallest=buildings.reduce((max,item)=>Math.max(max,Number.isFinite(item.height)?item.height:0),0);
    const cageHeight=Math.max(65,Math.min(bounds*.42,320),(maxElevation-baseElevation)*displayScale+tallest+Math.min(bounds*.4,180)+20);
    const box=new THREE.BoxGeometry(bounds*1.08,cageHeight,bounds*1.08);
    const edges=new THREE.LineSegments(new THREE.EdgesGeometry(box),new THREE.LineBasicMaterial({color:'#94a9a3',transparent:true,opacity:.42,depthTest:false}));
    box.dispose();editingFrame.position.set(focusX,cageHeight/2-2,focusZ);editingFrame.add(edges);scene.add(editingFrame);scene.add(layerGuides);
  }
  const perspective=new THREE.PerspectiveCamera(45,1,.1,Math.max(bounds*20,5000));
  const orthographic=new THREE.OrthographicCamera(-bounds,bounds,bounds,-bounds,.1,Math.max(bounds*20,5000));
  let camera=perspective,viewMode='orbit';
  camera.position.set(focusX+bounds*.8,Math.max(bounds*.7,55),focusZ+bounds*.8);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  container.replaceChildren(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let pointerStart=null;
  const pointerDown=e=>{pointerStart=[e.clientX,e.clientY];};
  const pointerUp=e=>{
    if(!pointerStart||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>5 )return;
    const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    const hit=groups.buildings.visible?raycaster.intersectObjects(groups.buildings.children,false)[0]:null;if(!hit){const groundHit=terrainSurface&&raycaster.intersectObject(terrainSurface,false)[0];if(groundHit){const {x,y,z}=groundHit.point;onGroundSelect({longitude:midLon+x/scaleX,latitude:midLat-z/scaleY,elevation:baseElevation+y/displayScale});}return;}
    const feature=hit.object.userData.ranges.find(range=>hit.faceIndex*3<range.end)?.feature;if(!feature)return;
    selection?.parent?.remove(selection);selection?.geometry.dispose();
    const lines=[],height=Number.isFinite(feature.height)&&feature.height>0?feature.height:0;
    for(const rings of ringsOf(feature.geometry))for(const ring of rings){
      for(let i=1;i<ring.length;i++){
        const a=ring[i-1],b=ring[i],[ax,az]=coord(a),[bx,bz]=coord(b);
        const y=sample(rings[0][0])+height+1.2;
        lines.push(ax,y,az,bx,y,bz);
      }
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));
    selection=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#e78f3d',depthTest:false}));selection.renderOrder=10;selection.position.y=groups.buildings.position.y;scene.add(selection);
    onSelect(feature);
  };
  renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pointerUp);
  controls.target.set(focusX,Math.max(0,(maxElevation-baseElevation)*displayScale*.4),focusZ);
  controls.maxPolarAngle=Math.PI*.49;controls.update();
  const resize=()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h,false);perspective.aspect=w/h;perspective.updateProjectionMatrix();const half=bounds*(w<700?1.1:1.35);orthographic.left=-half*w/h;orthographic.right=half*w/h;orthographic.top=half;orthographic.bottom=-half;orthographic.updateProjectionMatrix();};
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  function frame(){if(!active)return;controls.update();renderer.render(scene,camera);frameId=requestAnimationFrame(frame);}frame();
  const dispose=()=>{active=false;cancelAnimationFrame(frameId);cancelAnimationFrame(buildFrameId);observer.disconnect();renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pointerUp);controls.dispose();scene.traverse(object=>{object.geometry?.dispose();if(object.material&&!Object.values(materials).includes(object.material))object.material.dispose();});Object.values(materials).forEach(m=>m.dispose());renderer.dispose();container.replaceChildren();};
  dispose.getView=()=>({position:camera.position.toArray(),target:controls.target.toArray(),mode:viewMode,zoom:orthographic.zoom});
  dispose.setView=view=>{if(!view||!Array.isArray(view.position)||!Array.isArray(view.target))return;dispose.preset(view.mode||'orbit');camera.position.fromArray(view.position);controls.target.fromArray(view.target);if(camera===orthographic){orthographic.zoom=view.zoom||1;orthographic.updateProjectionMatrix();}controls.update();};
  dispose.setLayerVisible=(name,visible)=>{if(groups[name]){groups[name].visible=visible;if(editorFrame)applyOffsets();}};
  const layerOffsets={buildings:0,trees:0,roads:0,water:0,landuse:0};
  let explode=0;
  const guidesFor=(features,group)=>{
    if(!editorFrame||group.position.y<1||!features.length)return;
    const vertices=[],count=Math.min(10,features.length);
    for(let i=0;i<count;i++){
      const feature=features[Math.floor((i+.5)*features.length/count)],geometry=feature.geometry;
      const point=geometry?.type==='Point'?geometry.coordinates:geometry?.type==='LineString'?geometry.coordinates?.[0]:geometry?.type==='MultiLineString'?geometry.coordinates?.[0]?.[0]:geometry?.type==='Polygon'?geometry.coordinates?.[0]?.[0]:geometry?.type==='MultiPolygon'?geometry.coordinates?.[0]?.[0]?.[0]:null;
      if(!point||![point[0],point[1]].every(Number.isFinite))continue;
      const [x,z]=coord(point),y=sample(point)+.7;
      vertices.push(x,y,z,x,y+group.position.y,z);
    }
    if(!vertices.length)return;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    const lines=new THREE.LineSegments(geometry,new THREE.LineDashedMaterial({color:'#668981',dashSize:2,gapSize:2,transparent:true,opacity:.64,depthTest:false}));
    lines.computeLineDistances();layerGuides.add(lines);
  };
  const applyOffsets=()=>{
    const offset=explode*Math.min(bounds*.18,90),individual=Math.min(bounds*.2,100);
    groups.landuse.position.y=offset*.2+layerOffsets.landuse*individual;
    groups.water.position.y=offset*.38+layerOffsets.water*individual;
    groups.roads.position.y=offset*.55+layerOffsets.roads*individual;
    groups.trees.position.y=offset*.8+layerOffsets.trees*individual;
    groups.buildings.position.y=offset+layerOffsets.buildings*individual;
    groups.contours.position.y=offset*.12;
    if(selection)selection.position.y=groups.buildings.position.y;
    if(editorFrame){
      for(const item of [...layerGuides.children]){layerGuides.remove(item);item.geometry.dispose();item.material.dispose();}
      for(const [name,features] of Object.entries({buildings,trees,roads,water,landuse}))if(groups[name].visible)guidesFor(features,groups[name]);
    }
  };
  dispose.setExplode=value=>{
    explode=Math.max(0,Math.min(1,Number(value)||0));
    applyOffsets();
  };
  dispose.setLayerOffset=(name,value)=>{
    if(!(name in layerOffsets))return;
    layerOffsets[name]=Math.max(0,Math.min(1,Number(value)||0));
    applyOffsets();
  };
  dispose.setStyle=name=>{
    const light=name==='clay';
    scene.background.set(light?'#f5f0e8':'#ffffff');
    if(editorFrame)editingFrame.children[0].material.color.set('#768f84');
    materials.recorded.color.set(light?'#a58e77':'#49765e');
    materials.floor_estimate.color.set(light?'#b9a994':'#7d9c95');
    materials.unknown.color.set(light?'#d3cbbd':'#a6b0ac');
    materials.road.color.set(mode==='roads'?'#db704c':light?'#9b7458':'#526961');
    materials.water.color.set(light?'#738fa3':'#6a9ea9');
    materials.landuse.color.set(light?'#8da37c':'#86a677');
    for(const mesh of groups.trees.children)mesh.material.color.set(mode==='trees'?'#43c473':light?'#638976':'#418668');
  };
  dispose.capturePng=async ({caption='Site context',source='© OpenStreetMap contributors · Overture Maps Foundation'}={})=>{
    const width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight);
    const oldRatio=renderer.getPixelRatio();
    const ratio=Math.min(3,Math.max(1,2400/width),renderer.capabilities.maxTextureSize/Math.max(width,height));
    const frameVisible=editingFrame.visible,selectionVisible=selection?.visible;
    try{
      if(editorFrame)editingFrame.visible=false;
      if(selection)selection.visible=false;
      renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);renderer.render(scene,camera);
      const output=document.createElement('canvas');output.width=renderer.domElement.width;
      output.height=renderer.domElement.height+Math.round(90*ratio);
      const context=output.getContext('2d');if(!context)throw new Error('Image canvas unavailable');
      context.fillStyle='#ffffff';context.fillRect(0,0,output.width,output.height);
      context.drawImage(renderer.domElement,0,0);
      context.fillStyle='#111215';context.font=`600 ${Math.round(21*ratio)}px sans-serif`;
      context.fillText(caption,Math.round(24*ratio),renderer.domElement.height+Math.round(35*ratio));
      context.fillStyle='#75777c';context.font=`${Math.round(11*ratio)}px sans-serif`;
      context.fillText(source,Math.round(24*ratio),renderer.domElement.height+Math.round(60*ratio),output.width-Math.round(250*ratio));
      context.textAlign='right';context.fillText('kaniks-studio',output.width-Math.round(24*ratio),renderer.domElement.height+Math.round(60*ratio));
      return await new Promise((resolve,reject)=>output.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG encoding failed')),'image/png'));
    }finally{editingFrame.visible=frameVisible;if(selection)selection.visible=selectionVisible;renderer.setPixelRatio(oldRatio);resize();}
  };
  dispose.preset=name=>{
    viewMode=name==='iso'||name==='plan'?name:'orbit';
    camera=viewMode==='orbit'?perspective:orthographic;controls.object=camera;
    controls.target.set(focusX,Math.max(0,(maxElevation-baseElevation)*displayScale*.4),focusZ);
    orthographic.zoom=1;orthographic.updateProjectionMatrix();
    if(viewMode==='plan')camera.position.set(focusX,Math.max(bounds*2,100),focusZ+.01);
    else camera.position.set(focusX+bounds*.8,Math.max(bounds*.85,55),focusZ+bounds*.8);
    camera.up.set(0,1,0);controls.update();
  };
  return dispose;
}
