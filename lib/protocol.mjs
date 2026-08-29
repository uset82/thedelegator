/**
 * TheDelegator Agent-to-Agent Communication Protocol
 *
 * Defines structured message schemas, validation, and factory helpers for
 * seamless autonomous dialogue between Architect and Worker agents.
 */

import { randomUUID } from "node:crypto";

export const MESSAGE_TYPES = {
  SPEC: "spec",
  TASK_ASSIGN: "task_assign",
  TASK_CLAIM: "task_claim",
  PROGRESS_REPORT: "progress_report",
  REVIEW_REQUEST: "review_request",
  REVIEW_DECISION: "review_decision",
  QUESTION: "question",
  HUMAN_INPUT: "human_input",
  SYSTEM_EVENT: "system_event",
};

export const ROLES = {
  ARCHITECT: "architect",
  BUILDER: "builder",
  REVIEWER: "reviewer",
  SUPERVISOR: "supervisor",
  SYSTEM: "system",
};

/**
 * Validates a message object according to protocol requirements.
 */
export function validateMessage(msg) {
  if (!msg || typeof msg !== "object") return { valid: false, error: "Message must be an object" };
  if (!msg.sender || typeof msg.sender !== "string") return { valid: false, error: "Missing or invalid sender" };
  if (!msg.receiver || typeof msg.receiver !== "string") return { valid: false, error: "Missing or invalid receiver" };
  if (!msg.content || typeof msg.content !== "string") return { valid: false, error: "Missing or invalid content" };
  if (msg.type && !Object.values(MESSAGE_TYPES).includes(msg.type)) {
    return { valid: false, error: `Invalid message type '${msg.type}'` };
  }
  return { valid: true };
}

/**
 * Creates a normalized message envelope.
 */
export function createMessage({
  sender,
  receiver = "all",
  role = ROLES.BUILDER,
  type = MESSAGE_TYPES.PROGRESS_REPORT,
  content = "",
  metadata = {},
}) {
  const id = `msg_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const timestamp = new Date().toISOString();

  // Automatically detect if human intervention is explicitly requested
  const requiresHuman =
    metadata.requiresHuman ??
    Boolean(
      content.includes("@human") ||
      content.includes("@supervisor") ||
      content.includes("ESCALATION") ||
      content.includes("HUMAN_DECISION_REQUIRED")
    );

  const message = {
    id,
    timestamp,
    sender,
    receiver,
    role,
    type,
    content: content.trim(),
    metadata: {
      ...metadata,
      requiresHuman,
    },
  };

  const check = validateMessage(message);
  if (!check.valid) {
    throw new Error(`Protocol message validation failed: ${check.error}`);
  }

  return message;
}

/**
 * Formats a message for LLM context injection.
 */
export function formatMessageForLLM(msg) {
  const senderBadge = msg.role ? `[${msg.sender.toUpperCase()} - ${msg.role.toUpperCase()}]` : `[${msg.sender.toUpperCase()}]`;
  const typeBadge = msg.type ? `(${msg.type.toUpperCase()})` : "";
  const header = `--- ${senderBadge} ${typeBadge} (${msg.timestamp}) ---`;

  let extra = "";
  if (msg.metadata?.branch) extra += `Branch: ${msg.metadata.branch}\n`;
  if (msg.metadata?.commit) extra += `Commit: ${msg.metadata.commit}\n`;
  if (msg.metadata?.changedFiles?.length) {
    extra += `Changed Files:\n  - ${msg.metadata.changedFiles.join("\n  - ")}\n`;
  }
  if (msg.metadata?.laneCheck) {
    extra += `Lane Check: ${msg.metadata.laneCheck.status}\n`;
  }

  return `${header}\n${extra ? extra + "\n" : ""}${msg.content}\n`;
}
