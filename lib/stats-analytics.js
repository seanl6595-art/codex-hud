'use strict';
// Optional presentation grouping. Only consumes deltas from the canonical Stats pass.
const { createBuckets } = require('./stats-buckets');
const text = value => typeof value === 'string' && value.trim() ? value : null;
function attribution(row, previous, accounted, field) {
  const current = text(row[field]);
  if (!current || !previous || previous.session_id !== row.session_id || current === text(previous[field])) return current;
  // Across a metadata boundary, a cumulative interval can span multiple contexts.
  // Attribute it to the current context only when every available delta agrees
  // with the observed last usage snapshot. Otherwise retain the entire row as Unknown.
  const columns = { input: 'input_tokens', cached: 'cached_input_tokens', output: 'output_tokens', reasoning: 'reasoning_output_tokens' };
  return Object.entries(columns).every(([key, column]) => accounted[key] === null || accounted[key] === row[column]) ? current : null;
}
function createAnalytics({ period, unit, filters = {}, keys, accumulator, add, finish }) {
  const models = new Map(), efforts = new Map(), cross = new Map(), modelOptions = new Set([null]), effortOptions = new Set([null]);
  const make = (model, effort, timeline = false) => ({ model, effort, observations: 0, usageEvents: 0, ids: new Set(), turns: new Set(), unknownTurns: 0,
    totals: Object.fromEntries(keys.map(key => [key, accumulator()])), cohort: { input: 0, cached: 0, fresh: 0, observations: 0 },
    buckets: timeline && unit ? createBuckets(period, unit, keys, accumulator, add, finish) : null });
  const selected = make(null, null);
  const coverage = {knownModelMetadata:0,knownEffortMetadata:0,validPrimaryDeltas:0};
  const group = (map, key, model, effort, timeline) => {
    if (!map.has(key)) map.set(key, make(model, effort, timeline));
    return map.get(key);
  };
  group(models, null, null, null, true); group(efforts, null, null, null, false);
  function record(g, row, accounted, at, reasons) {
    g.observations++;
    for (const key of keys) add(g.totals[key], accounted[key], reasons[key]);
    g.buckets?.add(at, accounted, row.session_id, reasons);
    if (accounted.input > 0 || accounted.output > 0) {
      g.usageEvents++; g.ids.add(row.session_id);
      const turn = text(row.turn_id);
      if (turn) g.turns.add(JSON.stringify([row.session_id, turn])); else g.unknownTurns++;
    }
    if (accounted.fresh !== null) {
      g.cohort.input += accounted.input; g.cohort.cached += accounted.cached; g.cohort.fresh += accounted.fresh; g.cohort.observations++;
    }
  }
  return {
    observe(row, previous, accounted, at, reasons = {}) {
      const model = attribution(row, previous, accounted, 'model'), effort = attribution(row, previous, accounted, 'reasoning_effort');
      modelOptions.add(model); effortOptions.add(effort);
      if (Object.hasOwn(filters, 'model') && model !== filters.model || Object.hasOwn(filters, 'effort') && effort !== filters.effort) return;
      coverage.knownModelMetadata+=Number(text(row.model)!==null);
      coverage.knownEffortMetadata+=Number(text(row.reasoning_effort)!==null);
      coverage.validPrimaryDeltas+=Number(accounted.input!==null && accounted.output!==null);
      record(selected, row, accounted, at, reasons);
      record(group(models, model, model, null, true), row, accounted, at, reasons);
      record(group(efforts, effort, null, effort, false), row, accounted, at, reasons);
      record(group(cross, JSON.stringify([model, effort]), model, effort, false), row, accounted, at, reasons);
    },
    finish(globalAccumulators, timedCoverage) {
      const unknown = Object.fromEntries(keys.map(k => [k, globalAccumulators[k].unattributed ? null : 0]));
      function completeTotals(g) {
        for (const k of keys) if (unknown[k] === null) {
          g.totals[k].unattributed = true;
          for (const reason of ['unknown_timestamp', 'source_integrity']) {
            if (globalAccumulators[k].reasons[reason]) g.totals[k].reasons[reason] = globalAccumulators[k].reasons[reason];
          }
        }
        return Object.fromEntries(keys.map(k => [k, finish(g.totals[k])]));
      }
      const denominator = completeTotals(selected);
      function share(totals, metric) {
        const names = metric === 'combined' ? ['input', 'output'] : [metric];
        const complete = names.every(k => denominator[k].complete && totals[k].complete);
        const whole = names.reduce((sum, k) => sum + (denominator[k].value || 0), 0), value = names.reduce((sum, k) => sum + (totals[k].value || 0), 0);
        return { value: complete && whole > 0 ? value / whole * 100 : null, complete, available: complete && whole > 0,
          denominator: 'filtered period accounted ' + (metric === 'combined' ? 'Input + Output' : metric) + ', including Unknown', denominatorValue: whole };
      }
      function result(g) {
        const totals = completeTotals(g), c = g.cohort;
        const complete = c.observations === g.observations && ['input', 'cached', 'fresh'].every(k => totals[k].complete);
        for (const reason of ['unknown_timestamp', 'source_integrity']) {
          const affected = Object.fromEntries(keys.map(k => [k, globalAccumulators[k].reasons[reason] ? null : 0]));
          if (Object.values(affected).some(v => v === null)) g.buckets?.unknown(affected, reason);
        }
        return { model: g.model, effort: g.effort, observations: g.observations, totals,
          usageEvents: g.usageEvents, distinctSessions: g.ids.size, activityComplete: timedCoverage,
          observedTurns: { value: g.turns.size, complete: g.unknownTurns === 0 && timedCoverage, unknownIdentityEvents: g.unknownTurns },
          sessionIds: [...g.ids].sort(), cacheRatio: { value: complete && c.input > 0 ? c.cached / c.input * 100 : null,
            complete, available: complete && c.input > 0, denominator: 'accounted Input in matched Input/Cached observation cohort', cohort: c },
          shares: { input: share(totals, 'input'), output: share(totals, 'output'), combined: share(totals, 'combined') },
          ...(g.buckets ? { buckets: g.buckets.finish() } : {}) };
      }
      const ranked = map => [...map.values()].map(result).sort((a, b) => (b.totals.input.value || 0) - (a.totals.input.value || 0));
      return { filters, coverage, modelOptions: [...modelOptions].sort(), effortOptions: [...effortOptions].sort(),
        totals: denominator, observations: selected.observations, models: ranked(models), efforts: ranked(efforts), cross: ranked(cross) };
    }
  };
}
module.exports = { createAnalytics, attribution };
