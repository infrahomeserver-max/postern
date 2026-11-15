[CmdletBinding()] param([switch]$Purge)
$ErrorActionPreference = 'Stop'
$Dest = Split-Path -Parent $MyInvocation.MyCommand.Path
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -like "$Dest\*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item -Force (Join-Path ([Environment]::GetFolderPath('Programs')) 'Postern.lnk') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Postern' -ErrorAction SilentlyContinue
$p = [Environment]::GetEnvironmentVariable('Path','User'); [Environment]::SetEnvironmentVariable('Path', (($p -split ';') | Where-Object { $_ -and $_ -ne $Dest }) -join ';', 'User')
if ($Purge) { Remove-Item -Recurse -Force (Join-Path $env:APPDATA 'Postern') -ErrorAction SilentlyContinue } else { Write-Host "Kept your data in %APPDATA%\Postern (use -Purge to delete it)." }
# this script lives in the folder being deleted: remove it after exit
Start-Process cmd.exe -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$Dest`"" -WindowStyle Hidden
Write-Host 'Postern removed.'
