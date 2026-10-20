# macOS internal preview startup: DYLD library validation

Reported device: Apple Silicon MacBook, macOS 26.3.1. Reported failure:
`EXC_CRASH (SIGABRT)`, `Namespace DYLD, Code 1`, loading
`Electron Framework.framework/Electron Framework`, with
`mapping process and mapped file (non-platform) have different Team IDs`.
Only the supplied crash excerpt is available; no complete `.ips` or failed-device
bundle was supplied. Do not infer particular certificate identities from that
message alone, or claim a physical-device retest from hosted CI.

## Cause and previous coverage gap

The Forge configuration explicitly selected ad-hoc identity `-` but delegated
per-file settings to the locked `@electron/osx-sign` **2.7.1** dependency.
Its installed `dist/sign.js` defaults to Hardened Runtime and its default main,
generic helper, renderer and GPU entitlements omit `disable-library-validation`.
The plugin default includes that exception but also unnecessary unsigned
executable memory. Ad-hoc code has no certificate-backed Team ID; two ad-hoc
signatures do not establish a common development team. Library validation can
therefore reject the Electron Framework before any application JavaScript runs.
The supplied loader error and effective configuration identify this failure
mechanism. Direct inspection of the retained Apple Silicon artifact from run
`39409398936` (artifact `12259625388`) and Intel artifact from run `39410503044`
(artifact `12259517676`) confirms that their main executable, framework and all four helpers
have CodeDirectory flags `0x10002` (ad-hoc + runtime) and no Team ID. Main, generic,
renderer and GPU helpers lack the library-validation exception; only the plugin
helper has it. The main/generic defaults also include unnecessary hardware and
personal-information entitlements. All four original container SHA-256 values match
their retained `SHA256SUMS`. This is a read of embedded CodeDirectory/XML bytes on
Windows, not cryptographic signature verification or native execution. It shows
absent team identities, rather than a mixture of vendor certificates, in both ZIPs.

Original arm64 ZIP SHA-256:
`88b9baa8de3e4b46320052e972e710193ff39c5e1b97753e1e0a5cb85dd75cda`.
Original arm64 DMG SHA-256:
`5187ad85cc70be8f18cbad6168396aba4803638f3112fc47378fe6f6f4bafec2`.

`codesign --verify --deep --strict` checks signature integrity, not whether the
kernel will allow runtime framework mapping. Previous macOS 15 CI passed on both
architectures, launched the final ZIP, and mounted/verified the DMG, but never
launched a DMG-extracted app and did not exercise macOS 26.
The precise OS/host-policy difference that let the previous macOS 15 CI pass is
not established. The evidence identifies a signing/library-validation defect;
it does not establish a newly introduced macOS 26 regression or reproduce the
old build's failure on a hosted macOS 26 runner.

## Focused correction

Use the supported `optionsForFile` API to retain Hardened Runtime explicitly,
grant JIT plus `disable-library-validation` to internal Electron processes, and
grant no extra entitlements to libraries/frameworks. Apply timestamp `none` per
file for internal signatures. Preserve a separate, explicitly selected Developer
ID policy with validated identity, timestamping and JIT only, retaining library
validation. There is no unsigned executable memory, debugger, DYLD environment,
hardware access or global Hardened Runtime exception.

Inspect every packaged Mach-O identity, Team ID, runtime flag and exact entitlement
dictionary. This rejects the original missing-entitlement regression, mixed
identities and broader exceptions. Verify the final mounted DMG and extracted ZIP
and run both complete copies through the existing runtime/native/LaunchServices
gates using only disposable synthetic databases and sources. Check the exact OS
and architecture and retain macOS 15 alongside macOS 26 Apple Silicon coverage.

Windows packaging/workflow, Electron version, application security and production
telemetry/accounting code are unchanged. PR runs never distribute binaries;
candidate readiness is marked only after both final containers pass all gates.

## Validation record

Local Windows development: 363 existing core tests and 17 desktop tests passed,
including missing-library-validation, absent runtime, wrong-team, excessive
entitlements and future Developer ID negative cases. Native results for code
commit `310665bed25f701b6e8c5e9878e148398efa0f4b` are recorded in
[CI run 39432070570](https://github.com/seanl6595-art/codex-hud/actions/runs/39432070570).

| Native target | Result |
| --- | --- |
| macOS 15.7.9 x64 | Passed: all 14 Mach-O signatures, 363 embedded-runtime and 13 native tests per final container; both LaunchServices launches; 66 browser tests |
| macOS 15.7.9 arm64 | Passed: all 14 Mach-O signatures, 363 embedded-runtime and 13 native tests per final container; both LaunchServices launches; 66 browser tests |
| macOS 26 arm64 | Not executed: original job and isolated retry both cancelled after 15 minutes without acquiring a GitHub hosted runner |

The macOS 26 checks report: `The job was not acquired by Runner of type hosted
even after multiple attempts`, with notices of macOS ARM capacity constraints.
Original job `118659370542` and retry `118672058894` have no steps or runner
assignment. The overall workflow is therefore **not green**. Native macOS 26
startup, the affected 26.3.1 MacBook and an old/new build comparison on that system
remain unvalidated. No fully validated macOS 26 artifact is available for review.

Passing macOS 15 test candidates below were generated and tested on CI only.
They were not uploaded or retained for distribution; the run's artifact count is
zero. These hashes identify tested bytes, not downloadable release artifacts.

| Target/container | SHA-256 |
| --- | --- |
| arm64 ZIP | `e537edd50a78eef3b14d0d98381734232f6c96c62ec66b26798d3caed37a7448` |
| arm64 DMG | `5619df68abdbacf845186a15603c4ab151d9cb095c0dcd24c0945a0020f9cc64` |
| x64 ZIP | `0d74697c18e5971fb20dfc36e97062f922551d367c4ab8fd63c04109f37d3877` |
| x64 DMG | `3c1f81a54957c96011e3c9b29641df77ab8374d9e8e4ca93128b9a1398d0e86c` |

Hosted macOS 26 is a moving image: its actual patch version is printed by CI and
is not evidence for exactly 26.3.1. Gatekeeper/quarantined download, Developer ID,
notarization/stapling, physical Finder/Dock interaction, real sleep/logout and a
repeat launch on the affected MacBook remain separate review/manual gates.

References:

- [Apple: Disable Library Validation](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation)
- [Electron osx-sign source and per-file defaults](https://github.com/electron/osx-sign/blob/main/src/sign.ts)
- [GitHub: native macOS 26 runners](https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/)
