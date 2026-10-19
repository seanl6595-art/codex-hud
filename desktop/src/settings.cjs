'use strict';
const fs = require('node:fs'), path = require('node:path');
const PREFERENCES = Object.freeze({
  'codex-hud.language.v1': ['en', 'zh-CN'],
  'codex-hud.include-auto-review.v1': ['yes', 'no'],
  'codex-hud.chart-type.v1': ['bar', 'line']
});
function preferences(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, allowed] of Object.entries(PREFERENCES)) if (allowed.includes(value[key])) result[key] = value[key];
  return result;
}
function readJSON(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function writeJSON(file, data) {
  // Only window geometry and the three enumerated UI preferences belong here.
  const temporary = file + '.' + process.pid + '.tmp';
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n'); fs.renameSync(temporary, file); return true; }
  catch { try { fs.unlinkSync(temporary); } catch {} return false; }
}
function area(a, b) { return Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) * Math.max(0, Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)); }
function windowOptions(saved, displays, primary) {
  const valid = saved && ['x','y','width','height'].every(key => Number.isFinite(saved[key]) && Math.abs(saved[key]) <= 100000) && saved.width > 0 && saved.height > 0;
  const display = valid ? displays.reduce((best, d) => area(saved,d.workArea)>area(saved,best.workArea)?d:best, primary) : primary;
  const work = display.workArea;
  const width = Math.min(Math.max(valid ? Math.round(saved.width) : 1440, 960), work.width);
  const height = Math.min(Math.max(valid ? Math.round(saved.height) : 900, 640), work.height);
  const visible = valid && area(saved,work) > 0;
  return { width, height,
    x: visible ? Math.max(work.x,Math.min(Math.round(saved.x),work.x+work.width-width)) : work.x+Math.floor((work.width-width)/2),
    y: visible ? Math.max(work.y,Math.min(Math.round(saved.y),work.y+work.height-height)) : work.y+Math.floor((work.height-height)/2),
    minWidth: Math.min(960,work.width), minHeight: Math.min(640,work.height), maximized: !!(valid && saved.maximized) };
}
function parseOptions(argv) {
  const result = { port: 0 };
  const names = { '--codex-home': 'home', '--db': 'dbPath', '--user-data': 'userData', '--port': 'port' };
  for (let i=0;i<argv.length;i++) {
    const key=names[argv[i]];
    if (!key) throw new Error('Unsupported desktop argument. Supported: --codex-home, --db, --user-data, --port.');
    const value=argv[++i];
    if (!value || value.startsWith('--')) throw new Error('A value is required for '+argv[i-1]+'.');
    if (key==='port') {
      if (!/^\d+$/.test(value) || Number(value)>65535) throw new Error('Port must be an integer from 0 to 65535.');
      result.port=Number(value);
    } else result[key]=path.resolve(value);
  }
  return result;
}
module.exports={ PREFERENCES, preferences, readJSON, writeJSON, windowOptions, parseOptions };
