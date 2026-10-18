import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Bar, Line, ComposedChart, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { AnalyticsGroup, MetricName, Stats, Workload } from '../../../lib/gui/contracts';
import { request } from '../api';
import { compactTokens, exactTokens } from '../formatters.mjs';
import { niceAxis } from '../chart-math.mjs';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import TokenValue from './TokenValue';
import ChartDialog, { ExpandButton } from './ChartDialog';
const metrics: MetricName[] = ['input','cached','fresh','output','reasoning'];
const palette = ['#59d9f5','#c7a0ff','#68e4b0','#ffc078','#7d9dff','#ff9dbb','#c6dc89','#afbecf'];
const identity = (model: string | null) => JSON.stringify(model);
const hash = (model: string) => Array.from(model).reduce((n,c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
function workload(g: Pick<AnalyticsGroup, 'totals'>, metric: Workload) {
  if (metric !== 'combined') return g.totals[metric];
  const a = g.totals.input, b = g.totals.output;
  return { value: a.value === null && b.value === null ? null : (a.value || 0) + (b.value || 0), complete: a.complete && b.complete };
}
type Sort = MetricName | 'model' | 'usageEvents' | 'observedTurns' | 'distinctSessions' | 'cacheRatio' | 'inputWorkloadShare';
export default function ModelAnalytics({stats, loading = false, onSelect}: {stats: Stats; loading?:boolean;onSelect: (id: string) => void}) {
  const { t, locale } = useI18n();
  const modelColors = useMemo(() => {
    const colors = new Map<string | null, string>([[null, '#a3afc3']]), used = new Set<number>();
    for (const model of (stats.analytics?.modelOptions || []).filter((m): m is string => m !== null).sort()) {
      let index = hash(model) % palette.length;
      if (used.size < palette.length) { while (used.has(index)) index = (index + 1) % palette.length; used.add(index); colors.set(model, palette[index]); }
      else colors.set(model, `hsl(${hash(model) % 360} 65% 72%)`);
    }
    return colors;
  }, [stats.analytics?.modelOptions]);
  const color = (model: string | null) => modelColors.get(model) || '#a3afc3';
  const [model, setModel] = useState('all'), [effort, setEffort] = useState('all'), [metric, setMetric] = useState<Workload>('input');
  const [search, setSearch] = useState(''), [limit, setLimit] = useState('10'), [page, setPage] = useState(0);
  const [sort, setSort] = useState<Sort>('input'), [descending, setDescending] = useState(true), [chartType, setChartType] = useState<'bar'|'line'>('bar');
  const [expanded, setExpanded] = useState(false), [seriesLimit, setSeriesLimit] = useState('5');
  const params = new URLSearchParams({range: 'absolute', from: stats.period.from, to: stats.period.to, timezone: stats.period.timezone, analytics:'1'});
  if (stats.verification) params.set('evidenceRevision', stats.verification.snapshotId);
  if (model !== 'all') params.set('model', model); if (effort !== 'all') params.set('effort', effort);
  const {data: filtered, error, isLoading} = useSWR<Stats>(model !== 'all' || effort !== 'all' ? '/api/stats?' + params : null, request, {revalidateOnFocus: false});
  const analytics = model === 'all' && effort === 'all' ? stats.analytics : filtered?.analytics;
  const effortName = (name: string | null) => {
    const labels: Record<string, MessageKey> = {minimal:'effortMinimal',low:'effortLow',medium:'effortMedium',high:'effortHigh',xhigh:'effortXhigh',none:'effortNone',auto:'effortAuto'};
    return name === null ? t('unknownAttribution') : labels[name] ? t(labels[name]) : name;
  };
  const name = (value: string | null) => value ?? t('unknownAttribution');
  const ranked = useMemo(() => (analytics?.models || []).filter(g => name(g.model).toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a,b) => {
    const value = (g: AnalyticsGroup): number => metrics.includes(sort as MetricName) ? g.totals[sort as MetricName].value ?? -1
      : sort === 'observedTurns' ? g.observedTurns.value : sort === 'cacheRatio' ? g.cacheRatio.value ?? -1 : sort === 'inputWorkloadShare' ? g.shares.input.value ?? -1 : sort === 'model' ? 0 : g[sort as 'usageEvents'|'distinctSessions'];
    return (sort === 'model' ? name(a.model).localeCompare(name(b.model)) : value(a) - value(b)) * (descending ? -1 : 1);
  }), [analytics, search, sort, descending, locale]);
  const limited = limit === 'all' ? ranked : ranked.slice(0, Number(limit)), pages = Math.max(1, Math.ceil(limited.length / 25)), currentPage = Math.min(page, pages - 1), rows = limited.slice(currentPage * 25, (currentPage + 1) * 25);
  const distributionGroups = [...(analytics?.models || [])].sort((a,b) => (workload(b,metric).value || 0) - (workload(a,metric).value || 0));
  const shownDistribution = limit === 'all' ? distributionGroups : distributionGroups.slice(0,Number(limit));
  const unknownGroup = analytics?.models.find(g => g.model === null);
  if (unknownGroup && !shownDistribution.includes(unknownGroup)) shownDistribution.push(unknownGroup);
  function order(key: Sort) { if (sort === key) setDescending(v => !v); else {setSort(key); setDescending(key !== 'model');} setPage(0); }
  const heading = (key: Sort, text: string) => <th key={key} aria-sort={sort === key ? descending ? 'descending' : 'ascending' : 'none'}><button aria-label={text} onClick={() => order(key)}>{text}{sort === key ? descending ? ' ↓' : ' ↑' : ''}</button></th>;
  const percent = (value: number | null) => value === null ? '—' : value.toFixed(1) + '%';
  const groupValues = (g: AnalyticsGroup) => <>{metrics.map(k => <td key={k}><TokenValue value={g.totals[k].value} complete={g.totals[k].complete}/></td>)}</>;
  function distribution(groups: AnalyticsGroup[], byEffort = false) {
    const ordered = [...groups].sort((a,b) => (workload(b, metric).value || 0) - (workload(a, metric).value || 0));
    const maximum = ordered.reduce((m,g) => Math.max(m, workload(g,metric).value || 0), 1);
    return <div className="distribution" aria-label={t(byEffort ? 'effortAnalytics' : 'modelDistribution')}>{ordered.map(g => {
      const m = workload(g, metric), label = byEffort ? effortName(g.effort) : name(g.model);
      return <button className="distribution-row" key={identity(byEffort ? g.effort : g.model)} onClick={() => byEffort ? setEffort(identity(g.effort)) : setModel(identity(g.model))}>
        <span className="distribution-name">{label}</span><span className="distribution-track"><i style={{width: (m.value || 0) / maximum * 100 + '%', background: byEffort ? 'var(--reasoning)' : color(g.model)}}/></span>
        <strong><TokenValue value={m.value} complete={m.complete}/></strong><span>{percent(g.shares[metric].value)}</span></button>;
    })}</div>;
  }
  const timeline = useMemo(() => {
    const candidates = [...(analytics?.models || [])].filter(g => g.observations > 0).sort((a,b) => (workload(b, metric).value || 0) - (workload(a, metric).value || 0));
    const series = seriesLimit === 'all' ? candidates : candidates.slice(0, Number(seriesLimit));
    const data = stats.buckets.map((b, index) => {
      const out: Record<string, string | number | null> = {key:b.key};
      series.forEach((g, i) => { const bucket = g.buckets?.[index]; out['s' + i] = bucket?.observations ? workload(bucket, metric).value : null; });
      return out;
    });
    return {series, data};
  }, [analytics, stats.buckets, metric, seriesLimit]);
  const date = (key: string) => new Date(stats.bucketUnit === 'day' ? key + 'T12:00Z' : key).toLocaleString(locale, stats.bucketUnit === 'day' ? {month:'short',day:'numeric',timeZone:'UTC'} : {hour:'numeric',timeZone:stats.period.timezone});
  function trend(detailed: boolean) {
    const maximum = timeline.data.reduce((max,row) => Math.max(max, chartType === 'bar' ? timeline.series.reduce((sum,_,i) => sum + Number(row['s'+i] || 0), 0) : Math.max(0,...timeline.series.map((_,i) => Number(row['s'+i] || 0)))), 0), axis = niceAxis(maximum, detailed);
    return <><div className="chart-controls"><div className="segmented chart-type">{(['bar','line'] as const).map(type => <button key={type} aria-pressed={chartType === type} onClick={() => setChartType(type)}>{t(type)}</button>)}</div>
      <label>{t('modelSeriesLimit')}<select value={seriesLimit} onChange={e => setSeriesLimit(e.target.value)}>{['5','10','all'].map(l => <option key={l} value={l}>{l === 'all' ? t('all') : t('topN',{count:l})}</option>)}</select></label>
      <span>{t(metric === 'combined' ? 'combined' : metric)} · {stats.period.timezone}</span></div>
      <div className="model-legend">{timeline.series.map(g => <button key={identity(g.model)} onClick={() => setModel(identity(g.model))}><i className="dot" style={{background: color(g.model)}}/>{name(g.model)}</button>)}</div>
      <div className={'chart model-chart' + (detailed ? ' expanded-chart' : '')}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={timeline.data} accessibilityLayer margin={{top:14,right:22,bottom:6,left:4}}>
        <CartesianGrid vertical={false} stroke="var(--line)"/><XAxis dataKey="key" tickFormatter={key => date(String(key))} minTickGap={40} tick={{fill:'var(--muted)',fontSize:13}} axisLine={false} tickLine={false}/>
        <YAxis domain={[0,axis.maximum]} ticks={axis.ticks} tickFormatter={v => compactTokens(Number(v))} width={68} tick={{fill:'var(--muted)',fontSize:13}} axisLine={false} tickLine={false}/>
        <Tooltip filterNull={false} isAnimationActive={false} content={({active,label}) => {
          if (!active) return null; const index = stats.buckets.findIndex(b => b.key === String(label));
          return <div className="chart-tooltip" role="tooltip"><strong>{date(String(label))}</strong><small>{String(label)} · {stats.period.timezone}</small>{timeline.series.map(g => {
            const bucket = g.buckets?.[index]; if (!bucket?.observations) return <p key={identity(g.model)}>{name(g.model)} · {t('noObservations')}</p>;
            const m = workload(bucket,metric); return <div className="tooltip-metric" key={identity(g.model)}><span style={{color:color(g.model)}}>{name(g.model)}</span><TokenValue value={m.value} complete={m.complete} detailed/></div>;
          })}</div>;
        }}/>
        {timeline.series.map((g,i) => chartType === 'bar' ? <Bar key={identity(g.model)} dataKey={'s'+i} name={name(g.model)} stackId="workload" fill={color(g.model)} maxBarSize={32} isAnimationActive={false}/>
          : <Line key={identity(g.model)} dataKey={'s'+i} name={name(g.model)} stroke={color(g.model)} dot={{r:2}} connectNulls={false} strokeWidth={2} isAnimationActive={false}/>)}
      </ComposedChart></ResponsiveContainer></div><p className="chart-note">{t('modelTrendHelp')} {t('seriesNote',{count:timeline.series.length})}</p></>;
  }
  const options = stats.analytics;
  return <section className="model-analytics" aria-label={t('modelAnalytics')}>
    <div className="analytics-heading"><div><h2>{t('modelAnalytics')}</h2><p>{t('analyticsSubtitle')}</p></div></div>
    {!stats.analytics && !loading && <div className="error-box analytics-unavailable" role="alert"><strong>{t('analyticsServerUnavailable')}</strong><p>{t('analyticsRestartHelp')}</p></div>}
    {!stats.analytics && loading && <div className="skeleton" role="status">{t('loadingAnalytics')}</div>}
    <div className="analytics-filters" role="group" aria-label={t('analyticsFilters')}>
      <label>{t('modelFilter')}<select aria-label={t('modelFilter')} value={model} onChange={e => {setModel(e.target.value); setPage(0);}}><option value="all">{t('allModels')}</option>{options?.modelOptions.map(m => <option key={identity(m)} value={identity(m)}>{name(m)}</option>)}</select></label>
      <label>{t('effortFilter')}<select aria-label={t('effortFilter')} value={effort} onChange={e => {setEffort(e.target.value); setPage(0);}}><option value="all">{t('allEfforts')}</option>{options?.effortOptions.map(e => <option key={identity(e)} value={identity(e)}>{effortName(e)}</option>)}</select></label>
      <label>{t('workload')}<select aria-label={t('workload')} value={metric} onChange={e => setMetric(e.target.value as Workload)}>{(['input','output','combined'] as const).map(k => <option key={k} value={k}>{t(k)}</option>)}</select></label>
      <button className="button" disabled={model === 'all' && effort === 'all'} onClick={() => {setModel('all');setEffort('all');setPage(0);}}>{t('clearFilters')}</button>
    </div>
    {error && <p role="alert" className="error-box">{t('errorRead')}</p>}
    {isLoading && <div className="skeleton" role="status">{t('updating')}</div>}
    {analytics && <>
      <div className="analytics-coverage panel"><h3>{t('attributionCoverageTitle')}</h3>{analytics.coverage && <p>{t('attributionCoverageCounts',{count:exactTokens(analytics.observations),model:exactTokens(analytics.coverage.knownModelMetadata),effort:exactTokens(analytics.coverage.knownEffortMetadata),valid:exactTokens(analytics.coverage.validPrimaryDeltas)})}</p>}
        <p>{t('attributionWorkload',{metric:t(metric),known:compactTokens(analytics.models.filter(g=>g.model!==null).reduce((n,g)=>n+(workload(g,metric).value||0),0)),unknown:compactTokens(workload(analytics.models.find(g=>g.model===null) || {totals:analytics.totals},metric).value)})}</p>
        {analytics.observations>0 && !analytics.models.some(g=>g.model!==null && g.observations>0) && <p className="attribution-unknown">{t('allModelAttributionUnknown')}</p>}
        <p>{t('attributionCoverageLimits')}</p></div>
      <div className="panel model-distribution"><div className="panel-heading"><div><h2>{t('modelDistribution')}</h2><p>{t('analyticsDenominator',{metric:t(metric)})}</p></div><span className="subtle-badge">{t('selectedRange')}</span></div>
        {analytics.observations ? distribution(shownDistribution) : <p className="empty-inline">{t('noAnalytics')}</p>}
        <div className="analytics-workload-total"><span>{t('observedWorkload')} · {t(metric)}</span><TokenValue value={workload({totals:analytics.totals},metric).value} complete={workload({totals:analytics.totals},metric).complete}/></div>
      </div>
      <div className="panel model-table"><div className="panel-heading"><h2>{t('modelTable')}</h2></div><div className="analytics-table-controls"><label>{t('searchModels')}<input aria-label={t('searchModels')} value={search} onChange={e => {setSearch(e.target.value);setPage(0);}}/></label><label>{t('analyticsLimit')}<select aria-label={t('analyticsLimit')} value={limit} onChange={e => {setLimit(e.target.value);setPage(0);}}>{['5','10','all'].map(l => <option key={l} value={l}>{l === 'all' ? t('all') : t('topN',{count:l})}</option>)}</select></label></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t('modelTable')}><table><thead><tr>{heading('model',t('model'))}{heading('usageEvents',t('usageEvents'))}{heading('observedTurns',t('observedTurns'))}{heading('distinctSessions',t('distinctSessions'))}{metrics.map(k => heading(k,t(k)))}{heading('cacheRatio',t('cacheRatio'))}{heading('inputWorkloadShare',t('inputWorkloadShare'))}<th>{t('effortBreakdown')}</th></tr></thead>
          <tbody>{rows.map(g => <tr key={identity(g.model)}><td><button className="text-button model-name" onClick={() => setModel(identity(g.model))}><i className="dot" style={{background:color(g.model)}}/>{name(g.model)}</button></td><td>{exactTokens(g.usageEvents)}{!g.activityComplete && '*'}</td><td>{exactTokens(g.observedTurns.value)}{!g.observedTurns.complete && '*'}</td><td>{exactTokens(g.distinctSessions)}{!g.activityComplete && '*'}</td>{groupValues(g)}<td>{percent(g.cacheRatio.value)}</td><td>{percent(g.shares.input.value)}</td><td className="effort-breakdown">{analytics.cross.filter(c => c.model === g.model).map(c => <button key={identity(c.effort)} className="text-button" onClick={() => {setModel(identity(g.model));setEffort(identity(c.effort));}}>{effortName(c.effort)} <TokenValue value={workload(c,metric).value} complete={workload(c,metric).complete}/></button>)}</td></tr>)}</tbody></table></div>
        {!rows.length && <p className="empty-inline">{t('noAnalytics')}</p>}
        {pages > 1 && <div className="analytics-pagination"><button className="button" disabled={!currentPage} onClick={() => setPage(p => p - 1)}>{t('previous')}</button><span>{t('pageOf',{page:currentPage+1,pages})}</span><button className="button" disabled={currentPage >= pages - 1} onClick={() => setPage(p => p + 1)}>{t('next')}</button></div>}
        <p className="chart-note">{t('analyticsDenominator',{metric:t('input')})}</p>
      </div>
      <div className="panel model-trend"><div className="panel-heading"><div><h2>{t('modelTrend')}</h2><p>{t(stats.bucketUnit === 'hour' ? 'hourlyDeltas' : 'dailyDeltas')}</p></div><ExpandButton title={t('modelTrend')} onClick={() => setExpanded(true)}/></div>{!expanded && trend(false)}{expanded && <ChartDialog title={t('modelTrend')} onClose={() => setExpanded(false)}>{trend(true)}</ChartDialog>}</div>
      <section className="panel effort-analytics"><div className="panel-heading"><div><h2>{t('effortAnalytics')}</h2><p>{t('effortSubtitle')}</p></div></div>{distribution(analytics.efforts, true)}
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t('effortAnalytics')}><table><thead><tr><th>{t('reasoningEffort')}</th>{metrics.map(k => <th key={k}>{t(k)}</th>)}<th>{t('usageEvents')}</th><th>{t('observedTurns')}</th><th>{t('distinctSessions')}</th><th>{t('cacheRatio')}</th><th>{t('distributionShare')}</th></tr></thead><tbody>{analytics.efforts.map(g => <tr key={identity(g.effort)}><td><button className="text-button" onClick={() => setEffort(identity(g.effort))}>{effortName(g.effort)}</button></td>{groupValues(g)}<td>{exactTokens(g.usageEvents)}{!g.activityComplete && '*'}</td><td>{exactTokens(g.observedTurns.value)}{!g.observedTurns.complete && '*'}</td><td>{exactTokens(g.distinctSessions)}{!g.activityComplete && '*'}</td><td>{percent(g.cacheRatio.value)}</td><td>{percent(g.shares[metric].value)}</td></tr>)}</tbody></table></div>
        <p className="chart-note">{t('analyticsDenominator',{metric:t(metric)})}</p>
      </section>
      {model !== 'all' && <div className="panel related-sessions"><div className="panel-heading"><h2>{t('relatedSessions')} · {name(JSON.parse(model))}</h2></div><div className="related-session-list">{[...new Set(analytics.models.flatMap(g => g.sessionIds))].map(id => <button key={id} className="text-button" onClick={() => onSelect(id)}>{stats.sessions.find(s => s.sessionId === id)?.displayName || id}</button>)}</div></div>}
      <details className="panel quality-details" open><summary>{t('qualityDetails')}</summary><p>{t('coverageDetail',{count:exactTokens(analytics.observations),unknown:exactTokens(stats.coverage.invalidTimestampObservations)})}</p><p>{t('attributionNote')}</p><p>{t('privacyNote')}</p></details>
    </>}
  </section>;
}
