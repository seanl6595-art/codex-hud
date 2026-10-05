# Architecture

Data flow:

```text
local JSONL ---- jsonl incremental projection/cache ---- telemetry ---- selected-file view
       |                   |                               |
       |                   +---- sessions + session_index --+-- browser selection
       |                   |
       +-------------------+---- subscription (all files, event time, codex pool)
                                                             |
                                                     data view composition
                                                             |
                                                         renderer + theme
                                                             |
                                                   app state machine + terminal
```

| Module | Responsibility |
| --- | --- |
| `jsonl.js` | Active/archive discovery, bounded concurrent stream reads, append cache, partial UTF-8 handling, replacements/truncation, projection excluding message text |
| `sessions.js` | Metadata, official append-only session-index rename, project/path normalization, canonical rollout de-duplication, list ordering |
| `telemetry.js` | Pure selected-record reduction, usage subset validation, context estimate, model/effort, unique turn IDs |
| `subscription.js` | Global event-time snapshot selection, separate pool handling, pure allowance window state evaluation |
| `browser.js` | Pure filter/highlight/selection-lock state: BROWSER → HUD → BROWSER → EXIT |
| `data.js` | Compose the selected-file telemetry and independent global subscription view |
| `renderer.js` | Pure HUD/browser/statusline formatting, responsive layout, no filesystem access |
| `theme.js` | ANSI palette/thresholds, grapheme cell width, clipping, untrusted-text sanitization |
| `terminal.js` | Key decoding, alternate screen/raw mode/cursor, resize, signals, idempotent cleanup |
| `app.js` | One-process interaction, refresh timer, no overlapping reads, revision guard against late renders |
| `cli.js` | Arguments, diagnostics and command dispatch |
| `bin/codex-hud.js` | Small executable entry and top-level error reporting |
| `recorder.js` | Opt-in event ingestion, byte checkpoints, ordered metadata, deduplication and transactional recovery |
| `recorder-db.js` | SQLite schema and derived features view; loaded only for recorder commands |

Recorder data flow: active/archive JSONL → logical source discovery → committed-prefix validation → ordered metadata/event projection → one SQLite transaction per source. This runs independently of `DataSource`, selected-session HUD and global subscription reduction. See [RECORDER.md](RECORDER.md).

## Invariants

1. A HUD refresh receives a frozen selected file descriptor. No global “latest session” lookup occurs in that refresh.
2. Subscription selection always scans all discovered JSONL files. Selected-session telemetry never exposes a rate-limit or plan fallback.
3. The entire newest applicable snapshot wins. Missing fields remain unknown; older windows/plan are not patched into it. Equal event timestamps use stable sorted-path encounter order.
4. Cached input and reasoning output are subsets. Totals use input + output; cumulative snapshots are replaced rather than added.
5. READY means only that a valid old 5h reset has passed. Weekly expiry is STALE. Neither state supplies a guessed balance.
6. Raw terminal state is restored on Q, Esc, Ctrl+C, SIGINT, SIGTERM, stream errors and top-level failures. A killed process (for example Task Manager force termination) cannot run JavaScript cleanup.
7. Refresh completion checks state revision and selected file. Returning to the browser or exiting invalidates a pending HUD render.

## Performance and limits

The first scan streams all local JSONL to project only the relevant records. Later refreshes read appended bytes and reuse unchanged files, with at most eight file reads at once. No 50MB exclusion silently drops larger histories. Cache entries for disappeared files are pruned when the session list refreshes. There is no persisted cache containing private metadata.

The cache assumes Codex's normal append-only rollout behavior. Truncation, file replacement, and changed-mtime same-size rewrites trigger a full reread. A malicious non-append rewrite that changes earlier bytes while growing the file cannot reliably be detected without rereading the entire file; use R after restarting the tool for such manually altered histories. JSONL with extremely large individual lines requires memory for that line. Directory discovery is repeated to find newly created sessions.

The official session index is used for rename; the app's internal SQLite database and authentication files are never opened. Thread-only entries without a local JSONL are not selectable. Canonical rollout filenames containing the session ID are preferred over auto-review rollouts, following the verified prototype technique.

A local home can contain historical accounts and stale snapshots from other devices. Identity is not authenticated. This is a telemetry viewer, not a live quota API. Observation time, unknown states and incomplete scan diagnostics preserve that distinction.

`requestCount` counts changes in adjacent total/last usage snapshot pairs. Distinct requests with identical usage and absent cumulative data cannot be distinguished. Turns are the unique IDs visible in the selected file; inherited history is counted if it actually appears there.
