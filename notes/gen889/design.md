# GEN-889 (second half) + GEN-710 + GEN-958 + GEN-990 — build design

Approved plan: `C:\Users\Erez\.claude\plans\come-up-with-a-soft-haven.md` (converged /check, 2 rounds; Erez approved it 2026-10-29).
Working copies: `notes/gen889/wc/hooks/*.js`, `notes/gen889/wc/refs/*.md`. Baselines: `notes/gen889/live-before/`.
Builders: `make-split.js` (notes split, byte-for-byte block moves + coverage check), `make-wc.js`, `reword-missing.js`, `reword-surfacer.js`. Tests: `test.js` (69/69).

## The rule being applied

Anthropic, code.claude.com/docs/en/hooks.md, "Add context for Claude": "Write the text as factual statements rather than imperative system instructions ... Text framed as out-of-band system commands can trigger Claude's prompt-injection defenses, which causes Claude to surface the text to you instead of treating it as context." Also: each `additionalContext` string is capped at 10,000 characters; over it Claude gets a path + 2,000-character preview.

## Evidence on which text actually misfires

A search of every local transcript (`~/.claude/projects/**/*.jsonl`) for assistant text mentioning "prompt injection" / "injected instruction" found 11 hits in 9 files. Traced: the only hook text of ours flagged as a suspected injection is `INVOICE_CODEJS_POINTER` in `inject-edit-refs.js` (read-only reviewer sub-agents, 2026-08-17 / 09-10 / 09-14 — "a PreToolUse:Read hook additional context ... instructing me to treat this as a file edit"). The other flags were harness text (MCP server instructions, plan-mode reminder), not ours. No refs note was flagged.

## Sorting rule (from the plan)

- **A — reword:** an order that can misfire where the hook fires (wrong tool, read-only reader, sub-agent), or text framed as an out-of-band system command (ALL-CAPS "ACTION:", "relay this to Erez at the top of your first response", "flag this to Erez").
- **B — keep, with reason:** conditional domain advice led by its fact; deny/ask/block reasons (decision text — Anthropic's guidance is about added context); checker lines about the call that just ran, which the notes tell Claude to expect.
- **C — deferred to after the 1 Nov week check:** text in `pretooluse-effort-tag-gate.js` and `stop-foryou-nudge.js`.

## Changes (A)

| File | Change |
|---|---|
| `inject-edit-refs.js` | `INVOICE_CODEJS_POINTER` reworded as facts true on Read and Edit ("... the header comment of `function fileHeldInvoiceManually_` documents the input contract ...; a change to one of those helpers either keeps that contract or updates the comment to match. This note is background for any edit of this file and asks nothing of a read."). Missing-notes notice → fact. Closes GEN-710. |
| `inject-windows-mcp-refs.js` | Rewritten for two parts (GEN-958): part 1 `refs/windows-mcp.md` on the first qualifying call, part 2 `refs/windows-mcp-troubleshooting.md` on the next; one part per call; markers `claude-refs-windows-mcp-part1/2-<session>` (exclusive create), so `inject-topic-refs.js --reset-after-compact` re-arms both (today's marker `claude-windows-mcp-refs-<session>` is not reset). Cap per part from `guidelines-limits.js` (`hook-injected-text`, fallback 10,000) minus 500, as in the browser injector; over cap → one fact line with size and path. Pure `handle()` exported for tests. Sub-agents still skipped. |
| `inject-browser-refs.js` | Part 2 `refs/browser-sites.md` (GEN-990) only on a call AFTER the one that delivered part 1 (the part-1 marker already exists when this call reaches its notes step; in a parallel race the two parts still go to different strings); marker `claude-refs-browser-part2-<session>` (covered by the compaction reset). Same fit-or-defer test per part (factored into `addNotes`). Missing / over-cap notices → facts. Diagnosis tails ("Tell Erez this in one line ...", "Tell Erez; in a scheduled task ...", "Tell Erez the browser is still not reliable ...") → facts. |
| `windows-mcp-approval.js` | Only the `STUCK_STEPS` pointer: "Details: "Stuck add-on" in .../refs/windows-mcp-troubleshooting.md" (the section moved there). |
| `windows-mcp-approval.test.js` | Injector test now expects part 1, then part 2, then nothing; cleans up both new markers. |
| `inject-notion-refs.js`, `inject-jira-refs.js`, `inject-shell-refs.js`, `inject-deployment-refs.js`, `inject-topic-refs.js` | "missing or empty — ... NOT loaded; flag this to Erez." → "... is missing or empty, so the ... reference notes are not in this session; Erez has not been told." (topic-refs also its unknown-topic notice). |
| `inject-perk-refs.js` | " Flag this to Erez." → " Erez has not been told."; perk reminder's "mention the perk to Erez ... update its Status line" → "the perk is worth mentioning to him ...; its "- Status:" line in that file is updated in the same turn". |
| `sessionstart-configunlock-reaper.js` | Alarm: "SAFETY SWITCH STUCK ON — relay this to Erez ... ACTION: delete the file" → facts: what is open, that safety reviews are disabled, that deleting the file re-arms them (same `rm` line), the one reason to keep it, "Erez has not been told; this is the first thing he needs to hear in the session." |
| `sessionstart-backup-surfacer.js` | 12 strings: "Relay this to Erez at the top of your first response" → "Erez has not seen this yet; it belongs at the top of the first response."; "Tell Erez in the 📌 For you block of your first reply" → "Erez has not been told; it belongs in the 📌 For you block of the first reply" (the with-record rules-size line: "Erez has not been told; it belongs once in the 📌 For you block ..."); "ACTION: Relay this to Erez immediately ..." → fact; secret line meaning kept. |
| `browser-site-gate.js` | Over-bar alert "Tell Erez in your next For-you block ..." → "Erez has not been told; with these causes in the next For-you block, he can decide whether the browser gate's rules need revisiting." |

Notes (no rule text changed; whole blocks moved byte-for-byte, coverage checked by script before two cross-reference fixes):
- `refs/windows-mcp.md` → part 1 (header gains one sentence naming part 2) + `refs/windows-mcp-troubleshooting.md` (Pop-up dialogs, Stuck add-on, works in every folder). Part 1 keeps everything needed before and during the first actions (last resort, announce, task pass, websites, approved-task limit, one call at a time, report every miss, read the window first, setup with own tools).
- `refs/browser.md` → part 1 (all but Site notes) + `refs/browser-sites.md` (Site notes).
- Cross-reference fixes (the only wording changes inside moved blocks): windows-mcp "No countdown may mean a stuck add-on (next item)." → "(\"Stuck add-on\" in part 2, `refs/windows-mcp-troubleshooting.md`)"; browser "Insert through the editor's own view instead (below)." → "(Snowsight, in part 2, `refs/browser-sites.md`)".
- Size-checker output (`config-health-scan.ps1 -Action size-check -Target <draft> -AsIfPath <live path>`, run 2026-10-29, 0 breach / 0 near / 0 errors each):
  - `size: C:\Users\Erez\.claude\hooks\refs\windows-mcp.md 9,923 → 8,318 / 10,000 characters (hard; hook-injected-text)`
  - `size: C:\Users\Erez\.claude\hooks\refs\windows-mcp-troubleshooting.md new → 1,987 / 10,000 characters (hard; hook-injected-text)`
  - `size: C:\Users\Erez\.claude\hooks\refs\browser.md 9,318 → 6,340 / 10,000 characters (hard; hook-injected-text)`
  - `size: C:\Users\Erez\.claude\hooks\refs\browser-sites.md new → 3,311 / 10,000 characters (hard; hook-injected-text)`
- `notes/anthropic-guidelines.json` `hook-injected-text.appliesTo` says the Code.js pointer is 580 characters on "edits"; the new one is 590 and fires on reads too. Updated at install (description text only; no limit value changes).

## Kept (B), with reason

- **All `hooks/refs/*.md` notes** (except the split): conditional domain advice led by its fact ("X fails when Y; Z works"), delivered at the matching tool; none was flagged in the transcript scan. Rewording ~94 KB of reviewed rules for wording alone risks meaning loss for no observed gain.
- **Deny / ask / block reasons** (auto-approve, windows-mcp-approval pre-checks, delete-guard, deny-askuserquestion, confirm-send, precompact-loggate, reviewer-verdict-guard, notion-schema-guard): decision text, outside the "added context" guidance; their job is to say what to do instead.
- **Checker lines about the call just made:** `notion-write-verify.js` ("Notion edit ..." lines, which `refs/notion-write.md` tells Claude to expect), `notion-fetch-staleness.js`, `windows-mcp-approval.js` post-call notes (incl. `STUCK_STEPS` wording).
- **`auto-approve.js` break-glass notes / redirect nudge:** fire only during break-glass or as an advisory; the file is a locked config file and the change would not pay for its gate.
- **`sessionstart-loggate.js`:** inactive (`~/.claude/.loggate-verified` exists since 2026-06-24, so it never fires).
- **`sessionstart-skill-restore.js`, `inject-topic-refs.js` fitToCap / deferred lines, notion/shell fitToCap notes:** already fact-form.

## Deferred (C)

`pretooluse-effort-tag-gate.js` and `stop-foryou-nudge.js` text — after the 2026-11-01 GEN-941/619 week check (Step 5 of the plan; GEN-889 stays In Progress).

Proposed addition to C (put to Erez on the approval card, since the plan named only the two hooks above): the order-style notes in `stop-claim-linter.js` (self-audit note), `stop-signal-surface.js`, `stop-cred-denial-surface.js` and `prompt-wmcp-miss-reminder.js`. They are not themselves held, but their text tells Claude when to write or not write the "📌 For you" block — the behaviour the GEN-941/619 week check is measuring through 2026-11-01 — so rewording them now could change what that check sees. They already label themselves as automatic background notes, and none was flagged in the transcript scan. Reworded with the two held hooks in Step 5.

Excluded as emitting no context text: `planmode-readonly-answer.js`, `posttooluse-signal-detect.js`, `sessionstart-backup-spawner.js`, `permission-denied-log.js`, `sessionstart-session-backup.js`, `account-session-sync.js` (their details reach Claude only through the surfacer).

## Install precondition

`notes/gen889/preinstall-check.js` hashes every live file being replaced against `live-before/` and confirms the two new notes files do not exist yet; any difference stops the install and the change is rebuilt from the newer live text (GEN-980 has browser-notes work queued). Run immediately before minting.

## Residuals

- A session that makes only one qualifying PC-control or browser call gets part 1 only (part 1 carries the before-action rules).
- A session running at install time already holds the old windows-mcp marker name, so it may receive part 1 once more at its next PC-control call; a running session that already got the old one-file browser notes gets the site notes again as part 2 (both harmless duplicates).
- Ticket close-out: GEN-958's and GEN-990's done-when text says all notes arrive on the first call; it is updated to "part 1 on the first call, part 2 on the next" before either goes to Done. GEN-990 closes only after a live browser call shows both parts.
- The reworded alarms (surfacer, reaper) are unit-tested for wording only; whether Claude still relays them is seen at their next real firing.
- `notes/gen883/smoke.js` (an old build test of the browser injector) still expects one notes file; it is a build artifact, not a live test.
- GEN-697 (one shared injector helper) should absorb the per-hook two-part delivery later.
