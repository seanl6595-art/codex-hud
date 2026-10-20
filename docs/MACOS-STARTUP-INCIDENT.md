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
mechanism; actual packaged signature evidence is required to distinguish it from
a mixture of ad-hoc and vendor-signed nested binaries in a particular download.

`codesign --verify --deep --strict` checks signature integrity, not whether the
kernel will allow runtime framework mapping. Previous macOS 15 CI passed on both
architectures, launched the final ZIP, and mounted/verified the DMG, but never
launched a DMG-extracted app and did not exercise macOS 26.

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
entitlements and future Developer ID negative cases. Native results will be
recorded after the focused branch commit runs on all three required runners.

Hosted macOS 26 is a moving image: its actual patch version is printed by CI and
is not evidence for exactly 26.3.1. Gatekeeper/quarantined download, Developer ID,
notarization/stapling, physical Finder/Dock interaction, real sleep/logout and a
repeat launch on the affected MacBook remain separate review/manual gates.

References:

- [Apple: Disable Library Validation](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation)
- [Electron osx-sign source and per-file defaults](https://github.com/electron/osx-sign/blob/main/src/sign.ts)
- [GitHub: native macOS 26 runners](https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/)
