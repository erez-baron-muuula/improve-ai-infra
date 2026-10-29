// Realism corpus for the snowflake-read.ps1 look-up filter: every SQL statement that Claude put
// into a browser page (Snowsight editor scripts, typed text) in session transcripts on this PC
// from the last 30 days, split on ';', de-duplicated, each labelled by the live browser gate's
// own write classifier (typedWrite). Writes statements only (no page text, no results).
'use strict';
const fs = require('fs'), path = require('path');
const home = process.env.USERPROFILE;
const G = require(path.join(home, '.claude', 'hooks', 'browser-site-gate.js'));
const DAYS = 30;
const root = path.join(home, '.claude', 'projects');
const SQLISH = /\b(select|show|desc|describe|with|explain|insert|update|delete|merge|create|alter|drop|grant|revoke|truncate|call|copy|use|undrop)\b/i;
const STARTS = /^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*(select|show|desc|describe|with|explain|insert|update|delete|merge|create|alter|drop|grant|revoke|truncate|call|copy|use|undrop|begin|execute|set|unset|list|ls|remove|put|get)\b/i;
const sqlIn = t => { const m = String(t).match(/`[^`]*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g) || []; return m.map(x => x.slice(1, -1).replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"')).filter(x => SQLISH.test(x) && /\s/.test(x)); };
const seen = new Map();
for (const d of fs.readdirSync(root)) {
  let fl; try { fl = fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of fl) {
    const fp = path.join(root, d, f);
    if (Date.now() - fs.statSync(fp).mtimeMs > DAYS * 864e5) continue;
    const raw = fs.readFileSync(fp, 'utf8');
    if (!/snowflake/i.test(raw) || !/hrome__/.test(raw)) continue;
    for (const line of raw.split('\n')) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      const c = e.message && e.message.content; if (!Array.isArray(c)) continue;
      for (const x of c) {
        if (x.type !== 'tool_use' || !G.PREFIX.test(x.name)) continue;
        const inp = x.input || {};
        const texts = [];
        if (inp.text && /javascript/i.test(inp.action || x.name)) texts.push(...sqlIn(inp.text));
        else if (inp.action === 'type' && inp.text) texts.push(inp.text);
        for (const a of (inp.actions || [])) { const ai = a.input || {}; if (ai.text) texts.push(...(/javascript/i.test(a.name) ? sqlIn(ai.text) : [ai.text])); }
        for (const t of texts) {
          for (const st of t.split(/;\s*(?:\n|$)/)) {
            const s = st.trim();
            if (s.length < 6 || !STARTS.test(s)) continue;
            if (!seen.has(s)) seen.set(s, { sql: s, gateWrite: !!G.typedWrite(s) });
          }
        }
      }
    }
  }
}
const out = 'C:/Users/Erez/AppData/Local/Temp/claude/C--Users-Erez-AI-Projects-Improve-AI-Infra/88d16f1c-a32f-4372-b5d7-a53fa190260a/scratchpad/sql-corpus.json';
fs.writeFileSync(out, JSON.stringify([...seen.values()]));
console.log('statements=' + seen.size + ' gateWrite=' + [...seen.values()].filter(v => v.gateWrite).length);
