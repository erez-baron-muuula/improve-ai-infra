# GEN-767 — stop-foryou-nudge.js: two per-kind model floors (code design)

Target: `C:\Users\Erez\.claude\hooks\stop-foryou-nudge.js` (live Stop hook + CLI used by /vet-code and /wrap).
Data source (already updated, committed a592b22): `C:\Users\Erez\AI Projects\Improve AI Infra\notes\effort-model-reference.md` Part 2 now has two machine-read lines (lines 43, 45):

    **Model floor — strong (judgment, correctness-critical): Opus 4.8.** At or above it (Opus 4.8, Opus 5, Opus 5.5, Fable 5, Fable 5.1). Below it (Sonnet 5.5, Sonnet 5, Haiku 4.5).
    **Model floor — standard (coding, well-specified authoring; at high effort or above): Sonnet 5.5.** At or above it (Sonnet 5.5, Opus 4.8, Opus 5, Opus 5.5, Fable 5, Fable 5.1). Below it (Sonnet 5, Haiku 4.5).

The CURRENT hook takes the FIRST line containing both "Model floor" and "At or above it (" (= the strong line), so today it already runs on the strong floor with no warnings (verified: `--selftest` ok, warnings []). Policy (approved by Erez, converged /check 2026-10-04): strong floor = judgment + correctness-critical; standard floor = coding / well-specified authoring ONLY at high effort or above (lower effort -> strong); mechanical work = no minimum; mixed/unclear -> strong. The hook can see the session model but NOT the kind of work or the actual effort setting; Claude applies kind/effort per path when it writes each tag.

## Changes

1. `parseModelListText(text)`:
   - Collect EVERY Part 2 line containing both `Model floor` and `At or above it (`. Label each by `/Model floor\s*[\u2014\u2013-]+\s*(strong|standard)\b/i`.
   - Error (list: null -> every model "unconfirmed", today's fail-safe) if: no labelled strong line, or no labelled standard line, or a label appears twice, or a floor-shaped line has no recognised label (an unlabelled legacy line is ambiguous -> fail safe rather than guess).
   - Per bar, same checks as today: both lists present and non-empty, every entry a `<Name> <major>[.<minor>]` name, no model in both lists of the same bar.
   - Return `list = { atAbove, below, bars: { strong: {atAbove, below}, standard: {atAbove, below} }, tier, warnings }` where top-level `atAbove`/`below` ARE the strong bar's (back-compat: existing callers and `classifyModelId(id, list)` keep strong-floor semantics).
   - Warnings (non-fatal, as today): tier-line entry not a model name; tier-line model missing from EITHER bar (named per bar); a bar's model missing from the tier line; NEW: a model at-or-above the strong floor but below the standard floor (strong must be a subset of standard — inconsistent file).
2. `classifyModelId(id, bar)`: UNCHANGED. Works on any `{atAbove, below}` (the strong-bar top-level fields or a `list.bars.X`). Newer-in-family runs per bar.
3. New helper `classifyByBar(id, list)` -> `{ strong, standard }` classes (both 'unlisted' when list is null).
4. `buildModelDirective`: let S = strong class, T = standard class, model = transcript read (unchanged read + match-guard).
   - model null, or S === 'unlisted' -> today's "could not be confirmed" fail-safe text, unchanged.
   - S at/above (listed-at-above | newer-in-family) -> today's "at or above the floor -- OMIT the model" text, byte-identical.
   - S === 'listed-below' and T at/above -> NEW mixed text: meets the standard floor (coding/agentic/tool-heavy and well-specified authoring at high effort or above) but is below the strong floor; for each tag decide from that path's kind of work (the same judgment that sets its effort): OMIT the model for mechanical work, and for coding or well-specified authoring tagged high/xhigh/max; for anything else (judgment, correctness-critical, mixed or unclear, or effort below high) SHOW the model and recommend switching to a stronger one. Same reconcile-and-fail-safe sentence and CODA as the other forms.
   - S === 'listed-below' and T not at/above (listed-below or unlisted) -> today's below-floor text plus one clause: the model may be omitted on a path that is purely mechanical work (lookups, formatting, straightforward edits). (Standard 'unlisted' with strong 'listed-below' takes this conservative branch: it recommends switching, never silently passes.)
5. CLI: `describeModel` adds `byBar: {strong, standard}`; `class` stays the strong class (so /vet-code Step 0/3/6 and /wrap Step 3f, which read only `class`, behave identically). `--agent-transcript` unchanged in its `class` logic (weakest strong class across models). `--selftest` keeps `atAbove`/`below` (strong) and adds `bars`.
6. Header/inline comments updated to describe two floors. No change to: marker detection, effort-tag enrichment, follow-up re-nudge, empty-fire sentinel, transcript reading, exit codes, CLI argument shapes.
7. Reference-file text: after install, drop "the strong line FIRST" from its "Refresh when" note (the new hook matches by label) — a plain doc edit in the repo.

## Tests (Step 4)
- Fixture unit tests (require the working copy): parse of the live file (both bars, no warnings); missing standard line / missing strong line / duplicate label / unlabelled legacy single line / empty list / model in both lists of one bar -> error; strong-not-subset-of-standard -> warning; classifyByBar for every listed model + claude-sonnet-5-7 (unlisted both) + claude-opus-5-7 (newer-in-family both).
- Directive: pipe real Stop payloads + real transcripts through the working copy with the transcript's last assistant model rewritten to opus-5-5 / sonnet-5-5 / sonnet-5 / haiku / unknown; assert the four directive forms; assert opus-5-5 output byte-identical to the live hook's.
- Regression: run the live and working copy over a corpus of real Stop payloads built from this machine's transcripts; output must be identical for every strong-floor model.
- CLI: --classify / --agent-transcript / --selftest outputs: `class` identical to live for all current model IDs.
