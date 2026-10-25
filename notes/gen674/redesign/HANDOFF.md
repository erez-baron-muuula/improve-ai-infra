# GEN-674 size-stop redesign — handoff (cold start)

Status (2026-10-25): SUPERSEDED IN PART. Erez chose option E ("Go with option E. Start with the one-click prompt test.") — read `option-e-proposal.md` (this folder) first; its step 1 (ask-rule prompt test) passed. Next: rebuild the working copies to option E, then two code reviews, approval card, install. The B+/A text below is history.

Original status: built and tested, NOT installed. Waiting on Erez's answer to one question.

## Pending decision (asked 2026-10-21, not yet answered)
"Which way should the size stop go in?"
- **B+ (recommended, review panel converged 3/3 in 2 rounds):** install the core WITHOUT the two command-text add-ons, plus a ~10-line session-start check that flags if `update-config.ps1` no longer contains its two `Invoke-RulesSizeStop` calls or `update-global-rule.ps1` no longer hands off to `update-config.ps1` (unreadable/missing Drive script -> a silent "could not check", not an alarm). Proposal text: `standoff-proposal.md` (this folder).
- **A:** install as built (both add-ons). Known gaps and wrong refusals; unmeasured false-refusal count.
Ask Erez again if no answer is on record. Do not install anything before he answers.

## What exists
- Approved plan: `plan.md` (this folder; copy of `~/.claude/plans/gen-674-redesign-the-rules-file-sharded-hanrahan.md`).
- Working copies: `wc/` (update-config.ps1, auto-approve.js, sessionstart-backup-surfacer.js, deny-askuserquestion.js, size-approval-prompt.js [new], settings.json). They were built on the live files of 2026-10-21 (incl. GEN-924's browser-gate edits by another session). **Rebuild before use**: `node build.js` re-applies `spec-*.txt` (exact-once replacements) to the current live files and writes `wc/`; `size-approval-prompt.js` is authored directly in `wc/` (build.js does not regenerate it — keep the saved copy).
- Checks: `node syntax.js` (node --check, JSON parse, PowerShell parser, NUL/BOM scan); `node mkdiff.js` (writes wc.diff vs live).
- Tests: `..\sizestop2-test.js <wc dir> <fixtureRoot>` — last result `{"pass":153,"fail":0}` (with add-ons). Replay of past commands: `..\sizestop2-corpus.js` — known flaw: runs in fixture paths, so it cannot see false refusals on real paths; must be fixed to use real paths (without touching live staging/log files) before the approval card.
- Vetting evidence: `step1-reviewers.json` (design /check agentIds), `passB-ids.json` (Pass B agentIds + findings). The transcripts live under session fc640018-e3f8-4d8d-bdca-f1c9dbfeee14's `subagents\` folder; a new session must run its own /check for its own record (the mint check needs this session's transcripts).

## Design in one paragraph
`update-config.ps1` measures the exact bytes it is about to write; a target is "the rules file" when its bytes equal `~/.claude/CLAUDE.md`'s. Crossing 200 lines (limit may only be lowered by `notes/anthropic-guidelines.json` claude-md-lines) without approval -> exit 6, nothing written. Approval = `-ApproveSizeUpTo N` + a per-session one-time grant (`grant-<CLAUDE_SESSION_ID>.json` in `~/.claude-staging/` + `rulesize` + `-ok`) written by the new PreToolUse hook `size-approval-prompt.js`, which forces Claude Code's own "ask" prompt. Approval record (sha256) kept so the session-start check (in `sessionstart-backup-surfacer.js`) stays quiet for an approved over-limit file; it also wipes all grants at session start. auto-approve.js: vetting lock on the two Drive scripts, guard on the approval folder (never write the folder name whole in a shell command, description or commit message once live), refusal of direct shell writes to the global CLAUDE.md.

## If B+ is chosen — steps
1. Prompt-premise probe BEFORE installing: in auto mode, PowerShell tool, `curl.exe -X POST https://api.notion.com/v1/pages` (no auth; can only 401). notion-schema-guard.js should force a prompt; Erez clicks Deny. First feed the same string to the hook as a fixture to confirm it returns "ask". No prompt shown -> stop, redesign the approval.
2. Remove both add-ons from the specs: in `spec-auto-approve.txt` drop the `commandWritesRulesFile` second signal (+ its `@@@OLD function blockCheckDue` block) and the `DRIVE_SCRIPT_TAILS` / `RUNS_DRIVE_SCRIPT_RE` copy-guard block; keep the precise Case-3 refusal. Add the script-contents check to `spec-surfacer.txt`. Update tests (drop A4c-A4g, A7g-A7h; add script-check cases). Fix the replay; report counts.
3. /check the reduced design if it changed, write the vetting records, fresh Pass A (/code-review high) + Pass B (check-reviewer, model opus) on the reduced diff.
4. Approval card -> re-check live files unchanged right before mint (rebuild + refresh contentHash if not) -> mint one vetting pass per target -> apply (scripts first, then hooks, settings.json last) -> verify sha256 -> sync.
5. Live test on a byte-equal scratch copy of CLAUDE.md: no switch -> exit 6; switch -> prompt; Deny -> nothing written; Allow -> written. Rollback copy of settings.json prepared before step 4 (unregistering the hook is itself vetting-gated).
6. GEN-674 note; GEN-938 note with the add-on designs and round-2 findings; then Waves 2-4.

Verified facts: Claude Code 2.1.304; `$env:CLAUDE_SESSION_ID` reaches the PowerShell tool; docs (code.claude.com/docs/en/hooks, /permissions): hook "ask" forces a prompt in auto mode and an allow rule does not remove it.
