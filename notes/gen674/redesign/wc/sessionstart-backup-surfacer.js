// SessionStart hook — GEN-382 Phase B step 1a: backup-failure surfacer.
//
// The backup sweep (backup-sweep.ps1) appends one JSON record per line to an
// append-only failure queue whenever a repo could NOT be safely backed up
// (secret quarantined, remote unreachable, file locked/torn, mid-op skip, etc.).
// This hook, at every session start, shows the operator any failures it has not
// shown before, so a failed backup can never sit silently unseen.
//
// CONTRACT WITH THE WRITER (backup-sweep.ps1 Add-Failure):
//   - The queue file is APPEND-ONLY. The writer never rewrites it, and a
//     background sweep may append at any moment. So this reader NEVER writes the
//     queue file — not even to flip the record's `surfaced` flag. Editing it in
//     place would race the concurrent append and could corrupt the very file the
//     backup system depends on.
//   - Instead we keep our OWN small cursor file recording how many bytes of the
//     queue we have already surfaced. Next session we read only bytes past the
//     cursor. The queue stays untouched; no race with the writer.
//   - Records are UTF-8, NO BOM, one compact JSON object per line, shape:
//     { ts, machine, session, repo, kind, detail, surfaced }.
//
// CURSOR SAFETY (byte offset):
//   - If the queue shrank below the stored cursor (rotated/truncated/replaced),
//     the offset is stale — reset to 0 and re-surface from the start. Re-nagging
//     is acceptable; missing a failure is not. Fail toward showing, never hiding.
//   - A trailing partial line (a sweep mid-append when we read) is NOT consumed:
//     we advance the cursor only past the last COMPLETE newline-terminated line,
//     so the partial line is re-read whole next session.
//
// Fails open: any error → surface nothing, never disrupt session startup, and do
// NOT advance the cursor (so nothing is silently marked-shown on a read error).
// BUT never fail SILENTLY: every catch writes a one-line breadcrumb to STDERR
// (never stdout — stdout is the hookSpecificOutput JSON contract) so a hook that
// chokes on its own is distinguishable from "there were no failures to show".
//
// CONCURRENCY (deliberately accepted, do NOT "fix" with locking): multiple
// sessions can hit SessionStart at once. Each computes its advance purely from
// its OWN (start-cursor, snapshot-size) read; it never trusts a concurrently
// written cursor except at its own initial read. The only race outcome is a
// cursor REGRESSION (a later write with a smaller offset), which causes a
// harmless duplicate re-surface next session — never a lost record. Adding a
// lock would trade this safe behavior for fragility.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Drain stdin (required for the 'end' event to fire) but we don't need the
// payload — this hook keys off files, not the SessionStart JSON.
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  let additionalContext = null;
  // Cursor advance is DEFERRED: we compute it here but persist it only AFTER a
  // successful stdout emission below. Advancing before the message is shown would
  // mark records "seen" that a crash/kill (between the two writes) never displayed
  // — and the cleanly-advanced cursor would never re-surface them. Show first,
  // then mark seen.
  let pendingCursorFile = null;
  let pendingCursor = null;
  try {
    const claudeDir = path.join(os.homedir(), '.claude');
    const queueFile = path.join(claudeDir, 'backup-sweep-failures.jsonl');
    const cursorFile = path.join(claudeDir, 'backup-sweep-surfacer-cursor.json');

    // No queue yet → nothing has ever failed → nothing to surface.
    if (fs.existsSync(queueFile)) {
      const size = fs.statSync(queueFile).size;

      // Read the stored byte cursor. Missing/corrupt → start from 0.
      let cursor = 0;
      try {
        if (fs.existsSync(cursorFile)) {
          const c = JSON.parse(fs.readFileSync(cursorFile, 'utf8') || '{}');
          if (Number.isInteger(c.offset) && c.offset >= 0) cursor = c.offset;
        }
      } catch (e) {
        cursor = 0; // corrupt cursor → re-surface from start (never hide)
        process.stderr.write(
          `backup-surfacer: unreadable/corrupt cursor, re-surfacing from start (${e && e.message})\n`
        );
      }

      // Queue shrank below the cursor → stale offset → re-read from start. (The
      // real writer is strictly append-only, so a same-size content SWAP can't
      // happen — this guard only catches a genuine shrink from rotation/reset.)
      if (cursor > size) cursor = 0;

      if (cursor < size) {
        // TOCTOU note: we read exactly [cursor, size) using the `size` captured
        // above. Any bytes a concurrent sweep appends AFTER that snapshot are
        // simply not requested here and get picked up next session — benign by
        // construction, NOT a race to guard against.
        const fd = fs.openSync(queueFile, 'r');
        let buf;
        try {
          const len = size - cursor;
          buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, cursor);
        } finally {
          fs.closeSync(fd);
        }

        // Advance only past the last COMPLETE line so a trailing partial
        // (sweep mid-append) is re-read whole next session.
        const lastNl = buf.lastIndexOf(0x0a); // '\n'
        const completeEnd = lastNl >= 0 ? lastNl + 1 : 0;
        const text = buf.toString('utf8', 0, completeEnd);
        const newCursor = cursor + completeEnd;

        const lines = text.split('\n').filter(l => l.trim().length > 0);
        const recs = [];
        for (const line of lines) {
          try {
            recs.push(JSON.parse(line));
          } catch (e) {
            // A single malformed line must not lose the others. Keep a raw
            // marker so a corrupt entry is still visible, not silently dropped.
            recs.push({ __raw: line });
          }
        }

        if (recs.length > 0) {
          additionalContext = buildMessage(recs);
        }

        // Stage the cursor advance; it is persisted AFTER the stdout write (see
        // the deferred-persist block below the try). We own this file; we never
        // touch the queue file.
        if (newCursor !== cursor) {
          pendingCursorFile = cursorFile;
          pendingCursor = newCursor;
        }
      }
    }
  } catch (e) {
    // fail open — surface nothing, disrupt nothing — but leave a breadcrumb so a
    // hook that broke on its own is not mistaken for "no failures to show".
    additionalContext = null;
    try {
      process.stderr.write(`backup-surfacer: failed open (${e && e.message})\n`);
    } catch (e2) {
      /* stderr itself unavailable — nothing more we can safely do */
    }
  }

  // GEN-860: session-backup staleness check. Independent of the queue AND of the copier hook, so a
  // copier that never runs (unregistered, script missing, killed every time) is still noticed. Runs
  // after the queue read so its own failure can never stop queued records from being shown.
  // GEN-703: projectBackupStaleLine replaces the per-record 'postponed' lines (see buildMessage); the
  // slow-copy line was removed because the Drive copy now runs in the background (async hook).
  // GEN-674: every session start (startup, /clear, resume, compact) drops all one-time size approvals, so
  // a grant left by an earlier session's denied prompt can never serve a later one. A concurrent session's
  // pending approval is dropped too; its crossing is then refused and asked again (safe direction).
  try {
    const okDir = path.join(os.homedir(), '.claude-staging', 'rulesize' + '-ok');
    for (const n of fs.readdirSync(okDir)) {
      if (/^grant-.*\.json$/.test(n)) fs.rmSync(path.join(okDir, n), { force: true });
    }
  } catch (e) {
    /* no folder yet, or a file in use: the grant still expires within 10 minutes */
  }
  const staleLines = [];
  for (const check of [projectBackupStaleLine, sessionBackupStaleLine, accountSyncStaleLine, rulesFileSizeLine]) {
    try {
      const line = check(path.join(os.homedir(), '.claude'), Date.now());
      if (line) staleLines.push(line);
    } catch (e) {
      try {
        process.stderr.write(`backup-surfacer: session-backup check failed (${e && e.message})\n`);
      } catch (e2) {
        /* stderr unavailable */
      }
    }
  }

  // GEN-703: keep the whole injected text under Claude Code's 10,000-character limit for hook output
  // (over it, Claude sees only a 2,000-character preview). The staleness lines are short and always
  // kept whole; only the queue listing is cut, at a line boundary, from its end (secrets are listed
  // first there, so a cut falls on the least important records).
  const staleText = staleLines.join('\n\n');
  if (additionalContext) {
    const budget = MAX_CONTEXT_CHARS - (staleText ? staleText.length + 2 : 0) - CUT_NOTE.length;
    if (additionalContext.length > budget + CUT_NOTE.length) {
      const nl = additionalContext.lastIndexOf('\n', Math.max(budget, 0));
      additionalContext = additionalContext.slice(0, nl > 0 ? nl : Math.max(budget, 0)) + CUT_NOTE;
    }
  }
  if (staleText) additionalContext = additionalContext ? `${additionalContext}\n\n${staleText}` : staleText;
  if (additionalContext && additionalContext.length > MAX_CONTEXT_CHARS) {
    // Only reachable if the staleness lines alone exceed the limit; cut them at a line boundary too.
    const nl = additionalContext.lastIndexOf('\n', MAX_CONTEXT_CHARS - CUT_NOTE.length);
    additionalContext = additionalContext.slice(0, nl > 0 ? nl : MAX_CONTEXT_CHARS - CUT_NOTE.length) + CUT_NOTE;
  }

  // Emit the message FIRST (so it is shown), THEN persist the cursor (mark seen).
  // If emission throws, we deliberately do NOT advance the cursor, so the batch
  // re-surfaces next session — never a mark-seen-but-never-shown gap.
  let emittedOk = true;
  if (additionalContext) {
    try {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext,
          },
        })
      );
    } catch (e) {
      emittedOk = false;
      try {
        process.stderr.write(
          `backup-surfacer: failed to emit message, NOT advancing cursor (${e && e.message})\n`
        );
      } catch (e2) {
        /* stderr unavailable — nothing more we can safely do */
      }
    }
  }

  // Persist the staged cursor advance only if the message was emitted (or there
  // was no message to emit — e.g. the batch was only blank lines). A persist
  // failure just means we re-surface next session (safe re-nag).
  if (pendingCursorFile !== null && pendingCursor !== null && emittedOk) {
    try {
      fs.writeFileSync(
        pendingCursorFile,
        JSON.stringify({ offset: pendingCursor }),
        'utf8'
      );
    } catch (e) {
      try {
        process.stderr.write(
          `backup-surfacer: could not persist cursor, will re-surface next session (${e && e.message})\n`
        );
      } catch (e2) {
        /* stderr unavailable */
      }
    }
  }

  // Give the stdout write a tick to flush before exit. Piped stdout is
  // synchronous on Windows/POSIX in modern Node (verified: no truncation up to
  // 8MB), but exiting on the next tick is belt-and-suspenders and costs nothing.
  process.exitCode = 0;
});

// GEN-860: one line when the last successful session backup (session-backup.ps1 writes epoch ms to
// ~/.claude/session-backup-state/last-success after a complete run) is more than 24 h older than the
// newest change to a top-level session transcript (~/.claude/projects/<project>/<id>.jsonl); else null.
// A missing or unreadable last-success counts as "never succeeded" (fail toward showing). Repeats at
// every session start until a copy succeeds. A future modified time (clock skew) is capped at now.
const SESSION_BACKUP_STALE_MS = 24 * 60 * 60 * 1000;
const SESSION_BACKUP_IGNORE_RECENT_MS = 10 * 60 * 1000;
function sessionBackupStaleLine(claudeDir, now) {
  let lastSuccess = 0;
  let future = false;
  try {
    const n = Number(String(fs.readFileSync(path.join(claudeDir, 'session-backup-state', 'last-success'), 'utf8')).trim());
    // A stamp in the future (clock jumped back after it was written) cannot be trusted: treat it as never.
    if (Number.isFinite(n) && n > 0 && n <= now) lastSuccess = n;
    else if (Number.isFinite(n) && n > now) future = true;
  } catch (e) {
    /* missing/unreadable -> never succeeded */
  }
  const projectsDir = path.join(claudeDir, 'projects');
  let newest = 0;
  for (const ent of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    let files;
    try {
      files = fs.readdirSync(path.join(projectsDir, ent.name), { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      try {
        const m = fs.statSync(path.join(projectsDir, ent.name, f.name)).mtimeMs;
        // Skip changes from the last 10 minutes: they may belong to this very session start, whose own
        // copy runs in parallel with this check.
        if (m > newest && m < now - SESSION_BACKUP_IGNORE_RECENT_MS) newest = m;
      } catch (e) {
        /* vanished between list and stat */
      }
    }
  }
  newest = Math.min(newest, now);
  if (newest === 0 || newest - lastSuccess <= SESSION_BACKUP_STALE_MS) return null;
  const fmt = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const since = lastSuccess
    ? `since ${fmt(lastSuccess)}`
    : future
      ? 'reliably (its last-success time is in the future; the PC clock may have changed)'
      : 'at all (no successful copy is recorded)';
  return (
    `SESSION BACKUP — the automatic copy of Claude sessions to the Drive backup has not succeeded ${since}, ` +
    `but sessions changed after that (newest change ${fmt(newest)}). Recent sessions may be missing from the backup. ` +
    'Relay this to Erez at the top of your first response. Run log: ~/.claude/session-backup-state/runs.log.'
  );
}

// GEN-703: one line when a project repo has gone more than 24 h past its last successful GitHub backup
// while backups of it kept being postponed or failing; else null. Replaces listing every 'postponed'
// record (a time-limit skip, which never contacted GitHub) at every session start.
//   - Last success: backup-sweep.ps1 writes epoch ms to ~/.claude/backup-sweep-state/<repoKey>.lastsuccess
//     after each successful push; repoKey = first 16 hex chars (upper case) of the SHA-1 of the
//     lower-cased repo path, exactly as the sweep computes it.
//   - Activity: records in the failure queue for that repo, or for '(spawn)' (a run that failed or was
//     cut off before reaching any repo), dated at or after INSTALL_CUTOFF_MS. Records from before the
//     install (when skips were still labelled 'unreachable') are ignored, and a repo with no stamp yet
//     is measured from the install time, so the old backlog cannot trigger it.
//   - Stale: the records dated after max(last success, install time) span more than 24 h, i.e. backups of
//     it kept being postponed or failing for over a day with no success in between. One record after a
//     quiet weekend (success on Friday, a single postponed run on Monday) does not trigger it, and with no
//     records there is nothing to warn about.
//   - Reads the whole queue (its last 1 MB) every time, independent of the cursor, so a record that was
//     already shown, or never listed, still counts.
// Repos: immediate subfolders of PROJECTS_DIR that hold a .git entry (same rule as the spawner).
const PROJECTS_DIR = 'C:\\Users\\Erez\\AI Projects';
const INSTALL_CUTOFF_MS = Date.parse('2026-10-20T08:20:30Z'); // GEN-703 install day; re-set if installed more than a day later
const PROJECT_BACKUP_STALE_MS = 24 * 60 * 60 * 1000;
const QUEUE_TAIL_BYTES = 1024 * 1024;
const MAX_CONTEXT_CHARS = 9000;
const CUT_NOTE = '\n…(list cut to stay under the hook-text limit; the full list is in ~/.claude/backup-sweep-failures.jsonl). Relay this to Erez at the top of your first response.';
function repoKeyOf(repoPath) {
  return require('crypto').createHash('sha1').update(repoPath.toLowerCase(), 'utf8').digest('hex').toUpperCase().slice(0, 16);
}
function projectBackupStaleLine(claudeDir, now) {
  if (!Number.isFinite(INSTALL_CUTOFF_MS)) return null;
  let repos = [];
  try {
    // Same rule as the spawner's findProjectRepos, including a symlink/junction to a directory.
    repos = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => {
        let isDir = d.isDirectory();
        if (!isDir && d.isSymbolicLink()) {
          try { isDir = fs.statSync(path.join(PROJECTS_DIR, d.name)).isDirectory(); } catch (e) { isDir = false; }
        }
        return isDir && fs.existsSync(path.join(PROJECTS_DIR, d.name, '.git'));
      })
      .map(d => path.join(PROJECTS_DIR, d.name));
  } catch (e) {
    return null; // no projects folder
  }
  if (repos.length === 0) return null;
  const queueFile = path.join(claudeDir, 'backup-sweep-failures.jsonl');
  let size;
  try {
    size = fs.statSync(queueFile).size;
  } catch (e) {
    return null; // no queue: nothing has been postponed or failed
  }
  const len = Math.min(size, QUEUE_TAIL_BYTES);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(queueFile, 'r');
  try {
    fs.readSync(fd, buf, 0, len, size - len);
  } finally {
    fs.closeSync(fd);
  }
  const timesByRepo = new Map(); // lower-cased repo path -> record times
  const spawnTimes = [];
  for (const line of buf.toString('utf8').split('\n')) {
    let r;
    try {
      r = JSON.parse(line);
    } catch (e) {
      continue; // partial first line, or a malformed line (the cursor path shows those)
    }
    if (!r || typeof r.repo !== 'string') continue;
    const t = Date.parse(r.ts);
    if (!Number.isFinite(t) || t < INSTALL_CUTOFF_MS || t > now) continue;
    if (r.repo === '(spawn)') {
      spawnTimes.push(t);
    } else {
      const k = r.repo.toLowerCase();
      if (!timesByRepo.has(k)) timesByRepo.set(k, []);
      timesByRepo.get(k).push(t);
    }
  }
  const fmt = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const stale = [];
  for (const repo of repos) {
    const own = timesByRepo.get(repo.toLowerCase()) || [];
    if (own.length === 0 && spawnTimes.length === 0) continue;
    let lastSuccess = 0;
    try {
      const n = Number(String(fs.readFileSync(path.join(claudeDir, 'backup-sweep-state', repoKeyOf(repo) + '.lastsuccess'), 'utf8')).trim());
      if (Number.isFinite(n) && n > 0 && n <= now) lastSuccess = n;
    } catch (e) {
      /* no stamp yet -> measured from the install time below */
    }
    const base = Math.max(lastSuccess, INSTALL_CUTOFF_MS);
    let first = Infinity;
    let last = 0;
    // A repo with no stamp yet (new, or renamed: the key is a hash of its path) counts only its OWN
    // records; '(spawn)' records from before it existed must not make a brand-new project look stale.
    for (const t of lastSuccess ? own.concat(spawnTimes) : own) {
      if (t <= base) continue;
      if (t < first) first = t;
      if (t > last) last = t;
    }
    if (last === 0 || last - first <= PROJECT_BACKUP_STALE_MS) continue;
    stale.push(`${path.basename(repo)} (${lastSuccess ? 'last backed up ' + fmt(lastSuccess) : 'no successful backup recorded since ' + fmt(INSTALL_CUTOFF_MS)})`);
  }
  if (stale.length === 0) return null;
  return (
    `PROJECT BACKUP — ${stale.length === 1 ? 'this project has' : 'these projects have'} gone more than 24 h without a successful ` +
    `backup to GitHub, while backups kept being postponed or failing for over a day: ${stale.join('; ')}. Committed work still reaches GitHub ` +
    'at each /wrap. Relay this to Erez at the top of your first response. Details: ~/.claude/backup-sweep-failures.jsonl.'
  );
}

// GEN-859: one line when the account session sync (hooks/account-session-sync.js) has not completed a run
// for more than 24 h while the session lists kept changing, or when its off switch is set; else null.
// Independent of the sync hook, so a sync that never runs (unregistered, crashing, budget-starved) is still
// noticed. Silent on a PC without the desktop app or with fewer than two accounts' lists.
const ACCOUNT_SYNC_STALE_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_SYNC_IGNORE_RECENT_MS = 10 * 60 * 1000;
function accountSyncStaleLine(claudeDir, now) {
  const root = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude-code-sessions');
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  let accounts;
  try {
    accounts = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && UUID_RE.test(d.name)).map(d => d.name);
  } catch (e) {
    return null; // no desktop app session lists on this PC
  }
  if (accounts.length < 2) return null;
  const stateDir = path.join(claudeDir, 'account-session-sync');
  const fmt = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  let off = null;
  try { off = fs.statSync(path.join(stateDir, 'disabled')); } catch (e) { /* not switched off */ }
  if (off) {
    return (
      `ACCOUNT SESSION SYNC — switched OFF since ${fmt(off.mtimeMs)} (~/.claude/account-session-sync/disabled exists), ` +
      "so sessions from one Claude account are not being copied to the other account's list. " +
      'Relay this to Erez at the top of your first response.'
    );
  }
  let lastSuccess = 0;
  try {
    const n = Number(String(fs.readFileSync(path.join(stateDir, 'last-success'), 'utf8')).trim());
    if (Number.isFinite(n) && n > 0 && n <= now) lastSuccess = n;
  } catch (e) {
    /* missing/unreadable -> never succeeded */
  }
  let newest = 0;
  for (const acct of accounts) {
    let orgs = [];
    try { orgs = fs.readdirSync(path.join(root, acct), { withFileTypes: true }).filter(d => d.isDirectory()); } catch (e) { continue; }
    for (const org of orgs) {
      let names = [];
      try { names = fs.readdirSync(path.join(root, acct, org.name)); } catch (e) { continue; }
      for (const n of names) {
        if (!n.startsWith('local_') || !n.endsWith('.json')) continue;
        try {
          const m = fs.statSync(path.join(root, acct, org.name, n)).mtimeMs;
          if (m > newest && m < now - ACCOUNT_SYNC_IGNORE_RECENT_MS) newest = m;
        } catch (e) {
          /* vanished between list and stat */
        }
      }
    }
  }
  newest = Math.min(newest, now);
  if (newest === 0 || newest - lastSuccess <= ACCOUNT_SYNC_STALE_MS) return null;
  const since = lastSuccess ? `since ${fmt(lastSuccess)}` : 'at all (no completed run is recorded)';
  return (
    `ACCOUNT SESSION SYNC — the copy that keeps both Claude accounts' session lists matched has not completed ${since}, ` +
    `but the lists changed after that (newest change ${fmt(newest)}). Sessions may be missing after switching accounts. ` +
    'Relay this to Erez at the top of your first response. Run log: ~/.claude/account-session-sync/changes.log.'
  );
}

// GEN-674: one line when the always-loaded global rules file (~/.claude/CLAUDE.md) is over its line limit
// and the size approval record does not cover its current text; else null. update-config.ps1 measures
// every write to that file. It writes the record ({lines, sha256 of the written bytes, approvedOn}) when
// Erez approves a crossing on the size prompt, carries it forward on a later trim that stays over the
// limit, and deletes it once the file is back at or under the limit. So over-limit text that did not
// arrive through that route (a write the gates did not recognise, a Drive copy pulled in by sync,
// break-glass) shows up here at every session start until it is fixed. The line rule and limit mirror
// update-config.ps1 (Get-RulesLineCount, Get-RulesLineLimit) and config-health-scan.ps1 Get-LineCount:
// keep the three in step. A read failure on the rules file is reported, not hidden.
const RULES_LINE_CAP = 200;
function rulesFileSizeLine(claudeDir, now) {
  const home = path.join(claudeDir, '..');
  const dropBom = s => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
  let buf;
  try {
    buf = fs.readFileSync(path.join(claudeDir, 'CLAUDE.md'));
  } catch (e) {
    return (
      `RULES-FILE SIZE — could not read ~/.claude/CLAUDE.md to check its size (${(e && (e.code || e.message)) || 'unknown error'}). ` +
      'Tell Erez in the 📌 For you block of your first reply.'
    );
  }
  const text = dropBom(buf.toString('utf8'));
  let lines = 0;
  if (text.length > 0) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
    if (text.charCodeAt(text.length - 1) !== 10) lines++;
  }
  let limit = RULES_LINE_CAP;
  try {
    const g = JSON.parse(dropBom(fs.readFileSync(path.join(home, 'AI Projects', 'Improve AI Infra', 'notes', 'anthropic-guidelines.json'), 'utf8')));
    const entry = g && Array.isArray(g.limits) ? g.limits.find(x => x && x.id === 'claude-md-lines') : null;
    if (entry && Number.isInteger(entry.value) && entry.value > 0 && entry.value < limit) limit = entry.value;
  } catch (e) {
    /* unreadable or malformed -> 200 (the file can only lower the limit) */
  }
  if (lines <= limit) return null;
  const sha = require('crypto').createHash('sha256').update(buf).digest('hex');
  let rec = null;
  try {
    rec = JSON.parse(dropBom(fs.readFileSync(path.join(home, '.claude-staging', 'rulesize' + '-ok', 'record.json'), 'utf8')));
  } catch (e) {
    /* no record */
  }
  if (rec && rec.sha256 === sha) return null;
  return (
    `RULES-FILE SIZE — your always-loaded rules file ~/.claude/CLAUDE.md is ${lines} lines, over its ${limit}-line limit, ` +
    'with no OK from Erez on record for its current text. Tell Erez in the 📌 For you block of your first reply, ' +
    `in plain words, and offer to bring it back to ${limit} lines or fewer.`
  );
}

// Build the operator-facing message. Kinds map to plain-language meaning; the
// most severe (a secret that was NOT backed up) is called out first.
function buildMessage(allRecs) {
  // GEN-703: 'postponed' records (a time-limit skip or a run cut off by a session close; GitHub was
  // never contacted) are not listed one by one. projectBackupStaleLine warns instead when a repo goes
  // 24 h past its last successful backup. They are still consumed by the cursor like any record.
  const recs = allRecs.filter(r => !(r && r.kind === 'postponed'));
  if (recs.length === 0) return null;
  const KIND_LABEL = {
    secret: 'SUSPECTED SECRET — repo was NOT backed up (quarantined pending your review)',
    unreachable: 'could not push to GitHub (no answer in time, or the push was refused — see detail) — not backed up this pass; the work is safe on this PC, will retry',
    postponed: 'postponed (time limit, or session closed) — will retry',
    torn: 'file changing mid-save — skipped this pass, will retry',
    locked: 'file locked/unreadable — repo skipped (fail-closed), will retry',
    'lock-skip': 'another sweep held the lock — skipped this pass',
    size: 'file over the size limit — not backed up (needs LFS or another destination)',
    'mid-op': 'repo mid-merge/rebase — skipped to avoid backing up conflict debris',
    error: 'backup error — see detail',
    // GEN-860 session backup (session-backup.ps1)
    'session-shrunk': 'a session transcript on this PC got shorter or its earlier content changed — the older Drive backup copy was kept under _previous-versions',
    'session-held': 'a session file on this PC is empty or looks cut off — its Drive backup copy was kept, not replaced',
    'session-transcript-lost': 'a session still listed in the Claude app lost its transcript on this PC — the detail says whether the Drive backup holds it (reported once)',
    // GEN-859 account session sync (account-session-sync.js)
    'account-sync-error': "account session sync problem — the two Claude accounts' session lists may not match; see detail",
  };

  // Severity order: secret first (highest), then the rest as listed. Null-safe
  // partition (a record could be null or a __raw marker with no kind).
  const severe = recs.filter(r => r && r.kind === 'secret');
  // GEN-860: session-backup data notices next, so the 25-record cap below cannot bury them under a
  // run of routine 'unreachable' records.
  const SESSION_KINDS = new Set(['session-transcript-lost', 'session-shrunk', 'session-held', 'account-sync-error']);
  const sessionNotices = recs.filter(r => r && SESSION_KINDS.has(r.kind));
  const rest = recs.filter(r => !(r && (r.kind === 'secret' || SESSION_KINDS.has(r.kind))));
  const ordered = severe.concat(sessionNotices, rest);

  // Cap how many records we render into a single session-context injection, so a
  // pathological backlog can't bloat the context. All records are still COUNTED
  // in the header; secrets sort first, so a cap never buries a secret. Truncated
  // remainder is named, not silently dropped ("+N more — see the queue file").
  const MAX_SHOWN = 25;
  const shown = ordered.slice(0, MAX_SHOWN);
  const hidden = ordered.length - shown.length;

  // Render each record independently. A throw on ONE oddly-shaped record must
  // never blanket-suppress the rest of the batch (which, since the cursor would
  // not advance, would silently re-hide every failure each session) — so each
  // render is isolated and a failure degrades to a raw marker, never a drop.
  const lines = shown.map(r => {
    try {
      if (r && r.__raw) return `  • [unparseable queue line] ${clean(r.__raw, 500)}`;
      const rec = r || {};
      const label = KIND_LABEL[rec.kind] || `${clean(rec.kind, 40) || 'unknown'}`;
      const repo = clean(rec.repo, 300) || '(unknown repo)';
      const when = clean(rec.ts, 40);
      const detail = rec.detail ? ` — ${clean(rec.detail, 500)}` : '';
      return `  • ${label}\n    repo: ${repo}${detail}\n    when: ${when}`;
    } catch (e) {
      // Last-resort: show something rather than lose the record.
      return `  • [unrenderable failure record] ${safeStringify(r)}`;
    }
  });
  if (hidden > 0) {
    lines.push(
      `  • …and ${hidden} more — see ~/.claude/backup-sweep-failures.jsonl`
    );
  }

  const secretCount = severe.length;
  const header =
    `BACKUP SWEEP — ${recs.length} unseen failure${recs.length === 1 ? '' : 's'} from a prior backup run` +
    (secretCount > 0
      ? ` (⚠ ${secretCount} SUSPECTED SECRET — that repo was NOT backed up):`
      : ':');

  const footer =
    secretCount > 0
      ? 'ACTION: Relay this to Erez immediately at the top of your first response. For each SUSPECTED SECRET, the repo was NOT pushed anywhere; Erez must rule on the flagged content before it can be backed up.'
      : 'Relay this to Erez at the top of your first response so a failed backup is not missed. Most kinds retry automatically next sweep.';

  return `${header}\n${lines.join('\n')}\n${footer}`;
}

// Neutralize a free-text field before injecting it into session context: coerce
// to string, strip control chars (incl. CR/LF/tab) so a crafted repo path or git
// error can't fake line structure that mimics an instruction block, collapse
// runs of whitespace, and bound the length. Returns '' for null/undefined.
function clean(v, max) {
  if (v === null || v === undefined) return '';
  let s;
  try {
    s = String(v);
  } catch (e) {
    return '(unrepresentable)';
  }
  // Replace ASCII control chars (0x00-0x1F) and DEL (0x7F) -- incl. CR/LF/TAB -- with a space, collapse whitespace, trim.
  s = s.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const limit = max || 500;
  if (s.length > limit) s = s.slice(0, limit) + '…';
  return s;
}

// Stringify a record for the last-resort render path without ever throwing
// (JSON.stringify can throw on circular refs / BigInt); returns a bounded string.
function safeStringify(v) {
  try {
    return String(JSON.stringify(v)).slice(0, 500);
  } catch (e) {
    try {
      return String(v).slice(0, 500);
    } catch (e2) {
      return '(unrepresentable)';
    }
  }
}
