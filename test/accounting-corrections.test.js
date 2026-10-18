'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Recorder } = require('../lib/recorder');
const { openDatabase, openReadOnlyDatabase } = require('../lib/recorder-db');
const { upgradeProvenance } = require('../lib/provenance-upgrade');
const { getHistoricalUsageStats } = require('../lib/stats');
const { fixture, meta, context, token, usage, limit, record, NOW } = require('./helpers');
const keys = ['input', 'cached', 'fresh', 'output', 'reasoning'];
const measure = (values, last = values, time = NOW + 1000) => token({ total_token_usage: usage(...values), last_token_usage: usage(...last) }, limit(), time);
function edit(f, fn) { const db = openDatabase(f.dbPath); try { return fn(db); } finally { db.close(); } }
function snapshot(f) { const db = openReadOnlyDatabase(f.dbPath); try { return JSON.stringify(['sources', 'telemetry_events'].map(table => db.prepare('SELECT * FROM ' + table + ' ORDER BY 1,2').all())); } finally { db.close(); } }
async function setup(t, events, { legacy = false, records } = {}) {
  const f = fixture(t), dbPath = path.join(f.home, 'synthetic.sqlite3');
  const file = f.write('sessions/source.jsonl', records || [meta('review'), context(), ...events]);
  const r = new Recorder({ home: f.home, dbPath });
  try { assert.deepEqual((await r.scan()).errors, []); } finally { r.close(); }
  const result = { ...f, dbPath, file, stats: (options = {}) => getHistoricalUsageStats({ home: f.home, dbPath,
    from: new Date(NOW).toISOString(), to: new Date(NOW + 3600000).toISOString(), timezone: 'UTC', analytics: true, buckets: 'hour', ...options }) };
  if (legacy) edit(result, db => db.exec("DROP TABLE event_provenance_v1; DELETE FROM recorder_meta WHERE key='event_provenance_version'"));
  return result;
}
function complete(stats, values) { assert.deepEqual(keys.map(k => stats.totals[k].value), values); assert.ok(keys.every(k => stats.totals[k].complete)); }
function reconciles(s) { for (const groups of [s.buckets, s.analytics.models, s.analytics.efforts, s.analytics.cross]) {
  for (const key of keys) assert.equal(groups.reduce((sum, g) => sum + (g.totals[key].value || 0), 0), s.totals[key].value || 0);
} }

for (const legacy of [false, true]) test(`correction F1: coherent vector reset retains rising/equal subsets, legacy=${legacy}`, async t => {
  for (const next of [[20,15,4,3], [20,10,4,2], [20,15,20,3]]) {
    const f = await setup(t, [measure([100,10,10,2]), token(null), measure(next)], { legacy }), s = f.stats();
    complete(s, [100 + next[0], 10 + next[1], 90 + next[0] - next[1], 10 + next[2], 2 + next[3]]);
    reconciles(s); assert.equal(s.activity.usageEvents, 2); assert.equal(s.ratios.cachedPercent.available, true);
  }
});
test('resets: exact duplicates and monotonic C==L do not start a new epoch', async t => {
  const f = await setup(t, [measure([100,10,10,2]), measure([100,10,10,2]), measure([120,20,14,3])]);
  complete(f.stats(), [120,20,100,14,3]); assert.equal(f.stats().activity.usageEvents, 2);
});
test('resets: ambiguous primary decrease withholds incompatible positive-predecessor deltas', async t => {
  const f = await setup(t, [measure([100,10,10,2]), measure([20,15,14,3], [20,15,4,1])]); const s = f.stats();
  assert.equal(s.totals.input.value, 120); assert.equal(s.totals.input.complete, true);
  for (const key of ['cached', 'output', 'reasoning']) { assert.equal(s.totals[key].complete, false); assert.equal(s.totals[key].incompleteReasons.ambiguous_reset, 1); }
  assert.equal(s.totals.fresh.complete, false); reconciles(s);
});
test('resets: zero predecessors retain epoch-independent values in an ambiguous vector', async t => {
  const f = await setup(t, [measure([100,0,0,0]), measure([20,0,4,0], [10,0,4,0])]); const s = f.stats();
  assert.equal(s.totals.input.complete, false);
  for (const key of ['cached', 'output', 'reasoning']) assert.equal(s.totals[key].complete, true);
  assert.equal(s.totals.output.value, 4); assert.equal(s.totals.fresh.complete, false);
});
test('resets: missing fields and contradictory reported totals cannot authenticate a full restart', async t => {
  for (const change of [m => { delete m.payload.info.total_token_usage.reasoning_output_tokens; },
    m => { m.payload.info.last_token_usage.total_tokens = 999; },
    m => { m.payload.info.total_token_usage.total_tokens = m.payload.info.last_token_usage.total_tokens = 999; }]) {
    const m = measure([20,15,4,3]); change(m); const f = await setup(t, [measure([100,10,10,2]), m]);
    assert.equal(f.stats().totals.cached.complete, false); assert.equal(f.stats().totals.fresh.complete, false);
  }
});
test('resets: subset-only decreases never reset independently justified primary counters', async t => {
  const f = await setup(t, [measure([100,80,10,8]), measure([200,50,20,4])]); const s = f.stats();
  assert.equal(s.totals.input.value, 200); assert.equal(s.totals.output.value, 20);
  assert.equal(s.totals.input.complete, true); assert.equal(s.totals.output.complete, true);
  assert.equal(s.totals.cached.complete, false); assert.equal(s.totals.reasoning.complete, false); assert.equal(s.ratios.cachedPercent.available, false);
});
test('correction F2: invalid participating last Cached/Input withholds Fresh and ratio', async t => {
  const f = await setup(t, [measure([100,80,10,2]), measure([200,50,20,4], [10,50,10,2])]); const s = f.stats();
  assert.equal(s.totals.input.complete, true); assert.equal(s.totals.output.complete, true);
  assert.equal(s.totals.fresh.complete, false); assert.equal(s.totals.fresh.incompleteReasons.invalid_cache_subset, 1);
  assert.equal(s.ratios.cachedPercent.available, false); reconciles(s);
});
test('subsets: first baselines and decreased whole counters validate contributing last subsets', async t => {
  for (const prefix of [[], [measure([1000,800,1000,400])]]) {
    const f = await setup(t, [...prefix, measure([100,50,100,20], [10,50,10,20])]); const s = f.stats();
    assert.equal(s.totals.fresh.complete, false); assert.equal(s.totals.reasoning.complete, false);
    assert.equal(s.totals.fresh.incompleteReasons.invalid_cache_subset, 1); assert.equal(s.totals.reasoning.incompleteReasons.invalid_reasoning_subset, 1);
  }
});
test('subsets: unused contradictory last snapshots do not erase justified cumulative increments', async t => {
  const f = await setup(t, [measure([100,50,10,2]), measure([200,100,20,4], [1,50,1,3])]);
  complete(f.stats(), [200,100,100,20,4]);
});
test('subsets: a validated reset can recover from contradictory historical endpoints', async t => {
  const f = await setup(t, [measure([100,110,10,20], undefined, NOW - 1000), measure([20,15,4,3])]);
  complete(f.stats(), [20,15,5,4,3]);
});
test('correction F3: truncated suffix is neither complete nor persistable evidence', async t => {
  const f = await setup(t, [measure([100,50,10,2]), token(null), measure([20,10,4,1])], { legacy: true });
  edit(f, db => db.exec('DELETE FROM telemetry_events WHERE event_seq=1; UPDATE telemetry_events SET event_seq=event_seq-1; UPDATE sources SET last_event_seq=2'));
  assert.equal(f.stats().totals.input.complete, false); const before = snapshot(f), result = upgradeProvenance(f);
  assert.equal(result.verified, 0); assert.equal(result.unknown, 2); assert.equal(snapshot(f), before);
  fs.unlinkSync(f.file); assert.equal(f.stats().totals.input.complete, false);
});
for (const removed of [1, 2, 3, 'all']) test(`integrity: removed/renumbered numeric-only history cannot appear complete, removed=${removed}`, async t => {
  const f = await setup(t, [measure([100,50,10,2]), measure([120,60,12,3]), measure([20,10,4,1])], { legacy: true });
  edit(f, db => { db.exec(removed === 'all' ? 'DELETE FROM telemetry_events' : 'DELETE FROM telemetry_events WHERE event_seq=' + removed);
    const rows = db.prepare('SELECT event_seq FROM telemetry_events ORDER BY event_seq').all();
    rows.forEach((r, i) => db.prepare('UPDATE telemetry_events SET event_seq=? WHERE event_seq=?').run(i + 1, r.event_seq));
    db.prepare('UPDATE sources SET last_event_seq=?').run(rows.length);
  });
  const s = f.stats(); assert.ok(keys.every(k => !s.totals[k].complete)); assert.ok(s.totals.input.incompleteReasons.source_integrity);
  assert.ok(s.buckets.every(b => !b.totals.input.complete)); assert.equal(s.analytics.totals.input.complete, false);
  // Missing evidence cannot be localized to the surviving timestamps.
  assert.equal(f.stats({ from: new Date(NOW - 86400000).toISOString(), to: new Date(NOW - 1000).toISOString() }).totals.input.complete, false);
  assert.equal(upgradeProvenance(f).verified, 0);
});
test('integrity: persisted allowance evidence cannot bypass a surviving-sequence conflict', async t => {
  const f = await setup(t, [measure([100,50,10,2]), token(null), measure([120,60,12,3])]);
  edit(f, db => db.exec('DELETE FROM telemetry_events WHERE event_seq=3'));
  assert.equal(f.stats().totals.input.complete, false);
});
test('integrity: a shifted source/session association is rejected despite unchanged byte hashes', async t => {
  const f = await setup(t, [token(null), measure([100,50,10,2])], { legacy: true });
  edit(f, db => db.exec("PRAGMA foreign_keys=OFF; UPDATE sources SET session_id='other'; UPDATE telemetry_events SET session_id='other'"));
  assert.equal(f.stats().totals.input.complete, false); assert.equal(upgradeProvenance(f).verified, 0);
});
test('integrity: byte-identical legitimate records retain distinct canonical ordinals', async t => {
  const m = measure([100,50,10,2]); const f = await setup(t, [token(null), m, m], { legacy: true });
  complete(f.stats(), [100,50,50,10,2]); assert.equal(f.stats().coverage.observations, 2); assert.equal(upgradeProvenance(f).verified, 3);
});
test('identity: ordinary paginated roots and disabled subagent metadata retain their full history', async t => {
  for (const extra of [{ history_mode: 'paginated' }, { history_mode: 'paginated', multi_agent_version: 'disabled', subagent_history_start_ordinal: 0 },
    { history_mode: 'paginated', multi_agent_version: 'v2' }]) {
    const header = meta('review'); Object.assign(header.payload, extra);
    const f = await setup(t, [], { legacy: true, records: [header, context(), token(null), measure([100,50,10,2])] });
    complete(f.stats(), [100,50,50,10,2]); assert.equal(upgradeProvenance(f).verified, 2);
  }
});
function forkRecords() {
  return [record('session_meta', { id: 'child', session_id: 'parent', forked_from_id: 'parent', parent_thread_id: 'parent',
    multi_agent_version: 'v2', history_mode: 'paginated', source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } }, subagent_history_start_ordinal: 3 }),
  meta('parent'), measure([10000,5000,1000,100]), record('event_msg', { type: 'thread_settings_applied', thread_id: 'child' }),
  context('child-turn', 'child-model'), token(null), measure([100,50,10,2])];
}
function rewriteAnchor(f, records) {
  const bytes = Buffer.from(records.map(r => JSON.stringify(r)).join('\n') + '\n'); fs.writeFileSync(f.file, bytes);
  edit(f, db => db.prepare('UPDATE sources SET checkpoint_byte_offset=?, anchor_end_offset=?, last_seen_file_size=?, anchor_sha256=?')
    .run(bytes.length, bytes.length, bytes.length, createHash('sha256').update(bytes).digest('hex')));
}
test('forks: shared canonical parser preserves verified inherited history and archive recovery', async t => {
  const f = await setup(t, [], { records: forkRecords(), legacy: true });
  const archived = path.join(f.home, 'archived_sessions', 'child.jsonl'); fs.mkdirSync(path.dirname(archived)); fs.renameSync(f.file, archived);
  complete(f.stats(), [100,50,50,10,2]); assert.equal(upgradeProvenance(f).verified, 2); fs.unlinkSync(archived); complete(f.stats(), [100,50,50,10,2]);
});
test('forks: legacy null boundary ownership is absent corroboration, not a conflicting identity', async t => {
  const rows = forkRecords(); rows[3].payload.thread_id = null;
  const f = await setup(t, [], { records: rows, legacy: true }); complete(f.stats(), [100,50,50,10,2]);
});
test('forks: malformed lineage, boundary owner, boundary ordinal and unsupported formats cannot authorize a suffix', async t => {
  for (const change of [rows => { rows[0].payload.multi_agent_version = 'v3'; }, rows => { rows[0].payload.parent_thread_id = 'wrong'; },
    rows => { rows[0].payload.subagent_history_start_ordinal = 2; }, rows => { rows[3].payload.thread_id = 'parent'; },
    rows => { rows[3].payload.type = 'task_started'; }, rows => { rows[1].payload.id = 'unrelated'; }]) {
    const f = await setup(t, [], { records: forkRecords(), legacy: true }), rows = forkRecords(); change(rows); rewriteAnchor(f, rows);
    assert.equal(f.stats().totals.input.complete, false); assert.equal(upgradeProvenance(f).verified, 0);
  }
});
test('forks: missing first child event cannot shift its canonical sequence', async t => {
  const rows = forkRecords(); rows.splice(5, 0, measure([80,40,8,1])); const f = await setup(t, [], { records: rows, legacy: true });
  edit(f, db => db.exec('DELETE FROM telemetry_events WHERE event_seq=1; UPDATE telemetry_events SET event_seq=event_seq-1; UPDATE sources SET last_event_seq=2'));
  assert.equal(f.stats().totals.input.complete, false); assert.equal(upgradeProvenance(f).verified, 0);
});
test('correction F4: an existing Recorder adopts an externally committed extension atomically', async t => {
  const f = await setup(t, [measure([100,50,10,2])], { legacy: true }), r = new Recorder(f);
  try {
    upgradeProvenance(f); fs.appendFileSync(f.file, JSON.stringify(token(null)) + '\n'); assert.deepEqual((await r.scan()).errors, []);
    assert.equal(r.db.prepare('SELECT count(*) n FROM event_provenance_v1').get().n, 2);
    fs.unlinkSync(f.file); complete(f.stats(), [100,50,50,10,2]);
  } finally { r.close(); }
});
test('upgrade lifecycle: unsupported versions and partial/removal states roll back scans', async t => {
  for (const sql of ["UPDATE recorder_meta SET value='2' WHERE key='event_provenance_version'",
    "DELETE FROM recorder_meta WHERE key='event_provenance_version'", 'DROP TABLE event_provenance_v1',
    'ALTER TABLE event_provenance_v1 RENAME COLUMN usage_kind TO unsupported_kind',
    'ALTER TABLE event_provenance_v1 ADD COLUMN unsupported_field TEXT',
    "UPDATE recorder_meta SET value='2' WHERE key='schema_version'",
    "DROP TABLE event_provenance_v1; DELETE FROM recorder_meta WHERE key='event_provenance_version'"]) {
    const f = await setup(t, [measure([100,50,10,2])]), r = new Recorder(f), before = snapshot(f);
    try { r.db.exec(sql); fs.appendFileSync(f.file, JSON.stringify(token(null)) + '\n'); const result = await r.scan();
      assert.equal(result.failed_sources, 1); assert.equal(r.counts().events, 1);
      // Restore only the synthetic base-version marker so the read-only snapshot helper can inspect it.
      if (sql.includes("key='schema_version'")) r.db.exec("UPDATE recorder_meta SET value='1' WHERE key='schema_version'");
      assert.equal(snapshot(f), before);
    } finally { r.close(); }
  }
});
test('upgrade lifecycle: adopted extension and event roll back together on failed scan; retry is safe', async t => {
  const f = await setup(t, [measure([100,50,10,2])], { legacy: true }), r = new Recorder({ ...f, beforeCommit() { throw Error('synthetic interruption'); } });
  try { upgradeProvenance(f); fs.appendFileSync(f.file, JSON.stringify(token(null)) + '\n'); const before = snapshot(f);
    assert.equal((await r.scan()).failed_sources, 1); assert.equal(snapshot(f), before); assert.equal(r.db.prepare('SELECT count(*) n FROM event_provenance_v1').get().n, 1);
    r.beforeCommit = null; assert.equal((await r.scan()).failed_sources, 0); fs.unlinkSync(f.file); complete(f.stats(), [100,50,50,10,2]);
  } finally { r.close(); }
});
test('upgrade race: upgrade waits behind an ongoing legacy scan and backfills its committed event', async t => {
  const f = await setup(t, [measure([100,50,10,2])], { legacy: true }); let child, exit;
  const r = new Recorder({ ...f, async beforeCommit() {
    child = spawn(process.execPath, ['-e', `console.log('START');require(process.argv[1]).upgradeProvenance({dbPath:process.argv[2],home:process.argv[3]});`,
      path.resolve(__dirname, '../lib/provenance-upgrade'), f.dbPath, f.home], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    await new Promise((resolve, reject) => { child.once('error', reject); child.stdout.once('data', resolve); });
    await new Promise(resolve => setTimeout(resolve, 100));
  } });
  try { fs.appendFileSync(f.file, JSON.stringify(token(null)) + '\n'); assert.equal((await r.scan()).failed_sources, 0); assert.equal(await exit, 0);
    r.beforeCommit = null; fs.appendFileSync(f.file, JSON.stringify(token(null)) + '\n'); assert.equal((await r.scan()).failed_sources, 0);
    assert.equal(r.db.prepare('SELECT count(*) n FROM event_provenance_v1').get().n, 3);
    const before = snapshot(f); upgradeProvenance(f); assert.equal(snapshot(f), before); fs.unlinkSync(f.file); complete(f.stats(), [100,50,50,10,2]);
  } finally { r.close(); if (child?.exitCode === null) child.kill(); }
});
