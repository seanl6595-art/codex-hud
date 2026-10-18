import { useState } from 'react';
import { Play, Square, RefreshCw, Database, HardDrive, SearchCheck } from 'lucide-react';
import type { CollectionSummary, RecorderStatus, SourceDiagnostics } from '../../../lib/gui/contracts';
import { exactTokens } from '../formatters.mjs';
import { request } from '../api';
import { useI18n } from '../i18n';
function grouped(items: {code:string}[]) {
  const counts = new Map<string,number>();
  for(const item of items)counts.set(item.code,(counts.get(item.code)||0)+1);
  return [...counts].sort(([a],[b])=>a.localeCompare(b)).map(([code,count])=>({code,count}));
}
export default function RecorderPanel({ status, onAction }: { status?: RecorderStatus; onAction: (action: string) => Promise<void> }) {
  const { t, time, errorText } = useI18n();
  const [pending, setPending] = useState<string | null>(null), [error, setError] = useState<unknown>(null);
  const [diagnostics, setDiagnostics] = useState<SourceDiagnostics | null>(null);
  async function act(action: string) {
    setPending(action); setError(null);
    try { if(action === 'inspect')setDiagnostics(await request<SourceDiagnostics>('/api/recorder/diagnostics')); else {await onAction(action);setDiagnostics(null);} }
    catch (e) { setError(e); }
    finally { setPending(null); }
  }
  const explain = (code:string) => t(code === 'SESSION_ID_CHANGED' ? 'sourceIdentityConflict' : code === 'SOURCE_OWNERSHIP_CONFLICT' ? 'sourceOwnershipConflict'
    : code === 'UNSUPPORTED_INHERITED_HISTORY' ? 'sourceUnsupportedHistory' : code === 'CONFLICTING_SESSION_COPIES' ? 'sourceCopiesConflict'
    : code === 'FORK_HISTORY_PENDING' ? 'sourceForkPending' : code.startsWith('FORK_') ? 'sourceForkConflict' : code === 'MALFORMED_COMPLETE_RECORD' ? 'sourceMalformed'
    : code === 'SOURCE_CHANGED_DURING_READ' ? 'sourceChanged' : 'sourceReadFailed');
  function result(summary:CollectionSummary, readOnly = false) {
    const errors = summary.error_types || grouped(summary.errors), skips = summary.skip_types || grouped(summary.skips || []);
    const outcome = summary.outcome || (summary.errors.length ? 'partial' : summary.partial_sources ? 'partial' : 'complete');
    return <div className={'collection-result outcome-' + outcome}>
      <p className="collection-outcome" role={outcome==='failed'?'alert':'status'}><strong>{t(readOnly ? outcome==='complete' ? 'inspectionComplete' : 'inspectionIssues' : outcome==='complete' ? 'syncComplete' : outcome==='partial' ? 'syncPartial' : 'syncFailed')}</strong></p>
      <div className="collection-counts">
        {!readOnly && <div><span>{t('newEventsCollected')}</span><strong>{exactTokens(summary.inserted_events)}</strong></div>}
        <div><span>{t('sourcesChecked')}</span><strong>{exactTokens(summary.scanned_sources)}</strong></div>
        <div><span>{t('sourcesFailed')}</span><strong>{exactTokens(summary.failed_sources ?? summary.errors.length)}</strong></div>
        <div><span>{t('sourcesSkipped')}</span><strong>{exactTokens(summary.skipped_sources || 0)}</strong></div>
        <div><span>{t('duplicateFilesSkipped')}</span><strong>{exactTokens(summary.skipped_files || 0)}</strong></div>
        <div><span>{t('sourcesAwaitingAppend')}</span><strong>{exactTokens(summary.partial_sources)}</strong></div>
        <div><span>{t('inheritedHistoriesRecognized')}</span><strong>{exactTokens(summary.inherited_history_sources || 0)}</strong></div>
        {!readOnly && <div><span>{t('rebuiltSources')}</span><strong>{exactTokens(summary.rebuilt_sources)}</strong></div>}
      </div>
      {(errors.length > 0 || skips.length > 0) && <div className="collection-issues"><h3>{t('sourceIssueDetails')}</h3><table><thead><tr><th>{t('errorType')}</th><th>{t('affectedSources')}</th><th>{t('explanation')}</th></tr></thead><tbody>{[...errors,...skips].map(item => <tr key={item.code}><td><code>{item.code}</code></td><td>{exactTokens(item.count)}</td><td>{explain(item.code)}</td></tr>)}</tbody></table></div>}
      <p className="collection-history-note">{t(readOnly ? 'inspectionDoesNotWrite' : 'failedHistoryPreserved')}</p>
    </div>;
  }
  return <section className="panel recorder-panel" aria-busy={!!pending || status?.busy}>
    <div className="panel-heading"><div><h2><Database size={19}/>{t('localRecorder')}</h2><p>{t('recorderHelp')}</p></div>
      <span className={'status-badge ' + (status?.running ? 'recording' : '')}><i/>{t(status?.busy ? 'syncing' : status?.running ? 'recording' : 'stopped')}</span></div>
    <div className="recorder-actions"><button className="button primary" disabled={!status || status.running || !!pending} onClick={() => act('start')}><Play size={15}/>{t(pending === 'start' ? 'starting' : 'startRecording')}</button>
      <button className="button" disabled={!status?.running || !!pending} onClick={() => act('stop')}><Square size={14}/>{t(pending === 'stop' ? 'stopping' : 'stopRecording')}</button>
      <button className="button" disabled={!status || status.busy || !!pending} onClick={() => act('sync')}><RefreshCw size={15} className={pending === 'sync' ? 'spinning' : ''}/>{t(pending === 'sync' ? 'syncingHistory' : 'syncOnce')}</button>
      <button className="button" disabled={!status || status.busy || !!pending} onClick={()=>act('inspect')}><SearchCheck size={16}/>{t(pending==='inspect'?'checkingSources':'checkSources')}</button></div>
    <p className="muted">{t('recorderOptIn')}</p>
    {(!!error || status?.lastError) && <div className="error-box" role="alert">{errorText(error || status?.lastError)}</div>}
    <div className="recorder-facts"><div><span>{t('recordedEvents')}</span><strong>{exactTokens(status?.events)}</strong></div><div><span>{t('logicalSources')}</span><strong>{exactTokens(status?.sources)}</strong></div><div><span>{t('lastGuiSync')}</span><strong>{status?.lastSync ? time(status.lastSync) : t('notSynced')}</strong></div><div><span>{t('latestSourceUpdate')}</span><strong>{status?.latestSourceUpdate ? time(status.latestSourceUpdate) : t('notAvailable')}</strong></div></div>
    <div className={'recorder-diagnostic-columns' + (diagnostics && status?.summary ? ' dual-results' : '')}>
      <section className="sync-result"><h3>{t('syncResult')}</h3>{status?.summary ? result(status.summary) : <p>{t('syncNotRun')}</p>}</section>
      <section className="source-inspection"><h3>{t('sourceInspection')}</h3>{diagnostics ? <><p>{t('sourceInspectionAt',{time:time(diagnostics.checkedAt)})}</p>{result(diagnostics,true)}<p className="pending-events">{t('pendingSourceEvents',{count:exactTokens(diagnostics.pending_events),changed:exactTokens(diagnostics.changed_sources)})}</p></> : <p>{t('sourceInspectionHelp')}</p>}</section>
    </div>
    <div className="database-path"><HardDrive size={18}/><div><span>{t('database')} · {t(status?.exists ? 'available' : 'notCreated')}</span><code>{status?.dbPath || t('loadingDatabase')}</code></div></div>
    <p className="recorder-ownership">{t('recorderOwnership')}</p>
  </section>;
}
