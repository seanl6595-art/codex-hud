import useSWR from 'swr';
import ChartDialog, { ExpandButton } from './ChartDialog';
import { request } from '../api';
import { useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Grid2X2 } from 'lucide-react';
import type { Bucket, Stats } from '../../../lib/gui/contracts';
import { tokenTotal } from '../api';
import { compactTokens, exactTokens } from '../formatters.mjs';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import TokenValue from './TokenValue';
const descriptions: Record<Bucket['state'], MessageKey> = {
  missing: 'missingDescription', incomplete: 'incompleteDescription', zero: 'zeroDescription', observed: 'completeDescription'
};
const bands = ['>0–10%','>10–25%','>25–50%','>50–75%','>75–100%'];
function HeatmapCalendar({ stats, expanded = false }: { stats: Stats; expanded?: boolean }) {
  const { t, locale } = useI18n(), wrapper = useRef<HTMLDivElement>(null);
  const tipId = useId();
  const [tip, setTip] = useState<{ cell: Bucket; left: number; top: number } | null>(null);
  const { cells, weeks, levels, months, max } = useMemo(() => {
    const buckets = stats.buckets, startDay = (new Date(buckets[0].key + 'T12:00Z').getUTCDay() + 6) % 7;
    const cells: (Bucket | null)[] = [...Array(startDay).fill(null), ...buckets], weeks = Math.ceil(cells.length / 7);
    while (cells.length < weeks * 7) cells.push(null);
    // Only complete positive days establish the visual scale. Accounting values are untouched.
    const max = Math.max(1, ...buckets.filter(b => b.state === 'observed').map(b => tokenTotal(b.totals) || 0));
    const levels = buckets.reduce<Record<string, number>>((out, b) => {
      const ratio = (tokenTotal(b.totals) || 0) / max;
      out[b.key] = ratio <= .1 ? 1 : ratio <= .25 ? 2 : ratio <= .5 ? 3 : ratio <= .75 ? 4 : 5; return out;
    }, {});
    let previous = '';
    const months = Array.from({ length: weeks }, (_, col) => {
      const first = cells.slice(col * 7, col * 7 + 7).find(Boolean);
      const month = first ? new Date(first.key + 'T12:00Z').toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' }) : '';
      const label = month !== previous ? month : ''; previous = month; return label;
    });
    return { cells, weeks, levels, months, max };
  }, [stats, locale]);
  const show = (cell: Bucket, target: HTMLElement) => {
    const base = wrapper.current!.getBoundingClientRect(), rect = target.getBoundingClientRect();
    const above = window.innerHeight - rect.bottom < 230 && rect.top > 230;
    setTip({ cell, left: Math.max(0, Math.min(rect.left - base.left, base.width - 260)), top: above ? rect.top - base.top - 225 : rect.bottom - base.top + 10 });
  };
  const activeDays = stats.buckets.filter(b => (tokenTotal(b.totals) || 0) > 0).length;
  const complete = stats.totals.input.complete && stats.totals.output.complete;
  return <section className={'panel heatmap-panel' + (expanded ? ' expanded-heatmap' : '')}>
    <div className="panel-heading"><div><h2><Grid2X2 size={18}/>{t('heatmap')}</h2><p>{expanded ? stats.buckets[0].key + ' → ' + stats.buckets[stats.buckets.length - 1].key + ' · ' + stats.period.timezone : t('heatmapSubtitle')}</p></div>
      <span className="subtle-badge">{t('activeDays', { count: activeDays })}</span></div>
    <div className="heatmap-body"><div className="heatmap-wrap" ref={wrapper}>
      <div className="heatmap-scroll"><div className="heatmap-calendar" style={{ '--weeks': weeks, ...(expanded ? {'--cell': stats.buckets.length > 182 ? '26px' : stats.buckets.length > 84 ? '34px' : 'clamp(38px, 3.3vw, 64px)'} : {}) } as React.CSSProperties}>
        <div className="heatmap-months">{months.map((m, i) => <span key={i}>{m}</span>)}</div>
        <div className="heatmap-weekdays">{(['weekMon', '', 'weekWed', '', 'weekFri', '', 'weekSun'] as const).map((d, i) => <span key={i}>{d ? t(d) : ''}</span>)}</div>
        <div className="heatmap-grid">{cells.map((b, i) => b ? <button key={b.key}
          className={'heatcell ' + (b.state === 'observed' ? 'level-' + levels[b.key] : b.state)}
          aria-label={b.key + ': ' + (b.state === 'missing' ? t('activityUnknown') : exactTokens(tokenTotal(b.totals)) + ' ' + t('accountedTokens')) + '. ' + t(descriptions[b.state])}
          aria-describedby={tip?.cell.key === b.key ? tipId : undefined}
          data-date={b.key} onMouseEnter={e => show(b, e.currentTarget)} onMouseLeave={() => setTip(null)}
          onFocus={e => show(b, e.currentTarget)} onBlur={() => setTip(null)} onClick={e => show(b, e.currentTarget)}/>
          : <span className="heatcell padding" key={'pad-' + i}/>)}</div>
      </div></div>
      {tip && <div role="tooltip" id={tipId} className="heat-tooltip" style={{ left: tip.left, top: tip.top }}>
        <strong>{new Date(tip.cell.key + 'T12:00Z').toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</strong>
        <small>{t('calendarDate', { timezone: stats.period.timezone })}</small>
        <div className="heat-tooltip-value">{tip.cell.state === 'missing' ? <strong>{t('unknown')}</strong> :
          <TokenValue value={tokenTotal(tip.cell.totals)} complete={tip.cell.state !== 'incomplete'} detailed/>}</div>
        <p>{t(descriptions[tip.cell.state])}</p><small>{t('observationCount', { count: exactTokens(tip.cell.observations) })} · {t('inputPlusOutput')}</small>
      </div>}
    </div><div className="heatmap-summary"><span>{expanded ? t('observedWorkload') : t('observedTokens')}</span><strong><TokenValue value={tokenTotal(stats.totals)} complete={complete}/></strong>
      <small>{t('inputPlusOutput')}</small><div className="heatmap-observed"><b>{stats.buckets.filter(b => b.observations > 0).length}<small> / {stats.buckets.length}</small></b><span>{t('observedDays')}</span></div>
    </div></div>
    <div className="heatmap-footer"><div className="heatmap-legend" aria-label={t('heatmap')}><span>{t('less')}</span>{[1,2,3,4,5].map(level =>
      <i key={level} className={'heatcell level-' + level} title={t('intensityBand', { level, band: bands[level - 1] })}/>)}<ArrowRight size={11}/><span>{t('more')}</span></div>
      <div className="heatmap-state-key"><span><i className="heatcell zero"/>{t('zeroRecorded')}</span><span><i className="heatcell missing"/>{t('noObservations')}</span><span><i className="heatcell incomplete"/>{t('incomplete')}</span></div></div>
    <p className="heatmap-scale">{t('heatScale', { max: compactTokens(max) })} · {stats.period.timezone}</p>
  </section>;
}

export default function ActivityHeatmap({ stats }: {stats: Stats}) {
  const { t, errorText } = useI18n(), [expanded, setExpanded] = useState(false), [weeks, setWeeks] = useState(12), [offset, setOffset] = useState(0);
  const { data, error, isValidating } = useSWR<Stats>(expanded && (weeks !== 12 || offset !== 0) ? '/api/heatmap?timezone=' + encodeURIComponent(stats.period.timezone) + '&weeks=' + weeks + '&offset=' + offset : null, request, {revalidateOnFocus: false, keepPreviousData: true});
  const displayed = weeks === 12 && offset === 0 ? stats : data;
  return <div className="expandable-heatmap"><div className="heatmap-expander"><ExpandButton title={t('heatmap')} onClick={() => setExpanded(true)}/></div>
    {!expanded && <HeatmapCalendar stats={stats}/>}
    {expanded && <ChartDialog title={t('heatmap')} onClose={() => setExpanded(false)}>
      <div className="chart-controls"><label>{t('calendarWindow')}<select value={weeks} onChange={e => setWeeks(Number(e.target.value))}>{[12,26,52].map(w => <option key={w} value={w}>{t('weeks', {count:w})}</option>)}</select></label>
        <button className="button" disabled={offset >= 520 || isValidating} onClick={() => setOffset(o => o + 1)}>{t('earlierWeek')}</button><button className="button" disabled={!offset || isValidating} onClick={() => setOffset(o => o - 1)}>{t('laterWeek')}</button><button className="button" disabled={!offset} onClick={() => setOffset(0)}>{t('today')}</button>
        {isValidating && <span role="status">{t('updating')}</span>}</div>
      {error && <p className="error-box" role="alert">{errorText(error)}</p>}
      {displayed ? <HeatmapCalendar stats={displayed} expanded/> : <p className="empty-inline" role="status">{t('loadingHeatmap')}</p>}
    </ChartDialog>}
  </div>;
}
