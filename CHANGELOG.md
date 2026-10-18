# Changelog

## [1.3.0-beta.1] - 2026-10-18 (public beta)

### Added

- Local loopback GUI with Dashboard, Statistics, Sessions and opt-in Recorder controls; compiled frontend assets ship in the package.
- English/Simplified Chinese UI, activity heatmaps, expanded charts, range controls and model/effort analytics with explicit Unknown attribution.
- Read-only source diagnostics, persistent review-session visibility, verification age and explicit source rechecks.
- Versioned provenance for new databases and an explicit opt-in upgrade for existing v1 databases.
- Memory-only verified-history evidence bound to committed database facts, reducing repeated source reads across warm queries.

### Corrected

- Avoid browser-blocked dynamic ports when launching the GUI with `--port 0`; explicit blocked ports now fail with an actionable message.

- Reject verification when source metadata changes during a read, including rewrites accompanied by growth, and bind the verified path to its open descriptor.

- Distinguish verified allowance-only observations from missing or malformed usage.
- Preserve coherent reset vectors, validate contributing subsets, and withhold completeness when canonical history or ownership conflicts.
- Validate copied-history headers, typed owners, boundaries and complete canonical sequences consistently across Recorder and source verification.
- Existing Recorder instances adopt an explicitly committed provenance extension under the writer lock; failed transactions retain prior events/checkpoints.
- Treat duplicate-duration subscription windows as unknown.
- Isolate tooltip fixtures with fixed boundaries so missing observations remain distinct from confirmed zero usage at every wall-clock time.

### Compatibility and safety

- Require Node.js 24.21.0 or newer in package metadata, CLI and database entrypoints; unsupported runtimes fail before opening a database.
- Include generated third-party notices for the bundled frontend.
- Add a manually triggered macOS 15 compatibility workflow for the exact supported minimum; no native macOS pass is claimed until it runs.

- Existing CLI entrypoints and Recorder v1 storage remain supported. Existing databases are not automatically upgraded.
- Token workload is local observed accounting, not official billing or quota attribution. Unknown and incomplete states remain explicit.
- No production database migration or real JSONL modification is part of candidate validation. No telemetry, credentials or personal paths ship in the archive.
- Native macOS validation is pending; see docs/RELEASE-CANDIDATE.md. This beta is distributed as a GitHub Pre-release; v1.2.0 remains stable and main is unchanged. No npm publication is performed.

- Windows is primarily tested; native macOS validation has not yet been completed. Cold startup may take several seconds.
- The earlier intermittent source-rewrite failure remains unexplained but was not reproduced in 3,500 targeted cycles. It is an accepted beta risk; testing and feedback do not guarantee complete stability.
- Provenance upgrade is optional and must never happen automatically.

## [1.2.0]

Published baseline at commit 979c3d291f812aba6f925f7384365f6d6aac147e: terminal HUD, opt-in Recorder and read-only historical usage statistics. Its tag and commit remain unchanged.
