# /wrap Steps 3d to 3j — the readouts: full procedure

**Contents:** 3d marker-liveness probe · 3e grounding-flag readout · 3f model-list readout · 3g search-first reminder readout · 3h verdict-guard readout · 3i ticket-gate readout · 3j release-review readout

Reference file for the `/wrap` runbook (`C:/Users/Erez/.claude/skills/wrap/SKILL.md`), which sends you here at Steps 3d to 3j. The runbook keeps every step's order and its non-negotiables; this file holds the full detail, moved here word for word (a pointer to text now in another file names that file).

## Step 3d — Ticket-gate marker-liveness probe (GEN-508 #6)
**Guard:** run only if the ticket-gate arm is present in the hook — grep `~/.claude/hooks/auto-approve.js`
for `enforceTicketVetting`. Absent → the gate is not installed; mark this step **"skipped — ticket-gate
hook not installed"** with its one-line reason in the roll-up (per Step 7's convention for a step that did
not apply this session), never a bare checkmark. (This guard only decides whether the board-liveness check
applies; detecting an installed-but-broken hook is `/vet-ticket` Step 0's job, not this probe's.)
Run the `/vet-ticket` **Marker-liveness probe** exactly as
`C:/Users/Erez/.claude/skills/vet-ticket/marker-probe.md` defines it — that file is the single definition; do NOT re-derive or restate its matching logic here. It
returns one of { MATCH, DIVERGENCE, LOOKUP-ERROR }, defaulting to non-MATCH on any incomplete or failed read
(never read "couldn't check" as "all clear").
**Report** — one line, under a "Ticket-gate marker-liveness" sub-heading, only when the outcome is not MATCH:
- DIVERGENCE: e.g. `Ticket-gate marker-liveness: DIVERGENCE — live board data source <id> is not in the
  hook's TEAM_TASKS_IDS; the gate is silently un-watching that board until the hardcoded set is updated by
  hand (a separate /vet-code change).`
- LOOKUP-ERROR: e.g. `Ticket-gate marker-liveness: could NOT verify the board (<reason>) — treat the gate as
  unverified this session.`
- MATCH: the step gets only its checkmark in the roll-up (matching Step 3b/3c's convention).
**Traceability:** a non-MATCH is recorded in the Step 4 HISTORY.md entry body on its own line
(`Ticket-gate marker-liveness: <DIVERGENCE|LOOKUP-ERROR> — <one line>`), so it survives a session that ends
before Step 7, and it counts as "a note the steps require surfacing," forcing the full Step 7 report rather
than the all-clean fast-path. **Read-only** — this step never mutates `TEAM_TASKS_IDS` or any file.

## Step 3e — Grounding-flag readout (GEN-716)
Read `C:\Users\Erez\.claude\hooks\grounding-nudges.jsonl` (the GEN-716 grounding-flag detector's durable, append-only log; each line `{ts, session_id, prompt_id, count_hits:[{tag, hit}]}`, one per turn where the claim-linter fired on an un-sourced COUNT claim). The grounding flag ships as a **measured experiment**; its retire decision is Erez's. This step just SURFACES the flag's current numbers so he can make that call — it sets no threshold, files no ticket, and mutates nothing.
Compute from the log: (a) **this session's count** — lines whose `session_id` equals this session's `$CLAUDE_SESSION_ID` (0 if that id is empty or unreadable); (b) the **lifetime total** — all lines; (c) the **age of the newest detection** — the current date (from session context) minus the `ts` of the newest line across all lines, both as UTC calendar days; "never" if the log has no lines.
**Report** — under a "Grounding flag" sub-heading, ONE informational line, only on a wrap where the flag actually fired this session (this session's count >= 1): e.g. `Grounding flag: 2 count-nudges this session, 27 lifetime, newest 0 days ago — retire the count patterns via /vet-code if the yield isn't worth the noise (to check yield, sample the logged session/prompt ids in grounding-nudges.jsonl for whether the fires led to conclusion-reconciliations, not just nudges).` It reports the actual computed numbers (never a fixed placeholder); its `/vet-code` retire suggestion is standing context shown with every such line, not a signal that anything is wrong, so the line asks for no action unless the numbers look off to Erez; and it counts as "a note the steps require surfacing" so it forces the full Step 7 report. When this session's count is 0 — including a missing or empty log, or an unreadable `$CLAUDE_SESSION_ID` — the step gets only its checkmark in the roll-up (a quiet-this-session flag needs no line; the lifetime figures keep for the next wrap on which it fires). This is a deliberately passive readout: it never proactively prompts a review at a threshold — surfacing the numbers whenever the flag is active is enough for Erez to decide when a closer look is due.
**Never mutate the log** (read-only; append-only, like its siblings `selfaudit-nudges.jsonl` / `signal-surface-pending.jsonl`).

## Step 3f — Model-list readout (GEN-705)
The model tier list and floor live in ONE place — Part 2 of `notes/effort-model-reference.md` in the Improve AI Infra repo — and the end-of-turn hook `stop-foryou-nudge.js` reads it live (so does `/vet-code`, through the same hook). Nothing else notices when that list goes stale or unreadable; this step is how it reaches Erez. Run, as two separate calls:
- `node "C:/Users/Erez/.claude/hooks/stop-foryou-nudge.js" --selftest`
- `node "C:/Users/Erez/.claude/hooks/stop-foryou-nudge.js" --classify <model-id>` — with the exact model ID from this turn's environment/system-context banner.
**Report** — under a "Model list" sub-heading, one line for each condition that holds, only when something is off:
- selftest `ok` is `false`: e.g. `Model list: can't read the model list (<error>) — model tags show as "unconfirmed" and /vet-code stops on every run until it's fixed.`
- selftest `warnings` is non-empty: e.g. `Model list: the model lines in effort-model-reference.md look off — <warnings, joined by "; ">.`
- classify prints `newer-in-family`: e.g. `Model list: this session ran on <model-id>, which isn't in the model list yet — add it to Part 2 of effort-model-reference.md (low effort).`
- classify prints `unlisted` (and selftest was `ok`): the same line, plus `— until then model tags show as "unconfirmed" and /vet-code stops to ask.`
- the banner names no model, or either command fails or prints no JSON: `Model list: couldn't check the session model (<reason>).`
- Otherwise (selftest `ok` with no warnings, and classify `listed-at-above` or `listed-below`): the step gets only its checkmark in the roll-up. (`listed-below` is a known model, not a list gap — its below-floor recommendation already reaches Erez through the model tags.)
**Traceability:** any line here counts as "a note the steps require surfacing," forcing the full Step 7 report, and is recorded in the Step 4 HISTORY.md entry body on its own line (`Model list: <one line>`). **Read-only** — this step never edits the reference file or the hook; adding a model is a normal follow-up.

## Step 3g — Search-first reminder readout (GEN-606)
Read `C:\Users\Erez\.claude\hooks\search-first-nudges.jsonl` — the durable, append-only log of the GEN-606 search-first reminder in `stop-foryou-nudge.js`, which fires when a reply proposes a new ticket and no board search has run since Erez's last message. A missing or empty log means no fires. It holds two row kinds (if a field named here is missing from the rows, re-derive the schema from the hook rather than guessing):
- `fire`: `{ts, kind:"fire", session_id, prompt_id, mode, patterns, blockShown, continuation, searchAge}`, one per reminder. `mode` `"A"` means the reminder rode the For-you nudge before the block was written. `"B"` means the For-you nudge was silent — almost always because the block was already on screen.
- `after`: `{ts, kind:"after", session_id, prompt_id, mode, anchorOk, searched, resultLine, resultMatch, blockReissued}`, written by the Stop that ends the reminder's continuation, in the same session. Some fires get no `after` row (an interrupted continuation). `searched`: a board search ran in that continuation. `resultMatch`: its "I searched the board" sentence named a ticket. `blockReissued` (mode B only): it repeated the For-you block.
Also read `C:\Users\Erez\.claude\hooks\search-first-switch.jsonl`, whose rows look like `{"kind":"switch","afterBlock":"off"|"on","ts":…}`. The newest switch row decides: `"off"` means the after-block part (mode B) is switched off. No file, or no switch row, means it is on. The reminder ships as a measured experiment; whether to keep its after-block part is Erez's call, and this readout only surfaces the numbers he decides from.

Compute with a short read-only script run from the Bash tool, which is where `$CLAUDE_SESSION_ID` is readable. Do not read the files and count by eye. Compare `ts` values with `Date.parse`, not as strings. Exclude from (c) and (d) every `after` row, of either mode, whose `anchorOk` is not `true`; call their count K.
- (a) **this session's fires**: `fire` rows whose `session_id` equals this session's `$CLAUDE_SESSION_ID`, split by mode. If that id is empty or unreadable, use 0.
- (b) **lifetime fires**: all `fire` rows, both the total and the mode-B count FB.
- (c) **lifetime outcomes**:
  - from mode-B `after` rows: Y rows, of which X have `searched`, Z have `resultMatch`, and W have `blockReissued`;
  - from mode-A `after` rows: Ya rows, of which Xa have `searched`;
  - this session's W: the same `blockReissued` count, restricted to this session.
- (d) **bar counts**: Y′, Z′ and W′ — the same as Y, Z and W, but only over mode-B `after` rows whose `ts` is later than the newest switch row of any value. With no switch row, they equal Y, Z and W.
- (e) **newest fire age**: the current date (from session context) minus the `ts` of the newest `fire` row, both as UTC calendar days. Use "never" if there are none.

**Report** — under a "Search-first reminder" sub-heading. Show each line below only when its condition holds:
- **This session fired** ((a) ≥ 1): e.g. `Search-first reminder: 2 this session (1 before the summary, 1 after it), 31 lifetime. After-summary reminders: a search followed 9 of 10 times, named an existing ticket 3 times, repeated the summary 1 time. Before-summary reminders: a search followed 18 of 20 times.`
  - Use the actual computed numbers.
  - Omit the after-summary sentence when Y is 0, and the before-summary sentence when Ya is 0.
  - Append `(K outcome records couldn't be checked and were left out.)` when K ≥ 1.
  - When this session's W ≥ 1, start the line with `⚠ ` and add `This session repeated the summary after the reminder.`
- **Re-evaluate bar**: shown on any wrap where it holds, even if the reminder was quiet this session, unless the after-block part is switched off. It holds when W′ ≥ 2, OR when Y′ ≥ 20 and Z′ is 0. Line: e.g. `Search-first reminder: the after-summary part is costing more than it finds (repeated the summary 3 times) — switch it off, or keep it? (the command is in /wrap Step 3g)` Name whichever condition held.
- **Not working**: shown when any of these holds:
  - the newest fire is older than 30 days;
  - there are no fires and the current date is more than 30 days after 2026-10-11, the install date;
  - FB ≥ 5 and Y + K is under half of FB, meaning outcomes are not being recorded and the repeat count can't be trusted.
  Line: e.g. `Search-first reminder: no fire in 34 days (a replay of past replies predicted about one a day) — worth checking it still works: confirm the hook still has its search-first stage and re-run its tests (notes/gen606/test-search-first.js in the Improve AI Infra repo).` Adapt the reason to the condition that held.
- Otherwise the step gets only its checkmark in the roll-up.

**Acting on Erez's answer** is a separate action, never part of this readout, and never taken on the bar alone. Only on his explicit go, append exactly one row to `search-first-switch.jsonl`, using the Bash tool so the file stays UTF-8 without a BOM:
`printf '{"kind":"switch","afterBlock":"%s","ts":"%s"}\n' <off|on> "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" >> "$HOME/.claude/hooks/search-first-switch.jsonl"`
The shell stamps the time. Never type the time by hand: the bar's restart depends on it.
- `"off"` switches the after-block part off.
- `"on"` keeps it, or turns it back on. Either way the row restarts the bar's count.

Then parse the file's last line as JSON to confirm it landed: it must have the intended `afterBlock`, and a `ts` within a minute of now. Never edit or delete existing rows. This is not a hook-code change, so it needs no `/vet-code`.

**Traceability:** any line here counts as "a note the steps require surfacing", which forces the full Step 7 report. Each line is also recorded on its own line in the Step 4 HISTORY.md entry body (`Search-first reminder: <one line>`). **The readout is read-only:** it never writes to the log or the switch file.

## Step 3h — Verdict-guard readout (GEN-812)
`~/.claude/hooks/reviewer-verdict-guard.js` bounces ticket-reviewer hand-backs that lack their verdict
line and logs each decision. Run, from the Bash tool (where `$CLAUDE_SESSION_ID` is readable):
`node "C:/Users/Erez/.claude/hooks/reviewer-verdict-guard.js" --readout "$CLAUDE_SESSION_ID"`
It prints nothing when there is nothing to report; otherwise relay each line it prints verbatim. If
`$CLAUDE_SESSION_ID` is empty, still run it (its other lines do not need the id) and add the line
`Verdict guard: this session's reviews couldn't be checked (session id unreadable)`. If the command fails
or prints "readout failed", say so in one line.
A `GEN-812 acceptance` line is a decision for Erez: put it in the "📌 For you" block as a proposal to
close (or reopen) GEN-812. Acting on his answer is a separate action, never part of this readout: only
on his explicit go, update GEN-812 per the ticket-status rules, then create the `.accepted` file the
line names, which retires the line.
**Traceability:** any line here counts as "a note the steps require surfacing", forcing the full Step 7
report, and each is recorded verbatim on its own line in the Step 4 HISTORY.md entry body. **The readout
is read-only:** it never writes the log or any marker file.

## Step 3i — Ticket-gate readout (GEN-636)
`~/.claude/hooks/ticket-gate-readout.js` is the durable, cross-session view of the ticket-quality gate:
its block and break-glass events, the waive and re-review rates, records missing their `source` tag,
open consult files, and unfiled recovery files. It is not a hook; nothing else runs it. Like Step 0b, it
runs in every session — it is not project-gated, and it is the only reader of the no-project recovery
files. Run, from the Bash tool:
`node "C:/Users/Erez/.claude/hooks/ticket-gate-readout.js"`
It prints nothing when every bar is clear; then the step gets only its checkmark. Otherwise relay each
line it prints verbatim under a "Ticket gate" sub-heading. If the command fails or prints "readout
failed", say so in one line.
**Acting on a line is a follow-up, never part of this step** — that includes asking Erez an open consult
question again, marking a consult file resolved or abandoned, and filing a recovery file's items through
`/vet-ticket` and then renaming it (Step 1).
**Traceability:** any line here counts as "a note the steps require surfacing", forcing the full Step 7
report, and each is recorded verbatim on its own line in the Step 4 HISTORY.md entry body. **The readout
is read-only:** it writes no file.

## Step 3j — Release-review readout (GEN-871)
The weekly `/release-review` job (scheduled task `release-review-weekly`) reviews new Claude Code releases and
files tickets unattended; this step is how its results — and its silence — reach Erez. Like Step 3i it runs in
every session; it is not project-gated. Run, from the Bash tool:
`node "C:/Users/Erez/AI Projects/Improve AI Infra/notes/release-review/release-review-tool.js" readout`
It prints nothing when there is nothing to report; then the step gets only its checkmark. Otherwise relay each
line it prints verbatim under a "Release review" sub-heading: the last run's date and what it filed, how many
items wait for Erez's yes/no in the digest ticket, what was not filed, and an alert when no run has happened
in 10 days. If the command fails or prints "readout failed", say so in one line.
**Traceability:** any line here counts as "a note the steps require surfacing", forcing the full Step 7
report, and each is recorded verbatim on its own line in the Step 4 HISTORY.md entry body. **The readout
is read-only:** it writes no file. Answering a waiting item or filing a not-filed one is a follow-up, never
part of this step.
