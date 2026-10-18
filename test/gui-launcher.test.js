'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../lib/gui/index.js'), 'utf8');
for (const [platform, executable, args] of [
  ['win32', 'rundll32.exe', ['url.dll,FileProtocolHandler', 'http://127.0.0.1:4317']],
  ['darwin', 'open', ['http://127.0.0.1:4317']],
  ['linux', 'xdg-open', ['http://127.0.0.1:4317']]
]) test('browser launcher uses argument arrays without a shell on ' + platform + ' (simulation)', () => {
  let invocation, unreferenced = false; const module = { exports: {} };
  const sandbox = { module, process: { platform, stderr: { write() {} } }, require(name) {
    if (name === './server') return { startServer() {} };
    assert.equal(name, 'node:child_process');
    return { spawn(executable, args, options) { invocation = { executable, args: Array.from(args), options };
      return { on(event) { assert.equal(event, 'error'); }, unref() { unreferenced = true; } }; } };
  } };
  vm.runInNewContext(source, sandbox);
  module.exports.openBrowser('http://127.0.0.1:4317');
  assert.equal(invocation.executable, executable); assert.deepEqual(invocation.args, args);
  assert.equal(invocation.options.shell, undefined); assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.detached, true); assert.equal(invocation.options.stdio, 'ignore');
  assert.equal(unreferenced, true);
});
