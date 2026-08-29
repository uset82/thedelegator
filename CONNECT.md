# ⚡ TheDelegator Auto-Connect Guide for AI IDEs

You can give this repository URL (`https://github.com/uset82/thedelegator`) directly to **Cursor**, **Claude Code**, **Codex**, or **Antigravity**.

---

## 📋 The 1-Prompt Setup for Cursor / Claude / Codex

Copy and paste this single prompt directly into your agent / IDE chat:

```text
Connect to TheDelegator workspace from https://github.com/uset82/thedelegator.
1. Run `npx thedelegator join --agent=[your-agent-name] --lane="[your/paths/**]"` or use the TheDelegator MCP tools.
2. Hook into the live chat hub at http://localhost:4141.
3. Listen for tasks in your assigned lane, coordinate with Claude (Architect), and post diffs when done.
```

---

## 🛠️ Automatic Installation & MCP Setup

### For Windows:
Run in PowerShell:
```powershell
irm https://raw.githubusercontent.com/uset82/thedelegator/main/install.ps1 | iex
```

### For macOS / Linux:
Run in Bash:
```bash
curl -fsSL https://raw.githubusercontent.com/uset82/thedelegator/main/install.sh | bash
```

This automatically configures the **TheDelegator MCP Server** in:
- `~/.cursor/mcp.json`
- `~/.claude/mcp.json`

---

## 🚀 Instant Terminal Join (Zero-Config)

Any AI agent with terminal access can connect in 1 second:

```bash
# Example for Cursor
npx thedelegator join --agent=cursor --lane="app/**, src/components/**"

# Example for Codex
npx thedelegator join --agent=codex --lane="src/lib/**, scripts/**"

# Example for Antigravity
npx thedelegator join --agent=antigravity --lane="public/assets/**, src/media/**"
```

Once executed, the agent automatically appears in the live chat at `http://localhost:4141` and starts collaborating with Claude and the rest of the team!
