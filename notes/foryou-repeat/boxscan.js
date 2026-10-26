// GEN-941 week check: where the "For you" block lands on next-step box turns, and
// whether anything written in the turn repeats it.
// Usage (from the Improve AI Infra repo root):
//   node notes/foryou-repeat/boxscan.js <sinceISO> [<ruleEditISO>]
// <ruleEditISO>: when the new CLAUDE.md wording went live. Sessions whose first
// transcript entry is at or after it ("new-rule" sessions) are reported apart,
// since a session keeps the rules it loaded at start.
// For each main-chain box call (mcp__ccd_turn__wrap_up, not an error) since the date:
//   placement = closing (block in text after the box, before any Stop-hook note)
//             | afterStop (block only after a Stop-hook note) | before (only before the box) | none
//   repeat    = a second block in the turn, or a long (>300 chars) text sharing >= 30% of its
//               six-word phrases with the block (either side of the box)
//   nudged    = a Stop-hook "For-you check" note arrived after the box
//   note      = the gate log's after-box row for this box (same session, within 20 s):
//               note fired or not, and the block status it saw
//   modelShown = the block carries an effort tag with a model name, e.g. "(xhigh, Opus 5.5)": the
//               fail-safe or below-floor form, so it tells whether the after-box directive arrived.
// Copies of a forked session that share a box timestamp are counted once.
// Also summarises the gate log (~/.claude/hooks/effort-tag-gate.jsonl) since the date and lists
// every refusal with its untagged buttons (a refusal with none is a wrong refusal).
const fs = require('fs');
const path = require('path');
const home = process.env.USERPROFILE || process.env.HOME;
const root = path.join(home, '.claude', 'projects');
const since = process.argv[2] || '2026-10-25T00:00:00Z';
const ruleEdit = process.argv[3] || null;
const MARK = /(?:^|\n)[ \t>*_#-]{0,12}\u{1F4CC}️?[ \t]{0,8}\*{0,2}[ \t]{0,8}For you/u;
const MODEL_TAG = /\(\s*(?:low|medium|high|xhigh|max)\b\s*,\s*(?:Opus|Sonnet|Haiku|Fable)[^)]*\)/i;
const sh = (s) => {
  const w = s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const set = new Set();
  for (let i = 0; i + 6 <= w.length; i++) set.add(w.slice(i, i + 6).join(' '));
  return set;
};

let gateRows = [];
try {
  gateRows = fs.readFileSync(path.join(home, '.claude', 'hooks', 'effort-tag-gate.jsonl'), 'utf8').split('\n')
    .filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter((r) => r && r.ts >= since);
} catch (e) {
  console.log('gate log unreadable: ' + e.message);
}
const afterRows = gateRows.filter((r) => typeof r.outcome === 'string' && r.outcome.indexOf('after-box') === 0);

const blank = () => ({ n: 0, closing: 0, afterStop: 0, before: 0, none: 0, repeated: 0, nudged: 0, tagged: 0, modelShown: 0,
  noteFired: 0, noteMissingOrUnknown: 0, noteFollowedByClosing: 0, notePresent: 0, notePresentButNoBlock: 0 });
const stats = { all: { ask: blank(), recap: blank() }, newRule: { ask: blank(), recap: blank() } };
const flagged = [];
const seen = new Set();
for (const proj of fs.readdirSync(root)) {
  const pdir = path.join(root, proj);
  let files;
  try { files = fs.readdirSync(pdir).filter((f) => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of files) {
    const fp = path.join(pdir, f);
    if (fs.statSync(fp).mtime < new Date(since)) continue;
    const sid = f.replace(/\.jsonl$/, '');
    const ents = [];
    for (const ln of fs.readFileSync(fp, 'utf8').split('\n')) { if (!ln.trim()) continue; try { ents.push(JSON.parse(ln)); } catch (e) { /* skip */ } }
    const firstTs = (ents.find((e) => e && typeof e.timestamp === 'string') || {}).timestamp || '';
    const isNew = !!(ruleEdit && firstTs && firstTs >= ruleEdit);
    const starts = [];
    const errIds = new Set();
    ents.forEach((e, i) => {
      if (e.type !== 'user' || e.isSidechain === true || !e.message) return;
      const c = e.message.content;
      if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result' && b.is_error) errIds.add(b.tool_use_id);
      if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return;
      if ((e.origin && typeof e.origin === 'object') || (typeof c === 'string' && !e.isMeta)) starts.push(i);
    });
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.type !== 'assistant' || e.isSidechain === true || !e.message || !Array.isArray(e.message.content)) continue;
      if (!e.timestamp || e.timestamp < since) continue;
      for (const c of e.message.content) {
        if (!c || c.type !== 'tool_use' || c.name !== 'mcp__ccd_turn__wrap_up' || errIds.has(c.id)) continue;
        const kind = (c.input && typeof c.input.ask === 'string' && c.input.ask.trim()) ? 'ask' : 'recap';
        const key = e.timestamp + '|' + kind;
        if (seen.has(key)) continue;
        seen.add(key);
        let ts = 0;
        for (const s of starts) if (s < i) ts = s;
        let te = ents.length;
        for (const s of starts) if (s > i) { te = s; break; }
        const texts = [];
        let stopSeen = false;
        let nudged = false;
        for (let j = ts; j < te; j++) {
          const x = ents[j];
          if (j > i && x.type === 'attachment' && x.attachment && x.attachment.hookEvent === 'Stop' && x.attachment.type === 'hook_additional_context') {
            stopSeen = true;
            const body = String((x.attachment.content || [])[0] || '');
            if (body.indexOf('For-you check, automatic') === 0) nudged = true;
          }
          if (x.type !== 'assistant' || x.isSidechain === true || !x.message || !Array.isArray(x.message.content)) continue;
          for (const b of x.message.content) {
            if (!b || b.type !== 'text' || !b.text || !b.text.trim()) continue;
            const pos = (j < i || (j === i && x.message.content.indexOf(b) < x.message.content.indexOf(c))) ? 'before' : (stopSeen ? 'afterStop' : 'closing');
            texts.push({ t: b.text, pos: pos, block: MARK.test(b.text) });
          }
        }
        const blocks = texts.filter((x) => x.block);
        const place = blocks.some((x) => x.pos === 'closing') ? 'closing' : blocks.some((x) => x.pos === 'afterStop') ? 'afterStop' : blocks.length ? 'before' : 'none';
        let overlap = 0;
        let modelShown = false;
        let tagged = false;
        if (blocks.length) {
          const last = blocks[blocks.length - 1];
          const b = sh(last.t);
          for (const x of texts) {
            if (x === last || x.t.length <= 300) continue;
            const q = sh(x.t);
            let m = 0;
            for (const p of q) if (b.has(p)) m++;
            overlap = Math.max(overlap, q.size ? m / q.size : 0);
          }
          modelShown = MODEL_TAG.test(last.t);
          tagged = /\(\s*(?:low|medium|high|xhigh|max)\b/i.test(last.t);
        }
        const repeated = blocks.length > 1 || overlap >= 0.3;
        const bt = Date.parse(e.timestamp);
        const row = afterRows.find((r) => r.session === sid && Math.abs(Date.parse(r.ts) - bt) < 20000 && (r.ask === (kind === 'ask')));
        for (const bucket of isNew ? [stats.all, stats.newRule] : [stats.all]) {
          const s = bucket[kind];
          s.n++;
          s[place]++;
          if (repeated) s.repeated++;
          if (nudged) s.nudged++;
          if (tagged) s.tagged++;
          if (modelShown) s.modelShown++;
          if (row && row.outcome === 'after-box-note') {
            s.noteFired++;
            if (row.block === 'present') { s.notePresent++; if (!blocks.some((x) => x.pos === 'before')) s.notePresentButNoBlock++; }
            else { s.noteMissingOrUnknown++; if (place === 'closing') s.noteFollowedByClosing++; }
          }
        }
        if (repeated) flagged.push([e.timestamp, kind, isNew ? 'new-rule' : 'old-rule', proj.replace('C--Users-Erez-', ''), sid.slice(0, 8), 'blocks=' + blocks.length, 'overlap%=' + Math.round(overlap * 100), 'placement=' + place].join(' | '));
      }
    }
  }
}
for (const l of flagged.sort()) console.log('REPEAT ' + l);
const line = (label, s) => label + ': ' + s.n + ' | block as closing message: ' + s.closing + ' | only after a Stop note: ' + s.afterStop +
  ' | only before the box: ' + s.before + ' | no block: ' + s.none + ' | repeated (>=30% or two blocks): ' + s.repeated +
  ' | Stop For-you reminder after the box: ' + s.nudged + ' | blocks with an effort tag: ' + s.tagged + ' | of those showing a model name: ' + s.modelShown +
  ' | after-box note fired: ' + s.noteFired + ' (saw no block: ' + s.noteMissingOrUnknown + ', then block as closing message: ' + s.noteFollowedByClosing +
  '; saw a block: ' + s.notePresent + ', but none before the box: ' + s.notePresentButNoBlock + ')';
for (const [cohort, label] of [['all', 'ALL sessions'], ['newRule', 'NEW-RULE sessions (started at/after ' + (ruleEdit || 'n/a') + ')']]) {
  if (cohort === 'newRule' && !ruleEdit) continue;
  console.log(label);
  console.log('  ' + line('question boxes', stats[cohort].ask));
  console.log('  ' + line('recap-only boxes', stats[cohort].recap));
}
const by = {};
for (const r of gateRows) by[r.outcome] = (by[r.outcome] || 0) + 1;
console.log('gate log since ' + since + ': ' + JSON.stringify(by));
for (const r of gateRows) if (r.outcome === 'blocked') console.log('REFUSED ' + r.ts + ' ' + r.tool + ' untagged=' + JSON.stringify(r.untagged || []) + (r.missing ? ' missing=' + JSON.stringify(r.missing) : '') + (r.block ? ' block=' + r.block : '') + ((r.tool === 'mcp__ccd_turn__wrap_up' && !(r.untagged || []).length) ? ' <- WRONG (no untagged button)' : ''));
