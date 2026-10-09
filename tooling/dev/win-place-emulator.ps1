# Moves the Android emulator window fully on screen (top-left, phone sized). The emulator
# remembers its last position in emulator-user.ini and on scaled laptop displays that can
# land it above the visible area. Called by tooling/dev/demo-android.mjs on Windows.
param([int]$X = 30, [int]$Y = 10, [int]$Width = 400, [int]$Height = 790)
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class VamarWin {
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
 public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
}
"@
$moved = $false
[VamarWin]::EnumWindows({ param($h, $l)
  if ([VamarWin]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][VamarWin]::GetWindowText($h, $sb, 256)
    if ($sb.ToString() -like 'Android Emulator*') {
      [void][VamarWin]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, $Width, $Height, 0x0040)
      $script:moved = $true
    }
  }
  $true }, [IntPtr]::Zero) | Out-Null
if ($moved) { "emulator window placed at $X,$Y ($Width x $Height)" } else { "emulator window not found" }
