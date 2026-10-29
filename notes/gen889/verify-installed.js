// GEN-889 /vet-code Step 8: installed files byte-identical to the approved working copies (by the
// records' normalized contentHash and a raw byte compare), no live vetting pass left for any
// target, and the four notes files equal to wc/refs. Then a live-fire of each installed injector
// with a throwaway session id (real stdin/stdout), and the installed approval-hook test suite.
// Run: node verify-installed.js
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const LIVE = 'C:/Users/Erez/.claude/hooks';
const WC = path.join(__dirname, 'wc');
const PASSES = 'C:/Users/Erez/.claude-staging/vetting-passes';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let bad = 0;
const check = (name, ok, d) => { if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (d ? ' | ' + d : '')); };
for (const t of ['inject-browser-refs.js', 'inject-edit-refs.js', 'inject-windows-mcp-refs.js', 'windows-mcp-approval.js', 'windows-mcp-approval.test.js']) {
  const live = fs.readFileSync(path.join(LIVE, t));
  const wc = fs.readFileSync(path.join(WC, 'hooks', t));
  const rec = JSON.parse(fs.readFileSync(path.join(PASSES, 'vetting-record-gen889-' + t.replace(/\.js$/, '') + '.json'), 'utf8'));
  check('byte-identical ' + t, Buffer.compare(live, wc) === 0);
  check('record hash ' + t, sha(live.toString('utf8').replace(/\r\n/g, '\n')) === rec.contentHash);
  const lc = rec.target;
  const livePasses = fs.readdirSync(PASSES).filter((f) => f.endsWith('.json') && !f.startsWith('vetting-record')).filter((f) => {
    try { const p = JSON.parse(fs.readFileSync(path.join(PASSES, f), 'utf8')); return p.kind === 'vetting' && p.target === lc; } catch (e) { return false; }
  });
  check('no live pass left for ' + t, livePasses.length === 0, livePasses.join(','));
}
for (const f of fs.readdirSync(path.join(WC, 'refs'))) {
  check('notes identical ' + f, Buffer.compare(fs.readFileSync(path.join(LIVE, 'refs', f)), fs.readFileSync(path.join(WC, 'refs', f))) === 0);
}
const sid = 'gen889-live-' + Date.now();
const fire = (hook, data) => {
  const r = spawnSync(process.execPath, [path.join(LIVE, hook)], { input: JSON.stringify(data), encoding: 'utf8' });
  try { return { code: r.status, ctx: JSON.parse(r.stdout).hookSpecificOutput.additionalContext }; } catch (e) { return { code: r.status, ctx: r.stdout }; }
};
const w1 = fire('inject-windows-mcp-refs.js', { session_id: sid, tool_name: 'ToolSearch', tool_input: { query: 'select:mcp__windows-mcp__Snapshot' } });
const w2 = fire('inject-windows-mcp-refs.js', { session_id: sid, tool_name: 'mcp__windows-mcp__Snapshot', tool_response: 'ok' });
check('live windows: part 1 then part 2', w1.code === 0 && /Part 1 of 2/.test(w1.ctx) && w2.code === 0 && /part 2 of 2/.test(w2.ctx));
const b1 = fire('inject-browser-refs.js', { session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'ToolSearch', tool_input: { query: 'select:mcp__claude-in-chrome__tabs_context_mcp' } });
const b2 = fire('inject-browser-refs.js', { session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'mcp__claude-in-chrome__tabs_context_mcp', tool_response: 'Tab Context: ok' });
check('live browser: part 1 then part 2', b1.code === 0 && /Part 1 of 2/.test(b1.ctx) && b2.code === 0 && /part 2 of 2/.test(b2.ctx));
const e1 = fire('inject-edit-refs.js', { session_id: sid, tool_name: 'Read', tool_input: { file_path: 'C:\\Users\\Erez\\AI Projects\\InvoiceAutomation\\Code.js' } });
check('live edit: Code.js pointer as facts', e1.code === 0 && /asks nothing of a read/.test(e1.ctx) && !/Before finishing this edit/.test(e1.ctx));
for (const n of ['claude-refs-windows-mcp-part1-', 'claude-refs-windows-mcp-part2-', 'claude-refs-browser-', 'claude-refs-browser-part2-', 'claude-edit-refs-']) {
  try { fs.unlinkSync(path.join(os.tmpdir(), n + sid)); } catch (e) { /* none */ }
}
const t = spawnSync(process.execPath, [path.join(LIVE, 'windows-mcp-approval.test.js')], { encoding: 'utf8', cwd: LIVE, timeout: 300000 });
check('installed windows-mcp-approval.test.js', t.status === 0, (t.stdout + t.stderr).trim().split('\n').slice(-1)[0]);
console.log(bad ? 'FAIL: ' + bad : 'ALL PASS');
process.exit(bad ? 1 : 0);
