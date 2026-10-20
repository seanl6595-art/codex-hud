'use strict';
// Native LaunchServices smoke test. Never launches the normal profile or real
// Codex sources, and never quits an app based only on its bundle identifier.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync,execFileSync}=require('node:child_process');
const {createFixture}=require('../../e2e/fixtures.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
async function until(fn,timeout=30000){const began=Date.now();while(!fn()){if(Date.now()-began>timeout)throw Error('Native Finder launch/quit timed out');await pause(100);}}
function tree(main){
 const rows=execFileSync('/bin/ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));const owned=new Set([main]);
 for(let changed=true;changed;){changed=false;for(const [pid,parent]of rows)if(owned.has(parent)&&!owned.has(pid)){owned.add(pid);changed=true;}}
 return[...owned];
}
function sameExecutable(pid,executable){try{return fs.realpathSync(execFileSync('/bin/ps',['-p',String(pid),'-o','comm='],{encoding:'utf8'}).trim())===fs.realpathSync(executable)}catch{return false}}
async function finderSmoke(){
 if(process.platform!=='darwin')throw Error('Finder/LaunchServices validation requires native macOS.');
 const latest=JSON.parse(fs.readFileSync(path.join(__dirname,`../out/macos/latest-${process.arch}.json`),'utf8'));
 const app=process.env.CODEX_HUD_DESKTOP_APP||latest.app,executable=path.join(app,'Contents/MacOS/Codex HUD');
 if(!fs.existsSync(executable))throw Error('Provide an actual complete .app bundle.');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hud-finder-smoke-')),profile=path.join(root,'profile');let main,owned=[];
 try{
  const fixture=await createFixture('populated',path.join(root,'synthetic'));
  const fingerprint=()=>[fixture.dbPath,...fs.readdirSync(path.join(fixture.home,'sessions')).map(file=>path.join(fixture.home,'sessions',file))].map(file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  const before=fingerprint(),statusFile=path.join(profile,'desktop-status.json');
  const status=()=>{try{return JSON.parse(fs.readFileSync(statusFile,'utf8'))}catch{return{events:[]}}};
  const env={...process.env,PATH:'/usr/bin:/bin:/usr/sbin:/sbin'};for(const name of ['CODEX_HOME','NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE'])delete env[name];
  const opened=spawnSync('/usr/bin/open',['-n','-a',app,'--args','--codex-home',fixture.home,'--db',fixture.dbPath,'--user-data',profile],{env,encoding:'utf8'});assert.equal(opened.status,0,opened.stderr);
  await until(()=>status().events.some(event=>event.event==='dashboard-ready'));
  const ready=status();assert.equal(ready.runtime.platform,'darwin');assert.equal(ready.runtime.arch,process.arch);assert.equal(ready.events.find(e=>e.event==='dashboard-ready').outcome,'data');
  main=ready.mainPid;assert.ok(Number.isInteger(main)&&sameExecutable(main,executable),'Refusing to signal a process not owned by this launch');owned=tree(main);
  const commands=owned.map(pid=>execFileSync('/bin/ps',['-p',String(pid),'-o','comm='],{encoding:'utf8'}).trim());assert.ok(commands.every(file=>!/^node(?:\.exe)?$/.test(path.basename(file))));
  process.kill(main,'SIGTERM');await until(()=>owned.every(pid=>!alive(pid)));
  const final=status();assert.ok(final.events.some(event=>event.event==='shutdown-complete'&&event.backendExited));assert.deepEqual(fingerprint(),before);
  const report={platform:process.platform,arch:process.arch,launch:'macOS LaunchServices (/usr/bin/open), no inspector',requestedPATH:env.PATH,globalNodeProcessUsed:false,readOnlyFingerprintUnchanged:true,remainingOwnedPids:owned.filter(alive),status:final,physicalFinderClick:false,quarantineGatekeeperTest:false};
  const evidence=path.resolve(process.env.CODEX_HUD_DESKTOP_TEST_ROOT||path.join(__dirname,'../test-results/mac-finder'));fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'finder-launch.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));return report;
 }finally{
  if(main&&alive(main)&&sameExecutable(main,executable)){process.kill(main,'SIGKILL');await until(()=>!alive(main));}
  const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('hud-finder-smoke-'));fs.rmSync(resolved,{recursive:true,force:true});
 }
}
if(require.main===module)finderSmoke().catch(error=>{console.error(error);process.exitCode=1});
module.exports={finderSmoke};
