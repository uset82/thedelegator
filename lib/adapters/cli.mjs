/**
 * Headless CLI Subprocess Adapter
 *
 * Runs external agent command line tools (e.g., cursor, claude-cli, aider)
 * inside the agent's dedicated worktree directory.
 */

import { execFile } from "node:child_process";
import { BaseAdapter } from "./base.mjs";

export class CliAdapter extends BaseAdapter {
  constructor(options = {}) {
    super(options);
    this.cmd = options.cmd;
    this.args = options.args || [];
    this.timeoutMs = options.timeoutMs || 120_000;
  }

  async sendTurn({ history = [], instruction = "", extraContext = "" } = {}) {
    if (!this.cmd) {
      throw new Error(`CliAdapter for agent '${this.name}' has no command configured`);
    }

    const contextPrompt = this.formatContextMessages(history.slice(-5));
    const fullInput = [
      `[SYSTEM] You are working on repository branch for ${this.name}.`,
      extraContext ? `[CONTEXT]\n${extraContext}` : "",
      contextPrompt ? `[CONVERSATION HISTORY]\n${contextPrompt}` : "",
      instruction ? `[INSTRUCTION]\n${instruction}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return new Promise((resolve, reject) => {
      const child = execFile(
        this.cmd,
        this.args,
        {
          cwd: this.worktreeDir,
          timeout: this.timeoutMs,
          shell: process.platform === "win32",
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error && error.code !== 0 && !stdout) {
            return reject(new Error(`CLI agent '${this.cmd}' failed: ${stderr || error.message}`));
          }

          const output = stdout ? stdout.trim() : (stderr ? stderr.trim() : "Task completed.");
          resolve({
            content: output,
            metadata: {
              cmd: this.cmd,
              exitCode: error ? error.code : 0,
            },
          });
        }
      );

      if (child.stdin) {
        child.stdin.write(fullInput);
        child.stdin.end();
      }
    });
  }
}
