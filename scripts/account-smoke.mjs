// Run against a local server: node scripts/account-smoke.mjs
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const origin=process.env.STUDIO_ORIGIN||'http://127.0.0.1:8787';
const email=`account-smoke-${randomUUID()}@example.test`;
const password='local-test-password-2026';
let cookie='';
async function request(route,method='GET',payload){
  const response=await fetch(`${origin}/api/auth/${route}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});
  const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
  return {status:response.status,data:await response.json(),headers:response.headers};
}

try{
  let result=await request('register','POST',{email,password});
  assert.equal(result.status,201);assert.equal(result.data.user.plan,'free');
  assert.match(result.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
  result=await request('me');assert.equal(result.data.user.email,email);
  result=await request('profile','PATCH',{displayName:'Site Test',profession:'Designer',bio:'Local account smoke check.'});
  assert.equal(result.status,200);assert.equal(result.data.user.profile.display_name,'Site Test');
  result=await request('logout','POST');assert.equal(result.status,200);
  result=await request('me');assert.equal(result.data.user,null);
  result=await request('login','POST',{email,password});assert.equal(result.status,200);
  result=await request('account','DELETE',{password});assert.equal(result.status,200);
  result=await request('me');assert.equal(result.data.user,null);
  process.stdout.write('Account HTTP smoke check passed.\n');
}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}
