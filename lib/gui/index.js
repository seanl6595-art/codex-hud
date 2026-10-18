'use strict';
const { spawn } = require('node:child_process');
const { startServer } = require('./server');
function openBrowser(url) {
  const spec = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(spec[0], spec[1], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => process.stderr.write('Open the printed local URL in your browser.\n')); child.unref();
}
async function runGui(options = {}) {
  const gui = await startServer(options);
  process.stdout.write('Codex HUD GUI: ' + gui.url + '\nLocal telemetry only. Ctrl+C stops the GUI and its recorder.\n');
  if (options.open !== false) openBrowser(gui.url);
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true;
    process.removeListener('SIGINT', close); process.removeListener('SIGTERM', close);
    await gui.close();
  };
  process.on('SIGINT', close); process.on('SIGTERM', close);
  return gui;
}
module.exports = { runGui, openBrowser };
