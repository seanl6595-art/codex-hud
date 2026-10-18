import { useMemo, useState } from 'react';
import { BarChart3, ChartNoAxesCombined } from 'lucide-react';
import { ComposedChart, Bar, Cell, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Brush } from 'recharts';
import type { Stats } from '../../../lib/gui/contracts';
import { compactTokens, readPreference, savePreference } from '../formatters.mjs';
import { gapGuides, niceAxis } from '../chart-math.mjs';
import { useI18n } from '../i18n';
import TokenValue from './TokenValue';
import ChartDialog, { ExpandButton } from './ChartDialog';
type Visible = 'input' | 'output';
export default function UsageCharts({ stats, overview = false }: { stats: Stats; overview?: boolean }) {
  const { t, locale } = useI18n(), zone = stats.period.timezone;
  const [chartType, setChartType] = useState<'bar' | 'line'>(() => readPreference('codex-hud.chart-type.v1', ['bar','line'], 'bar'));
  const [expanded, setExpanded] = useState(false), [connect, setConnect] = useState(true), [split, setSplit] = useState(false);
  const [visible, setVisible] = useState<Visible[]>(['input','output']);
  const [zoom, setZoom] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const chooseType = (next: 'bar' | 'line') => { setChartType(next); savePreference('codex-hud.chart-type.v1', next); };
  const label = (key: string, full = false) => new Date(stats.bucketUnit === 'day' ? key + 'T12:00Z' : key).toLocaleString(locale,
    stats.bucketUnit === 'day' ? { month: 'short', day: 'numeric', ...(full ? { year: 'numeric' } : {}), timeZone: 'UTC' }
      : { hour: 'numeric', ...(full ? { minute: '2-digit', month: 'short', day: 'numeric', timeZoneName: 'shortOffset' } : {}), timeZone: zone });
  const data = useMemo(() => stats.buckets.map(b => ({ key: b.key,
    input: b.observations ? b.totals.input.value : null, output: b.observations ? b.totals.output.value : null })), [stats]);
  const bucketsByKey = useMemo(() => new Map(stats.buckets.map(b => [b.key, b])), [stats.buckets]);
  const start = expanded ? Math.min(zoom?.startIndex || 0, data.length - 1) : 0;
  const end = expanded ? Math.min(zoom?.endIndex ?? data.length - 1, data.length - 1) : data.length - 1;
  const controls = <div className="chart-controls">
    <div className="chart-type segmented" aria-label={t('chartType')}>{(['bar','line'] as const).map(type => <button key={type} aria-label={t(type)} aria-pressed={chartType === type} onClick={() => chooseType(type)}>{type === 'bar' ? <BarChart3 size={16}/> : <ChartNoAxesCombined size={16}/>}<span>{t(type)}</span></button>)}</div>
    <div className="metric-toggles">{(['input','output'] as const).map(metric => <label key={metric}><input type="checkbox" checked={visible.includes(metric)} disabled={visible.length === 1 && visible.includes(metric)} onChange={() => setVisible(v => v.includes(metric) ? v.filter(x => x !== metric) : [...v, metric])}/><i className={'dot ' + metric}/>{t(metric)}</label>)}</div>
    {chartType === 'line' && <label><input type="checkbox" checked={connect} onChange={e => setConnect(e.target.checked)}/>{t('connectGaps')}</label>}
    {expanded && <><label><input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)}/>{t('splitScales')}</label><button className="button" disabled={!zoom} onClick={() => setZoom(null)}>{t('resetZoom')}</button></>}
  </div>;
  function plot(metrics: Visible[], detailed: boolean, brush: boolean) {
    const maximum = data.slice(start, end + 1).reduce((max, row) => Math.max(max, ...metrics.map(k => row[k] || 0)), 0), axis = niceAxis(maximum, detailed);
    return <div className={'chart' + (detailed ? ' expanded-chart' : '') + (split && detailed ? ' split-chart' : '')} aria-label={t('chartDescription')}>
      <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 14, right: 20, left: 4, bottom: 6 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--line)"/>
        {axis.minor.map(y => <ReferenceLine key={y} y={y} stroke="var(--line)" strokeDasharray="2 5" strokeOpacity={.55}/>)}
        <XAxis dataKey="key" tickFormatter={key => label(String(key))} minTickGap={40} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 13 }} dy={9}/>
        <YAxis domain={[0, axis.maximum]} ticks={axis.ticks} allowDataOverflow tickFormatter={value => compactTokens(Number(value))} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 13 }} width={68}/>
        <Tooltip filterNull={false} isAnimationActive={false} cursor={{ stroke: 'var(--line)', fill: 'rgba(111,151,197,.08)' }} content={({ active, label: key }) => {
          const bucket = bucketsByKey.get(String(key));
          if (!active || !bucket) return null;
          return <div className="chart-tooltip" role="tooltip"><strong>{label(bucket.key, true)}</strong><small>{zone}</small>
            {!bucket.observations ? <p>{t('chartNoObservations')}</p> : <>{metrics.map(metric =>
              <div className={'tooltip-metric tooltip-' + metric} key={metric}><span>{t(metric)}</span><TokenValue value={bucket.totals[metric].value} complete={bucket.totals[metric].complete} detailed/></div>)}
              <p className={bucket.state === 'incomplete' ? 'tooltip-warning' : ''}>{t(bucket.state === 'zero' ? 'zeroDescription' : bucket.state === 'incomplete' ? 'incompleteTelemetry' : 'completeDescription')}</p></>}
          </div>;
        }}/>
        {chartType === 'line' && connect && metrics.flatMap(metric => gapGuides(stats.buckets.slice(start, end + 1), metric).map((segment, i) => <ReferenceLine className="gap-guide" key={metric + i} segment={segment} stroke={'var(--' + metric + ')'} strokeDasharray="5 5" strokeWidth={1.5} strokeOpacity={.65}/>))}
        {metrics.map(metric => chartType === 'bar'
          ? <Bar key={metric} dataKey={metric} fill={'var(--' + metric + ')'} radius={[3,3,0,0]} maxBarSize={detailed ? 32 : 24} isAnimationActive={false}>{stats.buckets.map(b => <Cell key={b.key} stroke={b.totals[metric].complete ? 'none' : 'var(--warning)'} fillOpacity={b.totals[metric].complete ? 1 : .65}/>)}</Bar>
          : <Line key={metric} type="linear" dataKey={metric} stroke={'var(--' + metric + ')'} strokeWidth={2} dot={props => {
            const {cx,cy,payload} = props, bucket = bucketsByKey.get(payload?.key);
            if (!bucket?.observations || bucket.totals[metric].value === null) return <g/>;
            return bucket.totals[metric].complete ? <circle cx={cx} cy={cy} r={detailed ? 3 : 2} fill={'var(--' + metric + ')'}/>
              : <rect x={(cx || 0)-4} y={(cy || 0)-4} width={8} height={8} fill={'var(--' + metric + ')'} stroke="var(--warning)" strokeWidth={2}/>;
          }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false}/>)}
        {detailed && <Brush dataKey="key" height={brush ? 34 : 0} travellerWidth={brush ? 12 : 0} stroke="var(--muted)" fill="var(--ground)" tickFormatter={key => label(String(key))} startIndex={start} endIndex={end} onChange={next => { if (next.startIndex !== undefined && next.endIndex !== undefined) setZoom({startIndex: next.startIndex, endIndex: next.endIndex}); }}/ >}
      </ComposedChart></ResponsiveContainer>
    </div>;
  }
  const content = (detailed: boolean) => <>{controls}{detailed && <p className="exploration-caption">{label(data[start]?.key || stats.period.from, true)} → {label(data[end]?.key || stats.period.to, true)} · {zone} · {t('brushHelp')}</p>}
    {detailed && split ? visible.map((metric, i) => <div className="split-pane" key={metric}><h3 className={'metric-' + metric}>{t(metric)} · {t('independentScale')}</h3>{plot([metric], true, i === visible.length - 1)}</div>) : plot(visible, detailed, true)}
    <p className="chart-note">{t('chartGaps')}{chartType === 'line' && connect ? ' ' + t('gapGuideNote') : ''}{!split && visible.length > 1 ? ' ' + t('scaleHelp') : ''}</p></>;
  return <section className={'panel usage-panel' + (overview ? ' overview-trend' : '')} data-chart-type={chartType}>
    <div className="panel-heading"><div><h2>{t('usageOverTime')}</h2><p>{t(stats.bucketUnit === 'hour' ? 'hourlyDeltas' : 'dailyDeltas')} · {zone}</p></div><ExpandButton title={t('usageOverTime')} onClick={() => setExpanded(true)}/></div>
    {!expanded && content(false)}
    {expanded && <ChartDialog title={t('usageOverTime')} onClose={() => setExpanded(false)}>{content(true)}</ChartDialog>}
  </section>;
}
