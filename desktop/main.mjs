import path from 'node:path';
import {app,BrowserWindow,shell,session,dialog} from 'electron';

let window;
let server;
let localOrigin;

function openExternal(url){
  try{
    const target=new URL(url);
    if(target.protocol==='https:')void shell.openExternal(target.href);
  }catch{}
}

function createWindow(){
  window=new BrowserWindow({
    width:1440,height:900,minWidth:760,minHeight:600,
    backgroundColor:'#f4f7fb',title:'Site Context Studio',autoHideMenuBar:true,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}
  });
  window.webContents.setWindowOpenHandler(({url})=>{openExternal(url);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{
    try{if(new URL(url).origin===localOrigin)return;}catch{}
    event.preventDefault();openExternal(url);
  });
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  void window.loadURL(`${localOrigin}/`);
  window.on('closed',()=>{window=null;});
}

async function start(){
  const dataDir=path.join(app.getPath('userData'),'site-data');
  for(const key of ['DEMO_PASSWORD','DEMO_PASSWORD_FILE','REQUIRE_DEMO_PASSWORD','DEMO_EPHEMERAL','TRUST_RENDER_PROXY','TRUST_CLOUDFLARE_PROXY','TRUST_CADDY_PROXY','SECURE_COOKIES'])delete process.env[key];
  process.env.DESKTOP_LOCAL='1';
  process.env.ACCOUNTS_DB=path.join(dataDir,'accounts.sqlite');
  process.env.OVERTURE_CATALOG_CACHE_DIR=path.join(dataDir,'overture-catalog');
  process.env.OVERTURE_WORK_DIR=dataDir;
  if(app.isPackaged){
    process.env.OVERTURE_READER_EXE=path.join(process.resourcesPath,'site-context-reader',process.platform==='win32'?'site-context-reader.exe':'site-context-reader');
  }
  ({server}=await import('../server.mjs'));
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});
  });
  localOrigin=`http://127.0.0.1:${server.address().port}`;
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  createWindow();
}

if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',()=>server?.close());
  app.whenReady().then(start).catch(error=>{
    dialog.showErrorBox('Site Context Studio could not start',error.message||String(error));
    app.quit();
  });
}
