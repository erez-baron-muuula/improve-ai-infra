# GEN-702 — RESUME BRIEF (Item 2 of the post-GEN-508 batch)

**Status: ACTIVE / not started.** Batch A (items 1 & 3 — autonomous `/vet-ticket` invocation + trimmed card) shipped and verified 2026-08-17. This doc is the self-contained handoff so a post-`/compact` session can continue Item 2 with **no re-explanation needed**. Read it in full before acting.

## The goal (plain terms)
Make `/wrap` file its captured tickets **automatically**, instead of hard-blocking. Right now `/wrap` Step 1 (unresolved-item capture) and Step 3c (self-audit detector-review ticket) call `notion-create-pages` / `notion-update-page` **directly and silently**, but the GEN-508 ticket-quality gate hard-blocks any Team-Tasks write with no minted pass (`no-pass`, unbreakable). So every wrap-time filing blocks and has to be done by a manual `/vet-ticket` run. This is the "GEN-702 conflict."

## Verified root cause (grounded, 2026-08-17)
- `~/.claude/skills/wrap/SKILL.md` Step 1 (lines ~18–34) and Step 3c file via `notion-create-pages` directly; the file contains **no `/vet-ticket` reference for filing** (only Step 3d's read-only marker-liveness probe).
- `~/.claude/hooks/auto-approve.js` `enforceTicketVetting` gates the four Notion MCP tools with **no `/wrap`-aware exemption**; missing pass → `no-pass`, and break-glass does NOT clear `no-pass` (content decision, unbreakable).
- Recorded live in `HISTORY.md` (2026-08-17 (2) entry): wrap Step 1 auto-capture was blocked, filed manually via `/vet-ticket` at Erez's direction.

## The converged design (already decided — do NOT re-litigate)
Source of truth: `notes/gen508-piece1/design-converged.md` §11 ("Callers that already write to Team-Tasks", ~lines 1942–1974) and §12 deliverable 10 + its fork resolution (~lines 1986–2017). Summary:
- Rewrite `/wrap` Steps 1 and 3c so that, **per captured item**, they run the vet-ticket machinery: draft payload → `node auto-approve.js --ticket-hash` → spawn **one** independent `check-reviewer` → mint the single-use ticket pass → apply → verify.
- **UNATTENDED — no Erez-facing card** (the whole point is that `/wrap` runs without stopping; Steps 1 & 3c carry a standing override exempting them from the draft-for-approval pause).
- Tag each filing `--source wrap-step1` / `--source wrap-step3c` for the §10 slice monitor (**monitoring only — NOT a gate bypass**; the hook still keys on tool + payload marker + pass).
- Rationale for keeping the reviewer (not a blanket `source==wrap` hook exemption): an auto-filed hollow ticket is useless later; the independent reviewer against the ticket bar is the one check that still adds value with no human watching, and it preserves the gate's "never self-certify" integrity. Cost is bounded (a handful of items per wrap, one reviewer each).

## Decisions locked THIS session (2026-08-17) — not in the design doc
- **Reviewer model: stays on Sonnet.** Erez's explicit call. No model/effort override, including on the unattended `/wrap` path. He accepts Sonnet is the sole competence check on auto-filed captures. (`agents/check-reviewer.md` pins `model: sonnet`.)
- **Build effort: xhigh.** Model Opus 4.8 is at/above Erez's floor → no model change recommended.
- **Execution path:** this is a skill edit to `~/.claude/skills/wrap/SKILL.md` → go through `/vet-rule` (run `/check` to convergence, mint the single-use check pass, apply, verify). The shared pass/record machinery lives in `~/.claude/skills/vet-ticket/SKILL.md` — **reference it, don't fork it** (per vet-ticket's own "port to siblings" note).
- Best done as its **own dedicated session** (this is why we're compacting).

## Files
- Edit: `~/.claude/skills/wrap/SKILL.md` — Steps 1 and 3c.
- Depends on / read first: `~/.claude/skills/vet-ticket/SKILL.md` (the machinery + its Step 1–8 flow), `~/.claude/hooks/auto-approve.js` (`enforceTicketVetting`, the `--ticket-hash` CLI, `TICKET_PASS_KEYS`), `notes/gen508-piece1/design-converged.md` §11/§12, `notes/gen508-piece1/README.md` (piece-3 follow-ups incl. the unread `ticket-gate-events.jsonl` and the deferred `/wrap` aggregate).
- Plan of record: `C:\Users\Erez\.claude\plans\now-the-508-is-velvety-iverson.md` (Item 2 section).

## First actions on resume
1. Confirm GEN-702's live Notion status + re-read its body; if it describes a superseded approach, update title/body to reality; set it **In Progress** (primary ticket).
2. Re-read `design-converged.md` §11/§12 and `wrap/SKILL.md` Steps 1 + 3c.
3. Draft the exact Step 1 + Step 3c rewrite (unattended reviewer flow, `--source` tags, no card).
4. Run it through `/check` to convergence, then `/vet-rule` to apply (mint check pass, byte-exact apply, verify).

## Acceptance criteria (how we know it works)
Run `/wrap` (or a dry-run of Step 1): captures file through the gate with **no hard-block and no card**, leaving `wrap-step1` / `wrap-step3c`-tagged `approve` rows in `~/.claude-staging/ticket-gate-events.jsonl`; each created ticket re-fetched to confirm body + key properties landed.

## Open considerations to weigh during design
- The N-reviewer-per-wrap cost (bounded; note it in `/wrap`'s report if it ever grows).
- Step 3c's detector-review ticket routes through the same unattended flow.
- The `ticket-gate-events.jsonl` reader / `/wrap` aggregate is a deferred "piece 3" — check whether it should be folded in or kept separate.
