'use strict';
// Release validation only. All sources, databases and installs are disposable.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const archive = path.resolve(process.argv[2] || 'codex-hud-1.3.0-beta.1.tgz');
assert.ok(fs.statSync(archive).isFile(), 'Provide an actual npm archive.');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli && fs.existsSync(npmCli), 'Run through npm run test:package -- ARCHIVE.');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud package caf\u00e9-'));
assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
assert.ok(path.basename(root).startsWith('codex-hud package caf\u00e9-'));
const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', TZ: 'UTC' };
const home = path.join(root, 'synthetic home'), dbPath = path.join(root, 'synthetic data', 'usage.sqlite3');
const install = path.join(root, 'clean install');
const checks = [];
let child, exited, browser;
function run(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: install, env, windowsHide: true, encoding: 'utf8', timeout: 30000, ...options });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return result.stdout;
}
function writeHistory() {
  const stamp = hour => `2026-01-01T0${hour}:00:00.000Z`;
  const usage = (input, output) => ({ input_tokens: input, cached_input_tokens: input / 2,
    output_tokens: output, reasoning_output_tokens: output / 2, total_tokens: input + output });
  const measure = (hour, input, output, lastInput, lastOutput) => ({ type: 'event_msg', timestamp: stamp(hour),
    payload: { type: 'token_count', info: { total_token_usage: usage(input, output), last_token_usage: usage(lastInput, lastOutput) } } });
  const rows = [
    { type: 'session_meta', timestamp: stamp(0), payload: { id: 'rc-synthetic-session', cwd: path.join(root, 'example project') } },
    { type: 'turn_context', timestamp: stamp(0), payload: { turn_id: 'rc-synthetic-turn', model: 'rc-synthetic-model', effort: 'high' } },
    measure(1, 100, 20, 100, 20),
    { type: 'event_msg', timestamp: stamp(2), payload: { type: 'token_count', info: null,
      rate_limits: { primary: { used_percent: 10, window_minutes: 300, resets_at: 1767240000 } } } },
    measure(3, 150, 30, 50, 10)
  ];
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sessions', 'synthetic.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}
(async () => {
  try {
    fs.mkdirSync(install); const userConfig = path.join(root, 'user.npmrc'), globalConfig = path.join(root, 'global.npmrc');
    fs.writeFileSync(userConfig, ''); fs.writeFileSync(globalConfig, '');
    run(process.execPath, [npmCli, 'install', '--prefix', install, '--offline', '--omit=dev', '--ignore-scripts',
      '--no-audit', '--no-fund', '--cache', path.join(root, 'npm cache'), '--userconfig', userConfig,
      '--globalconfig', globalConfig, archive]);
    const packageRoot = path.join(install, 'node_modules', 'codex-hud');
    assert.equal(fs.lstatSync(packageRoot).isSymbolicLink(), false);
    assert.equal(fs.existsSync(path.join(packageRoot, 'node_modules')), false);
    const modules = fs.readdirSync(path.join(install, 'node_modules')).filter(name => !name.startsWith('.'));
    assert.deepEqual(modules, ['codex-hud']);
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    assert.equal(pkg.version, '1.3.0-beta.1'); assert.deepEqual(pkg.dependencies || {}, {});
    const notices = fs.readFileSync(path.join(packageRoot, 'dist/gui/THIRD-PARTY-NOTICES.md'), 'utf8');
    for (const name of ['react', 'react-dom', 'recharts', 'lucide-react', 'swr']) assert.ok(notices.includes(name), name);
    assert.ok(notices.includes('Permission is hereby granted'));
    const supplemental = fs.readFileSync(path.join(packageRoot, 'NOTICE.md'), 'utf8');
    assert.ok(supplemental.includes('Tailwind Labs, Inc.'));
    assert.ok(supplemental.includes('Formidable Labs.'));
    checks.push('bundled frontend dependency licenses and copyright notices included');
    const cli = path.join(packageRoot, 'bin', 'codex-hud.js');
    const call = args => run(process.execPath, [cli, ...args, '--codex-home', home]);
    assert.match(run(process.execPath, [cli, 'help']), /Usage: codex-hud/);
    checks.push('offline clean npm installation; no runtime dependencies; spaced/Unicode paths');
    writeHistory(); const sourceFile = path.join(home, 'sessions', 'synthetic.jsonl');
    const originalSource = fs.readFileSync(sourceFile);
    for (const command of ['summary', 'statusline', 'json', 'doctor']) {
      const output = call([command]); assert.ok(output.length > 0);
      if (command === 'doctor') assert.match(output, /codex-hud 1\.3\.0-beta\.1/);
      if (command === 'json') assert.equal(JSON.parse(output).telemetry.lastRequest.inputTokens, 50);
    }
    assert.equal(fs.existsSync(dbPath), false);
    const first = JSON.parse(call(['record', '--once', '--db', dbPath]));
    assert.equal(first.events, 3); assert.equal(first.inserted_events, 3);
    assert.equal(JSON.parse(call(['record', '--once', '--db', dbPath])).inserted_events, 0);
    const { openDatabase, openReadOnlyDatabase } = require(path.join(packageRoot, 'lib/recorder-db'));
    const { getHistoricalUsageStats } = require(path.join(packageRoot, 'lib/stats'));
    const query = () => getHistoricalUsageStats({ home, dbPath, from: '2026-01-01T00:00:00Z',
      to: '2026-01-01T04:00:00Z', timezone: 'UTC', buckets: 'hour', analytics: true });
    function snapshot() {
      const db = openReadOnlyDatabase(dbPath);
      try { return JSON.stringify(['sqlite_schema', 'recorder_meta', 'sources', 'telemetry_events'].map(table =>
        db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all())); } finally { db.close(); }
    }
    const statsArgs = ['stats', '--db', dbPath, '--from', '2026-01-01 00:00', '--to', '2026-01-01 04:00'];
    assert.match(call(statsArgs), /INPUT\s+Total\s+150/);
    let stats = query(); assert.equal(stats.totals.input.value, 150); assert.equal(stats.totals.output.value, 30);
    assert.equal(stats.coverage.allowanceOnlyObservations, 1); assert.equal(stats.totals.input.complete, true);
    assert.ok(stats.analytics.models.some(model => model.model === 'rc-synthetic-model'));
    checks.push('CLI summary/statusline/json/doctor; Recorder catch-up/idempotence; SQLite and Stats accounting');
    // Disposable equivalent of the v1 layout: no extension or ownership seals.
    const writer = openDatabase(dbPath);
    try { writer.exec("DROP TABLE event_provenance_v1; DELETE FROM recorder_meta WHERE key='event_provenance_version' OR key LIKE 'ownership_proof_%'"); }
    finally { writer.close(); }
    assert.equal(JSON.parse(call(['record', '--once', '--db', dbPath])).inserted_events, 0);
    let reader = openReadOnlyDatabase(dbPath);
    try { assert.equal(reader.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='event_provenance_v1'").get().n, 0); }
    finally { reader.close(); }
    const before = snapshot();
    assert.match(call([...statsArgs, '--verify-sources']), /INPUT\s+Total\s+150/); assert.equal(snapshot(), before);
    child = spawn(process.execPath, [cli, 'gui', '--no-open', '--port', '0', '--codex-home', home, '--db', dbPath],
      { cwd: install, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    exited = new Promise(resolve => child.once('exit', resolve));
    let stdout = '', stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Packaged GUI startup timed out: ' + stderr)), 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stdout.on('data', chunk => { stdout += chunk; const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); } });
    });
    const boot = await (await fetch(url + '/api/bootstrap')).json();
    assert.equal(boot.version, '1.3.0-beta.1'); assert.equal(boot.capabilities.modelAnalytics, true);
    const response = await fetch(url + '/api/stats?range=absolute&from=2026-01-01T00:00:00Z&to=2026-01-01T04:00:00Z&timezone=UTC',
      { headers: { 'x-codex-hud-token': boot.token } });
    assert.equal(response.status, 200); stats = await response.json();
    assert.equal(stats.totals.input.value, 150); assert.equal(stats.coverage.allowanceOnlyObservations, 1);
    const assets = fs.readdirSync(path.join(packageRoot, 'dist/gui/assets'));
    for (const asset of ['/', ...assets.map(asset => '/assets/' + asset)]) {
      const result = await fetch(url + asset); assert.equal(result.status, 200, asset); await result.arrayBuffer();
    }
    checks.push('packaged CLI GUI entrypoint; all compiled assets; real analytics API; read-only legacy database');
    if (process.env.CODEX_HUD_PACKAGE_BROWSER === '1') {
      // Playwright is a source-side test harness; the installed server has no dependencies.
      const { chromium } = require('@playwright/test');
      browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
      for (const mobile of [false, true]) {
        const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 1050 },
          isMobile: mobile, hasTouch: mobile, timezoneId: 'UTC', reducedMotion: 'reduce' });
        const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(url);
        if (mobile) await page.getByRole('button', { name: 'Toggle navigation' }).click();
        await page.getByRole('button', { name: 'Statistics', exact: true }).click();
        await page.getByRole('button', { name: 'Custom range', exact: true }).click();
        await page.getByLabel('Start date and time').fill('2026-01-01T00:00');
        await page.getByLabel('End date and time').fill('2026-01-01T04:00');
        await page.getByLabel('Timezone', { exact: true }).selectOption('UTC');
        await page.getByRole('button', { name: 'Apply range' }).click();
        await page.locator('.metric-input .token-value[data-exact-tokens="150"]').waitFor();
        await page.locator('.model-table tbody').getByText('rc-synthetic-model', { exact: true }).waitFor();
        assert.deepEqual(errors, []); await context.close();
      }
      await browser.close(); browser = null; checks.push('installed archive rendered in desktop and mobile Chrome');
    }
    assert.equal(snapshot(), before);
    child.kill(); await exited; child = null;
    if (process.platform === 'win32') {
      const shim = path.join(install, 'node_modules', '.bin', 'codex-hud.cmd');
      const script = path.join(root, 'shim-check.ps1');
      fs.writeFileSync(script, "param($Shim, $HomePath)\n& $Shim help\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n& $Shim doctor --codex-home $HomePath\nexit $LASTEXITCODE\n");
      for (const shell of ['powershell.exe', ...(process.env.CODEX_HUD_TEST_PWSH ? [process.env.CODEX_HUD_TEST_PWSH] : [])]) {
        assert.match(run(shell, ['-NoProfile', '-NonInteractive', '-File', script, '-Shim', shim, '-HomePath', home]), /codex-hud 1\.3\.0-beta\.1/);
      }
      checks.push('Windows PowerShell 5.1 command shim' + (process.env.CODEX_HUD_TEST_PWSH ? ' and PowerShell 7 command shim' : ''));
    }
    if (process.platform !== 'win32') {
      const shim = path.join(install, 'node_modules', '.bin', 'codex-hud');
      fs.accessSync(shim, fs.constants.X_OK);
      assert.match(run(shim, ['help']), /Usage: codex-hud/);
      assert.match(run(shim, ['doctor', '--codex-home', home]), /codex-hud 1\.3\.0-beta\.1/);
      checks.push('POSIX installed executable permissions, shebang and npm command link');
    }
    const upgrade = JSON.parse(call(['upgrade-provenance', '--db', dbPath]));
    assert.equal(upgrade.verified, 3); assert.equal(upgrade.conflictingSources, 0);
    assert.equal(query().totals.input.value, 150); assert.deepEqual(fs.readFileSync(sourceFile), originalSource);
    checks.push('existing v1 remains unupgraded until explicit synthetic provenance upgrade; source bytes unchanged');
    console.log(JSON.stringify({ version: pkg.version, node: process.version, platform: process.platform,
      checks, result: 'PASS', privateDataUsed: false, productionDatabaseTouched: false }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (child) { child.kill(); await exited; }
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('codex-hud package caf\u00e9-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
