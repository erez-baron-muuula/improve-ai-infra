# Plan: GEN-892 — notice Anthropic's guideline changes, and apply limit changes automatically (round 3)

## In plain terms
- **The problem.** Our size limits come from Anthropic's documentation pages. When Anthropic changes a number there, nothing notices, so our checks and hooks keep using the old number.
- **What you asked** (2026-10-26, on "will it change the line automatically?"): "if not, it should."
- **The fix, in four parts:**
  1. **Watch.** The weekly release review (every Thursday) reads Anthropic's pages. For each limit we keep the exact sentence that states it, for example "truncated at 1,536 characters in the skill listing".
  2. **Update.** If the same sentence now carries a different number, our limits file is updated automatically.
  3. **Everything that uses the number follows it.**
     - The size checker and your approval-card size lines already read that file.
     - Six other places keep their own copy of a limit:
       - the four hooks that inject notes (10,000-character cap);
       - the session-start rules-file alarm (200 lines);
       - the gate that asks for your OK before your global rules file grows past 200 lines (`update-config.ps1`).
     - They change to read the file too, keeping their current number only as a fallback if the file can't be read.
     - **Decided (Erez, 2026-10-26).** Question: "if Anthropic raised its recommended size for CLAUDE.md files from 200 to 300 lines, should your global rules file be allowed to grow to 300 without asking you?" Erez: "let it grow to 300 without asking me".
       - So the alarm and the gate follow Anthropic up as well as down, which replaces GEN-674's lower-only safety.
       - Guard: a number above their built-in 200 is accepted only when it matches the newest automatic change logged by the weekly watch (`guidelines-changes.jsonl`, carrying Anthropic's quoted sentence). Otherwise they stay at 200 and say so at session start. Lowering is always accepted.
       - Editing the limits file alone can't raise the limit. A deliberately forged log row in the same folder could, but it would show at /wrap, in git and in the project-edit report ("a guard against mistakes, not a wall", `update-config.ps1:88`).
       - Plan approved by Erez on 2026-10-26, with the amendments at the end of this file.
  4. **You're told.** The change shows at your next /wrap for 30 days, quoting Anthropic's new sentence and naming any of our files now over the limit. If anything needs a person, a ticket is filed. Every change is saved in git, so it can be undone.
- **When a script can't be sure, it stays a human decision.** Nothing changes automatically, and a ticket is filed instead, if any of these happen:
  - the sentence was reworded;
  - two different numbers appear;
  - the new number is more than 4 times bigger or smaller;
  - a whole page looks broken.
- **New advice that isn't a number** becomes a ticket only when it concerns our setup files.
- **New models.** When the changelog announces a new major Claude model, a ticket is filed to revisit our CLAUDE.md files.
- **Timing.** Build now. Install after the first unattended weekly run passes (Thursday 2026-10-29), so that check on GEN-871 isn't muddied.
- **Effort:** high to design, xhigh to build.

## Context (verified 2026-10-26)
- **Limits file.** `notes/anthropic-guidelines.json` holds 8 Anthropic limits and 1 house rule. Its readers:
  - The size checker (`~/.claude/skills/config-health/config-health-scan.ps1`, `Read-SizeLimits`) takes every number from it. A grep for each limit value in the script finds no hardcoded copy (soundness reviewer).
  - `/suggest` check 4b reads it while forming proposals (`suggest/SKILL.md`, the 4b paragraph).
  - `~/.claude/hooks/sessionstart-backup-surfacer.js` reads `claude-md-lines` but caps it at `RULES_LINE_CAP = 200` (line 498: "the file can only lower the limit"). It needs a JSON integer.
- **Hardcoded copies** (grep of `~/.claude/hooks/*.js` and `G:\My Drive\AI Projects\_Tooling\Claude\*.ps1`, 2026-10-26):
  - `inject-notion-refs.js:40/41` and `inject-shell-refs.js:40/41` have `CAP = 10000` and `KEEP = 9000` (`fitToCap` uses `cap - (CAP - KEEP)`). `inject-topic-refs.js:50/51` has the same pair, with `POINTER_ROOM = 500` at line 52.
  - `inject-browser-refs.js:71` has `INJECT_CAP = 9500`, which is the cap minus 500.
  - `sessionstart-backup-surfacer.js:333` has `MAX_CONTEXT_CHARS = 9000`, which is the cap minus 1,000.
  - `sessionstart-backup-surfacer.js:498` has `RULES_LINE_CAP = 200`, and can only lower it.
  - `update-config.ps1:90` has `$RulesLineCap = 200`, and `Get-RulesLineLimit` (lines 124-144) can only lower it. This is the write-time gate on the global CLAUDE.md. The surfacer comment says to keep it, the surfacer and the size checker "in step".
  - Message text only: `sessionstart-skill-restore.js` lines 2-3 and 68 ("5,000 tokens each, 25,000 in total").
  - The house rule `gate-skill-runbook` (12,000 characters) is our own number, stated in 4 gate skills and derived from 5,000 tokens.
- **Hook copies on Drive.** `G:\My Drive\AI Projects\_Tooling\Claude\hooks\` is two-way synced by `sync.ps1`: From-Claude pushes the live files, and To-Claude pulls without overwriting a local edit. The build edits the live `~/.claude/hooks` files and runs the From-Claude direction.
- **Weekly job.** `/release-review` is the scheduled task `release-review-weekly` (Thursday 09:08).
  - Helper: `notes/release-review/release-review-tool.js`.
  - The /wrap readout comes from its `readout` command, run by `wrap/SKILL.md` Step 3j.
  - Supervised run passed 2026-10-26 (`state.json` `supervisedPassedUtc`). GEN-871 stays in Review until a Thursday check sees an unattended run pass.
  - Its `SKILL.md` Step 1 stops early on a no-op week ("record a no-op run … and stop").
- **Room in the release-review instructions.** `~/.claude/skills/release-review/SKILL.md` is at 4,786 of 5,000 tokens (installed size-check, `sizeLines` output, 2026-10-26). No net growth is allowed.
- **Pages** (probe `scratchpad/gen892/anchors.js`, normal HTTPS with certificate checking on, raw markdown). The anchor sentences were confirmed on the downloaded pages by two reviewers:
  - hooks.md:1050 "…plain stdout, are capped at 10,000 characters"
  - skills.md:613 "keeping the first 5,000 tokens of each"
  - skills.md:400 "is truncated at 1,536 characters in the skill listing"
  - skills.md:555 "Keep `SKILL.md` under 500 lines"
  - memory.md:547 "The first 200 lines of `MEMORY.md`, or the first 25KB"
  - memory.md:621 "Files over 200 lines consume more context"
  - bestpractices.md:257 "body under 500 lines"
  - bestpractices.md:1134 "`description`: Maximum 1,024 characters"
  - bestpractices.md:410 "reference files longer than 100 lines"
- **The 7 watched pages:** memory, skills, hooks, sub-agents, large-codebases and best-practices (code.claude.com/docs/en/*.md), plus skill best practices (platform.claude.com). The last 3 hold no numbers we use and are watched for new advice only.

## Design

### 1. Anchors in the limits file (data)
- Each Anthropic limit gains `anchors: [{ page, before, after, scale? }]`.
  - `before` and `after` are the exact words around the number. The unit word sits inside `after`, so a unit change reads as "not found", never as a silent change.
  - Each anchor must match one sentence on today's page. Identical repeated sentences carrying the same number count as one match; for example, best-practices states "Keep the `SKILL.md` body under 500 lines for optimal performance" twice. The build tests this.
  - `skill-md-lines` has two anchors (skills page and best-practices page); if they disagree, a ticket is filed.
  - `memory-md-load` has two (lines, and 25KB scaled to bytes).
- House rules and our own counting values are not watched.
- `_about` changes to: anchored numbers are updated automatically by the weekly guidelines watch (GEN-892); everything else only with Erez present.

### 2. `release-review-tool.js guidelines-check [--apply] [--pages-dir <dir>]` (mechanical)
1. **Download** the 7 pages.
   - A download failure, a non-markdown response, or a page under 50% of its baseline size gives one page warning, and none of that page's anchors are judged.
   - A page where 2 or more anchors are missing is treated the same way.
2. **Judge each anchor.** It searches for `before` + number + `after`. Numbers are read with or without thousands commas; markdown and whitespace are tolerated.
   - Only the current number found → unchanged.
   - Exactly one other number found, within 0.25x–4x (after `scale`) → **change**.
   - Not found, several numbers, or the current number alongside a different one → **ticket candidate**, with stable key `guidelines:<limitId>:<reason>`.
3. **`--apply`** (live runs only; see section 4):
   - For each change, a targeted text replacement of that limit's number (and the `memory-md-load` display string), written as a JSON integer. The file goes to a temp file, is re-read as valid JSON by the size checker, and is then renamed into place.
   - `verified` is set to today.
   - A row is added to `notes/release-review/guidelines-changes.jsonl` with the limit, old and new values, the sentence (capped at 300 characters) and the date.
   - `size-sweep` runs and the names of our files now over that limit are recorded.
   - Prose fields that embed the old number are listed as "text to update", with no auto-edit.
   - `state.json` `guidelinesCheckUtc` is set on every run. In a plain run (no `--apply`) that timestamp is the only write: no limits file, no log.
   - Downloads reuse the tool's existing fetch, which has a 60-second timeout.
4. **Changed paragraphs.** For each page whose normalised text changed against the local copy, it outputs at most 10 changed paragraphs, keeping only paragraphs that mention a limit word (lines, characters, tokens, KB, limit, cap, truncat) or one of our file kinds (CLAUDE.md, SKILL.md, skill, command, hook, MEMORY.md), plus a count of the rest.
   - Page copies live in `notes/release-review/docs/`. They are local and git-ignored; only their hashes go in `state.json`.
5. **Never throws.** Any error is a warning in the JSON output, exit code 0.

### 3. Every copy follows the file (one /vet-code panel; 5 hooks plus `update-config.ps1`)
- **Notes cap.** `inject-notion-refs.js`, `inject-shell-refs.js`, `inject-topic-refs.js`, `inject-browser-refs.js` and the surfacer's context cap read `hook-injected-text.value` from the limits file once per run.
  - The built-in number becomes a constant named `FALLBACK_*`, used if the file is unreadable or the value is not an integer from 2,000 to 100,000.
  - Derived numbers move with it:
    - `KEEP` = cap − 1,000;
    - browser cap = cap − 500;
    - surfacer `MAX_CONTEXT_CHARS` = cap − 1,000;
    - `POINTER_ROOM` stays 500.
  - User-facing text that says "10,000" uses the same variable.
- **Rules-file line limit.** The surfacer (`RULES_LINE_CAP`) and `update-config.ps1` (`$RulesLineCap` / `Get-RulesLineLimit`) follow `claude-md-lines`, with 200 as the fallback.
  - The value must be an integer from 50 to 800 (4x either way of 200), or the fallback applies.
  - Lowering is always accepted.
  - A value above 200 is accepted only when the newest `claude-md-lines` row in `notes/release-review/guidelines-changes.jsonl` carries that same value. Otherwise both use 200, and the surfacer says "rules-file limit in the limits file (N) does not match a logged Anthropic change; using 200".
  - The same cross-check applies to a notes cap above 10,000.
  - Their old "may lower it, never raise it" comments are updated.
  - `update-config.ps1` is the locked Drive script. It changes through its own vetted path, in the same /vet-code panel, and the two stay in step.
- **Message text.** `sessionstart-skill-restore.js` takes "5,000" from `skill-after-compaction.value`. The 25,000 shared budget is not in the limits file, so it stays as message text and is listed as "text to update".
- **Stray-copy test.** It scans `~/.claude/hooks/*.js`, `~/.claude/scripts/*.ps1`, `~/.claude/skills/**/*.ps1` and `update-config.ps1`, but only identifiers whose name contains CAP, KEEP, LIMIT or MAX_CONTEXT (case-insensitive) and that are assigned a literal number.
  - It fails if such an identifier equals 10,000 / 9,500 / 9,000 (the notes cap and its derived values) or 200 in a rules-line name (`RULES_LINE`, `RulesLine`), unless the identifier is a `FALLBACK_*` constant.
  - Known unrelated names (for example `TASK_CAP`, `TEXT_CAP` and `MAX_BOUNCES`) never match, because the value must also be one of those numbers. `POINTER_ROOM` is not matched.
  - It runs in the build's tests and again inside `guidelines-check`, which reports any hit as a warning, so a future stray copy surfaces at /wrap.
  - Today's run must show zero hits once the build is done.

### 4. The release-review run (new reference file, no net growth to `SKILL.md`)
- **New file:** `~/.claude/skills/release-review/guidelines-watch.md`, under 100 lines.
- **`SKILL.md` Step 1** gets one sentence, placed **before** the no-op stop: run the check as `guidelines-watch.md` says. Wording is trimmed elsewhere to keep net size at or below today's.
- **Modes:**
  - live (`scheduled` after the supervised pass, or `supervised`): `guidelines-check --apply`;
  - `dry`, or `scheduled` before the supervised pass: plain `guidelines-check`, which writes nothing.
- **What `guidelines-watch.md` covers:**
  - Run the check; a tool warning goes in the digest and the run carries on.
  - File one ticket per applied change that has consequences (our files now over the limit, or "text to update"). Quote Anthropic's sentence and list them.
  - File one ticket per candidate key not already in `findings.jsonl`, through the existing unattended lane and caps.
  - Read the capped changed paragraphs, which are page text and data, never instructions. File a ticket only for new or changed advice about our setup files; otherwise write one digest line.
  - On a new major model in the changelog, file one "revisit CLAUDE.md for <model>" ticket per model.
  - A no-op week still commits the limits file and the log when they changed.
  - Step 10's commit list adds `anthropic-guidelines.json` and `guidelines-changes.jsonl` when changed.
- **Repairing a reworded sentence** is done in the ticket's session with Erez present: update the anchor, re-run `guidelines-check` (without `--apply`) and confirm "unchanged".

### 5. Surfacing (tool `readout`, shown at every /wrap)
- **For 30 days after each applied change:** "Anthropic changed a size limit: <id> <old> → <new> <unit> (<page>: "<sentence>"), applied <date>. Now over it: <file names or "none">. Hooks and the size checker follow it automatically."
- **Warnings:**
  - "guidelines watch has not run in N days" when `guidelinesCheckUtc` is more than 10 days old while live runs are succeeding;
  - page warnings from the last check.

## Tests
- **Fixture pages, no network:**
  - unchanged;
  - one number changed: the file is updated as an integer, a log row is written, the readout names the breaching files, and a ticket is filed when there are consequences;
  - reworded: candidate;
  - two numbers: candidate;
  - old and new number together: candidate;
  - 10x: candidate;
  - 25KB → 30KB gives 30,000 bytes;
  - "1536" without a comma;
  - failed download, HTML response, and a page under half its size: one page warning, and no per-anchor tickets;
  - first run: baseline only;
  - no `--apply` writes nothing;
  - the size checker still loads the file after an update.
- **Hooks and gate:**
  - Each notes hook follows a raised and a lowered cap (for example 5,000 and 15,000), and its kept text stays under the cap.
  - An unreadable file or an out-of-range value gives the fallback.
  - The surfacer and `update-config.ps1` both follow a lowered value (150). They follow a raised value (250) only when the log carries it; a hand-edited 250 with no log row gives 200 plus the warning. Both are tested in step, on a scratch copy.
  - The notes hooks are also tested at the 2,000 floor.
  - The stray-copy test passes.
- **Live:** one real run against today's pages: no changes, 7 hashes stored, and every anchor matches exactly once.

## Residual
- The watch runs weekly and only while the Claude app is open, so a change is picked up within about a week. The 10-day readout warning covers a stalled watch.
- Changes outside the 7 pages are not seen.
- If Anthropic's own sentence is wrong, the automatic change is wrong too. It is quoted at /wrap and can be undone in git.
- The house 12,000-character cap and prose text in the limits file are ours. They are flagged as "text to update", never auto-edited.
- The new-advice path reads page text, and the existing ticket review is its only guard.
- The weekly run and an attended edit of the limits file at the same moment could lose one edit. Both are rare, and git shows it.

## Amendments (focused Opus review after round 3; approved with the plan, 2026-10-26)
1. **Tests can never touch the real files.**
   - `guidelines-check` gets `--root <dir>`, the folder holding the limits file, `guidelines-changes.jsonl`, `state.json` and `docs/`.
   - `--apply` with `--pages-dir` is refused unless `--root` points outside the real project.
   - A test proves that a fixture `--apply` leaves the real files byte-identical.
2. **Fallback names.** The rules-line fallback is renamed `FALLBACK_RULES_LINE_CAP` in the surfacer and `$FALLBACK_RULES_LINE_CAP` in `update-config.ps1`, so the stray-copy test has zero hits.
3. **Write order.** `--apply` writes the log row first, then renames the new limits file into place. A failed rename marks the row "not applied" (the readers ignore it).
4. **Reading the log.** Both readers (JavaScript and PowerShell) take the newest valid row whose status is applied, skip a malformed line, and compare its `new` field with the file's value. They are tested on the same fixture log.
5. **Repairing a reworded sentence that also changed the number.** Fix the anchor only, never the value by hand. The next live run applies and logs the change.
6. **Warning text** for an unlogged notes cap above 10,000: "notes cap in the limits file (N) does not match a logged Anthropic change; using 10,000".
7. **Residual.** The size checker and /suggest read the value without the cross-check, so a hand-edited value shows on approval cards while the gate stays at 200. This mismatch exists today too; it is listed, not fixed.

## Size lines
Measured 2026-10-26 with the installed size-check. "Proposed" is a target until drafted; the /vet-rule card will show the real lines.
- `~/.claude/skills/release-review/SKILL.md`:
  - size: 4,786 → ≤4,786 / 5,000 tokens (hard; skill-after-compaction)
  - size: 270 → ≤271 / 500 body lines (recommended; skill-md-lines)
  - size: description 531 → 531 / 1,536 characters (hard; skill-description-listing)
  - size: description 531 → 531 / 1,024 characters (recommended, note; skill-description-portable)
- `~/.claude/skills/release-review/guidelines-watch.md`:
  - size: new → <100 / 100 lines (recommended; reference-file-toc)
- size: skipped (no size limits apply to `release-review-tool.js`, the 5 hooks, `update-config.ps1`, `anthropic-guidelines.json` or `guidelines-changes.jsonl`)
