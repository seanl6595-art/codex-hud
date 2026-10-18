// Display formatting only. Accounted values remain unchanged.
const exactFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });
const compactFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, useGrouping: false });
export function exactTokens(value) {
  return value == null || !Number.isFinite(value) ? '—' : exactFormatter.format(value);
}
export function compactTokens(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude < 1000) return exactTokens(value);
  let unit = magnitude >= 1e9 ? 1e9 : magnitude >= 1e6 ? 1e6 : 1e3;
  // Avoid "1000K" when rounding naturally carries into the next supported unit.
  if (unit < 1e9 && Math.round(magnitude / unit * 10) / 10 >= 1000) unit *= 1000;
  return compactFormatter.format(value / unit) + (unit === 1e9 ? 'B' : unit === 1e6 ? 'M' : 'K');
}
export function readPreference(key, allowed, fallback) {
  try { const value = localStorage.getItem(key); return allowed.includes(value) ? value : fallback; }
  catch { return fallback; }
}
export function savePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* The interface still works when storage is blocked. */ }
}
