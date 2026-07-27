param(
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$OutDir = "dist"
)
$ErrorActionPreference = "Stop"
$CleanVersion = $Version.TrimStart("v")
$SourceDir = Join-Path (Join-Path "target" $Target) "release"
$Asset = "agents-crew-v$CleanVersion-$Target.zip"
$Stage = Join-Path ([System.IO.Path]::GetTempPath()) ("agents-crew-" + [System.Guid]::NewGuid())
New-Item -ItemType Directory -Path $Stage | Out-Null
try {
    Copy-Item (Join-Path $SourceDir "crew.exe") (Join-Path $Stage "crew.exe")
    Copy-Item (Join-Path $SourceDir "agents-crew.exe") (Join-Path $Stage "agents-crew.exe")
    Copy-Item "LICENSE" (Join-Path $Stage "LICENSE")
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $Destination = Join-Path $OutDir $Asset
    Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $Destination -Force
    Write-Output $Destination
}
finally {
    Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
}
