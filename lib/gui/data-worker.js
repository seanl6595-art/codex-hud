'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const { DataSource } = require('../data');
const { readSessionIndex } = require('../sessions');
const { getHistoricalUsageStats } = require('../stats');
const { openReadOnlyDatabase } = require('../recorder-db');
const { inspectRecorderSources } = require('../recorder');
const source = new DataSource(workerData.home);
let known = new Map();
function database(fn, fallback) {
  if (!fs.existsSync(workerData.dbPath)) return fallback;
  const db = openReadOnlyDatabase(workerData.dbPath);
  try { return fn(db); } finally { db.close(); }
}
function metadata() {
  return database(db => ({ exists: true,
    events: db.prepare('SELECT count(*) AS n FROM telemetry_events').get().n,
    sources: db.prepare('SELECT count(*) AS n FROM sources').get().n,
    latestSourceUpdate: db.prepare('SELECT max(updated_at) AS at FROM sources').get().at
  }), { exists: false, events: 0, sources: 0, latestSourceUpdate: null });
}
async function sessions() {
  const listed = await source.list(); known = new Map(listed.sessions.map(s => [s.id, s]));
  const names = readSessionIndex(workerData.home);
  const recorded = database(db => db.prepare(`SELECT e.session_id, e.model, e.event_timestamp,
    (SELECT count(*) FROM telemetry_events x WHERE x.session_id=e.session_id AND x.model='codex-auto-review') AS review_events,
    (SELECT count(*) FROM telemetry_events x WHERE x.session_id=e.session_id AND x.model IS NOT NULL AND trim(x.model)<>'' AND x.model<>'codex-auto-review') AS other_model_events
    FROM telemetry_events e WHERE e.event_seq = (SELECT max(x.event_seq) FROM telemetry_events x WHERE x.session_id=e.session_id)`).all(), []);
  const result = new Map(listed.sessions.map(s => [s.id, { id: s.id, name: s.name, project: s.project,
    model: s.model, updatedAt: s.updatedAt, archived: s.archived, recorded: false, hasLocalTelemetry: true, isAutoReview: s.model === 'codex-auto-review', reviewClassification: s.model === 'codex-auto-review' ? 'observed-model' : null }]));
  for (const row of recorded) {
    const old = result.get(row.session_id);
    const classification = row.review_events > 0 && row.other_model_events === 0 ? {isAutoReview:true,reviewClassification:'recorded-models'} : {isAutoReview:false,reviewClassification:null};
    result.set(row.session_id, old ? { ...old, recorded: true, ...classification } : { id: row.session_id,
      name: names.get(row.session_id)?.name || 'Session ' + row.session_id.slice(0, 8), project: 'Recorded history',
      model: row.model, updatedAt: row.event_timestamp, archived: false, recorded: true, hasLocalTelemetry: false, ...classification });
  }
  return { sessions: [...result.values()].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    diagnostics: { errors: listed.errors.length } };
}
async function detail(id) {
  const catalog = await sessions();
  const session = catalog.sessions.find(s => s.id === id);
  if (!session) throw Object.assign(new Error('Session not found.'), { code: 'NOT_FOUND' });
  const local = known.get(id);
  const telemetry = local ? (await source.view(local)).telemetry : null;
  const recent = database(db => db.prepare('SELECT event_seq, event_timestamp, model, reasoning_effort, input_tokens, output_tokens, context_window_tokens FROM telemetry_events WHERE session_id=? ORDER BY event_seq DESC LIMIT 12').all(id), []);
  return { session, telemetry, recent };
}
let queue = Promise.resolve();
parentPort.on('message', message => {
  queue = queue.then(async () => {
    try {
      const data = message.method === 'stats' ? getHistoricalUsageStats({ ...message.args, ...workerData })
        : message.method === 'diagnostics' ? await inspectRecorderSources(workerData)
        : message.method === 'sessions' ? await sessions()
        : message.method === 'detail' ? await detail(message.args.id) : metadata();
      parentPort.postMessage({ id: message.id, data });
    } catch (e) {
      parentPort.postMessage({ id: message.id, error: { message: e.message,
        code: e.code || (/database not found/i.test(e.message) ? 'DB_MISSING' : 'READ_ERROR') } });
    }
  });
});
