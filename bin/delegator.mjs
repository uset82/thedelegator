#!/usr/bin/env node
/**
 * the delegator — coordination-free parallelism for multiple AI coding agents.
 *
 * Zero dependencies. Node built-ins only. Read the whole thing in ten minutes.
 *
 *   delegator doctor    is every agent actually able to work?
 *   delegator check     did anyone write outside their lane?   (CI gate)
 *   delegator status    what moved, what is stuck, what needs you
 *   delegator prompts   generate each agent's prompt from the manifest
 *   delegator init      scaffold a manifest and the worktrees
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ownerOf, everyoneMayWrite, findViolations, assertDisjoint } from "../lib/lanes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = "agents.manifest.json";

/* ── tiny helpers ─────────────────────────────────────────────────────────── */

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const git = (args, cwd = process.cwd()) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
};

const gh = (args) => {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
};

/* ── manifest ─────────────────────────────────────────────────────────────── */

function findRepoRoot(start = process.cwd()) {
  const top = git(["rev-parse", "--show-toplevel"], start);
  return top || start;
}

function loadManifest() {
  const root = findRepoRoot();
  const candidates = [
    join(process.cwd(), MANIFEST),
    join(root, MANIFEST),
    join(root, "thedelegator", MANIFEST),
  ];
  const found = candidates.find(existsSync);
  if (!found) {
    console.error(C.red(`No ${MANIFEST} found.`));
    console.error(`Looked in:\n  ${candidates.join("\n  ")}`);
    console.error(`\nRun ${C.cyan("delegator init")} to create one.`);
    process.exit(2);
  }
  const m = JSON.parse(readFileSync(found, "utf8"));
  validate(m, found);
  return { manifest: m, manifestPath: found, root };
}

function validate(m, path) {
  const fail = (msg) => {
    console.error(C.red(`Invalid ${path}: ${msg}`));
    process.exit(2);
  };
  if (!m.agents || typeof m.agents !== "object") fail("missing `agents`");
  if (!m.defaultBranch) fail("missing `defaultBranch`");

  // The property this whole system rests on: lanes must not overlap.
  const problems = assertDisjoint(m);
  if (problems.length) fail(problems.join("; ") + ". Lanes must be disjoint.");
}

/* ── commands ─────────────────────────────────────────────────────────────── */

function cmdCheck(argv) {
  const { manifest: m, root } = loadManifest();
  const agentArg = argv.find((a) => a.startsWith("--agent="))?.split("=")[1];
  const base = argv.find((a) => a.startsWith("--base="))?.split("=")[1] ?? `origin/${m.defaultBranch}`;

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root);
  const agent = agentArg ?? Object.entries(m.agents).find(([, a]) => a.branch === branch)?.[0];

  if (!agent) {
    console.error(C.red(`Cannot tell which agent owns branch "${branch}".`));
    console.error(`Pass ${C.cyan("--agent=<name>")} or add the branch to ${MANIFEST}.`);
    process.exit(2);
  }
  if (!m.agents[agent]) {
    console.error(C.red(`Unknown agent "${agent}". Known: ${Object.keys(m.agents).join(", ")}`));
    process.exit(2);
  }

  const mergeBase = git(["merge-base", base, "HEAD"], root) || base;
  const changed = git(["diff", "--name-only", `${mergeBase}...HEAD`], root)
    .split("\n")
    .filter(Boolean);

  if (changed.length === 0) {
    console.log(C.dim(`No changes against ${base}.`));
    return;
  }

  const { violations, unclaimed } = findViolations(changed, agent, m);

  console.log(`${C.bold("the delegator")} · lane check`);
  console.log(`  agent   ${C.cyan(agent)}   branch ${branch}`);
  console.log(`  base    ${base}`);
  console.log(`  files   ${changed.length}\n`);

  if (unclaimed.length) {
    console.log(C.yellow(`  ${unclaimed.length} unclaimed path(s) — no agent owns these:`));
    unclaimed.slice(0, 15).forEach((p) => console.log(`    ? ${p}`));
    if (unclaimed.length > 15) console.log(C.dim(`    …and ${unclaimed.length - 15} more`));
    console.log(C.dim("  Add them to a lane in the manifest, or they are nobody's job.\n"));
  }

  if (violations.length === 0) {
    console.log(C.green(`  ✓ every changed file is inside ${agent}'s lane`));
    return;
  }

  console.log(C.red(`  ✗ ${violations.length} file(s) outside ${agent}'s lane:\n`));
  for (const v of violations) {
    const why = v.shared ? `SHARED, owned by ${v.agent}` : `owned by ${v.agent}`;
    console.log(`    ${C.red("✗")} ${v.path}`);
    console.log(`      ${C.dim(why)}`);
  }
  console.log(
    `\n  ${C.dim("Request the change in your PR body instead. The owner applies it; you rebase.")}`,
  );
  process.exit(1);
}

function cmdStatus() {
  const { manifest: m, root } = loadManifest();
  git(["fetch", "origin", "--quiet", "--prune"], root);

  const staleMs = (m.checks?.staleAfterHours ?? 12) * 3600_000;
  const openPrs = (() => {
    const raw = gh(["pr", "list", "--state", "open", "--json", "number,title,headRefName,isDraft"]);
    try {
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  })();

  const moved = [];
  const stuck = [];

  for (const [name, a] of Object.entries(m.agents)) {
    const ref = `origin/${a.branch}`;
    const exists = git(["rev-parse", "--verify", "--quiet", ref], root);
    if (!exists) {
      stuck.push(`${name} — branch ${a.branch} does not exist on origin. Never started.`);
      continue;
    }

    const ahead = Number(git(["rev-list", "--count", `origin/${m.defaultBranch}..${ref}`], root) || 0);
    const lastIso = git(["log", "-1", "--format=%cI", ref], root);
    const ageMs = lastIso ? Date.now() - new Date(lastIso).getTime() : Infinity;
    const rel = git(["log", "-1", "--format=%cr", ref], root);
    const pr = openPrs.find((p) => p.headRefName === a.branch);

    // Attribute work by the paths actually touched — no self-reporting.
    const files =
      ahead > 0
        ? git(["diff", "--name-only", `origin/${m.defaultBranch}...${ref}`], root).split("\n").filter(Boolean)
        : [];
    const strays = files.filter(
      (f) => !everyoneMayWrite(f, name, m) && ownerOf(f, m) && ownerOf(f, m).agent !== name,
    );

    if (ahead === 0) {
      stuck.push(`${name} — 0 commits ahead, last activity ${rel || "unknown"}. Idle or never started.`);
    } else if (pr && pr.isDraft) {
      stuck.push(`${name} — PR #${pr.number} is a DRAFT and will not merge. Mark it ready.`);
    } else if (!pr) {
      const how = ageMs > staleMs ? "STALE" : "unpushed";
      stuck.push(`${name} — ${ahead} commit(s), no open PR (${how}, ${rel}). Not delivered.`);
    } else {
      moved.push(`${name} — PR #${pr.number} "${pr.title}" · ${ahead} commit(s) · ${rel}`);
    }

    if (strays.length) {
      stuck.push(
        `${name} — ${strays.length} file(s) outside its lane: ${strays.slice(0, 3).join(", ")}${strays.length > 3 ? "…" : ""}`,
      );
    }
  }

  const p = (title, items, colour) => {
    console.log(C.bold(title));
    if (!items.length) console.log(C.dim("  none"));
    else items.forEach((i) => console.log(`  ${colour(i)}`));
    console.log("");
  };

  console.log(`${C.bold("the delegator")} · status · ${new Date().toISOString().slice(0, 16).replace("T", " ")}\n`);
  p("MOVED", moved, C.green);
  p("STUCK", stuck, C.yellow);
  console.log(C.bold("NEEDS YOU"));
  console.log(C.dim("  (decisions live in your board file — the delegator does not track them)"));
}

function cmdDoctor() {
  const { manifest: m, root } = loadManifest();
  let problems = 0;
  const bad = (s) => {
    problems++;
    console.log(`  ${C.red("✗")} ${s}`);
  };
  const ok = (s) => console.log(`  ${C.green("✓")} ${s}`);

  console.log(`${C.bold("the delegator")} · doctor\n`);

  console.log(C.bold("git"));
  git(["rev-parse", "--is-inside-work-tree"], root) ? ok("inside a git repository") : bad("not a git repository");
  git(["rev-parse", "--verify", "--quiet", `origin/${m.defaultBranch}`], root)
    ? ok(`origin/${m.defaultBranch} exists`)
    : bad(`origin/${m.defaultBranch} missing — fetch first`);

  console.log(`\n${C.bold("gh")}`);
  gh(["auth", "status"]) ? ok("authenticated") : bad("not authenticated — run: gh auth login");

  console.log(`\n${C.bold("worktrees")}`);
  const wt = git(["worktree", "list"], root);
  for (const [name, a] of Object.entries(m.agents)) {
    if (!a.worktree) continue;
    const path = resolve(root, m.worktreeRoot ?? "..", a.worktree);
    if (!existsSync(path)) {
      bad(`${name}: ${a.worktree} missing — git worktree add ${join(m.worktreeRoot ?? "..", a.worktree)} -b ${a.branch}`);
      continue;
    }
    if (!wt.includes(a.worktree)) {
      bad(`${name}: ${a.worktree} exists on disk but is not a registered worktree`);
      continue;
    }
    const behind = Number(git(["rev-list", "--count", `HEAD..origin/${m.defaultBranch}`], path) || 0);
    if (behind > 0) bad(`${name}: ${behind} commit(s) behind ${m.defaultBranch} — needs a rebase`);
    else ok(`${name}: ${a.worktree} present and current`);
  }

  console.log(`\n${C.bold("lanes")}`);
  ok(`${Object.keys(m.agents).length} agents, lanes verified disjoint`);
  if (m.shared?.paths?.length) ok(`${m.shared.paths.length} shared path rule(s) owned by ${m.shared.owner}`);

  console.log("");
  if (problems === 0) console.log(C.green(C.bold("Ready. Every agent can work.")));
  else {
    console.log(C.red(C.bold(`${problems} problem(s). Fix before launching agents.`)));
    process.exit(1);
  }
}

function cmdPrompts(argv) {
  const { manifest: m, root } = loadManifest();
  const only = argv.find((a) => !a.startsWith("-"));
  const outDir = argv.find((a) => a.startsWith("--out="))?.split("=")[1];

  const chain = readFileSync(join(HERE, "..", "templates", "chain-of-command.md"), "utf8");
  const architect = Object.entries(m.agents).find(([, a]) => a.role === "architect")?.[0] ?? "claude";

  for (const [name, a] of Object.entries(m.agents)) {
    if (only && only !== name) continue;
    if (name === architect) continue;

    const lane = (a.owns ?? []).map((p) => `  ${p}`).join("\n");
    const forbidden = Object.entries(m.agents)
      .filter(([n]) => n !== name)
      .map(([n, o]) => `  ${(o.owns ?? []).join(", ")}  → ${n}`)
      .join("\n");

    const body = [
      chain.replaceAll("${architect}", architect).trim(),
      "",
      `You are ${name} — ${a.title}.`,
      `Work in ../${a.worktree} on branch ${a.branch}. Never in the main checkout.`,
      "",
      "YOU OWN (write freely):",
      lane,
      "",
      "YOU MUST NOT EDIT:",
      forbidden,
      `  ${(m.shared?.paths ?? []).join(", ")}  → SHARED, ${m.shared?.owner} only`,
      "",
      "EVERY TASK:",
      `1. git fetch origin && git rebase origin/${m.defaultBranch}`,
      "2. Build only that task. One task per PR.",
      `3. Run: ${m.checks?.verify ?? "<the project check command>"} — must be green.`,
      `4. Run: npx delegator check --agent=${name} — must pass. This proves you stayed in your lane.`,
      `5. Open a PR TARGETING ${m.defaultBranch}. Never target another agent's branch.`,
      "6. PR body: acceptance criteria met, commands run with output, shared-file requests,",
      "   and any new task you discovered.",
      `7. Stop. Wait for ${architect} to merge.`,
    ].join("\n");

    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      const f = join(outDir, `${name}.prompt.md`);
      writeFileSync(f, body + "\n");
      console.log(`wrote ${f}`);
    } else {
      console.log(`${"═".repeat(72)}\n${C.bold(name.toUpperCase())}\n${"═".repeat(72)}\n${body}\n`);
    }
  }
}

function cmdInit() {
  const root = findRepoRoot();
  const target = join(process.cwd(), MANIFEST);
  if (existsSync(target)) {
    console.log(C.yellow(`${MANIFEST} already exists. Nothing written.`));
    return;
  }
  const example = readFileSync(join(HERE, "..", "templates", "manifest.starter.json"), "utf8");
  writeFileSync(target, example);
  console.log(`${C.green("✓")} wrote ${target}`);
  console.log(`
Next:
  1. Edit ${MANIFEST} — set your agents' owned paths. ${C.bold("They must not overlap.")}
  2. ${C.cyan("npx delegator prompts --out=./prompts")}   generate each agent's prompt
  3. ${C.cyan("npx delegator doctor")}                     verify every agent can work
  4. Copy ${C.cyan("templates/lane-check.yml")} into .github/workflows/ to enforce lanes in CI
`);
}

/* ── entry ────────────────────────────────────────────────────────────────── */

const [, , cmd, ...argv] = process.argv;
const commands = { check: cmdCheck, status: cmdStatus, doctor: cmdDoctor, prompts: cmdPrompts, init: cmdInit };

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log(`${C.bold("the delegator")} — coordination-free parallelism for AI coding agents

  ${C.cyan("delegator init")}       create a manifest
  ${C.cyan("delegator doctor")}     is every agent actually able to work?
  ${C.cyan("delegator check")}      did this branch write outside its lane?  ${C.dim("(CI gate)")}
  ${C.cyan("delegator status")}     what moved, what is stuck
  ${C.cyan("delegator prompts")}    generate each agent's prompt from the manifest

  ${C.dim("--agent=<name>   override branch→agent detection")}
  ${C.dim("--base=<ref>     compare against something other than origin/<default>")}
  ${C.dim("--out=<dir>      write prompts to files instead of stdout")}
`);
  process.exit(0);
}

if (!commands[cmd]) {
  console.error(C.red(`Unknown command "${cmd}". Try --help.`));
  process.exit(2);
}
commands[cmd](argv);
