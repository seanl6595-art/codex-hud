'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { Recorder } = require('../lib/recorder');
const { fixture, record, meta, context, token, usage, limit, NOW } = require('./helpers');
const { EVENT_COLUMNS, SOURCE_COLUMNS } = require('../lib/recorder-db');
const bin = path.resolve(__dirname, '../bin/codex-hud.js');
const append = (file, records) => fs.appendFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
function setup(t, options = {}) {
  let cleanup;
  const f = fixture({ after: fn => { cleanup = fn; } }), dbPath = path.join(f.home, 'telemetry.sqlite3');
  const r = new Recorder({ home: f.home, dbPath, ...options });
  t.after(() => { try { r.close(); } finally { cleanup(); } });
  return { ...f, r, dbPath };
}
const rows = r => r.db.prepare('SELECT * FROM telemetry_events ORDER BY session_id,event_seq').all();
const features = r => r.db.prepare('SELECT * FROM event_features_v1 ORDER BY session_id,event_seq').all();
const source = r => r.db.prepare('SELECT * FROM sources ORDER BY session_id').get();
async function scan(r) { const result = await r.scan(); assert.deepEqual(result.errors, []); return result; }

test('recorder: unchanged scans insert zero and SQLite enforces persistent event identity', async t => {
  const f = setup(t); f.write('sessions/a.jsonl', [meta(), context(), token(), token()]);
  assert.equal((await scan(f.r)).inserted_events, 2);
  assert.equal((await scan(f.r)).inserted_events, 0); assert.equal(rows(f.r).length, 2);
  assert.throws(() => f.r.db.prepare('INSERT INTO telemetry_events(session_id,event_seq) VALUES (?,?)').run('anonymous-session', 1), /UNIQUE/);
  const events = rows(f.r); assert.equal(events[0].raw_event_sha256, events[1].raw_event_sha256);
  assert.deepEqual(events.map(e => e.event_seq), [1, 2]); // Hash equality does not dedup separate events.
});
test('recorder: active to archived move changes only recovery path', async t => {
  const f = setup(t), file = f.write('sessions/a.jsonl', [meta(), context(), token()]); await scan(f.r);
  const target = path.join(f.home, 'archived_sessions', 'renamed.jsonl'); fs.mkdirSync(path.dirname(target)); fs.renameSync(file, target);
  assert.equal((await scan(f.r)).inserted_events, 0); assert.equal(source(f.r).current_path, target);
  assert.equal(rows(f.r).length, 1); assert.ok(!('current_path' in rows(f.r)[0]));
});
test('recorder: compatible active/archive replicas choose longest complete history without oscillation', async t => {
  const f = setup(t), base = [meta(), context(), token()];
  f.write('sessions/a.jsonl', base); const other = f.write('archived_sessions/a.jsonl', [...base, token()]);
  assert.equal((await scan(f.r)).inserted_events, 2);
  assert.equal((await scan(f.r)).inserted_events, 0); assert.equal(source(f.r).current_path, other);
});
test('recorder: conflicting copies fail safely without replacing an existing session', async t => {
  const f = setup(t); f.write('sessions/a.jsonl', [meta(), context(), token()]); await scan(f.r);
  f.write('archived_sessions/a.jsonl', [meta(), context(), token({ last_token_usage: usage(900) })]);
  const result = await f.r.scan(); assert.equal(result.errors[0].code, 'CONFLICTING_SESSION_COPIES');
  assert.equal(rows(f.r)[0].input_tokens, 1000);
});
test('recorder: a large partial tail never replaces a replica with more complete events', async t => {
  const f = setup(t), base = [meta(), context(), token()];
  const unfinished = f.write('sessions/a.jsonl', base), complete = f.write('archived_sessions/a.jsonl', [...base, token()]);
  fs.appendFileSync(unfinished, '{"unfinished":"' + 'x'.repeat(5000));
  assert.equal((await scan(f.r)).inserted_events, 2); assert.equal(source(f.r).current_path, complete);
  assert.equal((await scan(f.r)).inserted_events, 0); assert.equal(rows(f.r).length, 2);
});
test('recorder: real process crash before commit rolls back events and checkpoint; restart catches up', async t => {
  const f = fixture(t), dbPath = path.join(f.home, 'telemetry.sqlite3');
  const file = f.write('sessions/a.jsonl', [meta(), context(), token()]);
  let r = new Recorder({ home: f.home, dbPath }); await scan(r); const cp = source(r); r.close();
  append(file, [token(), token()]);
  const script = `const {Recorder}=require(${JSON.stringify(path.resolve(__dirname, '../lib/recorder'))});
    new Recorder({home:process.argv[1],dbPath:process.argv[2],beforeCommit:()=>process.exit(79)}).scan();`;
  const child = spawnSync(process.execPath, ['-e', script, f.home, dbPath], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 79, child.stderr);
  r = new Recorder({ home: f.home, dbPath });
  try {
    assert.equal(rows(r).length, 1); assert.equal(source(r).checkpoint_byte_offset, cp.checkpoint_byte_offset);
    assert.equal((await scan(r)).inserted_events, 2); assert.equal(rows(r).length, 3);
    assert.equal((await scan(r)).inserted_events, 0);
  } finally { r.close(); }
});
test('recorder: partial final JSON and complete JSON without newline never advance checkpoint', async t => {
  const f = setup(t), file = f.write('sessions/a.jsonl', [meta(), context()]);
  const end = fs.statSync(file).size, bytes = Buffer.from(JSON.stringify(token()));
  fs.appendFileSync(file, bytes.subarray(0, 50));
  assert.equal((await scan(f.r)).inserted_events, 0); assert.equal(source(f.r).checkpoint_byte_offset, end);
  fs.appendFileSync(file, bytes.subarray(50));
  assert.equal((await scan(f.r)).inserted_events, 0); assert.equal(source(f.r).checkpoint_byte_offset, end);
  fs.appendFileSync(file, '\n'); assert.equal((await scan(f.r)).inserted_events, 1);
  assert.equal(source(f.r).checkpoint_byte_offset, fs.statSync(file).size);
});
test('recorder: truncation rebuilds session from byte zero and removes obsolete rows', async t => {
  const f = setup(t); f.write('sessions/a.jsonl', [meta(), context(), token(), token()]); await scan(f.r);
  f.write('sessions/a.jsonl', [meta(), token(null)]);
  const result = await scan(f.r); assert.equal(result.rebuilt_sources, 1); assert.equal(rows(f.r).length, 1);
  assert.equal(rows(f.r)[0].event_seq, 1); assert.equal(rows(f.r)[0].model, null);
});
test('recorder: earlier prefix mutation while file grows triggers full rebuild', async t => {
  const f = setup(t), file = f.write('sessions/a.jsonl', [meta(), context(), token()]); await scan(f.r);
  const bytes = fs.readFileSync(file, 'utf8').replace('gpt-6.1-sol', 'gpt-6-luna'); fs.writeFileSync(file, bytes); append(file, [token()]);
  const result = await scan(f.r); assert.equal(result.rebuilt_sources, 1);
  assert.deepEqual(rows(f.r).map(e => e.model), ['gpt-6-luna', 'gpt-6-luna']); assert.equal(rows(f.r).length, 2);
  const cp = source(f.r); assert.equal(cp.anchor_start_offset, 0); assert.equal(cp.anchor_end_offset, cp.checkpoint_byte_offset);
  assert.equal(cp.anchor_sha256, createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
});
test('recorder: failed rebuild transaction preserves original rows and checkpoint', async t => {
  const f = setup(t); f.write('sessions/a.jsonl', [meta(), context(), token(), token()]); await scan(f.r);
  const original = JSON.stringify(rows(f.r)), cp = JSON.stringify(source(f.r));
  f.write('sessions/a.jsonl', [meta(), token(null)]); f.r.beforeCommit = () => { throw new Error('synthetic crash'); };
  assert.equal((await f.r.scan()).errors.length, 1); assert.equal(JSON.stringify(rows(f.r)), original);
  assert.equal(JSON.stringify(source(f.r)), cp); f.r.beforeCommit = null;
  assert.equal((await scan(f.r)).rebuilt_sources, 1);
});
test('recorder: Sol to Luna mid-session preserves each event-time model, including before first context', async t => {
  const f = setup(t); f.write('sessions/a.jsonl', [meta(), token(), context(), token(), context('turn-2', 'gpt-6-luna'), token()]);
  await scan(f.r); assert.deepEqual(rows(f.r).map(e => e.model), [null, 'gpt-6.1-sol', 'gpt-6-luna']);
});
test('recorder: High to Medium mid-session preserves each event-time effort', async t => {
  const f = setup(t), medium = context('turn-2'); medium.payload.effort = 'medium';
  f.write('sessions/a.jsonl', [meta(), context(), token(), medium, token()]); await scan(f.r);
  assert.deepEqual(rows(f.r).map(e => e.reasoning_effort), ['high', 'medium']);
});
test('recorder: missing token fields and allowance-only events remain NULL without carrying usage forward', async t => {
  const f = setup(t); f.write('sessions/a.jsonl', [meta(), context(), token(), token({ last_token_usage: { input_tokens: 0 } }), token(null)]);
  await scan(f.r); const e = rows(f.r); assert.equal(e[1].input_tokens, 0);
  for (const key of ['cached_input_tokens', 'output_tokens', 'total_tokens', 'cumulative_input_tokens']) assert.equal(e[1][key], null);
  assert.equal(e[2].input_tokens, null); assert.equal(e[2].total_tokens, null);
});
test('recorder: fresh input and cache percent are derived; observed total is never synthesized', async t => {
  const f = setup(t); f.write('sessions/a.jsonl', [meta(), token({ last_token_usage: { input_tokens: 1000, cached_input_tokens: 800 } })]);
  await scan(f.r); const e = features(f.r)[0]; assert.equal(e.fresh_input_tokens, 200); assert.equal(e.cache_hit_percent, 80);
  assert.equal(e.total_tokens, null); assert.ok(!('fresh_input_tokens' in rows(f.r)[0]));
});
test('recorder: reasoning output derives visible output without adding reasoning to totals', async t => {
  const f = setup(t); f.write('sessions/a.jsonl', [meta(), token()]); await scan(f.r);
  assert.equal(features(f.r)[0].visible_output_tokens, 60); assert.equal(rows(f.r)[0].total_tokens, 1100);
});
test('recorder: invalid subsets persist observed values and produce NULL derived values', async t => {
  const f = setup(t); f.write('sessions/a.jsonl', [meta(), token({ last_token_usage: usage(100, 110, 10, 20) })]);
  await scan(f.r); const e = features(f.r)[0]; assert.equal(e.cached_input_tokens, 110); assert.equal(e.reasoning_output_tokens, 20);
  for (const key of ['fresh_input_tokens', 'cache_hit_percent', 'visible_output_tokens']) assert.equal(e[key], null);
});
test('recorder: zero or unknown denominators produce NULL percentages', async t => {
  const f = setup(t); f.write('sessions/a.jsonl', [meta(), token({ last_token_usage: usage(0, 0), model_context_window: 0 })]);
  await scan(f.r); const e = features(f.r)[0]; assert.equal(e.cache_hit_percent, null); assert.equal(e.context_percent, null);
});
test('recorder: primary/secondary swapped still map to canonical 5h/weekly by window_minutes', async t => {
  const f = setup(t), limits = limit();
  [limits.primary, limits.secondary] = [limits.secondary, limits.primary];
  f.write('sessions/a.jsonl', [meta(), token(undefined, limits)]); await scan(f.r); const e = features(f.r)[0];
  assert.equal(e.primary_window_minutes, 10080); assert.equal(e.secondary_window_minutes, 300);
  assert.equal(e.five_hour_used_percent, 10); assert.equal(e.weekly_used_percent, 53);
});
test('recorder: missing and ambiguous windows do not guess a canonical mapping', async t => {
  const f = setup(t), limits = limit(); limits.secondary.window_minutes = 300;
  f.write('sessions/a.jsonl', [meta(), token(undefined, limits), token(null, null)]); await scan(f.r);
  for (const e of features(f.r)) { assert.equal(e.five_hour_used_percent, null); assert.equal(e.weekly_used_percent, null); }
});
test('recorder: historical sessions retain their own old accounting snapshots independent of HUD selection', async t => {
  const f = setup(t); f.write('sessions/a.jsonl', [meta('a'), context(), token(undefined, limit(12), NOW - 10000)]);
  f.write('sessions/b.jsonl', [meta('b'), context('turn-b', 'gpt-6-luna'), token(undefined, limit(87), NOW)]);
  await scan(f.r); const before = JSON.stringify(features(f.r));
  const { DataSource } = require('../lib/data'), data = new DataSource(f.home), { sessions } = await data.list();
  for (const s of sessions) await data.view(s);
  assert.equal(JSON.stringify(features(f.r)), before); assert.deepEqual(features(f.r).map(e => e.five_hour_used_percent), [12, 87]);
});
test('recorder: prompt/response/reasoning/tool/file text is absent from every table and SQLite files', async t => {
  const f = setup(t), secret = 'SYNTHETIC_PRIVATE_SENTINEL_92841';
  const m = meta(); m.payload.base_instructions = secret;
  const c = context(); c.payload.instructions = secret;
  const tok = token(); tok.payload.info.secret = secret; tok.payload.rate_limits.secret = secret;
  f.write('sessions/a.jsonl', [m, c, record('event_msg', { type: 'user_message', message: secret }),
    record('response_item', { type: 'message', role: 'assistant', content: [{ text: secret }] }),
    record('response_item', { type: 'reasoning', text: secret }),
    record('response_item', { type: 'function_call_output', output: secret }),
    record('file_contents', { text: secret }), tok]);
  await scan(f.r); assert.equal(rows(f.r).length, 1);
  for (const table of ['recorder_meta', 'sources', 'telemetry_events', 'event_features_v1']) {
    assert.ok(!JSON.stringify(f.r.db.prepare(`SELECT * FROM ${table}`).all()).includes(secret));
  }
  const columns = table => f.r.db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  assert.deepEqual(columns('telemetry_events'), EVENT_COLUMNS); assert.deepEqual(columns('sources'), SOURCE_COLUMNS);
  assert.deepEqual(f.r.db.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table','view') ORDER BY name").all().map(r => r.name),
    ['event_features_v1', 'recorder_meta', 'sources', 'telemetry_events']);
  for (const name of fs.readdirSync(f.home).filter(n => n.startsWith('telemetry.sqlite3'))) {
    assert.ok(!fs.readFileSync(path.join(f.home, name)).includes(Buffer.from(secret)));
  }
});
test('recorder: restart/catch-up uses persisted as-of state on append-only Codex-shaped synthetic fixtures', async t => {
  const f = fixture(t), dbPath = path.join(f.home, 'telemetry.sqlite3');
  const file = f.write('sessions/2026/01/a.jsonl', [meta(), record('event_msg', { type: 'task_started', turn_id: 'turn-1', model_context_window: 20000 }), context(), token()]);
  let r = new Recorder({ home: f.home, dbPath }); await scan(r); r.close();
  // Metadata arrives while the recorder is stopped; a partial line straddles restart.
  const medium = context('turn-2', 'gpt-6-luna'); medium.payload.effort = 'medium';
  append(file, [medium]); const tail = JSON.stringify(token()); fs.appendFileSync(file, tail.slice(0, 40));
  r = new Recorder({ home: f.home, dbPath });
  try {
    assert.equal((await scan(r)).inserted_events, 0); fs.appendFileSync(file, tail.slice(40) + '\n');
    assert.equal((await scan(r)).inserted_events, 1); const e = rows(r)[1];
    assert.equal(e.model, 'gpt-6-luna'); assert.equal(e.reasoning_effort, 'medium'); assert.equal(e.turn_id, 'turn-2');
    assert.equal((await scan(r)).inserted_events, 0);
  } finally { r.close(); }
});
test('recorder: task_started context survives turn_context with no window; missing new-turn model stays NULL', async t => {
  const f = setup(t); f.write('sessions/a.jsonl', [meta(), record('event_msg', { type: 'task_started', turn_id: 't', model_context_window: 20000 }),
    context('t'), token({ last_token_usage: usage() }), record('event_msg', { type: 'task_started', turn_id: 'new' }), token(null)]);
  await scan(f.r); const e = features(f.r); assert.equal(e[0].context_window_tokens, 20000); assert.equal(e[0].context_percent, 5);
  assert.equal(e[1].model, null); assert.equal(e[1].reasoning_effort, null); assert.equal(e[1].context_window_tokens, null);
});
test('recorder: turn_aborted clears ended-turn metadata before later accounting events', async t => {
  const f = setup(t); f.write('sessions/a.jsonl', [meta(), context(), token(), record('event_msg', { type: 'turn_aborted' }), token(null)]);
  await scan(f.r); assert.equal(rows(f.r)[1].turn_id, null); assert.equal(rows(f.r)[1].model, null);
});
test('recorder: byte checkpoints handle CRLF and split UTF-8 without retaining message bodies', async t => {
  const f = setup(t), file = f.write('sessions/a.jsonl', []);
  const bytes = Buffer.from([meta(), context(), record('event_msg', { type: 'user_message', message: '匿名内容' }), token()].map(r => JSON.stringify(r)).join('\r\n') + '\r\n');
  const split = bytes.indexOf(Buffer.from('匿')) + 1; fs.writeFileSync(file, bytes.subarray(0, split)); await scan(f.r);
  fs.appendFileSync(file, bytes.subarray(split)); assert.equal((await scan(f.r)).inserted_events, 1);
  assert.equal(source(f.r).checkpoint_byte_offset, bytes.length);
  assert.equal(source(f.r).anchor_sha256, createHash('sha256').update(bytes).digest('hex'));
});
test('recorder: malformed complete line rolls back and errors never include source contents', async t => {
  const f = setup(t), file = f.write('sessions/a.jsonl', [meta(), token()]); await scan(f.r); const cp = source(f.r);
  fs.appendFileSync(file, '{SYNTHETIC_INVALID_BODY\n'); const result = await f.r.scan();
  assert.deepEqual(result.errors, [{ code: 'MALFORMED_COMPLETE_RECORD' }]); assert.equal(rows(f.r).length, 1);
  assert.equal(source(f.r).checkpoint_byte_offset, cp.checkpoint_byte_offset);
});
test('recorder: event timestamps sort globally with session/ordinal ties and no claimed cross-session causality', async t => {
  const f = setup(t); f.write('sessions/z.jsonl', [meta('z'), token(undefined, undefined, NOW), token(undefined, undefined, NOW - 1000)]);
  f.write('sessions/a.jsonl', [meta('a'), token(undefined, undefined, NOW)]); await scan(f.r);
  const events = f.r.db.prepare('SELECT session_id,event_seq FROM event_features_v1 ORDER BY event_timestamp,session_id,event_seq').all();
  assert.deepEqual(events.map(e => [e.session_id, e.event_seq]), [['z', 2], ['a', 1], ['z', 1]]);
});
test('recorder: appends beyond scan snapshot wait for next scan', async t => {
  const f = setup(t), file = f.write('sessions/a.jsonl', [meta(), context(), token()]);
  f.r.beforeCommit = () => append(file, [token()]);
  assert.equal((await scan(f.r)).inserted_events, 1); f.r.beforeCommit = null;
  assert.equal((await scan(f.r)).inserted_events, 1); assert.equal(rows(f.r).length, 2);
});
test('recorder: modern root/subagent IDs are independent; legacy session_id-only identity still works', async t => {
  const f = setup(t), root = meta('root'), child = meta('child');
  root.payload.session_id = 'root'; child.payload.session_id = 'root';
  f.write('sessions/root.jsonl', [root, token()]); f.write('sessions/child.jsonl', [child, token()]);
  f.write('archived_sessions/legacy.jsonl', [record('session_meta', { session_id: 'legacy' }), token()]);
  assert.equal((await scan(f.r)).scanned_sources, 3);
  assert.deepEqual(rows(f.r).map(e => e.session_id), ['child', 'legacy', 'root']);
  assert.equal((await scan(f.r)).inserted_events, 0);
});
test('recorder: record CLI is opt-in, one-shot reports counts, and a new process resumes idempotently', t => {
  const f = fixture(t), dbPath = path.join(f.home, 'telemetry.sqlite3'); f.write('sessions/a.jsonl', [meta(), context(), token()]);
  const args = [bin, 'record', '--once', '--codex-home', f.home, '--db', dbPath];
  const first = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 }); assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).inserted_events, 1);
  const second = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 }); assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).inserted_events, 0);
  const { parseArgs } = require('../lib/cli');
  for (const args of [['record', '--file', 'x'], ['record', '--current-project'], ['hud', '--db', 'x'], ['--once']]) assert.throws(() => parseArgs(args));
  assert.equal(parseArgs([]).command, 'hud');
});
