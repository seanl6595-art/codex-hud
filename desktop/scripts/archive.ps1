param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationPath) { throw 'Archive already exists; refusing to replace it.' }
[System.IO.Compression.ZipFile]::CreateFromDirectory($sourcePath, $destinationPath, [System.IO.Compression.CompressionLevel]::Optimal, $true)
$zip = [System.IO.Compression.ZipFile]::OpenRead($destinationPath)
try { @($zip.Entries | ForEach-Object { [pscustomobject]@{ name=$_.FullName; size=$_.Length } }) | ConvertTo-Json -Depth 3 }
finally { $zip.Dispose() }
