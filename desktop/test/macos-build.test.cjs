'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {nativeTarget,stageMacApplication}=require('../scripts/package-macos.cjs');
const {createMacForgeConfig,bundleID,bundleVersion,releaseVersion}=require('../forge.macos.cjs');
test('Mac builds reject non-Mac and mismatched architecture hosts',()=>{
  assert.throws(()=>nativeTarget('arm64','win32','x64'),/native macOS/);assert.throws(()=>nativeTarget('x64','darwin','arm64'),/matching native/);assert.equal(nativeTarget('arm64','darwin','arm64'),'arm64');assert.equal(nativeTarget('x64','darwin','x64'),'x64');assert.throws(()=>nativeTarget('universal','darwin','arm64'));
});
test('Forge Mac target pins native identity, internal signing only, and no publisher',()=>{
  const config=createMacForgeConfig({icon:'/owned/icon.icns',outDir:'/owned/build'});
  assert.equal(config.packagerConfig.appBundleId,bundleID);assert.equal(config.packagerConfig.appVersion,'1.3.0');assert.equal(config.packagerConfig.executableName,'Codex HUD');assert.equal(config.packagerConfig.asar,false);assert.equal(config.packagerConfig.osxSign.identity,'-');assert.equal(config.packagerConfig.osxSign.identityValidation,false);assert.equal(config.packagerConfig.osxNotarize,undefined);assert.deepEqual(config.publishers,[]);assert.equal(config.makers[0].name,'@electron-forge/maker-zip');assert.equal(config.packagerConfig.prune,false);
  assert.equal(config.packagerConfig.buildVersion,bundleVersion);assert.equal(config.packagerConfig.extendInfo.CodexHUDReleaseVersion,releaseVersion);
});
test('Forge strips build-only metadata before application signing',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hud-mac-metadata-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'package.json');fs.writeFileSync(file,JSON.stringify({name:'test',devDependencies:{electron:'44.9.0'},config:{forge:'private-build-config'},scripts:{build:'test'}}));
  const config=createMacForgeConfig({icon:'/icon',outDir:root});await config.packagerConfig.afterCopy[0]({buildPath:root});assert.deepEqual(JSON.parse(fs.readFileSync(file)),{name:'test'});
});
test('Mac staged metadata survives the installed Packager version rewrite without losing preview identity',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hud-mac-stage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const licenses=path.join(root,'electron');fs.mkdirSync(licenses);fs.writeFileSync(path.join(licenses,'LICENSE'),'synthetic unit-test license');fs.writeFileSync(path.join(licenses,'LICENSES.chromium.html'),'synthetic unit-test notices');
  const stage=path.join(root,'stage');const {appPackage,manifest}=stageMacApplication(stage,licenses);
  assert.equal(appPackage.description,'Codex HUD macOS internal desktop preview');assert.ok(manifest.some(row=>row.file==='assets/icon-1024.png'));assert.ok(manifest.some(row=>row.file==='CHROMIUM-LICENSES.html'));assert.ok(!manifest.some(row=>/node_modules|\.ico$|test-results/.test(row.file)));assert.equal(fs.existsSync(path.join(stage,'forge.macos.cjs')),false);assert.equal(JSON.parse(fs.readFileSync(path.join(stage,'package.json'))).devDependencies.electron,'44.9.0');
  const config=createMacForgeConfig({icon:'/icon',outDir:root});
  await config.packagerConfig.afterCopy[0]({buildPath:stage});
  // Exercise Packager 20.3.0 itself, including a mismatched input that must be
  // rewritten, rather than duplicating its implementation in this test.
  const {App}=await import(require('node:url').pathToFileURL(path.join(path.dirname(require.resolve('@electron/packager')),'platform.js')).href);
  const packagedFile=path.join(stage,'package.json');
  fs.writeFileSync(packagedFile,JSON.stringify({...JSON.parse(fs.readFileSync(packagedFile)),version:'0.0.0'}));
  await App.prototype.writeAppVersion.call({opts:config.packagerConfig,originalResourcesAppDir:stage});
  assert.deepEqual(JSON.parse(fs.readFileSync(packagedFile)),appPackage);
  assert.equal(appPackage.version,'1.3.0');assert.equal(appPackage.version,bundleVersion);
  assert.equal(appPackage.codexHudReleaseVersion,'1.3.0-desktop.1');assert.equal(appPackage.codexHudReleaseVersion,require('../package.json').version);
  assert.equal(config.packagerConfig.extendInfo.CodexHUDReleaseVersion,appPackage.codexHudReleaseVersion);
});
