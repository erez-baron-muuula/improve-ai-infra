# GEN-615 + GEN-620 — one concurrent-session awareness mechanism (v3)

**Status:** proposal v3, revised 2026-08-03 after `/check` rounds 1–2. Not applied.
**Supersedes:** `design-v1.md`, `design-v2.md` (kept for the record). §8 lists all changes.
**Tickets:** GEN-615 (two sessions on the same *ticket*), GEN-620 (two sessions in the
same project *folder*). Deliberately not merged as tickets; served by one artifact.

---

## 1. The two goals, unchanged

- **GEN-615:** when a session begins substantive work on a named ticket, it should know
  whether another live session is already on that ticket, surface it to Erez, and ask
  which session owns the work rather than proceeding in parallel. Incident: 2026-08-02,
  two sessions on GEN-443 Step 3 for hours; a whole panel + review + two rigs voided, and
  an approval record pinned a hash that no longer matched the file.
- **GEN-620:** when a session begins work in a project folder, it should know whether
  another live session has recently been writing there — naming the files and how
  recently. The failure it targets is *silent*: reading a file another session is halfway
  through rewriting, and drawing conclusions from a partial state.

Both are **awareness**, not locking. GEN-620 rejected advisory locks on their merits
(hook processes are short-lived; this project's rhythm has long idle gaps waiting for
Erez, so a TTL lock either expires mid-work or outlives a dead session). That rejection
stands, and **no part of this design may quietly reintroduce a TTL** — a lesson that cost
two review rounds, once as a 120-minute folder window and once as a 24-hour map expiry.

## 2. What is actually available

The blocker both tickets named — "the two id spaces do not line up, so matching stays
heuristic" — is real for the tool GEN-615 was looking at, and irrelevant to the design,
because a different source shares the edit log's id space exactly.

| Source | Contents |
|---|---|
| `~/.claude/sessions/<pid>.json` | one file per **live** session: `pid`, `sessionId`, `cwd`, `startedAt`, `procStart`, `entrypoint`, `name`, `version` |
| `~/.claude/hooks/auto-approved-edits.jsonl` | append-only `{ts, tool, file, existed, session}` per approved edit; `session` = the same `sessionId` |
| `~/.claude/projects/<slug>/<sessionId>.jsonl` | that session's transcript — same id again |
| `mcp__ccd_session_mgmt__list_sessions` | `local_<uuid>` ids + titles — **different id space**, and an MCP tool a hook cannot call |

Measurements taken 2026-08-03 on this machine, each a **point-in-time snapshot**. Three
drifted during review alone — the edit-log `Write` count went 20 → 21 → 22 (the first
because writing this document logged an entry), and the live-session count went 6 → 7.
None is load-bearing at runtime: the hook reads live state on every call, and §6 step 0
re-measures before build.

- `sessions/*.json`: 6 files, 6 live pids, 0 stale.
- Edit log: 1,171 events, 171 distinct sessions; tool tally **Edit 1,151 / Write 20 and
  nothing else**.
- Id spaces: 0 of 200 session-list ids intersect the 171 edit-log session ids.
- Transcripts: 0.1–11.0 MB across the 6 live sessions.
- `GEN-\d+` over the last 120 transcript lines per live session: GEN-58 is the top hit in
  4 of 6 (146 in one), because standing rules mention it every turn.

Independently corroborated twice during review: `sessions/1180.json` carries
`sessionId: bd0001a6-…`, and the edit-log line for this document's own creation carries
`session: bd0001a6-…` — a live worked example of the exact join the design rests on.

Figures quoted from the **GEN-620 ticket body** (41 project-root collisions at a
30-minute window, 38 of them `HISTORY.md`, 0 subfolder collisions in seven weeks) are
**reported by that ticket, not re-measured here**. No part of §3 now depends on them
numerically; they support only the qualitative claims that collisions are rare and
`HISTORY.md` dominates the noise.

Two measured limits the design must respect:

1. **Ticket detection must read only what Erez typed** — the GEN-58 pollution above is
   what a transcript-scanning approach would drown in. (Also: 11 MB transcripts, so no
   hook may read one whole.)
2. **The edit log sees harness `Edit`/`Write` only.** A shell-based write (`Set-Content`,
   a redirect, `git checkout`) is invisible to it. Residual, §7.

## 3. The design

One new hook file, `~/.claude/hooks/concurrent-session-warn.js`, registered on two
events. Both halves ask the same question — *"which other live session is on my key, and
how recently?"* — and differ in the key: **ticket id** for GEN-615, **folder** for
GEN-620.

### 3a. Liveness (shared) and folder scoping (NOT shared)

The two halves share liveness and must **not** share folder scoping. A ticket id is a
global Team-Tasks identifier — GEN numbering runs across all three projects — so a
same-ticket collision between a session in one project folder and a session in another is
a real collision and must warn. A folder collision, by definition, cannot cross folders.

- **`liveSessions()` — used by both halves, and by every prune.** Read every
  `~/.claude/sessions/*.json` fresh (small directory; 7 files today). Keep entries whose
  `pid` still exists **and** whose running process start time matches the recorded
  `procStart` (a mismatch is pid reuse, not a live session). No `cwd` filter here.
  Exclude this session's own `sessionId`.
- **`sameFolderSessions()` — folder half only.** `liveSessions()` narrowed to sessions
  whose `cwd` equals this session's `cwd`. **"Project folder" means exactly this session's
  own `cwd`** — no whitelist to maintain.
- Unreadable directory or unrecognized shape → inject a one-line "session registry
  unreadable" note and stop. Degraded, but visibly so.

### 3b. Ticket half (GEN-615) — `UserPromptSubmit`

Self-registering presence, so no transcript parsing is ever needed:

1. Match Erez's prompt with `/\bGEN[\s-]?(\d+)\b/gi` — case-insensitive and tolerant of a
   space, because he writes "gen 615" as often as "GEN-615" (this session's opening
   message did). Collect **every** id in the prompt, not just the last.
2. Read `~/.claude/hooks/session-tickets.json`:
   `sessionId → { pid, procStart, tickets: { "GEN-615": lastNamedTs } }`.
   - **Accumulate, never overwrite.** A session working GEN-443 for hours that mentions
     GEN-88 once in passing keeps both, each with its own timestamp.
   - **Prune by liveness only** — an entry goes when its `sessionId` is absent from
     `liveSessions()`, i.e. its process is gone. **No age-based expiry**: a registration
     lives exactly as long as its session does. An entry untouched for a day belongs to a
     session that is either still alive (so it still matters) or dead (so liveness removes
     it). This is the same reasoning that removed the folder window, and it also bounds
     the file naturally — at most one entry per live session.
   - Pruning uses `liveSessions()`, never `sameFolderSessions()`. Otherwise a hook running
     in one project would treat a live session in another project as dead and delete its
     registration from this shared file.
3. For each ticket in this prompt, if a live *other* session has that ticket in its set,
   inject a warning naming that session, which ticket, and **when it last named it** —
   letting recency be information rather than a hidden filter.
4. Record this session's ids and write the map back **atomically**: re-read, merge, write
   a temp file in the same directory, `rename()` over the target. Without this, two
   sessions starting on the same ticket within one hook's execution can each read before
   either writes and the loser's entry vanishes — silently producing the double-work this
   exists to prevent. `rename()` is atomic, so no reader ever sees a partial file; a
   vanishingly narrow lost-update window remains (both re-read before either renames) and
   is accepted, since the consequence is one missed warning, not corruption.
5. **Dedupe:** warn once per `(ticket, other sessionId)` pair; re-arm only when that
   session's `lastNamedTs` for the ticket has advanced ≥30 minutes past the last warning
   shown. Without dedupe the warning refires on every prompt for the whole overlap — the
   "teaches Erez to ignore the channel" failure this design rejects `SessionStart` for.
   **The 30 minutes is a judgment call, not derived from evidence**; it sets only the
   re-warning cadence, never whether the first warning fires.

**What this can and cannot distinguish.** A prompt naming a ticket means *named*, not
necessarily *worked* — "what's the status of GEN-88?" registers GEN-88. The warning
therefore reports only what it can stand behind ("that session named this ticket, most
recently N minutes ago") and leaves ownership to Erez. Accumulation keeps the
false-negative direction closed; a false positive costs one question.

Precedent: `inject-notion-refs.js` already fires on `UserPromptSubmit` and already uses
`/\bGEN-\d+\b/` as a prompt cue, reading only `data.prompt`.

### 3c. Folder half (GEN-620) — `PreToolUse` on `Read|Edit|Write|NotebookEdit`

No new writer needed — the edit log already *is* the folder presence signal:

1. Take the target file's **containing folder**; proceed only if it is inside this
   session's `cwd`. Never widen to the project as a whole — GEN-620 measured that a
   project-level trigger would fire on roughly one folder-entry in five.
2. Ignore entries for files with their own protection — `HISTORY.md` above all: 38 of the
   41 measured project-root overlaps, already serialized by the GEN-218 locked appender,
   and touched only at wrap-up.
3. **Liveness is the gate; recency is information.** Warn if a session in
   `sameFolderSessions()` wrote in that folder at any point **since that session started**,
   naming the files and the most recent time. No time window: a fixed cutoff would
   reintroduce the TTL mismatch of §1 — a session idle three hours mid-rewrite is exactly
   the case that matters — and bounding by the other session's own lifetime needs no
   invented number and cannot miss its work.
4. Read the log **bounded**: only entries at or after the earliest `startedAt` among
   `sameFolderSessions()` (tail-scan, stop early). The log is append-only and unbounded
   (1,171 lines today); the discipline applied to transcripts applies here.
5. **Dedupe with re-arm**, symmetric with the ticket half: once per `(folder, other
   sessionId)` pair, re-armed when that session's most recent write in the folder has
   advanced ≥30 minutes past the last warning shown. v2 had no re-arm here, which would
   have gone silent for a pair that kept writing new files for hours.

**Where dedupe state lives.** Not in `session-tickets.json` — that file is shared presence
data, and warned-state is private to the session doing the warning. Both halves keep it in
one small per-session file in the OS temp directory, keyed by `session_id`
(`claude-concsess-<sessionId>.json`), holding `pair → lastWarnedTs`. Private state means no
cross-session merge and no race, and it disappears with the temp directory. This follows
`inject-edit-refs.js`, which already keys a per-session marker file by `session_id` in
`os.tmpdir()`.

Precedent: `inject-edit-refs.js` already fires `PreToolUse` on exactly
`Read|Edit|Write|NotebookEdit`, including `Read` deliberately — which is what makes the
*read-into-an-actively-rewritten-folder* failure GEN-620 targets reachable at all. Note
`NotebookEdit` never appears in the edit log (Edit/Write only), so it can trigger a check
but will never be the cause of one.

### 3d. Shared

- **Fails open, always.** Missing file, malformed JSON, unrecognized shape → inject
  nothing, never block the prompt or the tool call. Same posture as the four existing
  `inject-*-refs.js` hooks.
- **No CLAUDE.md growth, no new rule, no new skill step.** The instruction to stop and ask
  travels *inside* the injected text, at the only moment it is relevant — nothing is added
  to the always-loaded file that GEN-86 is actively shrinking.

## 4. What the warning says, and who reads the signal

Ticket half:

> **Concurrent session warning.** Live session "Gen 152 and 621 cleanup" (started 14:02)
> last named **GEN-152** 8 minutes ago — a ticket this prompt names. Before doing
> substantive work on it, surface this in the "📌 For you" block and ask Erez which
> session owns the work. Reading or discussing the ticket is fine.

Folder half:

> **Concurrent session warning.** Live session "improve-ai-infra-bd" wrote
> `notes/gen508-piece1/design-converged.md` in this folder 4 minutes ago (2 files since it
> started). Files here may be mid-rewrite — treat what you read as possibly partial, and
> surface this in the "📌 For you" block before relying on it.

**Primary signal, and its reader.** The warning is the signal; its reader is Erez, in that
same turn's "📌 For you" block — a routine he already sees. Nothing new to check.

**Secondary signal — is it noise?** Each firing appends one line to
`~/.claude/hooks/concurrent-session-warnings.jsonl` (`{ts, half, key, otherSession,
sessionId}`), for the sole purpose of answering "is this channel becoming noise", which a
dismissed warning otherwise leaves no trace of.

- **Reader and when:** a follow-up ticket, filed *at install time* and assigned to Claude,
  with a self-trigger three weeks out, whose job is to count the lines against the bar.
- **Re-evaluate bar:** if the folder half has fired more than about once a week, tighten
  the scope or exclusions before trusting it further; if the ticket half has fired more
  than a handful of times with no real collision behind it, revisit whether a prompt
  mention is too loose a cue.
- v1's "Erez waves it off twice" leg is dropped: nothing in the log records a dismissal, so
  it was unmeasurable. If he asks for it to stop, that needs no log.

## 5. Why not the alternatives

- **An always-loaded CLAUDE.md rule.** *Strongest case:* no code, no vetting flow, and it
  covers what a prompt cue cannot — work arising mid-turn, never named in a prompt. It
  fires on judgment at exactly the right moment. *Why not:* it depends on remembering,
  which is what failed on 2026-08-02 — the information was available from the first turn
  and nothing prompted anyone to look. It grows the file GEN-86 is shrinking, and makes the
  join manual, and therefore sloppy, every time.
- **A `SessionStart` hook warning about same-folder sessions** — GEN-615's original guess.
  *Strongest case:* simplest possible, zero judgement, no keys, no parsing. *Why not:*
  measured noise. Seven live sessions sit in this one project folder right now, so it would
  warn at every session start while unable to say whether any is on the same work — the
  option most likely to be tuned out, which is worse than nothing because it teaches Erez
  to ignore the channel.
- **Advisory lock files per ticket or folder.** *Strongest case:* it would prevent the
  collision rather than describe it, and `procStart`-checked liveness answers the
  stale-lock objection. *Why not:* blocking is the wrong shape — Erez deliberately runs
  several sessions per project, and a false lock stops real work. Both tickets ask to be
  *told*.
- **Extend an existing `inject-*-refs.js` hook instead of adding a file.** *Strongest
  case:* no new registration, one fewer file to vet. *Why not:* those hooks are pure
  data-injection with no state; this one holds a shared map and a warnings log. A bug in
  the state handling would take the reference-note injection down with it. Vetting cost is
  roughly a wash, so separation wins on blast radius.
- **Folder presence from filesystem mtimes or git instead of the edit log.** *Strongest
  case:* it would catch the shell-based writes the log misses (§7). *Why not:* neither
  carries **which session** wrote, which is the whole point — a warning that cannot name
  the other session is not actionable.
- **`list_sessions` + title matching**, as GEN-615 assumed. *Why not:* 0 of 200 ids join
  the edit log, so it cannot say what the other session touched, and no hook can call an
  MCP tool. Its titles are richer; the presence map gets the same fact exactly.

## 6. Build order

0. **Re-measure** the §2 snapshots immediately before writing code — three drifted during
   review alone.
1. Write liveness, folder scoping, and both halves in one file (~180 lines).
2. `/vet-code` it — mandatory for a new hook: `/check`, two code-review passes, then the
   single-use vetting pass.
3. Register both events in `settings.json` via `update-config.ps1` (locked file).
4. **Verify by construction, not by waiting.** A correctly-scoped folder warning would
   have fired 0 times in seven weeks, so acceptance cannot be "wait for it to fire" — this
   supersedes GEN-620's "verified by Erez in a real two-session sitting":
   - *ticket half:* two sessions, same project; the second names a ticket the first
     registered → warning appears, naming the other session and when it last named it.
   - *ticket half, cross-project:* the two sessions in **different** project folders, same
     ticket → warning still appears (ticket ids are global; this is what proves the `cwd`
     filter did not leak into the ticket half).
   - *ticket half, accumulation:* first session names ticket A, then B in passing; second
     session names A → warning still appears.
   - *ticket half, no age expiry:* a live session whose registration is more than a day old
     → still warns.
   - *ticket half, race:* two prompts naming the same ticket submitted as close together as
     can be managed → both entries survive (what the atomic write buys; the sequential test
     cannot exercise it).
   - *ticket half, dedupe:* same overlap across several prompts → warns once, not every
     turn; and re-warns after the other session re-names the ticket ≥30 minutes later.
   - *folder half:* session A edits a file in a subfolder; session B then **reads** a
     different file in that same subfolder → warning appears naming A's file and time.
   - *folder half, re-arm:* A keeps writing new files for over 30 minutes → B warns again
     rather than staying silent for the rest of the session.
   - *attribution:* a sub-agent's tool call inside one session does **not** produce a
     self-warning; and a resumed session's new pid pairs correctly with its existing
     `sessionId`. Both are currently unverified (§7) and must be settled here.
   - *negative controls:* different tickets → silent; **a different subfolder inside the
     same project** → silent (this, not "a different project", tests the
     folder-not-project scoping); `HISTORY.md` → silent; a dead session's leftover record →
     silent; a **reused pid** whose `procStart` disagrees → silent.
5. **File the noise-review follow-up ticket** (§4) with its three-week self-trigger, at
   install time — not after.
6. Close GEN-615 and GEN-620 on that demonstration.

## 7. Honest residual — what this does NOT solve

- **It warns; it does not prevent.** If Erez says proceed, both sessions still run. That is
  what both tickets asked for, not an oversight.
- **Shell-based writes are invisible.** The edit log carries `Edit`/`Write` only. A session
  rewriting a file via `Set-Content`, a redirect, or `git checkout` produces no folder
  signal at all. GEN-218's file-level protection is likewise not extended by this.
- **Ticket detection is prompt-cued, so a mid-turn pivot is uncovered** — work that turns
  to a ticket never typed in a prompt stays silent. Same known limit as
  `inject-notion-refs.js`.
- **Named ≠ worked.** A passing mention registers a ticket; the warning reports "last
  named", not "is working". A false positive costs one question to Erez.
- **Reads are still unlogged.** This tells you another session *wrote* nearby; it cannot
  tell that session that *you* are reading its half-finished file. GEN-620's exposure is
  covered in one direction only.
- **A vanishingly narrow lost-update window survives the atomic write** (both processes
  re-read before either renames). Consequence is one missed warning, never corruption.
- **Sub-agent and resumed-session attribution is unverified** — whether a sub-agent's tool
  calls carry the parent's `session_id`, and how a resumed session's new pid pairs with its
  existing `sessionId`. Both are on the §6 test list and must be settled at build; as of now
  they are unknown, not proven safe.
- **It leans on an internal Claude Code file.** `~/.claude/sessions/<pid>.json` is not a
  documented interface (observed on 2.1.219) and could change shape or move in an upgrade.
  Unrecognized shape → fail open plus a visible one-line note. If it disappears entirely,
  the folder half degrades to a recency guess over the edit log and the ticket half stops
  working.
- **One machine, one user.** Nothing here survives a second machine; all sessions are
  assumed to share `~/.claude`.

## 8. Changes across review rounds

**From v1, after round 1:**

1. Ticket regex relaxed to `/\bGEN[\s-]?(\d+)\b/gi`; **all** ids in a prompt collected.
2. Presence map **accumulates** instead of overwriting, so a long session's ticket is not
   evicted by a passing mention; named-vs-worked ambiguity stated and reflected in the
   warning's wording.
3. Presence map written **atomically** (temp + rename, re-read-and-merge); race test added.
4. The **120-minute folder window removed** — replaced by liveness-as-gate bounded by the
   other session's lifetime. Removed an unjustified number and a reintroduced TTL mismatch.
5. Ticket half gained **dedupe with a re-arm rule**.
6. The noise log gained a **named reader** (follow-up ticket + three-week self-trigger,
   filed at install); the unmeasurable "waved off twice" bar dropped.
7. Liveness algorithm spelled out, including pid-reuse via `procStart`; "project folder"
   defined as this session's own `cwd`.
8. Edit-log read **bounded** by the earliest live session's `startedAt`.
9. Negative control reworded to "a different subfolder inside the same project"; pid-reuse
   and dedupe controls added; a re-measure step added before build.
10. §2 measurements labelled point-in-time with observed drift; GEN-620-sourced figures
    marked ticket-reported, and §3 made numerically independent of them.
11. §5 gained two unconsidered alternatives (extending an existing `inject-*-refs.js` hook;
    mtimes/git for folder presence).
12. §7 gained the named-≠-worked and sub-agent/resumed-session residuals.

**From v2, after round 2:**

13. **The `cwd` filter no longer applies to the ticket half.** Liveness (`liveSessions()`,
    pid + `procStart`, no folder filter) is shared by both halves and by every prune;
    folder narrowing (`sameFolderSessions()`) belongs to the folder half alone. v2 would
    have missed a genuine cross-project same-ticket collision — GEN numbering is global
    across all three projects — and, worse, a hook running in one project could have
    deleted a live session's registration from another project as "not live". A
    cross-project test case now proves it.
14. **The 24-hour map expiry is gone.** Registrations live exactly as long as their
    session, pruned by liveness alone. The age cutoff was the TTL mismatch of §1 sneaking
    back into the ticket half, and it carried no justification. A "live session, day-old
    registration, still warns" test now guards it. Liveness pruning also bounds the file
    (one entry per live session), which is what the expiry was nominally for.
15. **Folder half gained a re-arm**, symmetric with the ticket half — v2 would have gone
    silent for a pair that kept writing new files for hours.
16. **Dedupe state location specified:** a per-session file in the OS temp dir, following
    `inject-edit-refs.js`, rather than the shared presence map — private state, so no merge
    and no race.
17. The **30-minute re-arm is labelled a judgment call**, not evidence-derived.
18. Sub-agent and resumed-session attribution promoted from "in spirit" to an explicit §6
    test case.
