# GEN-615 + GEN-620 — where this stands, and how to resume

Written 2026-08-04 so this survives a `/compact`. If you are picking this up cold, read this
file first, then `design-v7.md` (the design of record).

## What is done

- **Design:** `design-v7.md`, converged over **six `/check` rounds** (v1→v7; earlier versions kept
  as the review record). Rounds 5 and 6 each returned PASS from the soundness and proportionality
  lenses; the failure-mode lens raised one material finding in each, both fixed.
- **Implementation:** `concurrent-session-warn.js` — the hook, **staged, NOT installed**. It is in
  this project folder, not in `~/.claude/hooks/`. Nothing is running.
- **Tests:** `test-concurrent-session-warn.js` — 50 cases, all passing. Runs against a throwaway
  `CONCSESS_TEST_ROOT`, never against real `~/.claude` state.
- **Tickets:** GEN-615 and GEN-620 both **In Progress**.

## Where the `/vet-code` flow stands

| Step | State |
|---|---|
| 0 — gate self-check | Done. `enforceVetting` + `findVettingPassFile` present in `auto-approve.js`. **`/code-review` is `disable-model-invocation`: only Erez can start it.** |
| 1 — `/check` on the design | Done as the six rounds above. **A fresh `/check` is still owed on the three build-time deviations** (see below) before Step 1b's record can cite it honestly. |
| 1b — vetting record | **Not written yet.** Needs the `check-reviewer` agentIds from the Step-1 panel that covers the deviations. |
| 2 — working copy | Done (the staged file). |
| 3 — code review, two passes | **Round 1 done, round 2 owed.** Pass A (Erez's `/code-review`) found 6; Pass B (independent, opus, cold) found 3 material + 10 advisory. All fixed. Fixes were non-trivial, so the skill requires **re-running BOTH passes**. |
| 4 — live-verify | Partly done via the 50-case harness. Still owed: the **pass-consumption assertion** in a fixture tree (single-line consumes, multi-line defers) and the two-session live cases in `design-v7.md` §6 phase B. |
| 4a — antivirus survival | **Not applicable** — this change launches no background process, spawns nothing, registers no scheduled task. |
| 5 — attest + approve | Not reached. |
| 6 — mint pass | Not reached. |
| 7 — apply | Not reached. Two targets, so **two passes**: the new hook file, and `settings.json`. |
| 8 — verify installed | Not reached. |

## Resume in this order

1. **Erez types `/code-review`** (Pass A, round 2). Fix anything it finds.
2. **Re-run Pass B** — Agent tool, `subagent_type: check-reviewer`, `model: opus`, briefed
   adversarially, given only the file. Do not leak Pass A's findings into its brief.
3. **Run `/check`** on the three deviations from `design-v7.md` that the build introduced, then
   write the Step-1b vetting record citing that panel's real agentIds.
4. **Finish Step 4**: the pass-consumption assertion in a fixture tree, then phase B's two-session
   cases. Phase B must be a **cross-project** pairing (one session in each of two project folders,
   the first having written into the second's tree) or two of its cases cannot run.
5. **Step 5** attest to Erez → **Step 6** mint (two passes) → **Step 7** apply → **Step 8** verify.
6. **File the noise-review follow-up ticket** at install time, with a three-week self-trigger and
   BOTH bars from `design-v7.md` §4 — including the *lower* bar (zero ticket-half firings in three
   weeks is suspect, not reassuring) and the calibration caveat.
7. Close GEN-615 and GEN-620 as **Done** on the phase A + B demonstration, but only if step 8 below
   settled the two open unknowns.

## Three build-time deviations from design-v7.md — these need the Step-1 `/check`

1. **A lock replaces the accepted lost-update window.** §3b step 4 of the design accepted a bare
   re-read-and-merge because the window was "vanishingly narrow". Measured, it is not: with six
   concurrent writers **only two of six registrations survived**. The write is now serialised by a
   lock file whose holder pid is checked for liveness before it can be broken. All six survive.
2. **Two performance changes.** Per-row `path.dirname`/`path.resolve` over the edit log cost ~224 ms
   per call on a hook that fires on every file tool call; replaced with normalized string prefix
   matching. (An earlier payload-`cwd` pre-filter was reverted during code review — it ANDed two
   containment roots that can diverge.) Per-call cost is now ~40 ms on top of node's own 485 ms
   startup on this machine.
3. **A `CONCSESS_TEST_ROOT` env override** relocates all four paths for testing, so the harness can
   fabricate a corrupt map, an oversized log and a registry missing this session — without touching
   the real `auto-approved-edits.jsonl`, which a standing reporting rule reads. No-op when unset.

## Two unknowns still open (design-v7.md §7, and §6 step 0)

Neither could be settled from stored artifacts; both are assigned to the build:

1. **Does a resumed session keep its `sessionId`?** If it does not, its ticket registration is
   pruned on resume and never re-created, and a long-running session goes unregistered — GEN-615's
   own incident, silently. Phase B has a resume case for this.
2. **Does every session `kind` write a `~/.claude/sessions/*.json`?** All 8 live records read
   `kind: "interactive"`, which is direct evidence other kinds exist. A kind that writes no file
   would trip the self-presence gate and emit one degraded note per session.

## Install-step details easy to lose

- The `settings.json` hooks entry must match **`Read|Edit|Write|MultiEdit|NotebookEdit`**. The
  sibling `inject-edit-refs.js` entry omits `MultiEdit`; copying it verbatim makes that fix inert.
- Register **two events**: `UserPromptSubmit` and `PreToolUse`.
- Apply must be a **single line** — `enforceVetting` scores any multi-line command as ambiguous and
  returns without consuming the pass, leaving it live until TTL.
- `settings.json` is locked: apply via `update-config.ps1`, not a direct edit.

## Review-findings history (so a re-review can tell recurrence from a new issue)

- Design rounds 1–4 removed: a 120-minute folder window, a 24-hour map expiry, a `cwd` filter on the
  ticket half, a self-exclusion inside the liveness set, a mandatory `procStart` check.
- Round 5 added `agent_id` to the dedupe keys: sub-agents carry the parent's `session_id`, so a
  sub-agent's read was consuming the parent's one-per-folder warning slot.
- Round 6 fixed a false coverage claim (§7 cited a §6 test that the restructure had dropped).
- Code review Pass A (6): null `lastFile` crash; cap-note comparing against all live sessions;
  double containment root; missing `MultiEdit`; ignored `readSync` return; unreachable pid branch.
- Code review Pass B (3 material): an unreadable session file treated as proof of absence, so
  pruning deleted a live session's registrations; every dropped-registration path silent; the
  stale-lock breaker able to steal a live lock and then have its release unlink the new holder's.
