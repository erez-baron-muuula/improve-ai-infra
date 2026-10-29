// GEN-980 Rule A build: makes the working copy wc/browser-site-gate.js from the LIVE gate by exact-text
// replacements (each anchor must occur exactly once). Changes nothing live.
// Usage: node build-wc.js
'use strict';
const fs = require('fs'), path = require('path');
const LIVE = path.join(process.env.USERPROFILE, '.claude', 'hooks', 'browser-site-gate.js');
const OUT = path.join(__dirname, 'wc', 'browser-site-gate.js');
let s = fs.readFileSync(LIVE, 'utf8');
const rep = (a, b) => {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error('anchor found ' + n + ' times: ' + a.slice(0, 70));
  s = s.split(a).join(b);
};

// 1. header
rep(` *  - Typing that contains a newline (an Enter) asks unless it is a read-only query or a search.`,
` *  - Tableau Cloud data reads (GEN-980): a page script on a Tableau Cloud tab whose every server call goes
 *    through a wrapper of one fixed shape, declared in the script and called only with a method name in
 *    quotes from a closed list of reads (TABLEAU_READS), is checked as a read: the rest of the script must
 *    pass the script rules above on its own. A list of shapes the gate reads in full, not of bad requests.
 *  - Typing that contains a newline (an Enter) asks unless it is a read-only query or a search.`);

// 2. the rule
rep(`const callsHelper = (text, helpers) => helperCalls(text, helpers).length > 0;`,
`const callsHelper = (text, helpers) => helperCalls(text, helpers).length > 0;

// Claude's standard Tableau Cloud data read (GEN-980): the page's own session API, through a wrapper of
// exactly this shape (names, spacing and quote style free), declared in the script itself:
//   const vz = async (m, p) => (await fetch('/vizportal/api/web/v1/' + m, {method: 'POST', headers:
//     {'Content-Type': 'application/json', 'X-XSRF-TOKEN': x}, body: JSON.stringify({method: m, params: p})})).json();
// or with fetch(...).then(r => r.json()); with parameters named method and params, the body may be
// {method, params}. Every use of the wrapper's name must be a call with a listed method name in quotes, after
// the declaration. The methods Claude has used to read Tableau, and those its browser notes name; Tableau does
// not document them, so the list holds only names that read (an unlisted one asks). The browser tool may keep
// a script's names for the next script, so every wrapper name seen is remembered for the session
// (state.wrappers), and a later script that uses a remembered name other than as such a read call asks.
const TABLEAU_HOST = /^[a-z0-9-]+\\.online\\.tableau\\.com$/;
const TABLEAU_READS = new Set(['getWorkbooks', 'getDatasources', 'getDataConnections', 'getExtractTasks', 'getDataAlerts',
  'getSessionInfo', 'getUsers', 'getSchedules', 'getFlows', 'getBackgroundJobs']);
const JS_ID = '[A-Za-z_$][\\\\w$]*';
const reId = s => s.replace(/[$]/g, '\\\\$');
const QS = s => \`(?:'\${s}'|"\${s}"|\\\`\${s}\\\`)\`; // a fixed string, in matching quotes
function tableauFetch(m, p) {
  const S = '\\\\s*', M = reId(m), P = reId(p);
  const body = m === 'method' && p === 'params' ? \`(?:method\${S}:\${S}method\${S},\${S}params\${S}:\${S}params|method\${S},\${S}params)\`
    : \`method\${S}:\${S}\${M}\${S},\${S}params\${S}:\${S}\${P}\`;
  return \`fetch\${S}\\\\(\${S}\${QS('/vizportal/api/web/v1/')}\${S}\\\\+\${S}\${M}\${S},\${S}\\\\{\${S}method\${S}:\${S}\${QS('POST')}\${S},\${S}\` +
    \`headers\${S}:\${S}\\\\{\${S}\${QS('Content-Type')}\${S}:\${S}(?:\${QS('application/json')}|\${QS('application/json;charset=UTF-8')})\${S},\${S}\` +
    \`\${QS('X-XSRF-TOKEN')}\${S}:\${S}\${JS_ID}\${S}\\\\}\${S},\${S}body\${S}:\${S}JSON\\\\.stringify\\\\(\${S}\\\\{\${S}\${body}\${S}\\\\}\${S}\\\\)\${S}\\\\}\${S}\\\\)\`;
}
// (a var wrapper is found, so its name is remembered, but never let through: a top-level var is a property of
// window; a name fits the saved state's 61 characters)
const TABLEAU_HEAD = new RegExp(\`\\\\b(const|let|var)\\\\s+([A-Za-z_$][\\\\w$]{0,60})(?![\\\\w$])\\\\s*=\\\\s*(?:async\\\\s*)?\\\\(\\\\s*(\${JS_ID})\\\\s*,\\\\s*(\${JS_ID})\\\\s*(?:=\\\\s*\\\\{\\\\s*\\\\}\\\\s*)?\\\\)\\\\s*=>\\\\s*\`, 'g');
// A name is a whole identifier, not part of a longer one (in any script's letters). A call must be a bare
// call (NB: not obj.name(...)); any other occurrence, a property one included, counts as a use (NBU).
const NB = '(?<![\\\\p{ID_Continue}$.])', NBU = '(?<![\\\\p{ID_Continue}$])', NA = '(?![\\\\p{ID_Continue}$])';
const tableauCall = n => new RegExp(NB + n + \`\\\\s*\\\\(\\\\s*(['"\\\`])(\${JS_ID})\\\\1\\\\s*([,)])\`, 'gu');
const countUses = (t, n, b) => (t.match(new RegExp((b || NBU) + n + NA, 'gu')) || []).length;
// The wrappers of the fixed shape a script declares: [{ name, start, end }].
function findWrappers(t) {
  const found = [];
  if (!t.includes('/vizportal/api/web/v1/')) return found;
  TABLEAU_HEAD.lastIndex = 0;
  let mm;
  while ((mm = TABLEAU_HEAD.exec(t))) {
    const [head, kind, W, m, p] = mm;
    if (W === m || W === p || m === p || [W, m, p].some(x => x === 'fetch' || x === 'JSON')) continue;
    const F = tableauFetch(m, p);
    const b = new RegExp(\`^(?:\\\\(\\\\s*await\\\\s+\${F}\\\\s*\\\\)\\\\s*\\\\.json\\\\(\\\\s*\\\\)|\${F}\\\\s*\\\\.then\\\\(\\\\s*(\${JS_ID})\\\\s*=>\\\\s*\\\\1\\\\.json\\\\(\\\\s*\\\\)\\\\s*\\\\))\\\\s*;?\`).exec(t.slice(mm.index + head.length));
    if (!b) continue;
    const end = mm.index + head.length + b[0].length;
    found.push({ name: W, kind, start: mm.index, end });
    TABLEAU_HEAD.lastIndex = end;
  }
  return found;
}
const wrapperNames = text => [...new Set(findWrappers(String(text)).map(w => w.name))];
// Does this script use a wrapper name remembered from an earlier script (and not declared here) other than as a
// bare call with a listed read method in quotes? Then it may reach that wrapper with any method: it asks.
function wrapperMisuse(text, remembered) {
  if (!remembered || !remembered.length) return false;
  const t = String(text), own = wrapperNames(t);
  if (/\\\\u\\{/.test(t)) return true; // an escaped name is not read here
  return remembered.some(W => {
    if (own.includes(W) || !t.includes(W)) return false; // declared again here: tableauRead or the script rules judge it
    // a bare use, or one through the global object (a top-level var is a property of window)
    const n = reId(W), uses = countUses(t, n, NB) + countUses(t, n, '(?<![\\\\p{ID_Continue}$.])(?:window|globalThis|self|this|top|parent|frames)\\\\s*\\\\??\\\\.\\\\s*');
    if (!uses) return false;
    const calls = [...t.matchAll(tableauCall(n))];
    return uses !== calls.length || calls.some(c => !TABLEAU_READS.has(c[2]));
  });
}
// { ok, rest, methods, wrappers }: rest is the script with the wrappers and their calls blanked out, for the
// script rules. ok is false (the script is checked as before) unless every part above holds.
function tableauRead(text, helpers) {
  const no = why => ({ ok: false, why });
  let t = String(text);
  const found = findWrappers(t);
  if (!found.length) return no('no wrapper');
  if (found.some(w => w.kind === 'var')) return no('var declaration');
  // A name, fetch or JSON stored on window by an earlier script could be what the calls reach; an escaped name
  // (v\\\\u{7a}) is not read here.
  if ((helpers || []).some(h => h === 'fetch' || h === 'JSON' || found.some(w => w.name === h))) return no('a stored helper shadows the wrapper');
  if (/\\\\u\\{/.test(t)) return no('escaped name');
  // A comment could hide where a declaration starts; keep the shape's meaning fixed: nothing may comment code out.
  if (/\\/\\/|\\/\\*/.test(t)) return no('comment in the script');
  for (const w of found) if (countUses(t.slice(0, w.start), reId(w.name)) > 0) return no('wrapper used before its declaration');
  let out = '', last = 0;
  for (const w of found) { out += t.slice(last, w.start) + ' 0; '; last = w.end; }
  t = out + t.slice(last);
  const methods = [], wrappers = [...new Set(found.map(w => w.name))];
  for (const W of wrappers) {
    const n = reId(W), call = tableauCall(n);
    const calls = [...t.matchAll(call)];
    if (!calls.length || countUses(t, n) !== calls.length) return no('wrapper used other than as a bare call with a method name in quotes');
    for (const c of calls) { if (!TABLEAU_READS.has(c[2])) return no('method not on the read list: ' + c[2]); methods.push(c[2]); }
    t = t.replace(call, (all, q, name, endc) => '__tableauRead__(' + (endc === ')' ? ')' : ''));
  }
  if (RISKY_SCRIPT.test(t) || RELOAD_SCRIPT.test(t)) return no('rest of the script has a risky pattern');
  // ...nor reach or change what the wrapper relies on (fetch by another name, JSON or its stringify, toJSON, prototypes)
  if (/(^|[^\\w$.])fetch(?![\\w$])|\\bJSON\\s*(=|\\.\\s*\\w+\\s*=[^=])|toJSON|\\bprototype\\b|__proto__|defineProperty/.test(t)) return no('rest touches fetch or JSON');
  return { ok: true, rest: t, methods: [...new Set(methods)], wrappers };
}
// The text the script rules read: a recognized Tableau read without its wrappers and their calls. Used by
// moves() on any site: a fetch cannot navigate, and the rest passed the risky-pattern check.
const scriptRest = (t, helpers) => { const r = tableauRead(t, helpers); return r.ok ? r.rest : t; };`);

// 3. moves(): a recognized read cannot navigate (a fetch does not move the tab; the rest passed the rules);
// a script that may reach a remembered wrapper with any method may do anything
rep(`function moves(it, helpers) {`, `function moves(it, helpers, wrappers) {`);
rep(`  if (it.name === 'javascript_tool') { const t = String(it.input.text || ''); return RISKY_SCRIPT.test(t) || RELOAD_SCRIPT.test(t) || typedWrite(t) || callsHelper(t, helpers); }`,
`  if (it.name === 'javascript_tool') {
    const t = String(it.input.text || ''), tt = scriptRest(t, helpers);
    return RISKY_SCRIPT.test(tt) || RELOAD_SCRIPT.test(tt) || typedWrite(t) || callsHelper(tt, helpers) || wrapperMisuse(t, wrappers);
  }`);
rep(`    if (!moves(it, helpers)) return;`, `    if (!moves(it, helpers, wrappersKnown)) return;`);
rep(`    const mv = moves(it, state.helpers);`, `    const mv = moves(it, state.helpers, state.wrappers);`);
rep(`  let helpers = Array.isArray(state.helpers) ? state.helpers : [];`,
`  let helpers = Array.isArray(state.helpers) ? state.helpers : [];
  // Tableau wrapper names seen so far, earlier items of this batch included (GEN-980).
  const wrappersKnown = Array.isArray(state.wrappers) ? state.wrappers.slice() : [];`);

// state: the remembered wrapper names (names only ever make a later script ask)
rep(`  return { approved: {}, tabs: {}, pending: {}, helpers: [], streak: { cause: null, n: 0 },`,
`  return { approved: {}, tabs: {}, pending: {}, helpers: [], wrappers: [], streak: { cause: null, n: 0 },`);
rep(`  d.helpers = Array.isArray(s.helpers) ? s.helpers.filter(x => typeof x === 'string' && /^[A-Za-z_$][\\w$]{0,60}$/.test(x)).slice(-200) : [];`,
`  d.helpers = Array.isArray(s.helpers) ? s.helpers.filter(x => typeof x === 'string' && /^[A-Za-z_$][\\w$]{0,60}$/.test(x)).slice(-200) : [];
  d.wrappers = Array.isArray(s.wrappers) ? s.wrappers.filter(x => typeof x === 'string' && /^[A-Za-z_$][\\w$]{0,60}$/.test(x)).slice(-200) : [];`);
rep(`function rememberHelpers(state, names) {
  for (const hn of names || []) if (!state.helpers.includes(hn)) state.helpers.push(hn);
  if (state.helpers.length > 200) state.helpers = state.helpers.slice(-200);
}`,
`function rememberHelpers(state, names) {
  for (const hn of names || []) if (!state.helpers.includes(hn)) state.helpers.push(hn);
  if (state.helpers.length > 200) state.helpers = state.helpers.slice(-200);
}
// Remember Tableau wrapper names a script declares (the newest 200), as soon as it may run (GEN-980).
function rememberWrappers(state, names) {
  if (!Array.isArray(state.wrappers)) state.wrappers = [];
  for (const wn of names || []) if (!state.wrappers.includes(wn)) state.wrappers.push(wn);
  if (state.wrappers.length > 200) state.wrappers = state.wrappers.slice(-200);
}`);
rep(`    state.tabs = {}; state.approved = {};
    rememberHelpers(state, res.newHelpers);
    return;`,
`    state.tabs = {}; state.approved = {};
    rememberHelpers(state, res.newHelpers);
    rememberWrappers(state, res.newWrappers);
    return;`);
rep(`  // A helper is remembered as soon as a script that stores it may run (a lost PostToolUse must not forget it).
  rememberHelpers(state, res.newHelpers);`,
`  // A helper is remembered as soon as a script that stores it may run (a lost PostToolUse must not forget it).
  rememberHelpers(state, res.newHelpers);
  rememberWrappers(state, res.newWrappers);`);
rep(`    for (const it of items) if (it.name === 'javascript_tool') rememberHelpers(state, helperNames(it.input.text || ''));
    return;`,
`    for (const it of items) if (it.name === 'javascript_tool') { rememberHelpers(state, helperNames(it.input.text || '')); rememberWrappers(state, wrapperNames(it.input.text || '')); }
    return;`);
rep(`    if (it.name === 'javascript_tool') rememberHelpers(state, helperNames(it.input.text || ''));
  });`,
`    if (it.name === 'javascript_tool') { rememberHelpers(state, helperNames(it.input.text || '')); rememberWrappers(state, wrapperNames(it.input.text || '')); }
  });`);
rep(`  for (const it of items) if (it.name === 'javascript_tool') for (const hn of helperNames(it.input.text || '')) if (!newHelpers.includes(hn)) newHelpers.push(hn);`,
`  for (const it of items) if (it.name === 'javascript_tool') for (const hn of helperNames(it.input.text || '')) if (!newHelpers.includes(hn)) newHelpers.push(hn);
  const newWrappers = wrappersKnown.filter(w => !(state.wrappers || []).includes(w));`);
rep(`    tainted: [...tainted], untainted: [...untainted], passed, newHelpers,`,
`    tainted: [...tainted], untainted: [...untainted], passed, waived, newHelpers, newWrappers,`);

// 4. decide(): the script rules read the rest of a recognized Tableau read
rep(`  const asks = [], denies = [], newHosts = [], notes = [], moved = new Set(), tainted = new Set(), untainted = new Set(), passed = [];`,
`  const asks = [], denies = [], newHosts = [], notes = [], moved = new Set(), tainted = new Set(), untainted = new Set(), passed = [];
  const waived = []; // items a GEN-980 rule let through that the script rules alone would have asked about (logged)`);
rep(`      const jsBefore = asks.length;
      if (RISKY_SCRIPT.test(t)) asks.push('risky-script');
      else {
        // Approved per site: a helper of the same name on another site is another function.
        const st = has(tabs, String(inp.tabId)) ? tabs[inp.tabId] : null;
        const site = (st && hostOf(st.url)) || '?';
        const hc = helperCalls(t, helpers).map(x => 'helper:' + site + ':' + x);`,
`      const jsBefore = asks.length;
      const st = has(tabs, String(inp.tabId)) ? tabs[inp.tabId] : null;
      const site = (st && hostOf(st.url)) || '?';
      // A Tableau Cloud data read (GEN-980) on a tab last seen on Tableau Cloud (the page the helper rule uses
      // too; if a click moved it, the request is still only a listed read, sent to the page's own address): the
      // rules below read the script without its wrappers and their calls. A script reaching a wrapper an earlier
      // script declared, other than as a listed read, asks.
      const misuse = wrapperMisuse(t, wrappersKnown);
      for (const wn of wrapperNames(t)) if (!wrappersKnown.includes(wn)) wrappersKnown.push(wn);
      const tr = TABLEAU_HOST.test(site) && !misuse ? tableauRead(t, helpers) : null;
      const tt = tr && tr.ok ? tr.rest : t;
      if (RISKY_SCRIPT.test(tt) || misuse) asks.push('risky-script');
      else {
        // Approved per site: a helper of the same name on another site is another function.
        const hc = helperCalls(tt, helpers).map(x => 'helper:' + site + ':' + x);`);
rep(`        if (hc.length && !helperArgsOk(t)) asks.push('helper-args');
      }
      if (typedWrite(t)) asks.push('typed-write');`,
`        if (hc.length && !helperArgsOk(tt)) asks.push('helper-args');
      }
      if (typedWrite(t)) asks.push('typed-write');
      if (tr && tr.ok && asks.length === jsBefore) waived.push({ rule: 'tableau-read', host: site, methods: tr.methods.slice(0, 10) });`);

// a failed save may not forget a wrapper name (the same reason as for helpers)
rep(`          !(res.newHelpers || []).length && !res.switchesBrowser;`,
`          !(res.newHelpers || []).length && !(res.newWrappers || []).length && !res.switchesBrowser;`);

// 5. log what the rule let through (site + method names, no page text), for the two-week check
rep(`  if (res.decision !== 'deny' && res.passed && res.passed.length) logLine({ event: 'pass', session: input.session_id, items: res.passed.slice(0, 10) });`,
`  if (res.decision !== 'deny' && res.passed && res.passed.length) logLine({ event: 'pass', session: input.session_id, items: res.passed.slice(0, 10) });
  // What a GEN-980 rule let through (site + method names, no page text), and whether the call then went
  // ahead without any ask ('none'): read by the two-week check after install.
  if (res.decision !== 'deny' && res.waived && res.waived.length) logLine({ event: 'waived', session: input.session_id, decision: res.decision, items: res.waived.slice(0, 10) });`);

// 6. exports
rep(`  ADMIN_CONSOLES_HIGH_STAKES, SUMMARY_MODE, plainReason, legacyReasonFor, sqlKind, scriptKinds };`,
`  ADMIN_CONSOLES_HIGH_STAKES, SUMMARY_MODE, plainReason, legacyReasonFor, sqlKind, scriptKinds, tableauRead, TABLEAU_READS, TABLEAU_HOST };`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, s);
console.log('wrote', OUT, s.length, 'chars');
