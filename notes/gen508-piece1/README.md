# GEN-508 piece 1 — build artifacts (paused 2026-08-02)

Working copies from the session that built the Notion half of the ticket-quality gate. **Nothing
here is installed** — the live `~/.claude/hooks/auto-approve.js` is untouched.

The authoritative handoff, including why this stopped and what to do next, is in the
**"BUILD STATE 2026-08-02"** section of
[GEN-508](https://app.notion.com/p/3a36e495d07c81fb9a55ddc315639c7f). Read that first; this folder
is just the artifacts it refers to.

| File | What it is |
|------|-----------|
| `auto-approve.working.js` | Full working copy of the hook with the `enforceTicketVetting` arm added (342 lines, purely additive). Passes `node --check`. Its scoping layer is what needs the rebuild. |
| `gen508-hook.diff` | The same change as a unified diff against the live hook, for review. |
| `vet-ticket-SKILL.md` | Working copy of the new `/vet-ticket` skill (not yet installed at `~/.claude/skills/vet-ticket/`). |
| `design-converged.md` | The design as it converged through three `/check` rounds, plus every revision the review rounds forced. Still accurate except for the scoping layer. |

Do not copy `auto-approve.working.js` over the live hook. It is locked config: any install goes
through `/vet-code`, and this copy has five known open findings recorded on the ticket.
