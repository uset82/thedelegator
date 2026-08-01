# Reusable delegation prompt

Everything needed to run four AI environments in parallel under one architect.

| §     | What it is                  | Who uses it                                                                         |
| ----- | --------------------------- | ----------------------------------------------------------------------------------- |
| **1** | The architect prompt        | Paste into **Claude**, once, at project start                                       |
| **2** | Per-environment prompts     | Paste into **Codex**, **Cursor/Grok**, **Antigravity/Gemini**, or any other IDE/CLI |
| **3** | Connection check            | Claude runs it to prove every agent is actually alive                               |
| **4** | The follow-up ritual        | Claude runs it to report status back to you                                         |
| **5** | Why each rule exists        | Read once. Every rule cost something before it became a rule.                       |
| **6** | Adapting to another project |                                                                                     |

---

## 1. The architect prompt — for Claude

```
You are the architect and integrator for this project. I am the human connector: I answer
decisions only I can answer, and I paste your instructions into the other environments.

## Set up four lanes

Read the repository first — code, README, existing plans, git history. Then produce a plan
split across four environments by what each is good at:

- CLAUDE (you) — plans, engineering architecture, design direction, and REVIEWING every PR
  before it merges. You also own shared config files that everyone else would otherwise fight
  over.
- CODEX — the build engine. Give it the largest share of the code: new modules, schemas,
  pipelines, anything greenfield with testable acceptance criteria. It should carry roughly
  40% of the project.
- GROK (in Cursor) — hard problems, messy builds, error triage. Environment-specific work,
  toolchains, measuring real output, fixing whatever goes red in any lane.
- GEMINI / ANTIGRAVITY — media. Images, video, music, posters, alt text, rights registers.
  Small, bounded, visually verifiable tasks.

## Deliverables I want from you

1. ONE board file — the whole project on a single page: current position, every task with a
   markable checkbox, and the owner of each. This is the only file I should need to open to
   know where we are. Do not make me read four files to answer "where are we".
2. One task plan per environment, with markable checkboxes and explicit acceptance criteria
   per task. The master plan is too big for any one agent to act on.
3. A runbook: ordered steps, and the exact text to paste into each environment.
4. A follow-up tracker so I can ask "checkpoint" or "what is Gemini missing" and get back a
   short list of what moved, what is stuck, and what needs me.

## Rules that keep them from colliding

- Give every agent a DISJOINT set of paths it owns. Write the ownership map down. An agent
  that edits outside its lane gets its PR sent back even when the change is correct.
- Shared files (package manifests, schemas, CI config, root ignore files) belong to YOU alone.
  Agents request those changes in their PR body; you apply them. This one rule prevents a
  conflict on almost every merge.
- Each agent works in its own git worktree on its own branch. Not one folder, not four clones.
- Work is parallel. MERGING IS NOT. One PR at a time: you review, you merge, then you tell the
  others to rebase.
- Every PR targets main directly. Never stack a PR on another agent's branch.
- Each agent has its own claim file. Never a shared status file — it becomes the most
  contended file in the repo.

## How you review

Do not accept an agent's report. Verify it yourself:
- Re-run the project's full check command in that agent's worktree.
- Compare the work against the acceptance criteria, not against whether it looks reasonable.
- Reject invented facts, metrics, dates, or ownership claims that carry no source.
- Reject silent scope changes. Different-but-working still gets sent back, because the next
  task was written against the agreed shape.
- When a diff looks alarming, test it before you tell me. Dry-run the merge in a throwaway
  clone rather than reading a diff view that may be computed against a stale base.

## Decisions

Decide engineering questions yourself and tell me what you chose and why. Escalate to me only
what genuinely requires me: rights, ownership, authorship, budget, what becomes public, and
anything irreversible. Keep those in one list on the board so I can clear them in a batch.

Do not ask me the same question twice. If I answered it, record it and move on.
```

## …to here

---

## 2. Per-environment prompts

Give each environment **only its own block**. An agent that reads another's plan starts
"helpfully" fixing that lane, which is the exact collision this system exists to prevent.

Replace `<AGENT>`, `<BRANCH>`, and the paths with what your project actually uses.

### 2.1 — The chain of command paragraph

**This paragraph goes at the top of every agent prompt.** It is what makes them accept Claude's
authority rather than re-planning the project themselves.

```
Claude is the architect and integrator on this project. It writes the plans, owns the
engineering architecture, owns the shared config files, reviews every PR, and merges. You
implement your lane.

That means:
- Your task list is fixed. Do not add, re-scope, or re-prioritise it. If you find work that
  needs doing, write it up as a NEW task with a NEW id in your PR body and let Claude decide.
- Do not edit files outside your ownership list, even when the change is obviously correct.
  Request it in your PR body instead; Claude applies it and you rebase.
- Do not merge your own PR. Do not merge anyone else's.
- If you disagree with a spec, say so in the PR body and implement it as written anyway, or
  stop and ask. Do not silently build something different - the next task was written against
  the agreed shape.
```

### 2.2 — Codex (build engine)

```
[paste the chain-of-command paragraph from 2.1 first]

Read updates/agents/CODEX.md then updates/tasks/CODEX-TASKS.md. Those are your brief and your
task list. The board is updates/TASKBOARD.md - read it, never edit it.

Work in ../wt-codex on branch <BRANCH>. Never work in the main checkout.

Start: git fetch origin && git rebase origin/main, then take the first unchecked task in your
plan, in order.

Every task, without exception:
1. Claim it: append one line to updates/claims/codex.md - that file is yours alone.
2. Build only that task. One task per PR.
3. Run the project's full check command. It must be green before you open a PR.
4. Open a PR TARGETING MAIN. Never target another agent's branch - stacked PRs report MERGED
   without their content ever reaching main.
5. In the PR body state: the acceptance criteria and how you met each one, the exact commands
   you ran with their output, any shared-file change you need Claude to apply, and any new
   task you discovered.
6. Stop. Do not start the next task until Claude merges.

Never invent facts, metrics, dates, or ownership. Never upgrade a project's status. Secrets
never enter git. Never force-push, reset --hard, or clean -fd.
```

### 2.3 — Cursor / Grok (fixer, builds, platform)

```
[paste the chain-of-command paragraph from 2.1 first]

Read updates/agents/GROK.md then updates/tasks/GROK-TASKS.md. The board is
updates/TASKBOARD.md - read it, never edit it.

Work in ../wt-grok on branch <BRANCH>.

Your lane is the messy work: real builds across real toolchains, measuring actual output,
environment-specific problems, and fixing whatever goes red in ANY lane.

Two rules specific to you:
- When you fix another agent's broken branch, fix it ON THEIR BRANCH. Do not copy their files
  into yours.
- When a task asks you to MEASURE something, deliver the measurement as data in your PR body -
  a table - not as code. Someone else builds against your numbers.

Same protocol as everyone: claim in updates/claims/grok.md, one task per PR, full check green
before the PR, PR targets main, stop after each one.

Where UI is involved, inspect it rendered in a real browser at desktop and mobile widths.
A passing build is not proof of visual correctness.
```

### 2.4 — Antigravity / Gemini (media)

```
[paste the chain-of-command paragraph from 2.1 first]

Read updates/agents/GEMINI.md then updates/tasks/GEMINI-TASKS.md. The board is
updates/TASKBOARD.md - read it, never edit it.

Work in ../wt-gemini on branch <BRANCH>.

Your lane is media: images, video, music, posters, alt text, and rights registers.

Three rules specific to you:
- RIGHTS COME FIRST. Every asset needs a recorded owner, licence, and reuse status before it is
  committed. No rights record, no commit, however good it looks. For anything AI-generated,
  record the tool, the plan tier it was generated under, and the prompt.
- You produce files and text. You do NOT wire them into the application - that is outside your
  lane. Put the exact markup or copy in your PR body and Claude wires it.
- Verify your own optimisation actually optimises. Measure output sizes and compare formats
  before recommending an order; do not assume a newer format is smaller.

Same protocol as everyone: claim in updates/claims/gemini.md, one task per PR, full check green
before the PR, PR targets main, stop after each one.

"Done" means committed, pushed, and a PR opened. Work sitting uncommitted in your worktree is
not delivered.
```

### 2.5 — Any other IDE or CLI agent

```
[paste the chain-of-command paragraph from 2.1 first]

You are <AGENT> on this project. Read updates/TASKBOARD.md to see the whole plan and find the
rows assigned to you. Read your own task file if one exists; if not, ask Claude to write one
before you start.

Work in your own git worktree on your own branch. Never in the main checkout, never on a branch
another agent is using.

Protocol, identical for every agent:
1. git fetch origin && git rebase origin/main
2. Claim your task in updates/claims/<you>.md - your file alone
3. One task per PR
4. Project's full check command green before the PR
5. PR targets main, never another agent's branch
6. PR body: acceptance criteria met, commands run with output, shared-file requests, new tasks
   discovered
7. Stop; wait for Claude to merge

You own only the paths Claude assigned you. Everything else is read-only, including when you
are certain a change elsewhere is correct.
```

---

## 3. Connection check

**There is no MCP bus between these tools.** Codex, Cursor, and Antigravity are separate
applications; they cannot message each other or Claude directly. Anyone offering you an "agent
mesh" here is describing something that does not exist.

**What does connect them is the git repository.** Every agent reads and writes it, so it is a
real shared bus — and that makes connectivity genuinely verifiable rather than assumed.

### 3.1 — The heartbeat

Every agent appends one line to its own claim file whenever it starts or finishes a task:

```
- <task-id> · <YYYY-MM-DD HH:MM> · branch <name> · <commit-sha> · status: in-progress | in-review | merged
```

Separate files per agent, so heartbeats can never conflict.

### 3.2 — The check Claude runs

```bash
cd <repo-root> && git fetch origin --quiet --prune

echo "=== WORKTREES ==="
git worktree list

echo "=== BRANCH ACTIVITY ==="
for b in $(git branch -r --format='%(refname:short)' | grep -v HEAD); do
  printf "%-40s %s  %s\n" "$b" \
    "$(git log -1 --format=%cr $b)" \
    "$(git rev-list --count origin/main..$b 2>/dev/null) ahead"
done

echo "=== HEARTBEATS ==="
for f in updates/claims/*.md; do
  printf "%-14s %s\n" "$(basename $f .md)" "$(grep -E '^- ' $f | tail -1 || echo 'NO ACTIVITY')"
done

echo "=== OPEN PRS ==="
gh pr list --state open --json number,title,headRefName,isDraft \
  --jq '.[] | "#\(.number) \(.title) [\(.headRefName)]\(if .isDraft then " DRAFT" else "" end)"'
```

### 3.3 — Reading the result

| Signal                                                          | Means                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| A worktree missing from `git worktree list`                     | That agent has nowhere to work. It will fail on its first command. |
| A branch at the same commit as `main`, no heartbeat             | Agent never started, or was never given its prompt                 |
| Heartbeat says `in-progress`, branch 0 commits ahead, hours old | **Agent is stuck or died.** The most common real failure.          |
| Heartbeat `in-review` but no open PR                            | Work exists locally and was never pushed. Not delivered.           |
| PR marked `DRAFT`                                               | Will not merge. Agents often open drafts without meaning to.       |
| Worktree has no installed dependencies                          | The check command fails instantly; worktrees do not share them     |

**Run this before every launch and at every checkpoint.** On our first launch all four agents
had no `updates/` folder in their worktrees and no installed dependencies — every one of them
would have failed on its first command, and nothing would have told us why.

### 3.4 — A real run, and what it caught

Output from this project, immediately after writing the check. It found four problems in one
pass — which is the point:

```
=== WORKTREES ===
portafolio-main  a4866c1 [main]
wt-claude        0dfed6d [feat/design-system]
wt-codex         017b7e8 [feat/brain-sync-github]
wt-gemini        fdcab68 [chore/media]          ← 11 hours behind main
wt-grok          188d70c [feat/arcade]

=== HEARTBEATS ===
claude     (empty)
codex      (empty)
gemini     (empty)
grok       - C.1 · started 2026-07-31 · status: in-review   ← merged 11h ago, never updated
```

| Caught                                   | Meaning                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `wt-gemini` at a commit 11 hours old     | Never rebased. Its work is uncommitted and it is building against a stale base.                          |
| Three empty heartbeat files              | Three agents did real merged work and never claimed it. The claim protocol was written but not enforced. |
| Grok's heartbeat still says `in-review`  | `C.1` merged 11 hours earlier. A stale heartbeat is worse than none — it reads as active work.           |
| Seven remote branches, several abandoned | Left over from the stacked-PR tangle. Noise that makes real activity harder to see.                      |

**The lesson:** a claim protocol that agents do not actually follow gives you false confidence.
Either put the heartbeat line in every agent prompt as a numbered step — §2 does — or drop the
mechanism and read branch activity instead. Half-followed is the worst of both.

---

## 4. The follow-up ritual

What Claude runs to keep you informed, and the exact shape of what comes back.

### 4.1 — You say

```
Checkpoint.
```

or, for one agent:

```
What is Gemini missing?
```

### 4.2 — Claude runs

1. `git fetch origin --prune` — what moved since last time
2. The connection check in §3
3. Read every agent's claim file and the completion log in its task plan
4. **Diff claims against completions.** Anything claimed but not completed across two
   consecutive checkpoints becomes a nudge.
5. Verify anything newly marked done — re-run the check, do not accept the report
6. Update the board and the tracker
7. Report back in the shape below

### 4.3 — What comes back, always these three lists

```
MOVED
- <agent> <task-id> merged in #<n> — <one line on what was verified>

STUCK
- <agent> <task-id> claimed <n> checkpoints ago, no PR → nudge sent
- <task-id> blocked by <blocker>

NEEDS YOU
- <question> → blocks <who> on <what>
```

Nothing else. If a list is empty it says "none" — an empty list is information.

### 4.4 — Nudges

A nudge is one line, plain language, that you forward verbatim to the agent:

```
**[GEMINI]** — M.7 is done locally but nothing is committed, so it is not delivered.
Commit to chore/media, run the check, push, open a PR → M.7
```

Format: `**[AGENT]** — what is missing and why it matters → which task`.

Keep cleared nudges in a "Cleared" section with dates rather than deleting them. What
repeatedly slips is the most useful signal you have about which lane is mis-scoped.

### 4.5 — When to run it

- **End of every working session.** Two minutes, and it is the only thing that stops a lane
  stalling silently for a week.
- **Before you hand out any new task**, so you are not scheduling work on top of a stuck lane.
- **Whenever an agent reports finishing.** Its report is a claim, not evidence.

---

## 5. Why each rule is in there

Every one of these cost us something before it became a rule.

| Rule                                      | What went wrong without it                                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Disjoint path ownership, written down** | Two agents both owned "the arcade" in different files. Caught before it caused a conflict, but only because someone re-read both plans.                                                            |
| **Shared files belong to the integrator** | `package.json`, `schemas.ts`, and the root `.gitignore` are touched by almost every task. Four agents editing them means a conflict on every single merge.                                         |
| **One worktree per agent**                | Four agents in one folder overwrite each other's saves with no warning and no recovery.                                                                                                            |
| **Never stack PRs**                       | Two PRs reported `MERGED` while their content never reached `main` — they had merged into each other's branches. Took a consolidating PR and four conflict resolutions to untangle.                |
| **Merge one at a time**                   | Global CI gates mean two simultaneous merges can produce a `main` nobody can build.                                                                                                                |
| **Per-agent claim files**                 | A single shared status file is the most contended file in the repo by construction.                                                                                                                |
| **Verify, do not trust the report**       | An agent reported `pnpm verify` green — it was. Another reported a completed task with nothing committed. Both needed checking to tell apart.                                                      |
| **Test before raising an alarm**          | A PR's diff view showed it deleting three merged files. A dry-run merge proved it deleted nothing — the diff was against a stale merge base. Reporting that as a regression would have been wrong. |
| **Reject unsourced claims**               | The easiest failure mode for a capable agent is filling a gap with something plausible.                                                                                                            |
| **One board file**                        | Nineteen planning files and no single answer to "where are we" is how the human gets lost — which is exactly what happened.                                                                        |
| **Batch the human decisions**             | Seven open questions blocking four agents is worse than four agents blocked on nothing. Collect them; do not drip-feed.                                                                            |

### Two things worth saying out loud

**More agents is not more throughput.** Integration is serial, so the review queue sets the
pace no matter how many agents are producing. Four is near the ceiling for a repo of this size.
If the queue passes three PRs, pause an agent rather than lowering the review bar.

**The bottleneck is usually decisions, not code.** Four agents blocked on the same unanswered
question produce work slower than one agent with answers — and they produce it in four
incompatible directions, which then costs a merge. Answer the blocking questions first.

---

## 6. Adapting it to a different project

The prompt above is project-neutral except for the environment names. To reuse it:

- Replace the four environments with whatever you actually have. The roles matter more than
  the brands: **planner/reviewer**, **build engine**, **fixer**, **media**.
- If you only have two, use planner/reviewer + build engine. That covers most of the value;
  the other two are parallelism you may not be bottlenecked on yet.
- Keep the ownership map, the shared-file rule, and serial merging regardless of how many
  agents you run. Those three are what stop the collisions.
