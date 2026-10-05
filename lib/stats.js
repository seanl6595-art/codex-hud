'use strict';
const { openReadOnlyDatabase, defaultDatabasePath } = require('./recorder-db');
const { defaultCodexHome, readSessionIndex } = require('./sessions');
const { sanitize, fit } = require('./theme');

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
function accumulator() { return { sum: 0, valid: 0, invalid: 0, unattributed: false }; }
function add(total, value) {
  if (value === null) total.invalid++;
  else {
    const sum = total.sum + value;
    if (!Number.isFinite(sum)) throw new Error('Stats aggregate exceeds supported numeric range.');
    total.sum = sum; total.valid++;
  }
}
function finish(total) {
  return { value: total.valid || !total.invalid ? total.sum : null,
    complete: total.invalid === 0 && !total.unattributed,
    validObservations: total.valid, indeterminateObservations: total.invalid };
}
function getHistoricalUsageStats(options = {}) {
  // Validate before opening any DB, so invalid CLI/API ranges cannot query or mutate it.
  const period = resolvePeriod(options), names = readSessionIndex(options.home || defaultCodexHome());
  const db = openReadOnlyDatabase(options.dbPath || defaultDatabasePath());
  const totals = Object.fromEntries(KEYS.map(key => [key, accumulator()])), sessions = new Map();
  let previous = null, observations = 0, usageEvents = 0, invalidTimestampObservations = 0, timedCoverage = true;
  const cohort = { input: 0, cached: 0, fresh: 0, observations: 0 };
  let transaction = false;
  try {
    db.exec('BEGIN'); transaction = true;
    // Crucial: no period WHERE here. Adjacency uses the complete canonical sequence.
    // Stream selected observed fields only; no raw JSONL or derived Recorder view pipeline.
    const query = db.prepare(`SELECT session_id, event_seq, event_timestamp,
      ${Object.values(METRICS).flatMap(key => [key, `cumulative_${key}`]).join(',')}
      FROM telemetry_events ORDER BY session_id, event_seq`);
    for (const row of query.iterate()) {
      const hasPredecessor = previous !== null && previous.session_id === row.session_id;
      const contiguous = !hasPredecessor || previous.event_seq + 1 === row.event_seq;
      const accounted = {};
      for (const [name, column] of Object.entries(METRICS)) {
        accounted[name] = contiguous ? delta(previous?.[`cumulative_${column}`], row[`cumulative_${column}`], row[column], hasPredecessor) : null;
      }
      accounted.fresh = accounted.input !== null && accounted.cached !== null && accounted.cached <= accounted.input
        ? accounted.input - accounted.cached : null;
      // Update predecessor even for untimed, duplicate, missing and out-of-period rows.
      previous = row;
      const at = absoluteInstant(row.event_timestamp);
      if (!Number.isFinite(at)) {
        invalidTimestampObservations++;
        for (const key of KEYS) if (accounted[key] !== 0) totals[key].unattributed = true;
        if (accounted.input !== 0 || accounted.output !== 0) timedCoverage = false;
        continue;
      }
      if (at < period.start || at >= period.end) continue;
      observations++;
      if (!sessions.has(row.session_id)) sessions.set(row.session_id, { sessionId: row.session_id,
        displayName: names.get(row.session_id)?.name || `Session ${row.session_id}`, input: accumulator(), usageEvents: 0 });
      const session = sessions.get(row.session_id);
      for (const key of KEYS) add(totals[key], accounted[key]);
      add(session.input, accounted.input);
      if (accounted.input > 0 || accounted.output > 0) { usageEvents++; session.usageEvents++; }
      if (accounted.fresh !== null) {
        cohort.input += accounted.input; cohort.cached += accounted.cached; cohort.fresh += accounted.fresh; cohort.observations++;
      }
    }
    db.exec('COMMIT'); transaction = false;
  } finally {
    try { if (transaction) db.exec('ROLLBACK'); } finally { db.close(); }
  }
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
  return { period: { from: period.from, to: period.to, timezone: period.timezone, label: period.label }, totals: finished,
    ratios: { cachedPercent: ratio(cohort.cached), freshPercent: ratio(cohort.fresh) },
    activity: { usageEvents, sessions: activeSessions.length, complete: timedCoverage }, sessions: activeSessions,
    coverage: { observations, invalidTimestampObservations } };
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
  return lines.join('\n');
}
module.exports = { getHistoricalUsageStats, renderHistoricalUsageStats, resolvePeriod, parseLocalDateTime };
