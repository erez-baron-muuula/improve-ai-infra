// Writes %TEMP%\gen748-fixtures\reply-corpus.jsonl (conversation text -- never commit it). Input for regress-firststop.js.
// Build a corpus of real turn-final assistant replies (what a Stop hook sees as
// last_assistant_message) from all main-session transcripts.
// Boundaries: system/stop_hook_summary (a Stop fired) or a genuine prompt.
// Each reply = text of the LAST assistant message (by message.id) before the boundary.
// Tags: followup (previous boundary was a Stop summary with non-empty hookAdditionalContext),
// byForyou (that summary carried the For-you note), marker (old MARKER_RE), hasSummary (file has summaries).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\Erez\\.claude\\projects';
const OUT = path.join(path.join(require('os').tmpdir(), 'gen748-fixtures'), 'reply-corpus.jsonl'); fs.mkdirSync(path.dirname(OUT), { recursive: true });
const MARKER_OLD = /\u{1F4CC}\s*\*{0,2}\s*For you/u;
function isPromptEntry(e) {
  if (!e || e.type !== 'user' || !e.message) return false;
  const c = e.message.content;
  if (typeof c === 'string') return true;
  if (Array.isArray(c)) return !c.some((b) => b && b.type === 'tool_result');
  return false;
}
const outFd = fs.openSync(OUT, 'w');
let n = 0;
for (const slug of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, slug);
  let names; try { names = fs.readdirSync(dir); } catch (e) { continue; }
  for (const f of names) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(dir, f);
    let st; try { st = fs.statSync(p); } catch (e) { continue; }
    if (!st.isFile()) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    const hasSummary = lines.some((l) => l.indexOf('"stop_hook_summary"') !== -1);
    let lastMsgId = null, lastText = '', lastLine = 0, lastTs = null;
    let prev = { followup: false, byForyou: false };
    let tools = 0;
    const emit = (lineNo) => {
      if (lastMsgId !== null) {
        const rec = { f: slug.slice(-22) + '/' + f.slice(0, 8), line: lastLine, ts: lastTs, followup: prev.followup, byForyou: prev.byForyou, hasSummary, tools, marker: MARKER_OLD.test(lastText.slice(0, 300000)), text: lastText };
        fs.writeSync(outFd, JSON.stringify(rec) + '\n');
        n++;
      }
      lastMsgId = null; lastText = ''; tools = 0;
    };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      let e; try { e = JSON.parse(l); } catch (x) { continue; }
      if (e.type === 'system' && e.subtype === 'stop_hook_summary') {
        emit(i + 1);
        const ctx = Array.isArray(e.hookAdditionalContext) ? e.hookAdditionalContext : [];
        prev = { followup: ctx.length > 0, byForyou: ctx.some((s) => typeof s === 'string' && s.indexOf('For-you check, automatic') === 0) };
        continue;
      }
      if (isPromptEntry(e)) { emit(i + 1); prev = { followup: false, byForyou: false }; continue; }
      if (e.type === 'assistant' && e.isSidechain !== true && e.message && Array.isArray(e.message.content)) {
        const id = e.message.id;
        for (const c of e.message.content) { if (c && c.type === 'tool_use') tools++; }
        const txt = e.message.content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('');
        if (!txt) continue;
        if (id !== lastMsgId) { lastMsgId = id; lastText = ''; }
        lastText += txt; lastLine = i + 1; lastTs = e.timestamp || null;
      }
    }
    emit(lines.length);
  }
}
fs.closeSync(outFd);
console.log('replies written:', n, '->', OUT);
