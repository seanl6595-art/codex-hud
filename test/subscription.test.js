'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { JsonlStore, projectRecord } = require('../lib/jsonl');
const { loadSubscription, snapshotFromRecord, evaluateSubscription } = require('../lib/subscription');
const { DataSource } = require('../lib/data');
const { renderHud } = require('../lib/renderer');
const { fixture, NOW, meta, context, token, limit, usage } = require('./helpers');
const snap = (limits, time = NOW) => snapshotFromRecord(projectRecord(token(null, limits, time)), 'anonymous.jsonl', null, NOW);
test('active 5h and weekly show used, remaining and future reset', () => {
  const sub = evaluateSubscription(snap(limit()), NOW);
  assert.equal(sub.fiveHour.state, 'ACTIVE'); assert.equal(sub.fiveHour.usedPercent, 10);
  assert.equal(sub.fiveHour.remainingPercent, 90); assert.equal(sub.weekly.state, 'ACTIVE');
});
test('100% before reset is EXHAUSTED', () => {
  assert.equal(evaluateSubscription(snap(limit(100)), NOW).fiveHour.state, 'EXHAUSTED');
});
test('expired 100% becomes READY, clears current percentages and cannot say reset now', () => {
  const sub = evaluateSubscription(snap(limit(100, NOW / 1000 + 1)), NOW + 1001);
  assert.equal(sub.fiveHour.state, 'READY'); assert.equal(sub.fiveHour.usedPercent, null);
  const text = renderHud({ subscription: sub });
  assert.match(text, /READY \/ INACTIVE/); assert.doesNotMatch(text, /100% used|reset (in )?now/);
});
test('weekly expiry is STALE, never current remaining balance', () => {
  const sub = evaluateSubscription(snap(limit(0, NOW / 1000 + 1, NOW / 1000 + 1)), NOW + 1001);
  assert.equal(sub.weekly.state, 'STALE'); assert.equal(sub.weekly.remainingPercent, null);
});
test('reset already past at event time is UNKNOWN rather than guessed READY', () => {
  assert.equal(evaluateSubscription(snap(limit(100, NOW / 1000 - 1)), NOW).fiveHour.state, 'UNKNOWN');
});
test('READY -> ACTIVE when later telemetry arrives, with incremental append', async t => {
  const f = fixture(t), store = new JsonlStore();
  const file = f.write('sessions/a.jsonl', [meta(), token(null, limit(100, NOW / 1000 + 1), NOW - 5000)]);
  assert.equal((await loadSubscription(f.home, store, NOW + 2000)).fiveHour.state, 'READY');
  fs.appendFileSync(file, JSON.stringify(token(null, limit(2), NOW + 3000)) + '\n');
  const sub = await loadSubscription(f.home, store, NOW + 4000);
  assert.equal(sub.fiveHour.state, 'ACTIVE'); assert.equal(sub.fiveHour.usedPercent, 2);
});
test('two selected historic sessions use the same latest global account snapshot', async t => {
  const f = fixture(t);
  const a = f.write('sessions/a.jsonl', [meta('a'), context(), token(undefined, limit(100, NOW / 1000 - 100), NOW - 1000000)]);
  const b = f.write('archived_sessions/b.jsonl', [meta('b'), context('turn-b', 'gpt-6-luna'), token({ total_token_usage: usage(50, 10), last_token_usage: usage(50, 10) }, limit(70), NOW - 500000)]);
  f.write('sessions/latest.jsonl', [meta('new'), token(null, limit(4), NOW)]);
  const source = new DataSource(f.home), first = await source.view({ id: 'a', file: a }, NOW), second = await source.view({ id: 'b', file: b }, NOW);
  assert.deepEqual(first.subscription, second.subscription); assert.equal(first.subscription.fiveHour.usedPercent, 4);
  assert.equal(first.telemetry.lastRequest.inputTokens, 1000); assert.equal(second.telemetry.lastRequest.inputTokens, 50);
  assert.equal(first.telemetry.modelName, 'GPT-6.1 Sol'); assert.equal(second.telemetry.modelName, 'GPT-6 Luna');
});
test('event timestamp beats filename and file mtime, also inside a file', async t => {
  const f = fixture(t), old = f.write('sessions/z-new-name.jsonl', [meta(), token(null, limit(90), NOW - 5000)]);
  fs.utimesSync(old, new Date(NOW + 1e7), new Date(NOW + 1e7));
  f.write('archived_sessions/a-old-name.jsonl', [meta(), token(null, limit(3), NOW), token(null, limit(50), NOW - 2000)]);
  const sub = await loadSubscription(f.home, new JsonlStore(), NOW);
  assert.equal(sub.fiveHour.usedPercent, 3);
});
test('newer premium and base pools do not overwrite codex account allowance', async t => {
  const f = fixture(t); f.write('sessions/a.jsonl', [meta(), token(null, limit(4), NOW - 1000),
    token(null, { ...limit(90), limit_id: 'premium' }), token(null, { ...limit(95), limit_id: 'base_model_inference' })]);
  assert.equal((await loadSubscription(f.home, new JsonlStore(), NOW)).fiveHour.usedPercent, 4);
});
test('swapped primary/secondary are classified by window_minutes', () => {
  const l = limit(); [l.primary, l.secondary] = [l.secondary, l.primary];
  assert.equal(evaluateSubscription(snap(l), NOW).fiveHour.usedPercent, 10);
});
test('duplicate five-hour or weekly durations are ambiguous rather than first-slot wins', () => {
  for (const [minutes,key] of [[300,'fiveHour'],[10080,'weekly']]) {
    const l=limit(); l.primary.window_minutes=minutes; l.secondary.window_minutes=minutes;
    const s=evaluateSubscription(snap(l),NOW); assert.equal(s[key].state,'UNKNOWN');
    assert.equal(s[key].usedPercent,null); assert.match(s[key].reason,/ambiguous/);
  }
});
test('weekly-only prolite preserves absent five-hour UNKNOWN independently of plan label', () => {
  const l=limit(); l.plan_type='prolite'; l.primary=l.secondary; l.secondary=null;
  const s=evaluateSubscription(snap(l),NOW); assert.equal(s.plan,'prolite'); assert.equal(s.weekly.state,'ACTIVE');
  assert.equal(s.fiveHour.state,'UNKNOWN'); assert.equal(s.fiveHour.usedPercent,null);
});
test('invalid timestamp, future timestamp and malformed percentage are unknown', () => {
  assert.equal(snapshotFromRecord({ type: 'event_msg', timestamp: 'bad', payload: { type: 'token_count', rate_limits: limit() } }, 'x', null, NOW), null);
  assert.equal(snap(limit(), NOW + 120000), null);
  const l = limit(); l.primary.used_percent = null;
  assert.equal(evaluateSubscription(snap(l), NOW).fiveHour.state, 'UNKNOWN');
});
test('new partial snapshot does not reuse older missing weekly data or session plan', () => {
  const l = limit(); l.secondary = null; l.plan_type = null;
  const sub = evaluateSubscription(snap(l), NOW);
  assert.equal(sub.weekly.state, 'UNKNOWN'); assert.equal(sub.plan, 'unknown');
});
test('missing global data is UNKNOWN and reports unverified identity', async t => {
  const f = fixture(t), sub = await loadSubscription(f.home, new JsonlStore(), NOW);
  assert.equal(sub.fiveHour.state, 'UNKNOWN'); assert.equal(sub.weekly.state, 'UNKNOWN');
  assert.match(sub.identity, /unverified/);
});
test('malformed complete lines make the global scan explicitly incomplete', async t => {
  const f = fixture(t); f.write('sessions/a.jsonl', [meta(), token(), '{malformed']);
  const sub = await loadSubscription(f.home, new JsonlStore(), NOW);
  assert.equal(sub.coverage, 'incomplete'); assert.equal(sub.errors[0].code, 'MALFORMED_JSONL');
});
