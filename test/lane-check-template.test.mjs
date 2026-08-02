/**
 * The workflow template is the one artifact users copy verbatim into their own
 * repository, and it was the only shipped file with no coverage. Everything it
 * depends on was proven separately — the CLI, the exit codes, the merge base —
 * while the file that ties them together was taken on faith.
 *
 * This runs the command out of the template itself rather than a copy of it, so
 * editing the template and breaking the gate fails here instead of in someone
 * else's CI.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE = fileURLToPath(new URL("../templates/lane-check.yml", import.meta.url));
const CLI = fileURLToPath(new URL("../bin/delegator.mjs", import.meta.url));
const yml = readFileSync(TEMPLATE, "utf8");

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/**
 * A repository shaped like the one the workflow runs against: two lanes, a
 * manifest on main, and `origin/main` present so `--base` resolves.
 */
function scaffold() {
  const dir = mkdtempSync(join(tmpdir(), "delegator-lane-check-"));
  git(["init", "-q", "--initial-branch=main", "."], dir);
  git(["config", "user.email", "t@example.com"], dir);
  git(["config", "user.name", "T"], dir);

  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "infra"));
  writeFileSync(join(dir, "src/a.txt"), "a\n");
  writeFileSync(join(dir, "infra/b.txt"), "b\n");
  writeFileSync(
    join(dir, "agents.manifest.json"),
    JSON.stringify({
      defaultBranch: "main",
      agents: {
        codex: { branch: "feat/build", owns: ["src/**"] },
        grok: { branch: "feat/platform", owns: ["infra/**"] },
      },
    }),
  );
  git(["add", "-A"], dir);
  git(["commit", "-qm", "base"], dir);
  // The workflow compares against origin/<base_ref>; give it one to find.
  git(["update-ref", "refs/remotes/origin/main", git(["rev-parse", "HEAD"], dir).trim()], dir);
  return dir;
}

/** The template's own command, pointed at this working tree instead of the registry. */
function templateCommand() {
  const line = yml
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("run:") && l.includes("delegator"));
  assert.ok(line, "no `run:` step invoking delegator found in the template");

  const raw = line.replace(/^run:\s*/, "");
  assert.match(raw, /npx --yes thedelegator/, "template no longer invokes the published CLI as expected");

  return raw
    .replaceAll("${{ github.base_ref }}", "main")
    .replace("npx --yes thedelegator", `node "${CLI}"`);
}

/** Exit code of the template's command in `cwd`. */
function runTemplate(cwd) {
  try {
    execSync(templateCommand(), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
}

test("template asks for the history the gate needs", () => {
  // Without full history there is no merge base, and `check` silently compares
  // against the wrong thing — a green tick that means nothing.
  assert.match(yml, /fetch-depth:\s*0/, "checkout must use fetch-depth: 0");
  assert.match(yml, /pull_request:/, "the gate must run on pull requests");
  assert.match(yml, /--base=/, "the gate must pin the base it compares against");
});

test("the template passes a branch that stayed in its lane", (t) => {
  const dir = scaffold();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(["checkout", "-qb", "feat/build"], dir);
  writeFileSync(join(dir, "src/a.txt"), "a changed\n");
  git(["add", "-A"], dir);
  git(["commit", "-qm", "codex: own lane"], dir);

  assert.equal(runTemplate(dir), 0);
});

test("REGRESSION: the template actually fails a branch that left its lane", (t) => {
  // The whole point of shipping the file. Never once executed before this test.
  const dir = scaffold();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(["checkout", "-qb", "feat/build"], dir);
  writeFileSync(join(dir, "infra/b.txt"), "codex touching grok's lane\n");
  git(["add", "-A"], dir);
  git(["commit", "-qm", "codex: out of lane"], dir);

  assert.equal(runTemplate(dir), 1);
});
