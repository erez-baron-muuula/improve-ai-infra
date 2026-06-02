# Project History

## 2026-06-02 — GEN-43 sub-items resolution, git push fix, four global rules

Worked through several Team-Tasks tickets and hardened the global-rule tooling.

- **GEN-43 (sub-items tables) — Done.** Root-caused the empty epic/story child-tables: the templates filtered `Parent item` to a real page literally named "This Page" (GEN-23) that was later deleted. Notion has no dynamic "current page" filter for relations, and the view API/DSL can't edit relation filters (verified). Erez fixed it by pointing each template's filter at the template page itself, which Notion re-points to each new page on instantiation (verified isolated per page) — solving all future pages. Existing pages need a manual per-page re-point, tracked in GEN-118 (assigned to Erez). Closed GEN-48 (future-pages, superseded).
- **GEN-106 (git push fix) — Done.** The `claude-config-history` repo's remote URL had an embedded, now-revoked token, so every push failed (exit 128). Removed it, switched to a tokenless URL backed by Git Credential Manager; Erez re-authenticated once. `update-global-rule.ps1` / `sync.ps1` now push cleanly (confirmed in the automated path).
- **Four global `CLAUDE.md` rules added/corrected** (all pushed to GitHub): never use AskUserQuestion popups (ask inline); corrected the Notion "This Page"/relation-filter learning (the prior version was wrong and had misled this session); a ticket-routing heuristic (GEN-109); and a Notion filename-backtick rule to stop auto-linkified filenames (GEN-108).
- **GEN-119 / GEN-120 (mirror rules into Cursor) — Wont Do.** Investigated: Cursor has no global rules file (User Rules are settings-stored, per-machine), so automation isn't worth the cost. Fallback: ask Cursor what's needed when switching.

Open follow-ups: GEN-118 (manual per-page re-point, Erez), GEN-107 (remove a stray empty `advancedFilter` on GEN-78's view — manual UI).

## 2026-06-01 — Notion Team-Tasks sub-item backfill

Wrote and ran a one-off Node.js migration script to backfill the "Parent item 1" relation (the native Notion sub-item relation) from the existing "Parent item" relation in the Team-Tasks database.

- 78 pages scanned, 71 updated, 1 already had the target set (skipped), 6 had no source (skipped).
- All 71 writes succeeded with no errors.
- Script location: `C:\Users\Erez\AI Projects\Improving Claude and Cursor\notion-subitem-backfill\migrate.js`
- After the run, the native sub-item expand arrows in Notion are now driven by correct data.
