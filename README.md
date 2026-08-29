# the delegator

[![npm](https://img.shields.io/npm/v/thedelegator?color=cb3837&logo=npm)](https://www.npmjs.com/package/thedelegator)
[![ci](https://github.com/uset82/thedelegator/actions/workflows/ci.yml/badge.svg)](https://github.com/uset82/thedelegator/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/node/v/thedelegator)](https://nodejs.org)

**Run Claude, Codex, Cursor, Antigravity, and Gemini on the same repository at the same time — without them destroying each other's work.**

Zero dependencies. One JSON file. Autonomous multi-agent coordination.

```bash
npx thedelegator chat       # live multi-agent chat room & spectator web console (http://localhost:4141)
npx thedelegator loop       # autonomous execution loop (Claude + builders) until goal completion
npx thedelegator join       # 1-second auto-join for any IDE/agent with assigned lanes
npx thedelegator doctor     # is every agent actually able to work?
npx thedelegator check      # did this branch write outside its lane?   ← CI gate
npx thedelegator status     # what moved, what is stuck (observed directly from git)
npx thedelegator prompts    # generate each agent's custom system prompt
```

---

## Give your IDE this repository

Paste this into **Cursor**, **Claude Code**, **Codex**, **Antigravity**, or any agent with a terminal. Nothing to install first, and nothing to start first.

```text
Connect me to TheDelegator: https://github.com/uset82/thedelegator

Run this in the terminal, replacing the two values:

  npx thedelegator join --agent=<your-name> --lane="<paths/you/own/**>"

Then:
- Read agents.manifest.json. If it already lists you, use the lane it gives you.
- Never write outside your lane. `npx thedelegator check` proves you stayed in it.
- Coordinate in the chat at http://localhost:4141.
```

That single command does everything:

| | |
| --- | --- |
| **Installs** | `npx` fetches the package. Zero dependencies, so there is nothing else to pull. |
| **Starts the hub** | If nothing is serving `http://localhost:4141`, the first agent to join opens the room. |
| **Registers a lane** | Your paths are written into `agents.manifest.json`. |
| **Connects** | You appear in the live console with your own colour, and can talk to the team. |

The second agent to run it finds the room already open and walks in.

### Check the lanes before you start

```bash
npx thedelegator doctor
```

Lanes must be **disjoint** — two agents may never own the same path. `doctor` refuses to pass if they overlap, which is the entire point of the tool: agents cannot destroy each other's work if they cannot reach the same files.

### Prefer a native install

Installs to `~/.thedelegator`, links the CLI globally, and registers the MCP server in `~/.cursor/mcp.json` and `~/.claude/mcp.json`.

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/uset82/thedelegator/main/install.ps1 | iex
```

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/uset82/thedelegator/main/install.sh | bash
```

---

## The live console

`http://localhost:4141`, opened by the first agent that joins, or on demand:

```bash
npx thedelegator chat
```

- **War Room** carries every broadcast. Each agent also has its own channel, holding what it said and what was addressed to it.
- **Every message is attributed** — name, role, colour and time — so a long multi-agent log can be read by who rather than re-read from the top.
- **Lanes are enforced on every turn**, not audited afterwards.

Run an autonomous mission from the terminal:

```bash
npx thedelegator loop --goal="Implement JWT auth middleware with unit tests"
```

---

## The problem

You have four capable AI coding agents. They cannot talk to each other — different vendors, different processes, no shared memory, no message bus. Point them at one repository and you get:

- two agents editing the same file, one silently overwriting the other
- a pull request that reports **MERGED** while its content never reached `main`
- an agent that says "done" with nothing committed
- an agent that has been stuck for eleven hours and nothing told you

Every multi-agent framework solves this by making agents **coordinate**: message passing, shared state, an orchestrator. That requires one framework. You do not have one framework.

## The secret

**Do not make them coordinate. Make coordination unnecessary.**

Two ideas, and that is the whole tool:

### 1. Lanes are disjoint, and a machine enforces it

Every path in the repository belongs to **exactly one agent**. Not by convention — by a manifest the CI reads. An agent that writes outside its lane fails the build, even when the change is correct.

Agents never negotiate because there is nothing to negotiate. They never need to know another agent exists.

```jsonc
{
  "shared": {
    "owner": "claude", // files everyone would otherwise fight over
    "paths": ["package.json", "Dockerfile", ".github/workflows/**"]
  },
  "agents": {
    "codex": { "owns": ["src/lib/**", "scripts/**"] },
    "cursor": { "owns": ["app/**", "src/components/**"] },
    "antigravity": { "owns": ["public/assets/**", "src/media/**"] }
  }
}
```

The manifest refuses to load if two agents claim the same glob. That is not a warning — an overlap is the exact failure this tool exists to prevent.

### 2. Status is observed, never reported

Most agent systems ask agents to report progress. Agents forget, and a protocol that is half-followed is worse than none — it reads as active work when nothing is happening.

**Git already knows everything.** Which branch moved, which commit, which paths changed, whether a PR is open, whether it is a draft, how long since anything happened. So `status` derives it:

```
MOVED
  none

STUCK
  claude — 1 commit(s), no open PR (STALE, 13 hours ago). Not delivered.
  codex  — 1 commit(s), no open PR (unpushed, 12 hours ago). Not delivered.
  cursor — 2 commit(s), no open PR (STALE, 12 hours ago). Not delivered.
  cursor — 1 file(s) outside its lane: .gitignore
  gemini — branch chore/media does not exist on origin. Never started.
```

That output is real, from the project this was built for. Nobody reported anything. An agent cannot forget to update something that is computed from what it actually did.

---

## Full setup: one worktree per agent

The paste above is enough for a team sharing a single checkout — disjoint lanes are what keep agents apart, not separate directories. Give each agent its own worktree when you want them on separate branches with separate pull requests.

**1. Give each agent its own worktree.** Not one folder, not four clones — four worktrees on one repository:

```bash
git worktree add ../wt-codex       -b feat/build
git worktree add ../wt-cursor      -b feat/app
git worktree add ../wt-antigravity -b chore/media
```

**2. Generate the prompts** — they are derived from the manifest, so ownership can never drift out of sync with what the agents were told:

```bash
npx thedelegator prompts --out=./prompts
```

**3. Verify everyone can actually work** before you launch anything:

```bash
npx thedelegator doctor
```

```
git
  ✓ inside a git repository
  ✓ origin/main exists
gh
  ✓ authenticated
agents
  ✓ claude: 2.1.220 (Claude Code)
  ✓ codex: codex-cli 0.142.0
  ✓ cursor: cursor 0.45.0
  ✓ antigravity: antigravity 2.0
worktrees
  ✓ codex: clean (wt-codex)
  ✓ cursor: clean (wt-cursor)
```

**4. Enforce the lanes in CI:**

```bash
cp node_modules/thedelegator/templates/lane-check.yml .github/workflows/
```

Now an agent writing outside its lane fails the pull request. The ownership map stops being a document and becomes a constraint.

---

## How it works

```
                        agents.manifest.json
                     the single source of truth
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
    prompts                  check                   status
 what each agent      CI gate: did this        derived from git:
 is told it owns      branch stay in           branches, PRs,
                      its lane?                changed paths
```

| Command | What it does | Exit code |
| --- | --- | --- |
| `chat` | Starts the multi-agent live chat server and spectator web console at `http://localhost:4141` | `0` |
| `loop` | Runs autonomous turn loop between Architect (Claude) and Builders until milestone completion | `0` / `1` |
| `join` | One-second terminal command to register an agent and its lanes into the active workspace | `0` |
| `doctor` | Checks agent CLI binaries, worktree status, and GitHub CLI auth | `1` if anything is broken |
| `check` | Compares changed files against the branch's lane — fails PR on violations | `1` on violation |
| `status` | Per-agent state derived directly from git history and open PRs | `0` |
| `prompts` | Renders each agent's system prompt derived from manifest ownership | `0` |
| `init` | Scaffolds a starter manifest | `0` |

---

## Why the rules exist

Every rule here has a scar. None of it is theory.

| Rule | What happened without it |
| --- | --- |
| Lanes must be disjoint | Two agents were assigned the same directory in different files. Nine copies of the ownership map, and they drifted. |
| Shared files have one owner | `package.json` and `.gitignore` are touched by nearly every task. Four agents editing them means a conflict on every merge. |
| One worktree per agent | Four agents in one folder overwrite each other's saves with no warning and no recovery. |
| Never stack PRs | Two PRs reported `MERGED` while their content never reached `main` — they had merged into each other's branches. |
| Merge one at a time | Global CI gates mean two simultaneous merges can produce a `main` nobody can build. |
| Verify, don't trust the report | One agent reported "complete" with nothing committed. Another reported green — and was. Only checking tells them apart. |
| Test before raising an alarm | A diff view showed a PR deleting three merged files. A dry-run merge proved it deleted nothing; the diff was against a stale merge base. |
| Status must be derived | The claim protocol was written clearly and three of four agents ignored it entirely. |

---

## The manifest

```jsonc
{
  "version": 1,
  "defaultBranch": "main",
  "worktreeRoot": "..",

  "shared": {
    "owner": "claude",
    "paths": ["package.json", "**/package.json", "Dockerfile", ".github/workflows/**"]
  },

  "agents": {
    "claude": {
      "role": "architect",
      "branch": "feat/architecture",
      "worktree": "wt-claude",
      "owns": ["docs/**", "plans/**"]
    },
    "cursor": {
      "role": "builder",
      "branch": "feat/app",
      "worktree": "wt-cursor",
      "owns": ["app/**", "src/components/**"]
    },
    "antigravity": {
      "role": "builder",
      "branch": "chore/media",
      "worktree": "wt-antigravity",
      "owns": ["public/assets/**", "src/media/**"]
    }
  },

  "everyoneMayWrite": ["claims/${agent}.md"],
  "checks": { "verify": "npm test", "staleAfterHours": 12 }
}
```

---

## Tests

```bash
npm test
```

37 automated unit and regression tests verifying lane isolation, overlap prevention, claim resolution, status extraction, and manifest validation.

---

## License

MIT. Built while running multiple agents on one repository, and shaped entirely by what broke.
