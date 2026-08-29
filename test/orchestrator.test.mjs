import test from "node:test";
import assert from "node:assert/strict";
import { Orchestrator, SESSION_STATUS } from "../lib/orchestrator.mjs";
import { MockAdapter } from "../lib/adapters/mock.mjs";
import { createBridgeServer } from "../lib/server.mjs";
import { ROLES, MESSAGE_TYPES } from "../lib/protocol.mjs";

const testManifest = {
  defaultBranch: "main",
  shared: {
    owner: "claude",
    paths: ["package.json", "docs/**"],
  },
  agents: {
    codex: {
      owns: ["src/**", "lib/**"],
      worktree: "codex-tree",
    },
    gemini: {
      owns: ["public/assets/**"],
      worktree: "gemini-tree",
    },
  },
};

test("orchestrator runs autonomous turn loop between architect and worker until completion", async () => {
  const orchestrator = new Orchestrator({
    manifest: testManifest,
    architect: "claude",
    maxTurns: 5,
    autoVerify: false,
  });

  const claudeAdapter = new MockAdapter({
    name: "claude",
    role: ROLES.ARCHITECT,
    responses: [
      {
        content: "Codex: Please build the database connection pool in src/db.mjs.",
        metadata: { step: 1 },
      },
      {
        content: "Reviewed src/db.mjs diff. Everything adheres to specs. APROBADO. ALL_TASKS_COMPLETED.",
        metadata: { step: 2, status: "approved" },
      },
    ],
  });

  const codexAdapter = new MockAdapter({
    name: "codex",
    role: ROLES.BUILDER,
    responses: [
      {
        content: "Implemented src/db.mjs with connection pooling and unit tests. Ready for review.",
        metadata: { branch: "feat/db-pool" },
      },
    ],
  });

  orchestrator.registerAdapter("claude", claudeAdapter);
  orchestrator.registerAdapter("codex", codexAdapter);

  const result = await orchestrator.start({ goal: "Implement database connection pool" });

  assert.equal(result.status, SESSION_STATUS.COMPLETED);
  assert.equal(result.turnCount, 3); // 1: Claude delegates -> 2: Codex builds -> 3: Claude reviews & completes

  const history = orchestrator.bus.getHistory();
  assert.equal(history.length, 4); // 1 human goal + 3 agent turns
  assert.equal(history[0].sender, "human");
  assert.equal(history[1].sender, "claude");
  assert.equal(history[2].sender, "codex");
  assert.equal(history[3].sender, "claude");
});

test("orchestrator pauses and emits escalation when agent requests @human guidance", async () => {
  const orchestrator = new Orchestrator({
    manifest: testManifest,
    architect: "claude",
    maxTurns: 5,
    autoVerify: false,
  });

  const claudeAdapter = new MockAdapter({
    name: "claude",
    role: ROLES.ARCHITECT,
    responses: [
      {
        content: "Codex: Proceed with Stripe payment integration.",
      },
    ],
  });

  const codexAdapter = new MockAdapter({
    name: "codex",
    role: ROLES.BUILDER,
    responses: [
      {
        content: "I need @human decision: Should we use live or test Stripe API keys?",
      },
    ],
  });

  orchestrator.registerAdapter("claude", claudeAdapter);
  orchestrator.registerAdapter("codex", codexAdapter);

  let escalated = false;
  orchestrator.on("escalation", () => {
    escalated = true;
  });

  const result = await orchestrator.start({ goal: "Integrate Stripe payments" });

  assert.equal(result.status, SESSION_STATUS.WAITING_HUMAN);
  assert.equal(escalated, true);
});

test("bridge server provides HTTP status and message history API endpoints", async () => {
  const orchestrator = new Orchestrator({
    manifest: testManifest,
    architect: "claude",
    autoVerify: false,
  });

  const bridge = createBridgeServer({ orchestrator, port: 4149 });
  const url = await bridge.listen(4149);

  try {
    const statusRes = await fetch(`${url}/api/status`);
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.status, "idle");
    assert.deepEqual(statusData.agents, ["codex", "gemini"]);

    // Send a message via API
    const postRes = await fetch(`${url}/api/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Supervisor instruction via API" }),
    });
    assert.equal(postRes.status, 200);

    const historyRes = await fetch(`${url}/api/history`);
    const historyData = await historyRes.json();
    assert.equal(historyData.length, 1);
    assert.equal(historyData[0].content, "Supervisor instruction via API");
  } finally {
    await bridge.close();
  }
});
