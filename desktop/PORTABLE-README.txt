Codex HUD — Windows Desktop Preview 1.3.0-desktop.1

1. Right-click the ZIP and choose Extract All.
2. Open the extracted Codex HUD-win32-x64 folder.
3. Double-click CodexHUD.exe. Keep all the files together.

No Node installation, PowerShell command or separate browser is required.
This is an unsigned public preview. Windows SmartScreen may warn about the EXE.
Keep system security protections enabled; this release does not require disabling
them. If Windows or your organization's policy blocks execution, report the issue
or wait for a signed build. No installer,
tray service, automatic updater or telemetry uploads are included.
The application does not upload your data to external servers. Its local API is
bound only to 127.0.0.1. Clean-VM validation without Node installed is incomplete.

Normal launches read your existing Codex home (CODEX_HOME or %USERPROFILE%\.codex)
and existing %USERPROFILE%\.codex-hud\telemetry.sqlite3. Opening the app does not
create or upgrade that telemetry database. Recorder is off at every launch.
Start recording or Sync once is an explicit request to write the existing DB.
Stop recording controls only this app's Recorder, never an external CLI Recorder.
Closing the window exits the app and stops its local backend/Recorder.

Window placement and three interface preferences are saved separately under
%APPDATA%\Codex HUD. A small desktop-status.json records startup/shutdown timing,
runtime versions and generic failure codes, without telemetry values or paths.
The existing browser/CLI commands remain available through the separate CLI
package. This ZIP is the desktop application and does not install CLI commands.

If startup fails, check that the complete ZIP was extracted and close/reopen.
The native window displays a localized error. An occupied explicit port can be
avoided by launching normally, which allocates a safe loopback port automatically.
If history is missing, confirm that Codex has local sessions and that CODEX_HOME
points to the intended home. Recorder remains opt-in; do not delete your history
or upgrade provenance as a troubleshooting shortcut. An external CLI Recorder is
independent of this application's controls.

Updates are manual: close the old app, download the newer ZIP from the official
GitHub release page, extract it to a new folder, and double-click its EXE. Keep the
existing Codex and telemetry data locations; no history copy into the app folder
is needed. SHA256SUMS accompanies the ZIP for optional integrity verification.

Downloads: https://github.com/seanl6595-art/codex-hud/releases
Bug reports: https://github.com/seanl6595-art/codex-hud/issues
Include the desktop version, Windows version, reproduction steps and expected vs
observed behavior. Redact personal paths, session names and telemetry in images.
Do not attach credentials, actual databases or raw Codex session JSONL histories.

Advanced launch arguments: --codex-home PATH --db PATH --user-data PATH --port N.
Use --port 0 for automatic allocation. These options are useful for disposable
test data and separate profiles; ordinary users can simply double-click the EXE.

License notices: resources/app/LICENSE, resources/app/NOTICE.md,
resources/app/core/dist/gui/THIRD-PARTY-NOTICES.md, LICENSE and
LICENSES.chromium.html. Preserve these when copying the application.

Windows x64 preview only. Code signing, installer, auto-updates, Windows ARM64 and
native macOS validation are deferred. macOS is not included in this release.
Do not treat this public preview as a stable production release.

简体中文
1. 右键单击 ZIP，选择“全部解压缩”。
2. 打开解压后的 Codex HUD-win32-x64 文件夹。
3. 双击 CodexHUD.exe。请保持全部文件位于同一文件夹。

无需安装 Node，无需输入 PowerShell 命令，也不会打开单独的浏览器。
默认读取现有 Codex 数据和 telemetry.sqlite3。仅打开应用不会创建或升级遥测数据库。
每次启动时记录器均为关闭状态。只有主动选择“开始记录”或“同步一次”后才会写入。
关闭窗口将退出应用并停止此应用负责的本地服务，不会停止单独运行的 CLI 记录器。
此版本为公开预览，尚未签名。Windows SmartScreen 可能提示警告，请保持系统安全防护开启。
如果系统或组织策略阻止运行，请报告问题或等待已签名版本，不要关闭安全防护。
应用不会向外部服务器上传数据。无需另装 Node 的全新虚拟机验证尚未完成。
此版本仅支持 Windows x64，不包含 macOS、安装器或自动更新。
更新时请先退出旧版，将新版 ZIP 全部解压到新文件夹后双击 EXE；保留现有数据位置。
问题反馈请使用上述 GitHub Issues 链接，并删除截图中的个人信息；不要上传真实数据库或会话日志。
