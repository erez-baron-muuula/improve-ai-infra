// Pass 2: classify block-opener FORMS and re-classify missing/duplicates.
const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/Erez/.claude/projects';
const CUTOFF = new Date('2026-07-19T00:00:00Z');
const LOOSE = /\u{1F4CC}\s*\*{0,2}\s*For you/u;
// Guard's opener + tail window: DERIVED from the TARGET file's source, never
// hand-copied (code-review 2026-08-10 -- the hand copy needed a manual re-sync
// on every regex change and carried no drift detector). TARGET is the working
// copy until the GEN-467 batch applies; after apply the working copy and the
// live hook are identical, and once the working dir is retired, point TARGET
// at the live hook. guardSees/guardReleases in openers.json are computed with
// THESE values -- regenerate openers.json after any TARGET change, never mix
// old rows with a new recogniser.
const TARGET = 'C:/Users/Erez/AI Projects/Improve AI Infra/notes/gen467-holistic-fix/working/stop-claim-linter.js';
const targetSrc = fs.readFileSync(TARGET, 'utf8');
const reM = targetSrc.match(/const BLOCK_OPENER_RE = (\/.*\/[a-z]*);/);
const winM = targetSrc.match(/const RELEASE_TAIL_WINDOW = (\d+);/);
if (!reM || !winM) throw new Error('BLOCK_OPENER_RE or RELEASE_TAIL_WINDOW not found in TARGET -- re-derive');
const GUARD_OPENER = new Function('return ' + reM[1] + ';')();
const GUARD_OPENER_G = new RegExp(GUARD_OPENER.source, GUARD_OPENER.flags + 'g');
const RELEASE_TAIL_WINDOW = parseInt(winM[1], 10);
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
      // must be a short header-ish line ending the pin+"For you" phrase.
      // #{1,6} matches the guard's own heading range (code-review 2026-08-10:
      // the old #{1,4} + the 160-char skip silently excluded forms from the
      // acceptance corpus that the guard must handle).
      if (!/^(?:#{1,6}[ \t]*)?(?:\*{0,2})[ \t]*(?:\u{1F4CC}[ \t]*)+/u.test(s)) continue;
      if (!/For you/i.test(s) && !/^(?:#{1,6}\s*)?\*{0,2}(?:\u{1F4CC}\s*)+\*{0,2}[A-Z]/u.test(s)) continue;
      if (s.length > 160) continue;
      const pins = (s.match(/\u{1F4CC}/gu) || []).length;
      const heading = /^#{1,6}/.test(s);
      const bold = /\*\*/.test(s);
      const hasForYou = /For you/i.test(s);
      form = (heading ? 'heading' : 'plain') + '+' + pins + 'pin' + (bold ? '+bold' : '') + (hasForYou ? '' : '+noForYou');
      break;
    }
    // A LOOSE-matched message whose lines defeat the classifier still enters
    // the corpus as 'unclassified' -- the acceptance replay must see EVERY
    // observed opener candidate, or a form the classifier can't name ships
    // unwitnessed (code-review 2026-08-10; previously these were dropped).
    if (!form) form = 'unclassified';
    const key = o.uuid;
    if (seen.has(key)) continue; seen.add(key);
    forms[form] = (forms[form] || 0) + 1;
    // guardSees = the guard RECOGNISES an opener; guardReleases = it would
    // also RELEASE-RECORD it (last opener within RELEASE_TAIL_WINDOW of the
    // stripped end) -- the two differ for out-of-window openers, where the
    // shipped guard logs release-skipped-tail and Arm 1 stays inert
    // (code-review 2026-08-10: guardSees alone overstated release coverage).
    GUARD_OPENER_G.lastIndex = 0;
    let gm, gLast = -1;
    while ((gm = GUARD_OPENER_G.exec(t)) !== null) { gLast = gm.index; }
    openerMsgs.push({ file: p, turnKey, turnTs, ts: o.timestamp, uuid: o.uuid, form,
      guardSees: gLast >= 0,
      guardReleases: gLast >= 0 && (t.length - gLast) <= RELEASE_TAIL_WINDOW,
      head: raw.slice(Math.max(0, raw.search(LOOSE) - 60), raw.search(LOOSE) + 160).replace(/\s+/g, ' ') });
  }
}
console.log('OPENER FORMS (all dates):', JSON.stringify(forms, null, 1));
const recent = openerMsgs.filter(m => (m.turnTs || '') >= '2026-07-28');
const rf = {}; recent.forEach(m => { rf[m.form + (m.guardSees ? ' [guard-sees]' : ' [GUARD-BLIND]')] = (rf[m.form + (m.guardSees ? ' [guard-sees]' : ' [GUARD-BLIND]')] || 0) + 1; });
console.log('\nSINCE 2026-07-28:', JSON.stringify(rf, null, 1));
// duplicates by turn, over the census collected above (an earlier comment
// credited a BROAD_OPENER regex that was never actually consulted -- that
// dead regex and its twin PIN_LINE were removed 2026-08-10).
// Messages BEFORE a file's first real prompt have no turn (turnKey null);
// they are excluded rather than merged -- null used to stringify into one
// shared 'null' bucket ACROSS ALL FILES, fabricating a phantom duplicate
// turn in the all-dates count (code-review 2026-08-10).
const byTurn = {};
for (const m of openerMsgs) { if (!m.turnKey) continue; (byTurn[m.turnKey] = byTurn[m.turnKey] || []).push(m); }
const dups = Object.entries(byTurn).filter(([k, v]) => v.length >= 2);
const dupRecent = dups.filter(([k, v]) => (v[0].turnTs || '') >= '2026-07-28');
console.log('\nBROAD duplicates all-dates:', dups.length, '| since 2026-07-28:', dupRecent.length);
for (const [k, v] of dupRecent) {
  console.log('\n####', v[0].turnTs, path.basename(v[0].file), 'n=' + v.length);
  v.forEach(m => console.log('   ', m.ts, m.form, m.guardSees ? '[guard-sees]' : '[GUARD-BLIND]', '::', m.head.slice(0, 200)));
}
fs.writeFileSync(path.join(__dirname, 'openers.json'), JSON.stringify(openerMsgs, null, 1));
