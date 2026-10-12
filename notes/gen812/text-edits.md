# GEN-812 + GEN-798 — proposed text edits (for /vet-rule)

Context: GEN-812's guard `~/.claude/hooks/reviewer-verdict-guard.js` is installed and live (2026-10-12):
a PreToolUse hook on `SubagentHandback` that bounces a ticket reviewer's hand-back when it lacks a
well-formed `TICKET-REVIEW-VERDICT: PASS|REVISE <hash>` line; its log + `--readout` CLI carry the
acceptance signal. GEN-798: two documents went stale after GEN-453 (practice page; sub-agent hooks).

Facts these edits rest on (verified this session):
- `auto-approve.js` L3838-3856: `--ticket-hash` on a practice-page payload exits 3 with one of two
  messages — "a plain edit of the Notion practice page, which the hook lets through with no review. Send
  it directly" or "the hook REFUSES it outright (...). No review record can clear that refusal". L3807-3835:
  exit 3 is also used for usage errors, unreadable JSON and a normaliser throw.
- `auto-approve.js` L1885 `NOTION_PRACTICE_PAGE_ID`; L2601-2672 reason `practice-page-plain-only`.
- Hooks fire inside sub-agents: this session's live test — the guard (a settings.json PreToolUse hook)
  fired on a sub-agent's SubagentHandback call (`~/.claude/hooks/reviewer-verdict-guard.jsonl` rows
  2026-10-12T07:04:48Z/07:04:53Z, sub-agent a6a658b3fa9dbe603); docs code.claude.com/docs/en/hooks say
  hooks from settings files "also run inside subagents". gen337-probe.jsonl logged PreToolUse inside a
  check-reviewer (2026-07-07). PostToolUse inside a sub-agent: docs say so; not separately observed here.

---

## Edit 1 — `~/.claude/skills/vet-ticket/SKILL.md`, scope section "NOT gated" list (GEN-798)

Insert a new bullet after the "Comments, views, and attachments" bullet (before "**If the payload or its
target cannot be read…**"):

```
- **The Notion practice page** (`NOTION_PRACTICE_PAGE_ID` in `~/.claude/hooks/auto-approve.js`) — a
  plain-text edit of it passes with no review. Anything else aimed at it is refused outright
  (`practice-page-plain-only`), and no review record can clear that refusal, so never run this skill
  for it: send a plain edit directly, or make the change in the Notion app.
```

## Edit 2 — same file, Step 1 "If it exits non-zero" paragraph (GEN-798)

Old:
```
**If it exits non-zero it prints no hash — then STOP and do not mint.** A non-zero exit means the
hook could not read that payload end to end, so it is going to hard-block the call whatever pass
exists. Re-issue the call in the ordinary shape instead of hunting for a pass.
```
New:
```
**If it exits non-zero it prints no hash — then STOP and do not mint**, and read its message: no pass
can help. Usually the hook could not read that payload end to end, so it will hard-block the call
whatever pass exists — re-issue the call in the ordinary shape instead of hunting for a pass. Two
messages mean something else: a payload aimed at the Notion practice page is either a plain edit the
hook lets through unreviewed (send it directly) or one it refuses outright (see the practice-page
bullet under "NOT gated").
```

## Edit 3 — same file, Step 2, after the paragraph ending "…Brief the reviewer to sign off in its concluding report, not along the way." (GEN-812)

Insert:
```
**The verdict-line guard (GEN-812).** `~/.claude/hooks/reviewer-verdict-guard.js` checks every
ticket reviewer's hand-back before it is delivered: if the report doesn't end with a well-formed
`TICKET-REVIEW-VERDICT: PASS|REVISE <hash>` line whose hash appears in the reviewer's prompts, the
hand-back is bounced back to the reviewer with instructions to re-send it ending with that line
(at most twice per turn). So a reviewer that forgets the line usually fixes it itself before you see
the report. It checks form only — `--ticket-verify` (Step 7) stays the authority. It only sees
hand-back delivery; if a reviewer still arrives without the line (plain-text delivery, or the guard
gave up), SendMessage the same reviewer asking it to reply with only the filled verdict block, token
last, and re-verify — no re-review or re-hash needed.
```

## Edit 4 — `~/.claude/hooks/refs/notion.md` line 36 (GEN-812)

Old:
```
- **/vet-ticket reviewer sign-off can arrive without its verdict block.** Twice on 2026-10-11 a `check-reviewer` hand-back reached the caller as plain prose with no `TICKET-REVIEW-VERDICT` line, and `--ticket-verify` returned `no-token`. Always run `--ticket-verify` before minting; on `no-token` after a PASS-sounding report, SendMessage the same reviewer asking it to reply with only the filled verdict block (token last) and re-verify -- no re-review or re-hash needed.
```
New:
```
- **/vet-ticket reviewer sign-off can still arrive without its verdict block** — rarely, since GEN-812's `reviewer-verdict-guard.js` bounces such hand-backs back to the reviewer (it gives up after two bounces a turn, and never sees plain-text delivery). Always run `--ticket-verify` before minting; on `no-token` after a PASS-sounding report, SendMessage the same reviewer asking it to reply with only the filled verdict block (token last) and re-verify -- no re-review or re-hash needed.
```

## Edit 5 — `~/.claude/hooks/refs/notion.md` line 18, caveat (1) (GEN-798)

Old:
```
**(1) Sub-agents** — PostToolUse fires in the main session only and sub-agents can't run the REST check anyway, so don't delegate time-sensitive Notion reconciliation
```
New:
```
**(1) Sub-agents** — hooks do fire inside sub-agents, but a sub-agent can't run the REST check this hook relies on (no shell), so don't delegate time-sensitive Notion reconciliation
```

## Edit 6 — `~/.claude/skills/wrap/SKILL.md`, new Step 3h after Step 3g (GEN-812)

Insert before the next "## Step" heading that follows Step 3g's "**Traceability:**" paragraph:
```
## Step 3h — Verdict-guard readout (GEN-812)
`~/.claude/hooks/reviewer-verdict-guard.js` bounces ticket-reviewer hand-backs that lack their verdict
line and logs each decision; its readout turns that log into the lines Erez needs. Run, from the Bash
tool (where `$CLAUDE_SESSION_ID` is readable):
`node "C:/Users/Erez/.claude/hooks/reviewer-verdict-guard.js" --readout "$CLAUDE_SESSION_ID"`
It prints nothing when there is nothing to report. Otherwise relay each line it prints, verbatim, under a
"Verdict guard" sub-heading: this session's reviews that still needed a manual re-ask, were left without
a report, or couldn't be checked; briefs it couldn't read; the one-time GEN-812 acceptance result
(repeats every wrap until the `.accepted` file it names exists — act on it: close or reopen GEN-812, then
create that file); a switched-off or test-only notice; or a "hasn't fired in 14 days" warning. If the
command fails or prints "readout failed", say so on one line.
**Traceability:** any line here counts as "a note the steps require surfacing", forcing the full Step 7
report, and is recorded on its own line in the Step 4 HISTORY.md entry body (`Verdict guard: <line>`).
**Read-only** — this step never writes the log or any marker file.
```
