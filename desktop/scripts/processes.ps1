param([Parameter(Mandatory=$true)][string]$Executable, [long]$ClosePid = 0)
if ($ClosePid) { (Get-Process -Id $ClosePid -ErrorAction Stop).CloseMainWindow() | Out-Null; return }
$resolved = [System.IO.Path]::GetFullPath($Executable)
$processes = @(Get-CimInstance Win32_Process -Filter "name = 'CodexHUD.exe'" | Where-Object { $_.ExecutablePath -eq $resolved } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Select-Object Id, MainWindowHandle, WorkingSet64, PrivateMemorySize64, CPU)
ConvertTo-Json -InputObject $processes -Depth 3 -Compress
