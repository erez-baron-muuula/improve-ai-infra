// Behavioural test harness for the rebuilt GEN-508 scoping layer.
//
// Loads auto-approve.next.js up to `// ---- main`, evaluates it in a sandbox with a FAKE home dir
// (so the pass dir and the page cache are isolated), a stubbed execFileSync (no network, no
// Credential Manager) and a stubbed process (so exit/stderr are observable), then runs:
//   PART A  the named edge cases from design-scoping-v3.md
//   PART B  every one of the 1,313 real corpus payloads, twice -- once with the resolver saying
//           "everything is a ticket" (the FAIL-OPEN detector: anything that comes back out-of-scope
//           there was not read properly) and once saying "nothing is a ticket"
//   PART C  the pass round-trip: mint -> block-without-pass -> approve-and-consume, run against an
//           ENVELOPED payload, plus a batch partial-consume
//   PART D  the shared --ticket-hash CLI and its allow-list matcher
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { execFileSync: realExec } = cp;

// Usage:  node test-gen508.js [hook.js] [corpus.jsonl]
// Defaults: ./auto-approve.working.js and ./notion-payload-corpus.jsonl (both beside this file).
// PART B is SKIPPED with a loud notice when the corpus is absent -- it is not committed, because it
// contains ticket bodies; regenerate it with scratchpad/build-corpus.js from the design notes.
const SCRATCH = __dirname;
const HOOK_SRC = process.argv[2] || path.join(SCRATCH, 'auto-approve.working.js');
const CORPUS = process.argv[3] || path.join(SCRATCH, 'notion-payload-corpus.jsonl');
const FAKE_HOOKS = path.join(os.tmpdir(), 'gen508-test-' + process.pid, '.claude', 'hooks');
const FAKE_HOME = path.join(FAKE_HOOKS, '..', '..');
const FAKE_STAGING = path.join(FAKE_HOME, '.claude-staging');
const TICKET_PASSES = path.join(FAKE_STAGING, 'ticket-passes');

const PFX = 'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__';
const T = {
  create: PFX + 'notion-create-pages',
  update: PFX + 'notion-update-page',
  dup: PFX + 'notion-duplicate-page',
  move: PFX + 'notion-move-pages'
};
const TT_DS = 'bd2cd17b-f58f-4993-8b95-468e881272fa';
const TT_DB = 'fe198002-6618-48d7-ae04-56f8cee479f3';
const GEN58 = '36d6e495d07c816e9e0cce265d694ab3';
const VOL6 = '3b06e495-d07c-8114-be75-cd8a65d7fc30';

// ---- sandbox ---------------------------------------------------------------
// resolver.mode: 'ticket' | 'workspace' | 'down' | fn(id) -> {code, parent}
const resolver = { mode: 'ticket', calls: 0, tokenCalls: 0 };

function stubExec(file, args, opts) {
  if (/powershell/i.test(file)) { resolver.tokenCalls++; return 'fake-token\n'; }
  if (/curl/i.test(file)) {
    resolver.calls++;
    const url = args.find(a => typeof a === 'string' && a.indexOf('api.notion.com') !== -1) || '';
    const id = url.split('/').pop();
    let r;
    if (typeof resolver.mode === 'function') r = resolver.mode(id);
    else if (resolver.mode === 'ticket') r = { code: 200, parent: { type: 'data_source_id', data_source_id: TT_DS, database_id: TT_DB } };
    else if (resolver.mode === 'workspace') r = { code: 200, parent: { type: 'workspace', workspace: true } };
    else r = { code: 503, parent: null };
    if (r.code !== 200) return JSON.stringify({ object: 'error', status: r.code }) + '\n' + r.code;
    return JSON.stringify({ object: 'page', id: id, parent: r.parent }) + '\n200';
  }
  throw new Error('unexpected execFileSync: ' + file);
}

const out = { stdout: '', stderr: '' };
class ExitSignal { constructor(code) { this.code = code; } }
const fakeProcess = {
  pid: 4242,
  argv: ['node', path.join(FAKE_HOOKS, 'auto-approve.js')],
  env: {},
  stdout: { write: s => { out.stdout += s; } },
  stderr: { write: s => { out.stderr += s; } },
  stdin: { setEncoding() {}, on() {} },
  exit: code => { throw new ExitSignal(code); }
};

function loadHook() {
  let src = fs.readFileSync(HOOK_SRC, 'utf8');
  const cut = src.indexOf('// ---- main ---');
  if (cut === -1) throw new Error('main marker not found');
  src = src.slice(0, cut).replace(/^#![^\r\n]*/, '');   // new Function() rejects a shebang
  const exposed = [
    'ticketNormalise', 'ticketScope', 'ticketIsHousekeepingOnly', 'ticketIsContentOnly',
    'ticketMarkerScan', 'ticketSplitIds', 'ticketIdsIn', 'enforceTicketVetting',
    'sha256Hex', 'stableStringify', 'isSafeTicketHash', 'ticketHashCli', 'findTicketPassFile',
    'consumeTicketPass', 'ticketPassMatches', 'cachePageFlag', 'cachedPageFlag',
    'TICKET_PASS_DIR', 'TEAM_TASKS_IDS', 'GEN58_PAGE_ID'
  ];
  src += '\nreturn {' + exposed.join(',') + '};\n';
  const patched = Object.assign({}, cp, { execFileSync: stubExec });
  const fakeRequire = name => (name === 'child_process' ? patched : require(name));
  // eslint-disable-next-line no-new-func
  const factory = new Function('require', '__dirname', '__filename', 'process', src);
  return factory(fakeRequire, FAKE_HOOKS, path.join(FAKE_HOOKS, 'auto-approve.js'), fakeProcess);
}

fs.rmSync(FAKE_HOME, { recursive: true, force: true });
fs.mkdirSync(FAKE_HOOKS, { recursive: true });
fs.mkdirSync(TICKET_PASSES, { recursive: true });
process.on('exit', () => { try { fs.rmSync(FAKE_HOME, { recursive: true, force: true }); } catch (e) {} });
console.log('hook under test : ' + HOOK_SRC);
const H = loadHook();

// ---- tiny assert -----------------------------------------------------------
let pass = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fails.push(name + (detail ? '   [' + detail + ']' : ''));
}
function scope(tool, ti, mode) {
  resolver.mode = mode === undefined ? 'ticket' : mode;
  const before = resolver.calls;
  const sc = H.ticketScope(tool, ti);
  return { sc: sc, netCalls: resolver.calls - before };
}
function clearCache() { try { fs.rmSync(path.join(FAKE_STAGING, 'notion-page-parents.json'), { force: true }); } catch (e) {} }

// ============================ PART A -- edge cases =========================
console.log('=== PART A: named edge cases ===');

// 1. envelope hash parity (design §5, round-2 finding 9)
const plain = { page_id: '36d6e495-d07c-816e-9e0c-ce265d694ab3', command: 'insert_content', new_str: 'hello' };
const enveloped = { data: JSON.stringify(plain) };
const nPlain = H.ticketNormalise(plain), nEnv = H.ticketNormalise(enveloped);
const hPlain = H.sha256Hex(H.stableStringify(nPlain.root));
const hEnv = H.sha256Hex(H.stableStringify(nEnv.root));
ok('A1 envelope hoist -> identical hash', nPlain.ok && nEnv.ok && hPlain === hEnv, hPlain.slice(0, 12) + ' vs ' + hEnv.slice(0, 12));
ok('A1b raw hashes would NOT have matched',
  H.sha256Hex(H.stableStringify(plain)) !== H.sha256Hex(H.stableStringify(enveloped)));

// 2. harness truncation -> hard block
const trunc = { __unparsedToolInput: { raw: '{"page_id":"36d6e495d07c816e9e0cce265d694ab3","comm', len: 900 } };
let r = scope(T.update, trunc);
ok('A2 __unparsedToolInput truncation blocks', r.sc.scope === 'block' && r.sc.reason === 'scope-unreadable', JSON.stringify(r.sc.reason) + '/' + r.sc.why);
ok('A2b truncation costs no network call', r.netCalls === 0, String(r.netCalls));

// 3/4/5. housekeeping closed shape, plain + enveloped + null-clear
clearCache();
r = scope(T.update, { page_id: TT_DB, command: 'update_properties', properties: { Status: 'Done' } });
ok('A3 housekeeping-only -> out', r.sc.scope === 'out', JSON.stringify(r.sc));
ok('A3b housekeeping costs no network call', r.netCalls === 0, String(r.netCalls));
r = scope(T.update, { data: JSON.stringify({ page_id: TT_DB, command: 'update_properties', properties: { Status: 'Done' } }) });
ok('A4 ENVELOPED housekeeping -> out (round-2 holistic advisory)', r.sc.scope === 'out' && r.netCalls === 0, JSON.stringify(r.sc) + ' calls=' + r.netCalls);
r = scope(T.update, { page_id: TT_DB, command: 'update_properties', properties: { Assignee: null, 'Parent item': [] } });
ok('A5 null clear counts as primitive -> out', r.sc.scope === 'out', JSON.stringify(r.sc));

// 5b. a substance property is NOT housekeeping
r = scope(T.update, { page_id: TT_DB, command: 'update_properties', properties: { Status: 'Done', Priority: 'High' } });
ok('A5b substance property -> in scope', r.sc.scope === 'in', JSON.stringify(r.sc));

// 6. the alternate inner schema is not exempt
clearCache();
r = scope(T.update, { pages: [{ id: '3806e495-d07c-81b3-8e37-e21aded65abc', properties: { Status: 'Done' }, content: { type: 'edits', edits: [] } }] });
ok('A6 alternate schema {pages:[...]} -> in scope, not exempt', r.sc.scope === 'in', JSON.stringify(r.sc));

// 7/8. malformed target ids block
r = scope(T.create, { parent: { page_id: 'placeholder' }, pages: [{ properties: {} }] });
ok('A7 page_id "placeholder" -> block bad-target', r.sc.scope === 'block' && r.sc.reason === 'bad-target', JSON.stringify(r.sc));
r = scope(T.update, { page_id: '3806e495-d07c-81b3-8e37-e21aded65', command: 'update_content', new_str: 'x' });
ok('A8 truncated uuid -> block bad-target', r.sc.scope === 'block' && r.sc.reason === 'bad-target', JSON.stringify(r.sc));

// 9/10. zero ids is two cases
r = scope(T.create, { pages: [{ properties: { title: 'a workspace page' } }] });
ok('A9 create with no parent anywhere -> out', r.sc.scope === 'out', JSON.stringify(r.sc));
r = scope(T.update, { command: 'update_content', new_str: 'x' });
ok('A10 update with no target key -> block no-target', r.sc.scope === 'block' && r.sc.reason === 'no-target', JSON.stringify(r.sc));
r = scope(T.dup, { title: 'copy' });
ok('A10b duplicate with no target key -> block no-target', r.sc.scope === 'block' && r.sc.reason === 'no-target', JSON.stringify(r.sc));

// 11. body text that merely LOOKS like JSON must not block (round-3 advisory)
clearCache();
for (const txt of ['[Vol. 3](https://app.notion.com/p/abc)', '[D recurrence - scope-mis-assignment] 2026-07-15', '{not json at all']) {
  r = scope(T.update, { page_id: '3806e495-d07c-81b3-8e37-e21aded65abc', command: 'insert_content', new_str: txt }, 'workspace');
  ok('A11 markdown/bracket body text does not block: ' + txt.slice(0, 22), r.sc.scope === 'out', JSON.stringify(r.sc));
}

// 12/13. marker scan catches the shapes the old layer missed, with zero network
clearCache();
r = scope(T.create, { parent: { data_source_url: 'collection://' + TT_DS }, pages: [{ properties: {} }] });
ok('A12 data_source_url create -> in via marker, 0 calls', r.sc.scope === 'in' && r.netCalls === 0, JSON.stringify(r.sc) + ' calls=' + r.netCalls);
r = scope(T.create, { pages: [{ parent: { data_source_id: TT_DS }, properties: {} }] });
ok('A13 nested parent create -> in via marker, 0 calls', r.sc.scope === 'in' && r.netCalls === 0, JSON.stringify(r.sc) + ' calls=' + r.netCalls);
r = scope(T.create, { data: JSON.stringify({ parent: { database_id: 'collection://' + TT_DB }, pages: [{}] }) });
ok('A13b enveloped create -> in via marker, 0 calls', r.sc.scope === 'in' && r.netCalls === 0, JSON.stringify(r.sc) + ' calls=' + r.netCalls);

// 14-17. the GEN-58 subtree carve-out
clearCache();
r = scope(T.update, { page_id: GEN58, command: 'insert_content', new_str: 'a write-up' });
ok('A14 GEN-58 page content write -> out, 0 calls', r.sc.scope === 'out' && r.netCalls === 0, JSON.stringify(r.sc) + ' calls=' + r.netCalls);
r = scope(T.update, { page_id: GEN58, command: 'update_content', old_str: 'a', new_str: 'quoting ' + TT_DS + ' in the body' });
ok('A15 GEN-58 write quoting a Team-Tasks id -> out (carve-out beats marker)', r.sc.scope === 'out' && r.netCalls === 0, JSON.stringify(r.sc) + ' calls=' + r.netCalls);
r = scope(T.update, { page_id: GEN58, command: 'update_properties', properties: { Priority: 'High' } });
ok('A16 GEN-58 substance PROPERTY edit -> in scope (still gated)', r.sc.scope === 'in', JSON.stringify(r.sc));
r = scope(T.update, { page_id: GEN58, command: 'update_properties', properties: { Status: 'Done' } });
ok('A16b GEN-58 housekeeping property edit -> out', r.sc.scope === 'out', JSON.stringify(r.sc));
// the log VOLUME: a child page of GEN-58, unknown on a cold cache
clearCache();
const volParent = id => (id === H.GEN58_PAGE_ID.replace(/-/g, '') || id === VOL6.replace(/-/g, ''))
  ? { code: 200, parent: { type: 'page_id', page_id: GEN58 } }
  : { code: 200, parent: { type: 'workspace' } };
r = scope(T.update, { page_id: VOL6, command: 'insert_content', new_str: 'entry N, mentioning ' + TT_DS }, volParent);
ok('A17 GEN-58 log VOLUME content write -> out', r.sc.scope === 'out', JSON.stringify(r.sc));
ok('A17b first volume write pays exactly one round-trip', r.netCalls === 1, String(r.netCalls));
r = scope(T.update, { page_id: VOL6, command: 'insert_content', new_str: 'entry N+1' }, volParent);
ok('A17c second volume write is cached, 0 calls', r.sc.scope === 'out' && r.netCalls === 0, JSON.stringify(r.sc) + ' calls=' + r.netCalls);
// and a volume write during an outage is NOT waved through (the stated residual). Two sub-cases:
// with a Team-Tasks id in the body the marker scan makes it in-scope, so it needs a pass; without
// one, resolution fails and it blocks outright. Either way the write does not land unreviewed.
clearCache();
r = scope(T.update, { page_id: VOL6, command: 'insert_content', new_str: 'x ' + TT_DS }, 'down');
ok('A17d cold cache + Notion down + marker in body -> needs a pass', r.sc.scope === 'in', JSON.stringify(r.sc));
ok('A17d2 and it attempted only one round-trip', r.netCalls === 1, String(r.netCalls));
clearCache();
r = scope(T.update, { page_id: VOL6, command: 'insert_content', new_str: 'plain entry text' }, 'down');
ok('A17e cold cache + Notion down, no marker -> block unresolved', r.sc.scope === 'block' && r.sc.reason === 'unresolved', JSON.stringify(r.sc));
ok('A17e2 and the failed resolution is memoised, not retried', r.netCalls === 1, String(r.netCalls));

// 18. move-out of a Team-Tasks row
clearCache();
r = scope(T.move, { page_or_database_ids: ['3806e495-d07c-81b3-8e37-e21aded65abc'], new_parent: { type: 'workspace' } }, 'ticket');
ok('A18 move-OUT of a ticket -> in scope', r.sc.scope === 'in', JSON.stringify(r.sc));
r = scope(T.move, { page_or_database_ids: ['3806e495-d07c-81b3-8e37-e21aded65abc'], new_parent: { data_source_id: TT_DS } }, 'workspace');
ok('A18b move-IN -> in via marker, 0 calls', r.sc.scope === 'in' && r.netCalls === 0, JSON.stringify(r.sc) + ' calls=' + r.netCalls);
ok('A18c move-IN seeds the moved page', (r.sc.seedIds || []).length === 1, JSON.stringify(r.sc.seedIds));
r = scope(T.move, { page_or_database_ids: ['3806e495-d07c-81b3-8e37-e21aded65abc'], new_parent: { type: 'workspace' } }, 'ticket');
ok('A18d move-OUT seeds nothing', (r.sc.seedIds || []).length === 0, JSON.stringify(r.sc.seedIds));

// 19. resolver failures all mean unknown -> block
clearCache();
for (const code of [401, 403, 404, 429, 500]) {
  r = scope(T.update, { page_id: '3806e495-d07c-81b3-8e37-e21aded65abc', command: 'update_content', new_str: 'x' }, () => ({ code: code, parent: null }));
  ok('A19 HTTP ' + code + ' -> block unresolved (no 404 shortcut)', r.sc.scope === 'block' && r.sc.reason === 'unresolved', JSON.stringify(r.sc));
}

// 20. budget: cost bounds hold
clearCache();
// 32 hex chars each, all distinct: 27-char prefix + a 5-digit index.
const many = Array.from({ length: 20 }, (_, i) => '3806e495d07c81b38e37e21aded' + String(100000 + i).slice(1));
ok('A20-pre the test ids really are 32-hex', many.every(x => /^[0-9a-f]{32}$/.test(x)), many[0] + ' len=' + many[0].length);
r = scope(T.move, { page_or_database_ids: many, new_parent: { type: 'workspace' } }, 'workspace');
ok('A20 at most 8 ids resolved per call', r.netCalls <= 8, String(r.netCalls));
ok('A20b exhausted cap -> unknown -> block', r.sc.scope === 'block' && r.sc.reason === 'unresolved', JSON.stringify(r.sc));

// 21. prototype pollution / weird keys
const before = Object.prototype.polluted;
r = scope(T.update, { page_id: GEN58, command: 'insert_content', __proto__: { polluted: true }, new_str: 'x' });
ok('A21 __proto__ in payload does not pollute Object.prototype', Object.prototype.polluted === before && before === undefined);
ok('A21b and does not throw', r.sc.scope === 'out' || r.sc.scope === 'block', JSON.stringify(r.sc));
r = scope(T.update, { page_id: GEN58, command: 'update_properties', properties: JSON.parse('{"__proto__":{"x":1},"Status":"Done"}') });
ok('A21c __proto__ property key is treated as substance -> gated', r.sc.scope === 'in', JSON.stringify(r.sc));

// 22. budget exhaustion on a pathological payload, and it must not hang
let deep = 'leaf';
for (let i = 0; i < 40; i++) deep = { nest: deep };
r = scope(T.update, { page_id: GEN58, command: 'insert_content', body: deep });
ok('A22 over-deep payload -> block scope-unreadable', r.sc.scope === 'block' && r.sc.reason === 'scope-unreadable', JSON.stringify(r.sc) + '/' + r.sc.why);
const wide = { page_id: GEN58, command: 'insert_content', xs: Array.from({ length: 6000 }, (_, i) => 'n' + i) };
r = scope(T.update, wide);
ok('A22b over-wide payload -> block scope-unreadable', r.sc.scope === 'block' && r.sc.reason === 'scope-unreadable', JSON.stringify(r.sc) + '/' + r.sc.why);

// 23. non-object payloads
for (const bad of [null, 42, true, undefined]) {
  r = scope(T.update, bad);
  ok('A23 non-object payload ' + String(bad) + ' -> block', r.sc.scope === 'block' && r.sc.reason === 'scope-unreadable', JSON.stringify(r.sc));
}
// a top-level JSON STRING is a legal envelope
r = scope(T.update, JSON.stringify({ page_id: GEN58, command: 'insert_content', new_str: 'x' }));
ok('A23b top-level JSON string payload -> read + carve-out -> out', r.sc.scope === 'out', JSON.stringify(r.sc));
r = scope(T.update, 'not json');
ok('A23c top-level non-JSON string -> block', r.sc.scope === 'block' && r.sc.reason === 'scope-unreadable', JSON.stringify(r.sc));

// 24a. a page_id given as a full Notion URL now RESOLVES (the old layer blocked all 5 as unparsable)
const URLID = '3806e495d07c81b38e37e21aded65abc';                              // exactly 32 hex
clearCache();
r = scope(T.update, { page_id: 'https://app.notion.com/p/' + URLID, command: 'update_content', old_str: 'a', new_str: 'b' }, 'ticket');
ok('A24a URL-form page_id resolves instead of blocking', r.sc.scope === 'in' && r.sc.ids.indexOf(URLID) !== -1, JSON.stringify(r.sc));
clearCache();
r = scope(T.update, { page_id: 'https://www.notion.so/muuula/GEN-508-Some-Title-' + URLID, command: 'insert_content', new_str: 'x' }, 'workspace');
// A BARE (undashed) id at the end of a slug is the hypothetical ambiguous case -- "title" ends in a
// hex 'e', so dash-stripping merges it into a 33-char run. Both windows are tried, so the real id is
// still found; the cost is one extra resolver call. No corpus payload takes this branch.
const bareSlug = 'https://www.notion.so/muuula/GEN-508-Some-Title-' + URLID;
ok('A24b bare-id slug URL still finds the real id', H.ticketIdsIn(bareSlug).indexOf(URLID) !== -1, JSON.stringify(H.ticketIdsIn(bareSlug)));
ok('A24b1 at the documented cost of one extra candidate', r.sc.scope === 'out' && r.netCalls === 2, JSON.stringify(r.sc) + ' calls=' + r.netCalls);
// the same page named by a DASHED id inside a slug: the dashed pattern pins it exactly, one call
clearCache();
const dashedUrl = 'https://www.notion.so/muuula/GEN-508-Fix-deadbeef-3806e495-d07c-81b3-8e37-e21aded65abc';
ok('A24b3 dashed id in a slug URL extracts exactly one id',
  H.ticketIdsIn(dashedUrl).length === 1 && H.ticketIdsIn(dashedUrl)[0] === URLID, JSON.stringify(H.ticketIdsIn(dashedUrl)));
r = scope(T.update, { page_id: dashedUrl, command: 'insert_content', new_str: 'x' }, 'workspace');
ok('A24b4 and costs exactly one round-trip', r.sc.scope === 'out' && r.netCalls === 1, JSON.stringify(r.sc) + ' calls=' + r.netCalls);
// oddly dashed ids (9 real instances) still resolve
ok('A24b5 oddly dashed id still yields the right 32-hex',
  H.ticketIdsIn('3726e495-d07c-80779bb2f2c1a7fbe964')[0] === '3726e495d07c80779bb2f2c1a7fbe964',
  JSON.stringify(H.ticketIdsIn('3726e495-d07c-80779bb2f2c1a7fbe964')));
ok('A24b2 and the extracted id is the real one',
  H.ticketIdsIn('https://www.notion.so/muuula/GEN-508-Some-Title-' + URLID).indexOf(URLID) !== -1,
  JSON.stringify(H.ticketIdsIn('https://www.notion.so/muuula/GEN-508-Some-Title-' + URLID)));
// a slug ENDING in hex merges with the id under dash-stripping; the trailing window still finds it
const hexTail = 'https://www.notion.so/muuula/GEN-508-Fix-deadbeef-' + URLID;
ok('A24c hex-tailed slug: the real id is still extracted',
  H.ticketIdsIn(hexTail).indexOf(URLID) !== -1, JSON.stringify(H.ticketIdsIn(hexTail)));
clearCache();
r = scope(T.update, { page_id: hexTail, command: 'insert_content', new_str: 'x' }, id => (id === URLID
  ? { code: 200, parent: { type: 'data_source_id', data_source_id: TT_DS } }
  : { code: 404, parent: null }));
ok('A24c2 and a ticket behind a hex-tailed slug is still gated', r.sc.scope === 'in', JSON.stringify(r.sc));
ok('A24d a bare dashed uuid still yields exactly one id',
  H.ticketIdsIn('3806e495-d07c-81b3-8e37-e21aded65abc').length === 1, JSON.stringify(H.ticketIdsIn('3806e495-d07c-81b3-8e37-e21aded65abc')));
ok('A24e a truncated uuid still yields none', H.ticketIdsIn('3806e495-d07c-81b3-8e37-e21aded65').length === 0);

// 24. an id mentioned only in PROSE must not make an unrelated page a ticket
clearCache();
r = scope(T.update, { page_id: '3806e495-d07c-81b3-8e37-e21aded65abc', command: 'insert_content', new_str: 'see page 39e6e495-d07c-819b-9d51-ff4428e65e43' }, 'workspace');
ok('A24 prose id is not resolved as a target', r.netCalls === 1, String(r.netCalls));

console.log('  ' + pass + ' passed, ' + fails.length + ' failed');

// ============================ PART B -- the real corpus ====================
console.log('');
console.log('=== PART B: real corpus payloads ===');
const haveCorpus = fs.existsSync(CORPUS);
const rows = haveCorpus ? fs.readFileSync(CORPUS, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : [];
const TOOLS = new Set(Object.values(T));
if (!haveCorpus) {
  console.log('  !! SKIPPED -- no corpus at ' + CORPUS);
  console.log('  !! This is the fail-open detector; parts A/C/D do NOT substitute for it.');
  console.log('  !! Regenerate with scratchpad/build-corpus.js (it is not committed: ticket bodies).');
}
if (haveCorpus) {
console.log('  payloads: ' + rows.length);

function sweep(mode, label) {
  const tally = {};
  const examples = {};
  resolver.calls = 0;
  clearCache();
  for (const row of rows) {
    const tool = row.tool && row.tool.indexOf(PFX) === 0 ? row.tool : PFX + String(row.short || '');
    if (!TOOLS.has(tool)) continue;
    let sc;
    try { resolver.mode = mode; sc = H.ticketScope(tool, row.input); }
    catch (e) { sc = { scope: 'THREW', reason: String(e && e.message).slice(0, 80) }; }
    const key = sc.scope + (sc.reason ? ':' + sc.reason : '') + (sc.why ? '(' + sc.why + ')' : '');
    tally[key] = (tally[key] || 0) + 1;
    if (!examples[key]) examples[key] = JSON.stringify(row.input).slice(0, 150);
  }
  console.log('  [' + label + '] resolver calls=' + resolver.calls);
  for (const k of Object.keys(tally).sort((a, b) => tally[b] - tally[a])) {
    console.log('    ' + String(tally[k]).padStart(5) + '  ' + k);
    if (/THREW|block/.test(k)) console.log('           e.g. ' + examples[k]);
  }
  return tally;
}

const A = sweep('ticket', 'resolver: EVERYTHING is a ticket -- fail-open detector');
const B = sweep('workspace', 'resolver: NOTHING is a ticket');

// Under "everything is a ticket", any payload that comes back OUT is either a genuine exemption
// (housekeeping / GEN-58 subtree / a create with no page target) or a fail-open. Count and name them.
resolver.mode = 'ticket';
clearCache();
// "noPageTarget" covers both real sub-cases: a workspace-level create with no parent at all, and a
// create whose parent is a NON-Team-Tasks container (a container id is never resolved as a page, and
// if it had been Team-Tasks the marker scan would already have fired). Both are correctly out of
// scope at zero network cost, which is design-scoping-v3 §4's "create elsewhere in Notion: 0 calls".
const outs = { housekeeping: 0, gen58: 0, noPageTarget: 0, other: 0 };
const otherEg = [];
for (const row of rows) {
  const tool = row.tool && row.tool.indexOf(PFX) === 0 ? row.tool : PFX + String(row.short || '');
  if (!TOOLS.has(tool)) continue;
  let sc; try { sc = H.ticketScope(tool, row.input); } catch (e) { continue; }
  if (sc.scope !== 'out') continue;
  const norm = H.ticketNormalise(row.input);
  if (norm.ok && H.ticketIsHousekeepingOnly(norm.root)) { outs.housekeeping++; continue; }
  const ids = H.ticketSplitIds(norm.idish || []);
  if (tool === T.update && ids.pageIds.every(i => i === GEN58)) { outs.gen58++; continue; }
  if (tool === T.create && !ids.sawCandidateKey && ids.pageIds.length === 0) {
    outs.noPageTarget++;
    if (outs.noPageTarget <= 5) console.log('    no-page-target create e.g. ' + JSON.stringify(row.input).slice(0, 200));
    continue;
  }
  outs.other++;
  if (otherEg.length < 6) otherEg.push(JSON.stringify(row.input).slice(0, 220));
}
console.log('');
console.log('  out-of-scope breakdown under "everything is a ticket":');
console.log('    housekeeping-exempt      ' + outs.housekeeping);
console.log('    GEN-58 subtree           ' + outs.gen58);
console.log('    create, no page target   ' + outs.noPageTarget);
console.log('    UNEXPLAINED (fail-open?) ' + outs.other);
for (const e of otherEg) console.log('      e.g. ' + e);
ok('B1 no unexplained out-of-scope verdict in the corpus', outs.other === 0, String(outs.other));
ok('B2 nothing throws on the corpus', !Object.keys(A).some(k => k.indexOf('THREW') === 0) && !Object.keys(B).some(k => k.indexOf('THREW') === 0));
}   // end: if (haveCorpus)

// ============================ PART C -- pass round-trip ====================
console.log('');
console.log('=== PART C: mint -> block -> approve-and-consume (enveloped payload) ===');

function runGate(tool, ti, mode) {
  resolver.mode = mode === undefined ? 'ticket' : mode;
  out.stdout = ''; out.stderr = '';
  try { H.enforceTicketVetting(tool, ti); return { exit: null, stdout: out.stdout, stderr: out.stderr }; }
  catch (e) {
    if (e instanceof ExitSignal) return { exit: e.code, stdout: out.stdout, stderr: out.stderr };
    throw e;
  }
}
function mint(entries) {
  const f = path.join(TICKET_PASSES, 'pass-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.json');
  fs.writeFileSync(f, JSON.stringify({
    kind: 'ticket', surface: 'notion', targets: entries,
    expires: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  }));
  return f;
}
function livePasses() { return fs.readdirSync(TICKET_PASSES).filter(f => f.endsWith('.json')); }

const ttPage = '3806e495-d07c-81b3-8e37-e21aded65abc';
const callPlain = { page_id: ttPage, command: 'update_content', old_str: 'a', new_str: 'b' };
const callEnv = { data: JSON.stringify(callPlain) };

clearCache();
let g = runGate(T.update, callEnv);
ok('C1 in-scope write with NO pass hard-blocks (exit 2)', g.exit === 2, 'exit=' + g.exit);
ok('C1b block message names the flow', /vet-ticket/.test(g.stderr));

// mint from the ENVELOPED payload's hash, then send the PLAIN twin
const hEnvelope = H.sha256Hex(H.stableStringify(H.ticketNormalise(callEnv).root));
const p1 = mint([{ target: 'update-page:' + ttPage.replace(/-/g, ''), contentHash: hEnvelope }]);
g = runGate(T.update, callPlain);
ok('C2 pass minted from the ENVELOPED form approves the PLAIN call', g.exit === 0 && /"allow"/.test(g.stdout), 'exit=' + g.exit + ' ' + g.stdout.slice(0, 80));
ok('C3 the pass is CONSUMED (not replayable)', livePasses().length === 0, livePasses().join(','));
g = runGate(T.update, callPlain);
ok('C4 replay of the same call blocks', g.exit === 2, 'exit=' + g.exit);

// stale-hash diagnostic
const p2 = mint([{ target: 'update-page:' + ttPage.replace(/-/g, ''), contentHash: 'deadbeef'.repeat(8) }]);
g = runGate(T.update, callPlain);
ok('C5 pass for this ticket but wrong hash -> stale-hash message', g.exit === 2 && /minted for a DIFFERENT payload/.test(g.stderr), g.stderr.slice(0, 120));
fs.rmSync(p2, { force: true });

// batch pass: partial consume leaves the sibling under the ORIGINAL filename
const callB = { page_id: ttPage, command: 'insert_content', new_str: 'second ticket edit' };
const hA = H.sha256Hex(H.stableStringify(H.ticketNormalise(callPlain).root));
const hB = H.sha256Hex(H.stableStringify(H.ticketNormalise(callB).root));
const p3 = mint([{ target: 'a', contentHash: hA }, { target: 'b', contentHash: hB }]);
g = runGate(T.update, callPlain);
ok('C6 batch pass: first entry approves', g.exit === 0, 'exit=' + g.exit);
ok('C6b batch pass file survives under its original name', fs.existsSync(p3), livePasses().join(','));
const surviving = JSON.parse(fs.readFileSync(p3, 'utf8'));
ok('C6c only the consumed entry is gone', surviving.targets.length === 1 && surviving.targets[0].contentHash === hB, JSON.stringify(surviving.targets));
g = runGate(T.update, callB);
ok('C6d second entry approves', g.exit === 0, 'exit=' + g.exit);
ok('C6e file retired once its last entry goes', !fs.existsSync(p3) && livePasses().length === 0, livePasses().join(','));

// an EXPIRED pass must not match
const pExp = path.join(TICKET_PASSES, 'expired.json');
fs.writeFileSync(pExp, JSON.stringify({ kind: 'ticket', targets: [{ target: 'x', contentHash: hA }], expires: new Date(Date.now() - 1000).toISOString() }));
g = runGate(T.update, callPlain);
ok('C7 expired pass does not match', g.exit === 2, 'exit=' + g.exit);
fs.rmSync(pExp, { force: true });
// wrong kind must not match
const pKind = path.join(TICKET_PASSES, 'wrongkind.json');
fs.writeFileSync(pKind, JSON.stringify({ kind: 'check', targets: [{ target: 'x', contentHash: hA }], expires: new Date(Date.now() + 60000).toISOString() }));
g = runGate(T.update, callPlain);
ok('C8 a check/vetting pass cannot satisfy the ticket gate', g.exit === 2, 'exit=' + g.exit);
fs.rmSync(pKind, { force: true });

// out-of-scope writes fall through untouched
g = runGate(T.update, { page_id: ttPage, command: 'update_properties', properties: { Status: 'Done' } });
ok('C9 housekeeping edit falls through (no decision, no exit)', g.exit === null && g.stdout === '', 'exit=' + g.exit);
g = runGate('Bash', { command: 'ls' });
ok('C10 a non-Notion tool is untouched', g.exit === null && g.stdout === '');

// ============================ PART D -- the shared CLI =====================
console.log('');
console.log('=== PART D: shared --ticket-hash CLI ===');
const selfPath = path.join(FAKE_HOOKS, 'auto-approve.js');
ok('D1 pinned invocation is approved', H.isSafeTicketHash('node "' + selfPath + '" --ticket-hash "C:\\tmp\\p.json"'));
ok('D1b & prefix ok', H.isSafeTicketHash('& "node" --ticket-hash'.replace('--ticket-hash', '"' + selfPath + '" --ticket-hash "C:\\tmp\\p.json"')));
ok('D2 a FOREIGN auto-approve.js is refused',
  !H.isSafeTicketHash('node "C:\\Users\\Erez\\AI Projects\\evil\\auto-approve.js" --ticket-hash "C:\\tmp\\p.json"'));
ok('D3 chaining is refused', !H.isSafeTicketHash('node "' + selfPath + '" --ticket-hash "C:\\tmp\\p.json" ; rm -rf /'));
ok('D3b piping is refused', !H.isSafeTicketHash('node "' + selfPath + '" --ticket-hash "C:\\tmp\\p.json" | cat'));
ok('D3c expansion is refused', !H.isSafeTicketHash('node "' + selfPath + '" --ticket-hash "$(evil).json"'));
ok('D4 the hook itself without the flag is refused', !H.isSafeTicketHash('node "' + selfPath + '"'));
ok('D5 a non-.json argument is refused', !H.isSafeTicketHash('node "' + selfPath + '" --ticket-hash "C:\\tmp\\p.txt"'));

// the CLI must agree with the gate, byte for byte
const payloadFile = path.join(FAKE_HOME, 'payload.json');
fs.writeFileSync(payloadFile, JSON.stringify(callEnv));
out.stdout = ''; out.stderr = '';
let cliExit = null;
fakeProcess.argv = ['node', selfPath, '--ticket-hash', payloadFile];
try { H.ticketHashCli(fakeProcess.argv); } catch (e) { cliExit = e instanceof ExitSignal ? e.code : e; }
ok('D6 CLI exits 0 on a readable payload', cliExit === 0, String(cliExit));
ok('D6b CLI hash === gate hash', out.stdout.trim() === hEnvelope, out.stdout.trim().slice(0, 16) + ' vs ' + hEnvelope.slice(0, 16));
// and it must REFUSE on an unreadable payload rather than invent a hash
fs.writeFileSync(payloadFile, JSON.stringify(trunc));
out.stdout = ''; out.stderr = ''; cliExit = null;
try { H.ticketHashCli(['node', selfPath, '--ticket-hash', payloadFile]); } catch (e) { cliExit = e instanceof ExitSignal ? e.code : e; }
ok('D7 CLI refuses (exit 3) an unreadable payload', cliExit === 3, String(cliExit));
ok('D7b and prints no hash', out.stdout === '', JSON.stringify(out.stdout));
ok('D7c and says not to mint', /do NOT mint/.test(out.stderr), out.stderr.slice(0, 100));

// ============================ summary ======================================
console.log('');
console.log('==========================================');
console.log('  ' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length) { for (const f of fails) console.log('  FAIL  ' + f); process.exitCode = 1; }
