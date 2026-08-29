#!/usr/bin/env bash
# TheDelegator Universal Installer & IDE Auto-Connector (macOS/Linux)
set -euo pipefail

echo -e "\033[1;36m===========================================================\033[0m"
echo -e "\033[1;36m      ⚡ Installing TheDelegator Multi-Agent Bridge        \033[0m"
echo -e "\033[1;36m===========================================================\033[0m"
echo ""

INSTALL_DIR="${THEDELEGATOR_DIR:-$HOME/.thedelegator}"

if [ -d "$INSTALL_DIR" ]; then
    echo -e "\033[1;33m[1/3] Updating existing TheDelegator repository in $INSTALL_DIR...\033[0m"
    cd "$INSTALL_DIR"
    git pull --rebase || true
else
    echo -e "\033[1;33m[1/3] Cloning TheDelegator to $INSTALL_DIR...\033[0m"
    git clone https://github.com/uset82/thedelegator.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

echo -e "\033[1;33m[2/3] Linking TheDelegator CLI globally...\033[0m"
npm install --no-fund --no-audit
npm link

echo -e "\033[1;33m[3/3] Registering MCP Server across IDEs...\033[0m"

# Cursor MCP
mkdir -p "$HOME/.cursor"
CURSOR_MCP="$HOME/.cursor/mcp.json"
if [ ! -f "$CURSOR_MCP" ]; then
    echo '{"mcpServers":{}}' > "$CURSOR_MCP"
fi
node -e "
const fs = require('fs');
const p = '$CURSOR_MCP';
const cfg = JSON.parse(fs.readFileSync(p, 'utf8') || '{\"mcpServers\":{}}');
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.thedelegator = { command: 'node', args: ['$INSTALL_DIR/bin/delegator.mjs', 'mcp'] };
fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
"
echo -e "\033[1;32m  ✔ Cursor MCP server registered at $CURSOR_MCP\033[0m"

# Claude Code MCP
mkdir -p "$HOME/.claude"
CLAUDE_MCP="$HOME/.claude/mcp.json"
if [ ! -f "$CLAUDE_MCP" ]; then
    echo '{"mcpServers":{}}' > "$CLAUDE_MCP"
fi
node -e "
const fs = require('fs');
const p = '$CLAUDE_MCP';
const cfg = JSON.parse(fs.readFileSync(p, 'utf8') || '{\"mcpServers\":{}}');
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.thedelegator = { command: 'node', args: ['$INSTALL_DIR/bin/delegator.mjs', 'mcp'] };
fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
"
echo -e "\033[1;32m  ✔ Claude Code MCP server registered at $CLAUDE_MCP\033[0m"

echo ""
echo -e "\033[1;32m===========================================================\033[0m"
echo -e "\033[1;32m  ⚡ TheDelegator is Ready and Connected!\033[0m"
echo -e "\033[1;32m===========================================================\033[0m"
echo ""
