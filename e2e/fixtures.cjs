'use strict';
// All browser fixtures are synthetic. No real telemetry is copied.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Recorder } = require('../lib/recorder');
const { openDatabase } = require('../lib/recorder-db');
const { dateKey, shiftDate } = require('../lib/stats-buckets');
const { parseLocalDateTime } = require('../lib/stats');
async function createFixture(mode = 'populated', target) {
  const root = target || fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-browser-'));
  const home = path.join(root, 'codex-home'), dbPath = path.join(root, 'synthetic.sqlite3');
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  const names = ['Synthetic · Core API refactor', 'Synthetic · Dashboard exploration', 'Synthetic · Test suite cleanup',
    'Synthetic · Recorder reliability', 'Synthetic · Docs and examples', 'Synthetic · TypeScript migration'];
  const today = dateKey(Date.now(), 'America/Vancouver'), index = [];
  for (let j = 0; j < names.length; j++) {
    const id = 'synthetic-session-' + j, records = [{ type: 'session_meta', timestamp: new Date().toISOString(),
      payload: { id, cwd: 'C:/Synthetic/Codex-HUD' } }, { type: 'turn_context',
      payload: { turn_id: 'synthetic-turn', model: j % 2 ? 'gpt-6-luna' : 'gpt-6.1-sol', effort: j % 2 ? 'medium' : 'high' } }];
    let input = 0, cached = 0, output = 0, reasoning = 0;
    for (let d = 0; d < 84; d++) {
      if (d % 11 === 3) continue;
      const day = shiftDate(today, d - 83);
      for (let h = 0; h < 4; h++) {
        const stamp = parseLocalDateTime(day + 'T' + ['08:15','11:15','14:15','17:15'][h], 'America/Vancouver');
        if (Date.parse(stamp) >= Date.now()) continue;
        const increment = d % 13 === 7 ? 0 : Math.round([3000,11000,24000,44000,60000][d % 5] * (j + 1) / 7 * [.5, 1, .7, 1.3][h]);
        const c = Math.round(increment * .68), o = Math.round(increment * .14), r = Math.round(o * .4);
        input += increment; cached += c; output += o; reasoning += r;
        records.push({ type: 'event_msg', timestamp: stamp, payload: { type: 'token_count', info: {
          total_token_usage: { input_tokens: j === 2 && d === 26 ? null : input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output },
          last_token_usage: { input_tokens: increment, cached_input_tokens: c, output_tokens: o, reasoning_output_tokens: r, total_tokens: increment + o }, model_context_window: 200000 } } });
      }
    }
    fs.writeFileSync(path.join(home, 'sessions', id + '.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
    index.push({ id, thread_name: names[j] });
  }
  fs.writeFileSync(path.join(home, 'session_index.jsonl'), index.map(r => JSON.stringify(r)).join('\n') + '\n');
  if (mode === 'populated') {
    const recorder = new Recorder({ home, dbPath });
    try { const result = await recorder.scan(); if (result.errors.length) throw new Error('Synthetic fixture ingestion failed.'); } finally { recorder.close(); }
  } else if (mode === 'empty') { const db = openDatabase(dbPath); db.close(); }
  return { root, home, dbPath, cleanup() {
    const absolute = path.resolve(root), temp = path.resolve(os.tmpdir()) + path.sep;
    if (target || !absolute.startsWith(temp) || !path.basename(root).startsWith('codex-hud-browser-')) throw new Error('Cleanup requires an owned temporary fixture.');
    fs.rmSync(root, { recursive: true, force: true });
  } };
}
module.exports = { createFixture };
