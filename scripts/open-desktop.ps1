$ErrorActionPreference = "SilentlyContinue"
$appUrl = "http://127.0.0.1:3000"
$deadline = (Get-Date).AddSeconds(60)

do {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $appUrl -TimeoutSec 2
    if ($response.StatusCode -eq 200) { break }
  } catch {
    Start-Sleep -Milliseconds 300
  }
} while ((Get-Date) -lt $deadline)

$edgeCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if ($edgeCandidates.Count -gt 0) {
  Start-Process -FilePath $edgeCandidates[0] -ArgumentList "--app=$appUrl", "--start-maximized"
} else {
  Start-Process $appUrl
}
