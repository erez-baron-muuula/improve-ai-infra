# GEN-467 verification scan — duplicate-block bars (re-cut regime, 2026-08-10)

Scheduled-task skill. Reads this machine's own logs and transcripts, judges the
re-cut's bars, and reports counts + a verdict in this session's own "📌 For you"
block. On any bar trip, also append the evidence to
[GEN-467](https://app.notion.com/p/39f6e495d07c818b8440c4788d0fdb74).

## When this runs (cadence)

The task is re-created at apply as a one-time task firing **7 days after the
apply timestamp** (enough window for Bar 3's ≥5 block-carrying turns — a normal
week has far more — while transcripts from the window are still on disk; Claude
Code prunes old transcripts, so do not let the window stretch to months).

Run history (the scan's own memory): every run APPENDS one JSON line to
`C:\Users\Erez\.claude\scheduled-tasks\gen467-block-after-check-verify\scan-log.jsonl`
— `{"ts":"<ISO>","verdict":"clear"|"tripped"|"deferred","bars":[...]}` — and
reads that file FIRST to learn which run it is (a missing or empty file means
this is run 1).

At the END of a scan run, decide the next firing and create it in the same
session: bars all clear AND the previous line is not "clear" → schedule one
more scan +14 days out; bars all clear AND the previous line IS "clear" (second
consecutive clear) → do not schedule a third scan; instead put a GEN-467
closure PROPOSAL to Erez in the report block (a proposal only — never a status
change); any bar tripped → follow the bar's action and schedule per the
reopened work (no fixed date — the reopened work owns the timeline). If at
firing time fewer than 5 post-apply block-carrying turns exist, do not judge —
record "deferred", reschedule +7 days, and say so in the report.

## Regime boundary (fail-safe)

Judge ONLY transcripts and log rows with timestamps >= `__APPLY_DATE_UTC__`
(filled at apply; if this placeholder is still unfilled, STOP and report that
the scan cannot run — never judge pre-apply data under these bars).

## Inputs (authority constants — read these paths, don't guess)

- Guard log: `C:\Users\Erez\.claude\hooks\foryou-guard-events.jsonl`.
  Row fields: `session_id`, `prompt_id`, `event`. Post-re-cut event vocabulary:
  `release-clean`, `arm1-samemsg-release`, `arm1-sighting`,
  `phase1-skip-blockform`. The retired names (`arm1-block`, `arm1-escape`,
  `arm1-stateless-release`, `arm2-*`) can never occur again — a 0 count for
  them is EXPECTED and is NOT an all-clear.
- Signal-surface log: `C:\Users\Erez\.claude\hooks\signal-surface-pending.jsonl`.
  Row fields differ from the guard log: `session`, `prompt`, `decision`, `kind`.
  `deliver` rows carry `decision` ∈ {`nudge`, `cleared-surfacing-designed`,
  `suppressed-block-out`}. When joining across the two logs, map
  `session`↔`session_id` and `prompt`↔`prompt_id`.
- Self-audit log (for injector detection only): `C:\Users\Erez\.claude\hooks\selfaudit-nudges.jsonl`
  (fields `session_id`, `prompt_id`) — records self-audit-branch Phase-1 notes.
  NOTE: a claims-only Phase-1 note writes to NO log; detect those from
  transcripts (below).
- Transcripts: every `C:\Users\Erez\.claude\projects\<slug>\*.jsonl` (ALL
  project slugs) with mtime >= the regime boundary. Assistant text lives at
  `message.content[].text` on `"type":"assistant"` lines; tool calls appear as
  `"type":"tool_use"` entries in the same `message.content` arrays.
- Injector-detection method (used by Bars 1–2): an injected note is visible in
  the transcript text of the turn — grep the turn's entries between block #1
  and block #2 for the injector signature strings: `Claim-linter, automatic:`,
  `Self-audit, automatic:`, `Signal-surfacing check, automatic:` (and the
  sibling `Credential-denial` signature if present). A duplicate with one of
  these in the gap is injector-provoked; without any, it is not.
- Block recognizer: extract `WIDE_OPENER_RE` and `stripFences` from the LIVE
  `C:\Users\Erez\.claude\hooks\stop-claim-linter.js` SOURCE TEXT — match the
  line `const WIDE_OPENER_RE = /.../flags;` with a regex over the file text and
  `stripFences`'s function body likewise. NEVER `require()` the hook (it
  exports nothing and arms stdin listeners + a process-exit watchdog in your
  process), and never retype the patterns (retyped copies drift). Assert
  exactly ONE `WIDE_OPENER_RE` declaration matched, then self-test the derived
  regex: it must match `📌 For you` and `## 📌 For you` and reject
  `📌 For your` — a failed self-test means extraction broke: STOP and report.

## Counting rules

- Dedup every count by (session, prompt, event/decision) using the field
  mapping above — a Stop event can double-fire one turn, and nothing in the
  hooks caps repeated sighting/skip rows. Rows carrying the fallback ids
  (`nosession`/`noprompt`) collapse under this key; report their raw count
  separately if nonzero.
- Suppression counts ≠ exposures. `phase1-skip-blockform` fires on EVERY
  wide-recognized block-carrying message (including continuations and turns
  with nothing to lint), so it measures recognizer coverage, not harm.
  Report three separated numbers, never one aggregate:
  (a) skip rows (recognizer coverage), (b) `suppressed-block-out` rows
  (a nudge was due and withheld — true block-already-out exposures),
  (c) `arm1-sighting` rows (a REALIZED second block-form message after a
  release — not an averted one; each is hand-reviewed, and any that is a real
  visible duplicate belongs to Bars 1–2, not to a count).
- The duplicate census is TRANSCRIPT-based, never guard-log-based: a wide-only
  (heading/doubled-pin) first block writes no release record, so mixed-form
  duplicates are invisible or mislabeled in the guard log. Census: for each
  turn, count assistant messages whose fence-stripped text matches the derived
  recognizer; ≥2 in one turn with no user message between = a duplicate.

## Bars

1. **Any post-apply duplicate in a suppressed class** — the injector-detection
   grep finds a claim-linter or signal-surface signature between block #1 and
   block #2 → the causal model is wrong → REOPEN the design on GEN-467; never
   patch.
2. **Any post-apply duplicate with ≥1 tool call in the gap and no injector
   signature** → the un-defer trigger for the banked mid-turn hook
   (`notes/gen467-holistic-fix/working/posttooluse-foryou-released.js`,
   built-but-unregistered by Erez's 2026-08-09 decision).
3. **Liveness**: a window containing ≥5 block-carrying turns but ZERO
   `phase1-skip-blockform` AND zero `suppressed-block-out` AND zero
   `release-clean` rows → recognizer drift or a dead hook → investigate before
   trusting any other bar (absence of events is never evidence of health on
   its own).
4. **Suppression precision (hand review)**: list any `phase1-skip-blockform`
   row whose turn's message does not verify as genuinely block-carrying on
   inspection. Baseline measured 2026-08-10: 0 false fires in 5,331 real
   messages / 114 wide-form matches. More than ~2 false fires in a window →
   the regex is over-matching → surface to Erez.

## Interim compliance lines (until the Part-7 decision)

The convention question — whether block-after-check compliance itself stays
watched — is a QUEUED decision on GEN-467 (design Part 7), not decided by this
file. Until Erez decides it, each scan also reports, as informational lines
with no bar attached: (a) turns that plainly owed a block but none appeared in
the substantive reply or any continuation (missing blocks), and (b) block
messages that appear in the substantive reply rather than after the Stop
checks (convention misses, as a count). When Part 7 is decided, update this
section per the decision instead of silently dropping or keeping it.

## Report form

One "📌 For you" block in this scan session: the three separated counts from
the Counting rules, the deduped per-event counts, the duplicate-census result,
each bar's verdict, the interim compliance lines, the cadence outcome (the
next firing date, or — on the second consecutive clear — the GEN-467 closure
proposal, put to Erez as a decision), and, only if a bar tripped, the
recommended next step. A clean scan reports the numbers, "all bars clear", and
its cadence outcome briefly; it does not narrate the checking.
