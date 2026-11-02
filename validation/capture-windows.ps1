param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $condition = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty),([System.Windows.Automation.ControlType]::Window)
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
  $captions = @()
  foreach ($window in $windows) {
    $texts = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $captions += @{ title=$window.Current.Name; controls=@($texts | Select-Object -First 80 | ForEach-Object { $_.Current.Name }) }
  }
  $captions | ConvertTo-Json -Depth 4 | Out-File (Join-Path $OutputDirectory 'windows-startup.json') -Encoding utf8
} catch { $_.Exception.Message | Out-File (Join-Path $OutputDirectory 'windows-startup-error.log') }
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width,$bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bitmap.Size)
  $bitmap.Save((Join-Path $OutputDirectory 'windows-startup.png'))
  $graphics.Dispose()
  $bitmap.Dispose()
} catch { $_.Exception.Message | Out-File (Join-Path $OutputDirectory 'windows-startup-image-error.log') }

try {
  Get-Process | Where-Object { $_.ProcessName -match 'Akashic|python|nsis|update' } | Select-Object Id,ProcessName,Path,MainWindowTitle | ConvertTo-Json | Out-File -Encoding utf8 (Join-Path $OutputDirectory 'windows-processes.json')
} catch { $_.Exception.Message | Out-File (Join-Path $OutputDirectory 'windows-processes-error.log') }
