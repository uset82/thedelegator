# TheDelegator Universal Installer & IDE Auto-Connector (Windows PowerShell)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "      ⚡ Installing TheDelegator Multi-Agent Bridge        " -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""

# Check Prerequisites
foreach ($cmd in @("git", "node", "npm")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "TheDelegator requires '$cmd' on PATH. Please install it before running this installer."
    }
}

$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($LASTEXITCODE -ne 0 -or $nodeMajor -lt 18) {
    throw "TheDelegator requires Node.js 18 or newer; found Node.js $nodeMajor."
}

# Determine installation directory
$installDir = if ($env:THEDELEGATOR_DIR) { $env:THEDELEGATOR_DIR } else { Join-Path $HOME ".thedelegator" }

if (Test-Path $installDir) {
    Write-Host "[1/3] Updating existing TheDelegator repository in $installDir..." -ForegroundColor Yellow
    Push-Location $installDir
    try {
        & git pull --rebase
    } catch {
        Write-Warning "Could not git pull, continuing with local version..."
    }
} else {
    Write-Host "[1/3] Cloning TheDelegator to $installDir..." -ForegroundColor Yellow
    & git clone https://github.com/uset82/thedelegator.git $installDir
    Push-Location $installDir
}

# Build and Link CLI
Write-Host "[2/3] Linking TheDelegator CLI globally..." -ForegroundColor Yellow
& npm install --no-fund --no-audit
& npm link

# Register MCP Server for Cursor and Claude
Write-Host "[3/3] Registering MCP Server across IDEs..." -ForegroundColor Yellow

# 1. Cursor MCP Registration (~/.cursor/mcp.json)
$cursorMcpPath = Join-Path $HOME ".cursor\mcp.json"
if (-not (Test-Path (Split-Path $cursorMcpPath))) {
    New-Item -ItemType Directory -Force -Path (Split-Path $cursorMcpPath) | Out-Null
}
$mcpConfig = if (Test-Path $cursorMcpPath) {
    Get-Content $cursorMcpPath -Raw | ConvertFrom-Json
} else {
    [PSCustomObject]@{ mcpServers = [PSCustomObject]@{} }
}
if (-not $mcpConfig.mcpServers) {
    $mcpConfig | Add-Member -MemberType NoteProperty -Name "mcpServers" -Value ([PSCustomObject]@{})
}
$mcpConfig.mcpServers | Add-Member -MemberType NoteProperty -Name "thedelegator" -Value ([PSCustomObject]@{
    command = "node"
    args = @((Join-Path $installDir "bin\delegator.mjs"), "mcp")
}) -Force
$mcpConfig | ConvertTo-Json -Depth 10 | Set-Content $cursorMcpPath
Write-Host "  ✔ Cursor MCP server registered at $cursorMcpPath" -ForegroundColor Green

# 2. Claude Code MCP Registration (~/.claude/mcp.json)
$claudeMcpPath = Join-Path $HOME ".claude\mcp.json"
if (-not (Test-Path (Split-Path $claudeMcpPath))) {
    New-Item -ItemType Directory -Force -Path (Split-Path $claudeMcpPath) | Out-Null
}
$claudeConfig = if (Test-Path $claudeMcpPath) {
    Get-Content $claudeMcpPath -Raw | ConvertFrom-Json
} else {
    [PSCustomObject]@{ mcpServers = [PSCustomObject]@{} }
}
if (-not $claudeConfig.mcpServers) {
    $claudeConfig | Add-Member -MemberType NoteProperty -Name "mcpServers" -Value ([PSCustomObject]@{})
}
$claudeConfig.mcpServers | Add-Member -MemberType NoteProperty -Name "thedelegator" -Value ([PSCustomObject]@{
    command = "node"
    args = @((Join-Path $installDir "bin\delegator.mjs"), "mcp")
}) -Force
$claudeConfig | ConvertTo-Json -Depth 10 | Set-Content $claudeMcpPath
Write-Host "  ✔ Claude Code MCP server registered at $claudeMcpPath" -ForegroundColor Green

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host "  ⚡ TheDelegator is Ready and Connected!" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Start the Live Chat Hub:"
Write-Host "    delegator chat" -ForegroundColor Cyan
Write-Host ""
