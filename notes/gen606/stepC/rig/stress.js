// Stress: run both hooks on the same non-proposal replies under heavy parallel load; count lost outputs per hook.
// usage: node stress.js <working> <baseline> [concurrency] [rounds]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const [WSRC, BSRC, CONC, ROUNDS] = process.argv.slice(2);
const conc = parseInt(CONC || '16', 10), rounds = parseInt(ROUNDS || '6', 10);
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'gen606-stress-'));
fs.mkdirSync(path.join(FIX, 'w')); fs.mkdirSync(path.join(FIX, 'b'));
const W = path.join(FIX, 'w', 'stop-foryou-nudge.js'); fs.writeFileSync(W, fs.readFileSync(WSRC));
const B = path.join(FIX, 'b', 'stop-foryou-nudge.js'); fs.writeFileSync(B, fs.readFileSync(BSRC));
const text = 'Done. The fix is in and the tests pass.';
const tp = path.join(FIX, 'tr.jsonl');
fs.writeFileSync(tp, JSON.stringify({ type: 'user', uuid: 'h', origin: { kind: 'human' }, message: { role: 'user', content: 'x' } }) + '\n' +
  JSON.stringify({ type: 'assistant', message: { id: 'm', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }] } }) + '\n');
let n = 0;
function run(hook) {
  return new Promise((resolve) => {
    const tmp = path.join(FIX, 't' + (n++)); fs.mkdirSync(tmp);
    const env = Object.assign({}, process.env, { TEMP: tmp, TMP: tmp, TMPDIR: tmp });
    const t0 = Date.now();
    const ch = cp.spawn(process.execPath, [hook], { env });
    let out = ''; ch.stdout.on('data', (d) => { out += d; });
    ch.on('close', (code) => resolve({ code, len: out.length, ms: Date.now() - t0 }));
    ch.stdin.end(JSON.stringify({ session_id: 's' + n, prompt_id: 'p' + n, transcript_path: tp, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: text }));
  });
}
(async function () {
  const tally = { w: { runs: 0, lost: 0, maxMs: 0 }, b: { runs: 0, lost: 0, maxMs: 0 } };
  for (let r = 0; r < rounds; r++) {
    const jobs = [];
    for (let i = 0; i < conc; i++) { jobs.push(run(W).then((x) => ['w', x])); jobs.push(run(B).then((x) => ['b', x])); }
    for (const [k, x] of await Promise.all(jobs)) {
      tally[k].runs++; if (x.len === 0) tally[k].lost++; tally[k].maxMs = Math.max(tally[k].maxMs, x.ms);
    }
  }
  console.log(JSON.stringify(tally));
  fs.rmSync(FIX, { recursive: true, force: true });
})();
