// GEN-699 item 2 (E) measurement: how often does real traffic carry (a) a JSON-literal string under a
// TEXT field, the item's trigger, and (b) a JSON string under any OTHER key (a stringified parameter)?
//   node measure-e.js [corpus path]
// Run 2026-10-12 over 1,189 payloads: (a) 0; (b) {"Assignee":7,"data":4,"Parent item":6}.
const fs = require('fs'), os = require('os'), p = require('path');
const CORPUS = process.argv[2] || p.join(os.tmpdir(), 'gen508-notion-payload-corpus.jsonl');
const rows = fs.readFileSync(CORPUS, 'utf8').split(/\r?\n/).filter(x => x.trim()).map(l => JSON.parse(l));
const TEXT = new Set(['new_str', 'old_str', 'content', 'selection_with_ellipsis']);
const isJ = s => { const t = s.trim(); if (!t || (t[0] !== '{' && t[0] !== '[')) return false;
                   try { const v = JSON.parse(t); return !!v && typeof v === 'object'; } catch (e) { return false; } };
let hits = 0, g58 = 0; const strParams = {};
function walk(n, k, cb) {
  // A JSON string is reported AND walked into, so values inside an enveloped (`data`) payload are counted.
  if (typeof n === 'string') { if (isJ(n)) { cb(k, n); walk(JSON.parse(n.trim()), k, cb); } return; }
  if (Array.isArray(n)) { n.forEach(x => walk(x, k, cb)); return; }
  if (n && typeof n === 'object') for (const kk of Object.keys(n)) walk(n[kk], kk, cb);
}
for (const r of rows) {
  let t = false;
  walk(r.input, '', (k) => { if (TEXT.has(k)) t = true; else strParams[k] = (strParams[k] || 0) + 1; });
  if (t) { hits++; if (JSON.stringify(r.input).replace(/-/g, '').includes('36d6e495d07c816e9e0cce265d694ab3')) g58++; }
}
console.log('rows', rows.length, '| JSON-literal text values', hits, '(GEN-58 writes among them', g58 + ')');
console.log('JSON-string values under non-text keys:', JSON.stringify(strParams));
