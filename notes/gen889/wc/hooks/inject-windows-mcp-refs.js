// PostToolUse hook -- injects the PC-control notes (lessons for driving Erez's PC through the
// Windows-MCP add-on) at the moment a session reaches for the add-on (GEN-840):
//  - after a ToolSearch whose query or result names the add-on's tools (they are deferred
//    tools, so a session normally loads them this way before its first call -- this is the
//    point where the choice to use PC control is being made); or
//  - after a Windows-MCP call that actually ran (fallback for a session where the tools were
//    not deferred).
// settings.json matcher: ToolSearch|mcp__windows-mcp__.*
//
// Two parts (GEN-958): Claude Code caps each injected string at 10,000 characters, so the notes
// are split. Part 1 (refs/windows-mcp.md, the rules needed before the first action) goes with
// the first qualifying call; part 2 (refs/windows-mcp-troubleshooting.md) with the next one.
// One part per call, each with its own once-per-session marker claude-refs-windows-mcp-part<N>-
// <session_id>, so inject-topic-refs.js --reset-after-compact (SessionStart "compact") clears
// both and the notes come back after a compaction. A part over the cap is not injected; a
// one-line note gives its size and path instead (same rule as inject-browser-refs.js).
//
// Sub-agent calls (agent_id present) are skipped: sub-agents may not use PC control
// (windows-mcp-approval.js blocks them), and injecting there would spend the session's
// once-only markers where the main session never sees them.
//
// Never blocks the tool call. A missing/empty notes file injects a one-line note instead of
// silence (GEN-336); any other error fails open silently.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'mcp__windows-mcp__';
const PARTS = [
  { n: 1, file: 'windows-mcp.md', what: 'PC-control notes (part 1 of 2)' },
  { n: 2, file: 'windows-mcp-troubleshooting.md', what: 'PC-control troubleshooting notes (part 2 of 2)' },
];
// 500 under Claude Code's per-string limit on injected text, read through guidelines-limits.js
// (notes/anthropic-guidelines.json, hook-injected-text), as in inject-browser-refs.js. Read only
// when a part is about to be injected, since this hook runs on every ToolSearch.
const FALLBACK_NOTES_CAP = 10000;
function injectCap() {
  try {
    const c = require('./guidelines-limits.js').readLimit('hook-injected-text', { fallback: FALLBACK_NOTES_CAP, min: 2000, max: 100000 }).value;
    if (Number.isInteger(c)) return c - 500;
  } catch (e) { /* missing or broken reader: keep the fallback */ }
  return FALLBACK_NOTES_CAP - 500;
}

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

function markerPath(tmpDir, n, safeId) { return path.join(tmpDir, 'claude-refs-windows-mcp-part' + n + '-' + safeId); }

// The text one part injects: the notes, or a one-line note when the file is missing, empty or
// over the cap.
function partText(part, hooksDir) {
  const refFile = path.join(hooksDir, 'refs', part.file);
  let refText = '';
  try { refText = fs.readFileSync(refFile, 'utf8'); } catch (e) { refText = ''; }
  if (!refText || !refText.trim()) {
    return 'inject-windows-mcp-refs: refs/' + part.file + ' missing or empty -- ' + part.what + ' were NOT loaded; flag this to Erez.';
  }
  const cap = injectCap();
  if (refText.length > cap) {
    return 'inject-windows-mcp-refs: refs/' + part.file + ' is ' + refText.length + ' characters, over the ' + cap + ' that fit in one injection -- read it with the Read tool (' + refFile + ') and tell Erez it needs splitting.';
  }
  return refText;
}

// Pure core, exported for tests. opts: { tmpDir, hooksDir }. Returns the text to inject or null.
// Delivers the first part whose marker this call claims; a later part waits for a later call.
function handle(data, opts) {
  const safeId = (typeof data.session_id === 'string' ? data.session_id : '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!safeId || !shouldInject(data)) return null;
  try { fs.mkdirSync(opts.tmpDir, { recursive: true }); } catch (e) { /* the claim below reports it */ }
  for (const part of PARTS) {
    // Exclusive create claims this part's one injection, even when two calls arrive together
    // (the loser moves on to the next part); marker first, so a crash after this point can only
    // under-inject, never repeat. Any other write error: inject nothing this call.
    try {
      fs.writeFileSync(markerPath(opts.tmpDir, part.n, safeId), new Date().toISOString(), { flag: 'wx' });
    } catch (e) {
      if (e && e.code === 'EEXIST') continue;
      return null;
    }
    return partText(part, opts.hooksDir);
  }
  return null;
}

function main() {
  let input = '';
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', () => {
    let additionalContext = null;
    try {
      const data = JSON.parse(input || '{}');
      additionalContext = handle(data, { tmpDir: os.tmpdir(), hooksDir: __dirname });
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
module.exports = { shouldInject, handle, PARTS };
