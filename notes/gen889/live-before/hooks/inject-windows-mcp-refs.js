// PostToolUse hook -- injects hooks/refs/windows-mcp.md (lessons for driving Erez's PC
// through the Windows-MCP add-on) once per session, at the moment a session reaches for
// the add-on (GEN-840):
//  - after a ToolSearch whose query or result names the add-on's tools (they are deferred
//    tools, so a session normally loads them this way before its first call -- this is the
//    point where the choice to use PC control is being made); or
//  - after the first Windows-MCP call that actually ran (fallback for a session where the
//    tools were not deferred).
// settings.json matcher: ToolSearch|mcp__windows-mcp__.*
//
// Sub-agent calls (agent_id present) are skipped: sub-agents may not use PC control
// (windows-mcp-approval.js blocks them), and injecting there would spend the session's
// once-only marker where the main session never sees it.
//
// Once-per-session marker in the OS temp dir, written only when a note is injected. Never
// blocks the tool call. A missing/empty refs file injects a one-line warning instead of
// silence (GEN-336); any other error fails open silently.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'mcp__windows-mcp__';

function shouldInject(data) {
  const tool = typeof data.tool_name === 'string' ? data.tool_name : '';
  if (data.agent_id !== undefined && data.agent_id !== null) return false;
  if (tool.startsWith(PREFIX)) return true;
  if (tool !== 'ToolSearch') return false;
  const query = data.tool_input && typeof data.tool_input.query === 'string' ? data.tool_input.query : '';
  let response = '';
  try { response = JSON.stringify(data.tool_response === undefined ? null : data.tool_response); } catch (e) { response = ''; }
  return /windows-mcp/i.test(query) || response.indexOf(PREFIX) >= 0;
}

function main() {
  let input = '';
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', () => {
    let additionalContext = null;
    try {
      const data = JSON.parse(input || '{}');
      const safeId = (typeof data.session_id === 'string' ? data.session_id : '').replace(/[^A-Za-z0-9_-]/g, '');
      if (safeId && shouldInject(data)) {
        const marker = path.join(os.tmpdir(), 'claude-windows-mcp-refs-' + safeId);
        let claimed = false;
        // Exclusive create claims the one injection, even when two calls arrive together;
        // marker first, so a crash after this point can only under-inject, never repeat.
        try { fs.writeFileSync(marker, new Date().toISOString(), { flag: 'wx' }); claimed = true; } catch (e) { claimed = false; }
        if (claimed) {
          const refFile = path.join(__dirname, 'refs', 'windows-mcp.md');
          let refText = '';
          try { refText = fs.readFileSync(refFile, 'utf8'); } catch (e) { refText = ''; }
          additionalContext = refText && refText.trim()
            ? refText
            : 'inject-windows-mcp-refs: refs/windows-mcp.md missing or empty -- PC-control lessons were NOT loaded; flag this to Erez.';
        }
      }
    } catch (e) {
      // fail open -- inject nothing
    }
    if (additionalContext) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }));
    }
    process.exit(0);
  });
}

if (require.main === module) main();
module.exports = { shouldInject };
