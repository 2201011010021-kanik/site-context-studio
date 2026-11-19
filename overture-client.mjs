import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const python=process.env.OVERTURE_PYTHON||path.join(root,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
const script=path.join(root,'fetch-overture.py');
const reader=process.env.OVERTURE_READER_EXE||python;
const readerArgs=process.env.OVERTURE_READER_EXE?[]:[script];
const workDir=process.env.OVERTURE_WORK_DIR||root;
const deadlineMs=8*60*1000;
const responseLimit=32*1024*1024;

export async function fetchOverture(aoi,polygon,layers,signal,onProgress=()=>{},options={}){
  if(!existsSync(reader))throw new Error(process.env.OVERTURE_READER_EXE?'The bundled online reader is missing. Reinstall Site Context Studio.':'Online reader is not installed. Run ./scripts/install-online-deps.sh in the site-studio folder.');
  return new Promise((resolve,reject)=>{
    const child=spawn(reader,readerArgs,{cwd:workDir,stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    const chunks=[];let size=0,diagnostics='',settled=false,timedOut=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);if(error)reject(error);else resolve(value);};
    const cancel=()=>child.kill();
    const timer=setTimeout(()=>{timedOut=true;child.kill();},deadlineMs);
    signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted)cancel();
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({bounds:aoi.bounds,polygon,layers,...options}));
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>responseLimit)child.kill();else chunks.push(chunk);});
    child.stderr.on('data',chunk=>{
      diagnostics=(diagnostics+chunk.toString()).slice(-2500);
      for(const match of chunk.toString().matchAll(/Loaded (buildings|roads|water|landuse): \d+/g))onProgress(match[1]);
    });
    child.on('error',error=>finish(error));
    child.on('close',code=>{
      if(signal.aborted)return finish(new Error('Extraction cancelled.'));
      if(timedOut)return finish(new Error('Online data query exceeded eight minutes. Your boundary remains in this page; choose fewer layers or a smaller area.'));
      if(size>responseLimit)return finish(new Error('Online result exceeds the 32 MB response guard. Choose a smaller area.'));
      if(code!==0)return finish(new Error(diagnostics.match(/Online Overture query failed: ([^\n]+)/)?.[1]||'Online Overture query failed.'));
      try{const data=JSON.parse(Buffer.concat(chunks).toString());if(!data.layers||!data.release)throw new Error('Invalid Overture response.');finish(null,data);}catch(error){finish(error);}
    });
  });
}
