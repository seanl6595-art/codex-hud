Codex HUD — macOS internal desktop preview

This is an internal, unvalidated macOS port based on Windows Desktop 1.3.0-desktop.1.
It is not a public macOS release. Build separately on native Apple Silicon (arm64)
and Intel (x64) Macs; running one architecture does not validate the other.

An approved, signed distribution should open from Finder without Node or a shell:
open the DMG, drag Codex HUD.app to Applications, and open it there. Alternatively,
extract the complete ZIP and move Codex HUD.app to Applications. Keep the bundle
intact. The internal build may use an ad-hoc signature for local native testing;
this is not Developer ID signing, notarization or Gatekeeper approval. Do not
disable Gatekeeper or remove quarantine protections to run a downloaded preview.
If macOS blocks it, wait for a signed/notarized reviewed build.

The red close button closes the window and stops its backend and GUI-owned
Recorder; the Dock application remains available. Click its Dock icon to reopen
a fresh window with Recorder OFF. Codex HUD > Quit / Command-Q exits the app and
drains its backend. Repeated launches reuse the existing instance.

Default sources: ~/.codex (or CODEX_HOME when present in the launch environment).
Existing telemetry database: ~/.codex-hud/telemetry.sqlite3.
Desktop settings/profile: ~/Library/Application Support/Codex HUD.
Finder does not inherit interactive .zshrc/.zprofile variables. The app does not
execute shell startup files or search PATH for Node. Standard home locations work
without terminal setup. Advanced --codex-home, --db and --user-data options remain
available for development/custom launchers; no new telemetry migration is added.

Opening the app does not create or migrate telemetry history. Recorder is off on
startup/reopen. Start recording or Sync once are explicit writes using the existing
Recorder. Closing/quitting never stops a separately launched CLI Recorder.
All development writes must use disposable synthetic data.

The API stays on authenticated 127.0.0.1 loopback with Host/Origin protections.
Renderer sandbox/context isolation remain enabled and Node integration disabled.
There is no unrestricted filesystem bridge, remote navigation or telemetry upload.
No updater, Node sidecar or additional telemetry implementation is included.

Developer ID Application signing, notarization/stapling, real Finder quarantine
launch, native runtime/SQLite/workers on both architectures, sleep/wake/logout and
Windows regression checks are required before a public macOS Beta. Do not treat
Windows results, a generated DMG or CI handler simulations as those native passes.

Original MIT attribution and Electron/Chromium/frontend notices are retained in
Contents/Resources and Contents/Resources/app. Report issues with redacted details;
never upload real databases, credentials or raw session histories.
