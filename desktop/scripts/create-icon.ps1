param([string]$Output = (Join-Path $PSScriptRoot '..\assets\codex-hud.ico'))
# Windows export of assets/icon.svg: the existing mint terminal brand mark.
Add-Type -AssemblyName System.Drawing
$frames = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform(($size / 32.0), ($size / 32.0))
  $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
  $shape.AddArc(1, 1, 16, 16, 180, 90)
  $shape.AddArc(15, 1, 16, 16, 270, 90)
  $shape.AddArc(15, 15, 16, 16, 0, 90)
  $shape.AddArc(1, 15, 16, 16, 90, 90)
  $shape.CloseFigure()
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#68e4b0'))
  $graphics.FillPath($brush, $shape)
  $pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#103d32'), 2)
  $pen.StartCap = $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLines($pen, [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(8,10), [System.Drawing.PointF]::new(13,15), [System.Drawing.PointF]::new(8,20)))
  $graphics.DrawLine($pen, 17, 21, 24, 21)
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $frames += [pscustomobject]@{ Size = $size; Bytes = $stream.ToArray() }
  $stream.Dispose(); $pen.Dispose(); $brush.Dispose(); $shape.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$file = [System.IO.File]::Create([System.IO.Path]::GetFullPath($Output))
$writer = New-Object System.IO.BinaryWriter($file)
try {
  $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
  $offset = 6 + 16 * $frames.Count
  foreach ($frame in $frames) {
    $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
    $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
    $offset += $frame.Bytes.Length
  }
  foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
} finally { $writer.Dispose(); $file.Dispose() }
