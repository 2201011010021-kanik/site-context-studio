import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {validateAOI,applyScenario,featureCollection,makeDXF,makeDAE,makeZip} from './geo.mjs';
import {createOverpassClient,PUBLIC_PROVIDERS} from './overpass-client.mjs';
import {fetchOverture} from './overture-client.mjs';
import {createMemoryCaptureStore} from './capture-store.mjs';
import {fetchTerrain,terrainPlan,previewFromGeoTiff} from './terrain.mjs';
import {siteInsights} from './site-insights.mjs';
import {mappedTrees} from './trees.mjs';
import {createPlaceSearch} from './place-search.mjs';
import {createAccountStore} from './accounts.mjs';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const port=Number(process.env.PORT||8787);
const host=process.env.HOST||'127.0.0.1';
const ephemeralDemo=process.env.DEMO_EPHEMERAL==='1';
const captureFeatureLimit=150000;
const demoAreaLimitKm2=5;
const demoPassword=process.env.DEMO_PASSWORD_FILE?(await readFile(process.env.DEMO_PASSWORD_FILE,'utf8')).trim():process.env.DEMO_PASSWORD;
if(process.env.DEMO_PASSWORD_FILE&&!demoPassword)throw new Error('The demo password file is empty.');
if(process.env.REQUIRE_DEMO_PASSWORD==='1'&&!demoPassword)throw new Error('Set DEMO_PASSWORD before opening the hosted demo.');
const jobs=new Map();
const captureStore=createMemoryCaptureStore();
const providers=process.env.OVERPASS_URL?[process.env.OVERPASS_URL]:PUBLIC_PROVIDERS;
const dataClient=createOverpassClient({providers});
const placeSearch=createPlaceSearch();
const accountStore=createAccountStore(process.env.ACCOUNTS_DB||path.join(path.dirname(fileURLToPath(import.meta.url)),'.local','accounts.sqlite'));
const authAttempts=new Map();
const demoAttempts=new Map();
const captureAttempts=new Map();
const searchAttempts=new Map();
const exportAttempts=new Map();
const contentSecurityPolicy=[
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net 'sha256-zbCxOKDRE0WhTKrWegZ+BGoIaHlb4iSVK4P7HsC7VpE=' 'sha256-7v//oCxXAqFstrYiMQqrjtK9IVdiwRhit5ZQLpcgC3I='",
  "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
  "img-src 'self' data: blob: https://cdn.jsdelivr.net https://tile.openstreetmap.org https://tiles.maps.eox.at https://api.maptiler.com https://media.maptiler.com",
  "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'",
  "form-action 'self'", "frame-ancestors 'none'"
].join('; ');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf'};
function json(res,status,obj,headers={}){const body=JSON.stringify(obj);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(body);}
function sessionToken(req){return req.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith('ks_session='))?.slice(11)||null;}
function visitorToken(req){return req.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith('ks_visitor='))?.slice(11)||null;}
function visitorCookie(req,token){return `ks_visitor=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200${req.socket.encrypted||process.env.SECURE_COOKIES==='1'?'; Secure':''}`;}
function visitorKey(token){return typeof token==='string'&&/^[A-Za-z0-9_-]{32}$/.test(token)?createHash('sha256').update(token).digest('hex'):null;}
function ownedJob(req,id){const job=jobs.get(id);return job&&job.ownerKey===visitorKey(visitorToken(req))?job:null;}
function cookieHeader(req,token){return `ks_session=${token||''}; Path=/; HttpOnly; SameSite=Lax; ${token?`Max-Age=${accountStore.sessionSeconds}`:'Max-Age=0'}${req.socket.encrypted||process.env.SECURE_COOKIES==='1'?'; Secure':''}`;}
function sameOrigin(req){
  const site=req.headers['sec-fetch-site'];
  if(site&&site!=='same-origin')return false;
  const source=req.headers.origin||req.headers.referer;
  if(source){
    try{return [`http://${req.headers.host}`,`https://${req.headers.host}`].includes(new URL(source).origin);}catch{return false;}
  }
  return site==='same-origin';
}
function clientIp(req){
  const direct=req.socket.remoteAddress||'local';
  const forwarded=req.headers['cf-connecting-ip'];
  const trustedCloudflare=process.env.TRUST_RENDER_PROXY==='1'||process.env.TRUST_CLOUDFLARE_PROXY==='1'&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(direct);
  if(trustedCloudflare&&typeof forwarded==='string'&&isIP(forwarded))return forwarded;
  const caddyIp=req.headers['x-forwarded-for']?.split(',').at(-1)?.trim();
  return process.env.TRUST_CADDY_PROXY==='1'&&isIP(caddyIp||'')?caddyIp:direct;
}
function checkRate(req,store,limit,windowMs){const key=clientIp(req),now=Date.now(),entry=store.get(key)||{start:now,count:0};if(now-entry.start>windowMs){entry.start=now;entry.count=0;}entry.count++;store.set(key,entry);if(entry.count>limit)throw Object.assign(new Error('Too many requests. Try again later.'),{status:429});if(store.size>10000)for(const [ip,value] of store)if(now-value.start>windowMs)store.delete(ip);}
export function desktopRequestAllowed(req,port){return req.headers.host===`127.0.0.1:${port}`&&req.socket.remoteAddress==='127.0.0.1';}
function checkDemoArea(aoi){
  if(!ephemeralDemo&&!demoPassword)return;
  if(aoi.areaKm2>demoAreaLimitKm2)throw Object.assign(new Error(`Choose a site of ${demoAreaLimitKm2} km² or smaller for this demo.`),{status:422});
  const [west,south,east,north]=aoi.bounds;
  if((east-west)*aoi.scaleX>5000||(north-south)*aoi.scaleY>5000)throw Object.assign(new Error('Keep each side of the boundary within 5 km for this demo.'),{status:422});
}
function demoAuthorized(req){if(!demoPassword)return true;const encoded=req.headers.authorization?.match(/^Basic ([A-Za-z0-9+/=]+)$/)?.[1];if(!encoded)return false;const decoded=Buffer.from(encoded,'base64').toString('utf8'),colon=decoded.indexOf(':');if(colon<0)return false;const actual=createHash('sha256').update(decoded.slice(colon+1)).digest();const expected=createHash('sha256').update(demoPassword).digest();return timingSafeEqual(actual,expected);}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>50000)throw new Error('Request is too large.');}try{return JSON.parse(raw);}catch{throw new Error('Invalid JSON.');}}
export const fetchOSM=(bounds,signal)=>dataClient.request(bounds,signal);
async function runJob(job){
  job.status='running';
  try{
    await captureStore.save(job);
    for(const layer of job.selectedLayers){
      if(job.completedLayers.includes(layer))continue;
      if(job.controller.signal.aborted)throw new Error('Extraction paused.');
      const remaining=captureFeatureLimit-Object.values(job.layers).reduce((sum,list)=>sum+list.length,0);
      if(remaining<=0)throw new Error(`Selection exceeds ${captureFeatureLimit.toLocaleString()} mapped features; choose a smaller area.`);
      job.currentLayer=layer;
      let result;
      if(layer==='trees'){
        try{result={layers:{trees:mappedTrees((await dataClient.request(job.aoi.bounds,job.controller.signal,'trees')).data.elements,job.polygon,remaining)},release:job.release};}
        catch(error){if(job.controller.signal.aborted)throw error;job.treeLookupError=error.message;result={layers:{trees:[]},release:job.release};}
      }else result=await fetchOverture(job.aoi,job.polygon,[layer],job.controller.signal,()=>{},
        {release:job.release||undefined,remaining});
      if(job.controller.signal.aborted)throw new Error('Extraction paused.');
      if(job.release&&job.release!==result.release)throw new Error('Data release changed during capture.');
      job.release=result.release;
      job.layers[layer]=result.layers[layer];
      job.completedLayers.push(layer);job.completed=job.completedLayers.length;
      job.retrievedAt=new Date().toISOString();if(layer!=='trees'||!job.treeLookupError)job.providers.add(layer==='trees'?'OpenStreetMap contributors':'Overture Maps Foundation');
      try{await captureStore.save(job,layer);}catch(error){
        job.completedLayers.pop();job.completed=job.completedLayers.length;job.layers[layer]=[];
        throw error;
      }
    }
    if(!Object.values(job.layers).some(list=>list.length)&&!job.selectedLayers.includes('trees'))throw new Error('There are no mapped features in this boundary.');
    job.sources=Object.fromEntries(job.selectedLayers.map(layer=>[layer,layer==='trees'?(job.treeLookupError?'Tree lookup unavailable; no mapped trees fetched':'OpenStreetMap contributors (ODbL 1.0)'):'Overture Maps Foundation (ODbL 1.0)']));
    job.status='complete';
  }catch(err){
    if(job.status!=='deleted'){
      job.status=job.controller.signal.aborted?'paused':'error';
      job.error=job.status==='paused'?null:(err.message||'The data service failed.');job.errorCode=err.code||'DATA_UNAVAILABLE';
    }
  }finally{
    job.currentLayer=null;job.finishedAt=new Date().toISOString();
    if(job.status!=='deleted')try{await captureStore.save(job);}catch(error){
      job.status='error';job.error=`Could not save capture progress: ${error.message}`;
      console.error(job.error);
    }
  }
}
function jobPayload(job){
  const result={id:job.id,status:job.status,completed:job.completed,total:job.total,areaKm2:job.aoi.areaKm2,
    polygon:job.polygon,selectedLayers:job.selectedLayers,completedLayers:job.completedLayers,
    currentLayer:job.currentLayer||null,createdAt:job.createdAt,release:job.release||null};
  if(job.status==='error')Object.assign(result,{error:job.error,code:job.errorCode,retryAfterSeconds:job.retryAfterSeconds});
  if(job.status==='complete')Object.assign(result,{retrievedAt:job.retrievedAt,cacheStatus:job.cacheStatus||'live',cacheAgeSeconds:0,sources:job.sources||Object.fromEntries(job.selectedLayers.map(layer=>[layer,layer==='trees'?'OpenStreetMap contributors (ODbL 1.0)':'Overture Maps Foundation (ODbL 1.0)'])),layers:job.layers,counts:Object.fromEntries(Object.entries(job.layers).map(([k,v])=>[k,v.length]))});
  if(job.terrain)result.terrain={...job.terrain,preview:undefined};
  if(job.treeLookupError)result.treeLookupError=job.treeLookupError;
  return result;
}
async function runTerrain(job){
  try{
    const result=await fetchTerrain(job.aoi,job.terrainController.signal,(completed,total)=>{job.terrain.completed=completed;job.terrain.total=total;},{
      readTile:key=>captureStore.readTerrainTile(job.id,key),
      saveTile:(key,bytes,source)=>captureStore.saveTerrainTile(job.id,key,bytes,source)
    });
    if(job.status==='deleted'||job.terrainController.signal.aborted)return;
    await captureStore.saveTerrain(job.id,result.tiff);
    job.terrain={status:'complete',completed:result.metadata.tileCount,total:result.metadata.tileCount,
      metadata:result.metadata,preview:result.preview};
  }catch(error){if(job.status!=='deleted')job.terrain={status:'error',error:error.message||'Terrain service failed.'};}
  finally{if(job.status!=='deleted')try{await captureStore.save(job);}catch(error){console.error('Could not save terrain state',error);}}
}
export function pack(job,settings){
  const layers=applyScenario(job.layers,settings.scenario);
  const selected=['buildings','roads','water','landuse','trees'].filter(k=>settings.layers?.[k]!==false&&(k!=='trees'||Array.isArray(layers.trees)));
  const included=Object.fromEntries(selected.map(k=>[k,layers[k]||[]]));
  const heights=layers.buildings.reduce((a,f)=>(a[f.properties.height_method]=(a[f.properties.height_method]||0)+1,a),{});
  const local=job.cacheStatus==='offline',mixed=Boolean(job.sources?.buildings?.includes('Open Buildings-style'));
  const overture=Boolean(job.release);
  const manifest={tool:'Site Context Studio',version:'0.1.36',created_at:new Date().toISOString(),capture:{id:job.id||null,created_at:job.createdAt||null,completed_layers:job.completedLayers||selected,release_pinned:job.release||null},aoi:job.polygon,area_km2:job.aoi.areaKm2,source:{name:overture?'Overture Maps Foundation':mixed?'User-supplied local GIS files':'OpenStreetMap',url:overture?'https://docs.overturemaps.org/attribution/':'https://www.openstreetmap.org/copyright',license:local?'Original source license not verified from supplied files; verify before redistribution':'ODbL 1.0',layers:job.sources||null,release:job.release||null,open_buildings_reference:mixed?'https://sites.research.google/gr/open-buildings/':null,retrieved_at:job.retrievedAt,query_tiles:job.total||1,providers:job.providers?[...job.providers]:[],cache_status:job.cacheStatus||'live',maximum_cache_age_seconds:job.cacheAgeSeconds||0,extract_file_modified_at:job.extractFileModifiedAt||null,data_as_of:local?'unknown':job.retrievedAt},terrain:job.terrain?.status==='complete'?job.terrain.metadata:null,layers:Object.fromEntries(selected.map(k=>[k,included[k].length])),height_methods:heights,scenario:settings.scenario,coordinate_system:{geojson:'EPSG:4326',dxf_dae:'local planar metres, equirectangular approximation',origin_lon_lat:job.aoi.origin},limitations:['Building footprints crossing the boundary are retained in full, not clipped to the polygon.','Mapped data may omit buildings, roads, water, and height attributes.','Floor heights assume 3.2 metres per floor; scenario heights are invented for conceptual massing.','The local source files may be older than their file modification dates.','Terrain is a mixed-source bare-earth DEM, not a site survey. Output pixel size does not imply source accuracy.','The DAE terrain mesh uses the resampled preview grid; the separate GeoTIFF retains the downloaded grid.','The DAE extrudes simple footprint rings and does not model roof shapes, courtyards, bridges, or road surfaces.','This model is not a survey or regulatory analysis.']};
  const readme=`SITE CONTEXT STUDIO — EARLY DESIGN PACKAGE\n\nArea: ${job.aoi.areaKm2} km². ${overture?`Source: Overture Maps Foundation release ${job.release}, ODbL 1.0; includes OpenStreetMap and other contributors.`:mixed?'Buildings: local BUILDINGS.geojson (Open Buildings-style); roads: local ROAD_NETWORK.geojson; water: local WATER_BODIES.geojson. Original source and license of supplied files need verification before redistribution.':'Source: OpenStreetMap contributors (ODbL 1.0).'} Retrieved ${job.retrievedAt}; source release and retrieval time are recorded in provenance.json.\n\nsite_layers.geojson: WGS84 data for QGIS. site_layers.dxf: local metres relative to ${job.aoi.origin.join(', ')}. site_massing.dae: building extrusions and, if terrain was fetched, a terrain mesh in local metres; import into a 3D modeller and verify scale. The mesh is resampled from the DEM preview, while site_terrain.tif retains the downloaded grid. The DAE is not a native .skp file and does not model roof shapes, bridges or road surfaces. site_analysis.json: mapped feature counts, building height evidence excluding scenario heights, and road centreline length clipped to the site polygon. The road readout is not a walkability or traffic model. provenance.json: source and assumptions.\n\nHeight methods: recorded = source height; floor_estimate = source floors × 3.2m; scenario = user range and deterministic seed; unknown = no height. Scenario geometry is not a measured site condition.\n\nLimitations: building polygons intersecting the AOI retain their full footprint; missing data is not filled with fabricated footprints. Verify scale, sources, geometry and heights against field or authoritative records before presentation.\n\n© OpenStreetMap contributors, Overture Maps Foundation: https://docs.overturemaps.org/attribution/\n`;
  const terrainNote=job.terrain?.status==='complete'?`\nTerrain: site_terrain.tif is a float32 GeoTIFF in EPSG:3857 with -9999 outside the boundary. ${job.terrain.metadata.attribution} Source tiles: ${job.terrain.metadata.sourceTiles.join(', ')||'not reported'}. Data accessed ${job.terrain.metadata.retrievedAt}. Source pixel spacing is not ground accuracy; verify the source-specific rights before commercial redistribution.\n`:'';
  const files={'site_layers.geojson':JSON.stringify(featureCollection(included,selected)),
    'site_layers.dxf':makeDXF(included,job.aoi),'site_massing.dae':makeDAE(included.buildings||[],job.aoi,settings.terrainBuffer?job.terrain?.preview:null,included.trees||[]),
    'provenance.json':JSON.stringify(manifest,null,2),
    'site_analysis.json':JSON.stringify(siteInsights(included,{id:job.id,release:job.release,retrievedAt:job.retrievedAt,polygon:job.polygon}),null,2),
    'README.txt':readme+terrainNote};
  if(settings.terrainBuffer)files['site_terrain.tif']=settings.terrainBuffer;
  return makeZip(files);
}
export const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',contentSecurityPolicy);
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
    if(process.env.DESKTOP_LOCAL==='1'&&!desktopRequestAllowed(req,server.address()?.port))return json(res,403,{error:'Local access only.'});
    if(process.env.SECURE_COOKIES==='1')res.setHeader('Strict-Transport-Security','max-age=31536000');
    if(url.pathname==='/api/health'&&['GET','HEAD'].includes(req.method))return json(res,200,{ok:true,version:'0.1.36'},{'Cache-Control':'no-store'});
    if(!demoAuthorized(req)){
      checkRate(req,demoAttempts,20,15*60*1000);
      return json(res,401,{error:'Enter the demo access password.'},{'WWW-Authenticate':'Basic realm="Kaniks Studio demo"'});
    }
    if(url.pathname.startsWith('/api/')&&!['GET','HEAD'].includes(req.method)&&!sameOrigin(req))return json(res,403,{error:'Cross-site request blocked.'});
    if(ephemeralDemo&&url.pathname.startsWith('/api/auth/'))return json(res,503,{error:'Accounts are unavailable on this temporary free demo. Open the site tool without signing in.'});
    if(url.pathname.startsWith('/api/auth/')){
      if(req.method!=='GET'&&!sameOrigin(req))return json(res,403,{error:'Cross-site request blocked.'});
      if(url.pathname==='/api/auth/me'&&req.method==='GET')return json(res,200,{user:accountStore.getUser(sessionToken(req))});
      if(url.pathname==='/api/auth/profile'&&req.method==='PATCH'){
        const input=await body(req);return json(res,200,{user:accountStore.updateProfile(sessionToken(req),input)});
      }
      if(url.pathname==='/api/auth/register'&&req.method==='POST'){
        checkRate(req,authAttempts,10,15*60*1000);const input=await body(req),result=await accountStore.register(input.email,input.password);
        return json(res,201,{user:result.user},{'Set-Cookie':cookieHeader(req,result.token)});
      }
      if(url.pathname==='/api/auth/login'&&req.method==='POST'){
        checkRate(req,authAttempts,10,15*60*1000);const input=await body(req),result=await accountStore.login(input.email,input.password);
        return json(res,200,{user:result.user},{'Set-Cookie':cookieHeader(req,result.token)});
      }
      if(url.pathname==='/api/auth/logout'&&req.method==='POST'){
        accountStore.logout(sessionToken(req));return json(res,200,{ok:true},{'Set-Cookie':cookieHeader(req,null)});
      }
      if(url.pathname==='/api/auth/account'&&req.method==='DELETE'){
        const input=await body(req);await accountStore.deleteAccount(sessionToken(req),input.password);
        return json(res,200,{ok:true},{'Set-Cookie':cookieHeader(req,null)});
      }
      return json(res,404,{error:'Account endpoint not found.'});
    }
    if(url.pathname==='/api/provider-health')return json(res,200,{providers:dataClient.snapshot()});
    if(url.pathname==='/api/config')return json(res,200,{maptilerKey:process.env.MAPTILER_KEY||null,source:'online Overture Maps',accountsAvailable:!ephemeralDemo});
    if(url.pathname==='/api/places'&&req.method==='GET'){
      checkRate(req,searchAttempts,60,60*60*1000);
      try{return json(res,200,{results:await placeSearch.search(url.searchParams.get('q')),attribution:'© OpenStreetMap contributors'});}
      catch(error){return json(res,error.status||503,{error:error.status?error.message:'Place search is temporarily unavailable. Try again shortly.'});}
    }
    if(url.pathname==='/api/plan'&&req.method==='POST'){
      const input=await body(req),aoi=validateAOI(input.polygon);
      checkDemoArea(aoi);
      const layers=['buildings','roads','water','landuse','trees'].filter(name=>input.layers?.[name]!==false);
      if(!layers.length)return json(res,400,{error:'Select at least one data layer.'});
      return json(res,200,{areaKm2:aoi.areaKm2,steps:layers.length,layers,featureLimit:captureFeatureLimit,
        note:`One live cloud read per layer. Feature count and duration are unknown until extraction; up to ${captureFeatureLimit.toLocaleString()} features per capture.`});
    }
    if(url.pathname==='/api/extract'&&req.method==='POST'){
      checkRate(req,captureAttempts,5,60*60*1000);
      const input=await body(req),aoi=validateAOI(input.polygon);
      checkDemoArea(aoi);
      if([...jobs.values()].filter(j=>['running','queued','pausing'].includes(j.status)).length>=(ephemeralDemo?1:3))return json(res,429,{error:'Another site study is downloading. Try again shortly.'});
      const sourceMode='online-overture';
      const selectedLayers=['buildings','roads','water','landuse','trees'].filter(name=>input.layers?.[name]!==false);
      if(!selectedLayers.length)return json(res,400,{error:'Select at least one data layer.'});
      const token=visitorKey(visitorToken(req))?visitorToken(req):randomBytes(24).toString('base64url');
      const id=randomUUID(),job={id,ownerKey:visitorKey(token),polygon:input.polygon,aoi,layers:{buildings:[],roads:[],water:[],landuse:[],trees:[]},status:'queued',completed:0,total:selectedLayers.length,selectedLayers,completedLayers:[],sourceMode,createdAt:new Date().toISOString(),controller:new AbortController(),providers:new Set()};
      await captureStore.save(job);jobs.set(id,job);
      job.expiry=setTimeout(()=>{job.controller.abort();job.terrainController?.abort();jobs.delete(id);void captureStore.remove(id);},2*60*60*1000);
      job.expiry.unref();job.worker=runJob(job);
      return json(res,202,jobPayload(job),{'Set-Cookie':visitorCookie(req,token)});
    }
    const jobMatch=url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})$/);
    if(jobMatch&&req.method==='GET'){
      const job=ownedJob(req,jobMatch[1]);return job?json(res,200,jobPayload(job)):json(res,404,{error:'This study expired. Draw or fetch it again.'});
    }
    if(jobMatch&&req.method==='DELETE'){
      const job=ownedJob(req,jobMatch[1]);if(!job)return json(res,404,{error:'Study not found.'});
      job.status='deleted';job.controller.abort();job.terrainController?.abort();
      if(job.worker)await job.worker;
      if(job.terrainWorker)await job.terrainWorker;
      clearTimeout(job.expiry);jobs.delete(job.id);await captureStore.remove(job.id);
      return json(res,200,{id:job.id,status:'deleted'});
    }
    const insightsMatch=url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/insights$/);
    if(insightsMatch&&req.method==='GET'){
      const job=ownedJob(req,insightsMatch[1]);
      if(!job)return json(res,404,{error:'Study not found.'});
      if(job.status!=='complete')return json(res,409,{error:'Site analysis is available after capture completes.'});
      return json(res,200,siteInsights(job.layers,{id:job.id,release:job.release,retrievedAt:job.retrievedAt,polygon:job.polygon}));
    }
    const terrainMatch=url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/terrain$/);
    if(terrainMatch){
      const job=ownedJob(req,terrainMatch[1]);if(!job)return json(res,404,{error:'Study not found.'});
      if(req.method==='GET'){
        if(job.terrain?.status==='complete'&&job.terrain.preview?.width<Math.min(256,job.terrain.metadata.width)){
          job.terrain.preview=previewFromGeoTiff(await captureStore.readTerrain(job.id),job.terrain.preview);
          await captureStore.save(job);
        }
        return json(res,200,job.terrain||{status:'idle'});
      }
      if(req.method==='POST'){
        if(job.status!=='complete')return json(res,409,{error:'Fetch map data before adding terrain.'});
        if(job.terrain?.status==='complete'||job.terrain?.status==='running')return json(res,200,job.terrain);
        if([...jobs.values()].some(j=>j.terrain?.status==='running'))return json(res,429,{error:'Another terrain capture is in progress.'});
        const plan=terrainPlan(job.aoi);
        job.terrainController=new AbortController();job.terrain={status:'running',completed:0,total:plan.tileCount};
        await captureStore.save(job);job.terrainWorker=runTerrain(job);
        return json(res,202,job.terrain);
      }
    }
    const action=url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/(pause|resume)$/);
    if(action&&req.method==='POST'){
      const job=ownedJob(req,action[1]);if(!job)return json(res,404,{error:'Study not found.'});
      if(action[2]==='pause'){
        if(job.status==='running'||job.status==='queued'){job.status='pausing';job.controller.abort();}
        return json(res,200,jobPayload(job));
      }
      if(!['paused','error'].includes(job.status))return json(res,409,{error:'This study cannot resume in its current state.'});
      if([...jobs.values()].filter(j=>j!==job&&['running','queued','pausing'].includes(j.status)).length>=(ephemeralDemo?1:3))return json(res,429,{error:'Another site study is downloading. Try again shortly.'});
      if(job.worker)await job.worker;
      job.error=null;job.controller=new AbortController();job.status='queued';
      await captureStore.save(job);job.worker=runJob(job);
      return json(res,202,jobPayload(job));
    }
    if(url.pathname==='/api/export'&&req.method==='POST'){
      checkRate(req,exportAttempts,20,60*60*1000);
      const input=await body(req),job=ownedJob(req,input.id);if(!job)return json(res,404,{error:'This study expired. Fetch the area again.'});
      if(job.status!=='complete')return json(res,409,{error:'The site data is not ready for export.'});
      const terrainBuffer=job.terrain?.status==='complete'?await captureStore.readTerrain(job.id):null;
      const zip=pack(job,{...input,terrainBuffer});res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="site-context-package.zip"','Content-Length':zip.length,'Cache-Control':'no-store'});return res.end(zip);
    }
    if(url.pathname==='/geometry.js'&&req.method==='GET'){
      const source=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'geo.mjs'));
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(source);
    }
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
    const requestPath=url.pathname==='/'?'/index.html':url.pathname;
    const filepath=path.resolve(root,'.'+decodeURIComponent(requestPath));if(!filepath.startsWith(root+path.sep))return json(res,403,{error:'Forbidden.'});
    const file=await readFile(filepath);res.writeHead(200,{'Content-Type':mime[path.extname(filepath)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(file);
  }catch(err){
    const client=/^(Draw|Invalid|Close|The selected|This selection|This boundary|Request|Set a valid)/.test(err.message);
    const status=err.status|| (err.code==='ENOENT'?404:client?400:err.name==='AbortError'?504:502);
    json(res,status,{error:status===404?'File not found.':status>=500?'The server could not complete this request.':err.message});
  }
});
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))server.listen(port,host,()=>console.log(`Site Context Studio listening on http://${host}:${port}`));
