'use strict';
// Ordinary GUI execution: no Playwright launch, inspector or global Node lookup.
// The Node controller only creates disposable fixtures and reads process metrics.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn,execFileSync}=require('node:child_process');
const {createFixture}=require('../../e2e/fixtures.cjs');
const exe=process.env.CODEX_HUD_DESKTOP_EXECUTABLE;
if(!exe||!path.isAbsolute(exe)||!fs.existsSync(exe))throw Error('Provide the extracted preview using CODEX_HUD_DESKTOP_EXECUTABLE.');
const root=path.resolve(process.env.CODEX_HUD_DESKTOP_MEASURE_ROOT||path.join(__dirname,'../test-results/performance'));
fs.mkdirSync(root,{recursive:true});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
const processes=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'processes.ps1'),'-Executable',exe],{encoding:'utf8',windowsHide:true}));
async function until(fn,timeout=30000){const began=performance.now();while(!fn()){if(performance.now()-began>timeout)throw Error('Native measurement timed out');await pause(20);}}
function summary(rows){return{workingSetMiB:rows.reduce((n,p)=>n+p.WorkingSet64,0)/1048576,privateMiB:rows.reduce((n,p)=>n+p.PrivateMemorySize64,0)/1048576,cpuSeconds:rows.reduce((n,p)=>n+p.CPU,0),processCount:rows.length,processes:rows};}
(async()=>{
  if(processes().length)throw Error('Close other copies of this exact preview before measuring.');
  const f=await createFixture('populated',path.join(root,'synthetic-data'));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'hud-desktop-measure-'));
  const results=[];
  try{
    for(const label of ['fresh profile','warm profile 1','warm profile 2']){
      const env={...process.env,PATH:process.env.SystemRoot+'\\System32'};delete env.NODE_OPTIONS;delete env.NODE_PATH;delete env.ELECTRON_RUN_AS_NODE;
      const statusFile=path.join(profile,'desktop-status.json');if(fs.existsSync(statusFile))fs.unlinkSync(statusFile);
      const args=['--codex-home',f.home,'--db',f.dbPath,'--user-data',profile];
      const start=performance.now(),child=spawn(exe,args,{env,cwd:path.dirname(exe),windowsHide:true,stdio:'ignore'});
      const status=()=>{try{return JSON.parse(fs.readFileSync(statusFile,'utf8'))}catch{return{events:[]}}};
      const launched=()=>status().events;
      let closed=false;
      try{
        await until(()=>launched().some(e=>e.event==='window-visible'));const windowVisibleMs=performance.now()-start;
        await until(()=>launched().some(e=>e.event==='dashboard-ready'));const dashboardReadyMs=performance.now()-start;
        await pause(10000);const idle=summary(processes());
        await pause(10000);const idleEnd=summary(processes());
        const oneCorePercent=(idleEnd.cpuSeconds-idle.cpuSeconds)/10*100;
        const main=idleEnd.processes.find(p=>p.Id===child.pid);if(!main?.MainWindowHandle)throw Error('Owned native window was not found');
        if(label==='fresh profile')execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'../test/native/capture-window.ps1'),'-WindowHandle',String(main.MainWindowHandle),'-OutputPath',path.join(root,'actual-desktop-window.png')],{windowsHide:true});
        const stop=performance.now();execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'processes.ps1'),'-Executable',exe,'-ClosePid',String(child.pid)],{windowsHide:true});
        await until(()=>idleEnd.processes.every(p=>!alive(p.Id)));closed=true;
        const final=status();const result={label,windowVisibleMs,dashboardReadyMs,idle,idleEnd,idleOneCorePercent:oneCorePercent,idleSystemPercent:oneCorePercent/os.cpus().length,logicalCores:os.cpus().length,closeToExitMs:performance.now()-stop,backendShutdownMs:final.events.find(e=>e.event==='backend-stopped')?.durationMs,remainingOwnedPids:idleEnd.processes.filter(p=>alive(p.Id)).map(p=>p.Id),status:final,noInspector:true,nodeAbsentFromPATH:true};
        results.push(result);fs.writeFileSync(path.join(root,'measurements.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({label,windowVisibleMs,dashboardReadyMs,workingSetMiB:idleEnd.workingSetMiB,privateMiB:idleEnd.privateMiB,idleOneCorePercent:oneCorePercent,closeToExitMs:result.closeToExitMs,backendShutdownMs:result.backendShutdownMs,remainingOwnedPids:result.remainingOwnedPids}));
      }finally{if(!closed&&alive(child.pid)){const wait=new Promise(resolve=>child.once('exit',resolve));child.kill();await wait;}}
    }
  }finally{
    const resolved=path.resolve(profile);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('hud-desktop-measure-'))throw Error('Unexpected disposable profile target');fs.rmSync(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
