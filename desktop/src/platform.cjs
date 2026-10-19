'use strict';
function desktopArguments(argv,packaged,platform=process.platform){
  return argv.slice(packaged?1:2).filter(arg=>!/^--(?:inspect(?:-brk)?|remote-debugging-port)=/.test(arg)&&!(platform==='darwin'&&/^-psn_\d+_\d+$/.test(arg)));
}
const closeQuitsApplication=platform=>platform!=='darwin';
function applicationMenu(platform){
  if(platform!=='darwin')return null;
  return [{role:'appMenu'},{label:'File',submenu:[{role:'close'}]},{role:'editMenu'},{label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'}]},{role:'windowMenu'}];
}
// Dock activation and second-instance events may arrive during an asynchronous
// close. Share one reopen operation and wait for the old backend to drain first.
function createReopener({isQuitting,whenClosed,getWindow,createWindow,focus}){
  let pending;
  return function reopen(){
    if(pending)return pending;
    pending=(async()=>{await whenClosed();if(isQuitting())return;const window=getWindow();if(window&&!window.isDestroyed())focus(window);else await createWindow();})().finally(()=>{pending=null;});
    return pending;
  };
}
module.exports={desktopArguments,closeQuitsApplication,applicationMenu,createReopener};
