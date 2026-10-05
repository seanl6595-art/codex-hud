'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { JsonlStore } = require('../lib/jsonl');
const { listSessions, readSessionIndex, projectName, normalizePath } = require('../lib/sessions');
const { filterSessions, BrowserState } = require('../lib/browser');
const { fixture, meta, context, token, NOW } = require('./helpers');
test('Windows normalized paths match exactly; same project basename elsewhere does not', () => {
  assert.equal(normalizePath('C:/Projects/Example/'), normalizePath('c:\\projects\\Example'));
  assert.equal(projectName('C:\\Projects\\Example\\'), 'Example');
  const rows = [{ cwd: 'C:\\Projects\\Example' }, { cwd: 'D:\\Other\\Example' }];
  assert.equal(filterSessions(rows, 'project', 'c:/projects/example').length, 1);
  assert.notEqual(normalizePath('/work/Example'), normalizePath('/work/example'));
});
test('session index prefers last official rename including timestamp-less entry', t => {
  const f = fixture(t); f.write('session_index.jsonl', [{ id: 'a', thread_name: 'Original', updated_at: '2026-01-01T12:00:00Z' },
    { id: 'a', thread_name: 'Renamed', updated_at: '2026-01-01T13:00:00Z' }, '{bad', { session_id: 'a', name: 'Final' }]);
  const index = readSessionIndex(f.home); assert.equal(index.get('a').name, 'Final');
});
test('active/archive discovery joins official names; canonical file beats auto-review', async t => {
  const f = fixture(t); f.write('session_index.jsonl', [{ id: 'a', thread_name: '正式重命名' }]);
  f.write('sessions/rollout-a.jsonl', [meta('a'), context(), token()]);
  f.write('archived_sessions/review.jsonl', [meta('a'), context('review', 'codex-auto-review')]);
  f.write('archived_sessions/rollout-b.jsonl', [meta('b'), context()]);
  const result = await listSessions(f.home, new JsonlStore());
  assert.equal(result.sessions.length, 2); assert.equal(result.sessions.find(s => s.id === 'a').name, '正式重命名');
  assert.match(result.sessions.find(s => s.id === 'a').file, /rollout-a/);
  assert.equal(result.sessions.find(s => s.id === 'b').archived, true);
});
test('recent/all/current project filters and arrow bounds', () => {
  const sessions = Array.from({ length: 40 }, (_, i) => ({ id: String(i), file: String(i), cwd: 'C:\\Projects\\Example' }));
  const state = new BrowserState({ recent: 5, cwd: 'c:/projects/example' }); state.setSessions(sessions);
  assert.equal(state.rows.length, 5); state.dispatch('up'); assert.equal(state.selected, 0);
  for (let i = 0; i < 10; i++) state.dispatch('down'); assert.equal(state.selected, 4);
  state.dispatch('a'); assert.equal(state.rows.length, 40); state.dispatch('p'); assert.equal(state.rows.length, 40);
  state.dispatch('n'); assert.equal(state.rows.length, 5);
});
test('Browser -> HUD -> Browser -> EXIT; Ctrl+C always exits', () => {
  const state = new BrowserState(); state.setSessions([{ id: 'a', file: 'a' }]);
  state.dispatch('enter'); assert.equal(state.mode, 'HUD'); state.dispatch('escape'); assert.equal(state.mode, 'BROWSER');
  state.dispatch('enter'); state.dispatch('q'); assert.equal(state.mode, 'BROWSER'); state.dispatch('q'); assert.equal(state.mode, 'EXIT');
  const second = new BrowserState(); second.dispatch('ctrl+c'); assert.equal(second.mode, 'EXIT');
});
test('selection is locked even if another session becomes newest during refresh', () => {
  const state = new BrowserState(); state.setSessions([{ id: 'a', file: 'a' }, { id: 'b', file: 'b' }]);
  state.dispatch('enter'); const lock = state.locked;
  state.setSessions([{ id: 'new', file: 'new' }, { id: 'b', file: 'b' }]);
  assert.equal(state.locked, lock); assert.equal(state.locked.file, 'a'); assert.equal(Object.isFrozen(lock), true);
});
test('browser refresh preserves highlighted file after sort changes', () => {
  const state = new BrowserState(); state.setSessions([{ file: 'a' }, { file: 'b' }]); state.dispatch('down');
  state.setSessions([{ file: 'b' }, { file: 'a' }]); assert.equal(state.selected, 0);
});
test('empty list cannot enter HUD', () => {
  const state = new BrowserState(); state.dispatch('enter'); assert.equal(state.mode, 'BROWSER');
});
test('incremental JSONL handles split UTF-8, partial append and no-final-newline records', async t => {
  const f = fixture(t), file = f.write('sessions/a.jsonl', [meta('a')]), store = new JsonlStore();
  const line = Buffer.from(JSON.stringify(context('测试')) + '\n'), split = line.indexOf(Buffer.from('测')) + 1;
  fs.appendFileSync(file, line.subarray(0, split)); const partial = await store.read(file);
  assert.equal(partial.records.length, 1); assert.equal(partial.pendingTail, true);
  fs.appendFileSync(file, line.subarray(split)); const full = await store.read(file);
  assert.equal(full.records[1].payload.turn_id, '测试');
  fs.appendFileSync(file, JSON.stringify(token())); assert.equal((await store.read(file)).records.length, 3);
  fs.appendFileSync(file, '\n'); assert.equal((await store.read(file)).records.length, 3);
});
test('truncation invalidates cached session; missing files report error', async t => {
  const f = fixture(t), file = f.write('sessions/a.jsonl', [meta('a'), context(), token()]), store = new JsonlStore();
  assert.equal((await store.read(file)).records.length, 3);
  fs.writeFileSync(file, JSON.stringify(meta('b')) + '\n'); assert.equal((await store.read(file)).records[0].payload.id, 'b');
  fs.unlinkSync(file); assert.equal((await store.read(file)).error, 'ENOENT');
});
