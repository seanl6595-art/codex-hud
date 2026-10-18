# Rollout ownership and inherited-history policy

Parser version 4; source verifier version 4. This document supplements ACCOUNTING.md.
It describes canonical telemetry ownership, not a general Codex history renderer.

## Upstream evidence

Audited on 2026-10-17 against OpenAI's public Codex source. Revision observed during
the audit: `8d9f6466ff0294785d56f55b1fe363d132fe4133`. The audit artifacts preserve
the fetched source files and their hashes; no private rollout content is included.

- [Protocol definitions](https://github.com/openai/codex/blob/8d9f6466ff0294785d56f55b1fe363d132fe4133/codex-rs/protocol/src/protocol.rs):
  SessionMeta, HistoryPosition, ThreadSettingsAppliedEvent, ItemStartedEvent,
  ItemCompletedEvent, content deltas, ThreadGoalUpdatedEvent, ThreadQueueChangedEvent,
  SessionConfiguredEvent, TokenUsageRecord, and collaboration events.
- [History envelopes](https://github.com/openai/codex/blob/8d9f6466ff0294785d56f55b1fe363d132fe4133/codex-rs/history/src/lib.rs):
  RolloutItem and ResponseItemEnvelope distinguish model-history objects from events.
- [Response objects](https://github.com/openai/codex/blob/8d9f6466ff0294785d56f55b1fe363d132fe4133/codex-rs/protocol/src/models.rs):
  ResponseItem's discriminated content/tool variants.
- [Ordinal writer](https://github.com/openai/codex/blob/8d9f6466ff0294785d56f55b1fe363d132fe4133/codex-rs/rollout/src/ordinal.rs)
  and [rollout writer](https://github.com/openai/codex/blob/8d9f6466ff0294785d56f55b1fe363d132fe4133/codex-rs/rollout/src/recorder.rs):
  paginated local records advance ordinals; external history can start at a
  nonzero ordinal. An unfinished copied prefix must not be resumed as child work.

SessionMeta defines `subagent_history_start_ordinal` as the first record of the
child's projected history. ThreadSettingsAppliedEvent explicitly identifies its
logical owner and permits an absent owner in older histories. Those definitions,
consistent fork/spawn lineage, physical position, and the actual settings record
jointly establish the supported local boundary. A numeric cutoff alone never does.
External `history_base` and logical fork cutoffs have different semantics and are
deliberately rejected, rather than treated as a local copied prefix.

## Ownership inventory

Paths below are JSON wire paths. They are explicit, not recursive searches.

| Record family | Owner or interpretation | In an inherited prefix |
| --- | --- | --- |
| Every record envelope | Direct `thread_id` / `threadId`, when present | Must equal parent; malformed or conflicting values reject |
| Every direct payload | Direct `payload.thread_id` / `payload.threadId`, when present | Must agree with envelope and parent |
| `session_meta` | `payload.id`; legacy `session_id` only when `id` is absent | Parent identity required; every declaration validated; nested inherited histories rejected |
| Session family metadata | `session_id` alongside `id` groups related threads | Not an owner; repeated headers must preserve its declaration |
| Fork declaration | `forked_from_id`, `parent_thread_id`, `source.subagent.thread_spawn.parent_thread_id`, version, mode, boundary | Consistent supported v2 local layout only; parent references are lineage, not observation ownership |
| External history | `history_base.thread_id` references a rollout, which may differ from logical thread identity; `forked_from_ordinal_exclusive` is a separate logical cutoff | Unsupported; reject even in a repeated header or copied parent header |
| `thread_settings_applied` | Optional `payload.thread_id` | Explicit owner must be parent; at boundary it must be child. Missing/null remains supported legacy absence |
| `turn_context` | Optional direct thread owner; turn/root-turn IDs identify attribution, not thread ownership | Validate explicit owner; otherwise known source-local context |
| `item_started`, `item_completed` | Required `payload.thread_id` | Required valid parent owner; child, foreign, missing, null or malformed owners reject |
| `agent_message_content_delta`, `plan_delta`, `reasoning_content_delta`, `reasoning_raw_content_delta` | Required `payload.thread_id` | Same mandatory owner policy as item lifecycle |
| `thread_goal_updated` | Camel-case `payload.threadId` **and** `payload.goal.threadId` | Both mandatory and parent-owned; conflicting snake-case direct aliases also reject |
| `thread_queue_changed` | Camel-case `payload.threadId` | Mandatory parent owner |
| `session_configured` | `payload.thread_id`, with legacy `payload.session_id` fallback | Mandatory parent owner; modern session family ID is not confused with thread ID |
| `token_count` | Source-local usage/allowance; optional direct owner | Validate direct owners; usage classification and hashes are unchanged |
| `token_usage_record` RolloutItem, compatibility `event_msg.token_usage_record` / `token_usage` | Required `payload.thread_id` | Mandatory parent owner; these records do not add telemetry rows (only `token_count` does) |
| Collaboration spawn, interaction, waiting, close and resume begin/end | `payload.sender_thread_id` | Mandatory parent sender; `receiver_thread_id(s)`, `new_thread_id`, agent arrays and status-map keys are references |
| `sub_agent_activity` | `agent_thread_id` identifies the affected subagent | Reference, not owner; direct envelope/payload owners still checked |
| `response_item` | Reviewed ResponseItem variant; content, tool arguments/output, author/recipient and harness evidence are not recursive owner fields | Known variants only; direct owner fields still checked |
| `event_msg.raw_response_item` | Nested `payload.item` ResponseItem discriminant | Known nested variant required; opaque model/tool content is not traversed |
| `world_state` | `full` boolean and `state` object hold model-visible comparison state | Known shape required; map keys are data, not recursive owner declarations |
| `compacted` | Source-local compaction record | Direct owners checked; no new fork projection inferred from content |
| Other reviewed EventMsg variants | Source-local task/turn, text/reasoning, tool, approval, hook, environment, realtime, warning/error and status records | Explicit finite list in `localEvents`; direct owners checked |
| Other RolloutItems | `inter_agent_communication`, its metadata, `security_risk_score`, `retained_context`, `realtime_item` | Not reviewed for inherited projection; reject inside a copied prefix |
| Unknown outer/event/response variants | No reviewed inherited ownership contract | Reject, even if a supplied parent ID looks plausible |

The explicit source-local event inventory is in `localEvents`; it includes the
reviewed wire names and task/turn compatibility aliases. The explicit response
inventory is in `responseTypes`. Adding a future variant requires a protocol
review and a regression, not an automatic trust fallback.

## Invariants and entrypoints

1. Every parsed nonblank record in a proposed inherited prefix passes the reviewed
   format policy and all applicable owner checks before exclusion.
2. Explicit child/foreign ownership, mixed owners, and missing mandatory typed
   owners reject the source. There is no shortened trusted suffix in those cases.
3. Every session header is validated before any same-ID return. Repeated identity
   must preserve family/lineage/version/mode/boundary semantics. A later header
   cannot introduce or remove inherited history. Different own-stream IDs reject.
4. Supported copied history begins with the child header at physical record zero;
   consistent parent/fork/spawn lineage and the exact settings boundary are
   required. Supplied ordinals must match physical positions. Legacy omitted
   ordinals and optional settings ownership remain compatible.
5. Incomplete prefixes remain pending; malformed, unsupported, or contradictory
   complete prefixes fail. Unknown own-stream records can remain ordinary records
   because they do not authorize exclusion; their direct owners are still checked.
6. Discovery, append/rebuild ingestion, read-only inspection, and byte-authenticated
   legacy/provenance recovery use `canonicalSource`. Recorder replays declarations
   in the old checkpoint too, while inserting only new canonical events.
7. Event identity, ordered `event_seq`, raw hashes, counter projections, source
   associations, byte checkpoints, and model/effort attribution are retained.
   Source verification still authenticates the entire committed byte prefix and
   complete canonical token sequence. Parser/verifier versions enter cache keys.

## Persisted provenance and historical snapshots

`event_provenance_v1` keeps its existing schema and classifier version. Its old
rows alone cannot prove that version 4 accepted ownership. A successful Recorder
transaction or explicit fresh upgrade writes `recorder_meta` key
`ownership_proof_v4:<source-id>` with a SHA-256 binding of parser/verifier versions,
source identity/checkpoint/hash/count, all ordered telemetry rows, and persisted
classification rows. Recorder refreshes classifications from verified bytes before
writing this seal; it does not countersign earlier unverified classifications.

A current matching seal permits source-independent persisted classification after
deletion. Without it, old v1 evidence requires live source verification. An absent
source with old unsealed v1 rows cannot certify even a plausible numeric sequence.
An explicit upgrade that rejects a source writes a `conflict:` binding of source
and ordered row facts in the same metadata slot. This durable negative provenance
prevents deletion/restart from reviving the rejected numeric-only history. A fresh
successful verification can supersede it; changes to its bound facts invalidate it.
Neither unavailable evidence alone nor a memory snapshot creates a positive seal.

Stats and GUI GET requests remain read-only. They do not migrate or write seals.
The existing process-local cache remains an as-of historical proof, not live
attestation. Positive cache bindings include the source's own seal, not every
other source's seal; this avoids quadratic serialization after upgrade. Unrelated
metadata/configuration and all relevant event/provenance facts remain bound.
Explicit fresh checks bypass positive reuse. Archive movement requires fresh
prefix authentication. Unknown results never become positive cache entries.

Ordinary read-only conflicts remain process-local, as previously documented;
only an explicit upgrade persists rejection evidence. A legacy numeric-only DB
without sources or an explicit upgrade witness retains its existing arithmetic
compatibility; it has no current source certificate and reports unavailable source
verification. This cannot reconstruct history already lost before any observation.

## Limits

This is ownership validation for reviewed wire families, not a full JSON-schema
validator of opaque message/tool content. It cannot infer owners from prose,
turn IDs, family IDs, recipients, or arbitrarily renamed fields. Nested forks,
external/reverted history bases, unsupported versions, unreviewed record families,
compressed source discovery, and other projection layouts remain unsupported.
Future ownership semantics require a parser/verifier bump and fresh proof.

Canonical replay and fresh certification add Recorder work; warm Stats/GUI proof
reuse is unchanged. No aggregate totals are cached. Cold full-source verification
and the session catalogue remain separate performance follow-ups.
