# Local GUI preview (v1.3 branch)

This is the functional GUI preview on feature/gui-v1.3. The published v1.2.0 tag and release are unchanged. Final visual polish and release preparation are pending user feedback.

## Launch from a source checkout

Requires Node.js 22.13+ (validated here with Node 24 on Windows).

    npm install
    npm run build:gui
    node ./bin/codex-hud.js gui

The server prints http://127.0.0.1:4317 and opens the default browser. Ctrl+C stops the server and its GUI-managed recorder after the current scan completes.

    node ./bin/codex-hud.js gui --no-open --port 4318
    codex-hud gui --db PATH --codex-home PATH --interval 5

Use --port 0 to select a free loopback port. There is no public-network binding option. Windows uses the system URL handler; macOS uses open; Linux uses xdg-open. macOS has not been physically validated in this session.

## Packaged installations

The package allowlist includes dist/gui and lib/gui. The prepack script compiles the frontend, so an installed tarball serves bundled assets directly without Vite, React, a TypeScript compiler, or a build step at runtime. All frontend/build/browser-test packages are development dependencies.

For a local package only:

    npm pack
    npm install --prefix /path/to/local-install --omit=dev /path/to/codex-hud-VERSION.tgz

Run the installed codex-hud gui command or its installed bin/codex-hud.js directly. No publish command is needed. A source checkout must build assets before launch; missing assets produce an actionable error.

## Statistics and calendar activity

- Presets are rolling elapsed durations: 24h, 48h, 168h, and 720h.
- Lookback accepts hours or days; a day is 24 elapsed hours for this shortcut.
- Custom inputs are local wall-clock times in the selected IANA timezone. Existing Stats validation rejects invalid dates, DST gaps/folds, reversed boundaries and incomplete bounds.
- Every range is [from,to): start included, end excluded. Custom/lookback ranges are limited to 366 elapsed days.
- Ranges up to 48 elapsed hours use hourly buckets; longer ranges use daily buckets. Hour buckets have absolute UTC-hour boundaries and are displayed in the chosen timezone; repeated local hours remain separate and tooltip labels include their offset.
- The heatmap has a separate 84-local-calendar-day query, including today. It does not change when the Statistics range changes. Today and the first/last Statistics buckets can be partial time intervals.
- Heatmap token usage means accounted Input + Output. Cached and Reasoning are subsets and are never added again.
- Five positive intensity levels scale relative to the largest accounted day in the heatmap. Recorded zero, no recorded observations, and incomplete Input/Output accounting have distinct appearances.
- No observations means the recorded dataset has no observations for that cell; it does not establish that no real activity happened. Even complete accounting only describes available local telemetry.
- Asterisks mark partial totals. NULL values remain unavailable. Cached/Fresh ratios and session Input shares are withheld under the existing completeness/cohort rules.
- Unknown timestamps remain predecessors and preserve the audited unassignable-workload flags; they are not assigned to a guessed day.

Buckets accumulate deltas already computed in the existing Stats pass. Full canonical session/event sequence adjacency is established before range filtering. First-observation, duplicate, reset, gap and missing-metric rules are unchanged. The default Stats result and CLI formatting are unchanged when buckets are not requested.

## Sessions and Recorder

Sessions combine existing local session discovery with recorded canonical IDs. Display names are current names. Missing JSONL does not remove recorded history. Details expose latest known request/context metrics and recent observed metadata; request snapshots are not added as workload.

The GUI recorder is opt-in. Opening the GUI does not create a database. Start recording and Sync once use the existing Recorder class and schema. Stop recording affects only the worker owned by this GUI; it does not discover, stop, or claim the status of independently launched CLI recorders. SQLite's existing writer locking and recovery remain authoritative.

Last GUI sync belongs to this server run. Latest source update is persisted database metadata, not evidence of a completed global scan. Partial sources and collection errors are displayed.

## Local access and privacy

The HTTP server binds only to 127.0.0.1. Host/Origin checks, per-launch API tokens, same-origin policy and a Content Security Policy limit access from unrelated websites. There is no CORS wildcard. Browser requests cannot choose arbitrary database or source paths; those come from CLI startup options. Static-file paths stay inside the compiled asset root.

Telemetry requests, charts, fonts and other runtime assets stay local. API responses contain selected metadata, not raw JSONL or message bodies. Historical usage is locally observed workload, not official billing or subscription quota attribution.

## Verification

    npm test
    npm run build:gui
    npm run test:browser

Browser tests use project-local Playwright with installed Google Chrome, at 1440px desktop and 390px touch-emulated mobile widths. PW_CHANNEL can select another installed Playwright browser channel. Synthetic source generators construct their data in owned temporary directories. No real telemetry is committed.

The current initial validation covers date controls, DST errors, bucket reconciliation, heatmap tooltips/states, session search/details, Recorder controls, loading/error/empty states and local API access checks. Chromium mobile emulation does not establish physical-device or Safari validation.


## Review revision: bilingual analysis and clearer activity

- The header switches between English and Simplified Chinese. The choice is stored in codex-hud.language.v1 in localStorage; no preference is sent to the backend.
- UI translations live in gui/src/i18n.tsx. Navigation, headings, controls, status messages, empty/error states, dates, chart labels and tooltips are localized. User-provided session names, model identifiers, source IDs and technical error codes retain their original values.
- gui/src/formatters.mjs is the shared display formatter: exact values below 1K, then K/M/B with one decimal when useful. Rounding can carry into the next unit. Exact token values remain available in titles and two-line interactive tooltips; missing values remain unavailable. Display formatting never changes stored or accounted values.
- Usage trends default to Bar and can switch to Line. The selected type is stored in codex-hud.chart-type.v1. Both charts receive the same buckets; missing observations remain gaps, including in Line mode.
- Three blue ramps were compared in a browser: cobalt/ice, azure/glacier and indigo/mist. Cobalt/ice was selected. The five positive levels are relative to the largest complete observed day: >0–10%, >10–25%, >25–50%, >50–75%, and >75–100%. Incomplete days are hatched and do not establish the visual maximum. Recorded zero and no observations retain separate neutral treatments.
- Dashboard is the concise overview: quick ranges, summary metrics, the independent 12-week heatmap, five Top Sessions, and compact trends. Analyze this range leads to the complete Statistics controls.
- Statistics includes full range controls, larger charts, ranking search and expandable bucket data. Rankings default to Top 10 and support Top 25, Top 50 and All. All and larger lists paginate in batches of at most 25; search runs against the full ranking dataset before applying the display limit. Global ranking positions and the original period Input shares are preserved.
- Token formatting and localization have no effect on accounting, timezone conversion, cumulative adjacency, completeness or query boundaries. That earlier bilingual revision changed no backend or accounting files.


## Comfortable layout and expanded analytics preview — 2026-10-17

Continue on feature/gui-v1.3. HEAD remains 979c3d291f812aba6f925f7384365f6d6aac147e; the release version remains 1.2.0. Existing uncommitted work was preserved. No merge, push, publication, schema migration, or Recorder edit was performed.

### Preview and relaunch

To run a read-only preview on an alternate local port:

    npm run build:gui
    node ./bin/codex-hud.js gui --no-open --port 4320

Stop the relevant preview before reusing its port. Ctrl+C stops a foreground launch. Local preview logs and process metadata are ignored and are not distributed.

### Implemented

- Content uses 94% of the workspace, capped at 2360px, with comfortable 14–16px text, larger metrics and tables, and 340–380px normal charts. Breakpoints reflow the sidebar, cards and panels without page overflow.
- Usage and model time-series charts, plus the blue heatmap, expand into native accessible dialogs. Escape, close and backdrop dismissal restore focus. Existing plot data is reused on expansion. Input/Output visibility and chart type persist across opening and closing; the main chart type and language retain their existing local-storage persistence.
- Usage charts provide zero-based adaptive major/minor scales, a keyboard-operable time brush, optional independent aligned Input/Output scales, and a default Connect gaps option. Dashed segments join recorded endpoints across missing buckets only. They add no intermediate values and never change accounting. Incomplete metric values use outlined marks; unknown metrics remain unavailable. Tooltips explicitly distinguish missing observations and recorded zero.
- The independent heatmap defaults to 12 weeks. Expanded mode supports 12/26/52 local-calendar weeks and navigation one week at a time. Changing the calendar window queries that window; opening the default expanded view does not recalculate it. Five blue intensity bands, recorded zero, no observations and incomplete states remain separate.
- Statistics adds model distribution, sortable/searchable Top 5 / Top 10 / All tables (25 rows per page), model time series with stacked bars or individual lines, related sessions, reasoning-effort distribution/totals and model × effort drill-down. Model/effort filters apply together across these related analytics and use exactly the selected Statistics boundaries. The general summary and session ranking retain their full-period scope. Table text search affects table rows; the model distribution always retains Unknown.
- Input, Output and Input + Output are selectable workloads. Cached and Reasoning are never added again. Model colors remain consistent across distribution, table, time series and model filtering. All new controls and explanations are available in English and Simplified Chinese.

### Accounting definitions and limits

lib/stats-analytics.js is an optional presentation consumer of deltas from lib/stats.js. Canonical session/event ordering, predecessor adjacency, delta/reset rules, metric-independent NULLs and CLI output remain unchanged. No metadata or time filter runs before delta computation. Analytics read the existing model, reasoning_effort and turn_id event columns and never consult the latest session model for historical attribution.

Across a model or effort transition, attribution to the new context is allowed only when every available accounted counter agrees with the corresponding last-usage counter. A spanning or ambiguous interval stays Unknown for that dimension. Model and effort attribution are checked independently. This deliberately conservative rule can leave observed workload unattributed even when the latest context is known.

Usage Events are observations with positive safely accounted Input or Output; duplicate/zero snapshots add no event. Observed Turns deduplicate canonical session ID + recorded turn ID on those positive events. Missing turn identity or unassignable time coverage is marked incomplete. These are observed identities, never exact request counts. A session or turn can appear in multiple model/effort groups, so group counts are not additive. Session counts use the same positive-activity criterion as existing Stats.

Shares use the filtered period accounted metric including Unknown. They require a positive, complete denominator and complete group metrics; otherwise they are withheld. Input + Output excludes Cached and Reasoning subsets. Cache ratios follow the existing complete matched Input/Cached cohort rule. Unknown timestamps are not assigned to a guessed period; affected metric completeness and percentages are withheld conservatively. All figures describe locally observed workload, not official billing, subscription quota, costs or model effectiveness.

Optional previous-period comparison and a density switch are deferred. Large tables intentionally scroll horizontally; long expanded calendars scroll within their dialog. Browser validation covers installed Chrome and touch-emulated mobile, not physical devices, Safari or Firefox.

### Validation and synthetic screenshots

Run the verification commands above against temporary synthetic sources and databases. Browser checks cover responsive layouts, both languages, tooltips, chart persistence, dialog focus/dismissal, brush zoom, calendar navigation, model/effort filters, sorting, search and linked sessions. Synthetic screenshots generated by browser tests stay in the ignored .gui-preview directory and are not distributed.

The tooltip regression uses isolated synthetic history and fixed custom boundaries, including a daylight-saving transition. It asserts the complete ordered bucket states before targeting Bar and Line tooltips. A missing bucket has no observations; a confirmed-zero bucket has an actual unchanged cumulative observation. Combining fixtures can add positive usage to a zero observation's hour, legitimately changing that bucket to observed. Wall-clock-relative fixtures must not be assumed to contain every state in every rolling window.

## Model Analytics and Recorder diagnostics

### Implementation locations

| Responsibility | Location |
|---|---|
| Canonical full-sequence deltas and optional analytics consumer | lib/stats.js |
| Model, effort and cross groups; conservative attribution; cache cohorts and percentages | lib/stats-analytics.js |
| Model distribution, metric tables, search/sort/limits, time series and linked sessions | gui/src/components/ModelAnalytics.tsx |
| Analytics HTTP options, absolute-boundary filtering and worker calls | lib/gui/service.js; lib/gui/data-worker.js |
| API capabilities and read-only diagnostic endpoint | lib/gui/server.js; lib/gui/service.js |
| Review classification from observed model evidence | lib/gui/data-worker.js |
| Persistent review visibility, counts and session detail selection | gui/src/App.tsx; gui/src/components/SessionExplorer.tsx |
| Fork-boundary recognition, strict collection checks and read-only inspection | lib/recorder.js; lib/rollout-identity.js |
| Collection outcome and unique error counts | lib/recorder-summary.js; lib/gui/recorder-worker.js |
| Recorder diagnostics and responsive layout | gui/src/components/RecorderPanel.tsx; gui/src/styles.css |

### Backend/frontend compatibility

A server started before a backend update can serve newly built static assets while retaining older loaded Node modules. Refreshing the browser alone cannot update those modules. If Statistics lacks analytics, stop and relaunch the server from the current checkout. Bootstrap declares API version 2 and its capabilities; Statistics explicitly requests analytics. Missing analytics produces an English/Chinese restart instruction. A separate coverage state explains genuinely unavailable or ambiguous attribution, retaining Unknown totals instead of an empty section.

### Attribution coverage and synthetic example

Coverage separates raw model/effort metadata from safe deltas and positive Usage Events. Compute predecessors over the complete canonical sequence before applying identical half-open boundaries to summary, model, effort and cross-group queries. Safe deltas can include confirmed zero; Usage Events require positive safely accounted Input or Output. Neither is an exact request count. Missing or indeterminate records never establish zero activity, and they withhold affected completeness flags and shares. Exact rendered metrics and filtered model/effort cells should reconcile with the same API period.

Illustrative synthetic values only: Input 1,000, Cached 600, Fresh 400, Output 100 and Reasoning 20 describe combined workload 1,100. Cached and Reasoning are subsets, so combined workload never adds them again. Unknown attribution retains its safely accounted amounts in the denominator; it does not imply unknown token accounting.

### Copied-history collection

A supported v2 paginated subagent thread-spawn header can precede inherited parent session_meta/context records. The child ID, parent/fork/spawn lineage, version, history mode, parsed ordinal and thread_settings_applied boundary must agree. Every explicit owner inside the inherited prefix must agree with the parent. Unsupported or contradictory layouts fail conservatively.

Recorder excludes verified inherited prefix counters, preserves the child canonical ID and starts the child's own event sequence independently. Inherited metadata cannot leak into child state. Own-stream identity changes still produce SESSION_ID_CHANGED and roll back; an existing nonzero checkpoint cannot be silently moved past a copied prefix. Read-only source inspection can report pending child observations without collecting or reingesting them. See [rollout ownership](ROLLOUT-OWNERSHIP.md) and [accounting](ACCOUNTING.md) for the full contracts and compatibility limits.

### Diagnostics, review visibility and limits

- Analytics expose coverage counts, explicit Unknown states and an actionable stale-server message. Effort tables include observed turns and valid cache ratios alongside all five token metrics. Previous equal-period comparison remains deferred.
- Recorder results distinguish successful checks, failed sources, skipped sources/files, partial tails, rebuilt sources and recognized inherited histories. Error types are grouped with counts while original per-source errors remain intact. Fatal sync errors stay separate from partial collection outcomes.
- Check sources (read-only) validates identities, declared boundaries and checkpoints without constructing a Recorder writer or creating a missing database. Parsing preserves LF, CRLF, UTF-8 and valid bare-CR JSON whitespace. Failed collection transactions retain previously recorded history.
- Auto Review classification uses exact observed codex-auto-review model evidence. Recorded sessions with other known models remain visible; titles alone never hide a session. The visibility toggle persists, and search/counts use the filtered list. Review token events remain included in Statistics, and quota semantics are unchanged.
- Model/turn session counts across groups are not additive. No request identity, billing, subscription quota or effectiveness is inferred from tokens. Unknown future fork variants retain strict checks. Physical-device, Safari and Firefox validation are outside the Chrome-based suite.

Local diagnostic reports, real-data screenshots, source identifiers, private usage totals and personal paths must remain outside committed documentation and the package. All mutation-based validation uses owned synthetic fixtures; production database upgrades and real-history edits are not part of these checks.
