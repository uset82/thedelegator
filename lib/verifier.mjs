/**
 * TheDelegator Auto-Verification & Lane Gatekeeper
 *
 * Checks git diffs, file modifications, and runs lane verification after every agent turn.
 */

import { execFileSync } from "node:child_process";
import { findViolations } from "./lanes.mjs";

function runGit(args, cwd = process.cwd()) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

/**
 * Verifies a worktree or branch for an agent against manifest lanes.
 *
 * @param {Object} options
 * @param {string} options.agentName - The agent being checked
 * @param {Object} options.manifest - The loaded manifest
 * @param {string} [options.cwd] - Working directory (repo root or agent worktree)
 * @param {string} [options.base] - Git base ref (default: origin/defaultBranch or defaultBranch)
 * @returns {Object} Verification outcome
 */
export function verifyAgentWork({ agentName, manifest, cwd = process.cwd(), base = null }) {
  const defaultBranch = manifest.defaultBranch || "main";
  const baseRef = base || `origin/${defaultBranch}`;

  // Find merge base or fallback to baseRef
  const mergeBase = runGit(["merge-base", baseRef, "HEAD"], cwd) || runGit(["merge-base", defaultBranch, "HEAD"], cwd) || baseRef;

  // Uncommitted + committed changes compared to base
  const changedRaw = runGit(["diff", "--name-only", `${mergeBase}...HEAD`], cwd);
  const uncommittedRaw = runGit(["status", "--porcelain"], cwd);

  const changedCommitted = changedRaw ? changedRaw.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  const uncommittedFiles = uncommittedRaw
    ? uncommittedRaw
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter(Boolean)
    : [];

  const allChanged = [...new Set([...changedCommitted, ...uncommittedFiles])];

  if (allChanged.length === 0) {
    return {
      passed: true,
      hasChanges: false,
      changedFiles: [],
      violations: [],
      unclaimed: [],
      diffStat: "No changes detected",
      summary: "Clean working tree, no modifications.",
    };
  }

  const { violations, unclaimed } = findViolations(allChanged, agentName, manifest);
  const passed = violations.length === 0;

  const diffStat = runGit(["diff", "--stat", `${mergeBase}...HEAD`], cwd) || "Changes present";

  let summary = "";
  if (passed) {
    summary = `✅ Lane check PASSED. ${allChanged.length} file(s) changed within assigned lane.`;
    if (unclaimed.length > 0) {
      summary += ` (Note: ${unclaimed.length} unclaimed path(s): ${unclaimed.join(", ")})`;
    }
  } else {
    summary = `❌ Lane check FAILED. Agent '${agentName}' modified ${violations.length} file(s) outside its lane:\n` +
      violations.map((v) => `  - ${v.path} (belongs to: ${v.agent || "shared/nobody"})`).join("\n");
  }

  return {
    passed,
    hasChanges: true,
    changedFiles: allChanged,
    violations,
    unclaimed,
    diffStat,
    summary,
  };
}
