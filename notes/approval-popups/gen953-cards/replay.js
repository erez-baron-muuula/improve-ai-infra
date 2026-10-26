// GEN-953 step 2 regression: every real browser call in ~/.claude/projects transcripts, decided in-process
// by the live hook and by the working copy, step by step with separate state. The decision fields and the
// state after each call must be identical; only the pop-up text may differ. Writes cards.txt (old vs new
// pop-up text for every ask) and prints counts.
// Usage: node replay.js
'use strict';
const fs = require('fs'), path = require('path');
const L = require(path.join(process.env.USERPROFILE, '.claude', 'hooks', 'browser-site-gate.js'));
const W = require('./wc/browser-site-gate.js');
const home = process.env.USERPROFILE;
const opts = { adminConsolesHighStakes: L.ADMIN_CONSOLES_HIGH_STAKES };
const NEW_FIELDS = ['texts', 'claims', 'where'];
const strip = r => { const o = Object.assign({}, r); for (const k of NEW_FIELDS) delete o[k]; return JSON.stringify(o); };

function* transcripts() {
  const root = path.join(home, '.claude', 'projects');
  for (const d of fs.readdirSync(root)) {
    const pd = path.join(root, d);
    if (!fs.statSync(pd).isDirectory()) continue;
    for (const f of fs.readdirSync(pd)) if (f.endsWith('.jsonl')) yield path.join(pd, f);
  }
}

let files = 0, calls = 0, asks = 0, denies = 0, decisionDiff = 0, stateDiff = 0, textErr = 0, sameText = 0;
const byCause = {};
const out = [];
for (const fp of transcripts()) {
  const raw = fs.readFileSync(fp, 'utf8');
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
    const rl = L.decide(sl, c.tool, c.input, opts), rw = W.decide(sw, c.tool, c.input, opts);
    if (strip(rl) !== strip(rw)) { decisionDiff++; if (decisionDiff <= 5) console.log('DECISION DIFF', path.basename(fp), c.tool, strip(rl).slice(0, 200), '|', strip(rw).slice(0, 200)); }
    for (const [M, st, r] of [[L, sl, rl], [W, sw, rw]]) {
      M.countCall(st, r);
      const pend = r.decision === 'ask' && (r.hosts.length || (r.untainted || []).length) ? { hosts: r.hosts, unmark: r.untainted || [] } : null;
      M.applyDecision(st, r);
      if (r.decision !== 'deny') M.record(st, c.tool, c.input, c.result, pend ? pend.hosts : [], c.err, pend ? pend.unmark : []);
    }
    if (JSON.stringify(sl) !== JSON.stringify(sw)) { stateDiff++; if (stateDiff <= 3) console.log('STATE DIFF', path.basename(fp)); }
    if (rl.decision === 'deny') denies++;
    if (rl.decision === 'ask') {
      asks++;
      let oldT, newT;
      try { oldT = L.reasonFor(rl); newT = W.plainReason(rw); } catch (e) { textErr++; console.log('TEXT ERROR', e.message); continue; }
      if (oldT === newT) sameText++;
      const key = rl.causes.join('+');
      byCause[key] = (byCause[key] || 0) + 1;
      out.push('[' + key + '] ' + path.basename(fp).slice(0, 8) + ' ' + L.shortName(c.tool) + '\n  OLD: ' + oldT + '\n  NEW: ' + newT + '\n  LEN: ' + oldT.length + ' -> ' + newT.length + '\n');
    }
  }
}
fs.writeFileSync(path.join(__dirname, 'cards.txt'), out.join('\n'));
console.log(JSON.stringify({ files, calls, asks, denies, decisionDiff, stateDiff, textErr, sameText }, null, 0));
console.log(Object.entries(byCause).sort((a, b) => b[1] - a[1]).map(([k, v]) => v + ' ' + k).join('\n'));
