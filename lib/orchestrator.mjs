/**
 * TheDelegator Autonomous Multi-Agent Orchestrator
 *
 * Manages the turn-taking loop between Architect (Claude) and Builders (Codex/Cursor/Gemini),
 * enforcing lane checks, handling autonomous handoffs, and pausing for human escalation.
 */

import { EventEmitter } from "node:events";
import { MessageBus } from "./bus.mjs";
import { MESSAGE_TYPES, ROLES, createMessage } from "./protocol.mjs";
import { verifyAgentWork } from "./verifier.mjs";
import { AnthropicAdapter } from "./adapters/anthropic.mjs";
import { OpenAIAdapter } from "./adapters/openai.mjs";
import { GeminiAdapter } from "./adapters/gemini.mjs";
import { CliAdapter } from "./adapters/cli.mjs";
import { MockAdapter } from "./adapters/mock.mjs";
import { toolSpec } from "./tools.mjs";

export const SESSION_STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  WAITING_HUMAN: "waiting_human",
  COMPLETED: "completed",
  ERROR: "error",
};

/**
 * Creates an Orchestrator with auto-detected model adapters.
 */
export function createAutoOrchestrator({ manifest, repoRoot = process.cwd(), storageDir = null } = {}) {
  const bus = new MessageBus({ storageDir, persist: Boolean(storageDir) });
  const orchestrator = new Orchestrator({ manifest, repoRoot, bus });

  const architectName = manifest.shared?.owner || "claude";

  // Register architect
  if (process.env.ANTHROPIC_API_KEY) {
    orchestrator.registerAdapter(
      architectName,
      new AnthropicAdapter({ name: architectName, role: ROLES.ARCHITECT, manifest })
    );
  } else if (process.env.GEMINI_API_KEY) {
    orchestrator.registerAdapter(
      architectName,
      new GeminiAdapter({ name: architectName, role: ROLES.ARCHITECT, manifest })
    );
  } else if (process.env.OPENAI_API_KEY) {
    orchestrator.registerAdapter(
      architectName,
      new OpenAIAdapter({ name: architectName, role: ROLES.ARCHITECT, manifest })
    );
  } else {
    orchestrator.registerAdapter(
      architectName,
      new MockAdapter({ name: architectName, role: ROLES.ARCHITECT, manifest })
    );
  }

  // Register worker agents from manifest
  for (const [name, agent] of Object.entries(manifest.agents || {})) {
    const spec = toolSpec(agent);
    if (spec) {
      orchestrator.registerAdapter(
        name,
        new CliAdapter({
          name,
          cmd: spec.cmd,
          args: spec.args,
          worktreeDir: agent.worktree ? `${repoRoot}/../${agent.worktree}` : repoRoot,
          manifest,
        })
      );
    } else if (process.env.OPENAI_API_KEY && (name.includes("codex") || name.includes("gpt"))) {
      orchestrator.registerAdapter(name, new OpenAIAdapter({ name, role: ROLES.BUILDER, manifest }));
    } else if (process.env.GEMINI_API_KEY && name.includes("gemini")) {
      orchestrator.registerAdapter(name, new GeminiAdapter({ name, role: ROLES.BUILDER, manifest }));
    } else {
      orchestrator.registerAdapter(name, new MockAdapter({ name, role: ROLES.BUILDER, manifest }));
    }
  }

  return orchestrator;
}


export class Orchestrator extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.manifest - Loaded manifest
   * @param {string} [options.repoRoot] - Repository root directory
   * @param {MessageBus} [options.bus] - Message bus instance
   * @param {Map<string, Object>|Object} [options.adapters] - Registered model adapters
   * @param {string} [options.architect='claude'] - Name of architect agent
   * @param {number} [options.maxTurns=20] - Maximum turn count before safety stop
   * @param {boolean} [options.autoVerify=true] - Auto-run lane check after each worker turn
   */
  constructor({
    manifest,
    repoRoot = process.cwd(),
    bus = null,
    adapters = {},
    architect = "claude",
    maxTurns = 20,
    autoVerify = true,
  } = {}) {
    super();
    this.manifest = manifest;
    this.repoRoot = repoRoot;
    this.bus = bus || new MessageBus();
    this.adapters = adapters instanceof Map ? adapters : new Map(Object.entries(adapters));
    this.architectName = architect;
    this.maxTurns = maxTurns;
    this.autoVerify = autoVerify;

    this.status = SESSION_STATUS.IDLE;
    this.turnCount = 0;
    this.activeAgent = null;
    this.currentGoal = "";
    this._pausePromise = null;
    this._pauseResolver = null;
  }

  /**
   * Register an agent adapter.
   */
  registerAdapter(name, adapter) {
    this.adapters.set(name, adapter);
  }

  /**
   * Get an adapter or throw if missing.
   */
  getAdapter(name) {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new Error(`No adapter registered for agent '${name}'`);
    }
    return adapter;
  }

  /**
   * Start an autonomous delegation session.
   *
   * @param {Object} params
   * @param {string} params.goal - High-level objective or initial prompt
   * @param {string} [params.initialWorker] - Optional specific worker to start with
   */
  async start({ goal, initialWorker = null }) {
    if (this.status === SESSION_STATUS.RUNNING) {
      throw new Error("Orchestration session is already running");
    }

    this.currentGoal = goal;
    this.turnCount = 0;
    this.status = SESSION_STATUS.RUNNING;
    this.emit("session:start", { goal });

    // Publish initial goal to message bus
    this.bus.publish({
      sender: "human",
      receiver: this.architectName,
      role: ROLES.SUPERVISOR,
      type: MESSAGE_TYPES.HUMAN_INPUT,
      content: `Goal for this session:\n${goal}`,
    });

    let nextTarget = this.architectName;
    let lastWorker = initialWorker || Object.keys(this.manifest.agents || {})[0] || "worker";

    try {
      while (this.status === SESSION_STATUS.RUNNING && this.turnCount < this.maxTurns) {
        if (this._pausePromise) {
          this.emit("session:paused");
          await this._pausePromise;
          this.emit("session:resumed");
        }

        this.turnCount++;
        this.activeAgent = nextTarget;
        this.emit("turn:start", { turn: this.turnCount, agent: nextTarget });

        const adapter = this.getAdapter(nextTarget);
        const history = this.bus.getHistory({ limit: 15 });

        // Generate extra context (git lane verification, repo state)
        let extraContext = "";
        if (this.autoVerify && nextTarget !== this.architectName) {
          const check = verifyAgentWork({
            agentName: nextTarget,
            manifest: this.manifest,
            cwd: adapter.worktreeDir || this.repoRoot,
          });
          extraContext = check.summary;
        }

        // Execute agent turn
        const result = await adapter.sendTurn({
          history,
          instruction: this.turnCount === 1 ? goal : "",
          extraContext,
        });

        const isArchitect = nextTarget === this.architectName;
        const role = isArchitect ? ROLES.ARCHITECT : ROLES.BUILDER;
        const msgType = isArchitect ? MESSAGE_TYPES.TASK_ASSIGN : MESSAGE_TYPES.PROGRESS_REPORT;

        // Auto-detect recipient from content if architect delegates to someone
        let recipient = isArchitect ? lastWorker : this.architectName;
        if (isArchitect) {
          for (const agentName of Object.keys(this.manifest.agents || {})) {
            if (result.content.toLowerCase().includes(agentName.toLowerCase())) {
              recipient = agentName;
              lastWorker = agentName;
              break;
            }
          }
        }

        // Post agent response to the bus
        const publishedMsg = this.bus.publish({
          sender: nextTarget,
          receiver: recipient,
          role,
          type: msgType,
          content: result.content,
          metadata: result.metadata || {},
        });

        this.emit("turn:end", { turn: this.turnCount, message: publishedMsg });

        // Check for human escalation or completion
        if (publishedMsg.metadata?.requiresHuman) {
          this.status = SESSION_STATUS.WAITING_HUMAN;
          this.emit("escalation", { reason: "Agent requested human guidance", message: publishedMsg });
          break;
        }

        if (
          result.content.includes("ALL_TASKS_COMPLETED") ||
          result.content.includes("PROJECT_COMPLETE") ||
          (isArchitect && result.content.includes("GOAL_ACHIEVED"))
        ) {
          this.status = SESSION_STATUS.COMPLETED;
          this.emit("session:completed", { turnCount: this.turnCount });
          break;
        }

        // Handoff to next agent
        if (nextTarget === this.architectName) {
          nextTarget = recipient;
        } else {
          // Worker completed turn -> perform automated lane verification
          if (this.autoVerify) {
            const verification = verifyAgentWork({
              agentName: nextTarget,
              manifest: this.manifest,
              cwd: adapter.worktreeDir || this.repoRoot,
            });

            if (!verification.passed) {
              // Post system warning directly to worker to self-correct
              this.bus.publish({
                sender: "system",
                receiver: nextTarget,
                role: ROLES.SYSTEM,
                type: MESSAGE_TYPES.SYSTEM_EVENT,
                content: `⚠️ LANE VIOLATION DETECTED:\n${verification.summary}\nYou must undo changes to unauthorized files immediately.`,
              });
              // Keep nextTarget as the worker so it fixes its mistake
              continue;
            }
          }

          // Handoff back to Architect for code review
          nextTarget = this.architectName;
        }
      }

      if (this.turnCount >= this.maxTurns && this.status === SESSION_STATUS.RUNNING) {
        this.status = SESSION_STATUS.PAUSED;
        this.emit("max_turns_reached", { maxTurns: this.maxTurns });
      }
    } catch (err) {
      this.status = SESSION_STATUS.ERROR;
      this.emit("error", err);
      throw err;
    }

    return {
      status: this.status,
      turnCount: this.turnCount,
      history: this.bus.getHistory(),
    };
  }

  /**
   * Pause execution.
   */
  pause() {
    if (this.status === SESSION_STATUS.RUNNING && !this._pausePromise) {
      this._pausePromise = new Promise((resolve) => {
        this._pauseResolver = resolve;
      });
      this.status = SESSION_STATUS.PAUSED;
    }
  }

  /**
   * Resume execution.
   */
  resume() {
    if (this._pauseResolver) {
      this.status = SESSION_STATUS.RUNNING;
      this._pauseResolver();
      this._pausePromise = null;
      this._pauseResolver = null;
    }
  }

  /**
   * Inject a message from the human supervisor.
   */
  injectHumanMessage(content, target = null) {
    const receiver = target || this.architectName;
    const msg = this.bus.publish({
      sender: "human",
      receiver,
      role: ROLES.SUPERVISOR,
      type: MESSAGE_TYPES.HUMAN_INPUT,
      content,
    });

    if (this.status === SESSION_STATUS.WAITING_HUMAN || this.status === SESSION_STATUS.PAUSED) {
      this.status = SESSION_STATUS.RUNNING;
      if (this._pauseResolver) {
        this._pauseResolver();
        this._pausePromise = null;
        this._pauseResolver = null;
      }
    }

    return msg;
  }
}
