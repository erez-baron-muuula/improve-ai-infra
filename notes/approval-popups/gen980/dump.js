// GEN-980: dump the full text of every ask on the two candidates (Tableau session-API reads, Snowsight
// query runs) in the last N days, with the calls before each Snowsight run on that tab, so the allowlist
// can be built from the real shapes. Writes dump-tableau.txt and dump-snow.txt next to this file.
// Usage: node dump.js [days]
'use strict';
const fs = require('fs'), path = require('path');
const home = process.env.USERPROFILE;
const G = require(path.join(home, '.claude', 'hooks', 'browser-site-gate.js'));
const DAYS = +(process.argv[2] || 14);
const opts = { adminConsolesHighStakes: G.ADMIN_CONSOLES_HIGH_STAKES };
const tab = [], snow = [], seen = new Set();
const root = path.join(home, '.claude', 'projects');
const itemsOf = c => G.shortName(c.tool) === 'browser_batch' ? (c.input.actions || []).map(a => ({ name: a.name, input: a.input || {} })) : [{ name: G.shortName(c.tool), input: c.input || {} }];
for (const d of fs.readdirSync(root)) {
  let fl; try { fl = fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of fl) {
    const fp = path.join(root, d, f);
    if (Date.now() - fs.statSync(fp).mtimeMs > DAYS * 864e5) continue;
    const raw = fs.readFileSync(fp, 'utf8');
    if (!/hrome__/.test(raw)) continue;
    const list = [], byId = {};
    for (const line of raw.split('\n')) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.isSidechain) continue;
      const c = e.message && e.message.content; if (!Array.isArray(c)) continue;
      for (const x of c) {
        if (x.type === 'tool_use' && G.PREFIX.test(x.name)) { if (seen.has(x.id)) continue; seen.add(x.id); const o = { tool: x.name, input: x.input, result: '', err: false }; list.push(o); byId[x.id] = o; }
        else if (x.type === 'tool_result' && byId[x.tool_use_id]) { byId[x.tool_use_id].result = G.responseText(x.content); byId[x.tool_use_id].err = !!x.is_error; }
      }
    }
    const st = G.newState();
    const hist = {}; // tabId -> recent items
    list.forEach((c, i) => {
      const r = G.decide(st, c.tool, c.input, opts);
      const items = itemsOf(c);
      const hostOfTab = id => { const t = st.tabs[String(id)]; return t ? G.hostOf(t.url) : '?'; };
      if (r.decision === 'ask') {
        for (const it of items) {
          const h = hostOfTab(it.input.tabId);
          const t = String(it.input.text || '');
          if (it.name === 'javascript_tool' && (/vizportal|__vz\b/.test(t))) tab.push('### ' + f.slice(0, 8) + ' #' + i + ' host=' + h + ' causes=' + r.causes.join(',') + '\n' + t + '\n');
          const sum = String(it.input.action_summary || '');
          const isRun = /snowflake/.test(h || '') && it.name === 'computer' && (/\brun/i.test(sum) || (it.input.action === 'key' && /enter|return/i.test(String(it.input.text || ''))));
          if (isRun) {
            const prior = (hist[it.input.tabId] || []).slice(-4).map(p => '   prev: ' + p).join('\n');
            snow.push('### ' + f.slice(0, 8) + ' #' + i + ' host=' + h + ' causes=' + r.causes.join(',') + ' action=' + it.input.action + ' key=' + (it.input.text || '') + '\n   SUM: ' + sum + '\n' + prior + '\n');
          }
        }
      }
      for (const it of items) {
        const k = it.input.tabId; if (k == null) continue;
        const desc = it.name + (it.input.action ? ':' + it.input.action : '') + ' [' + (r.decision) + '] ' + (it.name === 'javascript_tool' ? String(it.input.text || '').replace(/\s+/g, ' ').slice(0, 300) : String(it.input.action_summary || it.input.text || it.input.url || '').slice(0, 120));
        (hist[k] = hist[k] || []).push(desc);
      }
      G.countCall(st, r);
      const pend = r.decision === 'ask' && (r.hosts.length || (r.untainted || []).length) ? { hosts: r.hosts, unmark: r.untainted || [] } : null;
      G.applyDecision(st, r);
      if (r.decision !== 'deny') G.record(st, c.tool, c.input, c.result, pend ? pend.hosts : [], c.err, pend ? pend.unmark : []);
    });
  }
}
fs.writeFileSync(path.join(__dirname, 'dump-tableau.txt'), tab.join('\n'));
fs.writeFileSync(path.join(__dirname, 'dump-snow.txt'), snow.join('\n'));
console.log(JSON.stringify({ tableauAsks: tab.length, snowRunAsks: snow.length }));
