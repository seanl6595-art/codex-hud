'use strict';
const {test,expect}=require('@playwright/test');
const {fixture,launch,ready,close,api,status,pids,until,pause,alive,cleanupProfiles,attachJSON}=require('./helpers.cjs');
let current;
test.skip(process.platform!=='darwin','Requires actual native macOS execution; Windows is not a compatibility pass.');
test.afterAll(()=>cleanupProfiles());
test.afterEach(async()=>{if(current){try{await close(current)}catch{await current.app.close()}current=null;}});
test('red close drains Recorder/backend; Dock activation reopens one fresh opt-in window',async({},info)=>{
  current=await launch(await fixture(info.outputPath('data')));await ready(current);
  expect(status(current).runtime.platform).toBe('darwin');expect(status(current).runtime.arch).toBe(process.arch);
  await api(current,'/api/recorder/start',{method:'POST'});expect((await(await api(current,'/api/recorder')).json()).running).toBe(true);
  const oldBackend=await current.app.evaluate(({app})=>app.getAppMetrics().find(m=>m.name==='Codex HUD backend').pid);
  await current.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await until(()=>current.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length===0));await until(()=>!alive(oldBackend));
  expect(await current.app.evaluate(({app})=>app.getAppMetrics().some(m=>m.name==='Codex HUD backend'))).toBe(false);
  // Native Electron process handles the actual event, but this is not a physical
  // Dock click or OS sleep/logoff test.
  await current.app.evaluate(({app})=>{app.emit('activate',{},false);app.emit('activate',{},false);});await ready(current);
  expect(await current.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(1);
  expect((await(await api(current,'/api/recorder')).json()).running).toBe(false);
  expect(await current.app.evaluate(({app})=>app.getAppMetrics().find(m=>m.name==='Codex HUD backend').pid)).not.toBe(oldBackend);
  await attachJSON(info,'mac-close-reopen',{oldBackend,status:status(current),physicalDockClick:false});
});
test('native App menu provides Quit and normal quit drains all owned processes',async({},info)=>{
  current=await launch(await fixture(info.outputPath('data'),'missing'));await ready(current,'missing');
  const menu=await current.app.evaluate(({Menu})=>Menu.getApplicationMenu().items.map(item=>({role:item.role,submenu:item.submenu?.items.map(child=>child.role)})));
  expect(menu.some(item=>item.submenu?.includes('quit'))).toBe(true);
  const stopped=await close(current);current=null;expect(stopped.remaining).toEqual([]);await attachJSON(info,'mac-app-quit',stopped);
});
