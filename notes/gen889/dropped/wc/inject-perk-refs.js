// UserPromptSubmit + PreToolUse(WebSearch) hook — reminds Claude of a perk Erez holds
// (credits, discount codes) when the text in play mentions what that perk covers.
//
// The perks live in hooks/refs/perks.md, one `## ` section per perk with `- Status:` and
// `- Keywords:` lines (format described at the top of that file). This hook reads the
// text of Erez's message (UserPromptSubmit `prompt`) or of a web search Claude is about
// to run (PreToolUse WebSearch `tool_input.query`; falls back to the whole tool_input as
// JSON if that field is absent), and injects every unused, unexpired perk with a keyword
// in that text. Keywords match case-insensitively on whole words (letters/digits on
// either side block a match), so "office space" does not fire on "officespace" and
// Hebrew keywords work too.
//
// Once per perk per session: one marker file per perk in the OS temp dir, keyed by
// session_id + a hash of the perk's heading. No session_id -> inject nothing (never risk
// re-injecting every call), as in inject-deployment-refs.js. The marker is written
// BEFORE emitting, so a crash can only under-inject, never repeat.
//
// Problems with the list are not silent: a missing/unreadable file, a file with no
// readable perk, or individual sections missing Status/Keywords produce a one-line
// warning, once per session per distinct problem (its own marker). Any other error fails open silently via
// the outer catch. Never blocks the prompt or the tool call.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REF_FILE = path.join(__dirname, 'refs', 'perks.md');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word, case-insensitive matcher for one keyword; inner whitespace matches any run of whitespace.
// A Hebrew keyword also matches with one attached prefix letter (ב ה ו כ ל מ ש), as Hebrew writes them;
// any other keyword also matches with an English plural ending ("office spaces", "static sites").
function keywordRe(kw) {
  const body = escapeRe(kw).replace(/\s+/g, '\\s+');
  const hebrew = /^\p{Script=Hebrew}/u.test(kw);
  const prefix = hebrew ? '[בהוכלמש]?' : '';
  const plural = hebrew ? '' : '(?:e?s)?';
  return new RegExp('(?<![\\p{L}\\p{N}])' + prefix + body + plural + '(?![\\p{L}\\p{N}])', 'iu');
}

const STATUSES = ['unused', 'used', 'declined', 'expired'];

function todayLocal() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Split perks.md into sections; return { perks: [...], bad: [titles of unreadable sections] }.
function parsePerks(text) {
  const perks = [];
  const bad = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const body = cur.lines.join('\n');
    const status = (body.match(/^\s*-\s*Status:\s*(.+)$/im) || [])[1];
    const kwLine = (body.match(/^\s*-\s*Keywords:\s*(.+)$/im) || [])[1];
    let regexes = [];
    try {
      regexes = kwLine ? kwLine.split(',').map(k => k.trim()).filter(Boolean).map(keywordRe) : [];
    } catch (e) {
      regexes = [];
    }
    // Status is its first word, so "unused (checked 2026-11-01)" still reads as unused.
    const statusWord = status ? (status.trim().match(/^[A-Za-z]+/) || [''])[0].toLowerCase() : '';
    if (!STATUSES.includes(statusWord) || regexes.length === 0) {
      bad.push(cur.title);
    } else {
      const expires = (body.match(/^\s*-\s*Expires:\s*(\d{4}-\d{2}-\d{2})/im) || [])[1] || null;
      perks.push({
        title: cur.title,
        status: statusWord,
        regexes,
        expires,
        text: ('## ' + cur.title + '\n' + body).trim(),
      });
    }
    cur = null;
  };
  for (const line of lines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      flush();
      cur = { title: h[1], lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  flush();
  return { perks, bad };
}

// Write a marker; true if this call created it (first time this session), false if it already existed.
function claimMarker(file) {
  try {
    fs.writeFileSync(file, new Date().toISOString(), { flag: 'wx' });
    return true;
  } catch (e) {
    return false;
  }
}

let input = '';
process.stdin.on('error', () => process.exit(0)); // fail open explicitly
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  let additionalContext = null;
  let eventName = null;
  try {
    const data = JSON.parse(input || '{}');
    eventName = typeof data.hook_event_name === 'string' ? data.hook_event_name : '';
    const sessionId = typeof data.session_id === 'string' ? data.session_id : '';
    const safeId = sessionId.replace(/[^A-Za-z0-9_-]/g, '');
    // Sub-agents share the parent's session_id; a reminder shown only to a sub-agent never
    // reaches Erez but would use up that perk's once-per-session marker. Skip them entirely.
    const inSubagent = typeof data.agent_id === 'string' && data.agent_id !== '';

    let text = '';
    if (inSubagent) {
      text = '';
    } else if (eventName === 'UserPromptSubmit') {
      text = typeof data.prompt === 'string' ? data.prompt : '';
    } else if (eventName === 'PreToolUse' && data.tool_name === 'WebSearch') {
      const ti = data.tool_input || {};
      text = typeof ti.query === 'string' ? ti.query : JSON.stringify(ti);
    }

    if (text && safeId) {
      const markerBase = path.join(os.tmpdir(), 'claude-perk-refs-' + safeId);
      const warnings = [];
      let perks = [];
      let raw = null;
      try {
        raw = fs.readFileSync(REF_FILE, 'utf8');
      } catch (e) {
        raw = null;
      }
      if (raw === null) {
        warnings.push('refs/perks.md is missing or unreadable — perk reminders are OFF.');
      } else {
        const parsed = parsePerks(raw);
        perks = parsed.perks;
        if (perks.length === 0) {
          warnings.push('refs/perks.md has no readable perk (each needs "- Status:" and "- Keywords:" lines) — perk reminders are OFF.');
        } else if (parsed.bad.length) {
          warnings.push('refs/perks.md: these sections lack a valid "- Status:" (unused/used/declined/expired) or "- Keywords:" line and are skipped: ' + parsed.bad.join('; ') + '.');
        }
      }

      const out = [];
      if (warnings.length) {
        // One marker per distinct warning, so a different problem later in the session still surfaces.
        const wkey = crypto.createHash('sha1').update(warnings.join(' ')).digest('hex').slice(0, 12);
        if (claimMarker(markerBase + '-warn-' + wkey)) {
          out.push('inject-perk-refs: ' + warnings.join(' ') + ' Erez has not been told.');
        }
      }

      const today = todayLocal();
      const hits = perks.filter(p =>
        p.status === 'unused' &&
        !(p.expires && p.expires < today) &&
        p.regexes.some(re => re.test(text))
      );
      const fresh = hits.filter(p => {
        const key = crypto.createHash('sha1').update(p.title).digest('hex').slice(0, 12);
        return claimMarker(markerBase + '-' + key);
      });
      if (fresh.length) {
        out.push(
          'Perk reminder (from ~/.claude/hooks/refs/perks.md): Erez holds the perk(s) below, and this message mentions what they cover. ' +
          'At a decision about buying, choosing or paying for something they cover, the perk is worth mentioning to him, with its validity unconfirmed unless checked. ' +
          'When he uses or turns one down, its "- Status:" line in that file is updated in the same turn.\n\n' +
          fresh.map(p => p.text).join('\n\n')
        );
      }
      if (out.length) additionalContext = out.join('\n\n');
    }
  } catch (e) {
    // fail open — inject nothing
  }

  if (additionalContext && eventName) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: eventName,
          additionalContext,
        },
      })
    );
  }
  process.exit(0);
});
