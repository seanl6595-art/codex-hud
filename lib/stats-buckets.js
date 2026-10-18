'use strict';
// Presentation aggregation only. The caller supplies the audited accumulators and deltas.
const HOUR = 3600000, DAY = 86400000;
const dateFormatters = new Map();
function dateKey(instant, timezone) {
  let formatter = dateFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    if (dateFormatters.size >= 16) dateFormatters.clear();
    dateFormatters.set(timezone, formatter);
  }
  const p = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
  return p.year + '-' + p.month + '-' + p.day;
}
function shiftDate(date, days) {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function startOfDate(date, timezone) {
  const nominal = Date.parse(date + 'T00:00:00Z');
  let low = nominal - 2 * DAY, high = nominal + 2 * DAY;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dateKey(mid, timezone) < date) low = mid + 1; else high = mid;
  }
  return low;
}
function heatmapPeriod(now, timezone, weeks = 12, offset = 0) {
  if (![12, 26, 52].includes(weeks) || !Number.isInteger(offset) || offset < 0 || offset > 520) throw new Error('Invalid heatmap calendar range.');
  const today = shiftDate(dateKey(now, timezone), -offset * 7), first = shiftDate(today, -(weeks * 7 - 1));
  return { from: new Date(startOfDate(first, timezone)).toISOString(), to: new Date(offset ? startOfDate(shiftDate(today, 1), timezone) : now).toISOString(),
    timezone, buckets: 'day', includeEndDate: !offset };
}
function createBuckets(period, unit, keys, accumulator, add, finish, includeEndDate = false) {
  if (!['hour', 'day'].includes(unit)) throw new Error('Buckets must be hour or day.');
  const map = new Map();
  const create = key => ({ key, observations: 0, usageEvents: 0, ids: new Set(),
    totals: Object.fromEntries(keys.map(k => [k, accumulator()])) });
  if (unit === 'hour') {
    for (let at = Math.floor(period.start / HOUR) * HOUR; at < period.end; at += HOUR) {
      if (map.size >= 2200) throw new Error('Choose a shorter range for hourly buckets.');
      const key = new Date(at).toISOString(); map.set(key, create(key));
    }
  } else {
    const last = dateKey(period.end - (includeEndDate ? 0 : 1), period.timezone);
    for (let key = dateKey(period.start, period.timezone); key <= last; key = shiftDate(key, 1)) {
      if (map.size >= 1100) throw new Error('Choose a range of at most 1100 calendar days.');
      map.set(key, create(key));
      if (key === last) break;
    }
  }
  let activityComplete = true;
  return {
    unknown(accounted, reason = 'unknown_timestamp') {
      for (const bucket of map.values()) for (const k of keys) if (accounted[k] !== 0) {
        bucket.totals[k].unattributed = true;
        bucket.totals[k].reasons[reason] = (bucket.totals[k].reasons[reason] || 0) + 1;
      }
      if (accounted.input !== 0 || accounted.output !== 0) activityComplete = false;
    },
    add(at, accounted, id, reasons = {}) {
      const key = unit === 'day' ? dateKey(at, period.timezone) : new Date(Math.floor(at / HOUR) * HOUR).toISOString();
      const bucket = map.get(key);
      if (!bucket) throw new Error('Accounted event falls outside generated buckets.');
      bucket.observations++;
      for (const k of keys) add(bucket.totals[k], accounted[k], reasons[k]);
      if (accounted.input > 0 || accounted.output > 0) { bucket.usageEvents++; bucket.ids.add(id); }
    },
    finish() {
      return [...map.values()].map(b => {
        const totals = Object.fromEntries(keys.map(k => [k, finish(b.totals[k])]));
        const complete = totals.input.complete && totals.output.complete;
        return { key: b.key, observations: b.observations, totals,
          activity: { usageEvents: b.usageEvents, sessions: b.ids.size, complete: activityComplete },
          state: !complete ? 'incomplete' : !b.observations ? 'missing'
            : totals.input.value === 0 && totals.output.value === 0 ? 'zero' : 'observed' };
      });
    }
  };
}
module.exports = { createBuckets, dateKey, shiftDate, heatmapPeriod };
