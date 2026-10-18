'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const { getHistoricalUsageStats, renderHistoricalUsageStats, resolvePeriod, parseLocalDateTime } = require('../lib/stats');
const { openDatabase, openReadOnlyDatabase } = require('../lib/recorder-db');
const { Recorder } = require('../lib/recorder');
const { fixture, meta, context, token, usage, record } = require('./helpers');
const bin = path.resolve(__dirname, '../bin/codex-hud.js');
const FROM = '2026-01-01T12:00:00.000Z', TO = '2026-01-01T13:00:00.000Z';
const BEFORE = '2026-01-01T11:59:00.000Z', INSIDE = '2026-01-01T12:30:00.000Z';
const columns = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens'];
function setup(t) {
  let cleanup;
  const f = fixture({ after: fn => { cleanup = fn; } }), dbPath = path.join(f.home, 'telemetry.sqlite3');
  const db = openDatabase(dbPath); db.close();
  t.after(() => cleanup());
  function insert({ id = 'a', seq, at = INSIDE, current = [0, 0, 0, 0], last = current, model = 'gpt-6.1-sol', effort = 'high', turn = 'turn-1' }) {
    const writer = openDatabase(dbPath);
    try {
      writer.prepare(`INSERT OR IGNORE INTO sources (session_id,current_path,checkpoint_byte_offset,last_event_seq,
        anchor_start_offset,anchor_end_offset,anchor_sha256,last_seen_file_size,updated_at) VALUES (?, ?, 0, 0, 0, 0, ?, 0, ?)`).run(id, 'synthetic-only', 'synthetic-hash', FROM);
      writer.prepare(`INSERT INTO telemetry_events (session_id,event_seq,event_timestamp,model,reasoning_effort,turn_id,
        ${columns.flatMap(c => [c, `cumulative_${c}`]).join(',')}) VALUES (${Array(14).fill('?').join(',')})`)
        .run(id, seq, at, model, effort, turn, ...columns.flatMap((_, i) => [last[i] ?? null, current[i] ?? null]));
    } finally { writer.close(); }
  }
  const stats = (options = {}) => getHistoricalUsageStats({ from: FROM, to: TO, timezone: 'UTC', home: f.home, dbPath, ...options });
  return { ...f, dbPath, insert, stats };
}
const cli = (args, env = {}) => spawnSync(process.execPath, [bin, 'stats', ...args], { encoding: 'utf8', timeout: 10000, env: { ...process.env, ...env } });
function snapshot(dbPath) {
  const db = openReadOnlyDatabase(dbPath);
  try {
    return JSON.stringify({ schema: db.prepare('SELECT name,type,sql FROM sqlite_schema ORDER BY name').all(),
      meta: db.prepare('SELECT * FROM recorder_meta ORDER BY key').all(), sources: db.prepare('SELECT * FROM sources ORDER BY session_id').all(),
      events: db.prepare('SELECT * FROM telemetry_events ORDER BY session_id,event_seq').all(),
      features: db.prepare('SELECT * FROM event_features_v1 ORDER BY session_id,event_seq').all() });
  } finally { db.close(); }
}

test('stats 1: normal cumulative growth accounts the difference, not last snapshots', t => {
  const f = setup(t); f.insert({ seq: 1, at: BEFORE, current: [100, 50, 10, 5] });
  f.insert({ seq: 2, current: [160, 80, 30, 10], last: [999, 999, 999, 999] });
  const s = f.stats(); assert.equal(s.totals.input.value, 60); assert.equal(s.totals.cached.value, 30);
  assert.equal(s.totals.output.value, 20); assert.equal(s.totals.reasoning.value, 5);
});
test('stats 2: duplicate usage snapshots add zero workload and no Usage Event', t => {
  const f = setup(t); f.insert({ seq: 1, at: BEFORE, current: [160, 80, 20, 10] });
  f.insert({ seq: 2, current: [160, 80, 20, 10], last: [60, 30, 10, 5] });
  const s = f.stats(); assert.equal(s.totals.input.value, 0); assert.equal(s.totals.input.complete, true);
  assert.equal(s.activity.usageEvents, 0); assert.equal(s.activity.sessions, 0);
});
test('stats 3: safe first observation C == L accounts C', t => {
  const f = setup(t); f.insert({ seq: 1, current: [80, 40, 10, 4] });
  const s = f.stats(); assert.equal(s.totals.input.value, 80); assert.equal(s.totals.input.complete, true);
});
test('stats 4: unsafe first observation C != L is indeterminate', t => {
  const f = setup(t); f.insert({ seq: 1, current: [500, 100, 10, 4], last: [80, 40, 10, 4] });
  const s = f.stats(); assert.equal(s.totals.input.value, null); assert.equal(s.totals.input.complete, false);
  assert.equal(s.totals.output.value, 10);
});
test('stats 5: recognized cumulative reset C < P and C == L accounts C', t => {
  const f = setup(t); f.insert({ seq: 1, at: BEFORE, current: [1000, 800, 100, 40] });
  f.insert({ seq: 2, current: [120, 80, 20, 8] });
  const s = f.stats(); assert.equal(s.totals.input.value, 120); assert.equal(s.activity.usageEvents, 1);
});
test('stats 6: an ambiguous primary reset cannot certify other positive-predecessor deltas', t => {
  const f = setup(t); f.insert({ seq: 1, at: BEFORE, current: [1000, 800, 100, 40] });
  f.insert({ seq: 2, current: [500, 900, 110, 45], last: [120, 80, 10, 5] });
  const s = f.stats(); assert.equal(s.totals.input.value, null); assert.equal(s.totals.cached.value, null);
  assert.equal(s.totals.output.value, null); assert.equal(s.activity.usageEvents, 0);
  for (const key of ['cached', 'output', 'reasoning']) assert.equal(s.totals[key].incompleteReasons.ambiguous_reset, 1);
});
test('stats 7: actual Recorder task/model/effort/turn boundaries do not reset cumulative adjacency', async t => {
  const f = setup(t), medium = context('turn-2', 'gpt-6-luna'); medium.payload.effort = 'medium';
  f.write('sessions/a.jsonl', [meta('a'), context(), token({ total_token_usage: usage(100, 50, 10, 5), last_token_usage: usage(100, 50, 10, 5) }, null, Date.parse(BEFORE)),
    record('event_msg', { type: 'task_started', turn_id: 'turn-2' }), medium,
    token({ total_token_usage: usage(160, 80, 30, 10), last_token_usage: usage(60, 30, 20, 5) }, null, Date.parse(INSIDE))]);
  const recorder = new Recorder({ home: f.home, dbPath: f.dbPath });
  try { assert.deepEqual((await recorder.scan()).errors, []); } finally { recorder.close(); }
  assert.equal(f.stats().totals.input.value, 60);
});
test('stats 8: canonical sessions with overlapping ordinals never mix', t => {
  const f = setup(t); f.insert({ id: 'a', seq: 1, at: BEFORE, current: [100, 50, 10, 5] });
  f.insert({ id: 'b', seq: 1, at: BEFORE, current: [1000, 500, 10, 5] });
  f.insert({ id: 'a', seq: 2, current: [160, 80, 20, 10] }); f.insert({ id: 'b', seq: 2, current: [1020, 510, 20, 10] });
  const s = f.stats(); assert.equal(s.totals.input.value, 80); assert.equal(s.activity.sessions, 2);
  assert.deepEqual(s.sessions.map(x => [x.sessionId, x.input.value]), [['a', 60], ['b', 20]]);
});
test('stats 9: exact half-open boundary includes from and excludes to', t => {
  const f = setup(t); f.insert({ seq: 1, at: FROM, current: [10, 5, 2, 1] });
  f.insert({ seq: 2, at: TO, current: [30, 10, 4, 2] });
  const s = f.stats(); assert.equal(s.totals.input.value, 10); assert.equal(s.activity.usageEvents, 1);
});
test('stats 10: pre-from predecessor is used but contributes no activity or totals itself', t => {
  const f = setup(t); f.insert({ seq: 1, at: BEFORE, current: [100, 50, 10, 5] });
  f.insert({ seq: 2, current: [105, 53, 12, 6] }); f.insert({ id: 'outside-only', seq: 1, at: BEFORE, current: [999, 500, 10, 5] });
  const s = f.stats(); assert.equal(s.totals.input.value, 5); assert.equal(s.activity.usageEvents, 1); assert.equal(s.activity.sessions, 1);
});
test('stats 11 MANDATORY: full-sequence adjacency must precede period filtering', t => {
  const f = setup(t); f.insert({ seq: 1, at: BEFORE, current: [1000, 800, 100, 40] });
  // C == L would let a time-filter-first implementation incorrectly account 1010.
  f.insert({ seq: 2, current: [1010, 805, 110, 45], last: [1010, 805, 110, 45] });
  const s = f.stats(); assert.equal(s.totals.input.value, 10); assert.equal(s.totals.cached.value, 5);
  assert.equal(s.totals.fresh.value, 5); assert.equal(s.activity.usageEvents, 1);
});
test('stats 12: full workload delta belongs to current timestamp with no fractional split', t => {
  const f = setup(t); f.insert({ seq: 1, at: '2025-12-01T00:00:00.000Z', current: [100, 50, 10, 5] });
  f.insert({ seq: 2, at: FROM, current: [200, 100, 20, 10] }); assert.equal(f.stats().totals.input.value, 100);
});
test('stats 13: all-NULL observation counts no Usage Event and marks metrics incomplete', t => {
  const f = setup(t); f.insert({ seq: 1, current: [null, null, null, null] });
  const s = f.stats(); assert.equal(s.activity.usageEvents, 0); assert.equal(s.activity.sessions, 0);
  for (const value of Object.values(s.totals)) { assert.equal(value.value, null); assert.equal(value.complete, false); }
});
test('stats 14: partial missing metrics preserve valid Input and Output deltas', t => {
  const f = setup(t); f.insert({ seq: 1, current: [100, null, 20, null] });
  const s = f.stats(); assert.equal(s.totals.input.value, 100); assert.equal(s.totals.output.value, 20);
  assert.equal(s.totals.cached.value, null); assert.equal(s.totals.fresh.value, null); assert.equal(s.activity.usageEvents, 1);
});
test('stats 15: Fresh subtracts accounted deltas and rejects cached delta above input delta', t => {
  const f = setup(t); f.insert({ seq: 1, at: BEFORE, current: [1000, 900, 10, 5] });
  f.insert({ seq: 2, current: [1100, 980, 20, 10] }); assert.equal(f.stats().totals.fresh.value, 20);
  f.insert({ seq: 3, current: [1200, 1100, 30, 15] }); const s = f.stats();
  assert.equal(s.totals.fresh.value, 20); assert.equal(s.totals.fresh.complete, false); assert.equal(s.totals.cached.value, 200);
});
test('stats 16: cached/fresh ratios use a matched cohort; incomplete cohorts withhold percentages', t => {
  const f = setup(t); f.insert({ seq: 1, current: [100, 80, 20, 10] });
  f.insert({ seq: 2, current: [300, null, 40, 20] });
  const s = f.stats(), ratio = s.ratios.cachedPercent;
  assert.equal(s.totals.input.value, 300); assert.equal(ratio.cohort.input, 100); assert.equal(ratio.cohort.cached, 80);
  assert.equal(ratio.cohort.observations, 1); assert.equal(ratio.value, null); assert.equal(ratio.complete, false);
  assert.equal(s.ratios.freshPercent.cohort.fresh, 20); assert.equal(s.ratios.freshPercent.value, null);
});
test('stats 17: partial sums preserve completeness and renderer labels incomplete totals', t => {
  const f = setup(t); f.insert({ seq: 1, current: [100, 80, 20, 10] });
  f.insert({ seq: 2, current: [null, null, 30, 15] }); const s = f.stats();
  assert.equal(s.totals.input.value, 100); assert.equal(s.totals.input.complete, false);
  assert.match(renderHistoricalUsageStats(s), /Total\s+100 \(incomplete\)/);
  assert.match(renderHistoricalUsageStats(s), /N\/A \/ incomplete/); assert.equal(s.sessions[0].inputShare.value, null);
});
test('stats 18: Usage Events require positive valid Input OR Output, not Recorder row counts', t => {
  const f = setup(t); f.insert({ seq: 1, current: [0, 0, 0, 0] }); // Zero.
  f.insert({ seq: 2, current: [0, 0, 0, 0] }); // Duplicate.
  f.insert({ seq: 3, current: [10, 0, 0, 0] }); // Input only.
  f.insert({ seq: 4, current: [null, null, 5, 2] }); // Input invalid; Output positive.
  f.insert({ seq: 5, current: [null, null, null, null] });
  f.insert({ id: 'input-only', seq: 1, current: [10, null, null, null] });
  const s = f.stats(); assert.equal(s.activity.usageEvents, 3); assert.equal(s.coverage.observations, 6);
});
test('stats 19: only sessions with at least one period Usage Event count once', t => {
  const f = setup(t); f.insert({ id: 'zero', seq: 1 }); f.insert({ id: 'unknown', seq: 1, current: [null, null, null, null] });
  f.insert({ id: 'active', seq: 1, current: [10, 0, 5, 2] }); f.insert({ id: 'active', seq: 2, current: [20, 0, 10, 4] });
  const s = f.stats(); assert.equal(s.activity.sessions, 1); assert.equal(s.activity.usageEvents, 2);
  assert.deepEqual(s.sessions.map(x => x.sessionId), ['active']);
});
test('stats 20: current rename metadata changes display only, even when names match', t => {
  const f = setup(t); f.insert({ id: 'root', seq: 1, current: [100, 50, 20, 10] });
  f.insert({ id: 'child', seq: 1, current: [50, 25, 10, 5] });
  f.write('session_index.jsonl', [{ id: 'root', thread_name: 'Same current name' }, { id: 'child', thread_name: 'Same current name' }]);
  const first = f.stats(); assert.equal(first.activity.sessions, 2); assert.equal(first.totals.input.value, 150);
  f.write('session_index.jsonl', [{ id: 'root', thread_name: 'New name' }, { id: 'child', thread_name: 'Same current name' }]);
  const second = f.stats(); assert.deepEqual(first.totals, second.totals);
  assert.equal(second.sessions.find(s => s.sessionId === 'root').displayName, 'New name');
  assert.equal(second.sessions.find(s => s.sessionId === 'root').input.value, 100);
});
test('stats 21: Stats leaves all Recorder tables, checkpoints and view semantics unchanged', t => {
  const f = setup(t); f.insert({ seq: 1, current: [100, 50, 10, 5] }); const before = snapshot(f.dbPath);
  f.stats(); renderHistoricalUsageStats(f.stats());
  assert.equal(snapshot(f.dbPath), before);
  const reader = openReadOnlyDatabase(f.dbPath);
  try { assert.throws(() => reader.exec('DELETE FROM telemetry_events'), /readonly|read-only/i); } finally { reader.close(); }
});
test('stats 22: Stats reads committed history while a real Recorder transaction is pending, then writer commits', { timeout: 10000 }, async t => {
  const f = setup(t), file = f.write('sessions/a.jsonl', [meta('a'), context(), token({ total_token_usage: usage(100, 50, 10, 5), last_token_usage: usage(100, 50, 10, 5) }, null, Date.parse(INSIDE))]);
  const recorder = new Recorder({ home: f.home, dbPath: f.dbPath });
  try { assert.deepEqual((await recorder.scan()).errors, []); } finally { recorder.close(); }
  fs.appendFileSync(file, JSON.stringify(token({ total_token_usage: usage(160, 80, 30, 10), last_token_usage: usage(60, 30, 20, 5) }, null, Date.parse(INSIDE))) + '\n');
  const script = `const {Recorder}=require(${JSON.stringify(path.resolve(__dirname, '../lib/recorder'))});
    (async()=>{const r=new Recorder({home:process.argv[1],dbPath:process.argv[2],beforeCommit:()=>new Promise(resolve=>{process.once('message',resolve);process.send('pending');})});
    const result=await r.scan();r.close();process.send({status:'committed',errors:result.errors});process.disconnect();})().catch(()=>process.exit(1));`;
  const child = spawn(process.execPath, ['-e', script, f.home, f.dbPath], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  assert.equal((await once(child, 'message'))[0], 'pending');
  assert.equal(f.stats().totals.input.value, 100); // Never reads the writer's uncommitted row.
  const committed = once(child, 'message'); const exited = once(child, 'exit'); child.send('commit');
  assert.deepEqual((await committed)[0], { status: 'committed', errors: [] }); assert.equal((await exited)[0], 0);
  assert.equal(f.stats().totals.input.value, 160);
  const db = openReadOnlyDatabase(f.dbPath);
  try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); } finally { db.close(); }
});
test('stats 23: default last 24h is a rolling duration, including across DST', t => {
  const f = setup(t), now = Date.parse('2026-03-08T20:00:00Z');
  const period = resolvePeriod({ now, timezone: 'America/Vancouver' });
  assert.equal(Date.parse(period.to) - Date.parse(period.from), 24 * 3600 * 1000);
  assert.equal(period.from, '2026-03-07T20:00:00.000Z'); assert.equal(period.label, 'Last 24 hours');
  assert.equal(getHistoricalUsageStats({ now, timezone: 'America/Vancouver', home: f.home, dbPath: f.dbPath }).period.label, 'Last 24 hours');
});
test('stats 24: explicit local datetime bounds become correct absolute instants and CLI uses local timezone', t => {
  const f = setup(t); f.insert({ seq: 1, at: '2026-01-01T20:00:00.000Z', current: [100, 50, 10, 5] });
  f.insert({ seq: 2, at: '2026-01-01T21:00:00.000Z', current: [200, 100, 20, 10] });
  assert.equal(parseLocalDateTime('2026-01-01 12:00', 'America/Vancouver'), '2026-01-01T20:00:00.000Z');
  assert.equal(parseLocalDateTime('2026-07-01T12:00:00.125', 'America/Vancouver'), '2026-07-01T19:00:00.125Z');
  const out = cli(['--from', '2026-01-01 12:00', '--to', '2026-01-01 13:00', '--db', f.dbPath, '--codex-home', f.home], { TZ: 'America/Vancouver' });
  assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /CODEX USAGE/); assert.match(out.stdout, /Custom period/);
  assert.match(out.stdout, /Total\s+100/); assert.match(out.stdout, /Usage Events\s+1/);
});
test('stats 25: invalid, incomplete and reversed ranges fail before DB access or creation', t => {
  const f = fixture(t), dbPath = path.join(f.home, 'missing.sqlite3');
  for (const args of [ ['--from', '2026-01-01 12:00'], ['--to', '2026-01-01 13:00'],
    ['--from', 'not-a-time', '--to', '2026-01-01 13:00'],
    ['--from', '2026-01-01 13:00', '--to', '2026-01-01 12:00'],
    ['--from', '2026-01-01 12:00', '--to', '2026-01-01 12:00'],
    ['--from', '2026-02-30 12:00', '--to', '2026-03-01 12:00'] ]) {
    const out = cli([...args, '--db', dbPath]); assert.equal(out.status, 1); assert.doesNotMatch(out.stderr, /database not found/i);
  }
  assert.equal(fs.existsSync(dbPath), false);
});
test('stats: empty period is a complete zero workload, with no fabricated zero-input percentages', t => {
  const f = setup(t), s = f.stats();
  for (const value of Object.values(s.totals)) { assert.equal(value.value, 0); assert.equal(value.complete, true); }
  assert.equal(s.activity.usageEvents, 0); assert.equal(s.ratios.cachedPercent.value, null);
});
test('stats: missing direct predecessor metric is never inherited from an earlier valid row', t => {
  const f = setup(t); f.insert({ seq: 1, at: BEFORE, current: [100, 50, 10, 5] });
  f.insert({ seq: 2, at: BEFORE, current: [null, 60, 20, 10] });
  f.insert({ seq: 3, current: [200, 70, 30, 15], last: [200, 70, 30, 15] });
  const s = f.stats(); assert.equal(s.totals.input.value, null); assert.equal(s.totals.cached.value, 10);
  assert.equal(s.totals.output.value, 10); assert.equal(s.activity.usageEvents, 1);
});
test('stats: allowance-only rows preserve sequence adjacency instead of skipping to a valid snapshot', t => {
  const f = setup(t); f.insert({ seq: 1, at: BEFORE, current: [100, 50, 10, 5] });
  f.insert({ seq: 2, at: BEFORE, current: [null, null, null, null] });
  f.insert({ seq: 3, current: [110, 55, 12, 6], last: [110, 55, 12, 6] });
  assert.equal(f.stats().totals.input.value, null);
});
test('stats: sequence order, not timestamp order, establishes each predecessor', t => {
  const f = setup(t); f.insert({ seq: 1, at: '2026-01-01T14:00:00.000Z', current: [100, 50, 10, 5] });
  f.insert({ seq: 2, at: INSIDE, current: [110, 55, 12, 6] }); assert.equal(f.stats().totals.input.value, 10);
});
test('stats: Recorder-invalid producer values remain NULL while valid metrics still account', async t => {
  const f = setup(t);
  f.write('sessions/a.jsonl', [meta('a'), token({ total_token_usage: { input_tokens: '100', cached_input_tokens: true, output_tokens: 20 },
    last_token_usage: { input_tokens: '100', cached_input_tokens: true, output_tokens: 20 } }, null, Date.parse(INSIDE))]);
  const recorder = new Recorder({ home: f.home, dbPath: f.dbPath });
  try { assert.deepEqual((await recorder.scan()).errors, []); } finally { recorder.close(); }
  const s = f.stats(); assert.equal(s.totals.input.value, null); assert.equal(s.totals.cached.value, null);
  assert.equal(s.totals.output.value, 20); assert.equal(s.activity.usageEvents, 1);
});
test('stats: negative and nonfinite numeric facts are indeterminate rather than zero', t => {
  const f = setup(t); f.insert({ seq: 1, current: [-1, -2, Infinity, null] });
  const s = f.stats(); for (const value of Object.values(s.totals)) { assert.equal(value.value, null); assert.equal(value.complete, false); }
});
test('stats: complete matched cohorts yield correct percentages and explicit Input share denominator', t => {
  const f = setup(t); f.insert({ id: 'a', seq: 1, current: [100, 80, 20, 10] });
  f.insert({ id: 'b', seq: 1, current: [300, 120, 50, 20] }); const s = f.stats();
  assert.equal(s.ratios.cachedPercent.value, 50); assert.equal(s.ratios.freshPercent.value, 50);
  assert.equal(s.ratios.cachedPercent.complete, true); assert.equal(s.sessions[0].inputShare.value, 75);
  assert.equal(s.sessions[0].inputShare.denominator, 'period accounted Input');
  assert.match(renderHistoricalUsageStats(s), /Input share denominator: period accounted Input = 400 tokens/);
});
test('stats: reasoning remains separate subset of Output, never added to Output', t => {
  const f = setup(t); f.insert({ seq: 1, current: [100, 50, 20, 8] }); const s = f.stats();
  assert.equal(s.totals.output.value, 20); assert.equal(s.totals.reasoning.value, 8);
  assert.match(renderHistoricalUsageStats(s), /OUTPUT\nTotal\s+20\nReasoning\s+8/);
});
test('stats: no Codex session logs are scanned; only optional current display index is read', t => {
  const f = setup(t); f.insert({ seq: 1, current: [100, 50, 20, 10] });
  f.write('sessions/unreadable-content.jsonl', ['THIS IS NOT JSONL']); f.write('archived_sessions/another.jsonl', ['ALSO INVALID']);
  assert.equal(f.stats().totals.input.value, 100);
});
test('stats: missing DB fails clearly without creating database, directory or schema', t => {
  const f = fixture(t), missing = path.join(f.home, 'not-created', 'telemetry.sqlite3');
  const out = cli(['--db', missing]); assert.equal(out.status, 1); assert.match(out.stderr, /Recorder database not found/);
  assert.equal(fs.existsSync(path.dirname(missing)), false);
});
test('stats: local DST gaps/folds and invalid calendars are rejected without guessed instants', () => {
  assert.throws(() => parseLocalDateTime('2026-03-08 02:30', 'America/Vancouver'), /does not exist/);
  assert.throws(() => parseLocalDateTime('2025-11-02 01:30', 'America/Vancouver'), /ambiguous/);
  for (const value of ['2026-02-29 12:00', '2026-01-01 24:00', '2026-01-01 12:60', '2026-01-01T12:00Z', 'yesterday']) {
    assert.throws(() => parseLocalDateTime(value, 'America/Vancouver'));
  }
});
test('stats: unknown timestamps remain predecessors and unassignable workload is visibly incomplete', t => {
  const f = setup(t); f.insert({ seq: 1, at: null, current: [100, 50, 20, 10] });
  f.insert({ seq: 2, current: [110, 55, 22, 11] }); const s = f.stats();
  assert.equal(s.totals.input.value, 10); assert.equal(s.totals.input.complete, false);
  assert.equal(s.coverage.invalidTimestampObservations, 1); assert.equal(s.activity.usageEvents, 1);
  assert.match(renderHistoricalUsageStats(s), /unknown timestamps/);
});
test('stats: renderer sanitizes current names and CLI Stats does not change default HUD command', t => {
  const f = setup(t); f.insert({ seq: 1, current: [100, 50, 20, 10] });
  f.write('session_index.jsonl', [{ id: 'a', thread_name: '\u001b[31mInjected\nname' }]);
  const out = renderHistoricalUsageStats(f.stats()); assert.doesNotMatch(out, /\u001b/); assert.match(out, /Injected name/);
  const { parseArgs } = require('../lib/cli'); assert.equal(parseArgs([]).command, 'hud');
  assert.throws(() => parseArgs(['record', '--from', 'x', '--to', 'y'])); assert.throws(() => parseArgs(['stats', '--once']));
});


function reconcileBuckets(f, options) {
  const { buckets = 'hour', ...periodOptions } = options;
  const plain = f.stats(periodOptions), bucketed = f.stats({ ...periodOptions, buckets });
  assert.equal('buckets' in plain, false);
  assert.deepEqual(bucketed.totals, plain.totals);
  assert.deepEqual(bucketed.ratios, plain.ratios);
  assert.deepEqual(bucketed.sessions, plain.sessions);
  for (const key of Object.keys(plain.totals)) {
    const cells = bucketed.buckets.map(b => b.totals[key]);
    const valid = cells.reduce((n, m) => n + m.validObservations, 0);
    const invalid = cells.reduce((n, m) => n + m.indeterminateObservations, 0);
    assert.equal(valid, plain.totals[key].validObservations);
    assert.equal(invalid, plain.totals[key].indeterminateObservations);
    assert.equal(valid || !invalid ? cells.reduce((n, m) => n + (m.value ?? 0), 0) : null, plain.totals[key].value);
    assert.equal(cells.every(m => m.complete), plain.totals[key].complete);
  }
  assert.equal(bucketed.buckets.reduce((n, b) => n + b.observations, 0), plain.coverage.observations);
  assert.equal(bucketed.buckets.reduce((n, b) => n + b.activity.usageEvents, 0), plain.activity.usageEvents);
  return bucketed;
}
test('GUI buckets reconcile growth, duplicates, resets, gaps, missing metrics and half-open bounds', t => {
  const f = setup(t);
  f.insert({ seq: 1, at: BEFORE, current: [100, 50, 20, 8] });
  f.insert({ seq: 2, at: FROM, current: [120, 60, 24, 9] });
  f.insert({ seq: 3, at: INSIDE, current: [120, 60, 24, 9] });
  f.insert({ seq: 4, at: '2026-01-01T13:00:00Z', current: [10, 5, 2, 1] });
  f.insert({ seq: 6, at: '2026-01-01T14:00:00Z', current: [40, null, 8, null] });
  f.insert({ seq: 7, at: '2026-01-01T15:00:00Z', current: [50, 20, 10, 3] });
  f.insert({ seq: 8, at: '2026-01-01T16:00:00Z', current: [999, 500, 100, 30] });
  for (const buckets of ['hour', 'day']) reconcileBuckets(f, { from: FROM, to: '2026-01-01T16:00:00Z', buckets });
});
test('GUI buckets preserve unknown timestamp incompleteness and direct predecessor adjacency', t => {
  const f = setup(t);
  f.insert({ seq: 1, at: null, current: [100, 50, 20, 8] });
  f.insert({ seq: 2, current: [120, 60, 25, 10] });
  const s = reconcileBuckets(f, { from: FROM, to: '2026-01-02T12:00:00Z', buckets: 'hour' });
  assert.ok(s.buckets.every(b => !b.totals.input.complete));
  assert.equal(s.totals.input.value, 20);
});
test('GUI daily buckets follow local calendar dates across spring and fall DST', t => {
  for (const [from, to, expectedHours] of [
    ['2026-03-07T00:00', '2026-03-10T00:00', 71],
    ['2025-11-01T00:00', '2025-11-04T00:00', 73]
  ]) {
    const f = setup(t), timezone = 'America/Vancouver';
    const start = parseLocalDateTime(from, timezone), end = parseLocalDateTime(to, timezone);
    f.insert({ seq: 1, at: start, current: [10, 5, 2, 1] });
    f.insert({ seq: 2, at: new Date(Date.parse(end) - 1).toISOString(), current: [20, 10, 4, 2] });
    const s = reconcileBuckets(f, { from: start, to: end, timezone, buckets: 'day' });
    assert.equal(s.buckets.length, 3);
    assert.equal((Date.parse(end) - Date.parse(start)) / 3600000, expectedHours);
    assert.equal(s.buckets[0].key, from.slice(0, 10));
    const hourly = reconcileBuckets(f, { from: start, to: end, timezone, buckets: 'hour' });
    assert.equal(hourly.buckets.length, expectedHours);
    assert.equal(new Set(hourly.buckets.map(b => b.key)).size, expectedHours);
  }
});
test('GUI cells distinguish missing observations, observed zero and incomplete telemetry', t => {
  const f = setup(t);
  f.insert({ seq: 1, at: '2026-01-01T12:00:00Z', current: [0, 0, 0, 0] });
  f.insert({ seq: 2, at: '2026-01-01T14:00:00Z', current: [null, null, null, null] });
  const s = f.stats({ to: '2026-01-01T15:00:00Z', buckets: 'hour' });
  assert.deepEqual(s.buckets.map(b => b.state), ['zero', 'missing', 'incomplete']);
});
test('GUI 12-week heatmap includes exactly 84 local dates including today', () => {
  const { heatmapPeriod, createBuckets } = require('../lib/stats-buckets');
  for (const now of ['2026-03-10T18:00:00Z', '2026-03-10T07:00:00Z']) {
    const options = heatmapPeriod(Date.parse(now), 'America/Vancouver');
    const period = resolvePeriod(options);
    const cells = createBuckets(period, 'day', ['input'], () => ({}), () => {}, () => ({}), options.includeEndDate).finish();
    assert.equal(cells.length, 84); assert.equal(cells.at(-1).key, '2026-03-10');
  }
});
test('GUI buckets reject unsupported or oversized aggregation before creating a DB', t => {
  const f = fixture(t), dbPath = path.join(f.home, 'absent.sqlite3');
  assert.throws(() => getHistoricalUsageStats({ dbPath, buckets: 'minute' }), /hour or day/);
  assert.throws(() => getHistoricalUsageStats({ dbPath, buckets: 'hour', from: '2020-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }), /shorter range/);
  assert.equal(fs.existsSync(dbPath), false);
});
