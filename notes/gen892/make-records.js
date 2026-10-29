// GEN-892: write the vetting records (code, /vet-code) and check-records (skill text, /vet-rule) for every
// target, bound to the normalized working-copy hash. Run after the last review, before minting.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WC = path.join(__dirname, 'wc');
const STAGING = 'C:/Users/Erez/.claude-staging';
const drafted = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const hashOf = f => crypto.createHash('sha256').update(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');

const DESIGN_IDS = ['a8c5157610c54f900', 'a51d7086e01eac920', 'a0b50c2f37147399b', 'afd0c6645113cc44d', 'aa1709fda65fac09c', 'adcf213f7076d8f6b'];
const PASS_B_IDS = ['aa6df53779f981cd3', 'afa1af8eff6f33b7f', 'a25c5473d8bd91363', 'a070eea8ba97fbfd3', 'a516659aeece696ae'];
const SKILL_IDS = ['a0129319d31f4f02f', 'af05caf79d049de02', 'aef36d9acd94f4768', 'ae5cf87c0bb5a7f23', 'a9d3a13c1303936ad'];

const CODE = [
  ['C:\\Users\\Erez\\.claude\\hooks\\guidelines-limits.js', 'hooks/guidelines-limits.js'],
  ['C:\\Users\\Erez\\.claude\\hooks\\inject-notion-refs.js', 'hooks/inject-notion-refs.js'],
  ['C:\\Users\\Erez\\.claude\\hooks\\inject-shell-refs.js', 'hooks/inject-shell-refs.js'],
  ['C:\\Users\\Erez\\.claude\\hooks\\inject-topic-refs.js', 'hooks/inject-topic-refs.js'],
  ['C:\\Users\\Erez\\.claude\\hooks\\inject-browser-refs.js', 'hooks/inject-browser-refs.js'],
  ['C:\\Users\\Erez\\.claude\\hooks\\sessionstart-backup-surfacer.js', 'hooks/sessionstart-backup-surfacer.js'],
  ['C:\\Users\\Erez\\.claude\\hooks\\sessionstart-skill-restore.js', 'hooks/sessionstart-skill-restore.js'],
  ['G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1', 'drive/update-config.ps1'],
  ['C:\\Users\\Erez\\.claude\\skills\\config-health\\config-health-scan.ps1', 'skills/config-health-scan.ps1'],
];
const SKILL = [
  ['C:\\Users\\Erez\\.claude\\skills\\release-review\\SKILL.md', 'skills/release-review/SKILL.md'],
  ['C:\\Users\\Erez\\.claude\\skills\\release-review\\guidelines-watch.md', 'skills/release-review/guidelines-watch.md'],
  ['C:\\Users\\Erez\\.claude\\skills\\release-review\\writes-and-digest.md', 'skills/release-review/writes-and-digest.md'],
];

const codeVerdicts = 'Design /check (3 lenses) converged in 2 rounds (round 1: false project-edit-report trace, candidate re-arm, masked stalled watch, missing 4b size lines; all resolved). Pass A /code-review high twice (6 + 2 findings: 6 fixed, 2 skipped as fail-safe). Pass B opus: run 1 PASS (stale diff noted, current copies passed), run 2 PASS on the final versions, run 3 delta review of the last hardening, run 4 REVISE on the PowerShell reader copy (it kept disagreeing with the JS reader on hand-damaged files), so per Erez ("one shared reader, but in a new session") update-config.ps1 now calls hooks/guidelines-limits.js print; run 5 PASS on that delta (5 advisories: install the reader first, document the fallback ceiling and trust location, both done; node via PATH and the two-file forged raise noted as residual). Pass A /code-review high on the delta: 5 findings, 4 fixed, 1 by design (limits under 50 fall back to 200). Tests 124/124 (notes/gen892/test.js), size-checker suites 51/51 and 44/44, live-verify 10/10 identical to live hooks on real inputs.';
const skillVerdicts = 'Skill-text /check (pre-mortem, holistic, soundness): holistic PASS and soundness PASS in round 1; pre-mortem REVISE round 1 (one-shot output unsaved; no-op digest path), REVISE round 2 (recovery-file clearing, new from revision), PASS round 3 on opus. Advisories adopted: re-arm scope and recovery exemption, settled list, Step 10 deletion line, Step 8 bullets split, digest slot, Step 11 limit changes.';

function write(dir, name, rec) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  fs.writeFileSync(f, JSON.stringify(rec, null, 2) + '\n', 'utf8');
  console.log('record', f, rec.contentHash.slice(0, 12));
}
for (const [target, rel] of CODE) {
  write(path.join(STAGING, 'vetting-passes'), 'gen892-' + path.basename(rel).replace(/\W+/g, '-') + '.record.json', {
    kind: 'vetting-record', target: target.toLowerCase(), contentHash: hashOf(path.join(WC, rel)),
    checkReviewerAgentIds: DESIGN_IDS, checkVerdict: 'converged', capturedVerdicts: codeVerdicts, draftedUtc: drafted, passBAgentIds: PASS_B_IDS });
}
for (const [target, rel] of SKILL) {
  write(path.join(STAGING, 'check-passes'), 'gen892-' + path.basename(rel).replace(/\W+/g, '-') + '.record.json', {
    kind: 'check-record', target: target.toLowerCase(), contentHash: hashOf(path.join(WC, rel)),
    checkReviewerAgentIds: SKILL_IDS, checkVerdict: 'converged', capturedVerdicts: skillVerdicts, draftedUtc: drafted });
}
