# Project History

## 2026-06-03 — GEN-93 research arc complete (config/memory/token/code/flow)

Completed the full research arc for the **GEN-93 "AI Infra Efficiency"** sub-epic. All five research Stories are now Done: GEN-95 (config health), GEN-101 (memory health), GEN-97 (token economy), GEN-94 (code health), GEN-96 (conversation flow).

- **Key architectural finding (for the pending synthesis):** the five dimensions do **not** collapse into one audit engine — they cluster into **two measurement families**: (A) a *static corpus audit* over documents (config + memory, with code reporting in via its own code-tool probes), and (B) a *transcript/behavioural analysis* over the per-session `.jsonl` turns (token economy + conversation flow, plus a live hook). A document scanner can't detect a conversation loop (a temporal pattern), so the two families are genuinely separate.
- **GEN-94 (code health) — Done.** Grounded in real state: InvoiceAutomation is a single **2,865-line `Code.js`** (the clear worst offender); tooling scripts are healthy; MemoryPirates not scanned. Decision: **don't build a custom code checker** — use off-the-shelf `jscpd` + a line-counter on demand across all repos; add per-language linters only when a repo earns it. Follow-up **GEN-142** (split `Code.js`) filed under the **Invoice automation epic (GEN-21)**, routed by domain — not under GEN-93.
- **GEN-96 (conversation flow) — Done.** Flow metrics (turns-to-completion, repeated tool calls, edit churn, stall ratio) are derivable from existing transcripts — no new capture. Follow-ups under GEN-93: **GEN-143** (add flow metrics to the transcript-mining report) and **GEN-144** (in-session loop/edit-churn detector hook — the *mechanical* enforcement of GEN-58's prompt-only fix-on-fix/contradiction triggers; build alongside GEN-58).
- **GEN-97 note corrected.** Removed the now-false "dead reference to `statusline.js`" claims: that file was an intentional, approved deletion, `settings.json` is clean, and Claude Code's built-in context gauge supersedes a custom one. Also removed the redundant "alert at 90%/95% context" rule from the global `CLAUDE.md` (the built-in gauge covers it).
- **GEN-140 (backup safeguard)** reframed earlier in the session to a Low-priority, forward-looking ticket (the latent risk is `sync.ps1`'s hardcoded allow-list; statusline.js loss was intentional, not a fault).
- **GEN-145 (Bug, under "Improving Notion") — filed.** `notion-create-pages` applies the Task Template inconsistently (blank for GEN-142; duplicated `## Description` heading for GEN-143/144). Workaround in use: for leaf tasks, create without `template_id` and write the Description directly. Flagged an open rule-design tension with the global "always apply a template" rule (not resolved).
- **Auto-approval reviewer (wrap-up):** analyzed all 492 entries in `deferred-calls.jsonl`. No safe-set additions warranted — the recurring deferrals (`notion-update-page`, `Edit`, `notion-create-pages`, `node`, `git`, `Remove-Item`) are state-mutating and correctly stay manual; the read-only recurring ones are already allowed.

**Next:** the **GEN-93 epic synthesis** (Opus-tier design) — ratify the two-family architecture, pick build priorities, and unblock the synthesis-gated tickets (GEN-129/130/131, memory cross-store dedup, unified-dashboard question).

## 2026-06-03 — Playwright MCP cleanup, GEN-104/107/118, project rename

- **Stray Playwright MCP removed.** A startup warning ("Could not attach to MCP server playwright") traced to a `playwright` server entry added to `claude_desktop_config.json` on 2026-06-02 (not by Erez intentionally). Removed it; warning clears on next restart.
- **GEN-104 (search tickets by ID) — Done (Erez).** Clarified scope: Claude's *API* search already finds GEN-* by ID reliably (demonstrated, and a DB-scoped `notion-search` is the robust path); the ticket's real target is Notion's *GUI* search bar, whose property-indexing behavior is unverified. Erez marked Done.
- **GEN-107 (stray empty advancedFilter on GEN-78 view) — Done (Erez).** Could not be done via API (no way to read a view's filter, and the only write primitive is all-or-nothing CLEAR FILTER, which would wipe the needed relation filter the DSL can't rebuild). On inspection the GEN-78 "All Tasks" view was already clean — only two populated filters, no empty group. Nothing to remove. Erez marked Done.
- **GEN-118 (manual per-page sub-item re-point) — In Progress.** Decided to fix lazily (option 3): no upfront pass; rely on native Sub-items ▸ expand-arrows, and re-point a page's filter only when its body table is found empty. Decision recorded as a comment on the ticket; assignee stays Erez.
- **Project renamed → "Improve AI Infra".** Renamed mid-session (likely by a concurrent session) from "Improving Claude and Cursor"; local CLAUDE.md/.cursorrules/README and the GitHub URL (`improve-ai-infra`) all updated. The global CLAUDE.md projects table was already updated to match by that session.

### Confirmed limitations (this session)
- The Notion API/MCP cannot **read** a view's filter configuration (no get-view; `fetch` rejects `view://` URLs; a page fetch doesn't surface embedded-view filters). This extends the known "API/DSL cannot *edit* relation filters" limitation — it cannot even inspect them, so broken-filter pages can't be auto-detected.

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
