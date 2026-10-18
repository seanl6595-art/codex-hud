'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const COUNTERS = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const EVENT_COLUMNS = ['session_id', 'event_seq', 'event_timestamp', 'raw_event_sha256',
  'turn_id', 'model', 'reasoning_effort', 'context_window_tokens', ...COUNTERS,
  ...COUNTERS.map(key => `cumulative_${key}`),
  'primary_used_percent', 'primary_window_minutes', 'primary_resets_at',
  'secondary_used_percent', 'secondary_window_minutes', 'secondary_resets_at', 'plan_type',
  'limit_id', 'ingested_at'];
const SOURCE_COLUMNS = ['session_id', 'current_path', 'checkpoint_byte_offset', 'last_event_seq',
  'anchor_start_offset', 'anchor_end_offset', 'anchor_sha256', 'last_seen_file_size', 'updated_at',
  'state_turn_id', 'state_model', 'state_reasoning_effort', 'state_context_window_tokens'];
const defaultDatabasePath = () => path.join(os.homedir(), '.codex-hud', 'telemetry.sqlite3');

function openDatabase(file = defaultDatabasePath()) {
  // Load only for record: Node 20 continues to support every v1.0 HUD command.
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch { throw new Error('Recorder requires Node.js 22.13 or newer with node:sqlite (Node 24 recommended).'); }
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    db.exec('BEGIN IMMEDIATE');
    db.exec('CREATE TABLE IF NOT EXISTS recorder_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT');
    const version = db.prepare("SELECT value FROM recorder_meta WHERE key='schema_version'").get();
    if (version && version.value !== '1') throw new Error('Unsupported recorder schema version; database left unchanged.');
    const numericEvents = new Set(['event_seq', 'context_window_tokens', ...COUNTERS, ...COUNTERS.map(key => `cumulative_${key}`),
      ...['primary', 'secondary'].flatMap(side => ['used_percent', 'window_minutes', 'resets_at'].map(key => `${side}_${key}`))]);
    db.exec(`CREATE TABLE IF NOT EXISTS sources (
      session_id TEXT PRIMARY KEY, current_path TEXT NOT NULL,
      checkpoint_byte_offset INTEGER NOT NULL CHECK(checkpoint_byte_offset >= 0),
      last_event_seq INTEGER NOT NULL CHECK(last_event_seq >= 0),
      anchor_start_offset INTEGER NOT NULL CHECK(anchor_start_offset = 0),
      anchor_end_offset INTEGER NOT NULL CHECK(anchor_end_offset = checkpoint_byte_offset),
      anchor_sha256 TEXT NOT NULL, last_seen_file_size INTEGER NOT NULL, updated_at TEXT NOT NULL,
      state_turn_id TEXT, state_model TEXT, state_reasoning_effort TEXT, state_context_window_tokens REAL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS telemetry_events (
      ${EVENT_COLUMNS.map(key => `${key} ${key === 'event_seq' ? 'INTEGER NOT NULL CHECK(event_seq > 0)' : numericEvents.has(key) ? 'REAL' : 'TEXT'}`).join(',\n')},
      PRIMARY KEY(session_id, event_seq), FOREIGN KEY(session_id) REFERENCES sources(session_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS telemetry_event_order ON telemetry_events(event_timestamp, session_id, event_seq);
    CREATE VIEW IF NOT EXISTS event_features_v1 AS SELECT e.*,
      CASE WHEN cached_input_tokens BETWEEN 0 AND input_tokens THEN input_tokens - cached_input_tokens END AS fresh_input_tokens,
      CASE WHEN reasoning_output_tokens BETWEEN 0 AND output_tokens THEN output_tokens - reasoning_output_tokens END AS visible_output_tokens,
      CASE WHEN input_tokens > 0 AND cached_input_tokens BETWEEN 0 AND input_tokens THEN 100.0 * cached_input_tokens / input_tokens END AS cache_hit_percent,
      CASE WHEN context_window_tokens > 0 AND input_tokens >= 0 THEN 100.0 * input_tokens / context_window_tokens END AS context_percent,
      ${['five_hour', 'weekly'].flatMap((name, i) => ['used_percent', 'window_minutes', 'resets_at'].map(field => {
        const minutes = i === 0 ? 300 : 10080;
        // Ambiguous duplicate windows have no canonical mapping.
        return `CASE WHEN primary_window_minutes = ${minutes} AND (secondary_window_minutes IS NULL OR secondary_window_minutes != ${minutes}) THEN primary_${field}
          WHEN secondary_window_minutes = ${minutes} AND (primary_window_minutes IS NULL OR primary_window_minutes != ${minutes}) THEN secondary_${field} END AS ${name}_${field}`;
      })).join(',\n')}
    FROM telemetry_events e;`);
    db.prepare("INSERT OR IGNORE INTO recorder_meta VALUES ('schema_version', '1')").run();
    db.prepare("INSERT OR IGNORE INTO recorder_meta VALUES ('contract', 'recorder_v1')").run();
    // Additive extension on NEW databases only. Existing v1 databases require
    // the explicit upgrade-provenance command; opening one never migrates it.
    if (!version) require('./event-provenance').createProvenance(db);
    else require('./event-provenance').hasProvenance(db);
    db.exec('COMMIT');
    return db;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* Initialization may fail before BEGIN. */ }
    db.close();
    throw error;
  }
}
function openReadOnlyDatabase(file = defaultDatabasePath()) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch { throw new Error('Stats requires Node.js 22.13 or newer with node:sqlite (Node 24 recommended).'); }
  if (!fs.existsSync(file)) throw new Error('Recorder database not found. Run codex-hud record first, or select an existing database with --db.');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    // Connection settings only: no schema initialization, migration or writer PRAGMAs.
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');
    const version = db.prepare("SELECT value FROM recorder_meta WHERE key='schema_version'").get();
    if (version?.value !== '1') throw new Error('Stats requires the existing Recorder v1 schema; no database changes were made.');
    return db;
  } catch (error) { db.close(); throw error; }
}
module.exports = { openDatabase, openReadOnlyDatabase, defaultDatabasePath, EVENT_COLUMNS, SOURCE_COLUMNS, COUNTERS };
