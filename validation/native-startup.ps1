param([string]$Executable,[string]$Label,[switch]$Fresh)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class StartupNative {
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 public struct POINT { public int X; public int Y; }
}
'@
$out=Join-Path $PWD "output/startup/$Label"
New-Item -ItemType Directory -Force $out | Out-Null
$state=Join-Path $env:APPDATA 'Akashic Alpha'
$log=Join-Path $state 'logs/startup.jsonl'
$shortcut=Join-Path $env:TEMP "Akashic startup $Label.lnk"
$ws=New-Object -ComObject WScript.Shell
$link=$ws.CreateShortcut($shortcut);$link.TargetPath=$Executable;$link.WorkingDirectory=Split-Path $Executable;$link.Save()
function Shot([string]$name) {
 $bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
 $b=New-Object System.Drawing.Bitmap $bounds.Width,$bounds.Height
 $g=[System.Drawing.Graphics]::FromImage($b)
 try {$g.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$b.Size);$b.Save((Join-Path $out "$name.png"))} finally {$g.Dispose();$b.Dispose()}
}
Shot 'before-launch'
$utc=[DateTimeOffset]::UtcNow
$watch=[Diagnostics.Stopwatch]::StartNew()
$start=New-Object Diagnostics.ProcessStartInfo
$start.FileName=$shortcut;$start.UseShellExecute=$true
$proc=[Diagnostics.Process]::Start($start)
$receipt=[ordered]@{label=$Label;freshInstallFirstLaunch=[bool]$Fresh;launchMethod='Windows ShellExecute of .lnk; no debugger or remote debugging flags';launchRequestedAt=$utc.ToString('o');launchCallReturnedMs=$watch.Elapsed.TotalMilliseconds;pid=$null;processStartedAt=$null;nativeWindowVisibleMs=$null;milestones=@{};result='running'}
function Save {$receipt | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $out 'receipt.json')}
Save
$known=@{};$target=$null;$ready=$false
while ($watch.Elapsed.TotalSeconds -lt 240) {
 if (Test-Path $log) {
  foreach($line in Get-Content $log -ErrorAction SilentlyContinue) {
   try {$row=$line|ConvertFrom-Json} catch {continue}
   # ConvertFrom-Json may coerce ISO dates to DateTime and string conversion loses milliseconds.
   $rawAt=[regex]::Match($line,'"at":"([^"]+)"').Groups[1].Value
   $stamp=[DateTimeOffset]::Parse($rawAt,[Globalization.CultureInfo]::InvariantCulture)
   if ($stamp -lt $utc) {continue}
   if (!$target) {$target=Get-Process -Id $row.pid -ErrorAction Stop;$receipt.pid=$row.pid;$receipt.processStartedAt=$target.StartTime.ToUniversalTime().ToString('o')}
   if ($row.pid -ne $target.Id -or $known.ContainsKey($row.stage)) {continue}
   $known[$row.stage]=$true
   $receipt.milestones[$row.stage]=[ordered]@{fromLaunchRequestMs=($stamp-$utc).TotalMilliseconds;launcherElapsedMs=$row.elapsedMs;at=$rawAt}
  }
 }
 if($target){
  $target.Refresh()
  if($target.HasExited){throw 'App exited before startup completed'}
  if(!$receipt.nativeWindowVisibleMs -and $target.MainWindowHandle -ne [IntPtr]::Zero -and [StartupNative]::IsWindowVisible($target.MainWindowHandle)) {
   $receipt.nativeWindowVisibleMs=$watch.Elapsed.TotalMilliseconds
   [StartupNative]::SetForegroundWindow($target.MainWindowHandle)|Out-Null
   Shot 'window-visible'
  }
 }
 if($Fresh){$ready=$known.ContainsKey('backend.ready') -and $known.ContainsKey('renderer.ready')}
 else {$ready=$known.ContainsKey('backend.ready') -and $known.ContainsKey('renderer.ready') -and $known.ContainsKey('splash.complete')}
 Save
 if($ready){break}
 Start-Sleep -Milliseconds 100
}
if(!$ready){throw 'Startup did not complete within 240 seconds'}
$receipt.startupConditionObservedMs=$watch.Elapsed.TotalMilliseconds
if($Fresh){Start-Sleep -Seconds 2;Shot 'onboarding-visible';$receipt.onboardingScreenshotMs=$watch.Elapsed.TotalMilliseconds}
else {
 Shot 'chat-revealed';$receipt.chatScreenshotMs=$watch.Elapsed.TotalMilliseconds
 $point=Get-Content output/startup/composer-point.json|ConvertFrom-Json
 $target.Refresh();[StartupNative]::SetForegroundWindow($target.MainWindowHandle)|Out-Null
 $p=New-Object StartupNative+POINT;$p.X=[int]$point.x;$p.Y=[int]$point.y
 [StartupNative]::ClientToScreen($target.MainWindowHandle,[ref]$p)|Out-Null
 [StartupNative]::SetCursorPos($p.X,$p.Y)|Out-Null
 [StartupNative]::mouse_event(2,0,0,0,[UIntPtr]::Zero);[StartupNative]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 [System.Windows.Forms.SendKeys]::SendWait('Startup interaction check')
 Start-Sleep -Milliseconds 400;Shot 'typed-draft'
 $receipt.nativeTypingAttempted=$true
 [System.Windows.Forms.SendKeys]::SendWait('^a{BACKSPACE}')
}
$receipt.result='measured';Save
Copy-Item $log (Join-Path $out 'startup.jsonl')
$target.Refresh();if(!$target.CloseMainWindow()){throw 'Normal window close was rejected'}
if(!$target.WaitForExit(90000)){throw 'App did not exit normally within 90 seconds'}
$receipt.normalExit=$true;$receipt.exitCode=$target.ExitCode;Save
Write-Output ($receipt|ConvertTo-Json -Depth 8 -Compress)
