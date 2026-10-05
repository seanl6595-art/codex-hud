'use strict';
const { discoverFiles } = require('./jsonl');
const { nonnegative } = require('./telemetry');

function normalizeLimit(raw, minutes, timestamp) {
  if (!raw || raw.window_minutes !== minutes) return null;
  const usedPercent = nonnegative(raw.used_percent), resetsAt = nonnegative(raw.resets_at);
  if (usedPercent == null || usedPercent > 100 || !resetsAt) return null;
  // An already-expired reset at the time of the event is inconsistent, not an inactive-window signal.
  if (resetsAt * 1000 <= timestamp) return { invalid: true, reason: 'reset precedes snapshot' };
  return { usedPercent, remainingPercent: 100 - usedPercent, resetsAt, windowMinutes: minutes };
}
function snapshotFromRecord(record, file, accountId, now = Date.now()) {
  const p = record.payload || {}, raw = p.rate_limits, timestamp = Date.parse(record.timestamp);
  if (record.type !== 'event_msg' || p.type !== 'token_count' || !raw || !Number.isFinite(timestamp) || timestamp > now + 60000) return null;
  // These are separate allowance pools. Never substitute premium/base inference for codex.
  if (raw.limit_id && raw.limit_id !== 'codex') return null;
  const windows = [raw.primary, raw.secondary];
  const fiveHour = normalizeLimit(windows.find(w => w?.window_minutes === 300), 300, timestamp);
  const weekly = normalizeLimit(windows.find(w => w?.window_minutes === 10080), 10080, timestamp);
  if (!fiveHour && !weekly && typeof raw.plan_type !== 'string') return null;
  return { timestamp, observedAt: record.timestamp, file, accountId: accountId || null,
    pool: raw.limit_id || 'legacy-unlabelled', plan: raw.plan_type || null, fiveHour, weekly };
}
function windowState(limit, kind, now) {
  if (!limit || limit.invalid) return { state: 'UNKNOWN', usedPercent: null, remainingPercent: null,
    reason: limit?.reason || 'no valid telemetry for this window' };
  if (now >= limit.resetsAt * 1000) {
    return { state: kind === 'fiveHour' ? 'READY' : 'STALE', usedPercent: null, remainingPercent: null,
      resetsAt: limit.resetsAt, reason: kind === 'fiveHour'
        ? 'old window ended; awaiting new window telemetry' : 'old weekly snapshot expired; awaiting telemetry' };
  }
  return { ...limit, state: limit.usedPercent >= 100 ? 'EXHAUSTED' : 'ACTIVE',
    resetSeconds: Math.ceil((limit.resetsAt * 1000 - now) / 1000) };
}
function evaluateSubscription(snapshot, now = Date.now(), errors = []) {
  return { plan: snapshot?.plan || 'unknown', observedAt: snapshot?.observedAt || null,
    pool: snapshot?.pool || null, sourceFile: snapshot?.file || null,
    identity: snapshot?.accountId ? 'local creator account metadata' : 'unverified; local telemetry only',
    fiveHour: windowState(snapshot?.fiveHour, 'fiveHour', now), weekly: windowState(snapshot?.weekly, 'weekly', now),
    coverage: errors.length ? 'incomplete' : 'complete', errors };
}
async function loadSubscription(home, store, now = Date.now()) {
  const { files, errors } = discoverFiles(home); let newest = null;
  for (let start = 0; start < files.length; start += 8) {
    const group = files.slice(start, start + 8), data = await Promise.all(group.map(file => store.read(file)));
    data.forEach((result, i) => {
      if (result.error) { errors.push({ file: group[i], code: result.error }); return; }
      if (result.parseFailures) errors.push({ file: group[i], code: 'MALFORMED_JSONL', count: result.parseFailures });
      let accountId = null;
      for (const record of result.records) {
        if (record.type === 'session_meta') accountId = record.payload.accountId || null;
        const candidate = snapshotFromRecord(record, group[i], accountId, now);
        // Sorted paths provide a deterministic tie-break; mtime never determines the winner.
        if (candidate && (!newest || candidate.timestamp > newest.timestamp)) newest = candidate;
      }
    });
  }
  return evaluateSubscription(newest, now, errors);
}
module.exports = { snapshotFromRecord, windowState, evaluateSubscription, loadSubscription };
