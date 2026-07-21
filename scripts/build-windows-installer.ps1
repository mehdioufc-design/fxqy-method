$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$workRoot = Join-Path $projectRoot "work\windows-installer"
$stageRoot = Join-Path $workRoot "stage"
$appStage = Join-Path $stageRoot "app"
$packageRoot = Join-Path $workRoot "package"
$outputRoot = Join-Path $projectRoot "outputs"
$setupPath = Join-Path $outputRoot "FXQY Method Setup v1.10.exe"
$csc = "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$nodeRuntime = Join-Path (Split-Path -Parent (Get-Command node.exe).Source) "node.exe"

foreach ($required in @($csc, $nodeRuntime)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required build tool is missing: $required" }
}

if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
New-Item -ItemType Directory -Path $appStage, $packageRoot, $outputRoot -Force | Out-Null

Push-Location $projectRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "The production web build failed." }
} finally {
  Pop-Location
}

$webViewRoot = Join-Path $projectRoot ".tools\webview2"
$webViewCore = Join-Path $webViewRoot "lib\net462\Microsoft.Web.WebView2.Core.dll"
$webViewForms = Join-Path $webViewRoot "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
$webViewLoader = Join-Path $webViewRoot "runtimes\win-x64\native\WebView2Loader.dll"
foreach ($required in @($webViewCore, $webViewForms, $webViewLoader)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "WebView2 SDK file is missing: $required" }
}
& $csc /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:"$webViewCore" /reference:"$webViewForms" /out:"$appStage\FXQY Method.exe" "$projectRoot\desktop\TikTokOptimizerLauncher.cs"
if ($LASTEXITCODE -ne 0) { throw "The desktop launcher build failed." }
Copy-Item -LiteralPath $webViewCore, $webViewForms, $webViewLoader -Destination $appStage -Force
& $csc /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /out:"$appStage\Uninstall FXQY Method.exe" "$projectRoot\desktop\TikTokOptimizerUninstaller.cs"
if ($LASTEXITCODE -ne 0) { throw "The uninstaller build failed." }

foreach ($directory in @(".next", "lib", "public", "worker")) {
  $source = Join-Path $projectRoot $directory
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $appStage $directory) -Recurse -Force
  }
}
New-Item -ItemType Directory -Path (Join-Path $appStage "scripts"), (Join-Path $appStage "runtime") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "scripts\run.mjs") -Destination (Join-Path $appStage "scripts\run.mjs") -Force
Copy-Item -LiteralPath $nodeRuntime -Destination (Join-Path $appStage "runtime\node.exe") -Force
foreach ($file in @("package.json", "package-lock.json", "tsconfig.json", "README.md")) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $appStage $file) -Force
}

@'
const nextConfig = {
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; worker-src 'self' blob:" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" }
    ] }];
  }
};
export default nextConfig;
'@ | Set-Content -LiteralPath (Join-Path $appStage "next.config.mjs") -Encoding UTF8

$null = & robocopy.exe (Join-Path $projectRoot "node_modules") (Join-Path $appStage "node_modules") /E /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "Copying runtime dependencies failed with robocopy code $LASTEXITCODE." }

Push-Location $appStage
try {
  & npm.cmd prune --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "Pruning development dependencies failed." }
} finally {
  Pop-Location
}

$payloadPath = Join-Path $packageRoot "payload.zip"
Compress-Archive -Path (Join-Path $appStage "*") -DestinationPath $payloadPath -CompressionLevel Optimal

if (Test-Path -LiteralPath $setupPath) { Remove-Item -LiteralPath $setupPath -Force }
& $csc /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:Microsoft.CSharp.dll /resource:"$payloadPath",FXQYMethod.Payload.zip /out:"$setupPath" "$projectRoot\desktop\TikTokOptimizerInstaller.cs"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $setupPath)) { throw "The graphical Windows installer build failed." }

$setup = Get-Item -LiteralPath $setupPath
$hash = Get-FileHash -LiteralPath $setupPath -Algorithm SHA256
[pscustomobject]@{
  Path = $setup.FullName
  Bytes = $setup.Length
  Sha256 = $hash.Hash
} | ConvertTo-Json
