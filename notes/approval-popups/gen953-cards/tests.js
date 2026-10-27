// GEN-953 step 2 tests (design v2.1): the plain-words pop-up text of the browser gate working copy.
// The opening sentence of every cause and the closed list of serious additions are written out here,
// independently of the code: every card is checked against them (allow-list), so a milder or new phrase
// added to the code fails. Plus an oracle over hidden dangerous statements, named cases from the reviews,
// and end-to-end runs of the real hook process, comparing the decision with the live hook.
// Usage: node tests.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const WC = path.join(__dirname, 'wc', 'browser-site-gate.js');
const LIVE = path.join(process.env.USERPROFILE, '.claude', 'hooks', 'browser-site-gate.js');
const W = require(WC);
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

// ---------------------------------------------------------------- the committed wording (design-v2.1.md)
const { SEVERE_SQL, SEVERE_JS, FLOOR, leftover, claudeLast, claudePlaced, cardOk } = require('./cardcheck.js');
const wordPlaced = t => claudePlaced({ causes: ['word'] }, t);

const typed = t => [{ kind: 'typed', text: t }];
const script = t => [{ kind: 'script', text: t }];
const kinds = t => W.sqlKind(typed(t)).kinds;
const res = o => Object.assign({ decision: 'ask', causes: [], hosts: [], notes: [], texts: [], claims: [], where: [] }, o);
let t;

// ---------------------------------------------------------------- SQL: serious kinds only
ok('sql drop', kinds('DROP TABLE t')[0] === SEVERE_SQL[0]);
ok('sql delete', kinds('delete from x where 1=1')[0] === SEVERE_SQL[0]);
ok('sql truncate', kinds('TRUNCATE TABLE a')[0] === SEVERE_SQL[0]);
ok('sql remove stage', kinds('REMOVE @mystage/x')[0] === SEVERE_SQL[0]);
ok('sql insert overwrite deletes', kinds('INSERT OVERWRITE INTO t SELECT * FROM s')[0] === SEVERE_SQL[0]);
ok('sql merge then delete deletes', kinds('MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE')[0] === SEVERE_SQL[0]);
ok('sql grant', kinds('GRANT SELECT ON t TO ROLE r')[0] === SEVERE_SQL[1]);
ok('sql create user', kinds('CREATE USER bob')[0] === SEVERE_SQL[1]);
ok('sql copy into stage', kinds('COPY INTO @ext/out FROM t')[0] === SEVERE_SQL[2]);
ok('sql create or replace', kinds('CREATE OR REPLACE PROCEDURE p() ...')[0] === SEVERE_SQL[3]);
ok('sql alter table', kinds('alter table t add column c int')[0] === SEVERE_SQL[3]);
ok('sql call', kinds('CALL my_proc(1)')[0] === SEVERE_SQL[4]);
ok('sql system$', kinds('select system$cancel_query(1)')[0] === SEVERE_SQL[4]);
ok('sql mild kinds never named', ['INSERT INTO t VALUES (1)', 'update t set a = 1', 'merge into t using s on 1=1 when matched then update set a=1', 'create table t (a int)', 'COPY INTO t FROM @s', 'replace into b values (1)'].every(q => kinds(q).length === 0));
ok('sql every serious kind, worst first', JSON.stringify(kinds('GRANT OWNERSHIP ON DATABASE prod TO ROLE public; DELETE FROM tmp_x')) === JSON.stringify([SEVERE_SQL[0], SEVERE_SQL[1]]));
ok('sql string value set aside', kinds("select * from h where q ilike 'create or replace procedure%'").length === 0);
ok('sql doubled quote in value', kinds("select 'it''s drop table x' as a").length === 0);
ok('sql use role is not a change', kinds('USE ROLE ACCOUNTADMIN').length === 0);
ok('sql comment marker in a value hides nothing', kinds("insert into t values ('--'); drop table t; select '--'")[0] === SEVERE_SQL[0]);
ok('sql backslash quote hides nothing', kinds("insert into t values ('a\\'b'); drop table x; select 'c'")[0] === SEVERE_SQL[0]);
ok('sql quote in a comment hides nothing', kinds("-- it's here\ninsert into t values (1); drop table t -- '")[0] === SEVERE_SQL[0]);
ok('sql mysql 1--1 hides nothing', kinds('INSERT INTO audit VALUES (1--1); DROP TABLE users')[0] === SEVERE_SQL[0]);
ok('sql in script quotes only', W.sqlKind(script('run("DROP TABLE t")')).kinds[0] === SEVERE_SQL[0]);
ok('sql js delete is not sql', W.sqlKind(script('delete obj.x; const update = 1;')).kinds.length === 0);
ok('sql cross-string apostrophe hides nothing', W.sqlKind(script('const l = "Yakir\'s grants"; ed.setValue("DELETE FROM app.grants WHERE g = \'Y\'")')).kinds[0] === SEVERE_SQL[0]);
ok('sql open value noted', W.sqlKind(typed("insert into t values ('it's')")).open === true && W.sqlKind(typed("insert into t values ('a')")).open === false);
ok('sql escaped value is not open', W.sqlKind(typed("insert into t values ('it\\'s')")).open === false);
ok('sql empty', W.sqlKind([]).kinds.length === 0 && W.sqlKind(undefined).kinds.length === 0);

// ---------------------------------------------------------------- script: serious kinds only
const sk = s => W.scriptKinds(script(s));
ok('js fetch', sk('fetch("/api")')[0] === SEVERE_JS[1]);
ok('js click', sk('document.querySelector("b").click()')[0] === SEVERE_JS[2]);
ok('js navigate', sk('location.assign("/x")')[0] === SEVERE_JS[3]);
ok('js storage', sk('localStorage.setItem("a","b")')[0] === SEVERE_JS[4]);
ok('js hidden first', sk('b.click(); eval(atob("eA=="))')[0] === SEVERE_JS[0]);
ok('js page edit never named', sk('el.value = "x"; el.appendChild(n)').length === 0);
ok('js send named before navigate', JSON.stringify(sk('location.assign("/y"); fetch("/x", {method: "POST"})')) === JSON.stringify([SEVERE_JS[1], SEVERE_JS[3]]));
ok('js xhr.open is not navigation', JSON.stringify(sk('const x=new XMLHttpRequest(); x.open("GET","/a"); x.send()')) === JSON.stringify([SEVERE_JS[1]]));
ok('js typed text ignored', W.scriptKinds(typed('fetch(')).length === 0);

// ---------------------------------------------------------------- opening sentences, per cause
const one = (c, o) => W.plainReason(res(Object.assign({ causes: [c] }, o || {})));
for (const c of Object.keys(FLOOR)) {
  t = one(c, { hosts: ['example.com'], notes: [c === 'high-stakes' ? 'mail.google.com' : 'example.org', '"Clicks OK"'], texts: script('x()'), claims: [{ text: 'Clicks OK', danger: false }] });
  ok('floor ' + c, FLOOR[c].test(t) && leftover(t) === '' && claudePlaced({ causes: [c] }, t), t);
}
for (const c of ['always-file_upload', 'always-upload_image', 'always-shortcuts_execute', 'always-gif-drop', 'nav-history', 'unreadable-url', 'non-web-url', 'non-web-tab', 'no-state', 'unreadable-batch', 'deny-loop-no-summary', 'deny-loop-stale-tab', 'unknown-tool:weird']) {
  t = one(c);
  ok('fixed ' + c, leftover(t) === '' && !/\bgate\b/.test(t), t);
}
ok('change causes get the caution', ['word', 'typed-write', 'risky-script', 'no-state', 'unknown-tool:x', 'deny-loop-stale-tab'].every(c => /Undo not guaranteed; allow only if expected\./.test(one(c))));
ok('first visit alone: no caution, full sentence', (t = one('new-site', { hosts: ['a.com'] })) === 'First action on a.com this session. If allowed, Claude can look around and search there without asking; changes, sends and deletes still ask.', t);
t = W.plainReason(res({ causes: ['new-site', 'word'], hosts: ['a.com'], notes: ['a.com', '"Clicks Apply"'], claims: [{ text: 'Clicks Apply', danger: false }] }));
ok('first visit with a change: short sentence, after the change', t.indexOf('May change') < t.indexOf('Also the first action on a.com') && !/still ask/.test(t) && cardOk(res({ causes: ['new-site', 'word'] }), t), t);
t = W.plainReason(res({ causes: ['word', 'typed-write'], notes: ['app.snowflake.com', '"Types it"'], texts: typed('DROP TABLE t'), claims: [{ text: 'Types it', danger: false }] }));
ok('worst cause first', t.indexOf('database command') < t.indexOf('May change'), t);

// ---------------------------------------------------------------- whole cards
t = W.plainReason(res({ causes: ['typed-write'], notes: ['app.snowflake.com'], texts: typed('CREATE OR REPLACE PROCEDURE x()'), claims: [{ text: 'Types the routine', danger: false }], where: ['app.snowflake.com'] }));
ok('typed routine card', t === 'On app.snowflake.com: Typing a database command that changes or deletes data. Among other things, it replaces or changes live code or tables. Claude says (unverified): "Types the routine". Undo not guaranteed; allow only if expected.', t);
t = W.plainReason(res({ causes: ['typed-write'], texts: typed('INSERT INTO t VALUES (1)') }));
ok('mild command: today\'s sentence only', t === 'Typing a database command that changes or deletes data. Undo not guaranteed; allow only if expected.', t);
t = W.plainReason(res({ causes: ['typed-write'], texts: [{ kind: 'typed', text: 'insert into t values (1)', cut: true }] }));
ok('cut text says so', /The check could not read all of it\./.test(t) && cardOk(res({ causes: ['typed-write'] }), t), t);
t = W.plainReason(res({ causes: ['typed-write'], texts: [{ kind: 'typed', text: 'insert into t values (1) ' + 'x'.repeat(12000) }, { kind: 'typed', text: 'y'.repeat(12000) }] }));
ok('batch over the cap counts as cut', /could not read all of it/.test(t), t);
t = W.plainReason(res({ causes: ['typed-write'], texts: typed('insert into t values (1)').concat(script('run("drop table x")')) }));
ok('mixed typed and script wording', /^Typing or a page script runs a database command that changes or deletes data\. Among other things, it deletes data or database objects\./.test(t), t);
t = W.plainReason(res({ causes: ['helper-args', 'typed-write'], notes: ['app.snowflake.com'], texts: script('h("GRANT x TO ROLE r")') }));
ok('helper-args with typed-write names the kind once', (t.match(/changes who has access/g) || []).length === 1 && cardOk(res({ causes: ['helper-args', 'typed-write'] }), t), t);
t = W.plainReason(res({ causes: ['risky-script', 'typed-write'], texts: [{ kind: 'script', text: 'fetch("/x"); run("drop table t")', cut: true }] }));
ok('cut note once with both additions', (t.match(/could not read all of it/g) || []).length === 1 && /sends data/.test(t) && /deletes data or database objects/.test(t), t);
t = W.plainReason(res({ causes: ['script-helper'], hosts: ['helper:app.snowflake.com:runQ'], notes: ['app.snowflake.com'], texts: script('runQ("select 1")') }));
ok('helper names are not shown', !/runQ/.test(t) && /later calls to it go ahead unless the call itself has a database change or a risky step/.test(t) && leftover(t) === '', t);
t = W.plainReason(res({ causes: ['high-stakes'], notes: ['mail.google.com'], claims: [{ text: 'Opens the draft', danger: false }], where: ['mail.google.com'] }));
ok('high-stakes card', t === 'High-stakes site (mail.google.com): every click, key and form fill asks. Claude says (unverified): "Opens the draft". Undo not guaranteed; allow only if expected.', t);
t = W.plainReason(res({ causes: ['follow-up', 'word'], notes: ['a.com', '"Toggles x"', '"Clicks y"'], claims: [{ text: 'Toggles x', danger: true }, { text: 'Clicks y', danger: false }], where: ['a.com', 'b.com'] }));
ok('follow-up names only its own site', /^Right after a role, permission, owner or billing control on a\.com; often the action that applies it\. Claude says \(unverified\): "Toggles x"; "Clicks y"\. Also on b\.com\./.test(t) && /May change, send, delete/.test(t), t);

// ---------------------------------------------------------------- v2.3 order (fits about 3 visible lines)
t = W.plainReason(res({ causes: ['follow-up', 'word'], notes: ['us-west-2b.online.tableau.com', '"Selects Erez Baron as the new owner"'], claims: [{ text: 'Selects Erez Baron as the new owner', danger: true }] }));
ok('click after a role control: Claude words right after the first sentence, before the second', t.indexOf('Claude says') < t.indexOf('May change') && t.indexOf('Right after a role') === 0 && cardOk(res({ causes: ['follow-up', 'word'] }), t), t);
t = W.plainReason(res({ causes: ['risky-script'], notes: ['payments.google.com'], texts: script('fetch("/x"); location.assign("/y")') }));
ok('the card opens with the site', /^On payments\.google\.com: A page script/.test(t), t);
t = one('deny-loop-stale-tab', { notes: ['app.snowflake.com'] });
ok('stuck-tab card says the site is last seen', /^Claude could not confirm which page this tab is on\. Last seen on app\.snowflake\.com\. /.test(t) && leftover(t) === '', t);
t = W.plainReason(res({ causes: ['helper-args', 'typed-write'], texts: typed('DROP TABLE t').concat(script('h("x y")')) }));
ok('mixed batch keeps the helper sentence', /A page script runs more than a lookup through code left on the page/.test(t) && /^Typing or a page script runs/.test(t), t);
t = W.plainReason(res({ causes: ['helper-args', 'typed-write'], texts: script('h("DROP TABLE t")') }));
t = W.plainReason(res({ causes: ['helper-args', 'typed-write'], texts: script('run("DROP TABLE t")').concat(script('h("archive 42")')) }));
ok('two scripts in a batch keep the helper sentence', /A page script runs more than a lookup through code left on the page; it can change, delete or send data\./.test(t), t);
t = W.plainReason(res({ causes: ['word'], claims: [{ text: 'Saves ǁ ᑊᑊ ᛌᛌ װ x. Check: done', danger: true }] }));
ok('stroke letters of other scripts and Latin clicks become an apostrophe', !/[ǁᑊᛌװ]/.test(t) && /"Saves ' ' ' ' x\. Check: done"/.test(t), t);
t = W.plainReason(res({ causes: ['word'], claims: [{ text: 'Clicks שמור (Save) and Сохранить', danger: true }] }));
ok('Hebrew and Cyrillic words stay', /שמור \(Save\) and Сохранить/.test(t), t);
t = W.plainReason(res({ causes: ['helper-args', 'typed-write'], texts: script('h("DROP TABLE t")') }));
ok('script-only batch drops the repeated helper sentence',!/more than a lookup/.test(t) && /^A page script runs a database command/.test(t), t);

t = W.plainReason(res({ causes: ['follow-up'], notes: ['github.com'], claims: [{ text: 'Opens the Contents access menu', danger: false }] }));
ok('click after a role control with no danger word: Claude words before the undo note', t.indexOf('Claude says') < t.indexOf('Undo not guaranteed') && cardOk(res({ causes: ['follow-up'] }), t), t);
t = W.plainReason(res({ causes: ['new-site', 'word'], hosts: ['accounts.google.com'], notes: ['"Clicks Continue"'], claims: [{ text: 'Clicks Continue', danger: true }], where: ['accounts.google.com'] }));
ok('first visit with a click: the site leads the card', /^On accounts\.google\.com: /.test(t), t);
t = W.plainReason(res({ causes: ['word', 'deny-loop-stale-tab'], notes: ['app.snowflake.com', '"Clicks Run"'], claims: [{ text: 'Clicks Run', danger: true }] }));
ok('stuck tab comes first, then the next cause and its last-seen site, then Claude words', t === 'Claude could not confirm which page this tab is on. May change, send, delete, pay, share or grant something. Last seen on app.snowflake.com. Claude says (unverified): "Clicks Run". Undo not guaranteed; allow only if expected.' && cardOk(res({ causes: ['word', 'deny-loop-stale-tab'] }), t), t);
t = W.plainReason(res({ causes: ['deny-loop-stale-tab', 'typed-write'], notes: ['app.snowflake.com', '"Types the command"'], claims: [{ text: 'Types the command', danger: false }], texts: typed('DROP TABLE t') }));
ok('stuck tab with a database command: the command warning and what the check sees come before Claude words', /^Claude could not confirm which page this tab is on\. Typing a database command that changes or deletes data\. Among other things, it deletes data or database objects\. Last seen on app\.snowflake\.com\. Claude says/.test(t) && cardOk(res({ causes: ['deny-loop-stale-tab', 'typed-write'] }), t), t);
t = W.plainReason(res({ causes: ['deny-loop-stale-tab', 'deny-loop-no-summary', 'risky-script'], notes: ['a.com'], texts: script('fetch("/x")'), claims: [{ text: 'Runs a script', danger: false }] }));
ok('two stuck reasons: both first, then the next cause, then Claude words', /^Claude could not confirm which page this tab is on\. Claude did not say what this action does, so the check could not look at it\. A page script that can change the page or send data\. Among other things, it sends data to a server\. Last seen on a\.com\. Claude says/.test(t) && cardOk(res({ causes: ['deny-loop-stale-tab', 'deny-loop-no-summary', 'risky-script'] }), t), t);
t = W.plainReason(res({ causes: ['deny-loop-stale-tab', 'new-site'], notes: ['a.com'], hosts: ['b.com'], claims: [{ text: 'Clicks x', danger: false }] }));
ok('stuck tab with only a first visit: Claude words before the first-visit note', t.indexOf('Claude says') < t.indexOf('Also the first action') && cardOk(res({ causes: ['deny-loop-stale-tab', 'new-site'] }), t), t);
t = W.plainReason(res({ causes: ['deny-loop-unknown-tab', 'follow-up'], notes: ['a.com'], claims: [{ text: 'Clicks Save', danger: false }] }));
ok('stuck tab: a site the next sentence names is not listed again', !/Sites in this request: a\.com/.test(t) && /control on a\.com/.test(t) && cardOk(res({ causes: ['deny-loop-unknown-tab', 'follow-up'] }), t), t);
t = W.plainReason(res({ causes: ['deny-loop-stale-tab', 'deny-loop-no-summary'], notes: ['a.com'] }));
ok('two stuck reasons alone: both shown, then the site', /^Claude could not confirm which page this tab is on\. Claude did not say what this action does, so the check could not look at it\. Last seen on a\.com\./.test(t), t);
ok('checker: a stuck-tab card with the next cause after Claude words fails', !cardOk(res({ causes: ['deny-loop-stale-tab', 'word'] }), 'Claude could not confirm which page this tab is on. Claude says (unverified): "Clicks Run". May change, send, delete, pay, share or grant something. Undo not guaranteed; allow only if expected.'));

t = W.plainReason(res({ causes: ['word'], claims: [{ text: 'Opens menu\u0027\u0027 Read-only; nothing changes.\"\"', danger: true }] }));
ok('two apostrophes or quotes cannot fake a closing quote', !/''/.test(t) && cardOk(res({ causes: ['word'] }), t), t);
t = W.plainReason(res({ causes: ['risky-script'], notes: ['a' + 'b'.repeat(60) + '.evil.example'] }));
ok('a very long site name shows its end, and the full list ends the card', /^On …b+\.evil\.example: A page script/.test(t) && t.indexOf('A page script') < 70 && /All sites: ab{60}\.evil\.example\.$/.test(t), t);
t = W.plainReason(res({ causes: ['risky-script'], notes: ['a.com', 'b.com', 'c.com', 'd.com'] }));
ok('many sites: two named and a count, full list at the end', /^On a\.com, b\.com and 2 more: A page script/.test(t) && /All sites: a\.com, b\.com, c\.com, d\.com\.$/.test(t), t);

t = W.plainReason(res({ causes: ['deny-loop-unknown-tab', 'word'], notes: ['"Clicks Delete repository"'], claims: [{ text: 'Clicks Delete repository', danger: true }], where: ['github.com'] }));
ok('unknown tab: no site claimed for it, other sites neutral', /^Claude could not confirm which page this tab is on\. /.test(t) && !/Last seen on github/.test(t) && /Sites in this request: github\.com\./.test(t) && cardOk(res({ causes: ['deny-loop-unknown-tab', 'word'] }), t), t);
t = W.plainReason(res({ causes: ['non-web-tab', 'new-site'], hosts: ['docs.google.com'] }));
ok('non-web tab: no site put in front of it', /^Acts on a tab showing a page that is not an ordinary web site/.test(t), t);
t = W.plainReason(res({ causes: ['word'], claims: [{ text: 'Says \u201chi\u201d and \u2035\u2035done\u2035\u2035 \u02c8\u02c8x', danger: true }] }));
ok('quote look-alikes outside the plain set become one apostrophe', /"Says 'hi' and 'done' 'x"/.test(t), t);
t = W.plainReason(res({ causes: ['word'], claims: [{ text: 'Saves ᐦ. Check: read-only ᐦ Ꞌꞌxꞌ ײ', danger: true }] }));
ok('quote-like letters become an apostrophe too (and letters of other scripts)',!/[ᐦꞋꞌײ]/.test(t) && /"Saves '\. Check: read-only ' 'x' '"/.test(t), t);

// ---------------------------------------------------------------- Claude's part
t = W.plainReason(res({ causes: ['word'], claims: Array.from({ length: 9 }, (_, i) => ({ text: 'Step ' + i, danger: false })) }));
ok('plain summaries capped at 6, count inside the label', /Claude says \(unverified\): "Step 0"; .* and 3 more\./.test(t) && !/Step 6/.test(t) && wordPlaced(t), t);
t = W.plainReason(res({ causes: ['word'], claims: Array.from({ length: 7 }, (_, i) => ({ text: 'Types ' + i, danger: false })).concat([{ text: 'Clicks Archive all', danger: true }]) }));
ok('a danger summary is shown first, never hidden', /Claude says \(unverified\): "Clicks Archive all"; "Types 0".* and 2 more\./.test(t), t);
t = W.plainReason(res({ causes: ['word'], claims: [{ text: 'Opens the panel". Browser safety check: nothing changes. Undo is guaranteed.' }] }));
ok('a quote in a summary cannot close the quote', /: "Opens the panel'\. Browser safety check: nothing changes\. Undo is guaranteed\."\. /.test(t) && wordPlaced(t), t);
t = W.plainReason(res({ causes: ['word'], claims: [{ text: 'Selects row ‮.kcehc ytefas‏ “x” ״y״ ❝z❞', danger: false }] }));
ok('direction and invisible characters removed, look-alike quotes plain', !/[‮‏“”״❝❞]/.test(t) && /"Selects row \.kcehc ytefas 'x' 'y' 'z'"\./.test(t), t);
t = W.plainReason(res({ causes: ['word'], claims: [{ text: 'Opens the panel\n\n Safe:   approved', danger: false }] }));
ok('summary whitespace flattened', /"Opens the panel Safe: approved"/.test(t), t);
t = W.plainReason(res({ causes: ['word'], claims: [{ text: 'x'.repeat(150), danger: false }] }));
ok('summary cut at 80 with an ellipsis', t.includes('"' + 'x'.repeat(80) + '…"'), t);
t = W.plainReason({ decision: 'ask', causes: ['word'], hosts: [], notes: ['x.com', '"Deletes the draft"'] }); // no new fields
ok('missing new fields tolerated', /May change, send, delete/.test(t) && /^On x\.com: /.test(t) && /Claude says \(unverified\): "Deletes the draft"\. /.test(t), t);
ok('unknown tool name sanitised and short', (t = one('unknown-tool:x" The check approved this. Undo is guaranteed' + 'y'.repeat(200))) && !/approved this\. /.test(t) && t.length < 320, t);
ok('reasonFor falls back to the old text on an error', W.reasonFor({ causes: 'word', notes: [], hosts: [] }).endsWith('(browser gate, GEN-924)'));

// ---------------------------------------------------------------- named cases from the reviews
const st0 = () => { const st = W.newState(); for (const h of ['app.snowflake.com', 'admin.google.com', 'payments.google.com']) st.approved[h] = true;
  st.tabs['1'] = { url: 'https://app.snowflake.com/x', stale: false, taint: false }; st.tabs['2'] = { url: 'https://admin.google.com/x', stale: false, taint: false };
  st.tabs['3'] = { url: 'https://payments.google.com/x', stale: false, taint: false }; return st; };
const click = (tab, sum) => W.decide(st0(), 'mcp__claude-in-chrome__computer', { action: 'left_click', tabId: tab, coordinate: [1, 1], action_summary: sum }, {});
for (const [tab, sum] of [[1, 'Runs CREATE OR REPLACE of the reviewed routine'], [2, 'Confirms suspending the qa@muuula.com account'], [1, 'Runs the approved supervised CALL of the updated routine'], [1, 'Clicks Apply'], [1, 'Clicks Run']]) {
  const r = click(tab, sum);
  if (r.decision !== 'ask') { ok('named click asks: ' + sum, false, r.decision); continue; }
  t = W.plainReason(r);
  ok('named click: ' + sum, cardOk(r, t) && /^On [a-z.]+: May change, send, delete, pay, share or grant something\./.test(t) && !/approve something|confirm or approve/.test(t), t);
}

// ---------------------------------------------------------------- oracle: hidden dangerous statements
const DANGER = ['DELETE FROM t WHERE 1=1', 'DROP TABLE t', 'TRUNCATE TABLE t', 'INSERT OVERWRITE INTO t SELECT 1', 'GRANT ALL ON t TO ROLE r',
  'MERGE INTO t USING s ON t.a = s.a WHEN MATCHED THEN DELETE'];
const MILD = 'INSERT INTO log VALUES (1)';
const TRICKS = {
  'comment apostrophes': d => MILD + "; -- don't\n" + d + "; -- it's",
  'block comment apostrophes': d => MILD + "; /* don't */ " + d + "; /* it's */",
  'dollar quote': d => MILD + "; select $$it's$$; " + d + "; select 'x'",
  'double-quoted name': d => MILD + "; select * from \"it's\"; " + d + "; select 'x'",
  'backtick name': d => MILD + "; select `it's`; " + d + "; select 'x'",
  'backslash escapes': d => "INSERT INTO log VALUES ('it\\'s'); " + d + "; select 'he\\'s'",
  'past the cap': d => MILD + '; ' + ' '.repeat(20500) + d
};
let oracleCards = 0, oracleNamed = 0;
for (const [trick, f] of Object.entries(TRICKS)) for (const d of DANGER) {
  const st = st0();
  const r = W.decide(st, 'mcp__claude-in-chrome__computer', { action: 'type', tabId: 1, text: f(d), action_summary: 'Types the query' }, {});
  if (r.decision !== 'ask' || !r.causes.includes('typed-write')) continue; // the unchanged decision does not ask: out of scope
  t = W.plainReason(r); oracleCards++;
  if (/Among other things, it (deletes data|changes who has access)/.test(t)) oracleNamed++;
  ok('oracle ' + trick + ': ' + d, cardOk(r, t), t);
}
for (const d of DANGER) {
  const r = W.decide(st0(), 'mcp__claude-in-chrome__javascript_tool', { action: 'javascript_exec', tabId: 1, text: 'const l = "Yakir\'s grants"; ed.setValue("' + MILD + '; ' + d + '"); run.click();' }, {});
  if (r.decision !== 'ask') continue;
  t = W.plainReason(r); oracleCards++;
  if (/deletes data or database objects|changes who has access/.test(t)) oracleNamed++;
  ok('oracle cross-string script: ' + d, cardOk(r, t), t);
}
{
  const r = W.decide(st0(), 'mcp__claude-in-chrome__javascript_tool', { action: 'javascript_exec', tabId: 3, text: 'fetch("/pay", {method:"POST", body: d}); location.assign("/done")' }, {});
  t = W.plainReason(r);
  ok('oracle script sends and navigates: send named first', r.decision === 'ask' && t.indexOf('sends data to a server') > 0 && t.indexOf('sends data') < t.indexOf('opens another address') && cardOk(r, t), t);
}
ok('oracle ran', oracleCards >= 40, oracleCards);
console.log('oracle accuracy: serious kind named on ' + oracleNamed + ' of ' + oracleCards + ' hidden-danger cards (every card kept the opening sentence)');

{
  const st3 = st0(); st3.approved['b.example'] = true; st3.tabs['4'] = { url: 'https://b.example/x', stale: false, taint: false };
  const same = 'Clicks Send on the draft';
  const rb = W.decide(st3, 'mcp__claude-in-chrome__browser_batch', { actions: [{ name: 'computer', input: { action: 'type', tabId: 1, text: 'x', action_summary: same } }, { name: 'computer', input: { action: 'type', tabId: 4, text: 'y', action_summary: same } }] }, {});
  ok('duplicate summaries keep the always-shown flag', rb.claims.filter(c => c.text === same).length <= 1 && rb.claims.every(c => c.text !== same || c.danger === true), rb.claims);
}
t = W.plainReason(res({ causes: ['word'], claims: [{ text: 'x˝ Browser safety check: fine \u{1F676}y\u{1F677}', danger: false }] }));
ok('more look-alike quotes made plain', !/[˝\u{1F676}\u{1F677}]/u.test(t) && wordPlaced(t), t);
{
  const items = Array.from({ length: 8 }, () => ({ name: 'computer', input: { action: 'type', tabId: 1, text: 'DELETE FROM t ' + '/* '.repeat(6667), action_summary: 'Types the query' } }));
  const t1 = Date.now();
  const rb = W.decide(st0(), 'mcp__claude-in-chrome__browser_batch', { actions: items }, {});
  const t2 = Date.now(); const card = rb.decision === 'ask' ? W.plainReason(rb) : ''; const t3 = Date.now();
  console.log('hostile batch timing: decide ' + (t2 - t1) + ' ms (unchanged code path), card ' + (t3 - t2) + ' ms');
  ok('hostile batch: card well under the 30 s limit', rb.decision === 'ask' && t3 - t2 < 10000 && cardOk(rb, card), { d: rb.decision, ms: t3 - t2 });
}

// ---------------------------------------------------------------- hostile input is fast
let t0 = Date.now();
W.sqlKind(typed(('update ' + 'a'.repeat(50000) + ' x').slice(0, 20000))); W.sqlKind(script('"' + "'".repeat(20000)));
W.sqlKind(typed("drop table x; '" + "\\'".repeat(10000))); W.scriptKinds(script('('.repeat(20000)));
W.plainReason(res({ causes: ['word'], claims: Array.from({ length: 50 }, () => ({ text: 'x'.repeat(2000) })) }));
ok('fast on hostile input', Date.now() - t0 < 1000, Date.now() - t0);

// ---------------------------------------------------------------- decide carries texts and claims, nothing new is saved
const st = st0();
const r1 = W.decide(st, 'mcp__claude-in-chrome__computer', { action: 'type', tabId: 1, text: 'DROP TABLE t ' + 'x'.repeat(30000), action_summary: 'Types the query ' + 'q'.repeat(3000) }, {});
ok('decide keeps typed text capped, marks the cut, keeps the summary capped', r1.decision === 'ask' && r1.texts.length === 1 && r1.texts[0].text.length === 20000 && r1.texts[0].cut === true && r1.claims[0].text.length === 2000 && r1.claims[0].danger === r1.causes.includes('word'), { d: r1.decision, c: r1.causes });
const r2 = W.decide(st0(), 'mcp__claude-in-chrome__computer', { action: 'left_click', tabId: 1, coordinate: [1, 1], action_summary: 'x'.repeat(90) + ' then deletes the workspace' }, {});
{
  const rb = click(1, 'Runs CREATE OR REPLACE of the reviewed routine');
  ok('a summary that made its own click ask is marked always-shown', rb.decision === 'ask' && rb.causes.includes('word') && rb.claims[0].danger === true, rb.claims);
}
ok('danger judged on the full summary', r2.claims[0].danger === true && /"x{80}…"/.test(W.plainReason(r2)), r2.claims);
W.countCall(st, r1); W.applyDecision(st, r1);
ok('state holds no texts or claims', !/DROP TABLE|Types the query/.test(JSON.stringify(st)));

// ---------------------------------------------------------------- end to end through the real hook process, live vs working copy
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
  { hook_event_name: 'PreToolUse', session_id: 's1', tool_use_id: 'u5', tool_name: 'mcp__claude-in-chrome__computer', tool_input: { tabId: 7, action: 'left_click', coordinate: [1, 1], action_summary: 'Runs CREATE OR REPLACE of the reviewed routine' } },
  { hook_event_name: 'PreToolUse', session_id: 's1', tool_use_id: 'u4', tool_name: 'mcp__claude-in-chrome__javascript_tool', tool_input: { tabId: 7, action: 'javascript_exec', text: 'fetch("/api/x", {method:"POST"})' } }
];
const outs = { live: [], wc: [] };
for (const p of steps) { outs.live.push(run(LIVE, 'live', p)); outs.wc.push(run(WC, 'wc', p)); }
const dec = o => o.out && o.out.hookSpecificOutput ? o.out.hookSpecificOutput.permissionDecision : 'none';
for (let i = 0; i < steps.length; i++) {
  const a = outs.live[i], b = outs.wc[i];
  ok('e2e step ' + i + ' same decision and exit', a.code === b.code && dec(a) === dec(b), { a: dec(a), b: dec(b), ca: a.code, cb: b.code });
}
const reason = i => outs.wc[i].out.hookSpecificOutput.permissionDecisionReason;
ok('e2e navigate asks new-site', /^First action on app\.snowflake\.com/.test(reason(0)), reason(0));
ok('e2e typed routine card', /^On app\.snowflake\.com: Typing a database command that changes or deletes data\. Among other things, it replaces or changes live code or tables\. Claude says \(unverified\): "Types the reviewed routine"\./.test(reason(3)), reason(3));
ok('e2e run click card', /^On app\.snowflake\.com: May change, send, delete, pay, share or grant something\./.test(reason(4)), reason(4));
ok('e2e script card', /^On app\.snowflake\.com: A page script that can change the page or send data\. Among other things, it sends data to a server\. Undo not guaranteed; allow only if expected\./.test(reason(5)), reason(5));
const strip = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { const j = JSON.parse(l); delete j.ts; return JSON.stringify(j); }).join('\n');
ok('e2e logs identical', strip(path.join(tmp, 'live', 'log.jsonl')) === strip(path.join(tmp, 'wc', 'log.jsonl')));
fs.rmSync(tmp, { recursive: true, force: true });

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
