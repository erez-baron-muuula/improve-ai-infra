// Survey real main-session transcripts for Stop-hook-opened follow-up segments.
// A segment starts right after a system/stop_hook_summary with non-empty
// hookAdditionalContext and runs until the next stop_hook_summary (the follow-up's
// own Stop) or a genuine new prompt (user entry that is not a tool_result).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\Erez\\.claude\\projects';
const MARKER_OLD = /\u{1F4CC}\s*\*{0,2}\s*For you/u;
const out = { files: 0, summaries: 0, summariesWithCtx: 0, ctxShapes: {}, segments: [], sidechainInMain: 0 };
function isPromptEntry(e) {
  if (!e || e.type !== 'user' || !e.message) return false;
  const c = e.message.content;
  if (typeof c === 'string') return true;
  if (Array.isArray(c)) return !c.some((b) => b && b.type === 'tool_result');
  return false;
}
for (const slug of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, slug);
  let names; try { names = fs.readdirSync(dir); } catch (e) { continue; }
  for (const f of names) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(dir, f);
    let st; try { st = fs.statSync(p); } catch (e) { continue; }
    if (!st.isFile()) continue;
    out.files++;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    let seg = null;
    const close = (reason, lineNo) => { if (seg) { seg.end = reason; seg.endLine = lineNo; out.segments.push(seg); seg = null; } };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      let e; try { e = JSON.parse(l); } catch (x) { continue; }
      if (e.isSidechain === true && e.type === 'assistant') out.sidechainInMain++;
      if (e.type === 'system' && e.subtype === 'stop_hook_summary') {
        out.summaries++;
        close('stop', i + 1);
        const ctx = Array.isArray(e.hookAdditionalContext) ? e.hookAdditionalContext : null;
        const k = ctx === null ? 'missing' : ('len' + ctx.length);
        out.ctxShapes[k] = (out.ctxShapes[k] || 0) + 1;
        if (ctx && ctx.length) {
          out.summariesWithCtx++;
          seg = {
            file: slug.slice(-25) + '/' + f.slice(0, 8), startLine: i + 1,
            openers: ctx.map((s) => String(s).slice(0, 40)),
            byForyou: ctx.some((s) => typeof s === 'string' && s.indexOf('For-you check, automatic') === 0),
            tools: 0, texts: [], markerInText: false, promptIds: new Set(),
            preventedContinuation: e.preventedContinuation
          };
        }
        continue;
      }
      if (!seg) continue;
      if (isPromptEntry(e)) { close('prompt', i + 1); continue; }
      if (e.type === 'user' && e.promptId) seg.promptIds.add(e.promptId);
      if (e.type === 'assistant' && e.isSidechain !== true && e.message && Array.isArray(e.message.content)) {
        for (const c of e.message.content) {
          if (!c) continue;
          if (c.type === 'tool_use') seg.tools++;
          if (c.type === 'text' && typeof c.text === 'string') { seg.texts.push(c.text); if (MARKER_OLD.test(c.text.slice(0, 200000))) seg.markerInText = true; }
        }
      }
    }
    close('eof', lines.length);
  }
}
const segs = out.segments.map((s) => Object.assign({}, s, { promptIds: s.promptIds.size }));
// (per-segment dump disabled in the banked copy: it contains conversation text)
const byF = segs.filter((s) => s.byForyou);
const summary = {
  files: out.files, summaries: out.summaries, summariesWithCtx: out.summariesWithCtx, ctxShapes: out.ctxShapes,
  sidechainInMain: out.sidechainInMain,
  segments: segs.length, byForyou: byF.length,
  byForyouEnd: byF.reduce((a, s) => { a[s.end] = (a[s.end] || 0) + 1; return a; }, {}),
  byForyouWithTools: byF.filter((s) => s.tools > 0).length,
  byForyouWithToolsNoMarker: byF.filter((s) => s.tools > 0 && !s.markerInText).length,
  byForyouStopEndWithToolsNoMarker: byF.filter((s) => s.end === 'stop' && s.tools > 0 && !s.markerInText).length,
  multiPromptIdSegs: segs.filter((s) => s.promptIds > 1).length
};
console.log(JSON.stringify(summary, null, 1));
