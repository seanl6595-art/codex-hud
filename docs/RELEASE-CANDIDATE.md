# v1.3.0-beta.1 public beta readiness

**Decision: controlled public beta authorized.** Updated October 18, 2026 (America/Vancouver). The owner reviewed the previous release-readiness results and explicitly accepted the documented, unexplained historical intermittent source-rewrite failure as a beta risk. It was not reproduced in 3,500 targeted cycles. This decision supersedes the prior BLOCK verdict; it does not claim the cause was identified. The final beta safety gate below passed on Node.js 24.21.0 / Windows x64; the versioned distributable is validated again after this report is included. New reproducible correctness, privacy, installation or data-integrity defects remain stop conditions.

## Identity and preservation

- Version: 1.3.0-beta.1 in package.json and both lockfile version fields. Tag: v1.3.0-beta.1.
- Branch: feature/gui-v1.3; preparation starts from 09097fc6949e01adccb529c54f72043eb17ff2f0. The annotated beta tag identifies the final reviewed preparation commit.
- Published v1.2.0 remains 979c3d291f812aba6f925f7384365f6d6aac147e, unchanged.
- All nine pre-existing preparation files were preserved before editing. Their original copies and the new private validation logs are outside the repository and npm archive.
- Changes now include runtime checks, source-read stability, browser-safe listening, regression tests, notices and a manual macOS workflow. Frontend appearance and accounting formulas are unchanged.
- Production SQLite and real JSONL files were not opened for mutation. Every writing test uses temporary synthetic sources/databases.

## Node 22.13.0: individual failure analysis

An unchanged baseline reproduction again produced **338 passes and 11 failures out of 349** on Windows x64. It used the existing Node 22.13.0 test executable. The preserved earlier repeat log had 311 passes / 8 failures / 319 reported cases because a test process terminated before all cases reported.

| Failing baseline case | Observed cause |
|---|---|
| history-verification: warm queries reuse cryptographic evidence | File identity mismatch; unchanged source unnecessarily reread |
| history-verification: time/model/effort changes share evidence | Same identity mismatch; filtered query cannot reuse proof |
| history-verification: source health timestamps alone do not invalidate evidence | Same identity mismatch, independent of database health metadata |
| history-verification: hidden external mutation is an as-of snapshot | Same identity mismatch; intended historical snapshot cannot be reused |
| ownership-gate: concealed all-stat rewrite retains historical age | Same identity mismatch; source reread instead of historical reuse |
| ownership-gate: archive relocation resumes reuse | Same identity mismatch after successful archive verification |
| history-verification: moved-source cold recovery reads each match once | SQLite statement finalized while the sources iterator is still live |
| history-verification: lightweight GUI status during fresh verification | Same SQLite error, propagated from the data worker |
| history-verification: large-history streaming accounting | Same SQLite iterator error at the sources traversal |
| provenance: consecutive/interleaved allowance updates | Same SQLite iterator error during repeated Stats calls |
| tooltip-fixture: custom bounds across wall clocks | Same SQLite iterator error, not a date-boundary assertion |

### Filesystem behavior

A disposable-file probe on Node 22.13.0 returns device 0 from `fs.statSync(path)` but a nonzero device from `fs.fstatSync(fd)`, with the other identity fields equal. Node 24.21.0 returns equal device identifiers. The cache compares a descriptor-derived certificate stamp with a path-derived stamp. The Node 22 mismatch conservatively evicts valid proofs; it does not justify deleting device/inode checks. No identity check was weakened to accommodate this runtime.

### SQLite statement lifetime

A standalone in-memory probe creates an iterator from `db.prepare(...).iterate()`, consumes one row, yields to the event loop and explicitly invokes garbage collection. Node 22.13.0 throws `ERR_INVALID_STATE: statement has been finalized`; Node 24.21.0 returns the remaining rows. No application database close or statement finalization occurs before iteration completes.

This reproduces the runtime lifetime defect described in [Node issue 57493](https://github.com/nodejs/node/issues/57493) and its [iterator fix 57569](https://github.com/nodejs/node/pull/57569). The five reproduced failures are runtime iterator/GC failures, not five independent accounting defects. Early process termination in the older repeat is consistent with that upstream bug, but its original crash dump is unavailable and is not independently proven.

`node:sqlite` exists in 22.13.0; missing API availability is not the explanation. Its then-experimental implementation has unsuitable behavior for this application. Tests use isolated temporary directories and independent connections; neither shared production data nor a weakened accounting expectation explains the failures.

## Supported runtime

The package and lockfile now require **Node.js >=24.21.0**. It is the earliest Node 24 patch actually validated by this project. Earlier Node 24 patches and Node 22 are unsupported. Newer versions satisfy the declared comparison, but this report claims execution only on 24.21.0.

README installation instructions, GUI/Recorder documentation, release notes, CLI help and Recorder/Stats errors agree. CLI and database entrypoints reject unsupported versions before opening or creating a database. An actual Node 22.13.0 CLI check exits 1 with the supported-minimum message. Regression tests cover the version boundary, no-write rejection, filesystem identity and SQLite iterator survival across forced GC.

## Source-rewrite investigation

### Confirmed cross-version defect: corrected

The old verifier accepted a changed `mtime` whenever the file grew. A deterministic test rewrites an already-read prefix and appends bytes before the final descriptor stat. The hash still describes the old bytes, but the verifier used to attach the newer file stamp to those bytes and cache the certificate. That test fails on Node 24.21.0 before the correction; changing engines alone would conceal a real application defect.

Verification now requires identical before/after identity, size and timestamps, and confirms that the path still resolves to the descriptor's identity. A changed file yields no new certificate; a later query can retry once it is stable. Tests cover growth plus rewrite, restored mtime and path replacement. Recorder tests deterministically mutate during parsing and prove that final prefix hashing rolls back both rows and checkpoints in new and legacy databases. No sleeps, retries of failed assertions, disabled tests or weakened expectations were introduced.

Only the memory-certificate read version changes. Durable v4 ownership seals and their binding format are preserved. A regression constructs the milestone's seal format independently, removes its source and confirms complete accounting with unchanged database bytes. Existing databases receive no automatic migration.

### Earlier sequential failure: still unresolved

The previous report recorded `provenance: legacy reads verify archived copies and reject rewritten prefixes` failing once and then passing. The retained Node 24 log contains only the successful final run, without the original assertion/stack or file-stat evidence.

Before corrections, this investigation ran three complete baseline suites (349/349 each), 30 standalone executions of that exact case, ten complete provenance-file suites, 500 fresh-fixture rewrite cycles and 3,000 repeated archive/append/rewrite cycles. None reproduced the reported failure. Twenty further targeted runs after the read-stability correction also passed. The original test remains enabled and unchanged.

The confirmed concurrent-read race above does **not** establish the cause of this sequential test's earlier failure. File timestamp collisions, concurrent external source access and scheduling remain hypotheses, not findings. The available evidence cannot honestly certify that the reported instability's root cause was identified and corrected. The owner has accepted this uncertainty for the controlled public beta. Keep the original case enabled, gather feedback, and stop for any new reproducible correctness, privacy, installation or data-integrity defect. Another large forensic investigation is not required solely for this historical, non-reproduced failure.

## Additional intermittent failure found during validation

A browser run failed with `ERR_UNSAFE_PORT` at loopback port 1720. The local Windows TCP dynamic range is 1024-15000, so requesting OS port 0 can allocate a [Fetch-blocked port](https://fetch.spec.whatwg.org/#port-blocking). A separate Node test reported `fetch failed`; that result is consistent with the same issue, but its truncated TAP error does not prove the exact allocated port.

The GUI now binds automatic selections directly in 49152-65535, retries bounded address conflicts and rejects explicitly requested Fetch-blocked ports with an actionable message. It retains loopback-only binding, no-shell launching and the existing local-origin/token protections. Regression tests cover automatic selection, collision handling, explicit-port errors and listener cleanup. The original browser and Node assertions remain unchanged.

## Previous readiness validation (before beta version preparation)

| Check | Result |
|---|---|
| Complete Node suite, final code, Node 24.21.0 Windows x64 | PASS: three consecutive runs, 363/363 each |
| Targeted rewrite/rollback cases | PASS: 20 repeated targeted runs; original case retained |
| Full browser suite, desktop/touch-emulated mobile Chrome | PASS: 66/66 on final code |
| Independent adversarial Node suites | PASS: original14 + additional10 + new-adversarial, 42/42 |
| Independent browser suite | PASS: 12/12 |
| Production TypeScript/Vite build | PASS: six compiled assets plus generated dependency notices |
| Actual npm archive and clean offline installation | PASS: no runtime dependencies; spaced/Unicode temporary paths |
| Installed CLI, Recorder, Stats, GUI and assets | PASS: exact synthetic accounting, idempotent recording, all compiled assets, desktop/mobile rendering |
| Windows PowerShell command shims | PASS: Windows PowerShell 5.1 and PowerShell 7 |
| Existing database provenance | PASS: explicit-only upgrade, source-independent milestone seals, read-only Stats |
| npm pack --dry-run / archive bytes / privacy / whitespace | PASS: 49 allowlisted files, seven build outputs; 104 project files scanned, zero findings; git diff --check clean |
| Native macOS | NOT RUN |

Earlier failed validation runs are retained in external evidence, including the baseline Node 22 failures, the injected source-read race and the unsafe-port browser failure. They are not replaced by successful later logs. Final evidence includes test logs, reviewed file hashes, package manifest and SHA256SUMS outside Git. Those earlier archives were inspection artifacts. The final beta package is generated and validated separately below.

## macOS review and pending execution

- Paths use Node path helpers. POSIX paths preserve case; Windows paths use a separate normalization path. Exact project matching does not assume that macOS filesystems are always case-insensitive. Synthetic Windows/POSIX path tests pass on Windows.
- Browser dispatch uses `open` with an argument array, no shell. `--no-open` prints the loopback URL as a fallback. Dispatch is simulated, not tested against Launch Services.
- npm creates the command link and sets executable permission for the shebang entrypoint. Source checkout instructions use `node ./bin/codex-hud.js`. The package validator now checks POSIX execute permission and invokes the installed command when run natively.
- Node 24.21.0 supplies SQLite; no system SQLite binary or separate native addon is required. Native macOS SQLite behavior has not been measured.
- Terminal lifecycle uses TTY detection, raw-mode cleanup and signal handlers; ASCII/no-color fallbacks remain available. Native terminal resizing, Ctrl+C and browser handling remain manual checks.
- GUI assets resolve relative to the installed module, independent of the working directory. All packaged assets load in the Windows clean install.
- `.github/workflows/compatibility.yml` is a manual `workflow_dispatch` workflow on macos-15, using exactly Node 24.21.0. It repeats Node tests three times, builds, runs the browser suite, packs, and performs the native clean-package check including the POSIX command link. It has read-only repository permissions and no publishing steps. Native execution has not yet been completed; the workflow remains manual.

Native macOS, Linux, Safari, Firefox and physical mobile support are not claimed as tested. Windows is the primarily tested platform. Native macOS validation has not yet been completed. Cold startup may take several seconds. This beta is for testing and feedback, with no guarantee of complete stability.

## Privacy, licensing and approval boundary

Source/archive review excludes telemetry, authentication files, databases/sidecars, personal paths, test fixtures, raw logs, dependency trees and local evidence. Runtime package dependencies remain empty. Original MIT attribution and copyright are retained. The build now includes exact bundled JavaScript dependency notices, with supplemental Tailwind CSS and Victory vendor notices in NOTICE.md.

The GUI remains a preview. Unknown accounting, ambiguous timestamps and ownership remain conservative. Token workload is not billing, quota, cost or model effectiveness. Cold historical verification can be expensive. Density controls and prior-period comparison remain deferred.

The owner explicitly authorized preparation, commit, branch/tag push and GitHub Pre-release publication after final checks. Stage only reviewed project files. Keep v1.2.0 and main unchanged; do not publish to npm. Provenance upgrade is optional and must never happen automatically. Final validation uses only synthetic writable fixtures and confirms unchanged production database bytes/metadata.

## Final beta safety gate

**PASS for the controlled 1.3.0-beta.1 public beta, with the documented risks accepted.** Executed October 18, 2026 on Windows x64 with Node.js 24.21.0. Native macOS validation remains pending.

| Final check | Result |
|---|---|
| Supported Node regression suite | PASS: 363/363; no skips or disabled cases |
| Desktop and touch-emulated mobile Chrome suite | PASS: 66/66 |
| Existing independent adversarial Node suites | PASS: 42/42 |
| Existing independent browser suite | PASS: 12/12 |
| Production TypeScript/Vite build | PASS: six compiled assets and generated third-party notices |
| Actual beta archive, exact source/build byte comparison | PASS: 50 allowlisted package files |
| Clean offline installation in spaced/Unicode paths | PASS: no runtime dependencies |
| Installed CLI / Recorder / Stats / GUI / all compiled assets | PASS: exact synthetic accounting, idempotent recording, desktop/mobile rendering |
| PowerShell command shims | PASS: Windows PowerShell 5.1 and PowerShell 7 |
| Optional provenance upgrade / legacy reads / rollback | PASS: explicit-only synthetic upgrade; no automatic migration |
| Privacy and license audit | PASS: 105 project files plus archive contents scanned; zero findings; original MIT attribution and bundled dependency notices retained |
| Production database and SQLite sidecars | PASS: SHA-256, sizes and modification times unchanged from the saved pre-test snapshot; no SQLite connection opened by release validation |
| Native macOS | NOT RUN; documented beta limitation |

External beta evidence contains the current test/build/package logs, exact archive manifest, reviewed file hashes, privacy audit and production-database hash snapshots. The public archive checksum is distributed separately as SHA256SUMS. The index and final commit contents are checked before the annotated tag is created. The release publishes only the reviewed branch/tag and validated archive/checksum; stable v1.2.0 and main remain unchanged.

## Reproduction and external evidence

Run `npm test` three times, `npm run test:browser`, `npm run build:gui`, `npm pack --dry-run`, `npm pack`, then `npm run test:package -- ./codex-hud-1.3.0-beta.1.tgz`. Set `CODEX_HUD_PACKAGE_BROWSER=1` for desktop/mobile installed-package rendering; on Windows, `CODEX_HUD_TEST_PWSH` selects the extra PowerShell 7 command check. All mutation-based checks create their own temporary synthetic history.

The external node-compatibility evidence directory contains `node22-baseline.tap`, `gc22.txt`, `gc24.txt`, `stat22.txt`, `stat24.txt`, `rewrite-race-before.txt`, the baseline and targeted repetitions, `node24-release-1.tap` through `node24-release-3.tap`, browser logs, package results, `audit.json`, `reviewed-files.json`, `package-manifest.json`, `readiness.json` and `SHA256SUMS`. Those files include machine-specific diagnostic paths and are deliberately excluded from Git and the package. The final archive is checked byte-for-byte against the reviewed source and build files.
