# Testing Codex HUD v1.3.0-beta.1

This GitHub Pre-release is for testing and feedback, with no guarantee of complete stability. Node.js **24.21.0 or newer** is required. Windows is the primarily tested platform. Native macOS validation has not yet been completed. Cold startup may take several seconds.

The stable main branch does not provide this beta GUI. Select the beta archive or the exact beta tag below. No npm registry installation is offered.

## Windows PowerShell: release archive

Run in a new folder with Node.js already on PATH. These commands install the beta into an isolated local folder, avoiding changes to a global installation.

```powershell
node --version
$releaseBase = 'https://github.com/seanl6595-art/codex-hud/releases/download/v1.3.0-beta.1'
Invoke-WebRequest "$releaseBase/codex-hud-1.3.0-beta.1.tgz" -OutFile './codex-hud-1.3.0-beta.1.tgz'
Invoke-WebRequest "$releaseBase/SHA256SUMS" -OutFile './SHA256SUMS'
$expectedHash = ((Get-Content './SHA256SUMS').Trim() -split '\s+')[0]
$actualHash = (Get-FileHash './codex-hud-1.3.0-beta.1.tgz' -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) { throw 'Beta archive checksum mismatch' }
npm.cmd install --prefix './hud-beta' --omit=dev ./codex-hud-1.3.0-beta.1.tgz
& './hud-beta/node_modules/.bin/codex-hud.cmd' gui --no-open
```

## macOS Terminal: release archive

Native macOS testing is pending. Install Node.js 24.21.0 or newer for your architecture, then run in a new folder:

```sh
node --version
release_base='https://github.com/seanl6595-art/codex-hud/releases/download/v1.3.0-beta.1'
curl --fail --location "$release_base/codex-hud-1.3.0-beta.1.tgz" --output codex-hud-1.3.0-beta.1.tgz
curl --fail --location "$release_base/SHA256SUMS" --output SHA256SUMS
shasum --algorithm 256 --check SHA256SUMS && \
  npm install --prefix ./hud-beta --omit=dev ./codex-hud-1.3.0-beta.1.tgz && \
  ./hud-beta/node_modules/.bin/codex-hud gui --no-open
```

Open the printed loopback URL manually. The default is http://127.0.0.1:4317. Use `--port 0` to choose another browser-safe port. Stop the local server with Ctrl+C. The Windows .cmd shim does not require changing execution policy.

## Source alternative: exact beta tag

Windows PowerShell:

```powershell
git clone --branch v1.3.0-beta.1 --depth 1 https://github.com/seanl6595-art/codex-hud.git codex-hud-beta
Set-Location ./codex-hud-beta
npm.cmd ci
npm.cmd run build:gui
node ./bin/codex-hud.js gui --no-open
```

macOS Terminal:

```sh
git clone --branch v1.3.0-beta.1 --depth 1 https://github.com/seanl6595-art/codex-hud.git codex-hud-beta
cd codex-hud-beta
npm ci && npm run build:gui && node ./bin/codex-hud.js gui --no-open
```

## Data and known limitations

- Opening GUI/Stats does not start Recorder or create a database. Recorder is opt-in. Use `--codex-home PATH` and `--db PATH` to select a disposable test history/database when desired.
- Existing Recorder databases remain supported. Provenance upgrade is optional, requires an explicit `upgrade-provenance` command, and must never happen automatically. Make a separate backup before any intentional future upgrade. Installing this beta does not require an upgrade.
- An earlier intermittent source-rewrite test failure remains unexplained but was not reproduced in 3,500 targeted cycles. This is a documented, accepted beta risk.
- Large histories may make cold verification and session cataloguing slow. Unknown/missing/ambiguous accounting remains incomplete. Tokens are local observed workload, not billing, quota, costs or model effectiveness.
- Native macOS, Linux, Safari, Firefox and physical mobile validation are pending. Mobile Chrome checks use emulation. Prior-period comparison and density controls are deferred.

## Report bugs safely

Open a [GitHub Issue](https://github.com/seanl6595-art/codex-hud/issues/new) and include:

- Beta version (1.3.0-beta.1), OS and architecture.
- Node version from `node --version`.
- Reproduction steps, ideally using a minimal synthetic example.
- Expected versus actual behavior.
- Redacted diagnostic output, with personal paths, names, identifiers and conversation content removed.

Never upload raw Codex JSONL files, private conversations, credentials or telemetry databases publicly. Screenshots can also contain private session names and paths; redact them before sharing.
