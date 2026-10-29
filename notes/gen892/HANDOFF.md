# GEN-892 build — handoff (2026-10-29)

Read this first, then `build-design.md`, `plan.md` (amendments 8-9 at the end).

## State
- Everything is built in `notes/gen892/wc/` and NOT installed. GEN-892 is In Progress. Riders: GEN-969 (size-checker YAML fix), GEN-971 (release-review SKILL.md under 4,500 tokens: draft is 4,477).
- Build scripts: `make-wc.js` (hooks, update-config.ps1, config-health-scan.ps1), `make-limits.js` (limits file anchors), `make-tool.js` + `tool-guidelines-block.js` (release-review-tool.js `guidelines-check`), `make-skill.js` (SKILL.md + writes-and-digest.md; `wc/skills/release-review/guidelines-watch.md` is edited directly). `make-diff.js` writes `wc.diff`.
- Tests: `node test.js` 109/109; `node live-verify.js` 10/10 (hooks identical to live on real inputs); size-checker suites `notes/gen890/weekly-test.js` 51/51 and `notes/gen893/size-lines-test.js` 44/44 against `wc/skills/config-health-scan.ps1`.
- Reviews done: design /check converged (ids in `check-panel.json`); skill-text /check converged round 3 (ids in `make-records.js` SKILL_IDS); Pass A /code-review twice; Pass B opus aa6df53779f981cd3 PASS, afa1af8eff6f33b7f PASS, a25c5473d8bd91363 REVISE (delta), a070eea8ba97fbfd3 REVISE (reader rewrite). Pass B model check: opus 5.5 for the first two (re-run for the rest). Secret-on-command-line scan: clean.
- GEN-871's 14:03 check ran and passed, so install timing is clear.

## Erez's decision (2026-10-29)
Question: "Should the rules-file gate use the same limit reader as the hooks?" Erez: "one shared reader, but in a new session."

## Remaining work
1. Replace the PowerShell reader in update-config.ps1 (`ps-reader-block.txt` + the `Get-RulesLineLimit` edits in `make-wc.js`) with a call to the JS reader: `& node -e`-free form, e.g. a tiny script `hooks/guidelines-limits.js --rules-line-limit` mode (or a separate CLI file) printing the integer; update-config.ps1 runs it the way it runs config-json-edit.js (line ~420, `& node ...`), uses the printed number only when it is an integer 50-800, else 200. Keep the file pure ASCII; keep every failure inside try/catch -> 200. Remove Get-ExactProperty/Get-RowField/Get-RowChangeId/Test-WholeNumber/Get-LoggedLimitValue.
2. The test harness `psRulesLimit` in test.js slices update-config.ps1 by comment markers: adapt it to the new code (it must run the gate's real function against fixture homes; the node reader finds files under USERPROFILE).
3. Last Pass B delta finding advisories worth taking: `expected.limits.find(x => x && x.id === ...)` in the apply block; move the isInside comment above isInside.
4. Rebuild, run all suites, regenerate wc.diff, one independent Pass B (opus) on the delta, Pass A.
5. `node make-records.js` (add the new Pass B ids), Step 5 approval card to Erez (attest: both /check verdicts, code reviews, Pass B models, tests, live-verify, secret scan, size lines for the 3 skill files), then mint passes and install: module `hooks/guidelines-limits.js` first (new, Write), then the 6 hooks and update-config.ps1 via `update-config.ps1 -File "<path>" -Op write-file -ContentFile "<wc>"` one line each, config-health-scan.ps1 / release-review-tool.js / anthropic-guidelines.json by byte copy, SKILL.md via check pass, the 2 new skill md files by Write. Then Drive From-Claude sync of hooks, byte-verify every target, confirm no live pass left.
6. After install: one live `guidelines-check --apply` (expect 0 changes, 12 anchors unchanged, 7 hashes, 0 stray copies); `readout` silent; a hook live-fire.
7. Tickets: rewrite GEN-892's body to what was built (it still says "thresholds updated only in an attended session" and "Blocked until"), set Review with the check "next Thursday's unattended run includes guidelines-check" (schedule a self-check); propose GEN-969 and GEN-971 Done. Commit notes/gen892, .gitignore, limits file, tool.

Do not install anything before Erez approves the card.
