'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  function write(relative, records) {
    const file = path.join(home, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join('\n') + '\n'); return file;
  }
  return { home, write };
}
const NOW = Date.parse('2026-01-01T12:00:00Z');
const record = (type, payload, time = NOW) => ({ type, timestamp: new Date(time).toISOString(), payload });
const meta = (id = 'anonymous-session', cwd = 'C:\\Projects\\Example') => record('session_meta', { id, cwd, creator_account_id: 'anonymous-account' });
const context = (turn = 'turn-1', model = 'gpt-6.1-sol') => record('turn_context', { turn_id: turn, model, effort: 'high', cwd: 'C:\\Projects\\Example' });
const usage = (input = 1000, cached = 800, output = 100, reasoning = 40) => ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output });
function limit(used = 10, reset = NOW / 1000 + 3600, weeklyReset = NOW / 1000 + 86400) {
  return { limit_id: 'codex', plan_type: 'plus', primary: { used_percent: used, window_minutes: 300, resets_at: reset },
    secondary: { used_percent: 53, window_minutes: 10080, resets_at: weeklyReset } };
}
const token = (info = { total_token_usage: usage(), last_token_usage: usage(), model_context_window: 10000 }, limits = limit(), time = NOW) => record('event_msg', { type: 'token_count', info, rate_limits: limits }, time);
module.exports = { fixture, NOW, record, meta, context, usage, limit, token };
