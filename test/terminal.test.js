'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { Terminal } = require('../lib/terminal');
const { runInteractive } = require('../lib/app');
function terminalFixture() {
  const input = new PassThrough(), output = new PassThrough(), events = new EventEmitter();
  input.isTTY = true; input.isRaw = false; const rawCalls = [];
  input.setRawMode = value => { input.isRaw = value; rawCalls.push(value); };
  output.isTTY = true; output.columns = 90; output.rows = 32; let rendered = '';
  output.on('data', chunk => { rendered += chunk.toString(); });
  const terminal = new Terminal({ input, output, processEvents: events });
  return { input, output, events, terminal, rawCalls, rendered: () => rendered };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 15));
test('terminal cleanup restores raw mode, cursor, alternate screen and listeners exactly once', () => {
  const f = terminalFixture(); let cleanups = 0;
  f.terminal.start(() => {}, () => {}); f.terminal.addCleanup(() => cleanups++);
  f.terminal.cleanup(); f.terminal.cleanup();
  assert.deepEqual(f.rawCalls, [true, false]); assert.equal(cleanups, 1);
  assert.match(f.rendered(), /\x1b\[\?25h/); assert.match(f.rendered(), /\x1b\[\?1049l/);
  assert.equal(f.events.listenerCount('SIGINT'), 0); assert.equal(f.input.listenerCount('keypress'), 0);
  assert.equal(f.input.listenerCount('data'), 0);
  assert.equal(f.input.isPaused(), true);
});
test('previously raw input is restored to its original mode', () => {
  const f = terminalFixture(); f.input.isRaw = true; f.terminal.start(() => {}, () => {}); f.terminal.cleanup();
  assert.deepEqual(f.rawCalls, [true, true]);
});
test('a failed cleanup callback does not block terminal restoration', () => {
  const f = terminalFixture(); f.terminal.start(() => {}, () => {}); f.terminal.addCleanup(() => { throw new Error('failure'); });
  f.terminal.cleanup(); assert.equal(f.input.isRaw, false); assert.match(f.rendered(), /\x1b\[\?25h/);
});
test('keypress decoding handles split arrow escape sequence and Ctrl+C', async () => {
  const f = terminalFixture(), keys = []; f.terminal.start(key => keys.push(key), () => {});
  f.input.write('\x1b'); f.input.write('['); f.input.write('B'); f.input.write('\r'); f.input.write('\x03');
  await settle(); f.terminal.cleanup(); assert.deepEqual(keys, ['down', 'enter', 'ctrl+c']);
});
test('single Escape is decoded after the escape timeout', async () => {
  const f = terminalFixture(), keys = []; f.terminal.start(key => keys.push(key), () => {});
  f.input.write('\x1b'); await new Promise(resolve => setTimeout(resolve, 120));
  f.terminal.cleanup(); assert.deepEqual(keys, ['escape']);
});
test('app navigates Browser -> locked HUD -> Browser in one process', async () => {
  const f = terminalFixture(), selected = [];
  const source = { list: async () => ({ sessions: [{ id: 'a', file: 'a', name: 'Anonymous', modelName: 'GPT-6.1 Sol' }] }),
    view: async session => { selected.push(session.file); return { session }; } };
  const run = runInteractive({ source, terminal: f.terminal, options: {} });
  await settle(); f.input.write('\r'); await settle(); f.input.write('q'); await settle(); f.input.write('q');
  await run; assert.deepEqual(selected, ['a']); assert.match(f.rendered(), /SESSION BROWSER/);
  assert.match(f.rendered(), /LAST REQUEST/); assert.equal(f.input.isRaw, false);
});
test('late HUD refresh cannot redraw after returning to Browser', async () => {
  const f = terminalFixture(); let resolveView;
  const source = { list: async () => ({ sessions: [{ id: 'a', file: 'a', name: 'Anonymous' }] }),
    view: () => new Promise(resolve => { resolveView = resolve; }) };
  const run = runInteractive({ source, terminal: f.terminal, options: {} });
  await settle(); f.input.write('\r'); await settle(); f.input.write('q'); await settle();
  const marker = f.rendered().length;
  resolveView({ session: { name: 'SHOULD NOT RENDER' } }); await settle();
  assert.doesNotMatch(f.rendered().slice(marker), /SHOULD NOT RENDER|LAST REQUEST/);
  f.input.write('q'); await run;
});
test('SIGINT while data read is pending restores terminal and prevents subsequent draw', async () => {
  const f = terminalFixture(); let resolveList;
  const run = runInteractive({ source: { list: () => new Promise(resolve => { resolveList = resolve; }) }, terminal: f.terminal, options: {} });
  await settle(); f.events.emit('SIGINT'); assert.equal(f.input.isRaw, false);
  const length = f.rendered().length; resolveList({ sessions: [] }); await run;
  assert.equal(f.rendered().length, length);
});
test('read failure restores terminal before propagating error', async () => {
  const f = terminalFixture();
  await assert.rejects(runInteractive({ source: { list: async () => { throw new Error('read failed'); } }, terminal: f.terminal, options: {} }), /read failed/);
  assert.equal(f.input.isRaw, false); assert.match(f.rendered(), /\x1b\[\?25h/);
});
test('watch exits on Q directly and stops its refresh timer', async () => {
  const f = terminalFixture(); let calls = 0;
  const run = runInteractive({ source: { view: async session => { calls++; return { session }; } }, terminal: f.terminal,
    options: {}, initialSession: { file: 'a', name: 'Anonymous' }, watch: true, interval: 20 });
  await settle(); f.input.write('q'); await run; const stoppedCalls = calls;
  await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(calls, stoppedCalls);
});
test('stream errors stop the app and restore the terminal', async () => {
  const f = terminalFixture();
  const run = runInteractive({ source: { list: async () => ({ sessions: [] }) }, terminal: f.terminal, options: {} });
  const rejected = assert.rejects(run, /stream failed/);
  await settle(); f.output.emit('error', new Error('stream failed'));
  await rejected; assert.equal(f.input.isRaw, false); assert.equal(f.terminal.closed, true);
});
