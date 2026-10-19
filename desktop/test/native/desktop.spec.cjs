'use strict';
const {test,expect}=require('@playwright/test'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http'),{spawn}=require('node:child_process');
const {fixture,launch,ready,close,api,status,shellPage,memory,pids,pause,until,alive,snapshot,capture,attachJSON,executable,repo,cleanupProfiles}=require('./helpers.cjs');
let current;
test.afterAll(()=>cleanupProfiles());
test.afterEach(async()=>{if(current){try{await close(current)}catch{try{await current.app.close()}catch{}}current=null;}});
test('first launch is sandboxed, reads history without changes, and closes cleanly',async({},info)=>{
  const f=await fixture(info.outputPath('data')),before=snapshot(f);current=await launch(f);const startup=await ready(current);
  const runtime=status(current).runtime;expect(runtime.electron).toBe(require('../../package.json').devDependencies.electron);expect(require('../../../lib/runtime').supportsNode(runtime.node)).toBe(true);expect(runtime.transactions).toBe(true);
  await expect(current.page.locator('.heatmap-grid button')).toHaveCount(84);await expect(current.page.locator('.session-item')).toHaveCount(0);
  const recorder=await(await api(current,'/api/recorder')).json();expect(recorder.running).toBe(false);expect(recorder.events).toBeGreaterThan(0);
  expect((await(await api(current,'/api/sessions')).json()).sessions).toHaveLength(6);
  const prefs=await current.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());expect(prefs.contextIsolation).toBe(true);expect(prefs.sandbox).toBe(true);expect(prefs.nodeIntegration).toBe(false);
  expect(await current.page.evaluate(()=>({require:typeof require,process:typeof process}))).toEqual({require:'undefined',process:'undefined'});
  const origin=new URL(current.page.url()).origin,token=(await(await fetch(origin+'/api/bootstrap')).json()).token;
  expect((await fetch(origin+'/api/recorder')).status).toBe(403);expect((await fetch(origin+'/api/recorder',{headers:{'x-codex-hud-token':token,Origin:'https://foreign.example'}})).status).toBe(403);
  const badHost=await new Promise(resolve=>http.get(origin+'/api/bootstrap',{headers:{Host:'foreign.example'}},r=>{r.resume();resolve(r.statusCode)}));expect(badHost).toBe(403);
  await capture(current,info.outputPath('desktop-en.png'));
  await current.page.getByRole('button',{name:'简体中文',exact:true}).click();await expect(current.page.locator('html')).toHaveAttribute('lang','zh-CN');await expect(current.page.getByRole('heading',{name:'用量概览',exact:true})).toBeVisible();await capture(current,info.outputPath('desktop-zh.png'));
  await current.page.getByRole('button',{name:'English',exact:true}).click();
  await current.page.getByRole('button',{name:'Statistics',exact:true}).click();await expect(current.page.locator('.metrics')).toBeVisible();
  for(const label of ['7 days','30 days','24 hours']){const start=performance.now();await current.page.getByRole('button',{name:label,exact:true}).click();await expect(current.page.locator('.metrics')).toBeVisible();expect(performance.now()-start).toBeLessThan(3000);}
  // Chromium reports a pending navigation to CDP even when Electron cancels it;
  // run this guard check after interactions so automation does not wait on it.
  await current.page.evaluate(()=>{const a=document.createElement('a');a.href='https://example.com';document.body.append(a);a.click();a.remove()});await pause(200);expect(current.page.url()).toBe(origin+'/');
  expect(await current.page.evaluate(()=>window.open('https://example.com')===null)).toBe(true);
  expect(await current.page.evaluate(async()=>{try{await fetch('https://example.com');return false}catch{return true}})).toBe(true);
  expect(current.errors).toEqual([]);const mem=await memory(current);const stopped=await close(current);current=null;
  expect(snapshot(f)).toEqual(before);expect(stopped.remaining).toEqual([]);await attachJSON(info,'startup-and-security',{startup,mem,stopped});
});
test('repeated launch restores/focuses one window and one backend',async({},info)=>{
  current=await launch(await fixture(info.outputPath('data'),'missing'));await ready(current,'missing');
  const backend=await current.app.evaluate(({app})=>app.getAppMetrics().find(m=>m.name==='Codex HUD backend').pid);
  await current.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());await until(()=>current.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized()),10000,'The native window did not minimize');
  const second=spawn(executable(),current.args,{env:current.env,cwd:path.dirname(executable()),windowsHide:true,stdio:'ignore'});expect(await new Promise(resolve=>second.on('exit',resolve))).toBe(0);
  await until(()=>current.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFocused()),10000,'The operating system did not grant focus after the second launch');
  expect(await current.app.evaluate(({app,BrowserWindow})=>({count:BrowserWindow.getAllWindows().length,minimized:BrowserWindow.getAllWindows()[0].isMinimized(),backend:app.getAppMetrics().find(m=>m.name==='Codex HUD backend').pid}))).toEqual({count:1,minimized:false,backend});
  await current.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize());await until(()=>current.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()));
  await current.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].unmaximize());
});
test('missing data stays opt-in; empty database renders without invented usage',async({},info)=>{
  const f=await fixture(info.outputPath('missing'),'missing');fs.rmSync(f.home,{recursive:true,force:true});current=await launch(f);await ready(current,'missing');
  expect((await api(current,'/api/stats')).status).toBe(404);expect((await(await api(current,'/api/sessions')).json()).sessions).toEqual([]);expect(fs.existsSync(f.dbPath)).toBe(false);expect(fs.existsSync(f.home)).toBe(false);await close(current);current=null;
  const empty=await fixture(info.outputPath('empty'),'empty'),before=snapshot(empty);current=await launch(empty);await ready(current);await expect(current.page.locator('.heatmap-grid .missing')).toHaveCount(84);expect(snapshot(empty)).toEqual(before);
});
test('occupied port shows a localized startup failure and automatic allocation recovers',async({},info)=>{
  const server=http.createServer((_q,r)=>r.end('unrelated'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  try{
    const f=await fixture(info.outputPath('data'),'missing');current=await launch(f,['--port',String(port)]);const shell=await shellPage(current);await expect(shell.locator('#message')).toContainText('already in use');await capture(current,info.outputPath('startup-error.png'));
    await shell.getByRole('button',{name:'简体中文',exact:true}).click();await expect(shell.locator('#message')).toContainText('已被占用');await close(current);current=null;
    expect(await(await fetch('http://127.0.0.1:'+port)).text()).toBe('unrelated');current=await launch(f);await ready(current,'missing');const selected=Number(new URL(current.page.url()).port);expect(selected).toBeGreaterThanOrEqual(49152);expect(selected).not.toBe(port);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('unexpected backend exit produces an error and no orphan workers',async({},info)=>{
  current=await launch(await fixture(info.outputPath('data')));await ready(current);const backend=await current.app.evaluate(({app})=>app.getAppMetrics().find(m=>m.name==='Codex HUD backend').pid);process.kill(backend,'SIGKILL');const shell=await shellPage(current);await expect(shell.locator('#message')).toContainText('stopped unexpectedly');expect(alive(backend)).toBe(false);
});
test('restart restores window bounds and language across changing ports',async({},info)=>{
  const f=await fixture(info.outputPath('data'));current=await launch(f);await ready(current);const port=new URL(current.page.url()).port;
  const expected=await current.app.evaluate(({BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows()[0],work=screen.getPrimaryDisplay().workArea;const bounds={x:work.x+20,y:work.y+20,width:Math.min(1180,work.width-20),height:Math.min(760,work.height-20)};w.setBounds(bounds);return w.getBounds();});
  await current.page.getByRole('button',{name:'简体中文',exact:true}).click();await expect(current.page.locator('html')).toHaveAttribute('lang','zh-CN');expect(await current.page.evaluate(()=>localStorage.getItem('codex-hud.language.v1'))).toBe('zh-CN');await close(current);current=null;
  expect(JSON.parse(fs.readFileSync(path.join(f.profile,'preferences.json'),'utf8'))['codex-hud.language.v1']).toBe('zh-CN');
  current=await launch(f);await ready(current);await expect(current.page.locator('html')).toHaveAttribute('lang','zh-CN');
  expect(await current.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds())).toEqual(expected);
  expect((await(await api(current,'/api/recorder')).json()).running).toBe(false);await attachJSON(info,'restored-window',{oldPort:port,newPort:new URL(current.page.url()).port,expected,status:status(current)});
});
test('GUI Recorder lifecycle never stops an unrelated CLI Recorder',async({},info)=>{
  const f=await fixture(info.outputPath('gui'),'missing'),other=await fixture(info.outputPath('external'),'missing');
  const external=spawn(process.execPath,[path.join(repo,'bin/codex-hud.js'),'record','--codex-home',other.home,'--db',other.dbPath,'--interval','1'],{windowsHide:true,stdio:'ignore'});
  try{
    await until(()=>fs.existsSync(other.dbPath));current=await launch(f);await ready(current,'missing');await current.page.getByRole('button',{name:'Open Recorder',exact:true}).click();await current.page.getByRole('button',{name:'Start recording',exact:true}).click();await expect(current.page.locator('.recorder-panel .status-badge')).toHaveText('Recording');await current.page.getByRole('button',{name:'Stop recording',exact:true}).click();await expect(current.page.locator('.recorder-panel .status-badge')).toHaveText('GUI recorder stopped');expect(alive(external.pid)).toBe(true);
    await current.page.getByRole('button',{name:'Start recording',exact:true}).click();await expect(current.page.locator('.recorder-panel .status-badge')).toHaveText('Recording');const stopped=await close(current);current=null;expect(alive(external.pid)).toBe(true);expect(stopped.remaining).toEqual([]);await attachJSON(info,'recorder-shutdown',stopped);
  }finally{external.kill();await new Promise(resolve=>external.once('exit',resolve));}
});
test('forced owner termination leaves no application-owned processes',async({},info)=>{
  current=await launch(await fixture(info.outputPath('data')));await ready(current);const owned=await pids(current),main=await current.app.evaluate(()=>process.pid),start=performance.now();process.kill(main,'SIGKILL');current=null;await until(()=>owned.every(pid=>!alive(pid)));await attachJSON(info,'forced-cleanup',{ms:performance.now()-start,remaining:owned.filter(alive)});
});
test('suspend/resume and session-end handlers preserve opt-in and drain the owner',async({},info)=>{
  current=await launch(await fixture(info.outputPath('data')));await ready(current);const before=await pids(current);
  await current.app.evaluate(({powerMonitor})=>powerMonitor.emit('suspend'));await pause(1200);await current.app.evaluate(({powerMonitor})=>powerMonitor.emit('resume'));await pause(1200);
  expect((await(await api(current,'/api/recorder')).json()).running).toBe(false);expect(status(current).events.some(e=>e.event==='resume')).toBe(true);
  const closed=current.app.waitForEvent('close');
  if(process.platform==='darwin')await current.app.evaluate(({powerMonitor})=>powerMonitor.emit('shutdown',{}));else await current.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].emit('query-session-end',{}));
  await closed;await until(()=>before.every(pid=>!alive(pid)));await attachJSON(info,'simulated-power-events',{actualOSSleep:false,actualOSLogout:false,status:status(current)});current=null;
});
