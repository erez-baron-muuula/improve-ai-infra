# GEN-382 — Airtight backup sweep: concrete design (v2, post-Phase-0)

Scope (Erez locked): ONE device, Claude-only. Multi-PC + non-Claude-tool coverage
deferred to two future tickets. Decisions closed 2026-07-12: backup home = GitHub
refs/backup/* channel; triggers, no scheduled timer.

## What it is
One PowerShell script, `backup-sweep.ps1`, living in `~/.claude/scripts/` (synced by
sync.ps1 like the other sanctioned scripts). Fire-and-forget: every invocation is
non-blocking, single-instance-locked, and never fails a session.

## The core operation (proven in Spike 1; revised post-/check round 1)
For each project repo it sweeps:
1. Refuse to touch a repo mid-merge/rebase (detect .git/MERGE_HEAD, rebase-*/ dirs) —
   snapshotting conflict debris is worse than skipping; flag loudly instead.
2. **Secret scan runs HERE — on working-tree files, BEFORE any git object is written.**
   (M3/M4 fix, both verified live in Phase-0 verify repos.) Scan the full set of files
   `git add -A` WOULD stage (tracked+untracked, .gitignore honored — enumerate via
   `git status --porcelain` + `git ls-files`), against hooks/secret-patterns.json.
   Rationale proven: `git commit-tree` writes blobs into local .git/objects the moment
   it runs (recoverable locally even if never pushed), so a scan sequenced after
   write-tree cannot prevent local persistence — it must precede it. And the scan is on
   the FULL tree, not an incremental diff-vs-parent: a secret already committed to the
   branch is invisible to a diff-vs-branch-tip yet still rides in the pushed tree
   (verified). Full-tree scan each run is the cost of a correct gate; accepted.
   On match: DO NOT create the snapshot for this repo; loud durable quarantine notice;
   continue other repos. Missing/unreadable patterns file → abort this repo (fail-closed).
3. Snapshot the FULL working tree (committed + uncommitted + untracked, .gitignore
   honored) via a TEMP index — never touches .git/index, HEAD, staging, or any branch.
   The temp index path is UNIQUE per invocation (PID + session id), so concurrent
   sweeps can't clobber one another's index (advisory-3 fix):
     GIT_INDEX_FILE=<temp-unique> ; cp .git/index -> temp ; git add -A ; git write-tree ;
     git commit-tree <tree> -p <parent> -m "<stamp>"
4. If the snapshot tree is identical to the last backed-up tree → skip (no-op push).
   "Last tree" is read from a per-repo LOCAL state file (survives across sessions). If
   that state is missing/unreadable OR the remote is unreachable, DEFAULT TO PUSH ANYWAY
   (never skip on uncertainty — a silent skip would itself violate the goal; advisory-2).
5. Immediately point a LOCAL ref (refs/backup-local/<...>) at the snapshot commit before
   pushing, so an aggressive local `git gc`/prune in the pre-push window can't drop the
   dangling commit (advisory-1 fix; default gc is 2wk but we don't rely on it). DELETE
   this local ref after the push succeeds (round-2 advisory) — else it accumulates one
   ref per snapshot per repo. On push failure, keep it (the commit must stay pinned for
   the retry) and let the next sweep's success clean it up.
6. Push the snapshot commit to a NAMED ref: refs/backup/<machine>/<session>/latest.
   Session id = the Claude Code session UUID (stable per session, unique across sessions);
   machine = COMPUTERNAME. Update the ref with a compare-and-swap (push the expected old
   value; on rejection, re-read and retry) so a same-session double-fire can't race the
   parent-chain (M2 fix). Parent = previous snapshot when present, else branch tip.
7. ONLY reads + pushes. NEVER pull/rebase/checkout/reset/merge. (Hard safety rule.)

## Safety gates (all must hold before a push)
- SECRET SCAN, fail-closed: see step 2 of the core operation — it runs on working-tree
  files BEFORE any git object is written, over the FULL tree (not an incremental diff).
  This placement + scope is the M3/M4 fix and is the correct gate; the earlier "scan
  added/modified blobs before push" framing was unsound (verified) and is replaced.
- Torn-file settle rule: only snapshot files whose mtime is > ~60s old? NO — re-examined:
  for the trigger model (not a blind timer) the sweep fires at session boundaries, not
  mid-save, so torn-file risk is low. Keep a lightweight guard: skip a file actively
  being written (locked handle) and log it for the next sweep. Residual accepted:
  last moments before a crash may exist only torn — documented, not solvable here.
- Size guard: a blob >100MB → skip + surface (GitHub rejects; LFS is a future ticket).

## Location discovery (the Spike-2 residual, resolved)
Two sources, union:
- KNOWN ROOTS: a small config list of project parent dirs (today: C:\Users\Erez\AI Projects\*
  and ~/.claude via its existing sync). Each immediate child that is a git repo → sweep it.
  This is a config list, but coverage does NOT depend on remembering to register each
  NEW project: the parent-dir scan finds any new repo under a known root automatically.
- BRAND-NEW WORK UNDER A KNOWN ROOT: a child dir under a known root that is NOT yet a
  git repo, and is not provably-throwaway → `git init` a local repo for it + snapshot to
  a catch-all ref, AND emit a "looks like new work — promote to its own GitHub repo?"
  flag for Erez. NEVER auto-create a named GitHub repo. (Matches locked decision 5.)
  Detection of brand-new work in a totally UNKNOWN location (outside all known roots) is
  explicitly OUT of scope for one-device/Claude-only — that's the deferred-ticket
  territory (needs the change-journal / tool-agnostic sweep). Documented as a known gap.

## Trigger wiring (decision 2, closed — triggers not timer)
All fire-and-forget, guarded by a single-instance lock. LOCK SCOPE = per-repo (M1 fix):
a repo already being swept is skipped, but different repos sweep in parallel, and a
different session's sweep of a free repo is never blocked. **If a repo is skipped due to
lock contention, that skip is itself written to the failure-notice file** — so a
lock-skip can never be a silent skip (M1 fix; the lock meant to protect us must not
become a silent-skip hole).
- PC startup/logon: a logon-scoped scheduled task (the ONE thing to live-test —
  credential in logon context). Runs the sweep once at logon.
- Every Claude session start: SessionStart hook (also fires on resume + after compact).
  A hook already exists for loggate; this adds a fire-and-forget spawn of the sweep.
- /wrap and /loghistory: add a sweep invocation at the end of each. /wrap is the normal
  end-of-session path and backs up late-in-session work (M5 mostly resolved here).
Residual (Erez's call, 2026-07-12 — accepted, NOT built): a session the user NEVER wraps
(terminal closed / abandoned / crashed) gets no end-of-session sweep, so its late work's
OFFSITE copy waits until the next session-start trigger. Local copy is never at risk (the
work is on disk the whole time). A Stop-hook trigger was considered to close this and
DROPPED — /wrap covers the normal case, and the abandoned-session offsite lag is a low-
probability window not worth the extra trigger (which was also the one piece arguably in
tension with the no-timer decision). Add later as a pure addition if it ever bites.
Fire-and-forget = spawn detached (Start-Process -WindowStyle Hidden / job), return
immediately; the session never waits on it and a sweep failure never blocks the session.

## Failure notice (wired to ALL trigger paths, not one)
When a sweep can't reach the remote (network/GitHub down) OR quarantines a secret OR
hits a torn/locked file it skipped OR is lock-skipped (M1): record it durably. The store
is an APPEND-ONLY queue of unsurfaced failures (e.g. backup-sweep-failures.jsonl), NOT a
single overwritable status slot (M7 fix). Sequencing to prevent the surface/re-sweep
race: SessionStart FIRST reads-and-marks-surfaced the pending failures (shows an
unmissable message), THEN spawns the new sweep; the new sweep only ever APPENDS, never
rewrites, so a fast subsequent run cannot clobber an unshown failure. Next sweep
auto-retries. Mirrors sync.ps1's warn-not-block git design. NEVER blocks. The notice
must not depend on a human noticing a single warning line (the exact failure that let
the hook slip).

## Retention (from day one)
Per-session refs/backup/<machine>/<session>/latest accrue. A compaction step (part of
the sweep or /wrap): a backup ref is a deletion CANDIDATE when its tip commit's DATE
(commit date, not reflog/mtime — advisory-4) is older than 30 days. BUT before deleting
any candidate, verify its tip's tree is SUBSUMED — i.e., some commit reachable from
refs/heads/main (or another retained backup ref) has the identical tree. Implement via
commit-ancestry, not a literal tree is-ancestor: walk candidate reachable-from-main
commits and compare `<commit>^{tree}` to the candidate tip's tree (round-2 advisory —
`git merge-base --is-ancestor` walks COMMITS, so don't point it at a tree). A candidate
whose work was NEVER merged anywhere is NOT deleted (retention extended) — deleting it
would be
silent permanent loss of the only copy of unmerged work (M6 fix). The curated
refs/heads/main is the permanent record; backup refs are safety copies. Never touch
refs/heads/*. Compaction only ever deletes a given session's refs when that session's
tip date is >30 days old, so it cannot race the live/current session (which is minutes
old, not 30 days).

## Hard NON-goals (explicit, to bound the build)
- No pull/merge/rebase/checkout — read + push only.
- No auto-creation of named GitHub repos.
- No multi-PC ref reconciliation (future ticket).
- No non-Claude-tool live coverage beyond what a logon / session-start / /wrap sweep
  catches (future ticket).
- No Stop-hook / end-of-session-crash trigger (dropped 2026-07-12; /wrap covers the
  normal case — see the Residual note under Trigger wiring).
- No scheduled timer.

## Build order after design approval
Phase A: backup-sweep.ps1 core (snapshot+push+secret-scan+lock+notice) → /check the
  concrete script design → /vet-code (guarded script) → apply.
Phase B: trigger wiring (SessionStart hook spawn; /wrap + /loghistory calls; logon task
  + its credential live-test) → /vet-code each hook/settings change.
Phase C: retention compaction.
Each phase verified live before the next.
