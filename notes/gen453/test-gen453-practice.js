// GEN-453 v3: behavioural suite for the Notion practice page in the ticket gate. Runs the working-copy
// hook as a real PreToolUse process (GEN-508 harness). The practice page id is pinned in the hook.
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./test-gen508-harness.js');

const STAGING = path.join(H.DIR, '..', '..', '.claude-staging');
const EVENTS = path.join(STAGING, 'ticket-gate-events.jsonl');
const PP = '3f36e495d07c81f0b7c1d2ce5db8d12d';
const PP_DASHED = '3f36e495-d07c-81f0-b7c1-d2ce5db8d12d';
const OTHER = H.PAGE; // a real Team-Tasks ticket id
const LT = '<';
const { check, state } = H.newChecker();
const upd = ti => H.mcp('notion-update-page', ti);
const refusedPP = r => H.ticketBlockReason(r) === 'practice-page-plain-only';
const isNoPass = r => H.ticketBlockReason(r) === 'no-pass';
const cu = (o, n, extra) => [Object.assign({ old_str: o, new_str: n }, extra || {})];
let r;

try { fs.rmSync(EVENTS, { force: true }); } catch (e) { /* none */ }

console.log('== 1. plain edits on the practice page fall through ==');
const ok = [
  ['update_content (dashed id)', { page_id: PP_DASHED, command: 'update_content', content_updates: cu('Alpha', 'Alpha2') }],
  ['update_content (bare id, allow_async false)', { page_id: PP, command: 'update_content', content_updates: cu('Alpha', 'Alpha2'), allow_async: false }],
  ['update_content, two pairs + replace_all_matches', { page_id: PP, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b', replace_all_matches: true }, { old_str: 'c', new_str: 'd' }] }],
  ['update_content deleting a paragraph (empty new_str)', { page_id: PP, command: 'update_content', content_updates: cu('Alpha paragraph plain text.', '') }],
  ['insert_content, no position', { page_id: PP, command: 'insert_content', content: 'New para' }],
  ['insert_content, position end', { page_id: PP, command: 'insert_content', content: 'New para', position: { type: 'end' } }],
  ['insert_content, position start', { page_id: PP, command: 'insert_content', content: 'New para', position: { type: 'start' } }],
  ['replace_content', { page_id: PP, command: 'replace_content', new_str: 'Alpha\n\nBravo with `inline.code` and a [link](https://example.com)\n\n- Delta\n- Echo' }],
  ['replace_content emptying the page', { page_id: PP, command: 'replace_content', new_str: '' }],
  ['title edit', { page_id: PP, command: 'update_properties', properties: { title: 'Notion practice page' } }],
  ['page_id with spaces + upper case', { page_id: ' ' + PP_DASHED.toUpperCase() + ' ', command: 'update_content', content_updates: cu('a', 'b') }],
  ['single braces, markdown link, inline code, short hex', { page_id: PP, command: 'insert_content', content: 'a { b } [t](https://example.com/x) `code.js` deadbeef' }]
];
for (const [name, ti] of ok) { r = upd(ti); check(name + ' falls through', H.fellThrough(r), r.err.slice(0, 160)); }
let ev = '';
try { ev = fs.readFileSync(EVENTS, 'utf8'); } catch (e) { /* none */ }
check('each exempt write is logged as a sandbox-exempt event', (ev.match(/"event":"sandbox-exempt"/g) || []).length === ok.length, (ev.match(/"event":"sandbox-exempt"/g) || []).length + ' events');

console.log('== 2. anything else aimed at the practice page is REFUSED (practice-page-plain-only) ==');
const otherUrl = 'https://app.notion.com/p/' + OTHER;
const bad = [
  ['page tag moving another page in', { page_id: PP, command: 'insert_content', content: LT + 'page url="' + otherUrl + '">X' + LT + '/page>' }],
  ['bare child-page tag', { page_id: PP, command: 'replace_content', new_str: 'x\n' + LT + 'page>Child' + LT + '/page>' }],
  ['database tag', { page_id: PP, command: 'insert_content', content: LT + 'database url="' + otherUrl + '">D' + LT + '/database>' }],
  ['synced block reference', { page_id: PP, command: 'insert_content', content: LT + 'synced_block_reference url="' + otherUrl + '">x' + LT + '/synced_block_reference>' }],
  ['mention of the practice page itself', { page_id: PP, command: 'insert_content', content: LT + 'mention-page url="https://app.notion.com/p/' + PP + '"/>' }],
  ['callout (harmless tag, still non-plain)', { page_id: PP, command: 'insert_content', content: LT + 'callout>hi' + LT + '/callout>' }],
  ['empty-block tag', { page_id: PP, command: 'insert_content', content: LT + 'empty-block/>' }],
  ['full-width angle bracket (NFKC folds to <)', { page_id: PP, command: 'insert_content', content: '＜page＞x' }],
  ['HTML entity &lt;', { page_id: PP, command: 'insert_content', content: '&lt;page&gt;' }],
  ['numeric entity &#60;', { page_id: PP, command: 'insert_content', content: '&#60;page' }],
  ['compressed placeholder {{3}}', { page_id: PP, command: 'insert_content', content: 'x {{3}} y' }],
  ['placeholder fragment }} in new_str', { page_id: PP, command: 'update_content', content_updates: cu('5', '9}}') }],
  ['tag-renaming fragment edit is allowed only if plain: old_str with <', { page_id: PP, command: 'update_content', content_updates: cu(LT + 'callout', LT + 'page') }],
  ['foreign 32-hex id in text', { page_id: PP, command: 'insert_content', content: 'see ' + OTHER }],
  ['the practice id itself in text', { page_id: PP, command: 'insert_content', content: 'this is ' + PP_DASHED }],
  ['foreign page URL (slug)', { page_id: PP, command: 'insert_content', content: 'see https://app.notion.com/p/Title-' + OTHER }],
  ['allow_deleting_content', { page_id: PP, command: 'replace_content', new_str: 'x', allow_deleting_content: true }],
  ['in_trash', { page_id: PP, command: 'update_properties', properties: { title: 'x' }, in_trash: true }],
  ['icon', { page_id: PP, command: 'update_properties', properties: { title: 'x' }, icon: 'x' }],
  ['cover', { page_id: PP, command: 'replace_content', new_str: 'y', cover: 'none' }],
  ['is_skill', { page_id: PP, command: 'update_content', content_updates: cu('a', 'b'), is_skill: true }],
  ['template_id', { page_id: PP, command: 'update_content', content_updates: cu('a', 'b'), template_id: 'x' }],
  ['apply_template', { page_id: PP, command: 'apply_template', template_id: 'x' }],
  ['update_verification', { page_id: PP, command: 'update_verification', verification_status: 'verified' }],
  ['update_content without content_updates', { page_id: PP, command: 'update_content' }],
  ['update_content with empty content_updates', { page_id: PP, command: 'update_content', content_updates: [] }],
  ['content_updates element with an extra key', { page_id: PP, command: 'update_content', content_updates: cu('a', 'b', { extra: 1 }) }],
  ['replace_all_matches not boolean', { page_id: PP, command: 'update_content', content_updates: cu('a', 'b', { replace_all_matches: 'yes' }) }],
  ['non-string new_str', { page_id: PP, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 5 }] }],
  ['update_content also carrying content', { page_id: PP, command: 'update_content', content_updates: cu('a', 'b'), content: 'x' }],
  ['insert_content without content', { page_id: PP, command: 'insert_content', position: { type: 'end' } }],
  ['insert_content position after a block', { page_id: PP, command: 'insert_content', content: 'x', position: { type: 'after', block: 'abc' } }],
  ['insert_content position with extra key', { page_id: PP, command: 'insert_content', content: 'x', position: { type: 'end', extra: 1 } }],
  ['non-string content', { page_id: PP, command: 'insert_content', content: 42 }],
  ['title + another property', { page_id: PP, command: 'update_properties', properties: { title: 'x', Urgency: 'Urgent' } }],
  ['property named Title (not exactly title)', { page_id: PP, command: 'update_properties', properties: { Title: 'x' } }],
  ['non-string title', { page_id: PP, command: 'update_properties', properties: { title: { a: 1 } } }],
  ['properties as a JSON string (raw shape must be an object)', { page_id: PP, command: 'update_properties', properties: JSON.stringify({ title: 'x' }) }],
  ['allow_async not boolean', { page_id: PP, command: 'insert_content', content: 'x', allow_async: 'false' }],
  ['enveloped {data:"<json>"} write', { data: JSON.stringify({ page_id: PP, command: 'update_content', content_updates: cu('x', 'y') }) }],
  ['decoy: practice id in id, other page in page_id', { page_id: OTHER, id: PP, command: 'update_content', content_updates: cu('a', 'b') }],
  ['practice page + extra id key', { page_id: PP, id: OTHER, command: 'update_content', content_updates: cu('a', 'b') }],
  ['create-pages under the practice page', null],
  ['duplicate of the practice page', null],
  ['move of the practice page', null],
  ['move of a ticket INTO the practice page', null]
];
for (const [name, ti] of bad) {
  if (ti === null) continue;
  r = upd(ti); check(name + ' -> refused', refusedPP(r), 'reason=' + H.ticketBlockReason(r) + ' ' + r.err.slice(0, 120));
}
r = H.mcp('notion-create-pages', { parent: { page_id: PP, type: 'page_id' }, pages: [{ properties: { title: 'child' }, content: 'x' }] });
check('create-pages under the practice page -> refused', refusedPP(r), 'reason=' + H.ticketBlockReason(r));
r = H.mcp('notion-duplicate-page', { page_id: PP });
check('duplicate of the practice page -> refused', refusedPP(r), 'reason=' + H.ticketBlockReason(r));
r = H.mcp('notion-move-pages', { page_or_database_ids: [PP], new_parent: { page_id: OTHER, type: 'page_id' } });
check('move of the practice page -> refused', refusedPP(r), 'reason=' + H.ticketBlockReason(r));
r = H.mcp('notion-move-pages', { page_or_database_ids: [OTHER], new_parent: { page_id: PP, type: 'page_id' } });
check('move of a ticket INTO the practice page -> refused', refusedPP(r), 'reason=' + H.ticketBlockReason(r));
r = H.mcp('notion-update-page', { page_id: PP, command: 'insert_content', content: LT + 'page>x' + LT + '/page>' },
  Object.assign({}, process.env, { CLAUDE_CONFIG_UNLOCK: '1' }));
check('the refusal holds with break-glass on (CLAUDE_CONFIG_UNLOCK=1)', refusedPP(r), 'code=' + r.code + ' ' + r.err.slice(0, 120));

r = H.mcp('notion-move-pages', { page_or_database_ids: ['https://app.notion.com/p/' + PP + '?v=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'], new_parent: { page_id: OTHER, type: 'page_id' } });
check('practice id beside a dashed uuid in the same value is still recognised -> refused', refusedPP(r), 'reason=' + H.ticketBlockReason(r));
r = H.mcp('notion-duplicate-page', { page_id: 'https://app.notion.com/p/dead-' + PP + '-beef' });
check('practice id inside a hex-bordered slug is still recognised -> refused', refusedPP(r), 'reason=' + H.ticketBlockReason(r));
r = H.mcp('notion-create-pages', { parent: { database_id: PP }, pages: [{ properties: { title: 'x' } }] });
check('create with the practice page named as a database parent -> refused', refusedPP(r), 'reason=' + H.ticketBlockReason(r));
r = upd({ page_id: PP, command: 'insert_content', content: 'x', position: { type: 'after', block: 'abc' } });
check('the refusal names the failed check', refusedPP(r) && r.err.indexOf('position is not exactly') !== -1, r.err.slice(0, 300));
r = upd({ page_id: PP, command: 'insert_content', content: 'x' + LT });
check('the refusal says no review record can clear it', refusedPP(r) && r.err.indexOf('do not run /vet-ticket') !== -1, r.err.slice(0, 300));

console.log('== 2b. the --ticket-hash CLI mints nothing for the practice page ==');
const PAYLOAD = path.join(H.DIR, 'test-payload.json');
fs.writeFileSync(PAYLOAD, JSON.stringify({ page_id: PP, command: 'insert_content', content: LT + 'page>x' + LT + '/page>' }));
let c = H.cli(['--ticket-hash', PAYLOAD, '--tool', 'update']);
check('--ticket-hash refuses a refused practice-page payload (exit 3, no hash)', c.code === 3 && !/^[0-9a-f]{64}/.test(c.out) && c.err.indexOf('REFUSES it') !== -1, 'code=' + c.code + ' out=' + c.out.slice(0, 70) + ' err=' + c.err.slice(0, 120));
fs.writeFileSync(PAYLOAD, JSON.stringify({ page_id: PP, command: 'insert_content', content: 'plain' }));
c = H.cli(['--ticket-hash', PAYLOAD, '--tool', 'update']);
check('--ticket-hash declines a plain practice-page payload (nothing to mint)', c.code === 3 && !/^[0-9a-f]{64}/.test(c.out) && c.err.indexOf('no review') !== -1, 'code=' + c.code + ' err=' + c.err.slice(0, 120));
fs.writeFileSync(PAYLOAD, JSON.stringify({ page_id: OTHER, command: 'insert_content', content: 'x' }));
c = H.cli(['--ticket-hash', PAYLOAD, '--tool', 'update']);
check('--ticket-hash still hashes an ordinary ticket payload', c.code === 0 && /^[0-9a-f]{64}/.test(c.out), 'code=' + c.code + ' err=' + c.err.slice(0, 120));

console.log('== 3. writes to OTHER pages are unchanged ==');
r = upd({ page_id: OTHER, command: 'update_content', content_updates: cu('a', 'b') });
check('a ticket body edit is still gated no-pass', isNoPass(r), 'reason=' + H.ticketBlockReason(r));
r = upd({ page_id: OTHER, command: 'insert_content', content: 'see the practice page https://app.notion.com/p/' + PP });
check('a ticket edit that only MENTIONS the practice page in text is still the ordinary no-pass', isNoPass(r), 'reason=' + H.ticketBlockReason(r));
r = upd({ page_id: H.GEN58, command: 'insert_content', content: 'log line' });
check('a GEN-58 log append still falls through', H.fellThrough(r), r.err.slice(0, 120));
r = upd({ page_id: OTHER, command: 'update_properties', properties: { Status: 'Done' } });
check('a housekeeping Status edit on a ticket still falls through', H.fellThrough(r), r.err.slice(0, 120));
const JIRA = 'mcp__9da13451-799f-4bf6-9a8f-58fe25fc6c80__editJiraIssue';
r = H.run({ tool_name: JIRA, tool_input: { cloudId: 'x', issueIdOrKey: 'MD-1', fields: { summary: 's' } }, cwd: H.DIR, transcript_path: path.join(H.DIR, 'nope.jsonl') });
check('a non-practice Jira ticket is still staging-blocked', r.code === 2 && r.err.toLowerCase().indexOf('staging') !== -1, r.err.slice(0, 120));

console.log('== 4. no slow path ==');
const t0 = Date.now();
r = upd({ page_id: PP, command: 'update_content', content_updates: [
  { old_str: 'Alpha', new_str: 'url=' + ' '.repeat(1500000) + 'x' },
  { old_str: 'Bravo', new_str: LT + 'page url="' + otherUrl + '">x' + LT + '/page>' }] });
const dt = Date.now() - t0;
check('1.5M-space decoy + page tag is refused in under 10 s (' + dt + ' ms)', refusedPP(r) && dt < 10000, 'reason=' + H.ticketBlockReason(r));
r = upd({ page_id: PP, command: 'replace_content', new_str: 'x'.repeat(2200000) });
check('an over-budget practice-page write gets the practice refusal, not the clearable unreadable block', refusedPP(r) && r.err.indexOf('could not read the payload in full') !== -1, 'reason=' + H.ticketBlockReason(r) + ' ' + r.err.slice(0, 160));
const BIG = 'x'.repeat(2200000);
const BG = Object.assign({}, process.env, { CLAUDE_CONFIG_UNLOCK: '1' });
const overs = [
  ['over-budget create under the practice page', 'notion-create-pages', { parent: { page_id: PP, type: 'page_id' }, pages: [{ properties: { title: 't' }, content: BIG }] }],
  ['over-node-budget create under the practice page', 'notion-create-pages', { parent: { page_id: PP, type: 'page_id' }, pages: Array.from({ length: 1500 }, () => ({ properties: { title: 't' } })) }],
  ['over-budget move into the practice page', 'notion-move-pages', { page_or_database_ids: [OTHER], new_parent: { page_id: PP, type: 'page_id' }, pad: BIG }],
  ['over-budget enveloped practice write', 'notion-update-page', { data: JSON.stringify({ page_id: PP, command: 'insert_content', content: LT + 'page>x' + LT + '/page>' + BIG }) }]
];
for (const [name, tool, ti] of overs) {
  r = H.mcp(tool, ti); check(name + ' -> refused', refusedPP(r), 'reason=' + H.ticketBlockReason(r) + ' ' + r.err.slice(0, 120));
  r = H.mcp(tool, ti, BG); check(name + ' -> refused even with break-glass', refusedPP(r), 'reason=' + H.ticketBlockReason(r) + ' code=' + r.code);
}
r = upd({ page_id: PP, command: 'update_properties', properties: { Status: 'Done' }, is_skill: true });
check('a housekeeping-shaped edit on the practice page (Status + is_skill) is refused, not housekept', refusedPP(r), 'reason=' + H.ticketBlockReason(r) + ' code=' + r.code);
r = upd({ page_id: OTHER, command: 'replace_content', new_str: 'x'.repeat(2200000) });
check('an over-budget ticket write still gets unreadable-payload', H.ticketBlockReason(r) === 'unreadable-payload', 'reason=' + H.ticketBlockReason(r));
const t1 = Date.now();
r = upd({ page_id: PP, command: 'replace_content', new_str: 'plain '.repeat(300000) });
const dt1 = Date.now() - t1;
check('a 1.8 MB plain replace falls through in under 10 s (' + dt1 + ' ms)', H.fellThrough(r) && dt1 < 10000, r.err.slice(0, 120));

H.cleanup();
console.log('\n' + (state.fail === 0 ? 'ALL PASS' : 'FAILURES') + ': ' + state.pass + ' passed, ' + state.fail + ' failed');
process.exit(state.fail === 0 ? 0 : 1);
