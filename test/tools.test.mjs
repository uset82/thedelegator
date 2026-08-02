import test from "node:test";
import assert from "node:assert/strict";
import { dirname, basename, delimiter } from "node:path";
import { toolSpec, resolveOnPath, probeTool, probeAgents } from "../lib/tools.mjs";

/** The one executable guaranteed to exist here: the node running these tests. */
const NODE_DIR = dirname(process.execPath);
const NODE_CMD = basename(process.execPath).replace(/\.exe$/i, "");
const envWithNode = { PATH: NODE_DIR, PATHEXT: ".COM;.EXE;.BAT;.CMD" };

test("tool shorthand and long form mean the same thing", () => {
  assert.deepEqual(toolSpec({ tool: "codex" }), { cmd: "codex", args: ["--version"] });
  assert.deepEqual(toolSpec({ tool: { cmd: "codex" } }), { cmd: "codex", args: ["--version"] });
  assert.deepEqual(toolSpec({ tool: { cmd: "cursor", args: ["--help"] } }), {
    cmd: "cursor",
    args: ["--help"],
  });
});

test("agents without a usable tool are skipped, not guessed at", () => {
  // Existing manifests predate `tool` entirely — they must keep working.
  assert.equal(toolSpec({}), null);
  assert.equal(toolSpec({ tool: "" }), null);
  assert.equal(toolSpec({ tool: "   " }), null);
  assert.equal(toolSpec({ tool: {} }), null);
  assert.equal(toolSpec({ tool: { args: ["--version"] } }), null);
});

test("resolveOnPath finds a real executable and rejects a fictional one", () => {
  assert.ok(resolveOnPath(NODE_CMD, envWithNode));
  assert.equal(resolveOnPath("delegator-no-such-binary-xyz", envWithNode), null);
});

test("resolveOnPath does not consult PATH for an explicit path", () => {
  assert.equal(resolveOnPath(process.execPath, { PATH: "" }), process.execPath);
  assert.equal(resolveOnPath("./no/such/binary", { PATH: NODE_DIR }), null);
});

test("a missing binary is reported as missing, never as working", () => {
  const r = probeTool({ cmd: "delegator-no-such-binary-xyz", args: ["--version"] }, envWithNode);
  assert.equal(r.status, "missing");
  assert.match(r.detail, /not on PATH/);
});

test("a present binary reports what it actually said", () => {
  const r = probeTool({ cmd: NODE_CMD, args: ["--version"] }, { ...process.env, ...envWithNode });
  assert.equal(r.status, "ok");
  assert.match(r.detail, /^v\d+\./); // node prints v22.14.0 and the like
});

test("a binary that exists but fails is an error, not an ok", () => {
  const r = probeTool(
    { cmd: NODE_CMD, args: ["-e", "process.exit(3)"] },
    { ...process.env, ...envWithNode },
  );
  assert.equal(r.status, "error");
  assert.match(r.detail, /found at/);
});

test("REGRESSION: doctor called every agent ready without checking any of them", () => {
  // A manifest can hand an agent a lane on a machine where that agent is not
  // installed. Before this, nothing looked, and doctor printed a green summary.
  const manifest = {
    agents: {
      real: { tool: NODE_CMD, owns: ["a/**"] },
      ghost: { tool: "delegator-no-such-binary-xyz", owns: ["b/**"] },
      untooled: { owns: ["c/**"] },
    },
  };
  const results = probeAgents(manifest, { ...process.env, ...envWithNode });

  assert.deepEqual(results.map((r) => r.name), ["real", "ghost"]); // untooled skipped
  assert.equal(results.find((r) => r.name === "real").status, "ok");
  assert.equal(results.find((r) => r.name === "ghost").status, "missing");
});
