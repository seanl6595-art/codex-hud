'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { discoverFiles } = require('./jsonl');
const { defaultCodexHome } = require('./sessions');
const { openDatabase, defaultDatabasePath, EVENT_COLUMNS, SOURCE_COLUMNS, COUNTERS } = require('./recorder-db');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;
const timestamp = value => text(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const emptyState = () => ({ turn_id: null, model: null, reasoning_effort: null, context_window_tokens: null });
const operationalError = code => Object.assign(new Error(code), { code });
// Modern session_id groups root + subagents; id identifies this independent rollout.
// Approved contract mapping: normalized DB session_id is the stable per-thread id.
const sessionIdentity = p => text(p?.id) || text(p?.session_id);

// Newline-terminated records only. Offsets and hashes are bytes (including CRLF/UTF-8).
async function* completeLines(handle, start, end) {
  const chunk = Buffer.alloc(64 * 1024);
  let offset = start, carry = Buffer.alloc(0), lineStart = start;
  while (offset < end) {
    const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, end - offset), offset);
    if (!bytesRead) throw operationalError('SOURCE_CHANGED_DURING_READ');
    offset += bytesRead;
    const bytes = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
    let from = 0, newline;
    while ((newline = bytes.indexOf(10, from)) !== -1) {
      const line = bytes.subarray(from, newline), next = lineStart + line.length + 1;
      yield { line, start: lineStart, end: next };
      lineStart = next; from = newline + 1;
    }
    carry = Buffer.from(bytes.subarray(from));
  }
}
function parseLine(line) {
  if (!line.toString('utf8').trim()) return null;
  try { return JSON.parse(line.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw operationalError('MALFORMED_COMPLETE_RECORD'); }
}
async function prefixHash(handle, end) {
  const digest = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
  let offset = 0;
  while (offset < end) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, end - offset), offset);
    if (!bytesRead) throw operationalError('SOURCE_CHANGED_DURING_READ');
    digest.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
  }
  return digest;
}
async function completeEnd(handle, size) {
  const buffer = Buffer.alloc(64 * 1024);
  let end = size;
  while (end > 0) {
    const start = Math.max(0, end - buffer.length);
    const { bytesRead } = await handle.read(buffer, 0, end - start, start);
    if (bytesRead !== end - start) throw operationalError('SOURCE_CHANGED_DURING_READ');
    const newline = buffer.subarray(0, bytesRead).lastIndexOf(10);
    if (newline !== -1) return start + newline + 1;
    end = start;
  }
  return 0;
}
async function identify(file) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const size = (await handle.stat()).size;
    for await (const { line } of completeLines(handle, 0, size)) {
      const r = parseLine(line);
      if (r?.type === 'session_meta') {
        const id = sessionIdentity(r.payload);
        if (!id) throw operationalError('MISSING_SESSION_ID');
        return { id, file, size };
      }
    }
    throw operationalError('MISSING_SESSION_ID');
  } finally { await handle.close(); }
}
function updateState(state, r) {
  const p = r?.payload;
  if (!p || typeof p !== 'object') return;
  const settings = p.collaboration_mode?.settings;
  if (r.type === 'turn_context') {
    state.turn_id = text(p.turn_id);
    state.model = text(p.model) || text(settings?.model);
    state.reasoning_effort = text(p.effort) || text(p.reasoning_effort) || text(settings?.reasoning_effort);
    if (Object.hasOwn(p, 'model_context_window') || Object.hasOwn(p, 'context_window')) {
      state.context_window_tokens = number(p.model_context_window) ?? number(p.context_window);
    }
  } else if (r.type === 'event_msg' && p.type === 'task_started') {
    Object.assign(state, emptyState(), { turn_id: text(p.turn_id),
      context_window_tokens: number(p.model_context_window) });
  } else if (r.type === 'event_msg' && ['task_complete', 'task_aborted', 'turn_aborted'].includes(p.type)) {
    Object.assign(state, emptyState());
  } else if (r.type === 'session_meta') {
    state.model = text(p.model);
    state.reasoning_effort = text(p.effort) || text(p.reasoning_effort);
    state.context_window_tokens = number(p.model_context_window) ?? number(p.context_window);
  }
  if (r.type === 'event_msg' && p.type === 'token_count' && p.info && Object.hasOwn(p.info, 'model_context_window')) {
    state.context_window_tokens = number(p.info.model_context_window);
  }
}
function eventRow(id, seq, r, line, state, now) {
  const p = r.payload, row = { session_id: id, event_seq: seq,
    event_timestamp: timestamp(r.timestamp), raw_event_sha256: hash(line), ...state,
    plan_type: text(p.rate_limits?.plan_type), limit_id: text(p.rate_limits?.limit_id), ingested_at: now };
  for (const key of COUNTERS) {
    row[key] = number(p.info?.last_token_usage?.[key]);
    row[`cumulative_${key}`] = number(p.info?.total_token_usage?.[key]);
  }
  for (const side of ['primary', 'secondary']) for (const key of ['used_percent', 'window_minutes', 'resets_at']) {
    row[`${side}_${key}`] = number(p.rate_limits?.[side]?.[key]);
  }
  return row;
}

class Recorder {
  constructor({ home = defaultCodexHome(), dbPath = defaultDatabasePath(), beforeCommit = null } = {}) {
    this.home = path.resolve(home); this.dbPath = dbPath === ':memory:' ? dbPath : path.resolve(dbPath);
    this.db = openDatabase(this.dbPath); this.beforeCommit = beforeCommit; this.scanning = false;
    this.getSource = this.db.prepare('SELECT * FROM sources WHERE session_id = ?');
    this.putSource = this.db.prepare(`INSERT INTO sources (${SOURCE_COLUMNS.join(',')}) VALUES (${SOURCE_COLUMNS.map(() => '?').join(',')})
      ON CONFLICT(session_id) DO UPDATE SET ${SOURCE_COLUMNS.slice(1).map(key => `${key}=excluded.${key}`).join(',')}`);
    this.putEvent = this.db.prepare(`INSERT INTO telemetry_events (${EVENT_COLUMNS.join(',')}) VALUES (${EVENT_COLUMNS.map(() => '?').join(',')})`);
  }
  close() { this.db.close(); }
  counts() {
    return { sources: this.db.prepare('SELECT count(*) AS n FROM sources').get().n,
      events: this.db.prepare('SELECT count(*) AS n FROM telemetry_events').get().n };
  }
  async choose(candidates) {
    // Never alternate between shorter replicas: all complete shared bytes must agree.
    if (candidates.length === 1) return candidates[0];
    const opened = [];
    try {
      for (const candidate of candidates) {
        const handle = await fs.promises.open(candidate.file, 'r');
        const item = { ...candidate, handle }; opened.push(item);
        item.size = (await handle.stat()).size;
        item.completeBytes = await completeEnd(handle, item.size);
      }
      // A large unfinished tail must never displace a more complete replica.
      opened.sort((a, b) => b.completeBytes - a.completeBytes || b.size - a.size || a.file.localeCompare(b.file));
      const winner = opened[0];
      for (const candidate of opened.slice(1)) {
        const end = candidate.completeBytes;
        const a = (await prefixHash(winner.handle, end)).digest('hex');
        const b = (await prefixHash(candidate.handle, end)).digest('hex');
        if (a !== b) throw operationalError('CONFLICTING_SESSION_COPIES');
      }
      return winner;
    } finally { for (const candidate of opened) await candidate.handle.close(); }
  }
  async scan() {
    if (this.scanning) throw operationalError('SCAN_ALREADY_RUNNING');
    this.scanning = true;
    try {
      const discovered = discoverFiles(this.home), groups = new Map();
      const summary = { discovered_files: discovered.files.length, scanned_sources: 0, inserted_events: 0,
        rebuilt_sources: 0, partial_sources: 0, errors: discovered.errors.map(e => ({ code: e.code })) };
      for (const file of discovered.files) {
        try {
          const candidate = await identify(file);
          if (!groups.has(candidate.id)) groups.set(candidate.id, []);
          groups.get(candidate.id).push(candidate);
        } catch (e) { summary.errors.push({ code: e.code || 'SOURCE_READ_ERROR' }); }
      }
      for (const candidates of groups.values()) {
        try {
          const result = await this.ingest(await this.choose(candidates));
          summary.scanned_sources++; summary.inserted_events += result.inserted;
          summary.rebuilt_sources += Number(result.rebuilt); summary.partial_sources += Number(result.partial);
        } catch (e) { summary.errors.push({ code: e.code || 'SOURCE_INGEST_ERROR' }); }
      }
      return { ...summary, ...this.counts() };
    } finally { this.scanning = false; }
  }
  async ingest({ id, file }) {
    const handle = await fs.promises.open(file, 'r');
    let inTransaction = false;
    try {
      // Hold a writer lock while loading the checkpoint: multiple recorders cannot race.
      this.db.exec('BEGIN IMMEDIATE'); inTransaction = true;
      const old = this.getSource.get(id), size = (await handle.stat()).size;
      let rebuild = false, offset = old?.checkpoint_byte_offset || 0, seq = old?.last_event_seq || 0;
      let digest = await prefixHash(handle, size < offset ? 0 : offset);
      if (old && (size < offset || digest.copy().digest('hex') !== old.anchor_sha256)) {
        rebuild = true; offset = 0; seq = 0; digest = createHash('sha256');
      }
      const state = old && !rebuild ? { turn_id: old.state_turn_id, model: old.state_model,
        reasoning_effort: old.state_reasoning_effort, context_window_tokens: old.state_context_window_tokens } : emptyState();
      const now = new Date().toISOString();
      const checkpoint = () => ({ session_id: id, current_path: file, checkpoint_byte_offset: offset,
        last_event_seq: seq, anchor_start_offset: 0, anchor_end_offset: offset,
        anchor_sha256: digest.copy().digest('hex'), last_seen_file_size: size, updated_at: now,
        state_turn_id: state.turn_id, state_model: state.model, state_reasoning_effort: state.reasoning_effort,
        state_context_window_tokens: state.context_window_tokens });
      let cp = checkpoint();
      this.putSource.run(...SOURCE_COLUMNS.map(key => cp[key]));
      if (rebuild) this.db.prepare('DELETE FROM telemetry_events WHERE session_id = ?').run(id);
      let inserted = 0;
      for await (const { line, end } of completeLines(handle, offset, size)) {
        const r = parseLine(line);
        if (r?.type === 'session_meta' && sessionIdentity(r.payload) !== id) {
          throw operationalError('SESSION_ID_CHANGED');
        }
        updateState(state, r);
        if (r?.type === 'event_msg' && r.payload?.type === 'token_count') {
          const row = eventRow(id, ++seq, r, line, state, now);
          this.putEvent.run(...EVENT_COLUMNS.map(key => row[key] ?? null)); inserted++;
        }
        digest.update(line).update('\n'); offset = end;
      }
      cp = checkpoint();
      // Abort safely if bytes were rewritten while parsing. Appends beyond size are next scan's work.
      if ((await prefixHash(handle, offset)).digest('hex') !== cp.anchor_sha256) throw operationalError('SOURCE_CHANGED_DURING_READ');
      this.putSource.run(...SOURCE_COLUMNS.map(key => cp[key]));
      if (this.beforeCommit) await this.beforeCommit({ inserted, rebuilt: rebuild });
      this.db.exec('COMMIT'); inTransaction = false;
      return { inserted, rebuilt: rebuild, partial: offset < size };
    } catch (e) {
      if (inTransaction) this.db.exec('ROLLBACK');
      throw e;
    } finally { await handle.close(); }
  }
}
async function runRecorder({ home, dbPath, once = false, interval = 2000, output = process.stdout } = {}) {
  const recorder = new Recorder({ home, dbPath });
  let stopped = false, wake;
  const stop = () => { stopped = true; if (wake) wake(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    do {
      const summary = await recorder.scan();
      output.write(JSON.stringify({ db_path: recorder.dbPath, ...summary }) + '\n');
      if (once) { if (summary.errors.length) process.exitCode = 1; break; }
      if (!stopped) await new Promise(resolve => {
        const timer = setTimeout(done, interval);
        function done() { clearTimeout(timer); wake = null; resolve(); }
        wake = done;
      });
    } while (!stopped);
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); recorder.close();
  }
}
module.exports = { Recorder, runRecorder };
