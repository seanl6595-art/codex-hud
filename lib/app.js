'use strict';
const { BrowserState } = require('./browser');
const { renderBrowser, renderHud } = require('./renderer');
async function runInteractive({ source, terminal, options, initialSession = null, watch = false, interval = 2000 }) {
  const state = new BrowserState(options);
  let finished = false, busy = false, dirty = false, timer, view = null, resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const paint = () => {
    if (finished) return;
    const rendering = { ...options, ...terminal.dimensions, watch };
    terminal.draw(state.mode === 'HUD' ? renderHud(view, rendering) : renderBrowser(state, rendering));
  };
  const stop = error => {
    if (finished) return;
    finished = true; state.dispatch('ctrl+c'); terminal.cleanup();
    if (error) rejectDone(error); else resolveDone();
  };
  const refresh = async () => {
    if (finished) return;
    if (busy) { dirty = true; return; }
    busy = true;
    const revision = state.revision, mode = state.mode, locked = state.locked;
    try {
      if (mode === 'HUD') {
        const result = await source.view(locked);
        if (!finished && state.revision === revision && state.locked?.file === locked?.file) view = result;
      } else {
        const result = await source.list();
        if (!finished && state.revision === revision) state.setSessions(result.sessions);
      }
      if (!finished) paint();
    } catch (error) { stop(error); }
    finally { busy = false; if (dirty && !finished) { dirty = false; void refresh(); } }
  };
  const onKey = key => {
    if (finished) return;
    if (watch && ['q', 'escape', 'ctrl+c'].includes(key)) { stop(); return; }
    const oldMode = state.mode;
    state.dispatch(key);
    if (state.mode === 'EXIT') { stop(); return; }
    if (state.mode === 'HUD' && oldMode !== 'HUD') view = { session: state.locked, telemetry: null, subscription: null, loading: true };
    paint();
    if (key === 'r' || state.mode !== oldMode || ['a', 'p', 'n'].includes(key)) void refresh();
  };
  try {
    terminal.start(onKey, error => stop(error instanceof Error ? error : undefined), paint);
    if (terminal.interactive) terminal.draw('CODEX HUD\nLoading local Codex telemetry...');
    if (initialSession) {
      state.setSessions([initialSession]); state.dispatch('enter');
      view = { session: state.locked, telemetry: null, subscription: null, loading: true };
    }
    await refresh();
    if (!terminal.interactive && !watch) { stop(); return; }
    if (!finished) { timer = setInterval(() => { if (state.mode === 'HUD' || watch) void refresh(); }, interval); terminal.addCleanup(() => clearInterval(timer)); }
    await done;
  } finally { terminal.cleanup(); }
}
module.exports = { runInteractive };
