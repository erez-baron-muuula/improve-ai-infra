// PreToolUse hook — deterministic injection of file-editing reference notes at the
// first Read/Edit/Write/NotebookEdit tool call of a session. Same pattern as
// inject-shell-refs.js (GEN-86 CLAUDE.md-shrink work), built for GEN-340: the
// remaining resident rules with no shell/Notion cue needed a new trigger, and
// Read/Edit/Write/NotebookEdit is the reliable cue for file-editing rules.
//
// Coverage note (see GEN-340 plan): the harness requires a file to have been Read
// in this conversation before an Edit of it, so including Read in the matcher
// guarantees this note is in context BEFORE the first such Edit — closing the
// timing gap that kept the "delete code by exact text" note resident. This only
// covers Edit-of-an-existing-file; a brand-new Write has no prior Read and the
// note arrives WITH that first call (acceptable: the relocated note is about
// deleting existing code, which a new-file Write doesn't do). Shell-based file
// rewrites (head/tail, Set-Content, sed) never touch this hook at all — they are
// covered separately by inject-shell-refs.js / hooks/refs/shell.md, which is why
// that file carries its own copy of this same warning.
//
// Once-per-session: a marker file in the OS temp dir keyed by session_id. No
// session_id in the input -> inject nothing (never risk re-injecting every call).
// Never blocks the tool call. A missing/empty refs file (GEN-336) is a distinguished
// condition that injects a one-line warning instead of silence; any OTHER error
// (e.g. malformed stdin) still fails open silently via the outer catch.
//
// GEN-342 (added): SEPARATELY from the once-per-session editing.md note above, on
// ANY Read/Edit/Write/NotebookEdit whose file_path is the Invoice Automation Code.js,
// inject a short grep-anchored POINTER to fileHeldInvoiceManually_'s header-comment
// contract. This fires on EVERY such call (NO per-session dedup) — deliberately, so it
// survives a mid-session /compact and is present just-in-time at each Code.js edit, not
// only the first. It is a POINTER (names the function to grep for), never a copy of the
// contract, so it cannot silently rot; the single source of truth is the helper's own
// header comment in Code.js. Path-scoped to the project-qualified path (never a bare
// "code.js"), and fails open (stale path -> no reminder, never a wrong claim). Inherent,
// accepted residual (same as the editing.md note): PreToolUse fires AFTER the model
// composed the current call, so any one injection informs the NEXT composition; re-firing
// on every call mitigates this and keeps the note re-surfacing after /compact.

const fs = require('fs');
const os = require('os');
const path = require('path');

// GEN-342: the pointer injected for edits to the Invoice Automation Code.js. Deliberately
// a POINTER (grep anchor to the function) and NOT a copy of the contract — the single
// source of truth is fileHeldInvoiceManually_'s own header comment in Code.js.
const INVOICE_CODEJS_POINTER =
  'Editing Invoice Automation Code.js: some functions here feed `fileHeldInvoiceManually_`, ' +
  'the rare Gemini-outage hand-file backup that runs ONLY during outages — so a break in what ' +
  'it depends on stays silent until the next outage. Before finishing this edit, find ' +
  '`function fileHeldInvoiceManually_` and read its header comment; make sure your change ' +
  'preserves — or updates that comment to match — the input contract it documents (required ' +
  'vs optional field names, enum values, and argument ORDER) for the shared helpers it calls.';

// GEN-342: normalized project-qualified tail of the Invoice Automation Code.js path. Matched
// as a suffix so it survives drive-letter/casing differences while staying project-scoped
// (never a bare "code.js", which would misfire across projects).
const INVOICE_CODEJS_TAIL = 'ai projects/invoiceautomation/code.js';

let input = '';
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  const parts = [];
  try {
    const data = JSON.parse(input || '{}');
    const toolName = typeof data.tool_name === 'string' ? data.tool_name : '';
    const sessionId = typeof data.session_id === 'string' ? data.session_id : '';

    // Defense in depth — settings.json's matcher should already filter to file tools.
    const isFileTool = /^(Read|Edit|Write|NotebookEdit)$/.test(toolName);
    // Marker filename: session_id sanitized to safe chars only.
    const safeId = sessionId.replace(/[^A-Za-z0-9_-]/g, '');

    // (existing) Once-per-session editing.md injection.
    if (isFileTool && safeId) {
      const marker = path.join(os.tmpdir(), 'claude-edit-refs-' + safeId);
      if (!fs.existsSync(marker)) {
        const refFile = path.join(__dirname, 'refs', 'editing.md');
        // Explicit missing/empty check (GEN-336) -- a distinguished, expected
        // condition that warns instead of the outer catch-all's silent fail-open.
        // The marker is written on this branch too, so the warning is once-per-session.
        if (!fs.existsSync(refFile)) {
          fs.writeFileSync(marker, new Date().toISOString());
          parts.push('inject-edit-refs: refs/editing.md missing or empty — file-editing reference notes were NOT loaded; flag this to Erez.');
        } else {
          const refText = fs.readFileSync(refFile, 'utf8');
          if (refText && refText.trim()) {
            // Write the marker BEFORE emitting, so a crash after this point can only
            // under-inject (fail open), never spam every subsequent call.
            fs.writeFileSync(marker, new Date().toISOString());
            parts.push(refText);
          } else {
            fs.writeFileSync(marker, new Date().toISOString());
            parts.push('inject-edit-refs: refs/editing.md missing or empty — file-editing reference notes were NOT loaded; flag this to Erez.');
          }
        }
      }
    }

    // (GEN-342) Fire on EVERY Read/Edit/Write/NotebookEdit of the Invoice Automation
    // Code.js — no dedup, so it survives mid-session /compact and is present at each edit.
    if (isFileTool) {
      const fp = data.tool_input && typeof data.tool_input.file_path === 'string' ? data.tool_input.file_path : '';
      const norm = fp.replace(/\\/g, '/').toLowerCase();
      if (norm.endsWith(INVOICE_CODEJS_TAIL)) {
        parts.push(INVOICE_CODEJS_POINTER);
      }
    }
  } catch (e) {
    // fail open — inject nothing
  }

  // Emit wrapped in try/finally so exit(0) is GUARANTEED even if a future change ever
  // pushes a non-serializable value into parts (join/stringify throw) — hardens the
  // never-block / fail-open guarantee this hook exists to keep. (Both /vet-code code-review
  // passes flagged the previously-bare emit as a latent fail-open-if-changed risk.)
  try {
    if (parts.length) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext: parts.join('\n\n'),
          },
        })
      );
    }
  } finally {
    process.exit(0);
  }
});
