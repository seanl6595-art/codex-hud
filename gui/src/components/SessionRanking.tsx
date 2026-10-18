import { useDeferredValue, useMemo, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { Stats } from '../../../lib/gui/contracts';
import { exactTokens } from '../formatters.mjs';
import { useI18n } from '../i18n';
import TokenValue from './TokenValue';
export default function SessionRanking({ stats, onSelect, overview = false, onAnalyze }: {
  stats: Stats; onSelect: (id: string) => void; overview?: boolean; onAnalyze?: () => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState(''), [limit, setLimit] = useState('10'), [pageIndex, setPageIndex] = useState(0);
  const query = useDeferredValue(search.trim().toLowerCase());
  const matches = useMemo(() => stats.sessions.map((session, index) => ({ session, rank: index + 1 }))
    .filter(({ session }) => !query || (session.displayName + ' ' + session.sessionId).toLowerCase().includes(query)), [stats.sessions, query]);
  const eligible = overview ? matches.slice(0, 5) : limit === 'all' ? matches : matches.slice(0, Number(limit));
  const pageSize = overview ? 5 : 25, pages = Math.max(1, Math.ceil(eligible.length / pageSize)), page = Math.min(pageIndex, pages - 1);
  const list = eligible.slice(page * pageSize, (page + 1) * pageSize);
  const changeLimit = (next: string) => { setLimit(next); setPageIndex(0); };
  return <section className={'panel ranking-panel' + (overview ? ' overview-ranking' : ' analysis-ranking')}>
    <div className="panel-heading"><div><h2>{t(overview ? 'topSessions' : 'sessionRanking')}</h2><p>{t('rankedInput')}</p></div>
      <span className="subtle-badge">{t('sessionCount', { count: exactTokens(stats.sessions.length) })}</span></div>
    {!overview && <div className="ranking-controls">
      <label className="search ranking-search"><Search size={16}/><input aria-label={t('searchRanking')} placeholder={t('searchRankingPlaceholder')}
        value={search} onChange={e => { setSearch(e.target.value); setPageIndex(0); }}/></label>
      <label className="ranking-limit"><span>{t('rankingLimit')}</span><select aria-label={t('rankingLimit')} value={limit} onChange={e => changeLimit(e.target.value)}>
        {[10,25,50].map(count => <option key={count} value={String(count)}>{t('topN', { count })}</option>)}<option value="all">{t('all')}</option>
      </select></label>
    </div>}
    {list.length ? <div className="rankings">{list.map(({ session: s, rank }) => <button className="ranking-row" key={s.sessionId} onClick={() => onSelect(s.sessionId)}>
      <span className="rank-index">{rank}</span><span className="rank-name"><strong title={s.displayName}>{s.displayName}</strong><span className="rank-track"><i style={{ width: (s.inputShare.value || 0) + '%' }}/></span></span>
      <span className="rank-value"><strong><TokenValue value={s.input.value} complete={s.input.complete}/></strong><small>{s.inputShare.value == null ? t('shareUnavailable') : t('inputShare', { value: s.inputShare.value.toFixed(1) })}</small></span><ChevronRight size={14}/></button>)}</div>
      : <div className="empty-inline">{t(query ? 'noRankMatch' : 'rankingEmpty')}</div>}
    {overview ? <button className="ranking-analysis-link" onClick={onAnalyze}>{t('analyzeSessions')}<ArrowUpRight size={14}/></button>
      : <div className="ranking-pagination">
        <p aria-live="polite">{t('showingMatches', { from: list.length ? page * pageSize + 1 : 0, to: page * pageSize + list.length, count: matches.length })}</p>
        <div className="ranking-disclosure">{eligible.length < matches.length && <button className="button" onClick={() => changeLimit(limit === '10' ? '25' : limit === '25' ? '50' : 'all')}>{t('showMore')}</button>}
          {limit !== '10' && <button className="button" onClick={() => changeLimit('10')}>{t('showLess')}</button>}</div>
        {pages > 1 && <div className="page-controls"><button className="button" disabled={page === 0} onClick={() => setPageIndex(page - 1)} aria-label={t('previous')}><ChevronLeft size={13}/></button>
          <span>{t('pageOf', { page: page + 1, pages })}</span><button className="button" disabled={page + 1 === pages} onClick={() => setPageIndex(page + 1)} aria-label={t('next')}><ChevronRight size={13}/></button></div>}
      </div>}
    <p className="chart-note">{t(overview ? 'currentNames' : 'shareNote')}</p>
  </section>;
}
