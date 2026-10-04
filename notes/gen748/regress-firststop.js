// First-Stop regression: BASELINE_HOOK vs HOOK_UNDER_TEST (default: installed hook) must give byte-identical
// output on real replies. Needs build-reply-corpus.js run first, and run-fixtures.js (it writes f1-real-failure.jsonl).
// 2026-09-29 result (pre-install working copy vs the pre-GEN-748 hook): 200 mode-A + 61 mode-B (--modeB-only) = 261 identical, 0 differ.
// Regression: on first-Stop payloads (stop_hook_active false) the working copy's
// output must be BYTE-IDENTICAL to the live hook's, over every unique real reply
// in reply-corpus.jsonl. Two transcript modes:
//   A) shared fixture transcript (model read -> unconfirmed branch)  -- all rows
//   B) the row's own real transcript cut at the row's line (model read ->
//      confirmed branch)                                              -- sample
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const SP = __dirname;
const LIVE = process.env.BASELINE_HOOK; if (!LIVE) { console.error('set BASELINE_HOOK to the hook version to compare against'); process.exit(1); }
const WORK = process.env.HOOK_UNDER_TEST || path.join(require('os').homedir(), '.claude', 'hooks', 'stop-foryou-nudge.js');
const TMPD = path.join(path.join(require('os').tmpdir(), 'gen748-fixtures'), 'tmp-regress'); fs.mkdirSync(TMPD, { recursive: true });
const SHARED = path.join(path.join(require('os').tmpdir(), 'gen748-fixtures'), 'f1-real-failure.jsonl');
const PROJ = 'C:\\Users\\Erez\\.claude\\projects';
const rows = fs.readFileSync(path.join(path.join(require('os').tmpdir(), 'gen748-fixtures'), 'reply-corpus.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const seen = new Set(); const uniq = rows.filter((r) => (seen.has(r.text) ? false : (seen.add(r.text), true)));
const env = Object.assign({}, process.env, { TEMP: TMPD, TMP: TMPD });
function run(hook, payload) {
  return new Promise((resolve) => {
    const ch = cp.spawn(process.execPath, [hook], { env: env });
    let out = ''; ch.stdout.on('data', (d) => { out += d; });
    ch.on('close', (code) => resolve({ code: code, out: out }));
    ch.stdin.end(JSON.stringify(payload));
  });
}
function resolveTranscript(f) {
  const [slugSuf, pre] = f.split('/');
  for (const slug of fs.readdirSync(PROJ)) {
    if (!slug.endsWith(slugSuf)) continue;
    const hit = fs.readdirSync(path.join(PROJ, slug)).find((x) => x.startsWith(pre) && x.endsWith('.jsonl'));
    if (hit) return path.join(PROJ, slug, hit);
  }
  return null;
}
const ONLY_B = process.argv.includes('--modeB-only');
const jobs = [];
if (!ONLY_B)
// mode A sample: every 6th unique row, plus EVERY row whose text has a pin (the
// MARKER_RE change's only behavioural surface) or a long whitespace run (the trimEnd change's)
for (let i = 0; i < uniq.length; i++) {
  const t = uniq[i].text;
  if (i % 6 === 0 || /\u{1F4CC}/u.test(t) || /\s{200,}/.test(t)) jobs.push({ mode: 'A', row: uniq[i], tp: SHARED });
}
// mode B sample: every 20th row (every 37th with --modeB-only, ~60 rows), cut its own transcript through the row's line
let bi = 0;
for (let i = 0; i < uniq.length; i += (ONLY_B ? 37 : 20)) {
  const r = uniq[i]; const src = resolveTranscript(r.f); if (!src) continue;
  const lines = fs.readFileSync(src, 'utf8').split('\n').slice(0, r.line);
  const out = path.join(path.join(require('os').tmpdir(), 'gen748-fixtures'), 'regB-' + (bi++) + '.jsonl'); fs.writeFileSync(out, lines.join('\n') + '\n');
  jobs.push({ mode: 'B', row: r, tp: out });
}
(async function () {
  let idx = 0, same = 0, diff = [], nudges = 0, confirmed = 0;
  async function worker() {
    while (idx < jobs.length) {
      const j = jobs[idx++];
      const payload = { session_id: 'regress', prompt_id: 'rp' + idx, transcript_path: j.tp, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: j.row.text };
      const [a, b] = await Promise.all([run(LIVE, payload), run(WORK, payload)]);
      if (a.code === b.code && a.out === b.out) same++; else diff.push(j.mode + ' ' + j.row.f + ':' + j.row.line + ' live=' + a.out.slice(0, 80) + ' | work=' + b.out.slice(0, 80));
      if (b.out) nudges++;
      if ((same + diff.length) % 50 === 0) console.log('progress', same + diff.length, '/', jobs.length, 'differ so far', diff.length);
      if (b.out.indexOf('at or above the floor') !== -1 || b.out.indexOf('below the floor') !== -1 || b.out.indexOf('meets the STANDARD floor') !== -1) confirmed++;
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const nA = jobs.filter((j) => j.mode === 'A').length;
  console.log(JSON.stringify({ uniqueReplies: uniq.length, jobs: jobs.length, modeA: nA, modeB: jobs.length - nA, identical: same, differ: diff.length, nudgesInWorkingCopy: nudges, confirmedModelBranch: confirmed }));
  diff.slice(0, 20).forEach((d) => console.log('DIFF', d));
})();
