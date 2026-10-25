// GEN-674 option E, /vet-code Step 1b: write one vetting record per target into ~/.claude-staging/vetting-passes/.
// contentHash = sha256 of the LF-normalized UTF-8 working copy (the same hash build.js prints).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const WC = path.join(__dirname, 'wc');
const OUT = path.join(os.homedir(), '.claude-staging', 'vetting-passes');
const step1 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'step1e-reviewers.json'), 'utf8'));
const passB = JSON.parse(fs.readFileSync(path.join(__dirname, 'passB-ids.json'), 'utf8')).passBAgentIds;
const TARGETS = [
  ['auto-approve.js', 'c:\\users\\erez\\.claude\\hooks\\auto-approve.js'],
  ['sessionstart-backup-surfacer.js', 'c:\\users\\erez\\.claude\\hooks\\sessionstart-backup-surfacer.js'],
  ['deny-askuserquestion.js', 'c:\\users\\erez\\.claude\\hooks\\deny-askuserquestion.js'],
  ['update-config.ps1', 'g:\\my drive\\ai projects\\_tooling\\claude\\update-config.ps1'],
  ['settings.json', 'c:\\users\\erez\\.claude\\settings.json'],
];
const drafted = new Date().toISOString();
fs.mkdirSync(OUT, { recursive: true });
for (const [name, target] of TARGETS) {
  const text = fs.readFileSync(path.join(WC, name), 'utf8').replace(/\r\n/g, '\n');
  const rec = {
    kind: 'vetting-record',
    target,
    contentHash: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
    checkReviewerAgentIds: step1.checkReviewerAgentIds,
    checkVerdict: 'converged',
    capturedVerdicts: step1.capturedVerdicts,
    draftedUtc: drafted,
    passBAgentIds: passB,
  };
  const file = path.join(OUT, 'record-gen674e-' + name.replace(/[^a-z0-9]+/gi, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
  console.log('record', path.basename(file), rec.contentHash);
}
