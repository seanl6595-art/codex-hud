'use strict';
const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {createFixture}=require('../../../e2e/fixtures.cjs');
const repo=path.resolve(__dirname,'../../..');
const ownedProfiles=new Map();
function createProfile(){const profile=fs.mkdtempSync(path.join(os.tmpdir(),'hud-desktop-profile-'));ownedProfiles.set(profile,null);return profile;}
function cleanupProfiles(){for(const [profile,evidence]of ownedProfiles){const resolved=path.resolve(profile);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('hud-desktop-profile-'))throw Error('Unexpected profile cleanup target');const status=path.join(resolved,'desktop-status.json');if(evidence&&fs.existsSync(status)){fs.mkdirSync(evidence,{recursive:true});fs.copyFileSync(status,path.join(evidence,'desktop-final-status.json'));}fs.rmSync(resolved,{recursive:true,force:true});}ownedProfiles.clear();}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
async function until(fn,timeout=10000,message='Condition timed out'){const start=Date.now();while(!await fn()){if(Date.now()-start>timeout)throw Error(message);await pause(100);}}
function executable(){
  const file=process.env.CODEX_HUD_DESKTOP_EXECUTABLE;
  if(!file||!path.isAbsolute(file)||!fs.existsSync(file))throw Error('Set CODEX_HUD_DESKTOP_EXECUTABLE to an extracted preview EXE outside the checkout.');
  if(path.resolve(file).toLowerCase().startsWith(repo.toLowerCase()+path.sep))throw Error('Native tests require an executable outside the checkout.');
  return file;
}
async function fixture(root,mode='populated'){
  // Chromium profile internals can exceed Windows MAX_PATH when nested beneath
  // Playwright's descriptive artifact names. Keep owned profiles short.
  fs.mkdirSync(root,{recursive:true});const f=await createFixture(mode,root);return{...f,profile:createProfile()};
}
async function launch(f,extra=[]){
  if(!f.home||!f.dbPath||!f.profile)throw Error('Disposable source, DB and profile must be explicit.');
  if(ownedProfiles.has(f.profile))ownedProfiles.set(f.profile,f.root||path.dirname(f.dbPath));
  const exe=executable(),args=['--codex-home',f.home,'--db',f.dbPath,'--user-data',f.profile,...extra];
  const env={...process.env,PATH:process.platform==='win32'?process.env.SystemRoot+'\\System32':'/usr/bin:/bin:/usr/sbin:/sbin'};delete env.NODE_OPTIONS;delete env.NODE_PATH;delete env.ELECTRON_RUN_AS_NODE;
  const start=performance.now();const app=await electron.launch({executablePath:exe,args,env,cwd:path.dirname(exe),timeout:30000});
  const page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  return{app,page,f,start,args,env,errors};
}
async function ready(t,kind='data'){
  await until(()=>{const gui=t.app.context().pages().find(p=>!p.isClosed()&&p.url().startsWith('http://127.0.0.1:'));if(gui){t.page=gui;return true;}return false;},30000);
  await t.page.waitForLoadState('domcontentloaded');
  if(kind==='missing')await expect(t.page.locator('.onboarding')).toBeVisible();else await expect(t.page.locator('.metrics')).toBeVisible();
  try{await until(()=>{try{return status(t).events.some(e=>e.event==='dashboard-ready')}catch{return false}});}catch(error){error.message+='; diagnostic='+JSON.stringify(status(t));throw error;}
  return performance.now()-t.start;
}
function status(t){return JSON.parse(fs.readFileSync(path.join(t.f.profile,'desktop-status.json'),'utf8'));}
async function shellPage(t){let page;await until(()=>{page=t.app.context().pages().find(p=>p.url().startsWith('codex-hud://shell/index.html'));return !!page});return page;}
async function api(t,route,options={}){try{const origin=new URL(t.page.url()).origin;const token=(await(await fetch(origin+'/api/bootstrap')).json()).token;return await fetch(origin+route,{...options,headers:{'x-codex-hud-token':token,...options.headers}});}catch(error){error.message+='; diagnostic='+JSON.stringify(status(t));throw error;}}
async function pids(t){return t.app.evaluate(({app})=>app.getAppMetrics().map(m=>m.pid));}
async function close(t){
  const owned=await pids(t),started=performance.now(),closed=t.app.waitForEvent('close');
  if(process.platform==='darwin')await t.app.evaluate(({app})=>app.quit());
  else await t.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await closed;
  await until(()=>owned.every(pid=>!alive(pid)));const final=status(t);if(t.f.root)fs.writeFileSync(path.join(t.f.root,'desktop-final-status.json'),JSON.stringify(final,null,2));return{ms:performance.now()-started,remaining:owned.filter(alive),status:final};
}
async function memory(t){
  const metrics=await t.app.evaluate(({app})=>app.getAppMetrics());
  let list;
  if(process.platform==='win32')list=[].concat(JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','Get-Process -Id '+metrics.map(m=>m.pid).join(',')+' -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64,CPU | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true})));
  else list=execFileSync('/bin/ps',['-p',metrics.map(m=>m.pid).join(','),'-o','pid=,rss=,time='],{encoding:'utf8'}).trim().split('\n').filter(Boolean).map(line=>{const [pid,rss,time]=line.trim().split(/\s+/);const parts=time.split(':').map(Number);let seconds=0;for(const n of parts)seconds=seconds*60+n;return{Id:Number(pid),WorkingSet64:Number(rss)*1024,CPU:seconds};});
  return{workingSetMiB:list.reduce((n,p)=>n+p.WorkingSet64,0)/1048576,privateMiB:process.platform==='win32'?list.reduce((n,p)=>n+p.PrivateMemorySize64,0)/1048576:null,metrics:metrics.map(m=>({pid:m.pid,type:m.type,name:m.name,cpu:m.cpu.percentCPUUsage})),processes:list};
}
function snapshot(f){
  const files=[f.dbPath,...fs.readdirSync(path.join(f.home,'sessions')).map(n=>path.join(f.home,'sessions',n))];
  return files.map(file=>({file,size:fs.statSync(file).size,mtime:fs.statSync(file).mtimeMs,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
}
async function capture(t,file){
  await t.app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];if(w.isMinimized())w.restore();w.show();w.focus();});await pause(200);
  // On macOS this is real rendered app content, not a capture of the OS title bar.
  // It needs no Screen Recording permission or Gatekeeper bypass on CI.
  if(process.platform!=='win32'){await t.page.screenshot({path:file});return;}
  const handle=await t.app.evaluate(({BrowserWindow})=>{const b=BrowserWindow.getAllWindows()[0].getNativeWindowHandle();return b.length===8?Number(b.readBigUInt64LE()):b.readUInt32LE();});
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'capture-window.ps1'),'-WindowHandle',String(handle),'-OutputPath',file],{windowsHide:true});
}
function attachJSON(testInfo,name,value){const file=testInfo.outputPath(name+'.json');fs.writeFileSync(file,JSON.stringify(value,null,2));return testInfo.attach(name,{path:file,contentType:'application/json'});}
module.exports={fixture,launch,ready,close,api,status,shellPage,memory,pids,pause,until,alive,snapshot,capture,attachJSON,executable,repo,createProfile,cleanupProfiles};
