'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { discoverFiles } = require('./jsonl');
const { canonicalSource, sessionIdentity, PARSER_VERSION } = require('./rollout-identity');
const historyCache = require('./verified-history-cache');
// Bump when the facts certified by source verification change, independently of
// the persisted event classifier and rollout parser versions.
const VERIFIER_VERSION = 4;

// Versioned, fail-closed interpretation of the producer's token_count envelope.
// Absence of counters alone is never evidence that usage was inapplicable.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const COUNTERS = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const usageColumns = COUNTERS.flatMap(key => [key, `cumulative_${key}`]);
function classifyTokenEvent(record) {
  const p = record?.payload;
  if (record?.type !== 'event_msg' || !object(p) || p.type !== 'token_count') return 'unknown';
  if (object(p.info)) return 'usage'; // Including malformed/partial usage: never skip it.
  if (!Object.hasOwn(p, 'info') || p.info !== null || !object(p.rate_limits)
    || Object.keys(record).some(key => !['type', 'timestamp', 'ordinal', 'payload'].includes(key))
    || Object.hasOwn(record, 'ordinal') && (!Number.isSafeInteger(record.ordinal) || record.ordinal < 0)
    || Object.keys(p).some(key => !['type', 'info', 'rate_limits'].includes(key))) return 'unknown';
  const validWindow = w => object(w) && finite(w.used_percent) && w.used_percent >= 0 && w.used_percent <= 100
    && Number.isSafeInteger(w.window_minutes) && w.window_minutes > 0 && finite(w.resets_at) && w.resets_at > 0;
  return [p.rate_limits.primary, p.rate_limits.secondary].some(validWindow) ? 'allowance_only' : 'unknown';
}
function hasProvenance(db) {
  const exists = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='event_provenance_v1'").get();
  const version = db.prepare("SELECT value FROM recorder_meta WHERE key='event_provenance_version'").get()?.value;
  if (!exists && version === undefined) return false;
  if (!exists || version !== '1') throw new Error('Unsupported event provenance version; database left unchanged.');
  const columns = db.prepare('PRAGMA table_info(event_provenance_v1)').all();
  const expected = { session_id: ['TEXT', 1], event_seq: ['INTEGER', 2], raw_event_sha256: ['TEXT', 0], usage_kind: ['TEXT', 0], classifier_version: ['INTEGER', 0] };
  const links = db.prepare('PRAGMA foreign_key_list(event_provenance_v1)').all();
  if (columns.length !== Object.keys(expected).length || columns.some(c => !expected[c.name]
    || c.type !== expected[c.name][0] || c.pk !== expected[c.name][1] || c.notnull !== 1)
    || links.length !== 2 || !['session_id', 'event_seq'].every(key => links.some(f => f.table === 'telemetry_events'
      && f.from === key && f.to === key && f.on_delete === 'CASCADE'))) {
    throw new Error('Unsupported event provenance schema; database left unchanged.');
  }
  return true;
}
function createProvenance(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS event_provenance_v1 (
    session_id TEXT NOT NULL, event_seq INTEGER NOT NULL, raw_event_sha256 TEXT NOT NULL,
    usage_kind TEXT NOT NULL CHECK(usage_kind IN ('usage','allowance_only','unknown')),
    classifier_version INTEGER NOT NULL CHECK(classifier_version=1),
    PRIMARY KEY(session_id,event_seq),
    FOREIGN KEY(session_id,event_seq) REFERENCES telemetry_events(session_id,event_seq) ON DELETE CASCADE
  ) STRICT`);
  db.prepare("INSERT OR IGNORE INTO recorder_meta VALUES ('event_provenance_version','1')").run();
}
function provenanceWriter(db) {
  return db.prepare(`INSERT INTO event_provenance_v1 (session_id,event_seq,raw_event_sha256,usage_kind,classifier_version) VALUES (?,?,?,?,1)
    ON CONFLICT(session_id,event_seq) DO UPDATE SET raw_event_sha256=excluded.raw_event_sha256,
    usage_kind=excluded.usage_kind,classifier_version=1`);
}
function allUsageAbsent(row) { return usageColumns.every(key => row[key] === null); }
function observedProjection(record) {
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const time = record.timestamp;
  const projection = {};
  const validTime = typeof time === 'string' && time.length > 0 && time.length <= 256 && Number.isFinite(Date.parse(time));
  if (!validTime) projection.event_timestamp = null;
  // Legacy Recorder accepted timezone-naive dates in its original process zone.
  // Do not reinterpret that stored observation in the reader's current zone.
  // Absolute source timestamps have an independently reproducible projection.
  else if (/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(time)) projection.event_timestamp = new Date(time).toISOString();
  for (const column of COUNTERS) {
    projection[column] = number(record.payload.info?.last_token_usage?.[column]);
    projection[`cumulative_${column}`] = number(record.payload.info?.total_token_usage?.[column]);
  }
  return projection;
}

// Verify the entire recorded byte prefix and the full canonical token stream.
// Only the shared, validated fork parser may exclude inherited parent history.
// No source text, identity, model, or later usage is copied into the DB by recovery.
function verifySource(file, source, expected) {
  let fd;
  try {
    if (!Number.isSafeInteger(source.checkpoint_byte_offset) || source.checkpoint_byte_offset < 0
      || source.anchor_start_offset !== 0 || source.anchor_end_offset !== source.checkpoint_byte_offset
      || !Number.isSafeInteger(source.last_event_seq) || source.last_event_seq < 0) return { conflict: true };
    if (source.checkpoint_byte_offset === 0) return null;
    if (!/^[a-f0-9]{64}$/.test(source.anchor_sha256 || '')) return { conflict: true };
    if (expected.length !== source.last_event_seq
      || expected.some((row, i) => row.event_seq !== i + 1 || !/^[a-f0-9]{64}$/.test(row.raw_event_sha256 || ''))) return { conflict: true };
    fd = fs.openSync(file, 'r');
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size < source.checkpoint_byte_offset) return null;
    const digest = createHash('sha256'), chunk = Buffer.alloc(65536), tokens = [], canonical = canonicalSource();
    let offset = 0, segments = [], length = 0, lineStart = 0, identityConflict = false;
    while (offset < source.checkpoint_byte_offset) {
      const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, source.checkpoint_byte_offset - offset), offset);
      if (!n) return null;
      digest.update(chunk.subarray(0, n)); offset += n;
      let start = 0, end;
      while ((end = chunk.indexOf(10, start)) >= 0 && end < n) {
        const tail = chunk.subarray(start, end), line = segments.length ? Buffer.concat([...segments, tail], length + tail.length) : tail;
        const text = line.toString('utf8').replace(/^\uFEFF/, '');
        if (text.trim()) {
          const record = JSON.parse(text);
          let own = false;
          if (!identityConflict) {
            try { own = canonical.accept(record, lineStart); } catch { identityConflict = true; }
          }
          if (own && record?.type === 'event_msg' && record.payload?.type === 'token_count') tokens.push({
            hash: createHash('sha256').update(line).digest('hex'), kind: classifyTokenEvent(record), projection: observedProjection(record)
          });
        }
        lineStart += line.length + 1; segments = []; length = 0; start = end + 1;
      }
      if (start < n) { const tail = Buffer.from(chunk.subarray(start, n)); segments.push(tail); length += tail.length; }
    }
    if (length || digest.digest('hex') !== source.anchor_sha256) return null;
    const after = fs.fstatSync(fd);
    if (after.size < before.size || after.size === before.size && after.mtimeMs !== before.mtimeMs) return null;
    try { canonical.finish(source.session_id); } catch { identityConflict = true; }
    if (identityConflict || tokens.length !== expected.length
      || tokens.some((token, i) => token.hash !== expected[i].raw_event_sha256
        || Object.entries(token.projection).some(([key, value]) => value !== expected[i][key]))) return { conflict: true };
    return { kinds: new Map(expected.map((row, i) => [row.event_seq, tokens[i].kind])),
      file, fileStamp: historyCache.signature(after), verifiedAt: new Date().toISOString() };
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
// Candidate identity is only an index hint. Acceptance still requires the exact
// authenticated prefix and full canonical mapping. Each candidate is probed once
// per resolver, so unrelated archive files are not fully hashed for every source.
function candidateIdentity(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const initial = fs.fstatSync(fd);
    if (!initial.isFile()) return null;
    const chunk = Buffer.alloc(8192), segments = [];
    let length = 0, offset = 0;
    while (offset < initial.size) {
      const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, initial.size - offset), offset); if (!n) return null;
      offset += n;
      let start = 0, end;
      while ((end = chunk.indexOf(10, start)) >= 0 && end < n) {
        const tail = chunk.subarray(start, end), line = segments.length ? Buffer.concat([...segments, tail], length + tail.length) : tail;
        const text = line.toString('utf8').replace(/^\uFEFF/, '');
        if (text.trim()) {
          const record = JSON.parse(text);
          if (record?.type === 'session_meta') return sessionIdentity(record.payload);
        }
        segments.length = 0; length = 0; start = end + 1;
      }
      if (start < n) { const tail = Buffer.from(chunk.subarray(start, n)); segments.push(tail); length += tail.length; }
    }
    return null;
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// v1 event classifications predate ownership validation. A versioned per-source
// seal binds persisted evidence to the exact fully validated source/row mapping.
// This is durable provenance, not a disk cache or a claim of live file freshness.
const sealKey = id => 'ownership_proof_v' + PARSER_VERSION + ':' + id;
function ownershipBinding(source, rows, evidence) {
  return createHash('sha256').update(JSON.stringify([PARSER_VERSION, VERIFIER_VERSION,
    source.session_id, source.checkpoint_byte_offset, source.last_event_seq,
    source.anchor_start_offset, source.anchor_end_offset, source.anchor_sha256, rows, evidence])).digest('hex');
}
function writeOwnershipProof(db, id) {
  const source = db.prepare('SELECT * FROM sources WHERE session_id=?').get(id);
  const rows = db.prepare('SELECT * FROM telemetry_events WHERE session_id=? ORDER BY event_seq').all(id);
  const evidence = db.prepare('SELECT * FROM event_provenance_v1 WHERE session_id=? ORDER BY event_seq').all(id);
  db.prepare('INSERT OR REPLACE INTO recorder_meta(key,value) VALUES (?,?)').run(sealKey(id), ownershipBinding(source, rows, evidence));
}
function writeOwnershipConflict(db, id) {
  const source = db.prepare('SELECT * FROM sources WHERE session_id=?').get(id);
  const rows = db.prepare('SELECT * FROM telemetry_events WHERE session_id=? ORDER BY event_seq').all(id);
  db.prepare('INSERT OR REPLACE INTO recorder_meta(key,value) VALUES (?,?)')
    .run(sealKey(id), 'conflict:' + ownershipBinding(source, rows, []));
}
function certifyRecordedSource(db, id) {
  const source = db.prepare('SELECT * FROM sources WHERE session_id=?').get(id);
  const rows = db.prepare('SELECT * FROM telemetry_events WHERE session_id=? ORDER BY event_seq').all(id);
  const verified = verifySource(source.current_path, source, rows);
  if (!verified?.kinds) throw Object.assign(new Error('SOURCE_CERTIFICATION_FAILED'), {code:'SOURCE_CERTIFICATION_FAILED'});
  // Do not countersign stale classifications left by an earlier writer.
  const put = provenanceWriter(db);
  for (const row of rows) put.run(id, row.event_seq, row.raw_event_sha256, verified.kinds.get(row.event_seq));
  writeOwnershipProof(db, id);
}

function createProvenanceResolver(db, home, { verification = 'fresh', dbPath = '', eventsBySource } = {}) {
  const enabled = hasProvenance(db);
  const stored = enabled ? db.prepare(`SELECT usage_kind FROM event_provenance_v1
    WHERE session_id=? AND event_seq=? AND raw_event_sha256=? AND classifier_version=1`) : null;
  const sourceQuery = db.prepare('SELECT * FROM sources WHERE session_id=?');
  // Include ALL committed row fields in the binding, not just the hash column:
  // resequencing, model edits, counter edits and changes made by old writers all
  // produce a different certificate key, even with unchanged filesystem stamps.
  const eventsQuery = db.prepare('SELECT * FROM telemetry_events WHERE session_id=? ORDER BY event_seq');
  const evidenceQuery = enabled ? db.prepare('SELECT * FROM event_provenance_v1 WHERE session_id=? ORDER BY event_seq') : null;
  const recovered = new Map(), sealed = new Set(); let candidates;
  const revision = createHash('sha256'), scope = [path.resolve(home), dbPath ? path.resolve(dbPath) : '', PARSER_VERSION, 1, VERIFIER_VERSION];
  const allMetadata = db.prepare('SELECT * FROM recorder_meta ORDER BY key').all();
  const ownershipProofs = new Map(allMetadata.filter(row => row.key.startsWith('ownership_proof_')).map(row => [row.key, row.value]));
  // A proof for another source is not part of this source's trust binding.
  // Keeping seals separate avoids quadratic serialization after an upgrade.
  const metadata = allMetadata.filter(row => !row.key.startsWith('ownership_proof_'));
  const summary = { mode: verification, liveSourceAttestation: false, checkedSources: 0, reusedSources: 0,
    unavailableSources: 0, conflictingSources: 0, retainedConflicts: 0, oldestVerifiedAt: null, newestVerifiedAt: null };
  function indexedCandidates() {
    if (!candidates) {
      candidates = new Map();
      for (const file of discoverFiles(home).files) {
        const id = candidateIdentity(file);
        if (id) { if (!candidates.has(id)) candidates.set(id, []); candidates.get(id).push(file); }
      }
    }
    return candidates;
  }
  function inspect(id) {
    if (recovered.has(id)) return recovered.get(id);
    const source = sourceQuery.get(id), expected = eventsBySource ? eventsBySource.get(id) || [] : eventsQuery.all(id);
    const evidenceRows = evidenceQuery?.all(id) || [];
    const ownershipProof = ownershipProofs.get(sealKey(id));
    if (enabled && source && ownershipProof?.length === 64
      && ownershipProof === ownershipBinding(source, expected, evidenceRows)) sealed.add(id);
    const binding = source ? [source.session_id, source.checkpoint_byte_offset, source.last_event_seq,
      source.anchor_start_offset, source.anchor_end_offset, source.anchor_sha256, expected] : [id, expected];
    const bindingKey = createHash('sha256').update(JSON.stringify([scope, binding])).digest('hex');
    const key = createHash('sha256').update(JSON.stringify([bindingKey, metadata, ownershipProof, evidenceRows])).digest('hex');
    const persistedConflict = source && ownershipProof?.startsWith('conflict:')
      && ownershipProof === 'conflict:' + ownershipBinding(source, expected, []);
    const knownConflict = historyCache.getConflict(bindingKey) || (persistedConflict ? {conflict:true} : null);
    if (verification === 'fresh') historyCache.remove(key);
    let result = verification === 'snapshot' ? knownConflict || historyCache.get(key) : null;
    if (result) summary.reusedSources++;
    else {
      summary.checkedSources++;
      result = source ? verifySource(source.current_path, source, expected) : expected.length ? { conflict: true } : null;
    }
    if (!result && source) {
      // Archive moves are allowed; only an exact authenticated prefix can win.
      for (const file of indexedCandidates().get(id) || []) {
        if (file === source.current_path) continue;
        result = verifySource(file, source, expected);
        if (result) break;
      }
    }
    if (!result && knownConflict) { result = knownConflict; summary.retainedConflicts++; }
    // Old v1 classifications do not prove that the current parser accepted the
    // sequence. Without source bytes or a current seal, withhold certification
    // even when numeric rows alone happen to form a plausible cumulative series.
    if (!result && enabled && evidenceRows.length && !sealed.has(id)) result = { conflict: true, unverifiedOwnership: true };
    if (result?.conflict) {
      result = { ...result, verifiedAt: result.verifiedAt || new Date().toISOString() };
      if (!result.unverifiedOwnership) historyCache.putConflict(bindingKey, result);
    }
    if (result?.kinds) {
      historyCache.put(key, result);
      summary.oldestVerifiedAt = !summary.oldestVerifiedAt || result.verifiedAt < summary.oldestVerifiedAt ? result.verifiedAt : summary.oldestVerifiedAt;
      summary.newestVerifiedAt = !summary.newestVerifiedAt || result.verifiedAt > summary.newestVerifiedAt ? result.verifiedAt : summary.newestVerifiedAt;
    } else if (result?.conflict) summary.conflictingSources++;
    else summary.unavailableSources++;
    revision.update(key).update(result?.kinds ? 'verified@' + result.verifiedAt : result?.conflict ? 'conflict@' + result.verifiedAt : 'unavailable');
    recovered.set(id, result); return result;
  }
  return {
    kind(row) {
      const authenticated = recovered.get(row.session_id)?.kinds?.get(row.event_seq);
      if (authenticated) return authenticated === 'allowance_only' && !allUsageAbsent(row) ? 'unknown' : authenticated;
      const persisted = /^[a-f0-9]{64}$/.test(row.raw_event_sha256 || '')
        ? stored?.get(row.session_id, row.event_seq, row.raw_event_sha256)?.usage_kind : undefined;
      // Contradictory persisted classification must never hide observed counters.
      if (sealed.has(row.session_id) && persisted && persisted !== 'unknown') return persisted === 'allowance_only' && !allUsageAbsent(row) ? 'unknown' : persisted;
      // Counter presence keeps usage applicable; recovery never supplies counters.
      if (!allUsageAbsent(row)) return 'unknown';
      return inspect(row.session_id)?.kinds?.get(row.event_seq) || 'unknown';
    },
    recover: id => { const kinds = inspect(id)?.kinds; return kinds ? new Map(kinds) : null; },
    conflict: id => inspect(id)?.conflict === true,
    summary: () => ({ ...summary, snapshotId: revision.copy().digest('hex') })
  };
}
module.exports = { classifyTokenEvent, hasProvenance, createProvenance, provenanceWriter, createProvenanceResolver, allUsageAbsent, certifyRecordedSource, writeOwnershipProof, writeOwnershipConflict };
