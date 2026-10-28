// GEN-980 step 2 (Erez, 2026-10-28: "Park + measure"): where do the pop-ups come from, per pop-up (asking call)?
// Replays the LIVE gate over every transcript on this PC (like dump.js) and, for each asking call:
//  - Snowflake: is it a data read a read-only login could take over? The query is the SQL in the script, the
//    typed text, or (for a run click / Enter) the last query text that went into that tab;
//  - "word" asks (a summary that is not a plain look): does the summary name a danger word, or is it only not
//    on the harmless list? Counted by first verb.
// Writes measure2-out.json and measure2-word-samples.txt (Claude's own action summaries, no page text).
// Usage: node measure2.js [days]
'use strict';
const fs = require('fs'), path = require('path');
const home = process.env.USERPROFILE;
const G = require(path.join(home, '.claude', 'hooks', 'browser-site-gate.js'));
const DAYS = +(process.argv[2] || 14);
const opts = { adminConsolesHighStakes: G.ADMIN_CONSOLES_HIGH_STAKES };
const root = path.join(home, '.claude', 'projects');
const itemsOf = c => G.shortName(c.tool) === 'browser_batch' ? (c.input.actions || []).map(a => ({ name: a.name, input: a.input || {} })) : [{ name: G.shortName(c.tool), input: c.input || {} }];
const SQLISH = /\b(select|show|desc|describe|with|explain|list|insert|update|delete|merge|create|alter|drop|grant|revoke|truncate|call|copy|use)\b/i;
const READ = /^\s*(select|show|desc|describe|with|explain|list|ls|use)\b/i;
// The SQL a script fills into the editor, or the script itself: string literals that look like SQL.
const sqlIn = t => { const m = String(t).match(/`[^`]*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g) || []; const s = m.map(x => x.slice(1, -1)).filter(x => SQLISH.test(x) && /\s/.test(x)); return s.length ? s.join(';\n') : ''; };
const kindOf = sql => { if (!sql) return 'no-query-known'; if (G.typedWrite(sql)) return 'write'; const st = sql.split(/;\s*/).filter(x => x.trim()); return st.length && st.every(x => READ.test(x)) ? 'read' : 'other-sql'; };
const inc = (o, k, n) => { o[k] = (o[k] || 0) + (n || 1); };
const out = { days: DAYS, files: 0, calls: 0, asks: 0, bySite: {}, snowflake: { asks: 0, byKind: {}, byCause: {}, byTool: {} }, word: { asks: 0, wordOnly: 0, dangerWord: 0, notPlainOnly: 0, bySite: {}, byVerb: {} } };
const samples = [];
const seen = new Set();
for (const d of fs.readdirSync(root)) {
  let fl; try { fl = fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of fl) {
    const fp = path.join(root, d, f);
    if (Date.now() - fs.statSync(fp).mtimeMs > DAYS * 864e5) continue;
    const raw = fs.readFileSync(fp, 'utf8');
    if (!/hrome__/.test(raw)) continue;
    out.files++;
    const list = [], byId = {};
    for (const line of raw.split('\n')) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.isSidechain) continue;
      const c = e.message && e.message.content; if (!Array.isArray(c)) continue;
      for (const x of c) {
        if (x.type === 'tool_use' && G.PREFIX.test(x.name)) { if (seen.has(x.id)) continue; seen.add(x.id); const o = { tool: x.name, input: x.input || {}, result: '', err: false }; list.push(o); byId[x.id] = o; }
        else if (x.type === 'tool_result' && byId[x.tool_use_id]) { byId[x.tool_use_id].result = G.responseText(x.content); byId[x.tool_use_id].err = !!x.is_error; }
      }
    }
    const st = G.newState();
    const lastSql = {}; // tabId -> last query text that went into that tab
    list.forEach(c => {
      out.calls++;
      const r = G.decide(st, c.tool, c.input, opts);
      const items = itemsOf(c);
      const hostOf = it => it.name === 'navigate' ? G.hostOf(String(it.input.url || '')) : (st.tabs[String(it.input.tabId)] ? G.hostOf(st.tabs[String(it.input.tabId)].url) : null);
      const hosts = [...new Set(items.map(hostOf).filter(Boolean))];
      const site = h => /snowflake/.test(h) ? 'snowflake' : /tableau\.com$/.test(h) ? 'tableau' : h;
      if (r.decision === 'ask') {
        out.asks++;
        const sites = [...new Set(hosts.map(site))];
        inc(out.bySite, sites.length ? sites.sort().join('+') : '(no site known)');
        if (sites.includes('snowflake')) {
          const S = out.snowflake; S.asks++;
          for (const cz of new Set(r.causes.map(x => String(x).split(':')[0]))) inc(S.byCause, cz);
          // the query this call runs or fills: script SQL, typed text, else the tab's last query
          let sql = '';
          for (const it of items) {
            if (it.name === 'javascript_tool') sql = sqlIn(it.input.text) || sql;
            else if (it.name === 'computer' && it.input.action === 'type' && SQLISH.test(String(it.input.text || ''))) sql = String(it.input.text);
          }
          const runOnly = !sql;
          if (runOnly) for (const it of items) if (lastSql[it.input.tabId]) sql = lastSql[it.input.tabId];
          const uiOnly = runOnly && items.every(it => it.name === 'navigate' || (it.name === 'computer' && !(it.input.action === 'key' && /enter|return/i.test(String(it.input.text || ''))) && !/\brun\b/i.test(String(it.input.action_summary || ''))));
          inc(S.byKind, uiOnly ? 'ui (navigate or click, no query run)' : kindOf(sql));
          inc(S.byTool, items.map(it => it.name + (it.input.action ? ':' + it.input.action : '')).sort().join('+').slice(0, 80));
        }
        if (r.causes.includes('word')) {
          const W = out.word; W.asks++;
          if (r.causes.every(x => x === 'word')) W.wordOnly++;
          for (const sx of sites.length ? sites : ['(no site known)']) inc(W.bySite, sx);
          let danger = false;
          for (const it of items) {
            const sum = String(it.input.action_summary || ''); if (!sum) continue;
            if (G.wordHit(sum)) danger = true;
            inc(W.byVerb, (sum.trim().split(/\s+/)[0] || '?').toLowerCase());
            if (samples.length < 400) samples.push((G.wordHit(sum) ? 'DANGER ' : 'notplain ') + (sites.join('+') || '?') + ' | ' + sum.replace(/\s+/g, ' ').slice(0, 110));
          }
          if (danger) W.dangerWord++; else W.notPlainOnly++;
        }
      }
      for (const it of items) {
        if (it.input.tabId == null) continue;
        if (it.name === 'javascript_tool') { const q = sqlIn(it.input.text); if (q) lastSql[it.input.tabId] = q; }
        if (it.name === 'computer' && it.input.action === 'type' && SQLISH.test(String(it.input.text || ''))) lastSql[it.input.tabId] = String(it.input.text);
      }
      G.countCall(st, r);
      const pend = r.decision === 'ask' && (r.hosts.length || (r.untainted || []).length) ? { hosts: r.hosts, unmark: r.untainted || [] } : null;
      G.applyDecision(st, r);
      if (r.decision !== 'deny') G.record(st, c.tool, c.input, c.result, pend ? pend.hosts : [], c.err, pend ? pend.unmark : []);
    });
  }
}
const sortObj = o => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
out.bySite = sortObj(out.bySite);
for (const k of ['byKind', 'byCause', 'byTool']) out.snowflake[k] = sortObj(out.snowflake[k]);
out.word.bySite = sortObj(out.word.bySite); out.word.byVerb = Object.fromEntries(Object.entries(sortObj(out.word.byVerb)).slice(0, 25));
fs.writeFileSync(path.join(__dirname, 'measure2-out.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(__dirname, 'measure2-word-samples.txt'), samples.join('\n'));
console.log(JSON.stringify(out, null, 1));
