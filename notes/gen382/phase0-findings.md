# GEN-382 Phase 0 spike findings (2026-07-12, Opus 4.8)

All three spikes run in throwaway temp git repos (bare remote + work clone), now deleted.
Nothing live was touched.

## Spike 1 — backup-channel push + restore: PROVEN ✅
Mechanism: snapshot the working tree (incl. uncommitted + untracked) via a TEMPORARY
index, so the real .git/index, HEAD, and main are never touched:
  export GIT_INDEX_FILE=<temp>; cp .git/index $GIT_INDEX_FILE
  git add -A                      # honors .gitignore
  TREE=$(git write-tree)
  SNAP=$(git commit-tree $TREE -p main -m "backup snapshot")
  git push origin $SNAP:refs/backup/<session>/latest
Verified:
- Snapshot captured a modified-unstaged file AND an untracked file; .gitignore'd file excluded.
- Pushed to refs/backup/* — OUTSIDE refs/heads/*.
- main HEAD unchanged; `git status --porcelain` identical before/after → real state undisturbed.
- Restore from a FRESH clone: `git fetch origin refs/backup/...:refs/backup/latest` then
  `git show refs/backup/latest:<file>` recovers exact uncommitted content.
- The backup ref does NOT appear in `git branch -a` (invisible as a branch; still restorable).
  Confirms the ticket's "not on GitHub.com web UI ≠ not backed up" claim.

## Spike 2 — enumeration mechanism: PROVEN, and SIMPLIFIED ✅
- `git add -A` into a temp index captures EVERY non-ignored change class in one commit:
  modified, untracked, nested new dirs, renames — tool-agnostic (doesn't care who edited).
  This IS "git's own truth, not a custom log that undercounts."
- NTFS change-journal NOT needed for the in-repo case — git enumerates within a repo.
- Brand-new non-repo location reduces to the SAME mechanism: `git init` + temp-index snapshot.
  So any location becomes coverable uniformly. Catch-all repo = just an init'd folder.
- RESIDUAL (still open): what DISCOVERS which locations to sweep? Git enumerates WITHIN a
  known repo, but the sweep needs (a) a list of repos to visit, and (b) detection of
  brand-new work in a not-yet-tracked location. (a) is a config/known-roots list. (b) is
  where the change-journal was the candidate — still to design. NOT blocking Spike 1/3.

## Spike 3 — logon-trigger credential access: MOSTLY PROVEN ✅ (one residual)
- GCM ("manager" helper) has a stored github.com credential; `git credential fill` returns
  it NON-INTERACTIVELY. Username pinned: erez-baron-muuula. So a script pushes w/o a prompt.
- RESIDUAL: credential is in Windows Credential Manager, tied to the user session. A
  logon-fired task runs as that user so it SHOULD reach it — but firing an actual logon
  task and confirming no prompt/failure is the one live-test to do at build time.

## Net design impact
- refs/backup/* channel is sound; build the sweep on the temp-index snapshot technique.
- Enumeration is git-native — drop the custom-log idea entirely (kills the exact failure
  class from GEN-58 Class D that this ticket already hit).
- Two residuals carry into build: (1) location-discovery for brand-new work; (2) logon-context
  credential live-test.
