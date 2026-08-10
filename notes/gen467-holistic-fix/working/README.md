# GEN-467 holistic fix — working copies (apply set)

State as of 2026-08-09 (fix-pass session; follows the build + two code-review passes
of the same day — see HISTORY.md 2026-08-09 and GEN-467's resume note).

## Apply set (what gets installed at Step 6 mint+apply)

1. `stop-claim-linter.js` → `C:\Users\Erez\.claude\hooks\stop-claim-linter.js`
2. `stop-signal-surface.js` → `C:\Users\Erez\.claude\hooks\stop-signal-surface.js`
3. `posttooluse-foryou-released.js` → `C:\Users\Erez\.claude\hooks\posttooluse-foryou-released.js`
   (NEW file; installs INERT — see below)
4. `scheduled-scan-SKILL.md` → `C:\Users\Erez\.claude\scheduled-tasks\gen467-block-after-check-verify\SKILL.md`
   (ships IN the batch per the review findings: new event types, arm1-block
   reinterpretation, Bars 1–5 with numeric trip points, the no-guard-event
   duplicate bar, the selfaudit-nudges.jsonl discontinuity note, and the stale
   step-4 grep string fixed to "Claim-linter, automatic". Not a hook — outside
   the vetting mint, applied alongside it so the scan never describes hooks
   that aren't live. Its text says "applied with the batch this file shipped
   in", which is only true if it ships together with the hook files.)

Apply order: hook files first, then the SKILL.md; `node --check` each hook after
copy. **There is NO settings step in this batch** — the banked settings.json is
NOT applied (see below); do not read the general file-before-settings safety
ordering as implying one. At apply, also fill the SKILL.md's apply-date
placeholder with the actual apply timestamp (it gates every bar).
combined.diff covers the three HOOK files only (the vetting scope).

## NOT in the apply set

- `settings.json` — a FULL settings snapshot (frozen 2026-08-09) whose ONLY
  relevant content is the single PostToolUse entry (matcher "" →
  posttooluse-foryou-released.js). **Erez's decision 2026-08-09: keep the hook
  built but UNREGISTERED** (its registration was measured at ~445ms spawn cost
  per tool call; after Parts 1+2 zero recorded duplicates remain in its class).
  Banked so activation is one /vet-code away, gated on the scheduled scan's
  Bar 2. Do NOT apply it with the batch — and at activation, EXTRACT that one
  entry and add it to the then-current live settings via the config tools;
  never apply this snapshot whole (it would silently revert every settings
  change made after 2026-08-09).

## combined.diff

Regenerated 2026-08-09 after the fix pass: exactly the three apply-set hunks
(`git diff --no-index` vs the live files; the new hook diffs against /dev/null).
The settings.json hunk was removed per the decision above.

## Fix pass applied (2026-08-09, this working set)

All fixes from the 15 verified findings of the two code-review passes: bounded
`[ \t]{0,16}` opener-regex runs (both copies) + corrected false "linear" comments;
single-scan shape + derived regex flags; agent_id sub-agent guard in the new hook
(+ corrected false "MAIN session only" claim — GEN-678 tracks the two other hooks);
`branch` field only on nudge rows; "is all that surfaces" reword; record-sourced
branchless arm1Reason; restored anti-spawn prohibition + not-due fallback in the
block-out branch; midturn-note = "attempted" honesty; new-hook header evidence
corrections (window evidence n=1; Aug-5 tool-call count 6, recounted live);
symbol-name citations; enriched release-skipped-tail detail (bareLine/prevIsHr/
msgLen); reorder append-position warning; no-Stop-topology residual in both files;
REGISTRATION STATUS header in the new hook.

## Fix pass 2 (2026-08-10, after the re-run of both review passes)

All Pass-A findings (15 reported + 9 sub-cap) and Pass-B advisories (5) applied;
extended live-fire 53/53. One item DEFERRED deliberately, not dropped:
stop-signal-surface.js's stop_hook_active exit precedes marker consumption, so
a detect marker written during a hook-continuation turn is never consumed and
its durable 'detect' line stays unpaired (/wrap then reports a false
crash-orphan). Pre-existing, touches load-bearing re-fire logic, needs its own
fixture — file as a follow-up ticket rather than patching in this batch.

Verified by the scratchpad mini live-fire (42/42: real-process runs of all three
hooks, reason-self-scan over all six captured injected strings, bounded-regex perf
probe 0ms at 190K, enriched tail-skip event shape, agent_id guard behavior).
Full Step-4 fixtures (opener replay over regenerated openers.json, negative set,
boundary fixture, GEN-602 reorder fixture, pass-consumption assertion) come after
the re-run of both review passes.
