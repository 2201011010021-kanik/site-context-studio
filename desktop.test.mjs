import assert from 'node:assert/strict';
import {test} from 'node:test';

process.env.ACCOUNTS_DB=':memory:';
const {desktopRequestAllowed}=await import('./server.mjs');

test('desktop listener accepts only its exact loopback Host',()=>{
  const request=(host,remoteAddress)=>({headers:{host},socket:{remoteAddress}});
  assert.equal(desktopRequestAllowed(request('127.0.0.1:49152','127.0.0.1'),49152),true);
  assert.equal(desktopRequestAllowed(request('attacker.example','127.0.0.1'),49152),false);
  assert.equal(desktopRequestAllowed(request('127.0.0.1:49153','127.0.0.1'),49152),false);
  assert.equal(desktopRequestAllowed(request('127.0.0.1:49152','192.168.1.20'),49152),false);
});
