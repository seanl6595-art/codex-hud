'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Project records before caching: prompts, instructions and responses never enter the cache.
function projectRecord(record) {
  const p = record?.payload;
  if (!p || typeof p !== 'object') return null;
  let payload;
  if (record.type === 'session_meta') {
    payload = { id: p.session_id || p.id, cwd: p.cwd, source: p.source,
      accountId: p.creator_account_id, contextWindow: p.context_window };
  } else if (record.type === 'turn_context') {
    const settings = p.collaboration_mode?.settings;
    payload = { turn_id: p.turn_id, cwd: p.cwd, model: p.model || settings?.model,
      effort: p.effort || settings?.reasoning_effort, model_context_window: p.model_context_window };
  } else if (record.type === 'event_msg' && p.type === 'task_started') {
    payload = { type: p.type, turn_id: p.turn_id, model_context_window: p.model_context_window };
  } else if (record.type === 'event_msg' && p.type === 'token_count') {
    payload = { type: p.type, info: p.info, rate_limits: p.rate_limits };
  } else return null;
  return { type: record.type, timestamp: record.timestamp, payload };
}

function discoverFiles(home) {
  const files = [], errors = [];
  for (const name of ['sessions', 'archived_sessions']) {
    const stack = [path.join(home, name)];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch (e) { if (e.code !== 'ENOENT') errors.push({ file: dir, code: e.code }); continue; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full);
      }
    }
  }
  return { files: files.sort(), errors };
}

class JsonlStore {
  constructor() { this.cache = new Map(); this.pending = new Map(); }
  async read(file) {
    if (!this.pending.has(file)) {
      this.pending.set(file, this.readFile(file).finally(() => this.pending.delete(file)));
    }
    return this.pending.get(file);
  }
  async readFile(file) {
    let stat;
    try { stat = await fs.promises.stat(file); }
    catch (e) { this.cache.delete(file); return { records: [], error: e.code, parseFailures: 0 }; }
    if (!stat.isFile()) return { records: [], error: 'NOT_FILE', parseFailures: 0 };
    let state = this.cache.get(file);
    // A replacement, truncation or same-size rewrite invalidates accumulated records.
    if (!state || stat.ino !== state.ino || stat.birthtimeMs !== state.birthtimeMs || stat.size < state.offset
      || (stat.size === state.offset && stat.mtimeMs !== state.mtimeMs)) {
      state = { records: [], offset: 0, carry: Buffer.alloc(0), parseFailures: 0,
        ino: stat.ino, birthtimeMs: stat.birthtimeMs };
    }
    const parse = (line, countFailure) => {
      if (!line.toString('utf8').trim()) return null;
      try { return projectRecord(JSON.parse(line.toString('utf8').replace(/^\uFEFF/, ''))); }
      catch { if (countFailure) state.parseFailures++; return null; }
    };
    try {
      if (stat.size > state.offset) {
        const stream = fs.createReadStream(file, { start: state.offset, end: stat.size - 1 });
        for await (const chunk of stream) {
          const buffer = Buffer.concat([state.carry, chunk]);
          let start = 0, end;
          while ((end = buffer.indexOf(10, start)) !== -1) {
            const r = parse(buffer.subarray(start, end), true);
            if (r) state.records.push(r);
            start = end + 1;
          }
          state.carry = buffer.subarray(start);
        }
      }
      state.offset = stat.size;
      state.mtimeMs = stat.mtimeMs;
      this.cache.set(file, state);
      // A complete EOF record without a newline is visible, but not committed twice on append.
      const tail = parse(state.carry, false);
      let pendingTail = false;
      if (state.carry.length) {
        try { JSON.parse(state.carry.toString('utf8').replace(/^\uFEFF/, '')); }
        catch { pendingTail = !!state.carry.toString('utf8').trim(); }
      }
      return { records: tail ? [...state.records, tail] : state.records,
        parseFailures: state.parseFailures, pendingTail,
        error: null, mtimeMs: stat.mtimeMs };
    } catch (e) {
      this.cache.delete(file);
      return { records: [], parseFailures: state.parseFailures, error: e.code || 'READ_ERROR' };
    }
  }
  prune(files) { const keep = new Set(files); for (const file of this.cache.keys()) if (!keep.has(file)) this.cache.delete(file); }
}
module.exports = { JsonlStore, discoverFiles, projectRecord };
