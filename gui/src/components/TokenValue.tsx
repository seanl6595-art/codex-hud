import { compactTokens, exactTokens } from '../formatters.mjs';
import { useI18n } from '../i18n';
export default function TokenValue({ value, detailed = false, complete = true }: {
  value: number | null | undefined; detailed?: boolean; complete?: boolean;
}) {
  const { t } = useI18n();
  const exact = exactTokens(value) + ' ' + t('tokenUnit');
  return <span className={'token-value' + (detailed ? ' detailed' : '')} title={exact + (!complete ? ' · ' + t('incomplete') : '')}
    data-exact-tokens={value == null ? '' : String(value)}>
    <span className="token-compact">{compactTokens(value)}{!complete && <span className="partial-mark" aria-label={t('incomplete')}>*</span>}</span>
    {detailed && <small className="token-exact">{exact}</small>}
  </span>;
}
