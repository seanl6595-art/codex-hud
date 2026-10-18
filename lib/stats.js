'use strict';
const { openReadOnlyDatabase, defaultDatabasePath } = require('./recorder-db');
const { defaultCodexHome, readSessionIndex } = require('./sessions');
const { sanitize, fit } = require('./theme');
const { createProvenanceResolver, allUsageAbsent } = require('./event-provenance');

const METRICS = { input: 'input_tokens', cached: 'cached_input_tokens',
  output: 'output_tokens', reasoning: 'reasoning_output_tokens' };
const KEYS = [...Object.keys(METRICS), 'fresh'];
const DAY = 24 * 60 * 60 * 1000;
const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
function timezoneFormatter(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' });
  } catch { throw new Error(`Invalid timezone: ${sanitize(timezone)}`); }
}
function partsAt(formatter, instant) {
  return Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
}
function utcValue(year, month, day, hour, minute, second, millisecond = 0) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, millisecond);
  return date.getTime();
}
function parseLocalDateTime(value, timezone = localTimezone()) {
  const m = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!m) throw new Error('Invalid local datetime. Use YYYY-MM-DD HH:mm[:ss[.SSS]] without a UTC offset.');
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(v => Number(v || 0));
  const millisecond = Number((m[7] || '').padEnd(3, '0'));
  const nominal = utcValue(year, month, day, hour, minute, second, millisecond), d = new Date(nominal);
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59
    || d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) {
    throw new Error('Invalid local datetime: calendar date or time is out of range.');
  }
  const formatter = timezoneFormatter(timezone), offsets = new Set();
  // Find offsets on either side of a possible DST transition, then round-trip candidates.
  for (const shift of [-2 * DAY, -DAY, 0, DAY, 2 * DAY]) {
    const instant = nominal + shift, p = partsAt(formatter, instant);
    offsets.add(utcValue(Number(p.year), Number(p.month), Number(p.day), Number(p.hour), Number(p.minute), Number(p.second), millisecond) - instant);
  }
  const candidates = [];
  for (const offset of offsets) {
    const instant = nominal - offset, p = partsAt(formatter, instant);
    if ([p.year, p.month, p.day, p.hour, p.minute, p.second].map(Number).every((v, i) => v === [year, month, day, hour, minute, second][i])) candidates.push(instant);
  }
  if (candidates.length !== 1) throw new Error(candidates.length === 0
    ? 'Local datetime does not exist in this timezone (daylight-saving transition).'
    : 'Local datetime is ambiguous in this timezone (daylight-saving transition); choose an unambiguous boundary.');
  return new Date(candidates[0]).toISOString();
}
function absoluteInstant(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
  return Date.parse(value);
}
function resolvePeriod({ from, to, timezone = localTimezone(), now = Date.now(), localInput = false } = {}) {
  timezoneFormatter(timezone);
  const custom = from !== undefined || to !== undefined;
  if (custom && (from === undefined || to === undefined)) throw new Error('Custom Stats ranges require both --from and --to.');
  const start = custom ? absoluteInstant(localInput ? parseLocalDateTime(from, timezone) : from) : absoluteInstant(now) - DAY;
  const end = custom ? absoluteInstant(localInput ? parseLocalDateTime(to, timezone) : to) : absoluteInstant(now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(new Date(start).getTime()) || !Number.isFinite(new Date(end).getTime())) {
    throw new Error('Invalid Stats timestamp.');
  }
  if (end <= start) throw new Error('Stats --to must be later than --from.');
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString(), timezone,
    label: custom ? 'Custom period' : 'Last 24 hours', start, end };
}
function delta(previous, current, last, hasPredecessor) {
  if (!validNumber(current)) return null;
  if (!hasPredecessor) return validNumber(last) && current === last ? current : null;
  if (!validNumber(previous)) return null;
  if (current >= previous) return current - previous;
  return validNumber(last) && current === last ? current : null;
}
function deltaReason(previous, current, last, hasPredecessor) {
  if (!validNumber(current)) return 'missing_cumulative';
  if (!hasPredecessor) return !validNumber(last) ? 'missing_last' : 'unsafe_baseline';
  if (!validNumber(previous)) return 'missing_predecessor';
  return !validNumber(last) ? 'missing_last' : 'unrecognized_reset';
}
function invalidSubset(row, subset, whole, prefix = 'cumulative_') {
  return row && validNumber(row[prefix + subset]) && validNumber(row[prefix + whole])
    && row[prefix + subset] > row[prefix + whole];
}
function decreased(previous, row, column) {
  return previous && validNumber(previous[`cumulative_${column}`]) && validNumber(row[`cumulative_${column}`])
    && row[`cumulative_${column}`] < previous[`cumulative_${column}`];
}
function resetEvidence(previous, row) {
  const primaryDecrease = ['input_tokens', 'output_tokens'].some(column => decreased(previous, row, column));
  // A fresh accumulator starts with the WHOLE usage vector equal to last usage.
  // A single falling subset is not evidence of a global epoch change. Reported
  // total_tokens is optional corroboration, never a substitute for a metric.
  const equalVector = Object.values(METRICS).every(column => validNumber(row[column])
    && validNumber(row[`cumulative_${column}`]) && row[column] === row[`cumulative_${column}`]);
  const totalConsistent = row.total_tokens === null && row.cumulative_total_tokens === null
    || validNumber(row.total_tokens) && row.total_tokens === row.cumulative_total_tokens
      && row.total_tokens === row.input_tokens + row.output_tokens;
  const whole = primaryDecrease && equalVector && totalConsistent
    && !invalidSubset(row, 'cached_input_tokens', 'input_tokens')
    && !invalidSubset(row, 'reasoning_output_tokens', 'output_tokens');
  return { whole, ambiguous: primaryDecrease && !whole };
}
function accumulator() { return { sum: 0, valid: 0, invalid: 0, unattributed: false, reasons: {} }; }
function add(total, value, reason = 'missing_cumulative') {
  if (value === null) { total.invalid++; total.reasons[reason] = (total.reasons[reason] || 0) + 1; }
  else {
    const sum = total.sum + value;
    if (!Number.isFinite(sum)) throw new Error('Stats aggregate exceeds supported numeric range.');
    total.sum = sum; total.valid++;
  }
}
function finish(total) {
  return { value: total.valid || !total.invalid ? total.sum : null,
    complete: total.invalid === 0 && !total.unattributed,
    validObservations: total.valid, indeterminateObservations: total.invalid,
    incompleteReasons: { ...total.reasons } };
}
function getHistoricalUsageStats(options = {}) {
  // Validate before opening any DB, so invalid CLI/API ranges cannot query or mutate it.
  const period = resolvePeriod(options), names = readSessionIndex(options.home || defaultCodexHome());
  const verification = options.verification || 'snapshot';
  if (!['snapshot', 'fresh'].includes(verification)) throw new Error('Verification must be snapshot or fresh.');
  const bucketState = options.buckets ? require('./stats-buckets').createBuckets(period, options.buckets, KEYS, accumulator, add, finish, !!options.includeEndDate) : null;
  const analytics = options.analytics ? require('./stats-analytics').createAnalytics({ period, unit: options.buckets, filters: options.filters, keys: KEYS, accumulator, add, finish }) : null;
  const db = openReadOnlyDatabase(options.dbPath || defaultDatabasePath());
  const totals = Object.fromEntries(KEYS.map(key => [key, accumulator()])), sessions = new Map();
  let previous = null, previousUsage = null, sequenceGap = false, sourceConflict = false, sourceConflicts = 0;
  let observations = 0, usageEvents = 0, invalidTimestampObservations = 0, timedCoverage = true;
  let allowanceOnlyObservations = 0, unknownProvenanceObservations = 0;
  const cohort = { input: 0, cached: 0, fresh: 0, observations: 0 };
  let transaction = false;
  let evidence;
  try {
    db.exec('BEGIN'); transaction = true;
    // Reuse this query's own committed rows for proof binding and accounting.
    // This is not a result cache. Bound materialization; large histories keep the
    // streaming path. Never omit events whose source row was corrupted/deleted.
    const materialize = db.prepare('SELECT count(*) n FROM telemetry_events').get().n <= 100000;
    const rows = materialize ? db.prepare('SELECT * FROM telemetry_events ORDER BY session_id,event_seq').all() : null;
    const eventsBySource = rows ? new Map() : null;
    if (rows) for (const row of rows) {
      if (!eventsBySource.has(row.session_id)) eventsBySource.set(row.session_id, []);
      eventsBySource.get(row.session_id).push(row);
    }
    const provenance = createProvenanceResolver(db, options.home || defaultCodexHome(), { verification,
      dbPath: options.dbPath || defaultDatabasePath(), eventsBySource });
    const conflictedSources = new Set();
    // Include sources whose last surviving event was removed: there may be no
    // event row to trigger integrity checks inside the accounting loop.
    for (const { session_id: id } of db.prepare('SELECT session_id FROM sources UNION SELECT session_id FROM telemetry_events ORDER BY session_id').iterate()) {
      if (provenance.conflict(id)) conflictedSources.add(id);
    }
    evidence = provenance.summary();
    sourceConflicts = conflictedSources.size;
    if (sourceConflicts) {
      timedCoverage = false;
      for (const key of KEYS) totals[key].unattributed = true;
      bucketState?.unknown(Object.fromEntries(KEYS.map(key => [key, null])), 'source_integrity');
    }
    // Crucial: no period WHERE here. Adjacency uses the complete canonical sequence.
    // Counter accounting uses recorded facts. Provenance recovery may verify
    // original bytes, but never backfills counters or metadata from those files.
    const query = db.prepare(`SELECT session_id, event_seq, event_timestamp, raw_event_sha256, model, reasoning_effort, turn_id,
      total_tokens, cumulative_total_tokens, ${Object.values(METRICS).flatMap(key => [key, `cumulative_${key}`]).join(',')}
      FROM telemetry_events ORDER BY session_id, event_seq`);
    for (const row of rows || query.iterate()) {
      const sameSession = previous !== null && previous.session_id === row.session_id;
      if (!sameSession) {
        previousUsage = null; sequenceGap = false;
        // An authenticated source disagreement is stronger evidence than a
        // plausible surviving delta, even when every surviving counter is known.
        sourceConflict = conflictedSources.has(row.session_id);
      }
      if (sameSession ? previous.event_seq + 1 !== row.event_seq : row.event_seq !== 1) sequenceGap = true;
      previous = row; // Full canonical integrity is independent of usage applicability.
      const at = absoluteInstant(row.event_timestamp), inPeriod = at >= period.start && at < period.end;
      const kind = sourceConflict ? 'unknown' : provenance.kind(row), allowance = kind === 'allowance_only';
      if (allowance && inPeriod) allowanceOnlyObservations++;
      // A canonical gap remains evidence of missing history even if the next
      // surviving record is allowance-only. Never let skipping erase that gap.
      if (allowance && !sequenceGap) continue;
      if (kind === 'unknown' && allUsageAbsent(row) && inPeriod) unknownProvenanceObservations++;
      const predecessor = previousUsage, hasPredecessor = predecessor !== null;
      const reset = resetEvidence(predecessor, row);
      const accounted = {}, reasons = {};
      for (const [name, column] of Object.entries(METRICS)) {
        const prior = predecessor?.[`cumulative_${column}`], current = row[`cumulative_${column}`];
        accounted[name] = sourceConflict || sequenceGap ? null : reset.whole ? current : delta(prior, current, row[column], hasPredecessor);
        if (accounted[name] === null) reasons[name] = sequenceGap ? 'sequence_gap' : sourceConflict ? 'source_integrity'
          : kind === 'unknown' && allUsageAbsent(row) ? 'unknown_provenance'
          : deltaReason(prior, current, row[column], hasPredecessor);
        // With an unresolved primary reset, C-P and C describe different possible
        // epochs. Only a zero predecessor makes those answers identical. A
        // decreasing metric can still independently establish its own C==L base.
        if (!sourceConflict && !sequenceGap && reset.ambiguous && validNumber(prior) && prior > 0 && validNumber(current) && current >= prior) {
          accounted[name] = null; reasons[name] = 'ambiguous_reset';
        }
        // A subset-only decrease cannot justify mixing a subset reset with a
        // monotonic whole. Retain the independently observed whole metric.
        if (!sourceConflict && !sequenceGap && !reset.whole && (name === 'cached' || name === 'reasoning') && decreased(predecessor, row, column)) {
          const whole = name === 'cached' ? 'input_tokens' : 'output_tokens';
          if (!decreased(predecessor, row, whole)) { accounted[name] = null; reasons[name] = 'ambiguous_reset'; }
        }
      }
      accounted.fresh = accounted.input !== null && accounted.cached !== null && accounted.cached <= accounted.input
        ? accounted.input - accounted.cached : null;
      const cacheBaseline = !predecessor || reset.whole || decreased(predecessor, row, 'input_tokens') || decreased(predecessor, row, 'cached_input_tokens');
      if (invalidSubset(row, 'cached_input_tokens', 'input_tokens')
        || !reset.whole && predecessor && row.cumulative_cached_input_tokens >= predecessor.cumulative_cached_input_tokens
          && invalidSubset(predecessor, 'cached_input_tokens', 'input_tokens')
        || cacheBaseline && invalidSubset(row, 'cached_input_tokens', 'input_tokens', '')) {
        accounted.fresh = null; reasons.fresh = 'invalid_cache_subset';
      }
      if (accounted.fresh === null && !reasons.fresh) reasons.fresh = accounted.input !== null && accounted.cached !== null ? 'invalid_cache_subset' : 'missing_input_or_cached';
      const reasoningBaseline = !predecessor || reset.whole || decreased(predecessor, row, 'output_tokens') || decreased(predecessor, row, 'reasoning_output_tokens');
      if (accounted.reasoning !== null && (accounted.output !== null && accounted.reasoning > accounted.output
        || invalidSubset(row, 'reasoning_output_tokens', 'output_tokens')
        || !reasoningBaseline && invalidSubset(predecessor, 'reasoning_output_tokens', 'output_tokens')
        || reasoningBaseline && invalidSubset(row, 'reasoning_output_tokens', 'output_tokens', ''))) {
        accounted.reasoning = null; reasons.reasoning = 'invalid_reasoning_subset';
      }
      // Genuine usage (including partial/unknown records) still advances adjacency
      // even when untimed, duplicated, or outside the requested period.
      if (!allowance) { previousUsage = row; sequenceGap = false; }
      if (!Number.isFinite(at)) {
        invalidTimestampObservations++;
        if (bucketState) bucketState.unknown(accounted);
        for (const key of KEYS) if (accounted[key] !== 0) {
          totals[key].unattributed = true;
          totals[key].reasons.unknown_timestamp = (totals[key].reasons.unknown_timestamp || 0) + 1;
        }
        if (accounted.input !== 0 || accounted.output !== 0) timedCoverage = false;
        continue;
      }
      if (at < period.start || at >= period.end) continue;
      observations++;
      analytics?.observe(row, predecessor, accounted, at, reasons);
      if (bucketState) bucketState.add(at, accounted, row.session_id, reasons);
      if (!sessions.has(row.session_id)) sessions.set(row.session_id, { sessionId: row.session_id,
        displayName: names.get(row.session_id)?.name || `Session ${row.session_id}`, input: accumulator(), usageEvents: 0 });
      const session = sessions.get(row.session_id);
      for (const key of KEYS) add(totals[key], accounted[key], reasons[key]);
      add(session.input, accounted.input, reasons.input);
      if (accounted.input > 0 || accounted.output > 0) { usageEvents++; session.usageEvents++; }
      if (accounted.fresh !== null) {
        cohort.input += accounted.input; cohort.cached += accounted.cached; cohort.fresh += accounted.fresh; cohort.observations++;
      }
    }
    db.exec('COMMIT'); transaction = false;
  } finally {
    try { if (transaction) db.exec('ROLLBACK'); } finally { db.close(); }
  }
  if (sourceConflicts) for (const key of KEYS) totals[key].reasons.source_integrity = sourceConflicts;
  const finished = Object.fromEntries(KEYS.map(key => [key, finish(totals[key])]));
  const ratioComplete = cohort.observations === observations && finished.input.complete && finished.cached.complete && finished.fresh.complete;
  const ratio = numerator => ({ value: ratioComplete && cohort.input > 0 ? numerator / cohort.input * 100 : null,
    complete: ratioComplete, available: ratioComplete && cohort.input > 0,
    denominator: 'accounted Input in the matched Input/Cached observation cohort', cohort: { ...cohort } });
  const activeSessions = [...sessions.values()].filter(s => s.usageEvents > 0).map(s => {
    const input = finish(s.input), complete = finished.input.complete && input.complete;
    return { sessionId: s.sessionId, displayName: s.displayName, input,
      inputShare: { value: complete && finished.input.value > 0 ? input.value / finished.input.value * 100 : null,
        complete, available: complete && finished.input.value > 0, denominator: 'period accounted Input' } };
  }).sort((a, b) => (b.input.value ?? -1) - (a.input.value ?? -1) || a.sessionId.localeCompare(b.sessionId));
  return { period: { from: period.from, to: period.to, timezone: period.timezone, label: period.label }, totals: finished, verification: evidence,
    ratios: { cachedPercent: ratio(cohort.cached), freshPercent: ratio(cohort.fresh) },
    activity: { usageEvents, sessions: activeSessions.length, complete: timedCoverage }, sessions: activeSessions,
    coverage: { observations, invalidTimestampObservations, allowanceOnlyObservations, unknownProvenanceObservations },
    ...(analytics ? { analytics: analytics.finish(totals, timedCoverage) } : {}),
    ...(bucketState ? { bucketUnit: options.buckets, buckets: bucketState.finish() } : {}) };
}
function formatTime(value, timezone) {
  const p = partsAt(timezoneFormatter(timezone), new Date(value));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ${p.timeZoneName}`;
}
function renderHistoricalUsageStats(stats) {
  const format = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
  const workload = metric => metric.value === null ? 'N/A / incomplete' : `${format(metric.value)}${metric.complete ? '' : ' (incomplete)'}`;
  const share = value => value.value === null ? value.complete ? 'N/A (zero Input)' : 'N/A / incomplete' : `${value.value.toFixed(1)}%`;
  const lines = ['CODEX USAGE', stats.period.label,
    `${formatTime(stats.period.from, stats.period.timezone)} -> ${formatTime(stats.period.to, stats.period.timezone)}`,
    `Timezone: ${stats.period.timezone}; range [from, to)`, '', 'INPUT',
    `Total      ${workload(stats.totals.input)}`, `Cached     ${workload(stats.totals.cached)}`, `Fresh      ${workload(stats.totals.fresh)}`,
    '', 'OUTPUT', `Total      ${workload(stats.totals.output)}`, `Reasoning  ${workload(stats.totals.reasoning)}`,
    'Reasoning is a subset of Output.', '', 'ACTIVITY',
    `Usage Events  ${stats.activity.usageEvents}${stats.activity.complete ? '' : ' (incomplete time coverage)'}`,
    `Sessions      ${stats.activity.sessions}${stats.activity.complete ? '' : ' (incomplete time coverage)'}`, '', 'SESSION BREAKDOWN',
    'Current display name                      Input workload      Input share'];
  for (const s of stats.sessions) lines.push(`${fit(sanitize(s.displayName), 40, true)}  ${workload(s.input).padEnd(18)}  ${share(s.inputShare)}`);
  if (!stats.sessions.length) lines.push('No accounted Usage Events in this period.');
  lines.push(`Input share denominator: period accounted Input = ${workload(stats.totals.input)} tokens.`,
    'Names are current display names; grouping uses canonical session IDs.');
  if (stats.coverage.invalidTimestampObservations) lines.push(`${stats.coverage.invalidTimestampObservations} observations have unknown timestamps; unassignable workload is not included.`);
  if (stats.coverage.allowanceOnlyObservations) lines.push(`${stats.coverage.allowanceOnlyObservations} verified allowance-only observations excluded from token accounting.`);
  if (stats.verification) lines.push(`Historical source evidence: ${stats.verification.reusedSources} reused, ${stats.verification.checkedSources} checked;`
    + ` oldest verified ${stats.verification.oldestVerifiedAt || 'unavailable'}. This is recorded history, not live source-file attestation.`);
  for (const key of KEYS) {
    const reasons = Object.entries(stats.totals[key].incompleteReasons || {});
    if (reasons.length) lines.push(`${key} incomplete reasons: ${reasons.map(([reason, count]) => `${reason}=${count}`).join(', ')}`);
  }
  return lines.join('\n');
}
module.exports = { getHistoricalUsageStats, renderHistoricalUsageStats, resolvePeriod, parseLocalDateTime };
