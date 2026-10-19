'use strict';
// Explicit staging prevents developer profiles, telemetry, credentials, tests and
// dependency caches from entering the portable application. No repository-wide copy.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const desktop=path.resolve(__dirname,'..'),repo=path.resolve(desktop,'..');
const pkg=require('../package.json'),core=require('../../package.json');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):[path.join(dir,entry.name)]);
function assertSafeNames(names){
  for(const name of names)if(/(?:^|[/\\])(?:node_modules|test|tests|test-results|sessions|archived_sessions|logs|runtime|poc-data|\.git|\.codex)(?:[/\\]|$)|\.(?:jsonl|sqlite\d*|db|log|tgz|pem|pfx|key)(?:$|[-.])|(?:^|[/\\])\.env(?:$|[.])|(?:^|[/\\])(?:auth|credentials|session_index|preferences|window-state|desktop-status)\.json|(?:^|[/\\])node\.exe$/i.test(name))throw Error('Unexpected private/development resource in package: '+name);
}
async function createPackage(){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('This preview must be packaged on Windows x64.');
  require('../../lib/runtime').assertSupportedNode('Desktop packaging');
  for(const file of ['dist/gui/index.html','dist/gui/THIRD-PARTY-NOTICES.md'])if(!fs.existsSync(path.join(repo,file)))throw Error('Build the existing GUI first: npm run build:desktop');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const build=path.join(desktop,'out',pkg.version+'-'+stamp),stage=path.join(build,'stage');
  fs.mkdirSync(stage,{recursive:true});
  for(const dir of ['src','ui','assets'])fs.cpSync(path.join(desktop,dir),path.join(stage,dir),{recursive:true});
  if(!fs.existsSync(path.join(stage,'assets/codex-hud.ico')))throw Error('Export the tracked icon with desktop/scripts/create-icon.ps1.');
  // Packager strips npm-only private metadata. The development package stays private.
  const appPackage={name:pkg.name,productName:'Codex HUD',version:pkg.version,description:pkg.description,author:pkg.author,license:pkg.license,main:'src/main.cjs'};
  fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify(appPackage,null,2)+'\n');
  fs.mkdirSync(path.join(stage,'core/dist'),{recursive:true});
  fs.cpSync(path.join(repo,'lib'),path.join(stage,'core/lib'),{recursive:true});
  fs.cpSync(path.join(repo,'dist/gui'),path.join(stage,'core/dist/gui'),{recursive:true});
  fs.writeFileSync(path.join(stage,'core/package.json'),JSON.stringify({name:core.name,version:core.version,type:core.type,license:core.license,engines:core.engines},null,2)+'\n');
  for(const file of ['LICENSE','NOTICE.md'])fs.copyFileSync(path.join(repo,file),path.join(stage,file));
  fs.copyFileSync(path.join(desktop,'PORTABLE-README.txt'),path.join(stage,'PORTABLE-README.txt'));
  const sourceManifest=files(stage).map(file=>({file:path.relative(stage,file).replaceAll('\\','/'),size:fs.statSync(file).size,sha256:hash(file)}));
  assertSafeNames(sourceManifest.map(row=>row.file));
  const {packager}=await import('@electron/packager');
  const [output]=await packager({dir:stage,out:build,name:'Codex HUD',executableName:'CodexHUD',platform:'win32',arch:'x64',electronVersion:pkg.devDependencies.electron,asar:false,prune:false,icon:path.join(stage,'assets/codex-hud.ico'),appBundleId:'art.seanl6595.codex-hud.desktop',appCopyright:'Codex HUD contributors; upstream Copyright (c) 2026 harveyxiacn',win32metadata:{CompanyName:'Codex HUD contributors',FileDescription:'Codex HUD Desktop Preview',ProductName:'Codex HUD',OriginalFilename:'CodexHUD.exe'},download:{cacheRoot:process.env.ELECTRON_CACHE||path.join(desktop,'.electron-cache')}});
  for(const row of sourceManifest)if(hash(path.join(output,'resources/app',row.file))!==row.sha256)throw Error('Packaged resource changed: '+row.file);
  for(const file of ['LICENSE','LICENSES.chromium.html','resources/app/LICENSE','resources/app/NOTICE.md','resources/app/core/dist/gui/THIRD-PARTY-NOTICES.md'])if(!fs.existsSync(path.join(output,file)))throw Error('Required license notice missing: '+file);
  fs.copyFileSync(path.join(desktop,'PORTABLE-README.txt'),path.join(output,'START-HERE.txt'));
  const zip=path.join(build,`codex-hud-desktop-${pkg.version}-win-x64.zip`);
  const archive=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'archive.ps1'),'-Source',output,'-Destination',zip],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024}));
  assertSafeNames(archive.map(row=>row.name));
  const sha256=hash(zip);fs.writeFileSync(zip+'.sha256',sha256+'  '+path.basename(zip)+'\n');
  fs.writeFileSync(path.join(build,'SHA256SUMS'),sha256+'  '+path.basename(zip)+'\n');
  const result={version:pkg.version,electron:pkg.devDependencies.electron,coreVersion:core.version,output,executable:path.join(output,'CodexHUD.exe'),zip,sha256,archiveBytes:fs.statSync(zip).size,unpackedBytes:files(output).reduce((n,file)=>n+fs.statSync(file).size,0),sourceManifest,archive};
  fs.writeFileSync(path.join(build,'manifest.json'),JSON.stringify(result,null,2)+'\n');
  fs.writeFileSync(path.join(desktop,'out/latest.json'),JSON.stringify({build,executable:result.executable,zip,sha256,manifest:path.join(build,'manifest.json')},null,2)+'\n');
  console.log(JSON.stringify({executable:result.executable,zip,sha256,archiveBytes:result.archiveBytes,unpackedBytes:result.unpackedBytes,appFiles:sourceManifest.length,archiveEntries:archive.length},null,2));
}
if(require.main===module)createPackage().catch(error=>{console.error(error);process.exitCode=1});
module.exports={assertSafeNames,createPackage};
