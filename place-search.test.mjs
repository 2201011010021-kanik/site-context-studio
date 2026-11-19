import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaceSearch} from './place-search.mjs';

test('searches submitted place names, maps bounds, validates coordinates, and caches results',async()=>{
  const requests=[];
  const search=createPlaceSearch({endpoint:'https://example.test/search',now:()=>1000,
    fetchImpl:async(url,options)=>{
      requests.push({url:new URL(url),options});
      return {ok:true,json:async()=>[
        {display_name:'Paris, France',lat:'48.8566',lon:'2.3522',boundingbox:['48.815','48.902','2.225','2.469']},
        {display_name:'Invalid',lat:'1000',lon:'2'}
      ]};
    }});
  const [first,second]=await Promise.all([search.search('  Paris, France  '),search.search('Paris, France')]);
  assert.deepEqual(first,second);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url.searchParams.get('q'),'Paris, France');
  assert.equal(requests[0].url.searchParams.get('limit'),'5');
  assert.match(requests[0].options.headers['User-Agent'],/KaniksStudio/);
  assert.deepEqual(first,[{label:'Paris, France',lat:48.8566,lon:2.3522,bounds:[[48.815,2.225],[48.902,2.469]]}]);
  assert.deepEqual(await search.search('paris, france'),first);
  assert.equal(requests.length,1);
  assert.throws(()=>search.search('x'),{status:400});
});

test('serializes upstream searches at least one second apart and recovers from provider failures',async()=>{
  let clock=0;
  const calls=[],waits=[];
  const search=createPlaceSearch({now:()=>clock,pause:async(ms)=>{waits.push(ms);clock+=ms;},
    fetchImpl:async(url)=>{calls.push({query:new URL(url).searchParams.get('q'),at:clock});return calls.length===2?{ok:false,status:429}:{ok:true,json:async()=>[]};}});
  const results=await Promise.allSettled([search.search('Sydney'),search.search('Tokyo'),search.search('Lima')]);
  assert.deepEqual(results.map(result=>result.status),['fulfilled','rejected','fulfilled']);
  assert.equal(results[1].reason.status,429);
  assert.deepEqual(calls.map(call=>call.at),[0,1100,2200]);
  assert.deepEqual(waits,[1100,1100]);
});
