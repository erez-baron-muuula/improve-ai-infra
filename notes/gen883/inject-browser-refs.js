// PostToolUse / PostToolUseFailure hook for the browser tools (Claude in Chrome, GEN-742 + GEN-883).
// settings.json: PostToolUse matcher "ToolSearch|mcp__(claude-in-chrome|Claude_in_Chrome)__.*",
//                PostToolUseFailure matcher "mcp__(claude-in-chrome|Claude_in_Chrome)__.*".
// CLI: node inject-browser-refs.js --explain   prints the current diagnosis (for scheduled tasks
//      and tests; read-only, never says the browser is OK).
//
// 1. Notes: injects hooks/refs/browser.md once per session -- after a ToolSearch whose query or
//    result names the browser tools (they are deferred, so this is where a session reaches for
//    them), or after the first browser call (fallback). Marker claude-refs-browser-<session_id>
//    in the temp dir, so inject-topic-refs.js --reset-after-compact (SessionStart "compact")
//    clears it and the notes come back after a compaction.
// 2. Diagnosis: when a browser call reports that no browser is connected -- the tool's own
//    failure phrases (matched on a failure's error text, or on a short result that STARTS with
//    the tool's banner, so page text containing "not connected" never trips it), or
//    list_connected_browsers returning [] -- reads the Claude desktop app's own log and injects
//    the real reason plus the one fix, ahead of the notes. Root cause (GEN-883, 2026-10-21, from
//    the app log): the app's browser link is tied to the Claude account the app was on when the
//    link last connected (a PC sleep/wake, an app restart, or a dropped connection
//    reconnecting); switching accounts alone does not move it. Each Comet profile's extension is
//    signed in to one account. The log only EXPLAINS a failure the tool already reported -- this
//    hook never declares the browser OK.
//    - Settle: if the link (re)connected or the extension disconnected under 90 s ago, the FIRST
//      failure after that event gets "wait 20 s, retry once" (not counted); the retry gets the
//      full diagnosis.
//    - At most one full diagnosis per session per link per clock-aligned 10-minute bucket; a
//      repeat gets a one-line reminder of the reason and fix.
//    - Each full diagnosis appends a line to hooks/browser-events.jsonl. When that log holds 2 or
//      more separate outages (events over 2 h apart count as separate) in the last 7 days, only
//      counting events after the two-profile setup (SETUP_UTC), the diagnosis also says the setup
//      is not holding -- the re-evaluate bar, surfaced to Erez at the moment of an outage. No
//      other reader exists.
//    Throttle markers live in <temp>/claude-browser-hook/ and are pruned after a day.
//
// Account labels come from hooks/refs/browser-accounts.json ({ "<first 8 hex of account id>":
// { "account": "<email>", "profile": "<Comet profile>" } }); an unmapped account is shown by its
// id prefix. A missing/unreadable log gives "reason unknown" with the generic fixes -- never
// silence.
//
// Sub-agent calls (agent_id present) are skipped, as in inject-windows-mcp-refs.js (sub-agents
// made 0 browser calls in this PC's transcripts, 2026-10-21).
// Never blocks the tool call; any unexpected error fails open silently (exit 0, no output).

const fs = require('fs');
const os = require('os');
const path = require('path');

const TOOL_RE = /^mcp__(claude-in-chrome|Claude_in_Chrome)__/;
const DIAG_WINDOW_MS = 10 * 60 * 1000;
const SHORT_RESULT = 1500; // a result longer than this is page content, not a connection error
const FAILURE_RES = [
  /Claude in Chrome is not connected/i,
  /Browser extension is not connected/i,
  /No Chrome extension connected/i,
  /NoExtensionConnectedError/,
  /No browsers? (are|is) connected/i,
];
// A normal (non-error) result must START with one of these (after symbols such as the warning
// sign and bold markers). Seen 2026-10-21: "⚠️ **Claude in Chrome is not connected**".
const RESULT_START_RE = /^[^A-Za-z0-9]*(Claude in Chrome is not connected|Browser extension is not connected)/i;
const SETTLE_MS = 90 * 1000;  // a link/extension event this recent may still be settling
const SETUP_UTC = Date.parse('2026-10-21T14:00:00Z'); // two-profile setup; earlier events don't count
const LOG_DIR = path.join(process.env.LOCALAPPDATA || '', 'Claude', 'Logs');
const LOG_FILES = ['main.log', 'main1.log']; // newest first; main1 is the previous rotation
const TAIL_READ = 2 * 1024 * 1024;   // try the log's last 2 MB first ...
const MAX_READ = 12 * 1024 * 1024;   // ... and the whole (rotation-capped) file only if needed
const BAR_OUTAGES = 2;
const BAR_DAYS = 7;
const EPISODE_GAP_MS = 2 * 3600 * 1000;
const MARKER_TTL_MS = 24 * 3600 * 1000;
const INJECT_CAP = 9500; // under Claude Code's 10,000-character limit on injected text
const SEP = '\n\n---\n\n';

function asText(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return ''; }
}

function toolName(data) { return typeof data.tool_name === 'string' ? data.tool_name : ''; }

function wantsNotes(data) {
  const tool = toolName(data);
  if (TOOL_RE.test(tool)) return true;
  if (tool !== 'ToolSearch') return false;
  const query = data.tool_input && typeof data.tool_input.query === 'string' ? data.tool_input.query : '';
  return /claude-in-chrome|claude_in_chrome/i.test(query) || /mcp__(claude-in-chrome|Claude_in_Chrome)__/.test(asText(data.tool_response));
}

// The first text part of a result (MCP results are [{type:'text',text}, ...]), else the whole.
function firstText(r) {
  if (Array.isArray(r)) {
    const p = r.find((x) => x && typeof x.text === 'string');
    return p ? p.text : '';
  }
  return asText(r);
}

// True when this browser call says no browser is reachable.
function reportsNotConnected(data) {
  const tool = toolName(data);
  if (!TOOL_RE.test(tool)) return false;
  const err = asText(data.error);
  if (err && FAILURE_RES.some((re) => re.test(err))) return true;
  // A normal result counts only when it IS the tool's own message: short, and starting with it.
  // Page text, console lines and the tab-title list never reach the start of the first part.
  const head = firstText(data.tool_response);
  if (head && head.length <= SHORT_RESULT && RESULT_START_RE.test(head)) return true;
  if (/__list_connected_browsers$/.test(tool)) {
    const r = data.tool_response;
    if (Array.isArray(r) && r.length === 0) return true;
    if (typeof r === 'string' && /^\s*\[\s*\]\s*$/.test(r)) return true;
    // MCP text content: [{"type":"text","text":"[]"}]
    if (Array.isArray(r) && r.length === 1 && r[0] && typeof r[0].text === 'string' && /^\s*\[\s*\]\s*$/.test(r[0].text)) return true;
  }
  return false;
}

function readLog(file, maxBytes) {
  try {
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(st.size - start);
      const n = fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8', 0, n);
    } finally { fs.closeSync(fd); }
  } catch (e) { return null; }
}

// Last match of a global regex: { m, ts } or null; ts = that log line's leading timestamp.
function lastMatch(text, re) {
  let found = null;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) found = m;
  if (!found) return null;
  const lineStart = text.lastIndexOf('\n', found.index) + 1;
  const tsm = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(text.slice(lineStart, lineStart + 19));
  return { m: found, ts: tsm ? tsm[1] : null };
}

const RE_ACCT = /acct:([0-9a-f]{8})/g;
const RE_LINK = /\[claude-in-chrome\] Connecting to bridge: \S*\/chrome\/([0-9a-f]{8})/g;
const RE_EXT = /\[claude-in-chrome\] (Paired with Chrome extension|Chrome extension connected to bridge|Chrome extension disconnected from bridge)/g;
// Only a bridge close counts as the link going down. 'Starting app' is NOT used: a second app
// launch that quits at once (a taskbar click, a claude:// link) logs it too and leaves the link up
// (main.log 2026-10-19 09:28: link from 09:27 stayed up until 20:41).
const RE_DOWN = /\[claude-in-chrome\] Bridge connection closed/g;

// Fills state from one log text; fields already set (from a newer text) are kept.
function scan(text, state) {
  if (!state.appAcct) {
    const a = lastMatch(text, RE_ACCT);
    if (a) state.appAcct = a.m[1];
  }
  if (!state.linkAcct) {
    const l = lastMatch(text, RE_LINK);
    if (l) { state.linkAcct = l.m[1]; state.linkTs = l.ts; }
  }
  if (!state.lastExt) {
    const e = lastMatch(text, RE_EXT);
    if (e) { state.lastExt = e.ts; state.lastExtKind = /disconnected/.test(e.m[1]) ? 'left' : 'seen'; }
  }
  if (!state.lastDown) {
    const d = lastMatch(text, RE_DOWN);
    if (d) state.lastDown = d.ts;
  }
}

function complete(state) { return !!(state.appAcct && state.linkAcct && state.lastExt); }

// From the app log(s): the app's current account, the account the browser link is on (and when
// it connected), the last extension event, and whether the link has gone down since it
// connected (a bridge close logged after it). Any field may be null.
function readState(logDir) {
  const state = { readable: false, appAcct: null, linkAcct: null, linkTs: null, lastExt: null, lastExtKind: null, lastDown: null, linkDown: false };
  for (const name of LOG_FILES) {
    const file = path.join(logDir, name);
    const tail = readLog(file, TAIL_READ);
    if (tail === null) continue;
    state.readable = true;
    scan(tail, state);
    if (!complete(state)) {
      const whole = readLog(file, MAX_READ);
      if (whole !== null && whole.length > tail.length) scan(whole, state);
    }
    if (complete(state)) break;
  }
  state.linkDown = !!(state.linkTs && state.lastDown && state.lastDown > state.linkTs);
  return state;
}

function loadLabels(dir) {
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(dir, 'refs', 'browser-accounts.json'), 'utf8'));
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) { return {}; }
}

function labelField(labels, acct, field) {
  const v = acct && labels[acct];
  return v && typeof v === 'object' && typeof v[field] === 'string' && v[field].trim() ? v[field].trim() : null;
}

// The Claude account, e.g. "info@muuula.com [account c68119fc]".
function label(labels, acct) {
  if (!acct) return 'an unknown account';
  const name = labelField(labels, acct, 'account');
  return name ? name + ' [account ' + acct + ']' : 'account ' + acct;
}

// The Comet profile holding that account's extension.
function profileLabel(labels, acct) {
  return labelField(labels, acct, 'profile') || 'the Comet profile whose Claude extension is signed in to ' + label(labels, acct);
}

// The diagnosis. Returns { reason, text, short } -- short is the one-line reminder for repeats.
function diagnose(state, labels, headOverride) {
  const head = headOverride || 'browser-diagnose (GEN-883): no Comet browser is answering. ';
  const tail = ' Tell Erez this in one line instead of the tool\'s generic install/sign-in list. In a scheduled task: follow the task\'s own steps for a browser that is not connected (its retry count, and its could-not-run or alert step if it has one) and put this fix in whatever it reports; never report a browser step as passed. If the task treats the browser as optional, just note it.';
  const restart = 'ask Erez first, since it stops every Claude session that is mid-task: fully quit the Claude app from its system-tray icon and reopen it, so the link reconnects on the app\'s current account';
  const openFix = (acct) => 'open ' + profileLabel(labels, acct) + ' (a minimized window is enough for the connection) and check that its Claude extension still shows ' + label(labels, acct) + '; if it shows the other account, sign it in to this one';
  if (!state.readable || !state.linkAcct) {
    const fix = '(1) open both Comet profiles, each with its Claude extension signed in to a different one of Erez\'s Claude accounts; (2) if that does not help, ' + restart;
    return {
      reason: 'unknown',
      text: head + 'Reason unknown: the Claude app log (' + path.join(LOG_DIR, 'main.log') + ') could not be read or names no browser link. Fix, in order: ' + fix + '.' + tail,
      short: 'reason unknown; fix: ' + fix + '.',
    };
  }
  if (state.linkDown) {
    // The last link is gone (its bridge connection closed after it connected); the next browser call
    // rebuilds it on the app's current account.
    const target = state.appAcct || state.linkAcct;
    return {
      reason: 'link-down',
      text: head + 'The browser link dropped at ' + state.lastDown + ' and has not reconnected yet; the next browser call rebuilds it on the app\'s current account, ' + label(labels, state.appAcct) + '. Retry once. If it still fails, fix for Erez: ' + openFix(target) + '.' + tail,
      short: 'the link went down at ' + state.lastDown + '; fix: ' + openFix(target) + '.',
    };
  }
  const L = label(labels, state.linkAcct);
  const since = !state.linkTs ? ''
    : state.lastExt && state.lastExt >= state.linkTs
    ? ' Last browser event on this link: ' + state.lastExt + ' (' + (state.lastExtKind === 'left' ? 'a browser disconnected' : 'a browser connected') + ').'
    : ' No browser has answered on this link since it connected at ' + state.linkTs + '.';
  if (state.appAcct && state.appAcct !== state.linkAcct) {
    return {
      reason: 'link-on-other-account',
      text: head + 'The Claude app is now on ' + label(labels, state.appAcct) + ', but its browser link is still on ' + L + ' (the link follows an account switch only when it next reconnects), and no browser signed in to that account is answering. Restarting an already-open Comet, refreshing a tab or signing in to a website does not fix this (2026-10-21).' + since + ' Fix for Erez: ' + openFix(state.linkAcct) + '. If that profile is open and correct, ' + restart + '.' + tail,
      short: 'the link is still on ' + L + ' while the app is on ' + label(labels, state.appAcct) + '; fix: ' + openFix(state.linkAcct) + '.',
    };
  }
  return {
    reason: 'no-browser-on-account',
    text: head + 'The browser link is on ' + L + (state.appAcct ? ' (the app\'s current account)' : ' (the app\'s current account could not be read from its log)') + ', but no Comet browser signed in to that account is answering.' + since + ' Fix for Erez: ' + openFix(state.linkAcct) + '. If that profile is open and correct, ' + restart + '.' + tail,
    short: 'no browser on ' + L + '; fix: ' + openFix(state.linkAcct) + '.',
  };
}

// Throttle markers: <temp>/claude-browser-hook/<name>. Exclusive create is atomic: true for
// exactly one caller per name.
function markerDir(tmpDir) { return path.join(tmpDir, 'claude-browser-hook'); }

// Returns 'claimed', 'taken' (another call already holds it) or 'error' (could not write).
function claimOnce(dir, name, now) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), new Date(now).toISOString(), { flag: 'wx' });
    return 'claimed';
  } catch (e) { return e && e.code === 'EEXIST' ? 'taken' : 'error'; }
}

// Deletes throttle markers older than a day (best-effort; runs only on a full diagnosis).
function pruneMarkers(dir, now) {
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { if (now - fs.statSync(p).mtimeMs > MARKER_TTL_MS) fs.unlinkSync(p); } catch (e) { /* skip */ }
    }
  } catch (e) { /* no dir yet */ }
}

// Separate outages in the last BAR_DAYS days (events over EPISODE_GAP_MS apart), after SETUP_UTC.
function outageCount(file, now) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return 0; }
  const cutoff = Math.max(SETUP_UTC, now - BAR_DAYS * 24 * 3600 * 1000);
  const times = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const t = Date.parse(JSON.parse(line).ts);
      if (t >= cutoff && t <= now) times.push(t);
    } catch (e) { /* skip a bad line */ }
  }
  times.sort((a, b) => a - b);
  let episodes = 0;
  let last = -Infinity;
  for (const t of times) { if (t - last > EPISODE_GAP_MS) episodes++; last = t; }
  return episodes;
}

// Pure core, exported for tests. opts: { tmpDir, hooksDir, logDir, now }.
function handle(data, opts) {
  const safeId = (typeof data.session_id === 'string' ? data.session_id : '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!safeId) return null;
  if (data.agent_id !== undefined && data.agent_id !== null) return null;
  const parts = [];
  if (reportsNotConnected(data)) {
    const state = readState(opts.logDir);
    const mdir = markerDir(opts.tmpDir);
    // The most recent link (re)connect or extension disconnect, if under SETTLE_MS ago (wake,
    // restart, dropped connection, a 3-second extension blip). Log times are local; Date parses
    // "YYYY-MM-DDTHH:MM:SS" (no zone) as local time.
    let settle = null;
    for (const ts of [state.linkTs, state.lastExtKind === 'left' ? state.lastExt : null]) {
      if (!ts) continue;
      const age = opts.now - Date.parse(ts.replace(' ', 'T'));
      if (age >= 0 && age < SETTLE_MS && (!settle || age < settle.age)) settle = { ts, age };
    }
    const linkKey = (state.linkTs || 'nolink').replace(/\D/g, '');
    if (settle && claimOnce(mdir, 'settle-' + safeId + '-' + settle.ts.replace(/\D/g, ''), opts.now) === 'claimed') {
      // Once per event; the retry it asks for falls through to the full diagnosis. Not counted.
      parts.push('browser-diagnose (GEN-883): the browser link or extension changed ' + Math.round(settle.age / 1000) + ' s ago and may still be settling. Wait about 20 s and retry once; if it still says not connected, the next result gives the reason and fix.');
    } else if (claimOnce(mdir, 'diag-' + safeId + '-' + linkKey + '-' + Math.floor(opts.now / DIAG_WINDOW_MS), opts.now) === 'taken') {
      // Already diagnosed for this link in this bucket: a one-line reminder, which also survives
      // a compaction that dropped the earlier paragraph.
      const d = diagnose(state, loadLabels(opts.hooksDir));
      parts.push('browser-diagnose (GEN-883): still not connected -- ' + d.short + ' Tell Erez; in a scheduled task, keep following its own retry count and not-connected steps.');
    } else {
      const d = diagnose(state, loadLabels(opts.hooksDir));
      const events = path.join(opts.hooksDir, 'browser-events.jsonl');
      try {
        fs.appendFileSync(events, JSON.stringify({
          ts: new Date(opts.now).toISOString(), session: safeId, tool: toolName(data), event: data.hook_event_name || null,
          reason: d.reason, appAcct: state.appAcct, linkAcct: state.linkAcct, lastExt: state.lastExt,
        }) + '\n');
      } catch (e) { /* tally is best-effort */ }
      let text = d.text;
      const n = outageCount(events, opts.now);
      if (n >= BAR_OUTAGES) {
        text += ' Re-evaluate bar reached: ' + n + ' separate browser outages in the last ' + BAR_DAYS + ' days, any cause (hooks/browser-events.jsonl, see each line\'s reason). Tell Erez the browser is still not reliable with the two-profile setup and GEN-883 needs another look (in a scheduled task, put this in its report).';
      }
      parts.push(text);
      pruneMarkers(mdir, opts.now);
    }
  }
  if (wantsNotes(data)) {
    let refText = '';
    try { refText = fs.readFileSync(path.join(opts.hooksDir, 'refs', 'browser.md'), 'utf8'); } catch (e) { refText = ''; }
    const notes = refText && refText.trim()
      ? refText
      : 'inject-browser-refs: refs/browser.md missing or empty -- browser notes were NOT loaded; flag this to Erez.';
    // Claude Code shows only a path + preview for injected text over 10,000 characters: if the
    // notes would push this call over the line, leave them for the next browser call.
    const used = parts.reduce((s, p) => s + p.length + SEP.length, 0);
    if (notes.length > INJECT_CAP) {
      if (claimOnce(opts.tmpDir, 'claude-refs-browser-' + safeId, opts.now) === 'claimed') {
        parts.push('inject-browser-refs: refs/browser.md is ' + notes.length + ' characters, over the ' + INJECT_CAP + ' that fit in one injection -- read it with the Read tool (' + path.join(opts.hooksDir, 'refs', 'browser.md') + ') and tell Erez it needs splitting.');
      }
    } else if (used + notes.length <= INJECT_CAP && claimOnce(opts.tmpDir, 'claude-refs-browser-' + safeId, opts.now) === 'claimed') {
      parts.push(notes);
    }
  }
  return parts.length ? parts.join(SEP) : null;
}

function main() {
  if (process.argv[2] === '--explain') {
    let text;
    // Read-only explanation; whether a browser answers is decided only by the live tool call.
    try { text = diagnose(readState(LOG_DIR), loadLabels(__dirname), 'browser-diagnose --explain (GEN-883; the live browser call alone says whether a browser answers -- this explains a failure it reported): ').text; } catch (e) { text = 'browser-diagnose: could not build a diagnosis (' + e.message + ').'; }
    process.stdout.write(text + '\n');
    process.exit(0);
  }
  let input = '';
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', () => {
    let out = null;
    let event = 'PostToolUse';
    try {
      const raw = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
      const data = JSON.parse(raw || '{}');
      if (data && data.hook_event_name === 'PostToolUseFailure') event = 'PostToolUseFailure';
      out = handle(data, { tmpDir: os.tmpdir(), hooksDir: __dirname, logDir: LOG_DIR, now: Date.now() });
    } catch (e) {
      out = null; // fail open
    }
    if (out) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: out } }));
    process.exit(0);
  });
}

if (require.main === module) main();
module.exports = { wantsNotes, reportsNotConnected, readState, diagnose, handle, label, profileLabel, outageCount };
