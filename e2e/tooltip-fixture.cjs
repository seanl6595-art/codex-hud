'use strict';
const path = require('node:path');
const { fixture: temporaryFixture, meta, context, token, usage } = require('../test/helpers');
const { Recorder } = require('../lib/recorder');
const { parseLocalDateTime } = require('../lib/stats');
const HOUR = 3600000;

// Isolated, clock-independent observations for real API and browser checks.
// Four elapsed hours also cover Vancouver's skipped/repeated local DST hour.
async function createTooltipFixture(from = '2026-03-08T00:00', to = '2026-03-08T05:00') {
  let cleanup;
  const f = temporaryFixture({ after: fn => { cleanup = fn; } });
  const dbPath = path.join(f.home, 'synthetic.sqlite3');
  const timezone = 'America/Vancouver';
  const start = Date.parse(parseLocalDateTime(from, timezone));
  const end = Date.parse(parseLocalDateTime(to, timezone));
  if (end - start !== 4 * HOUR) { cleanup(); throw new Error('Tooltip fixture requires four elapsed hours.'); }
  const observation = (at, input, output, lastInput, lastOutput) => token({
    total_token_usage: usage(input, 0, output, 0),
    last_token_usage: usage(lastInput, 0, lastOutput, 0)
  }, null, at);
  f.write('sessions/synthetic-tooltip.jsonl', [
    { ...meta('synthetic-tooltip'), timestamp: new Date(start).toISOString() },
    { ...context('synthetic-tooltip-turn', 'synthetic-tooltip-model'), timestamp: new Date(start).toISOString() },
    observation(start, 100, 10, 100, 10), // Inclusive start: positive observation.
    // No event in the second hour: missing, never a claimed zero observation.
    observation(start + 2 * HOUR, 100, 10, 0, 0), // Actual unchanged counters.
    observation(start + 3 * HOUR, 150, 15, 50, 5),
    observation(end, 1150, 115, 1000, 100) // Exclusive end: must not contribute.
  ]);
  const recorder = new Recorder({ home: f.home, dbPath });
  try {
    try {
      const result = await recorder.scan();
      if (result.errors.length) throw new Error('Synthetic tooltip ingestion failed.');
    } finally { recorder.close(); }
  } catch (error) { cleanup(); throw error; }
  return { ...f, dbPath, cleanup, range: { from, to, timezone, localInput: true, buckets: 'hour', analytics: true } };
}
module.exports = { createTooltipFixture };
