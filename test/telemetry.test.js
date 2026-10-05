'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { normalizeUsage, parseTelemetry, modelDisplayName } = require('../lib/telemetry');
const { projectRecord } = require('../lib/jsonl');
const { record, meta, context, token, usage } = require('./helpers');
const parse = records => parseTelemetry(records.map(projectRecord).filter(Boolean));
test('cached is input subset; fresh subtracts cached; reasoning is output subset', () => {
  const u = normalizeUsage(usage());
  assert.equal(u.freshInputTokens, 200); assert.equal(u.totalTokens, 1100);
  assert.equal(u.cacheHitPercent, 80); assert.equal(u.reasoningOutputTokens, 40);
});
test('invalid subsets are unknown, never clamped into invented usage', () => {
  const u = normalizeUsage(usage(20, 30, 5, 10));
  assert.equal(u.freshInputTokens, null); assert.equal(u.cachedInputTokens, null);
  assert.equal(u.reasoningOutputTokens, null); assert.equal(u.invalidSubsets, true);
});
test('missing counters remain unknown and cannot become zero', () => {
  assert.equal(normalizeUsage({}).inputTokens, null); assert.equal(normalizeUsage(null), null);
  assert.equal(normalizeUsage({ input_tokens: '123' }).inputTokens, null);
});
test('allowance-only token event does not erase last request or totals or add turns', () => {
  const s = parse([meta(), context(), token(), token(null)]);
  assert.equal(s.lastRequest.inputTokens, 1000); assert.equal(s.totals.inputTokens, 1000);
  assert.equal(s.turns, 1); assert.equal(s.requestCount, 1); assert.equal(s.tokenEvents, 2);
  assert.equal(s.subscription, undefined); assert.equal(s.plan, undefined);
});
test('deduplicated turns use task_started and turn_context IDs, not token events', () => {
  const s = parse([meta(), record('event_msg', { type: 'task_started', turn_id: 'turn-1' }), context(), token(), token(), context('turn-2'), token()]);
  assert.equal(s.turns, 2); assert.equal(s.requestCount, 1);
});
test('unknown turns do not guess from request counts', () => {
  assert.equal(parse([meta(), token()]).turns, null);
});
test('context comes only from selected file and uses last-request input', () => {
  const s = parse([meta(), context(), token()]);
  assert.equal(s.context.inputTokens, 1000); assert.equal(s.context.usedPercent, 10);
  assert.equal(s.modelName, 'GPT-6.1 Sol'); assert.equal(s.reasoningEffort, 'high');
});
test('cumulative snapshots replace totals and are not repeatedly summed', () => {
  const info = { total_token_usage: usage(3000, 2400, 400, 100), last_token_usage: usage(2000, 1600, 300, 60) };
  const s = parse([meta(), token(), token(info), token(info)]);
  assert.equal(s.totals.inputTokens, 3000); assert.equal(s.totals.totalTokens, 3400); assert.equal(s.requestCount, 2);
});
test('model and effort can change inside selected session', () => {
  const s = parse([meta(), context(), context('turn-2', 'custom-model')]);
  assert.equal(s.modelName, 'custom-model'); assert.equal(modelDisplayName('gpt-6-astra'), 'GPT-6 Astra');
});
test('projection drops message text, instructions, unrelated telemetry and response IDs', () => {
  const p = projectRecord(record('session_meta', { id: 'a', cwd: 'x', base_instructions: 'PRIVATE', creator_user_id: 'private' }));
  assert.ok(!JSON.stringify(p).includes('PRIVATE')); assert.ok(!JSON.stringify(p).includes('creator_user_id'));
  assert.equal(projectRecord(record('response_item', { content: 'private' })), null);
});
