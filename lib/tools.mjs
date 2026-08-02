/**
 * Agent preflight — can the agent actually run at all?
 *
 * `doctor` used to verify git, worktrees and lanes, then report "Ready. Every
 * agent can work." without ever checking whether the agents existed. A manifest
 * can hand gemini a lane on a machine with no gemini installed, and nothing said
 * so. Same class of false green the lane checks had.
 *
 * Nothing here knows the name of a single vendor. The manifest declares the
 * command, so a tool this file has never heard of works without a code change.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, delimiter, isAbsolute } from "node:path";

/** Probing costs a process spawn, so cap how long a wedged CLI can hold doctor up. */
export const PROBE_TIMEOUT_MS = 20_000;

/**
 * `"tool": "codex"` and `"tool": { "cmd": "cursor", "args": ["--version"] }`
 * mean the same thing. Agents without a `tool` are skipped, so existing
 * manifests keep working untouched.
 */
export function toolSpec(agent = {}) {
  const t = agent.tool;
  if (!t) return null;
  if (typeof t === "string") return t.trim() ? { cmd: t.trim(), args: ["--version"] } : null;
  if (typeof t === "object" && typeof t.cmd === "string" && t.cmd.trim()) {
    return { cmd: t.cmd.trim(), args: Array.isArray(t.args) ? t.args : ["--version"] };
  }
  return null;
}

/**
 * Where does `cmd` live? Resolved by reading PATH rather than by spawning, so
 * "not installed" is a fact we establish before running anything.
 */
export function resolveOnPath(cmd, env = process.env) {
  if (cmd.includes("/") || cmd.includes("\\") || isAbsolute(cmd)) {
    return existsSync(cmd) ? cmd : null;
  }
  const dirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  // "" first: an extensionless launcher is common even on Windows. Then PATHEXT,
  // which is how `codex` and `cursor` resolve — both ship as `.cmd` shims.
  const exts =
    process.platform === "win32"
      ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)]
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Run the declared command and report what came back.
 *
 * `shell` on Windows because npm and app shims are `.cmd` files, which Node
 * refuses to spawn directly. The command comes from the project's own manifest,
 * which is the same trust level as a package.json script.
 */
export function probeTool(spec, env = process.env) {
  const path = resolveOnPath(spec.cmd, env);
  if (!path) return { status: "missing", detail: `\`${spec.cmd}\` is not on PATH` };
  try {
    const out = execFileSync(spec.cmd, spec.args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: PROBE_TIMEOUT_MS,
      shell: process.platform === "win32",
      env,
    });
    const line = out.split("\n").map((s) => s.trim()).find(Boolean);
    return { status: "ok", detail: line || "responded", path };
  } catch (e) {
    const why = e.signal === "SIGTERM" ? `no answer in ${PROBE_TIMEOUT_MS / 1000}s` : `exited with an error`;
    return { status: "error", detail: `found at ${path} but ${why}`, path };
  }
}

/** Every agent that declared a tool, in manifest order, with its probe result. */
export function probeAgents(manifest, env = process.env) {
  return Object.entries(manifest.agents ?? {}).flatMap(([name, agent]) => {
    const spec = toolSpec(agent);
    return spec ? [{ name, spec, ...probeTool(spec, env) }] : [];
  });
}
