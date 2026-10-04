# Effort × Model Reference

**Purpose:** Lookup data for choosing a reasoning effort level (`low` / `medium` / `high` / `xhigh` / `max`) given the current model and the kind of work a request calls for. Consumed by the effort-nudge mechanism (and by Claude directly) to decide when to suggest changing effort.

**Last updated:** 2026-10-04

**Refresh when:**
- A new model ships to prod → add it to Part 2 in ALL THREE places — the tier line, and the matching list ("At or above it" or "Below it") on EACH of the two Model floor lines, strong and standard (a model missing from any of them still classifies as unlisted there) — and add its per-effort row to Part 3 if CursorBench publishes one. `/wrap` Step 3f flags a session model that isn't listed yet.
- CursorBench publishes a new version → the numbers in Part 3 are stale; re-pull from cursor.com/evals and update the version tag.
- The model floors or tier ranking change → edit Part 2 only; nothing else keeps a copy. The end-of-turn hook `~/.claude/hooks/stop-foryou-nudge.js` reads Part 2 live, and `/vet-code` (Steps 0, 3, 6) and `/wrap` (Step 3f) classify models through that hook's CLI (`--classify`, `--agent-transcript`, `--selftest`). **The tier line (the wholly bold line with `>` / `?` separators) and the Model floor lines' "At or above it (...)" / "Below it (...)" lists are machine-read** — keep their format (`<Name> <major>[.<minor>]` names, comma-separated; the strong line FIRST) or change it only together with the hook; `/wrap` Step 3f reports the list as unreadable or its lines as off if they break. If a floor moves, also check the tag rule in the global `CLAUDE.md` still reads right.

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

**Fable 5.1  >  Fable 5  ?  Opus 5.5  >  Sonnet 5.5  ?  Opus 5  >  Opus 4.8  >  Sonnet 5  >  Haiku 4.5**

(Fable 5.1 and Opus 5.5 added 2026-09-24; Sonnet 5.5 added 2026-10-04. Within-family order is by version. Opus 5.5 vs Fable 5 / Fable 5.1 has no general sourced comparison; on coding only, CursorBench 4.0 (Part 3) puts Opus 5.5 above Fable 5.1 at every effort level. Sonnet 5.5's position is **effort-dependent**: at high effort and above it beats Opus 5 and Opus 4.8 on coding and knowledge work; at medium it is below both (see the floor note below). The tier line feeds only the effort-guidance sentence — the Model floor lines below, not tier order, decide whether a model is acceptable.)

(Opus 4.8 is the prior-generation Opus, superseded as the default by Opus 5 on 2026-07-30 but retained as the strong floor's anchor.)

**Model floors — minimum model by kind of work (Erez's decision, 2026-10-04: "The minimum should be determined by the type of work that is needed").** Use the floor that matches the kind of work a path needs (the same Part 1 kinds that set its effort):

**Model floor — strong (judgment, correctness-critical): Opus 4.8.** At or above it (Opus 4.8, Opus 5, Opus 5.5, Fable 5, Fable 5.1). Below it (Sonnet 5.5, Sonnet 5, Haiku 4.5).

**Model floor — standard (coding, well-specified authoring; at high effort or above): Sonnet 5.5.** At or above it (Sonnet 5.5, Opus 4.8, Opus 5, Opus 5.5, Fable 5, Fable 5.1). Below it (Sonnet 5, Haiku 4.5).

- **Strong** applies to judgment work (design, architecture, rules, trade-offs, hard reasoning) and to anything correctness-critical — including `/vet-code` safety reviews, and coding or writing where a miss is costly.
- **Standard** applies to coding / agentic / tool-heavy work and well-specified authoring, **only when the path runs at high effort or above**; at a lower effort the strong floor applies.
- **Mechanical** work (lookups, formatting, straightforward edits) has no minimum — any model.
- A mixed or unclear path gets the strong floor. When it's unclear what a session will involve, start it on a strong-floor model.
- **Honest ceiling:** which kind a path is — and so which floor applies — is Claude's own judgment, the same judgment that sets its effort; no hook can verify it, and the hook cannot see the session's actual effort setting. So outside `/vet-code` this is advisory. `/vet-code` is mechanically fixed to the strong floor.

These lines are the single source of truth for the floors; their consumers (the model-tag directive in `stop-foryou-nudge.js`, `/vet-code`'s model check, the global `CLAUDE.md` tag rule) must be kept in sync per "Refresh when" above. Each floor is a set membership test, not a capability ranking — a model not listed on a line is treated as unconfirmed for it (surface it, don't silently pass or auto-nudge), with one exception Erez approved on 2026-09-24: an unlisted point release in the same line and major version as a listed at-or-above model, at or above that model's version (e.g. Opus 5.7 while Opus 5 and 5.5 are listed), counts as at or above — unless that model line also has an entry below that floor — and `/wrap` Step 3f flags it for adding here.

**Why these floors (evidence, 2026-10-04):**
- [Artificial Analysis, Sonnet 5.5 (high) vs Opus 4.8 (max)](https://artificialanalysis.ai/models/comparisons/claude-sonnet-5-5-high-vs-claude-opus-4-8): Intelligence Index 47 vs 42; GDPval-AA (real-world knowledge work) 1551 vs 1456; AA-Briefcase 1639 vs 1321; Terminal-Bench 4.0 44% vs 22% — but Humanity's Last Exam (hard reasoning) 46% vs 49%. → Sonnet 5.5 at high clears Opus 4.8 for coding/writing, not for hard judgment.
- [Artificial Analysis, Sonnet 5.5 (medium)](https://artificialanalysis.ai/models/comparisons/claude-sonnet-5-5-medium-vs-claude-opus-5-5-high): Index 41 — below Opus 4.8 max's 42 (cross-page comparison of the same index). Claude Code runs Sonnet 5.5 at medium by default ([Anthropic](https://www.anthropic.com/claude-sonnet-5-5)). → the "high effort or above" condition.
- CursorBench 4.0 (Part 3): Sonnet 5.5 beats Opus 5 at high/xhigh/max, trails it at low/medium.
- Anthropic: Opus 5.5 "remains clearly stronger at complex, open-ended work requiring sustained judgment" ([launch page](https://www.anthropic.com/claude-sonnet-5-5)).
- Toolathlon (Sonnet 5.5 system card, Table 8.14.5.A) — the card's only test including Opus 4.8 — is saturated: it also ranks Opus 5.5 and Fable 5.1 below Opus 4.8 (77.8 vs 79.9), so it cannot separate these models and is not used.
- Anthropic's "beats Opus 5.5 at coding" headline rests on Terminal-Bench 4.0 alone (Sonnet 5.5 70.6% at max vs Opus 5.5 66.4% at xhigh — effort-mismatched). Opus 5.5 leads SWE-Bench Pro (89.9 vs 81.3), FrontierCode (54.4 vs 52.1 at xhigh) and CursorBench 4.0.
- Claude Mythos 5.1 appears in Anthropic's system card and pricing notes but not in the public model lineup ([models overview](https://platform.claude.com/docs/en/about-claude/models/overview), checked 2026-10-04), so it is not listed.

Rule of thumb: **a stronger model can often drop one effort level for the same work** and hold quality. (E.g. work that wants `high` on Sonnet 5 may be fine at `medium` on Opus 5.) Combine this with Part 1: pick the effort the *work* needs, then adjust down if the current model is strong.

---

## Part 3 — CursorBench coding anchor (concrete per-effort numbers)

Real published scores showing how one model's score moves across effort levels — the only sourced per-effort numeric data found for the current Claude models.

**Benchmark:** CursorBench 4.0 (agentic coding; launched 2026-09-10; pulled 2026-10-04)
**Source:** cursor.com/evals
**Scope caveat:** Coding/agentic tasks only, single source, version-pinned. Does **not** tell you the right effort for design, writing, or general reasoning — use Part 1 for those. Directional, not authoritative. Not comparable with the earlier CursorBench 3.2 numbers.

Score by effort level (cost per task in brackets):

| Model | low | medium | high | xhigh | max |
|---|---|---|---|---|---|
| Opus 5.5 | 43.7% ($1.17) | 52.5% ($2.91) | 56.0% ($3.97) | 56.0% ($6.98) | 57.8% ($13.43) |
| Sonnet 5.5 | 35.8% ($0.50) | 39.2% ($0.70) | 47.8% ($1.67) | 53.1% ($3.88) | 55.5% ($9.67) |
| Fable 5.1 | 45.1% ($5.44) | 46.8% ($7.05) | 49.2% ($9.08) | 51.6% ($13.01) | 51.8% ($17.28) |
| Opus 5 | 40.7% ($4.87) | 43.3% ($6.94) | 44.7% ($9.00) | 46.1% ($11.43) | 46.6% ($11.95) |
| Sonnet 5 | 24.1% ($1.39) | 28.0% ($2.31) | 30.8% ($3.48) | 32.0% ($4.55) | 34.1% ($7.17) |

**Reading it:** Opus 5.5 leads at every effort level, and plateaus from `high` (56.0% at both `high` and `xhigh`). Sonnet 5.5 is the most effort-sensitive (~20 pts low→max): weak at `low`/`medium`, close to Opus 5.5 at `xhigh`/`max`, and at `high`/`xhigh` it costs well under Opus 5.5 for the same effort. The `max` premium is small for every model here.
