'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {desktopArguments,closeQuitsApplication,applicationMenu,createReopener}=require('../src/platform.cjs');
test('Finder arguments, macOS close semantics and native menu differ only on macOS',()=>{
  assert.deepEqual(desktopArguments(['App','-psn_0_42','--db','history.sqlite3'],true,'darwin'),['--db','history.sqlite3']);
  assert.deepEqual(desktopArguments(['App','-psn_0_42'],true,'win32'),['-psn_0_42']);
  assert.equal(closeQuitsApplication('darwin'),false);assert.equal(closeQuitsApplication('win32'),true);
  assert.equal(applicationMenu('win32'),null);assert.equal(applicationMenu('darwin')[0].role,'appMenu');
});
test('Dock reopen waits for owned backend drain and coalesces simultaneous activations',async()=>{
  let release,created=0,window=null,focused=0;
  const closed=new Promise(resolve=>release=resolve);
  const reopen=createReopener({isQuitting:()=>false,whenClosed:()=>closed,getWindow:()=>window,createWindow:async()=>{created++;window={isDestroyed:()=>false};},focus:()=>focused++});
  const a=reopen(),b=reopen();assert.equal(a,b);await Promise.resolve();assert.equal(created,0);release();await Promise.all([a,b]);assert.equal(created,1);await reopen();assert.equal(created,1);assert.equal(focused,1);
});
test('activation during quit cannot restart the backend',async()=>{
  let created=false;const reopen=createReopener({isQuitting:()=>true,whenClosed:()=>null,getWindow:()=>null,createWindow:async()=>{created=true;},focus:()=>{}});await reopen();assert.equal(created,false);
});
