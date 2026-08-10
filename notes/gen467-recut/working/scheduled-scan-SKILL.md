# GEN-467 verification scan — duplicate-block bars (re-cut regime, 2026-08-10)

One-time scheduled task. Reads this machine's own logs and transcripts, judges the
re-cut's bars, and reports counts + a verdict in this session's own "📌 For you"
block. On any bar trip, also append the evidence to
[GEN-467](https://app.notion.com/p/39f6e495d07c818b8440c4788d0fdb74).

## Regime boundary (fail-safe)

Judge ONLY transcripts and log rows with timestamps >= `__APPLY_DATE_UTC__`
(filled at apply; if this placeholder is still unfilled, STOP and report that the
scan cannot run — never judge pre-apply data under these bars).

## Inputs (authority constants — read these paths, don't guess)

- Guard log: `C:\Users\Erez\.claude\hooks\foryou-guard-events.jsonl`.
  Post-re-cut event vocabulary: `release-clean`, `arm1-samemsg-release`,
  `arm1-sighting`, `phase1-skip-blockform`. The retired names (`arm1-block`,
  `arm1-escape`, `arm1-stateless-release`, `arm2-*`) can never occur again —
  a 0 count for them is EXPECTED and is NOT an all-clear.
- Signal-surface log: `C:\Users\Erez\.claude\hooks\signal-surface-pending.jsonl`.
  `deliver` rows carry `decision` ∈ {`nudge`, `cleared-surfacing-designed`,
  `suppressed-block-out`}.
- Transcripts: every `C:\Users\Erez\.claude\projects\<slug>\*.jsonl` (ALL project
  slugs) with mtime >= the regime boundary. Assistant text lives at
  `message.content[].text` on `"type":"assistant"` lines.
- Block recognizer: derive `WIDE_OPENER_RE` and `stripFences` from the LIVE
  `C:\Users\Erez\.claude\hooks\stop-claim-linter.js` source at scan time — never
  retype them (retyped copies drift).

## Counting rules

- Dedup every log count by `(session_id, prompt_id, event)` — a Stop event can
  double-fire one turn, and nothing in the hooks caps repeated sighting/skip rows.
- Exposures ("a block was already out when an injector would have fired") =
  the UNION by `(session, prompt)` of {`phase1-skip-blockform` rows} ∪
  {`suppressed-block-out` rows} ∪ {`arm1-sighting` rows} — never a sum across
  logs (one Stop event can legitimately write to both files).
- The duplicate census is TRANSCRIPT-based, never guard-log-based: a wide-only
  (heading/doubled-pin) first block writes no release record, so mixed-form
  duplicates are invisible or mislabeled in the guard log. Census: for each
  turn, count assistant messages whose fence-stripped text matches the derived
  recognizer; ≥2 in one turn with no user message between = a duplicate.

## Bars

1. **Any post-apply duplicate in a suppressed class** — the turn shows a
   claim-linter or signal-surface injection between block #1 and block #2 →
   the causal model is wrong → REOPEN the design on GEN-467; never patch.
2. **Any post-apply duplicate with ≥1 tool call in the gap and no injector
   involvement** → the un-defer trigger for the banked mid-turn hook
   (`notes/gen467-holistic-fix/working/posttooluse-foryou-released.js`,
   built-but-unregistered by Erez's 2026-08-09 decision).
3. **Liveness**: a window containing ≥5 block-carrying turns but ZERO
   `phase1-skip-blockform` AND zero `suppressed-block-out` AND zero
   `release-clean` rows → recognizer drift or a dead hook → investigate before
   trusting any other bar (absence of events is never evidence of health on
   its own).
4. **Suppression precision (hand review)**: list any `phase1-skip-blockform`
   row whose turn's message does not verify as genuinely block-carrying on
   inspection. Baseline measured 2026-08-10: 0 false fires in 5,307 real
   messages / 114 wide-form matches. More than ~2 false fires in a window →
   the regex is over-matching → surface to Erez.

## Report form

One "📌 For you" block in this scan session: deduped counts per event, the
exposure count, the duplicate-census result, each bar's verdict, and — only if
a bar tripped — the recommended next step. A clean scan reports the counts and
"all bars clear" in two lines; it does not narrate the checking.
