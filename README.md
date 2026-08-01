# the delegator

**Run Claude, Codex, Cursor and Gemini on the same repository at the same time — without them
destroying each other's work.**

Zero dependencies. One JSON file. Four commands.

```bash
npx thedelegator doctor     # is every agent actually able to work?
npx thedelegator check      # did this branch write outside its lane?   ← CI gate
npx thedelegator status     # what moved, what is stuck
npx thedelegator prompts    # generate each agent's prompt
```

---

## The problem

You have four capable AI coding agents. They cannot talk to each other — different vendors,
different processes, no shared memory, no message bus. Point them at one repository and you get:

- two agents editing the same file, one silently overwriting the other
- a pull request that reports **MERGED** while its content never reached `main`
- an agent that says "done" with nothing committed
- an agent that has been stuck for eleven hours and nothing told you

Every multi-agent framework solves this by making agents **coordinate**: message passing, shared
state, an orchestrator. That requires one framework. You do not have one framework.

## The secret

**Do not make them coordinate. Make coordination unnecessary.**

Two ideas, and that is the whole tool:

### 1. Lanes are disjoint, and a machine enforces it

Every path in the repository belongs to **exactly one agent**. Not by convention — by a manifest
the CI reads. An agent that writes outside its lane fails the build, even when the change is
correct.

Agents never negotiate because there is nothing to negotiate. They never need to know another
agent exists.

```jsonc
{
  "shared": {
    "owner": "claude", // files everyone would otherwise fight over
    "paths": ["package.json", "Dockerfile", ".github/workflows/**"]
  },
  "agents": {
    "codex": { "owns": ["src/lib/**", "scripts/**"] },
    "gemini": { "owns": ["public/images/**"] }
  }
}
```

The manifest refuses to load if two agents claim the same glob. That is not a warning — an
overlap is the exact failure this tool exists to prevent.

### 2. Status is observed, never reported

Most agent systems ask agents to report progress. Agents forget, and a protocol that is
half-followed is worse than none — it reads as active work when nothing is happening.

**Git already knows everything.** Which branch moved, which commit, which paths changed, whether
a PR is open, whether it is a draft, how long since anything happened. So `status` derives it:

```
MOVED
  none

STUCK
  claude — 1 commit(s), no open PR (STALE, 13 hours ago). Not delivered.
  codex  — 1 commit(s), no open PR (unpushed, 12 hours ago). Not delivered.
  grok   — 2 commit(s), no open PR (STALE, 12 hours ago). Not delivered.
  grok   — 1 file(s) outside its lane: .gitignore
  gemini — branch chore/media does not exist on origin. Never started.
```

That output is real, from the project this was built for. Nobody reported anything. An agent
cannot forget to update something that is computed from what it actually did.

---

## Install

Nothing to install — it runs from `npx`. Node 18+.

```bash
cd your-repo
npx thedelegator init
```

Then edit `agents.manifest.json`: name your agents and give each one a set of paths.
**They must not overlap.**

## Setup, in four steps

**1. Give each agent its own worktree.** Not one folder, not four clones — four worktrees on one
repository:

```bash
git worktree add ../wt-codex  -b feat/build
git worktree add ../wt-grok   -b feat/platform
git worktree add ../wt-gemini -b chore/media
```

**2. Generate the prompts** — they are derived from the manifest, so ownership can never drift
out of sync with what the agents were told:

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
worktrees
  ✗ gemini: 19 commit(s) behind main — needs a rebase
```

On this project's first launch, all four agents had no plan files in their worktrees and no
installed dependencies. Every one would have failed on its first command and nothing would have
said why. `doctor` exists because of that morning.

**4. Enforce the lanes in CI:**

```bash
cp node_modules/thedelegator/templates/lane-check.yml .github/workflows/
```

Now an agent writing outside its lane fails the pull request. The ownership map stops being a
document and becomes a constraint.

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

One file defines ownership. Everything else reads from it, so the prompts an agent receives and
the rule CI enforces cannot disagree.

| Command | What it does | Exit code |
| --- | --- | --- |
| `doctor` | Worktrees present, current, dependencies installed, `gh` authenticated | `1` if anything is broken |
| `check` | Compares changed files against the branch's lane | `1` on a violation — fails the PR |
| `status` | Per-agent state derived from git and the PR list | `0` |
| `prompts` | Renders each agent's prompt from the manifest | `0` |
| `init` | Scaffolds a starter manifest | `0` |

`check` figures out which agent owns the branch from the manifest, so CI needs no per-agent
configuration.

---

## What it does not do

Worth being straight about.

**It does not make agents smarter.** It stops them corrupting each other's work. Those are
different problems.

**It does not remove the reviewer.** Merging stays serial and a human — or an architect agent —
still reads every PR. That reviewer is the throughput ceiling, and no amount of tooling changes
it. Sharper acceptance criteria do.

**It does not scale to twenty agents.** Past four or five the review queue dominates and you are
just queueing work more expensively. If your queue passes three open PRs, pause an agent rather
than lowering the bar.

**Most of it is not new.** Ownership maps are CODEOWNERS. Serial integration is a merge queue.
Disjoint lanes are module boundaries. These are decades-old practices that happen to apply
cleanly to agents, because the failure modes are the ones humans always had. What is unusual is
applying them across agents that *cannot* coordinate, with git as the only shared bus.

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
      "role": "architect", // reviews and merges; excluded from generated prompts
      "branch": "feat/architecture",
      "worktree": "wt-claude",
      "owns": ["docs/**", "plans/**"]
    },
    "codex": {
      "role": "builder",
      "branch": "feat/build",
      "worktree": "wt-codex",
      "owns": ["src/lib/**", "scripts/**"]
    }
  },

  "everyoneMayWrite": ["claims/${agent}.md"], // ${agent} scopes it to the writer
  "checks": { "verify": "npm test", "staleAfterHours": 12 }
}
```

**Unclaimed paths are reported, not blocked.** A path no agent owns is nobody's job, and nobody's
job is how things rot. `check` lists them so you can assign them deliberately.

---

## Tests

```bash
npm test
```

Eleven tests over the lane resolver, including a regression for every incident in the table
above. The glob matcher had a real bug — `brain/**` did not match `brain/a/b.json` — caught by
the first test run, which is the argument for writing them.

---

## License

MIT. Built while running four agents on one portfolio, and shaped entirely by what broke.
