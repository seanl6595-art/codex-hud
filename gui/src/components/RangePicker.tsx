import { useState } from 'react';
import { ArrowUpRight, CalendarRange, Clock3 } from 'lucide-react';
import type { Range } from '../api';
import { useI18n } from '../i18n';
export default function RangePicker({ value, onChange, busy, overview = false, onAnalyze }: {
  value: Range; onChange: (r: Range) => void; busy: boolean; overview?: boolean; onAnalyze?: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState(value.range === 'custom' || value.range === 'lookback' ? value.range : 'presets');
  const [hours, setHours] = useState(value.hours || '12'), [unit, setUnit] = useState('hours');
  const [from, setFrom] = useState(value.from || ''), [to, setTo] = useState(value.to || '');
  const [zone, setZone] = useState(value.timezone), [error, setError] = useState(false);
  const zones = [...new Set([value.timezone, 'UTC', 'America/Vancouver', 'America/New_York', 'Europe/London', 'Asia/Tokyo'])];
  const apply = (event: React.FormEvent) => {
    event.preventDefault(); setError(false);
    if (mode === 'custom' && (!from || !to)) { setError(true); return; }
    onChange({ range: mode, timezone: zone, ...(mode === 'custom' ? { from, to } : { hours: String(Number(hours) * (unit === 'days' ? 24 : 1)) }) });
  };
  return <section className={'range-panel' + (overview ? ' overview-range' : '')} aria-label={t('rangeLabel')}>
    <div className="range-primary">
      <div className="segmented" aria-label={t('quickRanges')}>{([['24h', 'range24'], ['48h', 'range48'], ['7d', 'range7'], ['30d', 'range30']] as const).map(([key, label]) =>
        <button key={key} aria-pressed={value.range === key} onClick={() => { setMode('presets'); onChange({ range: key, timezone: value.timezone }); }}>{t(label)}</button>)}</div>
      {overview ? <button className="button analysis-link" onClick={onAnalyze}>{t('analyzeRange')}<ArrowUpRight size={14}/></button> : <div className="range-tools">
        <button className={mode === 'lookback' ? 'button selected' : 'button'} onClick={() => setMode(mode === 'lookback' ? 'presets' : 'lookback')} aria-expanded={mode === 'lookback'}><Clock3 size={15}/>{t('lookback')}</button>
        <button className={mode === 'custom' ? 'button selected' : 'button'} onClick={() => setMode(mode === 'custom' ? 'presets' : 'custom')} aria-expanded={mode === 'custom'}><CalendarRange size={15}/>{t('customRange')}</button>
      </div>}
      <span className="update-label" aria-live="polite">{busy ? t('updating') : t('localTime')}</span>
    </div>
    {!overview && mode !== 'presets' && <form className="range-form" onSubmit={apply}>
      {mode === 'custom' ? <><label>{t('startDate')}<input aria-label={t('startDate')} type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} required/></label>
        <label>{t('endDate')}<input aria-label={t('endDate')} type="datetime-local" value={to} onChange={e => setTo(e.target.value)} required/></label></>
        : <><label>{t('lookBack')}<input aria-label={t('lookbackAmount')} type="number" min="1" max={unit === 'days' ? 366 : 8784} value={hours} onChange={e => setHours(e.target.value)} required/></label>
          <label>{t('durationUnit')}<select value={unit} onChange={e => setUnit(e.target.value)}><option value="hours">{t('hours')}</option><option value="days">{t('days')}</option></select></label></>}
      <label>{t('timezone')}<select aria-label={t('timezone')} value={zone} onChange={e => setZone(e.target.value)}>{zones.map(z => <option key={z}>{z}</option>)}</select></label>
      <button className="button primary" type="submit">{t('applyRange')}</button>
      <p className="form-note">{t('rangeNote')}</p>
      {error && <p role="alert">{t('errorBothDates')}</p>}
    </form>}
  </section>;
}
