// User-initiated place lookup. Shared queue and short-lived cache protect the
// public Nominatim service across all open tabs of this local studio.
export function createPlaceSearch({
  fetchImpl=fetch,
  endpoint=process.env.GEOCODER_URL||'https://nominatim.openstreetmap.org/search',
  userAgent='KaniksStudioSiteContext/0.1.36 (interactive site context editor)',
  now=Date.now,
  pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
}={}){
  const cache=new Map(),inflight=new Map();
  let tail=Promise.resolve(),nextRequestAt=0;
  const fail=(message,status=503)=>Object.assign(new Error(message),{status});
  function search(input){
    const query=String(input??'').trim().replace(/\s+/g,' ');
    if(query.length<2||query.length>160||/[\x00-\x1f\x7f]/.test(query))throw fail('Enter a place name between 2 and 160 characters.',400);
    const key=query.toLocaleLowerCase('en');
    const hit=cache.get(key);
    if(hit&&hit.expiresAt>now())return Promise.resolve(hit.results);
    if(inflight.has(key))return inflight.get(key);
    if(inflight.size>=15)throw fail('Place search is busy. Try again shortly.',429);
    const task=tail.catch(()=>{}).then(async()=>{
      const delay=Math.max(0,nextRequestAt-now());
      if(delay)await pause(delay);
      nextRequestAt=now()+1100;
      const url=new URL(endpoint);
      url.searchParams.set('q',query);
      url.searchParams.set('format','jsonv2');
      url.searchParams.set('limit','5');
      const response=await fetchImpl(url.toString(),{
        headers:{'User-Agent':userAgent,Accept:'application/json'},
        signal:AbortSignal.timeout(9000)
      });
      if(!response.ok)throw fail(response.status===429?'Place search is busy. Try again shortly.':'Place search is temporarily unavailable. Try again shortly.',response.status===429?429:503);
      const raw=await response.json();
      if(!Array.isArray(raw))throw fail('Place search returned an unexpected response.');
      const seen=new Set();
      const results=raw.slice(0,5).map(item=>{
        const lat=Number(item.lat),lon=Number(item.lon),bounds=item.boundingbox?.map(Number);
        if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180||!item.display_name)return null;
        const validBounds=Array.isArray(bounds)&&bounds.length===4&&bounds.every(Number.isFinite)
          &&bounds[0]>=-90&&bounds[1]<=90&&bounds[2]>=-180&&bounds[3]<=180
          &&bounds[0]<=bounds[1]&&bounds[2]<=bounds[3];
        return {label:String(item.display_name).slice(0,220),lat,lon,bounds:validBounds?[[bounds[0],bounds[2]],[bounds[1],bounds[3]]]:null};
      }).filter(place=>{
        if(!place)return false;
        const key=`${place.label}|${JSON.stringify(place.bounds)}`;
        if(seen.has(key))return false;
        seen.add(key);
        return true;
      });
      cache.delete(key);
      cache.set(key,{results,expiresAt:now()+(results.length?24*60*60*1000:10*60*1000)});
      if(cache.size>200)cache.delete(cache.keys().next().value);
      return results;
    });
    tail=task.catch(()=>{});
    inflight.set(key,task);
    task.then(()=>inflight.delete(key),()=>inflight.delete(key));
    return task;
  }
  return {search};
}
