// PreToolUse hook — deterministic injection of the Invoice Automation deployment /
// `clasp` reference notes, once per session, at the first Bash/PowerShell tool call
// whose command actually runs `clasp` or `deploy.ps1`. Part of the CLAUDE.md-shrink
// reliability work (GEN-673); same shape as inject-shell-refs.js but content-gated on
// the command text so it fires only for deploy/clasp activity, not every shell call.
//
// The deploy-cued rules were moved OUT of the always-loaded Invoice Automation project
// CLAUDE.md into hooks/refs/deployment.md; this hook injects them when they become
// relevant. The rules that must fire BEFORE any deploy command (e.g. "give one next
// action only", "run all terminal commands directly") deliberately STAY always-loaded
// in that project CLAUDE.md and are not carried here.
//
// Scope note (accepted): the hook is global, so it evaluates every project's shell
// calls, but only injects when the command matches `clasp`/`deploy.ps1`. `clasp` is a
// Google CLI and `deploy.ps1` a generic filename, so a different project could match;
// deployment.md carries a self-scoping disclaimer up top so a misfire is self-correcting.
//
// Known timing gap (accepted, as in inject-shell-refs.js): the notes arrive WITH the
// first matching call, so that first command is composed without them — acceptable for
// reference detail whose failure is visible/recoverable, and the always-loaded pointer
// in the project CLAUDE.md names the silent-failure-prone topics (parameterized `clasp
// run`, OAuth scopes) so they are guarded before the first call too.
//
// Once-per-session: a marker file in the OS temp dir keyed by session_id. No session_id
// in the input -> inject nothing (never risk re-injecting every call). Never blocks the
// tool call. A missing/empty refs file (GEN-336) is a distinguished condition that
// injects a one-line warning instead of silence; any OTHER error (e.g. malformed stdin)
// still fails open silently via the outer catch.

const fs = require('fs');
const os = require('os');
const path = require('path');

let input = '';
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  let additionalContext = null;
  try {
    const data = JSON.parse(input || '{}');
    const toolName = typeof data.tool_name === 'string' ? data.tool_name : '';
    const sessionId = typeof data.session_id === 'string' ? data.session_id : '';
    const command = data.tool_input && typeof data.tool_input.command === 'string' ? data.tool_input.command : '';

    // Defense in depth — settings.json's matcher should already filter to shell tools.
    const isShellTool = /^(Bash|PowerShell)$/.test(toolName);
    // Content gate: only inject when the command actually runs clasp or deploy.ps1.
    const isDeployCmd = /\bclasp\b/i.test(command) || /deploy\.ps1/i.test(command);
    // Marker filename: session_id sanitized to safe chars only.
    const safeId = sessionId.replace(/[^A-Za-z0-9_-]/g, '');

    if (isShellTool && isDeployCmd && safeId) {
      const marker = path.join(os.tmpdir(), 'claude-deployment-refs-' + safeId);
      if (!fs.existsSync(marker)) {
        const refFile = path.join(__dirname, 'refs', 'deployment.md');
        // Explicit missing/empty check (GEN-336) -- a distinguished, expected condition
        // that warns instead of the outer catch-all's silent fail-open. The marker is
        // written on this branch too, so the warning is once-per-session.
        if (!fs.existsSync(refFile)) {
          fs.writeFileSync(marker, new Date().toISOString());
          additionalContext = 'inject-deployment-refs: refs/deployment.md is missing or empty, so the deployment reference notes are not in this session; Erez has not been told.';
        } else {
          const refText = fs.readFileSync(refFile, 'utf8');
          if (refText && refText.trim()) {
            // Write the marker BEFORE emitting, so a crash after this point can only
            // under-inject (fail open), never spam every subsequent call.
            fs.writeFileSync(marker, new Date().toISOString());
            additionalContext = refText;
          } else {
            fs.writeFileSync(marker, new Date().toISOString());
            additionalContext = 'inject-deployment-refs: refs/deployment.md is missing or empty, so the deployment reference notes are not in this session; Erez has not been told.';
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
