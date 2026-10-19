'use strict';
const SHELL_ORIGIN = 'codex-hud://shell';
const SHELL_FILES = new Set(['/index.html', '/style.css', '/shell.js', '/icon.svg']);
function shellResource(value) {
  try { const url=new URL(value); return url.protocol==='codex-hud:' && url.hostname==='shell' && !url.username && !url.password && !url.port && SHELL_FILES.has(url.pathname); } catch { return false; }
}
function localResource(value, origin) {
  try { const url=new URL(value); return !!origin && url.protocol==='http:' && url.hostname==='127.0.0.1' && !url.username && !url.password && url.origin===origin; } catch { return false; }
}
function allowedRequest(value, origin) { return shellResource(value) || localResource(value,origin); }
function allowedNavigation(value, origin) {
  if (localResource(value,origin)) { const url=new URL(value); return url.pathname==='/' && !url.search; }
  return shellResource(value) && new URL(value).pathname==='/index.html';
}
function trustedSender(event, contents, origin) {
  return event.sender===contents && event.senderFrame===contents.mainFrame && localResource(event.senderFrame?.url,origin);
}
function protectContents(contents, getOrigin, onBlocked=()=>{}) {
  contents.setWindowOpenHandler(()=>({action:'deny'}));
  for(const name of ['will-navigate','will-redirect','will-frame-navigate']) contents.on(name,(event,url)=>{
    const target=typeof url==='string'?url:event.url;
    if(!allowedNavigation(target,getOrigin())) {event.preventDefault();onBlocked('navigation');}
  });
  contents.on('will-attach-webview',event=>event.preventDefault());
}
function protectSession(session,getOrigin,onBlocked=()=>{}) {
  session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.setPermissionCheckHandler(()=>false);
  session.on('will-download',event=>event.preventDefault());
  session.webRequest.onBeforeRequest((details,callback)=>{
    const allowed=allowedRequest(details.url,getOrigin());
    if(!allowed)onBlocked('request');
    callback({cancel:!allowed});
  });
}
module.exports={SHELL_ORIGIN,SHELL_FILES,shellResource,localResource,allowedRequest,allowedNavigation,trustedSender,protectContents,protectSession};
