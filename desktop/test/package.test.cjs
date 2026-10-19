'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assertSafeNames}=require('../scripts/package.cjs');
test('portable packaging rejects telemetry, credentials, caches, logs and redundant runtimes',()=>{
  assert.doesNotThrow(()=>assertSafeNames(['Codex HUD-win32-x64/CodexHUD.exe','resources/app/src/main.cjs','LICENSES.chromium.html','resources/app/core/dist/gui/assets/index.js']));
  for(const name of ['resources/app/auth.json','resources/app/sessions/history.jsonl','telemetry.sqlite3','data.sqlite3-wal','private.db','app.log','resources/app/node_modules/a/index.js','resources/app/test/private.js','runtime/node.exe','node.exe','resources/app/.codex/config.toml','resources/app/.env.production','signing.pfx','private.pem','resources/app/desktop-status.json'])assert.throws(()=>assertSafeNames([name]),undefined,name);
});
