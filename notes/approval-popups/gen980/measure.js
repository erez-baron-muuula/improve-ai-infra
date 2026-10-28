// GEN-980 design measurement (not a build): replays the LIVE browser gate over real transcripts and, on
// top of it, the two proposed allowlist rules, to count the pop-ups each would remove.
//   A. Tableau session-API reads: a page script on a *.online.tableau.com tab whose every server call is
//      one of two exact shapes (a direct fetch frame naming a listed read method, or a wrapper of fixed
//      shape declared in the same script and only ever called with a listed read method); the rest of the
//      script must pass today's script check (no risky pattern, no call to another stored helper).
//   B. Snowsight read-only run: a Ctrl+Return-type key on an app.snowflake.com tab whose editor text the
//      gate saw set (fill) to read-only SQL, with nothing else touching that site's tabs since.
//      The fill shapes: STRICT = the one canonical inline fill (published in Claude's browser notes);
//      PROJECTED = past home-made equivalents of it (a __setSql(<literal>) call whose definition on that
//      site was the whole-editor replace in the Snowsight iframe, or such a definition plus one call),
//      i.e. what the canonical form would have covered had Claude used it.
// A flipped call: every asking item is recognized and drops only the causes its rule answers; the rest
// of the call is re-decided by the live gate with those items replaced by a screenshot of the same tab.
// Usage: node measure.js [days] [--list]
'use strict';
const fs = require('fs'), path = require('path');
const home = process.env.USERPROFILE;
const G = require(path.join(home, '.claude', 'hooks', 'browser-site-gate.js'));
const DAYS = +(process.argv[2] || 14);
const LIST = process.argv.includes('--list');
const opts = { adminConsolesHighStakes: G.ADMIN_CONSOLES_HIGH_STAKES };
const T = 'mcp__claude-in-chrome__';
const RISKY_SCRIPT = G.RISKY_SCRIPT;
const RELOAD = /\blocation\.reload\s*\(|\bhistory\.go\s*\(\s*0?\s*\)/;
// (copied from the gate, which does not export it)
G.helperCalls = (text, helpers) => {
  if (!helpers || !helpers.length) return [];
  const t = String(text);
  return helpers.filter(h => {
    const n = h.replace(/[$]/g, '\\$');
    return new RegExp('(^|[^\\w$])' + n + '\\s*(\\(|\\?\\.\\s*\\(|\\.\\s*[A-Za-z_$][\\w$]*\\s*\\()').test(t) ||
      new RegExp('[(,]\\s*' + n + '\\s*[),]').test(t);
  });
};

// ---------- A. Tableau ----------
const TABLEAU_HOST = /^[a-z0-9-]+\.online\.tableau\.com$/;
const TABLEAU_READS = new Set(['getWorkbooks', 'getDatasources', 'getDataConnections', 'getExtractTasks', 'getDataAlerts',
  'getSessionInfo', 'getUsers', 'getSchedules', 'getFlows', 'getBackgroundJobs']);
const ID = '[A-Za-z_$][\\w$]*';
const S = '\\s*';
// headers object of fixed shape: Content-Type JSON (optionally ;charset=UTF-8) and X-XSRF-TOKEN from a variable
const HEADERS = `headers${S}:${S}\\{${S}(['"])Content-Type\\1${S}:${S}(['"])application/json(?:;${S}charset=UTF-8)?\\2${S},${S}(['"])X-XSRF-TOKEN\\3${S}:${S}${ID}${S}\\}`;
// renumber backreferences inside a fragment so fragments can be joined
function frag(src, base) { return src.replace(/\\(\d)/g, (m, d) => '\\' + (+d + base)); }
// Direct frame: fetch('/vizportal/api/web/v1/<M>', {method:'POST', headers:{...}, body:JSON.stringify({method:'<M>', params:
const DIRECT = new RegExp(`\\bfetch${S}\\(${S}(['"\`])/vizportal/api/web/v1/(${ID})\\1${S},${S}\\{${S}method${S}:${S}(['"])POST\\3${S},${S}` +
  frag(HEADERS, 3) + `${S},${S}body${S}:${S}JSON\\.stringify\\(${S}\\{${S}method${S}:${S}(['"])(${ID})\\7${S},${S}params${S}:`, 'g');
// Wrapper: [const|let|var|window.]W = [async] (m, p[={}]) => (await fetch(F)).json()  |  fetch(F).then(r => r.json())
//          |  { const x = <cookie>; const r = await fetch(F); return r.json(); }
function fetchVar(m, p) {
  return `fetch${S}\\(${S}(?:['"\`])/vizportal/api/web/v1/(?:['"\`])${S}\\+${S}${m}${S},${S}\\{${S}method${S}:${S}(?:['"])POST(?:['"])${S},${S}` +
    `headers${S}:${S}\\{${S}(?:['"])Content-Type(?:['"])${S}:${S}(?:['"])application/json(?:;${S}charset=UTF-8)?(?:['"])${S},${S}(?:['"])X-XSRF-TOKEN(?:['"])${S}:${S}${ID}${S}\\}` +
    `${S},${S}body${S}:${S}JSON\\.stringify\\(${S}\\{${S}(?:method${S}:${S}${m}|${m === 'method' ? 'method' : '(?!)'})${S},${S}(?:params${S}:${S}${p}|${p === 'params' ? 'params' : '(?!)'})${S}\\}${S}\\)${S}\\}${S}\\)`;
}
const COOKIE = `(?:decodeURIComponent\\(${S}\\(${S}document\\.cookie\\.match\\(${S}/XSRF-TOKEN=\\(\\[\\^;\\]\\+\\)/${S}\\)${S}\\|\\|${S}\\[${S}\\]${S}\\)${S}\\[${S}1${S}\\]${S}\\|\\|${S}''${S}\\)` +
  `|${S}\\(${S}document\\.cookie\\.match\\(${S}/XSRF-TOKEN=\\(\\[\\^;\\]\\+\\)/${S}\\)${S}\\|\\|${S}\\[${S}\\]${S}\\)${S}\\[${S}1${S}\\])`;
const WRAP_HEAD = new RegExp(`(?:\\b(?:const|let|var)\\s+)(${ID})${S}=${S}(?:async${S})?\\(${S}(${ID})${S},${S}(${ID})(?:${S}=${S}\\{${S}\\})?${S}\\)${S}=>${S}`, 'g');
function wrapBody(m, p) {
  const F = fetchVar(m, p);
  return new RegExp('^(?:' +
    `\\(${S}await${S}${F}${S}\\)${S}\\.json\\(${S}\\)` + '|' +
    `${F}${S}\\.then\\(${S}(${ID})${S}=>${S}\\1\\.json\\(${S}\\)${S}\\)` +
    `)${S};?`);
}
// Returns { ok, rest, methods } — rest is the script with every recognized part blanked out.
function tableauRead(text, allowDirect) {
  let t = String(text);
  const methods = [];
  const wrappers = []; // {name, end}
  // wrappers first
  let out = '', last = 0, mm;
  WRAP_HEAD.lastIndex = 0;
  const cuts = [];
  while ((mm = WRAP_HEAD.exec(t))) {
    const [all, W, m, p] = mm;
    const b = wrapBody(m, p).exec(t.slice(mm.index + all.length));
    if (!b) continue;
    const end = mm.index + all.length + b[0].length;
    if (new RegExp(`(^|[^\\w$.])${W.replace(/\$/g, '\\$')}(?![\\w$])`).test(t.slice(0, mm.index))) return { ok: false, why: 'wrapper used before its declaration' };
    cuts.push([mm.index, end]); wrappers.push({ name: W, end });
    WRAP_HEAD.lastIndex = end;
  }
  for (const [a, b] of cuts) { out += t.slice(last, a) + ' 0; '; last = b; }
  t = out + t.slice(last);
  // calls to each wrapper: every use must be W('<read method>', ...) after its declaration (positions in the original are
  // approximated by requiring no use before the first cut; a use before declaration is refused)
  for (const w of wrappers) {
    const use = new RegExp(`(^|[^\\w$.])${w.name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
    const call = new RegExp(`(^|[^\\w$.])${w.name.replace(/\$/g, '\\$')}${S}\\(${S}(['"\`])(${ID})\\2${S}([,)])`, 'g');
    const uses = [...t.matchAll(use)].length;
    const calls = [...t.matchAll(call)];
    if (uses !== calls.length) return { ok: false, why: 'wrapper used other than with a literal method' };
    for (const c of calls) { if (!TABLEAU_READS.has(c[3])) return { ok: false, why: 'unlisted method ' + c[3] }; methods.push(c[3]); }
    t = t.replace(call, (all, pre, q, name, end) => pre + '__RD(' + (end === ')' ? ')' : ''));
  }
  // direct frames
  let bad = null;
  // (the direct form leaves its params and the rest of its body unanchored, so it counts only when measured on purpose)
  t = t.replace(DIRECT, (all, q1, m1, q3, h1, h2, h3, q7, m2) => {
    if (!allowDirect) bad = bad || 'direct fetch form';
    if (m1 !== m2 || !TABLEAU_READS.has(m1)) bad = bad || ('direct frame ' + m1 + '/' + m2);
    methods.push(m1); return '__RD({params:';
  });
  if (bad) return { ok: false, why: bad };
  if (!methods.length) return { ok: false, why: 'no recognized call' };
  if (RISKY_SCRIPT.test(t) || RELOAD.test(t)) return { ok: false, why: 'rest has risky pattern: ' + (t.match(RISKY_SCRIPT) || t.match(RELOAD))[0] };
  return { ok: true, rest: t, methods, wrappers: wrappers.map(w => w.name) };
}

// ---------- B. Snowsight ----------
const SNOW_HOST = /^app\.snowflake\.com$/;
const RUN_KEY = /^\s*(?:(?:escape|ctrl\+a)\s+){0,2}ctrl\+(?:return|enter)\s*$/i;
const READ_RUN = /^(select|with|show|desc|describe|explain|list|ls)\b/i;
const QUOTED = /`([^`]*)`|"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'/;
const statementsOf = s => s.replace(/\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|[\s\S])/g, ' ').replace(/'(?:[^']|'')*'/g, "''")
  .split(/;|->>/).map(x => x.trim()).filter(Boolean);
function sqlReadOnly(sql) {
  // (sql is the literal's decoded value, or null when it could not be read in full)
  if (sql == null || /\$\$|--|\/\*|\\/.test(sql)) return false;
  // a query that defines or calls a routine is not a plain look (WITH p AS PROCEDURE ... CALL p())
  if (/\b(procedure|function|call)\b/i.test(sql.replace(/'(?:[^']|'')*'/g, "''"))) return false;
  const st = statementsOf(sql);
  return st.length > 0 && st.every(x => READ_RUN.test(x)) && !G.typedWrite(sql);
}
// one JS string literal, whole
const LIT = '(`[^`]*`|"(?:[^"\\\\]|\\\\[\\s\\S])*"|\'(?:[^\'\\\\]|\\\\[\\s\\S])*\')';
// The literal's value as JavaScript builds it; null (= not read-only) for a ${...} or any escape but these.
const ESC = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '`': '`' };
const litText = l => {
  const b = l.slice(1, -1);
  if (l[0] === '`' && /\$\{/.test(b)) return null;
  let bad = false;
  const v = b.replace(/\\([\s\S])/g, (m, c) => { if (!Object.prototype.hasOwnProperty.call(ESC, c)) bad = true; return ESC[c] || ''; });
  return bad ? null : v;
};
// STRICT canonical inline fill (what the browser notes would publish):
// (v => { v.dispatch({changes: {from: 0, to: v.state.doc.length, insert: <SQL>}}); v.focus(); return v.state.doc.length; })(document.querySelector('iframe').contentDocument.querySelector('.cm-content').cmView.view)
const CANON = new RegExp(`^${S}\\(${S}\\(?${S}v${S}\\)?${S}=>${S}\\{${S}v\\.dispatch\\(${S}\\{${S}changes${S}:${S}\\{${S}from${S}:${S}0${S},${S}to${S}:${S}v\\.state\\.doc\\.length${S},${S}insert${S}:${S}${LIT}${S}\\}${S}\\}${S}\\)${S};${S}v\\.focus\\(${S}\\)${S};${S}return${S}v\\.state\\.doc\\.length${S};?${S}\\}${S}\\)${S}\\(${S}document\\.querySelector\\(${S}(['"])iframe\\2${S}\\)${S}\\.contentDocument${S}\\.querySelector\\(${S}(['"])\\.cm-content\\3${S}\\)${S}\\.cmView${S}\\.view${S}\\)${S};?${S}$`);
// PROJECTED: a home-made whole-editor replace in the Snowsight iframe
const FILL_DEF = /iframe[\s\S]{0,200}\.cm-content[\s\S]{0,400}\.dispatch\(\s*\{\s*changes\s*:\s*\{\s*from\s*:\s*0\s*,\s*to\s*:\s*\w+\.state\.doc\.length\s*,\s*insert\s*:\s*(\w+)\s*\}/;
// (a read-only tail is allowed: it is the same as a separate read-only script after the fill)
const CALL_ONLY = new RegExp(`^${S}(?:window\\.)?(${ID})${S}\\(${S}${LIT}${S}\\)${S}(?:;([\\s\\S]*))?$`);
const DEF_THEN_CALL = new RegExp(`^${S}window${S}\\.${S}(${ID})${S}=${S}\\(${S}\\w+${S}\\)${S}=>${S}\\{[^{}]*\\{[^{}]*\\{[^{}]*\\}[^{}]*\\}[^{}]*\\}${S};${S}(?:window\\.)?(${ID})${S}\\(${S}${LIT}${S}\\)${S};?${S}$`);
const INLINE_CONST = new RegExp(`^${S}const${S}(${ID})${S}=${S}${LIT}${S};([\\s\\S]*)$`);

// classify a javascript_tool text on a Snowsight tab: { fill: true, read: bool, sql } | null
function snowFill(text, fillHelpers, mode) {
  const t = String(text);
  let m = CANON.exec(t);
  if (m) return { fill: true, read: sqlReadOnly(litText(m[1])), kind: 'canonical' };
  if (mode !== 'projected') return null;
  if ((m = CALL_ONLY.exec(t)) && fillHelpers.has(m[1]) && (!m[3] || (!RISKY_SCRIPT.test(m[3]) && !RELOAD.test(m[3]) && !/__\w+\s*\(/.test(m[3])))) return { fill: true, read: sqlReadOnly(litText(m[2])), kind: 'helper-call' };
  if ((m = DEF_THEN_CALL.exec(t)) && m[1] === m[3] && FILL_DEF.test(t) && !RISKY_SCRIPT.test(t.replace(/window\s*\.\s*\w+\s*=/, '').replace(/\.dispatch\(/, '.d(')))
    return { fill: true, read: sqlReadOnly(litText(m[4])), kind: 'def+call' };
  if ((m = INLINE_CONST.exec(t))) {
    const fd = FILL_DEF.exec(m[3]);
    if (fd && fd[1] === m[1] && !/\b(click|submit|location|open|fetch)\b/.test(m[3])) return { fill: true, read: sqlReadOnly(litText(m[2])), kind: 'inline-const' };
  }
  return null;
}
// a script that touches nothing: no risky pattern, no reload, no helper call, no typed write
const pureRead = (t, helpers, lenient) => !RISKY_SCRIPT.test(t) && !RELOAD.test(t) && !G.typedWrite(t) && (lenient || G.helperCalls(t, helpers).length === 0);

// ---------- replay ----------
function itemsOf(c) {
  const n = G.shortName(c.tool);
  return n === 'browser_batch' ? ((c.input && c.input.actions) || []).map(a => ({ name: a && a.name, input: (a && a.input) || {} })) : [{ name: n, input: c.input || {} }];
}
const READ_COMPUTER = new Set(['screenshot', 'wait', 'scroll', 'zoom', 'scroll_to', 'hover']);
const READ_TOOLS = new Set(['find', 'read_page', 'get_page_text', 'tabs_context_mcp', 'read_console_messages', 'read_network_requests', 'list_connected_browsers']);

function run(cfg) {
  const seen = new Set();
  const res = { before: 0, after: 0, tableau: 0, snowRun: 0, snowFill: 0, flipped: [], kept: { tableau: {}, snow: {} } };
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
          if (x.type === 'tool_use' && G.PREFIX.test(x.name)) { if (seen.has(x.id)) continue; seen.add(x.id); const o = { tool: x.name, input: x.input, result: '', err: false, ts: Date.parse(e.timestamp) }; list.push(o); byId[x.id] = o; }
          else if (x.type === 'tool_result' && byId[x.tool_use_id]) { byId[x.tool_use_id].result = G.responseText(x.content); byId[x.tool_use_id].err = !!x.is_error; }
        }
      }
      const st = G.newState();
      const ed = {};           // tabId -> { site, read }   (editor record)
      const fillHelpers = {}; const lastClear = {};  // site -> Set(names) whose last definition was a whole-editor replace (projection only)
      list.forEach((c, i) => {
        const r = G.decide(st, c.tool, c.input, opts);
        const items = itemsOf(c);
        const siteOf = id => { const t = st.tabs[String(id)]; return t && t.url ? G.hostOf(t.url) : null; };
        const recog = []; // per item: {kind, drop:Set}
        if (r.decision === 'ask') {
          res.before++;
          for (const it of items) {
            const inp = it.input || {};
            const site = siteOf(inp.tabId);
            let rec = null;
            if (it.name === 'javascript_tool' && site && TABLEAU_HOST.test(site) && cfg.tableau) {
              const tr = tableauRead(inp.text, cfg.direct);
              if (tr.ok) {
                // the rest must not call another stored helper (today's helper rule would apply to it)
                const others = G.helperCalls(tr.rest, st.helpers.filter(h => !tr.wrappers.includes(h)));
                if (!others.length) rec = { kind: 'tableau', drop: new Set(['risky-script', 'script-helper', 'helper-args']), methods: tr.methods };
                else res.kept.tableau['other helper'] = (res.kept.tableau['other helper'] || 0) + 1;
              } else if (/vizportal|__vz\b/.test(String(inp.text))) res.kept.tableau[tr.why.slice(0, 40)] = (res.kept.tableau[tr.why.slice(0, 40)] || 0) + 1;
            }
            if (it.name === 'javascript_tool' && site && SNOW_HOST.test(site) && cfg.snowFill) {
              const sf = snowFill(inp.text, fillHelpers[site] || new Set(), cfg.mode);
              if (sf && sf.read) rec = { kind: 'snowFill', drop: new Set(['risky-script', 'script-helper', 'helper-args']) };
            }
            if (it.name === 'computer' && inp.action === 'key' && site && SNOW_HOST.test(site) && RUN_KEY.test(String(inp.text || '')) && cfg.snowRun) {
              let e = ed[String(inp.tabId)];
              if (e && !(c.ts - e.ts <= 10 * 60e3)) e = null; // a record older than 10 minutes is not trusted
              if (e && e.read && !G.wordHit(String(inp.action_summary || ''))) rec = { kind: 'snowRun', drop: new Set(['word']) };
              else if (!e && cfg.mode === 'projected') (res.noRec = res.noRec || []).push(f.slice(0, 8) + ' #' + i + ' «' + inp.action_summary + '» last cleared by: ' + (lastClear[site] || lastClear['*'] || 'nothing (no fill seen)'));
              else res.kept.snow[!e ? 'no editor record' : !e.read ? 'editor not read-only' : 'danger word'] = (res.kept.snow[!e ? 'no editor record' : !e.read ? 'editor not read-only' : 'danger word'] || 0) + 1;
            }
            recog.push(rec);
          }
          // each recognized item's own causes must all be ones its rule answers
          const ok = items.map((it, k) => {
            if (!recog[k]) return false;
            const own = G.decide(st, T + it.name, it.input, opts);
            return own.decision === 'ask' && own.causes.every(x => recog[k].drop.has(x));
          });
          if (ok.some(Boolean)) {
            const mod = items.map((it, k) => ok[k] ? { name: 'computer', input: { action: 'screenshot', tabId: it.input.tabId } } : it);
            const r2 = items.length === 1 ? { decision: 'none', causes: [] } : G.decide(st, T + 'browser_batch', { actions: mod }, opts);
            if (r2.decision === 'none') {
              r.decision = 'none'; r.causes = []; r.hosts = [];
              const kinds = items.map((it, k) => ok[k] && recog[k].kind).filter(Boolean);
              for (const k of kinds) res[k === 'tableau' ? 'tableau' : k]++;
              res.flipped.push({ f: f.slice(0, 8), i, kinds, what: items.map((it, k) => ok[k] ? (recog[k].kind === 'tableau' ? 'methods ' + [...new Set(recog[k].methods)].join(',') : recog[k].kind === 'snowRun' ? 'key ' + it.input.text + ' «' + it.input.action_summary + '» sql: ' + ed[String(it.input.tabId)].sql.slice(0, 90) : 'fill') : null).filter(Boolean) });
            }
          }
          if (r.decision === 'ask') res.after++;
        }
        G.countCall(st, r);
        const pend = r.decision === 'ask' && (r.hosts.length || (r.untainted || []).length) ? { hosts: r.hosts, unmark: r.untainted || [] } : null;
        G.applyDecision(st, r);
        // editor records and fill helpers, as the call ran (a denied call did not run)
        if (r.decision !== 'deny') {
          for (const it of items) {
            const inp = it.input || {};
            const id = String(inp.tabId), site = siteOf(inp.tabId) || (G.shortName(c.tool) === 'navigate' ? G.hostOf(inp.url) : null);
            if (it.name === 'select_browser' || it.name === 'switch_browser') { for (const k of Object.keys(ed)) delete ed[k]; continue; }
            if (it.name === 'javascript_tool' && site && SNOW_HOST.test(site)) {
              const t = String(inp.text || '');
              // remember home-made fill definitions (projection), and forget a redefinition of anything else
              const defs = [...t.matchAll(/\bwindow\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g)].map(x => x[1]);
              if (defs.length) {
                const set = fillHelpers[site] = fillHelpers[site] || new Set();
                for (const n of defs) { const body = t.slice(t.indexOf(n)); if (FILL_DEF.test(body.slice(0, 700)) && /iframe/.test(body.slice(0, 300))) set.add(n); else set.delete(n); }
              }
              const sf = snowFill(t, fillHelpers[site] || new Set(), cfg.mode);
              if (process.env.DBG && f.startsWith(process.env.DBG)) console.error(i, site, [...(fillHelpers[site] || [])].join(','), sf && sf.kind, sf && sf.read, c.err, t.slice(0, 60).replace(/\s+/g, ' '));
              if (sf && !c.err) {
                // set only when the fill reports back the editor length the gate expects (the decoded text's length)
                const lm = t.match(new RegExp(LIT)); const val = lm ? litText(lm[1]) : null;
                const got = (String(c.result).match(/\d+/) || [])[0];
                if (process.env.DBG && f.startsWith(process.env.DBG)) console.error('LEN', i, got, val && val.length, JSON.stringify(String(c.result).slice(0, 80)));
                // (past home-made fills returned other things, e.g. "1"; the standard fill returns the length, so the
                // projection does not hold them to it)
                if (val != null && (sf.kind !== 'canonical' || (got != null && +got === val.length))) ed[id] = { site, read: sf.read, sql: val.replace(/\s+/g, ' '), ts: c.ts };
                else { for (const k of Object.keys(ed)) if (ed[k].site === site) delete ed[k]; res.lenMismatch = (res.lenMismatch || 0) + 1; }
                continue;
              }
              if (pureRead(t, st.helpers, cfg.lenient) && !c.err) continue;
            } else if (cfg.typedAsFill && site && SNOW_HOST.test(site) && it.name === 'computer' && inp.action === 'type' && !c.err) {
              // ceiling: a typed query, had it been put in with the standard fill instead
              const sq = String(inp.text || ''); ed[id] = { site, read: sqlReadOnly(sq), sql: sq.replace(/\s+/g, ' '), ts: c.ts }; continue;
            } else if (it.name === 'computer' && READ_COMPUTER.has(inp.action)) continue;
            else if (READ_TOOLS.has(it.name)) continue;
            // the run key uses the record up (one run per fill)
            else if (it.name === 'computer' && inp.action === 'key' && RUN_KEY.test(String(inp.text || '')) && ed[id] && !c.err) { delete ed[id]; continue; }
            else if (it.name === 'tabs_create_mcp' || it.name === 'tabs_close_mcp') continue;
            // anything else touches the site: forget every editor record on that site (or all, if the site is not known)
            for (const k of Object.keys(ed)) if (!site || ed[k].site === site) delete ed[k];
            if (site && SNOW_HOST.test(site) || !site) lastClear[site || '*'] = it.name + ':' + (inp.action || '') + ' ' + String(inp.action_summary || inp.text || inp.url || '').replace(/s+/g, ' ').slice(0, 90);
          }
        } else {
          // a denied call ran nothing
        }
        if (r.decision !== 'deny') G.record(st, c.tool, c.input, c.result, pend ? pend.hosts : [], c.err, pend ? pend.unmark : []);
      });
    }
  }
  return res;
}

const cfgs = {
  baseline: { },
  tableau: { tableau: true },
  tableau_with_direct: { tableau: true, direct: true },
  snowRun_strict: { snowRun: true, snowFill: false, mode: 'strict' },
  snowRun_projected: { snowRun: true, snowFill: false, mode: 'projected' },
  snowRun_projected_lenient: { snowRun: true, snowFill: false, mode: 'projected', lenient: true },
  snowFill_projected: { snowFill: true, mode: 'projected' },
  both_projected: { tableau: true, snowRun: true, mode: 'projected' },
  all_projected: { tableau: true, snowRun: true, snowFill: true, mode: 'projected' },
  snowRun_ceiling: { snowRun: true, mode: 'projected', typedAsFill: true },
  all_ceiling: { tableau: true, snowRun: true, snowFill: true, mode: 'projected', typedAsFill: true },
};
const summary = {};
for (const [k, cfg] of Object.entries(cfgs)) {
  const r = run(cfg);
  if (k === 'baseline') summary.base = r.before;
  summary[k] = { asks: r.after, removed: summary.base - r.after, pct: (100 * (summary.base - r.after) / summary.base).toFixed(1) + '%', tableau: r.tableau, snowRun: r.snowRun, snowFill: r.snowFill, lenMismatch: r.lenMismatch || 0 };
  if (k === 'all_projected' || k === 'tableau') { summary[k].keptTableau = r.kept.tableau; summary[k].keptSnow = r.kept.snow; }
  if (LIST && k === 'all_projected' && r.noRec) fs.writeFileSync(path.join(__dirname, 'norecord.txt'), r.noRec.join('\n'));
  if (LIST && k === 'all_ceiling') fs.writeFileSync(path.join(__dirname, 'flipped-ceiling.txt'), r.flipped.map(x => x.f + ' #' + x.i + ' ' + x.kinds.join('+') + ' :: ' + x.what.join(' | ')).join('\n'));
  if (LIST && k === 'all_projected') fs.writeFileSync(path.join(__dirname, 'flipped.txt'), r.flipped.map(x => x.f + ' #' + x.i + ' ' + x.kinds.join('+') + ' :: ' + x.what.join(' | ')).join('\n'));
}
console.log(JSON.stringify(summary, null, 1));
