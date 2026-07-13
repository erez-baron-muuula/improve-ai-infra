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

// Build the operator-facing message. Kinds map to plain-language meaning; the
// most severe (a secret that was NOT backed up) is called out first.
function buildMessage(recs) {
  const KIND_LABEL = {
    secret: 'SUSPECTED SECRET — repo was NOT backed up (quarantined pending your review)',
    unreachable: 'remote unreachable — backed up locally, did NOT reach GitHub, will retry',
    torn: 'file changing mid-save — skipped this pass, will retry',
    locked: 'file locked/unreadable — repo skipped (fail-closed), will retry',
    'lock-skip': 'another sweep held the lock — skipped this pass',
    size: 'file over the size limit — not backed up (needs LFS or another destination)',
    'mid-op': 'repo mid-merge/rebase — skipped to avoid backing up conflict debris',
    error: 'backup error — see detail',
  };

  // Severity order: secret first (highest), then the rest as listed. Null-safe
  // partition (a record could be null or a __raw marker with no kind).
  const severe = recs.filter(r => r && r.kind === 'secret');
  const rest = recs.filter(r => !(r && r.kind === 'secret'));
  const ordered = severe.concat(rest);

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
