import { ArrowDownLeft, ArrowUpRight, Database, Layers3, BrainCircuit, Activity, MessagesSquare } from 'lucide-react';
import type { Stats } from '../../../lib/gui/contracts';
import { exactTokens } from '../formatters.mjs';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import TokenValue from './TokenValue';
const reasonKeys: Record<string, MessageKey> = {
  missing_cumulative: 'reason_missing_cumulative', missing_last: 'reason_missing_last', unsafe_baseline: 'reason_unsafe_baseline',
  missing_predecessor: 'reason_missing_predecessor', unrecognized_reset: 'reason_unrecognized_reset', sequence_gap: 'reason_sequence_gap',
  ambiguous_reset: 'reason_ambiguous_reset',
  source_integrity: 'reason_source_integrity',
  unknown_provenance: 'reason_unknown_provenance', missing_input_or_cached: 'reason_missing_input_or_cached',
  invalid_cache_subset: 'reason_invalid_cache_subset', invalid_reasoning_subset: 'reason_invalid_reasoning_subset', unknown_timestamp: 'reason_unknown_timestamp'
};
const metrics = [
  { key: 'input', note: 'accountedTokens', icon: ArrowDownLeft },
  { key: 'cached', note: 'includedInput', icon: Database },
  { key: 'fresh', note: 'inputMinusCached', icon: Layers3 },
  { key: 'output', note: 'accountedTokens', icon: ArrowUpRight },
  { key: 'reasoning', note: 'includedOutput', icon: BrainCircuit }
] as const;
export default function SummaryCards({ stats }: { stats: Stats }) {
  const { t } = useI18n();
  return <section className="metrics" aria-label={t('periodSummary')}>
    {metrics.map(({ key, note, icon: Icon }) => {
      const metric = stats.totals[key];
      return <div className={'metric metric-' + key} key={key}><div className="metric-label"><Icon size={15}/>{t(key)}</div>
        <strong><TokenValue value={metric.value} complete={metric.complete}/></strong>
        <span>{!metric.complete ? t('partialObservation') : t(note)}</span>
        {!metric.complete && metric.incompleteReasons && <details className="metric-quality"><summary>{t('accountingDetails')}</summary>
          <ul>{Object.entries(metric.incompleteReasons).map(([reason, count]) => <li key={reason}>{t(Object.hasOwn(reasonKeys, reason) ? reasonKeys[reason] : 'reason_unknown')}: {count}</li>)}</ul>
        </details>}</div>;
    })}
    <div className="metric metric-events"><div className="metric-label"><Activity size={15}/>{t('usageEvents')}</div><strong>{exactTokens(stats.activity.usageEvents)}{!stats.activity.complete && '*'}</strong><span>{t('positiveUsage')}</span></div>
    <div className="metric metric-sessions"><div className="metric-label"><MessagesSquare size={15}/>{t('sessions')}</div><strong>{exactTokens(stats.activity.sessions)}{!stats.activity.complete && '*'}</strong><span>{t('withActivity')}</span></div>
  </section>;
}
