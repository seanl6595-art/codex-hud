'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {windowOptions,preferences,parseOptions,writeJSON,readJSON}=require('../src/settings.cjs');
const primary={workArea:{x:0,y:0,width:1920,height:1040}},secondary={workArea:{x:-1280,y:0,width:1280,height:720}};
test('window placement fits small displays and recovers from a disconnected monitor',()=>{
  const small=windowOptions(null,[secondary],secondary);assert.equal(small.width,1280);assert.equal(small.height,720);assert.equal(small.x,-1280);
  const restored=windowOptions({x:4000,y:100,width:1440,height:900,maximized:true},[primary],primary);assert.equal(restored.x,240);assert.equal(restored.maximized,true);
  const moved=windowOptions({x:-1200,y:50,width:1200,height:800},[primary,secondary],primary);assert.equal(moved.x,-1200);assert.equal(moved.y,0);assert.equal(moved.height,720);
  for(const invalid of [{x:NaN}, {x:Infinity,y:0,width:1,height:2},{x:0,y:0,width:-1,height:200}])assert.equal(windowOptions(invalid,[primary],primary).width,1440);
});
test('only enumerated UI preferences persist; invalid profile files are recoverable',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-hud-desktop-settings-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const value=preferences({'codex-hud.language.v1':'zh-CN','codex-hud.chart-type.v1':'remote-script',token:'private',path:'private'});assert.deepEqual(value,{'codex-hud.language.v1':'zh-CN'});
  const file=path.join(dir,'settings.json');assert.equal(writeJSON(file,value),true);assert.deepEqual(readJSON(file),value);fs.writeFileSync(file,'{broken');assert.equal(readJSON(file),null);
});
test('advanced paths are explicit and invalid ports/options fail closed',()=>{
  assert.deepEqual(parseOptions([]),{port:0});assert.equal(parseOptions(['--port','50001']).port,50001);assert.ok(path.isAbsolute(parseOptions(['--db','test.sqlite3']).dbPath));
  for(const args of [['--port','-1'],['--port','0.5'],['--port','65536'],['--db'],['--unknown','x'],['--port','--db']])assert.throws(()=>parseOptions(args));
});
