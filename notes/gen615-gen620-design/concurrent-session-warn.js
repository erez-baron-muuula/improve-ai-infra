// concurrent-session-warn.js — GEN-615 + GEN-620
//
// Tells a session when ANOTHER LIVE session is on the same work, so two sessions do not
// duplicate or corrupt each other's effort. Two halves, one question ("which other live
// session is on my key, and how recently?"), two keys:
//
//   UserPromptSubmit  -> key = ticket id   (GEN-615: two sessions on the same ticket)
//   PreToolUse        -> key = folder      (GEN-620: two sessions in the same folder)
//
// Design of record: notes/gen615-gen620-design/design-v7.md in the Improve AI Infra repo,
// converged over six /check rounds. Read it before changing anything here — several of the
// non-obvious clauses below are there because a reviewer caught the obvious version failing
// SILENTLY. The three that matter most:
//
//  1. liveSessions() applies NO cwd filter and NO self-exclusion, because it is what pruning
//     consults. Excluding self there makes every session delete its own registration on every
//     prompt (keeping only the current prompt's tickets); filtering by cwd there lets a hook
//     in one project delete a live session's entry in another. Self and folder are excluded
//     only at warn time.
//  2. `procStart` is deliberately ignored. It is present in only 1 of 7 live session files,
//     its format is undocumented, and Node cannot read another process's start time on
//     Windows without spawning a subprocess. Requiring it read 6 of 7 live sessions as dead.
//     Pid reuse is an accepted residual: it costs a spurious warning, the safe direction.
//  3. An ABSENT presence map is normal (create it); an UNPARSABLE one is never overwritten.
//     The tempting fresh-map recovery wipes every other live session's registration.
//
// Failure posture: fail open, but never silently for a NAMED condition. Every failure mode
// here otherwise looks exactly like correct operation (silence), so the named conditions
// below emit a one-line note instead — throttled once per session on the PreToolUse path
// (per inject-edit-refs.js), repeating per prompt on UserPromptSubmit (per
// inject-notion-refs.js: louder while broken). Any OTHER error injects nothing and never
// blocks the prompt or the tool call.
//
// Sub-agents: their hook calls carry the PARENT's session_id plus their own agent_id. Dedupe
// keys therefore include agent_id, or a sub-agent's read spends the parent's one-per-folder
// warning on a context that has no way to reach Erez — and in the idle-mid-rewrite case the
// parent's warning would never re-arm. Notes are suppressed entirely inside a sub-agent for
// the same reason.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Test-only relocation. When CONCSESS_TEST_ROOT is set, every path below resolves under it
// instead of ~/.claude, so the verification cases in design-v7.md §6 phase A can be run
// against fabricated state — a corrupt presence map, an oversized edit log, a session
// registry missing this session's file — WITHOUT touching the real
// auto-approved-edits.jsonl, which a standing reporting rule reads. Unset in normal
// operation, in which case this is a no-op and the paths are exactly the production ones.
const TEST_ROOT = process.env.CONCSESS_TEST_ROOT || '';
const CLAUDE_DIR = TEST_ROOT || path.join(os.homedir(), '.claude');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
const HOOKS_DIR = path.join(CLAUDE_DIR, 'hooks');
const EDIT_LOG = path.join(HOOKS_DIR, 'auto-approved-edits.jsonl');
const PRESENCE_MAP = path.join(HOOKS_DIR, 'session-tickets.json');
const WARN_LOG = path.join(HOOKS_DIR, 'concurrent-session-warnings.jsonl');

const TAIL_CAP_BYTES = 256 * 1024;   // ~1,400 entries; the startedAt bound normally wins
const REARM_MS = 30 * 60 * 1000;     // judgment call: re-warning cadence only
const LOCK_ATTEMPTS = 40;            // ~400 ms worst case under heavy contention
const STALE_LOCK_MS = 5000;          // a hook process lives for well under a second
// inject-edit-refs.js matches only Read|Edit|Write|NotebookEdit; MultiEdit is added here
// because the edit log this half reads DOES record it (auto-approve.js: Edit|Write|MultiEdit),
// so without it a session whose first touch of a folder is a MultiEdit gets no warning.
const FILE_TOOLS = /^(Read|Edit|Write|MultiEdit|NotebookEdit)$/;
const PROTECTED_BASENAMES = new Set(['history.md']); // GEN-218 serializes this one already

// Deliberately case-insensitive and space-tolerant: "gen 615" is as common as "GEN-615".
function ticketIdsIn(text) {
  const re = /\bGEN[\s-]?(\d+)\b/gi;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = 'GEN-' + m[1];
    if (out.indexOf(id) === -1) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------- paths

function norm(p) {
  try {
    return path.resolve(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  } catch (e) {
    return null;
  }
}

// The edit log stores original casing while its writer matches on a lowercased key, so both
// sides are normalized here; a plain prefix test is one casing divergence from silence.
function within(root, child) {
  const r = norm(root);
  const c = norm(child);
  if (!r || !c) return false;
  return c === r || c.indexOf(r + '\\') === 0;
}

// ---------------------------------------------------------------------------- liveness

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but is not ours to signal.
    return !!e && e.code === 'EPERM';
  }
}

// Returns { ok, reason, sessions: Map(sessionId -> {pid, cwd, startedAt, name}), seen: Set }.
// ok === false means the registry itself could not be trusted; the caller emits a note.
//
// `seen` holds every sessionId found in a parseable file REGARDLESS of pid liveness, and exists
// only so gateSelf can tell "no record for me at all" apart from "my record is there but
// unusable". Without it a renamed or malformed `pid` field is filtered out by pidAlive and then
// misreported as 'self-absent', pointing a future debugger at the wrong cause.
function liveSessions() {
  const sessions = new Map();
  const seen = new Set();
  let names;
  try {
    names = fs.readdirSync(SESSIONS_DIR);
  } catch (e) {
    return {
      ok: false, reason: 'registry-unreadable', sessions: sessions, seen: seen, readFailures: 1,
    };
  }
  let parsed = 0;
  let readFailures = 0;
  for (let i = 0; i < names.length; i++) {
    if (!/\.json$/i.test(names[i])) continue;
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, names[i]), 'utf8'));
    } catch (e) {
      // One unreadable file is not a registry failure — but it is NOT proof of absence either,
      // and pruning acts on absence. Claude Code rewrites these files during a session, and
      // writeFileSync truncates before writing, so a reader landing in that window sees an
      // empty or partial file. Counted here so the prune can refuse to run on a pass that
      // could not read everything; otherwise a millisecond glitch deletes a LIVE session's
      // registrations, which is the exact loss this hook exists to prevent.
      readFailures++;
      continue;
    }
    parsed++;
    if (!rec || typeof rec.sessionId !== 'string' || !rec.sessionId) continue;
    seen.add(rec.sessionId);
    if (!pidAlive(rec.pid)) continue;
    sessions.set(rec.sessionId, {
      pid: rec.pid,
      cwd: typeof rec.cwd === 'string' && rec.cwd ? rec.cwd : null,
      startedAt: typeof rec.startedAt === 'number' ? rec.startedAt : null,
      name: typeof rec.name === 'string' && rec.name ? rec.name : rec.sessionId.slice(0, 8),
    });
  }
  if (parsed === 0) {
    return {
      ok: false, reason: 'no-parsable-session-files', sessions: sessions, seen: seen,
      readFailures: readFailures,
    };
  }
  return {
    ok: true, reason: null, sessions: sessions, seen: seen, readFailures: readFailures,
  };
}

// The hook runs INSIDE a live session, so failing to find a usable record for self means the
// mechanism is wrong about the world — not that the world is unusual. Checking only presence
// is not enough: a rename of `cwd` alone would leave the ticket half healthy (so the
// monitoring's lower bar never fires) while making the folder half's containment test
// impossible to satisfy.
function gateSelf(live, selfId) {
  if (!live.ok) return { ok: false, reason: live.reason };
  const me = live.sessions.get(selfId);
  if (!me) {
    // A record that exists but was filtered out by pidAlive is an unusable record, not a
    // missing one — the realistic cause being a renamed or malformed `pid` field.
    return { ok: false, reason: live.seen.has(selfId) ? 'self-record-incomplete' : 'self-absent' };
  }
  if (!me.cwd || me.startedAt === null) return { ok: false, reason: 'self-record-incomplete' };
  return { ok: true, reason: null, me: me };
}

// ---------------------------------------------------------------- per-session dedupe state

// Private to the warning session, so it never needs a cross-session merge. Not race-free:
// parallel tool calls (and sub-agent fan-outs) share one session_id, so two hooks can write
// it at once. Accepted — a lost update can only drop or stale a lastWarned stamp, which
// pushes toward warning AGAIN rather than suppressing.
function stateFile(sessionId) {
  const safe = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '');
  return safe ? path.join(os.tmpdir(), 'claude-concsess-' + safe + '.json') : null;
}

function readState(f) {
  if (!f) return {};
  try {
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    return st && typeof st === 'object' ? st : {};
  } catch (e) {
    return {};
  }
}

function writeState(f, st) {
  if (!f) return;
  try {
    fs.writeFileSync(f, JSON.stringify(st));
  } catch (e) {
    /* fail open */
  }
}

// -------------------------------------------------------------------------- warnings log

// Every warning AND every note is logged, so a zero count is explicable rather than
// ambiguous. The three-week review reads this; it counts DISTINCT pairs, not lines, because
// one collision seen by a sub-agent fan-out is several lines.
function logEvent(obj) {
  try {
    fs.appendFileSync(WARN_LOG, JSON.stringify(obj) + '\n');
  } catch (e) {
    /* fail open */
  }
}

// ------------------------------------------------------------------------- degraded notes

const NOTE_TEXT = {
  'registry-unreadable':
    'the live-session registry (~/.claude/sessions/) could not be read',
  'no-parsable-session-files':
    'no file in ~/.claude/sessions/ could be parsed',
  'self-absent':
    'this session has no record in ~/.claude/sessions/, though other sessions do',
  'self-record-incomplete':
    'this session\'s record in ~/.claude/sessions/ is missing a field this check needs (sessionId, pid, cwd or startedAt)',
  'presence-map-unparsable':
    'the shared ticket map ~/.claude/hooks/session-tickets.json exists but could not be parsed; it was left untouched and must be repaired or deleted by hand',
  'edit-log-window-unparsable':
    'the scanned tail of ~/.claude/hooks/auto-approved-edits.jsonl contained no parsable entries',
  'edit-log-tail-capped':
    'the scanned tail of ~/.claude/hooks/auto-approved-edits.jsonl hit its 256 KB cap before reaching the oldest live session\'s start, so older writes in this folder were not checked',
};

// `throttle` is true on the PreToolUse path (once per session per reason) and false on
// UserPromptSubmit (repeat per matching prompt: louder while broken). Suppressed entirely
// inside a sub-agent, which has no "For you" block and so no path to Erez — emitting there
// would spend the parent's one note on an unreachable context.
function degradedNote(reason, ctx, throttle) {
  if (ctx.agentId) return null;
  if (throttle) {
    const st = readState(ctx.stateFile);
    st.notes = st.notes || {};
    if (st.notes[reason]) return null;
    st.notes[reason] = Date.now();
    writeState(ctx.stateFile, st);
  }
  logEvent({
    ts: new Date().toISOString(),
    half: ctx.half,
    kind: 'degraded',
    key: reason,
    otherSession: null,
    sessionId: ctx.selfId,
    agentId: null,
  });
  const what = NOTE_TEXT[reason] || ('an unexpected condition (' + reason + ')');
  return '**Concurrent-session check degraded.** ' + what +
    ', so this session cannot tell whether another session is working the same ticket or ' +
    'folder. It is not warning you when it should. Flag this to Erez in the "\u{1F4CC} For you" block.';
}

// ---------------------------------------------------------------------------- presence map

// Three states, deliberately distinct: absent is normal (create it), unparsable is never
// overwritten, parseable is the normal path. Conflating the first two either ships the
// ticket half permanently inert or makes it destructive.
function readPresenceMap() {
  let raw;
  try {
    raw = fs.readFileSync(PRESENCE_MAP, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { state: 'absent', map: {} };
    return { state: 'unparsable', map: {} };
  }
  if (!raw || !raw.trim()) return { state: 'absent', map: {} };
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return { state: 'unparsable', map: {} };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { state: 'unparsable', map: {} };
  return { state: 'ok', map: obj };
}

function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (e) {
    /* if SharedArrayBuffer is unavailable, spin the retry without a pause */
  }
}

// Mutual exclusion for the read-modify-write on the shared presence map.
//
// The design accepted a bare re-read-and-merge on the grounds that the lost-update window was
// "vanishingly narrow". Measured, it is not: with six concurrent writers only two
// registrations survived (test-concurrent-session-warn.js, "concurrency"). A lost registration
// is exactly the failure GEN-615 exists to prevent, so the section is locked instead.
//
// Only the ticket half writes, and only on a prompt naming a ticket, so this lock is never
// taken on the hot PreToolUse path. `wx` gives an atomic create-or-fail; a lock older than
// STALE_LOCK_MS belonged to a process that died holding it, since a hook lives for well under
// a second. Failure to acquire is not an error: skip the write, and the next prompt re-registers.
function withMapLock(fn) {
  const lock = PRESENCE_MAP + '.lock';
  const mine = String(process.pid);
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    let fd;
    try {
      fd = fs.openSync(lock, 'wx');
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return false;
      // Break the lock ONLY when its holder is provably gone. Breaking on age alone lets a
      // second writer into the critical section whenever a holder stalls past the age bound
      // (seven node processes plus an antivirus scan on a laptop, or a sleep/resume straddling
      // the hold) — and then the original holder's release unlinks the NEW holder's lock, admitting
      // a third. That is the lost update the lock was added to close, reintroduced. The age
      // bound survives only as a fallback for a lock whose pid cannot be read at all.
      try {
        const holder = fs.readFileSync(lock, 'utf8').trim();
        const holderPid = /^\d+$/.test(holder) ? parseInt(holder, 10) : NaN;
        const st = fs.statSync(lock);
        const stale = Number.isInteger(holderPid)
          ? !pidAlive(holderPid)
          : Date.now() - st.mtimeMs > STALE_LOCK_MS;
        if (stale) fs.unlinkSync(lock);
      } catch (e2) {
        /* another writer cleaned or replaced it first */
      }
      sleepMs(4 + Math.floor(Math.random() * 8));
      continue;
    }
    let ok = false;
    try {
      // The pid must land before fn() runs: it is what lets another writer tell a stalled
      // holder from a dead one. If it cannot be written, release immediately rather than
      // holding a lock nobody can adjudicate.
      try {
        fs.writeSync(fd, mine);
        ok = true;
      } catch (e) {
        ok = false;
      }
      try {
        fs.closeSync(fd);
      } catch (e) {
        /* ignore */
      }
      if (ok) fn();
    } finally {
      // Only release a lock we still own. If a stale-breaker took it from us mid-run, the file
      // now belongs to someone else and unlinking it would admit a third writer.
      try {
        if (fs.readFileSync(lock, 'utf8').trim() === mine) fs.unlinkSync(lock);
      } catch (e) {
        /* gone already, or unreadable — nothing safe to do */
      }
    }
    return ok;
  }
  return false;
}

// Re-read, re-derive liveness against that copy, re-gate, merge, then rename into place —
// all under the lock. Every clause is load-bearing: without re-pruning, the re-read resurrects
// pruned entries and the file grows forever; with the STALE liveness snapshot, a session born
// inside this hook's own execution window loses its fresh entry; without re-gating, a
// transiently degraded re-derivation would prune every live session's entries.
// A registration that never lands makes this session invisible to every other session for that
// ticket — and, because the design's own reasoning is that a long session names a ticket once and
// then works it through "proceed"/"yes", it may never get another chance. So every give-up path
// logs a reason: otherwise the three-week review cannot tell "no collisions happened" from
// "registrations never landed", which are the same zero.
function writePresenceMap(ctx, ticketIds, now) {
  let outcome = 'lock-unavailable';
  const acquired = withMapLock(function () {
    outcome = writePresenceMapLocked(ctx.selfId, ticketIds, now);
  });
  if (!acquired || outcome !== 'ok') {
    logEvent({
      ts: new Date().toISOString(),
      half: ctx.half,
      kind: 'degraded',
      key: 'registration-failed:' + (acquired ? outcome : 'lock-unavailable'),
      otherSession: null,
      sessionId: ctx.selfId,
      agentId: ctx.agentId || null,
    });
  }
  return acquired && outcome === 'ok';
}

// Returns 'ok' or a short reason. Never throws — the caller's warning must not be lost to a
// failure to record our own registration.
function writePresenceMapLocked(selfId, ticketIds, now) {
  const re = readPresenceMap();
  if (re.state === 'unparsable') return 'map-unparsable'; // never overwrite
  const base = re.map;

  const live2 = liveSessions();
  const g2 = gateSelf(live2, selfId);
  // Prune only on PROVABLE absence: a pass that could not read every session file has not
  // proved anything about the sessions it failed to read.
  const mayPrune = g2.ok && !live2.readFailures;

  const merged = {};
  const ids = Object.keys(base);
  for (let i = 0; i < ids.length; i++) {
    const sid = ids[i];
    // Never prune self, whatever the live set says — belt and braces on the failure that
    // cost two review rounds.
    if (mayPrune && sid !== selfId && !live2.sessions.has(sid)) continue;
    const rec = base[sid];
    if (rec && typeof rec === 'object') merged[sid] = rec;
  }

  const mine = (merged[selfId] && typeof merged[selfId].tickets === 'object' && merged[selfId].tickets)
    ? merged[selfId]
    : { tickets: {} };
  if (!mine.tickets || typeof mine.tickets !== 'object') mine.tickets = {};
  for (let i = 0; i < ticketIds.length; i++) mine.tickets[ticketIds[i]] = now;
  merged[selfId] = mine;

  // Unique temp name: a shared one lets two of several live writers interleave into one
  // truncated file. Unique names are not self-cleaning, so unlink on every failure path.
  const tmp = PRESENCE_MAP + '.' + process.pid + '.' +
    Math.random().toString(36).slice(2, 10) + '.tmp';
  let renamed = false;
  try {
    fs.writeFileSync(tmp, JSON.stringify(merged));
    // Windows can throw EPERM/EBUSY here when an antivirus scan or another session holds the
    // target or the just-created temp file. Retrying immediately re-attempts inside the same
    // hold, so the attempts are spaced — an AV scan of a small file lasts tens of milliseconds.
    for (let attempt = 0; attempt < 3 && !renamed; attempt++) {
      if (attempt) sleepMs(20);
      try {
        fs.renameSync(tmp, PRESENCE_MAP);
        renamed = true;
      } catch (e) {
        /* try again, or fall through to cleanup */
      }
    }
  } catch (e) {
    /* fall through to cleanup */
  }
  if (!renamed) {
    // Unconditional: writeFileSync can throw having already created the file, so keying cleanup
    // on "the write succeeded" leaks a partial temp file into ~/.claude/hooks forever.
    try {
      fs.unlinkSync(tmp);
    } catch (e) {
      /* nothing further to do */
    }
    return 'rename-failed';
  }
  return 'ok';
}

// ------------------------------------------------------------------------------ edit log

// Bounded by bytes rather than lines because the cost is reading, not parsing.
function readTail(file, cap) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch (e) {
    return null;
  }
  if (!size) return { text: '', offset: 0, size: 0 };
  const start = size > cap ? size - cap : 0;
  const len = size - start;
  const buf = Buffer.alloc(len);
  let fd;
  let read = 0;
  try {
    fd = fs.openSync(file, 'r');
    // readSync may return fewer bytes than asked; decoding the whole buffer would append NULs
    // to the LAST row, which is the most recent write and the one a warning most depends on.
    while (read < len) {
      const n = fs.readSync(fd, buf, read, len - read, start + read);
      if (!n) break;
      read += n;
    }
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (e) {
        /* ignore */
      }
    }
  }
  return { text: buf.slice(0, read).toString('utf8'), offset: start, size: size };
}

// -------------------------------------------------------------------------- ticket half

function ticketHalf(data, ctx) {
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  if (!prompt) return null;
  const tickets = ticketIdsIn(prompt);
  if (!tickets.length) return null;

  const live = liveSessions();
  const g = gateSelf(live, ctx.selfId);
  if (!g.ok) return degradedNote(g.reason, ctx, false);

  const read = readPresenceMap();
  if (read.state === 'unparsable') return degradedNote('presence-map-unparsable', ctx, false);

  const now = Date.now();
  const st = readState(ctx.stateFile);
  st.pairs = st.pairs || {};

  const lines = [];
  const sids = Object.keys(read.map);
  for (let t = 0; t < tickets.length; t++) {
    const ticket = tickets[t];
    for (let i = 0; i < sids.length; i++) {
      const sid = sids[i];
      if (sid === ctx.selfId) continue;
      const other = live.sessions.get(sid);
      if (!other) continue; // dead, or not in the registry: nothing to warn about
      const rec = read.map[sid];
      const namedAt = rec && rec.tickets ? rec.tickets[ticket] : null;
      if (typeof namedAt !== 'number') continue;

      // Ticket ids are global across projects, so NO folder filter here: a same-ticket
      // collision across two project folders is a real collision.
      const key = ctx.agentId + '|T|' + ticket + '|' + sid;
      const last = st.pairs[key];
      if (typeof last === 'number' && namedAt < last + REARM_MS) continue;
      st.pairs[key] = namedAt;

      lines.push('Live session `' + label(other.name, 40) + '` (pid ' + other.pid +
        (other.startedAt !== null ? ', started ' + hhmm(other.startedAt) : '') +
        ') last named **' + ticket + '** ' + ago(now - namedAt) +
        ' — a ticket this prompt names.');
      logEvent({
        ts: new Date().toISOString(),
        half: 'ticket',
        kind: 'warning',
        key: ticket,
        otherSession: sid,
        sessionId: ctx.selfId,
        agentId: ctx.agentId || null,
      });
    }
  }

  if (lines.length) writeState(ctx.stateFile, st);
  // Guarded so that a failure to record OUR OWN registration can never discard a warning about
  // someone else's that is already logged and already marked as shown — that warning would then
  // be lost permanently, not merely delayed.
  try {
    writePresenceMap(ctx, tickets, now);
  } catch (e) {
    /* the warning below still stands */
  }

  if (!lines.length) return null;
  return '**Concurrent session warning.** ' + lines.join(' ') +
    ' Before doing substantive work on it, surface this in the "\u{1F4CC} For you" block and ' +
    'ask Erez which session owns the work. Reading or discussing the ticket is fine.';
}

// -------------------------------------------------------------------------- folder half

function folderHalf(data, ctx) {
  const tool = typeof data.tool_name === 'string' ? data.tool_name : '';
  if (!FILE_TOOLS.test(tool)) return null;
  const ti = data.tool_input || {};
  const target = typeof ti.file_path === 'string' && ti.file_path
    ? ti.file_path
    : (typeof ti.notebook_path === 'string' ? ti.notebook_path : '');
  if (!target) return null;

  let folder;
  try {
    // Resolve a relative file_path against the PAYLOAD's cwd, not the hook process's: the writer
    // of the log rows being matched does the same (auto-approve.js resolves against input.cwd),
    // and a divergent base would compare two different absolute paths and silently never match.
    folder = path.dirname(path.resolve(typeof data.cwd === 'string' ? data.cwd : '', target));
  } catch (e) {
    return null;
  }

  const live = liveSessions();
  const g = gateSelf(live, ctx.selfId);
  if (!g.ok) return degradedNote(g.reason, ctx, true);

  // ONE authoritative containment root: the registry's cwd for this session. An earlier
  // revision also pre-filtered on the payload's own `cwd` to save the registry read for
  // out-of-tree files, but ANDing two roots that can diverge (a session launched in a
  // subfolder vs the harness reporting the project root) silently narrows coverage to their
  // intersection with nothing emitted to say so. The registry read is seven small files; the
  // measured cost of this half is dominated by node's own startup, not by it.
  //
  // Bounds the hook to this session's project tree, and keeps the key at folder rather than
  // project granularity. The mirror case (reading OUTSIDE my cwd) is a disclosed residual.
  if (!within(g.me.cwd, folder)) return null;

  // The WRITER's cwd is deliberately not tested: the folder match comes from the log entry's
  // own path, and testing the writer's cwd would hide real cross-project writes.
  const others = new Map();
  const it = live.sessions.entries();
  for (let e = it.next(); !e.done; e = it.next()) {
    if (e.value[0] !== ctx.selfId) others.set(e.value[0], e.value[1]);
  }
  if (!others.size) return null;

  const tail = readTail(EDIT_LOG, TAIL_CAP_BYTES);
  if (tail === null || !tail.text) return null;

  const rows = tail.text.split('\n');
  if (tail.offset > 0) rows.shift(); // a byte cut can land mid-record; a line cut cannot
  let nonEmpty = 0;
  let parsed = 0;
  let oldestSeen = Infinity;
  const hits = new Map(); // sid -> { files: [], lastTs }

  // Normalized once, then matched with string operations only. The per-row alternative
  // (path.dirname + path.resolve on every entry) cost ~200 ms per call over a full-size log,
  // on a hook that fires on every file tool call. The edit log's writer stores absolute
  // resolved paths, so lowercasing and unifying separators is sufficient here.
  const folderKey = norm(folder);
  if (!folderKey) return null;
  const folderPrefix = folderKey + '\\';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.trim()) continue;
    nonEmpty++;
    let o;
    try {
      o = JSON.parse(row);
    } catch (e) {
      continue; // per-line catch: one split or bad line must not blind the half
    }
    parsed++;
    if (!o || typeof o.session !== 'string' || typeof o.file !== 'string') continue;
    const when = typeof o.ts === 'string' ? Date.parse(o.ts) : NaN;
    if (!isFinite(when)) continue;
    if (when < oldestSeen) oldestSeen = when;
    if (o.session === ctx.selfId) continue;
    const other = others.get(o.session);
    if (!other) continue;
    if (other.startedAt !== null && when < other.startedAt) continue; // since IT started

    // Directly inside this folder: inside the prefix, with no further separator after it.
    const fileKey = o.file.replace(/\//g, '\\').toLowerCase();
    if (fileKey.indexOf(folderPrefix) !== 0) continue;
    const rest = fileKey.slice(folderPrefix.length);
    if (!rest || rest.indexOf('\\') !== -1) continue;
    if (PROTECTED_BASENAMES.has(rest)) continue;

    let h = hits.get(o.session);
    if (!h) {
      // -Infinity, not 0: a row whose ts parses to exactly 0 would fail `when > 0` and leave
      // lastFile null, and path.basename(null) throws — swallowing the whole warning in main's
      // catch after it has already been logged and deduped.
      h = { files: [], lastTs: -Infinity, lastFile: null };
      hits.set(o.session, h);
    }
    if (h.files.indexOf(o.file) === -1) h.files.push(o.file);
    if (when > h.lastTs || h.lastFile === null) {
      h.lastTs = when;
      h.lastFile = o.file;
    }
  }

  // A non-empty window that yields nothing parsable means the log's shape changed under us:
  // this half would otherwise go silent with nothing to show for it, and it has no
  // continuous health bar of its own.
  if (nonEmpty > 0 && parsed === 0) return degradedNote('edit-log-window-unparsable', ctx, true);

  // If the cap bound before reaching the start of a session that demonstrably writes in THIS
  // folder, the entries dropped are the OLDEST — the idle-session case that matters most.
  //
  // The comparison is against sessions with a hit here, not against the earliest start among
  // all live sessions: a session that has been open in an unrelated project since yesterday
  // would otherwise trip this note on every capped scan, which is a false alarm on the one
  // channel that is supposed to mean something. Residual: a session whose only writes in this
  // folder fall entirely before the window is invisible, so neither warns nor notes. At the
  // observed log volume the cap does not bind at all, and a bound cap is itself rare.
  //
  // It stands on its own when there is no warning to carry it, and is appended when there is:
  // degradedNote() consumes the once-per-session marker as soon as it is called, so discarding
  // the text on the warning path would burn the marker and mean the note is never seen at all.
  let capNote = null;
  if (tail.offset > 0 && isFinite(oldestSeen)) {
    let missedHistory = false;
    const hsids = hits.keys();
    for (let e = hsids.next(); !e.done; e = hsids.next()) {
      const rec = others.get(e.value);
      if (rec && typeof rec.startedAt === 'number' && rec.startedAt < oldestSeen) {
        missedHistory = true;
        break;
      }
    }
    if (missedHistory) capNote = degradedNote('edit-log-tail-capped', ctx, true);
  }

  if (!hits.size) return capNote;

  const now = Date.now();
  const st = readState(ctx.stateFile);
  st.pairs = st.pairs || {};
  const lines = [];
  const hkeys = hits.keys();
  for (let e = hkeys.next(); !e.done; e = hkeys.next()) {
    const sid = e.value;
    const h = hits.get(sid);
    const other = others.get(sid);
    const key = ctx.agentId + '|F|' + folderKey + '|' + sid;
    const last = st.pairs[key];
    if (typeof last === 'number' && h.lastTs < last + REARM_MS) continue;
    st.pairs[key] = h.lastTs;

    lines.push('Live session `' + label(other.name, 40) + '` (pid ' + other.pid + ') wrote `' +
      label(path.basename(h.lastFile), 80) + '` in this folder ' + ago(now - h.lastTs) +
      (h.files.length > 1 ? ' (' + h.files.length + ' files since it started)' : '') + '.');
    logEvent({
      ts: new Date().toISOString(),
      half: 'folder',
      kind: 'warning',
      key: folderKey,
      otherSession: sid,
      sessionId: ctx.selfId,
      agentId: ctx.agentId || null,
    });
  }
  if (!lines.length) return capNote;
  writeState(ctx.stateFile, st);

  return '**Concurrent session warning.** ' + lines.join(' ') +
    ' Files here may be mid-rewrite — treat what you read as possibly partial, and ' +
    'surface this in the "\u{1F4CC} For you" block before relying on it.' +
    (capNote ? '\n\n' + capNote : '');
}

// ---------------------------------------------------------------------------- formatting

function ago(ms) {
  if (!isFinite(ms) || ms < 0) return 'just now';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'less than a minute ago';
  if (mins === 1) return '1 minute ago';
  if (mins < 90) return mins + ' minutes ago';
  const hrs = Math.round(mins / 60);
  return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
}

// Session names and filenames written by ANOTHER session are interpolated into text that becomes
// model context, so a crafted filename would otherwise arrive as instructions. Bounded to a short
// single line of harmless characters — these are labels, and a mangled label is a fair price.
function label(s, max) {
  const out = String(s === null || s === undefined ? '' : s)
    .replace(/[`*_~\[\]<>\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!out) return '(unnamed)';
  return out.length > max ? out.slice(0, max) + '…' : out;
}

function hhmm(epochMs) {
  try {
    const d = new Date(epochMs);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  } catch (e) {
    return '?';
  }
}

// ---------------------------------------------------------------------------------- main

let input = '';
// Decode as UTF-8 at the stream, not by concatenating Buffers: a multibyte character split
// across two chunks would otherwise be mangled.
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (c) {
  input += c;
});
process.stdin.on('end', function () {
  let event = null;
  let additionalContext = null;
  try {
    const data = JSON.parse(input || '{}');
    event = typeof data.hook_event_name === 'string' ? data.hook_event_name : null;
    const selfId = typeof data.session_id === 'string' ? data.session_id : '';
    if (selfId && (event === 'UserPromptSubmit' || event === 'PreToolUse')) {
      const ctx = {
        selfId: selfId,
        agentId: typeof data.agent_id === 'string' ? data.agent_id : '',
        half: event === 'UserPromptSubmit' ? 'ticket' : 'folder',
        stateFile: stateFile(selfId),
      };
      additionalContext = event === 'UserPromptSubmit'
        ? ticketHalf(data, ctx)
        : folderHalf(data, ctx);
    }
  } catch (e) {
    additionalContext = null; // fail open on anything unexpected
  }

  if (additionalContext && event) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: additionalContext,
      },
    }));
  }
  process.exit(0);
});
