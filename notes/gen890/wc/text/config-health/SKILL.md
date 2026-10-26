---
name: config-health
description: "Audit CLAUDE.md files for config-health drift (redundancy, contradiction, stale/dead rules, dangling references, unenforceable rules, scattered-locality, plus mechanical issues: positional cross-refs, TODO/FIXME, duplicate headings, length, hardcoded time-varying facts). Surfaces candidates + drafted fixes for human review; NEVER auto-applies. Two modes: auto (called by /wrap, scoped to CLAUDE.md files changed since last review) and full (on-demand whole-file sweep of global / a named project / all). Also audits settings.json + settings.local.json (GEN-290): a weekly heads-up nudge at /wrap, plus an on-demand `settings` cleanup that verifies junk-removal candidates with an independent adversarial pass before surfacing, and remembers entries it keeps (a keep-list) so each is reviewed at most once (`settings full` forces a re-audit). Use ONLY when the user runs /config-health, or when /wrap invokes it."
disable-model-invocation: true
---

# /config-health — surface CLAUDE.md rule drift

Audit one or more `CLAUDE.md` files for config-health problems and return **candidates + drafted fixes** for the user's judgment. This is the build of GEN-271. It is **read-only**: it never edits any file and never applies a change. Applying an approved fix is a separate step (see "Applying a fix").

There are two modes:
- **auto** — invoked as a step in `/wrap`. Scoped to the `CLAUDE.md` file(s) that changed (global: since the last config sync; the active project's file: this session). Evaluates the **changed rules against the whole file**, plus mechanical checks; stays quiet when nothing changed.
- **full** — invoked on demand for a comprehensive whole-file sweep of `global`, a named project, or `all`. Catches drift that arose without an edit (which auto can't, by definition).

The deterministic parts run in the helper script `config-health-scan.ps1` (same folder). The semantic parts are **your** judgment, applied conservatively.

---

## Step 1 — Determine mode, scope, and the session ID

- If invoked by `/wrap`: **mode = auto**. Scope = the global `CLAUDE.md`, the active project's `CLAUDE.md`, AND the settings-health weekly nudge and the weekly size check (see "Settings-health dimension" below).
- If invoked directly with no argument: **mode = full**, and ask the user exactly one question and wait: "Which should I sweep — global `CLAUDE.md`, a specific project (which one?), `all` of those, or `settings` (the permission files)?" Do not default.
- If invoked directly with a target (`global` / a project name / `all`): **mode = full** on that target.
- If invoked directly with the target `settings`: run the on-demand settings cleanup (see "Settings-health dimension" below) instead of the `CLAUDE.md` steps.
- If invoked directly with the target `settings full`: run the SAME on-demand settings cleanup, but pass `-FullReaudit` to `scan-settings` so it bypasses the keep-list and re-surfaces every flagged entry (including ones previously adjudicated KEEP). Use this when the keep-list is old (the weekly nudge's `keepListOld`/`reauditMessage` flags this) or when you want a clean-slate re-review.
- **Session ID (needed for project change-detection in auto mode):** read it from your own scratchpad path in the environment context — the path is `...\Temp\claude\C--Users-Erez\<session-id>\scratchpad`; the UUID segment is the session ID. Pass it to the script's `-SessionId`.
- **Resolve project file paths from the Projects Directory table in the global `CLAUDE.md`** at run time — read that table now; never hardcode project paths.

## Step 2 — Detect what to scan (auto mode only; full mode scans everything in scope)

Run the helper for each candidate file (`pwsh`/`powershell`, the script is at `C:\Users\Erez\.claude\skills\config-health\config-health-scan.ps1`):

- **Global:** `-Action detect-global` (PURE READ — it never advances the marker). If `changed` is false, the global file is out of scope this run. If true, the `diff` is the changed region to review and `changeSource` says which signal fired: `since-last-review (marker)` = rules committed since the last completed health review; `uncommitted/override (live vs HEAD)` = an uncommitted or emergency-override edit; `fail-open (marker/repo unavailable)` = the marker or a git read was unavailable, so the WHOLE file is the scope and `markerWarning` says why (this is the never-silently-skip safety path, not a real diff). After you surface the global findings, advance the high-water mark — see "Marking the global file reviewed".
- **Active project:** `-Action detect-project -SessionId <id> -ProjectClaude <path>`. If `changed` is false, skip it. If true, the `diff` (best-effort, may be empty after a mid-session commit) helps you focus.

In **full** mode, skip detection: every in-scope file is scanned in full.

## Step 3 — Run the mechanical scan

For each in-scope file: `-Action scan -Target <file>`. The script returns:
- `mechanicalFindings` — high-confidence: `positional-cross-ref`, `todo-marker`, `duplicate-heading`. **Confirm each** before surfacing — a rule that *quotes* a banned positional phrase to define the ban (e.g. the cross-reference rule itself) is NOT a violation; drop those.
- `danglingRefs` — artifact references: `status: missing` (confirmed broken — surface with a drafted fix) and `status: unverified` (surface **separately**, never assert "missing"; e.g. a script that lives in the Drive tooling folder, or a plugin skill).
- `sizeFindings` — size limits the file breaks or nears; surface each breach, and any `sizeCheckError`.
- `extractedCandidates` — ticket IDs, ISO dates, and paths. **These are NOT findings.** They are raw material for the hardcoded-time-varying-facts judgment in Step 4.

In **auto** mode, focus mechanical findings on the changed regions (use the diff line ranges); whole-file structural checks (duplicate headings, length) still apply.

## Step 4 — The semantic checks (your judgment — apply conservatively, under-flag)

Evaluate the in-scope rules. In **auto** mode evaluate only the **changed** rules, each against the **whole file**; in **full** mode evaluate every rule. A "rule" is one paragraph; a headed cluster of sub-points is one unit. Skip pure reference data (the `# Personal Context` section, the Projects Directory table).

Check kinds:

1. **Hardcoded time-varying facts** (from `extractedCandidates`). For each extracted ID / date / path, judge: is it a *stale or at-risk* baked-in fact (the global rule "Do not write time-varying facts" forbids it), or is it legitimately stable (a load-bearing long-lived ticket ref like GEN-58/GEN-103, a real tooling path, a personal-context date)? Flag only the stale/at-risk ones. Most are stable — expect to flag few.
2. **Redundancy / overlap** — two rules assert the same thing. Propose merge or delete-one. Name both rules.
3. **Contradiction** — two rules give conflicting guidance. Name both; propose the reconciliation.
4. **Stale / dead rule** — a whole rule whose trigger or condition no longer exists. Propose removal.
5. **Locality / organization** — a rule that is valid and non-redundant but topically belongs near a cluster elsewhere; co-locating aids discoverability. Propose **relocation only** (never a merge). One advisory slot per rule-pair: if redundancy already flagged the pair, stay silent here. A genuinely multi-topic rule (e.g. destructive-ops spanning Notion + shell) stays put. **Under-flag** — co-location is a judgment call and nagging trains dismissal.
6. **Unenforceable rule** — its directed behavior depends on an external signal, a timer, or an ambient condition you don't observe when you'd act (e.g. "alert me when context hits 90%", "every 30 minutes", "continuously monitor X"). **False-positive guard (critical):** ordinary behavioral rules AND before/after-a-tool-call procedural rules ARE reliably self-executed by judgment — do NOT flag them. Flag only an external-signal/timer/ambient-threshold dependency. Fix = propose the lightest reliable enforcer (hook / scheduled task / wrapper) or a reframe to the doable approximation or removal; if you propose a reframe, **flag the intent shift** (e.g. proactive "alert at 90%" becomes reactive "report context % when you next act") and check the reframe doesn't duplicate an existing rule.
7. **Internal dangling references** — a rule citing another rule, a section, or a defined term that has no match in the file. Resolve against: (1) section headings, (2) framework terms with an in-file definition, (3) the distinctive quoted phrase the citing rule uses (grep for it). A reference identified only by loose prose with no such anchor is **out of scope → "check manually"**, not a finding.

**De-confliction (one finding per item, priority order):**
- A *wholly* dead rule -> stale/dead claims it (its broken pointers go with it); dangling-ref stays silent on references inside it. (A rule that is alive overall but cites one missing target -> dangling-ref still fires on that reference.)
- Hardcoded-fact vs artifact-dangling-ref on the same token -> **hardcoded-fact wins** (repairing the pointer would just re-introduce a hardcoded fact).
- Redundancy vs locality on a pair -> **redundancy wins**; locality emits only a relocation, only for pairs redundancy didn't flag.
- Stale/dead vs unenforceable on the same rule -> **stale/dead (removal) wins.**

**Project-file adjustments** (so legitimate project<->global structure isn't false-flagged):
- A project rule that references a GLOBAL rule/section is an intentional cross-file reference, NOT a dangling ref — on a project file, resolve internal refs only against that file's own headings/terms; suppress refs naming the global file.
- A project rule that restates or narrows a global rule is an intentional specialization/override, not redundancy — flag duplication only WITHIN the project file.
- Locality is intra-file only.
- **Cross-file consistency** (a project rule duplicating/contradicting a *global* rule) is **out of scope** — that's GEN-291.

## Step 5 — Output

Group by file. Within each file, order: (a) **high-confidence** (confirmed mechanical findings + confirmed-missing dangling refs); (b) **semantic candidates** (checks 1-7); (c) **unverified / check-manually** (surfaced separately, never asserted). For each candidate give: what it is, where (line number), why it's a problem, and a **drafted fix**. If a file had no findings, say so in one line. Be conservative; if unsure, prefer "check manually" over a confident finding.

In **auto** mode (called by `/wrap`), put this under a clearly-labelled sub-heading in `/wrap`'s "For you" block. Keep it tight.

## Settings-health dimension (GEN-290 — `settings.json` + `settings.local.json`)

These two files (permission allow-entries, hook registrations, env) are a different content type from the `CLAUDE.md` rulebooks, scanned by the helper's settings actions — never by hand. Two modes:

### Auto (at `/wrap`) — the weekly nudge only
After the `CLAUDE.md` auto checks, run once: the helper with `-Action settings-nudge` (its defaults cover both files + the 7-day state file `C:\Users\Erez\.claude\.settings-health-nudge`). On a `due:true` tick the helper returns two independent signals; surface whichever apply, each as a **single line** in `/wrap`'s "For you" block, and do NOT scan entry-by-entry or spawn any agent at wrap:
- `due:false` → say nothing about settings this wrap.
- `due:true` and `shouldNudge:true` → surface the returned `message` (a pointer to run `/config-health settings`).
- `due:true` and `keepListOld:true` → ALSO surface the returned `reauditMessage` (a pointer to run `/config-health settings full`). This fires **even when `shouldNudge:false`** — an old keep-list warrants a re-audit regardless of whether anything new looks stale. It never forces a re-review; it only suggests one.
- `due:true` with neither flag → nothing to flag (the timer reset silently).

This fires at most ~once per 7 days regardless of how often `/wrap` runs (the helper gates on the state file and resets it whenever it is due). The `keepListOld` reminder is drift-proof: it is driven by the OLDEST keep-list entry's stored date (default re-audit threshold 90 days), not the file's modification time, so a recent record for one entry can't mask a stale older one. The expensive verification runs only in the on-demand mode below.

### Auto (at `/wrap`) — the weekly size check (GEN-890)
After the settings nudge, follow `size-weekly.md` in this folder. It is this skill's one exception to read-only: it files and raises size tickets and writes its own state file.

### On-demand (`/config-health settings`) — the cleanup engine
Run the helper with `-Action scan-settings`. Handle each bucket it returns:

1. **Deterministic — safe to remove, no agent.** `deterministic.duplicatesWithinFile`, `duplicatesCrossFile`, `contradictions`, `deadHookPaths`. These are certain — label them "safe to remove." For a **cross-file duplicate**, the drafted fix is a `remove-allow` from ONE file only (the entry stays live in the other).
2. **Judgment candidates — verify FIRST, then record the keeps.** `judgmentCandidates` are structurally-dead / one-shot / fragment entries. This list is already the **unreviewed delta**: entries adjudicated KEEP on a prior run live on the keep-list (`C:\Users\Erez\.claude\.settings-health-keep.json`) and are suppressed here so each entry is reviewed **at most once**. The `judgmentCandidatesSuppressed` count reports how many were hidden; to re-review them, use `/config-health settings full` (which passes `-FullReaudit`). Save the full `scan-settings` JSON to a file before reviewing — you need its `judgmentCandidates` array (and array **indices**) and its `nonce` for the recording step.

   Spawn ONE fresh independent reviewer (Agent tool, `subagent_type: check-reviewer`, `model: sonnet`) over the **whole batch in one pass**, briefed: *"You did not flag these; for each, argue to KEEP it. Ground ONLY on the entry's structure, whether any file/path it names still exists, and whether it is self-evidently a one-shot (an inline `node -e`/`python -c`, a captured shell fragment, a vanished temp path). There is NO usage log — treat 'no evidence it was used' as inconclusive, NEVER as a reason to drop. Default to KEEP if uncertain. Return per entry: keep | drop-safe | needs-user-decision, plus a one-line reason."* (One pass, no convergence loop, no escalation.) Surface `drop-safe` as removal candidates and `needs-user-decision` as questions for the user; silently keep the rest.

   **After the user decides and you have applied the approved drops** (see "Applying"), record — as the FINAL step — every entry that ends this cleanup as **settled-KEEP**, so it is never re-reviewed: the reviewer's `keep` verdicts, plus any `drop-safe`/`needs-user-decision` entry the user explicitly chose to keep. One call does it: `config-health-scan.ps1 -Action keep-record -ScanResult "<saved scan file>" -KeepIndices "i,j,k" -Nonce "<the scan's nonce>"`. `-KeepIndices` are positions in that scan's `judgmentCandidates` array (integers only — there is no entry text to transcribe). Record NOTHING for dropped entries, and NOTHING for a `needs-user-decision` entry the user left **unresolved** — those intentionally reappear next run. Use the SAME saved scan file the reviewer saw (its `nonce` binds the indices to that exact scan; a re-run scan has a different nonce and `keep-record` rejects it). keep-record also prunes any keep-list entry no longer present in either settings file and preserves the original dates of entries already recorded.
3. **MCP servers — present for manual verification.** `mcpServersForVerification` lists each MCP server id + tool count. There is no machine-readable registry of live servers, so do NOT auto-judge — surface the list and ask the user which servers he still uses; offer to `remove-allow` every entry of any he retires.
4. **Advisory — never auto-remove.** `subsumptionAdvisory` (a narrow entry made redundant by a broader bare tool) and `env.secretFindings`. Surface as notes for the user's judgment. For subsumption, never draft an auto-removal — cross-file subsumption depends on how the harness unions the two files, which is unverified.

**Applying (settings):** locked files → never auto-apply. Approved changes go through `update-config.ps1 -Op remove-allow` / `add-allow -Entry "<exact entry>" -File settings.json` (or `settings.local.json`). One entry per call; copy the entry string verbatim from the scan output. Re-run `-Action scan-settings` afterward to confirm the change landed — but note a confirmation re-run produces a NEW `nonce`, so the bucket-2 `keep-record` step must reference the **originally saved** scan file (the one the reviewer adjudicated), never the confirmation run. Sequence: apply approved drops → (optionally confirm with a fresh `scan-settings`) → `keep-record` against the original saved scan as the final step.

## Marking the global file reviewed (surface-then-advance — a HARD INVARIANT)

`detect-global` is read-only; the high-water mark (`C:\Users\Erez\.claude\.config-health-global-marker`, a git-history commit SHA — local to this machine, never synced) only moves when you advance it, and you advance it **only AFTER** you have surfaced the global config-health findings to the user (in `/wrap`'s "For you" block, or in an on-demand run's output). As the FINAL step of any run that reviewed the global `CLAUDE.md`, issue once:

`config-health-scan.ps1 -Action mark-reviewed`

- **Never advance before surfacing.** If the run is interrupted before this step, the marker stays put and those edits re-surface next time — the safe direction (over-review, never a silent skip).
- **"Reviewed" = surfaced, NOT acted-upon.** Advance after surfacing regardless of whether any fix was applied; gating on applied fixes would re-surface declined candidates forever.
- **When to run it:** after a global review in EITHER mode — auto (the `/wrap` global check) or on-demand (`/config-health global` or `all`). Do NOT run it for a project-only or `settings`-only invocation (no global review happened). It is idempotent; running it when nothing changed simply re-affirms the marker at HEAD. A non-zero `ok` is non-fatal — it just means the next run re-checks.

## Applying a fix (separate, never inside this pass)

Surfacing is the end of this skill. Applying an approved fix is a follow-up the user authorizes:
- **Text change** (any reword/merge/removal): run `/check` on the new text, then apply — global file via `update-global-rule.ps1` (or `update-config.ps1` for a deletion / a move); project file via a direct `Edit` (project `CLAUDE.md` files are not protected).
- **Pure relocation** (identical wording moved): no `/check` needed (no text to review) — the user approves the move directly. A move is NOT a single `update-global-rule.ps1` text-replace; use `update-config.ps1 -Op write-file` with a full verified draft, or two sequential text-replaces with a verify step between.
- **Unenforceable -> enforcer:** building a hook / scheduled task is its own proposed build task, not a rule edit.
- Never auto-apply; never apply more than the user approved.
