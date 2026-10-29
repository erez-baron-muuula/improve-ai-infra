#!/usr/bin/env node
// PreToolUse approval gate for the Windows-MCP add-on (server name "windows-mcp").
// It replaces Claude Code's own permission prompt for this add-on. The add-on refuses any
// call made within 10 s of physical mouse/keyboard input (v0.8.8 windows_mcp/desktop/control.py
// _snapshot_locked / _tick_locked / begin_call), so a click on Claude's prompt always got the
// approved call refused. This hook first runs the delete guard, then shows its own window
// (windows-mcp-approval.ps1). After Erez clicks Allow, the window waits until he has been
// hands-off long enough, and only then does this hook allow the call.
//
// Announce-first (2026-10-18): a session once opened the window with no word in chat, so it
// came as a surprise. Now the first Windows-MCP call of each turn (one prompt_id) is blocked
// without a window, telling Claude to say in chat what it will do and why. The retry opens
// the window once assistant text has been written after that block; the text is shown in the
// window as "Claude says (unverified)", under the folder the call came from and the session's
// name (Claude can rename a session, so the name is labelled unverified too). This layer is a
// courtesy, not the safety gate: if the turn can't be tracked, the transcript can't be read,
// or two rounds pass with no text, the window opens anyway. Its state files sit in the temp
// folder, where a session's own shell could edit them; that can change what "Claude says"
// shows or skip the heads-up, never approve a call. Sub-agent calls are blocked outright,
// since Erez never sees a sub-agent's messages.
// A window that ends without approval leaves a marker; if the summary Erez saw didn't report
// it, prompt-wmcp-miss-reminder.js reminds the session when Erez sends his next message.
//
// Task pass (GEN-908, 2026-10-19): a short screen task used to need one window per action.
// When Claude's heads-up holds a "PC task:" block (the task, one target app, the exact texts
// it will type), the window shows that block as this hook parsed it and offers "Allow for
// this task". On that click (and only after the nonce check and the delete guard pass), this
// hook writes a task pass, tied to this session and turn, into its own folder. While the pass
// is valid (same turn, under 10 minutes, under 30 actions), a call runs WITHOUT a window only
// if it is on a fixed allowlist: a read-only look, or a left click / scroll / move / declared
// text at an exact screen point whose window belongs to the declared app (checked by
// windows-mcp-point.ps1), with no approval window open; typing also needs the app already in
// front, and no other screen-changing call anywhere on the PC may be running or awaiting
// approval (one "running" note per call, removed by this hook's PostToolUse / PostToolUseFailure run).
// Anything else opens the window as before, and a window Erez denies or leaves
// unanswered ends the pass. The pass folder is guarded in auto-approve.js against Claude's own tools; a program
// running as Erez could still forge a pass (the same accepted risk as these hook files, GEN-903).
//
// Task block from the "Ready?" message (GEN-908 live check, 2026-10-19): on 5.5-family models,
// prose written just before a tool call is often returned as a short reworded progress note,
// which loses the block's lines; a turn's closing text (no tool call after it) has always come
// back word for word. So when this turn is Erez's own reply, the block from the message where
// Claude asked him "Ready?" (the last text since his previous message holding a "PC task:"
// line, with no PC-control call after it) is used too, offered in one window per turn at most.
// The first call's bounce tells Claude whether one was found.
//
// Stuck add-on (GEN-920 / GEN-933, 2026-10-25): the add-on sometimes wedges - its own
// "who is in control" state stops moving and it refuses every later call in that session
// (v0.8.8 desktop/control.py; upstream issues #456, #465, #478). The PostToolUse /
// PostToolUseFailure run reads each refusal and ControlStatus result; once a wedge is
// confirmed, this session's calls (except ControlStatus) are refused without a window, and
// Claude is told what to ask Erez to do, until the add-on reports a change.
//
// Requirements, both in the global ~/.claude/settings.json (GEN-879: all folders):
//  - NO "ask" permission rule for mcp__windows-mcp: an ask rule still prompts even when a
//    hook allows, which would bring the refused-click problem back.
//  - This hook registered with "onFailure": "block" (Claude Code 2.1.295+), so a crash,
//    a hook that cannot start, or a timeout blocks the call instead of letting it through.
//
// Fails CLOSED: the allow decision is printed only after the window exits 0 AND prints the
// exact per-call nonce line and the delete guard passes both before and after the window, or
// after a valid task pass covers the call and the delete guard passes. Every other path
// exits 2 (block).

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SERVER_PREFIX = 'mcp__windows-mcp__';
const GUARD = path.join(__dirname, 'windows-mcp-delete-guard.js');
const WINDOW = path.join(__dirname, 'windows-mcp-approval.ps1');
const POINT = path.join(__dirname, 'windows-mcp-point.ps1');
// Fixed path (not from the environment): this program's output decides approval.
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
// Must stay below the hook's "timeout" in settings.json (300 s). The window's own budget is
// up to 45 s queued behind another approval + 120 s to answer + 60 s hands-off, plus startup.
const WINDOW_TIMEOUT_MS = 280000;
const POINT_TIMEOUT_MS = 20000;
// The add-on runs this tool without its hands-off rule (tools/control_notifications.py
// on_call_tool), so the window approves it as soon as Allow is clicked.
const NO_WAIT_TOOLS = new Set(['ControlStatus']);

// Shared with prompt-wmcp-miss-reminder.js (same directory name there).
const STATE_DIR = path.join(os.tmpdir(), 'claude-wmcp');
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BLOCK_ROUNDS = 2;     // after this many announce-blocks with no text, open the window anyway
const ROUND_GAP_MS = 3000;      // blocks closer together than this are parallel calls of one round
const MIN_ANNOUNCE_CHARS = 20;  // shorter text ("Retrying.") does not count as an announcement
const SAYS_CAP = 300;
const FOLDER_CAP = 80;
const TITLE_CAP = 60;
const TRANSCRIPT_READ_CAP = 8 * 1024 * 1024;
// The "Ready?" message can sit behind several MB of screenshots from that turn.
const PRIOR_READ_CAP = 32 * 1024 * 1024;
// The session name is searched backwards in chunks: one Screenshot result line can be
// several MB of image data, so a single 1 MB tail often misses it.
const TITLE_CHUNK = 1024 * 1024;
const TITLE_OVERLAP = 64 * 1024;
const TITLE_SCAN_CAP = 32 * 1024 * 1024;

// ---- Task pass (GEN-908) ----
// The folder name is built from two parts so no file of ours holds it whole: auto-approve.js
// refuses any Claude file write or command that names it.
const PASS_DIR = path.join(os.homedir(), '.claude-staging', 'wmcp-task' + '-passes');
const PASS_TTL_MS = 10 * 60 * 1000;
const PASS_MAX_CALLS = 30;
const PASS_PRUNE_MS = 24 * 60 * 60 * 1000;
const TASK_CAP = 200;
const TEXT_CAP = 200;
const MAX_TEXTS = 5;
const MAX_CLICKS = 2;
const MAX_WHEEL = 10;
const MAX_COORD = 100000;
const MAX_WAIT_S = 60;
// A call that never reports back (cancelled) stops holding the one-at-a-time lock after this.
// Longer than an approval window can last (WINDOW_TIMEOUT_MS), since the lock is held through it.
const BUSY_STALE_MS = 6 * 60 * 1000;
const READ_ONLY_TOOLS = new Set(['Screenshot', 'Snapshot', 'DisplayInventory', 'ControlStatus', 'Wait', 'WaitFor']);
const POINT_TOOLS = new Set(['Click', 'Scroll', 'Move', 'Type']);
// Programs a pass may never target: Claude itself, shells and terminals, the desktop and taskbar
// (explorer), script hosts, system consoles, and editors with a built-in terminal.
// Also the Windows shell hosts: ApplicationFrameHost owns every Store-app window (Settings among
// them), and the Start menu, search, notification and Settings hosts change the system.
// And web browsers (Erez's decision, 2026-10-20, GEN-908): one click there can send, delete or open a
// file on any site he is signed in to, and website work goes through the browser extension instead,
// so each screen click in a browser gets its own window.
// Also read by ~/.claude/scripts/desktop-background.ps1, which refuses to read these programs in the
// background (GEN-992); removing the export makes that script refuse every program.
const DENIED_APPS = new Set(['claude', 'powershell', 'pwsh', 'powershell_ise', 'cmd', 'conhost', 'windowsterminal',
  'openconsole', 'wt', 'explorer', 'bash', 'sh', 'wsl', 'wslhost', 'mintty', 'git-bash', 'python', 'pythonw', 'py',
  'node', 'wscript', 'cscript', 'mshta', 'regedit', 'mmc', 'taskmgr', 'rundll32', 'code', 'cursor', 'devenv',
  'applicationframehost', 'systemsettings', 'control', 'startmenuexperiencehost', 'shellexperiencehost', 'searchhost',
  'searchapp', 'textinputhost', 'lockapp', 'consent', 'msiexec', 'sihost', 'dwm', 'winlogon',
  // More editors with a terminal, more terminals, and windows onto another machine.
  'code - insiders', 'windsurf', 'zed', 'idea64', 'idea', 'pycharm64', 'pycharm', 'webstorm64', 'rider64', 'clion64',
  'goland64', 'datagrip64', 'phpstorm64', 'rubymine64', 'studio64', 'fleet', 'sublime_text', 'notepad++',
  'alacritty', 'wezterm-gui', 'wezterm', 'conemu64', 'conemu', 'putty', 'mobaxterm', 'tabby', 'hyper', 'warp',
  'mstsc', 'msrdc', 'vmconnect', 'virtualboxvm', 'vmware', 'vmplayer', 'anydesk', 'teamviewer',
  // Web browsers.
  'comet', 'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc', 'iexplore', 'chromium', 'zen',
  'librewolf', 'waterfox', 'floorp', 'thorium']);
const APP_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;
const TASK_LINE = /^\s*PC task:\s*(.*?)\s*$/i;
const APP_LINE = /^\s*App:\s*(.*?)\s*$/i;
const TYPE_LINE = /^\s*Type:\s*"(.*)"((?:\s*\+\s*(?:Enter|clear))*)\s*$/i;
const TYPE_OR_APP_START = /^\s*(Type|App):/i;
// A "PC task:" block followed, in the same turn, by a file edit was quoted while working on it,
// not put to Erez as a "Ready?" question (GEN-917). Shell commands are not counted: read-only
// checks often run after a closing "Ready?" message, and a wrong offer still needs Erez's click.
const PAST_BLOCK_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// ---- Stuck add-on (GEN-920 / GEN-933) ----
// A normal "Erez is using the PC" refusal counts down (wait_seconds above 0), and the add-on's
// generation number moves on within about 10 s (desktop/control.py _tick_locked / _set_locked).
// A wedged add-on keeps one generation and shows no countdown. So a refusal with wait 0 is a
// suspect; a reading at least STUCK_CONFIRM_MS later with the same generation and a state other
// than ready/ai confirms it (one reading is not enough: a brief "unavailable" recovers by itself
// within about 5 s, control_win32.py run_input_monitor). The wait is not required on the
// confirming reading, because Erez's click on its approval window restarts the add-on's idle
// count (2026-10-19: 9.17 s and 9.21 s at a frozen generation 75).
// The session's mark sits in the temp state folder, where Claude's own shell could edit it:
// deleting it only brings the windows back, and forging it only blocks calls.
const STUCK_CONFIRM_MS = 20 * 1000;
const STUCK_TTL_MS = 30 * 60 * 1000;
const SUSPECT_TTL_MS = 10 * 60 * 1000;
const STUCK_CODES = new Set(['USER_CONTROL', 'PHYSICAL_INPUT_HELD', 'CONTROL_UNAVAILABLE', 'CONTROL_PREEMPTED']);
const WORKING_STATES = new Set(['ready', 'ai']);
// One line per confirmed wedge, kept outside the temp folder (read when GEN-828 weighs an add-on update).
const STUCK_LOG = path.join(os.homedir(), '.claude-staging', 'wmcp-stuck-log.jsonl');
// Step (1) restarts the add-on: the desktop app has no Reconnect button for a server it still lists
// as connected, and a stopped add-on is started again by the session's next call to it (GEN-920 live
// test 2026-10-26: generation 44 -> 1). The restart script stops only this session's own add-on.
const STUCK_STEPS =
  'Tell Erez plainly that PC control is stuck in this session (the add-on is not waiting for him). Then: ' +
  '(1) Restart the add-on yourself: run exactly & "C:/Users/Erez/.claude/scripts/windows-mcp-restart.ps1" with your ' +
  'own PowerShell tool (no window; it stops only this session\'s own add-on, and the next PC-control call starts a fresh ' +
  'one). If it stopped the add-on or found none running, tell Erez in one line that PC control was restarted, ask him ' +
  'whether he is ready for one approval window, end your turn, and on his reply run ControlStatus once. (2) If the ' +
  'script refused or failed (including its "already restarted in the last 10 minutes" limit), or ControlStatus still ' +
  'shows the same generation and a state other than "ready", or fails instead of giving a reading, ask Erez to let go of any mouse button, press and release Ctrl, Shift, ' +
  'Alt and the Windows key once, then Esc, and keep his hands off for 10 seconds; ask whether he is ready, then run ' +
  'ControlStatus once more. (3) If that does not help, the work can continue in a new session, which starts its own ' +
  'add-on. Other PC-control calls in this session are refused without a window until ControlStatus shows "ready" or a ' +
  'different generation, or 30 minutes pass. Details: "Stuck add-on" in C:/Users/Erez/.claude/hooks/refs/windows-mcp-troubleshooting.md.';

const ANNOUNCE_MSG =
  'Automatic check, not a denial: PC control needs a heads-up first. Before this Windows-MCP ' +
  'call, tell Erez in chat, in one plain sentence, what you are about to do on his PC and why ' +
  '(an approval window will pop up on his screen). PC control is the last resort: if reading the ' +
  'page in the browser, downloading a file, or your own PowerShell can do this, use that instead; ' +
  'otherwise say why they cannot. Then make the call again.';
const SUBAGENT_MSG =
  'Blocked: PC control (Windows-MCP) is for the main session only, because Erez never sees a ' +
  "sub-agent's messages. Return to the main session and have it make this call.";

// Control, format (invisible, direction-changing), surrogate, private-use, unassigned,
// line/paragraph-separator and non-ASCII space characters could disguise what is being
// approved, as could the Hangul filler letters; all are shown as <U+XXXX> instead.
// Tab and the ordinary space are left as is.
const UNSAFE_CHAR = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;
const FILLERS = new Set([0x115F, 0x1160, 0x3164, 0xFFA0]);
const LRM = String.fromCharCode(0x200E);
// A Hebrew run: Hebrew words joined only by single spaces (a phrase keeps its own order).
const HEBREW_RUN = /\p{Script=Hebrew}+(?: \p{Script=Hebrew}+)*/gu;

function visible(s) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    out += c !== 0x09 && c !== 0x20 && (UNSAFE_CHAR.test(ch) || FILLERS.has(c))
      ? '<U+' + c.toString(16).toUpperCase().padStart(4, '0') + '>'
      : ch;
  }
  return out;
}

// One display line per line the value really has. PowerShell also treats a lone CR as a line
// break, so it starts a new display line marked <U+000D> rather than hiding inside one line.
function valueLines(text) {
  const out = [];
  for (const line of String(text).split(/\r\n|\n/)) {
    line.split('\r').forEach((part, i) => {
      // Long runs of blank characters (spaces, tabs, any Unicode space) are shown as a count;
      // they could otherwise push the rest of the line out of sight.
      const collapsed = part.replace(/[\t\p{Zs}]{20,}/gu, (m) => ' <' + Array.from(m).length + ' blank characters> ');
      let shown = (i > 0 ? '<U+000D>' : '') + visible(collapsed);
      // Fence each Hebrew run with left-to-right marks, so neutral characters between two
      // Hebrew names (a backslash, quotes, a space) cannot make them swap places on screen.
      shown = shown.replace(HEBREW_RUN, (m) => LRM + m + LRM);
      out.push(shown);
    });
  }
  return out;
}

// Plain-text listing of the tool's parameters; string values are shown raw (not JSON-escaped)
// so a command or file content reads as it will run.
function describe(toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return visible(JSON.stringify(toolInput === undefined ? null : toolInput));
  }
  const keys = Object.keys(toolInput);
  if (!keys.length) return '(no parameters)';
  return keys.map((k) => {
    const v = toolInput[k];
    const text = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    return visible(k) + ':\n' + valueLines(text).map((l) => '    ' + l).join('\n');
  }).join('\n\n');
}

function cap(s, n) {
  const chars = Array.from(String(s));
  return chars.length > n ? chars.slice(0, n).join('') + '...' : chars.join('');
}

// Who is asking, and what Claude said, shown under the action and its parameters. The session's
// project folder comes first: Claude can't change it. The session name and Claude's words are
// Claude's to set, so each is labelled unverified, capped, and on its own line.
function context(folder, title, says) {
  const saysText = says ? cap(says, SAYS_CAP) : '(no reason given)';
  const folderText = valueLines(cap(folder.name, FOLDER_CAP)).join(' ');
  return '----------------------------------------\n' +
    (folder.trusted ? 'Asked from folder: ' + folderText
      : 'Current folder (Claude can change it, unverified): ' + folderText) + '\n' +
    'Session name (set by Claude, unverified): ' + (title ? valueLines(cap(title, TITLE_CAP)).join(' ') : '(none found)') + '\n' +
    'Claude says (unverified - judge by the action above):\n' +
    valueLines(saysText).map((l) => '    ' + l).join('\n');
}

function firstLine(s) {
  return String(s || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l) || '';
}

function safeId(s) {
  return typeof s === 'string' ? s.replace(/[^A-Za-z0-9_-]/g, '') : '';
}

// A session/turn id usable in a pass file name: only when cleaning it changed nothing, so two
// different ids can never share a pass.
function exactId(s) {
  const c = safeId(s);
  return c && c === s && c.length <= 128 ? c : '';
}

function fileSize(p) {
  try { return fs.statSync(p).size; } catch (e) { return null; }
}

function readRange(p, start, end) {
  const len = Math.max(0, end - start);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(p, 'r');
  try {
    const n = fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

// The session's project folder: CLAUDE_PROJECT_DIR is "the project root where the session
// started" and Claude Code exports it to command hooks; a `cd` doesn't move it (hooks docs,
// "Reference scripts by path"). The input's `cwd` DOES follow Claude's `cd`, so it is used only
// as a labelled fallback, never as trusted identity.
function folderInfo(data, deps) {
  const proj = typeof deps.projectDir === 'string' ? deps.projectDir.trim().replace(/[\\/]+$/, '') : '';
  if (proj && path.basename(proj)) return { name: path.basename(proj), trusted: true };
  return { name: path.basename(String((data && data.cwd) || '')) || 'unknown folder', trusted: false };
}

// The session's name: the last top-level "custom-title" entry for this session, searched
// backwards through the transcript. Each line is parsed whole, so a look-alike object inside
// a tool call's input or result can't stand in for the real entry. The name itself can be set
// by Claude, so it is only ever shown labelled unverified.
function sessionTitle(data) {
  try {
    const tp = data && data.transcript_path;
    const size = typeof tp === 'string' ? fileSize(tp) : null;
    let end = size || 0;
    let scanned = 0;
    while (end > 0 && scanned < TITLE_SCAN_CAP) {
      const start = Math.max(0, end - TITLE_CHUNK);
      let title = '';
      for (const line of readRange(tp, start, end).split(/\r?\n/)) {
        if (line.indexOf('custom-title') < 0) continue;
        try {
          const e = JSON.parse(line);
          if (e && e.type === 'custom-title' && typeof e.customTitle === 'string' && e.customTitle.trim() &&
              (e.sessionId === undefined || e.sessionId === data.session_id)) title = e.customTitle.trim();
        } catch (err) { /* partial or other line */ }
      }
      if (title) return title;
      scanned += end - start;
      // Step back with an overlap, so a short line cut at the chunk edge is read whole next time.
      end = start > 0 ? start + TITLE_OVERLAP : 0;
    }
  } catch (e) { /* no title */ }
  return '';
}

// Text a content block showed Erez in chat. A short status line written just before a tool
// call is sometimes saved, reworded, as a "thinking" block whose signature is tagged
// "narration" (seen 2026-10-18 in live transcripts: 5 of 40 visible lines in one session,
// 24 of 135 in another). Private reasoning is tagged "thinking" instead and is never used.
// The tag is matched as its exact encoded field (0x42, length 9, "narration").
const NARRATION_TAG = '\x42\x09narration';
function shownText(b) {
  if (!b) return '';
  if (b.type === 'text' && typeof b.text === 'string') return b.text.trim();
  if (b.type === 'thinking' && typeof b.thinking === 'string' && typeof b.signature === 'string') {
    let tag = '';
    try { tag = Buffer.from(b.signature.slice(0, 64), 'base64').toString('latin1'); } catch (e) { tag = ''; }
    if (tag.indexOf(NARRATION_TAG) >= 0) return b.thinking.trim();
  }
  return '';
}

// The last main-session assistant text written after byte `offset` of the transcript (and, when
// `pick` is given, for which pick(text) is true).
// Returns '' when there is none (or it is too short), null when the transcript can't be read.
function announcementSince(tp, offset, pick) {
  try {
    const size = fs.statSync(tp).size;
    if (size <= offset) return '';
    const raw = readRange(tp, Math.max(offset, size - TRANSCRIPT_READ_CAP), size);
    let last = '';
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.indexOf('"assistant"') < 0) continue;
      let e;
      try { e = JSON.parse(line); } catch (err) { continue; }
      if (!e || e.type !== 'assistant' || e.isSidechain === true || !e.message) continue;
      // API-error notices are written as assistant entries too; they are not Claude's words.
      if (e.isApiErrorMessage === true || e.message.model === '<synthetic>') continue;
      const c = e.message.content;
      if (!Array.isArray(c)) continue;
      for (const b of c) {
        // Short text ("Retrying.") is not an announcement and does not hide an earlier one.
        const t = shownText(b);
        if (t.length >= MIN_ANNOUNCE_CHARS && (!pick || pick(t))) last = t;
      }
    }
    return last;
  } catch (e) {
    return null;
  }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

// Write-then-rename, so a parallel call never reads a half-written file. On Windows the rename
// fails while another process has the file open (a parallel read, antivirus), so it is retried
// briefly and then falls back to a direct write rather than dropping the update.
function writeJson(p, obj) {
  const text = JSON.stringify(obj);
  const tmp = p + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    for (let i = 0; i < 4; i++) {
      try { fs.renameSync(tmp, p); return; } catch (e) {
        if (!e || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || i === 3) break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
  } catch (e) { /* fall through to the direct write */ }
  try { fs.unlinkSync(tmp); } catch (e) { /* none */ }
  try { fs.writeFileSync(p, text, 'utf8'); } catch (e) { /* best effort */ }
}

function pruneState(dir, now) {
  try {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      try { if (now - fs.statSync(p).mtimeMs > STATE_TTL_MS) fs.unlinkSync(p); } catch (e) { /* skip */ }
    }
  } catch (e) { /* no dir yet */ }
}

// Whether a text holds a "PC task:" line (GEN-908).
function hasTaskBlock(t) {
  return /^\s*PC task:/im.test(t);
}

// A turn starts on a top-level user entry that is not a tool result or a skill/meta note and
// carries the turn's origin (Erez, a task notification, another session).
function isTurnStart(e) {
  if (!e || e.type !== 'user' || e.isSidechain === true || e.isMeta === true || !e.message) return false;
  const c = e.message.content;
  if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return false;
  return !!(e.origin && typeof e.origin === 'object') || typeof e.turnOrigin === 'string';
}

function fromErez(e) {
  return !!(e.origin && typeof e.origin === 'object' && e.origin.kind === 'human');
}

// The "PC task:" block from the message where Claude asked Erez whether he is ready: the last
// text block holding a "PC task:" line, written after Erez's previous message and before the
// message that started this turn, with no PC-control call after it - and only when this turn
// was started by Erez himself. Of several, the last one that is accepted wins, else the last
// one (so its error is shown).
// Returns the text, '' when there is none, null when the transcript can't be read.
function priorDeclaration(tp, pid) {
  try {
    const size = fs.statSync(tp).size;
    const from = Math.max(0, size - PRIOR_READ_CAP);
    const lines = readRange(tp, from, size).split(/\r?\n/);
    if (from > 0) lines.shift();  // cut at the read edge
    const entries = [];
    for (const line of lines) {
      if (!line || (line.indexOf('"user"') < 0 && line.indexOf('"assistant"') < 0)) continue;
      try { entries.push(JSON.parse(line)); } catch (err) { /* partial or other line */ }
    }
    let cur = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (isTurnStart(entries[i]) && entries[i].promptId === pid) { cur = i; break; }
    }
    if (cur < 0 || !fromErez(entries[cur])) return '';
    let prev = -1;
    for (let i = cur - 1; i >= 0; i--) { if (isTurnStart(entries[i]) && fromErez(entries[i])) { prev = i; break; } }
    // Erez's previous message is outside what was read: the range can't be bounded.
    if (prev < 0 && from > 0) return '';
    // Claude's blocks in that stretch, in order, each with the turn it was written in.
    const flat = [];
    const turnOf = [];
    let turn = 0;
    for (let i = prev + 1; i < cur; i++) {
      const e = entries[i];
      if (isTurnStart(e)) { turn++; continue; }
      if (!e || e.type !== 'assistant' || e.isSidechain === true || !e.message) continue;
      if (e.isApiErrorMessage === true || e.message.model === '<synthetic>' || !Array.isArray(e.message.content)) continue;
      for (const b of e.message.content) if (b) { flat.push(b); turnOf.push(turn); }
    }
    // Only text blocks (saved word for word; a reworded progress note is a thinking block, so
    // text written just before a tool call sometimes never arrives here). A block followed by
    // any PC-control call was for a task already done, so it is skipped; so is one followed by
    // a file edit in its own turn, which was quoted while working, not asked as "Ready?".
    const found = [];
    flat.forEach((b, k) => {
      // parseTask, not just hasTaskBlock: its multiline ^ also matches after a Unicode line
      // separator, which parseTask does not split on.
      if (b.type !== 'text' || typeof b.text !== 'string' || !parseTask(b.text.trim())) return;
      if (flat.some((x, j) => j > k && x.type === 'tool_use' && (String(x.name || '').startsWith(SERVER_PREFIX) ||
        (turnOf[j] === turnOf[k] && PAST_BLOCK_TOOLS.has(String(x.name || '')))))) return;
      found.push(b.text.trim());
    });
    const ok = found.filter((t) => parseTask(t).value);
    return ok.length ? ok[ok.length - 1] : (found.length ? found[found.length - 1] : '');
  } catch (e) {
    return null;
  }
}

// One line for the first call's bounce, so Claude knows before any window whether the task
// button will be offered.
function priorNote(data) {
  const tp = typeof data.transcript_path === 'string' ? data.transcript_path : '';
  const pid = exactId(data.prompt_id);
  if (!tp || !pid || !exactId(data.session_id)) return '';
  const text = priorDeclaration(tp, pid);
  if (text === null) return '';
  if (!text) {
    return ' No "PC task:" block was found in the message where you asked Erez whether he is ready, so ' +
      'unless this turn\'s own text holds one, each action will open its own approval window: tell Erez ' +
      'that before the first one.';
  }
  const d = parseTask(text);
  if (!d || !d.value) return ' The "PC task:" block in your last message before Erez\'s reply was not accepted (' + ((d && d.error) || 'it could not be read') + '), so each action will open its own approval window: tell Erez that before the first one.';
  return ' The "PC task:" block in your last message before Erez\'s reply was read (program: ' + d.value.app +
    '.exe, ' + d.value.texts.length + ' text(s) to type); the approval window will offer "Allow for this task" when the action fits it.';
}

function bounce(data) {
  return { action: 'block', reason: ANNOUNCE_MSG + priorNote(data) };
}

// Returns { action: 'block', reason } or { says, fresh, stateFile } (says = text to show, or null;
// fresh = the last text since the previous window that holds a "PC task:" block, or '';
// stateFile = this turn's state file, when the turn is tracked).
// The task block is searched for on its own, so a later status line can't hide it.
function announceCheck(data, deps) {
  const sid = safeId(data.session_id);
  const pid = safeId(data.prompt_id);
  const tp = typeof data.transcript_path === 'string' ? data.transcript_path : '';
  const now = (deps.now || Date.now)();
  const size = tp ? fileSize(tp) : null;
  // Can't tell turns apart or read what Claude wrote: skip the check, show the window.
  if (!deps.stateDir || !sid || !pid || size === null) return { says: null, fresh: '' };
  try { fs.mkdirSync(deps.stateDir, { recursive: true }); } catch (e) { return { says: null, fresh: '' }; }
  pruneState(deps.stateDir, now);

  const file = path.join(deps.stateDir, 'announce.' + sid + '.' + pid + '.json');
  let st = readJson(file);
  if (!st) {
    try {
      // Exclusive create: of several parallel first calls, exactly one records the offset.
      fs.writeFileSync(file, JSON.stringify({ offset: size, rounds: 1, lastBlockAt: now }), { encoding: 'utf8', flag: 'wx' });
      return bounce(data);
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return { says: null, fresh: '' };
      st = readJson(file);
      if (!st) {
        // Still being written by a parallel call of this round (block it the same way), or
        // left unreadable by a failed write (skip the check rather than block the whole turn).
        let age;
        try { age = Date.now() - fs.statSync(file).mtimeMs; } catch (err) { return { says: null, fresh: '' }; }
        return age > ROUND_GAP_MS ? { says: null, fresh: '' } : bounce(data);
      }
    }
  }
  if (typeof st !== 'object' || typeof st.offset !== 'number' || typeof st.rounds !== 'number') return { says: null, fresh: '' };

  // Past the check already this turn. Show only what Claude wrote since the previous window,
  // so an earlier, different action's reason is never presented as this action's reason.
  if (typeof st.says === 'string') {
    const from = typeof st.shownAt === 'number' ? st.shownAt : st.offset;
    const fresh = announcementSince(tp, from);
    st.shownAt = size;
    if (fresh) st.says = fresh;
    writeJson(file, st);
    if (fresh) return { says: fresh, fresh: announcementSince(tp, from, hasTaskBlock) || '', stateFile: file };
    return { says: st.says ? 'No new explanation for this action. Earlier this turn Claude said: "' + cap(st.says, 150) + '"' : null, fresh: '', stateFile: file };
  }

  const text = announcementSince(tp, st.offset);
  if (text === null) { st.says = ''; st.shownAt = size; writeJson(file, st); return { says: null, fresh: '', stateFile: file }; }
  if (text) { st.says = text; st.shownAt = size; writeJson(file, st); return { says: text, fresh: announcementSince(tp, st.offset, hasTaskBlock) || '', stateFile: file }; }

  // lastBlockAt is the START of the current round, so a quick run of retries can't keep
  // extending one round forever.
  // A clock set back (now before the round's start) counts as a new round, never as the same one.
  const sameRound = typeof st.lastBlockAt === 'number' && now >= st.lastBlockAt && now - st.lastBlockAt < ROUND_GAP_MS;
  if (!sameRound) {
    if (st.rounds + 1 > MAX_BLOCK_ROUNDS) { st.says = ''; st.shownAt = size; writeJson(file, st); return { says: null, fresh: '', stateFile: file }; }
    st.rounds += 1;
    st.lastBlockAt = now;
    writeJson(file, st);
  }
  return bounce(data);
}

// ---- Task pass (GEN-908) ----

// "tableau.exe", "Tableau" -> "tableau".
function appBase(s) {
  return String(s).trim().toLowerCase().replace(/\.exe$/, '');
}

// The "PC task:" block in Claude's heads-up, e.g.
//   PC task: Activate Tableau by signing in to a server
//   App: tableau.exe
//   Type: "https://us-west-2b.online.tableau.com"
//   Type: "erez" + Enter
// Returns null (no block), { error } (a block that is not accepted) or { value }.
function parseTask(text) {
  if (typeof text !== 'string' || !text) return null;
  const lines = text.split(/\r\n|\n|\r/);
  const start = lines.findIndex((l) => TASK_LINE.test(l));
  if (start < 0) return null;
  // One block per message, so there is never a question which one Erez was shown.
  if (lines.slice(start + 1).some((l) => TASK_LINE.test(l))) return { error: 'more than one "PC task:" line' };
  const task = TASK_LINE.exec(lines[start])[1];
  let app = null;
  const texts = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) break;
    let m = APP_LINE.exec(l);
    if (m) {
      if (app !== null) return { error: 'more than one "App:" line' };
      app = m[1];
      continue;
    }
    m = TYPE_LINE.exec(l);
    if (m) {
      const flags = m[2].toLowerCase();
      texts.push({ text: m[1], enter: flags.indexOf('enter') >= 0, clear: flags.indexOf('clear') >= 0 });
      continue;
    }
    // A malformed "Type:"/"App:" line is an error, not silently dropped; any other line ends the block.
    if (TYPE_OR_APP_START.test(l)) return { error: 'a "Type:" or "App:" line is not in the expected form' };
    break;
  }
  // A tab is shown as a blank but typed as the Tab key (moving between fields), so none is allowed.
  if (!task || Array.from(task).length > TASK_CAP || visible(task) !== task || task.indexOf('\t') >= 0) return { error: 'the task description is missing, too long or has hidden characters' };
  if (app === null || !APP_NAME.test(app)) return { error: 'no valid "App:" line (one program name, e.g. App: tableau.exe)' };
  const base = appBase(app);
  if (!base || DENIED_APPS.has(base)) return { error: 'a task pass cannot be used for ' + app };
  if (texts.length > MAX_TEXTS) return { error: 'more than ' + MAX_TEXTS + ' texts to type' };
  for (const t of texts) {
    if (!t.text || Array.from(t.text).length > TEXT_CAP || visible(t.text) !== t.text || t.text.indexOf('\t') >= 0) {
      return { error: 'a text to type is empty, too long, or has a tab or hidden characters' };
    }
  }
  return { value: { task, app: base, texts } };
}

// The window section for a task block, written by this hook (not Claude's free text). It is
// shown above the action, framed by lines of "=".
function taskSection(decl) {
  if (!decl) return '';
  const rule = '========================================';
  return rule + '\n' + taskBody(decl) + '\n' + rule + '\n\n';
}

function taskBody(decl) {
  if (decl.error) {
    // Say where the block came from, so Erez doesn't look for it in this turn (GEN-917).
    return (decl.prior
      ? 'Claude\'s last message before your reply had a "PC task:" block, but it was not accepted ('
      : 'Claude wrote a "PC task:" block, but it was not accepted (') + visible(decl.error) +
      '), so this window approves only this one action.';
  }
  const v = decl.value;
  const texts = v.texts.length
    ? v.texts.map((t) => '    "' + valueLines(t.text).join(' ') + '"' +
      (t.clear ? ' (first selects ALL the text where it clicks and deletes it)' : '') + (t.enter ? ' (then presses Enter)' : '')).join('\n')
    : '    (none - Claude may not type anything)';
  return (decl.prior
    ? 'PC TASK, as read by the approval check from Claude\'s last message before your reply\n(your reply may not have been about it):\n'
    : 'PC TASK, as read by the approval check from Claude\'s message:\n') +
    'Task (Claude\'s words, unverified):\n' + valueLines(v.task).map((l) => '    ' + l).join('\n') + '\n' +
    'Only inside the program: ' + v.app + '.exe\n' +
    'Exact text Claude may type:\n' + texts + '\n\n' +
    'If you click "Allow for this task": until Claude\'s current reply ends (at most 10 minutes or ' +
    PASS_MAX_CALLS + ' actions), Claude may look at EVERYTHING on all your screens, and click, scroll ' +
    'and type the text above inside ' + v.app + '.exe, without asking again (typing a long text briefly ' +
    'uses the clipboard). Anything else still asks you. Clicking Deny on a later window from this chat, ' +
    'or pressing Stop in the Claude app, ends it.';
}

function passFile(dir, sid, pid) {
  return path.join(dir, 'pass.' + sid + '.' + pid + '.json');
}

function validPass(p, sid, pid, now) {
  if (!p || typeof p !== 'object' || p.v !== 1 || p.sid !== sid || p.pid !== pid) return false;
  if (typeof p.app !== 'string' || !APP_NAME.test(p.app) || appBase(p.app) !== p.app || DENIED_APPS.has(p.app)) return false;
  if (typeof p.created !== 'number' || typeof p.expires !== 'number') return false;
  if (!(p.created <= now && now < p.expires && p.expires - p.created <= PASS_TTL_MS)) return false;
  if (!Array.isArray(p.texts) || p.texts.length > MAX_TEXTS) return false;
  return p.texts.every((t) => t && typeof t.text === 'string' && t.text && typeof t.enter === 'boolean' && typeof t.clear === 'boolean');
}

function plainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function onlyKeys(ti, allowed) {
  return Object.keys(ti).every((k) => allowed.indexOf(k) >= 0);
}

// An exact screen point: a JSON array of two whole numbers (not text, not a label).
function strictLoc(v) {
  return Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && Math.abs(n) <= MAX_COORD);
}

function oneOf(v, allowed) {
  return v === undefined || allowed.indexOf(v) >= 0;
}

function intIn(v, lo, hi) {
  return v === undefined || (Number.isInteger(v) && v >= lo && v <= hi);
}

// Whether the call's own parameters fit the pass (the screen-point check comes after).
function inputCovered(name, ti, pass) {
  // Wait just sleeps; an unbounded one would hold the turn with no window.
  if (name === 'Wait') return plainObject(ti) && onlyKeys(ti, ['duration']) && ti.duration !== undefined && intIn(ti.duration, 0, MAX_WAIT_S);
  if (READ_ONLY_TOOLS.has(name)) return ti === undefined || ti === null || plainObject(ti);
  if (!plainObject(ti)) return false;
  switch (name) {
    case 'Click':
      return onlyKeys(ti, ['loc', 'button', 'clicks']) && strictLoc(ti.loc) && oneOf(ti.button, ['left']) &&
        intIn(ti.clicks, 0, MAX_CLICKS);
    case 'Scroll':
      return onlyKeys(ti, ['loc', 'type', 'direction', 'wheel_times']) && strictLoc(ti.loc) &&
        oneOf(ti.type, ['vertical', 'horizontal']) && oneOf(ti.direction, ['up', 'down', 'left', 'right']) &&
        intIn(ti.wheel_times, 1, MAX_WHEEL);
    case 'Move':
      return onlyKeys(ti, ['loc', 'drag']) && strictLoc(ti.loc) && oneOf(ti.drag, [false]);
    case 'Type':
      return onlyKeys(ti, ['text', 'loc', 'clear', 'caret_position', 'press_enter']) && strictLoc(ti.loc) &&
        typeof ti.text === 'string' && oneOf(ti.caret_position, ['start', 'idle', 'end']) &&
        oneOf(ti.clear, [true, false]) && oneOf(ti.press_enter, [true, false]) &&
        pass.texts.some((t) => t.text === ti.text && (ti.clear !== true || t.clear) && (ti.press_enter !== true || t.enter));
    default:
      // App (even "switch") is not covered: the add-on matches window TITLES loosely, so it could
      // bring another program to the front.
      return false;
  }
}

// Takes one of the pass's PASS_MAX_CALLS action slots. Exclusive file creation, so parallel
// calls can never take more slots than there are.
function takeSlot(dir, sid, pid) {
  for (let n = 1; n <= PASS_MAX_CALLS; n++) {
    try {
      fs.writeFileSync(path.join(dir, 'pass.' + sid + '.' + pid + '.use.' + n), '', { flag: 'wx' });
      return n;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return 0;
    }
  }
  return 0;
}

function logUse(dir, sid, pid, name, ti, n, now) {
  try {
    fs.appendFileSync(path.join(dir, 'log.' + sid + '.jsonl'), JSON.stringify({
      ts: new Date(now).toISOString(), turn: pid, n, tool: name, input: cap(JSON.stringify(ti === undefined ? null : ti), 300),
    }) + '\n', 'utf8');
  } catch (e) { /* the call is still bounded by the pass; the log is best effort */ }
}

// ---- One screen action at a time, on the whole PC (GEN-908) ----
// A covered click or typing is checked against the screen as it is now; if another action were
// running at the same time - in this session or ANY other (each session has its own add-on
// process, all on one screen) - the screen could change between the check and this action.
// So every screen-changing call leaves its own "running" note (one file per call, so leaving it
// never fails on contention): an approval-path call writes it BEFORE its window opens and keeps
// it until the call ends (or removes it if not approved); a covered screen action writes its
// note and only THEN checks for any other live note - if there is one, it removes its own and
// is not covered (gets the window). Two covered actions at the same moment both see each other
// and both get a window; one can never miss the other. The PostToolUse / PostToolUseFailure
// run of this hook removes a call's note when it ends; a note is named by session + call id, so
// no other call's end can remove it.
const HOLD_RE = /^hold\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.json$/;

function holdFile(dir, sid, id) {
  return path.join(dir, 'hold.' + sid + '.' + id + '.json');
}

function addHold(dir, me, now) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(holdFile(dir, me.sid, me.id), JSON.stringify({ sid: me.sid, id: me.id, turn: me.turn, at: now }), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function removeHold(dir, sid, id) {
  try { fs.unlinkSync(holdFile(dir, sid, id)); } catch (e) { /* already gone */ }
}

// A note left behind: unreadable (a write cut short) and old on the real clock; older than
// BUSY_STALE_MS (or that far in the future after a clock change); or from an earlier turn of
// the same session (that turn's calls have ended, e.g. a cancelled call that never reported back).
function holdStale(f, me, now) {
  const st = readJson(f);
  if (!st || typeof st.at !== 'number') {
    try { return Date.now() - fs.statSync(f).mtimeMs > BUSY_STALE_MS; } catch (e) { return true; }
  }
  if (Math.abs(now - st.at) > BUSY_STALE_MS) return true;
  return st.sid === me.sid && typeof st.turn === 'string' && st.turn !== me.turn;
}

// Whether any call other than `me` has a live note. Notes left behind are removed on the way.
// An unreadable folder counts as busy (fail closed).
function otherHold(dir, me, now) {
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return true; }
  for (const name of names) {
    const m = HOLD_RE.exec(name);
    if (!m || (m[1] === me.sid && m[2] === me.id)) continue;
    const f = path.join(dir, name);
    if (holdStale(f, me, now)) { try { fs.unlinkSync(f); } catch (e) { /* skip */ } continue; }
    return true;
  }
  return false;
}

// True only when a valid task pass for this session and turn covers this exact call.
function passCovers(data, deps, name) {
  const sid = exactId(data.session_id);
  const pid = exactId(data.prompt_id);
  if (!deps.passDir || !sid || !pid) return false;
  if (!READ_ONLY_TOOLS.has(name) && !POINT_TOOLS.has(name)) return false;
  const now = (deps.now || Date.now)();
  const pass = readJson(passFile(deps.passDir, sid, pid));
  if (!validPass(pass, sid, pid, now)) return false;
  const ti = data.tool_input;
  if (!inputCovered(name, ti, pass)) return false;
  if (POINT_TOOLS.has(name)) {
    // The lock is released when the call ends, so a screen action needs this call's own id.
    const id = exactId(data.tool_use_id);
    const me = { sid, id, turn: pid };
    if (!id || !addHold(deps.passDir, me, now)) return false;
    if (otherHold(deps.passDir, me, now) || !pointOk(name, ti, pass, deps) || !useSlot(deps, sid, pid, name, ti, now)) {
      removeHold(deps.passDir, sid, id);
      return false;
    }
    return true;
  }
  return useSlot(deps, sid, pid, name, ti, now);
}

function pointOk(name, ti, pass, deps) {
  const pt = deps.runPoint(ti.loc[0], ti.loc[1]);
  if (!pt || pt.ok !== true || pt.approvalOpen !== false || typeof pt.process !== 'string') return false;
  const at = appBase(pt.process);
  if (at !== pass.app || DENIED_APPS.has(at)) return false;
  // The add-on clicks at the point and then sends the keys to whatever window has focus; a
  // click that doesn't take focus (an app running as administrator, a no-activate window)
  // would send the text elsewhere. So the declared app must already be in front.
  if (name === 'Type' && (typeof pt.foreground !== 'string' || appBase(pt.foreground) !== pass.app)) return false;
  return true;
}

function useSlot(deps, sid, pid, name, ti, now) {
  const n = takeSlot(deps.passDir, sid, pid);
  if (!n) return false;
  logUse(deps.passDir, sid, pid, name, ti, n, now);
  return true;
}

// ---- Stuck add-on (GEN-920 / GEN-933) ----

// The add-on's control reading in a finished call: a refusal - a failed call whose whole error
// is {"code": ..., "status": {...}} (as captured live, 2026-10-25) - or ControlStatus's own
// result. Anything else (other errors, other tools' results) gives null.
function controlReading(data) {
  const ev = data.hook_event_name;
  let text;
  if (ev === 'PostToolUseFailure') text = data.error;
  else if (ev === 'PostToolUse' && data.tool_name === SERVER_PREFIX + 'ControlStatus') text = responseText(data.tool_response);
  else return null;
  if (typeof text !== 'string' || text.length > 4096) return null;
  let j;
  try { j = JSON.parse(text.replace(/^\s*(?:Error:\s*)?/, '')); } catch (e) { return null; }
  if (!plainObject(j)) return null;
  const refusal = ev === 'PostToolUseFailure';
  if (refusal && (typeof j.code !== 'string' || !plainObject(j.status))) return null;
  const st = refusal ? j.status : j;
  if (typeof st.state !== 'string' || !Number.isInteger(st.generation) || st.generation < 0 ||
      typeof st.wait_seconds !== 'number' || !Number.isFinite(st.wait_seconds)) return null;
  return { refusal, code: refusal ? j.code : '', state: st.state, gen: st.generation, wait: st.wait_seconds };
}

// A tool result as text: a plain string, or the text items of a content list.
function responseText(r) {
  if (typeof r === 'string') return r;
  const items = Array.isArray(r) ? r : (plainObject(r) && Array.isArray(r.content) ? r.content : null);
  if (!items) return null;
  const texts = items.filter((x) => x && x.type === 'text' && typeof x.text === 'string').map((x) => x.text);
  return texts.length === 1 ? texts[0] : null;
}

function stuckFile(dir, sid) {
  return path.join(dir, 'stuck.' + sid + '.json');
}

function validMark(m, now, ttl) {
  return plainObject(m) && Number.isInteger(m.gen) && typeof m.at === 'number' && now >= m.at && now - m.at < ttl;
}

// This session's stuck state: { mark, suspect }, each only while still valid.
function readStuck(dir, sid, now) {
  const st = readJson(stuckFile(dir, sid));
  const out = {};
  if (st && validMark(st.mark, now, STUCK_TTL_MS)) out.mark = st.mark;
  if (st && validMark(st.suspect, now, SUSPECT_TTL_MS)) out.suspect = st.suspect;
  return out;
}

function clearStuck(dir, sid) {
  try { fs.unlinkSync(stuckFile(dir, sid)); } catch (e) { /* already gone */ }
}

function logStuck(deps, sid, mark, now) {
  if (!deps.stuckLog) return;
  try {
    fs.mkdirSync(path.dirname(deps.stuckLog), { recursive: true });
    fs.appendFileSync(deps.stuckLog, JSON.stringify({ ts: new Date(now).toISOString(), session: sid, code: mark.code, generation: mark.gen }) + '\n', 'utf8');
  } catch (e) { /* best effort */ }
}

function sinceText(at) {
  return new Date(at).toISOString().slice(11, 16) + ' UTC';
}

// Reads a finished call's result and updates the session's stuck state. Returns the note for
// Claude, or ''.
function noteReading(data, deps) {
  const sid = exactId(data.session_id);
  if (!deps.stateDir || !sid) return '';
  const name = String(data.tool_name || '').slice(SERVER_PREFIX.length);
  const r = controlReading(data);
  // Any other call the add-on carried out: every tool but ControlStatus waits for control (v0.8.8).
  const ran = data.hook_event_name === 'PostToolUse' && name !== 'ControlStatus';
  if (!r && !ran) return '';
  const now = (deps.now || Date.now)();
  try { fs.mkdirSync(deps.stateDir, { recursive: true }); } catch (e) { /* a write below then fails quietly */ }
  const cur = readStuck(deps.stateDir, sid, now);
  if (ran || WORKING_STATES.has(r.state)) {
    if (cur.mark || cur.suspect) clearStuck(deps.stateDir, sid);
    return cur.mark ? 'Automatic note (PC control): the Windows-MCP add-on is working again in this session, so PC-control calls are allowed again.' : '';
  }
  let note = '';
  if (cur.mark) {
    if (r.gen === cur.mark.gen) {
      return 'Automatic note (PC control): the Windows-MCP add-on is still stuck (generation ' + r.gen + ', state "' +
        visible(cap(r.state, 40)) + '"). ' + STUCK_STEPS;
    }
    // The add-on's state has moved: no longer the wedge that was marked.
    note = 'Automatic note (PC control): the Windows-MCP add-on has changed state (generation ' + r.gen + '), so it is ' +
      'no longer treated as stuck and PC-control calls are allowed again.';
  }
  if (cur.suspect && r.gen === cur.suspect.gen) {
    if (now - cur.suspect.at >= STUCK_CONFIRM_MS) {
      const mark = { gen: r.gen, at: now, code: cur.suspect.code };
      writeJson(stuckFile(deps.stateDir, sid), { mark });
      logStuck(deps, sid, mark, now);
      return 'Automatic note (PC control): the Windows-MCP add-on is stuck - it has kept generation ' + r.gen + ' with no ' +
        'progress for over ' + Math.round(STUCK_CONFIRM_MS / 1000) + ' seconds. ' + STUCK_STEPS;
    }
    const left = Math.ceil((STUCK_CONFIRM_MS - (now - cur.suspect.at)) / 1000);
    return 'Automatic note (PC control): too soon to tell whether the add-on is stuck. Wait about ' + left +
      ' more seconds with your own shell (for example PowerShell Start-Sleep), then run ControlStatus once.';
  }
  if (r.refusal && STUCK_CODES.has(r.code) && r.wait <= 0 && (r.code !== 'CONTROL_PREEMPTED' || r.state === 'unavailable')) {
    writeJson(stuckFile(deps.stateDir, sid), { suspect: { gen: r.gen, at: now, code: r.code } });
    return (note ? note + ' ' : '') + 'Automatic note (PC control): this refusal shows no countdown (wait 0, generation ' + r.gen +
      '), which can mean the Windows-MCP add-on is stuck rather than Erez using the PC. Do not retry the action yet: wait ' +
      'about ' + Math.round(STUCK_CONFIRM_MS / 1000) + ' seconds with your own shell (for example PowerShell Start-Sleep, ' +
      'not a Windows-MCP tool), then run ControlStatus once. If it shows the same generation and a state other than ' +
      '"ready", this check will say what to ask Erez to do.';
  }
  // A countdown, or a new generation: nothing suspicious; forget the old state.
  if (cur.mark || cur.suspect) clearStuck(deps.stateDir, sid);
  return note;
}

// Refuses, without a window, a call in a session whose add-on is marked stuck. ControlStatus
// still runs: it is how a change is seen. Returns null when the call may go on.
function stuckBlock(data, deps, name) {
  if (name === 'ControlStatus') return null;
  const sid = exactId(data.session_id);
  if (!deps.stateDir || !sid) return null;
  const cur = readStuck(deps.stateDir, sid, (deps.now || Date.now)());
  if (!cur.mark) return null;
  return {
    action: 'block',
    reason: 'Blocked without a window: the Windows-MCP add-on in this session is stuck (frozen at generation ' + cur.mark.gen +
      ' since ' + sinceText(cur.mark.at) + '), so this call could not work. Do not retry it. ' + STUCK_STEPS,
  };
}

// PostToolUse / PostToolUseFailure: the call has ended, so release its lock, then read the
// add-on's control reading. Never blocks; returns the note for Claude, or ''.
function afterCall(raw, deps) {
  let data;
  try {
    const bom = String.fromCharCode(0xFEFF);
    data = JSON.parse(raw.startsWith(bom) ? raw.slice(1) : raw);
    if (!String((data && data.tool_name) || '').startsWith(SERVER_PREFIX)) return '';
    const sid = exactId(data.session_id);
    const id = exactId(data.tool_use_id);
    if (deps.passDir && sid && id) removeHold(deps.passDir, sid, id);
  } catch (e) { return ''; /* nothing to release */ }
  try { return noteReading(data, deps); } catch (e) { return ''; }
}

// Removes this turn's pass and its action slots (a Deny or a missed window ends a running pass).
function endPass(dir, sid, pid) {
  const prefix = 'pass.' + sid + '.' + pid + '.';
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(prefix)) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* skip */ } }
    }
  } catch (e) { /* no folder */ }
}

// Old pass, slot, log and left-behind lock files only (never anything else in the folder).
function prunePasses(dir, now) {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/^(pass|log|hold)\./.test(name)) continue;
      const p = path.join(dir, name);
      try { if (now - fs.statSync(p).mtimeMs > PASS_PRUNE_MS) fs.unlinkSync(p); } catch (e) { /* skip */ }
    }
  } catch (e) { /* no dir yet */ }
}

// Written only after Erez clicked "Allow for this task" and every other check passed.
function writePass(data, deps, value) {
  const sid = exactId(data.session_id);
  const pid = exactId(data.prompt_id);
  if (!deps.passDir || !sid || !pid) return false;
  const now = (deps.now || Date.now)();
  try {
    fs.mkdirSync(deps.passDir, { recursive: true });
    prunePasses(deps.passDir, now);
    // A new task in the same turn starts its action count again (it had its own approval).
    endPass(deps.passDir, sid, pid);
    writeJson(passFile(deps.passDir, sid, pid), { v: 1, sid, pid, app: value.app, task: value.task, texts: value.texts, created: now, expires: now + PASS_TTL_MS });
    return true;
  } catch (e) {
    return false;
  }
}

// The program owning the top-level window at a screen point, per windows-mcp-point.ps1.
function runPoint(x, y) {
  const r = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', POINT],
    { encoding: 'utf8', timeout: POINT_TIMEOUT_MS, windowsHide: true, env: Object.assign({}, process.env, { WMCP_POINT_X: String(x), WMCP_POINT_Y: String(y) }) });
  if (!r || r.error || r.status !== 0) return null;
  const line = String(r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
  try { return JSON.parse(line); } catch (e) { return null; }
}

// Leaves a note for prompt-wmcp-miss-reminder.js: a window ended without approval.
function recordMiss(data, deps, name, why) {
  const sid = safeId(data.session_id);
  if (!deps.stateDir || !sid) return;
  try {
    fs.mkdirSync(deps.stateDir, { recursive: true });
    fs.appendFileSync(path.join(deps.stateDir, 'denied.' + sid),
      JSON.stringify({ ts: new Date((deps.now || Date.now)()).toISOString(), tool: name, why }) + '\n', 'utf8');
  } catch (e) { /* the block message itself still tells Claude */ }
}

function runGuard(raw) {
  const r = spawnSync(process.execPath, [GUARD], { input: raw, encoding: 'utf8', timeout: 20000, windowsHide: true });
  return { status: r.status, stderr: String(r.stderr || '') };
}

function runWindow(payloadFile, nonce, payloadSha256) {
  // windowsHide stays false: hiding the child can also hide its first window (the form).
  const r = spawnSync(POWERSHELL,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', WINDOW,
      '-PayloadFile', payloadFile, '-Nonce', nonce, '-PayloadSha256', payloadSha256,
      // The window closes itself if this hook or the process that launched it goes away.
      '-ParentPid', String(process.pid), '-GrandparentPid', String(process.ppid)],
    { encoding: 'utf8', timeout: WINDOW_TIMEOUT_MS, windowsHide: false });
  return windowResult(r);
}

// A window that never started, or ran past the time limit, says so instead of reading as
// "no answer".
function windowResult(r) {
  let err = '';
  if (r && r.error) {
    err = r.error.code === 'ETIMEDOUT'
      ? 'the approval window ran too long and was closed\n'
      : 'the approval window did not run: ' + (r.error.code || r.error.message) + '\n';
  }
  return { status: r ? r.status : null, stdout: String((r && r.stdout) || ''), stderr: err + String((r && r.stderr) || '') };
}

function guardBlock(g) {
  return { action: 'block', reason: firstLine(g.stderr) || 'Blocked: the Windows-MCP delete guard did not pass this call.' };
}

// Returns { action: 'allow' } | { action: 'block', reason } | { action: 'none' }.
function decide(raw, deps) {
  let data;
  try {
    const bom = String.fromCharCode(0xFEFF);
    data = JSON.parse(raw.startsWith(bom) ? raw.slice(1) : raw);
  } catch (e) {
    return { action: 'block', reason: 'Windows-MCP approval gate could not read the request (blocked).' };
  }
  const tool = String((data && data.tool_name) || '');
  if (!tool.startsWith(SERVER_PREFIX)) return { action: 'none' };
  if (data.agent_id !== undefined && data.agent_id !== null) return { action: 'block', reason: SUBAGENT_MSG };
  const name = tool.slice(SERVER_PREFIX.length);

  const before = deps.runGuard(raw);
  if (before.status !== 0) return guardBlock(before);

  // The add-on is stuck in this session: no window for a call that cannot work (GEN-920).
  // Checked before the task pass, so covered calls don't use up the pass on it either.
  const stuck = stuckBlock(data, deps, name);
  if (stuck) return stuck;

  // A valid task pass for this turn covers this exact call: no window (GEN-908).
  if (passCovers(data, deps, name)) return { action: 'allow' };

  const ann = announceCheck(data, deps);
  if (ann.action === 'block') return ann;

  // Offer "Allow for this task" only for a turn that a pass can be tied to, and only when this
  // window's own action is one the task would cover - so one task click never also approves an
  // action outside the task.
  const trackable = !!(exactId(data.session_id) && exactId(data.prompt_id) && deps.passDir);
  let declText = ann.fresh;
  // No block in this turn's own text: the one from the "Ready?" message, in one window per turn
  // at most. The state file can only stop it being offered (priorOffered / priorNone).
  let prior = false;
  let st = null;
  if (trackable && !declText && ann.stateFile) {
    st = readJson(ann.stateFile);
    if (st && typeof st === 'object' && !st.priorOffered && !st.priorNone) {
      // Once found, the block is kept in the state file: the stretch before this turn doesn't
      // change, so later windows of the turn needn't re-read up to PRIOR_READ_CAP of transcript
      // (GEN-917). A block forged there by Claude's own shell would still need Erez's click on
      // "Allow for this task", like one Claude writes in this turn's own text.
      const t = typeof st.priorText === 'string' && st.priorText ? st.priorText : priorDeclaration(data.transcript_path, data.prompt_id);
      if (t) {
        declText = t;
        prior = true;
        if (st.priorText !== t) { st.priorText = t; writeJson(ann.stateFile, st); }
      } else if (t === '') { st.priorNone = true; writeJson(ann.stateFile, st); }
    }
  }
  let decl = trackable ? parseTask(declText) : null;
  if (decl && prior) decl.prior = true;
  const priorRefused = !!(prior && decl && decl.error);
  if (decl && decl.value && !((READ_ONLY_TOOLS.has(name) || POINT_TOOLS.has(name)) && inputCovered(name, data.tool_input, decl.value))) {
    decl = { error: 'this action itself is not one the task would cover', prior };
  }
  // A screen action must also land inside the declared program (and, for typing, that program
  // must be in front), checked the same way as a covered call: the window shows only bare
  // coordinates, which Erez can't judge.
  if (decl && decl.value && POINT_TOOLS.has(name) && !pointOk(name, data.tool_input, decl.value, deps)) {
    decl = { error: 'this action\'s screen point is not inside ' + decl.value.app + '.exe', prior };
  }
  const offer = !!(decl && decl.value);
  // Offered (or shown as not accepted) once, whatever Erez answers: a Deny is not followed by
  // the same offer again. A task offered from this turn's own text also retires it.
  if (offer || priorRefused) {
    const s2 = st || (ann.stateFile ? readJson(ann.stateFile) : null);
    if (s2 && typeof s2 === 'object' && !s2.priorOffered) { s2.priorOffered = true; writeJson(ann.stateFile, s2); }
  }

  // A screen-changing call leaves its "running" note before its window opens, so no covered
  // action anywhere runs while this one is being approved or runs (one at a time, whole PC).
  const sid = exactId(data.session_id);
  const id = exactId(data.tool_use_id);
  const me = deps.passDir && sid && id && !READ_ONLY_TOOLS.has(name) ? { sid, id, turn: exactId(data.prompt_id) } : null;
  let held = me ? addHold(deps.passDir, me, (deps.now || Date.now)()) : false;
  const letGo = () => { if (held) { removeHold(deps.passDir, me.sid, me.id); held = false; } };

  const nonce = crypto.randomBytes(16).toString('hex');
  const payloadFile = path.join(deps.tmpDir, 'windows-mcp-approval-' + nonce + '.json');
  const folder = folderInfo(data, deps);
  let w;
  try {
    const bytes = Buffer.from(JSON.stringify({
      tool: visible(name),
      // The task section goes first, so its scope is in view next to its button.
      details: taskSection(decl) + describe(data.tool_input) + '\n\n' + context(folder, sessionTitle(data), ann.says),
      // Title bar: only the session's project folder, which Claude can't change; nothing otherwise.
      askedBy: folder.trusted ? 'folder ' + valueLines(cap(folder.name, FOLDER_CAP)).join(' ') : '',
      skipWait: NO_WAIT_TOOLS.has(name),
      taskOffer: offer,
    }), 'utf8');
    fs.writeFileSync(payloadFile, bytes);
    // The window refuses to open unless the file still has these exact bytes, so another
    // program rewriting it before the window reads it cannot change what Erez sees (GEN-903).
    w = deps.runWindow(payloadFile, nonce, crypto.createHash('sha256').update(bytes).digest('hex'));
  } finally {
    try { fs.unlinkSync(payloadFile); } catch (e) { /* already gone */ }
    if (!w) letGo();
  }

  const out = String((w && w.stdout) || '').split(/\r?\n/).map((l) => l.trim());
  const forTask = offer && out.indexOf('APPROVED-TASK ' + nonce) >= 0;
  const approved = w && w.status === 0 && (out.indexOf('APPROVED ' + nonce) >= 0 || forTask);
  if (!approved) {
    letGo();
    const why = firstLine(w && w.stderr).slice(0, 200) || 'no answer';
    recordMiss(data, deps, name, why);
    // Erez saying no (or not answering) also ends any task pass running this turn.
    if (deps.passDir && exactId(data.session_id) && exactId(data.prompt_id)) endPass(deps.passDir, data.session_id, data.prompt_id);
    return {
      action: 'block',
      reason: 'This Windows-MCP action was not approved (' + why + '). Do not retry it without asking ' +
        "Erez in chat first. In your 'For you' block, tell Erez plainly that the PC-control request was " +
        'not approved (' + why + '), what it was for, and what you did instead.',
    };
  }

  // Re-check after the wait: the guard's overwrite check looks at files that may have changed.
  const after = deps.runGuard(raw);
  if (after.status !== 0) { letGo(); return guardBlock(after); }
  if (forTask) writePass(data, deps, decl.value);
  // The window may have taken minutes: renew the note so it stays live until the call ends.
  if (me) addHold(deps.passDir, me, (deps.now || Date.now)());
  return { action: 'allow' };
}

function block(reason) {
  process.stderr.write(reason + '\n');
  process.exit(2);
}

function main() {
  process.on('uncaughtException', (e) => block('Windows-MCP approval gate failed safe (blocked): ' + (e && e.message)));
  process.on('unhandledRejection', (e) => block('Windows-MCP approval gate failed safe (blocked): ' + (e && e.message)));
  const raw = fs.readFileSync(0, 'utf8');
  // Also registered for PostToolUse / PostToolUseFailure: release the call's lock and, when the
  // add-on's reading says something about a stuck add-on, add a note for Claude next to the result.
  let event = '';
  try { event = String(JSON.parse((raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw)).hook_event_name || ''); } catch (e) { event = ''; }
  if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
    const note = afterCall(raw, { passDir: PASS_DIR, stateDir: STATE_DIR, stuckLog: STUCK_LOG, now: Date.now });
    if (note) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: note } }));
    process.exit(0);
  }
  const d = decide(raw, { runGuard, runWindow, runPoint, tmpDir: os.tmpdir(), stateDir: STATE_DIR, passDir: PASS_DIR, now: Date.now, projectDir: process.env.CLAUDE_PROJECT_DIR });
  if (d.action === 'allow') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }));
    process.exit(0);
  }
  if (d.action === 'none') process.exit(0);
  block(d.reason);
}

if (require.main === module) main();
module.exports = { decide, afterCall, describe, visible, announcementSince, sessionTitle, windowResult, shownText, parseTask, priorDeclaration, controlReading, STATE_DIR, DENIED_APPS };
