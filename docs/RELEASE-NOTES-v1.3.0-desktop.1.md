# Codex HUD v1.3.0-desktop.1 — Windows Desktop Preview

This public **GitHub Pre-release** brings the existing Codex HUD interface into a
dedicated Windows desktop window. It is an unsigned Windows x64 portable preview,
not a stable release. Existing v1.2.0 and v1.3.0-beta.1 releases remain unchanged.

## Download and open

1. Download `codex-hud-desktop-1.3.0-desktop.1-win-x64.zip` from this release.
2. Right-click the ZIP and choose **Extract All**.
3. Open the extracted `Codex HUD-win32-x64` folder.
4. Double-click **CodexHUD.exe** and use the existing Codex HUD interface.

Keep the whole application folder together. No separate Node installation,
PowerShell command, installer or browser window is required. `SHA256SUMS` is
attached for optional checksum verification with your preferred tool.

**Unsigned application:** Windows SmartScreen may warn about this preview. Keep
system security protections enabled. If Windows or your organization's policy
blocks the app, report the issue or wait for a signed build. Do not disable
security protections to run it.

## Behavior and privacy

- Native operating-system title bar and application icon; minimize, maximize,
  restore and close work normally. Closing exits and stops the owned backend.
- Repeated launch restores/focuses the existing window and reuses its backend.
- Saved window placement, dark theme and English/Simplified Chinese interface.
- Dashboard, Statistics, Sessions and opt-in Recorder reuse the existing backend
  and verified accounting/provenance behavior. CLI/browser usage remains available
  through the separate CLI package.
- Recorder is **off at every launch**. Opening the app does not create or migrate
  telemetry history. Start recording and Sync once are explicit writes. Stop and
  app exit affect only this app's Recorder, never an unrelated CLI Recorder.
- Sources remain at `CODEX_HOME` or `%USERPROFILE%\.codex`; the existing database
  remains `%USERPROFILE%\.codex-hud\telemetry.sqlite3`. Desktop window/settings
  files are separate under `%APPDATA%\Codex HUD`.
- **No data is uploaded to external servers.** The authenticated local API binds
  only to `127.0.0.1`. Renderer sandbox and context isolation stay enabled; Node
  integration is disabled. No API key or additional Codex quota is required.

## Manual updates and troubleshooting

There are no automatic updates. Close the old app, download a newer ZIP from the
[official releases](https://github.com/seanl6595-art/codex-hud/releases), extract it
into a new folder, and double-click its EXE. Keep existing data in its current
locations; do not copy telemetry into the application folder.

If startup fails, confirm that all ZIP contents were extracted, keep adjacent
resources, close and reopen. For missing history, check local Codex session data
and `CODEX_HOME`. Recorder remains optional. Do not delete your database or run a
provenance upgrade as an error-dismissal shortcut. Normal launches choose an
available safe loopback port automatically.

Report problems through [GitHub Issues](https://github.com/seanl6595-art/codex-hud/issues)
with desktop/Windows versions, steps, and expected versus observed behavior.
Redact personal paths, session names and telemetry from screenshots. Do not upload
credentials, actual databases or raw session JSONL files.

## Validation and limitations

The accepted MVP passed the existing Node/accounting/provenance suite (363 tests),
the same suite under Electron's Node runtime (363), the desktop/mobile browser
suite (66), desktop unit tests (7) and native Windows scenarios (11), including
48,000 synthetic historical events and a five-minute Recorder run. The final
release candidate is rebuilt and checked against its source and checksum before
publication. All write tests use disposable data; production history is untouched.

- Electron 44.9.0 embeds Node 24.22.0 and built-in SQLite. The app runs without
  global Node lookup; **clean-VM validation without Node installed is incomplete**.
- Windows x64 only. **macOS is not included**; Windows ARM64 is not validated.
- Code signing, an installer and automatic updates are deferred.
- Real OS sleep/logout/restart and overnight soak validation remain incomplete;
  handler simulations and finite sustained runs are not equivalent.
- Memory use can be substantial: approximately 530–564 MiB idle in the accepted
  ordinary-launch samples, and about 944 MiB after the 48,000-event workload.
- Keep custom desktop profile paths reasonably short; deeply nested paths caused
  Chromium storage issues in the test environment.

The original MIT license and upstream attribution are preserved, along with
Electron/Chromium and bundled frontend license notices. No private telemetry,
credentials, test databases, debug logs or Node sidecar are distributed.
