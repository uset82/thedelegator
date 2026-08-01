/**
 * Lane resolution — the whole idea of the delegator, in one file.
 *
 * A path belongs to exactly one agent. If two agents can write the same path,
 * you do not have lanes, you have a race. `assertDisjoint` refuses that setup.
 */

/** Minimal glob → RegExp. Supports `**`, `*`, `?`. No dependencies. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          // `**/` in the middle: zero or more directories. `**/x` must match `x`.
          i++;
          re += "(?:.*/)?";
        } else {
          // `**` at the end: everything below this point.
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$+.()|{}[]".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

export const matches = (path, globs = []) => globs.some((g) => globToRegExp(g).test(path));

/**
 * Who owns this path?
 * Shared paths resolve first and always to one owner — that is the point of them.
 * Returns null for unclaimed paths, which is a signal, not an error: an unclaimed
 * path is nobody's job, and nobody's job is how things rot.
 */
export function ownerOf(path, manifest) {
  if (manifest.shared?.paths && matches(path, manifest.shared.paths)) {
    return { agent: manifest.shared.owner, shared: true };
  }
  for (const [name, agent] of Object.entries(manifest.agents ?? {})) {
    if (matches(path, agent.owns ?? [])) return { agent: name, shared: false };
  }
  return null;
}

/** Paths every agent may write, scoped to itself — claim files and the like. */
export function everyoneMayWrite(path, agentName, manifest) {
  const globs = (manifest.everyoneMayWrite ?? []).map((g) => g.replaceAll("${agent}", agentName));
  return matches(path, globs);
}

/**
 * A `${agent}` entry reserves one path per agent — it does not open the whole
 * directory. `claims/gemini.md` is gemini's, so codex writing it is a violation,
 * not an unclaimed path. Without this, the slot leaks: nothing *owns* `claims/**`,
 * so the gate saw "nobody's job" and passed the branch.
 *
 * Entries without a `${agent}` placeholder are genuinely shared and belong to
 * nobody in particular, so they return null.
 */
export function reservedSlotOwner(path, manifest) {
  const templates = (manifest.everyoneMayWrite ?? []).filter((t) => t.includes("${agent}"));
  if (!templates.length) return null;
  for (const name of Object.keys(manifest.agents ?? {})) {
    if (matches(path, templates.map((t) => t.replaceAll("${agent}", name)))) return name;
  }
  return null;
}

/**
 * The core check. Given the files a branch changed, which ones were not that
 * agent's to touch?
 */
export function findViolations(changedPaths, agentName, manifest) {
  const violations = [];
  const unclaimed = [];
  for (const path of changedPaths) {
    if (everyoneMayWrite(path, agentName, manifest)) continue;

    // Checked before lanes: a reserved slot is more specific than any glob that
    // happens to cover the directory it sits in.
    const slot = reservedSlotOwner(path, manifest);
    if (slot && slot !== agentName) {
      violations.push({ path, agent: slot, shared: false, reserved: true });
      continue;
    }

    const owner = ownerOf(path, manifest);
    if (!owner) unclaimed.push(path);
    else if (owner.agent !== agentName) violations.push({ path, ...owner });
  }
  return { violations, unclaimed };
}

/**
 * Do two single segments — `*`, `?` and literals, never `/` — share any string?
 *
 * Deliberately conservative: it proves disjointness or gives up and says yes.
 * A false alarm costs one manifest edit; a miss hands two agents the same file,
 * which is the entire failure this tool exists to prevent.
 */
function segmentsOverlap(a, b) {
  if (a === b) return true;

  const fitsAt = (small, large, offset = 0) =>
    [...small].every((ch, i) => ch === "?" || large[i + offset] === "?" || ch === large[i + offset]);

  // Only `?` wildcards: same length, every position compatible.
  if (!a.includes("*") && !b.includes("*")) {
    return a.length === b.length && fitsAt(a, b);
  }

  // With `*` in play, the literal head and tail either side of the wildcards
  // must still be able to line up. Necessary, not sufficient — hence conservative.
  const head = (s) => (s.includes("*") ? s.slice(0, s.indexOf("*")) : s);
  const tail = (s) => (s.includes("*") ? s.slice(s.lastIndexOf("*") + 1) : s);

  const [shortHead, longHead] = [head(a), head(b)].sort((x, y) => x.length - y.length);
  if (!fitsAt(shortHead, longHead)) return false;

  const [shortTail, longTail] = [tail(a), tail(b)].sort((x, y) => x.length - y.length);
  return fitsAt(shortTail, longTail, longTail.length - shortTail.length);
}

/**
 * Could one path match both globs? `**` stands for zero or more segments, so
 * `src/**` and `src/lib/**` overlap even though the strings differ.
 */
export function globsOverlap(a, b) {
  const walk = (x, y) => {
    if (!x.length || !y.length) return x.every((s) => s === "**") && y.every((s) => s === "**");
    // `**` either matches nothing here, or swallows one segment of the other side.
    if (x[0] === "**") return walk(x.slice(1), y) || walk(x, y.slice(1));
    if (y[0] === "**") return walk(x, y.slice(1)) || walk(x.slice(1), y);
    return segmentsOverlap(x[0], y[0]) && walk(x.slice(1), y.slice(1));
  };
  return walk(a.split("/"), b.split("/"));
}

/**
 * Refuse a manifest whose lanes overlap. Two agents able to write the same path
 * is not a warning — it is the failure this tool exists to prevent, so it is fatal.
 *
 * Comparing glob strings for equality was not enough: `src/**` and `src/lib/**`
 * are different strings that own the same files, and which agent won `src/lib/x`
 * came down to the order the agents happened to be declared in.
 */
export function assertDisjoint(manifest) {
  const names = Object.keys(manifest.agents ?? {});
  const problems = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      for (const ga of manifest.agents[names[i]].owns ?? []) {
        for (const gb of manifest.agents[names[j]].owns ?? []) {
          if (!globsOverlap(ga, gb)) continue;
          problems.push(
            ga === gb
              ? `${names[i]} and ${names[j]} both own "${ga}"`
              : `${names[i]}'s "${ga}" overlaps ${names[j]}'s "${gb}"`,
          );
        }
      }
    }
  }
  return problems;
}
