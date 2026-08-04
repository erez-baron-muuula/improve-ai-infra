# GEN-615 + GEN-620 — one concurrent-session awareness mechanism (v2)

**Status:** proposal v2, revised 2026-08-03 after `/check` round 1. Not applied.
**Supersedes:** `design-v1.md` (kept for the record). Changes from v1 are listed in §8.
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
stands and this design does not revisit it.

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

Measurements taken 2026-08-03 on this machine, each a **point-in-time snapshot** (two
already drifted during review — the edit-log `Write` count moved 20→21 because writing
this very document logged an entry, and the live-session count moved 6→7 when a new window
opened). None is load-bearing at runtime — the hook reads live state on every call — and
§6 step 0 re-measures before build:

- `sessions/*.json`: 6 files, 6 live pids, 0 stale.
- Edit log: 1,171 events, 171 distinct sessions; tool tally **Edit 1,151 / Write 20 and
  nothing else**.
- Id spaces: 0 of 200 session-list ids intersect the 171 edit-log session ids.
- Transcripts: 0.1–11.0 MB across the 6 live sessions.
- `GEN-\d+` over the last 120 transcript lines per live session: GEN-58 is the top hit in
  4 of 6 (146 in one), because standing rules mention it every turn.

Independently corroborated during review: `sessions/1180.json` carries
`sessionId: bd0001a6-…`, and the edit-log line for this document's own creation carries
`session: bd0001a6-…` — a live worked example of the exact join the design rests on.

Figures quoted from the **GEN-620 ticket body** (41 project-root collisions at a 30-minute
window, 38 of them `HISTORY.md`, 0 subfolder collisions in seven weeks, 1,101 events /
171 sessions) are **reported by that ticket, not re-measured here**. §3b no longer depends
on any of them numerically — see the window change below — so they now support only the
qualitative claims that collisions are rare and `HISTORY.md` dominates the noise.

Two measured limits the design must respect:

1. **Ticket detection must read only what Erez typed** — the GEN-58 pollution above is
   what a transcript-scanning approach would drown in. (Also: 11 MB transcripts, so no
   hook may read one whole.)
2. **The edit log sees harness `Edit`/`Write` only.** A shell-based write (`Set-Content`,
   a redirect, `git checkout`) is invisible to it. Residual, §7.

## 3. The design

One new hook file, `~/.claude/hooks/concurrent-session-warn.js`, registered on two
events. Both halves ask the same question — *"which other live session is on my key, and
how recently?"* — and differ only in the key: **ticket id** for GEN-615, **folder** for
GEN-620. One liveness reader, one warning format, one dedupe helper, two keys.

### 3a. Shared liveness reader (used by both halves)

Spelled out because the rest depends on it being exact rather than a recency guess:

1. Read every `~/.claude/sessions/*.json` fresh on each call (small directory; 7 files
   today).
2. Build `live = { sessionId → {pid, procStart, startedAt, cwd, name} }`, skipping any
   file whose `pid` no longer exists, or whose running process start time disagrees with
   the recorded `procStart` (that mismatch is pid reuse, not a live session).
3. Skip this session's own `sessionId`, and skip sessions whose `cwd` is not the same
   project folder as this session's `cwd`. **"Project folder" means exactly this
   session's own `cwd`** — no whitelist to maintain.
4. Unrecognized shape or unreadable directory → inject a one-line "session registry
   unreadable" note and stop. Degraded, but visibly so.

### 3b. Ticket half (GEN-615) — `UserPromptSubmit`

Self-registering presence, so no transcript parsing is ever needed:

1. Match Erez's prompt with `/\bGEN[\s-]?(\d+)\b/gi` — case-insensitive and tolerant of
   a space, because he writes "gen 615" as often as "GEN-615" (this very session's opening
   message did). Collect **every** id in the prompt, not just the last.
2. Read `~/.claude/hooks/session-tickets.json`: `sessionId → { pid, procStart, tickets:
   { "GEN-615": lastNamedTs } }`. **Accumulate, never overwrite** — a session working
   GEN-443 for hours that mentions GEN-88 once in passing keeps both entries, with their
   own timestamps, and does not lose its GEN-443 registration. Entries older than 24h are
   dropped, as are entries for sessions no longer live per §3a.
3. For each ticket in this prompt, if a live *other* session has that ticket in its set,
   inject a warning naming that session, which ticket, and **when it last named it** —
   letting recency be information rather than a hidden filter.
4. Record this session's ids and write the map back **atomically**: re-read, merge, write
   a temp file in the same directory, `rename()` over the target. Without this, two
   sessions starting on the same ticket within one hook's execution can each read before
   either writes, and the loser's entry vanishes — silently producing exactly the
   double-work this exists to prevent.
5. **Dedupe:** warn once per `(ticket, other sessionId)` pair. Re-arm only when that other
   session's `lastNamedTs` for the ticket has advanced by ≥30 minutes since the warning
   shown. Without this the warning refires on every prompt for the duration of an
   overlap — the "teaches Erez to ignore the channel" failure this design rejects
   `SessionStart` for in §5.

**What this can and cannot distinguish.** A prompt naming a ticket means *named*, not
necessarily *worked*. Asking "what's the status of GEN-88?" registers GEN-88. The warning
therefore reports a fact it can stand behind — "that session named this ticket, most
recently N minutes ago" — and leaves ownership to Erez, rather than asserting the other
session is working it. Accumulating instead of overwriting keeps the false-negative
direction (losing a real registration) closed; the false-positive direction (a passing
mention) stays open by design and costs one question.

Precedent: `inject-notion-refs.js` already fires on `UserPromptSubmit` and already uses
`/\bGEN-\d+\b/` as a prompt cue, reading only `data.prompt`.

### 3c. Folder half (GEN-620) — `PreToolUse` on `Read|Edit|Write|NotebookEdit`

No new writer needed — the edit log already *is* the folder presence signal:

1. Take the target file's **containing folder**. Proceed only if it is inside this
   session's `cwd`. Never widen to "the same project" as a whole — GEN-620 measured that a
   project-level trigger would fire on roughly one folder-entry in five.
2. Ignore log entries for files with their own protection — `HISTORY.md` above all: it was
   38 of the 41 measured project-root overlaps, it is already serialized by the GEN-218
   locked appender, and sessions touch it only at wrap-up.
3. **Liveness is the gate; recency is information.** Warn if another **live** session (per
   §3a) wrote in that folder at any point **since that session started**, naming the files
   and the most recent time. v1 used a 120-minute window; that number was not supported by
   the evidence cited for it, and worse, a fixed cutoff reintroduces the very
   TTL-versus-work-rhythm mismatch §1 uses to reject locking — a session idle for three
   hours mid-rewrite is precisely the case that matters, and a 2-hour window would have
   gone silent on it. Bounding by the other session's own lifetime needs no invented
   number and cannot miss a live session's own work.
4. Read the log **bounded**: only entries at or after the earliest `startedAt` among live
   same-`cwd` sessions (tail-scan, stop early). The log is append-only and unbounded
   (1,171 lines today), and the same discipline applied to transcripts applies here.
5. **Dedupe** per `(folder, other sessionId)` — once per pair per session, not once per
   session, which would warn about the first folder and stay silent for every later one.

Precedent: `inject-edit-refs.js` already fires `PreToolUse` on exactly
`Read|Edit|Write|NotebookEdit`, and includes `Read` deliberately — which is what makes the
*read-into-an-actively-rewritten-folder* failure GEN-620 targets reachable at all.
Note `NotebookEdit` never appears in the edit log (Edit/Write only), so it can trigger a
check but will never be the *cause* of one.

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

**Primary signal, and its reader.** The warning itself is the signal, and its reader is
Erez, in that same turn's "📌 For you" block — a routine he already sees. Nothing new to
check, no store to consult.

**Secondary signal — is it noise?** Each firing appends one line to
`~/.claude/hooks/concurrent-session-warnings.jsonl` (`{ts, half, key, otherSession,
sessionId}`). This exists only to answer "is this channel becoming noise", which a
dismissed warning otherwise leaves no trace of.

- **Reader and when:** a follow-up ticket, filed *at install time* and assigned to Claude,
  with a self-trigger three weeks out, whose job is to count the lines and compare against
  the bar. Not left to be noticed.
- **Re-evaluate bar:** if the folder half has fired more than about once a week, tighten
  the scope or the exclusions before trusting it further; if the ticket half has fired more
  than a handful of times without a real collision behind it, revisit whether prompt
  mention is too loose a cue.
- v1 also carried an "Erez waves it off twice" leg. Dropped: nothing in the log records a
  dismissal, so that bar was unmeasurable as designed. If he asks for it to stop, that
  needs no log.

## 5. Why not the alternatives

- **An always-loaded CLAUDE.md rule.** *Strongest case:* no code, no vetting flow, and it
  covers what a prompt cue cannot — work arising mid-turn that is never named in a prompt.
  It also fires on judgment at exactly the right moment. *Why not:* it depends on
  remembering, which is what failed on 2026-08-02 — the information was available from the
  first turn and nothing prompted anyone to look. It also grows the file GEN-86 is
  shrinking, and makes the join manual, and therefore sloppy, every time.
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
  case:* no new registration, and one fewer file to vet. *Why not:* those hooks are pure
  data-injection with no state; this one holds a mutable shared map and a warnings log.
  Folding it in would put racy state inside a hook whose whole value is that it cannot
  fail interestingly, and a bug there would take the reference-note injection down with
  it. The vetting cost is roughly a wash, so separation wins on blast radius.
- **Folder presence from filesystem mtimes or git instead of the edit log.** *Strongest
  case:* it would catch shell-based writes the log misses (§7). *Why not:* neither mtime
  nor git carries **which session** wrote, which is the whole point — a warning that
  cannot name the other session is not actionable.
- **`list_sessions` + title matching**, as GEN-615 assumed. *Why not:* 0 of 200 ids join
  the edit log, so it cannot say what the other session touched, and no hook can call an
  MCP tool. Its titles are richer; the presence map gets the same fact exactly.

## 6. Build order

0. **Re-measure** the §2 snapshots immediately before writing code — two drifted during
   review alone.
1. Write the shared liveness reader plus both halves in one file (~180 lines, one artifact).
2. `/vet-code` it — mandatory for a new hook: `/check`, two code-review passes, then the
   single-use vetting pass.
3. Register both events in `settings.json` via `update-config.ps1` (locked file).
4. **Verify by construction, not by waiting.** A correctly-scoped folder warning would
   have fired 0 times in seven weeks, so acceptance cannot be "wait for it to fire" — this
   supersedes GEN-620's "verified by Erez in a real two-session sitting":
   - *ticket half:* two sessions, same project; the second names a ticket the first
     registered → warning appears, naming the other session and when it last named it.
   - *ticket half, accumulation:* first session names ticket A, then names B in passing;
     second session names A → warning still appears (A was not evicted).
   - *ticket half, race:* two prompts naming the same ticket submitted as close together
     as can be managed → both entries survive in the map (this is what the atomic write
     buys; the sequential test above cannot exercise it).
   - *ticket half, dedupe:* same overlap across several prompts → warns once, not every
     turn.
   - *folder half:* session A edits a file in a subfolder; session B then **reads** a
     different file in that same subfolder → warning appears naming A's file and time.
   - *negative controls:* different tickets → silent; **a different subfolder inside the
     same project** → silent (this, not "a different project", is what tests the
     folder-not-project scoping); `HISTORY.md` → silent; a dead session's leftover record
     → silent; a **reused pid** whose `procStart` disagrees → silent.
5. **File the noise-review follow-up ticket** (§4) with its three-week self-trigger, at
   install time — not after.
6. Close GEN-615 and GEN-620 on that demonstration.

## 7. Honest residual — what this does NOT solve

- **It warns; it does not prevent.** If Erez says proceed, both sessions still run. That
  is what both tickets asked for, not an oversight.
- **Shell-based writes are invisible.** The edit log carries `Edit`/`Write` only. A session
  rewriting a file via `Set-Content`, a redirect, or `git checkout` produces no folder
  signal at all. GEN-218's file-level protection is likewise not extended by this.
- **Ticket detection is prompt-cued, so a mid-turn pivot is uncovered** — work that turns
  to a ticket never typed in a prompt stays silent. Same known limit as
  `inject-notion-refs.js`.
- **Named ≠ worked.** A passing mention registers a ticket; the warning reports "last
  named", not "is working". Accumulation closes the false-negative direction; a
  false-positive costs one question to Erez.
- **Reads are still unlogged.** This tells you another session *wrote* nearby; it cannot
  tell that session that *you* are reading its half-finished file. GEN-620's exposure is
  covered in one direction only.
- **Sub-agent and resumed-session attribution is unverified.** Whether a sub-agent's tool
  calls carry the parent's `session_id` (so a session does not warn about itself), and how
  a resumed session's new pid pairs with its existing `sessionId`, were not confirmed —
  both are cheap to establish at build time and are on the §6 test list in spirit, but as
  of now they are unknown, not proven safe.
- **It leans on an internal Claude Code file.** `~/.claude/sessions/<pid>.json` is not a
  documented interface (observed on 2.1.219) and could change shape or move in an upgrade.
  Unrecognized shape → fail open plus a visible one-line note. If it disappears entirely,
  the folder half degrades to a recency guess over the edit log and the ticket half stops
  working.
- **One machine, one user.** Nothing here survives a second machine; all sessions are
  assumed to share `~/.claude`.

## 8. Changes from v1 (all from `/check` round 1)

1. Ticket regex relaxed to `/\bGEN[\s-]?(\d+)\b/gi`; **all** ids in a prompt collected,
   not just the last.
2. Presence map **accumulates** per session instead of overwriting, so a long-running
   session's ticket is not evicted by a passing mention of another. Named-vs-worked
   ambiguity now stated explicitly and reflected in the warning's wording.
3. Presence map written **atomically** (temp + rename, re-read-and-merge); a race test
   added to §6.
4. The 120-minute folder window is **gone** — replaced by liveness-as-gate, bounded by the
   other session's own lifetime. Removes an unjustified number and the reintroduced TTL
   mismatch.
5. Ticket half gains **dedupe with a re-arm rule**, matching the folder half.
6. The noise log now has a **named reader** (a follow-up ticket with a three-week
   self-trigger, filed at install) and the unmeasurable "waved off twice" bar is dropped.
7. Shared **liveness algorithm spelled out** (§3a), including pid-reuse via `procStart`;
   "project folder" defined as this session's own `cwd`.
8. Edit-log read **bounded** by the earliest live session's `startedAt`.
9. §6 negative control reworded to "a different subfolder inside the same project", plus
   pid-reuse and dedupe controls; §6 step 0 re-measures the snapshots before build.
10. §2 measurements labelled as point-in-time with the two observed drifts named; the
    GEN-620-sourced figures marked as ticket-reported, and §3c no longer depends on them
    numerically.
11. §5 gains two alternatives it had not considered: extending an existing
    `inject-*-refs.js` hook, and deriving folder presence from mtimes or git.
12. §7 gains the named-≠-worked and sub-agent/resumed-session residuals.
