/**
 * Base Adapter Interface for AI Agent Models
 */

import { formatMessageForLLM } from "../protocol.mjs";

export class BaseAdapter {
  /**
   * @param {Object} options
   * @param {string} options.name - Agent name (e.g. 'claude', 'codex', 'gemini')
   * @param {string} [options.role='builder'] - Role ('architect', 'builder', 'reviewer')
   * @param {string} [options.worktreeDir] - Path to the agent's worktree/directory
   * @param {Object} [options.manifest] - Loaded manifest
   * @param {string} [options.systemPrompt] - Base system prompt
   */
  constructor({ name, role = "builder", worktreeDir = process.cwd(), manifest = null, systemPrompt = "" } = {}) {
    this.name = name;
    this.role = role;
    this.worktreeDir = worktreeDir;
    this.manifest = manifest;
    this.customSystemPrompt = systemPrompt;
  }

  /**
   * Builds the system prompt according to agent role and manifest lanes.
   */
  getSystemPrompt() {
    if (this.customSystemPrompt) return this.customSystemPrompt;

    if (this.role === "architect") {
      return (
        `You are CLAUDE, the ARCHITECT, DESIGN LEAD and INTEGRATOR on this project.\n` +
        `You write plans, define interfaces, assign tasks with explicit acceptance criteria to builders, and REVIEW every PR.\n` +
        `You have final authority over design, architecture, and merge approvals.\n` +
        `When a builder reports completed work or submits a diff:\n` +
        `1. Inspect the diff and automated verification results carefully.\n` +
        `2. Check against acceptance criteria.\n` +
        `3. Deliver a clear decision: either 'APPROVED' or 'REVISION REQUIRED' with exact, actionable guidance.\n` +
        `Do not hallucinate code files. Be concise, direct, and authoritative.`
      );
    }

    const lanePaths = this.manifest?.agents?.[this.name]?.owns || [];
    return (
      `You are ${this.name.toUpperCase()}, a BUILDER and IMPLEMENTER on this project.\n` +
      `Claude is the architect. You listen to and follow Claude's orders and specifications.\n` +
      `You only touch files inside your assigned lane: [${lanePaths.join(", ")}].\n` +
      `Never edit files outside your lane. If you need a shared file modified, request it in your report.\n` +
      `When you finish a task, state your changes, files modified, and report ready for review.`
    );
  }

  /**
   * Formats the conversation history for consumption by LLMs.
   */
  formatContextMessages(messages = []) {
    return messages.map((m) => formatMessageForLLM(m)).join("\n\n");
  }

  /**
   * Execute a turn with this agent. Must be implemented by subclasses.
   * @param {Object} options
   * @param {Array} options.history - Message history
   * @param {string} [options.instruction] - New prompt/instruction
   * @param {Object} [options.extraContext] - Git status, diffs, etc.
   * @returns {Promise<{ content: string, metadata?: Object }>}
   */
  async sendTurn() {
    throw new Error(`sendTurn() must be implemented by adapter subclass '${this.constructor.name}'`);
  }
}
