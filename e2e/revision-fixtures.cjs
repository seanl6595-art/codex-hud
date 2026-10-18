'use strict';
// Synthetic database rows for display precision and long-ranking browser scenarios.
const fs = require('node:fs'), path = require('node:path');
const { openDatabase } = require('../lib/recorder-db');
function addRows(fixture, rows) {
  const db = openDatabase(fixture.dbPath), stamp = new Date(Date.now() - 3600000).toISOString();
  const columns = ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens'];
  try {
    db.exec('BEGIN');
    const source = db.prepare("INSERT INTO sources (session_id,current_path,checkpoint_byte_offset,last_event_seq,anchor_start_offset,anchor_end_offset,anchor_sha256,last_seen_file_size,updated_at) VALUES (?, 'synthetic-only', 0, 1, 0, 0, 'synthetic-hash', 0, ?)");
    const event = db.prepare('INSERT INTO telemetry_events (session_id,event_seq,event_timestamp,model,reasoning_effort,turn_id,' +
      columns.flatMap(c => [c,'cumulative_' + c]).join(',') + ') VALUES (' + Array(14).fill('?').join(',') + ')');
    for (const row of rows) {
      source.run(row.id,stamp);
      event.run(row.id,1,stamp,'synthetic-model','high','synthetic-turn', ...row.values.flatMap(value => [value,value]));
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.close(); }
  fs.appendFileSync(path.join(fixture.home,'session_index.jsonl'), rows.map(row => JSON.stringify({id:row.id,thread_name:row.name})).join('\n') + '\n');
}
function addRankings(fixture, count = 80) {
  addRows(fixture, Array.from({length:count},(_,index) => ({
    id:'synthetic-ranking-' + String(index + 1).padStart(3,'0'),
    name:index === count - 1 ? 'Deep search target 080' : 'Synthetic ranking ' + String(index + 1).padStart(3,'0'),
    values:[(count-index)*1000,(count-index)*500,(count-index)*100,(count-index)*40]
  })));
}
function addPrecision(fixture) {
  addRows(fixture,[{id:'synthetic-precision',name:'Synthetic tooltip precision',values:[31050070,21050070,153528,53245]}]);
}
module.exports = { addRankings, addPrecision };
