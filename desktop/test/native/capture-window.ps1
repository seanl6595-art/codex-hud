param([long]$WindowHandle, [string]$OutputPath)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public class HudWindowCapture {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
}
'@
$rect = New-Object HudWindowCapture+RECT
[HudWindowCapture]::GetWindowRect([IntPtr]$WindowHandle, [ref]$rect) | Out-Null
$bitmap = New-Object System.Drawing.Bitmap(($rect.Right-$rect.Left), ($rect.Bottom-$rect.Top))
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$dc = $graphics.GetHdc()
try { $ok = [HudWindowCapture]::PrintWindow([IntPtr]$WindowHandle, $dc, 2) } finally { $graphics.ReleaseHdc($dc) }
if (-not $ok) { throw 'Native window capture failed' }
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()
