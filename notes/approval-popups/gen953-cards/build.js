// GEN-953 step 2: build the working copy of browser-site-gate.js with plain-words pop-up text.
// Reads the live hook, applies exact-text edits (each must match exactly once), writes wc/browser-site-gate.js.
// Usage: node build.js
'use strict';
const fs = require('fs'), path = require('path');
const LIVE = path.join(process.env.USERPROFILE, '.claude', 'hooks', 'browser-site-gate.js');
const OUT = path.join(__dirname, 'wc', 'browser-site-gate.js');
let s = fs.readFileSync(LIVE, 'utf8');
fs.mkdirSync(path.join(__dirname, 'wc'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'live-baseline.js'), s);

function rep(from, to) {
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error('expected exactly 1 match, got ' + n + ' for: ' + from.slice(0, 90));
  s = s.replace(from, () => to);
}

// 1. Header note.
rep(` * Signals: each ask/deny is logged`,
` * Pop-up text (GEN-953): the reason Erez reads at the top of the pop-up says in plain words what kind of
 * change it is (from the typed text or script the gate itself read, or the danger word in Claude's own
 * summary), on which site, Claude's own summary marked as Claude's, "Undo is not guaranteed" and a
 * caution. Text only: it is built after the decision is made and logged, and any error building it
 * falls back to the earlier wording (legacyReasonFor).
 *
 * Signals: each ask/deny is logged`);

// 2. Per-call collections for the pop-up text (never saved to state, never logged).
rep(`  const asks = [], denies = [], newHosts = [], notes = [], moved = new Set(), tainted = new Set(), untainted = new Set(), passed = [];`,
`  const asks = [], denies = [], newHosts = [], notes = [], moved = new Set(), tainted = new Set(), untainted = new Set(), passed = [];
  // For the pop-up text only (GEN-953): what an asking script or typed text says, and Claude's summaries.
  const texts = [], claims = [], where = [];`);

// 3. Scripts that asked: keep their text for the pop-up.
rep(`      const t = String(inp.text || '');
      if (RISKY_SCRIPT.test(t)) asks.push('risky-script');`,
`      const t = String(inp.text || '');
      const jsBefore = asks.length;
      if (RISKY_SCRIPT.test(t)) asks.push('risky-script');`);
rep(`      if (typedWrite(t)) asks.push('typed-write');
      if (asks.length) siteNote(inp.tabId);`,
`      if (typedWrite(t)) asks.push('typed-write');
      if (asks.length > jsBefore) texts.push({ kind: 'script', text: t.slice(0, TEXT_CAP), cut: t.length > TEXT_CAP });
      if (asks.length) siteNote(inp.tabId);`);

// 4. Typed database writes: keep the typed text.
rep(`    if (!high && typed != null && typedWrite(typed)) asks.push('typed-write');`,
`    if (!high && typed != null && typedWrite(typed)) { asks.push('typed-write'); texts.push({ kind: 'typed', text: String(typed).slice(0, TEXT_CAP), cut: String(typed).length > TEXT_CAP }); }`);

// 5. Claude's summary and the site of every interaction that asked (beyond a new-site ask).
rep(`    const askedHere = asks.slice(before).some(c => c !== 'new-site');`,
`    const askedHere = asks.slice(before).some(c => c !== 'new-site');
    if ((high || askedHere) && typeof sum === 'string' && sum.trim()) { claims.push(sum.trim().slice(0, 80)); where.push(h); }`);

// 6. Carry them on the result.
rep(`    tainted: [...tainted], untainted: [...untainted], passed, newHelpers,`,
`    tainted: [...tainted], untainted: [...untainted], passed, newHelpers,
    texts, claims: [...new Set(claims)], where: [...new Set(where)],`);

// 7. The new pop-up text, with the old one kept as the fallback.
rep(`function reasonFor(res) {`,
fs.readFileSync(path.join(__dirname, 'plain-reason.js'), 'utf8') + `
function legacyReasonFor(res) {`);

// 8. TEXT_CAP next to the other limits.
rep(`const SHAPE_LOG_MAX = 20;`, `const SHAPE_LOG_MAX = 20;
const TEXT_CAP = 20000; // characters of a script or typed text the pop-up text reads (GEN-953)`);

// 9. Exports for tests.
rep(`  ADMIN_CONSOLES_HIGH_STAKES, SUMMARY_MODE };`,
`  ADMIN_CONSOLES_HIGH_STAKES, SUMMARY_MODE, plainReason, legacyReasonFor, sqlKind, scriptKinds, wordKind };`);

fs.writeFileSync(OUT, s);
console.log('wrote', OUT, s.length, 'chars');
