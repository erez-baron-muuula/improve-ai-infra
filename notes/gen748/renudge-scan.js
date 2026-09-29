// GEN-748 production verification scan (reader for the follow-up re-nudge).
// Usage: node renudge-scan.js <boundary-ISO-timestamp> [hookPath]
// Reads every main-session transcript under ~/.claude/projects, judges ONLY
// Stops whose summary timestamp is >= the boundary, and prints one JSON summary
// line plus one line per re-nudge fire / miss / suspected duplicate for a human
// (the scan session) to read. Read-only: writes nothing.
//
// Definitions (all from the transcript alone -- no hook log exists or is needed):
//   follow-up Stop  = a system/stop_hook_summary whose previous boundary was a
//                     stop_hook_summary with non-empty hookAdditionalContext
//                     (no genuine prompt in between).
//   For-you-opened  = that previous summary carried the For-you note.
//   re-nudge FIRE   = a For-you-opened follow-up Stop whose OWN summary also
//                     carries the For-you note (the hook spoke on a
//                     stop_hook_active Stop -- impossible before GEN-748).
//   MISS            = a For-you-opened follow-up Stop the installed hook's own
//                     followupState says should fire (tool work, no marker in the
//                     follow-up or its final text) but whose summary lacks the note
//                     while fewer than 2 re-nudges were used for that promptId.
//   SUSPECT DUP     = a fire whose follow-up text already looks like a delivered
//                     block without the pin (starts with "---", or opens "You
//                     asked"/"You said"/"You told") -- read each one.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const boundary = Date.parse(process.argv[2] || '');
if (!boundary) { console.error('usage: node renudge-scan.js <boundary-ISO> [hookPath]'); process.exit(1); }
const hook = require(process.argv[3] || path.join(os.homedir(), '.claude', 'hooks', 'stop-foryou-nudge.js'));
if (typeof hook.followupState !== 'function' || !hook.MARKER_RE) { console.error('installed hook lacks followupState/MARKER_RE exports -- is GEN-748 installed?'); process.exit(1); }
const ROOT = path.join(os.homedir(), '.claude', 'projects');
const PREFIX = 'For-you check, automatic';
const TAIL = 2 * 1024 * 1024; // = the hook's FOLLOWUP_TAIL_BYTES
const SKIP_TYPES = new Set(['attachment', 'queue-operation', 'file-history-snapshot', 'last-prompt', 'custom-title', 'atis-latch']);
const hasNote = (ctx) => Array.isArray(ctx) && ctx.some((c) => typeof c === 'string' && c.indexOf(PREFIX) === 0);
function isPromptEntry(e) {
  if (!e || e.type !== 'user' || !e.message) return false;
  const c = e.message.content;
  if (typeof c === 'string') return true;
  if (Array.isArray(c)) return !c.some((b) => b && b.type === 'tool_result');
  return false;
}
const out = { boundary: new Date(boundary).toISOString(), files: 0, summariesAfterBoundary: 0, foryouNoteSummaries: 0, foryouOpenedFollowupStops: 0, noteThenAssistant: 0, noteThenSummary: 0, noPromptTurnsSkipped: 0, fires: 0, misses: 0, suspectDup: 0, firesThenBlock: 0 };
const lines = [];
for (const slug of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, slug);
  let names; try { names = fs.readdirSync(dir); } catch (e) { continue; }
  for (const f of names) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(dir, f);
    let st; try { st = fs.statSync(p); } catch (e) { continue; }
    if (!st.isFile() || st.mtimeMs < boundary) continue;
    out.files++;
    const raw = fs.readFileSync(p, 'utf8').split('\n');
    const parsed = raw.map((l) => { if (!l) return null; try { return JSON.parse(l); } catch (e) { return null; } });
    let prev = null;          // previous boundary summary entry (or null after a prompt)
    let lastId = null, lastText = '', segTexts = [];
    const usedByPrompt = {};  // promptId -> re-nudges seen
    let curPrompt = null;
    let pendingFire = null;   // a fire whose NEXT follow-up we check for a block
    let toolsSince = 0;       // main-chain tool calls since the previous boundary
    for (let k = 0; k < parsed.length; k++) {
      const e = parsed[k];
      if (!e) continue;
      if (e.promptId) curPrompt = e.promptId;
      if (e.type === 'system' && e.subtype === 'stop_hook_summary') {
        const ts = Date.parse(e.timestamp || '') || 0;
        if (ts >= boundary) {
          out.summariesAfterBoundary++;
          if (hasNote(e.hookAdditionalContext)) {
            out.foryouNoteSummaries++;
            // Write-order check: the re-nudge anchor assumes the note's summary is
            // written BEFORE the follow-up it opens (true since harness 2.1.270;
            // <= 2.1.260 wrote summaries in a batch after the follow-up). Look at
            // the next substantive entry after this note summary.
            let j = k + 1;
            while (j < parsed.length && (!parsed[j] || SKIP_TYPES.has(parsed[j].type))) j++;
            const nx = parsed[j];
            if (nx && nx.type === 'assistant') out.noteThenAssistant++;
            else if (nx && nx.type === 'system' && nx.subtype === 'stop_hook_summary') out.noteThenSummary++;
          }
          if (pendingFire) { if (segTexts.some((t) => hook.MARKER_RE.test(t))) out.firesThenBlock++; pendingFire = null; }
          if (prev && hasNote(prev.hookAdditionalContext)) {
            out.foryouOpenedFollowupStops++;
            const where = slug.slice(-24) + '/' + f.slice(0, 8) + ':' + (k + 1);
            const joined = segTexts.join('\n');
            // A real re-nudge needs >= 1 tool call after the opening note (the hook's
            // own rule). A note summary right after a note summary with NO tool call
            // between is a NEW turn with no transcript-visible prompt (observed:
            // 9320ec4f 1510->1511, 38 min apart), not a re-nudge -- skip it.
            if (hasNote(e.hookAdditionalContext) && toolsSince === 0) {
              out.noPromptTurnsSkipped++;
            } else if (hasNote(e.hookAdditionalContext)) {
              out.fires++;
              usedByPrompt[curPrompt] = (usedByPrompt[curPrompt] || 0) + 1;
              const dupLike = /^\s*-{3,}/.test(lastText) || /^\s*(?:-{3,}\s*)?You (?:asked|said|told)\b/.test(lastText);
              if (dupLike) out.suspectDup++;
              const gapMin = prev && prev.timestamp ? Math.round((ts - Date.parse(prev.timestamp)) / 60000) : null;
              lines.push('FIRE ' + where + ' prompt=' + String(curPrompt).slice(0, 8) + ' slot=' + usedByPrompt[curPrompt] + ' tools=' + toolsSince + ' gapMin=' + gapMin + (dupLike ? ' SUSPECT-DUP' : '') + ' final=' + JSON.stringify(lastText.slice(0, 100)));
              pendingFire = where;
            } else {
              let bytes = 0, s0 = k;
              while (s0 > 0 && bytes + Buffer.byteLength(raw[s0 - 1] || '', 'utf8') + 1 <= TAIL) { s0--; bytes += Buffer.byteLength(raw[s0] || '', 'utf8') + 1; }
              const stt = hook.followupState(parsed.slice(s0, k).filter(Boolean));
              const shouldFire = !!lastText && stt && stt.openedByThisHook && stt.toolCalls >= 1 && !stt.markerAfter && !hook.MARKER_RE.test(lastText);
              if (shouldFire && (usedByPrompt[curPrompt] || 0) < 2) { out.misses++; lines.push('MISS ' + where + ' tools=' + stt.toolCalls + ' final=' + JSON.stringify(lastText.slice(0, 100))); }
            }
          }
        }
        prev = (Array.isArray(e.hookAdditionalContext) && e.hookAdditionalContext.length) ? e : null;
        lastId = null; lastText = ''; segTexts = []; toolsSince = 0;
        continue;
      }
      if (isPromptEntry(e)) { prev = null; lastId = null; lastText = ''; segTexts = []; toolsSince = 0; continue; }
      if (e.type === 'assistant' && e.isSidechain !== true && e.message && Array.isArray(e.message.content)) {
        for (const c of e.message.content) { if (c && c.type === 'tool_use') toolsSince++; }
        const txt = e.message.content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('');
        if (e.message.id !== lastId) { lastId = e.message.id; lastText = ''; }
        lastText += txt;
        if (txt) segTexts.push(txt);
      }
    }
  }
}
const rate = out.foryouOpenedFollowupStops ? out.fires / out.foryouOpenedFollowupStops : 0;
out.fireRate = Number(rate.toFixed(4));
const orderOk = out.noteThenAssistant > 0 && out.noteThenSummary <= out.noteThenAssistant;
out.bars = {
  anchorAlive: out.foryouNoteSummaries === 0 ? 'TRIPPED (no For-you note summaries after the boundary: harness format changed, or no sessions ran -- check which)'
    : (orderOk ? 'clear' : 'TRIPPED (note summaries are mostly followed by another summary, not by the follow-up: the harness went back to writing summaries after the follow-up, so the re-nudge anchor is blind)'),
  // expected rate ~1.6% (4 of 243 judgeable real follow-ups, 2026-09-29 replay); 5% ~ 3x that
  // the rate half needs >= 20 For-you-opened follow-ups to mean anything; below that only duplicates count
  overFire: out.suspectDup > 0 ? 'TRIPPED (suspect duplicate -- read it)'
    : out.foryouOpenedFollowupStops < 20 ? 'clear on duplicates; rate not judged (fewer than 20 follow-ups -- read every FIRE line)'
    : (rate <= 0.05 ? 'clear (read every FIRE line anyway)' : 'TRIPPED (fire rate > 5%)'),
  miss: out.misses === 0 ? 'clear' : 'TRIPPED'
};
console.log(JSON.stringify(out));
lines.forEach((l) => console.log(l));
