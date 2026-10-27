// GEN-953 step 2: what fits the pop-up's ~3 visible lines on EVERY kind of pop-up, not only the ones seen in
// past sessions. Builds a card for each reason on its own and for every pair of reasons, with and without
// Claude's own words, on a long real site name, and reports each part that falls past the visible lines:
// the site (wanted by line 2), the first sentence, the second reason's opening sentence, the start of
// Claude's words and the undo note (wanted by line 3).
// Usage: node sweep.js
'use strict';
const W = require('./wc/browser-site-gate.js');
const { FLOOR, cardOk } = require('./cardcheck.js');
const SITE = 'us-west-2b.online.tableau.com', HIGH = 'mail.google.com';
const CAUSES = Object.keys(FLOOR).concat(['unknown-tool:x']);
const RANK = ['deny-loop-stale-tab', 'deny-loop-unknown-tab', 'deny-loop-no-summary', 'typed-write', 'helper-args', 'risky-script', 'script-helper', 'high-stakes', 'follow-up', 'word', 'typed-enter'];
const rank = c => c === 'new-site' ? 99 : RANK.includes(c) ? RANK.indexOf(c) : c.startsWith('deny-loop-') ? 2.5 : 50;
// Simulated word wrap at 63 characters a line (as in replay.js), lines numbered from 1.
const lineOf = (text, at) => { let line = 1, len = 0, pos = 0; for (const w of text.split(' ')) { const need = len ? len + 1 + w.length : w.length; if (len && need > 63) { line++; len = w.length; } else len = need; if (pos + w.length > at) return line; pos += w.length + 1; } return line; };
const blankClaude = t => t.replace(/Claude says \(unverified\): "[^"]*"(; "[^"]*")*( and \d+ more)?\./, m => 'Claude says (unverified): ' + m.slice(26).replace(/\S/g, 'x'));

function card(causes, claim) {
  const site = causes.includes('high-stakes') ? HIGH : SITE;
  const texts = [];
  if (causes.includes('typed-write')) texts.push({ kind: 'typed', text: 'DROP TABLE t' });
  if (causes.includes('helper-args')) texts.push({ kind: 'script', text: 'h("GRANT x TO ROLE r")' });
  if (causes.includes('risky-script') || causes.includes('script-helper')) texts.push({ kind: 'script', text: 'fetch("/x")' });
  const hosts = (causes.includes('new-site') ? [site] : []).concat(causes.includes('script-helper') ? ['helper:' + site + ':runQ'] : []);
  // (a high-stakes site never gets the permission-control follow-up, so that one is on another site; a tab
  // whose page is unknown names no site of its own, only the sites of other reasons)
  const follow = causes.includes('follow-up') && causes.includes('high-stakes') ? [SITE] : [];
  const stuckUnknown = causes.includes('deny-loop-unknown-tab') && !causes.some(c => c === 'high-stakes' || c === 'follow-up');
  const notes = (stuckUnknown ? [] : [site]).concat(follow).concat(claim ? ['"' + claim + '"'] : []);
  return { decision: 'ask', causes, hosts, notes, texts, claims: claim ? [{ text: claim, danger: true }] : [], where: [site] };
}

const parts = { site: [], first: [], later: [], second: [], claude: [], undo: [] };
let cards = 0, wordingFail = 0;
const combos = [];
for (let i = 0; i < CAUSES.length; i++) { combos.push([CAUSES[i]]); for (let j = i + 1; j < CAUSES.length; j++) combos.push([CAUSES[i], CAUSES[j]]); }
for (const combo of combos.map(c => c.concat([])).concat(combos.map(c => c.concat(['new-site'])).filter(c => !c.slice(0, -1).includes('new-site')))) {
  for (const claim of [null, 'Clicks the Remove button next to the analyst role']) {
    const r = card(combo, claim);
    const t = W.plainReason(r);
    cards++;
    if (!cardOk(r, t)) { wordingFail++; if (wordingFail <= 5) console.log('WORDING', combo.join('+'), t); }
    const b = blankClaude(t), key = combo.join('+') + (claim ? ' (with Claude words)' : '');
    // the site: the first time it is named
    const s = b.search(/(us-west-2b\.online\.tableau\.com|mail\.google\.com)/);
    if (s >= 0 && lineOf(t, s + 15) > 2) parts.site.push(key + ' [line ' + lineOf(t, s + 15) + ']');
    const f = b.search(/\.( |$)/);
    if (lineOf(t, f) > 3) parts.first.push(key);
    const cs = [...new Set(combo)].filter(c => c !== 'new-site' && FLOOR[c] && !(c === 'helper-args' && combo.includes('typed-write') && !/more than a lookup/.test(b))).sort((x, y) => rank(x) - rank(y));
    if (cs.length > 1) {
      const f0 = FLOOR[cs[0]].exec(b), rest = f0 ? b.slice(0, f0.index) + ' '.repeat(f0[0].length) + b.slice(f0.index + f0[0].length) : b;
      const x = FLOOR[cs[1]].exec(rest);
      if (!x || lineOf(t, x.index + x[0].length - 1) > 3) parts.second.push(key + ' [line ' + (x ? lineOf(t, x.index + x[0].length - 1) : '?') + ']');
    }
    const c = t.indexOf('Claude says (unverified): "');
    if (claim && lineOf(t, c + 46) > 3) parts.claude.push(key + ' [line ' + lineOf(t, c + 46) + ']');
    const u = b.indexOf('Undo not guaranteed');
    if (u >= 0 && lineOf(t, u + 19) > 3) parts.undo.push(key);
    const l = b.indexOf('later calls to it go ahead');
    if (l >= 0 && lineOf(t, l + 100) > 3) parts.later.push(key + ' [line ' + lineOf(t, l + 60) + ']');
  }
}
console.log(JSON.stringify({ cards, wordingFail }));
const total = { site: 'site past line 2', first: 'first sentence past line 3', later: 'reused-code note ("later calls ... go ahead") past line 3', second: "second reason's opening sentence past line 3", claude: "start of Claude's words past line 3", undo: 'undo note past line 3' };
for (const [k, label] of Object.entries(total)) {
  console.log(label + ': ' + parts[k].length + ' of ' + cards + ' cards');
  if (process.argv.includes('-v') || k !== 'undo') for (const x of parts[k]) console.log('  ' + x);
}
