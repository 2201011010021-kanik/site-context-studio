// Measurements derived only from saved source features. No missing heights are invented here.
import {pointInside} from './geo.mjs';

const rad = Math.PI / 180;
function distanceMeters(a, b) {
  const dLat=(b[1]-a[1])*rad,dLon=(b[0]-a[0])*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dLon/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
}
function crossing(a,b,c,d) {
  const vx=b[0]-a[0],vy=b[1]-a[1],wx=d[0]-c[0],wy=d[1]-c[1];
  const det=vx*wy-vy*wx;
  if(Math.abs(det)<1e-15)return null;
  const qx=c[0]-a[0],qy=c[1]-a[1];
  const t=(qx*wy-qy*wx)/det,u=(qx*vy-qy*vx)/det;
  return t>0&&t<1&&u>=0&&u<=1?t:null;
}
export function lineInsideMeters(line,ring) {
  let sum=0;
  for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i];
    if(!a||!b||![...a,...b].every(Number.isFinite))continue;
    const cuts=[0,1];
    for(let j=1;j<ring.length;j++){
      const t=crossing(a,b,ring[j-1],ring[j]);if(t!==null)cuts.push(t);
    }
    cuts.sort((x,y)=>x-y);
    const length=distanceMeters(a,b);
    for(let j=1;j<cuts.length;j++){
      const mid=(cuts[j-1]+cuts[j])/2;
      if(cuts[j]-cuts[j-1]>1e-10&&pointInside([a[0]+(b[0]-a[0])*mid,a[1]+(b[1]-a[1])*mid],ring))sum+=length*(cuts[j]-cuts[j-1]);
    }
  }
  return sum;
}
function roadSummary(roads,ring) {
  if(!ring)return null;
  let metres=0,segmentsWithLength=0;
  const classes=new Map();
  for(const feature of roads){
    const geometry=feature.geometry||{},lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.type==='MultiLineString'?geometry.coordinates:[];
    let current=0;
    for(const line of lines)if(Array.isArray(line))current+=lineInsideMeters(line,ring);
    if(current<=0)continue;
    metres+=current;segmentsWithLength++;
    const kind=String(feature.properties?.kind||'unclassified').slice(0,60);
    classes.set(kind,(classes.get(kind)||0)+current);
  }
  return {mappedSegmentCount:roads.length,segmentsInsideBoundary:segmentsWithLength,
    lengthKm:Math.round(metres/10)/100,
    byKind:[...classes.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([kind,value])=>({kind,lengthKm:Math.round(value/10)/100})),
    limitation:'Mapped road centreline length clipped to the boundary. It does not measure road width, connectivity, walking access or travel time.'};
}
export function siteInsights(layers, {id = null, release = null, retrievedAt = null, polygon = null} = {}) {
  const buildings = layers.buildings || [];
  const evidence = {recorded: 0, floor_estimate: 0, unknown: 0};
  const recordedHeights = [];
  for (const feature of buildings) {
    const {height_m: height, height_method: method} = feature.properties || {};
    if (method === 'recorded' && Number.isFinite(height) && height > 0) {
      evidence.recorded++;
      recordedHeights.push(height);
    } else if (method === 'floor_estimate' && Number.isFinite(height) && height > 0) {
      evidence.floor_estimate++;
    } else evidence.unknown++;
  }
  recordedHeights.sort((a, b) => a - b);
  const middle = Math.floor(recordedHeights.length / 2);
  const median = recordedHeights.length
    ? recordedHeights.length % 2 ? recordedHeights[middle] : (recordedHeights[middle - 1] + recordedHeights[middle]) / 2
    : null;
  return {
    schema: 'site-context-insights/1', captureId: id, release, retrievedAt,
    footprintCount: buildings.length,
    otherMappedFeatures: {
      roads: (layers.roads || []).length,
      water: (layers.water || []).length,
      landuse: (layers.landuse || []).length,
      trees: (layers.trees || []).length
    },
    movement:roadSummary(layers.roads||[],polygon?.coordinates?.[0]),
    heightEvidence: evidence,
    recordedHeightMedianM: median === null ? null : Math.round(median * 10) / 10,
    limitations: [
      'Counts include complete features touching the boundary; they are not clipped area or density estimates.',
      'Recorded means present in source attributes, not field verified. Floor estimates assume 3.2 metres per floor.',
      'Unknown heights remain unknown. Conceptual scenario heights are excluded from this analysis.'
    ]
  };
}
