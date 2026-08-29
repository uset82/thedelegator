/**
 * TheDelegator Model Context Protocol (MCP) Server
 *
 * Exposes tools for Claude Code, Cursor, Codex, and Antigravity to connect
 * autonomously to the live chat room, receive tasks, and report diffs.
 */

import { createServer } from "node:http";
import { findViolations } from "./lanes.mjs";
import { createMessage, MESSAGE_TYPES, ROLES } from "./protocol.mjs";

export function createMcpServer({ orchestrator, port = 4142 }) {
  const tools = [
    {
      name: "delegator_connect",
      description: "Connect this agent/IDE to TheDelegator live chat hub and register assigned lane paths.",
      inputSchema: {
        type: "object",
        properties: {
          agentName: { type: "string", description: "Name of the agent/IDE (e.g. 'cursor', 'codex', 'antigravity')" },
          role: { type: "string", enum: ["builder", "architect", "triage", "media"], default: "builder" },
          branch: { type: "string", description: "Active worktree git branch (e.g. 'feat/platform')" },
          lanePaths: { type: "array", items: { type: "string" }, description: "Glob paths owned by this agent (e.g. ['app/**', 'src/**'])" },
        },
        required: ["agentName"],
      },
    },
    {
      name: "delegator_send_message",
      description: "Send a message, progress report, question, or review request to Claude or other agents in the live chat.",
      inputSchema: {
        type: "object",
        properties: {
          sender: { type: "string", description: "Your agent name" },
          receiver: { type: "string", description: "Target agent (e.g. 'claude', 'all')", default: "all" },
          type: { type: "string", enum: ["progress_report", "question", "review_request", "spec"], default: "progress_report" },
          content: { type: "string", description: "Markdown message content or report" },
          commit: { type: "string", description: "Optional commit SHA" },
        },
        required: ["sender", "content"],
      },
    },
    {
      name: "delegator_get_messages",
      description: "Get recent conversation history and instructions from Claude and the team.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", default: 10 },
        },
      },
    },
    {
      name: "delegator_check_lane",
      description: "Verify that all changed files in the working directory stay strictly inside this agent's assigned lane.",
      inputSchema: {
        type: "object",
        properties: {
          agentName: { type: "string", description: "Your agent name" },
          changedFiles: { type: "array", items: { type: "string" }, description: "List of modified file paths" },
        },
        required: ["agentName", "changedFiles"],
      },
    },
  ];

  async function handleToolCall(name, args) {
    if (name === "delegator_connect") {
      const { agentName, role = "builder", branch, lanePaths = [] } = args;
      if (!orchestrator.manifest.agents) orchestrator.manifest.agents = {};
      orchestrator.manifest.agents[agentName] = {
        role,
        branch: branch || `feat/${agentName}`,
        owns: lanePaths.length ? lanePaths : [`src/${agentName}/**`],
        title: `${agentName.toUpperCase()} Agent`,
      };

      return { success: true, message: `Connected as ${agentName}`, manifest: orchestrator.manifest.agents[agentName] };
    }

    if (name === "delegator_send_message") {
      const { sender, receiver = "all", type = MESSAGE_TYPES.PROGRESS_REPORT, content, commit } = args;
      const msg = orchestrator.bus.publish({
        sender,
        receiver,
        type,
        content,
        metadata: { commit },
      });
      return { success: true, messageId: msg.id, timestamp: msg.timestamp };
    }

    if (name === "delegator_get_messages") {
      const { limit = 10 } = args;
      const history = orchestrator.bus.getHistory({ limit });
      return { messages: history };
    }

    if (name === "delegator_check_lane") {
      const { agentName, changedFiles } = args;
      const { violations, unclaimed } = findViolations(changedFiles, agentName, orchestrator.manifest);
      return {
        passed: violations.length === 0,
        violations,
        unclaimed,
        summary: violations.length === 0 ? "Lane check PASSED" : `Violations: ${violations.map(v => v.path).join(", ")}`,
      };
    }

    throw new Error(`Unknown tool '${name}'`);
  }

  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/mcp/tools" && req.method === "GET") {
      res.writeHead(200);
      res.end(JSON.stringify({ tools }));
      return;
    }

    if (url.pathname === "/mcp/call" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { name, arguments: args } = JSON.parse(body || "{}");
          const result = await handleToolCall(name, args || {});
          res.writeHead(200);
          res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }));
        } catch (err) {
          res.writeHead(400);
          res.end(JSON.stringify({ isError: true, content: [{ type: "text", text: err.message }] }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not Found" }));
  });

  return {
    server,
    listen: (customPort = port) =>
      new Promise((resolve) => {
        server.listen(customPort, () => {
          resolve(`http://localhost:${customPort}`);
        });
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
