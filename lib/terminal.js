'use strict';
const readline = require('node:readline');
class Terminal {
  constructor({ input = process.stdin, output = process.stdout, processEvents = process } = {}) {
    this.input = input; this.output = output; this.events = processEvents;
    this.started = false; this.closed = false; this.rawEnabled = false;
    this.handlers = []; this.cleanups = [];
  }
  get interactive() { return !!(this.input.isTTY && this.output.isTTY && this.input.setRawMode); }
  get dimensions() { return { columns: this.output.columns || 90, rows: Math.max(1, (this.output.rows || 30) - 1) }; }
  listen(target, event, handler) { target.on(event, handler); this.handlers.push(() => target.removeListener(event, handler)); }
  addCleanup(callback) { this.cleanups.push(callback); }
  start(onKey, onStop, onResize = () => {}) {
    if (this.started || this.closed) return;
    this.started = true; this.wasRaw = !!this.input.isRaw; this.wasFlowing = this.input.readableFlowing === true;
    this.listen(this.events, 'SIGINT', onStop); this.listen(this.events, 'SIGTERM', onStop);
    this.listen(this.events, 'exit', () => this.cleanup());
    this.listen(this.output, 'resize', onResize);
    this.listen(this.input, 'end', onStop);
    this.listen(this.input, 'error', onStop);
    this.listen(this.output, 'error', onStop);
    if (this.interactive) {
      const before = { data: this.input.listeners('data'), newListener: this.input.listeners('newListener') };
      readline.emitKeypressEvents(this.input, { escapeCodeTimeout: 80 });
      this.listen(this.input, 'keypress', (text, key = {}) => {
        const name = key.ctrl && key.name === 'c' ? 'ctrl+c'
          : ['return', 'enter'].includes(key.name) ? 'enter' : key.name || text?.toLowerCase();
        onKey(name);
      });
      this.input.setRawMode(true); this.rawEnabled = true; this.input.resume();
      // Remove only listeners installed by our readline decoder; preserve any caller's listeners.
      for (const event of ['data', 'newListener']) {
        for (const handler of this.input.listeners(event)) if (!before[event].includes(handler)) {
          this.handlers.push(() => this.input.removeListener(event, handler));
        }
      }
    }
    if (this.output.isTTY) { this.screenEntered = true; this.output.write('\x1b[?1049h\x1b[?25l'); }
  }
  draw(text) {
    if (this.closed) return;
    this.output.write(this.output.isTTY ? `\x1b[H\x1b[2J${text.replace(/\n/g, '\r\n')}` : `${text}\n`);
  }
  cleanup() {
    if (this.closed) return;
    this.closed = true;
    // Each restoration is independent: one failed stream must not prevent raw-mode restoration.
    for (const restore of [...this.cleanups.reverse(), ...this.handlers.reverse()]) { try { restore(); } catch {} }
    try { if (this.rawEnabled) this.input.setRawMode(this.wasRaw); } catch {}
    try { if (this.started && !this.wasFlowing && this.input.isTTY) this.input.pause(); } catch {}
    try { if (this.screenEntered) this.output.write('\x1b[0m\x1b[?25h\x1b[?1049l'); } catch {}
  }
}
module.exports = { Terminal };
