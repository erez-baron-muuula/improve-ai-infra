// GEN-893 Part 2 /vet-rule Step 1b: one check-record per changed skill file, bound to the
// normalized (UTF-8, LF) working-copy hash. draftedUtc is passed in from the clock.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const drafted = process.argv[2];
if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(drafted || '')) { console.error('usage: node write-check-records.js <UTC timestamp>'); process.exit(2); }
const dir = path.join(require('os').homedir(), '.claude-staging', 'check-passes');
fs.mkdirSync(dir, { recursive: true });
const ids = ['a56ef7c38f182648c', 'a3c764e85a9fecd7d', 'a579d42f90fa8d440', 'a4bd37b9048137a2f', 'af2b982fdcff67951'];
const verdicts = 'Round 1 (4 lenses: pre-mortem, holistic, soundness, rule-check): all REVISE on one shared material finding - size a CLAUDE.md text-replace on the whole proposed file, not the OldText/NewText snippet. Fixed in suggest 4b and vet-rule Step 3, plus advisories (one-line command with launcher, house defined, approved-crossing wording, checker-error reason, cap-line pointers). Round 2 (combined re-review): PASS, finding RESOLVED, no new material issue; advisories cosmetic.';
const stamp = drafted.replace(/[-:TZ]/g, '').slice(0, 12);
for (const s of ['suggest', 'vet-rule', 'vet-code', 'vet-ticket', 'check']) {
  const wc = path.join(__dirname, 'wc2', s, 'SKILL.md');
  const norm = fs.readFileSync(wc, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const hash = crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
  const rec = {
    kind: 'check-record',
    target: ('c:\\users\\erez\\.claude\\skills\\' + s + '\\skill.md'),
    contentHash: hash,
    checkReviewerAgentIds: ids,
    checkVerdict: 'converged',
    capturedVerdicts: verdicts,
    draftedUtc: drafted,
  };
  const f = path.join(dir, 'record-gen893-' + s + '-' + stamp + '.json');
  fs.writeFileSync(f, JSON.stringify(rec, null, 2) + '\n');
  console.log(s, hash, f);
}
