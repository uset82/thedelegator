/**
 * Every manifest this package ships must be valid.
 *
 * A broken `templates/manifest.starter.json` means every `delegator init`
 * produces something that cannot load — and the user blames the tool, correctly.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { assertDisjoint } from "../lib/lanes.mjs";

const files = [
  "templates/manifest.starter.json",
  ...(existsSync("examples")
    ? readdirSync("examples")
        .filter((f) => f.endsWith(".json"))
        .map((f) => `examples/${f}`)
    : []),
];

let failed = 0;

for (const file of files) {
  const problems = [];
  let m;

  try {
    m = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`✗ ${file}: not valid JSON — ${err.message}`);
    failed++;
    continue;
  }

  if (!m.agents || typeof m.agents !== "object") problems.push("missing `agents`");
  if (!m.defaultBranch) problems.push("missing `defaultBranch`");

  for (const [name, agent] of Object.entries(m.agents ?? {})) {
    if (!agent.owns?.length) problems.push(`${name} owns nothing`);
    if (!agent.branch) problems.push(`${name} has no branch`);
  }

  problems.push(...assertDisjoint(m));

  if (problems.length) {
    console.error(`✗ ${file}`);
    problems.forEach((p) => console.error(`    ${p}`));
    failed++;
  } else {
    console.log(`✓ ${file} — ${Object.keys(m.agents).length} agents, lanes disjoint`);
  }
}

if (failed) {
  console.error(`\n${failed} manifest(s) invalid.`);
  process.exit(1);
}
console.log(`\n${files.length} shipped manifest(s) valid.`);
