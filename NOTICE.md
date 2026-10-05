# Provenance and attribution

Codex HUD is based on and derived from **codex-usage-monitor by harveyxiacn**:
[Original repository](https://github.com/harveyxiacn/codex-usage-monitor).

Upstream reference commit: `dc14906821a30266d473c129460602a6c22efccc`.

The upstream work established the local Codex JSONL usage-monitoring approach and parsing of session metadata, turn context and token-count snapshots. Its original MIT license, including **Copyright (c) 2026 harveyxiacn**, is preserved in [LICENSE](LICENSE) and distributed with this project.

Later modifications in this independent repository include:

- Interactive session browsing, project filtering, official rename-index display and session selection locks.
- A live terminal HUD, responsive Unicode-aware formatting and terminal lifecycle restoration.
- Account-global subscription snapshot selection and explicit expiration/unknown states.
- Incremental local telemetry reading and usage subset validation.
- An opt-in SQLite accounting recorder with event identity, ordered metadata, deduplication, checkpoints and crash/rewrite recovery.
- Read-only historical workload statistics with cumulative-delta accounting, half-open time ranges and explicit completeness handling.
- Synthetic tests, packaging and documentation for these extensions.

These are later additions and modifications, not a claim that the entire project or its underlying approach was written from scratch. Upstream copyright and permission terms continue to apply. No private session logs, authentication files or user databases are included.
