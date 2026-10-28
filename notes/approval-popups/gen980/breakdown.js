// GEN-980: what makes the live browser gate ask for page scripts and follow-ups. Replays the live hook over
// the last N days of transcripts; for each risky-script ask, names which RISKY_SCRIPT alternatives the script
// matches; for each follow-up ask, shows the summary that set the mark and the one that asked.
// Usage: node breakdown.js [days]
'use strict';
const fs = require('fs'), path = require('path');
const home = process.env.USERPROFILE;
const G = require(path.join(home, '.claude', 'hooks', 'browser-site-gate.js'));
const DAYS = +(process.argv[2] || 14);
const opts = { adminConsolesHighStakes: G.ADMIN_CONSOLES_HIGH_STAKES };
const ALTS = G.RISKY_SCRIPT.source.split('|');
const pat = {}, follow = [], seen = new Set();
const cand = { tableauRead: 0, snowsightFill: 0, domRead: 0, otherScript: 0, followLook: 0 };
const root = path.join(home, '.claude', 'projects');
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
    let lastSum = '';
    for (const c of list) {
      const r = G.decide(st, c.tool, c.input, opts);
      const items = G.shortName(c.tool) === 'browser_batch' ? (c.input.actions || []).map(a => ({ name: a.name, input: a.input || {} })) : [{ name: G.shortName(c.tool), input: c.input || {} }];
      if (r.decision === 'ask' && r.causes.includes('risky-script')) {
        for (const it of items) if (it.name === 'javascript_tool') {
          const t = String(it.input.text || '');
          const hit = ALTS.filter(a => { try { return new RegExp(a).test(t); } catch (e) { return false; } });
          const key = hit.slice(0, 3).join('  ||  ').slice(0, 120) || '(none?)';
          if (/fetch\s*\(\s*['"`]\/vizportal\/api\/web\/v1\//.test(t) || /__vz\s*\(\s*['"`]get/.test(t) || /window\.__vz\s*=/.test(t)) cand.tableauRead++;
          else if (/cmView\.view/.test(t) && /dispatch\s*\(\s*\{\s*changes/.test(t)) cand.snowsightFill++;
          else if (/innerText|textContent|gridcell/.test(t) && !/fetch|\.click|dispatch|location|open\s*\(|postMessage/.test(t)) cand.domRead++;
          else cand.otherScript++;
          (pat[key] = pat[key] || []).push(t.replace(/\s+/g, ' ').slice(0, 110));
        }
      }
      if (r.decision === 'ask' && r.causes.includes('follow-up')) {
        const s = items.map(it => it.input && it.input.action_summary).filter(Boolean).join(' / ');
        follow.push('after «' + lastSum.slice(0, 70) + '» → «' + s.slice(0, 70) + '»');
        if (r.causes.every(x => x === 'follow-up' || x === 'word') && items.every(it => !it.input.action_summary || (G.harmless(it.input.action_summary) && !G.wordHit(it.input.action_summary)))) cand.followLook++;
      }
      for (const it of items) if (it.input && it.input.action_summary) lastSum = it.input.action_summary;
      G.countCall(st, r);
      const pend = r.decision === 'ask' && (r.hosts.length || (r.untainted || []).length) ? { hosts: r.hosts, unmark: r.untainted || [] } : null;
      G.applyDecision(st, r);
      if (r.decision !== 'deny') G.record(st, c.tool, c.input, c.result, pend ? pend.hosts : [], c.err, pend ? pend.unmark : []);
    }
  }
}
const out = [];
out.push('RISKY-SCRIPT asks by matched pattern (top 3 alternatives):');
for (const [k, v] of Object.entries(pat).sort((a, b) => b[1].length - a[1].length)) { out.push(v.length + '  ' + k); for (const s of v.slice(0, 2)) out.push('      e.g. ' + s); }
out.push('', 'FOLLOW-UP asks (' + follow.length + '):');
for (const s of follow) out.push('  ' + s);
fs.writeFileSync(path.join(__dirname, 'breakdown.txt'), out.join('\n'));
console.log(JSON.stringify(cand));
