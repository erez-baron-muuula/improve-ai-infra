// Pass 2: classify block-opener FORMS and re-classify missing/duplicates.
const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/Erez/.claude/projects';
const CUTOFF = new Date('2026-07-19T00:00:00Z');
const LOOSE = /\u{1F4CC}\s*\*{0,2}\s*For you/u;
// Guard's own opener (verbatim from stop-claim-linter.js)
const GUARD_OPENER = /^[ \t]{0,3}\*{0,2}\u{1F4CC}[ \t]*\*{0,2}[ \t]*For you/imu;
// Broad "this message opens a For-you block" test: a line that starts (after
// optional ---, #, *, whitespace) with one or more pins and reaches "For you",
// OR a line starting with pin(s) + bold text (the "📌 **You ran ...**" variant).
const BROAD_OPENER = /^[ \t>*#-]{0,6}(?:\u{1F4CC}[ \t]*){1,3}\*{0,2}[^\n]{0,40}$|^[ \t>*#-]{0,6}(?:\u{1F4CC}[ \t]*){1,3}\*{0,2}[ \t]*For you/imu;
const PIN_LINE = /^[ \t]{0,4}(?:#{1,4}[ \t]*)?(?:\*{0,2})(?:\u{1F4CC}[ \t]*)+\*{0,2}[ \t]*(For you|You )/imu;
const stripFences = t => t.replace(/```[\s\S]*?(?:```|$)/g, '');

let files = [];
for (const r of fs.readdirSync(ROOT)) {
  const rp = path.join(ROOT, r);
  if (!fs.statSync(rp).isDirectory()) continue;
  for (const f of fs.readdirSync(rp)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(rp, f);
    if (fs.statSync(p).mtime > CUTOFF) files.push(p);
  }
}
function textOf(o) {
  const c = o.message && o.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => (x.type === 'text' ? x.text : '')).join('\n');
  return '';
}
function isTR(o) { const c = o.message && o.message.content; return Array.isArray(c) && c.some(x => x.type === 'tool_result'); }
function isRealPrompt(o) {
  if (o.type !== 'user' || o.isMeta || isTR(o)) return false;
  const t = textOf(o); if (!t) return false;
  return !t.startsWith('<local-command-stdout>') && t.trim() !== '[Request interrupted by user]';
}

// Collect every assistant message whose FIRST-COLUMN pin line looks like a block opener,
// and record which form it used.
const forms = {};
const openerMsgs = [];
const seen = new Set();
for (const p of files) {
  const entries = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  let turnTs = null, turnKey = null;
  for (const o of entries) {
    if (isRealPrompt(o)) { turnTs = o.timestamp; turnKey = p + '|' + o.timestamp; continue; }
    if (o.type !== 'assistant') continue;
    const raw = textOf(o); if (!raw) continue;
    const t = stripFences(raw);
    if (!LOOSE.test(t)) continue;
    // find candidate opener lines
    const lines = t.split('\n');
    let form = null;
    for (const ln of lines) {
      if (!/\u{1F4CC}/u.test(ln)) continue;
      const s = ln.trim();
      // must be a short header-ish line ending the pin+"For you" phrase
      if (!/^(?:#{1,4}[ \t]*)?(?:\*{0,2})[ \t]*(?:\u{1F4CC}[ \t]*)+/u.test(s)) continue;
      if (!/For you/i.test(s) && !/^(?:#{1,4}\s*)?\*{0,2}(?:\u{1F4CC}\s*)+\*{0,2}[A-Z]/u.test(s)) continue;
      if (s.length > 160) continue;
      const pins = (s.match(/\u{1F4CC}/gu) || []).length;
      const heading = /^#{1,4}/.test(s);
      const bold = /\*\*/.test(s);
      const hasForYou = /For you/i.test(s);
      form = (heading ? 'heading' : 'plain') + '+' + pins + 'pin' + (bold ? '+bold' : '') + (hasForYou ? '' : '+noForYou');
      break;
    }
    if (!form) continue;
    const key = o.uuid;
    if (seen.has(key)) continue; seen.add(key);
    forms[form] = (forms[form] || 0) + 1;
    openerMsgs.push({ file: p, turnKey, turnTs, ts: o.timestamp, uuid: o.uuid, form,
      guardSees: GUARD_OPENER.test(stripFences(raw)),
      head: raw.slice(Math.max(0, raw.search(LOOSE) - 60), raw.search(LOOSE) + 160).replace(/\s+/g, ' ') });
  }
}
console.log('OPENER FORMS (all dates):', JSON.stringify(forms, null, 1));
const recent = openerMsgs.filter(m => (m.turnTs || '') >= '2026-07-28');
const rf = {}; recent.forEach(m => { rf[m.form + (m.guardSees ? ' [guard-sees]' : ' [GUARD-BLIND]')] = (rf[m.form + (m.guardSees ? ' [guard-sees]' : ' [GUARD-BLIND]')] || 0) + 1; });
console.log('\nSINCE 2026-07-28:', JSON.stringify(rf, null, 1));
// duplicates by turn under the BROAD opener test
const byTurn = {};
for (const m of openerMsgs) { (byTurn[m.turnKey] = byTurn[m.turnKey] || []).push(m); }
const dups = Object.entries(byTurn).filter(([k, v]) => v.length >= 2);
const dupRecent = dups.filter(([k, v]) => (v[0].turnTs || '') >= '2026-07-28');
console.log('\nBROAD duplicates all-dates:', dups.length, '| since 2026-07-28:', dupRecent.length);
for (const [k, v] of dupRecent) {
  console.log('\n####', v[0].turnTs, path.basename(v[0].file), 'n=' + v.length);
  v.forEach(m => console.log('   ', m.ts, m.form, m.guardSees ? '[guard-sees]' : '[GUARD-BLIND]', '::', m.head.slice(0, 200)));
}
fs.writeFileSync(path.join(__dirname, 'openers.json'), JSON.stringify(openerMsgs, null, 1));
