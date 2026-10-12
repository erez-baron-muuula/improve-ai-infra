# GEN-812 — reviewer verdict guard: design (for /vet-code Step 1) — revision 2

## Goal
`/vet-ticket` reviewers (`check-reviewer` sub-agents) often hand back a complete review without the
machine-readable last line `TICKET-REVIEW-VERDICT: PASS|REVISE <64-hex contentHash>`, so
`auto-approve.js`'s ticket gate blocks with `no-token` and the caller must SendMessage a restatement.
Observed 4/8 and 3/7 reviews on 2026-10-11 (5/9 in InvoiceAutomation session 6747d9f7, per round-1
reviewer). Same model, prompt and delivery path for failing and passing reviewers; the briefs already end
with the exact block, so wording alone has not fixed it. Acceptance (GEN-812): ≥9 of the next 10 ticket
reviews deliver a verdict `--ticket-verify` accepts on the first reply the caller receives.

## Mechanism
New hook `~/.claude/hooks/reviewer-verdict-guard.js`, registered in global `settings.json` as a
`PreToolUse` entry with matcher `SubagentHandback`. When a ticket reviewer's hand-back lacks a
well-formed verdict line, it **denies** the hand-back with a reason telling the reviewer to re-send the
same report ending with that line. The caller then receives only the corrected report.

Grounding (verified):
- PreToolUse fires on `SubagentHandback`: `~/.claude/hooks/deferred-calls.jsonl` has 239 rows with
  `"tool":"SubagentHandback"`, written by `auto-approve.js`'s PreToolUse run.
- Hook input inside a sub-agent carries `agent_id`, `agent_type`, `session_id` (= the main session's),
  `transcript_path`: `~/.claude/hooks/gen337-probe.jsonl` (2026-07-07, check-reviewer Read/Grep calls —
  not a SubagentHandback call, so re-confirmed at the live test); docs say the same
  (code.claude.com/docs/en/hooks). Fallback for `agent_type`: the `.meta.json` sidecar.
- Report text is `tool_input.message` (docs; `auto-approve.js` L3426 reads `b.input.message`).
- A PreToolUse deny is recorded as a user record carrying a `tool_result` with `is_error:true` — not a
  prompt, so `turn` doesn't advance (`…Improve-AI-Infra/00aa7395-….jsonl` line 54, round-1 reviewer).
- The gate judges the LAST hand-back attempt in a turn and requires it confirmed (`auto-approve.js`
  L3404-3432), so a denied attempt followed by a confirmed re-send is judged on the re-send.
- Settings edits to hooks are "picked up automatically by the file watcher" (docs, relayed) — live test
  can run in-session.
- UNVERIFIED (hard live-test gate): that a reviewer whose hand-back was denied re-sends it. No refused
  hand-back exists in history (0 of 227 in a scan of all sub-agent transcripts this session). A
  successful hand-back's result carries `toolEndsTurn:true`; a denied one may differ.

## Decision logic (any exception → defer; see Fail-safe)
1. `tool_name !== 'SubagentHandback'` → defer. Kill switch file `reviewer-verdict-guard.off` exists → defer.
2. Reviewer type = input `agent_type`, or if absent the sidecar `agent-<agent_id>.meta.json` `agentType`
   (what the gate trusts, L3225-3233). Not `check-reviewer` → defer silently.
3. Transcript = `<sessionDir>/subagents/agent-<agent_id>.jsonl`, `sessionDir` from `transcript_path` via
   the gate's `ticketSessionDir` rule (L3214). Bad `agent_id`, > 4 MiB (gate cap L1980), unreadable →
   defer, log `error`.
4. Prompt records = the gate's `ticketIsPrompt` rule (L3346). `turn` = their count.
   - No prompt mentions `TICKET-REVIEW-VERDICT:` → not a ticket review → defer silently.
   - Expected hashes = every standalone 64-hex string (`\b[0-9a-f]{64}\b`, i) in the prompts. Callers
     write briefs freehand: real forms include `PASS <hash>`, `<PASS|REVISE> <hash>` (InvoiceAutomation
     `9f9b18c6-…/agent-a9d5f54cc8db764ab.jsonl` L1) and a placeholder line plus a separate
     `contentHash: <hash>` line (Memory Islands Dev `b045cb92-…/agent-acf7b6b92118322bc.jsonl` L1).
   - Prefix mentioned but no hash anywhere → defer, log `nohash` (a /check review discussing the gate, or
     a new brief shape — reported separately, never counted).
   - A prompt containing `GEN812-LIVE-TEST` marks the rows `test: true` (excluded from readout).
5. Report = `tool_input.message` (non-string → defer, log `error`). LAST `TICKET-REVIEW-VERDICT:`, next 128
   chars match `^\s*(PASS|REVISE)\s+([0-9a-f]{64})` (i) — the gate's `ticketLastToken` read (L3447) —
   and hash ∈ expected → defer, log `ok`. Form only: REVISE counts; the gate stays the authority on PASS.
6. Otherwise read the log (missing = empty; any other read error → defer, log `error`), count `bounce`
   rows for the same `(session_id, agent_id, turn)`. ≥ 2 → defer, log `cap`. Else append `bounce`; only
   if that append succeeded, deny with:
   "Your hand-back was NOT delivered: the report is missing its final verdict line. Call SubagentHandback
   again with your full report unchanged, ending with the ---VERDICT--- block from your brief, whose last
   line is exactly: TICKET-REVIEW-VERDICT: <PASS or REVISE> <hash>" (hash filled in when the prompts carry
   exactly one, else a placeholder). The reason lands in a tool_result, which the gate never reads as a
   verdict (L3406 skips non-assistant records).

## Fail-safe
Top-level try/catch → defer (exit 0, no output), best-effort `error` row. Never denies on its own failure;
never returns "allow" (only deny or defer). Deny output = `deny-askuserquestion.js`'s shape (L24-33).
Kill switch: create `~/.claude/hooks/reviewer-verdict-guard.off` (not a gated file) → guard inert at once.

## Log (the signal)
`~/.claude/hooks/reviewer-verdict-guard.jsonl`, append-only: `{ts, session_id, agent_id, turn, event[,
test]}`, `event` ∈ ok | bounce | cap | error | nohash. No report or brief text.

## Readout (how the signal reaches Erez)
`node reviewer-verdict-guard.js --readout <session_id>` — read-only, prints 0-4 lines. A review =
`(session_id, agent_id)`, test rows excluded. Outcome from its first non-bounce row: `ok` with no earlier
bounce = first-try; `ok` with all earlier bounces in the same turn = auto-fixed (both clean); `ok` after a
bounce in an earlier turn, or `cap` = manual; `error` = unchecked; `nohash` = separate. Only bounces and
the newest > 30 min old = abandoned (not clean, counted). Younger = in progress.
1. This session had any manual / abandoned / unchecked → one line with those counts (silent otherwise).
2. This session had any `nohash` → one line saying so (fine if /check reviews of the gate; otherwise a
   brief-shape change the guard isn't covering).
3. Acceptance: ≥10 counted reviews since install and `reviewer-verdict-guard.accepted` doesn't exist →
   "J of the first 10 … arrived with a well-formed verdict line and no manual re-ask — ready to close
   GEN-812 (bar 9); once closed, create <accepted file> to retire this line" or "below the bar; reopen".
   Shown at every wrap until retired, so it can't be missed.
4. Kill switch present → "switched off" line. Else newest row > 14 days old (or none and > 14 days since
   install, a constant) → "worth checking the hook still fires".
`/wrap` gets a read-only Step 3h that runs the readout with `$CLAUDE_SESSION_ID` (read via Bash, as 3e/3g
do) and relays any lines under "Verdict guard" (forcing the full Step 7 report, like 3e-3g). Applied via
/vet-rule with the vet-ticket and notion.md text edits.

## Tests (notes/gen812/test-guard.js, run in a fixture copy so the real log is untouched)
- Fixtures for every decision branch, all three real brief shapes, cap at 2, log-unwritable → no deny,
  log-unreadable → no deny, kill switch, test marker, sidecar fallback, readout outcome classes.
- Real-input corpus: replay every real `check-reviewer` hand-back on this machine through the guard (as a
  PreToolUse payload built from the transcript as it stood at that call) and count bounces vs. ok vs.
  ignored; every hand-back that `--ticket-verify` would accept must be `ok`, never `bounce` (no false
  fires), and /check reviewers must be ignored.

## Live test (after install, before declaring done)
One deliberately token-less ticket-review reviewer (brief carries `GEN812-LIVE-TEST` and a real-shape
hash) → expect bounce, re-send with the line, `--ticket-verify`-style read of its transcript sees the
re-sent report, log shows bounce then ok in the same turn. Also confirm the hook input's `session_id` /
`agent_type` on a hand-back. If the reviewer does NOT re-send: create the kill switch immediately (stops
other sessions being affected), then try the documented fallback — a `SubagentStop` "block" (keeps a
sub-agent running, delivers the reason as its next instruction; code.claude.com/docs/en/hooks) — and
failing that, skill-only auto-restatement.

## Residual
- Plain-text delivery (no hand-back tool) isn't seen; the notion.md workaround stays for that case.
- Doesn't make reviews better, only well-formed; "clean" = well-formed line, slightly looser than
  "`--ticket-verify` accepts" (a REVISE counts).
- While the live test runs, other sessions' reviewers are also guarded; the kill switch bounds that.
- Three small reads are copied from the gate; drift is caught only when test-guard.js is re-run.
