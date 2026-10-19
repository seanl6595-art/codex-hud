# macOS desktop port — internal preparation

This work starts at Windows Desktop commit
`775c9bdfbbeb64ea8a59b0259c5e984b3d5b1c73` (`v1.3.0-desktop.1`). It reuses
the Electron shell, compiled React frontend, existing HTTP backend, utility process
and four data/Recorder workers. Core telemetry, accounting/provenance, default
data paths, schema and CLI/browser entry points are unchanged. Electron stays
pinned at **44.9.0**. No macOS compatibility pass or public release is implied by
the configuration or the existing Windows results.

## Current gates

| Gate | Status before native execution |
| --- | --- |
| Apple Silicon arm64 `.app`/ZIP/DMG | Configuration prepared; native build and execution pending |
| Intel x64 `.app`/ZIP/DMG | Separate configuration prepared; native build and execution pending |
| Embedded Node, SQLite and worker behavior | Must be measured independently on each native architecture |
| Finder/Dock/close/Quit behavior | Implemented and policy-tested; native tests pending |
| Renderer/API security on macOS | Controls preserved; native execution pending |
| Developer ID signing and notarization | Not performed; required before public distribution |
| Gatekeeper/quarantined download and real power/session events | Not tested |

There is no connected Mac executor in the Windows development session. Native
validation uses GitHub-hosted runners through an authorized internal pull request
from `codex/macos-desktop-port` to the verified Windows desktop baseline,
`codex/windows-desktop-mvp`. This authorization covers the development commit,
branch push and CI execution only. Do not report any native gate as passed until
the matching native job supplies the evidence. Merging and public distribution
require separate approval; artifact upload remains disabled for the initial run.

## macOS application behavior

- Finder/Applications opens one native window with the existing dark bilingual GUI.
  No separately installed Node is used; the backend is an Electron utility process.
- A native app/edit/window menu supplies About, Quit/Command-Q, editing, zoom and
  window controls. The operating-system title bar remains intact.
- Red close drains/stops the GUI-owned Recorder/backend and closes the window.
  The Dock app stays available without a hidden Recorder. Dock activation opens
  one fresh window/backend with Recorder **off**. Concurrent activation/reopen
  waits for the old backend to drain. Quit exits the whole application.
- Window placement and enumerated UI preferences persist through a reopen.
- Unexpected backend/renderer failures show the existing localized error surface.
  Sleep/wake uses the existing heartbeat/reconnect logic. Native shutdown and
  SIGTERM/SIGINT request graceful owned cleanup. Real sleep/logout still needs
  manual validation; simulated events are not equivalent.

Windows retains close-to-exit, its native icon/title bar and single-instance
behavior. The Windows package excludes Mac-only image assets and build resources.

## Data locations and Finder environment

The backend continues to use `os.homedir()` and its original defaults:

- Codex sources: `~/.codex`, unless `CODEX_HOME` is actually present in the launch
  environment or an explicit `--codex-home` option is supplied.
- Recorder history: `~/.codex-hud/telemetry.sqlite3` (or explicit `--db`).
- Desktop profile/settings: `~/Library/Application Support/Codex HUD` (or
  explicit `--user-data`). These are separate from telemetry history.

Finder does not inherit interactive `.zshrc`/`.zprofile` environment variables. The
app does not spawn a shell, execute startup files, or search PATH for Node. Standard
home-directory sources work without terminal configuration. Custom source homes
need an explicit launch environment/options; this milestone adds no data-location
migration or path-picker UI. Filesystem/TCC permissions still apply to custom
protected folders; respect macOS permissions rather than bypassing them.

Opening a missing telemetry DB never creates it. Existing history is read-only
until the user explicitly chooses Start recording/Sync once. Provenance upgrade
remains explicit. Closing/quitting never discovers or terminates an external CLI
Recorder. Every automated write test supplies disposable source/DB/profile paths.

## Native internal build

On a matching native Mac with Node >=24.21.0 for development only:

```sh
npm ci
npm ci --prefix desktop
npm run build:gui
npm --prefix desktop run make:mac -- arm64  # Apple Silicon host
# On a separate native Intel host, use x64 instead.
```

The build rejects Windows/Linux, mismatched CPU targets and Rosetta execution.
It does not create an unvalidated cross-build and call it native support.

`desktop/forge.macos.cjs` configures Forge **8.0.1** and its ZIP maker with a
virtual configuration registered through Forge's public API. An explicit staging
allowlist reuses the existing app sources, backend and GUI. Build-only Electron
metadata is stripped before signing; no node_modules, credentials, private history,
database, debug logs or Node sidecar enter the app. Original MIT/upstream,
Electron/Chromium and frontend notices are retained inside the bundle.

The bundle ID is `art.seanl6595.codex-hud.desktop`; its executable and display name
are `Codex HUD`. Numeric Apple bundle versions use `1.3.0`; the app's internal
preview package metadata remains `1.3.0-desktop.1`. The branded SVG is exported to
a tracked 1024-pixel PNG; macOS `sips` and `iconutil` generate the ICNS at build time.
The minimum system version is read from the actual Electron bundle, not guessed.

Forge packages the `.app` and ZIP. Native `hdiutil` creates/verifies a DMG with the
app, an Applications link and internal readme. The current Forge DMG maker pulls
an image-parser advisory (GHSA-w3rx-r6r6-pgpr); it is deliberately not a dependency.
The selected Forge/ZIP/native-DMG chain is pinned and must pass the dependency audit.

Outputs, **only after a successful native build**, are:

```text
desktop/out/macos/<version>-<arch>-<timestamp>/Codex HUD-darwin-<arch>/Codex HUD.app
desktop/out/macos/<version>-<arch>-<timestamp>/codex-hud-desktop-<version>-macos-<arch>-internal.zip
desktop/out/macos/<version>-<arch>-<timestamp>/codex-hud-desktop-<version>-macos-<arch>-internal.dmg
desktop/out/macos/<version>-<arch>-<timestamp>/SHA256SUMS
desktop/out/macos/latest-<arch>.json
```

No `.app`/DMG exists merely because these paths are documented. Build metadata
records platform, actual architecture, source hashes, bundle identity, minimum
system version, artifact checksums and the signing/validation state. Windows
`out/latest.json` is independent of the Mac output pointers.

## Native test workflow and local commands

The prepared `.github/workflows/macos-desktop.yml` uses separate
`macos-15` (arm64) and `macos-15-intel` (x64) jobs, with explicit host/architecture
checks to fail if runner labels change. It runs core tests, the pinned runtime's
full Node/accounting suite, unit tests, a native internal build, mounted-DMG hash
and signature checks, relocated-ZIP native tests, LaunchServices smoke, and the
existing browser suite. It never pushes, tags, merges, notarizes or creates a release.
Its pull-request trigger validates the port without merging into main.
Manual `workflow_dispatch` generally requires the
workflow to be registered on the default branch; a local file or branch-only
manual workflow must not be presented as already callable. Check the actual
pull-request run and both job conclusions before reporting compatibility results.

Artifact upload is **off by default**. The optional explicit retention input must
be separately approved: artifacts in a public repository are not a private
distribution channel. Only generated preview archives/manifests/checksums are
selected; telemetry fixtures and debug traces are excluded.

Equivalent developer commands after the build:

```sh
npm test
npm run test:desktop
npm --prefix desktop run test:runtime
node desktop/scripts/verify-macos-artifacts.cjs
# Extract the real ZIP outside the checkout using ditto, preserving permissions.
export CODEX_HUD_DESKTOP_APP='/owned/test/Codex HUD.app'
export CODEX_HUD_DESKTOP_EXECUTABLE="$CODEX_HUD_DESKTOP_APP/Contents/MacOS/Codex HUD"
export CODEX_HUD_DESKTOP_TEST_ROOT='/owned/test/evidence'
npm run test:desktop:native
node desktop/scripts/macos-finder-smoke.cjs
```

The shared suite validates API authentication/Host/Origin, renderer sandbox/context
isolation, denied external navigation/popups/fetch, synthetic Statistics/sessions,
SQLite Recorder lifecycle, existing-history read fingerprints, empty/missing data,
duplicate launch, graceful/forced cleanup and architecture/runtime metadata. Mac
cases test red-close/Dock-event reopening and native app Quit. Windows skips those
cases rather than pretending to validate them. Mac screenshots capture real
rendered app content without the OS title bar; no Screen Recording permission is
required by that test capture method.

The separate LaunchServices test uses `/usr/bin/open` to launch the bundle with
no inspector, a system-only PATH, explicit disposable data and no interactive
shell initialization. It verifies the launched process's executable before sending
only that owned PID a graceful SIGTERM, checks child cleanup, and compares source/
DB fingerprints. It does not claim a physical Finder click, quarantined download
or genuinely Node-free clean-machine validation.

## Signing, notarization and the public Beta gate

Internal builds are configured for **ad-hoc signing only**, followed by strict
signature-integrity verification. This is not Developer ID author identity,
notarization or Gatekeeper approval. Those signing steps have not run in a Windows
session. The config reads no Apple account credentials or provisioning profiles.

Before a public macOS Beta:

1. Obtain actual native arm64 and x64 build/test evidence, including the embedded
   Node/SQLite/workers and complete archive resource checks.
2. Validate a real Finder/Dock flow, window/quit semantics, sleep/wake/logout,
   read-only existing history and no-global-Node operation on native Macs.
3. Configure a Developer ID Application certificate with narrowly scoped signing
   settings and keychain/CI secrets, then validate hardened runtime and helper
   entitlements. Keep renderer sandbox enabled; do not add broad filesystem IPC.
4. Submit the signed application for notarization using `notarytool` with an
   approved Apple identity, staple the ticket and verify the final app/DMG.
5. Test a quarantined downloaded artifact with Gatekeeper on a clean standard-user
   Mac. Never instruct users to disable Gatekeeper or remove quarantine protection.
6. Review the resulting checksums/artifacts and obtain explicit publication approval.

Reference documentation: [Electron macOS lifecycle](https://www.electronjs.org/docs/latest/api/app),
[Forge signing/notarization](https://www.electronforge.io/guides/code-signing/code-signing-macos),
[Forge API](https://js.electronforge.io/modules/_electron_forge_core.html),
[GitHub runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
