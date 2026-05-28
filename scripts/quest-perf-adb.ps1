param(
  [string]$OutDir = "perf-captures/quest",
  [string]$Adb = "adb"
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$captureDir = Join-Path $OutDir $timestamp
New-Item -ItemType Directory -Force -Path $captureDir | Out-Null

$propsPath = Join-Path $captureDir "device-props.txt"
$logPath = Join-Path $captureDir "logcat.txt"

Write-Host "Writing Quest performance capture to $captureDir"
Write-Host "Checking connected devices..."
& $Adb devices | Tee-Object -FilePath (Join-Path $captureDir "adb-devices.txt")

Write-Host "Saving device properties..."
& $Adb shell getprop | Tee-Object -FilePath $propsPath | Out-Null

Write-Host "Clearing logcat ring buffer..."
& $Adb logcat -c

Write-Host "Recording logcat to $logPath"
Write-Host "Start the viewer Quest Perf capture and OVR Metrics report now. Press Ctrl+C to stop."
& $Adb logcat -v threadtime | Tee-Object -FilePath $logPath
