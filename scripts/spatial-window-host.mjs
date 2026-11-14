import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {validateSpatialSurfaceInput,SPATIAL_DESKTOP_SURFACE_SCHEMA} from '../shared/vr/spatialDesktopSurfaceContractV1.mjs';

export function createNativeSurfaceAdapter(executable,{spawnRef=spawn}={}) {
  let process=null,buffer='',pending=null;
  function stop(){const active=process;process=null;buffer='';if(active)active.kill();if(pending){clearTimeout(pending.timer);pending.reject(new Error('Native surface stopped'));pending=null;}}
  function start(){
    if(process)return;
    // The helper is a GUI-subsystem binary with no console. Its explicit
    // connection consent must remain visible; SW_HIDE also hides MessageBox.
    const child=spawnRef(executable,[],{windowsHide:false,stdio:['pipe','pipe','ignore']});process=child;
    child.on('error',()=>{if(process===child)stop();});child.on('exit',()=>{if(process===child)stop();});
    child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{
      if(process!==child)return;
      buffer+=data;if(buffer.length>20*1024*1024){stop();return;}
      const end=buffer.indexOf('\n');if(end<0)return;
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      const current=pending;pending=null;if(!current){stop();return;}
      clearTimeout(current.timer);try{
        const value=JSON.parse(line);
        if(buffer.length||!value||Array.isArray(value)||typeof value.status!=='string')throw new Error('Invalid response');
        current.resolve(value);
      }catch{current.reject(new Error('Invalid native response'));stop();}
    });
  }
  return {stop,request(command){
    if(pending)return Promise.reject(new Error('Native surface busy'));
    start();return new Promise((resolve,reject)=>{
      pending={resolve,reject,timer:setTimeout(()=>stop(),command.op==='bind'?120000:15000)};
      const child=process;
      child.stdin.write(JSON.stringify(command)+'\n',error=>{if(error&&process===child)stop();});
    });
  }};
}
export function createSpatialWindowHost({native,origin='http://127.0.0.1:4173',port=4180,now=Date.now,buildId=null,readinessOnly=false}={}) {
  if(!['http://127.0.0.1:4173','http://127.0.0.1:4174'].includes(origin))throw new Error('Untrusted spatial origin');
  if(typeof readinessOnly!=='boolean')throw new Error('Invalid readiness mode');
  let session=null;
  const revoke=()=>{session=null;if(!readinessOnly)native.stop();};
  const timeout=setInterval(()=>{if(session&&now()-session.lastSeen>90000&&!session.busy)revoke();},1000);timeout.unref();
  const server=createServer(async(req,res)=>{
    const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    if(req.headers.host!==`127.0.0.1:${port}`||req.headers.origin!==origin){reply(403,{status:'origin-rejected'});return;}
    res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
    if(req.method==='GET'&&req.url==='/health'){reply(200,{schema:'stephanos.spatial-window-health.v1',buildId,...(readinessOnly?{readinessOnly:true}:{})});return;}
    // The temporary preparation listener must never accept a browser session
    // or start a capture child while the operator's page is already open.
    if(readinessOnly){reply(409,{status:'readiness-probe-only'});return;}
    if(req.method==='OPTIONS'){
      res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Spatial-Session');res.writeHead(204);res.end();return;
    }
    if(req.method!=='POST'||req.headers['content-type']!=='application/json'){reply(405,{status:'request-rejected'});return;}
    const chunks=[];let size=0;
    try{
      for await(const chunk of req){size+=chunk.length;if(size>4096)throw new Error('size');chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body||Array.isArray(body)||typeof body!=='object')throw new Error('body');
      if(req.url==='/session'){
        if(Object.keys(body).length)throw new Error('body');
        if(session&&(session.busy||now()-session.lastSeen<=90000)){reply(409,{status:'another-surface-active'});return;}
        revoke();session={token:randomBytes(32).toString('hex'),lastSeen:now(),bound:false,busy:false,sequence:0,windows:[]};
        reply(200,{schema:SPATIAL_DESKTOP_SURFACE_SCHEMA,token:session.token});return;
      }
      const current=session;
      const received=req.headers['x-spatial-session'];
      if(!current||typeof received!=='string'||!/^[a-f0-9]{64}$/.test(received)||!timingSafeEqual(Buffer.from(received),Buffer.from(current.token))||(!current.busy&&now()-current.lastSeen>90000)){reply(403,{status:'session-expired'});return;}
      if(req.url==='/stop'){if(Object.keys(body).length)throw new Error('body');revoke();reply(200,{status:'stopped'});return;}
      if(current.busy){reply(409,{status:'busy'});return;}
      current.busy=true;current.lastSeen=now();
      try{
        let result;
        if(req.url==='/windows'&&!current.bound&&Object.keys(body).length===0){
          result=await native.request({op:'list'});
          if(result.status!=='windows'||!Array.isArray(result.windows))throw new Error('list failed');
          current.windows=result.windows.filter(w=>Number.isSafeInteger(w.id)&&w.id>0&&Number.isSafeInteger(w.pid)&&w.pid>0&&typeof w.title==='string').slice(0,64);
          result={status:'windows',windows:current.windows};
        }else if(req.url==='/bind'&&Object.keys(body).length===1&&Number.isSafeInteger(body.id)){
          const window=current.windows.find(w=>w.id===body.id);if(!window)throw new Error('window');
          result=await native.request({op:'bind',id:window.id,pid:window.pid});current.bound=result.status==='connected';current.sequence=0;current.windows=[];
        }else if(req.url==='/frame'&&current.bound&&Object.keys(body).length===0){
          result=await native.request({op:'frame'});
        }else if(req.url==='/input'&&current.bound&&validateSpatialSurfaceInput(body)&&body.sequence===current.sequence+1){
          current.sequence=body.sequence;const {sequence:_,...input}=body;result=await native.request({op:'input',...input});
        }else throw new Error('operation');
        if(session!==current){reply(409,{status:'session-revoked'});return;}
        current.lastSeen=now();reply(200,result);
      }finally{current.busy=false;}
    }catch{reply(400,{status:'surface-request-failed'});}
  });
  server.headersTimeout=5000;server.requestTimeout=5000;server.maxConnections=8;
  server.on('close',()=>{clearInterval(timeout);revoke();});
  return server;
}
export function verifySpatialWindowInstallation(root) {
  const directory=resolve(root,'.stephanos/local-state-checkpoints/spatial-window');
  const receipt=JSON.parse(readFileSync(resolve(directory,'build.json'),'utf8').replace(/^\uFEFF/,''));
  const paths=['src/windows/Stephanos.SpatialWindow/SpatialWindow.cpp','scripts/spatial-window-host.mjs','shared/vr/spatialDesktopSurfaceContractV1.mjs'];
  const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
  if(receipt.schema!=='stephanos.spatial-window-build.v1'||!Array.isArray(receipt.sources)||receipt.sources.length!==paths.length)throw new Error('Console installation receipt missing');
  const digests=paths.map((path,i)=>{const digest=hash(resolve(root,path));if(receipt.sources[i]?.path!==path||receipt.sources[i]?.sha256!==digest)throw new Error('Console source changed; rebuild the reviewed installation');return digest;});
  const executable=resolve(directory,'SpatialWindow.exe'),nativeSha256=hash(executable);
  const buildId=createHash('sha256').update([...digests,nativeSha256].join(':')).digest('hex');
  if(nativeSha256!==receipt.nativeSha256||buildId!==receipt.buildId)throw new Error('Console binary does not match its installation receipt');
  return {executable,buildId};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const readinessOnly=process.argv.includes('--readiness-probe');
  if(readinessOnly&&process.argv.slice(2).length!==1)throw new Error('Readiness probe accepts no other arguments');
  const preview=process.argv.includes('--preview');
  const installation=preview?null:verifySpatialWindowInstallation(root);
  if(process.argv.includes('--verify-installation')){
    if(preview)throw new Error('Preview is not an installed console');
    console.log(JSON.stringify({status:'verified',buildId:installation.buildId}));
  }else{
  const nativePath=preview?process.argv[process.argv.indexOf('--native')+1]:installation.executable;
  if(!nativePath)throw new Error('Native capture binary missing');
  const server=createSpatialWindowHost({native:readinessOnly?null:createNativeSurfaceAdapter(nativePath),origin:`http://127.0.0.1:${preview?4174:4173}`,port:preview?4184:4180,buildId:installation?.buildId??null,readinessOnly});
  server.on('error',()=>{console.error('Spatial console could not bind its local port.');process.exitCode=1;});
  server.listen(preview?4184:4180,'127.0.0.1',()=>console.log('Spatial desktop adapter ready on loopback'));
  const stop=()=>server.close(()=>process.exit(0));process.on('SIGINT',stop);process.on('SIGTERM',stop);
  }
}
