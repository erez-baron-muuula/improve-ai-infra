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
- `write-verify-design.md` — design of the Notion write checker (`notion-write-verify.js`), including the
  2026-10-08 probe results on the practice page.
