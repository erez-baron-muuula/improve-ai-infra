# Design v3 (root rebuild) — Notion practice page in the ticket-quality gate

## Goal (Erez, 2026-10-08)
GEN-453 needs ~15–20 UNATTENDED test edits on one scratch "practice page" — chiefly `update_content`
(find/replace; the command whose silent no-ops are the bug), plus `insert_content`, `replace_content`, a
title edit. The ticket gate (`~/.claude/hooks/auto-approve.js`, `ticketScope`) treats every page id as a
ticket and requires a human-approved /vet-ticket record per write. Erez chose a permanent practice-page
exemption with every other gate on; scope he was told: "only edits to the text and title of that one
page; an edit that also touches any other page stays blocked; pages created inside it are not covered".
After five review rounds of blocklist patches he asked for the root fix; this is it.

## Threat model (the gate's own, auto-approve.js L1750-1754)
"this gate exists to stop the review being SKIPPED -- omitted under momentum, or lost across a context
compaction. It is NOT a defence against a Claude deliberately evading a rule it knows about." So the
carve-out must not let an ACCIDENTAL or ordinary write reach another page unreviewed; it need not resist
a deliberately evasive payload (though cheap closures are welcome).

## Root causes being fixed
1. A Notion text edit is not inert: per notion://docs/enhanced-markdown-spec (read 2026-10-08), `<page
   url=EXISTING>` MOVES that page in, a bare `<page>` creates a child page, `<database url=EXISTING>` moves
   a database, editing a synced-block reference changes the original elsewhere, URLs may be `{{N}}`
   placeholders. -> ALLOWLIST the payload: plain text only.
2. `update_content` edits text ALREADY on the page, so its effect depends on page state the hook cannot
   see (no network in this arm, L1786). -> keep the page plain BY CONSTRUCTION: no write aimed at the
   practice page may make it non-plain, reviewed or not.
3. The practice-page id lived in an unprotected file (`~/.claude-staging/sandboxes.json`), silently
   writable (bypassPermissions, L1756-1760), unreported, and the refusal text named it. -> PIN the id as a
   constant in the hook itself (a locked file that only changes through /vet-code + Erez's approval).

## Change
A. Revert the `loadSandboxRegistry` change entirely (back to jira/confluence only). Add
   `const NOTION_PRACTICE_PAGE_ID = '3f36e495d07c81f0b7c1d2ce5db8d12d';` next to `GEN58_PAGE_ID`.
B. `ticketIsPracticePagePlain(ti)` — evaluated on the RAW `tool_input` (no envelope hoisting, no
   JSON-in-string parsing: Notion receives the raw object, so that is what is judged). Plain iff ALL:
   1. `ti` is a plain object; every key ∈ {page_id, command, allow_async, content, position,
      content_updates, new_str, properties}.
   2. `ti.page_id` is a string that, trimmed / lowercased / dash-stripped, equals the practice id.
   3. `command` ∈ {update_content, insert_content, replace_content, update_properties}; the keys present
      match the command (update_content: content_updates; insert_content: content [+ position];
      replace_content: new_str; update_properties: properties) and no others besides page_id/command/
      allow_async.
   4. value shapes: allow_async boolean; content / new_str strings; position exactly {type:'start'} or
      {type:'end'}; content_updates a non-empty array of plain objects with only old_str/new_str
      (strings) and optional replace_all_matches (boolean); properties a plain object whose ONLY key is
      exactly `title` with a string value.
   5. every string VALUE among those fields (old_str, new_str, content, title): no `<`, no `{{`, no `}}`,
      also checked after `String.prototype.normalize('NFKC')` (folds full-width brackets); no `&lt`,
      `&gt`, `&#` (case-insensitive); no dash-stripped 32+ hex run at all (not even the practice id —
      the text never needs one, and an internal link would be converted to a mention tag).
   Linear time only (indexOf / one linear regex for hex runs).
C. Stage 2b in `ticketScope`, after the normaliser ok-check and the housekeeping early-out:
   - `practice = (pageIds from ticketSplitIds) includes NOTION_PRACTICE_PAGE_ID`, OR the raw page_id
     normalises to it.
   - if `practice` and tool === update-page and `ticketIsPracticePagePlain(ti)` -> `{scope:'out',
     sandbox:true, target}` (caller logs `sandbox-exempt`).
   - else if `practice` (any of the four gated tools: a non-plain update, a create whose parent is the
     practice page, a move into or of it, a duplicate of it) -> a HARD refusal with its own reason
     `practice-page-plain-only`, NOT clearable by a /vet-ticket record (returned as a block with no hash,
     the same "refuse now" path shell blocks use), message: the practice page accepts only plain-text
     edits; nothing else may be aimed at it.
   - Housekeeping-only property edits (Status etc.) on the practice page: it is not a database row, so
     these never apply; they still hit stage 2 first and fall through as today (harmless).
D. Refusal text NOT-gated list: "...and plain-text edits to the Notion practice page" (no file path).
E. Harness TICKET_BLOCK_SIGNATURES gains `practice-page-plain-only` (the contract suite pins the set of
   wired reasons).

## Residual (to tell Erez)
- Hand edits to the practice page in the Notion UI, and raw REST writes (the REST arm is unwired today,
  unchanged) can make the page non-plain; then an exempt fragment edit could act on that content.
  Mitigation later: GEN-453's own before-edit snapshot can verify the practice page holds no tags.
- Markdown Notion silently converts into a tag without `<` (e.g. a pipe table, if Notion parses one) is
  unverified — one live check after install.
- The wider class (a text edit on ANY page can move another page in, including the GEN-58 log lane) is
  out of scope here -> separate Notion-area ticket.

## Tests
Practice-page suite rewritten for v3 (exempt shapes; every non-plain shape -> no-pass is replaced by
`practice-page-plain-only`; create/move/duplicate -> practice-page-plain-only; a ticket write that only
mentions the practice page in text -> unaffected; timing test on 2 MB payload); GEN-508 arm (229) and
contract (32/2 pre-existing) suites unchanged; 994-payload real corpus sweep: only the one real practice
page write may change verdict; fixture pass-consumption test.
