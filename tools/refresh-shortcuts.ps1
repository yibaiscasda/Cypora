param([Parameter(Mandatory=$true)][string]$Install)
$ErrorActionPreference = 'Stop'
$taskExe = Join-Path $Install 'Cypora.exe'
$taskIcon = Join-Path $Install 'resources\app\assets\cypora.ico'
if (!(Test-Path -LiteralPath $taskExe) -or !(Test-Path -LiteralPath $taskIcon)) { throw 'Cypora installation is incomplete' }
$taskShell = New-Object -ComObject WScript.Shell
$taskLinks = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Cypora.lnk'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\Cypora.lnk')
)
$taskPinned = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
if (Test-Path -LiteralPath $taskPinned) {
  # Only update existing pins that actually launch this installation.
  foreach ($taskFile in Get-ChildItem -LiteralPath $taskPinned -Filter '*.lnk') {
    $taskExisting = $taskShell.CreateShortcut($taskFile.FullName)
    if ($taskExisting.TargetPath -ieq $taskExe) { $taskLinks += $taskFile.FullName }
  }
}
foreach ($taskLink in $taskLinks | Select-Object -Unique) {
  $taskShortcut = $taskShell.CreateShortcut($taskLink)
  $taskShortcut.TargetPath = $taskExe
  $taskShortcut.WorkingDirectory = $Install
  $taskShortcut.IconLocation = "$taskExe,0"
  $taskShortcut.Description = 'Cypora'
  $taskShortcut.Save()
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CyporaShellRefresh {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  public static extern void SHChangeNotify(uint change, uint flags, string item1, IntPtr item2);
}
'@
foreach ($taskLink in $taskLinks) { [CyporaShellRefresh]::SHChangeNotify(0x2000,0x1005,$taskLink,[IntPtr]::Zero) }
[CyporaShellRefresh]::SHChangeNotify(0x8000000,0,[NullString]::Value,[IntPtr]::Zero)
Write-Output "Refreshed Cypora shortcuts and shell icons"
