'use strict';
const { normalizePath } = require('./sessions');
function filterSessions(sessions, filter, cwd, recent = 30) {
  if (filter === 'project') return sessions.filter(s => s.cwd && normalizePath(s.cwd) === normalizePath(cwd));
  return filter === 'recent' ? sessions.slice(0, recent) : sessions;
}
class BrowserState {
  constructor({ cwd = process.cwd(), filter = 'recent', recent = 30 } = {}) {
    this.cwd = cwd; this.filter = filter; this.recent = recent; this.mode = 'BROWSER';
    this.sessions = []; this.rows = []; this.selected = 0; this.locked = null; this.revision = 0;
  }
  setSessions(sessions) {
    const selectedFile = this.rows[this.selected]?.file;
    this.sessions = sessions;
    this.rows = filterSessions(sessions, this.filter, this.cwd, this.recent);
    const index = this.rows.findIndex(s => s.file === selectedFile);
    this.selected = index >= 0 ? index : Math.min(this.selected, Math.max(0, this.rows.length - 1));
    // Refreshing the browser's list never changes the locked session.
  }
  dispatch(key) {
    if (key === 'ctrl+c') { this.mode = 'EXIT'; this.revision++; return; }
    if (this.mode === 'HUD') {
      if (key === 'escape' || key === 'q') { this.mode = 'BROWSER'; this.locked = null; this.revision++; }
      return;
    }
    if (this.mode !== 'BROWSER') return;
    if (key === 'escape' || key === 'q') { this.mode = 'EXIT'; this.revision++; }
    else if (key === 'up') this.selected = Math.max(0, this.selected - 1);
    else if (key === 'down') this.selected = Math.min(Math.max(0, this.rows.length - 1), this.selected + 1);
    else if (key === 'enter' && this.rows[this.selected]) {
      this.locked = Object.freeze({ ...this.rows[this.selected] }); this.mode = 'HUD'; this.revision++;
    } else if (['a', 'p', 'n'].includes(key)) {
      this.filter = { a: 'all', p: 'project', n: 'recent' }[key]; this.selected = 0; this.setSessions(this.sessions);
    }
  }
}
module.exports = { BrowserState, filterSessions };
