// SUPERSEDED (GEN-889/GEN-990, 2026-10-29): the browser notes are now two files (refs/browser.md +
// refs/browser-sites.md, part 2 on the next call); this build-time test still expects one file. The
// current tests are notes/gen889/test.js. Kept as the GEN-883 build record.
// Smoke test for the working-copy hook: pure core + one real stdin run.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = __dirname;
const hook = path.join(dir, 'inject-browser-refs.js');
const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'gen883-hooks-'));
fs.mkdirSync(path.join(fx, 'refs'), { recursive: true });
fs.copyFileSync(path.join(dir, 'browser.md'), path.join(fx, 'refs', 'browser.md'));
fs.copyFileSync(path.join(dir, 'browser-accounts.json'), path.join(fx, 'refs', 'browser-accounts.json'));
const mod = require(hook);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen883-'));
const logDir = path.join(process.env.LOCALAPPDATA, 'Claude', 'Logs');
const DIAG = /^browser-diagnose \(GEN-883\)/;
let n = 0, fail = 0;
function t(name, data, expect, now) {
  n++;
  const out = mod.handle(data, { tmpDir: tmp, hooksDir: fx, logDir, now: now || Date.now() }) || '';
  const ok = expect(out);
  if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' | ' + out.slice(0, 140).replace(/\n/g, ' '));
}
const NC = '⚠️ **Claude in Chrome is not connected**\n\nThe Chrome extension isn\'t reachable right now. If browser tools were working earlier in this session, this is usually transient — retry in a moment.\n\nIf retries keep failing, or browser tools have never worked in this session, the extension is likely not installed or not signed in. Tell the user how to fix it (include the link):\n1. Install the Claude in Chrome extension: https://chromewebstore.google.com/detail/fcoeoabgfenejglbffodgkkbkcdhcgfn\n2. Open the Claude side panel in Chrome and sign in with the same account as this app.\nThen retry the browser tool.';
const PAGE = 'Inbox\nURGENT: Snowflake check - could not run. Claude in Chrome is not connected; three tries failed.\n' + 'x'.repeat(2000);
t('ToolSearch naming chrome -> notes', { session_id: 's1', tool_name: 'ToolSearch', tool_input: { query: 'select:mcp__claude-in-chrome__tabs_context_mcp' } }, o => o.startsWith('Browser work'));
t('second call same session -> nothing', { session_id: 's1', tool_name: 'mcp__claude-in-chrome__navigate', tool_response: 'ok' }, o => o === '');
t('real banner -> diagnosis', { session_id: 's1', tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_response: [{ type: 'text', text: NC }] }, o => DIAG.test(o));
t('repeat in same window -> one-line pointer', { session_id: 's1', tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_response: NC }, o => /still not connected -- .*fix: open/.test(o) && o.length < 700);
t('tab-context listing a "not connected" title -> NO diagnosis', { session_id: 's12', tool_name: 'mcp__claude-in-chrome__navigate', tool_response: [{ type: 'text', text: 'Navigated.' }, { type: 'text', text: 'Tab Context:\n- Claude in Chrome is not connected (Gmail)' }] }, o => !DIAG.test(o));
{ // settle guard: pretend "now" is 30 s after the real log's last link connect
  const st = mod.readState(logDir);
  const linkMs = Date.parse(st.linkTs.replace(' ', 'T'));
  const evCount = () => { try { return fs.readFileSync(path.join(fx, 'browser-events.jsonl'), 'utf8').split('\n').filter(Boolean).length; } catch (e) { return 0; } };
  const before = evCount();
  const base = Math.max(linkMs, st.lastExtKind === 'left' ? Date.parse(st.lastExt.replace(' ', 'T')) : 0);
  t('event 30 s ago -> wait-and-retry, not counted', { session_id: 's13', tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_response: NC }, o => /may still be settling/.test(o) && evCount() === before, base + 30000);
  t('retry 55 s after -> full diagnosis + counted', { session_id: 's13', tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_response: NC }, o => DIAG.test(o) && /no browser is answering/.test(o) && !/Comet/.test(o) && evCount() === before + 1, base + 55000);
}
t('next window -> diagnosis again', { session_id: 's1', tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_response: NC }, o => DIAG.test(o), Date.now() + 11 * 60000);
t('page text with phrase -> NO diagnosis', { session_id: 's7', tool_name: 'mcp__claude-in-chrome__get_page_text', tool_response: [{ type: 'text', text: PAGE }] }, o => !DIAG.test(o) && o.startsWith('Browser work'));
t('short page text "not connected" -> NO diagnosis', { session_id: 's8', tool_name: 'mcp__claude-in-chrome__find', tool_response: 'Status: not connected' }, o => !DIAG.test(o));
t('empty list -> diagnosis first, then notes', { session_id: 's2', tool_name: 'mcp__claude-in-chrome__list_connected_browsers', tool_response: [{ type: 'text', text: '[]' }] }, o => DIAG.test(o) && o.indexOf('Browser work') > 0);
t('non-empty list -> no diagnosis', { session_id: 's3', tool_name: 'mcp__claude-in-chrome__list_connected_browsers', tool_response: [{ type: 'text', text: '[{"deviceId":"x"}]' }] }, o => !DIAG.test(o));
t('failure event error text', { session_id: 's4', hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__claude-in-chrome__navigate', error: '[claude-in-chrome] No Chrome extension connected after discovery' }, o => DIAG.test(o));
t('failure with unrelated error -> no diagnosis', { session_id: 's9', hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__claude-in-chrome__navigate', error: 'The tabs_close_mcp tool did not respond in time' }, o => !DIAG.test(o));
t('alt spelling Claude_in_Chrome', { session_id: 's10', tool_name: 'mcp__Claude_in_Chrome__tabs_context_mcp', tool_response: NC }, o => DIAG.test(o));
t('subagent skipped', { session_id: 's5', agent_id: 'a1', tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_response: NC }, o => o === '');
t('other tool ignored', { session_id: 's6', tool_name: 'Bash', tool_response: 'Claude in Chrome is not connected' }, o => o === '');
t('no session id -> nothing', { tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_response: NC }, o => o === '');
// re-evaluate bar: events in 2 separate hours
const ev = path.join(fx, 'browser-events.jsonl');
fs.writeFileSync(ev, JSON.stringify({ ts: '2026-11-01T09:00:00Z' }) + '\n');
t('bar reached on 2nd separate hour', { session_id: 's11', tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_response: NC }, o => /Re-evaluate bar reached/.test(o), Date.parse('2026-11-01T12:00:00Z'));
// diagnose branches with labels
const labels = JSON.parse(fs.readFileSync(path.join(dir, 'browser-accounts.json'), 'utf8'));
for (const st of [
  { readable: true, appAcct: 'c68119fc', linkAcct: 'a47791bc', linkTs: '2026-10-21 08:33:50', lastExt: '2026-10-21 10:20:06', lastExtKind: 'left' },
  { readable: true, appAcct: 'c68119fc', linkAcct: 'c68119fc', linkTs: '2026-10-21 14:09:36', lastExt: '2026-10-21 08:00:00', lastExtKind: 'seen' },
  { readable: true, appAcct: null, linkAcct: 'deadbeef', linkTs: null, lastExt: null },
  { readable: false },
]) { const d = mod.diagnose(st, labels); console.log('\n[' + d.reason + '] ' + d.text); }
// episodes: two events 30 min apart = one outage (no bar); a third 3 h later = two (bar)
{
  const fx2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gen883-ep-'));
  fs.mkdirSync(path.join(fx2, 'refs'));
  fs.writeFileSync(path.join(fx2, 'browser-events.jsonl'), JSON.stringify({ ts: '2026-11-02T05:30:00Z' }) + '\n');
  const o1 = mod.handle({ session_id: 'e1', tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_response: NC }, { tmpDir: tmp, hooksDir: fx2, logDir, now: Date.parse('2026-11-02T06:00:00Z') }) || '';
  n++; if (/Re-evaluate bar/.test(o1)) fail++; console.log((/Re-evaluate bar/.test(o1) ? 'FAIL ' : 'PASS ') + 'one outage across an hour edge -> no bar');
  const o2 = mod.handle({ session_id: 'e2', tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_response: NC }, { tmpDir: tmp, hooksDir: fx2, logDir, now: Date.parse('2026-11-02T09:30:00Z') }) || '';
  n++; if (!/Re-evaluate bar reached: 2 separate/.test(o2)) fail++; console.log((/Re-evaluate bar reached: 2 separate/.test(o2) ? 'PASS ' : 'FAIL ') + 'second separate outage -> bar');
}
// link-down: an app restart / bridge close after the last link connect
{
  const d = mod.diagnose({ readable: true, appAcct: 'c68119fc', linkAcct: 'a47791bc', linkTs: '2026-10-21 08:33:50', lastExt: null, lastDown: '2026-10-21 14:07:00', linkDown: true }, labels);
  n++; const ok = d.reason === 'link-down' && /dropped at 2026-10-21 14:07:00/.test(d.text) && /info@muuula.com/.test(d.text); if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + 'link-down branch | ' + d.text.slice(0, 150));
  const st = mod.readState(logDir);
  n++; const ok2 = st.linkDown === false || (st.lastDown > st.linkTs); if (!ok2) fail++;
  console.log((ok2 ? 'PASS ' : 'FAIL ') + 'real log linkDown consistent: ' + JSON.stringify({ linkTs: st.linkTs, lastDown: st.lastDown, linkDown: st.linkDown }));
}
// markers live in the subdir, not the temp root
n++; { const ok = fs.existsSync(path.join(tmp, 'claude-browser-hook')) && !fs.readdirSync(tmp).some((x) => /^claude-browser-(diag|settle)/.test(x)); if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + 'throttle markers in claude-browser-hook/'); }
console.log('\nstate from real log:', JSON.stringify(mod.readState(logDir)));
// real integration: stdin + JSON output, and --explain
// run a copy inside the temp fixture dir, so its events log never lands next to the working copy
fs.copyFileSync(hook, path.join(fx, 'inject-browser-refs.js'));
const r = spawnSync(process.execPath, [path.join(fx, 'inject-browser-refs.js')], { input: JSON.stringify({ session_id: 'smoke-' + Date.now(), hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__claude-in-chrome__x', error: 'Claude in Chrome is not connected' }), encoding: 'utf8' });
let parsed = null; try { parsed = JSON.parse(r.stdout); } catch (e) {}
console.log('stdin run exit', r.status, 'event', parsed && parsed.hookSpecificOutput.hookEventName, 'len', parsed && parsed.hookSpecificOutput.additionalContext.length);
const x = spawnSync(process.execPath, [hook, '--explain'], { encoding: 'utf8' });
console.log('--explain exit', x.status, '|', x.stdout.slice(0, 120));
const md = fs.readFileSync(path.join(dir, 'browser.md'), 'utf8');
let longest = 0;
for (const st of [{ readable: true, appAcct: 'c68119fc', linkAcct: 'a47791bc', linkTs: '2026-10-21 08:33:50', lastExt: '2026-10-21 10:20:06', lastExtKind: 'left' }, { readable: false }]) {
  longest = Math.max(longest, [...mod.diagnose(st, labels).text].length);
}
const total = [...md].length + longest + 400; // + re-evaluate line + separator
n++; if (total > 9000) fail++;
console.log((total <= 9000 ? 'PASS ' : 'FAIL ') + 'size: browser.md ' + [...md].length + ' + longest diagnosis ' + longest + ' + 400 = ' + total + ' / 9000');
console.log(`\n${n - fail}/${n} passed`);
