# GEN-679 change set — the two doc edits (exact text)

## Edit 1 — `C:\Users\Erez\.claude\skills\wrap\SKILL.md`, Step 3b (check-gated skill edit; applied via Edit tool after a check pass is minted)

**1a. Replace** (gloss correction):

> a `detect` with a matching `deliver` was handled at that turn's Stop (the in-session nudge already fired, or the surfacing was designed) — nothing to report.

**with:**

> a `detect` with a matching `deliver` was handled at that turn's Stop — the pairing itself needs no report (the `deliver`'s `decision` field records what happened: nudged, cleared as surfacing-designed, suppressed with the exposure recorded, or consumed on a hook-continuation turn — that last kind gets its own reporting, below).

**1b. Insert, immediately after the sentence ending** "…so Erez can check whether that mechanism ever got a surfacing path." **:**

> Also report each `deliver` row with `decision:"skipped-continuation"` not closed by a matching `ack` (matched on `session`+`prompt`+`file`, copying `file` from the deliver row — it may be `(unknown)`): such a row means a mechanism was built during a hook-continuation turn, where the nudge is structurally forbidden and no surfacing judgment ran (GEN-679), so it needs the same human look as an orphan — list it under the same "Signal-surface (unsurfaced)" sub-heading naming the file and turn, and retire it the same way (append an `ack` with evidence the signal is surfaced elsewhere). A **continuation-ack** — an `ack` whose `session`+`prompt`+`file` matches a `skipped-continuation` deliver row — is kept OUT of the detector-noise FYI below (its root cause is structural, not detection precision) and counted separately: at **two or more** continuation-acks in the last 90 days, add a one-line FYI naming that count — frequent continuation-turn builds mean the enforcer has a systematic coverage gap on those turns, a design-revisit signal, not a pattern retune.

**1e. Replace** (scope the existing detector-noise FYI to exclude continuation-acks):

> Also count the `ack` lines whose `ts` falls within the last 90 days: at **two or more**, add a one-line FYI naming that count, since a detector needing repeated hand-dismissal is over-firing and its patterns want retuning (that retune is GEN-510's job, not `/wrap`'s); below two, say nothing.

**with:**

> Also count the `ack` lines whose `ts` falls within the last 90 days, excluding continuation-acks (counted separately above): at **two or more**, add a one-line FYI naming that count, since a detector needing repeated hand-dismissal is over-firing and its patterns want retuning (that retune is GEN-510's job, not `/wrap`'s); below two, say nothing.

**1d. Replace** (broaden the retirement section's rationale to cover its second caller):

> An unpaired `detect` left by a session that died before Stop is permanent, so a confirmed false alarm would otherwise re-surface at every future `/wrap`.

**with:**

> An unpaired `detect` left by a session that died before Stop — and, since GEN-679, an un-acked `skipped-continuation` deliver row (a completed Stop where nudging was structurally forbidden) — is permanent, so a confirmed false alarm would otherwise re-surface at every future `/wrap`.

**1c. Replace:**

> If every `detect` is paired (the common case), this step gets only its checkmark — no "nothing pending" line.

**with:**

> If every `detect` is paired and no un-acked `skipped-continuation` row exists (the common case), this step gets only its checkmark — no "nothing pending" line.

**1g. Replace** (name the `decision` field in Step 3b's schema comment, since the prose now keys on it):

> Each line is a JSON object `{kind:"detect"|"deliver"|"ack", session, prompt, file, ts, ...}`.

**with:**

> Each line is a JSON object `{kind:"detect"|"deliver"|"ack", session, prompt, file, ts, ...}` (`deliver` rows also carry `decision`).

**1f. Replace** (the retirement mechanics clause, so it names both row kinds it now closes):

> Copy `session`, `prompt` and `file` verbatim from the orphan line so the `ack` closes that one `detect` and no sibling from the same turn,

**with:**

> Copy `session`, `prompt` and `file` verbatim from the orphan line so the `ack` closes that one `detect` (or that one `skipped-continuation` `deliver` row) and no sibling from the same turn,

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

`notes/gen467-recut/rig/run-fixtures.js` copies the banked `working/stop-signal-surface.js`; after GEN-679 installs, that banked copy no longer matches the live hook. Add a one-line HISTORICAL banner note to that rig (or its README section) saying re-runs exercise the pre-GEN-679 recut copy — same treatment maint-attrib.js already got.
