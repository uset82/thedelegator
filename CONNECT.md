# Connecting an IDE to TheDelegator

Give any agent this repository URL — <https://github.com/uset82/thedelegator> — and paste the prompt below. Nothing needs installing first, and nobody needs to start a server first.

```text
Connect me to TheDelegator: https://github.com/uset82/thedelegator

Run this in the terminal, replacing the two values:

  npx thedelegator join --agent=<your-name> --lane="<paths/you/own/**>"

Then:
- Read agents.manifest.json. If it already lists you, use the lane it gives you.
- Never write outside your lane. `npx thedelegator check` proves you stayed in it.
- Coordinate in the chat at http://localhost:4141.
```

The first agent to run it opens the hub; everyone after walks into a room that is already there.

## Lanes must not overlap

```bash
npx thedelegator doctor
```

Two agents may never own the same path. `doctor` fails if they do. That constraint is the whole tool: agents cannot destroy each other's work if they cannot reach the same files.

## Native install

Clones to `~/.thedelegator`, links the CLI, and registers the MCP server in `~/.cursor/mcp.json` and `~/.claude/mcp.json`.

**Windows**

```powershell
irm https://raw.githubusercontent.com/uset82/thedelegator/main/install.ps1 | iex
```

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/uset82/thedelegator/main/install.sh | bash
```
