# Root-cause note — Notion practice-page exemption (GEN-453)

## The goal
GEN-453 (catch Notion page-text edits that report success but silently do nothing, do half, or destroy a
neighbouring paragraph) needs ~15–20 UNATTENDED test edits — chiefly `update_content` (find/replace, the
command whose silent no-ops are the bug), plus `insert_content`, `replace_content`, and a title edit — on
a scratch page. The ticket-quality gate in `~/.claude/hooks/auto-approve.js` treats every page as a ticket
and requires a human-approved review per edit. Erez chose: a permanent "practice page" exemption, with
every other gate on, scoped to "only edits to the text and title of that one page; an edit that also
touches any other page stays blocked; pages created inside it are not covered".

## History of the fixes (each round found a new way an "exempt" edit could reach another page)
1. Only ids under id-named keys were checked -> a `<page url=OTHER>` tag in the text would MOVE that page
   in (Notion spec, notion://docs/enhanced-markdown-spec: "Using <page> with an existing page URL will MOVE
   that page into this page as a subpage") -> added a tag-name blocklist regex.
2. Foreign ids in the text -> added "every 32+ hex run must be the practice page id".
3. `<synced_block_reference>` missed by `\b`; `<unknown>`; compressed `{{3}}` URL placeholders -> widened.
4. Decoy: unparseable `page_id` beside the sandbox id in `id` -> pinned `page_id`, idish count 1.
5. Quadratic regex (a hook that times out does NOT block -> fail-open) and update_content editing text
   ALREADY on the page (`mention-page` -> `page` turns an existing link into a move; editing a sentence
   inside an existing synced-block reference changes the original elsewhere) -> replaced the tag regex
   with a plain ban on `<`, `{{`, `}}` in every string; position restricted to start/end; documented a
   PRECONDITION the hook cannot check: the practice page holds no tags (mentions, synced blocks, child
   pages/databases). Exempt writes can no longer ADD tags, so the page stays clean unless a reviewed write
   or a manual edit adds one.

## The suspected root cause
The gate decides from the REQUEST, but a Notion text edit's EFFECT depends on (a) markup semantics that
can reach other pages, and (b) what is ALREADY on the page (update_content / position edit existing
content). Fixes 1–4 were blocklist patches on (a). Fix 5's character ban is an allowlist-style rule for
(a) (exempt edits are plain text); (b) remains an assumed precondition.

## Candidate root-level options (for the reviewer to judge, extend, or reject)
- R1 Status quo of fix 5: payload allowlist + documented precondition (page stays plain). Cheapest.
- R2 Check page state at write time: for a practice-page write only, the hook reads the page via REST and
  confirms it holds no reach blocks (child_page, child_database, synced_block, link_to_page, mention
  rich_text), failing closed on error/timeout. Turns the precondition into a check. Cost: breaks the gate
  arm's stated invariant "NO subprocess call and NO network call on ANY path ... it is what keeps the arm
  in the class verified to block" (auto-approve.js ~L1786), and adds latency/fragility (token read via a
  PowerShell child; REST visibility limited to pages shared with the integration).
- R3 Fix the class globally instead of per-page: a guard (e.g. in notion-schema-guard.js, which already
  owns the "unreviewed re-parenting" incident class) that refuses/asks on ANY Notion content write
  containing a `<page url=` / `<database url=` / synced-block reference — protecting real tickets and the
  existing GEN-58 carve-out (which has the same exposure today) too. The practice-page exemption would
  then only need to decide "is this the practice page". Bigger scope; separate ticket?
- R4 Drop update_content from the exemption (only result-determined commands: replace_content,
  insert_content start/end, title). Removes the page-state dependency entirely, but GEN-453's tests of
  update_content (the actual bug) would each need a human-approved review again.
- R5 Something else.
