# Recorder v1 contract

Requires Node.js 24.21.0 or newer with built-in `node:sqlite`; Node 22 and earlier Node 24 patches are unsupported. No separate SQLite executable is required.

SQLite is the primary local store; CSV/JSONL are not primary stores. `record` is explicitly enabled and does not change default HUD behavior. No network or model dependencies exist. Node's built-in `node:sqlite` provides synchronous SQLite transactions with WAL, `synchronous=FULL`, foreign keys and a five-second writer busy timeout. Each source scan holds `BEGIN IMMEDIATE` while loading and updating its checkpoint, preventing competing processes from committing against a stale checkpoint. A busy recorder reports an operational error and retries on the next scan.

## Identity and source copies

Normalize the independent rollout/thread ID into DB `session_id`: `session_meta.payload.id`, or `payload.session_id` when `id` is absent. The [Codex protocol](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs) uses literal `payload.session_id` for the root/subagent family and `payload.id` for each thread. Using the shared family ID would collide independent ordinals. No file path participates in event identity.

Group active and archived copies by this identity. Compare their common complete-record prefix, choose the compatible copy with the longest completed prefix, and use the path only as recovery metadata. A larger unfinished tail cannot displace a more complete copy. Conflicting prefixes cause an operational error and leave committed data untouched. Never merge differing histories or assign events across independent streams by timestamp. Missing or changing source identity fails safely; no identity is inferred from filenames.

Count every matching `event_msg` with `payload.type="token_count"` in file order starting at 1. The primary key is `(session_id,event_seq)`; byte-identical events can have different ordinals. `raw_event_sha256` hashes exact event-record bytes excluding the LF delimiter (including CR when present); it validates integrity, not identity.

## Persistent layout

`recorder_meta`: key/value rows `schema_version=1`, `contract=recorder_v1`. Unknown schema versions are refused without modifying the database.

`sources`: one row per logical source with `session_id`, `current_path`, `checkpoint_byte_offset`, `last_event_seq`, `anchor_start_offset`, `anchor_end_offset`, `anchor_sha256`, `last_seen_file_size`, `updated_at`. Recovery additionally persists only `state_turn_id`, `state_model`, `state_reasoning_effort`, `state_context_window_tokens`; these are the ordered as-of state at the checkpoint, never a serialized raw record.

`telemetry_events`: observed facts only:

| Group | Columns |
| --- | --- |
| Identity/integrity | `session_id`, `event_seq`, `raw_event_sha256` |
| Time | `event_timestamp` (valid ISO UTC or NULL), `ingested_at` |
| Event-time metadata | `turn_id`, `model`, `reasoning_effort`, `context_window_tokens` |
| Last usage snapshot | `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens` |
| Cumulative snapshot | `cumulative_input_tokens`, `cumulative_cached_input_tokens`, `cumulative_output_tokens`, `cumulative_reasoning_output_tokens`, `cumulative_total_tokens` |
| Raw limits | `primary_used_percent`, `primary_window_minutes`, `primary_resets_at`, `secondary_used_percent`, `secondary_window_minutes`, `secondary_resets_at` |
| Raw labels | `plan_type`, `limit_id` |

Only finite JSON numbers are accepted as numeric facts; missing, null, string, boolean and nonfinite values become SQL NULL. Finite inconsistent values remain observed facts. `total_tokens` is the reported total, never an invented sum. Allowance-only events never inherit last usage or cumulative counters from an earlier event. Cumulative snapshots must not be summed as independent token increments.

`event_features_v1`: observed fields plus derived fields. `fresh_input_tokens=input-cached` and `cache_hit_percent=100*cached/input` require a valid nonnegative cached subset; zero input makes percentage NULL. `visible_output_tokens=output-reasoning` requires a valid nonnegative reasoning subset. Invalid subsets produce NULL, never clamping. `context_percent=100*input/context_window_tokens` requires nonnegative input and positive window. It estimates last-request context occupancy, not live occupancy.

Canonical columns `five_hour_used_percent`, `five_hour_window_minutes`, `five_hour_resets_at`, `weekly_used_percent`, `weekly_window_minutes`, `weekly_resets_at` map by 300/10080 minutes from either raw slot. Missing or duplicate/ambiguous same-window slots yield NULL. No quota state, weekly burn estimate or prediction is stored. `limit_id` stays available so later analysis can distinguish accounting pools; the recorder does not select a current HUD subscription snapshot.

Global analysis queries must explicitly use:

```sql
SELECT * FROM event_features_v1
ORDER BY event_timestamp, session_id, event_seq;
```

A view does not guarantee implicit row order. NULL timestamps are unknown and sort first in SQLite; filter them when analyzing timed events. Equal timestamps use the ID/ordinal tie-break only for deterministic display, never as evidence of causal order across sessions.

## Ordering and metadata

Read JSONL strictly in byte/record order even if event timestamps arrive out of order. `session_meta`, `task_started`, `turn_context` and token-event context-window reports update only the current as-of state. `turn_context` supplies model/effort directly or from `collaboration_mode.settings`. `task_started` establishes a new turn and clears unknown turn settings until its context arrives. Task completion/abort clears turn state. Context-window observations survive a context record omitting that field; a supplied null clears unknown context. Each telemetry row freezes the state at its own position. Historical events before metadata remain NULL forever, unless a source rewrite causes a full replay of the actual rewritten history. No session-index rename or HUD state is consulted.

## Checkpoint, restart and crash recovery

1. Discover active/archive sources and resolve stable identity/copies.
2. Acquire SQLite writer transaction, load checkpoint.
3. If size is below checkpoint or the committed-prefix anchor mismatches, reset the replay to byte zero and transactionally delete only that session's events.
4. Otherwise validate the prefix and read new bytes from the checkpoint. Restore the persisted as-of state first.
5. Parse only LF-terminated complete lines up to the size observed at scan start; count and insert events in file order. Blank/irrelevant records can advance the checkpoint but never become telemetry rows. Malformed complete lines abort the source transaction; never silently skip a potential ordinal.
6. Verify the completed prefix again to catch concurrent source rewrites, update the checkpoint/as-of state, then commit. Appends beyond the initial size are caught on the next scan.

`checkpoint_byte_offset` points immediately after the last committed complete record, measured in bytes. Partial UTF-8 or JSON tails and complete JSON without LF remain uncommitted. CRLF offsets include both delimiter bytes.

The anchor starts at 0 and ends at the checkpoint. Its hash covers the entire committed byte prefix. This detects early prefix mutation even when the file grows or the final record is unchanged; hashing requires reading historical bytes and is deliberately conservative. The parser holds one JSONL line plus a fixed-size chunk in memory; unusually large individual lines require proportionally more memory. Discovery polls do not create accounting samples. Long histories may justify a slower `--interval` to reduce local disk reads; scans never overlap.

Crash before COMMIT: neither new events nor new checkpoint/rebuild persists. Restart retries from the old checkpoint. Crash after COMMIT: both persist, and replay inserts zero events already committed. Rebuild failures retain the original session rows/checkpoint. The recorder never guesses ordinal correspondence after a rewrite.

## Privacy and limitations

Allowlisted field projection and bound SQL values prevent unrelated fields from entering SQLite. No prompt/response/reasoning/tool/file text, source code, conversation bodies, raw lines, rename or session display name is stored. Hashes are opaque integrity data. `current_path` is only in the source/recovery table. Error summaries contain codes and counts, without source paths, IDs or parser excerpts. No real user JSONL is copied into tests or the repository.

This is local observed telemetry, not server billing or an authenticated account database. No remote-only history can be ingested. Conflicting replicas and malformed complete lines leave committed history in place and report incomplete collection. Files disappearing during archive moves retry on the next scan. There is no automatic startup service, schema migration beyond v1, quota estimator, model, export feature or chart/HUD integration in this milestone.
