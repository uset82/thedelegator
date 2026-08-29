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

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findViolations, assertDisjoint } from "../lib/lanes.mjs";
import { probeAgents } from "../lib/tools.mjs";
import { createAutoOrchestrator } from "../lib/orchestrator.mjs";
import { createBridgeServer } from "../lib/server.mjs";
import { joinChatRoom } from "../lib/client.mjs";
import { createMcpServer } from "../lib/mcp.mjs";

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

function loadManifest(required = true) {
  const root = findRepoRoot();
  const candidates = [
    ...new Set([join(process.cwd(), MANIFEST), join(root, MANIFEST), join(root, "thedelegator", MANIFEST)]),
  ];
  const found = candidates.find(existsSync);
  if (!found) {
    if (!required) {
      const templatePath = join(HERE, "..", "templates", "manifest.starter.json");
      if (existsSync(templatePath)) {
        const m = JSON.parse(readFileSync(templatePath, "utf8"));
        return { manifest: m, manifestPath: templatePath, root };
      }
    }
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
    const why = v.reserved
      ? `${v.agent}'s claim slot — you may only write your own`
      : v.shared
        ? `SHARED, owned by ${v.agent}`
        : `owned by ${v.agent}`;
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
    // Same rule the CI gate applies, so status and check can never disagree.
    const strays = findViolations(files, name, m).violations.map((v) => v.path);

    if (ahead === 0) {
      stuck.push(`${name} — 0 commits ahead, last activity ${rel || "unknown"}. Idle or never started.`);
    } else if (pr && pr.isDraft) {
      stuck.push(`${name} — PR #${pr.number} is a DRAFT and will not merge. Mark it ready.`);
    } else if (!pr) {
      // The branch resolved on origin above, so what is missing is the PR, not the push.
      const stale = ageMs > staleMs ? "STALE, " : "";
      stuck.push(`${name} — ${ahead} commit(s) on origin, no open PR (${stale}${rel}). Not delivered.`);
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

  console.log(`\n${C.bold("agents")}`);
  const probes = probeAgents(m);
  if (!probes.length) {
    console.log(
      C.dim(`  no agent declares a "tool" — add one to check the agent can actually run`),
    );
  }
  for (const p of probes) {
    if (p.status === "ok") ok(`${p.name}: ${p.detail}`);
    else bad(`${p.name}: ${p.detail}`);
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
      // A team can share one checkout and rely on lanes instead of worktrees.
      // Printing "work in ../. and never in the main checkout" told them to go
      // to the directory they were already standing in, and then not to.
      a.worktree && a.worktree !== "."
        ? `Work in ${join(m.worktreeRoot ?? "..", a.worktree)} on branch ${a.branch}. Never in the main checkout.`
        : `Work in the checkout on branch ${a.branch}. Your lane, not a worktree, is what keeps you out of everyone else's way.`,
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

async function cmdChat(argv) {
  const { manifest: m, root } = loadManifest(false);
  const portArg = argv.find((a) => a.startsWith("--port="))?.split("=")[1];
  const port = portArg ? parseInt(portArg, 10) : 4141;

  const storageDir = join(root, ".delegator", "messages");
  const orchestrator = createAutoOrchestrator({ manifest: m, repoRoot: root, storageDir });
  const bridge = createBridgeServer({ orchestrator, port });

  const url = await bridge.listen(port);

  console.log(`\n${C.bold("⚡ TheDelegator — Multi-Agent Live Chat Hub")}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`Web Spectator Console: ${C.cyan(url)}`);
  console.log(`Architect:             ${C.yellow(m.shared?.owner || "claude")}`);
  console.log(`Active Agents:         ${C.green(Object.keys(m.agents || {}).join(", "))}`);
  console.log(`Auto-Verification:     ${C.green("ENABLED")} (lanes enforced on every turn)`);
  console.log(`${"═".repeat(60)}`);
  console.log(`${C.dim("Watching conversation... Press Ctrl+C to stop.")}\n`);

  orchestrator.bus.on("message", (msg) => {
    const time = new Date(msg.timestamp).toLocaleTimeString();
    const tag = msg.sender.toUpperCase();
    let color = C.cyan;
    if (tag.includes("CLAUDE")) color = C.yellow;
    if (tag.includes("HUMAN")) color = C.green;
    if (tag.includes("SYSTEM")) color = C.red;

    console.log(`\n[${C.dim(time)}] ${color(C.bold(tag))} (${msg.type}):`);
    console.log(msg.content);
    if (msg.metadata?.laneCheck) {
      const passed = msg.metadata.laneCheck.passed;
      console.log(passed ? C.green("  ✓ Lane check passed") : C.red("  ✗ Lane violation detected"));
    }
  });

  const goalArg = argv.find((a) => a.startsWith("--goal="))?.split("=").slice(1).join("=");
  if (goalArg) {
    console.log(`${C.bold("Starting Mission:")} ${goalArg}`);
    orchestrator.start({ goal: goalArg }).catch((err) => {
      console.error(C.red(`Session error: ${err.message}`));
    });
  }
}

async function cmdLoop(argv) {
  const { manifest: m, root } = loadManifest();
  const goalArg = argv.find((a) => a.startsWith("--goal="))?.split("=").slice(1).join("=");
  const maxTurnsArg = argv.find((a) => a.startsWith("--max-turns="))?.split("=")[1];
  const maxTurns = maxTurnsArg ? parseInt(maxTurnsArg, 10) : 20;

  if (!goalArg) {
    console.error(C.red("Missing --goal argument."));
    console.error(`Example: ${C.cyan('delegator loop --goal="Implement auth middleware and test coverage"')}`);
    process.exit(2);
  }

  const storageDir = join(root, ".delegator", "messages");
  const orchestrator = createAutoOrchestrator({ manifest: m, repoRoot: root, storageDir });
  orchestrator.maxTurns = maxTurns;

  console.log(`\n${C.bold("⚡ TheDelegator — Autonomous Execution Loop")}`);
  console.log(`Goal: ${goalArg}`);
  console.log(`Max turns: ${maxTurns}\n`);

  orchestrator.bus.on("message", (msg) => {
    const tag = msg.sender.toUpperCase();
    console.log(`\n--- [${tag}] (${msg.type}) ---`);
    console.log(msg.content);
  });

  try {
    const result = await orchestrator.start({ goal: goalArg });
    console.log(`\n${C.green("✓ Session finished with status:")} ${result.status} (${result.turnCount} turns)`);
  } catch (err) {
    console.error(C.red(`Execution loop failed: ${err.message}`));
    process.exit(1);
  }
}

async function cmdBridge(argv) {
  const { manifest: m, root } = loadManifest();
  const portArg = argv.find((a) => a.startsWith("--port="))?.split("=")[1];
  const port = portArg ? parseInt(portArg, 10) : 4141;

  const storageDir = join(root, ".delegator", "messages");
  const orchestrator = createAutoOrchestrator({ manifest: m, repoRoot: root, storageDir });
  const bridge = createBridgeServer({ orchestrator, port });

  const url = await bridge.listen(port);
  console.log(`TheDelegator bridge daemon running at ${url}`);
}

/**
 * Is a hub already listening, and can we start one if not?
 *
 * `join` used to fail outright when nothing was serving 4141, which made the
 * documented one-prompt setup untrue: an IDE pasted the prompt into a clean
 * machine and got a connection error, because the instructions never said
 * somebody has to run `chat` first. The first agent to arrive now opens the
 * room instead of finding the door locked.
 */
async function ensureHub(url) {
  const reachable = async () => {
    try {
      const res = await fetch(url + "/api/agents", { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  };

  if (await reachable()) return true;

  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
  if (!local) {
    console.error(C.red(`No hub at ${url}, and it is not local, so I will not start one.`));
    return false;
  }

  const port = Number(new URL(url).port || 4141);
  console.log(C.dim(`No hub on ${port} yet — starting one.`));
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "chat", `--port=${port}`], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await reachable()) {
      console.log(C.green(`Hub is up at ${url}`));
      return true;
    }
  }
  console.error(C.red(`Started a hub but it never answered on ${port}.`));
  return false;
}

async function cmdJoin(argv) {
  const agentName = argv.find((a) => a.startsWith("--agent=") || a.startsWith("--name="))?.split("=")[1] || "cursor";
  const role = argv.find((a) => a.startsWith("--role="))?.split("=")[1] || "builder";
  const branch = argv.find((a) => a.startsWith("--branch="))?.split("=")[1] || `feat/${agentName}`;
  const owns = argv.find((a) => a.startsWith("--owns=") || a.startsWith("--lane="))?.split("=")[1] || `src/${agentName}/**`;
  const url = argv.find((a) => a.startsWith("--url="))?.split("=")[1] || "http://localhost:4141";

  if (!(await ensureHub(url))) process.exit(1);
  await joinChatRoom({ agentName, role, branch, owns, serverUrl: url });
}

async function cmdMcp(argv) {
  const { manifest: m, root } = loadManifest(false);
  const portArg = argv.find((a) => a.startsWith("--port="))?.split("=")[1];
  const port = portArg ? parseInt(portArg, 10) : 4142;

  const storageDir = join(root, ".delegator", "messages");
  const orchestrator = createAutoOrchestrator({ manifest: m, repoRoot: root, storageDir });
  const mcp = createMcpServer({ orchestrator, port });

  const url = await mcp.listen(port);
  console.log(`TheDelegator MCP server running at ${url}`);
}

/* ── entry ────────────────────────────────────────────────────────────────── */

const [, , cmd, ...argv] = process.argv;
const commands = {
  check: cmdCheck,
  status: cmdStatus,
  doctor: cmdDoctor,
  prompts: cmdPrompts,
  init: cmdInit,
  chat: cmdChat,
  loop: cmdLoop,
  bridge: cmdBridge,
  join: cmdJoin,
  mcp: cmdMcp,
};

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log(`${C.bold("the delegator")} — coordination-free parallelism for AI coding agents

  ${C.cyan("delegator init")}       create a manifest
  ${C.cyan("delegator doctor")}     is every agent actually able to work?
  ${C.cyan("delegator check")}      did this branch write outside its lane?  ${C.dim("(CI gate)")}
  ${C.cyan("delegator status")}     what moved, what is stuck
  ${C.cyan("delegator prompts")}    generate each agent's prompt from the manifest
  ${C.cyan("delegator chat")}       start real-time multi-agent live chat & spectator console
  ${C.cyan("delegator loop")}       run autonomous agent execution loop until goal completion
  ${C.cyan("delegator join")}       auto-join IDE terminal session to the live chat
  ${C.cyan("delegator mcp")}        launch Model Context Protocol (MCP) server for Cursor/Claude

  ${C.dim("--goal=<text>    specify objective for chat / loop")}
  ${C.dim("--port=<num>     web console port (default: 4141)")}
  ${C.dim("--max-turns=<n>  safety turn limit for autonomous loop (default: 20)")}
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

