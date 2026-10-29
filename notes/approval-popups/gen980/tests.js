// GEN-980 Rule A tests: the working copy wc/browser-site-gate.js against the live gate.
//  1. shape tests (what passes, what still asks), on the decide() of the working copy;
//  2. real-transcript replay: every call on this PC decided by the live gate and by the working copy,
//     each with its own state; every difference listed and classified (a Tableau read let through is the
//     only allowed new 'none'; anything else is a FAIL);
//  3. end-to-end through the real hook process (stdin payloads, fixture state dir and log).
// Usage: node tests.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const WCF = path.join(__dirname, 'wc', 'browser-site-gate.js');
const LIVEF = path.join(process.env.USERPROFILE, '.claude', 'hooks', 'browser-site-gate.js');
const W = require(WCF), L = require(LIVEF);
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); } };
const T = 'mcp__claude-in-chrome__';
const opts = { adminConsolesHighStakes: W.ADMIN_CONSOLES_HIGH_STAKES };
const TAB = 'https://us-west-2b.online.tableau.com/#/site/muuula/home';

// ---------------------------------------------------------------- 1. shapes
const X = "const x = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/)||[])[1]||''); ";
const NOTES = X + "const vz = async (m, p) => (await fetch('/vizportal/api/web/v1/' + m, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-XSRF-TOKEN': x}, body: JSON.stringify({method: m, params: p})})).json();\n";
const SHORT = X + "const call = async (method, params) => (await fetch('/vizportal/api/web/v1/'+method, {method:'POST', headers:{'Content-Type':'application/json;charset=UTF-8','X-XSRF-TOKEN':x}, body: JSON.stringify({method, params})})).json();\n";
const THEN = X + "const call=(m,p)=>fetch(\"/vizportal/api/web/v1/\"+m,{method:\"POST\",headers:{\"Content-Type\":\"application/json\",\"X-XSRF-TOKEN\":x},body:JSON.stringify({method:m,params:p})}).then(r=>r.json());\n";
const st0 = () => { const s = W.newState(); s.tabs['7'] = { url: TAB, stale: false, taint: false }; s.approved['us-west-2b.online.tableau.com'] = true; return s; };
const js = (text, extra) => ({ action: 'javascript_exec', tabId: 7, text, ...(extra || {}) });
const dec = (text, s) => W.decide(s || st0(), T + 'javascript_tool', js(text), opts);
const passes = (name, text) => { const r = dec(text); ok('passes: ' + name, r.decision === 'none' && r.waived.length === 1, r); };
const asks = (name, text, s) => { const r = dec(text, s); ok('asks: ' + name, r.decision === 'ask', r); };

passes('the notes text', NOTES + "const w = await vz('getWorkbooks', {page:{startIndex:0,maxItems:200}}); w.result.workbooks.map(b=>b.name).join(' | ')");
passes('shorthand body with method/params names', SHORT + "const d = await call('getDatasources', {page:{startIndex:0,maxItems:200}}); JSON.stringify(d.result.totalCount)");
passes('then form, double quotes', THEN + "await call('getExtractTasks',{page:{startIndex:0,maxItems:100}})");
passes('default params', X + "const vz = async (m, p = {}) => (await fetch('/vizportal/api/web/v1/' + m, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-XSRF-TOKEN': x}, body: JSON.stringify({method: m, params: p})})).json();\nawait vz('getSessionInfo')");
passes('every listed method', NOTES + [...W.TABLEAU_READS].map(m => "await vz('" + m + "', {});").join(' '));
passes('loop with literal calls and setTimeout', NOTES + "let last=''; for (let i=0;i<3;i++){ await new Promise(r=>setTimeout(r,1000)); const t = await vz('getExtractTasks',{}); last = t.result.totalCount; } last");
ok('waived log item names methods', JSON.stringify(dec(NOTES + "await vz('getWorkbooks',{}); await vz('getUsers',{})").waived) === JSON.stringify([{ rule: 'tableau-read', host: 'us-west-2b.online.tableau.com', methods: ['getWorkbooks', 'getUsers'] }]));

asks('unlisted method (delete)', NOTES + "await vz('deleteDatasources', {ids:['1']})");
asks('unlisted method (refresh)', NOTES + "await vz('refreshExtracts', {ids:['1']})");
asks('unlisted get', NOTES + "await vz('getSecretThing', {})");
asks('method in a variable', NOTES + "const k='getWorkbooks'; await vz(k, {})");
asks('loop over method names', NOTES + "for (const [k,p] of [['getFlows',{}],['getUsers',{}]]) await vz(k,p)");
asks('wrapper passed around', NOTES + "[1].map(()=>vz)");
asks('wrapper re-bound', NOTES.replace('const vz', 'let vz') + "vz = (a,b)=>fetch('/x',{method:'DELETE'}); await vz('getWorkbooks',{})");
asks('call before declaration', "await vz('getWorkbooks', {}); " + NOTES);
asks('second fetch', NOTES + "await vz('getWorkbooks',{}); await fetch('/vizportal/api/web/v1/deleteDatasources',{method:'POST'})");
asks('direct fetch form', X + "await fetch('/vizportal/api/web/v1/getWorkbooks',{method:'POST',headers:{'Content-Type':'application/json','X-XSRF-TOKEN':x},body:JSON.stringify({method:'getWorkbooks',params:{}, method:'deleteDatasources'})})");
asks('window. assignment', NOTES + "window.__wb = await vz('getWorkbooks',{})");
asks('unicode escape', NOTES + "await v\\u007a('deleteDatasources',{})");
asks('wrapper with an extra statement', X + "const vz = async (m, p) => { m = 'deleteDatasources'; return (await fetch('/vizportal/api/web/v1/' + m, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-XSRF-TOKEN': x}, body: JSON.stringify({method: m, params: p})})).json(); };\nawait vz('getWorkbooks',{})");
asks('body names a fixed method', X + "const vz = async (m, p) => (await fetch('/vizportal/api/web/v1/' + m, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-XSRF-TOKEN': x}, body: JSON.stringify({method: 'deleteDatasources', params: p})})).json();\nawait vz('getWorkbooks',{})");
asks('GET-less verb (DELETE)', NOTES.replace("method: 'POST'", "method: 'DELETE'") + "await vz('getWorkbooks',{})");
asks('mismatched quotes', NOTES.replace("'/vizportal/api/web/v1/'", "'/vizportal/api/web/v1/\"") + "await vz('getWorkbooks',{})");
asks('mixed shorthand', X + "const call = async (method, p) => (await fetch('/vizportal/api/web/v1/'+method, {method:'POST', headers:{'Content-Type':'application/json','X-XSRF-TOKEN':x}, body: JSON.stringify({method, params: p})})).json();\nawait call('getWorkbooks',{})");
asks('different path', NOTES.replace('/vizportal/api/web/v1/', '/api/3.1/') + "await vz('getWorkbooks',{})");
asks('name in a string', NOTES + "await vz('getWorkbooks',{}); 'vz'");
asks('click in the rest', NOTES + "await vz('getWorkbooks',{}); document.querySelector('button').click()");
asks('database write text', NOTES + "await vz('getWorkbooks',{}); 'DROP TABLE t'");
(() => { const s = st0(); s.helpers.push('vz'); asks('wrapper name is a stored helper', NOTES + "await vz('getWorkbooks',{})", s); })();
(() => { const s = st0(); s.tabs['7'].url = 'https://example.com/x'; s.approved['example.com'] = true; asks('same script on another site', NOTES + "await vz('getWorkbooks',{})", s); })();
(() => { const s = st0(); s.tabs['7'].url = 'https://evil.online.tableau.com.example.org/'; asks('look-alike host', NOTES + "await vz('getWorkbooks',{})", s); })();
(() => { const s = st0(); s.helpers.push('__q'); asks('rest calls a stored helper (first call per site asks)', NOTES + "await vz('getWorkbooks',{}); __q('x')", s); })();
(() => { const s = st0(); delete s.tabs['7']; asks('unknown tab', NOTES + "await vz('getWorkbooks',{})", s); })();
// review findings (Pass A): unicode names, nested calls, long whitespace, a stored helper called alongside
// (a longer name is another function: it stays in the rest, judged by today's rules, not blanked as a read)
ok('a longer non-ASCII name ending in the wrapper name is not blanked', (W.tableauRead(NOTES + "await vz('getWorkbooks',{}); await ævz('deleteDatasources',{})", []).rest || '').includes('ævz(\'deleteDatasources\''));
asks('a longer non-ASCII name starting with it', NOTES + "await vzæ('getWorkbooks',{})");
passes('nested wrapper calls', NOTES + "await vz('getWorkbooks', await vz('getSessionInfo',{}))");
(() => { const t0 = Date.now(); const r = dec('const a = (b, c' + ' '.repeat(50000) + ' x'); ok('long whitespace after a head prefix is fast', Date.now() - t0 < 500 && r.decision !== undefined, Date.now() - t0); })();
(() => { const t0 = Date.now(); dec(NOTES.replace('(m, p)', '(m, p' + ' '.repeat(50000))); ok('long whitespace inside a near-wrapper is fast', Date.now() - t0 < 500, Date.now() - t0); })();
(() => { const s = st0(); s.helpers.push('__q'); s.approved['helper:us-west-2b.online.tableau.com:__q'] = true; const r = dec(NOTES + "await vz('getWorkbooks',{}); __q(\"select 1\")", s);
  ok('read + an approved stored helper with a read-only query goes ahead (rest judged by the helper rule)', r.decision === 'none', r);
  const r2 = dec(NOTES + "await vz('getWorkbooks',{}); __q(\"DELETE FROM t\")", s); ok('read + an approved helper with a write asks', r2.decision === 'ask', r2); })();
ok('a script with no session API call is not a read', W.tableauRead('const vz = 1', []).ok === false);
// review findings (Pass B): a wrapper remembered across scripts, dotted uses, shadowed fetch/JSON, escapes, stale tab
const after = (first, s) => { s = s || st0(); const r = W.decide(s, T + 'javascript_tool', js(first), opts); W.applyDecision(s, r); return s; };
(() => { const s = after(NOTES + "await vz('getWorkbooks',{})");
  ok('the read is remembered by its wrapper name', JSON.stringify(s.wrappers) === '["vz"]', s.wrappers);
  asks('a later script reaching the wrapper with a delete', "await vz('deleteDatasources',{ids:['1']})", s);
  asks('a later script passing the wrapper around', "const f = vz; await f('deleteDatasources',{})", s);
  asks('a later script using the wrapper with a method in a variable', "const k='refreshExtracts'; await vz(k,{})", s);
  ok('a later script reaching the wrapper with a delete marks the tab moved', W.decide(s, T + 'javascript_tool', js("await vz('deleteDatasources',{})"), opts).moved.includes('7'));
  const s2 = Object.assign(W.newState(), { wrappers: s.wrappers }); s2.tabs['9'] = { url: 'https://example.com/', stale: false, taint: false };
  ok('...on any site', W.decide(s2, T + 'javascript_tool', { action: 'javascript_exec', tabId: 9, text: "vz('deleteDatasources',{})" }, opts).decision === 'ask');
  ok('a later listed read without declaring it goes ahead (no request text of its own)', dec("await vz('getWorkbooks',{})", s).decision === 'none');
  ok('a later script declaring it again is judged as a new read', dec(NOTES + "await vz('getUsers',{})", s).decision === 'none');
  ok('saved state keeps the names', JSON.stringify(W.normalizeState(JSON.parse(JSON.stringify(s))).wrappers) === '["vz"]'); })();
asks('a var wrapper (a property of window) is not let through', NOTES.replace('const vz', 'var vz') + "await vz('getWorkbooks',{})");
asks('a comment in the script', NOTES + "// read\nawait vz('getWorkbooks',{})");
asks('a comment hiding the declaration', X + "const m='deleteDatasources', p={};\n// const vz = async (m, p) =>\nfetch('/vizportal/api/web/v1/' + m, {method:'POST', headers:{'Content-Type':'application/json','X-XSRF-TOKEN':x}, body: JSON.stringify({method:m, params:p})}).then(r => r.json());\n// vz('getWorkbooks')");
asks('JSON as a parameter name', X + "const vz = async (m, JSON) => (await fetch('/vizportal/api/web/v1/' + m, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-XSRF-TOKEN': x}, body: JSON.stringify({method: m, params: JSON})})).json();\nawait vz('getWorkbooks',{stringify:()=>'{}'})");
asks('rest aliases fetch', NOTES + "const f = fetch; await vz('getWorkbooks',{})");
asks('rest patches JSON.stringify', NOTES + "JSON.stringify = () => '{\"method\":\"deleteDatasources\"}'; await vz('getWorkbooks',{})");
asks('rest patches a prototype', NOTES + "Object.prototype.toJSON = function(){ return {method:'deleteDatasources'} }; await vz('getWorkbooks',{})");
passes('rest uses JSON.stringify for its output', NOTES + "const w = await vz('getWorkbooks',{}); JSON.stringify(w.result.totalCount)");
(() => { const s = after(NOTES.replace('const vz', 'var vz') + "await vz('getWorkbooks',{})");
  ok('a var wrapper (asked) is still remembered', JSON.stringify(s.wrappers) === '["vz"]', s.wrappers);
  for (const g of ['window.vz', 'globalThis.vz', 'self.vz', 'this.vz', 'window?.vz', "window['vz']", 'top.vz'])
    asks('a later script reaching the remembered wrapper as ' + g, 'await ' + g + "('deleteDatasources',{})", s);
  ok('a later unrelated .call( is not a use', dec("[1].map(function(){ return 1 }).call(null)", Object.assign(st0(), { wrappers: ['call'] })).decision === 'none');
  asks('a later script with an escaped name', "await v\\u{7a}('deleteDatasources',{})", s); })();
(() => { const s = st0(); const r = W.decide(s, T + 'javascript_tool', js(NOTES.replace(/vz/g, 'v' + 'z'.repeat(70)) + "await v" + 'z'.repeat(70) + "('getWorkbooks',{})"), opts);
  ok('a wrapper name longer than the saved state keeps is not let through', r.decision === 'ask', r); })();
(() => { const s = st0(); W.record(s, T + 'javascript_tool', js(NOTES + "await vz('getWorkbooks',{})"), 'ok', [], false, []);
  ok('record() remembers the wrapper too (a lost PreToolUse save)', JSON.stringify(s.wrappers) === '["vz"]', s.wrappers);
  const s2 = st0(); W.record(s2, T + 'browser_batch', { actions: [{ name: 'select_browser', input: {} }, { name: 'javascript_tool', input: js(NOTES + "await vz('getWorkbooks',{})") }] }, 'ok', [], false, []);
  ok('record() remembers it across a browser switch', JSON.stringify(s2.wrappers) === '["vz"]', s2.wrappers); })();
(() => { const r = W.decide(st0(), T + 'browser_batch', { actions: [{ name: 'javascript_tool', input: js(NOTES + "await vz('getWorkbooks',{})") }, { name: 'javascript_tool', input: js("await vz('deleteDatasources',{})") }] }, opts);
  ok('batch: declare then misuse in the next item asks', r.decision === 'ask', r); })();
(() => { const s = st0(); s.tabs['7'].stale = true; const r = dec(NOTES + "await vz('getWorkbooks',{})", s); ok('tab last seen on Tableau but possibly moved: a listed read to its own address goes ahead', r.decision === 'none' && r.waived.length === 1, r); })();
asks('dotted use of the wrapper (var on window)', NOTES.replace('const vz', 'var vz') + "await vz('getWorkbooks',{}); await window.vz('deleteDatasources',{})");
(() => { const s = st0(); s.helpers.push('fetch'); asks('fetch stored by an earlier script', NOTES + "await vz('getWorkbooks',{})", s); })();
(() => { const s = st0(); s.helpers.push('JSON'); asks('JSON stored by an earlier script', NOTES + "await vz('getWorkbooks',{})", s); })();
asks('escaped name with \\u{..}', NOTES + "await vz('getWorkbooks',{}); await v\\u{7a}('deleteDatasources',{})");
// a recognized read does not mark its tab moved; an unrecognized script still does
ok('recognized read leaves tab sure', dec(NOTES + "await vz('getWorkbooks',{})").moved.length === 0);
ok('unrecognized fetch marks tab moved', dec(NOTES + "await vz('deleteDatasources',{})").moved.includes('7'));
// a batch: a click on the same tab after a recognized read is judged as before (here: denied? no -- tab still sure, summary decides)
(() => { const r = W.decide(st0(), T + 'browser_batch', { actions: [{ name: 'javascript_tool', input: js(NOTES + "await vz('getWorkbooks',{})") }, { name: 'computer', input: { action: 'left_click', tabId: 7, coordinate: [1, 1], action_summary: 'Deletes the workbook' } }] }, opts);
  ok('batch: read then a delete click still asks', r.decision === 'ask' && r.causes.includes('word'), r); })();

// ---------------------------------------------------------------- 2. real-transcript replay
const strip = r => { const o = Object.assign({}, r); delete o.waived; delete o.newWrappers; return JSON.stringify(o); };
let calls = 0, files = 0, same = 0, waivedFlips = 0, otherDiffs = 0, sameButNarrower = 0;
const narrower = [];
const flipMethods = {}, seen = new Set(), diffs = [];
const root = path.join(process.env.USERPROFILE, '.claude', 'projects');
for (const d of fs.readdirSync(root)) {
  let fl; try { fl = fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of fl) {
    const raw = fs.readFileSync(path.join(root, d, f), 'utf8');
    if (!/hrome__/.test(raw)) continue;
    const list = [], byId = {};
    for (const line of raw.split('\n')) {
      if (!line.includes('hrome') && !line.includes('tool_result')) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.isSidechain) continue;
      const c = e.message && e.message.content; if (!Array.isArray(c)) continue;
      for (const x of c) {
        if (x.type === 'tool_use' && L.PREFIX.test(x.name)) { if (seen.has(x.id)) continue; seen.add(x.id); const o = { tool: x.name, input: x.input, result: '', err: false }; list.push(o); byId[x.id] = o; }
        else if (x.type === 'tool_result' && byId[x.tool_use_id]) { byId[x.tool_use_id].result = L.responseText(x.content); byId[x.tool_use_id].err = !!x.is_error; }
      }
    }
    if (!list.length) continue;
    files++;
    const sl = L.newState(), sw = W.newState();
    for (const c of list) {
      calls++;
      const rl = L.decide(sl, c.tool, c.input, opts), rw = W.decide(sw, c.tool, c.input, opts);
      if (strip(rl) === strip(rw)) same++;
      else if (rl.decision === 'ask' && rw.decision === 'none' && rw.waived.length && rl.causes.every(x => ['risky-script', 'script-helper', 'helper-args'].includes(x))) {
        waivedFlips++; for (const w of rw.waived) for (const m of w.methods) flipMethods[m] = (flipMethods[m] || 0) + 1;
      } else if (rl.decision === rw.decision && rw.causes.every(x => rl.causes.includes(x)) && rl.causes.filter(x => !rw.causes.includes(x)).every(x => x === 'risky-script') && rw.decision !== 'none') {
        // still asks (or is denied) for its other causes; only the risky-script cause of a recognized read is gone
        sameButNarrower++; if (narrower.length < 5) narrower.push(f.slice(0, 8) + ' ' + rl.decision + ':' + rl.causes + ' -> ' + rw.causes);
      } else { otherDiffs++; if (diffs.length < 8) diffs.push(f.slice(0, 8) + ' ' + rl.decision + ':' + rl.causes + ' -> ' + rw.decision + ':' + rw.causes); }
      for (const [M, st, r] of [[L, sl, rl], [W, sw, rw]]) {
        M.countCall(st, r);
        const pend = r.decision === 'ask' && (r.hosts.length || (r.untainted || []).length) ? { hosts: r.hosts, unmark: r.untainted || [] } : null;
        M.applyDecision(st, r);
        if (r.decision !== 'deny') M.record(st, c.tool, c.input, c.result, pend ? pend.hosts : [], c.err, pend ? pend.unmark : []);
      }
    }
  }
}
console.log('replay:', JSON.stringify({ files, calls, same, tableauReadsLetThrough: waivedFlips, stillAskNarrowerCause: sameButNarrower, otherDiffs, flipMethods }));
for (const x of diffs) console.log('  diff', x);
for (const x of narrower) console.log('  still asks', x);
ok('replay: every let-through call is a listed read', Object.keys(flipMethods).every(m => W.TABLEAU_READS.has(m)));
ok('replay: no other decision differs', otherDiffs === 0, diffs);

// ---------------------------------------------------------------- 3. end-to-end, real hook process
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'gen980-e2e-'));
const run = (file, payload) => {
  const env = Object.assign({}, process.env, { BROWSER_GATE_STATE_DIR: path.join(FIX, path.basename(file) + '-state'), BROWSER_GATE_LOG: path.join(FIX, path.basename(path.dirname(file)) + '-log.jsonl') });
  const r = cp.spawnSync(process.execPath, [file], { input: JSON.stringify(payload), encoding: 'utf8', env });
  let d = 'none'; try { d = JSON.parse(r.stdout).hookSpecificOutput.permissionDecision || 'none'; } catch (e) { /* no output */ }
  return { code: r.status, d };
};
const ctx = 'Tab Context:\n- Available tabs:\n  • tabId 7: "Home" ("' + TAB + '")\n';
for (const [label, file] of [['live', LIVEF], ['wc', WCF]]) {
  const sid = 'e2e-' + label;
  run(file, { hook_event_name: 'PreToolUse', session_id: sid, tool_name: T + 'tabs_context_mcp', tool_input: {}, tool_use_id: 'a' });
  run(file, { hook_event_name: 'PostToolUse', session_id: sid, tool_name: T + 'tabs_context_mcp', tool_input: {}, tool_use_id: 'a', tool_response: [{ type: 'text', text: ctx }] });
  const r1 = run(file, { hook_event_name: 'PreToolUse', session_id: sid, tool_name: T + 'javascript_tool', tool_input: js(NOTES + "await vz('getWorkbooks',{})"), tool_use_id: 'b' });
  const r2 = run(file, { hook_event_name: 'PreToolUse', session_id: sid, tool_name: T + 'javascript_tool', tool_input: js(NOTES + "await vz('deleteDatasources',{ids:['1']})"), tool_use_id: 'c' });
  if (label === 'live') { ok('e2e live: read asks today', r1.d === 'ask', r1); ok('e2e live: delete asks', r2.d === 'ask', r2); }
  else {
    ok('e2e wc: read goes ahead with no pop-up', r1.code === 0 && r1.d === 'none', r1);
    ok('e2e wc: delete asks', r2.d === 'ask', r2);
    const log = fs.readFileSync(path.join(FIX, 'wc-log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    ok('e2e wc: waived line logged with methods, no page text', log.some(l => l.event === 'waived' && l.decision === 'none' && l.items[0].methods[0] === 'getWorkbooks' && !JSON.stringify(l).includes('XSRF')), log);
  }
}
fs.rmSync(FIX, { recursive: true, force: true });

console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
