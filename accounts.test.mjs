import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAccountStore} from './accounts.mjs';

test('accounts persist, authenticate with private sessions, and can be deleted',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'kaniks-accounts-'));
  const file=path.join(dir,'accounts.sqlite');let store=createAccountStore(file);
  try{
    const registered=await store.register('  Designer@Example.com  ','correct horse battery');
    assert.equal(registered.user.email,'designer@example.com');
    assert.equal(registered.user.plan,'free');
    assert.equal(registered.user.workspace.type,'personal');
    assert.equal(registered.user.workspace.role,'owner');
    assert.equal(store.getUser(registered.token).id,registered.user.id);
    const profile=store.updateProfile(registered.token,{displayName:'A. Designer',profession:'Architect',bio:'Site studies.'});
    assert.equal(profile.profile.display_name,'A. Designer');
    const other=await store.register('other@example.com','another secure password');
    assert.equal(store.getUser(other.token).profile.display_name,'');
    await assert.rejects(store.deleteAccount(other.token,'correct horse battery'),{status:401});
    await assert.rejects(store.register('designer@example.com','another long password'),{status:409});
    await assert.rejects(store.login('designer@example.com','wrong password'),{status:401});
    store.logout(registered.token);assert.equal(store.getUser(registered.token),null);
    store.close();store=createAccountStore(file);
    const signedIn=await store.login('designer@example.com','correct horse battery');
    assert.equal(signedIn.user.id,registered.user.id);
    assert.equal(signedIn.user.profile.profession,'Architect');
    await store.deleteAccount(signedIn.token,'correct horse battery');
    assert.equal(store.getUser(signedIn.token),null);
    await assert.rejects(store.login('designer@example.com','correct horse battery'),{status:401});
    assert.equal(store.getUser(other.token).email,'other@example.com');
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
