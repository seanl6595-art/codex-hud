'use strict';
const query=new URLSearchParams(location.search),code=query.get('code')||'STARTING';
const applicationName=query.get('platform')==='darwin'?'Codex HUD.app':'CodexHUD.exe';
let language=query.get('lang')==='zh-CN'?'zh-CN':'en';
const copy={
  opening:['Opening your dashboard…','正在打开用量概览…'],
  preparing:['Preparing your local history.','正在准备本地历史记录。'],
  privacy:['Your telemetry stays on this computer. Recorder starts only when you choose.','遥测数据仅保留在此电脑上。只有您主动选择后，才会开始记录。'],
  failed:['Codex HUD could not continue','Codex HUD 无法继续运行'],
  recovery:['Close this window and reopen Codex HUD to try again.','请关闭此窗口并重新打开 Codex HUD，然后重试。'],
  EADDRINUSE:['The selected local port is already in use. Reopen with automatic port selection.','所选本地端口已被占用。请使用自动分配端口重新打开。'],
  EACCES:['Windows could not open the local service. Check local network permissions and try again.','Windows 无法打开本地服务。请检查本地网络权限，然后重试。'],
  ASSETS_MISSING:['The application files are incomplete. Extract or reinstall the complete application package.','应用文件不完整。请完整解压或重新安装应用程序包。'],
  RUNTIME_UNSUPPORTED:['This application runtime does not support the required SQLite behavior. Use a verified desktop build.','此运行时不支持所需的 SQLite 行为。请使用已验证的桌面版本。'],
  BACKEND_START_FAILED:['The local service could not start. Your existing history has not been upgraded.','本地服务无法启动。未对现有历史记录执行升级。'],
  BACKEND_EXITED:['The local service stopped unexpectedly. Recording owned by this app has stopped.','本地服务意外停止。此应用负责的记录已停止。'],
  BACKEND_TIMEOUT:['The local service did not become ready in time.','本地服务未能及时就绪。'],
  GUI_WAIT_TIMEOUT:['Local history is taking longer than expected. This window will update when it is ready.','准备本地历史记录所需时间超出预期。就绪后此窗口将自动更新。'],
  GUI_LOAD_FAILED:['The dashboard could not load. Extract all application files and reopen it.','无法加载用量概览。请解压全部应用文件并重新打开。'],
  RENDERER_EXITED:['The dashboard stopped unexpectedly. The local service is shutting down.','用量概览意外停止。本地服务正在关闭。'],
  INVALID_ARGUMENTS:['A desktop launch option is invalid. Open '+applicationName+' directly to use the default settings.','桌面启动选项无效。请直接打开 '+applicationName+' 以使用默认设置。']
};
function render(){
  const text=key=>(copy[key]||copy.BACKEND_START_FAILED)[language==='zh-CN'?1:0];
  const failure=code!=='STARTING';
  document.documentElement.lang=language;document.body.classList.toggle('failed',failure);
  document.getElementById('heading').textContent=text(failure?'failed':'opening');
  document.getElementById('message').textContent=text(failure?code:'preparing');
  document.getElementById('privacy').textContent=text('privacy');
  document.getElementById('progress').hidden=failure;
  const recovery=document.getElementById('recovery');recovery.hidden=!failure;recovery.textContent=text('recovery');
  document.querySelectorAll('[data-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.language===language)));
}
document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>{language=button.dataset.language;render();}));
render();
