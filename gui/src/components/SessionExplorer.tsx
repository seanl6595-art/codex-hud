import { useDeferredValue, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Search, ChevronRight, MessagesSquare } from 'lucide-react';
import type { Session, SessionDetail } from '../../../lib/gui/contracts';
import { request } from '../api';
import { exactTokens } from '../formatters.mjs';
import { useI18n } from '../i18n';
import TokenValue from './TokenValue';
export default function SessionExplorer({ sessions, totalCount, includeAutoReview, onAutoReviewChange, selected, onSelect, timezone }: { sessions: Session[]; totalCount:number; includeAutoReview:boolean;onAutoReviewChange:(include:boolean)=>void;selected: string | null; onSelect: (id: string) => void; timezone: string }) {
  const { t, time, errorText } = useI18n();
  const [search, setSearch] = useState(''), query = useDeferredValue(search.trim().toLowerCase());
  const filtered = useMemo(() => sessions.filter(s => (s.name + ' ' + s.project + ' ' + (s.model || '')).toLowerCase().includes(query)), [sessions, query]);
  const active = filtered.find(s => s.id === selected)?.id || filtered[0]?.id;
  const { data: detail, error, isLoading } = useSWR<SessionDetail>(active ? '/api/sessions/' + encodeURIComponent(active) : null, request, { refreshInterval: 15000 });
  const telemetry = detail?.telemetry, last = telemetry?.lastRequest, context = telemetry?.context;
  const project = (value: string) => value === 'Recorded history' ? t('recordedHistory') : value === 'unknown' ? t('unknown') : value;
  return <div className="session-explorer">
    <section className="panel session-list"><div className="panel-heading"><h2>{t('sessionBrowser')}</h2><span className="subtle-badge" data-testid="visible-session-count">{filtered.length}</span></div>
      <div className="session-visibility-controls"><label><input type="checkbox" checked={includeAutoReview} onChange={e=>onAutoReviewChange(e.target.checked)}/>{t('includeAutoReview')}</label><p>{t('reviewVisibilityNote',{hidden:totalCount-sessions.length})}</p></div>
      <label className="search"><Search size={16}/><input aria-label={t('searchSessions')} placeholder={t('searchSessionsPlaceholder')} value={search} onChange={e => setSearch(e.target.value)}/></label>
      <div className="session-items">{filtered.length ? filtered.map(s => <button key={s.id} className={'session-item ' + (active === s.id ? 'active' : '')} aria-pressed={active === s.id} onClick={() => onSelect(s.id)}>
        <span className="session-avatar"><MessagesSquare size={17}/></span><span><strong>{s.name}</strong><small>{project(s.project)} · {s.model || t('modelUnknown')}</small><small>{time(s.updatedAt, timezone)}</small></span><ChevronRight size={15}/></button>)
        : <div className="empty-inline">{t(query ? 'noSessionsMatch' : 'noLocalSessions')}</div>}</div>
    </section>
    <section className="panel session-detail">{isLoading ? <div className="skeleton detail-skeleton" role="status">{t('loadingSession')}</div> : error ? <div className="error-box" role="alert">{errorText(error)}</div>
      : detail ? <><div className="panel-heading"><div><h2>{detail.session.name}</h2><p>{project(detail.session.project)}</p></div><span className="subtle-badge">{t(detail.session.archived ? 'archived' : detail.session.hasLocalTelemetry ? 'localSession' : 'recordedHistory')}</span></div>
        <div className="session-meta"><span>{t('model')}<strong>{telemetry?.modelName && telemetry.modelName !== 'unknown' ? telemetry.modelName : detail.recent[0]?.model || t('unknown')}</strong></span><span>{t('reasoningEffort')}<strong>{telemetry?.reasoningEffort || detail.recent[0]?.reasoning_effort || t('unknown')}</strong></span><span>{t('latestUsage')}<strong>{time(telemetry?.usageAt || detail.recent[0]?.event_timestamp, timezone)}</strong></span></div>
        <h3>{t('latestSnapshot')}</h3><div className="detail-metrics">{([
          ['input',last?.inputTokens],['cached',last?.cachedInputTokens],['output',last?.outputTokens],['reasoning',last?.reasoningOutputTokens]
        ] as const).map(([key,value]) => <div key={key}><span>{t(key)}</span><strong><TokenValue value={value}/></strong></div>)}</div>
        {!telemetry && <p className="muted">{t('missingLocalTelemetry')}</p>}
        <div className="context-heading"><h3>{t('contextEstimate')}</h3><strong>{context?.usedPercent == null ? t('unknown') : context.usedPercent.toFixed(1) + '%'}</strong></div>
        <div className="context-track" role="meter" aria-label={t('contextEstimate')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={context?.usedPercent == null ? undefined : Math.min(100, context.usedPercent)} aria-valuetext={context?.usedPercent == null ? t('unknown') : context.usedPercent.toFixed(1) + '% · ' + t('contextNote')}><span style={{ width: Math.max(0, Math.min(100, context?.usedPercent || 0)) + '%' }}/></div>
        <p className="muted small">{t('contextValues', { input: exactTokens(context?.inputTokens), window: exactTokens(context?.windowTokens) })} · {t('contextNote')}</p>
        {telemetry && (telemetry.diagnostics.parseFailures > 0 || telemetry.diagnostics.pendingTail || telemetry.diagnostics.error) && <p className="warning">{t('sourceIncomplete')}</p>}
        <h3>{t('recentActivity')}</h3><p className="muted small">{t('snapshotsNote')}</p>
        <div className="table-scroll"><table><thead><tr><th>{t('event')}</th><th>{t('observedAt')}</th><th>{t('lastInput')}</th><th>{t('lastOutput')}</th></tr></thead><tbody>{detail.recent.map(r => <tr key={r.event_seq}><td>#{r.event_seq}</td><td>{time(r.event_timestamp, timezone)}</td><td><TokenValue value={r.input_tokens}/></td><td><TokenValue value={r.output_tokens}/></td></tr>)}</tbody></table></div>
        {!detail.recent.length && <p className="empty-inline">{t('noRecentEvents')}</p>}
      </> : <div className="empty-inline">{t('chooseSession')}</div>}
    </section>
  </div>;
}
