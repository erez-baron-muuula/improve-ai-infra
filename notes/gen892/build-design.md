# GEN-892 build design (2026-10-29, round 2), implementing notes/gen892/plan.md + amendments 1-9

Adds GEN-969 (size-checker YAML fix) and GEN-971 (release-review SKILL.md under 4,500 tokens) as riders.
Built in working copies under notes/gen892/wc/; installed only after Erez's approval and after today's
14:03 GEN-871 check. Nothing here touches the global CLAUDE.md, settings.json or the For-you hooks.

Round 2 changes (from the round-1 panel): the applied-change trace is corrected (section 5; amendment 9
was wrong about the project-edit report, which logs only Edit/Write/MultiEdit tool calls, auto-approve.js
lines 163, 187-201, 4600-4603); candidate tickets re-arm once their ticket is closed; a separate apply
timestamp so plain runs cannot mask a stalled watch; tool state moved to its own file; second anchors;
GEN-969 continuation case; size lines; smaller items marked (r2).

## Files

| File | Change |
|---|---|
| notes/anthropic-guidelines.json | anchors per watched limit; `_about` reworded |
| notes/release-review/release-review-tool.js | new `guidelines-check`; `readout` failure lines; header comment updated (r2) |
| notes/release-review/guidelines-state.json (NEW, tool-written only) (r2) | page hashes/sizes, checkUtc, applyUtc, warnings |
| .gitignore (r2) | add `notes/release-review/docs/` |
| ~/.claude/hooks/guidelines-limits.js (NEW) | shared reader for the 6 hooks below |
| ~/.claude/hooks/inject-notion-refs.js, inject-shell-refs.js, inject-topic-refs.js, inject-browser-refs.js | notes cap from the limits file |
| ~/.claude/hooks/sessionstart-backup-surfacer.js | notes cap + rules-line limit from the file; warnings with relay wording |
| ~/.claude/hooks/sessionstart-skill-restore.js | "5,000" in its message from `skill-after-compaction.value` |
| G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1 | rules-line limit follows the file with the log cross-check |
| ~/.claude/skills/config-health/config-health-scan.ps1 | GEN-969 only |
| ~/.claude/skills/release-review/SKILL.md, guidelines-watch.md (NEW), one more reference file (NEW) | NOT part of this approval: a separate /vet-rule proposal with its own /check (section 4) |

Size lines (check 4b): the code and data files above have no size limit (`size: skipped (no limit applies
to .js/.ps1/.json/.jsonl/.gitignore)`). The skill files are formed as their own /vet-rule proposal after
the code is built; that proposal carries measured `size:` lines from the drafts
(`config-health-scan.ps1 -Action size-check -Target <draft> -AsIfPath <real path>`). Measured today:
`size: SKILL.md 4,786 / 5,000 tokens (hard; skill-after-compaction)`, `270 / 500 body lines`,
`description 531 / 1,536` and `531 / 1,024`. Targets: SKILL.md under 4,500 tokens with the new Step 1
sentence; each new reference file 100 lines or fewer (or a Contents line).

## 1. Anchors (data)

`anchors: [{ page, before, after, field?, scale? }]`; `field` defaults to `value`. Pages: `memory`, `skills`,
`hooks`, `skill-best-practices` (platform page), plus `sub-agents`, `large-codebases`, `best-practices`
watched for advice only. All confirmed on today's downloads (scratchpad/pages, grep line numbers):
- hook-injected-text: hooks "plain stdout, are capped at" / "characters" (1050); hooks "If a value
  exceeds" / "characters" (1138) (r2)
- skill-after-compaction: skills "keeping the first" / "tokens of each" (611)
- skill-description-listing: skills "is truncated at" / "characters in the skill listing" (398)
- skill-md-lines: skills "Keep `SKILL.md` under" / "lines" (553); skill-best-practices "body under" / "lines" (257, 1140)
- claude-md-lines: memory "Files over" / "lines consume more context" (621); memory "target under" /
  "lines per CLAUDE.md file" (88) (r2)
- memory-md-load: memory "The first" / "lines of `MEMORY.md`" (547, field valueLines); memory "or the first" / "KB" (547, field valueBytes, scale 1000)
- skill-description-portable: skill-best-practices "`description`: Maximum" / "characters" (1134)
- reference-file-toc: skill-best-practices "reference files longer than" / "lines" (410)
- House rule gate-skill-runbook: not watched (ours).
All anchors of one field must agree; a disagreement is candidate reason `anchors-disagree`.

## 2. `guidelines-check [--apply] [--pages-dir <dir>] [--root <dir>]`

- `--root` = the notes folder: limits file `<root>/anthropic-guidelines.json`; log, tool state and page
  copies under `<root>/release-review/` (`guidelines-changes.jsonl`, `guidelines-state.json`, `docs/`).
  Default = the real notes folder. Any run with `--pages-dir` (plain or `--apply`) is refused unless
  `--root` resolves outside the real project (r2).
- Download: the 7 `.md` URLs with the tool's existing HTTPS fetch (60 s), extended to also return the
  content type. Accepted: status 200, content type `text/markdown` or `text/plain`, parameters such as
  `; charset=utf-8` allowed (curl -w %{content_type} this session: all 7 return
  `text/markdown; charset=utf-8`; a missing page returns 404), body not starting with an HTML tag. Page warning (none
  of that page's anchors judged) when any of those fail, the body is under 50% of the stored size, or
  2+ of the page's anchors are not found.
- Normalisation for matching: drop backticks and `*`, collapse whitespace; the same to `before`/`after`.
  Number = digits with optional thousands commas, whole-number match. A match is `before`, optional
  whitespace, one number, optional whitespace, `after` (nothing else between; so hooks 1138's later
  "2,000 characters" is not picked up). Per anchor, the distinct numbers so matched (case-insensitive)
  decide: only current → unchanged; exactly one
  other within 0.25x-4x of current (after `scale`) → change; else candidate with reason not-found,
  several-numbers, old-and-new, out-of-range or anchors-disagree.
- Candidate key `guidelines:<limitId>:<reason>`. Re-arm (r2): guidelines-watch.md files a ticket for a
  candidate unless findings.jsonl links that key to a ticket that is still open (live status not Done or
  Wont Do); a closed ticket means the next event files a new one. A failed status read counts as open
  (no new ticket; one digest line). This replaces SKILL.md Step 7's first bullet for `guidelines:` keys.
- `guidelines-state.json` `warnings` are replaced (not accumulated) by each run. `sinceUtc` is written by
  the first run that finds no state file (the install-time live run) and never changed after.
- Plain run (no `--apply`): reads only; its single write is `guidelines-state.json` `checkUtc` and
  `warnings` (a detected change is stored as warning "change detected, not applied: ..."). No limits
  file, no log, no page copies, no hashes, no `applyUtc`.
- `--apply` (live runs): sets `applyUtc`. For each change, a targeted text replacement of that field's
  number inside that limit's object (plus `verified` = today, plus the `memory-md-load` display string),
  written to a temp file in the same folder. Then: JSON.parse of the temp file must equal the old object
  with only those fields changed; the size checker must load it
  (`config-health-scan.ps1 -Action size-sweep -GuidelinesFile <temp>`, read `ok`); the files over the
  changed limit are taken from that sweep's findings. Either check failing → nothing written, candidate
  reason `apply-failed` (r2). Then a log row is appended (the newest row = the last line in file order)
  `{changeId, limit, field, old, new, page, sentence (<=300 chars), date, status:"applied", overLimit:[...]}`,
  then the temp file is renamed into place; a failed rename appends `{changeId, status:"not-applied"}`.
  Page copies saved to `docs/`, their hashes and sizes to `guidelines-state.json`. State writes are
  temp-file-then-rename (r2).
- "Text to update" (r2): only the changed limit's own string fields, plus the gate-skill-runbook house rule
  when skill-after-compaction changes; whole-number matches of the old value. Output only.
- Changed paragraphs: for a page whose normalised text differs from its saved copy, up to 10 added
  paragraphs mentioning a limit word or one of our file kinds, plus a count of the rest. Output only; data.
- Stray-copy test (also run by the build's tests): `~/.claude/hooks/*.js`, `~/.claude/scripts/*.ps1`,
  `~/.claude/skills/**/*.ps1`, `update-config.ps1`; identifiers containing CAP, KEEP, LIMIT or
  MAX_CONTEXT (case-insensitive) assigned a literal 10000/9500/9000, or a rules-line name (RULES_LINE /
  RulesLine, case-insensitive) assigned 200, other than `FALLBACK_*` names → a stored warning.
- Never throws: any error becomes a warning in the JSON output; exit 0.
- New-major-model tickets are the skill's judgment (it already reads the changelog lines).

## 3. Readers (hooks and update-config.ps1)

`guidelines-limits.js` exports `readLimit(id, { fallback, min, max, field, home })` → `{ value, warning, error }`;
`home` defaults to `os.homedir()` (tests pass a fixture). Paths: `<home>/AI Projects/Improve AI Infra/notes/...`.
1. Read and parse the limits file (BOM stripped). Unreadable or missing file → `{ value: fallback, error }`;
   missing id, non-integer, or outside [min, max] → `{ value: fallback }`.
2. value <= fallback → accept (lowering always accepted).
3. value > fallback → read `guidelines-changes.jsonl` line by line (a malformed line is skipped); drop rows
   whose changeId has a later `not-applied` row; take the last remaining `applied` row for that limit and
   field; accept only if its `new` equals the value; else fallback plus warning text.
Ranges: notes cap 2,000-100,000, fallback 10,000; rules lines 50-800, fallback 200; skill tokens
1,000-20,000, fallback 5,000. Each hook requires the module inside try/catch and keeps a `FALLBACK_*`
constant, so a missing or broken module means today's numbers.
- inject-notion/shell/topic: `CAP` = notes cap, `KEEP` = cap − 1,000; message text uses the cap.
- inject-browser: `INJECT_CAP` = cap − 500.
- surfacer: `MAX_CONTEXT_CHARS` = cap − 1,000; `RULES_LINE_CAP` renamed `FALLBACK_RULES_LINE_CAP`; limit from
  `readLimit('claude-md-lines', ...)` with `home` from its `claudeDir`. Session-start lines, each ending
  "Tell Erez in the 📌 For you block of your first reply." (r2): the two mismatch warnings ("rules-file limit
  in the limits file (N) does not match a logged Anthropic change; using 200"; "notes cap in the limits
  file (N) does not match a logged Anthropic change; using 10,000"), and one line when the module cannot
  be loaded or the limits file cannot be read (r2: so a silent fallback is not invisible).
- skill-restore: "about N tokens each".
- update-config.ps1: `$RulesLineCap` renamed `$FALLBACK_RULES_LINE_CAP`; `Get-RulesLineLimit` follows the
  same three rules (same log path, same changeId handling, per-line try/catch). File stays pure ASCII
  (test asserts it). Tested in step with the JS reader on one fixture log.

## 4. Release-review skill (separate /vet-rule proposal)

- New `guidelines-watch.md` (<=100 lines) per the plan's section 4, amended: no ticket for over-limit files
  (the weekly size check files those); tickets for "text to update", candidates (re-arm rule above),
  `apply-failed`, new advice about our setup files, and a new major model; and one digest line per applied
  change (section 5), appended even on a no-op week (a short dated section holding only that line). It adds `anthropic-guidelines.json` and `guidelines-changes.jsonl` to Step 10's
  commit list when changed (`guidelines-state.json` too; `docs/` is ignored).
- `SKILL.md` Step 1 gains one sentence before the no-op stop. GEN-971: detail moved to a new reference file
  in the same folder so the file ends under 4,500 tokens.

## 5. Surfacing (r2, corrected)

- /wrap stays silent on success (amendment 9). `readout` adds only failure lines: every stored warning in
  `guidelines-state.json`, and "guidelines watch has not applied in N days" when `applyUtc` is over 10
  days old (or absent and `guidelines-state.json` `sinceUtc` is over 10 days old; no state file at all
  and a live release-review run recorded after this build's install date, a constant in the tool) while
  live runs are succeeding.
- An applied change is traced by: one line in that run's digest section on GEN-959 (limit, old → new,
  Anthropic's sentence, files now over the limit), the run's final report, the log row, and the git commit
  of the limits file and log. It is NOT in the project-edit report (that report logs only Edit/Write/
  MultiEdit tool calls; the tool writes from a Node process). The digest is not /wrap, so "silent" holds;
  Erez is told of this correction.

## 6. GEN-969

`ConvertFrom-SizeYamlScalar` plain branch: a first-line value that is only a comment (`#...`) is dropped,
and the continuation lines (if any) are the value; an empty result, or a plain value of exactly `~`,
`null`, `Null` or `NULL`, is empty. Tests: a command file with each empty form gets the "description not
in frontmatter" note; `# note` + an indented continuation measures the continuation; both existing test
files still pass.

## Tests

The plan's fixture list, run with `--root` pointing to a scratch copy (proof the real files stay
byte-identical); hooks driven through spawnSync with `USERPROFILE` set to a fixture home folder; the
shared module's `readLimit` also tested directly with `home`; update-config.ps1's reader tested on a
scratch copy whose base path points at the fixture, against the same fixture log as the JS reader;
update-config.ps1 has zero non-ASCII characters.

## Install

After approval and after today's 14:03 GEN-871 check: hooks and scripts through the gated channels, then
the Drive From-Claude sync of the hooks (`sync.ps1`, which picks up the new module), then one live
`guidelines-check --apply` against today's pages (no changes, 7 hashes stored, every anchor matched).

## Residual (r2 additions)

- The docs can describe a limit before the installed Claude Code enforces it; a raise is applied at once.
- A git revert of the limits file is re-applied next Thursday while the page says the new number; the real
  undo is editing that limit's anchor (in an attended session).
- The cross-check stops hand edits, not a faulty live apply that writes file and log consistently; that
  is guarded only by the anchors, the 0.25x-4x range and the parse-equality check.
- Prose copies of a limit outside the limits file (e.g. wrap/step1-capture.md's "over 9,000") are not in
  "text to update".
- A crash between the log append and the rename leaves an applied row the file does not match: readers
  fall back to the built-in numbers with a warning until the next live run re-applies.
