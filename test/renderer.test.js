'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { renderHud, renderBrowser, statusline } = require('../lib/renderer');
const { theme, displayWidth, sanitize } = require('../lib/theme');
const { BrowserState } = require('../lib/browser');
const { parseTelemetry } = require('../lib/telemetry');
const { projectRecord } = require('../lib/jsonl');
const { evaluateSubscription, snapshotFromRecord } = require('../lib/subscription');
const { NOW, meta, context, token, limit } = require('./helpers');
const view = { session: { name: '匿名会话 😀', project: 'Example' }, telemetry: parseTelemetry([meta(), context(), token()].map(projectRecord)),
  subscription: evaluateSubscription(snapshotFromRecord(projectRecord(token()), 'anonymous.jsonl', null, NOW), NOW) };
test('HUD has two columns, a 20-cell context bar and global subscription', () => {
  const text = renderHud(view, { columns: 90 });
  assert.match(text, /LAST REQUEST\s+│ SESSION/); assert.match(text, /SUBSCRIPTION/);
  assert.equal(displayWidth(theme().bar(10)), 20);
});
for (const columns of [4, 20, 40, 67, 78, 90, 120]) {
  test(`HUD and browser never overflow ${columns} columns including CJK/emoji/ANSI`, () => {
    const state = new BrowserState(); state.setSessions(Array.from({ length: 45 }, (_, i) => ({ id: String(i), file: String(i), name: '非常长的中文会话名称 👨‍👩‍👦', project: '中文项目', modelName: 'GPT-6.1 Sol', updatedAt: '2026-01-01T12:00:00Z' })));
    state.selected = 29;
    for (const text of [renderHud(view, { columns, rows: 25, color: true }), renderBrowser(state, { columns, rows: 25, color: true })]) {
      for (const line of text.split('\n')) assert.ok(displayWidth(line) <= columns, `${displayWidth(line)} > ${columns}`);
      assert.ok(text.split('\n').length <= 25);
    }
  });
}
test('ASCII/no-color output has ASCII frames and no ANSI escape sequences', () => {
  const text = renderHud({ ...view, session: { name: 'Anonymous', project: 'Example' } }, { ascii: true, color: false });
  assert.doesNotMatch(text, /[╭╮╯╰─│█░\x1b]/); assert.match(text, /\+----/);
});
test('statusline is one line and has global state and plan', () => {
  const text = statusline(view); assert.equal(text.split('\n').length, 1);
  assert.match(text, /5h ACTIVE/); assert.match(text, /Plan plus/);
});
test('untrusted session names cannot inject terminal controls', () => {
  const text = renderHud({ ...view, session: { name: '\x1b[2J\x1b]0;EVIL\x07\nInjected' } }, { color: false });
  assert.doesNotMatch(text, /\x1b|EVIL/); assert.equal(sanitize('\x03evil\r\n'), ' evil  ');
});
test('health thresholds and READY theme colors are stable', () => {
  const t = theme({ color: true }); assert.equal(t.severity(69), 'healthy');
  assert.equal(t.severity(70), 'warning'); assert.equal(t.severity(90), 'danger'); assert.match(t.paint('ready', 'READY'), /\x1b\[92m/);
});
test('short viewport keeps both allowance states visible', () => {
  const text = renderHud(view, { columns: 60, rows: 12 });
  assert.ok(text.split('\n').length <= 12); assert.match(text, /5h .*ACTIVE/); assert.match(text, /Week .*ACTIVE/);
});
test('long project names do not displace the plan from the header', () => {
  const text = renderHud({ ...view, session: { name: 'Very long session name '.repeat(10), project: 'Very long project name '.repeat(10) } }, { columns: 80 });
  assert.match(text.split('\n')[1], /Plan plus/);
});
