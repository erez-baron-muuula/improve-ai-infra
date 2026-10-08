# GEN-453 (+ GEN-593) working notes

- `practice-page-root-cause.md` — why the first practice-page exemption kept failing review (blocklist
  patches) and the root-level options.
- `practice-page-design-v3.md` — the root-rebuild design installed in `~/.claude/hooks/auto-approve.js` on
  2026-10-08: the Notion practice page (id pinned as `NOTION_PRACTICE_PAGE_ID`) accepts plain-text edits with
  no review; anything else aimed at it is refused outright (`practice-page-plain-only`).
- `test-gen453-practice.js` — behavioural suite for that change (86 checks at install). It runs the GEN-508
  harness against `auto-approve.working.js` in THIS folder: to re-run, copy the live hook here as
  `auto-approve.working.js` (with Node read/write, not a shell copy of a `~/.claude` file), plus
  `test-gen508-v8-arm.js` / `test-gen508-contract.js` / `notion-rest-write.ps1` / `vet-ticket-SKILL.md` from
  `../gen508-piece1/` if you want the regression suites too.
- `test-gen508-harness.js` — the GEN-508 harness with the `practice-page-plain-only` reason added (its own
  refusal prefix). `../gen508-piece1/test-gen508-harness.js` is the older copy, tied to that folder's stale
  working copy.
- `write-verify-design.md` (r1, with the 2026-10-08 probe results), `write-verify-design-r2.md`,
  `write-verify-design-r3.md` — design of the Notion write checker `~/.claude/hooks/notion-write-verify.js`
  and why it ended up reporting structural facts only (r2's text heuristics cried wolf).
- `drive.js` / `noedit-suite.js` — live drivers that run the checker as a real hook process against the
  practice page and the GEN-58 volumes. They load `notion-write-verify.js` from THIS folder: copy the live
  hook here first (Node read/write, not a shell copy of a `~/.claude` file).
- `wording-proposal.md` — the notes-file / GEN-58 protocol wording proposed for Erez's approval.
