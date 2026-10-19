# Windows desktop preview

The separate `desktop/` target packages the existing Codex HUD GUI and backend in
Electron 44.9.0. Its embedded Node 24.22.0 meets the existing >=24.21.0 requirement.
The CLI package remains `1.3.0-beta.1`; the desktop preview is
`1.3.0-desktop.1`. This is an unsigned public Windows x64 preview, with no
installer, tray service, automatic updater, publisher or telemetry uploader.

## Run the portable application

Download the Windows x64 portable ZIP and `SHA256SUMS` from the
[v1.3.0-desktop.1 Pre-release](https://github.com/seanl6595-art/codex-hud/releases/tag/v1.3.0-desktop.1).
Extract the **entire** portable ZIP, open `Codex HUD-win32-x64`, and double-click
`CodexHUD.exe`. Keep its DLLs, resources and license files together. Users need
neither Node nor a shell. Closing the native window exits the app. Launching again
restores/focuses the existing window rather than starting another owned backend.

The executable is **unsigned**, so Windows SmartScreen may warn. Keep security
protections enabled. If Windows or an organization policy blocks the app, report
the problem or wait for a signed build; do not disable system protection. This
public preview has incomplete clean-VM validation without Node installed. The app
was tested without Node on its PATH and bundles its own verified runtime.
macOS is not included in this release.

The application does **not upload data to external servers**. Its API is local to
`127.0.0.1`. No API key or additional Codex quota is required.

Normal mode uses the existing `CODEX_HOME`/`~/.codex` sources and
`~/.codex-hud/telemetry.sqlite3`. Opening a missing DB never creates one; opening
an existing DB never migrates it. Recorder starts off. Start recording and Sync
once are explicit writes through the existing GUI Recorder worker. Stop and exit
affect only that worker, never an unrelated CLI Recorder. Provenance upgrades
remain explicit CLI operations. The existing CLI and browser GUI are unchanged.

The native window initially targets 1440 × 900 logical pixels, constrained to the
display work area. Normal bounds and maximized state persist in
`%APPDATA%\Codex HUD\window-state.json`; disconnected-monitor placement is
recovered on the next launch. Three enumerated interface preferences persist in
`preferences.json` despite changing loopback ports. Chromium's profile lives in a
separate `browser/` subdirectory. These files do not replace the telemetry DB.
Use a reasonably short profile path because Chromium's Windows storage internals
can exceed MAX_PATH beneath deeply nested test-directory names.

`desktop-status.json` contains bounded startup/shutdown timings, runtime versions,
generic failure codes and blocked-request counts. It excludes source names,
tokens, telemetry values, DB paths and source paths. It stays local.

Advanced launch arguments, normally unnecessary:

```text
CodexHUD.exe --codex-home PATH --db PATH --user-data PATH --port 0
```

`--user-data` selects a separate desktop profile and instance lock. `--port 0`
allocates a safe port automatically. Arguments on a repeated launch of the same
profile do not change the running app's data sources.

## Manual updates, troubleshooting and bug reports

There are no automatic updates. Close the old app, download a newer ZIP from the
[official releases](https://github.com/seanl6595-art/codex-hud/releases), extract
it into a new folder, and launch its `CodexHUD.exe`. Do not overwrite files while
the old application is running. Existing Codex data, Recorder history and desktop
preferences stay in their existing locations. `SHA256SUMS` allows optional
verification with a checksum tool; ordinary installation needs no shell commands.

If the interface cannot load, confirm that the full ZIP was extracted, retain all
adjacent resources, close the window and reopen. Missing history can mean there
are no local Codex sessions, `CODEX_HOME` selects a different home, or the optional
Recorder DB does not exist. Starting Recorder is an explicit choice. Do not delete
databases or run a provenance upgrade merely to dismiss an error. For a blocked
explicit port, launch normally to use automatic allocation. The app's Stop button
does not control an independently launched CLI Recorder.

Report bugs through [GitHub Issues](https://github.com/seanl6595-art/codex-hud/issues).
Include desktop/Windows versions, reproduction steps, expected and observed
behavior, and a redacted screenshot or generic error code if useful. Do not upload
credentials, actual telemetry databases or raw JSONL histories. Redact personal
paths and session names from screenshots and diagnostic attachments.

## Development and packaging

Use Windows x64 and Node >=24.21.0:

```powershell
npm ci
npm ci --prefix desktop
npm run build:desktop
```

The icon is a Windows export of the existing mint terminal mark. Its SVG source
and seven-resolution ICO are tracked. To regenerate the ICO on Windows:

```powershell
powershell.exe -NoProfile -File desktop/scripts/create-icon.ps1
```

`npm run desktop` launches the development shell against the existing built GUI.
For development tests, always specify disposable sources, DB and profile:

```powershell
npm --prefix desktop start -- --codex-home C:\Temp\hud-test\home --db C:\Temp\hud-test\history.sqlite3 --user-data C:\Temp\hud-test\profile
```

`desktop/out/latest.json` locates the most recent EXE, ZIP, SHA-256 and full file
manifest. Every build gets a new output directory; previous previews are not
overwritten. Packaging uses the maintained official `@electron/packager` 20.3.0
(also used by Forge) and Windows .NET ZIP creation. This deliberately small
pipeline is sufficient for one portable target; Forge makers can replace the ZIP
step when installers are approved. Electron is pinned in `desktop/package-lock.json`.
No separate Node executable is bundled.
Each build writes `SHA256SUMS` beside the ZIP. GitHub publication is a separate,
explicitly approved action; the build itself does not publish anything.

The stage is built from explicit sources: `desktop/src`, `desktop/ui`,
`desktop/assets`, existing `lib/`, existing `dist/gui/`, minimal package metadata,
the portable readme and licenses. It never copies the whole checkout. Packaged
app files are compared by SHA-256; archive filenames are checked for excluded
telemetry, credentials, logs, profiles, tests, dependencies and runtime sidecars.
The ZIP retains Electron's `LICENSE` and `LICENSES.chromium.html`, the original
upstream MIT attribution, `NOTICE.md`, and generated frontend dependency notices.
The development package is private and there is no publishing command.

## Lifecycle and security boundaries

Electron main owns one native BrowserWindow. A utility process invokes the
unchanged `lib/gui/server.js`; its four existing worker threads own reading,
Statistics, metadata and the opt-in Recorder. Runtime startup verifies the
existing Node guard and in-memory SQLite transactions. No telemetry DB is opened
by the runtime probe.

The server binds only `127.0.0.1`, retaining exact Host/Origin checks, random
per-launch API authentication and its existing CSP. Port selection uses the
existing direct-bind/retry implementation, avoiding probe-and-release races.

The renderer uses context isolation, sandboxing, web security and disabled Node
integration. A sandboxed preload exposes **no** JavaScript bridge. It restores
three allowed preferences and reports only initial-view readiness and those
enumerated settings on one validated IPC channel. Main checks the owned renderer,
main frame and exact backend origin. The isolated preload does not expose file,
process, Electron, token or unrestricted IPC capabilities to application scripts.

A custom secure scheme serves exactly four loading/error resources. HTTP is
allowed only for the owned numeric loopback origin; navigation is limited to its
root and the local shell. Permissions, downloads, webviews, remote requests,
external navigation and popups are denied. No application remote-debugging port is
configured; native test tools supply their own inspector flags. DevTools are
disabled in packaged windows. The loading overlay disappears after existing GUI
metrics/heatmap, onboarding or a useful data error have settled. The React GUI
requires no modification.

Close requests graceful server/Recorder/worker shutdown. Only the precise owned
utility handle can be terminated; there is no process-name kill. A 15-second
grace deadline handles stuck scans, with SQLite's existing transaction recovery
remaining authoritative. A missed-heartbeat watchdog counts timer opportunities
rather than wall-clock sleep duration, and long timer gaps reset the lease. Resume
uses the GUI's existing reconnect behavior to refresh reads without starting a
Recorder. Windows session-end handlers request the same owned shutdown without
blocking the operating system's logout/restart. Real OS sleep/logout still needs
native manual validation; synthetic event dispatch tests only the handlers.

## Verification

```powershell
npm test
npm run test:browser
npm run test:desktop
npm --prefix desktop run test:runtime
```

The runtime command runs the existing full Node/accounting/provenance suite under
the packaged Electron Node runtime. It is separate from actual utility-process
GUI testing. Existing independent adversarial expectations in repository tests
remain in that suite; external suites cited by older review reports are not
silently treated as rerun evidence.

Extract the produced ZIP **outside the checkout**, set its absolute EXE path and
run the maintained native suite:

```powershell
$env:CODEX_HUD_DESKTOP_EXECUTABLE = 'C:\Temp\hud-preview\Codex HUD-win32-x64\CodexHUD.exe'
$env:CODEX_HUD_DESKTOP_TEST_ROOT = 'C:\Temp\hud-desktop-evidence'
npm run test:desktop:native
```

The test harness refuses an executable inside the checkout. It supplies all three
disposable data/profile paths, removes Node from the app's PATH, captures actual
native windows, checks API/renderer restrictions, proves read-only source/DB
fingerprints, tests an unrelated disposable CLI Recorder, restarts and forced
termination, and verifies exact independently calculated totals over 48,000
synthetic events. A 90-second append run plus idle sampling measures sustained
Recorder behavior. Set `CODEX_HUD_DESKTOP_SOAK_SECONDS` (10–7200) for a longer
run. That is not an overnight soak. Profile paths are kept short
and deleted only after their owning app has exited.

True clean-VM-without-Node, reboot-cold startup, actual OS sleep/logout, long-term
soak, signing/SmartScreen, installer/uninstaller, Windows ARM64 and native macOS
validation remain limitations of this public preview and gates for a stable
release. Do not suspend or log out the user's
machine as part of automated testing. The manual GitHub Actions workflow performs
Windows validation only and has no release or publishing steps.

For ordinary launches without any debugger, set the extracted EXE path above and
run `npm --prefix desktop run measure`. This uses disposable synthetic history and
reports time to window visibility, time to dashboard readiness, idle/private
memory, idle CPU, backend shutdown and remaining owned PIDs over fresh and warm
profiles. Set `CODEX_HUD_DESKTOP_MEASURE_ROOT` to an evidence directory. A controller
uses Node, but the application receives a PATH containing only Windows system
tools. No separately installed Node is launched by the desktop application.

## Future distribution

For a future installer, evaluate Forge Squirrel.Windows for a per-user install,
or Builder NSIS if its installer requirements are preferred. Code signing is
deferred and this public preview explicitly discloses its unsigned status. Sign
future production executables and installers; keep updates manual until a separately approved
signed update strategy is implemented. Preserve backend drain and rollback tests.
macOS requires native Apple Silicon/Intel builds and tests, Developer ID signing,
notarization and `.app`/`.dmg` validation. No macOS support claim follows from this
Windows preview.
