# GEN-679 change set — the two doc edits (exact text)

> Revised 2026-08-11 to clear the 8 findings from the `/code-review` Pass A re-run
> (`notes/gen679/review-pass-a-2026-08-11.md`), then revised again (round 2) to clear the
> targeted `/check` panel's one material finding: my fix-2 count-routing had dropped the
> aggregate signal that orphan-acks previously fed, so the three retirement causes are now a
> complete partition into three cause-routed 90-day FYIs (see 1e/1i). Each Edit 1 part below is
> tagged with the finding number(s) it addresses. The hook working copy is unaffected and remains hash-locked.

## Edit 1 — `C:\Users\Erez\.claude\skills\wrap\SKILL.md`, Step 3b (check-gated skill edit; applied as ONE full-file Write after a check pass is minted — never a sequence of Edit calls, the pass is single-use)

**Ordering (fix 3):** apply Edit 1 BEFORE, or in the same apply session as, the hook install — mirrors Edit 2's ordering note. Edit-1-first is costless: its new reporting keys on `skipped-continuation` rows that do not exist until the hook runs, so there is no window where the new prose mis-describes live data. Installing the hook first WITHOUT Edit 1 opens a window where continuation detects get a paired `skipped-continuation` `deliver` that the old prose treats as "handled — nothing to report", i.e. silent misses.

Each part below is tagged with the Pass A finding (or round-2 fix) it clears; compose them all into the single full-file Write.

**1g (schema comment). Replace** (name the fields the new prose now keys on):

> Each line is a JSON object `{kind:"detect"|"deliver"|"ack", session, prompt, file, ts, ...}`.

**with:**

> Each line is a JSON object `{kind:"detect"|"deliver"|"ack", session, prompt, file, ts, ...}` (`deliver` rows also carry `decision`; a retirement `ack`'s `reason` begins with a routing tag — see "Retiring a known-benign orphan" below).

**1a. Replace** (gloss correction):

> a `detect` with a matching `deliver` was handled at that turn's Stop (the in-session nudge already fired, or the surfacing was designed) — nothing to report.

**with:**

> a `detect` with a matching `deliver` was handled at that turn's Stop — the pairing itself needs no report (the `deliver`'s `decision` field records what happened: nudged, cleared as surfacing-designed, suppressed with the exposure recorded, or consumed on a hook-continuation turn — that last kind gets its own reporting, below).

**1h (fix 4). Replace** (hedge the unpaired-detect cause — the unlink-failure reset now creates unpaired detects from sessions that ended normally):

> but the session died before its Stop hook could deliver the nudge

**with:**

> but no `deliver` was ever paired to it — either the session died before its Stop hook ran, or the Stop ran normally but a marker-unlink failure aborted the pairing (GEN-679) — leaving the `detect` permanently unpaired

**1b (fixes 1, 5, 6, 7). Insert, immediately after the sentence ending** "…so Erez can check whether that mechanism ever got a surfacing path." **:**

> Also reconcile the `deliver` rows with `decision:"skipped-continuation"` (GEN-679 — written when a mechanism is built on a hook-continuation turn, where the nudge is structurally forbidden). Report such a row ONLY if it is not already accounted for. A row is accounted for if EITHER: (a) another `deliver` row with the same `session`+`prompt`+`file` carries a judged decision (`nudge`, `cleared-surfacing-designed`, or `suppressed-block-out`) — the mechanism was already judged on the main turn and this continuation row is just the nudge→fix compliance cycle re-tripping the detector, so treat it as handled and do not report it (this is the mechanically-available discriminator; matching on `session`+`prompt`+`file` cannot distinguish a genuinely new same-file mechanism from the compliance cycle — an accepted trade-off — and a compliance fix that instead lands in a different file simply won't match and is safely over-reported); OR (b) it is closed by a matching `ack` (matched on `session`+`prompt`+`file`). A row that survives both tests normally means a real signal-producing mechanism was built on a continuation turn and got no surfacing judgment — rarely, it is a main-turn leftover marker consumed by a sibling-spawned continuation (the hook header's documented mislabeling residual). Either way it needs the same human look as an orphan: list it under the same "Signal-surface (unsurfaced)" sub-heading naming the file and turn, and retire it per "Retiring a known-benign orphan" below. When matching or copying `file`, note it may be a sentinel — `(unknown)` or `(content-match)` — rather than a path; copy it verbatim. When the row's `file` is `(unknown)`, additionally list the `file` values of every `detect` row sharing its `session`+`prompt` as candidate names to help the human look — but the retiring `ack` still copies `(unknown)` verbatim from the `deliver` row (copying it is what closes the row; the recovered candidates are for the human, not the `ack`). The aggregate 90-day FYIs that tally these retirements by cause are defined together below.

**1c. Replace:**

> If every `detect` is paired (the common case), this step gets only its checkmark — no "nothing pending" line.

**with:**

> If every `detect` is paired and no `skipped-continuation` row remains to report (per the accounting above) — the common case — this step gets only its checkmark — no "nothing pending" line.

**1e (fix 2 + round-2 material fix). Replace** (replace the single detector-noise count with three cause-routed 90-day FYIs — a complete partition of retirement acks, so no cause goes uncounted):

> Also count the `ack` lines whose `ts` falls within the last 90 days: at **two or more**, add a one-line FYI naming that count, since a detector needing repeated hand-dismissal is over-firing and its patterns want retuning (that retune is GEN-510's job, not `/wrap`'s); below two, say nothing.

**with:**

> Also raise the aggregate 90-day FYIs from the retirement `ack` lines, routed by cause — for each, count the matching `ack` lines whose `ts` falls within the last 90 days and, at **two or more**, add a one-line FYI naming that count; below two, say nothing. (1) **Detector-retune** — `ack` lines tagged `false-detect:` (the detector fired but no signal-producing mechanism was built), since a detector that repeatedly fires on nothing is over-firing and its patterns want retuning (that retune is GEN-510's job, not `/wrap`'s). (2) **Continuation coverage-gap** — `ack` lines tagged `surfaced-elsewhere:` that close a `skipped-continuation` row, since real builds recurring on continuation turns predominantly mean the enforcer has a systematic coverage gap there (a design-revisit signal, not a detector retune). (3) **Orphaned-detect reliability** — `ack` lines tagged `surfaced-elsewhere:` that close an unpaired `detect` orphan, since a recurring need to hand-retire benign orphans means detects are repeatedly ending up unpaired. The count cannot tell WHY (per the hedge above, either the session died before Stop, or the Stop ran but its marker-unlink failed — the GEN-679 bug class), so a rising count is a prompt to read the acks and surrounding log evidence and decide between routine session death and a recurring pairing bug — not a claim that pairing is broken. Individual retirements would otherwise hide the trend. Every **tagged** retirement `ack` feeds exactly one of these three, by its tag and the row kind it closes.

**1d (fix 4). Replace** (broaden the retirement section's rationale to cover its new callers and the hedged cause):

> An unpaired `detect` left by a session that died before Stop is permanent, so a confirmed false alarm would otherwise re-surface at every future `/wrap`.

**with:**

> An unpaired `detect` — left either by a session that died before Stop or by a normally-completed Stop whose marker-unlink failed (GEN-679) — and, since GEN-679, an un-acked `skipped-continuation` `deliver` row (a completed Stop where nudging was structurally forbidden) — are permanent, so a confirmed false alarm would otherwise re-surface at every future `/wrap`.

**1i (fix 2). Replace** (introduce the two routing tags on `reason`, and give the false-detect case a legal retirement wording):

> and give `reason` the specific evidence that this mechanism's signal does reach Erez by some other designed path; absent that evidence the orphan is not benign and must not be acked, because an `ack` permanently hides it.

**with:**

> and begin `reason` with one of two routing tags recording WHY the row is benign, because Step 3b's aggregate FYIs route on it — the tag prefix is what makes the retirement countable; an untagged `reason` still retires the row but falls out of every count: `surfaced-elsewhere:` followed by the specific evidence that this mechanism's signal does reach Erez by some other designed path (use when a real mechanism was built), or `false-detect:` followed by what the detector matched and why it is not a signal producer (use when NO signal-producing mechanism was built this turn — the only legal wording for a pure false positive, which has nothing "surfaced elsewhere" to cite). Absent a truthful form of one tag the row is not benign and must not be acked, because an `ack` permanently hides it. Routing (by which row kind the `ack`'s `session`+`prompt`+`file` matches, not by any hedged cause): a `false-detect:` ack feeds the detector-retune FYI whatever it closes; a `surfaced-elsewhere:` ack feeds the continuation coverage-gap FYI if it closes a `skipped-continuation` `deliver` row, or the orphaned-detect-reliability FYI if it closes an unpaired `detect` orphan.

**1f. Replace** (the retirement mechanics clause, so it names both row kinds it now closes):

> Copy `session`, `prompt` and `file` verbatim from the orphan line so the `ack` closes that one `detect` and no sibling from the same turn,

**with:**

> Copy `session`, `prompt` and `file` verbatim from the orphan line so the `ack` closes that one `detect` (or that one `skipped-continuation` `deliver` row) and no sibling from the same turn,

**1j (fix 2). Replace** (in the ack-template code fence, show the tagged `reason`):

> reason='<evidence the signal is surfaced elsewhere>'

**with:**

> reason='surfaced-elsewhere: <evidence the signal reaches Erez by another path>'  # or 'false-detect: <what the detector matched and why it is not a signal producer>'

### Test-coverage note (Pass A, on `rig/livefire.js` Case 12) — carry to verify time

Nothing in the banked rig exercises the new `/wrap`-reader rules — the fix-1 compliance-cycle exclusion and the three cause-routed 90-day FYIs (`false-detect:` retune, `surfaced-elsewhere:`-continuation coverage-gap, `surfaced-elsewhere:`-orphan orphaned-detect reliability). These are reader rules, not hook behavior, so they are not on the hook's live-fire path. Verify them by hand once post-install (or file a rig fixture as a follow-up): construct a `signal-surface-pending.jsonl` with (i) a `skipped-continuation` row that has a judged-decision sibling — must be ignored; (ii) a `false-detect:` ack — feeds only the retune count; (iii) a `surfaced-elsewhere:` ack closing a `skipped-continuation` row — feeds only the coverage-gap count; (iv) a `surfaced-elsewhere:` ack closing an unpaired `detect` — feeds only the orphaned-detect-reliability count.

## Edit 2 — `C:\Users\Erez\.claude\scheduled-tasks\gen467-block-after-check-verify\SKILL.md` (not a gated file; applied with the Edit tool in the same batch, after the hook installs)

**Replace:**

>   `deliver` rows carry `decision` ∈ {`nudge`, `cleared-surfacing-designed`,
>   `suppressed-block-out`}. When joining across the two logs, map

**with:**

>   `deliver` rows carry `decision` ∈ {`nudge`, `cleared-surfacing-designed`,
>   `suppressed-block-out`, `skipped-continuation`}. `skipped-continuation`
>   (GEN-679, 2026-08-11) is informational to this scan — no count or bar keys
>   on it; its reader is /wrap's reconciliation step. When joining across the
>   two logs, map

## Post-install maintenance note (project repo, auto-approved edit)

`notes/gen467-recut/rig/run-fixtures.js` copies the banked `notes/gen679/working/stop-signal-surface.js`; after GEN-679 installs, that banked copy no longer matches the live hook. Add a one-line HISTORICAL banner comment at the top of `notes/gen467-recut/rig/run-fixtures.js` itself (verified to exist) saying its runs exercise the pre-GEN-679 recut copy, not the live hook. (Fix 8: earlier drafts pointed this at a `notes/gen467-recut` README and cited `maint-attrib.js` — neither exists; the banner goes on the rig file directly.)
