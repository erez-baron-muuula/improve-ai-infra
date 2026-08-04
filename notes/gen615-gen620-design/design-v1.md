# GEN-615 + GEN-620 — one concurrent-session awareness mechanism

**Status:** proposal v1, formed 2026-08-03, not yet reviewed, not applied.
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

## 2. What is actually available (measured 2026-08-03, this machine)

The blocker both tickets named — "the two id spaces do not line up, so matching stays
heuristic" — is real for the tool GEN-615 was looking at, and irrelevant to the design,
because a different source shares the edit log's id space exactly.

| Source | Contents | Verified |
|---|---|---|
| `~/.claude/sessions/<pid>.json` | one file per **live** session: `pid`, `sessionId`, `cwd`, `startedAt`, `procStart`, `entrypoint`, `name`, `version` | 6 files / 6 live pids; 0 stale |
| `~/.claude/hooks/auto-approved-edits.jsonl` | append-only `{ts, tool, file, existed, session}` per approved edit | 1,171 events; `session` = the same `sessionId` |
| `~/.claude/projects/<slug>/<sessionId>.jsonl` | that session's transcript | same id again; up to 11 MB |
| `mcp__ccd_session_mgmt__list_sessions` | `local_<uuid>` ids + titles | **0** of 200 ids intersect the 171 log ids — different id space; also an MCP tool, so a hook cannot call it |

So: `sessions/*.json` ⋈ `auto-approved-edits.jsonl` on `sessionId` is an **exact join**,
no title-and-timing inference. Liveness is a real `pid` check, not a TTL guess —
which answers the specific objection that killed locking, for *awareness* purposes.

Two measured limits the design must respect:

1. **Ticket detection must read only what Erez typed.** Counting `GEN-\d+` across a
   transcript tail is swamped by injected rule text: GEN-58 scored 146 hits in one live
   session and appears at the top of 4 of 6 sessions, because standing rules mention it
   every turn. (Also: transcripts reach 11 MB, so no hook may read one whole.)
2. **The edit log sees harness edits only** — 1,151 `Edit` + 20 `Write`, and nothing
   else. A shell-based write (`Set-Content`, `git checkout`, a redirect) is invisible to
   it. This is a coverage gap, not a design choice; stated as a residual in §7.

## 3. The design

One new hook file, `~/.claude/hooks/concurrent-session-warn.js`, registered on two
events. Both halves ask the same question — *"which other live session is on my key, and
how recently?"* — and differ only in the key: **ticket id** for GEN-615, **folder** for
GEN-620. One reader, one liveness check, one warning format, two keys.

### 3a. Ticket half (GEN-615) — `UserPromptSubmit`

Self-registering presence, so no transcript parsing is ever needed:

1. If Erez's prompt matches `\bGEN-\d+\b`, take the **last** such id as this session's
   current ticket. (Prompt text only — never injected context — which sidesteps limit 1
   above by construction.)
2. Read `~/.claude/hooks/session-tickets.json`: a small map `sessionId → {ticket, ts}`.
   Drop every entry whose session is no longer live (`pid` gone, or `procStart` mismatch
   → pid reuse).
3. If a **live** other session is recorded on the same ticket, inject a warning naming
   its ticket, how long it has been on it, and its session name. Otherwise inject
   nothing.
4. Record this session's own `{ticket, ts}` and write the map back.

Precedent for the trigger and the cue: `inject-notion-refs.js` already fires on
`UserPromptSubmit` and already uses `/\bGEN-\d+\b/` as a prompt cue.

### 3b. Folder half (GEN-620) — `PreToolUse` on `Read|Edit|Write|NotebookEdit`

No new writer needed — the edit log already *is* the folder presence signal:

1. Take the target file's **containing folder**. Skip unless it is inside a known project
   folder. Never widen to "the same project" — GEN-620 measured that a project-level
   trigger would fire on ~1 folder-entry in 5.
2. Ignore log entries for files with their own protection — `HISTORY.md` above all: 38 of
   the 41 measured project-root overlaps were `HISTORY.md`, it is already serialized by
   the GEN-218 locked appender, and sessions touch it only at wrap-up.
3. Warn if another **live** session wrote in that same folder within the last **120
   minutes**, naming the files and the most recent time. 120 rather than GEN-620's 30 is
   deliberate: measured subfolder collisions at 30 min were **0** in seven weeks, so the
   window is not the noise source, and the long-idle-gap case is exactly the one that
   matters (the GEN-443 incident ran for hours).
4. Dedupe per `(folder, other session)` — once per pair per session, not once per session
   (per-session would warn about the first folder and stay silent for every later one).

Precedent for the trigger: `inject-edit-refs.js` already fires `PreToolUse` on exactly
`Read|Edit|Write|NotebookEdit`, and includes `Read` deliberately — which is what makes the
*read-into-an-actively-rewritten-folder* failure GEN-620 targets reachable at all.

### 3c. Shared

- **Fails open, always.** Any missing file, malformed JSON, unrecognized shape → inject
  nothing, never block the prompt or the tool call. Same posture as the four existing
  `inject-*-refs.js` hooks.
- **No CLAUDE.md growth.** The instruction to stop and ask travels *inside* the injected
  text, at the only moment it is relevant. Nothing is added to the always-loaded file,
  which GEN-86 is actively shrinking.
- **No new always-loaded rule, no new skill step.**

## 4. What the warning says (the surfacing path)

Injected text, on the ticket half:

> **Concurrent session warning.** Session "Gen 152 and 621 cleanup" (started 14:02, still
> live) has been working **GEN-152** since 14:11 — the ticket this prompt names. Before
> doing substantive work on it, surface this in the "📌 For you" block and ask Erez which
> session owns the work. Reading or discussing the ticket is fine.

and on the folder half:

> **Concurrent session warning.** Session "improve-ai-infra-bd" (live) wrote
> `notes/gen508-piece1/design-converged.md` in this folder 4 minutes ago. Files here may
> be mid-rewrite — treat what you read as possibly partial, and surface this in the
> "📌 For you" block before relying on it.

**Who reads the signal, and when:** the model, in the turn it fires, and Erez in that
turn's "📌 For you" block — a routine he already sees every turn. No new place to look.

**Measuring whether it is noise:** each firing appends one line to
`~/.claude/hooks/concurrent-session-warnings.jsonl` (`{ts, half, key, otherSession,
sessionId}`). **Re-evaluate bar:** if the folder half fires more than about once a week,
or Erez waves either half off twice, revisit the window and the exclusions before
trusting it further. Without that line the "is this noise?" question is unanswerable
after the fact, since a warning that is dismissed leaves no trace.

## 5. Why not the alternatives

- **An always-loaded CLAUDE.md rule** ("before substantive work on a ticket, check for
  another session"). *Strongest case for it:* no code, no vetting flow, and it covers what
  a prompt cue cannot — work that arises mid-turn without ever being named in a prompt.
  It also fires on judgment at exactly the right moment. *Why not:* it depends on
  remembering, which is precisely what failed on 2026-08-02 — the information was
  available from the first turn and nothing prompted anyone to look. It also grows the
  file GEN-86 is shrinking, and makes the join manual (and therefore sloppy) every time.
- **A `SessionStart` hook warning about same-folder sessions** — the form GEN-615
  originally floated. *Strongest case for it:* the simplest possible mechanism, zero
  judgement, no prompt parsing, no keys. *Why not:* measured noise. Six live sessions sit
  in this one project folder right now, so it would warn at every session start while
  being unable to say whether any of them is on the same work — the option most likely to
  be tuned out, which is worse than nothing because it teaches Erez to ignore the channel.
- **Advisory lock files per ticket or folder.** *Strongest case for it:* it would actually
  prevent the collision instead of describing it, and `procStart`-checked pid liveness
  answers the stale-lock objection that GEN-620 raised. *Why not:* blocking is the wrong
  shape here — Erez deliberately runs several sessions per project, and a false lock stops
  real work. Both tickets ask to be *told*.
- **`list_sessions` + title matching**, as GEN-615 assumed. *Why not:* 0 of 200 ids join
  the edit log, so it cannot say *what* the other session touched; and it is an MCP tool,
  so no hook can call it. Its titles are richer, but the presence map in §3a gets the same
  fact exactly.

## 6. Build order

1. Write the shared reader + both halves in one file (~150 lines, one artifact).
2. `/vet-code` it — mandatory for a new hook: `/check`, two code-review passes, then the
   single-use vetting pass.
3. Register both events in `settings.json` via `update-config.ps1` (locked file).
4. **Verify by construction, not by waiting.** A correctly-scoped folder warning would
   have fired 0 times in seven weeks, so acceptance cannot be "wait for it to fire"
   (this supersedes GEN-620's "verified by Erez in a real two-session sitting"):
   - *ticket half:* two sessions, same project, second prompt names a ticket the first
     recorded → warning appears.
   - *folder half:* session A edits a file in a subfolder, session B then reads a file in
     the same subfolder → warning appears naming A's file and time.
   - *negative controls:* different tickets → silent; different folders → silent;
     `HISTORY.md` → silent; a dead session's record → silent.
5. Close GEN-615 and GEN-620 on that demonstration.

## 7. Honest residual — what this does NOT solve

- **It warns; it does not prevent.** If Erez says proceed, both sessions still run. That
  is the deliberate choice both tickets asked for, not an oversight.
- **Shell-based writes are invisible.** The edit log carries `Edit`/`Write` only
  (1,151 + 20, nothing else). A session rewriting a file via `Set-Content`, a redirect, or
  `git checkout` produces no folder signal at all. GEN-218's file-level protection is
  likewise not extended by this.
- **Ticket detection is prompt-cued, so a mid-turn pivot is uncovered.** If work turns to
  a ticket that was never typed in a prompt, the ticket half stays silent — the same known
  limit as `inject-notion-refs.js`, documented there.
- **Reads are still unlogged.** This tells you another session *wrote* nearby; it cannot
  tell that session that *you* are reading its half-finished file. The exposure GEN-620
  describes is measured in one direction only.
- **It leans on an internal Claude Code file.** `~/.claude/sessions/<pid>.json` is not a
  documented interface (observed on 2.1.219) and could change shape or move in an upgrade.
  Mitigation: unrecognized shape → fail open silently, and inject a one-line "session
  registry unreadable" note so the degradation is visible rather than silent. If it
  disappears entirely, the folder half still works off the edit log alone, with liveness
  degraded to a recency guess; the ticket half stops working.
- **One machine, one user.** Nothing here survives a second machine, and it assumes all
  sessions share `~/.claude`.
