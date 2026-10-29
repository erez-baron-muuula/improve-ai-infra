# GEN-889 (second half) + GEN-710 + GEN-958 + GEN-990 — build design (round 2)

Approved plan: `C:\Users\Erez\.claude\plans\come-up-with-a-soft-haven.md` (converged /check, 2 rounds; Erez approved it 2026-10-29).
Working copies: `notes/gen889/wc/hooks/*.js`, `notes/gen889/wc/refs/*.md`. Baselines: `notes/gen889/live-before/`.
Builders: `make-split.js` (notes split, byte-for-byte block moves + coverage check + two cross-reference fixes), `make-wc.js`. Install guard: `preinstall-check.js`. Tests: `test.js` (45/45).
Round-1 rewordings of relay notices were built and then dropped (kept for the record in `notes/gen889/dropped/`).

## The rule being applied

Anthropic, code.claude.com/docs/en/hooks.md, "Add context for Claude": "Write the text as factual statements rather than imperative system instructions ... Text framed as out-of-band system commands can trigger Claude's prompt-injection defenses, which causes Claude to surface the text to you instead of treating it as context." Also: each `additionalContext` string is capped at 10,000 characters; over it Claude gets a path + 2,000-character preview.

## Evidence

- **Misfire seen:** only `INVOICE_CODEJS_POINTER` in `inject-edit-refs.js`. Read-only reviewer sub-agents (2026-08-17, 09-10, 09-14) reported "a PreToolUse:Read hook additional context ... instructing me to treat this as a file edit" and spent a paragraph flagging it. Here the failure Anthropic describes (surfacing instead of using as context) defeats the note's purpose. Source: a search of every local transcript for assistant text containing "prompt injection" / "injected instruction" (11 hits, 9 files); the other flagged texts were harness text (MCP server instructions, plan-mode reminder). Limit: the search sees only cases where Claude said those words, not notes it silently ignored.
- **Relay notices work as written:** the round-1 pre-mortem reviewer found session-start "Relay this to Erez at the top of your first response" notices relayed in the first reply (Memory Islands Dev session `f76bb84d` line 37, 2026-10-18; Improve AI Infra session `ef5b356b` line 13), across about 63 sessions that carry such notices.

## Sorting rule, refined in round 2

The plan's rule was: reword an order that can misfire where the hook fires, or text framed as an out-of-band system command. Round 2 adds the test Anthropic's own failure mode implies: **reword where Claude surfacing the text, instead of using it, defeats its purpose.**
- **A — reword:** text whose purpose is silent use as context but that reads as an order out of place. Only the Code.js pointer qualifies (it orders an edit on reads, including read-only sub-agents' reads).
- **B — keep, with reason:** (1) **relay notices**, whose whole purpose is to reach Erez, so Claude surfacing them is success, they are proven to be relayed today, and fact-wording risks a silent miss for notices that are shown once (the surfacer advances its cursor on emission; the rules-size note is marked shown on emission); (2) conditional domain advice in `refs/*.md`; (3) deny/ask/block decision text; (4) checker lines about the call just made.
- **C — deferred:** the two held For-you hooks, after 1 Nov (plan Step 5).

This narrows the plan's Step 2 bullet "Category-A strings in other non-held hooks reworded as statements, including the 'missing or empty … flag this to Erez' / 'tell Erez it needs splitting' notices" — those are relay notices, now kept — and resolves its Step 3 bullet "Reword category-A passages across refs/*.md" to none reworded (B2). Both stated on the approval card.

## Changes

| File | Change |
|---|---|
| `inject-edit-refs.js` | `INVOICE_CODEJS_POINTER` reworded as facts true on Read and Edit: "Invoice Automation Code.js (this file): some functions here feed `fileHeldInvoiceManually_`, the rare Gemini-outage hand-file backup that runs ONLY during outages, so a break in what it depends on stays silent until the next outage. The header comment of `function fileHeldInvoiceManually_` documents the input contract (...) of the shared helpers it calls, so an edit to one of those helpers is safe only if it keeps that contract or updates the comment to match, which takes reading that comment first. This note is background for any edit of this file and asks nothing of a read." (644 characters, measured by node; the live one is 529.) Missing-notes notice text unchanged (moved into a constant). Closes GEN-710. |
| `inject-windows-mcp-refs.js` | Rewritten for two parts (GEN-958): part 1 `refs/windows-mcp.md` on the first qualifying call, part 2 `refs/windows-mcp-troubleshooting.md` on the next; one part per call; markers `claude-refs-windows-mcp-part1/2-<session>` (exclusive create), so `inject-topic-refs.js --reset-after-compact` re-arms both (today's marker `claude-windows-mcp-refs-<session>` is not reset). Cap per part from `guidelines-limits.js` (`hook-injected-text`, fallback 10,000) minus 500, as the browser injector does; over cap → the browser injector's existing notice ("... -- read it with the Read tool (path) and tell Erez it needs splitting."). Missing notice keeps today's form, naming the part ("... missing or empty -- PC-control notes (part 1 of 2) were NOT loaded; flag this to Erez."; today: "PC-control lessons"). Pure `handle()` exported for tests. Sub-agents still skipped. |
| `inject-browser-refs.js` | Part 2 `refs/browser-sites.md` (GEN-990) only once the part-1 marker exists when a call reaches its notes step (so never in the same string as part 1; in a parallel race the two still go to different strings); marker `claude-refs-browser-part2-<session>` (covered by the compaction reset). Same fit-or-defer test per part (factored into `addNotes`), with today's notice wording. Diagnosis text unchanged. |
| `windows-mcp-approval.js` | Only the `STUCK_STEPS` pointer: "Details: "Stuck add-on" in .../refs/windows-mcp-troubleshooting.md" (the section moved there). |
| `windows-mcp-approval.test.js` | Injector test now expects part 1, then part 2, then nothing; cleans up both new markers. |

Notes (no rule text changed; whole blocks moved byte-for-byte, coverage checked by script before two cross-reference fixes):
- `refs/windows-mcp.md` → part 1 (header gains one sentence naming part 2) + `refs/windows-mcp-troubleshooting.md` (Pop-up dialogs, Stuck add-on, works in every folder). Part 1 keeps everything needed before and during the first actions (last resort, announce, task pass, websites, approved-task limit, one call at a time, report every miss, read the window first, setup with own tools).
- `refs/browser.md` → part 1 (all but Site notes) + `refs/browser-sites.md` (Site notes).
- Part-2 headers: "Part 1, `refs/<file>`, arrived earlier in this session."
- Cross-reference fixes (the only wording changes inside moved blocks): windows-mcp "No countdown may mean a stuck add-on (next item)." → "(\"Stuck add-on\" in part 2, `refs/windows-mcp-troubleshooting.md`)"; browser "Insert through the editor's own view instead (below)." → "(Snowsight, in part 2, `refs/browser-sites.md`)".
- Size-checker output (`config-health-scan.ps1 -Action size-check -Target <draft> -AsIfPath <live path>`, run 2026-10-29, 0 breach / 0 near / 0 errors each):
  - `size: C:\Users\Erez\.claude\hooks\refs\windows-mcp.md 9,923 → 8,318 / 10,000 characters (hard; hook-injected-text)`
  - `size: C:\Users\Erez\.claude\hooks\refs\windows-mcp-troubleshooting.md new → 1,956 / 10,000 characters (hard; hook-injected-text)`
  - `size: C:\Users\Erez\.claude\hooks\refs\browser.md 9,318 → 6,340 / 10,000 characters (hard; hook-injected-text)`
  - `size: C:\Users\Erez\.claude\hooks\refs\browser-sites.md new → 3,283 / 10,000 characters (hard; hook-injected-text)`
- Final installed sizes (after the absolute part-2 paths were added to the part-1 headers): `windows-mcp.md` 8,346, `windows-mcp-troubleshooting.md` 1,956, `browser.md` 6,368, `browser-sites.md` 3,283 characters. Final tests: 47/47. The two browser parts together (9,651) are under 10,000 but over the injector's 9,500 per-string cap, which is why they travel separately.
- Early warning for regrowth already exists: the GEN-890 weekly size check reports a file "near" its limit and files a ticket (it filed GEN-958 and GEN-990).
- `notes/anthropic-guidelines.json` `hook-injected-text.appliesTo` says the Code.js pointer is 580 characters on "edits" (already stale: live is 529); at install it becomes "a ~650-character Code.js pointer on Invoice Automation Code.js reads and edits" (description text only; no limit value changes; nothing parses the number).

## Inventory for GEN-889 (every hook that adds text to Claude's context)

- **Reworded (A):** `inject-edit-refs.js` Code.js pointer.
- **Kept — relay notices (B1):** `sessionstart-backup-surfacer.js` (12 "Relay this to Erez ..." / "Tell Erez in the 📌 For you block ..." lines), `sessionstart-configunlock-reaper.js` (safety-switch alarm), `browser-site-gate.js` (over-bar alert), `inject-browser-refs.js` (diagnosis and re-evaluate-bar lines), `inject-perk-refs.js` (perk reminder and warnings), the "missing or empty ... flag this to Erez" notices in `inject-notion-refs.js`, `inject-jira-refs.js`, `inject-shell-refs.js`, `inject-deployment-refs.js`, `inject-topic-refs.js`, `inject-edit-refs.js`, `inject-windows-mcp-refs.js`, `inject-browser-refs.js`; `prompt-wmcp-miss-reminder.js`, `stop-cred-denial-surface.js`. Reason: their purpose is to reach Erez; Claude surfacing them is success; they are relayed today.
- **Kept — reference notes (B2):** all `hooks/refs/*.md` (conditional domain advice led by its fact, delivered at the matching tool; none flagged). The windows-mcp and browser notes are only split.
- **Kept — decision text (B3):** deny/ask/block reasons in `auto-approve.js`, `windows-mcp-approval.js` (pre-checks), `windows-mcp-delete-guard.js`, `deny-askuserquestion.js`, `confirm-send.js`, `precompact-loggate.js`, `reviewer-verdict-guard.js`, `notion-schema-guard.js`.
- **Kept — checker lines and self-labelled automatic notes (B4):** `notion-write-verify.js`, `notion-fetch-staleness.js`, `windows-mcp-approval.js` post-call notes (incl. `STUCK_STEPS`), `stop-claim-linter.js`, `stop-signal-surface.js`, `auto-approve.js` break-glass notes and redirect nudge (fire only in break-glass or as advice). Each describes the call just made or labels itself "automatic ... not a message from Erez"; none flagged. The two Stop notes also steer when the For-you block is written, so as a precaution against altering For-you behaviour while the 1 Nov week check is measuring it, they are revisited with the held hooks in Step 5, not before.
- **Already fact-form:** `sessionstart-skill-restore.js`; the fit-to-cap and deferral lines in `inject-topic-refs.js`, `inject-notion-refs.js`, `inject-shell-refs.js`.
- **Inactive:** `sessionstart-loggate.js` (`~/.claude/.loggate-verified` exists since 2026-06-24).
- **Deferred (C):** `pretooluse-effort-tag-gate.js`, `stop-foryou-nudge.js` — after 2026-11-01.
- **Emit no context text:** `planmode-readonly-answer.js`, `posttooluse-signal-detect.js`, `sessionstart-backup-spawner.js`, `permission-denied-log.js`, `sessionstart-session-backup.js`, `account-session-sync.js`.

## Install

- Precondition: `node notes/gen889/preinstall-check.js` immediately before minting — every live file being replaced is byte-identical to `live-before/`, and the two new notes files don't exist yet; any difference stops the install and the change is rebuilt from the newer live text (GEN-980 has browser-notes work queued; its handoff gets a line about the split).
- Order: notes first (new part-2 files, then the two part-1 files), then the injectors, then `windows-mcp-approval.js` and its test. A new windows-mcp injector reading the old 9,923-character file would emit only a size notice. Rollback restores notes and hooks together from `live-before/` (old injectors with new notes deliver part 1 only).

## Residuals

- A session that makes only one qualifying PC-control or browser call gets part 1 only (part 1 carries the before-action rules).
- At install, a running session holding the old windows-mcp marker may get part 1 once more; a running session that got the old one-file browser notes gets the site notes again as part 2 (harmless duplicates).
- The new pointer no longer orders "read the header comment before finishing this edit"; it states that a safe edit takes reading it first. Compliance on real edits may be slightly lower; that is the trade-off GEN-710 asks for.
- Ticket close-out: GEN-958's and GEN-990's done-when says all notes arrive on the first call; updated to "part 1 on the first call, part 2 on the next" before either goes to Done. GEN-990 closes only after a live browser call shows both parts.
- `notes/gen883/smoke.js` is marked superseded (it expects one browser notes file).
- GEN-697 (one shared injector helper) should absorb the per-hook two-part delivery later.
