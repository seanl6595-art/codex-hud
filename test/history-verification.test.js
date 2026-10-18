'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto'), { spawnSync } = require('node:child_process');
const { Recorder } = require('../lib/recorder');
const { openDatabase, openReadOnlyDatabase } = require('../lib/recorder-db');
const { upgradeProvenance } = require('../lib/provenance-upgrade');
const { getHistoricalUsageStats } = require('../lib/stats');
const cache = require('../lib/verified-history-cache');
const { fixture, meta, context, record, token, usage, limit, NOW } = require('./helpers');
const measure = (v = [100,50,10,2], last = v) => token({ total_token_usage: usage(...v), last_token_usage: usage(...last) }, limit(), NOW + 1000);
const marker = id => record('event_msg', { type: 'thread_settings_applied', thread_id: id });
const header = (extra = {}) => record('session_meta', { id: 'child', session_id: 'family', forked_from_id: 'parent', parent_thread_id: 'parent',
  multi_agent_version: 'v2', history_mode: 'paginated', source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } }, subagent_history_start_ordinal: 4, ...extra });
const fork = (prefix, extra = {}) => [header({ subagent_history_start_ordinal: prefix.length + 1, ...extra }), ...prefix, marker('child'), measure([20,10,4,1])];
function edit(f, fn) { const db = openDatabase(f.dbPath); try { return fn(db); } finally { db.close(); } }
async function setup(t, rows = [meta('test'), context(), token(null), measure()], legacy = true) {
  cache.clear(); const f = fixture(t), dbPath = path.join(f.home, 'synthetic.sqlite3'), file = f.write('sessions/test.jsonl', rows), r = new Recorder({ home: f.home, dbPath });
  let summary; try { summary = await r.scan(); } finally { r.close(); }
  const result = { ...f, file, dbPath, summary, stats: (options = {}) => getHistoricalUsageStats({ home: f.home, dbPath,
    from: new Date(NOW).toISOString(), to: new Date(NOW + 3600000).toISOString(), timezone: 'UTC', analytics: true, buckets: 'hour', ...options }) };
  if (legacy) edit(result, db => db.exec("DROP TABLE event_provenance_v1; DELETE FROM recorder_meta WHERE key='event_provenance_version'"));
  t.after(() => cache.clear()); return result;
}
function rewrite(f, rows) {
  const data = rows.map(x => JSON.stringify(x)).join('\n') + '\n'; fs.writeFileSync(f.file, data);
  edit(f, db => db.prepare('UPDATE sources SET checkpoint_byte_offset=?,anchor_end_offset=?,last_seen_file_size=?,anchor_sha256=?')
    .run(Buffer.byteLength(data), Buffer.byteLength(data), Buffer.byteLength(data), createHash('sha256').update(data).digest('hex')));
}
function readCounts(fn) {
  const open = fs.openSync, read = fs.readSync, close = fs.closeSync, fds = new Set(); let bytes = 0, opens = 0;
  fs.openSync = function(file, ...args) { const fd = open.call(this, file, ...args); if (String(file).endsWith('.jsonl')) { fds.add(fd); opens++; } return fd; };
  fs.readSync = function(fd, ...args) { const n = read.call(this, fd, ...args); if (fds.has(fd)) bytes += n; return n; };
  fs.closeSync = function(fd) { fds.delete(fd); return close.call(this, fd); };
  try { return { result: fn(), bytes, opens }; } finally { fs.openSync = open; fs.readSync = read; fs.closeSync = close; }
}
test('ownership: child-owned settings/usage and mixed explicit owners cannot be inherited', async t => {
  const ownedUsage = measure(); ownedUsage.payload.thread_id = 'child';
  const envelope = measure(); envelope.thread_id = 'child';
  const mixed = marker('parent'); mixed.thread_id = 'child';
  for (const contradictory of [marker('child'), marker('unrelated'), ownedUsage, envelope, mixed]) {
    const f = await setup(t, fork([meta('parent'), contradictory, measure()]));
    assert.equal(f.summary.failed_sources, 1); assert.equal(f.summary.events, 0); assert.equal(f.summary.errors[0].code, 'SOURCE_OWNERSHIP_CONFLICT');
  }
});
test('ownership: parent-owned observations and unrelated recipient references remain supported', async t => {
  const inherited = measure(); inherited.payload.thread_id = 'parent';
  const reference = record('event_msg', { type: 'collab_agent_spawn_end', sender_thread_id: 'parent', receiver_thread_id: 'child' });
  const f = await setup(t, fork([meta('parent'), marker('parent'), inherited, reference]));
  assert.equal(f.summary.failed_sources, 0); assert.equal(f.stats().totals.input.value, 20); assert.equal(f.stats().totals.input.complete, true);
});
test('ownership: foreign-owned usage in an ordinary stream rolls back rather than becoming its usage', async t => {
  const foreign = measure(); foreign.payload.thread_id = 'other'; const f = await setup(t, [meta('test'), foreign]);
  assert.equal(f.summary.failed_sources, 1); assert.equal(f.summary.events, 0);
});
test('ownership: child headers and boundary envelopes cannot contradict their declared owner', async t => {
  for (const position of [0,2]) {
    const rows = fork([meta('parent')]); rows[position].thread_id = 'other';
    const f = await setup(t,rows); assert.equal(f.summary.failed_sources,1); assert.equal(f.summary.events,0);
  }
});
test('ownership: authenticated legacy boundary/header contradictions remain incomplete', async t => {
  for (const position of [0,2]) {
    const rows = fork([meta('parent')]), f = await setup(t,rows); assert.equal(f.stats().totals.input.complete,true);
    rows[position].thread_id = 'other'; rewrite(f,rows);
    assert.equal(f.stats().totals.input.complete,false); assert.equal(upgradeProvenance(f).verified,0);
  }
});
test('history declarations: unsupported and truncated copied-history declarations fail without a second session_meta', async t => {
  for (const extra of [{ multi_agent_version: 'v3' }, { multi_agent_version: null }, { history_mode: 'other' }, { forked_from_id: null },
    { forked_from_id: '' }, { parent_thread_id: null }, { source: null }, { subagent_history_start_ordinal: null }, { subagent_history_start_ordinal: '4' }]) {
    const rows = fork([marker('parent'), measure(), context()], extra), f = await setup(t, rows);
    assert.equal(f.summary.failed_sources, 1); assert.equal(f.summary.events, 0); assert.equal(f.summary.errors[0].code, 'UNSUPPORTED_INHERITED_HISTORY');
  }
});
test('history declarations: ordinary roots and non-inheriting child streams remain compatible', async t => {
  for (const extra of [{ history_mode: 'paginated' }, { history_mode: 'paginated', multi_agent_version: null, parent_thread_id: 'parent' }, { history_mode: 'paginated', multi_agent_version: 'disabled', parent_thread_id: 'parent', subagent_history_start_ordinal: 143 },
    { history_mode: 'paginated', multi_agent_version: 'v2', parent_thread_id: 'parent', source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } }]) {
    const root = meta('test'); Object.assign(root.payload, extra); const f = await setup(t, [root, measure()]);
    assert.equal(f.summary.failed_sources, 0); assert.equal(f.stats().totals.input.value, 100); assert.equal(f.stats().totals.input.complete, true);
  }
});
test('legacy recovery: previously committed child-owned suffix cannot be certified after the parser correction', async t => {
  const rows = fork([meta('parent')]); rows.push(marker('child'), measure([30,15,5,2]));
  const f = await setup(t, rows); assert.equal(f.stats().totals.input.complete, true);
  rows[0].payload.subagent_history_start_ordinal = 4; rewrite(f, rows);
  edit(f, db => db.exec('DELETE FROM telemetry_events WHERE event_seq=1; UPDATE telemetry_events SET event_seq=1; UPDATE sources SET last_event_seq=1'));
  assert.equal(f.stats().totals.input.complete, false); assert.equal(upgradeProvenance(f).verified, 0);
});
test('legacy recovery: unsupported parent-plus-child history cannot be certified as an ordinary sequence', async t => {
  const parentUsage = measure(), childUsage = measure([20,10,4,1]); const f = await setup(t, [meta('child'), parentUsage, childUsage]);
  assert.equal(f.stats().totals.input.complete, true);
  rewrite(f, [header({ multi_agent_version: 'v3', subagent_history_start_ordinal: 3 }), marker('parent'), parentUsage, marker('child'), childUsage]);
  assert.equal(f.stats().totals.input.complete, false); assert.equal(upgradeProvenance(f).verified, 0);
});
test('cache: warm queries reuse cryptographic evidence without rereading source content', async t => {
  const f = await setup(t), first = readCounts(() => f.stats()), second = readCounts(() => f.stats());
  assert.ok(first.bytes > 0); assert.equal(second.bytes, 0); assert.equal(second.result.verification.reusedSources, 1);
  assert.equal(second.result.verification.liveSourceAttestation, false); assert.equal(second.result.verification.snapshotId, first.result.verification.snapshotId);
  assert.deepEqual(second.result.totals, first.result.totals);
});
test('cache: time/model/effort changes share evidence but still compute their own accounting', async t => {
  const f = await setup(t); f.stats();
  const filtered = readCounts(() => f.stats({ filters: { model: 'absent-model', effort: 'low' } }));
  assert.equal(filtered.bytes, 0); assert.equal(filtered.result.analytics.totals.input.value, 0); assert.equal(filtered.result.totals.input.value, 100);
  const outside = f.stats({ from: new Date(NOW + 86400000).toISOString(), to: new Date(NOW + 90000000).toISOString() });
  assert.equal(outside.totals.input.value, 0); assert.equal(outside.verification.reusedSources, 1);
});
test('cache: source health timestamps alone do not invalidate unchanged committed evidence', async t => {
  const f = await setup(t); f.stats(); edit(f, db => db.exec("UPDATE sources SET updated_at='2099-01-01T00:00:00Z',last_seen_file_size=last_seen_file_size+1"));
  assert.equal(readCounts(() => f.stats()).bytes, 0);
});
test('cache: committed counter/timestamp tampering changes the binding and fails raw projection verification', async t => {
  for (const sql of ['UPDATE telemetry_events SET input_tokens=101,cumulative_input_tokens=101,total_tokens=111,cumulative_total_tokens=111 WHERE event_seq=2', "UPDATE telemetry_events SET event_timestamp='2026-01-01T12:02:00.000Z' WHERE event_seq=2"]) {
    const f = await setup(t); f.stats(); edit(f, db => db.exec(sql)); const checked = readCounts(() => f.stats());
    assert.ok(checked.bytes > 0); assert.equal(checked.result.totals.input.complete, false); assert.equal(checked.result.verification.reusedSources, 0);
  }
});
test('cache: a witnessed integrity conflict is not erased by upgrade metadata or source deletion', async t => {
  const f = await setup(t), bytes = fs.readFileSync(f.file); f.stats();
  edit(f, db => db.exec('UPDATE telemetry_events SET input_tokens=101,cumulative_input_tokens=101,total_tokens=111,cumulative_total_tokens=111 WHERE event_seq=2'));
  assert.equal(f.stats().totals.input.complete,false);
  assert.equal(upgradeProvenance(f).conflictingSources,1);
  fs.unlinkSync(f.file); assert.equal(f.stats().totals.input.complete,false);
  const fresh = f.stats({verification:'fresh'}); assert.equal(fresh.totals.input.complete,false); assert.equal(fresh.verification.retainedConflicts,1);
  edit(f, db => db.exec('UPDATE telemetry_events SET input_tokens=100,cumulative_input_tokens=100,total_tokens=110,cumulative_total_tokens=110 WHERE event_seq=2'));
  fs.writeFileSync(f.file,bytes);assert.equal(f.stats().totals.input.complete,true);
});
test('legacy timestamps: fresh verification does not reinterpret a stored naive timestamp in a new process zone', async t => {
  const m=measure();m.timestamp='2026-01-01T12:00:01';const f=await setup(t,[meta('test'),m]);
  const script=`const s=require(process.argv[1]).getHistoricalUsageStats(JSON.parse(process.argv[2]));console.log(JSON.stringify({value:s.totals.input.value,complete:s.totals.input.complete,conflicts:s.verification.conflictingSources}))`;
  const options={home:f.home,dbPath:f.dbPath,from:'2026-01-01T00:00:00Z',to:'2026-01-02T00:00:00Z',timezone:'UTC',verification:'fresh'};
  const result=spawnSync(process.execPath,['-e',script,path.resolve(__dirname,'../lib/stats'),JSON.stringify(options)],{encoding:'utf8',env:{...process.env,TZ:'Pacific/Auckland'},windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{value:100,complete:true,conflicts:0});
});
test('cache: resequencing or deleting a previously authenticated first event cannot reuse its proof', async t => {
  const f = await setup(t, [meta('test'), measure(), token(null), measure([20,10,4,1])]); f.stats();
  edit(f, db => db.exec('DELETE FROM telemetry_events WHERE event_seq=1; UPDATE telemetry_events SET event_seq=event_seq-1; UPDATE sources SET last_event_seq=2'));
  const s = f.stats(); assert.equal(s.totals.input.complete, false); assert.equal(s.verification.reusedSources, 0);
});
test('cache: malformed checkpoint metadata cannot reuse or authenticate a previously valid sequence', async t => {
  for (const change of ["anchor_sha256='bad'",'anchor_start_offset=1','anchor_end_offset=checkpoint_byte_offset+1']) {
    const f=await setup(t);f.stats();edit(f,db=>db.exec('PRAGMA ignore_check_constraints=ON; UPDATE sources SET '+change));
    const s=f.stats();assert.equal(s.totals.input.complete,false);assert.equal(s.verification.conflictingSources,1);
  }
});
test('query row reuse: orphaned observations are never silently omitted from accounting', async t => {
  const f = await setup(t); f.stats(); edit(f, db => db.exec('PRAGMA foreign_keys=OFF; DELETE FROM sources'));
  const s = f.stats(); assert.equal(s.coverage.observations, 2); assert.equal(s.totals.input.complete, false);
  assert.equal(s.totals.input.incompleteReasons.source_integrity, 1);
});
test('cache: metadata/provenance upgrades invalidate bindings, and unsupported versions fail before reuse', async t => {
  const f = await setup(t); const old = f.stats().verification.snapshotId; upgradeProvenance(f);
  const after = f.stats(); assert.equal(after.verification.reusedSources, 0); assert.notEqual(after.verification.snapshotId, old);
  edit(f, db => db.exec("UPDATE recorder_meta SET value='2' WHERE key='event_provenance_version'")); assert.throws(() => f.stats(), /Unsupported event provenance/);
});
test('cache: manual fresh verification always reads bytes and retains read-only schema/rows', async t => {
  const f = await setup(t); f.stats();
  const snapshot = () => { const db = openReadOnlyDatabase(f.dbPath); try { return JSON.stringify(['sqlite_schema','recorder_meta','sources','telemetry_events'].map(table => db.prepare('SELECT * FROM '+table).all())); } finally { db.close(); } };
  const before = snapshot(), fresh = readCounts(() => f.stats({ verification: 'fresh' }));
  assert.ok(fresh.bytes > 0); assert.equal(fresh.result.verification.reusedSources, 0); assert.equal(fresh.result.verification.mode, 'fresh'); assert.equal(snapshot(), before);
});
test('cache: observable file changes and disappearance evict legacy evidence', async t => {
  const f = await setup(t); f.stats(); fs.appendFileSync(f.file, '\n'); assert.ok(readCounts(() => f.stats()).bytes > 0);
  fs.unlinkSync(f.file); const s = f.stats(); assert.equal(s.totals.input.complete, false); assert.equal(s.verification.unavailableSources, 1);
});
test('cache: unavailable evidence is not promoted and restored sources can be verified immediately', async t => {
  const f = await setup(t), bytes = fs.readFileSync(f.file); fs.unlinkSync(f.file); assert.equal(f.stats().totals.input.complete, false);
  fs.writeFileSync(f.file, bytes); const s = f.stats(); assert.equal(s.totals.input.complete, true); assert.equal(s.verification.checkedSources, 1);
});
test('cache: hidden external mutation is explicitly an as-of snapshot; fresh audit detects it and evicts the old proof', async t => {
  const f = await setup(t), first = f.stats(), stamp = fs.statSync(f.file), stat = fs.statSync;
  fs.writeFileSync(f.file, fs.readFileSync(f.file, 'utf8').replace('"info":null', '"info":{}'));
  // Hide all metadata signals, stronger than merely restoring size and mtime.
  fs.statSync = function(file, ...args) { return path.resolve(String(file)) === path.resolve(f.file) ? stamp : stat.call(this, file, ...args); };
  try {
    const snapshot = f.stats(); assert.equal(snapshot.verification.reusedSources, 1); assert.equal(snapshot.verification.liveSourceAttestation, false);
    assert.equal(snapshot.verification.oldestVerifiedAt, first.verification.oldestVerifiedAt); assert.deepEqual(snapshot.totals, first.totals);
    const fresh = f.stats({ verification: 'fresh' }); assert.equal(fresh.totals.input.complete, false);
    assert.equal(f.stats().totals.input.complete, false); // failed fresh audit cannot resurrect the old certificate
  } finally { fs.statSync = stat; }
});
test('cache: process restart has no implicit persisted certificate', async t => {
  const f = await setup(t); f.stats(); fs.unlinkSync(f.file);
  const script = `const s=require(process.argv[1]).getHistoricalUsageStats(JSON.parse(process.argv[2]));console.log(JSON.stringify({complete:s.totals.input.complete,reused:s.verification.reusedSources}))`;
  const result = spawnSync(process.execPath, ['-e', script, path.resolve(__dirname, '../lib/stats'), JSON.stringify({home:f.home,dbPath:f.dbPath,from:new Date(NOW).toISOString(),to:new Date(NOW+3600000).toISOString(),timezone:'UTC'})], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), { complete: false, reused: 0 });
});
test('cache: an explicit upgrade freshly authenticates bytes instead of persisting a cached as-of classification', async t => {
  const f = await setup(t, undefined, false);
  edit(f, db => db.exec('DELETE FROM event_provenance_v1'));
  f.stats(); const stamp = fs.statSync(f.file), stat = fs.statSync;
  fs.writeFileSync(f.file, fs.readFileSync(f.file, 'utf8').replace('"info":null', '"info":{}'));
  fs.statSync = function(file, ...args) { return path.resolve(String(file)) === path.resolve(f.file) ? stamp : stat.call(this, file, ...args); };
  try {
    assert.equal(upgradeProvenance(f).verified, 0);
    assert.equal(edit(f, db => db.prepare('SELECT count(*) n FROM event_provenance_v1').get().n), 0);
    assert.equal(f.stats().totals.input.complete, false);
  } finally { fs.statSync = stat; }
});
test('cache: an interrupted Recorder append cannot publish uncommitted observations to readers', async t => {
  const f = await setup(t); f.stats(); fs.appendFileSync(f.file, JSON.stringify(measure([120,60,12,3],[20,10,2,1]))+'\n');
  let during; const r = new Recorder({ ...f, beforeCommit() { during = f.stats(); throw Error('interrupt'); } });
  try { assert.equal((await r.scan()).failed_sources, 1); } finally { r.close(); }
  assert.equal(during.totals.input.value, 100); assert.equal(during.totals.input.complete, true); assert.equal(f.stats().totals.input.value, 100);
});
test('cache: a committed append and rebuild invalidate old sequence certificates', async t => {
  const f = await setup(t); const first = f.stats();
  fs.appendFileSync(f.file, JSON.stringify(measure([120,60,12,3],[20,10,2,1]))+'\n');
  const r = new Recorder(f);
  try {
    assert.equal((await r.scan()).inserted_events, 1); const appended = f.stats();
    assert.equal(appended.totals.input.value, 120); assert.equal(appended.verification.reusedSources, 0);
    assert.notEqual(appended.verification.snapshotId, first.verification.snapshotId);
    fs.writeFileSync(f.file, [meta('test'),measure([20,10,4,1])].map(x=>JSON.stringify(x)).join('\n')+'\n');
    assert.equal((await r.scan()).rebuilt_sources, 1); const rebuilt = f.stats();
    assert.equal(rebuilt.totals.input.value, 20); assert.equal(rebuilt.totals.input.complete, true); assert.equal(rebuilt.verification.reusedSources, 0);
  } finally { r.close(); }
});
test('cache: returned recovery maps cannot mutate a later cached classification', async t => {
  const f = await setup(t, [meta('test'),token({}),measure()]), db = openReadOnlyDatabase(f.dbPath);
  try {
    const resolver = require('../lib/event-provenance').createProvenanceResolver(db, f.home, {dbPath:f.dbPath});
    const kinds = resolver.recover('test'); kinds.set(1,'allowance_only');
  } finally { db.close(); }
  assert.equal(f.stats().totals.input.complete, false); assert.equal(f.stats().coverage.allowanceOnlyObservations, 0);
});
test('archive index: moved-source cold recovery reads each matching source once, not every candidate per source', async t => {
  const f = fixture(t), dbPath = path.join(f.home, 'synthetic.sqlite3'), n = 24; cache.clear();
  for (let i=0;i<n;i++) f.write('sessions/'+String(i).padStart(3,'0')+'.jsonl', [meta('id-'+String(i).padStart(3,'0')), record('padding',{data:'x'.repeat(65536)}), token(null), measure()]);
  const r = new Recorder({home:f.home,dbPath}); try { assert.equal((await r.scan()).failed_sources,0); } finally { r.close(); }
  fs.mkdirSync(path.join(f.home,'archived_sessions'));
  for(let i=0;i<n;i++)fs.renameSync(path.join(f.home,'sessions',String(i).padStart(3,'0')+'.jsonl'),path.join(f.home,'archived_sessions',String(n-i-1).padStart(3,'0')+'.jsonl'));
  const run=()=>getHistoricalUsageStats({home:f.home,dbPath,from:new Date(NOW).toISOString(),to:new Date(NOW+3600000).toISOString(),timezone:'UTC'});
  const cold=readCounts(run); assert.equal(cold.result.totals.input.value,n*100); assert.equal(cold.result.totals.input.complete,true);
  assert.equal(cold.opens,n*2); assert.ok(cold.bytes < n*90000); assert.equal(readCounts(run).bytes,0); cache.clear();
});
test('archive index: duplicate identities remain candidates, not trusted matches', async t => {
  const f = await setup(t), bytes = fs.readFileSync(f.file); fs.unlinkSync(f.file);
  f.write('sessions/conflict.jsonl',[meta('test'),token({}),measure()]); fs.mkdirSync(path.join(f.home,'archived_sessions')); fs.writeFileSync(path.join(f.home,'archived_sessions','exact.jsonl'),bytes);
  assert.equal(f.stats().totals.input.complete,true); assert.equal(upgradeProvenance(f).verified,2);
});
test('archive index: a growing candidate is bounded to its initial extent and can be retried', async t => {
  const rows = [record('padding',{data:'prefix'}),meta('test'),token(null),measure()], f = await setup(t,rows), bytes = fs.readFileSync(f.file);
  const cut = bytes.indexOf(10)+1, archive = path.join(f.home,'archived_sessions','growing.jsonl'); fs.mkdirSync(path.dirname(archive));
  fs.unlinkSync(f.file); fs.writeFileSync(archive,bytes.subarray(0,cut));
  const open=fs.openSync,read=fs.readSync,close=fs.closeSync;let candidate,appended=false;
  fs.openSync=function(file,...args){const fd=open.call(this,file,...args);if(path.resolve(String(file))===path.resolve(archive))candidate=fd;return fd;};
  fs.readSync=function(fd,...args){if(fd===candidate&&!appended){appended=true;fs.appendFileSync(archive,bytes.subarray(cut));}return read.call(this,fd,...args);};
  fs.closeSync=function(fd){if(fd===candidate)candidate=undefined;return close.call(this,fd);};
  try{assert.equal(f.stats().totals.input.complete,false);}finally{fs.openSync=open;fs.readSync=read;fs.closeSync=close;}
  assert.equal(appended,true);assert.equal(f.stats().totals.input.complete,true);
});
test('GUI workers: a lightweight status response is not queued behind a fresh source verification', async t => {
  const padding = record('padding', { data: 'x'.repeat(256*1024) });
  const f = await setup(t, [meta('test'), ...Array(256).fill(padding), token(null), measure()]);
  const service = require('../lib/gui/service').createService(f);
  try {
    await service.status(); let completed = false;
    const stats = service.stats(new URLSearchParams({range:'custom',from:'2026-01-01T12:00',to:'2026-01-01T13:00',timezone:'UTC',verification:'fresh'}))
      .then(value => { completed = true; return value; });
    await new Promise(resolve => setTimeout(resolve,10));
    const status = await service.status(); assert.equal(status.events,2); assert.equal(completed,false);
    assert.equal((await stats).totals.input.complete,true);
  } finally { await service.close(); }
});
test('CLI: explicit source verification is scoped to Stats and preserves exact totals', async t => {
  const f = await setup(t); const {parseArgs} = require('../lib/cli');
  assert.equal(parseArgs(['stats','--verify-sources']).flags['verify-sources'],true);
  assert.throws(()=>parseArgs(['summary','--verify-sources']),/requires stats/);
  const result = spawnSync(process.execPath,[path.resolve(__dirname,'../bin/codex-hud.js'),'stats','--verify-sources','--db',f.dbPath,'--codex-home',f.home,
    '--from','2026-01-01 12:00','--to','2026-01-01 13:00'],{encoding:'utf8',env:{...process.env,TZ:'UTC'},windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Total\s+100/);assert.match(result.stdout,/0 reused, 1 checked/);
});
test('CLI: an upgrade with authenticated integrity conflicts reports them and exits nonzero', async t => {
  const f = await setup(t);
  edit(f,db=>db.exec('UPDATE telemetry_events SET input_tokens=101,cumulative_input_tokens=101,total_tokens=111,cumulative_total_tokens=111 WHERE event_seq=2'));
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'../bin/codex-hud.js'),'upgrade-provenance','--db',f.dbPath,'--codex-home',f.home],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,1);const report=JSON.parse(result.stdout);assert.equal(report.conflictingSources,1);assert.equal(report.verified,0);
  assert.equal(edit(f,db=>db.prepare('SELECT count(*) n FROM telemetry_events').get().n),2);
});
test('large histories: streaming accounting preserves duplicates and complete known metrics', async t => {
  const f = fixture(t), dbPath = path.join(f.home,'large.sqlite3'), db = openDatabase(dbPath), at = new Date(NOW).toISOString();
  try {
    db.exec('BEGIN');
    db.prepare(`INSERT INTO sources (session_id,current_path,checkpoint_byte_offset,last_event_seq,anchor_start_offset,anchor_end_offset,anchor_sha256,last_seen_file_size,updated_at)
      VALUES ('large','synthetic-only',0,100001,0,0,'',0,?)`).run(at);
    db.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<100001)
      INSERT INTO telemetry_events (session_id,event_seq,event_timestamp,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,
        cumulative_input_tokens,cumulative_cached_input_tokens,cumulative_output_tokens,cumulative_reasoning_output_tokens)
      SELECT 'large',n,?,100,50,10,2,100,50,10,2 FROM seq`).run(at);
    db.exec('COMMIT');
  } finally { db.close(); }
  const s = getHistoricalUsageStats({home:f.home,dbPath,from:at,to:new Date(NOW+3600000).toISOString(),timezone:'UTC'});
  assert.equal(s.coverage.observations,100001);assert.equal(s.totals.input.value,100);assert.equal(s.totals.input.complete,true);
  assert.equal(s.activity.usageEvents,1);assert.equal(s.verification.unavailableSources,1);
});
