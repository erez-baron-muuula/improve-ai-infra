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
| 3 — code review, two passes | **Round 1 done. Round 2: Pass A done 2026-08-04, found 5 — NOT yet fixed. Pass B round 2 not run.** Round 1: Pass A found 6, Pass B (independent, opus, cold) found 3 material + 10 advisory; all fixed. Round 2 Pass A's 5 findings are listed below and are the first work of the next session. |
| 4 — live-verify | Partly done via the 50-case harness. Still owed: the **pass-consumption assertion** in a fixture tree (single-line consumes, multi-line defers) and the two-session live cases in `design-v7.md` §6 phase B. |
| 4a — antivirus survival | **Not applicable** — this change launches no background process, spawns nothing, registers no scheduled task. |
| 5 — attest + approve | Not reached. |
| 6 — mint pass | Not reached. |
| 7 — apply | Not reached. Two targets, so **two passes**: the new hook file, and `settings.json`. |
| 8 — verify installed | Not reached. |

## Resume in this order

1. **Fix the five round-2 Pass A findings** in "Round 2 Pass A findings" below. Start here — the
   review has already run; do NOT ask Erez for another `/code-review` until after Pass B round 2.
2. **Re-run Pass B** — Agent tool, `subagent_type: check-reviewer`, `model: opus`, briefed
   adversarially, given only the file. Do not leak Pass A's findings into its brief.
   Then: if the round-2 fixes were non-trivial, the skill requires BOTH passes AGAIN — which needs
   Erez to type `/code-review` a third time, since it is `disable-model-invocation`. Judge honestly.
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

## Round 2 Pass A findings (2026-08-04) — OPEN, fix these first

All five are in `concurrent-session-warn.js`. Line numbers are as of the reviewed version; re-locate
by the quoted code, not the number. Nothing here has been fixed yet.

1. **`:634` — an unreadable edit log silently disables the folder half.** `readTail()` returns `null`
   for BOTH "log absent" (normal) and "log unreadable" (broken: permissions, an exclusive share-mode
   hold, a future rotation), and `folderHalf` returns on `null` with no `degradedNote` and no
   `logEvent`. There is no `NOTE_TEXT` key for the condition at all (only `edit-log-window-unparsable`
   and `edit-log-tail-capped`), so it is unrepresentable, not merely throttled. Consequence: the
   three-week review reads zero folder firings and cannot tell it from "no collisions" — the exact
   ambiguity design-v7 §1 names as a standing constraint. Fix: have `readTail` distinguish ENOENT
   from every other failure and give the latter its own note + log line.
2. **`:291` — a transient presence-map read error is reported as permanent corruption.**
   `readPresenceMap()` maps every non-`ENOENT` read error to `state:'unparsable'`. On Windows,
   `MoveFileExW` with REPLACE_EXISTING (our own `renameSync` at `:456`, run by another session) can
   make a concurrent open-for-read fail with `ERROR_SHARING_VIOLATION`/`ERROR_ACCESS_DENIED`. The
   ticket half's read at `:529` is OUTSIDE `withMapLock`, so it is exposed; the write path's read is
   inside the lock and is safe. Result: the "must be repaired or deleted by hand" note fires on a
   healthy file, unthrottled (once per ticket-naming prompt), and that prompt's registration is
   skipped. Fix: a distinct `unreadable` state — log it, skip silently or retry once, do not claim
   corruption.
3. **`:373` — the lock leaks when the holder-pid write fails, jamming every writer for 5 s.** If
   `fs.writeSync(fd, mine)` throws after `openSync(lock,'wx')` succeeded, the lock file exists but is
   empty; the `finally` only unlinks when the content equals our pid, so it is never released —
   contradicting the comment at `:355` ("release immediately rather than holding a lock nobody can
   adjudicate"). Other writers read `holder=''` → `holderPid=NaN` → fall to the age branch, and since
   `LOCK_ATTEMPTS`(40) × ~7 ms ≈ 280 ms per invocation, no single hook can outwait `STALE_LOCK_MS`
   (5000). So every ticket-naming prompt in every session skips registration for a full 5 s. Fix:
   track ownership in a variable rather than by re-reading the file, and unlink on the `!ok` path.
4. **`:141` — the `readFailures` rationale is contradicted by the live registry.** The comment asserts
   Claude Code rewrites `~/.claude/sessions/*.json` mid-session, opening a `writeFileSync` truncation
   window. Measured 2026-08-04: all 8 live records have `mtime` within ~1.3 s of their own
   `startedAt`, including `13352.json` (startedAt 06:02:47Z, mtime 06:02:48Z) whose pid was still
   alive >24 h later — written once at startup, never rewritten. Keep the guard (any single unreadable
   file genuinely is not proof of absence) but restate its reason. The false model also conceals a
   real consequence: since the record is never rewritten, `g.me.cwd` is the session's STARTUP cwd
   forever, so the folder half's containment gate at `:622` silently covers the wrong tree for any
   session that later changes directory. Decide whether that is a disclosed residual or needs a fix,
   and say so in design-v7 §7.
5. **`:686` — the file count is deduped case-sensitively.** `h.files.indexOf(o.file)` compares raw
   paths while every other comparison in that loop is case-folded (`auto-approve.js` logs
   `path.resolve(input.cwd, p)`, which preserves the caller's letter case). One file recorded under
   two casings is counted twice, so a single collided file reports "(2 files since it started)".
   Cosmetic, but it overstates the collision in the one sentence Erez is asked to act on.

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
- Round 2 Pass A (5, still OPEN): see "Round 2 Pass A findings" above. Note the pattern — three of
  the five (1, 2, 3) are again in the post-design lock/write path, and finding 1 is the same CLASS
  as round 1's "every dropped-registration path silent" (a break that presents as ordinary silence),
  reached by a different route. That class is not yet fully closed; sweep for it deliberately rather
  than fixing only the instance named.
