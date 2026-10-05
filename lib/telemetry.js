'use strict';
function nonnegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const input = nonnegative(raw.input_tokens), cached = nonnegative(raw.cached_input_tokens);
  const output = nonnegative(raw.output_tokens), reasoning = nonnegative(raw.reasoning_output_tokens);
  const validCache = cached != null && input != null && cached <= input;
  const validReasoning = reasoning != null && output != null && reasoning <= output;
  return { inputTokens: input, cachedInputTokens: validCache ? cached : null,
    freshInputTokens: validCache ? input - cached : null, outputTokens: output,
    reasoningOutputTokens: validReasoning ? reasoning : null,
    totalTokens: input != null && output != null ? input + output : null,
    cacheHitPercent: validCache && input > 0 ? cached / input * 100 : null,
    invalidSubsets: (cached != null && input != null && !validCache) || (reasoning != null && output != null && !validReasoning) };
}
function modelDisplayName(model) {
  if (!model) return 'unknown';
  return String(model).replace(/^gpt-/i, 'GPT-').replace(/-(sol|astra|luna|terra|mini|nano)(?=-|$)/gi,
    (_, word) => ` ${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`);
}
function parseTelemetry(records, diagnostics = {}) {
  let model = null, effort = null, contextWindow = null, lastRequest = null, totals = null;
  let usageAt = null, updatedAt = null, cwd = null, id = null, tokenEvents = 0, requestCount = 0;
  let previousUsage = null;
  const turns = new Set();
  for (const record of records) {
    const p = record.payload || {}, time = Date.parse(record.timestamp);
    if (Number.isFinite(time) && (!updatedAt || time > Date.parse(updatedAt))) updatedAt = record.timestamp;
    if (record.type === 'session_meta') { id = p.id || id; cwd = p.cwd || cwd; contextWindow = nonnegative(p.contextWindow) || contextWindow; }
    if (record.type === 'turn_context') {
      model = p.model || model; effort = p.effort || effort; cwd = p.cwd || cwd;
      contextWindow = nonnegative(p.model_context_window) || contextWindow;
      if (p.turn_id) turns.add(p.turn_id);
    }
    if (record.type !== 'event_msg') continue;
    if (p.type === 'task_started') {
      if (p.turn_id) turns.add(p.turn_id);
      contextWindow = nonnegative(p.model_context_window) || contextWindow;
    }
    if (p.type !== 'token_count') continue;
    tokenEvents++;
    // Allowance-only events have info:null and must not erase the last request or totals.
    if (!p.info) continue;
    const fingerprint = JSON.stringify([p.info.total_token_usage, p.info.last_token_usage]);
    if (fingerprint !== previousUsage) { requestCount++; previousUsage = fingerprint; }
    if (p.info.total_token_usage) totals = normalizeUsage(p.info.total_token_usage);
    if (p.info.last_token_usage) { lastRequest = normalizeUsage(p.info.last_token_usage); usageAt = record.timestamp || null; }
    contextWindow = nonnegative(p.info.model_context_window) || contextWindow;
  }
  const contextInput = lastRequest?.inputTokens ?? null;
  return { id, cwd, model, modelName: modelDisplayName(model), reasoningEffort: effort,
    context: { inputTokens: contextInput, windowTokens: contextWindow,
      usedPercent: contextWindow && contextInput != null ? contextInput / contextWindow * 100 : null,
      basis: 'last-request input; estimate, not live context occupancy' },
    lastRequest, totals, turns: turns.size || null, requestCount, tokenEvents, usageAt, updatedAt,
    diagnostics: { parseFailures: diagnostics.parseFailures || 0, pendingTail: !!diagnostics.pendingTail, error: diagnostics.error || null } };
}
module.exports = { normalizeUsage, parseTelemetry, modelDisplayName, nonnegative };
