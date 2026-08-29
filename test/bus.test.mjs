import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageBus } from "../lib/bus.mjs";

test("bus publishes and routes targeted messages", () => {
  const bus = new MessageBus({ persist: false });
  const receivedClaude = [];
  const receivedCodex = [];

  bus.subscribe("claude", (msg) => receivedClaude.push(msg));
  bus.subscribe("codex", (msg) => receivedCodex.push(msg));

  bus.publish({
    sender: "claude",
    receiver: "codex",
    content: "Task for codex",
  });

  bus.publish({
    sender: "codex",
    receiver: "claude",
    content: "Report for claude",
  });

  bus.publish({
    sender: "system",
    receiver: "all",
    content: "Broadcast event",
  });

  assert.equal(receivedCodex.length, 2); // target + broadcast
  assert.equal(receivedClaude.length, 2); // target + broadcast
});

test("bus persists and reloads message history from disk", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "delegator-bus-test-"));
  try {
    const bus1 = new MessageBus({ storageDir: tempDir, persist: true });
    bus1.publish({ sender: "claude", receiver: "codex", content: "Persisted message 1" });
    bus1.publish({ sender: "codex", receiver: "claude", content: "Persisted message 2" });

    assert.equal(bus1.getHistory().length, 2);

    // Create new bus pointing to same storage
    const bus2 = new MessageBus({ storageDir: tempDir, persist: true });
    const history = bus2.getHistory();
    assert.equal(history.length, 2);
    assert.equal(history[0].content, "Persisted message 1");
    assert.equal(history[1].content, "Persisted message 2");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
