# GEN-897 bundle — handoff (read first when continuing)

Plan (approved by Erez 2026-10-28): `C:\Users\Erez\.claude\plans\come-up-with-a-vectorized-beacon.md`.
GEN-897 set In Progress 2026-10-28.

## Done

- **Round 1 INSTALLED + verified 2026-10-28** (Erez: "Yes, install the nine Round 1 fixes as reviewed.").
  /check converged in 1 round, 4 lenses PASS (reviewers a77c2e36db951039c, acde4dec0ce63c061,
  a1f1acb98662a0996, acbedbbe36a1b9aef). Files: shell-howto, notion-howto, notion-ticket-lookup
  (+ SECURE-LOOKUP-DESIGN.md), content-review, review-design, check (skills); agents/check-reviewer.md;
  project CLAUDE.md. All 9 match the reviewed working copies (hash/diff); all 7 check passes consumed.
  Working copies + diff + build script: session scratchpad `gen897-r1/` (temporary).
  Live confirmation: shell-howto's full description now appears in the skill list (inv-H1 fixed).
  Advisories left for later (non-blocking): SECURE-LOOKUP-DESIGN.md line ~40 still says
  "Business/Enterprise error"; check's removed "(+ the premise-challenge paragraph above.)" could be a
  named pointer; a "re-test if the Notion plan changes" cue was dropped from notion-ticket-lookup.

## Decision 1 (F1) — settled 2026-10-28

Session permission mode: `auto` (get_session "self"; settings.json `permissions.defaultMode: auto`;
allow rules cover only `Edit/Write(C:\Users\Erez\.claude\*)`, not `~/.claude-staging`).
Live probe: a harmless Write to `~/.claude-staging/check-passes/gen897-f1-probe.txt` completed with NO
permission pop-up (Erez's screenshot showed none; a pop-up would have blocked the write until answered).
The 7 Round 1 pass writes also completed 2–5 s apart with no click from Erez.
**Conclusion:** in auto mode a pass-file write does NOT prompt Erez. The skills' claim "the mint write
prompts him — that prompt IS the gate" is false in auto mode (and in bypassPermissions). The real human
gate is Erez's explicit chat approval of the card. Record this on GEN-624 (Review) at close-out.
Consequence for GEN-525: the probe fast-path skips /check; with no prompt either, it has no human gate
except the card approval — wording must say the lane needs Erez's explicit chat approval of the probe card.

## Round 2 — to draft next (files located by grep 2026-10-28)

History / stale text:
- vet-code/reviews.md:84-88 (M13a "Pass B is now pinned … no longer applies")
- vet-code/live-verify.md:143 (M13b "Do not reflexively object…"), :215 (M13d "narrow remnant…"), :71 ("since GEN-641")
- vet-code/gate-mechanics.md:59 (M4 "confirm the first time you exercise this"), :144, :178, :221 ("since GEN-641"),
  :170 (M13c "regardless of pass" note + "historically (GEN-436)"), :208 ("Since GEN-462")
  — gate-mechanics.md is SHARED by /vet-code and /vet-rule: check against both runbooks.
- vet-ticket/scope.md:29 (M15a "Corrected 2026-08-05…"), :46 (M15b "This replaces an earlier…"), :79 (M15c, long line)
- vet-ticket/review.md:85 ("any more"), :163 ("realigned 2026-08-05…")
- vet-ticket/record-card-mint.md:70 (long line), :106 ("Earlier drafts…"), :187 ("Before 2026-08-05…")
- vet-ticket/lanes.md:66-67 (M9 `design-converged.md` → full path `notes\gen508-piece1\design-converged.md`; "A round-1 review rejected…")
F1 wording ("that prompt IS the gate" / "unforgeable"):
- vet-code/SKILL.md:132; vet-code/gate-mechanics.md:110 (shared), :211 (break-glass — check whether the sentinel
  write gets an explicit hook `ask`); staging/SKILL.md:11; vet-code/probe-fastpath.md:39; vet-code/background.md:14, :21;
  vet-rule/SKILL.md:13 (and :41 mechanical lane — check whether the hook returns an explicit `ask`, which may still prompt);
  vet-rule/background.md:35. vet-ticket already says bypass falls through silently (background.md:16, record-card-mint.md:83).
Companion tickets: GEN-525 + GEN-763 (probe-fastpath.md / vet-code Step 5), GEN-509 (one sentence in vet-code),
GEN-709 (vet-rule Step 2 third working-copy case; Step 7 "install this gate's own machinery" ≠ hook code),
GEN-852 vet-ticket half (SKILL.md:26-29 + scope.md:26/60 "not gated" bullet contradiction).
Also: cap-measure lines → `LC_ALL=C.UTF-8 wc -m`.
Size limits (checker, 2026-10-28): vet-code/SKILL.md 11,597/12,000, vet-rule/SKILL.md 11,396/12,000 (house caps) —
additions must be offset by removed history text in the same file.

## Round 2 — progress (sub-session 4cd4759a, 2026-10-28)

- Working copies built: session scratchpad `gen897-r2/` (`edits.txt` = every replacement with an id;
  `build.js` → `old/`, `new/`; `round2.diff`; `sizelines.txt`; `brief-context.md` = panel brief).
  75 replacements, 15 files, every file flat or smaller; xref checks 118/0 and 92/0.
- Docs verified (permission-modes.md): auto mode SHOWS a hook's explicit `ask`; a write with no hook
  decision goes to the auto-mode classifier (no prompt if allowed). auto-approve.js has no `ask`
  anywhere (defer = no decision), so mechanical lane / break-glass / new-file writes can land unseen.
  vet-ticket scope.md's "bypassPermissions discards the ask" claim was wrong for auto mode → fixed.
  settings.json: `Write(...)` allow rules never match; `Edit(C:\...\*)` = direct children only → GEN-624 note.
- /check round 1 panel spawned (sonnet): pre-mortem a483a252a01f6d038, holistic a1c41c7a6c0f1ae13,
  soundness a679f61e532dfc47b, rule-check a5a83bb0951386b8b.
- Decision 3 (GEN-525 quick lane) SETTLED. Question: keep the quick lane for throwaway test hooks, with
  Erez's chat OK on a card as its only check, or turn it off? Erez: "Keep it, with your OK." (option A,
  as drafted).
- Round 1 panel: all 4 PASS, no material findings. Advisories applied (81 replacements, 18 files —
  added vet-rule/claude-md-apply.md, vet-ticket/apply-recover.md, marker-probe.md for leftover
  "second prompt"/re-prompting/history text). probe-fastpath.md GROWS +300 chars (GEN-525/763 step +
  restored instruction sentences reviewers asked back) — must be flagged to Erez on the card.
  Re-review of revisions spawned: a2f67d16998010f79. Every other file flat or smaller; xref 118/0, 92/0.
- Re-review a2f67d16998010f79 PASS; its 3 advisories applied; confirmation a8eee073e943d71e3 PASS.
  CONVERGED. Final: 82 replacements, 18 files; xref 118/0, 92/0; sizelines regenerated.
  17 check-records written 2026-10-28T11:07:05Z (`gen897r2-*.check-record.json`, 6 reviewer ids).
  **staging/SKILL.md HELD**: session "Jira redline for external tickets" (local_efcda214-9ea4-4f73-8b72-e99517f5aab1,
  Memory Islands Dev) has a converged, uninstalled staging + global CLAUDE.md edit (records
  record-staging-skill-redline-audience.json / record-global-claude-md-redline-audience.json, 11:01Z).
  Re-run build.js for staging on top of its version once it lands (or once Erez drops it), quick re-review, own card.
- GEN-320 SETTLED. Question: how should wrap-up decide a session belongs to no project — A name the
  worked ticket(s) + parent epic before calling it "global", C hard-check code, B leave it? Erez: "my
  choice for 320 - A".
- The other session's staging + global CLAUDE.md edits LANDED 2026-10-28 ~11:34Z (passes consumed).
  Its global change = the "show exactly what changes" rule gets a Jira/Confluence no-preview exception;
  it does not touch the For-you/box rules the Nov 1 check measures. Staging fixes rebuilt on the new
  live file (`gen897-r2/staging-rebuild/`, intro anchor re-worded), 4,116 → 4,102 tokens; confirmation
  reviewer a1b93615eb7fa1890 spawned. old/new/staging in gen897-r2 now = new base.
- **Round 2 INSTALLED 2026-10-28** (Erez: "install, and tell me when to increase the effort"). Evidence
  check ALL OK on 18 records; live == base re-confirmed right before apply; 18 single-line
  `update-config.ps1 -Op write-file -ContentFile` applies, all exit OK; 18/18 installed files match the
  reviewed copies (LF-normalized); 18 passes consumed, 0 live.
## Round 3 — progress
- Effort raised to xhigh by Erez ("I raised the effort to xhigh. Start Round 3.").
- Drafted in scratchpad `gen897-r3/` (edits.txt 12 replacements + NEW config-health/settings-cleanup.md,
  moved block generated byte-identical by gen-move.js). Sizes: wrap/SKILL.md 11,928 → 11,902 chars;
  config-health/SKILL.md 4,580 → 3,576 tokens; step1-capture.md -240 chars. xref-check-wrap 114/2 —
  the same 2 fail on live (bytes-vs-chars, size-weekly.md path) = script limits, not regressions.
- Panel round 1 (sonnet): pre-mortem ad0be1cebe11caba7, holistic a33847d919589f8c3, soundness
  a64a6ee240a3c9d69, rule-check a82b6e72b1d22fd9b (PASS, advisories). GEN-970 split SETTLED.
  Question: "Move only the settings clean-up section out of the health-check sheet?" Erez: "Yes — move
  only the on-demand settings clean-up section into its own side sheet; everything wrap-up uses stays."
- New file goes through vet-rule Step 7 (no pass; create write after approval).
- Round 1: all 4 PASS (pre-mortem ad0be1cebe11caba7, holistic a33847d919589f8c3, soundness
  a64a6ee240a3c9d69, rule-check a82b6e72b1d22fd9b). Advisories applied via adv1.js (Step 0 lookup at
  decision point + "forces the full report" + "not just filed" + ticket-is-epic; "Step 2 skips the
  project CLAUDE.md"; Step 8 interrupted-sentence removed; step1 wording; config-health pointer style).
  Now 14 replacements: wrap 11,928 → 11,836 chars; config-health 4,580 → 3,569 tokens; xref 115/1
  (pre-existing size-weekly path). Re-review ae7d77b8c91f01a00 PASS → CONVERGED. 4 check-records
  written (`gen897r3-*.check-record.json`). Approval card shown; install = 3 passes + new-file create.
  Re-reviewer note for the card: with option A, a global-only session mapped to a project also runs
  that project's Step 6 closing steps (e.g. a deploy); Step 6's "only steps not already done" is the guard.
- Follow-up candidates (not this round): no-project wrap never releases the compact gate (Step 4 skipped;
  step4-history-git.md line 15) — pre-existing, for GEN-852 follow-up; Step 4b should name the project
  repo path when the working dir differs; 3c-3j "record in Step 4 HISTORY" lines have no home with no
  project; config-health-scan.ps1 line 14 comment still says "since the last config sync" (code).

- Follow-ups to file at close-out: hook comments in auto-approve.js (~1340 blockVetting "which prompts
  Erez", ~1554, ~1619, ~1832-1835, ~1885) repeat the old prompt claim; GEN-624 note: `permissions.ask`
  rule on `Edit(//c/Users/Erez/.claude-staging/*-passes/**)` would force a real prompt in every mode
  (docs: "Explicit ask rules still force a prompt"), settings frozen till Nov 1; vet-ticket SKILL.md
  dropped "never run this skill" for refusals (scope.md keeps it; not restored, size).
- Round 3 prep: GEN-320 body read (Step 0 "derive from parent epic" fix it mentions is NOT in the live
  sheet). Draft plan: wrap Step 0 two bullets (name tickets + parent epic before "global"; no project →
  skip only Steps 4/4b/6), description trigger (inv-M3), Step 5 full sync.ps1 path (verified exists),
  offsets by removing Step 2/3 "no line" sentences (covered by the Reporting rule) + moving the
  no-findings note into config-health Step 5; step1-capture.md inv-M5. config-health: drop "build of
  GEN-271", H5 marker wording, M1 session id via `$CLAUDE_SESSION_ID`, GEN-970: move the on-demand
  settings cleanup (lines ~96-108) to new `settings-cleanup.md` (no external refs to that section).
- Not done (recorded): `wc -m` switch (cap lines already use the size checker; `wc -m` miscounts emoji);
  vet-rule has no fast-path, so GEN-525 needs no vet-rule change; hook comments ~1619/~1832 repeat the
  old prompt claim (code, out of scope → follow-up).

## Rounds 3 and close-out

See the plan. Ticket progress notes (GEN-897, GEN-624, companions) go through /vet-ticket at close-out.
