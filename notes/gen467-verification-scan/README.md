# GEN-467 block-after-check verification scan — banked measurement rig

The scripts behind every figure in the **2026-08-09** `HISTORY.md` entry (GEN-467 verification
scan). Banked so the numbers are re-derivable rather than only readable.

Run with plain `node`; no dependencies. They read this machine's own session transcripts under
`~/.claude/projects/` and the guard's event log at `~/.claude/hooks/foryou-guard-events.jsonl`.

## Read this before quoting any number back

**A re-run will NOT reproduce the figures below**, and that is expected, not a bug: the corpus
is the live transcript tree, which grows every session — *including the session doing the
measuring*. The figures below are a snapshot over transcripts with mtime > 2026-07-19 as they
stood partway through 2026-08-09. A verification re-run later the SAME day already differed
(doubled-pin openers 9 → 10, turns 1,588 → 1,598) purely because that session's own turns had
accumulated in the meantime. Re-baseline and state your own date and time; never diff against a
printed number from a previous run. (Same standing instruction as the GEN-557 rig's README.)

**The raw outputs are not banked** — `scan-out.json` (1.5 MB) and `openers.json` (815 KB) were
left out for size. Regenerate them by running `scan.js` and `scan2.js`; every downstream script
reads them from its own directory.

## The measurement trap this rig exists to avoid

**Align the detector to the enforcing code's own matcher, not to a plausible-looking regex.**
The first pass used the tolerant marker from the scheduled task's brief and reported **63**
duplicates, **809** convention misses, **1,206** block-carrying turns. Re-running with the
guard's own `BLOCK_OPENER_RE` semantics (line-anchored, fence-stripped — copied verbatim from
`stop-claim-linter.js:659`) gave **36 / 795 / 1,168**, and hand-verification narrowed the
duplicates that actually matter to **2**.

The cause is structural and applies to any self-referential corpus: this project *discusses* the
"📌 For you" marker far more than it emits one — roughly **1,960** corpus lines contain pin +
"For you" against **~403** real blocks. A tolerant regex measures discussion, not occurrence.

**Corollary, already burned once:** `notes/gen557-selfaudit-measurement/rig/corpus.jsonl` holds
one turn-final message per turn, so it is structurally blind to any two-messages-in-one-turn
failure and cannot validate a change aimed at one. Use `foryou-guard-events.jsonl` as the
per-turn behaviour oracle instead.

## Scripts

| File | What it does |
|---|---|
| `scan.js` | Main pass. Segments transcripts into turns, classifies each as duplicate / convention-miss / correct-path / missing-candidate, and tracks claim-linter turns. Writes `scan-out.json` (pass the output path as argv[2]). |
| `scan2.js` | Classifies block-opener FORMS and flags which are invisible to the guard's own `BLOCK_OPENER_RE`. Writes `openers.json`. This is the pass that produced the 26% blind-spot figure. |
| `scan3.js` | Missing-block candidates under a broad opener test, plus the claim-linter correction-path readout. `node scan3.js missing <since>` or `node scan3.js linter`. |
| `q.js` | Lists entries from `scan-out.json` by category and date: `node q.js <category> <since> <n>`. |
| `dups.js` | Duplicate detail by date, with the surrounding excerpt of each block: `node dups.js <since>`. |
| `timeline.js` | Raw entry-by-entry dump around a timestamp: `node timeline.js <transcript.jsonl> <ISO-ts>`. |
| `turn.js` | Compressed structure of one turn (assistant messages, tool calls, hook injections, opener hits): `node turn.js <transcript.jsonl> <prompt-ISO-ts>`. |
| `corr.js` | One claim-linter turn end to end — pre-block reply, the injected note, the continuation block: `node corr.js <transcript.jsonl> <prompt-ISO-ts>`. |
| `claimscan.js` | Feeds recent blocks to the LIVE `stop-claim-linter.js` with `session_id`/`prompt_id` omitted (the guard is documented to skip in that case), so Phase 1's detectors run on block text — i.e. the verdict the removed Arm-2 content gate would have reached. Read-only; spawns the hook. |
| `m-widen.js` | Measures what WIDENING `BLOCK_OPENER_RE` (heading + multi-pin forms) would do: non-final opener matches, turns whose wide-only block draws a Phase-1 note (the continuations widening removes), and tail-distance stats. Superseded by `m-widen2.js` for the false-release question (its v1 sized the tail window on the turn-final arm only and eyeballed only non-final matches). |
| `m-widen2.js` | The corrected pass: BOTH arms (turn-final + non-final), union tail stats, and two false-release shape classifiers (non-bare matched line; bare line not preceded by `---`/message-start). Known limits, from its review: dedupe key is path+turn-ts so a resumed turn in two session files counts twice (inflates the denominator, cannot affect max or zero-candidate results); the header comment mentions heading-line exclusion the code doesn't do (code is more inclusive → conservative). |

## Figures as measured on 2026-08-09

Corpus: 101 top-level session transcripts, mtime > 2026-07-19, 1,588 turns.

- Duplicates since v2.2 took effect: **2** (2026-08-03, caught by Arm 1 — the log's only
  `arm1-block`; 2026-08-05, not caught, all openers heading-form).
- Opener blind spot: **106 of 403** block-carrying messages since 2026-07-28 (**26%**) invisible
  to the guard — 97 heading form, 9 doubled-pin. *Different denominator from the previously
  recorded 78/4,356 turns (1.8%) — reconcile before quoting either.*
- Convention compliance: **795 of 1,132** single-block turns (**70%**) emitted the block with no
  Stop check having run earlier in the turn. **A compliance figure, not a harm figure.**
- Missing blocks: **~1** plausible (9 candidates, hand-read).
- Correction path: 114 claim-linter turns since 07-28, 68 emitting the block after the injection;
  sampled case absorbed the correction silently, as designed.
- Opposite-regression check: 65 recent blocks re-run through the removed detectors → **1** flag
  ("the only"/"nothing else").
- Guard log: 397 lines; `arm2-*` events only on 07-23/26/27 (so **v2.2 took effect after
  2026-07-27**, a day later than the 2026-07-26 the ticket records); `arm1-block` 1,
  `arm1-escape` 0, `arm1-stateless-release` 0, `release-clean` 368.

## Widening measurement, 2026-08-09 afternoon (m-widen.js / m-widen2.js)

Inputs to the GEN-467 holistic-fix design (`../gen467-holistic-fix/design-v4r3.md` — converged
via a 3-round review panel the same day). Same drift warning as above; these ran a few hours
after the morning scan (e.g. claim-linter turns since 07-28 read 118 here vs 114 above).

- **407** widened-opener matches since 07-28 (364 turn-final, 43 non-final).
- **False-release candidates: 0 quote/draft-shaped lines in all 407** (class 1 non-bare: 0;
  class 2 odd-placement: 2 flagged, both real blocks missing the customary `---`, verified in
  transcript 9b667709 at 07-30 08:42/08:47). The turn-final arm is shape-classified, not
  individually eyeballed; the non-final arm is a complete population for the pre-block
  false-release channel by construction.
- **Tail geometry (union):** last opener match ≤4,523 fence-stripped chars from message end in
  100% of 407 (p99 = 4,247; non-final max 4,483) → the design's 6,000-char `markReleased` tail
  window has 1.33× margin over the complete observed population.
- **Continuations widening removes: 39 turns** since 07-28 whose wide-only block message drew a
  Phase-1 note at its Stop (~3/day). That most would have been false nudges is INFERRED from
  gen557's equivalent population, not measured on these 39.
- Claim-linter turns since 07-28: **118**, of which **41** had the block out before the linter
  fired (exposure upper bound; the 1 duplicate among them is Aug-5, an atypical exposure the
  widening eliminates). Signal-surface: **11** nudges, **3** co-firing with `release-clean`
  (prompts 0ed597c4 / 57a913f9 / e1291f02), 1 duplicate → **1/3** on block-already-out exposures.
