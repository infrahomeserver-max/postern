<#
.SYNOPSIS  Postern installer for Windows 10 / 11 (x64). Per-user, no administrator rights, own Node.js runtime.
.EXAMPLE
  .\install.ps1            # install / upgrade into %LOCALAPPDATA%\Programs\Postern
  .\install.ps1 -DryRun    # show the plan, change nothing
  .\install.ps1 -NoPath    # do not add Postern to the user PATH
#>
[CmdletBinding()] param([string]$Prefix, [switch]$NoPath, [switch]$NoShortcut, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not ((Test-Path "$Here\runtime\node.exe") -and (Test-Path "$Here\app\desktop\launch.mjs"))) { throw 'Run this from the extracted Postern folder.' }
$Version = (Get-Content "$Here\app\VERSION" -Raw).Trim()
$Dest = if ($Prefix) { $Prefix } else { Join-Path $env:LOCALAPPDATA 'Programs\Postern' }
function Do($msg, [scriptblock]$a) { if ($DryRun) { Write-Host "    $msg" -ForegroundColor DarkGray } else { & $a } }
Write-Host "==> Installing Postern $Version into $Dest" -ForegroundColor Cyan
Do "replace app and runtime in $Dest" {
  New-Item -ItemType Directory -Force $Dest | Out-Null
  foreach ($d in 'app','runtime') { if (Test-Path "$Dest\$d") { Remove-Item -Recurse -Force "$Dest\$d" } }
  Copy-Item -Recurse "$Here\app" "$Dest\app"; Copy-Item -Recurse "$Here\runtime" "$Dest\runtime"
  Copy-Item "$Here\postern.ico", "$Here\uninstall.ps1" $Dest -Force
  # hidden launcher: no console window
  Set-Content "$Dest\postern.vbs" ('CreateObject("WScript.Shell").Run """" & Replace(WScript.ScriptFullName, "postern.vbs", "runtime\node.exe") & """ """ & Replace(WScript.ScriptFullName, "postern.vbs", "app\desktop\launch.mjs") & """", 0, False') -Encoding ASCII
  Set-Content "$Dest\postern.cmd" "@echo off`r`n`"%~dp0runtime\node.exe`" `"%~dp0app\desktop\launch.mjs`" %*" -Encoding ASCII
}
if (-not $NoShortcut) { Do 'Start-menu shortcut "Postern"' {
  $lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Postern.lnk'
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
  $s.TargetPath = "$env:WINDIR\System32\wscript.exe"; $s.Arguments = "`"$Dest\postern.vbs`""; $s.IconLocation = "$Dest\postern.ico"; $s.WorkingDirectory = $Dest
  $s.Description = 'API, SOAP and SFTP workspace'; $s.Save() } }
if (-not $NoPath) { Do 'add install folder to the user PATH' {
  $p = [Environment]::GetEnvironmentVariable('Path','User'); if (($p -split ';') -notcontains $Dest) { [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';' + $Dest), 'User') } } }
Do 'register in Apps & features' {
  $k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Postern'; New-Item -Force $k | Out-Null
  Set-ItemProperty $k DisplayName 'Postern'; Set-ItemProperty $k DisplayVersion $Version; Set-ItemProperty $k Publisher 'Infra Server'
  Set-ItemProperty $k DisplayIcon "$Dest\postern.ico"; Set-ItemProperty $k InstallLocation $Dest
  Set-ItemProperty $k UninstallString "powershell -NoProfile -ExecutionPolicy Bypass -File `"$Dest\uninstall.ps1`"" }
Write-Host "==> Done. Open Postern from the Start menu. Your data stays in %APPDATA%\Postern." -ForegroundColor Green
Write-Host "    Remove with: $Dest\uninstall.ps1  (add -Purge to also delete your data)"
