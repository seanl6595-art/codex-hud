'use strict';
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const COLORS = { title: 36, healthy: 32, warning: 33, danger: 31, cached: 32, fresh: 36,
  reasoning: 35, secondary: 90, ready: 92 };
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
function sanitize(value) {
  // Local names/paths are untrusted text, including OSC links and control characters.
  return String(value ?? '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    .replace(ANSI, '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}
function graphemeWidth(text) {
  const cp = text.codePointAt(0);
  if (/^\p{Mark}+$/u.test(text)) return 0;
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text)) return 2;
  return (cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a
    || (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe19)
    || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x20000 && cp <= 0x3fffd))) ? 2 : 1;
}
function displayWidth(value) {
  return [...segmenter.segment(String(value).replace(ANSI, ''))].reduce((n, g) => n + graphemeWidth(g.segment), 0);
}
function fit(value, width, pad = false, ascii = false) {
  width = Math.max(0, width);
  const text = String(value), overflow = displayWidth(text) > width;
  const marker = ascii ? '~' : '…', budget = overflow ? Math.max(0, width - 1) : width;
  let out = '', used = 0;
  for (const part of text.split(/(\x1b\[[0-?]*[ -/]*[@-~])/)) {
    if (part.startsWith('\x1b[')) { out += part; continue; }
    for (const { segment } of segmenter.segment(part)) {
      const cells = graphemeWidth(segment);
      if (used + cells > budget) break;
      out += segment; used += cells;
    }
    if (used >= budget) break;
  }
  if (overflow && width) { out += marker; used++; }
  if (text.includes('\x1b[')) out += '\x1b[0m';
  return out + (pad ? ' '.repeat(Math.max(0, width - used)) : '');
}
function theme({ color = false, ascii = false } = {}) {
  const paint = (role, text) => color ? `\x1b[${COLORS[role] || 0}m${text}\x1b[0m` : String(text);
  const severity = p => p == null ? 'secondary' : p >= 90 ? 'danger' : p >= 70 ? 'warning' : 'healthy';
  return { paint, severity, ascii, bar(percent, length = 20) {
    if (percent == null) return paint('secondary', (ascii ? '?' : '░').repeat(length));
    const filled = Math.round(Math.max(0, Math.min(100, percent)) / 100 * length);
    return paint(severity(percent), (ascii ? '#' : '█').repeat(filled))
      + paint('secondary', (ascii ? '-' : '░').repeat(length - filled));
  }, box: ascii ? { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', l: '+', r: '+', mid: '+' }
    : { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', l: '├', r: '┤', mid: '┼' } };
}
module.exports = { theme, sanitize, displayWidth, fit };
