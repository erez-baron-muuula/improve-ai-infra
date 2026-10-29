// GEN-953 task approval, regression: every real browser call in ~/.claude/projects transcripts, decided
// in-process by the live hook (saved as live-baseline.js) and by the working copy, step by step with
// separate state and no task approval (no past transcript holds a "Browser task:" block; counted below).
// Decisions, causes, card text and the state after each call must be identical, apart from the working
// copy's new fields (task, taskWaived, sites).
// Usage: node replay.js
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./live-baseline.js');
const W = require('./wc/browser-site-gate.js');
const home = process.env.USERPROFILE;
const opts = { adminConsolesHighStakes: L.ADMIN_CONSOLES_HIGH_STAKES };
const strip = r => { const o = Object.assign({}, r); delete o.taskWaived; delete o.sites; return JSON.stringify(o); };
const stripState = s => { const o = JSON.parse(JSON.stringify(s)); delete o.task; return JSON.stringify(o); };

let files = 0, calls = 0, asks = 0, decisionDiff = 0, stateDiff = 0, textDiff = 0, blocks = 0;
const root = path.join(home, '.claude', 'projects');
for (const d of fs.readdirSync(root)) {
  const pd = path.join(root, d);
  let fl; try { fl = fs.readdirSync(pd).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of fl) {
    const fp = path.join(pd, f);
    const raw = fs.readFileSync(fp, 'utf8');
    // (this session's own transcript quotes the format while building it)
    if (/^\s*Browser task:/m.test(raw.replace(/\\n/g, '\n')) && !f.startsWith('440acfd3')) blocks++;
    if (!/hrome__/.test(raw)) continue;
    const list = [], byId = {};
    for (const line of raw.split('\n')) {
      if (!line.includes('hrome') && !line.includes('tool_result')) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.isSidechain) continue;
      const c = e.message && e.message.content; if (!Array.isArray(c)) continue;
      for (const x of c) {
        if (x.type === 'tool_use' && L.PREFIX.test(x.name)) { const o = { tool: x.name, input: x.input, result: '', err: false }; list.push(o); byId[x.id] = o; }
        else if (x.type === 'tool_result' && byId[x.tool_use_id]) { byId[x.tool_use_id].result = L.responseText(x.content); byId[x.tool_use_id].err = !!x.is_error; }
      }
    }
    if (!list.length) continue;
    files++;
    const sl = L.newState(), sw = W.newState();
    for (const c of list) {
      calls++;
      const rl = L.decide(sl, c.tool, c.input, opts), rw = W.decide(sw, c.tool, c.input, Object.assign({ task: null }, opts));
      if (strip(rl) !== strip(rw)) { decisionDiff++; if (decisionDiff <= 5) console.log('DECISION DIFF', f, c.tool, strip(rl).slice(0, 200), '|', strip(rw).slice(0, 200)); }
      if (rl.decision === 'ask') {
        asks++;
        if (L.reasonFor(rl) !== W.reasonFor(rw)) { textDiff++; if (textDiff <= 3) console.log('TEXT DIFF', L.reasonFor(rl).slice(0, 150), '|', W.reasonFor(rw).slice(0, 150)); }
      }
      for (const [M, st, r] of [[L, sl, rl], [W, sw, rw]]) {
        M.countCall(st, r);
        const pend = r.decision === 'ask' && (r.hosts.length || (r.untainted || []).length) ? { hosts: r.hosts, unmark: r.untainted || [] } : null;
        M.applyDecision(st, r);
        if (r.decision !== 'deny') M.record(st, c.tool, c.input, c.result, pend ? pend.hosts : [], c.err, pend ? pend.unmark : []);
      }
      if (stripState(sl) !== stripState(sw)) { stateDiff++; if (stateDiff <= 3) console.log('STATE DIFF', f); }
    }
  }
}
console.log(JSON.stringify({ files, calls, asks, decisionDiff, stateDiff, textDiff, transcriptsWithBlock: blocks }));
