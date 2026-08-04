# GEN-615 + GEN-620 — one concurrent-session awareness mechanism (v4)

**Status:** proposal v4, 2026-08-03. Not applied. Awaiting Erez's approval.
**Review:** `/check` ran three rounds (the cap). Every round-1 and round-2 finding was
resolved and confirmed resolved by the reviewers. Round 3 returned one PASS and two
further findings, both of which I agreed with and fixed here — **after** the cap, so v4
itself has not been through another panel. §9 records this.
**Supersedes:** `design-v1.md`, `-v2.md`, `-v3.md` (kept for the record). §8 lists changes.
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
| `~/.claude/sessions/<pid>.json` | one file per **live** session: `pid`, `sessionId`, `cwd`, `startedAt`, `entrypoint`, `name`, `version`, and **sometimes** `procStart` |
| `~/.claude/hooks/auto-approved-edits.jsonl` | append-only `{ts, tool, file, existed, session}` per approved edit; `session` = the same `sessionId` |
| `~/.claude/projects/<slug>/<sessionId>.jsonl` | that session's transcript — same id again |
| `mcp__ccd_session_mgmt__list_sessions` | `local_<uuid>` ids + titles — **different id space**, and an MCP tool a hook cannot call |

**`procStart` is optional in practice** — measured across all 7 live session files, it is
present in exactly **one** (`24020.json`) and absent from the other six, all reporting
version 2.1.219, with no relation to start order. v3 required it to match for a session to
count as live; that would have classified six of seven live sessions as dead, leaving both
halves permanently silent. §3a now treats it as an optional extra check.

Measurements taken 2026-08-03, each a **point-in-time snapshot**. Several drifted during
review — the edit log went 1,171 → 1,187 events (`Write` 20 → 23) and live sessions 6 → 7.
Nothing is load-bearing at runtime: the hook reads live state on every call, and §6 step 0
re-measures before build.

- `sessions/*.json`: 7 files, 7 live pids, 0 stale; all 7 share one `cwd`.
- Edit log: 1,187 events; tool tally **Edit 1,164 / Write 23 and nothing else**.
- Id spaces: 0 of 200 session-list ids intersect the 171 edit-log session ids.
- Transcripts: 0.1–11.0 MB across the live sessions.
- `GEN-\d+` over the last 120 transcript lines per live session: GEN-58 is the top hit in
  4 of 6 (146 in one), because standing rules mention it every turn.

Corroborated three times independently during review: a `sessions/*.json` `sessionId`
matching the edit-log `session` of the same session's own writes — a live worked example of
the join the design rests on.

Figures quoted from the **GEN-620 ticket body** (41 project-root collisions at a 30-minute
window, 38 of them `HISTORY.md`, 0 subfolder collisions in seven weeks) are **reported by
that ticket, not re-measured here**. No part of §3 depends on them numerically; they
support only the qualitative claims that collisions are rare and `HISTORY.md` dominates the
noise.

Two measured limits the design must respect:

1. **Ticket detection must read only what Erez typed** — the GEN-58 pollution above is
   what a transcript-scanning approach would drown in. (Also: 11 MB transcripts, so no
   hook may read one whole.)
2. **The edit log sees harness `Edit`/`Write` only.** A shell-based write (`Set-Content`,
   a redirect, `git checkout`) is invisible to it. Residual, §7.

## 3. The design

One new hook file, `~/.claude/hooks/concurrent-session-warn.js`, registered on two events.
Both halves ask the same question — *"which other live session is on my key, and how
recently?"* — and differ in the key: **ticket id** for GEN-615, **folder** for GEN-620.

### 3a. Liveness — `liveSessions()`, one function, used by both halves

1. Read every `~/.claude/sessions/*.json` fresh (small directory; 7 files today).
2. A session is **live** if its `pid` still exists. If — and only if — the file carries a
   `procStart`, additionally require the running process's start time to match it; a
   mismatch is pid reuse, not a live session. An **absent** `procStart` means live-if-pid-
   exists, accepting a narrow pid-reuse false positive. That is the only alternative to
   being blind: the field is present in 1 of 7 files today (§2).
3. **No `cwd` filter, and no self-exclusion, in this set.** It is the set of *live
   sessions*, and it is what every prune consults. Self and other projects are excluded
   only where that is meaningful — at warn time (§3b step 3, §3c step 3).
4. Unreadable directory, or files present but none parseable → inject a one-line "session
   registry unreadable" note and stop. Degraded, but visibly so.

Two failure modes this wording exists to prevent, both found in review:

- Folding self-exclusion into `liveSessions()` while using that set to prune means every
  session deletes **its own** live registration on every prompt, keeping only the current
  prompt's tickets — so a session that names GEN-443 once and then works it for two hours
  through "proceed" and "yes" is unregistered five minutes later, and the incident in §1
  replays with no warning.
- Requiring `procStart` to match when it is usually absent makes every such session read as
  dead: no warning ever fires, and live registrations get pruned.

### 3b. Ticket half (GEN-615) — `UserPromptSubmit`

Self-registering presence, so no transcript parsing is ever needed:

1. Match Erez's prompt with `/\bGEN[\s-]?(\d+)\b/gi` — case-insensitive and space-tolerant,
   because he writes "gen 615" as often as "GEN-615" (this session's opening message did).
   Collect **every** id in the prompt, not just the last.
2. Read `~/.claude/hooks/session-tickets.json`:
   `sessionId → { pid, tickets: { "GEN-615": lastNamedTs } }`.
   - **Accumulate, never overwrite.** A session working GEN-443 for hours that mentions
     GEN-88 once in passing keeps both, each with its own timestamp.
   - **Prune by liveness only** — an entry goes when its `sessionId` is absent from
     `liveSessions()`, i.e. its process is gone. **No age-based expiry**: a registration
     lives exactly as long as its session. An untouched entry belongs to a session either
     still alive (so it still matters) or dead (so liveness removes it). Same reasoning that
     removed the folder window; it also bounds the file — at most one entry per live session.
   - `liveSessions()` includes self and every project, so pruning can never delete this
     session's own entry, nor a live session's entry in another project folder.
3. For each ticket in this prompt, if a live **other** session has that ticket in its set,
   inject a warning naming that session, which ticket, and **when it last named it** —
   recency as information, not a hidden filter. Ticket ids are global Team-Tasks ids
   spanning all three projects, so **no folder filter applies here**: a same-ticket
   collision across two project folders is a real collision.
4. Record this session's ids and write the map back **atomically**: re-read, merge, write a
   temp file in the same directory, `rename()` over the target. Without this, two sessions
   starting on the same ticket within one hook's execution can each read before either
   writes and the loser's entry vanishes — silently producing the double-work this exists to
   prevent. `rename()` is atomic, so no reader sees a partial file; a vanishingly narrow
   lost-update window remains (both re-read before either renames) and is accepted, since
   the consequence is one missed warning, not corruption.
5. **Dedupe:** warn once per `(ticket, other sessionId)` pair; re-arm only when that
   session's `lastNamedTs` for the ticket has advanced ≥30 minutes past the last warning
   shown. Without dedupe the warning refires on every prompt for the whole overlap — the
   "teaches Erez to ignore the channel" failure this design rejects `SessionStart` for.
   **The 30 minutes is a judgment call, not derived from evidence**; it sets only the
   re-warning cadence, never whether the first warning fires.

**What this can and cannot distinguish.** A prompt naming a ticket means *named*, not
necessarily *worked* — "what's the status of GEN-88?" registers GEN-88. The warning reports
only what it can stand behind ("that session named this ticket, most recently N minutes
ago") and leaves ownership to Erez. Accumulation keeps the false-negative direction closed;
a false positive costs one question. With no age bound, expect stale mentions to dominate
the ticket half's firing rate — which is what §4's noise review is for.

Precedent: `inject-notion-refs.js` already fires on `UserPromptSubmit` and already uses
`/\bGEN-\d+\b/` as a prompt cue, reading only `data.prompt`.

### 3c. Folder half (GEN-620) — `PreToolUse` on `Read|Edit|Write|NotebookEdit`

No new writer needed — the edit log already *is* the folder presence signal:

1. Take the target file's **containing folder**; proceed only if it is inside this session's
   `cwd`. Never widen to the project as a whole — GEN-620 measured that a project-level
   trigger would fire on roughly one folder-entry in five.
2. Ignore entries for files with their own protection — `HISTORY.md` above all: 38 of the 41
   measured project-root overlaps, already serialized by the GEN-218 locked appender, and
   touched only at wrap-up.
3. **Liveness is the gate; recency is information.** Warn if any **live other session** (per
   §3a) wrote in that folder at any point **since that session started**, naming the files
   and the most recent time. No time window: a fixed cutoff would reintroduce the TTL
   mismatch of §1 — a session idle three hours mid-rewrite is exactly the case that matters
   — and bounding by the other session's own lifetime needs no invented number and cannot
   miss its work.
   **The writer's own `cwd` is not tested.** The folder match comes from the log entry's
   file path, so testing the writer's `cwd` as well would add nothing to scoping and would
   hide real cross-project writes — the edit log contains a session writing `CLAUDE.md` in
   two different project roots, at least one of them outside its own `cwd`. Dropping that
   test is both more correct and less machinery: v3's separate `sameFolderSessions()` helper
   is retired, leaving §3a's single function.
4. Read the log **bounded**: entries at or after the earliest `startedAt` among live
   sessions, **and** a hard cap on lines scanned (tail-scan, stop at whichever comes
   first). The log is append-only and unbounded (1,187 lines today), all live sessions
   currently share one `cwd`, and this runs on every file tool call — the `startedAt` bound
   alone would often mean scanning most of the log.
5. **Dedupe with re-arm**, symmetric with the ticket half: once per `(folder, other
   sessionId)` pair, re-armed when that session's most recent write in the folder has
   advanced ≥30 minutes past the last warning shown. v2 had no re-arm here, which would
   have gone silent for a pair that kept writing new files for hours.

**Where dedupe state lives.** Not in `session-tickets.json` — that file is shared presence
data, and warned-state is private to the session doing the warning. Both halves keep it in
one small per-session file in the OS temp directory, named from `session_id` **sanitized to
safe characters** (`claude-concsess-<safeId>.json`), holding `pair → lastWarnedTs`, exactly
as `inject-edit-refs.js` builds its marker name. Private state means no cross-session merge.
It is not race-free: the harness issues parallel tool calls, so two `PreToolUse` hooks of
the *same* session can write it concurrently — accepted, because the consequence is one
duplicated or one missed warning, self-correcting on the next write. On Windows `%TEMP%`
is not cleared on reboot, so a stale file may outlive its session; harmless, since it is
keyed by `sessionId` and a new session gets a new name.

Precedent: `inject-edit-refs.js` already fires `PreToolUse` on exactly
`Read|Edit|Write|NotebookEdit`, including `Read` deliberately — which is what makes the
*read-into-an-actively-rewritten-folder* failure GEN-620 targets reachable at all. Note
`NotebookEdit` never appears in the edit log (Edit/Write only), so it can trigger a check
but will never be the cause of one.

### 3d. Shared

- **Fails open, always.** Missing file, malformed JSON, unrecognized shape → inject nothing,
  never block the prompt or the tool call. Same posture as the four existing
  `inject-*-refs.js` hooks.
- **No CLAUDE.md growth, no new rule, no new skill step.** The instruction to stop and ask
  travels *inside* the injected text, at the only moment it is relevant — nothing is added
  to the always-loaded file that GEN-86 is actively shrinking.

## 4. What the warning says, and who reads the signal

Ticket half:

> **Concurrent session warning.** Live session "Gen 152 and 621 cleanup" (started 14:02)
> last named **GEN-152** 8 minutes ago — a ticket this prompt names. Before doing
> substantive work on it, surface this in the "📌 For you" block and ask Erez which session
> owns the work. Reading or discussing the ticket is fine.

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
- **Re-evaluate bar:** if the folder half has fired more than about once a week, tighten the
  scope or exclusions before trusting it further; if the ticket half has fired more than a
  handful of times with no real collision behind it, revisit whether a prompt mention is too
  loose a cue.
- v1's "Erez waves it off twice" leg is dropped: nothing in the log records a dismissal, so
  it was unmeasurable. If he asks for it to stop, that needs no log.

## 5. Why not the alternatives

- **An always-loaded CLAUDE.md rule.** *Strongest case:* no code, no vetting flow, and it
  covers what a prompt cue cannot — work arising mid-turn, never named in a prompt. It fires
  on judgment at exactly the right moment. *Why not:* it depends on remembering, which is
  what failed on 2026-08-02 — the information was available from the first turn and nothing
  prompted anyone to look. It grows the file GEN-86 is shrinking, and makes the join manual,
  and therefore sloppy, every time.
- **A `SessionStart` hook warning about same-folder sessions** — GEN-615's original guess.
  *Strongest case:* simplest possible, zero judgement, no keys, no parsing. *Why not:*
  measured noise. Seven live sessions sit in this one project folder right now, so it would
  warn at every session start while unable to say whether any is on the same work — the
  option most likely to be tuned out, which is worse than nothing because it teaches Erez to
  ignore the channel.
- **Advisory lock files per ticket or folder.** *Strongest case:* it would prevent the
  collision rather than describe it. *Why not:* blocking is the wrong shape — Erez
  deliberately runs several sessions per project, and a false lock stops real work. Both
  tickets ask to be *told*.
- **Extend an existing `inject-*-refs.js` hook instead of adding a file.** *Strongest case:*
  no new registration, one fewer file to vet. *Why not:* those hooks are pure data-injection
  with no state; this one holds a shared map and a warnings log. A bug in the state handling
  would take the reference-note injection down with it. Vetting cost is roughly a wash, so
  separation wins on blast radius.
- **Folder presence from filesystem mtimes or git instead of the edit log.** *Strongest
  case:* it would catch the shell-based writes the log misses (§7). *Why not:* neither
  carries **which session** wrote, which is the whole point — a warning that cannot name the
  other session is not actionable.
- **`list_sessions` + title matching**, as GEN-615 assumed. *Why not:* 0 of 200 ids join the
  edit log, so it cannot say what the other session touched, and no hook can call an MCP
  tool. Its titles are richer; the presence map gets the same fact exactly.

## 6. Build order

0. **Re-measure** the §2 snapshots immediately before writing code — several drifted during
   review, and `procStart`'s presence rate is worth re-checking after any version bump.
1. Write liveness plus both halves in one file (~170 lines).
2. `/vet-code` it — mandatory for a new hook: `/check`, two code-review passes, then the
   single-use vetting pass.
3. Register both events in `settings.json` via `update-config.ps1` (locked file).
4. **Verify by construction, not by waiting.** A correctly-scoped folder warning would have
   fired 0 times in seven weeks, so acceptance cannot be "wait for it to fire" — this
   supersedes GEN-620's "verified by Erez in a real two-session sitting":
   - *ticket half:* two sessions; the second names a ticket the first registered → warning
     appears, naming the other session and when it last named it.
   - *ticket half, cross-project:* the two sessions in **different** project folders, same
     ticket → warning still appears (proves no folder filter leaked into the ticket half).
   - *ticket half, self-preservation:* a session names a ticket, then sends several prompts
     that name none → its own registration survives, and a second session naming that ticket
     still gets warned.
   - *ticket half, accumulation:* first session names ticket A, then B in passing; second
     session names A → warning still appears.
   - *ticket half, no age expiry:* a live session whose registration is over a day old →
     still warns.
   - *ticket half, race:* two prompts naming the same ticket as close together as can be
     managed → both entries survive.
   - *ticket half, dedupe:* same overlap across several prompts → warns once; re-warns after
     the other session re-names the ticket ≥30 minutes later.
   - *folder half:* session A edits a file in a subfolder; session B then **reads** a
     different file in that same subfolder → warning appears naming A's file and time.
   - *folder half, re-arm:* A keeps writing new files past the re-arm interval → B warns
     again rather than staying silent for the rest of the session.
   - *liveness, absent `procStart`:* a session file without the field is treated as **live**
     (6 of 7 files today) → warnings fire normally.
   - *attribution:* a sub-agent's tool call inside one session does **not** produce a
     self-warning; a resumed session's new pid pairs correctly with its existing
     `sessionId`. Both are currently unverified (§7) and must be settled here.
   - *negative controls:* different tickets → silent; **a different subfolder inside the same
     project** → silent (this, not "a different project", tests folder-not-project scoping);
     `HISTORY.md` → silent; a dead session's leftover record → silent; a **reused pid** whose
     `procStart` disagrees → silent (runnable only against a file that carries the field).
   - **Exercising the two ≥30-minute cases without waiting 30 minutes:** pre-seed
     `lastWarnedTs` in the per-session dedupe file, or run with a temporary threshold
     override. Say which was used in the vetting record — otherwise these two get skipped and
     the re-arm path ships unexercised.
5. **File the noise-review follow-up ticket** (§4) with its three-week self-trigger, at
   install time — not after.
6. Close GEN-615 and GEN-620 on that demonstration.

## 7. Honest residual — what this does NOT solve

- **It warns; it does not prevent.** If Erez says proceed, both sessions still run. That is
  what both tickets asked for, not an oversight.
- **Shell-based writes are invisible.** The edit log carries `Edit`/`Write` only. A session
  rewriting a file via `Set-Content`, a redirect, or `git checkout` produces no folder signal
  at all. GEN-218's file-level protection is likewise not extended by this.
- **Ticket detection is prompt-cued, so a mid-turn pivot is uncovered** — work that turns to
  a ticket never typed in a prompt stays silent. Same known limit as `inject-notion-refs.js`.
- **Named ≠ worked**, and with no age bound, stale mentions will likely dominate the ticket
  half's firing rate. A false positive costs one question to Erez.
- **Reads are still unlogged.** This tells you another session *wrote* nearby; it cannot tell
  that session that *you* are reading its half-finished file. GEN-620's exposure is covered in
  one direction only.
- **Pid reuse is only guarded where `procStart` exists** — 1 of 7 files today. Elsewhere a
  reused pid could make a dead session look live, costing a spurious warning.
- **A vanishingly narrow lost-update window survives the atomic write**, and the per-session
  dedupe file can be written concurrently by parallel tool calls of the same session. Both
  cost at most one duplicated or missed warning, never corruption.
- **Sub-agent and resumed-session attribution is unverified** — on the §6 list, to be settled
  at build; as of now unknown, not proven safe.
- **It leans on an internal Claude Code file.** `~/.claude/sessions/<pid>.json` is not a
  documented interface (observed on 2.1.219, and already inconsistent in whether it carries
  `procStart`) and could change shape or move in an upgrade. Unrecognized shape → fail open
  plus a visible one-line note. If it disappears entirely, the folder half degrades to a
  recency guess over the edit log and the ticket half stops working.
- **One machine, one user.** Nothing here survives a second machine; all sessions are assumed
  to share `~/.claude`.

## 8. Changes across review rounds

**From v1, after round 1:** regex relaxed to `/\bGEN[\s-]?(\d+)\b/gi` and all ids in a prompt
collected; presence map accumulates instead of overwriting; atomic temp+rename write; the
**120-minute folder window removed** in favour of liveness-as-gate; ticket-half dedupe with
re-arm added; the noise log given a named reader and the unmeasurable "waved off twice" bar
dropped; liveness spelled out; edit-log read bounded; negative control reworded to "a
different subfolder inside the same project"; §2 figures labelled point-in-time and the
GEN-620-sourced ones marked ticket-reported; §5 gained the extend-an-existing-hook and
mtimes/git alternatives; §7 gained the named-≠-worked and sub-agent residuals.

**From v2, after round 2:** the `cwd` filter no longer applies to the ticket half (GEN ids are
global across the three projects, and pruning through a folder-filtered set could delete
another project's live registration); the **24-hour map expiry removed** — registrations live
as long as their session; folder half gained a re-arm; dedupe state moved to a per-session temp
file; the 30-minute re-arm labelled a judgment call; sub-agent/resumed-session promoted to an
explicit test.

**From v3, after round 3:**

1. **`procStart` is now optional.** Measured: present in 1 of 7 live session files. v3
   required it to match, which would have read six of seven live sessions as dead and left
   both halves permanently silent — the mechanism would have shipped inert. Now: live if the
   pid exists; `procStart` checked only when present. New test for a file without the field;
   pid-reuse exposure moved to §7.
2. **Self-exclusion removed from `liveSessions()`.** v3 excluded self from the set that
   *pruning* consults, so every session would have deleted its own registration on every
   prompt and kept only the current prompt's tickets — the §1 incident replaying silently.
   Self and other-project exclusion now happen only at warn time. New self-preservation test.
3. **The folder half no longer tests the writer's `cwd`.** The folder match already comes from
   the log entry's path; testing the writer's `cwd` hid real cross-project writes (the log
   shows one session writing `CLAUDE.md` in two project roots). Retires v3's
   `sameFolderSessions()` — less machinery and more correct.
4. Hard line cap added to the edit-log tail-scan; temp filename sanitized; the same-session
   dedupe-file race and Windows `%TEMP%` persistence accepted explicitly; a method given for
   exercising the two ≥30-minute tests without waiting.

## 9. Review status — stated plainly

Rounds 1 and 2 each produced material findings; all were fixed and confirmed resolved by the
reviewers in the following round. Round 3 — the cap — returned **PASS** from the
proportionality lens and **REVISE** from the failure-mode lens, with the two findings now
fixed as §8's round-3 items, plus the folder-`cwd` simplification the proportionality lens
raised as advisory. I verified the `procStart` claim myself before acting on it (1 of 7 files).

So: **this design did not converge inside the three-round cap.** v4's fixes have not been
independently reviewed. All three round-3 items are small and self-contained, and the fixes
each remove a mechanism rather than add one — but that is my judgment, not a reviewer's. If
Erez wants independent confirmation before build, the `/vet-code` flow in §6 step 2 runs its
own `/check` on the implementation anyway, which is the natural place for it.
