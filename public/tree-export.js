// Rebuild the download in the browser so imagery detections never reach the API.
const decoder=new TextDecoder(),encoder=new TextEncoder();
const uint16=(view,offset)=>view.getUint16(offset,true),uint32=(view,offset)=>view.getUint32(offset,true);
function readZip(buffer){
  const bytes=new Uint8Array(buffer),view=new DataView(buffer),files=new Map();let offset=0;
  while(offset+4<=bytes.length&&uint32(view,offset)===0x04034b50){
    if(uint16(view,offset+8)!==0||uint16(view,offset+6)&8)throw new Error('Unsupported ZIP encoding.');
    const size=uint32(view,offset+18),nameLength=uint16(view,offset+26),extra=uint16(view,offset+28),start=offset+30+nameLength+extra;
    if(start+size>bytes.length)throw new Error('Truncated ZIP.');
    files.set(decoder.decode(bytes.subarray(offset+30,offset+30+nameLength)),bytes.slice(start,start+size));offset=start+size;
  }
  if(!files.size)throw new Error('Empty ZIP.');return files;
}
function crc32(bytes){let crc=-1;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^-1)>>>0;}
function zip(files){
  const parts=[],directory=[];let position=0,centralLength=0;
  for(const [name,data] of files){
    const label=encoder.encode(name),bytes=typeof data==='string'?encoder.encode(data):data,checksum=crc32(bytes);
    const local=new Uint8Array(30+label.length),a=new DataView(local.buffer);
    a.setUint32(0,0x04034b50,true);a.setUint16(4,20,true);a.setUint32(14,checksum,true);a.setUint32(18,bytes.length,true);a.setUint32(22,bytes.length,true);a.setUint16(26,label.length,true);local.set(label,30);parts.push(local,bytes);
    const record=new Uint8Array(46+label.length),b=new DataView(record.buffer);
    b.setUint32(0,0x02014b50,true);b.setUint16(4,20,true);b.setUint16(6,20,true);b.setUint32(16,checksum,true);b.setUint32(20,bytes.length,true);b.setUint32(24,bytes.length,true);b.setUint16(28,label.length,true);b.setUint32(42,position,true);record.set(label,46);directory.push(record);position+=local.length+bytes.length;centralLength+=record.length;
  }
  const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.size,true);v.setUint16(10,files.size,true);v.setUint32(12,centralLength,true);v.setUint32(16,position,true);
  return new Blob([...parts,...directory,end],{type:'application/zip'});
}
export async function addBrowserTrees(blob,trees,polygon,settings,terrain,geometry){
  const files=readZip(await blob.arrayBuffer()),read=name=>decoder.decode(files.get(name));
  const features=JSON.parse(read('site_layers.geojson')).features;
  if(settings.layers.trees!==false)features.push(...trees);
  const layers=Object.fromEntries(['buildings','roads','water','landuse','trees'].map(name=>[name,features.filter(f=>f.properties.layer===name)]));
  const aoi=geometry.validateAOI(polygon),buildings=geometry.applyScenario(layers,settings.scenario).buildings;
  files.set('site_layers.geojson',encoder.encode(JSON.stringify({type:'FeatureCollection',features})));
  files.set('site_layers.dxf',encoder.encode(geometry.makeDXF(layers,aoi)));
  files.set('site_massing.dae',encoder.encode(geometry.makeDAE(buildings,aoi,terrain,layers.trees)));
  const provenance=JSON.parse(read('provenance.json'));
  provenance.layers.trees=layers.trees.length;
  provenance.source.layers??={};provenance.source.layers.trees='OpenStreetMap contributors and user-supplied imagery proposals';
  provenance.limitations.push('Image-derived trees are unverified colour proposals; grass, roofs and joined crowns may cause errors.');
  files.set('provenance.json',encoder.encode(JSON.stringify(provenance,null,2)));
  const analysis=JSON.parse(read('site_analysis.json'));analysis.otherMappedFeatures.trees=layers.trees.length;
  files.set('site_analysis.json',encoder.encode(JSON.stringify(analysis,null,2)));
  files.set('README.txt',encoder.encode(read('README.txt')+'\nTree dots: image proposals were reviewed in your browser; source imagery was never uploaded. The 3D tree markers are symbolic, not measured crowns.\n'));
  return zip(files);
}
