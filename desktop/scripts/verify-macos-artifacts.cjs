'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {bundleID,bundleVersion,releaseVersion}=require('../forge.macos.cjs');
const {inspectMacSignatures}=require('./inspect-macos-signatures.cjs');
const {nativeTarget}=require('./package-macos.cjs');
const desktop=path.resolve(__dirname,'..');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function verifyBundle(app,latest){
 const appRoot=path.join(app,'Contents/Resources/app'),packaged=JSON.parse(fs.readFileSync(path.join(appRoot,'package.json'),'utf8'));
 const plist=key=>execFileSync('/usr/libexec/PlistBuddy',['-c','Print :'+key,path.join(app,'Contents/Info.plist')],{encoding:'utf8'}).trim();
 assert.equal(packaged.version,bundleVersion);assert.equal(packaged.codexHudReleaseVersion,releaseVersion);
 assert.equal(plist('CFBundleIdentifier'),bundleID);assert.equal(plist('CFBundleExecutable'),'Codex HUD');
 assert.equal(plist('CFBundleShortVersionString'),bundleVersion);assert.equal(plist('CFBundleVersion'),bundleVersion);assert.equal(plist('CodexHUDReleaseVersion'),releaseVersion);
 for(const row of latest.sourceManifest)assert.equal(hash(path.join(appRoot,row.file)),row.sha256,row.file);
 const arch=execFileSync('/usr/bin/lipo',['-archs',path.join(app,'Contents/MacOS/Codex HUD')],{encoding:'utf8'}).trim();assert.equal(arch,process.arch==='x64'?'x86_64':'arm64');
 return inspectMacSignatures(app);
}
function verifyMacArtifacts(){
 nativeTarget();
 const translated=require('node:child_process').spawnSync('/usr/sbin/sysctl',['-in','sysctl.proc_translated'],{encoding:'utf8'});
 assert.notEqual(translated.stdout?.trim(),'1','Rosetta is not native validation');
 const latestFile=path.join(desktop,'out/macos/latest-'+process.arch+'.json'),latest=JSON.parse(fs.readFileSync(latestFile,'utf8'));
 assert.equal(latest.version,releaseVersion);assert.equal(latest.bundleVersion,bundleVersion);
 for(const row of latest.artifacts)assert.equal(hash(row.file),row.sha256,path.basename(row.file));
 // A prior pass cannot authorize a newly failed/re-run package.
 const passFile=path.join(latest.build,'validated-internal.json');fs.rmSync(passFile,{force:true});
 const indexFile=path.join(latest.build,'artifact-index.json'),index=JSON.parse(fs.readFileSync(indexFile,'utf8'));
 index.nativeRuntimeValidation='pending';fs.writeFileSync(indexFile,JSON.stringify(index,null,2)+'\n');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hud-artifact-verify-')),mount=path.join(root,'mount');fs.mkdirSync(mount);let mounted=false;
 const report={platform:process.platform,arch:process.arch,osVersion:execFileSync('/usr/bin/sw_vers',['-productVersion'],{encoding:'utf8'}).trim(),version:releaseVersion,bundleVersion,artifactHashesVerified:true,containers:[],developerIDSigned:false,notarizationVerified:false,gatekeeperQuarantineLaunchTested:false};
 try{
  const zipDir=path.join(root,'zip'),dmgDir=path.join(root,'dmg');fs.mkdirSync(zipDir);fs.mkdirSync(dmgDir);
  execFileSync('/usr/bin/ditto',['-x','-k',latest.zip,zipDir]);
  execFileSync('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,latest.dmg],{stdio:'pipe'});mounted=true;
  assert.equal(fs.readlinkSync(path.join(mount,'Applications')),'/Applications');
  const mountedSignatures=verifyBundle(path.join(mount,'Codex HUD.app'),latest);
  execFileSync('/usr/bin/ditto',[path.join(mount,'Codex HUD.app'),path.join(dmgDir,'Codex HUD.app')]);
  execFileSync('/usr/bin/hdiutil',['detach',mount],{stdio:'pipe'});mounted=false;
  for(const [container,dir]of [['zip',zipDir],['dmg',dmgDir]]){
   const app=path.join(dir,'Codex HUD.app'),signatures=verifyBundle(app,latest);
   if(container==='dmg')assert.deepEqual(signatures,mountedSignatures,'Copying from the final DMG changed signed code');
   console.log(container+' extracted signature/entitlement gate:',JSON.stringify(signatures));
   const evidence=path.join(latest.build,'validation',container);fs.mkdirSync(evidence,{recursive:true});
   fs.writeFileSync(path.join(evidence,'signatures.json'),JSON.stringify(signatures,null,2)+'\n');
   const env={...process.env,CODEX_HUD_DESKTOP_APP:app,CODEX_HUD_DESKTOP_EXECUTABLE:path.join(app,'Contents/MacOS/Codex HUD'),CODEX_HUD_DESKTOP_TEST_ROOT:path.join(evidence,'native')};
   delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;delete env.NODE_PATH;delete env.CODEX_HOME;
   // Launch the extracted executable and complete bundle, never the build
   // directory. No re-signing, quarantine removal or Gatekeeper bypass.
   execFileSync(process.execPath,[path.join(__dirname,'runtime-tests.cjs')],{cwd:desktop,env,stdio:'inherit'});
   execFileSync(process.execPath,[require.resolve('@playwright/test/cli'),'test','--config',path.join(desktop,'playwright.config.cjs')],{cwd:desktop,env,stdio:'inherit'});
   execFileSync(process.execPath,[path.join(__dirname,'macos-finder-smoke.cjs')],{cwd:desktop,env,stdio:'inherit'});
   report.containers.push({container,signatureGatePassed:true,sourceResourcesMatched:true,embeddedNodeSuitePassed:true,nativeSQLiteRecorderWorkersRendererSuitePassed:true,launchServicesPassed:true});
  }
  for(const row of latest.artifacts)assert.equal(hash(row.file),row.sha256,path.basename(row.file));
  fs.writeFileSync(path.join(latest.build,'artifact-verification.json'),JSON.stringify(report,null,2)+'\n');
  index.nativeRuntimeValidation='passed for final ZIP and DMG on '+report.osVersion+' '+process.arch;
  latest.nativeRuntimeValidation=index.nativeRuntimeValidation;
  fs.writeFileSync(indexFile,JSON.stringify(index,null,2)+'\n');fs.writeFileSync(latestFile,JSON.stringify(latest,null,2)+'\n');
  fs.writeFileSync(path.join(latest.build,'manifest.json'),JSON.stringify(latest,null,2)+'\n');
  // Internal readiness marker. Binary upload requires separate explicit approval.
  fs.writeFileSync(passFile,JSON.stringify({report,artifacts:latest.artifacts},null,2)+'\n');
  console.log(JSON.stringify(report,null,2));return report;
 }finally{
  if(mounted)execFileSync('/usr/bin/hdiutil',['detach',mount],{stdio:'pipe'});
  const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('hud-artifact-verify-'));fs.rmSync(resolved,{recursive:true,force:true});
 }
}
if(require.main===module){try{verifyMacArtifacts();}catch(error){console.error(error);process.exitCode=1;}}
module.exports={verifyMacArtifacts,verifyBundle};
