$ws = New-Object -ComObject WScript.Shell

$startMenuPath = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\MailMind AI.lnk")
$exePath = "D:\CODE79HACK WEB DEV SECRET HACK SIGMA\mailmind ai\MailMind.exe"
$workDir = "D:\CODE79HACK WEB DEV SECRET HACK SIGMA\mailmind ai"

$shortcut = $ws.CreateShortcut($startMenuPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = $workDir
$shortcut.Description = "MailMind AI - Intelligent Email Agent and Google Drive Sync"
$shortcut.IconLocation = "$exePath,0"
$shortcut.Save()

Write-Host "Start Menu shortcut created at: $startMenuPath"

# Also create a Desktop shortcut for quick access
$desktopPath = [System.IO.Path]::Combine([Environment]::GetFolderPath("Desktop"), "MailMind AI.lnk")
$shortcut2 = $ws.CreateShortcut($desktopPath)
$shortcut2.TargetPath = $exePath
$shortcut2.WorkingDirectory = $workDir
$shortcut2.Description = "MailMind AI - Intelligent Email Agent and Google Drive Sync"
$shortcut2.IconLocation = "$exePath,0"
$shortcut2.Save()

Write-Host "Desktop shortcut created at: $desktopPath"
