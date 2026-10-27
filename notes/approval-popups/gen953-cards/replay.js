// GEN-953 step 2 regression: every real browser call in ~/.claude/projects transcripts, decided in-process
// by the live hook and by the working copy, step by step with separate state. The decision fields and the
// state after each call must be identical; only the pop-up text may differ. Writes cards.txt (old vs new
// pop-up text for every ask) and prints counts.
// Usage: node replay.js
'use strict';
const fs = require('fs'), path = require('path');
// The reference is the pre-GEN-953 hook (saved as live-baseline.js), so decisions are compared with the
// original, and OLD is the wording before GEN-953.
const L = require('./live-baseline.js');
const W = require('./wc/browser-site-gate.js');
const { cardOk } = require('./cardcheck.js');
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

let files = 0, calls = 0, asks = 0, denies = 0, decisionDiff = 0, stateDiff = 0, textErr = 0, sameText = 0, wordingFail = 0;
const oldLen = [], newLen = [];
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
      // Every sentence is from the committed wording, each cause's opening sentence is there, Claude's part is last.
      if (!cardOk(rw, newT)) { wordingFail++; if (wordingFail <= 5) console.log('WORDING', newT.slice(0, 400)); }
      oldLen.push(oldT.length); newLen.push(newT.length);
      const key = rl.causes.join('+');
      byCause[key] = (byCause[key] || 0) + 1;
      out.push('[' + key + '] ' + path.basename(fp).slice(0, 8) + ' ' + L.shortName(c.tool) + '\n  OLD: ' + oldT + '\n  NEW: ' + newT + '\n  LEN: ' + oldT.length + ' -> ' + newT.length + '\n');
    }
  }
}
fs.writeFileSync(path.join(__dirname, 'cards.txt'), out.join('\n'));
console.log(JSON.stringify({ files, calls, asks, denies, decisionDiff, stateDiff, textErr, sameText, wordingFail }, null, 0));
const stats = a => { const s = a.slice().sort((x, y) => x - y); return 'median ' + s[Math.floor(s.length / 2)] + ', p90 ' + s[Math.floor(s.length * 0.9)] + ', max ' + s[s.length - 1]; };
console.log('length old: ' + stats(oldLen) + ' | new: ' + stats(newLen));
// What fits the pop-up's visible ~3 lines (about 65 characters a line, seen on Erez's screen 2026-10-26).
const checkPart = out.map(o => (/\n  NEW: (.*)\n/.exec(o) || [, ''])[1]).map(t => { const i = t.indexOf(' Claude says (unverified): "'); return i < 0 ? t : t.slice(0, i); });
const warnPart = checkPart.map(t => { const i = t.indexOf(' Undo not guaranteed'); return i < 0 ? t : t.slice(0, i); });
const pct = (a, n) => Math.round(100 * a.filter(x => x.length <= n).length / a.length) + '%';
console.log("check's own words: " + stats(checkPart.map(t => t.length)) + '; within 195 chars: ' + pct(checkPart, 195));
console.log('warning before the undo line: ' + stats(warnPart.map(t => t.length)) + '; within 130 chars: ' + pct(warnPart, 130));
console.log("check's own words within 130 / 160 chars: " + pct(checkPart, 130) + ' / ' + pct(checkPart, 160));
// Simulated word wrap at 63 characters a line (line 1 of Erez's screenshot held 63), lines numbered from 1.
const lineOf = (text, at) => { let line = 1, len = 0, pos = 0; for (const w of text.split(' ')) { const need = len ? len + 1 + w.length : w.length; if (len && need > 63) { line++; len = w.length; } else len = need; if (pos + w.length > at) return line; pos += w.length + 1; } return line; };
// (Claude's part is blanked, keeping its length, before searching for the site or the undo note, so its
// words cannot be counted as either.)
const cardsNew = out.map(o => (/\n  NEW: (.*)\n/.exec(o) || [, ''])[1]);
const blankClaude = t => t.replace(/Claude says \(unverified\): "[^"]*"(; "[^"]*")*( and \d+ more)?\./, m => 'Claude says (unverified): ' + m.slice(26).replace(/\S/g, 'x'));
const vis = (filter, mark, offset) => { const c = cardsNew.filter(filter); const ok = n => c.filter(t => { const i = t.indexOf(mark); return i >= 0 && lineOf(t, i + offset) <= n; }).length; return c.length + ' cards: ' + Math.round(100 * ok(3) / c.length) + '% by line 3, ' + Math.round(100 * ok(2) / c.length) + '% by line 2'; };
const visAt = (filter, find) => { const c = cardsNew.filter(filter); const ok = n => c.filter(t => { const i = find(t); return i >= 0 && lineOf(t, i) <= n; }).length; return c.length + ' cards: ' + Math.round(100 * ok(3) / c.length) + '% by line 3, ' + Math.round(100 * ok(2) / c.length) + '% by line 2'; };
// the 20th character of Claude's first quoted description
console.log("cards with Claude's words, their first 20 characters visible: " + visAt(t => t.includes('Claude says (unverified): "'), t => { const i = t.indexOf('Claude says (unverified): "'); return i < 0 ? -1 : i + 27 + 19; }));
// the end of the site name on the Site line, or in a sentence naming it
console.log('cards naming a site, the site visible: ' + visAt(t => /^(On|Last seen on) [a-z0-9.…-]+|(^|\. )(Last seen on|Sites in this request:|Also on) [a-z0-9.…-]+| on [a-z0-9.-]+\.[a-z]{2,}|site \([a-z0-9.-]+\)/.test(blankClaude(t)), t => { const m = /^(On|Last seen on) [a-z0-9.…-]+|(^|\. )(Last seen on|Sites in this request:|Also on) [a-z0-9.…-]+| on [a-z0-9.-]+\.[a-z]{2,}|site \([a-z0-9.-]+\)/.exec(blankClaude(t)); return m ? m.index + m[0].length - 1 : -1; }));
console.log('all cards, end of the first sentence visible: ' + visAt(t => true, t => { const i = blankClaude(t).search(/\.( |$)/); return i; }));
console.log('change cards, undo note visible: ' + visAt(t => t.includes('Undo not guaranteed'), t => { const i = blankClaude(t).indexOf('Undo not guaranteed'); return i < 0 ? -1 : i + 19; }));
console.log(Object.entries(byCause).sort((a, b) => b[1] - a[1]).map(([k, v]) => v + ' ' + k).join('\n'));
