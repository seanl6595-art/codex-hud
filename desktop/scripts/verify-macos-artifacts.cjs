'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {bundleVersion,releaseVersion}=require('../forge.macos.cjs');
function verifyMacArtifacts(){
 if(process.platform!=='darwin')throw Error('DMG and native bundle verification requires macOS.');
 const latest=JSON.parse(fs.readFileSync(path.join(__dirname,`../out/macos/latest-${process.arch}.json`),'utf8'));
 const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 for(const row of latest.artifacts)assert.equal(hash(row.file),row.sha256,path.basename(row.file));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hud-dmg-verify-')),mount=path.join(root,'mount');fs.mkdirSync(mount);let mounted=false;
 try{
  execFileSync('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,latest.dmg],{stdio:'pipe'});mounted=true;
  const app=path.join(mount,'Codex HUD.app'),appRoot=path.join(app,'Contents/Resources/app');
  const packaged=JSON.parse(fs.readFileSync(path.join(appRoot,'package.json'),'utf8'));
  const plist=key=>execFileSync('/usr/libexec/PlistBuddy',['-c','Print :'+key,path.join(app,'Contents/Info.plist')],{encoding:'utf8'}).trim();
  assert.equal(latest.version,releaseVersion);assert.equal(latest.bundleVersion,bundleVersion);
  assert.equal(packaged.version,bundleVersion);assert.equal(packaged.codexHudReleaseVersion,releaseVersion);
  assert.equal(plist('CFBundleShortVersionString'),bundleVersion);assert.equal(plist('CFBundleVersion'),bundleVersion);assert.equal(plist('CodexHUDReleaseVersion'),releaseVersion);
  for(const row of latest.sourceManifest)assert.equal(hash(path.join(appRoot,row.file)),row.sha256,row.file);
  assert.equal(fs.readlinkSync(path.join(mount,'Applications')),'/Applications');
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
  const arch=execFileSync('/usr/bin/lipo',['-archs',path.join(app,'Contents/MacOS/Codex HUD')],{encoding:'utf8'}).trim();assert.equal(arch,process.arch==='x64'?'x86_64':'arm64');
  const report={platform:process.platform,arch:process.arch,version:releaseVersion,bundleVersion,releaseIdentityVerified:true,artifactHashesVerified:true,readOnlyDMGMounted:true,sourceResourcesMatched:true,internalSignatureIntegrityVerified:true,developerIDSigned:false,notarizationVerified:false,gatekeeperQuarantineLaunchTested:false};
  fs.writeFileSync(path.join(latest.build,'artifact-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));return report;
 }finally{
  if(mounted)execFileSync('/usr/bin/hdiutil',['detach',mount],{stdio:'pipe'});
  const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('hud-dmg-verify-'));fs.rmSync(resolved,{recursive:true,force:true});
 }
}
if(require.main===module){try{verifyMacArtifacts();}catch(error){console.error(error);process.exitCode=1;}}
module.exports={verifyMacArtifacts};
