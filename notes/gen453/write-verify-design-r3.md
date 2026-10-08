# Design r3 — `notion-write-verify.js` — revised after /check round 2

Earlier: verify-design.md (r1), verify-design-r2.md (r2). Implementation (authoritative): wcv/notion-write-verify.js.

## The round-2 lesson, applied at the root
r2 added TEXT heuristics (per-pair "did this find/replace land?" and "is this changed block explained by the
edit?") on letters+digits normalisation. Both round-2 reviewers showed they misfire on ordinary edits
(numbered-list markers and mention tags never appear in plain_text; `"x".indexOf("") === 0` made an emptied
neighbour "explained"), and today's server already fails a non-matching pair loudly — so the heuristic could
only cry wolf. Patching it means enumerating more markup cases. Instead r3 reports STRUCTURAL FACTS ONLY and
LISTS what changed, so the caller (who knows what it meant to change) compares — a skipped pair in a batch
shows up as a missing entry in the list; nothing is guessed from text.

## The one Post line (r3)
- async_task response -> "NOT done yet ... poll notion-get-async-task ..." (+ any volume-check skip note).
- no snapshot / unreadable page / read failure -> "NOT verified (<why>) -- re-read via REST".
- nothing changed (after one 1.5 s re-read): page has nested blocks, or an old_str is not visible at top
  level -> "NOT verified: no top-level change seen -- may be nested, or did not land"; otherwise -> "CHECK:
  NOTHING changed ... did not land" (for replace_content: "identical, or the replace did not land"). Both
  carry "re-read via REST before retrying; a re-sent insert or append duplicates content".
- CHECK (facts only): a removed block, except (a) an empty `paragraph` with no children, or (b) a block whose
  own text (>= 8 letters/digits) lies wholly inside some old_str (an intended merge) — both are listed but not
  flagged; nested content wiped (has_children true -> false); a block emptied (non-empty -> empty text); an
  insert that changed existing blocks or added none; a replace that cut a kept block by half or more.
- otherwise "verified: [top-level blocks: N changed: <excerpts>; M added: <excerpts>; K removed (...)]. Check
  this against the change you meant" (batch: "Check that each of your N changes appears in this list").
- "(content nested inside blocks is not compared)" whenever the page has nested blocks.
Change detection = hash of the block's whole type payload (+ has_children), minus Notion-hosted file
`expiry_time` and signed `url`s (they rotate between reads).

## GEN-593 arm (unchanged except)
Pointer: the volume NUMBER wins; a page mention is used only when the pointer names no number. Every skip
(target unreadable other than 404, pointer missing/numberless, Pre timeout during an insert) is named in the
Post line as "VOLUME CHECK SKIPPED ...".

## Live results so far (drive.js -> the real hook process, practice page + GEN-58 volumes)
single edit -> verified + excerpt; batch of 2 -> verified; intended 2-block merge -> verified ("1 inside the
replaced text"); replace dropping an unrelated block -> CHECK REMOVED (GEN-453 acceptance); edit inside a
nested child -> NOT verified (nested); async -> NOT done yet; no snapshot -> NOT verified; 404 page -> NOT
verified; append to Vol. 8 -> exit 2 with the GEN-593 reason; append to Vol. 9 -> allowed.
