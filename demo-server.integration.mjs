import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

async function freePort(){
  const listener=net.createServer();
  await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  return port;
}

test('the shared demo password, visitor ownership, and proxy-aware auth limit protect a demo',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'kaniks-demo-'));
  const port=await freePort();
  const child=spawn(process.execPath,['server.mjs'],{cwd:import.meta.dirname,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',ACCOUNTS_DB:path.join(dir,'accounts.sqlite'),DEMO_PASSWORD:'demo-secret',SECURE_COOKIES:'1',TRUST_CLOUDFLARE_PROXY:'1',TRUST_CADDY_PROXY:'1',OVERPASS_URL:'http://127.0.0.1:1'},stdio:['ignore','pipe','pipe']});
  const base=`http://127.0.0.1:${port}`;
  const authorization=`Basic ${Buffer.from('demo:demo-secret').toString('base64')}`;
  try{
    let ready=false;
    for(let attempt=0;attempt<40;attempt++){
      if(child.exitCode!==null)throw new Error('Demo server exited before it was ready.');
      try{const response=await fetch(`${base}/api/health`,{headers:{Authorization:authorization}});ready=response.ok;if(ready)break;}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ready,'demo server should start');
    assert.equal((await fetch(`${base}/api/health`)).status,200,'cloud health checks should work without the demo password');
    const blocked=await fetch(base);
    assert.equal(blocked.status,401);
    assert.match(blocked.headers.get('www-authenticate'),/Basic/);
    const page=await fetch(base,{headers:{Authorization:authorization}});
    assert.equal(page.status,200);
    const csp=page.headers.get('content-security-policy');
    assert.match(csp,/object-src 'none'/);
    assert.match(csp,/frame-ancestors 'none'/);
    const html=await readFile(path.join(import.meta.dirname,'public','index.html'),'utf8');
    for(const [,inline] of html.matchAll(/<script(?: type="(?:importmap)?")?>([\s\S]*?)<\/script>/g)){
      const hash=createHash('sha256').update(inline).digest('base64');
      assert.ok(csp.includes(`'sha256-${hash}'`),'inline script hash should match CSP');
    }
    assert.equal((await fetch(`${base}/api/plan`,{method:'POST',headers:{Authorization:authorization,Origin:'https://another.example'}})).status,403);
    assert.equal((await fetch(`${base}/api/plan`,{method:'POST',headers:{Authorization:authorization,'Sec-Fetch-Site':'same-site'}})).status,403);
    assert.equal((await fetch(`${base}/api/plan`,{method:'POST',headers:{Authorization:authorization}})).status,403);
    assert.equal((await fetch(`${base}/%2e%2e%2fserver.mjs`,{headers:{Authorization:authorization}})).status,403);

    const polygon={type:'Polygon',coordinates:[[[72.57,23.02],[72.572,23.02],[72.572,23.022],[72.57,23.022],[72.57,23.02]]]};
    const response=await fetch(`${base}/api/extract`,{method:'POST',headers:{Authorization:authorization,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({polygon,layers:{buildings:false,roads:false,water:false,landuse:false,trees:true}})});
    assert.equal(response.status,202);
    const {id}=await response.json();
    const cookie=response.headers.get('set-cookie').split(';')[0];
    assert.match(response.headers.get('set-cookie'),/HttpOnly.*Secure/);
    assert.equal((await fetch(`${base}/api/jobs/${id}`,{headers:{Authorization:authorization}})).status,404);
    assert.equal((await fetch(`${base}/api/jobs/${id}`,{headers:{Authorization:authorization,Cookie:cookie}})).status,200);
    assert.equal((await fetch(`${base}/api/jobs/${id}`,{method:'DELETE',headers:{Authorization:authorization,Cookie:cookie,Origin:base}})).status,200);

    for(let attempt=0;attempt<10;attempt++){
      const result=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{Authorization:authorization,Origin:base,'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.1'},body:'{}'});
      assert.notEqual(result.status,429);
    }
    const limited=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{Authorization:authorization,Origin:base,'CF-Connecting-IP':'203.0.113.1'}});
    assert.equal(limited.status,429);
    const independent=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{Authorization:authorization,Origin:base,'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.2'},body:'{}'});
    assert.notEqual(independent.status,429);
    for(let attempt=0;attempt<10;attempt++){
      const result=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{Authorization:authorization,Origin:base,'Content-Type':'application/json','X-Forwarded-For':'198.51.100.1'},body:'{}'});
      assert.notEqual(result.status,429);
    }
    assert.equal((await fetch(`${base}/api/auth/login`,{method:'POST',headers:{Authorization:authorization,Origin:base,'X-Forwarded-For':'198.51.100.1'}})).status,429);
    assert.notEqual((await fetch(`${base}/api/auth/login`,{method:'POST',headers:{Authorization:authorization,Origin:base,'Content-Type':'application/json','X-Forwarded-For':'198.51.100.2'},body:'{}'})).status,429);
  }finally{
    child.kill('SIGTERM');
    await new Promise(resolve=>child.once('exit',resolve));
    await rm(dir,{recursive:true,force:true});
  }
});

test('the free hosted demo disables temporary accounts and limits capture area',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'kaniks-free-demo-'));
  const port=await freePort();
  const reader=path.join(dir,'slow-reader');
  await writeFile(reader,'#!/bin/sh\nexec sleep 20\n',{mode:0o700});
  const child=spawn(process.execPath,['server.mjs'],{cwd:import.meta.dirname,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',ACCOUNTS_DB:path.join(dir,'accounts.sqlite'),OVERTURE_PYTHON:reader,DEMO_PASSWORD:'demo-secret',DEMO_EPHEMERAL:'1',REQUIRE_DEMO_PASSWORD:'1',TRUST_RENDER_PROXY:'1'},stdio:['ignore','pipe','pipe']});
  const base=`http://127.0.0.1:${port}`;
  const headers={Authorization:`Basic ${Buffer.from('demo:demo-secret').toString('base64')}`,Origin:base,'Content-Type':'application/json'};
  try{
    for(let attempt=0;attempt<40;attempt++){
      if(child.exitCode!==null)throw new Error('Free demo exited before it was ready.');
      try{if((await fetch(`${base}/api/health`)).ok)break;}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const config=await fetch(`${base}/api/config`,{headers});
    assert.equal(config.status,200);
    assert.equal((await config.json()).accountsAvailable,false);
    assert.equal((await fetch(`${base}/api/auth/me`,{headers})).status,503);
    const polygon={type:'Polygon',coordinates:[[[72.57,23.02],[72.60,23.02],[72.60,23.04],[72.57,23.04],[72.57,23.02]]]};
    const plan=await fetch(`${base}/api/plan`,{method:'POST',headers,body:JSON.stringify({polygon})});
    assert.equal(plan.status,422);
    assert.match((await plan.json()).error,/5 km²/);
    const thin={type:'Polygon',coordinates:[[[72.57,23.02],[72.63,23.02],[72.63,23.0202],[72.57,23.0202],[72.57,23.02]]]};
    const thinPlan=await fetch(`${base}/api/plan`,{method:'POST',headers,body:JSON.stringify({polygon:thin})});
    assert.equal(thinPlan.status,422);
    assert.match((await thinPlan.json()).error,/within 5 km/);
    const nearLimit={type:'Polygon',coordinates:[[[72.57,23.02],[72.592,23.02],[72.592,23.039],[72.57,23.039],[72.57,23.02]]]};
    const nearLimitPlan=await fetch(`${base}/api/plan`,{method:'POST',headers,body:JSON.stringify({polygon:nearLimit})});
    assert.equal(nearLimitPlan.status,200);
    assert.ok((await nearLimitPlan.json()).areaKm2>4);
    const small={type:'Polygon',coordinates:[[[72.57,23.02],[72.572,23.02],[72.572,23.022],[72.57,23.022],[72.57,23.02]]]};
    const smallPlan=await fetch(`${base}/api/plan`,{method:'POST',headers,body:JSON.stringify({polygon:small})});
    assert.equal(smallPlan.status,200);
    assert.equal((await smallPlan.json()).featureLimit,150000);
    const layers={buildings:true,roads:false,water:false,landuse:false,trees:false};
    const first=await fetch(`${base}/api/extract`,{method:'POST',headers,body:JSON.stringify({polygon:small,layers})});
    assert.equal(first.status,202);
    const firstId=(await first.json()).id,firstCookie=first.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/api/jobs/${firstId}/pause`,{method:'POST',headers:{...headers,Cookie:firstCookie}})).status,200);
    let paused=false;
    for(let attempt=0;attempt<30;attempt++){
      const state=await (await fetch(`${base}/api/jobs/${firstId}`,{headers:{...headers,Cookie:firstCookie}})).json();
      if(state.status==='paused'){paused=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(paused,'first job should pause');
    const second=await fetch(`${base}/api/extract`,{method:'POST',headers,body:JSON.stringify({polygon:small,layers})});
    assert.equal(second.status,202);
    const secondId=(await second.json()).id,secondCookie=second.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/api/jobs/${firstId}/resume`,{method:'POST',headers:{...headers,Cookie:firstCookie}})).status,429);
    assert.equal((await fetch(`${base}/api/jobs/${secondId}`,{method:'DELETE',headers:{...headers,Cookie:secondCookie}})).status,200);
    assert.equal((await fetch(`${base}/api/jobs/${firstId}`,{method:'DELETE',headers:{...headers,Cookie:firstCookie}})).status,200);
    const invalid={...headers,Authorization:`Basic ${Buffer.from('demo:wrong').toString('base64')}`,'CF-Connecting-IP':'203.0.113.9'};
    for(let attempt=0;attempt<20;attempt++)assert.equal((await fetch(`${base}/api/config`,{headers:invalid})).status,401);
    assert.equal((await fetch(`${base}/api/config`,{headers:invalid})).status,429);
  }finally{
    child.kill('SIGTERM');
    await new Promise(resolve=>child.once('exit',resolve));
    await rm(dir,{recursive:true,force:true});
  }
});
