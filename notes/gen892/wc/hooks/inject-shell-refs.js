// PreToolUse hook — deterministic injection of shell reference notes at the first
// Bash/PowerShell tool call of a session. Part of the CLAUDE.md-shrink reliability
// work (GEN-86, same pattern as inject-notion-refs.js but tool-call-triggered, since
// shell work rarely announces itself in the user's prompt text).
//
// The non-dangerous PowerShell/shell gotchas were moved OUT of the always-loaded
// global CLAUDE.md into hooks/refs/shell.md; this hook injects them once per session,
// alongside the first shell tool call (settings.json matcher: Bash|PowerShell).
// GEN-825: the PowerShell, web/credential-tool and script-running notes were split out
// into refs/shell-*.md (listed at the end of shell.md) and are injected by
// inject-topic-refs.js on their own narrower triggers; this file keeps the general core.
//
// Known timing gap (accepted by design): the notes arrive WITH the first shell call,
// so that first command is composed without them — acceptable for reference detail
// whose failure is visible and recoverable. Safety-critical shell notes (silent
// String.Replace mass-deletion, empty-string arg drop, literal-$ in -NewText)
// deliberately STAY in the always-loaded CLAUDE.md and are not carried by this hook.
// One deliberate exception (GEN-337(e)): shell.md carries a REMINDER of the
// no-mixed-risk-chaining rule whose authoritative copy stays in CLAUDE.md — it is
// enforced by auto-approve.js's hard block, so this copy is a nudge, not the guard.
//
// Once-per-session: a marker file in the OS temp dir keyed by session_id. No
// session_id in the input -> inject nothing (never risk re-injecting every call).
// After a compaction, inject-topic-refs.js --reset-after-compact deletes this marker
// so the notes come back (GEN-825).
//
// Size guard (GEN-825): Claude Code caps each injected string at 10,000 characters and
// shows only a file path + 2,000-char preview above that, so an oversized shell.md is cut
// after the whole lines that fit in 9,000, with a line telling the session to Read the
// file in full and to tell Erez it needs splitting (once per session, with the notes).
//
// Never blocks the tool call. A missing/empty refs file (GEN-336) is a distinguished
// condition that injects a one-line warning instead of silence; any OTHER error
// (e.g. malformed stdin) still fails open silently via the outer catch.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Claude Code's per-string limit on injected text. Since GEN-892 it follows notes/anthropic-guidelines.json
// (hook-injected-text) through guidelines-limits.js; FALLBACK_CAP is used when that cannot be read.
const FALLBACK_CAP = 10000;
let CAP = FALLBACK_CAP;
try {
  const c = require('./guidelines-limits.js').readLimit('hook-injected-text', { fallback: FALLBACK_CAP, min: 2000, max: 100000 }).value;
  if (Number.isInteger(c)) CAP = c;
} catch (e) { /* missing or broken reader: keep the fallback */ }
const KEEP = CAP - 1000;  // over the cap, keep whole lines up to this many characters
const fmtNum = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Copied from inject-topic-refs.js (fitToCap) until GEN-697 consolidates the inject hooks.
function fitToCap(text, refFile, flagErez, cap = CAP) {
  if (text.length <= cap) return text;
  const keep = cap - (CAP - KEEP);
  let kept = '';
  for (const line of text.split('\n')) {
    const next = kept ? kept + '\n' + line : line;
    if (next.length > keep) break;
    kept = next;
  }
  let note = '\n\n(Notes cut here: this file is ' + text.length + ' characters, over the ' + fmtNum(CAP) + '-character limit on injected text, so only the lines above are included. The full file is ' + refFile + ' and should be read in full before relying on these notes.)';
  if (flagErez) note += '\n(Erez should be told that refs/' + path.basename(refFile) + ' needs splitting: it is over the ' + fmtNum(CAP) + '-character limit.)';
  return kept + note;
}

let input = '';
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  let additionalContext = null;
  try {
    const data = JSON.parse(input || '{}');
    const toolName = typeof data.tool_name === 'string' ? data.tool_name : '';
    const sessionId = typeof data.session_id === 'string' ? data.session_id : '';

    // Defense in depth — settings.json's matcher should already filter to shell tools.
    const isShellTool = /^(Bash|PowerShell)$/.test(toolName);
    // Marker filename: session_id sanitized to safe chars only.
    const safeId = sessionId.replace(/[^A-Za-z0-9_-]/g, '');

    if (isShellTool && safeId) {
      const marker = path.join(os.tmpdir(), 'claude-shell-refs-' + safeId);
      if (!fs.existsSync(marker)) {
        const refFile = path.join(__dirname, 'refs', 'shell.md');
        // Explicit missing/empty check (GEN-336) -- a distinguished, expected
        // condition that warns instead of the outer catch-all's silent fail-open.
        // The marker is written on this branch too, so the warning is once-per-session.
        if (!fs.existsSync(refFile)) {
          fs.writeFileSync(marker, new Date().toISOString());
          additionalContext = 'inject-shell-refs: refs/shell.md missing or empty — shell reference notes were NOT loaded; flag this to Erez.';
        } else {
          const refText = fs.readFileSync(refFile, 'utf8');
          if (refText && refText.trim()) {
            // Write the marker BEFORE emitting, so a crash after this point can only
            // under-inject (fail open), never spam every subsequent call.
            fs.writeFileSync(marker, new Date().toISOString());
            // The marker makes this once per session, so the "needs splitting" flag rides along.
            additionalContext = fitToCap(refText, refFile, true);
          } else {
            fs.writeFileSync(marker, new Date().toISOString());
            additionalContext = 'inject-shell-refs: refs/shell.md missing or empty — shell reference notes were NOT loaded; flag this to Erez.';
          }
        }
      }
    }
  } catch (e) {
    // fail open — inject nothing
  }

  if (additionalContext) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext,
        },
      })
    );
  }
  process.exit(0);
});
