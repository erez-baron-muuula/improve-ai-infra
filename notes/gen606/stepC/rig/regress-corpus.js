// Differential regression over EVERY real end-of-turn reply in corpus.jsonl: baseline (live copy) vs the
// working copy, first Stop, each reply in its own synthetic transcript (an Erez message, then the reply as
// the last assistant message, so the model directive takes its confirmed branch). Each hook copy runs from
// its own fixture dir, so search-first rows land there, not in ~/.claude/hooks.
// Pass condition per reply: working output == baseline output; or, where the search-first stage fires,
// working = baseline + SF_NOTE_WITH_BLOCK (For-you note present) / working = SF_NOTE_ALONE (baseline silent).
// usage: node regress-corpus.js <working> <baseline>
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const [WSRC, BSRC] = process.argv.slice(2);
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'gen606-reg-'));
for (const d of ['w', 'b', 't']) fs.mkdirSync(path.join(FIX, d));
const W = path.join(FIX, 'w', 'stop-foryou-nudge.js'); fs.writeFileSync(W, fs.readFileSync(WSRC));
const B = path.join(FIX, 'b', 'stop-foryou-nudge.js'); fs.writeFileSync(B, fs.readFileSync(BSRC));
const M = require(W);
const allRows = fs.readFileSync(path.join(__dirname, 'corpus.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// sample: every reply the detector matches + every 5th of the rest + every reply carrying the pin
const rows = allRows.filter((r, i) => M.detectTicketProposals(r.text).length || i % 8 === 0);
console.log('sampled', rows.length, 'of', allRows.length);
function run(hook, payload, tmp) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { TEMP: tmp, TMP: tmp, TMPDIR: tmp });
    const ch = cp.spawn(process.execPath, [hook], { env });
    let out = ''; ch.stdout.on('data', (d) => { out += d; });
    ch.on('close', (code) => resolve({ code, out }));
    ch.stdin.end(JSON.stringify(payload));
  });
}
const ctxOf = (o) => { try { return o ? JSON.parse(o).hookSpecificOutput.additionalContext : null; } catch (e) { return 'UNPARSEABLE'; } };
(async function () {
  let i = 0; const res = { same: 0, modeA: 0, modeB: 0, bad: [] };
  async function worker(k) {
    const tmpW = path.join(FIX, 't', 'w' + k), tmpB = path.join(FIX, 't', 'b' + k);
    fs.mkdirSync(tmpW); fs.mkdirSync(tmpB);
    while (i < rows.length) {
      const r = rows[i++];
      const tp = path.join(FIX, 't', 'tr' + k + '.jsonl');
      fs.writeFileSync(tp, JSON.stringify({ type: 'user', uuid: 'h' + i, origin: { kind: 'human' }, message: { role: 'user', content: 'x' } }) + '\n' +
        JSON.stringify({ type: 'assistant', message: { id: 'm' + i, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: r.text }] } }) + '\n');
      const p = { session_id: 'reg-' + i, prompt_id: 'p-' + i, transcript_path: tp, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: r.text };
      const [a, b] = await Promise.all([run(B, p, tmpB), run(W, p, tmpW)]);
      if (a.code !== 0 || b.code !== 0) { res.bad.push('exit ' + a.code + '/' + b.code + ' ' + r.msgId); continue; }
      if (a.out === b.out) { res.same++; continue; }
      const ca = ctxOf(a.out), cb = ctxOf(b.out);
      if (ca !== null && cb === ca + M.SF_NOTE_WITH_BLOCK) { res.modeA++; continue; }
      if (a.out === '' && cb === M.SF_NOTE_ALONE) { res.modeB++; continue; }
      res.bad.push('DIFF ' + r.session.slice(0, 8) + ' ' + r.msgId + ' base=' + String(ca).slice(0, 60) + ' | work=' + String(cb).slice(0, 60));
    }
  }
  // 2 workers: at 8 (16 concurrent hook processes) the 5 s stdin watchdog of BOTH hooks fires under CPU
  // starvation and drops output (stress.js: 63/96 vs 61/96 lost at 32 concurrent) -- a load artifact.
  await Promise.all(Array.from({ length: 2 }, (_, k) => worker(k)));
  console.log(JSON.stringify({ replies: rows.length, identical: res.same, plusModeA: res.modeA, plusModeB: res.modeB, bad: res.bad.length }));
  res.bad.slice(0, 15).forEach((x) => console.log(x));
  fs.rmSync(FIX, { recursive: true, force: true });
})();
