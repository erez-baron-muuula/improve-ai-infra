# Effort × Model Reference

**Purpose:** Lookup data for choosing a reasoning effort level (`low` / `medium` / `high` / `xhigh` / `max`) given the current model and the kind of work a request calls for. Consumed by the effort-nudge mechanism (and by Claude directly) to decide when to suggest changing effort.

**Last updated:** 2026-08-16

**Refresh when:**
- A new model ships to prod → add it to the tier ranking (Part 2), and add its per-effort row to Part 3 if CursorBench publishes one.
- CursorBench publishes a new version → the numbers in Part 3 are stale; re-pull from cursor.com/evals and update the version tag.
- The model floor or tier ranking changes → also update the inlined tier list in `~/.claude/hooks/stop-foryou-nudge.js`, the floor pointer in `~/.claude/skills/vet-code/SKILL.md`, and the tag rule in the global `CLAUDE.md`. (These consume the floor below; a `/wrap` or SessionStart drift check compares the hook's inlined list against this file's "Last updated" line.)

---

## Part 1 — Stable effort principles (model-independent)

These are Anthropic's published, qualitative effort guidance. They do **not** change per model release — only the model tier list (Part 2) does.

| Kind of work | Effort |
|---|---|
| Coding / agentic / tool-heavy | `xhigh` |
| Intelligence-sensitive: design, architecture, hard reasoning, trade-off analysis | `high` (minimum) |
| Simple / mechanical / latency-sensitive: transcription, formatting, straightforward edits, lookups | `low` |
| Correctness matters more than cost/latency | `max` |

`medium` is the step-down for well-specified work that doesn't need the full reasoning band but is more than trivial (e.g. authoring from a settled spec).

Source: Anthropic effort docs (platform.claude.com/docs/en/build-with-claude/effort) and the claude-api skill's Thinking & Effort guidance. Anthropic's own advice is to *measure on your own evals* — these are starting points, not fixed verdicts.

---

## Part 2 — Model capability tier ranking

Strongest → weakest, current models:

**Fable 5  >  Opus 5  >  Opus 4.8  >  Sonnet 5  >  Haiku 4.5**

(On coding specifically, Opus 5 is effectively at Fable 5's level — within ~0.5 pt at every effort level per Part 3 — at half the cost per task. Opus 4.8 is the prior-generation Opus, superseded as the default by Opus 5 on 2026-07-30 but retained here as the floor anchor below.)

**Model floor (Erez's bar): Opus 4.8.** At or above it (Opus 4.8, Opus 5, Fable 5) = acceptable — use as-is. Below it (Sonnet 5, Haiku 4.5) = flag and recommend going higher. This line is the single source of truth for the floor; its consumers (the weak-model nudge in `stop-foryou-nudge.js`, `/vet-code`'s model check, the global `CLAUDE.md` tag rule) must be kept in sync per "Refresh when" above. The floor is a set/rank membership test, not a cross-family capability claim — a model not listed here is treated as unconfirmed (surface it, don't silently pass or auto-nudge).

Rule of thumb: **a stronger model can often drop one effort level for the same work** and hold quality. (E.g. work that wants `high` on Sonnet 5 may be fine at `medium` on Opus 5.) Combine this with Part 1: pick the effort the *work* needs, then adjust down if the current model is strong.

---

## Part 3 — CursorBench coding anchor (concrete per-effort numbers)

Real published scores showing how one model's score moves across effort levels — the only sourced per-effort numeric data found for the current Claude models.

**Benchmark:** CursorBench 3.2 (agentic coding)
**Source:** cursor.com/evals
**Scope caveat:** Coding/agentic tasks only, single source, version-pinned. Does **not** tell you the right effort for design, writing, or general reasoning — use Part 1 for those. Directional, not authoritative.

Score by effort level:

| Model | low | medium | high | xhigh | max |
|---|---|---|---|---|---|
| Opus 5 | 62.8% | 64.3% | 66.7% | 69.3% | 70.0% |
| Sonnet 5 | 47.7% | 52.4% | 56.9% | 58.7% | 61.5% |
| Fable 5 | 62.1% | 65.2% | 66.5% | 68.4% | 70.5% |

**Reading it:** the gains are largest at the top end (`xhigh` → `max`) and on the weaker model (Sonnet 5 spreads ~14 pts low→max; Fable 5 only ~8 pts). For well-specified coding work, `medium`/`high` is often close to `xhigh`; the `max` premium pays off mainly on genuinely hard tasks. Consistent with Part 1's "xhigh for coding, but measure."
