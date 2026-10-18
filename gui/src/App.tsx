import { lazy, Suspense, useState } from 'react';
import useSWR from 'swr';
import { Activity, ChartNoAxesCombined, MessagesSquare, Database, Terminal, ShieldCheck, RefreshCw, ChevronRight, CircleHelp, Menu, ArrowUpRight } from 'lucide-react';
import type { Stats, RecorderStatus, Session } from '../../lib/gui/contracts';
import { bootstrap, request, rangeUrl, ApiError } from './api';
import type { Range } from './api';
import { useI18n } from './i18n';
import SummaryCards from './components/SummaryCards';
import RangePicker from './components/RangePicker';
import ActivityHeatmap from './components/ActivityHeatmap';
import SessionExplorer from './components/SessionExplorer';
import RecorderPanel from './components/RecorderPanel';
import SessionRanking from './components/SessionRanking';
import TokenValue from './components/TokenValue';
import { readPreference, savePreference } from './formatters.mjs';
const ModelAnalytics = lazy(() => import('./components/ModelAnalytics'));
const UsageCharts = lazy(() => import('./components/UsageCharts'));
const nav = [{ id: 'dashboard', icon: Activity }, { id: 'statistics', icon: ChartNoAxesCombined },
  { id: 'sessions', icon: MessagesSquare }, { id: 'recorder', icon: Database }] as const;
type View = typeof nav[number]['id'];
function CacheBreakdown({ stats }: { stats: Stats }) {
  const { t } = useI18n(), ratio = stats.ratios.cachedPercent, fresh = stats.ratios.freshPercent;
  return <section className="panel cache-panel"><div className="panel-heading"><div><h2>{t('inputComposition')}</h2><p>{t('matchedCohort')}</p></div></div>
    <div className="cache-percentage"><strong>{ratio.value == null ? '—' : ratio.value.toFixed(1) + '%'}</strong><span>{t('cachedInput')}</span></div>
    <div className="cache-bar" aria-label={t('proportions')}>{ratio.available && <><span style={{ width: ratio.value + '%' }}/><span style={{ width: fresh.value + '%' }}/></>}</div>
    <div className="breakdown-row"><span><i className="dot cached"/>{t('cached')}</span><strong><TokenValue value={stats.totals.cached.value} complete={stats.totals.cached.complete}/></strong></div>
    <div className="breakdown-row"><span><i className="dot fresh"/>{t('fresh')}</span><strong><TokenValue value={stats.totals.fresh.value} complete={stats.totals.fresh.complete}/></strong></div>
    <p className="chart-note">{t(ratio.available ? 'cacheNote' : ratio.complete ? 'positiveDenominator' : 'unavailableRatio')}</p>
  </section>;
}
function BucketTable({ stats }: { stats: Stats }) {
  const { t } = useI18n(), [open, setOpen] = useState(false);
  return <details className="panel data-table" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t('inspectBuckets')}</summary>{open && <div className="table-scroll"><table><thead><tr><th>{t('bucket')}</th>{(['input','cached','fresh','output','reasoning'] as const).map(key => <th key={key}>{t(key)}</th>)}<th>{t('observations')}</th><th>{t('dataStatus')}</th></tr></thead>
      <tbody>{stats.buckets.map(b => <tr key={b.key}><td>{b.key}</td>{(['input','cached','fresh','output','reasoning'] as const).map(key => <td key={key}><TokenValue value={b.totals[key].value} complete={b.totals[key].complete}/></td>)}<td>{b.observations}</td><td>{t(Object.values(b.totals).some(m => !m.complete) ? 'incomplete' : b.state === 'missing' ? 'noObservations' : b.state === 'zero' ? 'zeroRecorded' : 'complete')}</td></tr>)}</tbody></table></div>}
  </details>;
}
export default function App() {
  const { language, setLanguage, t, errorText, time } = useI18n();
  const [view, setView] = useState<View>('dashboard'), [mobileNav, setMobileNav] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState<Range>({ range: '24h', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const [checkingSources, setCheckingSources] = useState(false), [sourceCheckError, setSourceCheckError] = useState<string | null>(null);
  const [includeAutoReview, setIncludeAutoReview] = useState(() => readPreference('codex-hud.include-auto-review.v1', ['yes','no'], 'no') === 'yes');
  const changeAutoReview = (value: boolean) => {setIncludeAutoReview(value);savePreference('codex-hud.include-auto-review.v1',value?'yes':'no');};
  const { data: boot, error: connectionError, mutate: reconnect } = useSWR('bootstrap', bootstrap, { revalidateOnFocus: false });
  const statisticsView = view === 'dashboard' || view === 'statistics';
  const { data: stats, error: statsError, isLoading, isValidating, mutate: refreshStats } = useSWR<Stats>(boot && statisticsView ? rangeUrl(range) + (view === 'dashboard' ? '&analytics=0' : '&analytics=1') : null, request, { refreshInterval: 30000, keepPreviousData: true, revalidateOnFocus: false });
  const { data: heatmap, error: heatmapError, mutate: refreshHeatmap } = useSWR<Stats>(boot && view === 'dashboard' ? '/api/heatmap?timezone=' + encodeURIComponent(range.timezone) : null, request, { refreshInterval: 60000, revalidateOnFocus: false });
  const { data: catalog, error: sessionsError, mutate: refreshSessions } = useSWR<{ sessions: Session[]; diagnostics: { errors: number } }>(boot ? '/api/sessions' : null, request, { refreshInterval: 15000, revalidateOnFocus: false });
  const { data: status, error: recorderError, mutate: refreshRecorder } = useSWR<RecorderStatus>(boot ? '/api/recorder' : null, request, { refreshInterval: 3000, revalidateOnFocus: false });
  const navigate = (id: View) => { setView(id); setMobileNav(false); };
  const analyze = () => navigate('statistics');
  const isReview = (session: Session) => session.isAutoReview ?? session.model === 'codex-auto-review';
  const scopedSessions = (catalog?.sessions || []).filter(s => includeAutoReview || !isReview(s));
  const chooseSession = (id: string) => { if(catalog?.sessions.some(s=>s.id===id && isReview(s)))changeAutoReview(true);setSelected(id);navigate('sessions'); };
  const refresh = () => Promise.all([refreshStats(), refreshHeatmap(), refreshSessions(), refreshRecorder()]);
  const recheckSources = async () => {
    setCheckingSources(true); setSourceCheckError(null);
    try {
      await refreshStats(() => request<Stats>(rangeUrl(range) + (view === 'dashboard' ? '&analytics=0' : '&analytics=1') + '&verification=fresh'), { revalidate: false });
      await refreshHeatmap();
    } catch (error) { setSourceCheckError(errorText(error)); }
    finally { setCheckingSources(false); }
  };
  const action = async (command: string) => { await request('/api/recorder/' + command, 'POST'); await refresh(); };
  const titles = { dashboard: 'overviewTitle', statistics: 'statistics', sessions: 'sessions', recorder: 'recorder' } as const;
  const subtitles = { dashboard: 'overviewSubtitle', statistics: 'statisticsSubtitle', sessions: 'sessionsSubtitle', recorder: 'recorderSubtitle' } as const;
  const missing = statsError instanceof ApiError && statsError.code === 'DB_MISSING';
  const overview = view === 'dashboard';
  const trend = stats ? <div className="chart-row"><Suspense fallback={<div className="panel skeleton chart-skeleton" role="status">{t('loadingChart')}</div>}><UsageCharts stats={stats} overview={overview}/></Suspense><CacheBreakdown stats={stats}/></div> : null;
  return <div className="app-shell">
    <aside className={'sidebar ' + (mobileNav ? 'mobile-open' : '')}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('dashboard'); }}><span className="brand-symbol"><Terminal size={21}/></span><span>Codex <b>HUD</b><small>{t('observability')}</small></span></a>
      <nav aria-label={t('mainNavigation')}>{nav.map(({ id, icon: Icon }) => <button key={id} className={view === id ? 'nav-item active' : 'nav-item'} aria-label={t(id)} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={18}/><span>{t(id)}</span>{id === 'sessions' && <small>{scopedSessions.length}</small>}{id === 'recorder' && status?.running && <i className="live-dot"/>}</button>)}</nav>
      <div className="sidebar-note"><ShieldCheck size={18}/><strong>{t('onMachine')}</strong><p>{t('localPrivacy')}</p></div>
      <div className="sidebar-bottom"><span className={'status-badge ' + (status?.running ? 'recording' : '')}><i/>{t(status?.busy ? 'syncingTelemetry' : status?.running ? 'recorderActive' : 'recorderIdle')}</span><small>{t('preview')}</small></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label={t('toggleNavigation')} aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}><Menu size={20}/></button><span>Codex HUD</span><ChevronRight size={14}/><strong>{t(view)}</strong></div>
        <div className="topbar-tools"><div className="language-switch" role="group" aria-label={t('language')}><button aria-pressed={language === 'en'} onClick={() => setLanguage('en')} lang="en">English</button><button aria-pressed={language === 'zh-CN'} onClick={() => setLanguage('zh-CN')} lang="zh-CN">简体中文</button></div><span className="local-indicator"><i/>{t('localConnection')}</span></div></header>
      <main id="main" className={overview ? 'overview-page' : 'analysis-page'}><div className="page-heading"><div><h1>{t(titles[view])}</h1><p>{t(subtitles[view])}</p></div><button className="button" onClick={() => void refresh()} aria-label={t('refreshDashboard')}><RefreshCw size={15} className={isValidating ? 'spinning' : ''}/>{t('refresh')}</button></div>
        {connectionError && <div className="error-box" role="alert">{errorText(connectionError)}<button className="button" onClick={() => void reconnect()}>{t('reconnect')}</button></div>}
        {statisticsView && <><RangePicker key={view} value={range} onChange={setRange} busy={isValidating} overview={overview} onAnalyze={analyze}/>
          {statsError && !missing && <div className="error-box" role="alert"><strong>{t('statsFailed')}</strong> {errorText(statsError)}{stats && <span> {t('lastResult')}</span>}</div>}
          {missing ? <section className="panel onboarding"><Database size={32}/><h2>{t('historyStarts')}</h2><p>{t('historyHelp')}</p><button className="button primary" onClick={() => navigate('recorder')}>{t('openRecorder')}<ArrowUpRight size={15}/></button><small>{t('optInHelp')}</small></section>
            : stats ? <><SummaryCards stats={stats}/><div className="period-caption"><span>{time(stats.period.from, stats.period.timezone)} → {time(stats.period.to, stats.period.timezone)}</span><span>{stats.period.timezone} · {t('endExclusive')}</span></div>
              {stats.verification && <div className="history-verification chart-note" data-testid="history-verification"><span>{t(stats.verification.unavailableSources || stats.verification.conflictingSources ? 'historyEvidencePartial' : 'historyEvidenceScope')}{stats.verification.oldestVerifiedAt && <> {t('historyEvidenceSince')} {time(stats.verification.oldestVerifiedAt, stats.period.timezone)}.</>}</span><button className="button" disabled={checkingSources} onClick={() => void recheckSources()}>{t(checkingSources ? 'checkingHistorySources' : 'recheckHistorySources')}</button></div>}
              {sourceCheckError && <div className="error-box" role="alert">{sourceCheckError} {t('lastResult')}</div>}
              {(!stats.activity.complete || Object.values(stats.totals).some(m => !m.complete)) && <div className="warning" role="status">{t('incompleteWarning')}{stats.coverage.invalidTimestampObservations > 0 && ' ' + t('unknownTimes')}</div>}
              {overview ? <><div className="activity-row">{heatmap ? <ActivityHeatmap stats={heatmap}/> : heatmapError ? <div className="panel error-box" role="alert">{t('heatmap')}: {errorText(heatmapError)}</div> : <div className="panel skeleton chart-skeleton" role="status">{t('loadingHeatmap')}</div>}<SessionRanking stats={stats} overview onAnalyze={analyze} onSelect={chooseSession}/></div>{trend}</>
                : <>{trend}<Suspense fallback={<div className="panel skeleton">{t('loadingChart')}</div>}><ModelAnalytics stats={stats} loading={isValidating} onSelect={chooseSession}/></Suspense><SessionRanking stats={stats} onSelect={chooseSession}/><BucketTable stats={stats}/></>}
            </> : (isLoading || !boot) && <div className="dashboard-skeleton" role="status" aria-label={t('loadingDashboard')}><div className="skeleton metrics-skeleton"/><div className="skeleton chart-skeleton"/><div className="skeleton chart-skeleton"/></div>}
        </>}
        {view === 'sessions' && <>{sessionsError && <div className="error-box" role="alert">{errorText(sessionsError)}</div>}{catalog?.diagnostics.errors ? <p className="warning">{t('sourcesIncomplete')}</p> : null}<SessionExplorer sessions={scopedSessions} totalCount={catalog?.sessions.length || 0} includeAutoReview={includeAutoReview} onAutoReviewChange={changeAutoReview} selected={selected} onSelect={setSelected} timezone={range.timezone}/></>}
        {view === 'recorder' && <>{recorderError && <div className="error-box" role="alert">{errorText(recorderError)}</div>}<RecorderPanel status={status} onAction={action}/></>}
        <footer className="page-footer"><span><CircleHelp size={14}/>{t('privacyNote')}</span><span>{t('privateDefault')}<ShieldCheck size={14}/></span></footer>
      </main>
    </div>
  </div>;
}
