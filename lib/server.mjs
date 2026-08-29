/**
 * TheDelegator Local Live Chat & Spectator Server
 *
 * Lightweight, zero-dependency HTTP + SSE server.
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MockAdapter } from "./adapters/mock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export function createBridgeServer({ orchestrator, port = 4141 }) {
  const clients = new Set();
  const uiPath = join(HERE, "..", "templates", "ui", "index.html");

  // Subscribe to bus and orchestrator events to broadcast via SSE
  orchestrator.bus.on("message", (msg) => {
    broadcast({ type: "message", payload: msg });
  });

  orchestrator.on("session:start", (data) => broadcast({ type: "status", status: "running", data }));
  orchestrator.on("session:paused", () => broadcast({ type: "status", status: "paused" }));
  orchestrator.on("session:completed", (data) => broadcast({ type: "status", status: "completed", data }));
  orchestrator.on("escalation", (data) => broadcast({ type: "status", status: "waiting_human", data }));

  function broadcast(data) {
    const raw = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      res.write(raw);
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    // CORS headers for local integration
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Serve HTML UI
    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (existsSync(uiPath)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(readFileSync(uiPath, "utf8"));
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("UI template not found");
      }
      return;
    }

    // Serve Static UI Assets (PNGs, SVGs)
    if (url.pathname.endsWith(".png") || url.pathname.endsWith(".svg") || url.pathname.endsWith(".jpg")) {
      const assetPath = join(orchestrator.repoRoot, "templates", "ui", url.pathname.replace(/^\//, ""));
      if (existsSync(assetPath)) {
        const mime = url.pathname.endsWith(".svg") ? "image/svg+xml" : url.pathname.endsWith(".jpg") ? "image/jpeg" : "image/png";
        res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=3600" });
        res.end(readFileSync(assetPath));
        return;
      }
    }

    // SSE Stream
    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      clients.add(res);

      req.on("close", () => clients.delete(res));
      return;
    }

    // Get History
    if (url.pathname === "/api/history" && req.method === "GET") {
      const history = orchestrator.bus.getHistory();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(history));
      return;
    }

    // Get Status
    if (url.pathname === "/api/status" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: orchestrator.status,
          turnCount: orchestrator.turnCount,
          activeAgent: orchestrator.activeAgent,
          goal: orchestrator.currentGoal,
          agents: Object.keys(orchestrator.manifest?.agents || {}),
        })
      );
      return;
    }

    // Get Agents List & Configurations
    if (url.pathname === "/api/agents" && req.method === "GET") {
      const shared = orchestrator.manifest?.shared || { owner: "claude", paths: ["package.json", "docs/**"] };
      const agents = orchestrator.manifest?.agents || {};

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ shared, agents }));
      return;
    }

    // Add or Update Agent / IDE
    if (url.pathname === "/api/agents" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { name, role = "builder", branch, owns = [], title = "", color = "blue", icon = "🤖" } = JSON.parse(body || "{}");
          if (!name || !name.trim()) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing agent name" }));
            return;
          }
          const cleanName = name.trim().toLowerCase();
          if (!orchestrator.manifest.agents) orchestrator.manifest.agents = {};

          const laneArray = Array.isArray(owns)
            ? owns
            : typeof owns === "string"
            ? owns.split(",").map((s) => s.trim()).filter(Boolean)
            : [`src/${cleanName}/**`];

          const newAgentObj = {
            role,
            branch: branch || `feat/${cleanName}`,
            owns: laneArray.length ? laneArray : [`src/${cleanName}/**`],
            title: title || `${name} Agent`,
            color: color || "blue",
            icon: icon || "🤖",
          };

          orchestrator.manifest.agents[cleanName] = newAgentObj;

          // Save manifest to disk so it persists permanently
          const manifestFilePath = join(orchestrator.repoRoot, "agents.manifest.json");
          try {
            writeFileSync(manifestFilePath, JSON.stringify(orchestrator.manifest, null, 2), "utf8");
          } catch (err) {
            console.warn(`[server] Could not write manifest file: ${err.message}`);
          }

          // Register adapter in orchestrator
          try {
            orchestrator.registerAdapter(cleanName, new MockAdapter({ name: cleanName, role, manifest: orchestrator.manifest }));
          } catch {}

          broadcast({ type: "agent_added", name: cleanName, agent: newAgentObj });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, name: cleanName, agent: newAgentObj }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Delete a specific agent / IDE
    if (url.pathname === "/api/agents" && req.method === "DELETE") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { name } = JSON.parse(body || "{}");
          const queryName = url.searchParams.get("name") || name;
          if (!queryName) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing agent name to delete" }));
            return;
          }
          const cleanName = queryName.trim().toLowerCase();
          if (orchestrator.manifest.agents && orchestrator.manifest.agents[cleanName]) {
            delete orchestrator.manifest.agents[cleanName];

            const manifestFilePath = join(orchestrator.repoRoot, "agents.manifest.json");
            try {
              writeFileSync(manifestFilePath, JSON.stringify(orchestrator.manifest, null, 2), "utf8");
            } catch (err) {
              console.warn(`[server] Could not write manifest file: ${err.message}`);
            }

            broadcast({ type: "agent_added" });
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, deleted: cleanName }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Reset all registered agents
    if (url.pathname === "/api/agents/reset" && req.method === "POST") {
      orchestrator.manifest.agents = {};
      const manifestFilePath = join(orchestrator.repoRoot, "agents.manifest.json");
      try {
        writeFileSync(manifestFilePath, JSON.stringify(orchestrator.manifest, null, 2), "utf8");
      } catch (err) {
        console.warn(`[server] Could not write manifest file: ${err.message}`);
      }
      broadcast({ type: "agent_added" });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, agents: {} }));
      return;
    }

    // Post Message (from Human Supervisor)
    if (url.pathname === "/api/message" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { content, target, sender } = JSON.parse(body || "{}");
          if (!content) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing content" }));
            return;
          }
          // A named sender speaks as itself; anything else is the human.
          const msg = sender
            ? orchestrator.injectAgentMessage(sender, content, target)
            : orchestrator.injectHumanMessage(content, target);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, message: msg }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Pause
    if (url.pathname === "/api/pause" && req.method === "POST") {
      orchestrator.pause();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, status: orchestrator.status }));
      return;
    }

    // Git Diff Inspector
    if (url.pathname === "/api/diff" && req.method === "GET") {
      try {
        const diff = execFileSync("git", ["diff", "HEAD"], {
          cwd: orchestrator.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stat = execFileSync("git", ["diff", "--stat", "HEAD"], {
          cwd: orchestrator.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        const status = execFileSync("git", ["status", "--short"], {
          cwd: orchestrator.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ diff: diff || "No modified files", stat: stat || "Clean branch", status: status || "Nothing unstaged" }));
      } catch (err) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ diff: "Git repository clean", stat: "", status: "" }));
      }
      return;
    }

    // Taskplan reader
    if (url.pathname === "/api/taskplan" && req.method === "GET") {
      const taskplanPath = join(orchestrator.repoRoot, "taskplan.md");
      const delegationPromptPath = join(orchestrator.repoRoot, "DELEGATION-PROMPT.md");
      let content = "";
      if (existsSync(taskplanPath)) content = readFileSync(taskplanPath, "utf8");
      else if (existsSync(delegationPromptPath)) content = readFileSync(delegationPromptPath, "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ content }));
      return;
    }

    // Trigger autonomous turn
    if (url.pathname === "/api/trigger-turn" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { goal = "Review current workspace and implement next pending task", worker = null } = JSON.parse(body || "{}");
          if (orchestrator.status !== "running") {
            orchestrator.start({ goal, initialWorker: worker }).catch((err) => {
              console.error("[bridge] turn error:", err.message);
            });
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, status: orchestrator.status }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Clear history
    if (url.pathname === "/api/clear" && req.method === "POST") {
      orchestrator.bus.clear();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 404 Fallback
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
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
