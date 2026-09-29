// Whole-corpus replay of the GEN-748 re-nudge DECISION using the working copy's
// own exported followupState + MARKER_RE. For every Stop in every main
// transcript that ends a hook-opened continuation (the previous boundary was a
// stop_hook_summary with non-empty hookAdditionalContext, no genuine prompt in
// between), rebuild what the hook would see: the transcript tail (<= 512 KB of
// the lines BEFORE this Stop's own summary) and last_assistant_message (the
// last main-chain assistant message's text before it). Cap not simulated.
'use strict';
const fs = require('fs');
const path = require('path');
const wc = require(process.argv[2]);
const ROOT = 'C:\\Users\\Erez\\.claude\\projects';
const TAIL = 2 * 1024 * 1024; // = the hook's FOLLOWUP_TAIL_BYTES
function isPromptEntry(e) {
  if (!e || e.type !== 'user' || !e.message) return false;
  const c = e.message.content;
  if (typeof c === 'string') return true;
  if (Array.isArray(c)) return !c.some((b) => b && b.type === 'tool_result');
  return false;
}
let followupStops = 0, fires = [], openedByUs = 0, noSummaryInTail = 0;
for (const slug of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, slug);
  let names; try { names = fs.readdirSync(dir); } catch (e) { continue; }
  for (const f of names) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(dir, f);
    if (!fs.statSync(p).isFile()) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    const parsed = lines.map((l) => { if (!l) return null; try { return JSON.parse(l); } catch (e) { return null; } });
    let inFollowup = false;
    let lastMsgId = null, lastText = '';
    for (let k = 0; k < parsed.length; k++) {
      const e = parsed[k];
      if (!e) continue;
      if (e.type === 'system' && e.subtype === 'stop_hook_summary') {
        if (inFollowup) {
          followupStops++;
          // tail: lines before k, up to TAIL bytes
          let bytes = 0, start = k;
          while (start > 0 && bytes + Buffer.byteLength(lines[start - 1] || '', 'utf8') + 1 <= TAIL) { start--; bytes += Buffer.byteLength(lines[start] || '', 'utf8') + 1; }
          const tail = parsed.slice(start, k).filter(Boolean);
          const st = wc.followupState(tail);
          if (!st) noSummaryInTail++;
          if (st && st.openedByThisHook) openedByUs++;
          const msg = lastText;
          const fire = !!msg && !wc.MARKER_RE.test(msg) && st && st.openedByThisHook && st.toolCalls >= 1 && !st.markerAfter;
          if (fire) fires.push(slug.slice(-22) + '/' + f.slice(0, 8) + ' stopLine=' + (k + 1) + ' tools=' + st.toolCalls + ' msg=' + JSON.stringify(msg.slice(0, 90)));
        }
        const ctx = Array.isArray(e.hookAdditionalContext) ? e.hookAdditionalContext : [];
        inFollowup = ctx.length > 0;
        lastMsgId = null; lastText = '';
        continue;
      }
      if (isPromptEntry(e)) { inFollowup = false; lastMsgId = null; lastText = ''; continue; }
      if (e.type === 'assistant' && e.isSidechain !== true && e.message && Array.isArray(e.message.content)) {
        const txt = e.message.content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('');
        if (e.message.id !== lastMsgId) { lastMsgId = e.message.id; lastText = ''; }
        lastText += txt;
      }
    }
  }
}
console.log(JSON.stringify({ followupStops, openedByThisHook: openedByUs, noSummaryInTail, fires: fires.length }));
fires.forEach((x) => console.log('FIRE', x));
