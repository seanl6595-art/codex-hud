# Codex HUD

Codex HUD is a local terminal tool for browsing Codex sessions, watching token telemetry and account-global subscription snapshots, and reviewing historical token workload.

- **Session Browser / HUD:** choose a named session and watch its token counters without switching to another session when new activity appears.
- **Recorder:** explicitly collect accounting metadata from local session logs into a local SQLite database.
- **Stats:** read that database to report rolling or custom-period workload with a textual session breakdown.

Version **1.2.0** includes the v1.0 HUD, v1.1 Recorder and v1.2 Historical Usage Stats. It is based on and derived from **[codex-usage-monitor by harveyxiacn](https://github.com/harveyxiacn/codex-usage-monitor)**. The original MIT copyright is preserved; see [NOTICE.md](NOTICE.md) for upstream attribution and later modifications, and [LICENSE](LICENSE) for the license.

## Prerequisites

- **Local Codex session telemetry is required.** Installing this tool does not provide Codex, a subscription or telemetry for remote-only sessions.
- **Node.js 22.13 or newer** with built-in `node:sqlite`; Node 24 is recommended and tested on Windows/PowerShell. No third-party runtime dependencies are required.
- Git for the clone instructions below. Windows Terminal is recommended for interactive use.

Codex HUD does **not call the OpenAI API**, does not require an API key, and does **not consume additional Codex quota**. All commands operate on local data.

## Install on Windows / PowerShell

Replace `<GITHUB_OWNER>` with the owner of the published repository; this example is a placeholder, not a claim that the repository or npm package has already been published.

```powershell
git clone https://github.com/<GITHUB_OWNER>/codex-hud.git
Set-Location .\codex-hud
npm install
npm link

codex-hud --help
codex-hud
```

`npm link` exposes the `codex-hud` command from this checkout. It is a local installation and does not publish anything to npm. If the command is not found, reopen PowerShell and check that your npm global command directory is on PATH.

If PowerShell blocks a generated `.ps1` command shim, use `npm.cmd install`, `npm.cmd link` and `codex-hud.cmd` instead. These Windows command shims provide the same commands without changing execution policy. PowerShell 7 is tested; the `.cmd` fallback also works from Windows PowerShell 5.1.

If another installation already owns the command, you can run this checkout directly:

```powershell
node .\bin\codex-hud.js --help
node .\bin\codex-hud.js
```

All examples below work through the linked `codex-hud` command or by replacing it with `node .\bin\codex-hud.js` from the checkout.

## Session Browser / HUD

```powershell
codex-hud
codex-hud hud --current-project
codex-hud summary --no-color
codex-hud doctor
```

The default command opens the session browser. Select a session and press Enter to open its HUD. The selected session remains locked while other sessions become active. Run from your project's directory when using `--current-project`; project filtering uses the exact normalized working directory.

| Where | Key | Action |
| --- | --- | --- |
| Browser | Up / Down | Select a session; lists page with the highlight |
| Browser | Enter | Open the selected session in the HUD |
| Browser | A / P / N | All / Current Project / Recent sessions |
| Browser | R | Refresh sessions and current display names |
| Session HUD | R | Refresh immediately |
| Session HUD | Esc / Q | Return to the browser |
| Browser / Watch | Esc / Q | Exit |
| Everywhere | Ctrl+C | Exit and restore terminal state |

The HUD refreshes approximately every two seconds and shows session-specific model/effort, last-request and cumulative token counters, context estimates and separate account-global subscription snapshots. Wide terminals use side-by-side sections; narrow terminals stack them. `--ascii`, `--no-color`, `NO_COLOR` and `CODEX_HUD_ASCII=1` provide display fallbacks.

## Local data locations

Codex home defaults to `CODEX_HOME`, otherwise `~/.codex` (`%USERPROFILE%\.codex` on Windows). The tool reads both `sessions/**/*.jsonl` and `archived_sessions/**/*.jsonl`. The official `session_index.jsonl` supplies current display names.

Recorder's default database is **`~/.codex-hud/telemetry.sqlite3`**, or **`%USERPROFILE%\.codex-hud\telemetry.sqlite3`** on Windows. SQLite may create adjacent WAL/SHM files while in use. Keep this database outside the repository.

Use `--codex-home PATH` to override the source/display-index directory, and `--db PATH` with Recorder or Stats to select a different database. Generic relative-path examples:

```powershell
codex-hud doctor --codex-home '.\example-codex-home'
codex-hud watch --file '.\example-codex-home\sessions\example.jsonl'
```

## Recorder

Recording is opt-in. Start it separately from the HUD:

```powershell
codex-hud record
codex-hud record --once
```

`record` catches up immediately, then discovers new files and appended events every two seconds. Ctrl+C stops it. `--once` catches up and exits; `--interval SECONDS` changes the discovery interval (minimum one second). No startup service is installed. Run the recorder again after restarting your computer to catch up on local history. Default HUD startup does not start Recorder or create a database.

Events are recorded from the original `event_msg` / `token_count` observations; the discovery timer does not create synthetic accounting snapshots. Repeated unchanged scans and active-to-archive moves do not duplicate events. Events and checkpoints commit together. Partial final lines wait for completion; truncation or prefix mutation triggers a transactional rebuild of the affected session. Conflicting source copies or malformed complete records report an error and leave committed history intact.

Recorder stores numeric/accounting telemetry, model/effort/context window, timestamps, session/turn IDs, plan/limit labels, hashes and operational recovery metadata. **It does not store prompt, assistant response, reasoning text, tool output, file contents, source code, conversation bodies or raw JSONL lines.** Missing numbers remain NULL. Historical metadata is associated in source order at each event, never backfilled from later settings or current display names.

Tables: `recorder_meta`, `sources`, `telemetry_events`; derived view: `event_features_v1`. Canonical session identity is the independent thread ID from `session_meta.payload.id`, falling back to `payload.session_id` for legacy logs without `id`. Modern root/subagent family IDs are not used to merge independent streams. Paths are recovery metadata only. See [docs/RECORDER.md](docs/RECORDER.md) for the event/data/recovery contract.

## Historical Usage Stats

Stats reads the existing Recorder database without ingesting session logs or modifying any table, view or checkpoint:

```powershell
# Last rolling 24 elapsed hours: [now - 24h, now)
codex-hud stats

# Custom local time range; --to is exclusive
codex-hud stats --from '2026-01-01 08:00' --to '2026-01-02 08:00'
```

Custom ranges require both bounds in `YYYY-MM-DD HH:mm[:ss[.SSS]]` format; a `T` separator is also accepted. Inputs use your computer's local timezone and are converted to absolute instants. The report shows the timezone and offsets. All comparisons use **`[from,to)`**: include `from`, exclude `to`. Invalid dates, reversed/equal bounds, explicit UTC/offset suffixes, nonexistent local times and ambiguous local times at timezone transitions are rejected.

The report includes Input, Cached, Fresh, Output, Reasoning, Usage Events, Sessions and a session breakdown. **Historical token statistics represent locally observed workload, not official billing or subscription quota attribution.** They are not a quota estimator or a per-session share of the 5h/weekly allowance.

Accounting uses each metric's cumulative difference against the immediately preceding event in the same canonical session sequence. Adjacency is established before period filtering, so a predecessor before `from` can establish the current delta without contributing its own workload. Identical snapshots count zero. First observations and decreases are safe only under the documented baseline/reset rules. Task boundaries, model changes and effort changes do not reset cumulative adjacency. Stats never sums repeated last-request snapshots or overlapping cumulative totals.

Fresh is accounted Input minus accounted Cached only when both deltas form a valid subset. Reasoning is a subset of Output and is never added to it. Missing/invalid values, sequence gaps and unrecognized decreases remain indeterminate independently; partial totals explicitly show **`(incomplete)`** or **`N/A / incomplete`**. Unknown timestamps remain predecessors but cannot be assigned to a guessed period.

Usage Events require positive valid accounted Input or Output; duplicate, zero and all-NULL observations do not count. Sessions are canonical IDs with at least one such period event. Names are current display names, not asserted historical names. **Input share** means session accounted Input divided by period accounted Input; it is withheld when Input coverage is incomplete. Any cached/fresh ratios use matched valid observation cohorts. Stats can read a consistent SQLite snapshot while Recorder continues writing.

## Command reference

| Command | Purpose |
| --- | --- |
| `codex-hud` / `hud` / `browser` | Interactive Session Browser / HUD |
| `summary` | Full HUD snapshot; `--file` or most recently updated matching session |
| `statusline` | One-line model, effort, context, cache and global window states |
| `json` | Structured local session/telemetry/subscription snapshot |
| `doctor` | Version, data availability and read/parse diagnostics |
| `watch` | Watch one locked session file |
| `record` | Opt-in SQLite metadata recording; `--once` for one catch-up |
| `stats` | Read-only historical workload report |

Browser/HUD options include `--file PATH`, `--current-project`, `--recent N`, `--all`, `--ascii`, `--no-color` and `--width N`. Recorder supports `--codex-home`, `--db`, `--once` and `--interval`. Stats supports `--codex-home`, `--db`, paired `--from` / `--to` and `--no-color`. Use `--help` for argument details.

## Privacy

- All telemetry operations stay local. No OpenAI API/model/network calls, uploads or extra Codex quota usage occur.
- Session logs are read without modification. Prompt/response/reasoning text and file contents are not persisted by Recorder. HUD caching projects only relevant metadata.
- The accounting database still contains IDs, timestamps and source recovery paths. Terminal reports, `json` and `doctor` can expose names, paths or IDs; redact these before sharing.
- Only manually constructed anonymous synthetic data is used in tests. Real JSONL, databases, secrets, logs and runtime state are excluded from Git; the package uses an explicit code/documentation allowlist.
- The tool does not open authentication files or execute commands from telemetry.

## Limitations and accounting notes

- Local JSONL is required; remote-only history and activity from other devices may be absent. A missing Stats database must be created by running Recorder first.
- Missing or inconsistent telemetry is unknown, not invented zero. Cached Input and Reasoning Output are subsets, never extra tokens to add to totals. Cumulative counters replace snapshots rather than being summed.
- Context percentage estimates last-request Input relative to the observed context window, not live occupancy after compaction or output generation.
- Subscription snapshots are account-global local observations independent of the selected session. Window length, not primary/secondary position, identifies 5h/weekly. The HUD does not authenticate the current account or query current server quota.
- READY means an old valid 5h window ended and newer telemetry is awaited; it is not server confirmation of available quota. Expired weekly snapshots are stale. Missing data and ambiguous/multiple-account histories remain uncertain; use a separate Codex home per account.
- Full-prefix Recorder integrity checks and full-sequence Stats reads scale with history. A slower Recorder interval can reduce local disk reads. Unusually large JSONL lines require proportionally more memory.
- Very small terminals may truncate the HUD. Windows/PowerShell with Node 24 is tested; other terminal/platform combinations are not claimed tested here.
- No quota estimator, Estimated Weekly Burn, per-session quota attribution, chart or web dashboard is provided.

## Development and license

```powershell
npm test
npm pack --dry-run
```

The existing release baseline is **132 passing tests**, including HUD, Recorder, Stats, privacy, restart/recovery and concurrent read/write cases. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/RECORDER.md](docs/RECORDER.md) for implementation details.

Released under the upstream MIT license with its original copyright retained. Later extensions are described in [NOTICE.md](NOTICE.md); the project is not claimed as entirely written from scratch. Installation/build commands do not create a GitHub release or publish to npm.
