'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createTooltipFixture } = require('../e2e/tooltip-fixture.cjs');
const { getHistoricalUsageStats } = require('../lib/stats');
const { Recorder } = require('../lib/recorder');
const { meta, context, token, usage } = require('./helpers');
const query = f => getHistoricalUsageStats({ home: f.home, dbPath: f.dbPath, ...f.range });
function assertStates(s) {
  assert.deepEqual(s.buckets.map(b => b.state), ['observed', 'missing', 'zero', 'observed']);
  assert.deepEqual(s.buckets.map(b => b.observations), [1, 0, 1, 1]);
  assert.equal(s.totals.input.value, 150);
  assert.equal(s.totals.output.value, 15);
  assert.equal(s.totals.input.complete, true);
  assert.equal(s.buckets[1].observations, 0);
  assert.equal(s.buckets[2].totals.input.value, 0);
  assert.equal(s.buckets[2].totals.output.value, 0);
  assert.equal(s.buckets[2].totals.input.complete, true);
  assert.equal(s.analytics.totals.input.value, 150);
}
for (const [name, from, to] of [
  ['ordinary date', '2026-01-01T00:00', '2026-01-01T04:00'],
  ['spring DST gap', '2026-03-08T00:00', '2026-03-08T05:00'],
  ['fall DST repeated hour', '2025-11-02T00:00', '2025-11-02T03:00']
]) test('tooltip fixture preserves missing/zero and half-open boundaries across ' + name, async t => {
  const f = await createTooltipFixture(from, to); t.after(f.cleanup);
  const s = query(f); assertStates(s);
  const keys = s.buckets.map(b => Date.parse(b.key));
  assert.ok(keys.every((key, i) => i === 0 || key - keys[i - 1] === 3600000));
});
test('tooltip fixture custom bounds remain identical across different wall clocks', async t => {
  const f = await createTooltipFixture(); t.after(f.cleanup);
  const originalNow = Date.now;
  try {
    for (const at of ['2026-10-18T12:30:00Z', '2026-10-18T13:30:00Z', '2030-01-01T00:00:00Z']) {
      Date.now = () => Date.parse(at);
      assertStates(query(f));
    }
  } finally { Date.now = originalNow; }
});
test('positive usage from another source makes a zero-observation bucket observed without filling a missing hour', async t => {
  const f = await createTooltipFixture(); t.after(f.cleanup);
  const initial = query(f), at = Date.parse(initial.buckets[2].key);
  f.write('sessions/synthetic-overlap.jsonl', [
    { ...meta('synthetic-overlap'), timestamp: new Date(at).toISOString() }, context(),
    token({ total_token_usage: usage(20, 0, 2, 0), last_token_usage: usage(20, 0, 2, 0) }, null, at)
  ]);
  const recorder = new Recorder({ home: f.home, dbPath: f.dbPath });
  try { assert.deepEqual((await recorder.scan()).errors, []); } finally { recorder.close(); }
  const s = query(f);
  assert.deepEqual(s.buckets.map(b => b.state), ['observed', 'missing', 'observed', 'observed']);
  assert.equal(s.buckets[2].observations, 2);
  assert.equal(s.buckets[2].totals.input.value, 20);
  assert.equal(s.totals.input.value, 170);
});
