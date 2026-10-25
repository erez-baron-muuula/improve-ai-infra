# Cause map of open tickets — 2026-10-25

**Scope.** 455 open tickets: 413 in the AI project plus 42 with no project. The 31 Memory Islands game tickets were left out. Every ticket body was read, except GEN-58 and GEN-467, which were too large and were placed from their title and related notes.

**How tickets were placed.** Each ticket went into the first group that fits it. Groups A–C come first, so their counts include some tickets that also fit a later group. Grouping is a judgment call.

**"Maybe done".** 77 tickets look already fixed and are waiting for a check. That figure comes from the reading pass and is not verified. These tickets stay in their groups.

**Nothing is dropped.** No fix below closes a ticket unless its own problem is tested and solved. Any close or retire, such as tickets made moot by dropping Cursor, needs your OK ticket by ticket.

**Estimates.** "Resolves" is my rough estimate of how many tickets in the group the one fix would solve directly. The rest of each group still needs work ticket by ticket. Size is in working sessions.

| # | Group | Tickets | Fix | Resolves (est.) | Size |
|---|---|---|---|---|---|
| A | Claude states or acts on things it hasn't checked | 62 | Extend the live end-of-turn checker (the grounding flag from GEN-716) to the exact checks a program can do: ticket number vs its link, date vs weekday, a stated count vs its list. The older text-matching claim checker was retired on 2026-09-10 because it can't judge meaning, so judgment slips stay outside this fix. | ~10 | 1 |
| B | Claude doesn't apply a rule it already has, at the moment it matters | 73 | Move each such rule out of the every-session file to the moment it applies: a step in the skill that runs then, or a note injected when that tool is used. This is a method rather than one fix, and the record is mixed: notes are advisory and get ignored (GEN-388, GEN-422), a rule can be moved somewhere that isn't loaded when needed (GEN-581), and injected notes are capped at 10,000 characters (GEN-825). | ~30 | many, 1 per rule cluster |
| C | Rule files grow, overlap, contradict, go stale | 52 | Finish the rules-file trim already in progress (GEN-674) toward Anthropic's guidance of under 200 lines per file ([source](https://code.claude.com/docs/en/memory): longer files "reduce adherence"). Every rule removed is moved or pointed to, never deleted. Then run the size check built under GEN-886 automatically (GEN-890, not yet built). | ~12; the rest are single wording fixes | 2–3 |
| D | Our own safety checks guess from command text | 27 | Check the real target instead of guessing from the words in the command: the actual file path for file edits, and one shared command reader for shell commands. When unsure, ask instead of block. Claude Code's built-in OS-level sandbox would do this natively but doesn't run on native Windows ([source](https://code.claude.com/docs/en/sandboxing)). | ~20 | 2–3 |
| D2 | Claude Code's own auto-mode safety reviewer misjudges sanctioned steps | 6 | Add narrow allow rules for our documented steps. This is Anthropic's component, so we can't fix it at the root. | ~4 | <1 |
| E | Our safety checks fail silently when they break | 32 | Make blocking checks block on a crash, but always with a recovery path you can use, because GEN-389 and GEN-390 record lock-outs. Add one daily "still alive" check that warns when a watch or scheduled check didn't report. | ~22 | 1–2 |
| F | The same logic or text kept in two places drifts apart | 21 | One shared module for the vetting and pass code and one source for shared ids, then delete the copies. | ~17 | 2 |
| G | The review-and-vetting process itself has gaps | 29 | One simpler vetting flow: lock in the exact content that was reviewed, re-check the live file just before installing, and install in one step. | ~18 | 2 |
| H | Sessions running at the same time step on each other | 12 | Build on GEN-615 and GEN-620 (In Progress): a "who is working here" marker per folder, plus safe one-step writes for the overwrite cases (GEN-622, GEN-623). | ~8 | 1–2 |
| I | Ticket and session bookkeeping | 47 | Add a short "do next" list on top of the existing priority fields (not replacing them), an automatic reminder for any dated follow-up, and a monthly list of tickets waiting for a check, put to you for closing. | ~18 | 1–2 |
| J | Accounts, browser and PC control | 21 | Many trace to switching Claude accounts on this PC. Using one account here is your decision; the rest are single fixes. | ~8 | your decision, then 1 |
| K | Backups, secrets, cleanup, files left behind | 24 | Back up whole folders by rule instead of a hand-kept list. Let the cleanup sweep act only on an approved list of file types; GEN-551 shows the risk of deleting the wrong thing. | ~12 | 1–2 |
| L | Reaching Claude from the cloud, Slack or another machine | 11 | No single fix. It starts with your decision on whether remote use is needed now. | 0 until decided | — |
| M | Business: invoices | 21 | 15 are fixed and waiting for a real invoice to confirm. For the rest, one per-vendor facts list (auto-charge, payroll) for the reader to use. | ~18 | 1 |
| N | Business: documentation, game, dev team | 17 | No shared cause; each is its own task. | 0 | — |

**Totals.** 455 tickets in 15 groups. Shared fixes would resolve roughly 200. The other ~250 stay as individual work, made smaller by the shared fixes.

**First-group options:**
- **D + E, our safety checks (59 tickets, ~42 resolved, 3–5 sessions).** Concrete, and each fix can be tested. It also stops one of the main sources of new tickets, which is our checks breaking or misfiring.
- **C, rule files (52, ~12 resolved directly, 2–3 sessions).** Already under way. It helps A and B indirectly by making the remaining rules more likely to be followed.
- **The "maybe done" check (77 tickets, 1 session).** Fastest visible shrink, but it fixes nothing new.
