// GEN-953 task approval, realism: what the task approval would have removed on real past browser work.
// Pass 1 replays every real browser call (working copy, no task) and records each turn's asks per site.
// For each turn with 2+ non-first-visit asks on one site, a synthetic "Browser task:" list is built from
// that turn's own real summaries and single-line typed texts on that site (as if Claude had listed exactly
// what it then did; at most 20 steps / 10 texts). Pass 2 replays again with that list: the first card on
// the site that can carry the offer activates it (as if Erez allowed it), and later items are decided with
// the task in force (30-action limit; time not simulated). Reports asks before/after and checks that no
// waived item has a stop word or a serious typed text.
// Usage: node realism.js [days]   (default: all transcripts)
'use strict';
const fs = require('fs'), path = require('path');
const W = require('./wc/browser-site-gate.js');
const home = process.env.USERPROFILE;
const DAYS = process.argv[2] ? +process.argv[2] : 0;
const opts = { adminConsolesHighStakes: W.ADMIN_CONSOLES_HIGH_STAKES };
const T = 'mcp__claude-in-chrome__';

function itemsOf(c) {
  const n = W.shortName(c.tool);
  return n === 'browser_batch' ? ((c.input && c.input.actions) || []).map(a => ({ name: a && a.name, input: (a && a.input) || {} })) : [{ name: n, input: c.input || {} }];
}
function step(st, M, c, r) {
  M.countCall(st, r);
  const pend = r.decision === 'ask' && (r.hosts.length || (r.untainted || []).length) ? { hosts: r.hosts, unmark: r.untainted || [] } : null;
  M.applyDecision(st, r);
  if (r.decision !== 'deny') M.record(st, c.tool, c.input, c.result, pend ? pend.hosts : [], c.err, pend ? pend.unmark : []);
}

let before = 0, after = 0, nonSiteBefore = 0, tasks = 0, offered = 0, skippedFit = 0, waivedItems = 0, badWaived = 0, sessions = 0;
const seen = new Set();
const left = {}; // causes of the asks that remain with the task approval
let waivedKeys = 0; // (approximate) waived items that were key presses
const root = path.join(home, '.claude', 'projects');
for (const d of fs.readdirSync(root)) {
  const pd = path.join(root, d);
  let fl; try { fl = fs.readdirSync(pd).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of fl) {
    const fp = path.join(pd, f);
    if (DAYS && Date.now() - fs.statSync(fp).mtimeMs > DAYS * 864e5) continue;
    const raw = fs.readFileSync(fp, 'utf8');
    if (!/hrome__/.test(raw)) continue;
    const list = [], byId = {};
    let turn = 0;
    for (const line of raw.split('\n')) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.isSidechain) continue;
      const c = e.message && e.message.content;
      if (e.type === 'user' && (typeof c === 'string' || (Array.isArray(c) && !c.some(x => x && x.type === 'tool_result')))) turn++;
      if (!Array.isArray(c)) continue;
      for (const x of c) {
        if (x.type === 'tool_use' && W.PREFIX.test(x.name)) {
          // the same session in two files (a resumed copy) is counted once
          if (seen.has(x.id)) continue; seen.add(x.id);
          const o = { tool: x.name, input: x.input, result: '', err: false, turn }; list.push(o); byId[x.id] = o;
        } else if (x.type === 'tool_result' && byId[x.tool_use_id]) { byId[x.tool_use_id].result = W.responseText(x.content); byId[x.tool_use_id].err = !!x.is_error; }
      }
    }
    if (!list.length) continue;
    sessions++;
    // pass 1
    const s1 = W.newState();
    const perTurn = {}; // turn -> site -> { asks, steps:Set, texts:Set }
    for (const c of list) {
      const r = W.decide(s1, c.tool, c.input, Object.assign({ task: null }, opts));
      if (r.decision === 'ask') {
        before++;
        if (!r.causes.every(x => x === 'new-site')) nonSiteBefore++;
      }
      if (r.decision === 'ask' && !r.causes.every(x => x === 'new-site') && r.sites.length === 1 && r.sites[0] !== '?') {
        const site = r.sites[0];
        const g = ((perTurn[c.turn] = perTurn[c.turn] || {})[site] = perTurn[c.turn][site] || { asks: 0, steps: new Set(), texts: new Set() });
        g.asks++;
      }
      // every interactive summary and typed text on a known site in this turn (what Claude would list)
      for (const it of itemsOf(c)) {
        const inp = it.input || {}; const tab = s1.tabs[String(inp.tabId)]; const site = tab && W.hostOf(tab.url);
        if (!site || !(it.name === 'form_input' || (it.name === 'computer' && ['left_click', 'right_click', 'double_click', 'triple_click', 'type', 'key', 'left_click_drag'].includes(inp.action)))) continue;
        const g = ((perTurn[c.turn] = perTurn[c.turn] || {})[site] = perTurn[c.turn][site] || { asks: 0, steps: new Set(), texts: new Set() });
        if (typeof inp.action_summary === 'string' && inp.action_summary.trim() && inp.action_summary.length <= 160) g.steps.add(W.normStep(inp.action_summary));
        const typed = it.name === 'form_input' ? inp.value : (inp.action === 'type' ? inp.text : null);
        if (typeof typed === 'string' && typed && !/[\r\n]/.test(typed) && typed.length <= 2000) g.texts.add(typed);
      }
      step(s1, W, c, r);
    }
    // pass 2
    const s2 = W.newState();
    let curTurn = -1, tk = null;
    for (const c of list) {
      if (c.turn !== curTurn) {
        curTurn = c.turn; tk = null;
        const sites = perTurn[c.turn] || {};
        const best = Object.entries(sites).filter(([h, g]) => g.asks >= 2 && !W.isHigh(h, opts)).sort((a, b) => b[1].asks - a[1].asks)[0];
        if (best) {
          const rec = W.taskRecord('p' + c.turn, { value: { task: 'synthetic', site: best[0], steps: [...best[1].steps].slice(0, 20), texts: [...best[1].texts].slice(0, 10) } });
          if (rec.status === 'ready') { tk = rec; tasks++; }
        }
      }
      const active = tk && tk.status === 'active' && tk.used < W.TASK_MAX_ACTIONS ? tk : null;
      const r = W.decide(s2, c.tool, c.input, Object.assign({ task: active }, opts));
      if (r.decision === 'ask') {
        after++;
        const key = r.causes.slice().sort().join('+');
        left[key] = (left[key] || 0) + 1;
        const usable = tk ? tk.steps.filter(s => !W.taskStop(s)).length : 0;
        if (tk && tk.status === 'ready' && usable && r.sites.length && r.sites.every(s => s === tk.site)) {
          r.offerTask = { site: tk.site, steps: usable };
          if (W.offerFits(W.reasonFor(r), r)) { tk.status = 'active'; tk.used = 0; offered++; } else skippedFit++;
        }
      }
      if (active && r.decision !== 'deny' && r.taskWaived) {
        active.used += r.taskWaived; waivedItems += r.taskWaived;
        for (const it of itemsOf(c)) if (it.name === 'computer' && it.input && it.input.action === 'key' && typeof it.input.action_summary === 'string' && active.steps.includes(W.normStep(it.input.action_summary))) waivedKeys++;
        for (const p of r.passed.filter(p => p.task)) if (W.taskStop(p.words)) badWaived++;
      }
      step(s2, W, c, r);
    }
  }
}
console.log(JSON.stringify({ sessions, asksBefore: before, nonSiteBefore, asksAfter: after, removed: before - after,
  removedPct: Math.round(100 * (before - after) / before) + '%', removedOfNonSitePct: Math.round(100 * (before - after) / nonSiteBefore) + '%',
  syntheticTasks: tasks, offered, offerSkippedNoFit: skippedFit, waivedItems, waivedKeys, waivedWithStopWord: badWaived }));
console.log('remaining asks by cause: ' + Object.entries(left).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => v + ' ' + k).join(', '));
