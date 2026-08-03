# GEN-508 piece 1 — build artifacts (paused 2026-08-02)

Working copies from the session that built the Notion half of the ticket-quality gate. **Nothing
here is installed** — the live `~/.claude/hooks/auto-approve.js` is untouched.

The authoritative handoff, including why this stopped and what to do next, is in the
**"BUILD STATE 2026-08-02"** section of
[GEN-508](https://app.notion.com/p/3a36e495d07c81fb9a55ddc315639c7f). Read that first; this folder
is just the artifacts it refers to.

| File | What it is |
|------|-----------|
| `design-scoping-v3.md` | **Read this second, after the ticket.** The rebuilt scoping layer, converged through three more `/check` rounds (2026-08-03). Supersedes five sections of `design-converged.md` and carries two build-time sync obligations — including one against `vet-ticket-SKILL.md` that a builder must not miss. |
| `auto-approve.working.js` | Full working copy of the hook with the `enforceTicketVetting` arm added (342 lines, purely additive). Passes `node --check`. Its scoping layer is what `design-scoping-v3.md` replaces — **not yet rebuilt**. |
| `gen508-hook.diff` | The same change as a unified diff against the live hook, for review. |
| `vet-ticket-SKILL.md` | Working copy of the new `/vet-ticket` skill (not yet installed at `~/.claude/skills/vet-ticket/`). Its Step 4 hash formula is out of date — see `design-scoping-v3.md` §5. |
| `design-converged.md` | The design as it converged through three `/check` rounds, plus every revision the review rounds forced. Still governs everything `design-scoping-v3.md` does not supersede. |

Do not copy `auto-approve.working.js` over the live hook. It is locked config: any install goes
through `/vet-code`, and this copy has five known open findings recorded on the ticket.
