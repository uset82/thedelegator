import test from "node:test";
import assert from "node:assert/strict";
import { createMessage, validateMessage, formatMessageForLLM, MESSAGE_TYPES, ROLES } from "../lib/protocol.mjs";

test("protocol creates valid message envelope with UUID and timestamp", () => {
  const msg = createMessage({
    sender: "claude",
    receiver: "codex",
    role: ROLES.ARCHITECT,
    type: MESSAGE_TYPES.TASK_ASSIGN,
    content: "Please implement user authentication middleware.",
  });

  assert.ok(msg.id.startsWith("msg_"));
  assert.equal(msg.sender, "claude");
  assert.equal(msg.receiver, "codex");
  assert.equal(msg.role, "architect");
  assert.equal(msg.type, "task_assign");
  assert.equal(msg.metadata.requiresHuman, false);

  const validation = validateMessage(msg);
  assert.equal(validation.valid, true);
});

test("protocol detects human escalation triggers in message content", () => {
  const msg = createMessage({
    sender: "codex",
    receiver: "claude",
    content: "I need decision from @human regarding AWS deployment credentials.",
  });

  assert.equal(msg.metadata.requiresHuman, true);
});

test("protocol formats message for LLM context injection", () => {
  const msg = createMessage({
    sender: "claude",
    receiver: "codex",
    role: ROLES.ARCHITECT,
    type: MESSAGE_TYPES.SPEC,
    content: "Specification for 12 positions.",
    metadata: { branch: "feat/helix", commit: "70be8c5" },
  });

  const formatted = formatMessageForLLM(msg);
  assert.ok(formatted.includes("[CLAUDE - ARCHITECT]"));
  assert.ok(formatted.includes("Branch: feat/helix"));
  assert.ok(formatted.includes("Commit: 70be8c5"));
  assert.ok(formatted.includes("Specification for 12 positions."));
});
