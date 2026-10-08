# Design r2 — `notion-write-verify.js` (GEN-453 + GEN-593) — revised after /check round 1

Round-1 design: `verify-design.md` (same folder). Implementation (r2): `wcv/notion-write-verify.js`.
Probe results (live, 2026-10-08, practice page): see `verify-design.md` — today a lone or batched non-match
fails LOUDLY upstream; async/queued edits are silent; block ids are stable for update/replace/insert.

## Changes from round 1 (each answers a round-1 finding)
1. Per-pair check for update_content (all three reviewers): for each pair, with alnum() normalisation
   (letters+digits only, lower-cased, markdown link targets dropped): flag "change #k does NOT appear to have
   landed" only when the old text is still present at least as often as before AND the new text is absent
   (append-style pairs where new contains old: flag only if new is absent; pairs whose old text is not
   visible at top level are not judged). Also flag changed blocks the edit cannot explain (old text held no
   old_str fragment and new text holds no new_str fragment).
2. Command filter: Post filters exactly like Pre; every command except update_properties /
   update_verification is treated as content (default-in, so a legacy/new command still gets a line).
3. Change detection is by a hash of the block's WHOLE type payload + has_children, so attribute-only edits
   (checked, bold, link target, colour) and a destroyed link/mention with unchanged text count as changes.
4. "Nothing changed": re-read once after 1.5 s; then, if the page has any block with children or a pair's
   old text is not visible at top level -> "NOT verified: no top-level change seen -- may be nested; re-read
   via REST"; only otherwise "CHECK: ... did not land ... a retried insert can duplicate content".
5. Damage in place: CHECK when a block's nested content was wiped (has_children true->false); for
   replace_content, when a kept block was emptied or lost >= half its text; for insert_content, when any
   existing block changed or no block was added. Removed EMPTY blocks are reported as a harmless note, not
   a CHECK. "verified" lines always carry "(content nested inside blocks is not compared)" when the page has
   nested blocks.
6. GEN-593 arm: blocks with exit 2 + stderr (not a JSON deny — HISTORY.md 2026-07-21 recorded that a soft
   deny did not override the settings allow-list for notion-update-page; exit 2 is what auto-approve.js
   uses). Blocks only when the target volume number is LOWER than the pointer's (a newer target is a
   mid-roll-over state); pointer parsing tolerant (first "Vol. N" in the paragraph starting "Current log
   volume", or a page mention in it — compared by id); pointer search stops as soon as found (GEN-58 is
   ~400 blocks). Message: append to Vol. N, find it via REST not notion-fetch; editing an old volume is not
   blocked; verify the pointer via REST before changing it. A skipped check is reported in the Post line as
   "VOLUME CHECK SKIPPED: ...".
7. Pre writes a provisional "did not finish" snapshot first, so a timed-out Pre is reported by name.
8. Residual corrected: hooks DO run inside sub-agents (current Claude Code docs).

## Still not covered (residuals)
REST/curl writes and notion-create-pages; content nested inside blocks; pages not shared with the
"Muuula 1" integration (reported NOT verified); an async edit's neighbour effects; concurrent edits to the
same page can blur a diff; the July server behaviour (silent skipped pairs) is now guarded only by the
per-pair heuristic.

## Verification plan
Live on the practice page through the real hook process (drive.js; then, after install, through Claude
Code itself): single edit -> verified; batch of two -> verified; merge that drops a neighbour -> CHECK
REMOVED (GEN-453 acceptance); a pair that did not land (snapshot taken for pair X, a different edit made)
-> CHECK not landed; an unexplained neighbour change -> CHECK; no change -> CHECK did not land (flat page)
/ NOT verified (nested page); async -> NOT done yet; no snapshot -> NOT verified; unreadable page -> NOT
verified; append to Vol. 8 -> blocked (GEN-593 acceptance); append to Vol. 9 -> allowed.
