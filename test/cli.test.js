'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), { spawnSync } = require('node:child_process');
const { parseArgs } = require('../lib/cli');
const { fixture, meta, context, token } = require('./helpers');
const bin = path.resolve(__dirname, '../bin/codex-hud.js');
function cli(args) { return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', timeout: 10000 }); }
test('default is hud and Boolean options do not consume positional commands', () => {
  assert.equal(parseArgs([]).command, 'hud'); assert.equal(parseArgs(['--no-color', 'summary']).command, 'summary');
  assert.equal(parseArgs(['summary', '--recent=5']).flags.recent, '5');
});
test('invalid command/options/values are rejected with actionable errors', () => {
  for (const args of [['nonsense'], ['--file'], ['--recent', '-1'], ['--interval', 'NaN'], ['--other'], ['--no-color=true']]) assert.throws(() => parseArgs(args));
});
test('help, no-session browser, doctor and json work without Codex installed', t => {
  const f = fixture(t); assert.equal(cli(['help']).status, 0);
  for (const command of ['hud', 'doctor', 'summary', 'statusline']) {
    const out = cli([command, '--codex-home', f.home]); assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /No (Codex sessions|data source)/);
  }
  const json = JSON.parse(cli(['json', '--codex-home', f.home]).stdout);
  assert.equal(json.telemetry, null); assert.equal(json.subscription.fiveHour.state, 'UNKNOWN');
});
test('summary/statusline/json preserve noninteractive --file and --codex-home interfaces', t => {
  const f = fixture(t), file = f.write('sessions/anonymous-session.jsonl', [meta(), context(), token()]);
  const args = ['--file', file, '--codex-home', f.home, '--ascii', '--no-color'];
  const summary = cli(['summary', ...args]); assert.equal(summary.status, 0, summary.stderr); assert.match(summary.stdout, /LAST REQUEST/);
  const status = cli(['statusline', ...args]); assert.equal(status.stdout.trim().split('\n').length, 1); assert.doesNotMatch(status.stdout, /\x1b/);
  const json = JSON.parse(cli(['json', ...args]).stdout); assert.equal(json.telemetry.lastRequest.freshInputTokens, 200);
  assert.equal(json.subscription.plan, 'plus'); assert.ok(!('rateLimits' in json.telemetry));
});
test('missing explicit file fails rather than silently switching session', t => {
  const f = fixture(t), out = cli(['json', '--file', path.join(f.home, 'missing'), '--codex-home', f.home]);
  assert.equal(out.status, 1); assert.match(out.stderr, /Cannot read selected file/);
});
