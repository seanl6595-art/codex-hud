'use strict';
const {app,BrowserWindow,WebContentsView,Menu,utilityProcess,session,protocol,ipcMain,screen,powerMonitor}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {preferences,readJSON,writeJSON,windowOptions,parseOptions}=require('./settings.cjs');
const {SHELL_FILES,shellResource,localResource,trustedSender,protectContents,protectSession}=require('./security.cjs');
const began=performance.now();
const coreRoot=app.isPackaged?path.join(app.getAppPath(),'core'):path.resolve(__dirname,'../..');
let options,argumentError;
try{
  // Electron removes most switches; Playwright's inspector switches may remain.
  const args=process.argv.slice(app.isPackaged?1:2).filter(arg=>!/^--(?:inspect(?:-brk)?|remote-debugging-port)=/.test(arg));
  options=parseOptions(args);
}catch(error){options={port:0};argumentError=error.message;}
const profile=options.userData||path.join(app.getPath('appData'),'Codex HUD');
app.setName('Codex HUD');app.setAppUserModelId('art.seanl6595.codex-hud.desktop');
app.setPath('userData',profile);app.setPath('sessionData',path.join(profile,'browser'));
app.setPath('crashDumps',path.join(profile,'crashes'));
// Desktop has no updater, crash uploader, or remote resources.
app.commandLine.appendSwitch('disable-background-networking');
protocol.registerSchemesAsPrivileged([{scheme:'codex-hud',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const preferencesFile=path.join(profile,'preferences.json'),stateFile=path.join(profile,'window-state.json');
let savedPreferences=preferences(readJSON(preferencesFile));
let win,overlay,backend,origin,heartbeat,startTimer,viewTimer,stateTimer,backendExited=true;
let quitting=false,failed=false,stopPromise;
const diagnostic={version:require('../package.json').version,events:[],blocked:{navigation:0,request:0}};
function mark(event,extra={}){
  // Deliberately excludes paths, ports, tokens, source names and telemetry values.
  diagnostic.events.push({event,ms:Math.round(performance.now()-began),...extra});
  diagnostic.events=diagnostic.events.slice(-60);
}
function flushDiagnostics(){writeJSON(path.join(profile,'desktop-status.json'),diagnostic);}
function saveWindow(){
  if(!win||win.isDestroyed())return;
  writeJSON(stateFile,{...win.getNormalBounds(),maximized:win.isMaximized()});
}
function rememberPreferences(value){
  const next=preferences(value);
  if(JSON.stringify(next)!==JSON.stringify(savedPreferences)){
    savedPreferences=next;writeJSON(preferencesFile,next);
  }
}
const post=message=>{if(backend&&!backendExited)backend.postMessage(message);};
function layoutOverlay(){if(win&&overlay&&!win.isDestroyed()){const {width,height}=win.getContentBounds();overlay.setBounds({x:0,y:0,width,height});}}
function removeOverlay(){
  if(!overlay)return;
  win.contentView.removeChildView(overlay);overlay.webContents.close();overlay=null;
}
async function shell(code='STARTING'){
  if(quitting||!win||win.isDestroyed())return;
  // Match the existing GUI's default, then follow its persisted language.
  const language=savedPreferences['codex-hud.language.v1']||'en';
  const query=new URLSearchParams({code,lang:language});
  const url='codex-hud://shell/index.html?'+query;
  // Give the primary window a real document immediately, even if backend startup
  // fails. Only overlay it while the primary renderer loads its initial GUI.
  if(!origin){
    await win.loadURL(url);
  }else{
   if(!overlay){
    overlay=new WebContentsView({webPreferences:{session:session.defaultSession,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,devTools:!app.isPackaged,spellcheck:false}});
    overlay.setBackgroundColor('#0c111b');
    protectContents(overlay.webContents,()=>null,kind=>diagnostic.blocked[kind]++);
    win.contentView.addChildView(overlay);layoutOverlay();
   }
   await overlay.webContents.loadURL(url);
  }
  if(!win.isVisible()){win.show();mark('window-visible');flushDiagnostics();}
}
async function showFailure(code){
  if(quitting)return;
  failed=true;clearTimeout(startTimer);clearTimeout(viewTimer);mark('error',{code});flushDiagnostics();
  await shell(code);
}
function stopBackend(reason){
  if(stopPromise)return stopPromise;
  clearInterval(heartbeat);clearTimeout(startTimer);clearTimeout(viewTimer);
  if(!backend||backendExited)return Promise.resolve();
  stopPromise=new Promise(resolve=>{
    const force=setTimeout(()=>{mark('forced-backend-stop');backend.kill();},15000);
    backend.once('exit',()=>{clearTimeout(force);resolve();});
    post({action:'stop',reason});
  });
  return stopPromise;
}
async function shutdown(reason='window-close'){
  if(quitting)return;
  quitting=true;clearTimeout(stateTimer);saveWindow();mark('shutdown-requested',{reason});flushDiagnostics();
  // Capture only the enumerated UI settings before stopping its server.
  if(win&&!win.isDestroyed()&&localResource(win.webContents.getURL(),origin)){
    try{const values=await Promise.race([win.webContents.executeJavaScript(`(()=>{const result={};for(const key of ${JSON.stringify(Object.keys(require('./settings.cjs').PREFERENCES))})result[key]=localStorage.getItem(key);return result})()`),new Promise(resolve=>setTimeout(()=>resolve(null),250))]);if(values)rememberPreferences(values);}catch{}
  }
  await stopBackend(reason);
  mark('shutdown-complete',{backendExited});flushDiagnostics();
  if(overlay)removeOverlay();
  app.quit();
}
async function startBackend(){
  const config={coreRoot,home:options.home,dbPath:options.dbPath,port:options.port};
  // In normal mode the backend resolves the exact existing default locations.
  const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;delete env.ELECTRON_RUN_AS_NODE;
  backendExited=false;
  backend=utilityProcess.fork(path.join(__dirname,'backend.cjs'),[],{env,stdio:'ignore',serviceName:'Codex HUD backend'});
  backend.on('spawn',()=>{mark('backend-spawned');post({action:'start',config});});
  backend.on('error',()=>void showFailure('BACKEND_START_FAILED'));
  backend.on('exit',code=>{
    backendExited=true;clearInterval(heartbeat);clearTimeout(startTimer);mark('backend-exit',{code});
    if(!quitting&&!failed)void showFailure('BACKEND_EXITED');
  });
  backend.on('message',async message=>{
    if(message.event==='runtime'){diagnostic.runtime=message.runtime;return;}
    if(message.event==='stopped'){mark('backend-stopped',{durationMs:Math.round(message.ms),reason:message.reason});return;}
    if(message.event==='failure'){void showFailure(message.code);return;}
    if(message.event==='ready'&&!quitting&&!failed){
      clearTimeout(startTimer);
      try{
        const url=new URL(message.url);
        if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||message.address!=='127.0.0.1')throw Error('Unexpected local address');
        const response=await fetch(url.origin+'/api/bootstrap',{signal:AbortSignal.timeout(5000)});
        const bootstrap=await response.json();
        if(!response.ok||bootstrap.apiVersion!==2)throw Error('Readiness failed');
        origin=url.origin;mark('backend-ready');await shell();
        viewTimer=setTimeout(()=>{mark('initial-view-delayed');void shell('GUI_WAIT_TIMEOUT');flushDiagnostics();},60000);
        await win.loadURL(origin);mark('gui-document-loaded');
      }catch{void showFailure('BACKEND_START_FAILED');void stopBackend('readiness-failed');}
    }
  });
  heartbeat=setInterval(()=>post({action:'heartbeat'}),500);
  startTimer=setTimeout(()=>{void showFailure('BACKEND_TIMEOUT');void stopBackend('startup-timeout');},20000);
}
app.on('before-quit',event=>{if(!quitting){event.preventDefault();void shutdown('app-quit');}});
app.on('second-instance',()=>{
  mark('second-instance');
  if(win&&!win.isDestroyed()){
    const focus=()=>{if(!win.isDestroyed()){win.show();win.moveTop();win.focus();}};
    if(win.isMinimized()){win.once('restore',()=>setImmediate(focus));win.restore();}else focus();
  }
});
if(!app.requestSingleInstanceLock())app.exit(0);
else app.whenReady().then(async()=>{
  fs.mkdirSync(profile,{recursive:true});
  Menu.setApplicationMenu(null);
  session.defaultSession.protocol.handle('codex-hud',request=>{
    if(!shellResource(request.url))return new Response('Not found',{status:404});
    const file=new URL(request.url).pathname;
    if(!SHELL_FILES.has(file))return new Response('Not found',{status:404});
    const local=file==='/icon.svg'?path.join(__dirname,'../assets/icon.svg'):path.join(__dirname,'../ui',file.slice(1));
    try{return new Response(fs.readFileSync(local),{headers:{'Content-Type':{'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'}[path.extname(local)],'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'Cache-Control':'no-store'}});}catch{return new Response('Unavailable',{status:404});}
  });
  protectSession(session.defaultSession,()=>origin,kind=>diagnostic.blocked[kind]++);
  const bounds=windowOptions(readJSON(stateFile),screen.getAllDisplays(),screen.getPrimaryDisplay());
  const {maximized,...geometry}=bounds;
  win=new BrowserWindow({...geometry,show:false,title:'Codex HUD',backgroundColor:'#0c111b',icon:path.join(__dirname,'../assets/codex-hud.ico'),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),additionalArguments:['--codex-hud-preferences='+encodeURIComponent(JSON.stringify(savedPreferences))],contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:!app.isPackaged,spellcheck:false}});
  if(maximized)win.maximize();
  protectContents(win.webContents,()=>origin,kind=>diagnostic.blocked[kind]++);
  win.webContents.on('render-process-gone',()=>{if(!quitting){void showFailure('RENDERER_EXITED');void stopBackend('renderer-exited');}});
  win.webContents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3&&!quitting){void showFailure('GUI_LOAD_FAILED');void stopBackend('gui-load-failed');}});
  ipcMain.on('codex-hud:ui',(event,message)=>{
    if(!trustedSender(event,win.webContents,origin)||!message||!['ready','preferences'].includes(message.kind))return;
    rememberPreferences(message.preferences);
    if(message.kind==='ready'&&!failed&&!quitting&&['data','missing','error'].includes(message.outcome)){
      clearTimeout(viewTimer);mark('dashboard-ready',{outcome:message.outcome});removeOverlay();flushDiagnostics();
    }
  });
  for(const event of ['move','resize','maximize','unmaximize'])win.on(event,()=>{layoutOverlay();clearTimeout(stateTimer);stateTimer=setTimeout(saveWindow,200);});
  win.on('close',event=>{if(!quitting){event.preventDefault();win.hide();void shutdown();}});
  win.on('query-session-end',()=>{saveWindow();mark('query-session-end');void shutdown('session-end');});
  win.on('session-end',()=>void shutdown('session-end'));
  screen.on('display-removed',()=>{const next=windowOptions({...win.getNormalBounds(),maximized:win.isMaximized()},screen.getAllDisplays(),screen.getPrimaryDisplay());if(!win.isMaximized())win.setBounds({x:next.x,y:next.y,width:next.width,height:next.height});});
  powerMonitor.on('suspend',()=>{saveWindow();post({action:'heartbeat'});mark('suspend');flushDiagnostics();});
  powerMonitor.on('resume',()=>{
    post({action:'heartbeat'});mark('resume');flushDiagnostics();
    // SWR's existing reconnect behavior refreshes reads; no recorder is started.
    if(!failed&&origin)void win.webContents.executeJavaScript("window.dispatchEvent(new Event('online'))").catch(()=>{});
  });
  await shell();
  if(argumentError){void showFailure('INVALID_ARGUMENTS');return;}
  await startBackend();
}).catch(()=>{
  mark('fatal-startup');flushDiagnostics();
  if(win&&!win.isDestroyed())void showFailure('BACKEND_START_FAILED');else app.exit(1);
});
