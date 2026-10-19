'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync,spawnSync}=require('node:child_process');
const {assertSafeNames}=require('./package.cjs');
const {createMacIcon}=require('./create-mac-icon.cjs');
const {createMacForgeConfig,bundleID,bundleVersion,releaseVersion}=require('../forge.macos.cjs');
const desktop=path.resolve(__dirname,'..'),repo=path.resolve(desktop,'..');
const pkg=require('../package.json'),core=require('../../package.json');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(directory,e.name)):[path.join(directory,e.name)]);
function nativeTarget(arch=process.arch,platform=process.platform,hostArch=process.arch){
  if(platform!=='darwin')throw Error('macOS internal previews require a native macOS host; cross-builds are not native validation.');
  if(!['arm64','x64'].includes(arch)||arch!==hostArch)throw Error('Build and test each Mac architecture on a matching native runner.');
  return arch;
}
function stageMacApplication(stage,electronDist=path.join(desktop,'node_modules/electron/dist')){
  for(const file of ['dist/gui/index.html','dist/gui/THIRD-PARTY-NOTICES.md'])if(!fs.existsSync(path.join(repo,file)))throw Error('Build the existing GUI before packaging.');
  fs.mkdirSync(stage,{recursive:true});
  for(const dir of ['src','ui'])fs.cpSync(path.join(desktop,dir),path.join(stage,dir),{recursive:true});
  fs.mkdirSync(path.join(stage,'assets'));for(const file of ['icon.svg','icon-1024.png'])fs.copyFileSync(path.join(desktop,'assets',file),path.join(stage,'assets',file));
  fs.mkdirSync(path.join(stage,'core/dist'),{recursive:true});fs.cpSync(path.join(repo,'lib'),path.join(stage,'core/lib'),{recursive:true});fs.cpSync(path.join(repo,'dist/gui'),path.join(stage,'core/dist/gui'),{recursive:true});
  fs.writeFileSync(path.join(stage,'core/package.json'),JSON.stringify({name:core.name,version:core.version,type:core.type,license:core.license,engines:core.engines},null,2)+'\n');
  for(const file of ['LICENSE','NOTICE.md'])fs.copyFileSync(path.join(repo,file),path.join(stage,file));
  for(const [source,destination]of [['LICENSE','ELECTRON-LICENSE.txt'],['LICENSES.chromium.html','CHROMIUM-LICENSES.html']]){
    const license=path.join(electronDist,source);if(!fs.existsSync(license))throw Error('Install the pinned Electron distribution, including its license notices, before packaging.');
    fs.copyFileSync(license,path.join(stage,destination));
  }
  fs.copyFileSync(path.join(desktop,'MACOS-INTERNAL-README.txt'),path.join(stage,'PORTABLE-README.txt'));
  // Packager writes appVersion into package.json. Keep that numeric runtime
  // version separate from the complete preview release identity.
  const appPackage={name:pkg.name,productName:'Codex HUD',version:bundleVersion,codexHudReleaseVersion:releaseVersion,description:'Codex HUD macOS internal desktop preview',author:pkg.author,license:pkg.license,main:pkg.main};
  // Forge requires an Electron build dependency to select its exact runtime.
  // It exists only in staging metadata and is removed by afterCopy.
  fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({...appPackage,devDependencies:{electron:pkg.devDependencies.electron}},null,2)+'\n');
  const manifest=files(stage).filter(file=>path.basename(file)!=='package.json'||path.dirname(file)!==stage).map(file=>({file:path.relative(stage,file).replaceAll('\\','/'),sha256:hash(file)}));
  assertSafeNames(manifest.map(row=>row.file));return{appPackage,manifest};
}
function plist(app,key){return execFileSync('/usr/libexec/PlistBuddy',['-c','Print :'+key,path.join(app,'Contents/Info.plist')],{encoding:'utf8'}).trim();}
async function createMacPackage(arch=process.arch){
  nativeTarget(arch);require('../../lib/runtime').assertSupportedNode('macOS packaging');
  const translated=spawnSync('/usr/sbin/sysctl',['-in','sysctl.proc_translated'],{encoding:'utf8'});if(translated.stdout?.trim()==='1')throw Error('Rosetta execution is not a native architecture gate.');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),build=path.join(desktop,'out/macos',`${pkg.version}-${arch}-${stamp}`),stage=path.join(build,'stage');
  const {appPackage,manifest}=stageMacApplication(stage),icon=createMacIcon(path.join(build,'icon'));
  const {api,utils}=await import('@electron-forge/core');
  const config=createMacForgeConfig({icon,outDir:build});utils.registerForgeConfigForDirectory(stage,config);
  let made;try{made=await api.make({dir:stage,platform:'darwin',arch,outDir:build,interactive:false});}finally{utils.unregisterForgeConfigForDirectory(stage);}
  const app=path.join(build,`Codex HUD-darwin-${arch}`,'Codex HUD.app'),resources=path.join(app,'Contents/Resources'),appRoot=path.join(resources,'app');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(appRoot,'package.json'),'utf8')),appPackage);
  for(const row of manifest)assert.equal(hash(path.join(appRoot,row.file)),row.sha256,row.file);
  assertSafeNames(files(appRoot).map(file=>path.relative(appRoot,file)));
  assert.equal(plist(app,'CFBundleIdentifier'),bundleID);assert.equal(plist(app,'CFBundleExecutable'),'Codex HUD');
  assert.equal(plist(app,'CFBundleShortVersionString'),bundleVersion);assert.equal(plist(app,'CFBundleVersion'),bundleVersion);
  assert.equal(plist(app,'CodexHUDReleaseVersion'),releaseVersion);
  const executable=path.join(app,'Contents/MacOS/Codex HUD');
  const binaryArch=execFileSync('/usr/bin/lipo',['-archs',executable],{encoding:'utf8'}).trim();assert.equal(binaryArch,arch==='x64'?'x86_64':'arm64');
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
  for(const file of ['LICENSE','NOTICE.md','ELECTRON-LICENSE.txt','CHROMIUM-LICENSES.html','core/dist/gui/THIRD-PARTY-NOTICES.md'])assert.ok(fs.existsSync(path.join(appRoot,file)),file);
  const madeZip=made.flatMap(result=>result.artifacts).find(file=>file.endsWith('.zip'));assert.ok(madeZip,'Forge ZIP is missing');
  const zip=path.join(build,`codex-hud-desktop-${pkg.version}-macos-${arch}-internal.zip`);fs.copyFileSync(madeZip,zip);
  const zipEntries=execFileSync('/usr/bin/unzip',['-Z1',zip],{encoding:'utf8',maxBuffer:8*1024*1024}).trim().split('\n');assertSafeNames(zipEntries);assert.ok(zipEntries.every(name=>name.startsWith('Codex HUD.app/')));
  // Avoid the DMG maker's current vulnerable image parser; use Apple's native
  // disk-image utility after Forge has packaged and verified the application.
  const volume=path.join(build,'volume');fs.mkdirSync(volume);execFileSync('/usr/bin/ditto',[app,path.join(volume,'Codex HUD.app')]);fs.symlinkSync('/Applications',path.join(volume,'Applications'));
  fs.copyFileSync(path.join(desktop,'MACOS-INTERNAL-README.txt'),path.join(volume,'READ-ME-FIRST.txt'));
  const dmg=path.join(build,`codex-hud-desktop-${pkg.version}-macos-${arch}-internal.dmg`);
  execFileSync('/usr/bin/hdiutil',['create','-volname','Codex HUD Internal Preview','-srcfolder',volume,'-format','UDZO',dmg],{stdio:'pipe'});execFileSync('/usr/bin/hdiutil',['verify',dmg],{stdio:'pipe'});
  const artifacts=[zip,dmg].map(file=>({file,bytes:fs.statSync(file).size,sha256:hash(file)}));fs.writeFileSync(path.join(build,'SHA256SUMS'),artifacts.map(row=>row.sha256+'  '+path.basename(row.file)).join('\n')+'\n');
  const result={version:releaseVersion,bundleVersion,platform:'darwin',arch,app,executable,zip,dmg,artifacts,build,resources,sourceManifest:manifest,bundleID,minimumSystemVersion:plist(app,'LSMinimumSystemVersion'),signing:'ad-hoc internal signature verified; no Developer ID',notarization:'not requested',nativeRuntimeValidation:'pending separate test commands',forge:pkg.devDependencies['@electron-forge/core']};
  fs.writeFileSync(path.join(build,'artifact-index.json'),JSON.stringify({version:result.version,bundleVersion,platform:'darwin',arch,bundleID,minimumSystemVersion:result.minimumSystemVersion,signing:result.signing,notarization:result.notarization,nativeRuntimeValidation:result.nativeRuntimeValidation,artifacts:artifacts.map(({file,...row})=>({name:path.basename(file),...row})),sourceManifest:manifest},null,2)+'\n');
  fs.writeFileSync(path.join(build,'manifest.json'),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(desktop,`out/macos/latest-${arch}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));return result;
}
if(require.main===module)createMacPackage(process.argv[2]||process.arch).catch(error=>{console.error(error.message);process.exitCode=1});
module.exports={nativeTarget,stageMacApplication,createMacPackage};
