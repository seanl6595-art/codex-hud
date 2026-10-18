'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { Recorder } = require('../lib/recorder');
const { openDatabase, openReadOnlyDatabase } = require('../lib/recorder-db');
const { getHistoricalUsageStats } = require('../lib/stats');
const cache = require('../lib/verified-history-cache');
const { fixture, meta, token, usage, limit, NOW } = require('./helpers');
const measurement = () => token({ total_token_usage: usage(100, 50, 10, 2), last_token_usage: usage(100, 50, 10, 2) }, limit(), NOW + 1000);
async function setup(t, legacy = true) {
  const f = fixture(t), dbPath = path.join(f.home, 'synthetic.sqlite3');
  const file = f.write('sessions/test.jsonl', [meta('test'), token(null), measurement()]);
  const r = new Recorder({ home: f.home, dbPath });
  try { assert.equal((await r.scan()).failed_sources, 0); } finally { r.close(); }
  if (legacy) {
    const db = openDatabase(dbPath);
    try { db.exec("DROP TABLE event_provenance_v1; DELETE FROM recorder_meta WHERE key='event_provenance_version'"); } finally { db.close(); }
  }
  cache.clear(); t.after(() => cache.clear());
  return { ...f, dbPath, file, stats: options => getHistoricalUsageStats({ home: f.home, dbPath,
    from: new Date(NOW).toISOString(), to: new Date(NOW + 3600000).toISOString(), timezone: 'UTC', ...options }) };
}

for (const mode of ['growth', 'restored-mtime', 'replacement']) test('verification: no certificate for a prefix changed during reading: ' + mode, async t => {
  const f = await setup(t), bytes = fs.readFileSync(f.file, 'utf8'), old = fs.statSync(f.file);
  const open = fs.openSync, read = fs.readSync, close = fs.closeSync;
  let sourceFd, changed = false;
  fs.openSync = function (name, ...args) { const fd = open.call(this, name, ...args); if (name === f.file) sourceFd = fd; return fd; };
  fs.readSync = function (fd, ...args) {
    const n = read.call(this, fd, ...args);
    if (fd === sourceFd && !changed) {
      changed = true;
      if (mode === 'replacement') fs.renameSync(f.file, f.file + '.old');
      fs.writeFileSync(f.file, bytes.replace('"input_tokens":100', '"input_tokens":101') + (mode === 'growth' ? '\n' : ''));
      if (mode === 'restored-mtime') fs.utimesSync(f.file, old.atimeMs / 1000, old.mtimeMs / 1000);
    }
    return n;
  };
  fs.closeSync = function (fd) { if (fd === sourceFd) sourceFd = undefined; return close.call(this, fd); };
  let result;
  try { result = f.stats({ verification: 'fresh' }); } finally { fs.openSync = open; fs.readSync = read; fs.closeSync = close; }
  assert.equal(changed, true); assert.equal(result.totals.input.complete, false);
  const next = f.stats(); assert.equal(next.verification.reusedSources, 0); assert.equal(next.totals.input.complete, false);
});

for (const legacy of [false, true]) test('Recorder: concurrent prefix rewrite rolls back rows and checkpoint, legacy=' + legacy, async t => {
  const f = await setup(t, legacy);
  function snapshot() {
    const db = openReadOnlyDatabase(f.dbPath);
    try { return JSON.stringify(['sources', 'telemetry_events', 'recorder_meta', ...(!legacy ? ['event_provenance_v1'] : [])]
      .map(table => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all())); } finally { db.close(); }
  }
  const before = snapshot(); fs.appendFileSync(f.file, JSON.stringify(measurement()) + '\n');
  const originalOpen = fs.promises.open; let changed = false;
  fs.promises.open = async function (name, ...args) {
    const handle = await originalOpen.call(this, name, ...args);
    if (name === f.file) {
      const read = handle.read.bind(handle); let reads = 0;
      handle.read = async (...args) => {
        const result = await read(...args);
        // ingest first verifies the committed prefix, then parses the snapshot.
        if (++reads === 2) {
          changed = true;
          fs.writeFileSync(f.file, fs.readFileSync(f.file, 'utf8').replace('"input_tokens":100', '"input_tokens":101') + '\n');
        }
        return result;
      };
    }
    return handle;
  };
  const recorder = new Recorder(f);
  try { await assert.rejects(recorder.ingest({ id: 'test', file: f.file }), { code: 'SOURCE_CHANGED_DURING_READ' }); }
  finally { fs.promises.open = originalOpen; recorder.close(); }
  assert.equal(changed, true); assert.equal(snapshot(), before);
});

test('compatibility: milestone v4 ownership seals survive without source bytes or migration', async t => {
  const f = await setup(t, false), db = openDatabase(f.dbPath);
  try {
    const { createHash } = require('node:crypto'), { PARSER_VERSION } = require('../lib/rollout-identity');
    const source = db.prepare('SELECT * FROM sources WHERE session_id=?').get('test');
    const rows = db.prepare('SELECT * FROM telemetry_events WHERE session_id=? ORDER BY event_seq').all('test');
    const evidence = db.prepare('SELECT * FROM event_provenance_v1 WHERE session_id=? ORDER BY event_seq').all('test');
    // Reproduce the committed milestone's durable format independently.
    const seal = createHash('sha256').update(JSON.stringify([PARSER_VERSION, 4, source.session_id,
      source.checkpoint_byte_offset, source.last_event_seq, source.anchor_start_offset,
      source.anchor_end_offset, source.anchor_sha256, rows, evidence])).digest('hex');
    db.prepare('UPDATE recorder_meta SET value=? WHERE key=?').run(seal, 'ownership_proof_v' + PARSER_VERSION + ':test');
  } finally { db.close(); }
  const before = fs.readFileSync(f.dbPath); fs.unlinkSync(f.file); cache.clear();
  const stats = f.stats(); assert.equal(stats.totals.input.value, 100); assert.equal(stats.totals.input.complete, true);
  assert.deepEqual(fs.readFileSync(f.dbPath), before);
});
