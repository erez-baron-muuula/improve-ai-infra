# GEN-615 + GEN-620 — one concurrent-session awareness mechanism (v6)

**Status:** proposal v6, 2026-08-03. Not applied. Awaiting Erez's approval.
**Review:** `/check` rounds 1–5 complete. Round 5 returned **PASS** from the soundness and
proportionality lenses and one material finding from the failure-mode lens, fixed here.
§9 records the history and what remains unreviewed.
**Supersedes:** `design-v1.md` … `-v5.md` (kept as the review record). §8 lists changes.
**Tickets:** GEN-615 (two sessions on the same *ticket*), GEN-620 (two sessions in the
same project *folder*). Deliberately not merged as tickets; served by one artifact.

---

## 1. The two goals, unchanged

- **GEN-615:** when a session begins substantive work on a named ticket, it should know
  whether another live session is already on that ticket, surface it to Erez, and ask which
  session owns the work rather than proceeding in parallel. Incident: 2026-08-02, two
  sessions on GEN-443 Step 3 for hours; a whole panel + review + two rigs voided, and an
  approval record pinned a hash that no longer matched the file.
- **GEN-620:** when a session begins work in a project folder, it should know whether
  another live session has recently been writing there — naming the files and how recently.
  The failure it targets is *silent*: reading a file another session is halfway through
  rewriting, and drawing conclusions from a partial state.

Both are **awareness**, not locking. GEN-620 rejected advisory locks on their merits (hook
processes are short-lived; this project's rhythm has long idle gaps waiting for Erez, so a
TTL lock either expires mid-work or outlives a dead session). That rejection stands, and
**no part of this design may quietly reintroduce a TTL** — a lesson that cost two review
rounds, once as a 120-minute folder window and once as a 24-hour map expiry.

**Second standing constraint, learned the same way:** every failure mode here presents as
*silence*, and silence is also what correct operation looks like. Three review rounds each
caught a defect that would have installed cleanly and then done nothing — twice by making
the mechanism blind, once by letting a sub-agent consume the warning before it reached
anyone. So the design must carry its own way to tell "quiet because nothing collided" from
"quiet because broken": §3a's self-presence gate and §4's lower bar exist for that, and
nothing may be added that fails silently without one of them covering it.

## 2. What is actually available

The blocker both tickets named — "the two id spaces do not line up, so matching stays
heuristic" — is real for the tool GEN-615 was looking at, and irrelevant to the design,
because a different source shares the edit log's id space exactly.

| Source | Contents |
|---|---|
| `~/.claude/sessions/<pid>.json` | one file per **live** session: `pid`, `sessionId`, `cwd`, `startedAt`, `entrypoint`, `name`, `version`, and inconsistently `procStart` |
| `~/.claude/hooks/auto-approved-edits.jsonl` | append-only `{ts, tool, file, existed, session}`; `session` = the same `sessionId` |
| `~/.claude/projects/<slug>/<sessionId>.jsonl` | that session's transcript — same id again |
| `mcp__ccd_session_mgmt__list_sessions` | `local_<uuid>` ids + titles — **different id space**, and an MCP tool a hook cannot call |

Measurements taken 2026-08-03, each a **point-in-time snapshot**; several drifted during
review (the edit log went 1,171 → 1,188 events). Nothing is load-bearing at runtime — the
hook reads live state on every call — and §6 step 0 re-measures before build.

- `sessions/*.json`: 7 files, 7 live pids, 0 stale; all 7 share one `cwd`.
- **`procStart` is present in exactly 1 of the 7 files**, all reporting version 2.1.219,
  with no relation to start order. Confirmed independently five times. This is why §3a does
  not look at it at all — see §8, round 4 item 1.
- Session names are **derived**, not descriptive: all 7 carry `nameSource: "derived"` and
  names of the form `improve-ai-infra-XX`. A warning cannot quote a human-meaningful session
  title; §4's wording reflects that.
- Edit log: 1,188 events; tool tally **Edit 1,164 / Write 24 and nothing else** (the writer
  also records `MultiEdit`, which has not occurred in this window).
- Id spaces: 0 of 200 session-list ids intersect the 171 edit-log session ids.
- Transcripts: 0.1–11.0 MB across the live sessions.
- `GEN-\d+` over the last 120 transcript lines per live session: GEN-58 is the top hit in 4
  of 6, because standing rules mention it every turn.

Two runtime facts the design depends on, both confirmed against the hooks reference during
review rather than assumed:

- **`session_id` is present on every hook event**, not only `PreToolUse` — the ticket half
  rests on this, and neither existing `UserPromptSubmit` hook happens to read it. Also
  corroborated by five installed hooks that read it on five different event classes.
- **A sub-agent's hook calls carry the *parent's* `session_id`**, with `agent_id` and
  `agent_type` added alongside. This is what §3c's dedupe key must account for; see the
  round-5 finding in §8.

Corroborated five times independently: a `sessions/*.json` `sessionId` matching the edit-log
`session` of that session's own writes — one live session's id appears 102 times — a worked
example of the join the design rests on.

Figures quoted from the **GEN-620 ticket body** (41 project-root collisions at a 30-minute
window, 38 of them `HISTORY.md`, 0 subfolder collisions in seven weeks) are **reported by
that ticket, not re-measured here**. No part of §3 depends on them numerically.

Two measured limits the design must respect:

1. **Ticket detection must read only what Erez typed** — the GEN-58 pollution above is what
   a transcript-scanning approach would drown in. (Also: 11 MB transcripts, so no hook may
   read one whole.)
2. **The edit log's coverage is narrower than "harness edits".** It records only the
   `Edit`/`Write`/`MultiEdit` calls the auto-approve hook itself auto-approved, under two
   roots (`…\AI Projects\` and `…\MemoryPirates\`), excluding `.git`, `.env*` and secret
   extensions. A shell write, or an edit Erez approved by hand outside that scope, produces
   no folder signal. Residual, §7.

## 3. The design

One new hook file, `~/.claude/hooks/concurrent-session-warn.js`, registered on two events.
Both halves ask the same question — *"which other live session is on my key, and how
recently?"* — differing only in the key: **ticket id** for GEN-615, **folder** for GEN-620.

### 3a. Liveness — `liveSessions()`, one function, used by both halves

1. Read every `~/.claude/sessions/*.json` fresh (small directory; 7 files today).
2. A session is **live** if its `pid` still exists. Nothing else is checked. `procStart` is
   deliberately ignored: it exists in 1 of 7 files, its format is undocumented (the single
   live value is a .NET tick count, not epoch milliseconds), Node has no standard way to read
   another process's start time on Windows — it would mean spawning a subprocess inside a
   hook that fires on every `Read`/`Edit`/`Write` — and the branch could not be exercised by
   any test that can actually be run here. Keeping it would buy a pid-reuse guard for one
   session in seven at the price of a silent-inert path that a future version bump would arm
   everywhere. Pid reuse is an accepted residual (§7); its cost is a spurious warning, the
   safe direction.
3. **No `cwd` filter and no self-exclusion in this set.** It is the set of live sessions, and
   it is what pruning consults. Self and other projects are excluded only where that is
   meaningful — at warn time (§3b step 3, §3c step 3), keyed on `sessionId`.
4. **Self-presence is the health check.** This session's own record must appear in the set
   *and* carry the fields both halves consume — `sessionId`, `pid`, `cwd`, `startedAt`. The
   hook is, by definition, running inside a live session, so any failure here is the
   mechanism being wrong about the world, not the world being unusual. Emit the degraded note
   and **do nothing else** — no warning, no prune, no write — when: the directory is
   unreadable; files exist but none parse; the parsed set does not contain this session; or
   this session's record is missing one of those fields. That last clause matters as much as
   the others: a rename of `cwd` alone would leave the ticket half healthy — so §4's lower
   bar never fires — while making §3c step 1's containment test impossible to satisfy,
   silently killing the folder half.
   **The note is throttled to once per session on the `PreToolUse` path** (the per-session
   file of §3c, same marker discipline as `inject-edit-refs.js`, which writes its marker on
   the degraded branch precisely so a broken state cannot re-inject on every call). On the
   `UserPromptSubmit` path it repeats per matching prompt, following `inject-notion-refs.js`,
   which repeats deliberately — "louder while broken, self-clears once fixed". The note text
   tells the model to flag it to Erez, as the existing refs hooks' degraded notes do, and
   each emission appends a line to the warnings log (§4) so the three-week reader can see
   *why* a count is zero rather than only that it is.

Four failure modes this section exists to prevent, each found in review:

- Folding self-exclusion into `liveSessions()` while pruning against that set makes every
  session delete **its own** live registration each prompt, keeping only the current prompt's
  tickets — so a session that names GEN-443 once then works it for hours through "proceed"
  and "yes" is unregistered minutes later, and §1's incident replays silently.
- Requiring `procStart` to match when it is usually absent makes six of seven live sessions
  read as dead: no warning ever fires and live registrations get pruned.
- Pruning at all while self is missing from the set reproduces the first bug through a
  different door — including the upgrade case, where a shape change empties the set.
- Checking only that self is *present*, not that its record is *usable*, leaves the folder
  half killable by a single renamed field with no signal anywhere.

### 3b. Ticket half (GEN-615) — `UserPromptSubmit`

Self-registering presence, so no transcript parsing is ever needed:

1. Match Erez's prompt with `/\bGEN[\s-]?(\d+)\b/gi` — case-insensitive and space-tolerant,
   because he writes "gen 615" as often as "GEN-615" (this session's opening message did).
   Collect **every** id in the prompt, not just the last.
2. Read `~/.claude/hooks/session-tickets.json`:
   `sessionId → { tickets: { "GEN-615": lastNamedTs } }`. No `pid` field — every consumer
   keys on `sessionId`, and a hook's own `process.pid` is the hook's, not the session's, so
   storing one invites a wrong value.
   - **Accumulate, never overwrite.** A session working GEN-443 for hours that mentions
     GEN-88 once in passing keeps both, each with its own timestamp.
   - **Prune by liveness only, and only when §3a step 4 passed** — an entry goes when its
     `sessionId` is absent from `liveSessions()`, i.e. its process is gone. **No age-based
     expiry**: a registration lives exactly as long as its session. An untouched entry
     belongs to a session either still alive (so it still matters) or dead (so liveness
     removes it). Same reasoning that removed the folder window.
   - `liveSessions()` includes self and every project, so pruning cannot delete this
     session's own entry, nor a live session's entry in another project folder. §3a step 4's
     gate is what makes that unconditional rather than an assumption.
   - **A malformed map is never overwritten.** If the file exists but does not parse, emit
     the degraded note and skip the write. The tempting recovery — start a fresh map — would
     wipe every other live session's registration, the same harm class the self-eviction bug
     cost two rounds.
3. For each ticket in this prompt, if a live **other** session has that ticket in its set,
   inject a warning naming that session, which ticket, and **when it last named it** —
   recency as information, not a hidden filter. Ticket ids are global Team-Tasks ids spanning
   all three projects, so **no folder filter applies here**: a same-ticket collision across
   two project folders is a real collision.
4. Record this session's ids and write the map back **atomically**: re-read, **re-derive
   liveness against the re-read copy**, merge, write a **uniquely named** temp file in the
   same directory (`…\session-tickets.<pid>.<random>.tmp` — a shared temp name lets two of
   seven live writers interleave into one truncated file), then `rename()` over the target.
   Re-deriving rather than reusing the snapshot taken at hook start matters twice: without
   re-applying the prune at all, the re-read resurrects the entries step 2 pruned and the
   file grows without bound; reusing the *stale* snapshot would prune a session that started
   and registered inside this hook's own execution window. `rename()` is atomic on POSIX; on
   Windows it can throw `EPERM`/`EBUSY` when another session holds the target open, so catch
   and retry once, then give up — one missed registration, self-healing next prompt. A
   vanishingly narrow lost-update window remains (both re-read before either renames) and is
   accepted: one missed warning, never corruption.
5. **Dedupe:** warn once per `(ticket, other sessionId)` pair; re-arm only when that session's
   `lastNamedTs` for the ticket has advanced ≥30 minutes past the last warning shown. Without
   dedupe the warning refires on every prompt for the whole overlap — the "teaches Erez to
   ignore the channel" failure this design rejects `SessionStart` for. **The 30 minutes is a
   judgment call, not derived from evidence**; it sets only the re-warning cadence, never
   whether the first warning fires.

**What this can and cannot distinguish.** A prompt naming a ticket means *named*, not
necessarily *worked* — "what's the status of GEN-88?" registers GEN-88. The warning reports
only what it can stand behind ("that session named this ticket, most recently N minutes ago")
and leaves ownership to Erez. Accumulation keeps the false-negative direction closed; a false
positive costs one question. With no age bound, expect stale mentions to dominate the ticket
half's firing rate — which is what §4's noise review is for, and why §4 also carries a *lower*
bar.

Sub-agents never receive a user prompt, so this half is reached only by the main session.

Precedent: `inject-notion-refs.js` already fires on `UserPromptSubmit` and already uses
`/\bGEN-\d+\b/` as a prompt cue, reading only `data.prompt`.

### 3c. Folder half (GEN-620) — `PreToolUse` on `Read|Edit|Write|NotebookEdit`

No new writer needed — the edit log already *is* the folder presence signal:

1. Take the target file's **containing folder**; proceed only if it is inside this session's
   `cwd`. Two separate reasons, kept separate: it bounds the hook to the project tree so it
   never fires on unrelated system files, and it keeps the key at folder rather than project
   granularity — GEN-620 measured that a project-level trigger would fire on roughly one
   folder-entry in five. The mirror case this gate hides — reading a file *outside* my `cwd`
   that a live session is rewriting — is a disclosed residual (§7).
2. Ignore entries for files with their own protection — `HISTORY.md` above all: 38 of the 41
   measured project-root overlaps, already serialized by the GEN-218 locked appender
   (`~/.claude/scripts/prepend-log.ps1`), and touched only at wrap-up.
3. **Liveness is the gate; recency is information.** Warn if any **live other session** (per
   §3a) wrote in that folder at any point **since that session started**, naming the files
   and the most recent time. No time window: a fixed cutoff would reintroduce the TTL
   mismatch of §1 — a session idle three hours mid-rewrite is exactly the case that matters —
   and bounding by the other session's own lifetime needs no invented number and cannot miss
   its work.
   **The writer's own `cwd` is not tested.** The folder match comes from the log entry's file
   path, so testing the writer's `cwd` too would add nothing to scoping and would hide real
   cross-project writes: the log shows one session writing `CLAUDE.md` under
   `InvoiceAutomation` at 14:28:01 and under the Memory Pirates documentation folder at
   14:28:02, and two other sessions doing the same.
4. Read the log **bounded**, whichever comes first: back to the earliest `startedAt` among
   live sessions, or **256 KB** of tail. Bytes rather than lines, because the cost is reading
   not parsing — but a byte cut can land mid-record where a line cut cannot, so **discard the
   first (possibly partial) line and parse per-line with a per-line catch**; an all-or-nothing
   parse would turn one split line into a silently inert folder half. At ~180 bytes an entry
   the cap covers ~1,400 entries against a `startedAt` bound that spans hours, so it does not
   bind at today's volume (1,188 lines / ~216 KB); it exists so growth degrades visibly.
   **If the cap binds, the entries dropped are the oldest — the idle-session case step 3 calls
   the one that matters — so the cap binding is itself reported**: once per session, as its
   own note on the same throttle as §3a step 4, not appended to a warning that may not exist.
5. **Dedupe with re-arm**, symmetric with the ticket half: once per pair, re-armed when that
   session's most recent write in the folder has advanced ≥30 minutes past the last warning
   shown. v2 had no re-arm here, which would have gone silent for a pair that kept writing new
   files for hours.
   **The dedupe key includes `agent_id`:** `(agent_id ?? "", folder, other sessionId)`. A
   sub-agent's hook calls carry the *parent's* `session_id` (§2), so a shared key lets a
   sub-agent's `Read` consume the parent's slot — the warning lands in a context with no
   "📌 For you" block and no path to Erez, and the parent's own later read in that folder is
   then silent. Worse, in the idle-mid-rewrite case the other session never writes again, so
   the parent's warning never re-arms. That is GEN-620's exact failure, and it would be routine
   here: this design's own review ran three sub-agents reading files in the project folder.
   Keying by `agent_id` keeps the warning useful to a sub-agent — a reviewer reading a
   half-rewritten file should know — while leaving the parent's slot untouched.

**Where dedupe state lives.** Not in `session-tickets.json` — that file is shared presence
data, and warned-state is private to the session doing the warning. Both halves keep it in one
small per-session file in the OS temp directory, named from `session_id` **sanitized to safe
characters** (`claude-concsess-<safeId>.json`), holding `key → lastWarnedTs` plus the
once-per-session note markers of §3a step 4 and step 4 above — exactly as `inject-edit-refs.js`
builds its marker name. Private state means no cross-session merge. It is not race-free: the
harness issues parallel tool calls, and a fan-out of sub-agents makes that routine rather than
rare, so two `PreToolUse` hooks under one `sessionId` can write it concurrently — accepted,
because the consequence is one duplicated or one missed warning, self-correcting on the next
write. On Windows `%TEMP%` is not cleared on reboot, so a stale file may outlive its session;
harmless, since it is keyed by `sessionId` and a new session gets a new name.

Precedent: `inject-edit-refs.js` already fires `PreToolUse` on exactly
`Read|Edit|Write|NotebookEdit`, including `Read` deliberately — which is what makes the
*read-into-an-actively-rewritten-folder* failure GEN-620 targets reachable at all. Note
`NotebookEdit` has never appeared in the edit log, so it can trigger a check but will never be
the cause of one.

### 3d. Shared

- **Fails open, always** — but never *silently* for a condition §3a step 4 or §3c step 4
  names. Any unexpected error injects nothing and never blocks; the named degraded conditions
  inject a throttled one-line note instead, so the failure that looks exactly like success is
  the one that speaks.
- **No CLAUDE.md growth, no new rule, no new skill step.** The instruction to stop and ask
  travels *inside* the injected text, at the only moment it is relevant — nothing is added to
  the always-loaded file that GEN-86 is actively shrinking.

## 4. What the warning says, and who reads the signal

Session names are derived (`improve-ai-infra-fe`), not descriptive, so the warning leans on
timing and files rather than a title it cannot get:

> **Concurrent session warning.** Live session `improve-ai-infra-fe` (pid 13352, started
> 09:02) last named **GEN-152** 8 minutes ago — a ticket this prompt names. Before doing
> substantive work on it, surface this in the "📌 For you" block and ask Erez which session
> owns the work. Reading or discussing the ticket is fine.

> **Concurrent session warning.** Live session `improve-ai-infra-fe` (pid 13352) wrote
> `notes/gen508-piece1/design-converged.md` in this folder 4 minutes ago (2 files since it
> started). Files here may be mid-rewrite — treat what you read as possibly partial, and
> surface this in the "📌 For you" block before relying on it.

**Primary signal, and its reader.** The warning is the signal; its reader is Erez, in that
same turn's "📌 For you" block — a routine he already sees. Nothing new to check. This depends
on the model relaying the injected instruction into that block, which is a real dependency,
listed in §7; `stop-foryou-nudge.js` is existing precedent for a cheap Stop-time check if it
proves unreliable.

**Secondary signal — is it noise, or is it dead?** Each firing, and each degraded or
cap-binding note, appends one line to `~/.claude/hooks/concurrent-session-warnings.jsonl`
(`{ts, half, kind, key, otherSession, sessionId, agentId}`).

- **Reader and when:** a follow-up ticket, filed *at install time* and assigned to Claude, with
  a self-trigger three weeks out.
- **Upper bar (noise):** if the folder half has fired more than about once a week, tighten the
  scope or exclusions; if the ticket half has fired more than a handful of times with no real
  collision behind it, revisit whether a prompt mention is too loose a cue.
- **Lower bar (inertness) — the one this design would not have caught without it:** the ticket
  half firing **zero** times in three weeks is *suspect*, not reassuring, because §3b expects
  stale mentions to dominate its rate. On zero, re-run §6's construction cases rather than
  concluding all is well. §6's premise is that a correctly-scoped *folder* warning fired 0
  times in seven weeks of history, so silence there proves nothing either way — which is
  exactly why the ticket half carries the lower bar, and why degraded notes are logged too.
- v1's "Erez waves it off twice" leg is dropped: nothing in the log records a dismissal, so it
  was unmeasurable. If he asks for it to stop, that needs no log.

## 5. Why not the alternatives

- **An always-loaded CLAUDE.md rule.** *Strongest case:* no code, no vetting flow, and it
  covers what a prompt cue cannot — work arising mid-turn, never named in a prompt. It fires on
  judgment at exactly the right moment. *Why not:* it depends on remembering, which is what
  failed on 2026-08-02 — the information was available from the first turn and nothing prompted
  anyone to look. It grows the file GEN-86 is shrinking, and makes the join manual, and
  therefore sloppy, every time.
- **A `SessionStart` hook warning about same-folder sessions** — GEN-615's original guess.
  *Strongest case:* simplest possible, zero judgement, no keys, no parsing. *Why not:* measured
  noise. Seven live sessions sit in this one project folder right now, so it would warn at every
  session start while unable to say whether any is on the same work — the option most likely to
  be tuned out, which is worse than nothing because it teaches Erez to ignore the channel.
- **Advisory lock files per ticket or folder.** *Strongest case:* it would prevent the collision
  rather than describe it. *Why not:* blocking is the wrong shape — Erez deliberately runs
  several sessions per project, and a false lock stops real work. Both tickets ask to be *told*.
- **Extend an existing `inject-*-refs.js` hook instead of adding a file.** *Strongest case:* no
  new registration, one fewer file to vet. *Why not:* those hooks are pure data-injection with
  no state; this one holds a shared map and a warnings log. A bug in the state handling would
  take the reference-note injection down with it. Vetting cost is roughly a wash, so separation
  wins on blast radius.
- **Folder presence from filesystem mtimes or git instead of the edit log.** *Strongest case:*
  it would catch the writes the log misses (§2 limit 2). *Why not:* neither carries **which
  session** wrote, which is the whole point — a warning that cannot name the other session is
  not actionable.
- **`list_sessions` + title matching**, as GEN-615 assumed. *Why not:* 0 of 200 ids join the
  edit log, so it cannot say what the other session touched, and no hook can call an MCP tool.
  Its titles are genuinely better than the derived names §4 must use — a real cost of this
  choice, not a wash — but they cannot be reached from a hook at all.

## 6. Build order

0. **Re-measure** the §2 snapshots immediately before writing code — several drifted during
   review.
1. Write liveness plus both halves in one file (~180 lines).
2. `/vet-code` it — mandatory for a new hook: `/check`, two code-review passes, then the
   single-use vetting pass. The concrete file-write and catch branches are what that pass is
   for; §3b step 2's never-overwrite-a-malformed-map rule and step 4's unique temp name are the
   two places a reasonable implementation could go destructively wrong, so name them in the
   review brief.
3. Register both events in `settings.json` via `update-config.ps1` (locked file).
4. **Verify by construction, not by waiting** — a correctly-scoped folder warning would have
   fired 0 times in seven weeks, so acceptance cannot be "wait for it to fire". This supersedes
   GEN-620's "verified by Erez in a real two-session sitting". **Run in two phases** so the
   sitting is actually completable: everything below that needs no second session first, then
   one two-session pairing.

   *Phase A — solo, against fabricated state (say in the vetting record which method each used):*
   - *ticket cue:* a prompt containing "gen 615" lowercase and two ids at once → both
     registered (this is the branch review added, and it fails silently if mis-written).
   - *no age expiry:* hand-write a `lastNamedTs` over a day old → still warns.
   - *both ≥30-minute re-arms:* pre-seed `lastWarnedTs`, or a temporary threshold override.
   - *stale record:* a map entry whose `sessionId` matches no session file → silent, and the
     entry is pruned.
   - *self absent:* hide this session's own file → degraded note, and **no prune, no write, no
     warning**.
   - *self record incomplete:* remove `cwd` from this session's own file → degraded note (the
     single-renamed-field case).
   - *shape change that still parses:* rename a field across the session files → degraded note.
   - *malformed map:* corrupt `session-tickets.json` → degraded note, **and the file is left
     untouched**.
   - *note throttle:* hold a degraded condition across many tool calls → one note, not one per
     call.
   - *cap binding:* against a fabricated oversized log → the cap-binding note appears.
   - *race:* drive two hook invocations concurrently against a scratch map — human prompt speed
     cannot enter the read-modify-write window the atomic write exists to close, so a sequential
     test proves nothing about it.
   - *negative controls:* different tickets → silent; **a different subfolder inside the same
     project** → silent (this, not "a different project", tests folder-not-project scoping);
     `HISTORY.md` → silent.

   *Phase B — one two-session pairing:*
   - *ticket half, and accumulation and self-preservation in one sequence:* session 1 names
     ticket A, then B in passing, then sends two prompts naming neither; session 2 names A →
     warning appears, naming the other session, its pid, and when it last named A.
   - *ticket half, cross-project:* the two sessions in **different** project folders, same
     ticket → warning still appears (proves no folder filter leaked into the ticket half).
   - *ticket half, dedupe:* the same overlap across several prompts → warns once.
   - *folder half:* session A edits a file in a subfolder; session B then **reads** a different
     file in that same subfolder → warning appears naming A's file and time.
   - *folder half, cross-`cwd` writer:* a live session whose `cwd` is project A has written into
     project B's folder; a session in B reads there → warning appears (what round 4's removal of
     the writer-`cwd` test enables, and nothing else tests it).
   - *sub-agent attribution — the round-5 case:* with session A live and having written in
     folder F, session B spawns a sub-agent that reads in F, **then B itself reads in F** → B
     still gets its own warning, and no self-warning appears from the sub-agent's own session.
   - *log line:* confirm a line actually landed in the warnings log — the three-week review
     counts lines, and an empty log is otherwise indistinguishable from a healthy quiet one.
5. **File the noise-review follow-up ticket** (§4) with its three-week self-trigger and **both**
   bars, at install time — not after.
6. **Close GEN-615 and GEN-620 as Done** on the phase A + B demonstration: their own
   verification completes in that sitting. The three-week noise question is not their
   verification — it belongs to the follow-up ticket of step 5, which carries the self-trigger.

## 7. Honest residual — what this does NOT solve

- **It warns; it does not prevent.** If Erez says proceed, both sessions still run. That is what
  both tickets asked for, not an oversight.
- **The folder signal's coverage is narrower than "harness edits"** — only the
  `Edit`/`Write`/`MultiEdit` calls the auto-approve hook auto-approved, under the two project
  roots, excluding `.git`, `.env*` and secret extensions. Shell writes (`Set-Content`, a
  redirect, `git checkout`) and hand-approved edits outside that scope produce no signal at all.
  GEN-218's file-level protection is not extended by this either.
- **Ticket detection is prompt-cued, so a mid-turn pivot is uncovered** — work that turns to a
  ticket never typed in a prompt stays silent. Same known limit as `inject-notion-refs.js`.
- **Named ≠ worked**, and with no age bound, stale mentions will likely dominate the ticket
  half's firing rate. A false positive costs one question to Erez.
- **Session names are derived, not descriptive.** The warning offers
  `improve-ai-infra-fe (pid 13352, started 09:02)` and what that session touched — not "the
  session about GEN-152". Erez may still have to look at two windows to tell which is which.
- **Reads are still unlogged.** This tells you another session *wrote* nearby; it cannot tell
  that session that *you* are reading its half-finished file. One direction only.
- **Reading outside my own `cwd` gets no warning** — §3c step 1's gate hides the mirror of the
  cross-project case it otherwise catches.
- **Pid reuse is not guarded.** §3a deliberately dropped the only available check; a reused pid
  can make a dead session look live, costing a spurious warning. A *Claude* process reusing the
  pid overwrites the session file, so the dead session leaves the set correctly; only a
  non-Claude reuse leaves a stale file.
- **A resumed session's `startedAt` is the resume time**, so its pre-resume writes fall outside
  §3c step 3's bound and produce no warning.
- **While a session is in the degraded state it writes nothing**, so it registers no tickets and
  becomes invisible to the *other* sessions for as long as that lasts. Conservative direction,
  and visibly noted in the degraded session itself — but the other sessions get no hint.
- **The folder half has no runtime inertness bar.** §4's lower bar covers the ticket half only,
  because folder silence is the expected healthy state. The folder half's protection is the
  build-time construction test plus §3a's gate — nothing continuous.
- **Three narrow races are accepted:** the lost-update window in §3b step 4; concurrent writes
  to the per-session dedupe file by parallel tool calls or a sub-agent fan-out; and a session
  born inside a hook's own execution window. Each costs at most one duplicated or missed
  warning, never corruption.
- **The primary signal depends on the model relaying it** into the "📌 For you" block. A
  stronger dependency than it looks, though weaker than the CLAUDE.md alternative's, since it
  arrives at the moment of relevance.
- **Resumed-session attribution is unverified**, and whether every session class writes a
  `sessions/*.json` at all is unknown. Both are on §6's list; as of now unknown, not proven safe.
- **It leans on an internal Claude Code file.** `~/.claude/sessions/<pid>.json` is not a
  documented interface (observed on 2.1.219, and already inconsistent about `procStart`) and
  could change shape or move in an upgrade. §3a step 4's gate is what makes that visible rather
  than silent. If the directory disappears entirely, both halves stop and say so.
- **One machine, one user.** Nothing here survives a second machine; all sessions are assumed to
  share `~/.claude`.

## 8. Changes across review rounds

**Round 1 (v1→v2):** regex relaxed to `/\bGEN[\s-]?(\d+)\b/gi`, all ids collected; presence map
accumulates instead of overwriting; atomic temp+rename write; the **120-minute folder window
removed** for liveness-as-gate; ticket-half dedupe with re-arm; the noise log given a named
reader and the unmeasurable "waved off twice" bar dropped; liveness spelled out; edit-log read
bounded; a negative control disambiguated; §2 figures labelled point-in-time and the GEN-620
ones marked ticket-reported; two unconsidered alternatives added; two residuals added.

**Round 2 (v2→v3):** the `cwd` filter removed from the ticket half (GEN ids are global, and
pruning through a folder-filtered set could delete another project's live registration); the
**24-hour map expiry removed**; folder-half re-arm added; dedupe state moved to a per-session
temp file; the 30-minute re-arm labelled a judgment call.

**Round 3 (v3→v4):** `procStart` made optional (it was required, and is present in 1 of 7 files
— the mechanism would have shipped inert); **self-exclusion removed from the liveness set** (each
session would have deleted its own registration every prompt); the folder half stopped testing
the writer's `cwd`, retiring a helper; log-scan cap, sanitized temp filename, and a method for
exercising the ≥30-minute tests.

**Round 4 (v4→v5):** the **`procStart` check deleted outright** (its format undocumented, no
Node-native way to read a process start time on Windows, and no runnable test — while a version
bump making the field universal would arm it everywhere); **self-presence made a hard gate**;
a **lower monitoring bar** added so inertness is distinguishable from quiet; the prune re-applied
on re-read; the log cap named, measured in bytes and made visible; §4's examples given real
session names and pids; the map's unused `pid` field dropped; `rename()`'s Windows failure path
given a retry; the reader-`cwd` gate justified and its mirror gap disclosed; the edit log's true
coverage corrected.

**Round 5 (v5→v6):**

1. **The dedupe key now includes `agent_id`** — the round-5 material finding. Sub-agent hook
   calls carry the parent's `session_id`, so a shared key let a sub-agent's `Read` consume the
   parent's `(folder, other session)` slot: the warning landed in a context with no
   "📌 For you" block, and the parent's own later read went silent — with no re-arm in the
   idle-mid-rewrite case, which is the case that matters. Routine here, not exotic: this
   design's own review ran three sub-agents reading in the project folder. A new phase-B test
   asserts the parent still warns after a sub-agent read in the same folder.
2. **The self-presence gate now also checks that self's record is usable** — `pid`, `cwd`,
   `startedAt`, not just presence. A rename of `cwd` alone would otherwise kill the folder half
   silently while leaving the ticket half healthy, so §4's lower bar would never fire.
3. **The degraded and cap-binding notes are throttled** once per session on the `PreToolUse`
   path (per `inject-edit-refs.js`, which throttles its degraded branch for exactly this reason)
   and repeat per prompt on `UserPromptSubmit` (per `inject-notion-refs.js`, which repeats
   deliberately). Uncaught, the widened trigger set could inject a line on every tool call in a
   steady state — the alert-fatigue failure §5 uses to reject `SessionStart`. The notes are also
   logged, so a zero count is explicable.
4. **A malformed presence map is never overwritten** — the tempting fresh-map recovery would
   wipe every other live session's registration.
5. **The temp file for the atomic write is uniquely named per writer**, and **liveness is
   re-derived at re-read time** rather than reusing the hook-start snapshot, so a session born
   inside the execution window cannot have its fresh entry pruned.
6. **The byte-tail read discards its first partial line and parses per-line**; the cap-binding
   report became its own throttled note rather than a rider on a warning that may not exist.
7. §6 restructured into a solo phase and a single two-session pairing, with *accumulation* and
   *self-preservation* folded into one sequence; new cases for the lowercase/two-id cue, the
   incomplete self record, the note throttle, the cap binding, and the sub-agent case; the stale
   "fabricate a pid" wording fixed. §6 step 6 now states Done rather than leaving it open, with
   the reason.
8. §6 step 0's orphaned `procStart` re-measure dropped; §4's example start time corrected to the
   real value; §7's "AI-projects roots" wording corrected to the two actual roots; three new
   residuals (degraded-state invisibility, no folder-half runtime bar, session-class coverage
   unknown); §9's overreaching sentences rewritten.

## 9. Review status

Five rounds. Rounds 1–4 each produced material findings, every one fixed and confirmed resolved
by the following round. Round 5 ran all three lenses on v5 and returned **PASS** on soundness and
on proportionality, with one material finding from the failure-mode lens — the sub-agent dedupe
collision — now fixed as round-5 item 1 above, together with that round's advisories.

**What is not yet reviewed:** v6 itself. Erez extended the budget to five rounds specifically to
reach convergence, and five rounds is what was spent; the round-5 finding was fixed after the
last round rather than inside it. The reviewer who raised it judged that it "does not need
another full panel round" and that the mandatory `/vet-code` flow — its own `/check` plus two
code-review passes — is the right place to confirm it landed. I agree, and §6 step 2 names the
two spots where that review should look hardest. That is a judgment, not a reviewer's sign-off on
v6.

The design's *shape* has not changed since v1: one hook, two triggers, one liveness reader, the
edit log reused as the folder signal. What five rounds changed is the decision logic inside it —
a 120-minute window, a 24-hour expiry, a folder filter on the ticket half, a self-exclusion, a
`procStart` requirement and a shared dedupe key all removed — and, more than anything, that the
mechanism can now tell when it is broken. Three of the five rounds each caught a defect that
would have installed cleanly and done nothing at all, which is the strongest argument in the
file for having run them.
