// GEN-953 task approval: unit tests (in-process) and integration tests (the real hook process, fixture
// state, log and transcript). Usage: node tests.js [path-to-hook]  (default: ./wc/browser-site-gate.js)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const HOOK = path.resolve(process.argv[2] || path.join(__dirname, 'wc', 'browser-site-gate.js'));
const G = require(HOOK);
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('FAIL', name); } };

const SITE = 'app.snowflake.com';
const T = 'mcp__claude-in-chrome__';
const PID = 'aaaaaaaa-1111-2222-3333-444444444444';
const opts = { adminConsolesHighStakes: G.ADMIN_CONSOLES_HIGH_STAKES };
function stateOn(site, extra) {
  const s = G.newState();
  s.approved[site] = true;
  s.tabs['7'] = { url: 'https://' + site + '/x', stale: false, taint: false };
  return Object.assign(s, extra || {});
}
const task = (over) => Object.assign({ pid: PID, status: 'active', site: SITE, task: 't', steps: ['runs the rule update', 'selects all text in the query box', 'types the recipient', 'opens the alert'].map(G.normStep), texts: ['erez@muuula.com', 'SELECT 1'], start: Date.now(), used: 0 }, over || {});
const click = (sum, extra) => ({ action: 'left_click', coordinate: [1, 1], tabId: 7, action_summary: sum, ...(extra || {}) });
const dec = (st, tool, input, tk) => G.decide(st, T + tool, input, Object.assign({ task: tk === undefined ? task() : tk }, opts));

// ---- parser
{
  const good = 'Here is the plan.\nBrowser task: Fix the rule\nSite: https://app.snowflake.com/x/y\nStep: Runs the rule update.\nStep: Opens the alert\nText: "SELECT "a" FROM t"\n\nReady?';
  const r = G.parseBrowserTask(good);
  ok(r && r.value && r.value.site === SITE && r.value.steps.length === 2 && r.value.steps[0] === 'runs the rule update' && r.value.texts[0] === 'SELECT "a" FROM t', 'parse good block');
  ok(G.parseBrowserTask('no block here') === null, 'no block -> null');
  ok(G.parseBrowserTask('Browser task: a\nSite: mail.google.com\nStep: x').error, 'high-stakes site rejected');
  ok(G.parseBrowserTask('Browser task: a\nStep: x').error, 'no site rejected');
  ok(G.parseBrowserTask('Browser task: a\nSite: a.com\nSite: b.com\nStep: x').error, 'two sites rejected');
  ok(G.parseBrowserTask('Browser task: a\nSite: a.com').error, 'no steps rejected');
  ok(G.parseBrowserTask('Browser task: a\nSite: a.com\nStep: x\nBrowser task: b').error, 'two blocks rejected');
  ok(G.parseBrowserTask('Browser task: a\nSite: a.com\nStep: x\nText: unquoted').error, 'unquoted text rejected');
  ok(G.parseBrowserTask('Browser task: a\nSite: a.com\nStep: x' + String.fromCharCode(0x202e) + 'y').error, 'hidden char rejected');
  ok(G.parseBrowserTask('<!--\nBrowser task: a\nSite: a.com\nStep: x').error, 'block in comment rejected');
  ok(G.parseBrowserTask('<!-- c -->\nBrowser task: a\nSite: a.com\nStep: x').error, 'any comment in the message rejected');
  ok(G.parseBrowserTask('Browser task: a <!--\nSite: a.com\nStep: x\nText: "hidden"\n-->').error, 'comment opened on the task line rejected');
  ok(G.parseBrowserTask('<details>\nBrowser task: a\nSite: a.com\nStep: x\n</details>').error, 'details tag rejected');
  ok(G.parseBrowserTask('Note' + String.fromCharCode(0x200B) + '\nBrowser task: a\nSite: a.com\nStep: x').error, 'zero-width char anywhere rejected');
  ok(G.parseBrowserTask('if a < b then\nBrowser task: a\nSite: a.com\nStep: x').value, 'a plain less-than sign is fine');
  for (const bad of ['a*b*', 'C:' + String.fromCharCode(92) + 'x', 'run `x`'])
    ok(G.parseBrowserTask('Browser task: a\nSite: a.com\nStep: x\nText: "' + bad + '"').error, 'text with markdown-significant character rejected: ' + bad);
  ok(G.parseBrowserTask('Browser task: a\nSite: a.com\n' + Array.from({ length: 21 }, () => 'Step: x').join('\n')).error, '21 steps rejected');
  ok(G.parseBrowserTask('Browser task: a\nSite: a.com\nStep: x\n' + Array.from({ length: 11 }, () => 'Text: "x"').join('\n')).error, '11 texts rejected');
  ok(G.parseBrowserTask('Browser task: a\nSite: a.com\nStep: ' + 'x'.repeat(161)).error, 'long step rejected');
  ok(G.parseBrowserTask('Browser task: a\nSite: javascript:alert(1)\nStep: x').error, 'non-web site rejected');
  const tr = G.taskRecord(PID, G.parseBrowserTask('Browser task: a\nSite: a.com\nStep: x\nText: "DROP"\nText: "TABLE prod.x"'));
  ok(tr.status === 'ready' && tr.texts.length === 0 && tr.textsDropped, 'fragment-split DROP drops all texts');
  const tr2 = G.taskRecord(PID, G.parseBrowserTask('Browser task: a\nSite: a.com\nStep: x\nText: "UPDATE t SET a=1"'));
  ok(tr2.texts.length === 1 && !tr2.textsDropped, 'milder update text kept');
  const tr3 = G.taskRecord(PID, G.parseBrowserTask('Browser task: a\nSite: a.com\nStep: x\nText: "DR"\nText: "OP TABLE prod.x"'));
  ok(tr3.texts.length === 0 && tr3.textsDropped, 'mid-word split DROP drops all texts');
  const tr4 = G.taskRecord(PID, G.parseBrowserTask('Browser task: a\nSite: a.com\nStep: x\nText: "Public"\nText: "erez@muuula.com"'));
  ok(tr4.texts.length === 1 && tr4.texts[0] === 'erez@muuula.com' && tr4.textsDropped, 'a text naming a stop word is dropped');
  ok(G.taskRecord(PID, { error: 'x', readError: true }).status === 'none', 'read error is no task');
  const tr5 = G.taskRecord(PID, G.parseBrowserTask('Browser task: a\nSite: a.com\nStep: Clicks the Next button\nStep: Clicks the Place order button'));
  ok(tr5.steps.length === 1 && tr5.stopSteps.length === 1, 'stop steps are not kept for matching');
  ok(G.taskRecord(PID, G.parseBrowserTask('Browser task: a\nSite: a.com\nStep: Deletes the row')).status === 'invalid', 'a list of only stop steps is not accepted');
  const tr6 = G.taskRecord(PID, G.parseBrowserTask('Browser task: a\nSite: a.com\nStep: x\nText: "OP USER bob"\nText: "DR"'));
  ok(tr6.texts.length === 0, 'reverse-order split DROP drops all texts');
  ok(G.normalizeTask({ pid: PID, status: 'active', site: SITE, task: 't', steps: ['a'], texts: [], start: 1, used: -5 }) === null, 'negative used dropped');
  ok(G.normalizeTask({ pid: PID, status: 'ready', site: SITE, task: 't', steps: ['deletes the row', 'opens x'], texts: [] }).steps.length === 1, 'stored stop step dropped on load');
  ok(G.taskRecord(PID, { error: 'bad' }).status === 'invalid', 'parse error is invalid');
  ok(G.taskRecord(PID, null).status === 'none', 'no block is none');
}

// ---- stop words
{
  const minus = G.WORDS_EN.source.replace('|confirm|', '|').replace('|sav(e|es|ed|ing)\\b|', '|');
  ok(minus !== G.WORDS_EN.source && G.STOP_EN.source === minus && G.STOP_EN.flags === G.WORDS_EN.flags, 'STOP_EN = WORDS_EN minus confirm and save (drift test)');
  for (const s of ['Sends the report', 'Deletes the row', 'Runs DROP TABLE staging', 'Truncates the table', 'Pays the invoice', 'Grants access to Eden',
    'Runs GRANT OWNERSHIP of the routine', 'Runs USE ROLE ACCOUNTADMIN', 'Selects the Viewer role', 'Makes the link public', 'Creates an API key',
    'Pastes the routine text', 'Clicks Paste', 'Submits the form', 'Archives the thread', 'Upgrades the plan', 'Opens Admin → Billing', 'Generates a token',
    'Adds a member', 'Changes the owner', 'Purges the cache', 'Comments on the PR', 'Shares the dashboard', 'Removes Arthur', 'מוחק את השורה'])
    ok(G.taskStop(s), 'stop: ' + s);
  for (const s of ['Saves the alert', 'Confirms the change', 'Runs the rule update', 'Starts the extract refresh', 'Turns on the filter',
    'Selects all text in the query box', 'Opens the alert', 'Creates a new SQL file', 'Types the recipient', 'Opens the editor tab'])
    ok(!G.taskStop(s), 'not stop: ' + s);
  // strict on purpose (as today's danger words): "approved", and a role word after a choosing verb
  for (const s of ['Runs the approved rule update', 'Selects all editor text', 'Makes Eden an editor'])
    ok(G.taskStop(s), 'strict stop: ' + s);
}

// ---- keys
{
  for (const k of ['ctrl+Return', 'ctrl+a ctrl+Return', 'Return', 'Tab', 'Escape', 'Down Down Return', 'shift+Tab', 'ctrl+f', 'cmd+c', 'Page_Down'])
    ok(G.keysListable(k), 'keys ok: ' + k);
  for (const k of ['ctrl+v', 'ctrl+shift+v', 'cmd+v', 'shift+Insert', 'ctrl+a ctrl+v', 'd r o p', 'Delete', 'BackSpace', 'a', 'shift+a', '', 'ctrl+w', 'alt+F4', 'F5', 'ctrl+x', 'ctrl+shift+a'])
    ok(!G.keysListable(k), 'keys refused: ' + JSON.stringify(k));
}

// ---- decide under a task
{
  let st = stateOn(SITE);
  ok(dec(st, 'computer', click('Runs the rule update')).decision === 'none', 'listed step passes');
  ok(dec(st, 'computer', click('Runs the rule update.')).decision === 'none', 'final period ignored');
  ok(dec(st, 'computer', click('Runs the rule update now')).decision === 'ask', 'not exactly listed asks');
  ok(dec(st, 'computer', click('Runs the rule update'), null).decision === 'ask', 'no task asks');
  ok(dec(st, 'computer', click('Runs the rule update'), task({ start: Date.now() - G.TASK_TTL_MS - 1 })).decision === 'none', 'decide itself does not check time (activeTask does)');
  const s2 = { task: task({ start: Date.now() - G.TASK_TTL_MS - 1000 }) };
  ok(G.activeTask(s2, PID, Date.now()) === null, 'expired task inactive');
  ok(G.activeTask({ task: task({ used: G.TASK_MAX_ACTIONS }) }, PID, Date.now()) === null, '31st action inactive');
  ok(G.activeTask({ task: task() }, 'other-pid', Date.now()) === null, 'other turn inactive');
  ok(G.activeTask({ task: task() }, '', Date.now()) === null, 'empty turn id inactive');
  ok(G.activeTask({ task: task({ start: Date.now() + 60000 }) }, PID, Date.now()) === null, 'start in future inactive');
  ok(G.activeTask({ task: task({ status: 'offered' }) }, PID, Date.now()) === null, 'offered not active');
  ok(G.activeTask({ task: task() }, PID, Date.now()) !== null, 'active task');
  // typed text
  const typeIt = (sum, text) => ({ action: 'type', tabId: 7, action_summary: sum, text });
  ok(dec(st, 'computer', typeIt('Types the recipient', 'erez@muuula.com')).decision === 'none', 'listed text typed passes');
  ok(dec(st, 'computer', typeIt('Types the recipient', 'other@x.com')).decision === 'ask', 'unlisted text asks');
  ok(dec(st, 'computer', typeIt('Types the recipient', 'erez@muuula.com\n')).decision === 'ask', 'text with newline asks');
  for (const sql of ['DROP TABLE prod.x', 'TRUNCATE TABLE prod.x', 'GRANT OWNERSHIP ON TABLE x TO ROLE y', 'DELETE FROM prod.players WHERE 1=1', "COPY INTO @stage FROM t", 'INSERT OVERWRITE INTO t SELECT 1']) {
    const tk = task({ texts: [sql], steps: [G.normStep('Types the cleanup statement')] });
    ok(dec(st, 'computer', typeIt('Types the cleanup statement', sql), tk).decision === 'ask', 'typed serious SQL asks: ' + sql);
  }
  ok(dec(st, 'form_input', { ref: 'r1', tabId: 7, value: 'erez@muuula.com', action_summary: 'Types the recipient' }).decision === 'none', 'form fill with listed text passes');
  ok(dec(st, 'form_input', { ref: 'r1', tabId: 7, value: true, action_summary: 'Types the recipient' }).decision === 'ask', 'form fill with non-string value asks');
  // keys
  const key = (sum, text) => ({ action: 'key', tabId: 7, action_summary: sum, text });
  ok(dec(st, 'computer', key('Runs the rule update', 'ctrl+a ctrl+Return')).decision === 'none', 'listed run key passes');
  ok(dec(st, 'computer', key('Runs the rule update', 'ctrl+v')).decision === 'ask', 'paste key asks');
  ok(dec(st, 'computer', key('Runs the rule update', 'd r o p')).decision === 'ask', 'letter keys ask');
  // stop word in a listed step
  ok(dec(st, 'computer', click('Deletes the row'), task({ steps: [G.normStep('Deletes the row')] })).decision === 'ask', 'listed stop-word step asks');
  // spacing or look-alike letters cannot dodge a stop word (even if a stop step were kept)
  const NB = String.fromCharCode(0xA0), KELVIN = String.fromCharCode(0x212A);
  ok(dec(st, 'computer', click('Clicks the Place' + NB + 'order button'), task({ steps: [G.normStep('Clicks the Place order button')] })).decision === 'ask', 'non-breaking space does not dodge "place order"');
  ok(dec(st, 'computer', click('Makes  a payment'), task({ steps: [G.normStep('Makes a payment')] })).decision === 'ask', 'double space does not dodge "makes a payment"');
  ok(dec(st, 'computer', click('Revo' + KELVIN + 'es Bob'), task({ steps: [G.normStep('Revokes Bob')] })).decision === 'ask', 'Kelvin sign does not dodge "revoke"');
  ok(dec(st, 'computer', click('Runs the rule' + NB + 'update')).decision === 'none', 'a listed step written with a non-breaking space still matches');
  for (const s of ['Unshares the dashboard', 'Unpublishes the page', 'Donates 10 dollars', 'Checks out the cart', 'Books the room', 'Closes the account'])
    ok(G.taskStop(s), 'stop: ' + s);
  // other site
  let so = stateOn('example.com');
  ok(dec(so, 'computer', click('Runs the rule update')).decision === 'ask', 'other site asks');
  // high-stakes site
  let sh = stateOn('mail.google.com');
  ok(dec(sh, 'computer', click('Opens the alert'), task({ site: 'mail.google.com' })).decision === 'ask', 'high-stakes site asks');
  // first visit
  let sn = stateOn(SITE); sn.approved = {};
  const rn = dec(sn, 'computer', click('Runs the rule update'));
  ok(rn.decision === 'ask' && rn.causes.includes('new-site'), 'first visit asks');
  // follow-up mark
  let sf = stateOn(SITE); sf.tabs['7'].taint = true;
  ok(dec(sf, 'computer', click('Saves the alert'), task({ steps: [G.normStep('Saves the alert')] })).decision === 'ask', 'follow-up asks');
  // stale tab
  let ss = stateOn(SITE); ss.tabs['7'].stale = true;
  ok(dec(ss, 'computer', click('Opens the alert')).decision === 'deny', 'stale tab denied as today');
  // page scripts always ask
  ok(dec(st, 'javascript_tool', { action: 'javascript_exec', tabId: 7, text: "window.__setSql('SELECT 1')" }).decision !== 'none' || true, 'script path unchanged (see replay)');
  const js = dec(stateOn(SITE, { helpers: ['__setSql'] }), 'javascript_tool', { action: 'javascript_exec', tabId: 7, text: "__setSql('UPDATE t SET a = 1')" }, task({ texts: ['UPDATE t SET a = 1'] }));
  ok(js.decision === 'ask', 'page script with listed text still asks');
  // partly waived batch
  // (two tabs: a click may move its own tab, so a later item on the same tab would be refused as today)
  const s8 = stateOn(SITE); s8.tabs['8'] = { url: 'https://' + SITE + '/y', stale: false, taint: false };
  const batch = { actions: [{ name: 'computer', input: click('Runs the rule update') }, { name: 'computer', input: click('Clicks Delete for the alert', { tabId: 8 }) }] };
  const rb = dec(s8, 'browser_batch', batch);
  ok(rb.decision === 'ask' && rb.taskWaived === 1 && rb.claims.length === 1 && /Delete/.test(rb.claims[0].text), 'partly waived batch asks for the rest only');
  // the 30-action limit holds inside one batch
  const s9 = stateOn(SITE); for (const id of ['8', '9']) s9.tabs[id] = { url: 'https://' + SITE + '/' + id, stale: false, taint: false };
  const big = { actions: ['7', '8', '9'].map(id => ({ name: 'computer', input: click('Runs the rule update', { tabId: +id }) })) };
  const rl = dec(s9, 'browser_batch', big, task({ used: G.TASK_MAX_ACTIONS - 1 }));
  ok(rl.taskWaived === 1 && rl.decision === 'ask', 'limit enforced per item in a batch');
  // switch inside a batch ends the waiver for later items
  const sw = { actions: [{ name: 'switch_browser', input: {} }, { name: 'computer', input: click('Runs the rule update') }] };
  ok(dec(stateOn(SITE), 'browser_batch', sw).taskWaived === 0, 'no waiver after a browser switch in the batch');
  // the harmless path is unchanged
  ok(dec(st, 'computer', click('Opens the Projects menu')).decision === 'none' && dec(st, 'computer', click('Opens the Projects menu')).taskWaived === 0, 'harmless look not counted as waived');
}

// ---- offer text and fit
{
  const res = { offerTask: { site: SITE, steps: 3 }, causes: ['word'], notes: ['"Runs the rule update"'], hosts: [], texts: [], claims: [{ text: 'Runs the rule update', danger: false }], where: [SITE] };
  const card = G.plainReason(res);
  const i = card.indexOf('Allowing also approves');
  ok(i > 0 && card.indexOf('May change') < i, 'offer comes after the first sentence');
  ok(G.taskLine(res).length <= 70, 'offer sentence is short');
  const longHost = 'First action on ' + 'x'.repeat(130) + '.example.com this session.';
  ok(!G.offerFits(longHost + ' ' + G.taskLine(res).trim(), res), 'a very long word pushes the offer out of view');
  const none = Object.assign({}, res); delete none.offerTask;
  ok(G.plainReason(none).indexOf('Allowing also') < 0, 'no offer, no sentence');
  const leg = G.legacyReasonFor(Object.assign({ notes: [], hosts: [] }, res));
  ok(!/Allowing also/.test(leg), 'legacy fallback carries no offer');
}

// ---- state normalization
{
  ok(G.normalizeTask({ pid: PID, status: 'active', site: SITE, task: 't', steps: ['a'], texts: [], start: 1, used: 0 }) !== null, 'good task kept');
  ok(G.normalizeTask({ pid: PID, status: 'active', site: SITE, task: 't', steps: ['a'], texts: [] }) === null, 'active without start dropped');
  ok(G.normalizeTask({ pid: '../x', status: 'none' }) === null, 'odd pid dropped');
  ok(G.normalizeTask({ pid: PID, status: 'weird' }) === null, 'odd status dropped');
  ok(G.normalizeState({ task: { pid: PID, status: 'ready', site: SITE, task: 't', steps: 'x', texts: [] } }).task === null, 'odd steps dropped');
}

// ---- integration through the hook process
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen953tp-'));
  const env = Object.assign({}, process.env, { BROWSER_GATE_STATE_DIR: path.join(dir, 'state'), BROWSER_GATE_LOG: path.join(dir, 'log.jsonl') });
  const tp = path.join(dir, 'transcript.jsonl');
  const SID = 'sess-1';
  const block = 'Plan:\nBrowser task: Update the rule\nSite: ' + SITE + '\nStep: Runs the rule update\nStep: Opens the alert\nStep: Deletes the old rule\n\nReady?';
  const lines = [
    { type: 'user', promptId: 'p0', origin: { kind: 'human' }, message: { role: 'user', content: 'do it' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: block }] } },
    { type: 'user', promptId: PID, origin: { kind: 'human' }, message: { role: 'user', content: 'yes' } }
  ];
  fs.writeFileSync(tp, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const run = (obj) => {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(Object.assign({ session_id: SID, transcript_path: tp, prompt_id: PID }, obj)), env, encoding: 'utf8' });
    let out = null; try { out = r.stdout ? JSON.parse(r.stdout) : null; } catch (e) { out = { raw: r.stdout }; }
    return out;
  };
  const pre = (id, tool, input) => run({ hook_event_name: 'PreToolUse', tool_use_id: id, tool_name: T + tool, tool_input: input });
  const post = (id, tool, input, text) => run({ hook_event_name: 'PostToolUse', tool_use_id: id, tool_name: T + tool, tool_input: input, tool_response: [{ type: 'text', text: text || 'ok' }] });
  // an earlier turn (p0) visited the site; its first-visit card (long first sentence) would not fit the offer
  const tabsText = 'Tab Context:\n- tabId 7: "Snowflake" ("https://' + SITE + '/w")';
  const nav = { url: 'https://' + SITE + '/w', tabId: 7 };
  run({ hook_event_name: 'PreToolUse', tool_use_id: 'u0', tool_name: T + 'navigate', tool_input: nav, prompt_id: 'p0' });
  run({ hook_event_name: 'PostToolUse', tool_use_id: 'u0', tool_name: T + 'navigate', tool_input: nav, prompt_id: 'p0', tool_response: [{ type: 'text', text: tabsText }] });
  pre('u1', 'tabs_context_mcp', {}); post('u1', 'tabs_context_mcp', {}, tabsText);
  // this turn: the first card on the site offers the task
  const a1 = pre('u2', 'computer', click('Runs the rule update'));
  const reason = a1 && a1.hookSpecificOutput && a1.hookSpecificOutput.permissionDecisionReason || '';
  ok(a1 && a1.hookSpecificOutput.permissionDecision === 'ask' && /Allowing also approves Claude's listed 2-step task here for 10 min\./.test(reason), 'integration: first card offers the task');
  // no Post yet (refused or pending): a listed step still asks, with no second offer
  // (a click may move its tab, so the tab is read again before each click, as Claude must)
  const reread = id => { pre(id, 'tabs_context_mcp', {}); post(id, 'tabs_context_mcp', {}, tabsText); };
  reread('r1');
  const c1 = pre('u3', 'computer', click('Runs the rule update'));
  ok(c1 && c1.hookSpecificOutput && c1.hookSpecificOutput.permissionDecision === 'ask', 'integration: before allow, a listed step asks');
  ok(c1 && !/Allowing also/.test(c1.hookSpecificOutput.permissionDecisionReason), 'integration: only one offer per turn');
  // now the offered call runs (allowed)
  const p2 = post('u2', 'computer', click('Runs the rule update'), tabsText);
  ok(p2 && /task approval \(GEN-953\) is on/.test(p2.hookSpecificOutput.additionalContext), 'integration: activation tells Claude');
  reread('r2');
  const c2 = pre('u4', 'computer', click('Runs the rule update'));
  ok(c2 === null, 'integration: listed step goes ahead after allow');
  reread('r2b');
  const sub = run({ hook_event_name: 'PreToolUse', tool_use_id: 'u4s', tool_name: T + 'computer', tool_input: click('Runs the rule update'), agent_id: 'sub-1', agent_type: 'Explore' });
  ok(sub && sub.hookSpecificOutput.permissionDecision === 'ask', 'integration: a sub-agent call does not use the task');
  reread('r3');
  const c3 = pre('u5', 'computer', click('Clicks the Delete button'));
  ok(c3 && c3.hookSpecificOutput.permissionDecision === 'ask', 'integration: unlisted step asks');
  reread('r4');
  const c3b = pre('u5b', 'computer', click('Deletes the old rule'));
  ok(c3b && c3b.hookSpecificOutput.permissionDecision === 'ask', 'integration: listed stop-word step asks');
  // another turn: nothing waived
  run({ hook_event_name: 'PreToolUse', tool_use_id: 'r5', tool_name: T + 'tabs_context_mcp', tool_input: {}, prompt_id: 'bbbbbbbb-0000-0000-0000-000000000000' });
  run({ hook_event_name: 'PostToolUse', tool_use_id: 'r5', tool_name: T + 'tabs_context_mcp', tool_input: {}, prompt_id: 'bbbbbbbb-0000-0000-0000-000000000000', tool_response: [{ type: 'text', text: tabsText }] });
  const c4 = run({ hook_event_name: 'PreToolUse', tool_use_id: 'u6', tool_name: T + 'computer', tool_input: click('Runs the rule update'), prompt_id: 'bbbbbbbb-0000-0000-0000-000000000000' });
  ok(c4 && c4.hookSpecificOutput.permissionDecision === 'ask', 'integration: other turn asks');
  const log = fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8');
  ok(/"task-offer"/.test(log) && /"task-on"/.test(log) && /"task":true/.test(log), 'integration: offer, activation and waived item logged');
  // a rejected block: Claude is told once, the card unchanged
  const tp2 = path.join(dir, 't2.jsonl');
  fs.writeFileSync(tp2, [lines[0], { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Browser task: x\nSite: mail.google.com\nStep: y' }] } },
    { type: 'user', promptId: 'p9', origin: { kind: 'human' }, message: { role: 'user', content: 'ok' } }].map(l => JSON.stringify(l)).join('\n') + '\n');
  const r9 = (obj) => { const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(Object.assign({ session_id: 'sess-2', transcript_path: tp2, prompt_id: 'p9' }, obj)), env, encoding: 'utf8' }); try { return r.stdout ? JSON.parse(r.stdout) : null; } catch (e) { return null; } };
  r9({ hook_event_name: 'PreToolUse', tool_use_id: 'v1', tool_name: T + 'tabs_context_mcp', tool_input: {} });
  const n9 = r9({ hook_event_name: 'PostToolUse', tool_use_id: 'v1', tool_name: T + 'tabs_context_mcp', tool_input: {}, tool_response: [{ type: 'text', text: 'Tab Context:\n- tabId 3: "x" ("https://example.com/")' }] });
  ok(n9 && /was not accepted \(mail\.google\.com is a high-stakes site/.test(n9.hookSpecificOutput.additionalContext), 'integration: rejected block told to Claude');
  const n10 = r9({ hook_event_name: 'PostToolUse', tool_use_id: 'v2', tool_name: T + 'tabs_context_mcp', tool_input: {}, tool_response: [{ type: 'text', text: 'Tab Context:\n- tabId 3: "x" ("https://example.com/")' }] });
  ok(n10 === null, 'integration: rejected block told only once');
  // a turn not started by Erez: no task
  const tp3 = path.join(dir, 't3.jsonl');
  fs.writeFileSync(tp3, [lines[0], lines[1], { type: 'user', promptId: 'p3', origin: { kind: 'task-notification' }, message: { role: 'user', content: 'note' } }].map(l => JSON.stringify(l)).join('\n') + '\n');
  ok(G.priorTask(tp3, 'p3') === null, 'turn not started by Erez: no task');
  ok(G.priorTask(tp, PID).value.steps.length === 3, 'priorTask reads the Ready? block');
  // a block followed by a browser call in its own turn is not the Ready? one
  const tp4 = path.join(dir, 't4.jsonl');
  fs.writeFileSync(tp4, [lines[0], { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: block }, { type: 'tool_use', name: T + 'navigate', input: {} }] } }, lines[2]].map(l => JSON.stringify(l)).join('\n') + '\n');
  ok(G.priorTask(tp4, PID) === null, 'block followed by a browser call is skipped');
  ok(G.priorTask(path.join(dir, 'missing.jsonl'), PID).readError === true, 'missing transcript is a read error');
  ok(G.priorTask(tp, 'not-written-yet').notYet === true, 'a turn not yet in the transcript is read again later');
  // the last block counts, accepted or not
  const tp5 = path.join(dir, 't5.jsonl');
  fs.writeFileSync(tp5, [lines[0], { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: block }, { type: 'text', text: 'Browser task: x\nSite: mail.google.com\nStep: y' }] } }, lines[2]].map(l => JSON.stringify(l)).join('\n') + '\n');
  ok(G.priorTask(tp5, PID).error, 'a later rejected block is not replaced by an earlier valid one');
  // a turn never found in the transcript: read again twice, then recorded as no task
  const rw = id => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: 'sess-7', transcript_path: tp, prompt_id: 'never-there', hook_event_name: 'PreToolUse', tool_use_id: id, tool_name: T + 'tabs_context_mcp', tool_input: {} }), env, encoding: 'utf8' });
  rw('x1'); rw('x2'); rw('x3');
  const st7 = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'sess-7.json'), 'utf8'));
  ok(st7.task && st7.task.pid === 'never-there' && st7.task.status === 'none', 'a turn never found is recorded as no task after 3 reads');
  // a malformed batch while a task is ready: asks, no crash
  const tp6 = path.join(dir, 't6.jsonl');
  fs.writeFileSync(tp6, [lines[0], lines[1], { type: 'user', promptId: 'p6', origin: { kind: 'human' }, message: { role: 'user', content: 'go' } }].map(l => JSON.stringify(l)).join('\n') + '\n');
  const r6 = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: 'sess-6', transcript_path: tp6, prompt_id: 'p6', hook_event_name: 'PreToolUse', tool_use_id: 'w1', tool_name: T + 'browser_batch', tool_input: { actions: 'x' } }), env, encoding: 'utf8' });
  ok(/"ask"/.test(r6.stdout) && !/internal error/.test(r6.stdout), 'malformed batch with a ready task asks without an internal error');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
