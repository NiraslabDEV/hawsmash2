$ErrorActionPreference = "Stop"

$serviceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$buildDir = [System.IO.Path]::GetFullPath((Join-Path $serviceRoot "build"))
if (-not $buildDir.StartsWith($serviceRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Directório de build inválido."
}

Push-Location $serviceRoot
try {
  New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
  pnpm run build:bundle
  if ($LASTEXITCODE -ne 0) { throw "Falhou o bundle do bridge." }

  node --experimental-sea-config sea-config.json
  if ($LASTEXITCODE -ne 0) { throw "Falhou a preparação SEA." }

  $nodeExe = (Get-Command node -ErrorAction Stop).Source
  $targetExe = Join-Path $buildDir "hawsmash-print-bridge.exe"
  Copy-Item -LiteralPath $nodeExe -Destination $targetExe -Force

  $signTool = Get-Command signtool -ErrorAction SilentlyContinue
  if ($signTool) {
    & $signTool.Source remove /s $targetExe | Out-Null
  }

  pnpm exec postject $targetExe NODE_SEA_BLOB (Join-Path $buildDir "sea-prep.blob") `
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
  if ($LASTEXITCODE -ne 0) { throw "Falhou a injecção do bundle no executável." }

  $result = Get-Item -LiteralPath $targetExe
  Write-Host "Executável criado: $($result.FullName) ($($result.Length) bytes)"
} finally {
  Pop-Location
}
