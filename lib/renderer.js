'use strict';
const { theme, sanitize, fit, displayWidth } = require('./theme');
const tokens = value => value == null ? 'unknown' : value >= 1e6 ? `${(value / 1e6).toFixed(2)}M`
  : value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);
const percent = value => value == null ? 'unknown' : `${Number(value.toFixed(1))}%`;
function duration(seconds) {
  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h`;
}
function limitLines(label, limit, t, compact = false) {
  const state = limit?.state || 'UNKNOWN';
  if (state === 'READY') return [t.paint('ready', `${label}  READY / INACTIVE`),
    t.paint('secondary', 'Old window ended; awaiting new window telemetry')];
  if (state === 'STALE' || state === 'UNKNOWN') return [t.paint('secondary', `${label}  ${state} - ${limit?.reason || 'no telemetry'}`)];
  const used = `${percent(limit.usedPercent)} used / ${percent(limit.remainingPercent)} left`;
  return compact ? [`${label} ${t.paint(t.severity(limit.usedPercent), state)}  ${used}  reset ${duration(limit.resetSeconds)}`]
    : [`${label}  ${t.bar(limit.usedPercent)}  ${t.paint(t.severity(limit.usedPercent), state)}  ${used}`,
      t.paint('secondary', `  reset in ${duration(limit.resetSeconds)} (local snapshot)` )];
}
function usageLines(usage, t) {
  const u = usage || {};
  return [
    `Input        ${tokens(u.inputTokens)}`,
    `  Cached     ${t.paint('cached', tokens(u.cachedInputTokens))}  ${percent(u.cacheHitPercent)}`,
    `  Fresh      ${t.paint('fresh', tokens(u.freshInputTokens))}`,
    `Output       ${tokens(u.outputTokens)}`,
    `  Reasoning  ${t.paint('reasoning', tokens(u.reasoningOutputTokens))}`,
  ];
}
function renderHud(view, options = {}) {
  const t = theme(options), b = t.box, width = Math.max(4, Math.floor(options.columns || 90));
  const inside = width - 4, lines = [], telemetry = view?.telemetry, subscription = view?.subscription;
  const row = text => lines.push(`${b.v} ${fit(text, inside, true, t.ascii)} ${b.v}`);
  const rule = () => lines.push(b.l + b.h.repeat(width - 2) + b.r);
  const section = title => row(t.paint('title', title));
  lines.push(b.tl + b.h.repeat(width - 2) + b.tr);
  const heading = `CODEX HUD   ${sanitize(telemetry?.modelName || view?.session?.modelName || 'unknown')}  ${sanitize(telemetry?.reasoningEffort || 'unknown').toUpperCase()}`;
  const plan = `Plan ${sanitize(subscription?.plan || 'unknown')}`;
  row(`${t.paint('title', fit(heading, Math.max(0, inside - displayWidth(plan) - 3), true, t.ascii))} | ${plan}`);
  row(`${sanitize(view?.session?.name || 'No session')}  |  ${sanitize(view?.session?.project || 'unknown')}`);
  if (view?.loading) row(t.paint('secondary', 'Loading selected session telemetry...'));
  else if (!telemetry || telemetry.diagnostics?.error) row(t.paint('warning', 'Session unavailable; press Esc/Q to return to browser'));
  rule(); section('CONTEXT  (last-request input estimate)');
  const ctx = telemetry?.context || {};
  row(`${tokens(ctx.inputTokens)} / ${tokens(ctx.windowTokens)}  ${t.bar(ctx.usedPercent)}  ${t.paint(t.severity(ctx.usedPercent), percent(ctx.usedPercent))}`);
  rule();
  const left = [t.paint('title', 'LAST REQUEST'), ...usageLines(telemetry?.lastRequest, t)];
  const right = [t.paint('title', 'SESSION'), ...usageLines(telemetry?.totals, t), `Turns ${telemetry?.turns ?? 'unknown'}  |  Requests ${telemetry?.requestCount ?? 0}`];
  if (width >= 78) {
    const leftWidth = Math.floor((inside - 3) / 2), rightWidth = inside - leftWidth - 3;
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      row(`${fit(left[i] || '', leftWidth, true, t.ascii)} ${b.v} ${fit(right[i] || '', rightWidth, true, t.ascii)}`);
    }
  } else if ((options.rows || 40) < 34) {
    // Short/narrow terminals keep both usage summaries and allowance states visible.
    section('LAST REQUEST');
    row(`Input ${tokens(telemetry?.lastRequest?.inputTokens)}  Cached ${tokens(telemetry?.lastRequest?.cachedInputTokens)}  Fresh ${tokens(telemetry?.lastRequest?.freshInputTokens)}`);
    row(`Output ${tokens(telemetry?.lastRequest?.outputTokens)}  Reasoning ${tokens(telemetry?.lastRequest?.reasoningOutputTokens)}`);
    section('SESSION');
    row(`Input ${tokens(telemetry?.totals?.inputTokens)}  Output ${tokens(telemetry?.totals?.outputTokens)}  Cache ${percent(telemetry?.totals?.cacheHitPercent)}`);
    row(`Cached ${tokens(telemetry?.totals?.cachedInputTokens)}  Fresh ${tokens(telemetry?.totals?.freshInputTokens)}  Reasoning ${tokens(telemetry?.totals?.reasoningOutputTokens)}`);
    row(`Turns ${telemetry?.turns ?? 'unknown'}  |  Requests ${telemetry?.requestCount ?? 0}`);
  } else { left.forEach(row); row(''); right.forEach(row); }
  rule(); section('SUBSCRIPTION  (account-global codex pool)');
  limitLines('5-hour', subscription?.fiveHour, t).forEach(row);
  limitLines('Weekly', subscription?.weekly, t).forEach(row);
  row(t.paint('secondary', `Observed ${sanitize(subscription?.observedAt || 'unknown')} | ${subscription?.coverage || 'unknown'} scan`));
  const warnings = telemetry?.diagnostics?.parseFailures || subscription?.errors?.length || telemetry?.lastRequest?.invalidSubsets || telemetry?.totals?.invalidSubsets;
  if (warnings) row(t.paint('warning', 'Telemetry incomplete or invalid; run doctor for diagnostics'));
  lines.push(b.bl + b.h.repeat(width - 2) + b.br);
  lines.push(fit(t.paint('secondary', options.watch ? 'Q/Esc/Ctrl+C Exit | selected file locked | refresh ~2s' : 'Esc/Q Browser | R Refresh | Ctrl+C Exit | selected file locked'), width, false, t.ascii));
  // Very short viewports have a separate compact view; do not let scrolling hide allowance states.
  if (options.rows && lines.length > options.rows) {
    const compact = [
      `CODEX HUD ${sanitize(telemetry?.modelName || 'unknown')} ${sanitize(telemetry?.reasoningEffort || 'unknown')}`,
      sanitize(view?.session?.name || 'No session'),
      `Context ${tokens(ctx.inputTokens)}/${tokens(ctx.windowTokens)} ${percent(ctx.usedPercent)}`,
      `Last input ${tokens(telemetry?.lastRequest?.inputTokens)} cache ${tokens(telemetry?.lastRequest?.cachedInputTokens)} fresh ${tokens(telemetry?.lastRequest?.freshInputTokens)}`,
      `Last output ${tokens(telemetry?.lastRequest?.outputTokens)} reasoning ${tokens(telemetry?.lastRequest?.reasoningOutputTokens)}`,
      `Session input ${tokens(telemetry?.totals?.inputTokens)} output ${tokens(telemetry?.totals?.outputTokens)} turns ${telemetry?.turns ?? 'unknown'}`,
      ...limitLines('5h', subscription?.fiveHour, t, true), ...limitLines('Week', subscription?.weekly, t, true),
      'Esc/Q Back | Ctrl+C Exit',
    ];
    return compact.slice(0, options.rows).map(line => fit(line, width, false, t.ascii)).join('\n');
  }
  return lines.join('\n');
}
function renderBrowser(state, options = {}) {
  const t = theme(options), width = Math.max(4, options.columns || 90), height = options.rows || 30;
  const narrow = width < 72, pageSize = Math.max(1, Math.floor((height - 7) / (narrow ? 4 : 1)));
  const start = Math.floor(state.selected / pageSize) * pageSize;
  const lines = [t.paint('title', 'CODEX HUD / SESSION BROWSER'),
    `Filter: ${state.filter} | ${state.rows.length} sessions | A All  P Current Project  N Recent ${state.recent}`, ''];
  const nameWidth = Math.max(12, width - 59), projectWidth = 17, modelWidth = 20;
  const tableRow = (marker, name, project, model, updated) => `${marker} ${fit(name, nameWidth, true, t.ascii)} ${fit(project, projectWidth, true, t.ascii)} ${fit(model, modelWidth, true, t.ascii)} ${updated}`;
  if (!narrow) lines.push(tableRow(' ', 'Name', 'Project', 'Model', 'Updated'));
  if (!state.rows.length) lines.push('No Codex sessions in this filter. Try A; run Codex to create telemetry.');
  state.rows.slice(start, start + pageSize).forEach((s, i) => {
    const marker = i + start === state.selected ? '>' : ' ', updated = s.updatedAt?.replace('T', ' ').slice(0, 16) + 'Z';
    if (narrow) lines.push(`${marker} ${sanitize(s.name)}`, `  Project ${sanitize(s.project)}`,
      `  Model ${sanitize(s.modelName)}`, `  Updated ${updated}`);
    else lines.push(tableRow(marker, sanitize(s.name), sanitize(s.project), sanitize(s.modelName), updated));
  });
  lines.push('', t.paint('secondary', `${t.ascii ? 'Up/Down' : '↑/↓'} Select | Enter HUD | R Refresh | Esc/Q Exit`));
  return lines.map(line => fit(line, width, false, t.ascii)).slice(0, height).join('\n');
}
function statusline(view) {
  const s = view?.telemetry, sub = view?.subscription;
  const window = (label, limit) => `${label} ${limit?.state || 'UNKNOWN'}${limit?.usedPercent != null ? ` ${percent(limit.usedPercent)} used; reset ${duration(limit.resetSeconds)}` : ''}`;
  return sanitize(`${s?.modelName || 'unknown'} ${s?.reasoningEffort || 'unknown'} | Context ${tokens(s?.context?.inputTokens)}/${tokens(s?.context?.windowTokens)} ${percent(s?.context?.usedPercent)} | Cache ${percent(s?.totals?.cacheHitPercent)} | Plan ${sub?.plan || 'unknown'} | ${window('5h', sub?.fiveHour)} | ${window('Week', sub?.weekly)}`);
}
module.exports = { renderHud, renderBrowser, statusline, tokens, percent, duration };
