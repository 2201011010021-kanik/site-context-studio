// Source-backed axonometric drawing. Every visible element is SVG geometry.
const safeText=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const color=value=>/^#[0-9a-f]{6}$/i.test(value)?value:'#888888';
const palettes={
  Studio:{background:'#fbfaf6',terrain:'#e9e7de',buildings:'#ffffff',roads:'#326b94',water:'#91cbd4',linework:'#356b93'},
  Clay:{background:'#edeae2',terrain:'#d6c8ae',buildings:'#f6f3e9',roads:'#6d665b',water:'#80a9b5',linework:'#77776b'},
  Ink:{background:'#f6f6f1',terrain:'#e6e6df',buildings:'#202b29',roads:'#69736e',water:'#8aa7ac',linework:'#3f514c'},
  Cobalt:{background:'#0b367a',terrain:'#e4dfd6',buildings:'#f5f6f2',roads:'#faf9f4',water:'#80c4df',linework:'#466583'},
  // Retained only for the original urban network-choice graphic export; no site theme control.
  Night:{background:'#161b24',terrain:'#333d48',buildings:'#d2dbc9',roads:'#a7b8b4',water:'#5d9fba',linework:'#748d9d'}
};
export const illustrationPresets=palettes;
const rings=geometry=>geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];
const lines=geometry=>geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:[];

export function makeIllustration({polygon,layers,terrain=null,options={}}){
  const graphic=['masterplan','figure','nolli','landuse','streets','choice','reach','cycling','visibility'].includes(options.graphicMode)?options.graphicMode:'context';
  const palette={...(palettes[options.preset]||palettes.Studio),...options.colors};
  for(const key of Object.keys(palette))palette[key]=color(palette[key]);
  const visible={buildings:true,roads:true,water:true,landuse:true,trees:true,contours:true,boundary:true,...options.visible};
  const width=1200,height=850,ring=polygon.coordinates[0],lon=ring.map(p=>p[0]),lat=ring.map(p=>p[1]);
  const west=Math.min(...lon),east=Math.max(...lon),south=Math.min(...lat),north=Math.max(...lat),centerLon=(west+east)/2,centerLat=(south+north)/2;
  const mx=111320*Math.cos(centerLat*Math.PI/180),my=110574;
  const elevation=terrain?.values?.filter(Number.isFinite)||[],base=elevation.length?elevation.reduce((a,b)=>Math.min(a,b),Infinity):0;
  const elevationMax=elevation.length?elevation.reduce((a,b)=>Math.max(a,b),-Infinity):base;
  const sample=point=>{
    if(!terrain||!elevation.length)return 0;
    const x=Math.max(0,Math.min(terrain.width-1,Math.round((point[0]-terrain.west)/(terrain.east-terrain.west)*terrain.width-.5)));
    const y=Math.max(0,Math.min(terrain.height-1,Math.round((terrain.north-point[1])/(terrain.north-terrain.south)*terrain.height-.5)));
    const v=terrain.values[y*terrain.width+x];return Number.isFinite(v)?v-base:0;
  };
  const direction={NW:[1,1],NE:[-1,1],SW:[1,-1],SE:[-1,-1]}[options.view||'NW']||[1,1];
  const top=options.view==='Top',relief=Math.max(1,Math.min(5,Number(options.relief)||2));
  const strokeWeight=Math.max(.5,Math.min(3,Number(options.strokeWeight)||1));
  const raw=(point,z=0)=>{const x=(point[0]-centerLon)*mx*direction[0],y=(point[1]-centerLat)*my*direction[1];return top?[x,-y]:[(x-y)*.866,(x+y)*.5-z*relief];};
  const maxHeight=(layers.buildings||[]).reduce((m,f)=>Math.max(m,Number(f.properties?.height_m)||0),Math.max(0,Number(options.fixedMaxHeight)||0));
  const corners=[[west,south],[west,north],[east,south],[east,north]];
  const extents=corners.flatMap(p=>[raw(p,0),raw(p,elevationMax-base+maxHeight)]);
  const minX=Math.min(...extents.map(p=>p[0])),maxX=Math.max(...extents.map(p=>p[0])),minY=Math.min(...extents.map(p=>p[1])),maxY=Math.max(...extents.map(p=>p[1]));
  const scale=Math.min(1030/Math.max(1,maxX-minX),660/Math.max(1,maxY-minY));
  const at=(p,z=0)=>{const [x,y]=raw(p,z);return [((x-(minX+maxX)/2)*scale+width/2).toFixed(1),((y-(minY+maxY)/2)*scale+height/2).toFixed(1)];};
  const path=(pts,z)=>pts.filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])).map((p,i)=>`${i?'L':'M'}${at(p,typeof z==='function'?z(p):z).join(' ')}`).join(' ');
  const outline=options.outline===false?'none':palette.linework;
  const groups=[];
  if(terrain&&elevation.length){
    const terrainPaths=[],stride=Math.max(1,Math.ceil(Math.max(terrain.width,terrain.height)/128));
    const point=(x,y)=>[terrain.west+(x+.5)/terrain.width*(terrain.east-terrain.west),terrain.north-(y+.5)/terrain.height*(terrain.north-terrain.south)];
    for(let y=0;y+stride<terrain.height;y+=stride)for(let x=0;x+stride<terrain.width;x+=stride){
      const corners=[[x,y],[x+stride,y],[x+stride,y+stride],[x,y+stride]],values=corners.map(([cx,cy])=>terrain.values[cy*terrain.width+cx]);
      if(values.every(Number.isFinite))terrainPaths.push(`<path d="${corners.map(([cx,cy],i)=>`${i?'L':'M'}${at(point(cx,cy),values[i]-base).join(' ')}`).join(' ')}Z"/>`);
    }
    groups.push(`<g id="terrain" fill="${palette.terrain}" stroke="${palette.terrain}" stroke-width=".4">${terrainPaths.join('')}</g>`);
    if(visible.contours){
      const range=elevationMax-base,steps=[1,2,5,10,20,50,100,200],interval=steps.find(v=>v>=range/10)||200,segments=[];
      for(let y=0;y+stride<terrain.height;y+=stride)for(let x=0;x+stride<terrain.width;x+=stride){
        const cs=[[x,y],[x+stride,y],[x+stride,y+stride],[x,y+stride]],vs=cs.map(([cx,cy])=>terrain.values[cy*terrain.width+cx]);if(!vs.every(Number.isFinite))continue;
        for(let level=Math.ceil(Math.min(...vs)/interval)*interval;level<=Math.max(...vs);level+=interval){const hits=[];
          for(const [a,b] of [[0,1],[1,2],[2,3],[3,0]])if((vs[a]<=level&&level<vs[b])||(vs[b]<=level&&level<vs[a])){const t=(level-vs[a])/(vs[b]-vs[a]),cx=cs[a][0]+(cs[b][0]-cs[a][0])*t,cy=cs[a][1]+(cs[b][1]-cs[a][1])*t;hits.push(at(point(cx,cy),level-base));}
          for(let i=1;i<hits.length;i+=2)segments.push(`M${hits[i-1].join(' ')}L${hits[i].join(' ')}`);
        }
      }
      groups.push(`<g id="contours" fill="none" stroke="${palette.roads}" stroke-opacity=".42" stroke-width="${(.65*strokeWeight).toFixed(2)}"><path d="${segments.join(' ')}"/></g>`);
    }
  }
  if(visible.landuse)groups.push(`<g id="landuse" clip-path="url(#site-clip)" fill-opacity="${graphic==='landuse'?.72:.24}" stroke="none">${(layers.landuse||[]).flatMap(f=>rings(f.geometry).map(parts=>{const kind=String(f.properties?.kind||f.properties?.class||'').toLowerCase(),fill=graphic==='landuse'?/residen|housing/.test(kind)?'#e5bb8b':/commercial|retail|business/.test(kind)?'#e9a7a2':/industrial|manufactur/.test(kind)?'#baa3c4':/park|green|forest|recreation|garden/.test(kind)?'#90bc91':/school|education|hospital|civic|institution/.test(kind)?'#a5b9d5':'#c0c5b2':'#93ae87';return `<path d="${parts.map(part=>path(part,p=>sample(p)+.1)+'Z').join(' ')}" fill="${fill}" fill-rule="evenodd"/>`;})).join('')}</g>`);
  if(visible.water)groups.push(`<g id="water" clip-path="url(#site-clip)" fill="${palette.water}" fill-opacity=".6" stroke="${palette.water}" stroke-width="${(1.4*strokeWeight).toFixed(2)}">${(layers.water||[]).flatMap(f=>rings(f.geometry).map(parts=>`<path d="${parts.map(part=>path(part,p=>sample(p)+.2)+'Z').join(' ')}" fill-rule="evenodd"/>`).concat(lines(f.geometry).map(part=>`<path d="${path(part,p=>sample(p)+.2)}" fill="none"/>`))).join('')}</g>`);
  if(visible.roads)groups.push(`<g id="roads" clip-path="url(#site-clip)" fill="none" stroke="${palette.roads}" stroke-width="${(2*strokeWeight).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${(layers.roads||[]).flatMap(f=>lines(f.geometry).map(part=>{const kind=String(f.properties?.kind||'').toLowerCase(),score=Number(options.roadScores?.[f.properties?.id])||0,weight=graphic==='choice'?2+score*5:graphic==='streets'?/motorway|trunk|primary/.test(kind)?4:/secondary|tertiary/.test(kind)?3:/residential|unclassified/.test(kind)?2:1:graphic==='cycling'&&score<=0?1:2.8,shade=graphic==='choice'?score>.65?'#d44f3f':score>.35?'#ed9660':score>.12?'#e7c873':'#697db9':graphic==='reach'?score>.85?'#2db77c':score>.45?'#eabf62':score>.15?'#8f79be':'#8b9b99':graphic==='cycling'?score>0?'#2db77c':'#8b9b99':null;return `<path d="${path(part,p=>sample(p)+.5)}" stroke-width="${(weight*strokeWeight).toFixed(2)}"${shade?` stroke="${shade}"`:''}${graphic==='cycling'&&score<=0?' stroke-opacity=".25"':''}/>`;})).join('')}</g>`);
  if(visible.trees&&(layers.trees||[]).length)groups.push(`<g id="trees" clip-path="url(#site-clip)" fill="#3b8b62" fill-opacity=".9" stroke="#236044" stroke-width=".7">${(layers.trees||[]).filter(f=>f.geometry?.type==='Point'&&f.geometry.coordinates?.slice(0,2).every(Number.isFinite)).map(f=>{const [x,y]=at(f.geometry.coordinates,sample(f.geometry.coordinates)+1);return `<circle cx="${x}" cy="${y}" r="${top?3.2:2.8}"/>`;}).join('')}</g>`);
  if(visible.buildings){
    const buildings=[...(layers.buildings||[])].sort((a,b)=>{const first=f=>rings(f.geometry)[0]?.[0]?.[0]||[centerLon,centerLat];return raw(first(a))[1]-raw(first(b))[1];});
    const paths=[],selectedPaths=[];
    for(const feature of buildings)for(const parts of rings(feature.geometry)){
      const exterior=parts[0];if(!Array.isArray(exterior)||exterior.length<4)continue;
      const roof=exterior.slice(0,-1),z=sample(roof[0]),h=Number(feature.properties?.height_m)||0;
      const kind=String(feature.properties?.kind||'').toLowerCase();
      const fill=graphic==='figure'||graphic==='nolli'?'#182722':options.colorByType?(/residential|house|apart/.test(kind)?'#c99f7e':/school|hospital|public|civic|relig/.test(kind)?'#8ca49a':/commercial|office|retail|shop|hotel/.test(kind)?'#cdb66e':/industrial|factory|warehouse/.test(kind)?'#a992a2':palette.buildings):palette.buildings;
      const addBuildingPath=(d,opacity='')=>{
        paths.push(`<path d="${d}" fill="${fill}"${opacity}/>`);
        options.onBuildingPath?.(feature._illustrationIndex,d);
        if(Number.isInteger(options.selectedBuildingIndex)&&feature._illustrationIndex===options.selectedBuildingIndex)selectedPaths.push(`<path d="${d}"/>`);
      };
      if(h>0&&!top)for(let i=0;i<roof.length;i++){const a=roof[i],b=roof[(i+1)%roof.length];addBuildingPath(`M${at(a,z).join(' ')}L${at(b,z).join(' ')}L${at(b,z+h).join(' ')}L${at(a,z+h).join(' ')}Z`,' fill-opacity=".74"');}
      addBuildingPath(`${path(exterior,z+h)}Z`);
    }
    groups.push(`<g id="buildings" stroke="${outline}" stroke-width="${options.outline===false?0:(.75*strokeWeight).toFixed(2)}" stroke-linejoin="round">${paths.join('')}</g>`);
    if(selectedPaths.length)groups.push(`<g id="editor-selection" fill="none" stroke="#e78f3d" stroke-width="3" stroke-linejoin="round" pointer-events="none">${selectedPaths.join('')}</g>`);
  }
  if(graphic==='visibility'&&Array.isArray(options.sightlines))groups.push(`<g id="plan-sightlines" clip-path="url(#site-clip)" fill="none" stroke-width="2.5">${options.sightlines.flatMap(f=>lines(f.geometry).map(part=>`<path d="${path(part,p=>sample(p)+3)}" stroke="${f.properties?.blocked?'#f39569':'#27a77d'}"${f.properties?.blocked?' stroke-dasharray="3 5"':''}/>`)).join('')}</g>`);
  if(visible.boundary)groups.push(`<g id="site-boundary" fill="none" stroke="${palette.background==='#161b24'?'#f4bc75':'#cf7650'}" stroke-width="${(2.5*strokeWeight).toFixed(2)}" stroke-dasharray="7 5"><path d="${path(ring,p=>sample(p)+2)}"/></g>`);
  const labels=(options.labels||[]).filter(x=>typeof x.text==='string'&&x.text.trim()).map(x=>`<text x="${Math.round(Math.max(0,Math.min(1,x.x))*width)}" y="${Math.round(Math.max(0,Math.min(1,x.y))*height)}" fill="${color(x.color||'#202c28')}" font-size="${Math.max(12,Math.min(64,Number(x.size)||25))}" font-family="Manrope, Arial, sans-serif">${safeText(x.text)}</text>`).join('');
  const attribution=safeText(options.attribution||'Captured site data · check provenance in the site package');
  const note=safeText(graphic==='nolli'?'Nolli inspired: mapped footprint mask only; public interiors and access not surveyed.':graphic==='visibility'?'Plan sightlines from mapped footprints; not sky view or an eye-level survey.':graphic==='reach'?'Walking reach on mapped roads; not a walkability score or true isochrone polygon.':graphic==='cycling'?'Explicit mapped cycle routes only; access and demand unverified.':graphic==='choice'?'Local road-network choice proxy (800 m); not angular choice or observed footfall.':graphic==='streets'?'Mapped street class only; widths do not show footfall or traffic counts.':graphic==='landuse'?'Mapped land use categories may be incomplete.':'Source geometry, not a site survey.');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>Site context vector illustration</title><desc>${attribution}. ${note} Conceptual heights and displayed relief are not survey measurements.</desc><defs><clipPath id="site-clip"><path d="${path(ring,p=>sample(p))}Z"/></clipPath></defs><rect width="${width}" height="${height}" fill="${palette.background}"/>${groups.join('')}<g id="labels">${labels}</g><text x="22" y="810" fill="${palette.background==='#161b24'||palette.background==='#0b367a'?'#ebeee6':'#495c50'}" font-size="10" font-family="Manrope, Arial, sans-serif">${note}</text><text x="22" y="829" fill="${palette.background==='#161b24'||palette.background==='#0b367a'?'#ebeee6':'#495c50'}" font-size="11" font-family="Manrope, Arial, sans-serif">${attribution}</text><text id="studio-watermark" x="1178" y="829" text-anchor="end" fill="${palette.background==='#161b24'||palette.background==='#0b367a'?'#ebeee6':'#495c50'}" font-size="11" font-family="Manrope, Arial, sans-serif">kaniks-studio</text></svg>`;
}
