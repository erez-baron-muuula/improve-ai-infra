// UserPromptSubmit / PreToolUse / SessionStart hook -- deterministic, once-per-session injection
// of the topic reference notes split out of hooks/refs/notion.md and refs/shell.md (GEN-825).
//
// Why split: Claude Code caps each hook-injected string at 10,000 characters; over that, the
// session gets only a file path plus a 2,000-character preview and is not asked to read the file
// (docs: code.claude.com/docs/en/hooks, "JSON output" -- measured per string, even when several
// hooks fire on one event). Both files had grown past 22,000, so sessions saw about a tenth of
// each. Each bullet now lives in the topic file whose trigger is the moment it is needed, and
// this one script delivers all seven new topics. Its arguments are the topics one settings.json
// registration serves, in priority order:
//   node inject-topic-refs.js <topic> [<topic> ...]
//   node inject-topic-refs.js --reset-after-compact      (SessionStart, matcher "compact")
// One process per registration, not one per topic: hook processes on this PC slow each other
// down roughly in proportion to how many start at once (measured 2026-10-18: 5 in parallel took
// ~2.3 s, 10 took ~4.4 s), so five per-topic registrations on every shell call would add seconds.
// refs/notion.md and refs/shell.md keep their own hooks (inject-notion-refs.js on every
// Notion-worded prompt, inject-shell-refs.js at the first shell call) and list these files.
//
// Combining: the notes whose triggers match this call are joined in argument order while the
// total stays under the cap. A note that does not fit is NOT marked as delivered; one short line
// names it, and it arrives with the next call that matches it. The first note of a call that is
// too big for the room left (after any warning lines) is cut by the size guard instead.
//
// Once per session per topic: a marker file in the OS temp dir named
// claude-refs-<topic>-<session_id>[-<agent_id>], shared by the topic's prompt and tool triggers,
// so a Notion-worded prompt and a later Notion tool call inject the note only once. A sub-agent
// (agent_id present) gets its own marker, because the main session's injection never reaches
// it. No session_id in the input -> inject nothing (never risk re-injecting every call).
//
// Known timing gap (accepted, as in inject-shell-refs.js): a tool-triggered note arrives WITH
// the first matching call, so that one call is composed without it. Verified 2026-10-18: a note
// still arrives when another PreToolUse hook blocks the call (auto-approve.js exit 2).
//
// After a compaction (SessionStart, source "compact") the once-per-session notes would be lost
// with the old context, so --reset-after-compact deletes this session's markers (these topics'
// and inject-shell-refs.js's claude-shell-refs-<session_id>) and the next trigger re-injects.
//
// Size guard: a refs file too big for the room left is cut after the whole lines that fit,
// followed by a line saying where the full file is and that Erez should be told it needs
// splitting (once per session, with the note). /wrap flags a refs file over 9,000 when it
// appends to one, which is the earlier, durable signal.
//
// Never blocks anything. A missing/empty refs file (GEN-336) injects a one-line warning instead
// of silence (once per session -- the marker is claimed first); any other error fails open.

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
const POINTER_ROOM = 500;  // kept free for the line naming notes left for a later call
const SEP = '\n\n---\n\n';

// Notion signals in the user's prompt -- copied from inject-notion-refs.js.
const NOTION_PROMPT_PATTERNS = [
  /\bnotion\b/i,               // the word "Notion"
  /\bGEN-\d+\b/,               // Team-Tasks ticket IDs (GEN-123)
  /notion\.so\//i,             // notion.so URLs
  /\bnotion-[a-z-]+\b/i,       // Notion MCP tool names (notion-create-pages, notion-fetch, ...)
  /\bTeam-Tasks\b/i,           // the Team-Tasks board
  /collection:\/\//i,          // data-source URLs
];

// Notion MCP tools, any connector id. Reads = fetch, search, get-*, list-*, query-*, download-*;
// every other Notion tool, including a new unknown one, counts as a write.
const NOTION_TOOL_RE = /^mcp__.+__notion-(.+)$/;
const NOTION_READ_RE = /^(?:fetch|search|get-|list-|query-|download-)/;

const NOTION_REST_RES = [/api\.notion\.com/i, /claude-notion-token/i, /notion-ticket-lookup/i];
const VETTICKET_RES = [/--ticket-hash\b/];
const SHELL_PS_CMD_RES = [/\b(?:powershell|pwsh)(?:\.exe)?\b/i, /\.ps1\b/i];
const SHELL_TOOLS_RES = [
  /\bcurl(?:\.exe)?\b/i,
  /\bInvoke-(?:WebRequest|RestMethod)\b/i,
  /\b(?:iwr|irm|wget)\b/i,           // PowerShell aliases of the two above
  /\baz(?:\.cmd)?\b/i,
  /\bgh\s+[a-z]/,
  /\bcmdkey\b/i,
  /\bgit\s+credential\b/i,
  // an option argument is one whole shell word (quoted runs and plain characters, no overlap
  // between the branches -- an overlapping form backtracked exponentially on many -c "k=v")
  /\bgit(?:\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|[^"'\s])+|--no-pager|--git-dir=\S+))*\s+(?:push|pull|fetch|clone)\b/i,
];
const SHELL_SCRIPTING_RES = [
  /\bnode(?:\.exe)?(?=["'\s]|$)/i,
  /\bpython[0-9.]*(?:\.exe)?(?=["'\s]|$)/i,
  /\bpy(?:\.exe)?(?=\s)/,            // the Windows Python launcher
  /\bclaude\.exe\b/i,
  /(?:^|[\n;&|(]\s*)claude\s/,
];

function toolName(d) { return typeof d.tool_name === 'string' ? d.tool_name : ''; }
function shellCommand(d) {
  if (!/^(?:Bash|PowerShell)$/.test(toolName(d))) return '';
  return d.tool_input && typeof d.tool_input.command === 'string' ? d.tool_input.command : '';
}
function anyMatch(res, s) { return !!s && res.some(re => re.test(s)); }
function notionKind(d) {
  const m = NOTION_TOOL_RE.exec(toolName(d));
  if (!m) return null;
  return NOTION_READ_RE.test(m[1]) ? 'read' : 'write';
}
function isPowerShellWork(d) {
  const t = toolName(d);
  if (t === 'PowerShell') return true;
  if (t === 'Bash') return anyMatch(SHELL_PS_CMD_RES, shellCommand(d));
  if (t === 'Write' || t === 'Edit' || t === 'MultiEdit') {
    const fp = d.tool_input && typeof d.tool_input.file_path === 'string' ? d.tool_input.file_path : '';
    return /\.ps1$/i.test(fp);
  }
  return false;
}

// topic -> refs file, whether a Notion-worded prompt triggers it, and its tool-call test.
const TOPICS = {
  'notion-read':      { file: 'notion-read.md',      promptCue: true,  tool: d => notionKind(d) === 'read' },
  'notion-write':     { file: 'notion-write.md',     promptCue: true,  tool: d => notionKind(d) === 'write' },
  'notion-rest':      { file: 'notion-rest.md',      promptCue: false, tool: d => anyMatch(NOTION_REST_RES, shellCommand(d)) },
  'notion-vetticket': { file: 'notion-vetticket.md', promptCue: false, tool: d => anyMatch(VETTICKET_RES, shellCommand(d)) },
  'shell-ps':         { file: 'shell-ps.md',         promptCue: false, tool: isPowerShellWork },
  'shell-tools':      { file: 'shell-tools.md',      promptCue: false, tool: d => anyMatch(SHELL_TOOLS_RES, shellCommand(d)) },
  'shell-scripting':  { file: 'shell-scripting.md',  promptCue: false, tool: d => anyMatch(SHELL_SCRIPTING_RES, shellCommand(d)) },
};

function safe(s) { return (typeof s === 'string' ? s : '').replace(/[^A-Za-z0-9_-]/g, ''); }

// Exclusive create: true only for the one call that claims the marker, even when two calls
// arrive together. Marker first, so a crash after this point can only under-inject.
function claim(marker) {
  try { fs.writeFileSync(marker, new Date().toISOString(), { flag: 'wx' }); return true; } catch (e) { return false; }
}

// Over the cap: keep the whole lines that fit in cap - 1000, then say where the rest is.
// flagErez adds the "needs splitting" line. Shared logic, copied into inject-notion-refs.js and
// inject-shell-refs.js until GEN-697 consolidates the inject hooks.
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

function resetAfterCompact(data) {
  if (data.source !== 'compact') return;
  const safeId = safe(data.session_id);
  if (!safeId) return;
  const dir = os.tmpdir();
  for (const name of fs.readdirSync(dir)) {
    const ours = name === 'claude-shell-refs-' + safeId ||
      (name.startsWith('claude-refs-') && (name.endsWith('-' + safeId) || name.includes('-' + safeId + '-')));
    if (ours) { try { fs.unlinkSync(path.join(dir, name)); } catch (e) { /* already gone */ } }
  }
}

function fires(topic, data) {
  const event = typeof data.hook_event_name === 'string' ? data.hook_event_name : '';
  if (event === 'UserPromptSubmit') {
    const prompt = typeof data.prompt === 'string' ? data.prompt : '';
    return topic.promptCue && !!prompt && NOTION_PROMPT_PATTERNS.some(re => re.test(prompt));
  }
  if (event === 'PreToolUse') return !!topic.tool(data);
  return false;
}

// Build this call's injected text from the topics one registration serves.
function injectTopics(topicNames, data) {
  const parts = [];
  for (const name of topicNames) {
    if (!Object.prototype.hasOwnProperty.call(TOPICS, name)) {
      parts.push('inject-topic-refs: unknown topic "' + name + '" in its settings.json registration -- no notes loaded for it; flag this to Erez.');
    }
  }
  const safeId = safe(data.session_id);
  if (!safeId) return parts.length ? parts.join(SEP) : null;
  const safeAgent = safe(data.agent_id);
  const deferred = [];
  let notesIn = 0;  // real notes included so far (warnings do not count)
  for (const name of topicNames) {
    if (!Object.prototype.hasOwnProperty.call(TOPICS, name)) continue;
    const topic = TOPICS[name];
    if (!fires(topic, data)) continue;
    const marker = path.join(os.tmpdir(), 'claude-refs-' + name + '-' + safeId + (safeAgent ? '-' + safeAgent : ''));
    if (fs.existsSync(marker)) continue;
    const refFile = path.join(__dirname, 'refs', topic.file);
    let refText = '';
    try { refText = fs.readFileSync(refFile, 'utf8'); } catch (e) { refText = ''; }
    const missing = !refText.trim();
    const text = missing
      ? 'inject-topic-refs: refs/' + topic.file + ' missing or empty -- ' + name + ' reference notes were NOT loaded; flag this to Erez.'
      : refText;
    const used = parts.length ? parts.join(SEP).length + SEP.length : 0;
    const room = CAP - POINTER_ROOM - used;
    let piece;
    if (text.length <= room) piece = text;
    else if (!missing && !notesIn) piece = fitToCap(text, refFile, true, room);  // first note and too big: cut it
    else { deferred.push(topic.file); continue; }                                // leave it for its next call
    if (!claim(marker)) continue;  // a parallel call delivered it
    parts.push(piece);
    if (!missing) notesIn++;
  }
  if (deferred.length) {
    parts.push('(Also relevant to this call, but left out to stay under the ' + fmtNum(CAP) + '-character limit on injected text: ' +
      deferred.join(', ') + ' in ' + path.join(__dirname, 'refs') + '. Each is included with the next call that matches it; read it now if this call depends on it.)');
  }
  return parts.length ? parts.join(SEP) : null;
}

function main() {
  const args = process.argv.slice(2);
  let input = '';
  process.stdin.on('data', c => (input += c));
  process.stdin.on('end', () => {
    let additionalContext = null;
    let event = '';
    try {
      const data = JSON.parse(input || '{}');
      event = typeof data.hook_event_name === 'string' ? data.hook_event_name : '';
      if (args[0] === '--reset-after-compact') resetAfterCompact(data);
      else additionalContext = injectTopics(args, data);
    } catch (e) {
      additionalContext = null; // fail open -- inject nothing
    }
    if (additionalContext && (event === 'UserPromptSubmit' || event === 'PreToolUse')) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }));
    }
    process.exit(0);
  });
}

if (require.main === module) main();
module.exports = { TOPICS, notionKind, fitToCap, injectTopics, CAP, KEEP, POINTER_ROOM };
