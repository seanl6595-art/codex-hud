# Usage applicability and historical accounting

Collection success means the Recorder processed available sources. Accounting
completeness requires a safe delta and assignable timestamp for every applicable
usage observation, independently for each metric. These are local observed
workload statistics, not server billing or subscription quota measurements.

## Classification

Classifier version 1 recognizes `event_msg` / `token_count` with explicit
`info:null` as allowance-only only for the recognized event envelope and at least
one valid rate-limit window. The payload keys are `type`, `info`, `rate_limits`;
the record keys are `type`, `timestamp`, `payload`, and optionally a nonnegative
safe-integer `ordinal` as emitted by current JSONL producers. This source ordinal
does not replace canonical Recorder event identity. A valid window has a finite
percentage from 0 to 100, positive integer duration in minutes, and finite positive
reset timestamp. Duration and plan name are not hardcoded.

Object-valued `info`, including empty or partial objects, remains usage-shaped.
Missing `info`, invalid types, unknown envelope fields and unrecognized shapes
remain unknown. NULL counters alone never justify exclusion. Future formats
require reviewed classifier support.

Every canonical event retains its identity, ordinal, hash and observed counters.
Verified allowance-only rows are excluded from usage sample counts, ratios,
buckets, model/effort groups and usage-predecessor selection, and counted separately
in `coverage.allowanceOnlyObservations`.

Canonical sequence integrity is checked before time or model filtering. Gaps stay
indeterminate, including gaps next to allowance-only records. Usage adjacency uses
the last applicable observation in the same sequence; partial or unknown usage
never gets skipped. First applicable usage needs `cumulative == last` for a safe
baseline. Duplicates contribute zero; ordinary monotonic differences use cumulative
endpoints, not potentially stale last-usage snapshots.

A coherent restart requires a decrease in Input or Output and a complete,
nonnegative current Input/Cached/Output/Reasoning vector equal to last usage, with
valid subset relationships. When reported totals are supplied, both totals must
agree with that vector. All four counters then use the same new baseline, even
when a subset rose or stayed equal. A lone subset decrease never establishes a
global restart. This is an explicit HUD accounting rule based on a fresh additive
accumulator; the source has no explicit reset-epoch identifier.

An unresolved primary decrease makes positive-predecessor monotonic deltas
ambiguous: subtracting the old epoch may lose usage. Those metrics report
`ambiguous_reset`. A zero predecessor preserves an epoch-independent delta;
decreasing metrics can independently retain a valid `C == L` baseline. A subset
decrease without a corresponding whole decrease remains uncertain. Missing
metrics and unrelated safe primary counters remain independent where this evidence
permits. This deliberately replaces the old scalar-reset false-completeness rule.

## Compatible storage

Base `schema_version=1` and `contract=recorder_v1` remain unchanged. No columns,
observations, views or checkpoints are rewritten. New databases include the
additive `event_provenance_v1` table and `recorder_meta.event_provenance_version=1`.
The extension stores canonical session ID, ordinal, original raw-event SHA-256,
`usage_kind` (`usage`, `allowance_only`, `unknown`) and `classifier_version=1`.

Recorder writes event and evidence in the same source transaction. Foreign-key
cascade removes evidence on rebuild. Readers require matching event hashes and a
supported classifier version. Non-NULL counters contradict allowance-only status
and prevent exclusion. No conversation content is persisted in the extension.
Extension version, columns, primary key and cascade linkage are checked before
use. This correction adds no schema version or migration.

Existing v1 databases are **not automatically upgraded**, even when Recorder or
GUI opens them. Legacy recording remains supported, but its events depend on
source verification until explicitly upgraded. Older v1 readers/writers can open
the additive layout. An old writer may append without provenance, so new readers
retain legacy fallback. Old Stats still has the original accounting defect.

## Read-only legacy recovery

Fresh verification checks available recorded source prefixes against their checkpoint SHA-256
and checks the complete canonical event stream, including identity, count, ordinals
and raw-event hashes. Raw usage columns and absolute source timestamps must also
match their authenticated projection. A legacy timezone-naive source timestamp
cannot reconstruct the original Recorder's process zone; its stored normalized
timestamp stays a bound recorded fact and is not reinterpreted in the reader's zone.
Recorder discovery, append/rebuild ingestion, read-only inspection and recovery
share `rollout-identity.js`. See [Rollout ownership](ROLLOUT-OWNERSHIP.md) for the
version-4 protocol inventory, header invariants and persisted ownership proofs.
Ordinary sources must match the full sequence. Only the supported v2 paginated
fork declaration with consistent parent/fork/spawn lineage, an actual record
ordinal, matching inherited identities and a `thread_settings_applied` boundary
can exclude inherited history. Ownership is checked throughout the inherited
prefix: explicit observation ownership must be the parent there and the child at
or after the boundary. Child-owned, unrelated or contradictory owners reject the
source. `thread_settings_applied.thread_id` identifies ownership, as do explicit
thread owners on usage/context observations and record envelopes. Family IDs,
root-turn IDs and recipient references are not owners. Absent/null ownership is
accepted only for documented optional owner fields in a supported, authenticated
layout. Mandatory typed owners and unknown inherited record variants fail closed.

Copied-history declarations are recognized independently of later `session_meta`
records: `forked_from_id`, or a thread-spawn declaration with a history boundary,
must satisfy the complete supported layout. Unknown child versions carrying
lineage/boundary metadata are rejected. Unsupported/incomplete declarations never
fall back to ordinary usage. Legacy disabled rollouts can carry parent/ordinal
annotations without a fork/spawn declaration; non-inheriting v2 child streams can
lack copied history. Their full ordinary streams remain supported.
Ordinary roots may also declare `history_mode: paginated`; that field alone is
not a fork. A matching suffix is never sufficient evidence.

Counters and model metadata always come from SQLite; recovery supplies
classification and integrity evidence only. Known-counter rows are also checked
against available authenticated source evidence, so a numeric-only truncated
history cannot evade integrity checks. Sources with no surviving events are
included. A detected conflict conservatively affects all periods and buckets
because omitted observations have no trustworthy time assignment; `source_integrity`
counts affected sources. Model/effort groups receive the same incompleteness.

The recorded source path is tried first. If it moved, active and archived sources
under the selected Codex home are indexed by their first session identity, once
per verification pass. The identity index is only a candidate hint: the selected
file still needs exact prefix, canonical sequence and raw projection checks.
Each candidate is inspected once for identity and fully verified only for its
matching source, avoiding per-source scans of every unrelated candidate. Duplicate
identities remain separate candidates; a conflicting copy is never trusted merely
because its ID matches. A long prelude/metadata record can still require reading
that record once; work is linear in candidate bytes, not a fixed byte guarantee.
Identity probing stops at each file's initial size; it never chases a growing tail.
Exact replicas can establish the same classification; conflicting copies cannot
override recorded history. Later appends do not invalidate an unchanged prefix.
Recovery retains classifications and hashes, not conversation content.

Missing files, changed prefixes, malformed records, mismatched event hashes or
missing canonical events prevent recovery. Persisted verified evidence remains
usable after source deletion when bound to a current per-source ownership proof.
Old v1 classifications without that proof require source revalidation; absent
sources cannot certify those old rows. Legacy events without evidence stay unknown and
applicable. Known counters may still yield safe deltas independently, while
unresolved usage retains incomplete flags. An allowance-only event is not assigned
invented zero usage.

Unavailable or modified source bytes are not proof that committed known counters
are wrong. Without contradictory authenticated evidence, existing per-metric
accounting still applies. This is not tamper-proof storage: coordinated alterations
to all database evidence after the original sources disappear cannot be detected
by local hashes alone.

## Verified history snapshots and freshness

The default Stats mode is `verification: 'snapshot'`. A bounded, **memory-only**
cache retains certificates of previously cryptographically verified committed
history and witnessed integrity conflicts. It never caches unknown results as valid, invents counters, or skips the
accounting pass. Every query opens a fresh read-only SQLite transaction and computes
its own deltas, period, groups and buckets from current committed observations.
Up to 100,000 observations are materialized once within that transaction and reused
for certificate binding and accounting, avoiding duplicate DB reads. Larger
histories retain the streaming path. Orphaned events are included in integrity
checking and cannot disappear merely because their source row is missing.

Each certificate binds the selected DB/home scope, verifier/parser/classifier versions,
Recorder metadata, source ID, checkpoint offsets/hash, canonical sequence/count,
**all columns of every ordered event row**, and persisted provenance rows. A changed
counter, timestamp, ordinal, model/effort, checkpoint, schema metadata or provenance
row therefore cannot reuse an old certificate. Routine source-health `updated_at`,
uncommitted file-size observations and location paths are not accounting facts;
they do not invalidate an otherwise identical binding. The actual verified path
is retained only to detect common external changes. Cache limits are 1,024
certificates and 250,000 classified events per process; eviction/restart requires
verification again. No conversation text or persistent cache file is retained.

The certificate asserts historical byte/sequence correspondence at `verifiedAt`.
It does **not** assert that arbitrary external files are unchanged now. Current
file identity, size, birth/change/write times and existence act only as conservative
eviction signals. An unchanged stat signature is never the authentication proof:
the previous cryptographic certificate is. Missing/observably changed files evict
that cached proof. Known persisted applicability can still survive source deletion
under its existing contract; unresolved legacy applicability stays unknown.

An arbitrary external rewrite concealing all metadata changes cannot be immediately
detected without reading its contents again. Snapshot mode may continue to report
the same previously authenticated committed history, explicitly marked as such.
For fresh byte verification use:

```text
codex-hud stats --verify-sources [--db PATH] [--codex-home PATH]
GET /api/stats?...&verification=fresh
```

The GUI exposes **Recheck source files**, explains the historical evidence scope,
and shows its oldest verification time. `Stats.verification` returns mode, evidence
revision, checked/reused/unavailable/conflicting source counts, oldest/newest
verification times and `liveSourceAttestation:false`. A fresh check bypasses and
evicts the old certificate before reading bytes; failed verification cannot revive
that old entry. The explicit upgrade also always verifies fresh bytes and never
promotes a cached snapshot directly into persistent evidence.

A witnessed integrity conflict is bound to the source/checkpoint and ordered row
facts under the verifier versions, independently of additive provenance metadata.
Deleting its file or installing the extension does not repair those facts: a
cached negative witness keeps the same history incomplete, including after an
unsuccessful fresh read (`retainedConflicts`). Changed underlying facts require
new verification. Read-only witnesses share the bounded memory cache and do not
survive eviction/restart. An explicit version-4 upgrade additionally persists a
rejection binding so its rejected history cannot revive after source loss/restart.
This is durable provenance written only by the authorized upgrade, not a disk
cache. Keep original evidence when an upgrade reports unknown/conflicting history. The upgrade reports
`conflictingSources`; its CLI exits nonzero for conflicts and certifies none of
those source events. It still preserves previously committed observations.

The evidence revision changes when DB evidence or verification outcomes change;
filtered GUI analytics use it to invalidate old client results after a recheck.
Each HTTP response is internally consistent with its DB read transaction; separate
responses may reflect different committed revisions if Recorder advances meanwhile.
No cache of aggregate totals or deltas is used, and no file watcher/mtime-only trust
or unproved TTL policy substitutes for source authentication.

Stats and heatmap share the same verification worker/cache, so the second request
reuses the first request's proof. Catalog/diagnostics and lightweight status reads
have separate workers; source verification cannot serially block status. A cold
process, an explicit fresh check, or changed committed evidence still pays its
verification cost. Subsequent warm filter/range queries avoid source-content reads.
Running verification is not cancelled: warm queue work is cheap, and an initial
burst waits for one proof pass rather than redoing the entire history per filter.

## Explicit upgrade

```text
codex-hud upgrade-provenance --db PATH --codex-home PATH
```

This opt-in command installs/backfills only the extension in one `BEGIN IMMEDIATE`
transaction. It never ingests or rebuilds historical events. Missing sources remain
unclassified; unavailable files never erase earlier verified evidence. Reruns are
idempotent and can recover sources that later become available. Exception and
process-termination tests verify rollback before commit and safe restart.
Unsupported extension versions fail explicitly. Stats and GUI GET requests never
invoke an upgrade. The implementation audit did not upgrade the real user database.

Recorder now refreshes provenance capability after `BEGIN IMMEDIATE`, under the
same writer lock used by upgrade. A scan already in flight commits before a waiting
upgrade, which then backfills that observation; a scan beginning after upgrade
persists evidence atomically, including on an already-open Recorder. Unsupported
schema/version states or removal of an adopted extension fail the scan and preserve
its previously committed checkpoint. The upgrade rechecks the base schema under
its lock. Existing older Recorder binaries still need restart into this version
to obtain this behavior; they cannot be made aware of a new contract retroactively.

## Completeness, subsets and attribution

`incompleteReasons` reports per-metric counts: missing cumulative/last/predecessor
counters, unsafe baselines, unrecognized/ambiguous resets, sequence gaps, unknown
provenance, source integrity conflicts, unknown timestamps and invalid subsets. Unknown-time evidence may affect every
period because it cannot safely be placed. One unresolved applicable observation
makes its metric's period total incomplete without contaminating unrelated metrics
or ordinary other buckets.

Cached remains independently reported. Fresh needs consistent Input/Cached deltas
and contributing cumulative snapshots and baseline last-usage snapshots; invalid
subsets withhold Fresh and cache ratios without clamping recorded counters.
Last-usage snapshots that do not participate in a baseline/reset decision do not
override valid monotonic cumulative accounting. Reasoning is an Output subset:
inconsistent deltas, contributing cumulative snapshots or baseline last-usage
snapshots withhold Reasoning while independently safe Output remains available.
A valid recognized reset can restore a safe subset baseline. Missing Output alone
does not erase independently known Reasoning without evidence of inconsistency.

Ratios use matched applicable Input/Cached observations and complete denominators.
Attribution compares actual usage predecessors across metadata changes; allowance
metadata cannot conceal a multi-context interval. Unknown model/effort attribution
is a group, not unknown token accounting. The detailed table checks all five
metrics for its quality label; the heatmap retains its Input+Output definition.

## Subscription and release separation

Subscription remains account-global, latest-whole-snapshot, and duration-based.
Absent five-hour data stays UNKNOWN. Duplicate same-duration slots now yield
UNKNOWN rather than silently choosing the first. Token totals never supply quota.

The CLI correction requires independent re-review before a v1.2.1 backport: the provenance modules, shared rollout identity parser, Recorder/DB
extension support, explicit upgrade command, Stats applicability/reasons/subset
validation, subscription ambiguity handling and corresponding tests/docs. Resolve
the small Stats call-site differences manually because v1.3 also has bucket and
analytics consumers. GUI contracts, explanations, bucket labels and browser tests
belong in v1.3.0. Do not introduce GUI imports into the CLI-only backport.
