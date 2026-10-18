export function niceAxis(maximum, expanded = false) {
  if (!(maximum > 0)) return { maximum: 1, step: .2, ticks: [0, .2, .4, .6, .8, 1], minor: [] };
  const target = maximum * 1.08 / (expanded ? 10 : 6), power = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 2.5, 5, 10].find(n => n * power >= target) * power;
  const top = Math.ceil(maximum * 1.08 / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Number((i * step).toPrecision(12)));
  return { maximum: top, step, ticks, minor: expanded ? ticks.slice(1).map(n => n - step / 2) : [] };
}
// Only bridge genuinely absent buckets. Incomplete metric observations break the guide.
// Endpoints are recorded values; no intermediate numbers are added to chart data.
export function gapGuides(buckets, metric) {
  const guides = []; let previous = null, missing = false;
  for (const bucket of buckets) {
    if (!bucket.observations && bucket.state === 'missing') { missing = true; continue; }
    const value = bucket.totals[metric];
    if (!value.complete || value.value === null) { previous = null; missing = false; continue; }
    if (previous && missing) guides.push([{ x: previous.key, y: previous.value }, { x: bucket.key, y: value.value }]);
    previous = { key: bucket.key, value: value.value }; missing = false;
  }
  return guides;
}
