# GEN-953 step 1 — plans open in plain words (design)

## Goal (Erez, 2026-10-25, verbatim)
"I keep getting approval pop ups that looks trivial, and I approve them and think maybe there weren't supposed to happen. Also, some approval I approve without reading too deeply since it's too technical for me"

Approved plan step (`notes/approval-popups/plan-approved-2026-10-25.md`, step 2): "Every plan you're asked to approve opens with a short box: what changes for you, who is affected, whether it can be undone, what you need to do, and Claude's recommendation. A plan without it is sent back to Claude before you ever see it."

Erez approved this design on 2026-10-26: "Yes, build step 1 as proposed."

## Where
`~/.claude/hooks/pretooluse-effort-tag-gate.js`, ExitPlanMode branch (PreToolUse). That branch already reads the plan (`tool_input.plan`, or `planFilePath` confined to `~/.claude/plans/`, <= 1 MB) and refuses once when the plan has no effort level (GEN-619). Same file, same registration; no settings.json change.

## Behaviour
1. New pure function `planOpensPlain(text)`:
   - Headings = lines matching `^\s{0,3}#{1,6}\s+(.+)` OR a whole-line bold pseudo-heading `^\s*\*\*(.+?)\*\*:?\s*$`. Lines inside fenced code blocks (``` / ~~~) are ignored.
   - If the first heading is level 1 (`# `), it is the title and is skipped; the next heading is the first section. Otherwise the first heading is the first section.
   - Pass when the first section heading's text matches `\bplain\b` or `\bfor Erez\b` (case-insensitive). Covers the real forms seen: "In plain words (for Erez)", "In plain terms", "Context (plain terms)", "How it works for Erez".
   - No section heading at all -> fail.
2. ExitPlanMode decision: `missing = []`; push `effort` if `!planHasEffort`, push `plain` if `!planOpensPlain`. Non-empty -> the existing block-once path (one refusal per session+tool+prompt within 300 s, then the retry passes and is logged `passed-after-deny`). Both missing -> ONE combined refusal naming both fixes.
3. Refusal text for `plain`: tells Claude to put a first section headed "## In plain words (for Erez)" right under the title, covering in plain, non-technical words: what changes for Erez, who is affected, whether it can be undone, what he must do, and Claude's recommendation; technical detail goes below it. Only the heading is machine-checked; the five items are instructions.
4. Log: plan rows keep current outcomes (`tagged` when nothing missing, `blocked`, `passed-after-deny`, `plan-unavailable`, `error`), plus a `missing` array on blocked / passed-after-deny plan rows. `boxscan.js` (GEN-941 week check, 1 Nov) flags WRONG only for box-tool rows, so plan rows do not disturb it.
5. Fail-open unchanged: unreadable plan -> `plan-unavailable`, no block; state-write failure -> no block; any exception -> exit 0.
6. Exports: add `planOpensPlain` for tests. Header comment gains a GEN-953 paragraph.

## Adopted from the /check panel (round 1, all three lenses PASS; advisories taken)
- A whole-line bold line counts as a section heading only when it itself matches the plain pattern; other bold lines (`**Tickets**`, `**Effort to execute: xhigh**`) are ignored (real false fire: `propose-a-solution-for-vectorized-dahl.md`).
- A level-1 first heading that itself matches plain passes (not skipped as a title).
- "for Erez" must not be followed by `'s` or ` to` ("for Erez's OK", "for Erez to confirm" are not plain-box headings).
- `notes/foryou-repeat/boxscan.js` REFUSED lines print the `missing` array, so the 1 Nov check shows plan refusals by cause.
- The replay reports how many refused plans had a plain section lower down.

## Not doing
- No word-by-word check of the five items (would refuse good plans; Erez accepted heading-only).
- No position tolerance: a plain section lower down is sent back once to move it to the top (Erez accepted).
- Box-question path untouched.

## Evidence
- Last 60 plan files in `~/.claude/plans/`: 27 have a plain heading as the first `##` section, 34 anywhere.
- Claude Code docs: a PreToolUse hook exiting 2 blocks the call and feeds stderr to Claude (the existing GEN-619 plan check uses exactly this on ExitPlanMode and has fired in production — see `effort-tag-gate.jsonl` blocked rows for ExitPlanMode).

## Verification
- Unit tests for `planOpensPlain` (title/no title, bold pseudo-heading, code fence, no headings, CRLF, plain lower down).
- Realism replay over every plan file in `~/.claude/plans/` through the real hook via stdin: each fire hand-checked; a plan that opens with a plain section but is refused = false fire.
- Regression: effort-only behaviour unchanged on the same corpus (fire set for `effort` identical to live hook).
- Live: one plan-mode ExitPlanMode without the section is sent back once; with it, passes.
