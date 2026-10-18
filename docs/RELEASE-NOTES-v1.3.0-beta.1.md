# Codex HUD v1.3.0-beta.1 — Public Beta

Controlled public beta for testing and feedback, with no guarantee of complete stability. This is a GitHub **Pre-release**. v1.2.0 remains the stable release; the beta is not merged into main and is not published to npm.

## Highlights

- Local GUI with Dashboard, interactive Statistics, session exploration and opt-in Recorder controls.
- English/Simplified Chinese, activity heatmaps, expanded charts, custom ranges and model/effort drill-down.
- Conservative verified accounting, read-only diagnostics and memory-only evidence reuse with explicit source rechecks.
- Built frontend included in the archive; no runtime dependencies beyond supported Node.js.

## Install the beta

Requires **Node.js 24.21.0 or newer**. Download **codex-hud-1.3.0-beta.1.tgz** and **SHA256SUMS** from this release, verify SHA-256, then install the archive. Full Windows PowerShell and macOS Terminal commands, including verified downloads and exact beta-tag source installation, are in [beta testing instructions](https://github.com/seanl6595-art/codex-hud/blob/v1.3.0-beta.1/docs/BETA-TESTING.md).

Windows PowerShell, after checksum verification:

```powershell
npm.cmd install --prefix './hud-beta' --omit=dev ./codex-hud-1.3.0-beta.1.tgz
& './hud-beta/node_modules/.bin/codex-hud.cmd' gui --no-open
```

macOS Terminal, after checksum verification (native validation pending):

```sh
npm install --prefix ./hud-beta --omit=dev ./codex-hud-1.3.0-beta.1.tgz
./hud-beta/node_modules/.bin/codex-hud gui --no-open
```

Open the printed loopback URL. Do not clone stable main expecting the GUI; select tag **v1.3.0-beta.1** explicitly.

## Safety and known limitations

- Windows is the primarily tested platform. Native macOS validation has not yet been completed; Linux, Safari, Firefox and physical mobile are also unverified.
- Cold startup may take several seconds; large histories can take longer to verify.
- An earlier intermittent source-rewrite test failure remains unexplained but was not reproduced in **3,500 targeted cycles**. This is an accepted, documented beta risk, not a claim that its cause is known.
- GUI/Stats do not automatically start Recorder or create a database. Existing databases are not automatically migrated. **Provenance upgrade is optional and must never happen automatically**; it requires an explicit command and should follow a separate backup.
- Unknown history and ambiguous attribution remain incomplete. Tokens describe local observed workload, not official billing, quota, cost or model effectiveness. Prior-period comparison and density controls are deferred.

## Feedback

Report problems through [GitHub Issues](https://github.com/seanl6595-art/codex-hud/issues/new). Include OS and architecture, Node version, reproduction steps, expected versus actual behavior, and redacted diagnostic output. **Never publicly upload raw Codex JSONL, private conversations, credentials or telemetry databases.**

See [beta validation and historical evidence](https://github.com/seanl6595-art/codex-hud/blob/v1.3.0-beta.1/docs/RELEASE-CANDIDATE.md), [CHANGELOG](https://github.com/seanl6595-art/codex-hud/blob/v1.3.0-beta.1/CHANGELOG.md) and bundled LICENSE/NOTICE.md for upstream attribution and third-party licensing.
