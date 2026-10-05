'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { discoverFiles } = require('./jsonl');
const { parseTelemetry } = require('./telemetry');
const defaultCodexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
function projectName(cwd) { return String(cwd || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'unknown'; }
function normalizePath(cwd) {
  const value = String(cwd || '');
  if (/^[a-z]:[\\/]|^\\\\/i.test(value)) return path.win32.normalize(value).replace(/[\\/]+$/, '').toLowerCase();
  return path.posix.normalize(value.replace(/\\/g, '/')).replace(/\/$/, '');
}
function readSessionIndex(home) {
  const names = new Map(); let text;
  try { text = fs.readFileSync(path.join(home, 'session_index.jsonl'), 'utf8'); } catch { return names; }
  for (const line of text.split(/\r?\n/)) {
    try {
      const r = JSON.parse(line.replace(/^\uFEFF/, '')), id = r.id || r.session_id;
      if (!id) continue;
      // Codex's index is append-only: the last rename entry wins, even without updated_at.
      const old = names.get(id) || {};
      names.set(id, { name: r.thread_name || r.name || old.name, updatedAt: r.updated_at || r.timestamp || old.updatedAt });
    } catch { /* Incomplete append is retried on the next refresh. */ }
  }
  return names;
}
function canonicalScore(session) {
  return (path.basename(session.file).toLowerCase().includes(String(session.id).toLowerCase()) ? 2 : 0)
    + (session.model !== 'codex-auto-review' ? 1 : 0);
}
async function listSessions(home, store) {
  const { files, errors } = discoverFiles(home), names = readSessionIndex(home), unique = new Map();
  store.prune(files);
  // Bounded file reads avoid exhausting Windows file handles on large histories.
  for (let start = 0; start < files.length; start += 8) {
    const group = files.slice(start, start + 8);
    const data = await Promise.all(group.map(file => store.read(file)));
    data.forEach((result, i) => {
      const file = group[i];
      if (result.error) { errors.push({ file, code: result.error }); return; }
      const meta = parseTelemetry(result.records, result);
      if (!meta.id) return;
      const indexed = names.get(meta.id), eventTime = Date.parse(meta.updatedAt) || 0;
      const indexedTime = Date.parse(indexed?.updatedAt) || 0;
      const session = { id: meta.id, file, name: indexed?.name || `Session ${String(meta.id).slice(0, 8)}`,
        project: projectName(meta.cwd), cwd: meta.cwd, model: meta.model, modelName: meta.modelName,
        updatedAt: new Date(Math.max(eventTime, indexedTime, eventTime ? 0 : result.mtimeMs)).toISOString(),
        archived: file.includes(`${path.sep}archived_sessions${path.sep}`) };
      const old = unique.get(session.id);
      if (!old || canonicalScore(session) > canonicalScore(old)
        || (canonicalScore(session) === canonicalScore(old) && session.updatedAt > old.updatedAt)) unique.set(session.id, session);
    });
  }
  return { sessions: [...unique.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), errors };
}
module.exports = { defaultCodexHome, listSessions, readSessionIndex, projectName, normalizePath };
