// GEN-679 Step-4 pass-CONSUMPTION assertion (GEN-506/GEN-562 bar), fixture-tree form.
// Feeds the FIXTURE copy of auto-approve.js (in rig/consume/home/.claude/hooks/) real
// PreToolUse payloads for the sanctioned apply command and asserts, in one observation:
//   (1) valid fixture pass + SINGLE-LINE apply  -> APPROVED (exit 0, approve stdout)
//       AND the pass file is CONSUMED (renamed *.consumed.<ts>);
//   (2) NO pass + same single-line apply        -> BLOCKED (exit 2), nothing approved;
//   (3) valid fixture pass + MULTI-LINE apply   -> hard-BLOCKED (exit 2; the live gate's
//       GEN-641 behavior for MULTILINE on a resolved protected target) AND the pass file
//       is NOT consumed (still a live *.json) -- proving the multi-line shape can never
//       silently write, and never burns the pass either.
// Everything runs against the fixture home tree; the real gate, real passes dir, and
// real hooks are never touched.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RIG = __dirname;
const HOME = path.join(RIG, 'consume', 'home');
const GATE = path.join(HOME, '.claude', 'hooks', 'auto-approve.js');
const TARGET = path.join(HOME, '.claude', 'hooks', 'stop-signal-surface.js');
const PASS_DIR = path.join(HOME, '.claude-staging', 'vetting-passes');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) { if (cond) pass++; else { fail++; failures.push(name + (detail ? ' :: ' + detail : '')); } }

function listPasses() { try { return fs.readdirSync(PASS_DIR); } catch (e) { return []; } }
function clearPasses() { for (const f of listPasses()) fs.unlinkSync(path.join(PASS_DIR, f)); }
function mintFixturePass() {
  const p = path.join(PASS_DIR, 'pass-gen679-fixture.json');
  fs.writeFileSync(p, JSON.stringify({
    kind: 'vetting',
    target: TARGET.replace(/\//g, '\\').toLowerCase(),
    expires: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  }));
  return p;
}
function runGate(command) {
  const payload = JSON.stringify({
    session_id: 'gen679-consume-fixture',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    cwd: RIG
  });
  const r = spawnSync(process.execPath, [GATE], { input: payload, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const contentFile = path.join(RIG, 'consume', 'content.js');
fs.writeFileSync(contentFile, '// replacement bytes for the fixture apply\n');
const single = "& 'G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1' -File \"" + TARGET + "\" -Op write-file -ContentFile \"" + contentFile + "\"";
const multi = "$cf = \"" + contentFile + "\"\n& 'G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1' -File \"" + TARGET + "\" -Op write-file -ContentFile $cf";

// (1) valid pass + single line -> approve + consume
clearPasses();
mintFixturePass();
let before = listPasses();
let r = runGate(single);
let after = listPasses();
ok('C1 approved', r.code === 0 && /vetting pass consumed/i.test(r.out), 'code=' + r.code + ' out=' + r.out.slice(0, 160) + ' err=' + r.err.slice(0, 160));
ok('C1 pass consumed (renamed)', before.some(f => f.endsWith('.json')) &&
  after.some(f => /\.consumed\.\d+/.test(f)) && !after.some(f => f === 'pass-gen679-fixture.json'),
  'before=' + before.join('|') + ' after=' + after.join('|'));

// (2) no pass -> hard block
clearPasses();
r = runGate(single);
ok('C2 blocked without pass', r.code === 2 && /No vetting pass/i.test(r.err), 'code=' + r.code + ' err=' + r.err.slice(0, 160));

// (3) valid pass + MULTI-LINE -> hard block, pass NOT consumed
clearPasses();
mintFixturePass();
r = runGate(multi);
after = listPasses();
ok('C3 multiline blocked', r.code === 2, 'code=' + r.code + ' out=' + r.out.slice(0, 120) + ' err=' + r.err.slice(0, 200));
ok('C3 pass NOT consumed (still live)', after.includes('pass-gen679-fixture.json') && !after.some(f => /\.consumed\./.test(f)),
  'after=' + after.join('|'));

clearPasses();
console.log('PASS ' + pass + ' / FAIL ' + fail);
for (const f of failures) console.log('FAIL: ' + f);
process.exit(fail === 0 ? 0 : 1);
