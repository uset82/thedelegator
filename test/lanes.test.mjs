import test from "node:test";
import assert from "node:assert/strict";
import { globToRegExp, ownerOf, everyoneMayWrite, findViolations, assertDisjoint } from "../lib/lanes.mjs";

/** The real manifest shape, trimmed. Cases below are drawn from actual incidents. */
const m = {
  defaultBranch: "main",
  shared: {
    owner: "claude",
    paths: ["package.json", "**/package.json", "Dockerfile", ".github/workflows/**", ".gitignore"],
  },
  agents: {
    claude: { owns: ["updates/**", "docs/design/**", "site/src/styles/**"] },
    codex: { owns: ["brain/**", "scripts/brain-*.ts", "site/src/app/arcade/**"] },
    grok: { owns: ["site/public/games/**"] },
    gemini: { owns: ["site/public/images/**", "docs/content/*-register.json"] },
  },
  everyoneMayWrite: ["updates/claims/${agent}.md"],
};

test("glob: ** crosses directory separators, * does not", () => {
  assert.ok(globToRegExp("brain/**").test("brain/projects/x/project.json"));
  assert.ok(globToRegExp("brain/**").test("brain/README.md"));
  assert.ok(!globToRegExp("site/public/images/*").test("site/public/images/a/b.png"));
  assert.ok(globToRegExp("site/public/images/**").test("site/public/images/a/b.png"));
});

test("glob: prefixed wildcards match only within a segment", () => {
  assert.ok(globToRegExp("scripts/brain-*.ts").test("scripts/brain-check.ts"));
  assert.ok(!globToRegExp("scripts/brain-*.ts").test("scripts/brain/check.ts"));
  assert.ok(globToRegExp("docs/content/*-register.json").test("docs/content/asset-licensing-register.json"));
});

test("shared paths resolve to the shared owner, not to a lane", () => {
  assert.deepEqual(ownerOf(".gitignore", m), { agent: "claude", shared: true });
  assert.deepEqual(ownerOf("site/package.json", m), { agent: "claude", shared: true });
  assert.equal(ownerOf(".github/workflows/verify.yml", m).shared, true);
});

test("lane paths resolve to their agent", () => {
  assert.equal(ownerOf("brain/projects/ifoundyou/NOTES.md", m).agent, "codex");
  assert.equal(ownerOf("site/public/games/pong/index.html", m).agent, "grok");
  assert.equal(ownerOf("site/public/images/poster.avif", m).agent, "gemini");
  assert.equal(ownerOf("updates/TASKBOARD.md", m).agent, "claude");
});

test("unclaimed paths return null — nobody's job is a signal", () => {
  assert.equal(ownerOf("README.md", m), null);
  assert.equal(ownerOf("site/src/components/hero.tsx", m), null);
});

test("claim files are writable by their own agent only", () => {
  assert.ok(everyoneMayWrite("updates/claims/grok.md", "grok", m));
  assert.ok(!everyoneMayWrite("updates/claims/grok.md", "gemini", m));
});

/* ── regressions: each of these actually happened ─────────────────────────── */

test("REGRESSION: Grok's C.1 edited .gitignore, a shared file", () => {
  const { violations } = findViolations(
    [".gitignore", "site/public/games/C1-MEASUREMENTS.md", "updates/claims/grok.md"],
    "grok",
    m,
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, ".gitignore");
  assert.equal(violations[0].shared, true);
  assert.equal(violations[0].agent, "claude");
});

test("REGRESSION: Codex requested package.json rather than editing it — that PR passes", () => {
  const { violations } = findViolations(
    ["brain/README.md", "scripts/brain-check.ts", "site/src/app/arcade/page.tsx"],
    "codex",
    m,
  );
  assert.equal(violations.length, 0);
});

test("REGRESSION: Gemini producing assets is clean; wiring them in is not", () => {
  const clean = findViolations(["site/public/images/poster.avif", "docs/content/asset-licensing-register.json"], "gemini", m);
  assert.equal(clean.violations.length, 0);

  const wired = findViolations(["site/public/images/poster.avif", "site/src/styles/tokens.css"], "gemini", m);
  assert.equal(wired.violations.length, 1);
  assert.equal(wired.violations[0].agent, "claude");
});

test("overlapping lanes are fatal, not a warning", () => {
  assert.equal(assertDisjoint(m).length, 0);

  const overlapping = {
    agents: { a: { owns: ["src/**"] }, b: { owns: ["src/**"] } },
  };
  const problems = assertDisjoint(overlapping);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /both own "src\/\*\*"/);
});

test("unclaimed paths are reported separately from violations", () => {
  const { violations, unclaimed } = findViolations(["brain/x.md", "README.md"], "codex", m);
  assert.equal(violations.length, 0);
  assert.deepEqual(unclaimed, ["README.md"]);
});
