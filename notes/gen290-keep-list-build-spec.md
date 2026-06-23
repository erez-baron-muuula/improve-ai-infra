# GEN-290 follow-up — "review each settings entry at most once" (keep-list memory layer)

**Created:** 2026-06-23. **Status:** spec approved + `/check`-converged (2 rounds); APPROVED TO BUILD by Erez. **BUILT + VERIFIED 2026-06-23** (28-assertion live harness, all pass; scanner ASCII-clean, exits 0). Durable capture written because the Notion connector was invalidated mid-session and Erez wanted everything logged before a `/compact`.

**Build result:** implemented in `config-health-scan.ps1` (params `-KeepListFile`/`-KeepReauditDays`/`-FullReaudit`/`-ScanResult`/`-KeepIndices`/`-Nonce`; new `keep-record` action; keep-list filter at the `$candidates` build; `judgmentCandidatesSuppressed` + `nonce` + `fullReaudit` in scan output; `keepListCount`/`keepListAgeDays`/`keepListOld`/`reauditMessage` in the nudge) and in `SKILL.md` (Step-1 `settings full` route; weekly-nudge re-audit reminder incl. shouldNudge:false path; on-demand bucket 2 keep-record final step; Applying ordering note; frontmatter). Keep-list state file: `C:\Users\Erez\.claude\.settings-health-keep.json` (created on first `keep-record`). Verified: suppression + first-review intact, other checks unaffected by the filter, FullReaudit re-surfaces, keep-record index-sourced/date-preserving/prune/nonce-reject, backslash-heavy exact round-trip, nudge re-audit on the no-new-stale path.

This file is the source of truth for resuming after compact. When Notion reconnects: (1) file the ticket below under the config-health epic; (2) log the two GEN-58 items below; then (3) build + verify.

---

## Decisions locked (all approved by Erez)

- **Problem:** the on-demand settings cleanup re-flags + re-reviews entries the reviewer already kept, on every run. The survivor set grows monotonically (every run can add new reviewer-kept entries), so a hardcoded shape list (the dropped "Part A") doesn't generalize.
- **Chosen mechanism:** a **memory side-list** (decision "a"), NOT promote-to-curated-file. Rationale: it keeps scanning everything and only skips re-reviewing entries explicitly approved — most faithful to Erez's priority "never stop reviewing what's needed."
- **Part A (structural-exclusion slice) was DROPPED** — it would bypass *first* review of one-off-looking entries (`cat`/`xxd`/`tasklist`), violating needle 1. `Test-JunkCandidate` flagging logic stays UNCHANGED.
- **Two needles (the bar):** (1) never stop reviewing an entry the process genuinely needs; (2) never re-review what's easily avoidable.

## `/check` provenance
Spec converged in 2 rounds. Round 1: 3–4 needle-related flaws (keep-record could bless un-reviewed entries; nudge counted suppressed entries; re-audit reminder defeatable via file-mtime age + suppressed on the "nothing new" path). All fixed in v2 below; round 2 = both lenses PASS, soundness PASS. One non-blocking robustness add folded in (scan-result nonce, see point 3).

---

## Converged build spec (v2) — the thing to build

**Scope:** changes only `C:\Users\Erez\.claude\skills\config-health\config-health-scan.ps1` and the on-demand-cleanup section of `C:\Users\Erez\.claude\skills\config-health\SKILL.md`. `Test-JunkCandidate` UNCHANGED. No `/wrap` wiring change. ASCII-only `.ps1`, clean `exit 0`, JSON out.

1. **Keep-list = a JSON OBJECT** at `$KeepListFile` (default `C:\Users\Erez\.claude\.settings-health-keep.json`), mapping each exact **decoded** entry string -> the ISO date it was added. Absent file = empty. New script param `$KeepListFile`.

2. **Filter at the `$candidates` build ONLY** (config-health-scan.ps1 lines ~482-486): exclude an entry iff its exact string is a key in the keep-list. Every other check (duplicatesWithinFile/CrossFile, contradictions, subsumptionAdvisory, deadHookPaths, MCP enumeration, env secrets) runs over the full `$tagged`/`$allEntries`/`$main`/`$local` set UNCHANGED — verified these derive independently of `$candidates`. Add `judgmentCandidatesSuppressed` (count) to output. `$nudgeCount` (line ~498) is computed from the FILTERED `$candidates`, so the weekly count reflects only NEW (unremembered) stale entries.

3. **Recording keeps — only adjudicated, index-sourced (no transcription, no auto-bless):** new action `-Action keep-record -ScanResult <file> -KeepIndices "i,j,k"`. Reads the exact entry strings at those indices from the scan-result file's `judgmentCandidates` array (the SAME scan the reviewer saw — the filtered set), and writes keep-list = (existing keep-list entries still present in a settings file, dates preserved) UNION (the kept entries, dated today). Only entries the reviewer/user explicitly kept are recorded; un-reviewed or dropped entries are never auto-blessed; entries removed since are pruned. The skill emits only integer indices (transcription-safe). **Robustness guard (folded-in advisory):** the `scan-settings` output carries a one-time nonce/timestamp; `keep-record` records that nonce and rejects a `-ScanResult` whose nonce doesn't match the scan that produced the surfaced candidates — so indices can never bind to a stale/re-run scan.

4. **Full re-audit (needle-1 safety valve):** `scan-settings -FullReaudit` bypasses the keep-list and re-surfaces every flagged entry. Invoked from the skill as `/config-health settings full`.

5. **Self-triggering, drift-proof reminder:** `settings-nudge` output gains `keepListCount`, `keepListAgeDays` (= age of the OLDEST keep-list ENTRY by its stored date — NOT the file mtime, so a recent record for one entry can't mask an old one), and `keepListOld` (= list non-empty AND oldest >= `$KeepReauditDays`, default 90; new param). SKILL.md surfaces a full-re-audit suggestion whenever `keepListOld` is true — INCLUDING on the `due:true, shouldNudge:false` path (old list + nothing new still prompts). No forced re-review (needle 2 stays clean). Reminder fires on the next weekly tick, so up to ~7 days past threshold — accepted.

6. **Match form:** keep-list stores decoded strings (as `ConvertFrom-Json` yields, matching the `[string]$e` entries); scan compares decoded-to-decoded. Backslash/quote-safe via JSON round-trip.

7. **SKILL.md on-demand-cleanup section updates:** the reviewer reviews the FULL current candidate batch in ONE pass (no partial review); after applying approved drops via `update-config.ps1`, call `keep-record` with the kept indices as the FINAL step; state that the reviewer sees only the unsuppressed delta; state that `needs-user-decision` entries the user doesn't resolve reappear next run; document the `full` re-audit and when to use it.

8. **Header comment** updated: the script writes its own state files (nudge timer + keep-list) but still never edits settings/config/content files.

**Build-time verification checklist:** (i) seed a keep-list entry -> scan suppresses it from candidates but it still appears in any applicable dup/subsumption output; (ii) other-check counts identical with filter on vs off; (iii) `keep-record` writes exactly the kept indices, preserves existing dates, prunes absent entries, rejects a mismatched nonce; (iv) `-FullReaudit` re-surfaces suppressed entries; (v) nudge reports keepListCount/age/old and the reminder fires on the shouldNudge:false+old path; (vi) exact-match holds for a quote/backslash-heavy entry; (vii) ASCII-only, clean exit 0.

---

## Ticket to file (when Notion reconnects)
- **Title:** Remember approved settings entries so cleanup reviews each at most once
- **Type:** task · **Priority:** Medium · **Status:** Backlog · **Project:** AI · **Assignee:** unassigned (Claude to build)
- **Parent item:** config-health epic = `https://app.notion.com/p/3716e495d07c814e8293f76fade51ad2` (GEN-290's parent; confirm it's GEN-86 on fetch). Check/apply the Team-Tasks Task template.
- **Body:** the converged build spec above (points 1-8 + verification checklist + the two-needle rationale).
- Cross-link from GEN-290's build log (already notes "a fix to persist keep-verdicts is being scoped as a separate ticket").

## GEN-58 items to log (when Notion reconnects)
Read the GEN-58 failure-class index first and classify each as new-class / new-element / recurrence; don't re-read the whole log.
1. **Mis-modeled the recurring cost -> wrongly deferred the general fix.** Recommended deferring the persistence layer on YAGNI grounds by treating the kept-survivor set as static/bounded ("17 rare entries"), when it actually grows monotonically each run. Surfaced by Erez's pushback ("should it be baked in? every health check can have new cases"). Self-review AND the round-1 holistic reviewer both initially missed the growth dynamic. Lesson: when judging "is it worth building," model the recurrence dynamic, not a single snapshot.
2. **Needle-1 blind spot in the first proposal.** The original "Part A + sidecar" proposal included structural exclusions (stop flagging `cat`/`xxd`/`tasklist`/` *`-wildcards) that would bypass FIRST review of one-off-looking entries — violating Erez's explicit "never stop reviewing what's needed" priority. Caught by the `/check` panel (round 1, two lenses), not by self-review. Lesson: an "avoid re-review" optimization that also skips first review trades against the opposite needle; check both directions.

---

## Next steps after compact
1. ~~Build per the v2 spec; run the verification checklist live.~~ **DONE 2026-06-23.**
2. Erez reconnects Notion → file the ticket (above); log the two GEN-58 items. STILL PENDING (connector was down).
3. At `/wrap`: HISTORY.md entry + git push + config sync (NOT done yet — session continues).
