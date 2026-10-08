# Proposed wording (GEN-453 / GEN-593) — revised after the rule-check (PASS + advisories)

## A. `C:\Users\Erez\.claude\hooks\refs\notion.md` (injected on Notion turns)

A1 — at the end of the existing bullet that begins "Before writing to or updating a page:", replace the
stale parenthetical
"(GEN-523 wrap, 2026-08-02: the GEN-58 index's current-volume pointer line carries a page-mention to the live volume)."
with
"(GEN-523 wrap, 2026-08-02.)"
(The GEN-58 pointer is plain text today, verified via REST on 2026-10-08.)

A2 — add ONE new bullet directly after that bullet:

- **Notion page-text edits get a checker line** (`notion-write-verify.js`, GEN-453). Every SUCCESSFUL
  notion-update-page `update_content` / `insert_content` / `replace_content` call is followed by one line
  starting "Notion edit" (landed / CHECK / NOT verified / NOT done yet) — act on what it says. **If a
  successful content edit gets no such line, the checker is not running: verify by hand via REST and say
  so.** It checks top-level block structure only; it does not replace re-reading the changed paragraph
  (bullet above). Not covered: REST/curl writes (including long GEN-58 write-ups appended via REST — re-read
  the "Current log volume" pointer first), notion-create-pages, content nested inside blocks, and a
  sub-agent's edits (its line goes to the sub-agent). An insert into a GEN-58 log volume older than the one
  the pointer names is refused (GEN-593). To test how Notion edits behave, use the practice page whose id is
  `NOTION_PRACTICE_PAGE_ID` in `~/.claude/hooks/auto-approve.js` — plain-text edits only; anything else aimed
  at it is refused.

## B. GEN-58 "How to log to this ticket" — append to step 5 (roll over)

"Keep the pointer line in its plain form, "Current log volume: Vol. N (...)": the write checker reads the
number from it and refuses appends to older volumes (GEN-593), so repoint it as soon as the new volume exists."

## Deviations from the approved plan (to tell Erez)
- Dropped "send one find/replace per call": probed 2026-10-08, a batch with a non-matching pair now fails as a
  whole, loudly, so the advice no longer prevents anything.
- The GEN-58 line is a keep-the-pointer-format sentence instead of "appends to a closed volume are blocked;
  re-read and retry": the refusal message itself already tells Claude which volume to use.
- Added: A1 (a stale claim corrected) and the practice-page pointer.
