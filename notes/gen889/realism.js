// /vet-code Step 4 input realism for GEN-889: replays REAL tool calls from this PC's session
// transcripts (~/.claude/projects/**/*.jsonl, main sessions only) through the NEW injectors' pure
// cores (staged copies, fixture temp dirs) and the OLD trigger functions, and reports:
//  - trigger decisions old vs new (must be identical: the trigger code is unchanged)
//  - per session with qualifying calls: which call got part 1 and part 2 (part 2 must come on a
//    later call than part 1 whenever a session made 2+ qualifying calls; never both in one call)
//  - Code.js Read/Edit calls: the new pointer fires on each, with no order to edit.
// Run: node realism.js <stage dir from test.js>
const fs = require('fs');
const os = require('os');
const path = require('path');
const STAGE = process.argv[2];
const BEFORE = path.join(__dirname, 'live-before', 'hooks');
const wNew = require(path.join(STAGE, 'inject-windows-mcp-refs.js'));
const bNew = require(path.join(STAGE, 'inject-browser-refs.js'));
const wOld = require(path.join(BEFORE, 'inject-windows-mcp-refs.js'));
const ROOT = path.join(os.homedir(), '.claude', 'projects');

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'subagents' && e.name !== 'tool-results') yield* files(p); }
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}
const isW = (n) => n.startsWith('mcp__windows-mcp__');
const isB = (n) => /^mcp__(claude-in-chrome|Claude_in_Chrome)__/.test(n);
let sessions = 0, wSess = 0, bSess = 0, decisionDiff = 0, wOrderBad = 0, bOrderBad = 0, wNoPart2 = 0, bNoPart2 = 0, calls = 0;
let codeCalls = 0;
const examples = [];
for (const f of files(ROOT)) {
  let lines;
  try { lines = fs.readFileSync(f, 'utf8').split('\n'); } catch (e) { continue; }
  sessions++;
  const uses = new Map(); const seq = [];
  for (const l of lines) {
    if (!l.includes('tool_use') && !l.includes('tool_result')) continue;
    let o; try { o = JSON.parse(l); } catch (e) { continue; }
    const content = o.message && Array.isArray(o.message.content) ? o.message.content : [];
    for (const c of content) {
      if (c.type === 'tool_use' && (c.name === 'ToolSearch' || isW(c.name) || isB(c.name) || c.name === 'Read' || c.name === 'Edit')) { uses.set(c.id, c); seq.push(c.id); }
      if (c.type === 'tool_result' && uses.has(c.tool_use_id)) uses.get(c.tool_use_id).result = c.content;
    }
  }
  if (!seq.length) continue;
  const tmpW = fs.mkdtempSync(path.join(os.tmpdir(), 'gen889-rw-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'gen889-rb-'));
  const sid = 'real' + sessions;
  let w1 = -1, w2 = -1, b1 = -1, b2 = -1, wq = 0, bq = 0;
  seq.forEach((id, i) => {
    const u = uses.get(id);
    if (u.name === 'Read' || u.name === 'Edit') {
      const fp = u.input && typeof u.input.file_path === 'string' ? u.input.file_path.replace(/\\/g, '/').toLowerCase() : '';
      if (fp.endsWith('ai projects/invoiceautomation/code.js')) codeCalls++;
      return;
    }
    calls++;
    const data = { session_id: sid, tool_name: u.name, tool_input: u.input || {}, tool_response: u.result };
    if (wOld.shouldInject(data) !== wNew.shouldInject(data)) decisionDiff++;
    if (wNew.shouldInject(data)) wq++;
    if (bNew.wantsNotes(data)) bq++;
    const wo = wNew.handle(data, { tmpDir: tmpW, hooksDir: STAGE }) || '';
    if (/Part 1 of 2/.test(wo)) w1 = i;
    if (/part 2 of 2/.test(wo)) { w2 = i; if (/Part 1 of 2/.test(wo)) wOrderBad++; }
    const bo = bNew.handle(data, { tmpDir: tmpB, hooksDir: STAGE, logDir: path.join(tmpB, 'none'), now: Date.now() }) || '';
    if (/Part 1 of 2/.test(bo)) b1 = i;
    if (/part 2 of 2/.test(bo)) { b2 = i; if (/Part 1 of 2/.test(bo)) bOrderBad++; }
  });
  if (wq) { wSess++; if (w2 >= 0 && w2 <= w1) wOrderBad++; if (wq >= 2 && w2 < 0) wNoPart2++; if (examples.length < 6) examples.push('windows: ' + wq + ' qualifying calls, part1 at #' + w1 + ', part2 at #' + w2); }
  if (bq) { bSess++; if (b2 >= 0 && b2 <= b1) bOrderBad++; if (bq >= 2 && b2 < 0) bNoPart2++; if (examples.length < 12) examples.push('browser: ' + bq + ' qualifying calls, part1 at #' + b1 + ', part2 at #' + b2); }
  fs.rmSync(tmpW, { recursive: true, force: true });
  fs.rmSync(tmpB, { recursive: true, force: true });
}
console.log(JSON.stringify({ transcripts: sessions, toolSearchOrAddonCalls: calls, windowsSessions: wSess, browserSessions: bSess, triggerDecisionDiffOldVsNew: decisionDiff, windowsOrderOrSameStringErrors: wOrderBad, browserOrderOrSameStringErrors: bOrderBad, windowsSessionsWith2PlusCallsButNoPart2: wNoPart2, browserSessionsWith2PlusCallsButNoPart2: bNoPart2, codeJsReadEditCalls: codeCalls }, null, 1));
for (const e of examples) console.log(' ', e);
