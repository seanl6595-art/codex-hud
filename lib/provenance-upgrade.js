'use strict';
const { defaultDatabasePath, openReadOnlyDatabase } = require('./recorder-db');
const { defaultCodexHome } = require('./sessions');
const { hasProvenance, createProvenance, provenanceWriter, createProvenanceResolver, writeOwnershipProof, writeOwnershipConflict } = require('./event-provenance');

// Explicit opt-in only. Never called by Stats, GUI reads, or Recorder startup.
function upgradeProvenance({ dbPath = defaultDatabasePath(), home = defaultCodexHome(), beforeCommit } = {}) {
  // Validate without creating a missing DB or initializing any writer schema.
  const reader = openReadOnlyDatabase(dbPath); reader.close();
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath); let transaction = false;
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE'); transaction = true;
    if (db.prepare("SELECT value FROM recorder_meta WHERE key='schema_version'").get()?.value !== '1') {
      throw new Error('Unsupported recorder schema version; database left unchanged.');
    }
    const existing = hasProvenance(db);
    // Explicit persistence always re-verifies bytes; do not promote a cached
    // as-of certificate into durable evidence without this fresh check.
    const resolver = createProvenanceResolver(db, home, { verification: 'fresh', dbPath });
    createProvenance(db);
    const put = provenanceWriter(db), report = { extensionVersion: 1, alreadyPresent: existing, verified: 0, unknown: 0, conflictingSources: 0 };
    for (const source of db.prepare('SELECT session_id FROM sources ORDER BY session_id').all()) {
      const kinds = resolver.recover(source.session_id);
      if (resolver.conflict(source.session_id)) {
        report.conflictingSources++;
        // Explicit upgrade must not forget a rejected canonical history when the
        // source is subsequently deleted and memory-only witnesses disappear.
        writeOwnershipConflict(db, source.session_id);
      }
      for (const row of db.prepare('SELECT event_seq,raw_event_sha256 FROM telemetry_events WHERE session_id=? ORDER BY event_seq').all(source.session_id)) {
        const kind = kinds?.get(row.event_seq);
        if (kind) { put.run(source.session_id, row.event_seq, row.raw_event_sha256, kind); report.verified++; }
        else report.unknown++; // Never replace earlier trustworthy evidence with a guess.
      }
      if (kinds) writeOwnershipProof(db, source.session_id);
    }
    beforeCommit?.();
    db.exec('COMMIT'); transaction = false; return report;
  } finally { if (transaction) db.exec('ROLLBACK'); db.close(); }
}
module.exports = { upgradeProvenance };
