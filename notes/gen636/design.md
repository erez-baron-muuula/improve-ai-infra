# GEN-636 + GEN-834 design: make the ticket gate's warning signs reach Erez

Status: DRAFT rev 3 for `/check` (2026-10-13).

**Rev 3 changes** (round-2 `/check`: holistic PASS, soundness PASS, pre-mortem REVISE ×1):

- Row 11 is now bounded to 7 days, so it clears itself.
- Record times now come from the file mtime, which the system writes, instead of the typed `draftedUtc`.
- Row 0b/0c wording and how 0b clears.
- Row 8 legacy-bias note.
- The contract-test pin update is now named.
- The lane premise is scoped to the records that carry the marker.
- Coverage fixture: special-case for ternary reasons.
- New row 6b, waived unattended filing.
 Plan approved by Erez the same day
(`~/.claude/plans/i-want-to-work-deep-nebula.md`).

- [GEN-636](https://app.notion.com/p/3b26e495d07c81d7ba0eda927747315a): aggregate signal readers + stuck-consult persistence (GEN-508 piece 3).
- [GEN-834](https://app.notion.com/p/3f76e495d07c8130912ee2f998459e39): detect a Notion connector-id change so the gate does not silently stop.

**Rev 2 changes** (round-1 `/check`: pre-mortem REVISE ×2, holistic REVISE ×2, soundness PASS + advisories):

- Every event kind and reason the hook can log is now classified, checked at runtime and by a fixture (§4.3, §6.1).
- Row 11 has an install cut-over, so it can no longer fire on records written before the change (§4.4).
- Row 8 is re-based. The unattended `/wrap` lane passes first time 20/20, so a lane streak carries no information. It
  is replaced by a low-side bar on the attended re-review rate. Source tags now feed it by excluding unattended
  filings (§4.3).
- Clearing paths added for consults and recovery files. A missing log or a dead log now prints a line.
- The exempt-id count now uses the hook's own predicate. Remaining advisories are folded in; see the notes in each
  section.

## 1. Problem

The ticket-quality gate (`enforceTicketVetting` in `~/.claude/hooks/auto-approve.js`) appends every decision to
`~/.claude-staging/ticket-gate-events.jsonl`. Nothing reads it: README 807-817 says it "has no reader yet", and no
`/wrap` step names it.

Since GEN-702, `/wrap` files tickets with no card. Design §14 (`notes/gen508-piece1/design-converged.md` ~2297)
says the `/wrap` aggregate is the only early warning against a lenient reviewer.

Separately, the gate recognises Notion write tools by a hardcoded connector prefix (`NOTION_MCP_PREFIX`,
auto-approve.js:1839). A renamed connector fails the `isMcp` test and returns at :3696. Every Notion write then goes
through unchecked, and nothing is logged.

## 2. Premises verified (2026-10-13)

| Premise | Evidence |
|---|---|
| Every event carries `source:"unknown"` | auto-approve.js:2570 |
| `approve` events carry `hash`, `waived` | :3830-3831 |
| The hook reads only the minted pass (`kind:"ticket"`, closed keys) | `TICKET_PASS_KEYS` :1999; `ticketRecordMatches` :3521-3524; unknown-key block :3781-3785 |
| The hook never reads the Step-4 `ticket-record` | no `expires`, so `findPassInDir` skips it (:783-784); vet-ticket SKILL.md:464-467 |
| The ticket-record holds `priorReviewerAgentIds`, `waived`, `draftedUtc`, `searchSummary` | vet-ticket SKILL.md:470-481; all 340 live records carry `draftedUtc` (round-1 reviewer) |
| ticket-records persist; the dir has no other reader | consume renames only the matched pass (:797-798); grep of hooks/, scripts/, skills/ (two round-1 reviewers); `cleanup-sweep.ps1` keeps `.claude-staging` |
| A file with no `expires` in `ticket-passes/` is inert | `findPassInDir` :783-784; `ticketRecordExistsForIds` :3531-3538; `ticketRecordMatches` requires `kind==='ticket'` |
| approve ⇄ ticket-record join by hash works | `baseline.js`: 339/347 approves matched; 4 files spot-checked by reviewers |
| The skill may not append to staging logs (permission dialog) | vet-ticket SKILL.md:650-656; `~/.claude-staging` sits outside `Write(~/.claude/*)` (settings.json:5; auto-approve.js:726, :989) |
| Events carry no session id | event fields: ts, source, event, tool, surface, target, reason, why, hash, waived |
| "Adjudication" deleted in v7 and replaced by re-review | design-converged ~1571-1573, §10 ~1943 |
| The non-ticket lane reaches the gate | vet-ticket SKILL.md:166-173 |
| auto-approve.js sees every tool | settings.json:103 matcher `""`; called from main at :4357 |
| The harness rejects a non-existent tool name before PreToolUse | transcript `46d53865…jsonl` lines 265-266: tool_use 15:33:16.766Z, "No such tool available" result 15:33:16.767Z (round-1 pre-mortem) |
| No legitimate second Notion connector on this PC | `notes/gen636/prefix-scan-tooluse.js`: 2,147 transcripts, 1,293 real Notion-write `tool_use` calls, all `46ff9446-421e-4358-809c-6b8b01e661b2`. The 1 other is a garbled id (Slack's tail spliced in) that the harness rejected as non-existent. Desktop-entrypoint transcripts only. |
| The unattended `/wrap` lane passes first time far more often than average | `notes/gen636/lane-baseline.js` (2026-10-13). Records whose `searchSummary` marks them /wrap-unattended (only 2026-10-11/12 records carry that marker): 20, with 0 multi-round. Other `*wrap*`-named records, mostly earlier /wrap filings: 81, with 14 multi-round (first-pass 0.83). All records: 343, with 74 multi-round (21.6%). Even at 0.83, a 10-streak happens by chance about 16% of the time. |

**Baselines** (`node notes/gen636/baseline.js`, 2026-10-13, 428 events; it uses the same windowing as the readout):

- **Approves.** 347 approves, 339 matched; 1 waived.
- **Blocks.** 56 blocks: 55 `no-pass`, and 1 `practice-page-plain-only` on 2026-10-08.
- **Other events.** 25 `sandbox-exempt`.
- **Rolling 40 matched approves, multi-round:**
  - 300 windows; min 3, max 16, latest 7.
  - > 10 in 114 windows; > 16 in 0; ≤ 2 in 0.
- **Rolling 40 approves:**
  - Waived: max 1.
  - Unmatched: max 3, latest 0.

## 3. Part A: hook change (GEN-834 only), `/vet-code`

### 3.1 Behaviour

In `enforceTicketVetting`, after the `isMcp` computation and **before** `if (!isMcp) return;` (:3696), still outside
the try:

```js
// GEN-834: a Notion write tool from a connector whose id is NOT the one this gate watches.
const rotated = !isMcp && typeof tool === 'string' &&
  /^mcp__(.+)__notion-(create-pages|update-page|duplicate-page|move-pages)$/.exec(tool);
if (rotated) {
  const target = '<connector:' + rotated[1].slice(0, 80) + '>';
  if (configUnlocked() && TICKET_BREAKGLASS_REASONS.has('connector-mismatch'))
    return ticketBreakGlassSkip(tool, target, 'connector-mismatch');
  logTicketGateEvent({ event: 'block', tool: tool, target: target, reason: 'connector-mismatch' });
  return blockConnectorMismatch(tool, rotated[1]);
}
```

- **It cannot throw.** A regex exec on a string can't throw, so the check cannot turn an unrelated call into a block.
  `configUnlocked` (:230-233) and `logTicketGateEvent` both swallow errors. `ticketBreakGlassSkip` returns `defer()`,
  which exits 0 (:81-102).
- **Break-glass reasons.** Add `'connector-mismatch'` to `TICKET_BREAKGLASS_REASONS` (:2582). The new branch consults
  that set, so it stays the one list of breakable reasons.
  - Update the comment at :2574-2581: this block is mechanical (the gate cannot evaluate a tool it does not
    recognise). It is not a content decision. The repair needs Notion writes, so it must not be able to lock itself out.
- **New `blockConnectorMismatch(tool, seenId)`.** It has the same shape as `blockPracticePage` (:3544-3554):
  stderr, then exit 2. The generic "no usable ticket review record … use /vet-ticket" text would send Claude into a
  review that cannot help, so it gets its own message. Roughly:
  > Refused (ticket-quality gate): this Notion write comes from connector id `<seen, ≤80 chars>`, but the gate watches
  > `<NOTION_MCP_PREFIX id>`. Probable cause: the Notion connector was removed and re-added, which gives it a new id,
  > or this machine has a different Notion connector. Until the gate is updated it cannot check ANY Notion write, so
  > this is refused rather than let through unchecked.
  > Fix:
  > 1. Confirm the live id: ToolSearch for `notion-update-page`.
  > 2. Update `NOTION_MCP_PREFIX` in `~/.claude/hooks/auto-approve.js` through `/vet-code`.
  > 3. Grep `~/.claude` for the old id. It is also hardcoded in settings.json permissions and matchers,
  >    settings.local.json, and the other Notion hooks.
  >
  > Break-glass (`CLAUDE_CONFIG_UNLOCK` / the `.config-unlock` sentinel) lets writes through, logged, while you fix it.
  > Surface this in the next "📌 For you" block.
- **No hand-enumerated list of where the id lives.** The id appears 10× in settings.json, 5× in settings.local.json,
  and in 4 hook files (round-1 reviewer count).
- **Why refuse rather than follow the rotation.** Making `isMcp` accept any id would leave the three other Notion
  hooks silently blind on the old id. A refusal is the one tripwire that forces the whole update.

### 3.2 Comment corrections in the same edit

- **The `logTicketGateEvent` header (:2560-2565).** It says the slice counters use "the skill's events, which do carry
  the tag". There are none. It should say:
  - `source` / `lane` live on the Step-4 ticket-record;
  - the readout joins them to `approve` events by hash;
  - hook events stay `source:"unknown"`.
- **The "WHO READS THE EVENT LOG" comment (:2551-2558).** Name the reader: `/wrap` Step 3i via
  `hooks/ticket-gate-readout.js`. Replace its row list with "see the readout's `CLASS` table", so the list cannot fork.
  It currently promises raw-REST rows and exemption additions; those are deferred (§4.5).
- **The MAINTENANCE note (:1827).** A prefix rotation is now refused (GEN-834), not silent.
- **The exemption-file comment (~:2223-2226).** It promises "/wrap reports … ids added since the last report". Point it
  at row 12 and the recorded departure (§4.5).

### 3.3 Out of scope (stated residuals, §8)

- **The other Notion hooks** (`notion-write-verify`, `notion-fetch-staleness`, `notion-schema-guard`) also match the
  hardcoded id. This refusal makes a rotation visible on the first gated write. Those hooks are named in its message.
  - Follow-up: propose to Erez at close, as a GEN-834 sub-item, making them rotation-aware.
- **A rename of the Notion tool names themselves** (e.g. `notion-update-page` becoming something else). It would slip
  past both checks.
- **Notion tools other than the four gated ones.**

## 4. Part B: readout, `~/.claude/hooks/ticket-gate-readout.js` (`/vet-code`, same cycle)

### 4.1 Placement and shape

- **Placement.** It lives in `hooks/`, not `scripts/`. `isProtectedCodeTarget` (:1033-1044) gates `hooks/*.js` but
  only `.ps1` in scripts, so every later edit, recalibration included, needs `/vet-code`. That cost is accepted: the
  bars are safety thresholds. `reviewer-verdict-guard.js` is the precedent for a readout living here.
- **Not a hook.** It is not registered as one, and its header says so.
- **Backup.** Add it to `sync.ps1 $FileMap`. `Test-BackupCoverage` warns on a hooks `.js` missing from the map.
  - Follow the `reviewer-verdict-guard.js` entry at sync.ps1:31 (header list) and :155 (`$FileMap` row).
  - `sync.ps1` lives at `G:\My Drive\AI Projects\_Tooling\Claude\`, outside `~/.claude/scripts`, so
    `isProtectedCodeTarget` does not gate it. It is a plain edit covered by the approved plan, as in GEN-812.
- **CLI:** `node ticket-gate-readout.js [--now <ISO>] [--staging <dir>] [--claude-dir <dir>]`. The overrides exist for
  fixtures only.
- **Read-only:** no writes, no cursor or state file. The `/wrap` run prompts for the command, same as Step 3h's
  readout (no allow entry; precedent).
- **Output:** zero or more lines on stdout, each beginning `Ticket gate:`. Empty output means all clear.
- **Errors:** each row is computed in its own try/catch. A row that throws prints
  `Ticket gate: row <n> could not be computed (<message>)` and the other rows still run. A top-level failure prints
  `Ticket-gate readout failed: <message>`. Exit code is 0 always.

### 4.2 Inputs

- **`~/.claude-staging/ticket-gate-events.jsonl`.**
  - Missing → row 0a.
  - Unparseable lines among the last 500 → row 0b.
  - Each line's `ts` is read with `Date.parse`.
- **`~/.claude-staging/ticket-passes/*.json`.**
  - Skip any name containing `.consumed.`.
  - Read `kind:"ticket-record"` files, keyed by `contentHash.trim().toLowerCase()`, and `kind:"ticket-consult"`
    files (§5.1).
  - Ignore every other kind.
  - **A record's time is its file mtime**, which the system writes. The `draftedUtc` is typed by the model and was
    seen hand-rounded and shared across a batch. Fall back to `draftedUtc` only if the mtime can't be read.
  - A consult file's age is taken from its `openedUtc`, falling back to mtime.
- **`~/.claude-staging/ticket-gate-exempt-pages.txt`.** Counted with the **hook's own predicate**: distinct lowercase
  32-hex ids, other lines ignored (`readExemptPages` :2232-2254). This logic is copied, and a fixture compares both
  counts on the same file.
- **`~/.claude/wrap-surfaced-not-filed-*.md`.** Names and mtimes.

### 4.3 Lines and bars

**Definitions:**

- **"7 days":** `ts` falls within 7×24h before `--now`.
- **"Attended window":** the 40 most recent matched approves whose record is not tagged unattended. Unattended means
  `source` is `wrap-step1`, `wrap-step3c` or `scheduled`. An untagged record counts as attended, which is how the
  historical baseline was built.
- **Timestamps:** every one-off line names the newest event's timestamp, so a repeat across wraps reads as the same
  event.

| # | Fires when | Bar (baseline) | What the line tells Claude/Erez |
|---|---|---|---|
| 0a | events log missing | missing file (it has existed since 2026-08-16) | the gate is not logging, or the path drifted; check the hook |
| 0b | unparseable lines among the last 100 lines (~2 weeks at today's rate) | ≥ 3 (0) | the log is being corrupted. It clears when the bad lines scroll out, or once they are trimmed after diagnosis |
| 0c | ticket-records written in 7 days but no `approve` in 7 days | records ≥ 3 and approves = 0 | no gate approvals logged despite N drafted records: logging may be dead, or the drafts were never filed. Check the hook |
| 1 | `internal-error` blocks in 7 days | ≥ 2 (0) | the gate's own code is failing; investigate the hook |
| 2 | `consume-failed` blocks in 7 days | ≥ 1 (0) | a matched pass could not be consumed; see vet-ticket Step 9 |
| 3 | `connector-mismatch` blocks or break-glass skips in 7 days | ≥ 1 (0) | Notion connector id changed; update the gate (§3.1 fix) |
| 4 | `exempt-list-overflow` / `exempt-list-unreadable` blocks in 7 days | ≥ 1 (0) | GEN-58 exemption list broken; see the block message |
| 5 | `break-glass-skip` events in 7 days, other than `connector-mismatch` (row 3 covers that) | ≥ 1 (0) | the gate was bypassed under break-glass; confirm it is off |
| 6 | waived approves among the last 40 approves | > 10 (design ~1 in 4; max 1) | the waive lane fires too often; revisit gate scope |
| 6b | a waived approve whose record is tagged unattended (`wrap-*` / `scheduled`), in 7 days | ≥ 1 (should be impossible: vet-ticket SKILL.md:506 says that lane cannot waive) | an unattended run waived a ticket with no Erez present; investigate |
| 7 | multi-round reviews in the attended window | > 16 (3-16) | the reviewer is stricter than ever seen; check the reviewer brief |
| 8 | multi-round reviews in the attended window | ≤ 2 (3-16; chance ≈ 0.4% at 21.6%) | **lenient-reviewer early warning**: the reviewer has stopped pushing back; spot-check recent filings |
| 9 | `lane:"non-ticket"` among lane-tagged matched approves in the last 40, after the cut-over | > 2, and only once ≥ 20 lane-tagged exist (no baseline) | the "every Notion page is a ticket" premise is drifting; revisit gate scoping |
| 10 | unmatched approves among the last 40 approves | > 4 (max 3) | approves without an audit record; record-keeping slipped |
| 11 | untagged records in the last 7 days, after the cut-over (§4.4) | ≥ 2 | /vet-ticket stopped writing the source tag; rows 7-9 lose their exclusion. It clears 7 days after tagging resumes |
| 12 | distinct valid exempt ids | > 3,686 of 4,096 (2) | something is appending non-log ids; find it, then trim |
| 13 | open consult files (`kind:"ticket-consult"`, `resolved` not `true`/`"abandoned"`) | ≥ 1; each listed with age, target, question | a ticket question to Erez is unanswered: ask again, or mark it abandoned |
| 14 | `wrap-surfaced-not-filed-*.md` files | ≥ 1; listed | a no-project wrap's capture awaits a manual `/vet-ticket`; rename to `wrap-surfaced-filed-*.md` once filed |
| 15 | an `event` or `reason` value in 7 days that the `CLASS` table does not know | ≥ 1, named | the hook emits a signal nothing classifies; add it to the table |

**Every hook event and reason is classified** (the readout's `CLASS` table; row 15 catches drift at runtime; §6.1
checks it at build time).

- **Monitored (rows above):** `approve`, `break-glass-skip`, and block reasons `internal-error`, `consume-failed`,
  `connector-mismatch`, `exempt-list-overflow`, `exempt-list-unreadable`.
- **Self-surfacing, not counted.** Each exits 2 and prints its reason, so Claude acts on it in the same turn:
  `no-pass` (also carries `stale-content`, :3741), `bad-target`, `unreadable-payload`, `bad-record`,
  `unknown-record-key`, `expiry-too-far`, `bad-verdict`, `reviewer-unverified`, `no-token`, `transcript-too-large`,
  `practice-page-plain-only`.
  - `unknown-record-key` and `expiry-too-far` would indicate skill/hook template drift. They self-surface on every
    occurrence, because the write cannot proceed.
- **Audit-only:** `sandbox-exempt`. GEN-453 deliberately allows plain practice-page edits unreviewed, and no decision
  depends on how often that happens.
- **Not wired:** the REST-arm reasons (`rest-*`, `body-file-unreadable`). They cannot reach the log until GEN-635
  wires that arm (:3693-3696). They are listed so row 15 names them if they ever appear.

**Row 8 rationale (replaces the rev-1 `/wrap` streak).**

- **Why the lane streak was dropped.** The unattended lane passes on the first review 20/20 (`lane-baseline.js`), so
  any lane-only first-pass streak is always on and carries no information.
- **What a lenient reviewer looks like.** The same `check-reviewer` agent type and bar serve both lanes, so systemic
  leniency (model or brief drift) shows as a collapse of the attended re-review rate. That rate has never been below
  3/40.
- **Why tags still matter.** Excluding unattended filings stops a growing share of near-always-first-pass `/wrap`
  filings from dragging the rate down into a false row-8 fire.
- **Residual:** leniency confined to the unattended lane's own brief is not detectable by any rate (§8).
- **Transient bias.** Untagged legacy `/wrap` records still count as attended until they scroll out of the window.
  About 7-8 of today's latest 40 are such records (round-2 reviewer estimate). That raises row 8's chance of a false
  line to roughly 1% for a few days. The failure direction is a harmless "spot-check" line. Recheck at the 3-month
  recalibration.

### 4.4 Tag cut-over (rows 9 and 11)

- **The cut-over** is T₀, the earliest `draftedUtc` (or mtime) among records carrying a `source` key. Before any
  tagged record exists, rows 9 and 11 are silent: there is nothing to compare yet.
- **Row 11** counts untagged records with time > max(T₀ + 1h, now − 7 days).
  - The hour is grace for a session that loaded the pre-edit skill text.
  - It fires at ≥ 2, so a single stale record doesn't trip it. A stale `/wrap` batch can still write several at once.
  - The 7-day bound means it clears itself once tagging resumes. Without the bound, a single episode would latch the
    line forever, and only a `/vet-code` cycle could clear it.
  - T₀ and record times use file mtime (§4.2).
- **Row 9** counts only records with time > T₀ that carry `lane`.
- **Rows 7 and 8** need no cut-over: untagged records count as attended, which is how the baseline was built.

### 4.5 Departures from design §10, recorded

- **Re-review high bar (row 7).** Set at > 16/40, above the historical maximum. The design's ~1 in 4 would have fired
  on 114 of 300 historical windows. Recalibrate at 3 months by re-running `baseline.js`.
- **The `/wrap`-slice monitor** ("every filing passing first review across a window of more than five", design ~1945)
  is replaced by row 8 (§4.3 rationale). Waives cannot occur on that lane (vet-ticket SKILL.md:506).
- **"Repeated `internal-error` per session."** It needs a session id the events don't carry, so it became 2+ in
  7 days.
- **Raw-REST blocks by reason, and REST coverage.** Deferred until GEN-635 wires the REST arm.
- **Exemption "ids added since the last report"** (design ~1948; hook comment ~:2225) is dropped. The readout keeps
  no state.
  - What remains: GEN-58 rollover writes are made through vet-ticket's own lane, and the exempt list is tiny
    (2 ids). A stateless "ids present that are not the current or past GEN-58 volume" check was considered. It needs
    the list of real volume ids, which only Notion holds, so it is not built.
  - Residual in §8.
- **Re-evaluate points.** Rows 6-10 are recalibrated together at the 3-month mark: a `/wrap`-visible note is not
  needed, because Erez's GEN-636 close-out schedules it (§7).

## 5. Part C: skill edits, `/vet-rule`

### 5.1 `vet-ticket/SKILL.md`

- **Step 4 template.**
  - Add `"source"`, one of `interactive | wrap-step1 | wrap-step3c | scheduled`:
    - `interactive` is the default;
    - `/wrap` Steps 1 and 3c set their own value;
    - any other unattended run (a scheduled task) sets `scheduled`.
  - Add `"lane"`, one of `ticket | non-ticket | gen58-rollover`.
  - Add one sentence: both feed `/wrap` Step 3i. **Never copy them into the Step-5 pass**: its keys are closed
    (`TICKET_PASS_KEYS`), and the hook would refuse with `unknown-record-key`.
- **Step 2 consult path (~:449-453).** When stopping to consult Erez, write
  `~/.claude-staging/ticket-passes/consult-<slug>-<yyyymmddHHMM>.json`:

  ```json
  {"kind":"ticket-consult","target":"<page id or 'new'>","question":"<one line>","session":"<$CLAUDE_SESSION_ID or ''>","openedUtc":"<ISO>","resolved":false}
  ```

  - It has no `expires`, so the hook's pass scan skips it.
  - When the question is settled, in this or any later session, overwrite it with `"resolved":true`. Use
    `"resolved":"abandoned"` when Erez drops the item. Either way add `"resolvedUtc"`.
  - Overwrite rather than delete, so the trail stays.
  - The unattended `/wrap` lane writes none: its surfaced-not-filed path already covers that case.
- **Stale text to correct in the same edit:**
  - **:40-45.** "the durable cross-session aggregate is GEN-636" → `/wrap` Step 3i. The break-glass list should now
    read `internal-error`, `unreadable-payload`, `connector-mismatch`.
  - **:250-261.** The connector-rotation caveat ("not built yet") → the hook now refuses a rotated id (GEN-834).
  - **:640 and :660.** "later the GEN-636 aggregate" / "Aggregate counts … are piece 3" → `/wrap` Step 3i.
  - **:676-687.** Add `connector-mismatch` to the mechanical, break-glass-clearable pair.

### 5.2 `wrap/SKILL.md`

- **Step 1 (:43) and Step 3c (:88).** When running `/vet-ticket` unattended, set the ticket-record's `source` to
  `wrap-step1` / `wrap-step3c`.
- **Step 1 (:45).** When a recovery file's items are later filed, rename it to `wrap-surfaced-filed-<ts>.md`.
- **Step 1 (:47).** Replace "that aggregate, and the per-caller `--source` tagging … are GEN-636" with "the durable
  cross-session aggregate is Step 3i". The per-run tally stays.
- **New Step 3i "Ticket-gate readout (GEN-636)".** It goes after Step 3h, in the same shape:
  - **Run:** `node "C:/Users/Erez/.claude/hooks/ticket-gate-readout.js"`.
  - **Output:** relay each line verbatim under a "Ticket gate" sub-heading. Empty output gets the checkmark only.
  - **Failure:** if the command fails, or prints "readout failed", say so in one line.
  - **Traceability:** each line is recorded on its own line in the Step 4 HISTORY entry and forces the full Step 7
    report.
  - **Read-only.** Acting on rows 13 and 14 is a follow-up, never a `/wrap` action.

## 6. Tests

All hook and readout fixtures run against **working copies in an isolated temp tree**. Never against the live hook: a
live run would append real `connector-mismatch` and `break-glass-skip` rows that rows 3 and 5 would then report.

### 6.1 Readout (`notes/gen636/test-readout.js`)

- **Per row (0a-15).** Synthetic staging dirs, one just over and one just under each bar, asserting exactly that line
  or nothing.
- **Cut-over.**
  - A tagged record at T plus untagged records before T (within 7 days) → silent.
  - Two untagged records after T + 1h and within 7 days → row 11 fires.
  - One → silent.
  - Two untagged after T + 1h but older than 7 days → silent.
  - Record time comes from mtime (set in the fixture). A record whose `draftedUtc` disagrees with its mtime follows
    the mtime.
- **Real data.** The real staging dir plus the real `~/.claude` with `--now` = run time → **nothing**. This is a
  point-in-time check, re-run at install.
- **Bad inputs.** Missing files, empty files, malformed or BOM-prefixed lines, `null` JSON, uppercase hashes,
  records without `draftedUtc`.
  - None may throw.
  - A row-level throw (forced via a fixture) prints only its own line.
  - Exit code is always 0.
- **Coverage.**
  - Extract every `event: '…'` and `reason: '…'` literal from the hook working copy.
  - Also extract every `reason:'…'` returned by `ticketScope` / `ticketShellScope`, and every string returned by
    `ticketTokenVerdict`.
  - Also read the quoted literals inside the reason ternaries the hook uses. Those are `no-pass` / `stale-content`
    (:3736, :3741) and `exempt-list-overflow` / `exempt-list-unreadable` (:2720, :3175), so the extractor does not
    wrongly report them as "never emitted".
  - Assert each is in `CLASS`, and that `CLASS` has no entry the hook never emits, apart from those marked
    "not wired".
- **Exempt count.** It equals the hook's `readExemptPages` count on the same fixture file (duplicates, junk lines,
  uppercase).

### 6.2 Hook (new GEN-834 section in `notes/gen508-piece1/test-gen508-v8-arm.js`, working copy in its harness tree)

- **Rotated prefix**, for each of the four write tools: exit 2; the message names both ids, truncated to ≤ 80; one
  `connector-mismatch` block is logged.
- **The same with break-glass:** a `break-glass-skip` event with that reason, exit 0, and the advisory.
- **Real prefix:** unchanged behaviour. `mcp__x__notion-fetch` and `mcp__x__notion-search` fall through, and so do
  non-Notion tools.
- **Non-string `tool`:** no throw.
- **Existing suites stay green:** contract suite (README 393-408: 260), pass-consumption fixture, Section K sweep
  (1,189 payloads, 0 bypasses), and a verdict diff of 0 over real payloads.
  - One deliberate exception. The contract suite pins `TICKET_BREAKGLASS_REASONS` to exactly `internal-error` and
    `unreadable-payload` (test-gen508-contract.js:246-249). Widen that pin to include `connector-mismatch` in the same
    change. It is named here so the change is a reviewed widening of a safety pin, not a quiet weakening.
- **What those suites cannot show.** Section K runs `ticketScope` only (`--ticket-scope-batch`,
  test-gen508-v8-arm.js:931), so it cannot exercise the new branch. False-refusal evidence for the new branch is
  `prefix-scan-tooluse.js`, re-run at install.

## 7. Acceptance

**GEN-834 → Done** when:

- §6.2 passes;
- the installed hook is byte-identical to the vetted working copy;
- the re-run `prefix-scan-tooluse.js` shows no real Notion-write `tool_use` on any other prefix.

**GEN-636 → Review** when:

- §6.1 passes;
- the skills are applied;
- a real interactive filing after install produces a record with `source:"interactive"` and `lane:"ticket"`, and the
  readout joins it.

**GEN-636 → Done** after both of these, checked by a scheduled self-check:

- the first real `/wrap` that files a ticket produces a `source:"wrap-step1"` record;
- the readout stays silent on it.

At close, propose a 3-month recalibration reminder (re-run `baseline.js`, compare bars) as a GEN-636 sub-item.

## 8. Residuals (accepted)

- **Lane-specific leniency.** Leniency confined to the unattended lane's brief is invisible to any rate; row 8
  catches only systemic leniency. Detecting the lane-only case would need a second independent reviewer, which is
  not built.
- **Rows 7 and 8 sit near the historical extremes,** so a drifting baseline will give occasional false lines.
  Recalibrate at 3 months.
- **Rounds, `source` and `lane` are self-reported by the skill.** Row 11 catches a missing tag, not a wrong one.
- **Consult files depend on Claude following the skill.** Nothing enforces them.
- **Surfaced-not-filed items from project wraps** live in HISTORY.md entries, not recovery files, so row 14 does not
  see them. Sessions read recent HISTORY at start, which is the existing path.
- **The readout runs only at `/wrap`.** A session closed without `/wrap` is reported at the next one.
- **GEN-834 scope.**
  - It covers only the ticket gate.
  - A rename of the tool names themselves slips past.
  - The other Notion hooks still go quiet on a rotation, but this gate's refusal makes the rotation visible on the
    first write.
- **Other machines.** On a machine whose Notion connector id differs, every gated write is refused until the prefix
  is updated. That is loud and recoverable by break-glass, and it replaces today's silent no-gate. The connector
  premise is verified on this PC's desktop transcripts only.
- **Stateless one-off rows (1-5)** repeat for up to 7 days. Each names its event time, so a repeat reads as the same
  event.

## 9. Deviations from the ticket text (record on GEN-636 at close)

- **"Adjudication rate"** is now the re-review rate, in two bars (rows 7 and 8), per design v7.
- **The "append-only escalation log"** is now per-consult JSON files, overwritten to resolved or abandoned rather
  than deleted.
  - Why files: `~/.claude-staging` is outside the Write allow-list on purpose, so any skill write there can raise a
    dialog. vet-ticket SKILL.md:650-656 avoids a per-ticket append for that reason.
  - A consult file is written only on the rare consult path, where the flow is already stopping for Erez.
  - The Write tool writes whole files, not appends.
- **The `--source` writer** is a ticket-record field joined by hash: no hook change, no session marker.
- **The `/wrap`-slice monitor** is replaced by row 8 (§4.3).
