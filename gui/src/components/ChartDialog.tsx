import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Maximize2, X } from 'lucide-react';
import { useI18n } from '../i18n';
export function ExpandButton({ title, onClick }: { title: string; onClick: () => void }) {
  const { t } = useI18n();
  return <button className="icon-button expand-button" aria-label={t('expandChart', {title})} title={t('expandChart', {title})} onClick={onClick}><Maximize2 size={19}/></button>;
}
export default function ChartDialog({ title, onClose, children }: {title: string; onClose: () => void; children: ReactNode}) {
  const { t } = useI18n(), id = useId(), ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const dialog = ref.current!, before = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; before?.focus(); };
  }, []);
  return <dialog ref={ref} className="chart-dialog" aria-labelledby={id} onCancel={event => { event.preventDefault(); close.current(); }}
    onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close.current(); } }}>
    <header className="dialog-heading"><h2 id={id}>{title}</h2><button autoFocus className="icon-button" aria-label={t('closeChart')} onClick={onClose}><X size={23}/></button></header>
    <div className="dialog-body">{children}</div>
  </dialog>;
}
