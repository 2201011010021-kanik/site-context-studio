export const PUBLIC_PROVIDERS=[
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

export class ProviderError extends Error{
  constructor(message,{code='PROVIDERS_UNAVAILABLE',status=503,retryAfterSeconds=0,diagnostics=[]}={}){
    super(message);this.code=code;this.status=status;this.retryAfterSeconds=retryAfterSeconds;this.diagnostics=diagnostics;
  }
}

export function createOverpassClient({providers=PUBLIC_PROVIDERS,fetcher=(...args)=>fetch(...args),now=()=>Date.now(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=12500,deadlineMs=27000,queryTimeout=10,cacheTtlMs=600000,staleTtlMs=21600000,logger=event=>console.warn(JSON.stringify(event))}={}){
  const health=new Map(providers.map(url=>[url,{failures:0,blockedUntil:0,attempts:0,lastStatus:null}]));
  const cache=new Map();
  const host=url=>new URL(url).hostname;
  const snapshot=()=>providers.map(url=>({provider:host(url),...health.get(url),blockedUntil:Math.max(0,health.get(url).blockedUntil-now())}));
  function query(bounds){const [w,s,e,n]=bounds.map(x=>x.toFixed(7)),box=`(${s},${w},${n},${e})`;
    return `[out:json][timeout:${queryTimeout}];(way["building"]${box};way["highway"]${box};way["waterway"]${box};way["natural"="water"]${box};way["landuse"]${box};);out geom;`;
  }
  async function request(bounds,signal=new AbortController().signal,kind='all'){
    if(signal.aborted)throw new ProviderError('Extraction cancelled.',{code:'CANCELLED',status:499});
    const key=kind+':'+bounds.map(x=>x.toFixed(7)).join(','),saved=cache.get(key),age=saved?now()-saved.fetchedAt:Infinity;
    if(saved&&age<cacheTtlMs)return {...saved.result,cacheStatus:'fresh',cacheAgeSeconds:Math.floor(age/1000),retrievedAt:new Date(saved.fetchedAt).toISOString()};
    const end=now()+deadlineMs,diagnostics=[];
    for(let round=0;round<2;round++){
    if(round){if(end-now()<timeoutMs+500||saved&&age<staleTtlMs||providers.every(url=>health.get(url).blockedUntil>now()))break;await pause(800+Math.floor(Math.random()*300));}
    for(const url of providers){
      const h=health.get(url),remaining=end-now();
      if(remaining<=0)break;
      if(h.blockedUntil>now()){diagnostics.push({provider:host(url),code:'CIRCUIT_OPEN'});continue;}
      const controller=new AbortController(),onAbort=()=>controller.abort(),timer=setTimeout(()=>controller.abort(),Math.min(timeoutMs,remaining));
      signal.addEventListener('abort',onAbort,{once:true});const began=now();h.attempts++;
      try{
        const treeBox=`(${bounds[1]},${bounds[0]},${bounds[3]},${bounds[2]})`;
        const statement=kind==='trees'?`[out:json][timeout:${queryTimeout}];node["natural"="tree"]${treeBox};out body;`:query(bounds);
        const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','User-Agent':'SiteContextStudio/0.1 (+https://site-context-studio-kanik-demo.pivotcommons.chatgpt.site)'},body:new URLSearchParams({data:statement}),signal:controller.signal});
        if(response.status===429||response.status===406){
          const header=response.headers.get('Retry-After'),seconds=Number(header),date=Date.parse(header||'');
          const retry=Number.isFinite(seconds)&&seconds>0?seconds:Number.isFinite(date)?Math.ceil((date-now())/1000):60;
          const wait=Math.max(1,Math.min(retry,3600));
          h.blockedUntil=now()+wait*1000;h.lastStatus=response.status;
          throw new ProviderError('The map provider is rate limiting requests. Wait before trying again.',{code:'RATE_LIMITED',status:429,retryAfterSeconds:wait,diagnostics:[{provider:host(url),status:response.status}]});
        }
        if(!response.ok){
          if(response.status>=400&&response.status<500)throw new ProviderError('The map provider rejected this request.',{code:'PROVIDER_REJECTED',diagnostics:[{provider:host(url),status:response.status}]});
          const error=new Error(`HTTP ${response.status}`);error.status=response.status;throw error;
        }
        if(Number(response.headers.get('content-length')||0)>12000000)throw new Error('The map provider response exceeds 12 MB.');
        const raw=await response.text();if(raw.length>12000000)throw new Error('The map provider response exceeds 12 MB.');
        const data=JSON.parse(raw);
        if(!Array.isArray(data?.elements)||data.elements.some(item=>!item||!['node','way','relation'].includes(item.type)))throw new Error('Invalid map data response.');
        h.failures=0;h.blockedUntil=0;h.lastStatus=200;
        const fetchedAt=now(),result={data,endpoint:url};
        if(raw.length<=2000000){cache.delete(key);cache.set(key,{result,fetchedAt});if(cache.size>8)cache.delete(cache.keys().next().value);}
        return {...result,cacheStatus:'live',cacheAgeSeconds:0,retrievedAt:new Date(fetchedAt).toISOString()};
      }catch(cause){
        if(signal.aborted)throw new ProviderError('Extraction cancelled.',{code:'CANCELLED',status:499});
        if(cause instanceof ProviderError){
          if(saved&&age<staleTtlMs)return {...saved.result,cacheStatus:'stale',cacheAgeSeconds:Math.floor(age/1000),retrievedAt:new Date(saved.fetchedAt).toISOString()};
          throw cause;
        }
        const code=controller.signal.aborted||cause.name==='AbortError'?'TIMEOUT':cause.status?`HTTP_${cause.status}`:cause instanceof SyntaxError?'INVALID_JSON':cause.message==='Invalid map data response.'?'INVALID_SCHEMA':'NETWORK_OR_RESPONSE';
        h.failures++;h.lastStatus=cause.status||code;if(h.failures>=2)h.blockedUntil=now()+60000;
        const detail={provider:host(url),code,elapsedMs:now()-began};diagnostics.push(detail);logger({event:'map_provider_failed',...detail});
        if(url!==providers.at(-1)&&end-now()>800)await pause(400+Math.floor(Math.random()*250));
      }finally{clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
    }
    }
    if(saved&&age<staleTtlMs)return {...saved.result,cacheStatus:'stale',cacheAgeSeconds:Math.floor(age/1000),retrievedAt:new Date(saved.fetchedAt).toISOString()};
    const blocked=providers.map(url=>health.get(url).blockedUntil).filter(time=>time>now());
    const retryAfterSeconds=blocked.length?Math.ceil((Math.min(...blocked)-now())/1000):0;
    throw new ProviderError('Live map data is unavailable. Your boundary is saved; try again later.',{retryAfterSeconds,diagnostics});
  }
  return {request,snapshot};
}
