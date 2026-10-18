'use strict';
const path = require('node:path');
const { DataSource } = require('./data');
const { defaultCodexHome, projectName } = require('./sessions');
const { filterSessions } = require('./browser');
const { renderHud, renderBrowser, statusline } = require('./renderer');
const { Terminal } = require('./terminal');
const { runInteractive } = require('./app');
const { version } = require('../package.json');
const COMMANDS = new Set(['hud', 'browser', 'summary', 'statusline', 'json', 'doctor', 'watch', 'record', 'stats', 'gui', 'upgrade-provenance', 'help']);
const BOOL = new Set(['no-color', 'ascii', 'current-project', 'all', 'help', 'once', 'no-open', 'verify-sources']);
const VALUES = new Set(['file', 'codex-home', 'recent', 'interval', 'width', 'db', 'from', 'to', 'port']);
function parseArgs(argv) {
  let command = null; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h') { flags.help = true; continue; }
    if (!arg.startsWith('--')) {
      if (command || !COMMANDS.has(arg)) throw new Error(`Unknown command: ${arg}`);
      command = arg; continue;
    }
    const eq = arg.indexOf('='), name = arg.slice(2, eq < 0 ? undefined : eq);
    if (BOOL.has(name)) { if (eq >= 0) throw new Error(`--${name} does not accept a value`); flags[name] = true; }
    else if (VALUES.has(name)) {
      const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
      flags[name] = value;
    } else throw new Error(`Unknown option: --${name}`);
  }
  for (const key of ['recent', 'width']) if (flags[key] && (!/^\d+$/.test(flags[key]) || Number(flags[key]) < (key === 'width' ? 4 : 1))) throw new Error(`--${key} must be a positive integer${key === 'width' ? ' >= 4' : ''}`);
  if (flags.interval && (!Number.isFinite(Number(flags.interval)) || Number(flags.interval) < 1)) throw new Error('--interval must be at least 1 second');
  if (flags.once && command !== 'record') throw new Error('--once requires the record command');
  if (flags['verify-sources'] && command !== 'stats') throw new Error('--verify-sources requires stats');
  if (flags.db && !['record', 'stats', 'gui', 'upgrade-provenance'].includes(command)) throw new Error('--db requires record, stats, gui or upgrade-provenance');
  if (command === 'upgrade-provenance' && Object.keys(flags).some(key => !['db', 'codex-home', 'help'].includes(key))) throw new Error('upgrade-provenance supports only --db and --codex-home');
  if ((flags.from !== undefined || flags.to !== undefined) && command !== 'stats') throw new Error('--from and --to require stats');
  if (command === 'stats') {
    if ((flags.from !== undefined) !== (flags.to !== undefined)) throw new Error('Custom Stats ranges require both --from and --to.');
    if (['file', 'current-project', 'recent', 'all', 'width', 'ascii', 'interval'].some(key => flags[key] !== undefined)) {
      throw new Error('stats supports --from, --to, --db, --codex-home and --no-color');
    }
  }
  if (command === 'record' && ['file', 'current-project', 'recent', 'all', 'width', 'no-color', 'ascii'].some(key => flags[key] !== undefined)) {
    throw new Error('record scans all active/archive sessions; use only --codex-home, --db, --once or --interval');
  }
  if (flags['no-open'] && command !== 'gui') throw new Error('--no-open requires gui');
  if (flags.port !== undefined && (command !== 'gui' || !/^\d+$/.test(flags.port) || Number(flags.port) > 65535)) throw new Error('--port requires gui and an integer from 0 to 65535');
  if (command === 'gui' && ['file', 'current-project', 'recent', 'all', 'width', 'ascii', 'no-color'].some(k => flags[k] !== undefined)) throw new Error('gui supports --codex-home, --db, --port, --no-open and --interval');
  return { command: command || 'hud', flags };
}
const HELP = `codex-hud - read-only local Codex telemetry

Usage: codex-hud [hud|summary|statusline|json|doctor|watch|record|stats|gui] [options]
Default/hud: session browser. Enter opens a locked session; Esc/Q returns.
Browser: arrows select, R refresh, A all, P current project, N recent, Esc/Q exits.
Ctrl+C always restores the terminal. Watch: Esc/Q/Ctrl+C exits.
Record: opt-in SQLite event recorder, all sessions, no model/network calls.
Record requires Node 22.13+ (Node 24 recommended); Ctrl+C stops safely.
Stats: read-only Recorder database report; default rolling last 24 hours.
Stats custom bounds use local datetime and the exact range [from, to).
Upgrade-provenance: explicit additive database upgrade; verifies source history,
preserves events/checkpoints, and persists usage applicability. Never automatic.
Usage: codex-hud upgrade-provenance [--db PATH] [--codex-home PATH]

--file PATH          Select a JSONL (summary/statusline/json/watch; hud opens directly)
--codex-home PATH    Override CODEX_HOME or ~/.codex
--current-project   Exact normalized cwd match; no basename matching
--recent N          Recent browser size (default 30)
--all               Initially show all sessions (paged)
--interval SECONDS  Watch/record discovery interval (default 2, minimum 1)
--db PATH           Record/stats SQLite file (default ~/.codex-hud/telemetry.sqlite3)
--from DATETIME     Stats local start: YYYY-MM-DD HH:mm[:ss[.SSS]]
--to DATETIME       Stats local end (exclusive); both bounds required
--verify-sources    Recheck source bytes for Stats instead of reusing verified history
--once              Recorder catch-up once, then exit (default: keep recording)
--width N           Output width for noninteractive summaries
--no-color          Disable ANSI colors (also honors NO_COLOR)
--ascii             ASCII box drawing and bars (also CODEX_HUD_ASCII=1)
--port N            GUI loopback port (default 4317; 0 chooses a free port)
--no-open           Start GUI without opening a browser
--help, -h          Show this help
`;
async function main(argv = process.argv.slice(2)) {
  const { command, flags } = parseArgs(argv);
  if (command === 'help' || flags.help) { process.stdout.write(HELP); return; }
  if (command === 'upgrade-provenance') {
    const result = require('./provenance-upgrade').upgradeProvenance({ dbPath: flags.db, home: flags['codex-home'] });
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.conflictingSources) process.exitCode = 1;
    return;
  }
  if (command === 'gui') {
    return require('./gui').runGui({ home: flags['codex-home'], dbPath: flags.db,
      port: flags.port === undefined ? 4317 : Number(flags.port), open: !flags['no-open'], interval: Number(flags.interval || 2) * 1000 });
  }
  if (command === 'record') {
    const { runRecorder } = require('./recorder');
    return runRecorder({ home: flags['codex-home'], dbPath: flags.db, once: !!flags.once,
      interval: Number(flags.interval || 2) * 1000 });
  }
  if (command === 'stats') {
    const { getHistoricalUsageStats, renderHistoricalUsageStats, resolvePeriod } = require('./stats');
    const period = resolvePeriod({ from: flags.from, to: flags.to, localInput: true });
    const stats = getHistoricalUsageStats({ ...period, dbPath: flags.db, home: flags['codex-home'],
      verification: flags['verify-sources'] ? 'fresh' : 'snapshot' });
    // Preserve the default rolling-window label after passing resolved absolute bounds.
    stats.period.label = period.label;
    process.stdout.write(renderHistoricalUsageStats(stats) + '\n');
    return;
  }
  const home = path.resolve(flags['codex-home'] || defaultCodexHome()), source = new DataSource(home);
  const options = { cwd: process.cwd(), filter: flags['current-project'] ? 'project' : flags.all ? 'all' : 'recent', recent: Number(flags.recent || 30),
    ascii: !!flags.ascii || process.env.CODEX_HUD_ASCII === '1',
    color: !!process.stdout.isTTY && !flags['no-color'] && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb',
    columns: Number(flags.width || process.stdout.columns || 90) };
  const select = async () => {
    const result = await source.list();
    if (flags.file) {
      const file = path.resolve(flags.file), known = result.sessions.find(s => s.file === file);
      if (known) return { session: known, result };
      const data = await source.store.read(file);
      if (data.error) throw new Error(`Cannot read selected file: ${data.error}`);
      const { parseTelemetry } = require('./telemetry'), meta = parseTelemetry(data.records, data);
      return { session: { id: meta.id, file, name: meta.id ? `Session ${meta.id.slice(0, 8)}` : path.basename(file), project: projectName(meta.cwd), cwd: meta.cwd, modelName: meta.modelName }, result };
    }
    return { session: filterSessions(result.sessions, flags['current-project'] ? 'project' : 'all', options.cwd)[0] || null, result };
  };
  if (command === 'hud' || command === 'browser') {
    const terminal = new Terminal();
    return runInteractive({ source, terminal, options, initialSession: flags.file ? (await select()).session : null });
  }
  const { session, result } = await select();
  if (command === 'watch') {
    if (!session) { process.stdout.write('No Codex sessions found. Run Codex first; use doctor to check CODEX_HOME.\n'); return; }
    return runInteractive({ source, terminal: new Terminal(), options, initialSession: session, watch: true, interval: Number(flags.interval || 2) * 1000 });
  }
  const view = await source.view(session);
  if (command === 'json') { process.stdout.write(JSON.stringify(view, null, 2) + '\n'); return; }
  if (command === 'doctor') {
    const sub = view.subscription, diag = view.telemetry?.diagnostics;
    process.stdout.write(`codex-hud ${version} | Node ${process.version}\nCodex home: ${home}\nSessions: ${result.sessions.length}\nSelected: ${session?.file || 'none'}\nSession model: ${view.telemetry?.modelName || 'unknown'}\nSession parse failures: ${diag?.parseFailures || 0} | Pending partial line: ${!!diag?.pendingTail}\nGlobal pool: ${sub.pool || 'unknown'}\nGlobal observed: ${sub.observedAt || 'unknown'}\n5h: ${sub.fiveHour.state} | Weekly: ${sub.weekly.state}\nScan: ${sub.coverage} | Errors: ${sub.errors.length + result.errors.length}\nAccount identity: ${sub.identity}\n${!session ? 'No data source: create a local Codex session first.\n' : ''}`);
    for (const error of sub.errors) process.stdout.write(`Read error ${error.code}: ${error.file}\n`);
    return;
  }
  if (!session) { process.stdout.write('No Codex sessions found. Run Codex first; use doctor to check CODEX_HOME.\n'); return; }
  process.stdout.write((command === 'statusline' ? statusline(view) : renderHud(view, options)) + '\n');
}
module.exports = { main, parseArgs, HELP };
