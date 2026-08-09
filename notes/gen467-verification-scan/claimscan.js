// Feed recent For-you blocks to the live claim-linter with session_id/prompt_id
// OMITTED (the guard is documented to skip in that case), so Phase 1's
// findNakedClaims/findSelfAudit run on the block text -- i.e. the verdict the
// removed Arm-2 content-gate would have reached. Read-only; spawns the hook.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const openers = require('./openers.json');
const HOOK = 'C:/Users/Erez/.claude/hooks/stop-claim-linter.js';
const LOOSE = /\u{1F4CC}\s*\*{0,2}\s*For you/u;
const recent = openers.filter(m => (m.turnTs || '') >= '2026-08-02');
// sample evenly
const N = parseInt(process.argv[2] || '20', 10);
const step = Math.max(1, Math.floor(recent.length / N));
const sample = recent.filter((_, i) => i % step === 0).slice(0, N);
console.log('recent block-carrying messages since 2026-08-02:', recent.length, '| sampling', sample.length);
let flagged = 0;
const rows = [];
for (const m of sample) {
  const entries = fs.readFileSync(m.file, 'utf8').split('\n').filter(Boolean);
  let text = null;
  for (const l of entries) { let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.uuid === m.uuid) { const c = o.message.content; text = Array.isArray(c) ? c.map(x => x.type === 'text' ? x.text : '').join('\n') : c; break; } }
  if (!text) continue;
  const idx = text.search(LOOSE);
  const blockOnly = idx >= 0 ? text.slice(idx) : text;
  const payload = JSON.stringify({ last_assistant_message: blockOnly, stop_hook_active: false });
  const out = cp.execSync('node "' + HOOK + '"', { input: payload, encoding: 'utf8' });
  let claims = null;
  if (out && out.trim()) {
    try { const j = JSON.parse(out); const ac = j.hookSpecificOutput && j.hookSpecificOutput.additionalContext || '';
      const cm = ac.match(/the prior turn stated ([^]*?) with no source nearby/);
      const sm = ac.match(/that owed silence -- ([^]*?)\. On a turn/);
      claims = { naked: cm ? cm[1] : null, selfaudit: sm ? sm[1] : null };
    } catch (e) { claims = { raw: out.slice(0, 200) }; }
  }
  if (claims) flagged++;
  rows.push({ ts: m.ts, file: path.basename(m.file), form: m.form, claims });
}
console.log('flagged by the old content-gate logic:', flagged, '/', rows.length);
for (const r of rows) if (r.claims) console.log(' *', r.ts, r.file, '|', JSON.stringify(r.claims));
