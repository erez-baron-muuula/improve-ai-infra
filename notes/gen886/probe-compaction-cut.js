// probe-compaction-cut.js (GEN-886) -- READ-ONLY. Measures where Claude Code cuts a skill's
// text when it re-attaches the skill after a compaction, from this PC's own session logs.
//
// Why: the skills doc says compaction keeps "the first 5,000 tokens" of each skill but not how
// tokens are counted. The logs show the real rule. Each truncated record ends with the marker
// below; this script reports how long those records are (kept text + marker), per Claude Code
// version, so the size check's numbers (notes/anthropic-guidelines.json, counting.charsPerToken)
// can be re-checked when Claude Code changes.
//
// It prints lengths, skill names, versions and dates only -- never any log content.
// Exit code: 0 = found truncated records; 1 = found none (INCONCLUSIVE: the marker may have been
// reworded or the logs that held samples deleted -- it does NOT mean there is no cut); 2 = error.
//
//   node "C:\Users\Erez\AI Projects\Improve AI Infra\notes\gen886\probe-compaction-cut.js"

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'projects');
const MARK = '[... skill content truncated for compaction';
const HEADER = 'Base directory for this skill: ';

function walkStrings(v, cb) {
  if (typeof v === 'string') { cb(v); return; }
  if (Array.isArray(v)) { for (const x of v) walkStrings(x, cb); return; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) walkStrings(v[k], cb); }
}

async function scanFile(file, results) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('truncated for compaction')) continue;
    let obj;
    try { obj = JSON.parse(line); } catch (e) { continue; }
    walkStrings(obj, s => {
      // Only a single skill's own attachment: it starts with the header and holds the marker.
      if (!s.startsWith(HEADER)) return;
      const at = s.indexOf(MARK);
      if (at < 0) return;
      const folder = s.slice(HEADER.length, s.indexOf('\n'));
      results.push({
        skill: folder.replace(/.*[\\/]/, ''),
        total: s.length,
        kept: at,
        version: typeof obj.version === 'string' ? obj.version : '?',
        date: typeof obj.timestamp === 'string' ? obj.timestamp.slice(0, 10) : '?',
      });
    });
  }
}

(async () => {
  if (!fs.existsSync(root)) { console.error('no projects folder: ' + root); process.exit(2); }
  const results = [];
  for (const d of fs.readdirSync(root)) {
    const dir = path.join(root, d);
    let names = [];
    try { if (!fs.statSync(dir).isDirectory()) continue; names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      try { await scanFile(path.join(dir, n), results); } catch (e) { /* unreadable log: skip */ }
    }
  }
  if (results.length === 0) {
    console.log('INCONCLUSIVE: no truncated skill record found (marker reworded, or no samples left on disk).');
    process.exit(1);
  }
  const byTotal = {};
  for (const r of results) {
    const k = String(r.total);
    byTotal[k] = byTotal[k] || { records: 0, versions: new Set(), skills: new Set(), newest: '' };
    byTotal[k].records++;
    byTotal[k].versions.add(r.version);
    byTotal[k].skills.add(r.skill);
    if (r.date > byTotal[k].newest) byTotal[k].newest = r.date;
  }
  console.log('Truncated skill records: ' + results.length);
  for (const [len, v] of Object.entries(byTotal).sort((a, b) => b[1].records - a[1].records)) {
    console.log('  total length ' + len + ' (UTF-16 units, kept text + marker): ' + v.records + ' records; versions ' +
      [...v.versions].sort().join(', ') + '; skills ' + [...v.skills].sort().join(', ') + '; newest ' + v.newest);
  }
  process.exit(0);
})().catch(e => { console.error('error: ' + e.message); process.exit(2); });
