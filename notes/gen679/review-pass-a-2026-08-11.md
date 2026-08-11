# GEN-679 — /code-review Pass A re-run, 2026-08-11 (this file is the durable record; the in-app findings panel does not survive the session)

## Outcome
Ran at xhigh: 10 finder angles → 29 raw candidates → deduped to 16 → one adversarial verifier each → gap sweep (4 new grounded candidates). **15 findings reported.**

**The hook working copy is CLEAN for install purposes**: none of its findings is a runtime defect in the new code. Its vetting record and contentHash remain VALID — do NOT edit `working/stop-signal-surface.js`, do NOT re-vet it. The five hardest attacks on the new control flow were all REFUTED (unlink-failure reset = deliberate fixture-locked fix; continuation fs-wedge = watchdog never guarded sync stalls, sibling already does fs there; strict `=== true` = identical in all four hooks, probe-confirmed boolean; noprompt key collision = pre-existing flavor, never observed, monitored; untracked file-granularity residual = tracked on GEN-596).

**The material findings are in `working/doc-edits.md` (the check-gated /wrap SKILL.md Edit 1 text) + one live-skill gloss it re-asserts.** Erez chose (2026-08-11): FIX the doc-edit text in a new session, re-run a targeted /check on the revised Edit 1 text only, then resume the install.

## Findings the next session must FIX in doc-edits.md (before minting the check pass)
1. **Compliance-cycle rows read as coverage gaps** (Edit 1b, CONFIRMED, top severity): the nudge→fix cycle re-trips the detector (fix edit's new_string still contains e.g. appendFileSync; continuation Stop shares the main turn's session+prompt — probe-confirmed) → 'skipped-continuation' row → /wrap reports "unsurfaced" + hand-ack + feeds the 2-in-90d "coverage gap / design-revisit" FYI. FIX: exclude from the report (or classify separately) skipped rows whose session+prompt+file already carries a judged deliver ('nudge'/'cleared-surfacing-designed'/'suppressed-block-out') — the mechanically available discriminator.
2. **Edit 1e counter routing** (CONFIRMED, moderate): excluding ALL continuation-acks from the detector-retune count misroutes detector false-positives that happened on continuation turns — retune counter under-counts (bar 2/90d), gap counter over-counts. Also the retirement wording ("evidence the signal is surfaced elsewhere") has no valid form for a pure false detect. FIX: route by cause, not turn-type — e.g. have the ack's `reason` distinguish "false detect / no mechanism built" (feeds retune count) from "real build, structurally unjudged" (feeds gap count), and give the false-detect case a legal retirement wording.
3. **Install ordering** (CONFIRMED): add an ordering note to Edit 1's header mirroring Edit 2's — apply Edit 1 BEFORE (or in the same apply session as) the hook install; Edit-1-first is costless (its reporting keys on rows that don't exist until the hook runs). Without it, the hook-only window turns visible orphans into silent misses.
4. **"Session died" gloss now false for a new producer** (sweep finding, live SKILL.md line ~45, re-asserted by Edit 1d): the unlink-failure reset creates permanently-unpaired detects from sessions that ended normally (read OK, unlink threw, no row, marker TTL-prunes). FIX in the Edit 1 text: hedge the unpaired-detect cause gloss (crash OR transient unlink failure at Stop).
5. **Edit 1b categorical provenance gloss** (CONFIRMED): "such a row means a mechanism was built during a hook-continuation turn" — false for the leftover-marker path (main-turn marker consumed by a sibling-spawned continuation; the hook header's documented mislabeling residual). FIX: one-clause hedge ("normally means … rarely a main-turn leftover…"). Ack mechanics unaffected; optionally soften the FYI wording ("predominantly").
6. **'(content-match)' sentinel omitted** (sweep): Edit 1b says the copied file "may be (unknown)" — also name '(content-match)' as a sentinel, not a filename.
7. **'(unknown)' report-line recovery** (CONFIRMED, low): when the deliver row says '(unknown)', the report line should ALSO list all same-key detect rows' files as candidates. The ack must still copy '(unknown)' verbatim from the deliver row (that is what closes it — do NOT substitute the recovered name into the ack).
8. **Maintenance-note dead target** (sweep): doc-edits.md line ~74 points the HISTORICAL banner at a notes/gen467-recut README that does not exist; the banner belongs on notes/gen467-recut/rig/run-fixtures.js itself.

Optional if trivially foldable into the same doc-edit revision: a rig fixture (or explicit manual-check note) for the two new counting rules — nothing in the rig exercises the continuation-ack FYI count or the Edit 1e exclusion (test-coverage finding on rig/livefire.js Case 12).

## Findings that are NOT fixes now (file as follow-up tickets at /wrap or after install)
- **Hook comment inaccuracy** (line ~266): outer-catch comment wrongly names readFileSync (inner catch absorbs it; read-fail+unlink-success consumes+pairs '(unknown)' — intended per lines 245–247). Comment-only; hash-locked → follow-up ticket for the next re-vet, plus a read-fail+unlink-success fixture.
- **Pre-existing dead pattern** /\b\/wrap\b/i (line 144) — can never match prose "/wrap"; the file's own doc example can't match. One-token fix at next re-vet.
- **Pre-existing hygiene**: '(unknown)' not excluded from basename-context construction (line ~198, near-no-op).
- **Hardening**: truthy non-string markerData.file serialized raw (theoretical; detector is type-guarded).
- **Doctrine placement**: CONTINUATION-STATE etiquette absent from the canonical etiquette site (stop-cred-denial-surface.js) — fold a one-line cross-ref into the GEN-467-tracked etiquette refresh.
- **Advisory**: hook header's file-granularity residual could name GEN-596 (which tracks it).
- **Accepted debt (no action)**: typeof-coercion form; `markerData.file || '(unknown)'` computed twice; inline comment restating the header clause.

## State that remains valid (verified this session)
- Working copy `working/stop-signal-surface.js` sha256 (normalized \n): `56af932278e0ada78a567c7f617bffed7ad509a4709bac88b147b65c093eb1fa` — matches the vetting record `C:\Users\Erez\.claude-staging\vetting-passes\record-gen679-stop-signal-surface.json`.
- Live hook untouched: sha12 `03ce725f5087`.
- All seven Edit-1 anchors + Edit-2 anchor verified to exist verbatim and uniquely in the live target files (cross-file tracer, this session).

## Remaining steps for the pickup session (in order)
1. Revise `working/doc-edits.md` per fixes 1–8 above (this file is NOT hash-locked; revising it does not touch the hook's vetting).
2. Targeted /check on the revised Edit 1 text only (the wrap-skill edit is check-gated; the original panel's verdict no longer covers the revised text). Hook vetting stays banked — no Pass B, no design panel, no hook re-review.
3. Then resume the original install sequence: Step-5 attestation → Erez's approval → mint the `vetting` pass (hook) and `check` pass (wrap skill) → apply in the FIXED order (wrap-skill Edit 1 first, then hook via single-line update-config.ps1 -Op write-file, then Edit 2, then the maintenance banner on run-fixtures.js directly) → verify (hash equality, both passes consumed, live-fire pipe, re-read both skill files) → GEN-679 to Review.
