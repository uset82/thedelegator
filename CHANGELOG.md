# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-08-01

Four defects in the lane gate itself. Every one of them let a branch through
that should have been stopped, which is the only failure mode that matters in a
tool whose entire job is stopping branches.

Anyone on 0.1.0 should upgrade: that version reports overlapping lanes as
"verified disjoint".

### Fixed

- **Overlapping lanes were accepted whenever the glob strings differed.**
  `assertDisjoint` compared patterns with `===`, so `src/**` and `src/lib/**`
  passed as disjoint while owning the same files. Which agent won a contested
  path came down to the order agents appeared in the JSON — reordering the
  manifest reassigned ownership. `doctor` printed "lanes verified disjoint"
  over the top of it. Overlap is now decided segment by segment, with `**`
  standing for zero or more segments.

- **An agent could overwrite another agent's claim slot with CI green.**
  `everyoneMayWrite: ["claims/${agent}.md"]` scoped writes to self, but nothing
  *owned* `claims/**`, so another agent's slot fell through as "unclaimed" — a
  warning `check` does not fail on. A `${agent}` slot now belongs to its agent,
  and is checked before lanes, so it outranks a glob that merely covers the
  directory it sits in.

- **`status` reported branches as "unpushed" when they were on origin.** That
  line is only reachable after `origin/<branch>` resolves. What is missing in
  that state is the pull request, not the push, so it now says so.

- **`status` and `check` could disagree.** `status` computed lane strays with
  its own inline rule instead of `findViolations`, and so missed the claim-slot
  leak above. Both now apply one rule.

- The "no manifest found" error listed the same candidate path twice whenever
  the working directory was the repository root.

### Changed

- A claim slot now belongs to its agent even against the agent that owns the
  surrounding directory. In `examples/portfolio.manifest.json`, claude owns
  `updates/**` and could previously rewrite any agent's claim file; it no longer
  can. This is the one deliberate behaviour change, rather than a bug fix.

- Overlap detection is conservative by design: it proves two lanes are disjoint
  or reports an overlap. A false alarm costs one manifest edit; a miss hands two
  agents the same file. Sibling lanes in real manifests are unaffected —
  `src/lib/**` vs `src/api/**`, `scripts/brain-*.ts` vs `scripts/deploy-*.ts`,
  and `*-register.json` vs `*-inventory.json` all still read as disjoint.

### Added

- `globsOverlap` and `reservedSlotOwner` are exported from `lib/lanes.mjs`.
- Tests: 18 total, including one regression test per defect above and a case
  asserting that declaration order cannot change an overlap verdict.
- `prepublishOnly` runs the test suite, so a red tree cannot be published.

## [0.1.0] — 2026-08-01

Initial release. `init`, `doctor`, `check`, `status` and `prompts`, disjoint
lanes enforced in CI, and status derived from git rather than self-reported.

[0.2.0]: https://github.com/uset82/thedelegator/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/uset82/thedelegator/releases/tag/v0.1.0
