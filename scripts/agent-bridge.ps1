[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $BridgeArgs
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$cliPath = Join-Path $repoRoot 'dist' 'cli.js'
$nodePath = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path $cliPath)) {
    Write-Error 'Run npm run build before using scripts/agent-bridge.ps1'
    exit 1
}

if ([Console]::IsInputRedirected) {
    $stdinText = [Console]::In.ReadToEnd()
    $stdinText | & $nodePath $cliPath @BridgeArgs
}
else {
    & $nodePath $cliPath @BridgeArgs
}

exit $LASTEXITCODE
