# /doctor prompt-audit report, Invoice Automation folder (Claude Code 2.1.299, run 2026-10-18)

Source transcript: C--Users-Erez-AI-Projects-InvoiceAutomation/442893f7-4fe1-4948-a39c-166cef573699.jsonl

Backup notices first:
- **Backup sweep:** Memory Islands Dev was not pushed to GitHub on 2026-10-18 09:29. The sweep ran out of time before it reached that repo. The work is safe locally, and the next sweep will retry.
- **Session backup to Drive:** no copy has succeeded since 2026-10-15 20:05 UTC, but sessions changed after that, most recently 2026-10-18 05:45 UTC. Run log: `~/.claude/session-backup-state/runs.log`.
- **Session backup is slow:** each of the last 3 copies took over 10 s (the latest took 22 s), which delays the first reply in each session.

Starting the audit.

---

Inventory almost done; now reading the files themselves.

---

Reading ~380 KB of skill files. I'm splitting them across three parallel readers while I audit the two CLAUDE.md files myself.

---

The first of three readers is back. I'm checking its results and auditing the global `~/.claude/CLAUDE.md` while the other two finish.

---

Still running. I've audited both CLAUDE.md files, and the first batch of skills is back and checked. I'm waiting on the readers for the `vet-*` skills and the remaining skills before I put the report together.

---

---
📌 **For you**

You ran `/doctor prompt-audit`. The audit of your Claude setup files for outdated instructions is still in progress. Two readers are still going through the larger skill files, and the full report and proposed edits will follow once they finish. Nothing has been edited.

Separately, there are three backup warnings from session start:
- **GitHub backup:** Memory Islands Dev was not pushed to GitHub on 2026-10-18 at 09:29. The backup run ran out of time before it reached that project. The work is safe on this PC, and the next run will retry automatically.
- **Session backup to Drive:** no copy has succeeded since 2026-10-15 20:05 UTC, but sessions changed after that. Recent sessions may be missing from the Drive backup. The run log is `~/.claude/session-backup-state/runs.log`.
- **Slow session backup:** each of the last three copies took over 10 seconds (the latest took 22). The first reply in every new session waits for it.

---

The second reader is back, and I've checked its main finding (the three vet-* skills disagree on whether the approval step asks you for confirmation). Still waiting on the last reader, which covers the remaining skills.

---

Still waiting on the last reader.

---

The audit is done and nothing has been edited. It found 11 high-confidence and 17 medium-confidence findings, plus a set of low-confidence notes that need no edit. The full report and proposed edits are in `C:\Users\Erez\AppData\Local\Temp\claude\C--Users-Erez-AI-Projects-InvoiceAutomation\442893f7-4fe1-4948-a39c-166cef573699\scratchpad\prompt-audit-2026-10-18.md`.

**Most important findings:**
- **`shell-howto` is never prompted to load.** A typo-level formatting error (an invalid `\$` escape) in its description stops the "load before writing shell commands" trigger from ever reaching me. This session's own skill list shows only its heading.
- **The three `vet-*` safety skills disagree on a safety point.** `vet-rule` and `vet-code` say the final approval write pops a prompt for you, and that prompt is the human check. `vet-ticket` says that in your current permission mode no prompt appears. I flagged this for you to decide rather than proposing an edit.
- **Instructions that no longer match reality:**
  - The project `CLAUDE.md` lists 6 Hebrew search words; the code (`Code.js:522`) has 13.
  - The project `CLAUDE.md` says the Hebrew searches run "without parentheses"; the code adds them.
  - `notion-ticket-lookup` sends a stale pin straight to "ask Erez", skipping the REST lookup.
  - `check` contradicts itself on how many reviewers to run.
  - `config-health` has a wrong session-folder path and two different definitions of "changed".
- **The global "Default to silence on success" rule makes me go quiet during long work.** It pairs with a "one update per 10 tool calls" limit. In this session the system had to prompt me three times that you hadn't heard from me. The proposed edit replaces it with "a short line at each new phase or change of plan".

Most of the rest is past-history notes and "this used to be different" wording inside the `vet-*` skills and both `CLAUDE.md` files. On a model that follows instructions literally, that wording points at rules that no longer exist.

Every proposed edit except the six project `CLAUDE.md` hunks (7, 8, 31–34) is to a file under `~/.claude`, so it affects all projects.

---

---
📌 **For you**

You ran `/doctor prompt-audit`. It checked your Claude instruction files for wording that is out of date for the current model or no longer matches reality. The audit is done and nothing has been changed. It found 11 serious issues and 17 moderate ones. The full report with proposed wording is at `C:\Users\Erez\AppData\Local\Temp\claude\C--Users-Erez-AI-Projects-InvoiceAutomation\442893f7-4fe1-4948-a39c-166cef573699\scratchpad\prompt-audit-2026-10-18.md`. Apart from six edits to this project's own `CLAUDE.md`, every change is to your shared Claude setup, so it would affect all projects.

**Biggest findings, in plain terms:**
- **One how-to guide never triggers.** The guide for writing shell commands has a small formatting error. As a result, the note telling me when to use it never loads.
- **Your three safety checklists disagree with each other.** These are the checklists for changing rules, code and Notion tickets. Two say that a pop-up asks for your approval just before a protected file is unlocked, and that this pop-up is the human check. The third says that in your current permission mode no pop-up appears.
- **Several instructions describe things that have since changed.** For example:
  - This project's notes list 6 Hebrew search words, but the code uses 13.
  - The ticket-lookup guide skips a lookup step.
  - The review checklist contradicts itself on how many reviewers to run.
- **The "stay silent unless something goes wrong" rule makes me go quiet during long work.** Today you got three automatic "haven't heard from you" nudges. The proposed fix is a short line whenever I start a new stage or change plan.

**First decision — the safety-checklist disagreement:** when one of these protected files is about to be unlocked, does a pop-up actually appear asking for your OK?
- **If no pop-up appears:** I'd rewrite the other two checklists so I must get your explicit "yes" in chat before unlocking. That is safer, and it costs one extra confirmation message from you each time.
- **If a pop-up does appear:** I'd correct the third checklist to match. Nothing extra is needed from you.

Settling this is about 10 minutes of checking and two small edits (medium, Opus 5.5 — unconfirmed).

---

# Full report (copied from that session scratchpad)

# Prompt audit — 2026-10-18

## Assumptions (Step 0)
- **Scope:** Claude Code instruction files that load in the InvoiceAutomation project:
  - project `CLAUDE.md`
  - `~/.claude/CLAUDE.md`
  - `~/.claude/skills/*/SKILL.md` (with `notion-ticket-lookup/SECURE-LOOKUP-DESIGN.md`)
  - `~/.claude/commands/loghistory.md`
  - `~/.claude/agents/check-reviewer.md`
- **Files that don't exist:** `CLAUDE.local.md`, `AGENTS.md`, `.claude/CLAUDE.md`, ancestor-directory `CLAUDE.md` files, `~/.claude/rules/`, `~/.claude/output-styles/`, and a managed-policy `CLAUDE.md` (`C:\Program Files\ClaudeCode\` is absent). No `@imports`.
- **Report-only:** the Anthropic-synced skills under `~/.claude/skills/synced/`. `~/.claude/plugins/synced/` holds only marker files, with no plugin skills, commands or agents.
- **Not read:** settings files, `.mcp.json`, `~/.claude.json`, and `~/.claude/hooks/refs/*` (hook-injected, outside the requested scope). Paths on `G:\` were not probed.
- **Every edit under `~/.claude/` affects ALL projects.** Nothing has been applied.
- **Target model:** Claude Opus 5.5 (this session). No skill or agent pins a versioned model; `model: sonnet` is a family alias.
- **Other provider:** the app itself (`Code.js`) calls Gemini. It is not Claude-API code, so it is out of scope (Group 4 n/a).

## Summary
- **The `shell-howto` skill's description does not load.** The YAML contains an invalid `\$` escape. This session's skill list shows only the file's H1, so the "load before writing shell commands" trigger never reaches the model.
- **The three `vet-*` safety skills disagree on a safety point.** vet-rule and vet-code say the pass-mint write "prompts Erez — that prompt IS the gate". vet-ticket says that under bypassPermissions mode the write "falls through silently" and is no gate. This is flagged for Erez to decide, with no edit proposed.
- **Facts that have gone stale against the repository:**
  - The project `CLAUDE.md` Hebrew-keyword list has 6 words; `Code.js:522` has 13.
  - The project `CLAUDE.md` says "without parentheses"; the code uses `subject:(…)`.
  - `notion-ticket-lookup` sends a stale pin to the wrong step.
  - The `check` skill contradicts itself on panel size.
  - `config-health` has a wrong scratchpad-path template and two definitions of auto-scope.
- **The global "Default to silence on success" rule is a dated update suppressor.** It is paired with a fixed "one heartbeat per 10 tool calls" cadence. In this session the harness injected "the user hasn't heard from you in a while" three times.

**Counts:** Group 1 — 6. Group 2 — 34. Group 3 — 0 (skill descriptions are counted under Group 2). Group 4 — not applicable.

---

## Findings — HIGH confidence

| # | Location | Evidence | Pattern | Why | Action |
|---|---|---|---|---|---|
| H1 | `~/.claude/skills/shell-howto/SKILL.md:3` | `"… literal-\$ in -NewText …"` inside a double-quoted YAML string | G2 volatile / trigger text that doesn't resolve | `\$` is not a valid YAML escape, so the description fails and only the H1 shows in the skill list (visible in this session) | rewrite (hunk 1) |
| H2 | `~/.claude/skills/notion-ticket-lookup/SKILL.md:133` | `fall through to step 3 (ask Erez)` | G2 stale fact | Step 3 is now the REST lookup; asking Erez is step 4 (lines 36, 40) | rewrite (hunk 2) |
| H3 | `~/.claude/skills/check/SKILL.md:40` vs `:14`, `:35-37` | `For small/simple proposals a single pre-mortem reviewer may suffice` vs `one depth … no quick/single-pass tier` and lenses marked `ALWAYS` | G2 contradiction (same file) | A literal reader gets opposite rules on panel size. Assumed direction: keep "one depth" | rewrite (hunk 3) |
| H4 | `~/.claude/skills/notion-howto/SKILL.md:8-11` | `…incident classes) remain in the global CLAUDE.md…` | G2 stale fact | The global `CLAUDE.md` now says they live in `hooks/refs/notion.md` (exists) | rewrite (hunk 4) |
| H5 | `~/.claude/skills/config-health/SKILL.md:12` | `(global: since the last config sync; …)` | G2 contradiction (same file) | Line 33 defines it as since the last completed health review (marker), and `wrap/SKILL.md:66` agrees | rewrite (hunk 5) |
| H6 | `~/.claude/skills/config-health/SKILL.md:26` | `` `...\Temp\claude\C--Users-Erez\<session-id>\scratchpad` `` | G2 stale fact | The real path carries the project slug (this session: `C--Users-Erez-AI-Projects-InvoiceAutomation`) | rewrite (hunk 6) |
| H7 | project `CLAUDE.md:159` | `Hebrew keywords: תלוש הארנונה … החשבונית` (6 terms) | G2 stale fact | `Code.js:522` `buildSearchQuery` has 13 terms. A copied list goes stale, as the file itself says at line 60 | rewrite (hunk 7) |
| H8 | project `CLAUDE.md:158` | `separate GmailApp.search() calls without parentheses` | G2 stale fact | `Code.js:531` builds `` subject:(${k}) `` — with parentheses, one query per term | rewrite (hunk 8) |
| H9 | `vet-rule/SKILL.md:13,188,283`; `vet-code/SKILL.md:12,485,627` vs `vet-ticket/SKILL.md:13,557` | `the mint write itself prompts him — that prompt IS the gate` vs `under his bypassPermissions mode it falls through silently` | G2 contradiction between instruction files, on a safety rule | Whichever skill loads decides whether the model believes a human gate exists. There is no git history for `~/.claude`, so the two cannot be ordered | **flag**: Erez decides which is true. If vet-ticket is right, vet-rule and vet-code should require explicit chat approval before the mint write |
| H10 | `vet-ticket/SKILL.md:72-77, 90-91, 415, 578-582, 661-663` | `FIVE fields, not ten … (Corrected 2026-08-05 …)`; `(This replaces an earlier command-name rule…)`; `(realigned 2026-08-05; … GEN-740)`; `(Earlier drafts made the hook…)`; `(Before 2026-08-05 this step…)` | G1d migration-relative / G2 history narrative | Diffs against versions the model never saw. They add nothing to the current rule | rewrite / remove (hunks 9–13) |
| H11 | `vet-code/SKILL.md:205-210, 529-535, 607-609` | `Pass B is now pinned … no longer applies`; `(Note: 'regardless of pass' is NOT accurate…)`; `(This is the narrow remnant of the pre-GEN-435 manual carry…)` | G1d / G2 history | Same as H10 | rewrite / remove (hunks 14–16) |

## Findings — MEDIUM confidence

| # | Location | Evidence | Pattern | Why | Action |
|---|---|---|---|---|---|
| M1 | `~/.claude/CLAUDE.md:79` | `Default to silence on success … After every 10 tool calls … at most one per 10-call stretch` | G1d update suppressor + G1f fixed cadence | On Opus 5.5, "don't narrate" rules cause under-narration (the harness nudged three times this session). A numeric cadence is removed together with the suppressor | rewrite (hunk 17); a CLAUDE.md edit, so it needs `/check` and Erez's OK |
| M2 | `~/.claude/CLAUDE.md:43` | `Rate confidence internally. If not high, re-examine from scratch before responding.` | G1b prose steering thinking depth | Opus 5.5 always thinks; effort controls depth. The live purpose is a quality bar | rewrite (hunk 18); needs `/check` |
| M3 | `~/.claude/skills/wrap/SKILL.md:3` | `Use ONLY when the user explicitly runs /wrap.` | G2 contradiction with the global `CLAUDE.md` ("treat 'end session' / 'wrap up' as a request to run /wrap") | A literal reader may refuse to invoke the skill on "end session" | rewrite (hunk 19); widens the trigger |
| M4 | `~/.claude/skills/wrap/SKILL.md:257` | `` Run `sync.ps1 -Direction From-Claude` `` | G2 wrong degrees of freedom (fragile op, no path) | The full path exists only in project `CLAUDE.md` files, but wrap also runs in sessions with no project | rewrite (hunk 20); G:\ path not verified |
| M5 | `~/.claude/skills/wrap/SKILL.md:50` | long "VOLUNTEERED UNPROMPTED … nor to anything he ENGAGED with …" parenthetical | G1d patch accretion | About six nested exceptions on a judgment call | rewrite (hunk 21) |
| M6 | `vet-rule/SKILL.md:46-55` | `Anything beyond horizontal whitespace … is NOT mechanical` | G2 override that doesn't name the rule it overrides | The global `CLAUDE.md` says spelling and punctuation fixes skip `/check`. vet-rule (stricter, with a reason) never says it overrides that | add (hunk 22); tightens, never loosens |
| M7 | `vet-ticket:63-66, 123, 184-189, 359-361, 544, 592-600`; `vet-code:376-387, 539-541`; "since GEN-641/GEN-462" in `vet-rule:202-203,280,292`, `vet-code:315,520,624,636`; `vet-rule:122-124` + `vet-code:148-150` | history narratives, migration-relative "now / any more / since", a one-time install check | G1d / G2 | As H10 | rewrite (hunks 23–28); change vet-rule and vet-code together |
| M8 | `notion-ticket-lookup/SKILL.md:2-10, 17-21, 30-35, 107-113` | long procedural description; `(verified 2026-06-21 …; supersedes an earlier version…)`; "Enterprise plan" vs "Business plan" | G2 trigger bloat, history, self-inconsistency | The description repeats the body on every request, and the plan names disagree within the file | rewrite (hunk 29) |
| M9 | `notion-ticket-lookup/SECURE-LOOKUP-DESIGN.md:3-25, 124-128` | pending "Build steps"; `The current text … still falls back to "ask Erez"` | G2 stale fact | Already built; SKILL.md documents REST as the primary path | rewrite (hunk 30) |
| M10 | `content-review/SKILL.md:57` | `walk all fourteen checklist items` | G2 volatile count | Line 65 says the list grows | rewrite → `walk every checklist item` |
| M11 | `suggest/SKILL.md:87-88, 94-95` | `Owned here (moved from the former global "…" rule).` | G1d migration-relative | Refers to text the model never saw | rewrite → `Owned here.` |
| M12 | `suggest/SKILL.md:93-95` | `go think harder, don't dismiss it.` | G1b thinking-depth prose | Effort controls depth on Opus 5.5 | rewrite → `If you can't find a strong reason for one, re-examine that option before dismissing it.` |
| M13 | `config-health/SKILL.md:9` | `This is the build of GEN-271.` | G2 history | No behavior | remove |
| M14 | project `CLAUDE.md:137` | `→ accounting/To Pay (unchanged).` | G1d migration-relative | "unchanged" is relative to an earlier rule | rewrite (hunk 31) |
| M15 | project `CLAUDE.md:190` | `` `UrlFetchApp` does support `timeoutSeconds` (default 360 s; verified honored 2026-09-29) … by design (GEN-757) `` | G1d / G2 history | It rebuts an old claim; the dates and IDs are archaeology | rewrite (hunk 32) |
| M16 | project `CLAUDE.md:257` | `…that made \`clasp logs\` miss lines… Supersedes \`clasp logs\` for this project. (GEN-752)` | G1d / G2 history | Same as M15 | rewrite (hunk 33) |
| M17 | project `CLAUDE.md:8, 15` | `GEN-218`, `(GEN-673)` | G2 history | The reason is already stated beside each | remove the IDs (hunk 34) |

## Findings — LOW / flag only (no edit proposed)

- **`~/.claude/CLAUDE.md:67` vs the "default to acting rather than asking" rule (`~/.claude/CLAUDE.md:99`).** Line 67 reads `Break tasks into steps. One step at a time; wait for confirmation before continuing.` The other rule says to do mechanical or authorized work without asking. They are in the same file, with no history to order them. Erez to decide whether line 67 applies only to decision steps.
- **project `CLAUDE.md:13` vs `:14`/`:33`.** Line 13 says "give one next action only — never tell Erez to run both…". Lines 14 and 33 say Claude runs every deploy itself, so line 13 looks like a leftover from when Erez ran deploys. Same file; line 13 is newer (2026-08-05).
- **project `CLAUDE.md:22` vs the global rule "Before writing code … surface every assumption … wait for confirmation".** The project file overrides this for its own directory but doesn't name the rule it overrides. It is outside-project text, so it is flagged only.
- **`~/.claude/CLAUDE.md:25`.** `Concise, direct, truthful.` is a generic-virtue line, but short (keep-list 9/10).
- **History tags (low).** `~/.claude/CLAUDE.md:200` `(GEN-103)`; the many GEN-IDs in wrap step headings (working pointers); the H1 tags in release-review (`GEN-871`) and staging (`GEN-281`).
- **`wrap:165`.** The date anchor is a self-expiring liveness test, so it is kept.
- **`config-health:99` and `agents/check-reviewer.md`.** `model: sonnet` is a family alias, chosen on purpose.
- **`review-design:13`.** "First live run only" may now be dead text. Nothing in the files confirms whether that run has happened.
- **`staging:91`.** Restates lines 86–89; harmless.
- **vet-ticket.** The residual-risk text is stated twice (37–49 / 671–680); "piece 2" is jargon with no ticket ID; Step 7 is numbered out of order (runs before Step 5).
- **`vet-rule:217-219`.** "prescribes exactly that here-string form" overstates the global rule.
- **Synced (Anthropic) skills, report-only.**
  - `docs` has a very long routing description with call-order steps embedded.
  - `pdf` and `skill-creator` have trigger-heavy descriptions, which is acceptable for routing text.
  - No edits are proposed.

**Load-bearing text the readers checked and kept:**
- The exact procedures in `wrap`, `loghistory`, `staging`, `release-review` and the `vet-*` skills (locks, passes, git, credentials).
- Caps lines that state their reasons.
- The `check` verdict template.
- The token-handling prohibitions in `notion-ticket-lookup`.

**Clean files:** `loghistory.md`, `audit-rules`, `approve-ticket`, `document-feature`, `check-reviewer.md`, `release-review` and `staging` (low items only).

---

## Proposed diff (high + medium only; one finding per hunk; NOT applied)

Edits to `~/.claude/` files affect all projects. The global `CLAUDE.md` is locked, so edits go through `update-global-rule.ps1` after `/check` (your own rule). Skill edits go through `/vet-rule`.

**Hunk 1 — `shell-howto/SKILL.md:3` (H1)**
```diff
-description: "Windows PowerShell 5.1 / Bash-tool technical gotchas … literal-\$ in -NewText …"
+description: "Windows PowerShell 5.1 / Bash-tool gotchas and how-to: script and data-file encoding, native-command exit codes, here-string apostrophes, quoting for native exes, matching quoting to the executing shell, verifying through the real integration, backtick escapes in interpolated strings, curl.exe vs the PS alias, the GCM wrong-credential fix, and deleting added code by exact-text match. Load this before writing PowerShell/Bash commands or scripts."
```

**Hunk 2 — `notion-ticket-lookup/SKILL.md:133` (H2)**
```diff
-treat the pin as stale, fall through to step 3 (ask Erez), and fix the pin here.
+treat the pin as stale, continue with steps 2–4 above (epic, REST lookup, then ask Erez), and fix the pin here.
```

**Hunk 3 — `check/SKILL.md:40` (H3)**
```diff
-For small/simple proposals a single pre-mortem reviewer may suffice; for anything substantial, run the full set. **Spawn them in parallel** (one message, multiple Agent calls).
+**Spawn every applicable lens in parallel** (one message, multiple Agent calls).
```
*(If a lighter tier is wanted instead: drop the "no quick/single-pass tier" sentence on line 14 and change `ALWAYS` to `by default` on lines 35–37.)*

**Hunk 4 — `notion-howto/SKILL.md:8-11` (H4)**
```diff
-…Safety-critical Notion-adjacent notes (e.g. the destructive-relation incident classes) remain in the global CLAUDE.md and are not duplicated here.
+Load this skill before Notion MCP work. The safety-critical Notion incident classes are in ~/.claude/hooks/refs/notion.md (hook-injected on Notion turns), not here.
```

**Hunk 5 — `config-health/SKILL.md:12` (H5)**
```diff
-… (global: since the last config sync; the active project's file: this session) …
+… (global: changes since the last completed health review — the per-machine high-water marker; the active project's file: this session) …
```

**Hunk 6 — `config-health/SKILL.md:26` (H6)**
```diff
-- **Session ID …:** read it from your own scratchpad path in the environment context — the path is `...\Temp\claude\C--Users-Erez\<session-id>\scratchpad`; the UUID segment is the session ID. Pass it to the script's `-SessionId`.
+- **Session ID …:** read `$CLAUDE_SESSION_ID` in the Bash tool; if it is empty, use the UUID folder name directly above `\scratchpad` in your scratchpad path. Pass it to the script's `-SessionId`.
```

**Hunk 7 — project `CLAUDE.md:159` (H7)**
```diff
-- Hebrew keywords: תלוש הארנונה, חשבון הארנונה, תלוש ארנונה, חשבון ארנונה, חשבונית, החשבונית
+- Hebrew keywords: the `hebrewKeywords` list in `buildSearchQuery` in `Code.js` — read it there; a copy here goes stale
```

**Hunk 8 — project `CLAUDE.md:158` (H8)**
```diff
-- Hebrew keywords: separate GmailApp.search() calls without parentheses
+- Hebrew keywords: one separate GmailApp.search() query per keyword (`subject:(keyword)`), not OR-joined with the English query
```

**Hunks 9–13 — `vet-ticket/SKILL.md` (H10)**
- 72-77: replace with `**Housekeeping-only property edits** — Status, Assignee, Project, Type, Reason. Every other property, including Due Date, Remind me (days before), Date Created, ID and Parent item, is substance and is gated.` (keep the following deny-list sentence)
- 90-91: remove `(This replaces an earlier command-name rule that covered only 5% of real GEN-58 writes.)`
- 415: remove `(realigned 2026-08-05; hand-back channel added 2026-09-27, GEN-740)`
- 578-582: remove the `(Earlier drafts made the hook derive a canonical target string…)` parenthetical
- 661-663: remove the `(Before 2026-08-05 this step scanned…)` parenthetical

**Hunks 14–16 — `vet-code/SKILL.md` (H11)**
- 205-210 → `(Both passes run in the session's family, so below-floor is a stop point Erez decides, never a silent degrade. If the design ever drops Pass B or lets Pass A gate something Pass B doesn't, revisit this.)`
- 529-535: remove the `(Note: 'regardless of pass' is NOT accurate …)` parenthetical; rewrite (2) → `(2) a shell copy does not consume the pass, leaving it valid until its TTL and defeating the single-use guarantee.`
- 607-609: remove `(This is the narrow remnant of the pre-GEN-435 manual carry…)`

**Hunk 17 — `~/.claude/CLAUDE.md:79` (M1)** — replaces only the first and fourth sentences; the exception-stream, retry, and step-description sentences stay.
```diff
-Default to silence on success: on a turn where work proceeds normally, write no narration beyond the "📌 For you" block the turn requires (and if the turn requires none, nothing at all) — and no self-referential note that you checked, verified, or re-read something, or that it came back clean, counts as such permitted narration; …
+Keep process narration to what helps Erez follow along: during multi-step work, a short line when you start a new phase, finish a significant step, or change plan; skip notes that only say a check passed or that you re-read something. …
…
-After every 10 tool calls (each parallel or sub-agent call counts as one), you may add a one-line heartbeat ("done X, now on Y") — at most one per 10-call stretch, never a per-action play-by-play.
+(remove)
```

**Hunk 18 — `~/.claude/CLAUDE.md:43` (M2)**
```diff
-For any non-routine answer (design, architecture, trade-offs, uncertain territory): treat the first pass as a draft. Rate confidence internally. If not high, re-examine from scratch before responding.
+For any non-routine answer (design, architecture, trade-offs, uncertain territory), present it only when you are confident in it; where you are not, say what is uncertain and what would settle it.
```

**Hunk 19 — `wrap/SKILL.md:3` (M3)**
```diff
-description: End-of-session wrap-up procedure. Use ONLY when the user explicitly runs /wrap. …
+description: End-of-session wrap-up procedure. Use when the user runs /wrap or asks to end / wrap up the session ("end session", "wrap up") — not for a mid-session "wrap up this subtask". …
```

**Hunk 20 — `wrap/SKILL.md:257` (M4)**
```diff
-Run `sync.ps1 -Direction From-Claude`
+Run `& "G:\My Drive\AI Projects\_Tooling\Claude\sync.ps1" -Direction From-Claude`
```

**Hunk 21 — `wrap/SKILL.md:50` (M5)**: replace the "VOLUNTEERED UNPROMPTED" parenthetical with:
`…was NOT explicitly rejected by Erez, and is not an unprompted offer of yours that he let lapse (silence or a topic change). Anything he asked for or engaged with stays fileable; if you cannot tell whether it lapsed, file it.` (Leave the reversal-capture clause.)

**Hunk 22 — `vet-rule/SKILL.md` after line 55 (M6), add:**
`This is narrower than the global CLAUDE.md mechanical-fix exception (spelling, punctuation, formatting): the hook can verify only horizontal whitespace, so a spelling or punctuation fix to a gated file still runs this flow.`

**Hunks 23–28 — `vet-ticket` / `vet-code` / `vet-rule` (M7)**
- vet-ticket 63-66 → `That is deliberate: the hook makes no network call, so it cannot tell what an unrecognised page is, and treating it as a ticket is the safe default.`
- vet-ticket 123 → `do not restate the list elsewhere; a second copy drifts.`
- vet-ticket 183-189 → `**Entry to this lane is verified, not declared, and this session does the verifying before any reviewer is spawned.** The check must be a network read, and the check-reviewer sub-agent has no Notion tool, so it can never be the one to check.`
- vet-ticket 359-361 `Re-minting alone is not enough any more:` → `Re-minting alone does not help:`
- vet-ticket 544 → `(Erez's instruction)`
- vet-ticket 592-600 → `**ONE pass file authorises ONE write.** The hook consumes a matched pass by renaming the whole file to *.consumed.<ts>. A card list covering several tickets therefore needs one pass file per ticket, each with its own hash and reviewer token, written in the same approved moment. Never put several hashes in one file; the hook cannot read them.`
- vet-code 376-387 → `The firing mechanism is a **per-change one-time scheduled task** created at Step 8a, not a passive Review-ticket note. A dwell timer is a valid carrier because survival is trigger-agnostic (above).` (keep the following Review-not-Done sentence)
- vet-code 539-541 → `(a multi-line apply is refused before it writes, per Step 4 and the SINGLE-LINE note above)`
- every "Since GEN-641, …" / "since GEN-462 …" (vet-rule 202-203, 280, 292; vet-code 315, 520, 624, 636) → the same sentence in the present tense, without the "since" clause
- vet-rule 122-124 and vet-code 148-150: remove "confirm the first time you exercise this that the returned id matches the on-disk filename"

**Hunk 29 — `notion-ticket-lookup/SKILL.md` (M8)**
- description → `Find a Team-Tasks ticket by its GEN-NNN id. Use whenever you need to locate or open a ticket referenced by its number (e.g. GEN-194) — notion-search is semantic and cannot find a ticket by id. Match only the exact id, never a title or semantic hit.`
- 18-21 / 108 → `…plan-gated on this workspace (it returns a plan-upgrade error), so don't rely on it.`
- 31-34 → `Note: a notion-fetch of an epic returns its sub-items only as bare page URLs with no IDs.`
- 113 → `The working path is the Notion REST API.`

**Hunk 30 — `SECURE-LOOKUP-DESIGN.md` (M9)**
- Replace lines 3-25 with `## STATUS\nBuilt and live as ~/.claude/scripts/notion-ticket-lookup.ps1; the live procedure is SKILL.md. This file is a design record, not instructions.`
- Delete lines 124-128.

**Hunks M10–M13** — as given in the table: one-line replacements, or a removal for M13.

**Hunk 31 — project `CLAUDE.md:137` (M14)**
```diff
-… Bank-transfer details present → accounting/To Pay (unchanged).
+… Bank-transfer details present → accounting/To Pay.
```

**Hunk 32 — project `CLAUDE.md:190` (M15)**
```diff
-- Slow links: `UrlFetchApp` does support `timeoutSeconds` (default 360 s; verified honored 2026-09-29). Gemini reader calls are capped via `READER_CALL_TIMEOUT_S`, but link downloads (`attemptDownload`) are not, by design (GEN-757) — its catch-all turns any failure into a permanent manual flag. …
+- Slow links: `UrlFetchApp` honors `timeoutSeconds` (default 360 s). Gemini reader calls are capped via `READER_CALL_TIMEOUT_S`; link downloads (`attemptDownload`) are deliberately not capped, because its catch-all turns any failure into a permanent manual flag. …
```

**Hunk 33 — project `CLAUDE.md:257` (M16)**
```diff
-… and pages past the ~100-entry cap that made `clasp logs` miss lines. Cloud Logging retention is ~30 days. Supersedes `clasp logs` for this project. (GEN-752)
+… and pages past the ~100-entry cap of `clasp logs`, so use it instead of `clasp logs`. Cloud Logging retention is ~30 days.
```

**Hunk 34 — project `CLAUDE.md:8, 15` (M17)**: remove `; GEN-218` (line 8) and ` (GEN-673)` (line 15).

## Verify (Step 7)
- **H1:** after the fix, start a new session and confirm the skill list shows the full shell-howto description.
- **H7/H8:** re-read `Code.js:522-531` when applying.
- **M1/M2:** behavioral changes. Watch whether the "hasn't heard from you" nudges stop, and revert simply if narration becomes noisy.
- Apply one hunk group at a time; the `vet-*` hunks go together.
