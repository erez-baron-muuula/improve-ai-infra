// GEN-889 / GEN-710 / GEN-958 / GEN-990 tests for the working copies in wc/.
// Builds a stage folder = the live hooks folder (.js/.ps1/.json + refs/) overlaid with wc/hooks/*
// and wc/refs/*, then drives the changed hooks through their real stdin/stdout (spawnSync) or
// their exported pure core. Live hooks are never touched.
// Run: node test.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LIVE = 'C:/Users/Erez/.claude/hooks';
const WC = path.join(__dirname, 'wc');
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'gen889-stage-'));
fs.mkdirSync(path.join(STAGE, 'refs'));
for (const f of fs.readdirSync(LIVE)) if (/\.(js|ps1|json)$/.test(f)) fs.writeFileSync(path.join(STAGE, f), fs.readFileSync(path.join(LIVE, f)));
for (const f of fs.readdirSync(path.join(LIVE, 'refs'))) fs.writeFileSync(path.join(STAGE, 'refs', f), fs.readFileSync(path.join(LIVE, 'refs', f)));
for (const f of fs.readdirSync(path.join(WC, 'hooks'))) fs.writeFileSync(path.join(STAGE, f), fs.readFileSync(path.join(WC, 'hooks', f)));
for (const f of fs.readdirSync(path.join(WC, 'refs'))) fs.writeFileSync(path.join(STAGE, 'refs', f), fs.readFileSync(path.join(WC, 'refs', f)));

let n = 0, fail = 0;
function check(name, ok, detail) {
  n++; if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + String(detail).slice(0, 160).replace(/\n/g, ' ') : ''));
}
function run(hookFile, data, args) {
  const r = spawnSync(process.execPath, [hookFile].concat(args || []), { input: JSON.stringify(data), encoding: 'utf8' });
  let ctx = '';
  try { ctx = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : ''; } catch (e) { ctx = 'BAD JSON: ' + r.stdout; }
  return { status: r.status, ctx, stdout: r.stdout, stderr: r.stderr };
}
const sid = (tag) => 'gen889-' + tag + '-' + process.pid + '-' + Date.now();
const cp = (s) => [...s].length;
// Orders that misfire on a read (the GEN-710 pointer). Relay notices ("flag this to Erez") are
// deliberately kept as orders: surfacing them to Erez is their purpose.
const ORDER_RE = /Before finishing this edit|make sure your change|\bfind `function/i;
const MISSING_RE = /missing or empty -- .* were NOT loaded; flag this to Erez\./;
const OVERCAP_RE = /that fit in one injection -- read it with the Read tool \(.*\) and tell Erez it needs splitting\./;

// ---------- 0. syntax ----------
for (const f of fs.readdirSync(path.join(WC, 'hooks'))) {
  if (!f.endsWith('.js')) continue;
  const r = spawnSync(process.execPath, ['--check', path.join(WC, 'hooks', f)], { encoding: 'utf8' });
  check('syntax ' + f, r.status === 0, r.stderr);
}

// ---------- 1. notes sizes and cross-references ----------
for (const f of fs.readdirSync(path.join(WC, 'refs'))) {
  const c = cp(fs.readFileSync(path.join(WC, 'refs', f), 'utf8'));
  check('size under 9,000: refs/' + f, c < 9000, c + ' characters');
}
{
  const w1 = fs.readFileSync(path.join(WC, 'refs', 'windows-mcp.md'), 'utf8');
  const b1 = fs.readFileSync(path.join(WC, 'refs', 'browser.md'), 'utf8');
  check('notes: no dangling "(next item)" / "(below)" pointers', !/stuck add-on \(next item\)/.test(w1) && !/own view instead \(below\)/.test(b1));
}

// ---------- 2. windows-mcp injector: two parts in sequence ----------
{
  const H = path.join(STAGE, 'inject-windows-mcp-refs.js');
  const s = sid('w');
  const ts = { session_id: s, tool_name: 'ToolSearch', tool_input: { query: 'select:mcp__windows-mcp__Snapshot' } };
  const call = { session_id: s, tool_name: 'mcp__windows-mcp__Snapshot', tool_response: 'ok' };
  const r1 = run(H, ts);
  check('wmcp: first trigger -> part 1', r1.status === 0 && /Last resort/.test(r1.ctx) && /Part 1 of 2/.test(r1.ctx) && !/Stuck add-on \(GEN/.test(r1.ctx), r1.ctx);
  check('wmcp: part 1 under cap', cp(r1.ctx) <= 9500, cp(r1.ctx));
  const r2 = run(H, call);
  check('wmcp: next call -> part 2 only', /Stuck add-on \(GEN/.test(r2.ctx) && /part 2 of 2/.test(r2.ctx) && !/Last resort/.test(r2.ctx), r2.ctx);
  const r3 = run(H, call);
  check('wmcp: third call -> nothing', r3.stdout === '', r3.stdout);
  const rr = run(path.join(STAGE, 'inject-topic-refs.js'), { session_id: s, source: 'compact', hook_event_name: 'SessionStart' }, ['--reset-after-compact']);
  check('wmcp: compaction reset exits 0', rr.status === 0, rr.stderr);
  const r4 = run(H, call);
  check('wmcp: after compaction -> part 1 again', /Part 1 of 2/.test(r4.ctx), r4.ctx);
  const r5 = run(H, call);
  check('wmcp: after compaction, next -> part 2 again', /part 2 of 2/.test(r5.ctx), r5.ctx);
  for (const k of [1, 2]) { try { fs.unlinkSync(path.join(os.tmpdir(), 'claude-refs-windows-mcp-part' + k + '-' + s)); } catch (e) { /* none */ } }
  const s2 = sid('w2');
  const ra = run(H, { session_id: s2, agent_id: 'a1', tool_name: 'mcp__windows-mcp__Snapshot' });
  check('wmcp: sub-agent -> nothing, no marker', ra.stdout === '' && !fs.existsSync(path.join(os.tmpdir(), 'claude-refs-windows-mcp-part1-' + s2)));
  const ro = run(H, { session_id: s2, tool_name: 'ToolSearch', tool_input: { query: 'select:Read' }, tool_response: 'Read' });
  check('wmcp: unrelated ToolSearch -> nothing', ro.stdout === '');
  const rn = run(H, { tool_name: 'mcp__windows-mcp__Snapshot' });
  check('wmcp: no session id -> nothing', rn.stdout === '');
}
{
  const mod = require(path.join(STAGE, 'inject-windows-mcp-refs.js'));
  const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'gen889-wfx-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen889-wtmp-'));
  fs.mkdirSync(path.join(fx, 'refs'));
  fs.writeFileSync(path.join(fx, 'refs', 'windows-mcp.md'), 'PART ONE text');
  const d = { session_id: 'm1', tool_name: 'mcp__windows-mcp__Snapshot' };
  check('wmcp core: part 1 from fixture', mod.handle(d, { tmpDir: tmp, hooksDir: fx }) === 'PART ONE text');
  const m2 = mod.handle(d, { tmpDir: tmp, hooksDir: fx }) || '';
  check('wmcp core: missing part 2 -> relay notice', /windows-mcp-troubleshooting\.md/.test(m2) && MISSING_RE.test(m2), m2);
  fs.writeFileSync(path.join(fx, 'refs', 'windows-mcp.md'), 'x'.repeat(9600));
  const big = mod.handle({ session_id: 'm2', tool_name: 'mcp__windows-mcp__Snapshot' }, { tmpDir: tmp, hooksDir: fx }) || '';
  check('wmcp core: over-cap part -> size notice, not the text', /is 9600 characters, over the 9500/.test(big) && OVERCAP_RE.test(big) && big.length < 500, big);
  // race: another call already claimed part 1 -> this call moves on to part 2 (not nothing)
  fs.writeFileSync(path.join(fx, 'refs', 'windows-mcp-troubleshooting.md'), 'PART TWO text');
  fs.writeFileSync(path.join(tmp, 'claude-refs-windows-mcp-part1-m4'), 'x');
  check('wmcp core: part 1 claimed by a parallel call -> part 2', mod.handle({ session_id: 'm4', tool_name: 'mcp__windows-mcp__Snapshot' }, { tmpDir: tmp, hooksDir: fx }) === 'PART TWO text');
  // a temp folder that does not exist yet is created
  const tmpNew = path.join(tmp, 'not-yet', 'there');
  fs.writeFileSync(path.join(fx, 'refs', 'windows-mcp.md'), 'PART ONE text');
  check('wmcp core: missing temp folder is created', mod.handle({ session_id: 'm5', tool_name: 'mcp__windows-mcp__Snapshot' }, { tmpDir: tmpNew, hooksDir: fx }) === 'PART ONE text');
  fs.writeFileSync(path.join(fx, 'refs', 'windows-mcp.md'), 'x'.repeat(9600));
  fs.unlinkSync(path.join(fx, 'refs', 'windows-mcp.md'));
  const miss1 =mod.handle({ session_id: 'm3', tool_name: 'mcp__windows-mcp__Snapshot' }, { tmpDir: tmp, hooksDir: fx }) || '';
  check('wmcp core: missing part 1 -> relay notice', /refs\/windows-mcp\.md missing or empty/.test(miss1) && MISSING_RE.test(miss1), miss1);
}

// ---------- 3. browser injector: two parts in sequence ----------
{
  const mod = require(path.join(STAGE, 'inject-browser-refs.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen889-btmp-'));
  const opts = { tmpDir: tmp, hooksDir: STAGE, logDir: path.join(tmp, 'no-logs'), now: Date.now() };
  const ts = { session_id: 'b1', tool_name: 'ToolSearch', tool_input: { query: 'select:mcp__claude-in-chrome__tabs_context_mcp' } };
  const nav = { session_id: 'b1', tool_name: 'mcp__claude-in-chrome__navigate', tool_response: 'ok' };
  const o1 = mod.handle(ts, opts) || '';
  check('browser: first trigger -> part 1 only', /^Browser work/.test(o1) && /Part 1 of 2/.test(o1) && !/\*\*Snowsight:\*\*/.test(o1), o1);
  const o2 = mod.handle(nav, opts) || '';
  check('browser: next call -> part 2 (site notes)', /part 2 of 2: site notes/.test(o2) && /\*\*Snowsight:\*\*/.test(o2) && !/^Browser work \(Claude/.test(o2), o2);
  const o3 = mod.handle(nav, opts) || '';
  check('browser: third call -> nothing', o3 === '', o3);
  const NC = { session_id: 'b2', tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_response: [{ type: 'text', text: '⚠️ **Claude in Chrome is not connected**\n\nretry' }] };
  const d1 = mod.handle(NC, opts) || '';
  check('browser: diagnosis + part 1 fit one call', /^browser-diagnose/.test(d1) && /Part 1 of 2/.test(d1) && cp(d1) <= 9500, cp(d1));
  check('browser: diagnosis wording unchanged', /Tell Erez this in one line instead of the tool's generic install\/sign-in list/.test(d1));
  const d2 = mod.handle({ session_id: 'b2', tool_name: 'mcp__claude-in-chrome__navigate', tool_response: 'ok' }, opts) || '';
  check('browser: then part 2', /part 2 of 2/.test(d2), d2);
  check('browser: sub-agent -> nothing', (mod.handle({ session_id: 'b3', agent_id: 'x', tool_name: 'mcp__claude-in-chrome__navigate' }, opts) || '') === '');
  const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'gen889-bfx-'));
  fs.mkdirSync(path.join(fx, 'refs'));
  fs.writeFileSync(path.join(fx, 'refs', 'browser.md'), 'Browser work PART ONE');
  const o4 = mod.handle({ session_id: 'b4', tool_name: 'mcp__claude-in-chrome__navigate' }, { ...opts, hooksDir: fx }) || '';
  const o5 = mod.handle({ session_id: 'b4', tool_name: 'mcp__claude-in-chrome__navigate' }, { ...opts, hooksDir: fx }) || '';
  check('browser: missing part 2 -> relay notice', o4 === 'Browser work PART ONE' && /browser-sites\.md/.test(o5) && MISSING_RE.test(o5), o5);
  fs.writeFileSync(path.join(fx, 'refs', 'browser-sites.md'), 'y'.repeat(9700));
  mod.handle({ session_id: 'b5', tool_name: 'mcp__claude-in-chrome__navigate' }, { ...opts, hooksDir: fx });
  const o6 = mod.handle({ session_id: 'b5', tool_name: 'mcp__claude-in-chrome__navigate' }, { ...opts, hooksDir: fx }) || '';
  check('browser: over-cap part 2 -> size notice', /browser-sites\.md is 9700 characters, over the 9500/.test(o6) && OVERCAP_RE.test(o6) && o6.length < 600, o6);
  const opts2 = { ...opts, tmpDir: os.tmpdir() };
  const s = sid('b');
  mod.handle({ session_id: s, tool_name: 'mcp__claude-in-chrome__navigate' }, opts2);
  mod.handle({ session_id: s, tool_name: 'mcp__claude-in-chrome__navigate' }, opts2);
  run(path.join(STAGE, 'inject-topic-refs.js'), { session_id: s, source: 'compact' }, ['--reset-after-compact']);
  const gone = !fs.existsSync(path.join(os.tmpdir(), 'claude-refs-browser-' + s)) && !fs.existsSync(path.join(os.tmpdir(), 'claude-refs-browser-part2-' + s));
  check('browser: compaction reset clears both markers', gone);
  const o7 = mod.handle({ session_id: s, tool_name: 'mcp__claude-in-chrome__navigate' }, opts2) || '';
  check('browser: after compaction -> part 1 again', /Part 1 of 2/.test(o7));
  for (const p of ['claude-refs-browser-', 'claude-refs-browser-part2-']) { try { fs.unlinkSync(path.join(os.tmpdir(), p + s)); } catch (e) { /* none */ } }
  const r = run(path.join(STAGE, 'inject-browser-refs.js'), { session_id: sid('bs'), hook_event_name: 'PostToolUse', tool_name: 'ToolSearch', tool_input: { query: 'claude-in-chrome' } });
  check('browser: stdin run emits part 1 JSON', r.status === 0 && /Part 1 of 2/.test(r.ctx), r.stdout.slice(0, 80));
}

// ---------- 4. edit injector: Code.js pointer as facts, on Read and Edit ----------
{
  const H = path.join(STAGE, 'inject-edit-refs.js');
  const s = sid('e');
  const code = 'C:\\Users\\Erez\\AI Projects\\InvoiceAutomation\\Code.js';
  const first = run(H, { session_id: s, tool_name: 'Read', tool_input: { file_path: 'C:\\x\\other.txt' } });
  check('edit: first file call -> editing notes, no pointer', first.ctx.length > 100 && !/fileHeldInvoiceManually_/.test(first.ctx));
  const rd = run(H, { session_id: s, tool_name: 'Read', tool_input: { file_path: code } });
  check('edit: Read of Code.js -> pointer', /fileHeldInvoiceManually_/.test(rd.ctx) && /header comment/.test(rd.ctx) && /argument ORDER/.test(rd.ctx) && /reading that comment first/.test(rd.ctx), rd.ctx);
  check('edit: pointer has no order to edit', !ORDER_RE.test(rd.ctx), rd.ctx);
  const ed = run(H, { session_id: s, tool_name: 'Edit', tool_input: { file_path: code } });
  check('edit: Edit of Code.js -> pointer', /fileHeldInvoiceManually_/.test(ed.ctx));
  const sub = run(H, { session_id: s, agent_id: 'r1', tool_name: 'Read', tool_input: { file_path: code.replace(/\\/g, '/') } });
  check('edit: forward-slash path (sub-agent read) -> same fact pointer', /asks nothing of a read/.test(sub.ctx));
  try { fs.unlinkSync(path.join(os.tmpdir(), 'claude-edit-refs-' + s)); } catch (e) { /* none */ }
  const st2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gen889-noedit-'));
  fs.mkdirSync(path.join(st2, 'refs'));
  fs.writeFileSync(path.join(st2, 'inject-edit-refs.js'), fs.readFileSync(path.join(STAGE, 'inject-edit-refs.js')));
  const me = run(path.join(st2, 'inject-edit-refs.js'), { session_id: sid('em'), tool_name: 'Read', tool_input: { file_path: 'C:\\x\\y.txt' } });
  check('edit: missing editing.md -> original relay notice', /refs\/editing\.md missing or empty — file-editing reference notes were NOT loaded; flag this to Erez\./.test(me.ctx), me.ctx);
}

// ---------- 5. windows-mcp-approval suite in the stage ----------
{
  const r = spawnSync(process.execPath, [path.join(STAGE, 'windows-mcp-approval.test.js')], { encoding: 'utf8', cwd: STAGE, timeout: 300000 });
  const tail = (r.stdout + r.stderr).trim().split('\n').slice(-3).join(' / ');
  check('windows-mcp-approval.test.js in stage', r.status === 0, tail);
  const t = fs.readFileSync(path.join(WC, 'hooks', 'windows-mcp-approval.js'), 'utf8');
  check('approval hook points "Stuck add-on" at the troubleshooting file', /Stuck add-on" in C:\/Users\/Erez\/\.claude\/hooks\/refs\/windows-mcp-troubleshooting\.md/.test(t));
  const p2 = fs.readFileSync(path.join(WC, 'refs', 'windows-mcp-troubleshooting.md'), 'utf8');
  check('troubleshooting file holds the "Stuck add-on" section', /\*\*Stuck add-on \(GEN-920\/933\)\.\*\*/.test(p2));
}

console.log('\nstage: ' + STAGE);
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
