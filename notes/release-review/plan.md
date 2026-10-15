# Plan — Claude Code "what's new" review, and turning it into a standing system

## Context
Erez asked (verbatim): "Create a plan on how you'll go over the what's new section in claude code, and tell me what capability is added or improved that we can use to our advantage, in regards to what we have done in the past, and in regards tickets we have pending, and how will this become an automated system that automatically changes pending tickets and creates new tickets so we can work on improving the system."

Why it matters: we have built a lot by hand since 2026-06-01 (hooks, gates, checks, scheduled checks). Claude Code ships ~7 versions a week (~50 change lines each). Some of what we built by hand may now exist natively; some of the 372 open AI tickets may now be easier, unblocked, obsolete, or fixed upstream. Today nobody reads the release notes systematically — use so far has been ad hoc (HISTORY.md lines 326, 5315, 5668; `notes/gen860/HANDOFF.md:32`). No existing ticket covers this.

Facts established while planning (verified this session):
- **Sources.** Full list of changes: GitHub `CHANGELOG.md` (raw URL fetches; versions only, no dates). Dates: npm registry publish times, or GitHub Releases API. Curated weekly "What's new" digest at code.claude.com/docs/en/whats-new — but it stopped at Week 37 (Sep 7–11), so it can't be relied on alone. Desktop/app-level changes (artifacts, Docs, models): Help Center release notes page (no feed). `/release-notes` is not readable by Claude.
- **Volume.** 2026-08-01 → 10-14: 67 versions, ~3,600 lines (≈1,850 "Fixed"). After dropping VS Code-only lines: ~1,000. Since project start (06-01) roughly double.
- **Open tickets.** 372 open AI tickets (266 To Do, 45 Backlog, 29 Review, 14 Blocked, 14 In Progress, 4 blank) + 42 with no Project set.
- **Reusable machinery.** Unattended ticket filing through the ticket-quality gate already works inside `/wrap` (`~/.claude/skills/wrap/SKILL.md:43-60`, `vet-ticket/SKILL.md` — independent reviewer + single-use pass); a `scheduled` source is already defined in the gate. Duplicate check (exact title + semantic search) already in `/wrap` sub-steps 5–6. Local scheduled tasks exist with a self-logging precedent (`~/.claude/scheduled-tasks/gen748-renudge-verify/SKILL.md`). Board listing works via Notion REST (`notion-ticket-lookup/SKILL.md:105-121`) but only as an inline recipe (prompts), not a fixed script.
- **Rule constraints.** Ticket status changes are propose-and-wait (global CLAUDE.md "Ticket status" rule). The no-card unattended-filing exception is written only for `/wrap` (vet-ticket 39-45, 541).

## Approach — two phases, one shared procedure

### The procedure (written once as a skill `/release-review`, used by both phases)
1. **Collect** every changelog version newer than the last one reviewed (state file), dated via npm; plus new Help Center entries.
2. **Filter** out lines for surfaces we don't use (VS Code / JetBrains). Keep "Fixed" lines — they're how a workaround ticket becomes obsolete.
3. **Group** related lines across versions into capabilities ("hooks can now block on failure", etc.).
4. **Check availability**: our installed version (from recent session transcripts — `claude` isn't on PATH), and plan gating (Team/Enterprise-only, beta).
5. **Match each capability three ways:**
   - **Against what we built** (inventory of `~/.claude/hooks`, `skills`, `scripts`, `scheduled-tasks`): "native feature now does what our custom piece does" → simplify/retire candidate.
   - **Against open tickets** (titles of all 372 first; full body only for candidates): makes a ticket easier, unblocked, obsolete, or fixed upstream.
   - **Unmatched but useful** → new-opportunity candidate.
6. **Verify each candidate** against the feature's real docs before it becomes a finding (no claims from changelog wording alone).
7. **Act**, per finding type:
   - New opportunity → new ticket (through the gate, with priority fields and the true status; parent GEN-86).
   - Pending ticket affected → dated note appended to that ticket's body ("Release 2.1.NNN: … — means …").
   - **Blocked → To Do, automatic** (see Decision below), only when all hold: the ticket's *only* stated blocker is a missing Claude Code capability; the release adds it; it's verified in the docs and available in our installed version and plan. Every Blocked ticket's full body is read each run (blockers live in the body, not the title). Order: the gated note ("Unblocked by release 2.1.NNN: …") is written and re-fetched first, with the three conditions and the ticket's blocker text in the reviewer's brief so it judges the unblock itself; the status flips only after that succeeds. Listed in the digest so Erez can reverse it; a reversed unblock is recorded in the seen-findings log so it isn't re-applied.
   - Every other status change (close as obsolete, mark Done, etc.) → **proposal only**, listed for Erez's yes/no.
   - Each item is de-duplicated against the board and against a "seen findings" log so nothing is filed twice.
8. **Report**: one digest per run (what was reviewed, what was filed/appended, what awaits his yes/no).

### Phase 1 — catch-up review (manual, run in a session with Erez)
- Window: 2026-06-01 (project start) → latest version. First pass: the curated weekly digests for weeks 23–37 (cheap); then the full changelog for everything after Week 37 and for all "Fixed" lines. Re-derive the volume/date figures above at the start (they came from a sub-agent relay; only the Week 37 cutoff was independently re-checked). Split by version range across parallel read-only reviewers (each fetches its range and returns grouped capabilities); the main session does matching, verification, and ticket work.
- Output to Erez: a plain-language report of the top capabilities and what each means for us, then ticket actions through `/vet-ticket` (catch-up is attended, so normal approval applies).
- This also proves the procedure before it runs unattended.

### Phase 2 — the standing automated system
- **Trigger:** a weekly local scheduled task that runs `/release-review` on everything since the last reviewed version. If the PC/app is off, it runs at next launch and loses nothing (it works from "last version reviewed", not dates).
- **Writes:** creates tickets and appends notes unattended through the existing ticket-quality gate (independent reviewer on every write). Requires extending the gate's unattended exception from `/wrap` to this job (a rule change via `/vet-rule`, Erez approves). Caps per run: at most 5 new tickets and 10 appended notes (several findings on one ticket = one append); overflow goes in the digest. An append is a material change, so it re-derives that ticket's priority fields (`vet-ticket/SKILL.md:319-320`).
- **Never loses a finding:** the "last version reviewed" marker advances only after every finding is either written or saved in a local recovery file (same pattern as `/wrap`'s surfaced-not-filed file); unfiled items show in the `/wrap` readout.
- **Reads:** a new fixed, read-only "list open tickets" script modelled on `~/.claude/scripts/notion-ticket-lookup.ps1` (via `/vet-code`). Reads via REST, writes only via the gated Notion tools.
- **Permissions:** scheduled tasks stall on any tool without an allow rule (code.claude.com/docs/en/desktop-scheduled-tasks). Build step lists every tool the job uses (web fetch, listing script, `node` for the gate's hash/pass, staging + repo writes, sub-agent spawn, Notion write tools) and confirms each runs without a prompt.
- **How Erez sees it:** each run adds a dated section to one standing "Claude Code release review" ticket — his yes/no list; answered items are struck and moved to a "decided" section. `/wrap` gains a one-line readout: "Release review: last run <date>, N filed, M waiting for you, K not filed" + an alert if no run in 10 days.
- **Re-evaluate bar:** after 4 runs, if more than 1 in 3 auto-filed tickets ended as Wont Do, or more than half are still untouched after 4 weeks, tighten the filter or switch auto-filing to proposals.

### Decision recorded
Question: "should the system change ticket status by itself, for example closing a ticket that's no longer needed?" Erez's answer (verbatim, 2026-10-15): "let it move a ticket from Blocked back to To Do by itself when the thing it was waiting for now exists in Claude Code".
Consequence: the global CLAUDE.md "Ticket status (Notion, Jira, etc.)" rule (status changes are propose-and-wait outside the session's primary ticket) needs a narrow exception for this one case — done via `/vet-rule` (with `/check`) during the build, shown to Erez before it's applied. Status-only edits skip the ticket-quality gate (`vet-ticket/SKILL.md:71-82`), so the job writes a gated note first and flips the status only after it lands (see step 7). All other status changes stay proposals.

### Alternative trigger considered (not recommended)
Run the review inside `/wrap` when the installed version changed. Strongest reason for it: `/wrap` already has the unattended-filing exception, so no rule change, no scheduler. Against: adds 10–20 minutes of heavy analysis to session endings, when context is already full. Cloud routines rejected: they lack our local hooks and reviewer, so writes would be unreviewed.

## Files (created during execution, not now)
- `~/.claude/skills/release-review/SKILL.md` — the procedure (via `/vet-rule`).
- `~/.claude/scripts/list-open-tickets.ps1` — read-only board listing (via `/vet-code`).
- `~/.claude/scheduled-tasks/release-review-weekly/SKILL.md` — weekly trigger.
- `notes/release-review/state.json` (last version reviewed) and `notes/release-review/findings.jsonl` (seen findings) — in this repo.
- Edits: `vet-ticket/SKILL.md` (unattended exception), `wrap/SKILL.md` (readout line), global `CLAUDE.md` "Ticket status" rule (narrow auto-unblock exception) — all via `/vet-rule`.
- Tickets: one parent ticket for this work (filed via `/vet-ticket` at execution start) + the standing digest ticket.

## Order of execution
1. File the ticket for this work (`/vet-ticket`).
2. Phase 1 catch-up → report to Erez → ticket actions he approves.
3. Write `/release-review` from what Phase 1 taught; build listing script; extend gate exception; add `/wrap` readout; create weekly task.
4. Dry run of the scheduled job on the last week (writes disabled) → compare with a manual pass → first live run supervised and limited to 1–2 writes (the dry run can't test the unattended write path) → then full writes.

## Verification
- Phase 1: spot-check 5 findings against the docs; confirm every appended note and new ticket re-fetches correctly.
- Phase 2: dry run produces the same findings as a manual pass on the same week; first live run's tickets carry gate passes (`*.consumed.*`); `/wrap` readout shows the run; state file advanced to the latest version; a second run on the same week files nothing (dedupe).

## Honest limits
- Matching is judgment: title-first matching can miss tickets with vague titles; some changes are undocumented or worded too briefly to tell.
- Plan-gated or beta features may not be available on Erez's plan — checked per finding, but not always determinable.
- Unverified until build: that a scheduled run can spawn the gate's independent reviewer and pass its evidence check (expected — a `scheduled` source is already defined at `vet-ticket/SKILL.md:512-514` and `hooks/ticket-gate-readout.js:33` — proven in the supervised first run), and that the scheduled run uses a strong model at high effort.
- Scheduled tasks run only while the app is open and the PC awake; a missed week catches up at the next run because the job works from "last version reviewed".
- Help Center page has no feed; scraping it may break when the page changes.
