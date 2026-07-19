# GEN-373 — Build plan v1: auto-handle stray/junk files (home dir + project roots)

Ticket: GEN-373 "Auto-handle Claude session stray/junk files in the home directory AND
project roots" (Team-Tasks, AI epic GEN-86).

Status when this plan was written: converged design approved (3-round /check panel), Erez
chose rollout option **A** (build both parts; ship report-only first; graduate to full auto —
hard-delete in project roots, quarantine-move in home — once the junk signatures prove safe).

This doc is the CONCRETE build plan derived from the converged design. It is for Erez's
approval BEFORE any code is written. Nothing here is built yet.

---

## What the /check panel established (the safety spine — do not weaken)

These are the load-bearing conclusions the review converged on. Every implementation choice
below must preserve them:

1. **"The backup ran" ≠ "this file is safe."** `backup-sweep.ps1` is best-effort and skips a
   repo (pushes no snapshot) on secret match, oversize (>100MB), mid-merge/rebase,
   unreadable/locked file, unreachable/timeout remote, the 25s deadline, or a lock-skip
   (concurrent sweep — deliberately not even queued). So project-root deletion must be gated
   on **positive per-file proof** that the exact bytes are in THIS session's pushed backup
   ref — never on the absence of a failure-queue entry.
2. **The home dir has no backup net at all.** `C:\Users\Erez\` is not a git repo (verified: no
   `.git`) and is outside the sweep's known-roots scan entirely. So home-dir handling can
   never hard-delete — it must quarantine (move aside) with a grace period.
3. **"Tight pattern" must mean provenance, not extension.** `*.txt + age` is a broad glob and
   violates the ticket's own constraint. Tightness comes from known junk name-shapes and/or a
   content signature. Age is only ever a secondary narrower, never a sole trigger.
4. **Deletion requires ALL gates together** (project roots): captured-in-backup AND untracked
   AND signature-match AND old-enough. Never any one alone.
5. **The audit log is an audit trail, not the safety mechanism.** Safety is front-loaded in the
   gates above; the log only records what happened.
6. **Zone A runs where a FRESH session-scoped backup exists.** The captured-in-backup proof
   (point 1) checks `refs/backup/<machine>/<session>/latest` — a ref tied to a live session's
   just-pushed snapshot. A standalone timer has no session and no fresh backup, so it cannot do
   Zone A's safety check against a current snapshot without first triggering its own backup.
   That is why Zone A is driven from a session context (see Scheduling below), not a bare cron.
   (Session-start itself is still wrong as the sole host: it is fail-open + throttled +
   25s-deadline, so a cleanup folded there can silently never run.)

---

## Component 1 — Prevention nudge (best-effort, advisory only)

**What it is:** a `PreToolUse` check on `Bash`/`PowerShell` calls that fires a one-line,
non-blocking warning when a shell command's redirect target LITERALLY resolves to the home dir
or a project root (rather than the scratchpad). It steers output to the session scratchpad. It
does NOT block and is NOT a safety mechanism — Component 2 is the real backstop; this only
reduces how much junk lands.

**Where the code lives — DEFAULT (needs your ok):** extend the existing `auto-approve.js`
`PreToolUse` hook rather than add a second hook file. Reason: `auto-approve.js` already parses
Bash/PowerShell commands, already splits chains, and already holds the `PROJECT_ROOTS` list —
so a second hook would duplicate fragile parsing.
- **Caveat that makes this non-trivial:** `auto-approve.js` is a LOCKED file (edits refused;
  changed only via `update-config.ps1`), and per the `vet-code` skill any hook/script change
  goes through `/check` + two code-review passes + live-verify + a minted vetting pass. So
  "extend auto-approve.js" is the cheaper *design* but still a gated *change*. Alternative if
  you'd rather not touch the locked file: a small separate advisory-only hook (more duplicated
  parsing, but keeps auto-approve.js untouched). **Default: extend auto-approve.js.**

**Scope of detection (accepted limits, stated so no one mistakes it for airtight):** catches
literal redirect forms (`>`, `>>`, `-o`, `Out-File` with a literal path). It will MISS
variable-built paths (`$out="$HOME\x"; … > $out`), relative paths resolved against an unknown
CWD, here-strings, and `Tee-Object`/piped `Export-*`. That's acceptable because it's advisory
and Component 2 cleans up whatever slips through.

**Session scratchpad path:** the warning names the current session's scratchpad. The hook must
read that per-session absolute path from session context/env at fire time — never a hardcoded
or stale path.

---

## Component 2 — Cleanup sweep (the core), self-scheduling ("smart timer")

The cleanup does NOT run every session. Each run computes when the next run is worth doing, from
the age threshold itself, and arms a one-time timer for exactly then — with a session-end safety
net so a wake missed while the app was closed still runs. See "Scheduling" below for the full
model; the two zones (A/B) are the work each run performs.

When a run executes, it enumerates the same repos the backup sweep does by independently calling
the existing `findProjectRepos()` discovery (a standalone function — cleanup does not depend on
the session-start sweep having succeeded). Two categorically different zones.

### Zone A — PROJECT ROOTS (has a backup net → hard-delete allowed, once graduated)

For each candidate file in a project root, delete ONLY IF ALL FOUR hold:

1. **Captured-in-backup (positive proof).** Resolve this session's backup ref
   `refs/backup/<machine>/<session>/latest` on the repo's origin (fetch it ONCE per repo, then
   work locally — not once per file). Confirm the file's path exists in that snapshot tree AND
   its blob hash (`git hash-object` of the working file) equals the blob at that path in the
   backup tree. If the ref is absent (repo never swept, or lock-skipped so nothing was pushed
   under this session id), or the path is missing, or the hash differs, this FAILS → do not
   delete. This is the fix the panel required: positive recoverability proof, not
   absence-of-failure inference.
2. **Untracked**, checked with the SAME plumbing the sweep uses:
   `git ls-files -z --others --exclude-standard`. Never a tracked file, never anything under
   `.git/`.
3. **Signature match** — a tight known-junk name-shape and/or content signature (see the
   signature list below). NOT a bare extension glob.
4. **Older than the age threshold** (secondary narrower only).

Locked/unreadable candidate → skip (never delete-and-swallow-error). Loose/uncertain match →
report, do not delete.

### Zone B — HOME DIR (no backup net → quarantine only, never hard-delete)

A separate, hardcoded, shallow (non-recursive) pass over `C:\Users\Erez\` directly — NOT via
the git known-roots scan, which structurally cannot reach it.

- **Protected-entry exclusion (never touched):** `.claude`, `.claude.json` (+ `.backup`),
  `.cache`, `.claude-git-history`, `.claude-staging`, and anything not matching a tight
  signature. (The plan reads these from a named constant, so the list is auditable in one
  place.)
- **Action = quarantine, not delete.** A matching file is MOVED to a dated quarantine folder
  and only hard-deleted after a grace period during which nothing reclaimed it. Same
  signature + age gate, same skip-if-locked, same report-not-delete for loose matches.

### Audit log

Every action (report / quarantine-move / eventual hard-delete) is appended to a durable
append-only log, surfaced next session — mirroring the `backup-sweep-failures.jsonl` +
surfacer-cursor pattern that already exists. Audit trail only; not the safety mechanism.

### Scheduling — self-computing "smart timer" (+ session-end safety net)

The cleanup does not run every session. It runs only when it can actually have something to do,
and each run decides when the next run is worth doing.

**The rule each run applies:**
- Let `T` = age threshold (days). Scan for signature-matching candidates. Let `A` = age (days)
  of the OLDEST surviving candidate (the one closest to crossing `T`).
- If at least one candidate already meets `T` → act on it now (report / quarantine / delete per
  zone + rollout stage), then recompute from what remains.
- Compute the next-run time: `next = now + max(0, T − A)`. If NO candidate matched at all,
  `next = now + T` (nothing can qualify sooner than a full threshold from now).
- Arm a one-time timer (`fireAt = next`) via the scheduled-tasks mechanism, replacing any
  previously-armed cleanup timer.

**Why this is correct (not a heuristic):** a file created after this run is always at least `T`
old before it can qualify, and every armed wake is at most `T` out — so no file is ever missed
by more than the gap to the next wake. Example: threshold 7, oldest junk-shaped file is 3 days
old → nothing can qualify for 4 days → arm for `now + 4`. First run on a quiet system → `now + 7`.

**The safety net (covers the one thing the timer can't):** the scheduled-tasks timer only fires
while the Claude app is open; a wake due while the app was closed is deferred to next launch. So
a lightweight session-context check (at session start or wrap) asks: "is a cleanup timer armed
for a time that has already passed?" If yes, run the cleanup now and re-arm. This guarantees a
missed wake is caught opportunistically the next time you work, so junk never lingers
indefinitely because the machine was off. On sessions where the armed time is still in the
future, this check does nothing (one timestamp comparison).

**Why the check runs from a session, not purely from the bare timer:** Zone A's captured-in-
backup proof needs a fresh session-scoped backup ref (see the safety spine, point 6). Running
the actual cleanup pass from a session context (triggered by the due timer OR the safety-net
check) means a current backup exists to verify against. The timer's job is to decide *when* a
run is worth attempting; the run itself executes in a session where Zone A can prove capture.

### Rollout (your option A)

- **Iteration 1: report-only in BOTH zones.** A due run only lists what it *would* remove.
  Nothing is deleted or moved. (The smart-timer scheduling is live from iteration 1 — it just
  schedules *reports* until graduation.)
- **Graduation:** once the reported candidates confirm the signatures are safe in real use,
  turn on quarantine (Zone B) and hard-delete (Zone A). Graduation is a deliberate, separate
  step — not automatic.
- **Signature maintenance:** reported candidates are reviewed when a report surfaces and the
  signature list iterated, tracked against GEN-373 (or a child ticket) — so the report is a
  working queue, not an unread pile.

---

## Defaults that need your ok (routine — veto any)

These are the concrete values the design left open. Stated compactly so you can veto at a
glance; I'll use these unless you say otherwise.

1. **Age threshold (both zones): 7 days.** A junk file older than a week is very unlikely to be
   in active use; short enough that clutter doesn't linger long. (Lower = tidier but riskier;
   higher = safer but junk sits longer.)
2. **Quarantine grace period (home dir): 30 days** before a quarantined file is hard-deleted.
   Long safety margin because home-dir files have no other backup.
2a. **Smart-timer horizon = the age threshold (7 days).** Each run arms the next wake at
   `now + (T − oldest-candidate-age)`, or `now + T` if nothing matched (see Scheduling). No
   separate interval knob — the threshold drives the cadence.
3. **Quarantine location: `C:\Users\Erez\.claude\quarantine\<date>\`.** Inside `.claude` (which
   is already excluded from the sweep, so quarantine can't re-sweep itself) and out of your
   visible home-dir view.
4. **Junk signatures (iteration-1 starting set), from the ticket's own examples:**
   - Name-shapes: `fpcreate*.txt`, `spaces*.txt`, `spaceslist*.txt`, `forgehelp*.txt`,
     `readable_gen*.txt`, `full_decompressed.bin`, and `*_decompressed.bin`.
   - Content signature: files whose head contains the UTF-16 `NODE_TLS_REJECT_UNAUTHORIZED`
     TLS-warning marker (the stderr-dump fingerprint).
   - This set only grows as report-only surfaces new shapes; nothing auto-deletes on a shape
     not on the list.
5. **Audit log path: `C:\Users\Erez\.claude\cleanup-sweep-log.jsonl`**, with a surfacer cursor
   beside it — same pattern as the backup failure queue.
6. **Code layout:** the sweep as a new PowerShell script `~/.claude/scripts/cleanup-sweep.ps1`
   (mirrors `backup-sweep.ps1`), which also computes and re-arms the next-run timer at the end of
   each run. A lightweight session-context safety-net check (is a cleanup timer armed for a
   past time? → run now) added at session start or wrap. The audit-log surfacer reuses the
   existing session-start surfacing pattern. The self-arming timer uses the scheduled-tasks
   mechanism (`~/.claude/scheduled-tasks/`).

---

## Honest residual (what this does NOT solve)

- A brand-new junk *shape* isn't auto-handled until its signature is added (report-only surfaces
  it first — by design).
- The prevention nudge is leaky (literal redirects only); it reduces volume, doesn't guarantee.
- Zone A's positive-capture check depends on the backup ref surviving retention/gc until any
  recovery is needed — inherent to the backup-net design, not new here; worth a note in the
  runbook.
- The home-dir folder-consolidation (junctions) follow-up in the ticket is OUT OF SCOPE — a
  separate effort.
- The smart timer only fires while the app is open; the session-context safety net covers a
  missed wake, but the guarantee is "runs the next time you work," not "runs at the exact wall-
  clock moment" — acceptable, since junk lingering a bit past the threshold is harmless.

---

## Build order (once this plan is approved)

1. Zone A + Zone B cleanup script (`cleanup-sweep.ps1`), REPORT-ONLY mode first, INCLUDING the
   next-run computation + timer re-arm at the end of each run.
2. Session-context safety-net check (armed-timer-in-the-past → run now) + the audit-log surfacer.
3. Prevention nudge (auto-approve.js extension) — via the `vet-code` gated flow.
4. Live-verify report-only over a real session; confirm it correctly identifies known junk,
   touches nothing else, and arms the next timer at the expected time.
5. (Later, separate approval) graduate to quarantine + hard-delete.

Each hook/script change goes through the mandatory `vet-code` flow (/check + two code-review
passes + live-verify + minted pass). This plan is the design input to that flow, not a
substitute for it.
