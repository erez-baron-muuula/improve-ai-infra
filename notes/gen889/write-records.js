// GEN-889 /vet-code Step 1b: writes one vetting record per target into
// ~/.claude-staging/vetting-passes/ (bound by target + normalized content hash), and appends
// Pass B agent ids on request.
// Run: node write-records.js            -> write records (Step 1b)
//      node write-records.js passb <id> -> append a Pass B agentId to every record (Step 3)
//      node write-records.js verify     -> print each record's hash vs the current working copy
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/Erez/.claude-staging/vetting-passes';
const WC = path.join(__dirname, 'wc', 'hooks');
const TARGETS = ['inject-browser-refs.js', 'inject-edit-refs.js', 'inject-windows-mcp-refs.js', 'windows-mcp-approval.js', 'windows-mcp-approval.test.js'];
const norm = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const hash = (f) => crypto.createHash('sha256').update(norm(f), 'utf8').digest('hex');
const recFile = (t) => path.join(DIR, 'vetting-record-gen889-' + t.replace(/\.js$/, '') + '.json');
const target = (t) => ('c:\\users\\erez\\.claude\\hooks\\' + t).toLowerCase();

const CHECK_IDS = ['ad56922ae449ce3aa', 'a93f59499b050fcf2', 'a5c2a683fb47c4693', 'a6d211ec6be6214d6'];
const VERDICTS = 'Round 1 (sonnet check-reviewers): pre-mortem REVISE (1 material: relay notices reworded without misfire evidence -> fixed by keeping all relay notices, rewording narrowed to the Code.js pointer); holistic REVISE (3 material: size lines not checker output -> checker output pasted; false B reasons for 4 Stop/reminder hooks -> rewritten; no install drift guard -> preinstall-check.js); soundness PASS (advisories: dangling cross-references fixed, rules-size line wording, design wording). Round 2 (combined pre-mortem+holistic+soundness): PASS, all 4 prior findings RESOLVED, no new material; advisories applied to design.md (pointer 644 chars, missing-notice wording, Step 3 narrowing on the card, B4 precaution wording).';

const mode = process.argv[2] || 'write';
if (mode === 'write') {
  fs.mkdirSync(DIR, { recursive: true });
  const now = new Date().toISOString();
  for (const t of TARGETS) {
    const rec = {
      kind: 'vetting-record',
      target: target(t),
      contentHash: hash(path.join(WC, t)),
      checkReviewerAgentIds: CHECK_IDS,
      checkVerdict: 'converged',
      capturedVerdicts: VERDICTS,
      draftedUtc: now,
      passBAgentIds: [],
    };
    if (fs.existsSync(recFile(t))) throw new Error('record exists already: ' + recFile(t));
    fs.writeFileSync(recFile(t), JSON.stringify(rec, null, 2));
    console.log('wrote', recFile(t), rec.contentHash.slice(0, 12), now);
  }
} else if (mode === 'passb') {
  const id = process.argv[3];
  if (!/^[0-9a-f]{17}$/.test(id || '')) throw new Error('bad agent id');
  for (const t of TARGETS) {
    const rec = JSON.parse(fs.readFileSync(recFile(t), 'utf8'));
    if (!rec.passBAgentIds.includes(id)) rec.passBAgentIds.push(id);
    fs.writeFileSync(recFile(t), JSON.stringify(rec, null, 2));
    console.log('passB', t, rec.passBAgentIds.join(','));
  }
} else if (mode === 'rehash') {
  // After Step 3 fixes (both passes re-run): rebind each record to the fixed working copy.
  const note = process.argv[3] || '';
  for (const t of TARGETS) {
    const rec = JSON.parse(fs.readFileSync(recFile(t), 'utf8'));
    const h = hash(path.join(WC, t));
    if (h !== rec.contentHash) {
      rec.contentHash = h;
      rec.capturedVerdicts += ' | Step 3 fixes: ' + note;
      fs.writeFileSync(recFile(t), JSON.stringify(rec, null, 2));
      console.log('rehashed', t, h.slice(0, 12));
    } else console.log('unchanged', t);
  }
} else if (mode === 'verify') {
  let bad = 0;
  for (const t of TARGETS) {
    const rec = JSON.parse(fs.readFileSync(recFile(t), 'utf8'));
    const ok = rec.contentHash === hash(path.join(WC, t)) && rec.target === target(t);
    if (!ok) bad++;
    console.log((ok ? 'match   ' : 'MISMATCH') + ' ' + t + ' passB=' + rec.passBAgentIds.length);
  }
  process.exit(bad ? 1 : 0);
}
