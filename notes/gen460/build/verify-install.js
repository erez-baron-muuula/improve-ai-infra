// GEN-460 Step 8: installed files (local, Drive, git history) match the approved working copies
// (normalized UTF-8/LF sha256), and no unconsumed vetting pass remains.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const norm = (p) => { try { return crypto.createHash('sha256').update(fs.readFileSync(p).toString('utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex'); } catch (e) { return 'MISSING'; } };
const sets = {
  'auto-approve.working.js': ['C:/Users/Erez/.claude/hooks/auto-approve.js', 'G:/My Drive/AI Projects/_Tooling/Claude/hooks/auto-approve.js', 'C:/Users/Erez/.claude-git-history/hooks/auto-approve.js'],
  'sync.working.ps1': ['G:/My Drive/AI Projects/_Tooling/Claude/sync.ps1'],
};
for (const [wc, targets] of Object.entries(sets)) {
  const want = norm(path.join(__dirname, wc));
  for (const t of targets) console.log(norm(t) === want ? 'MATCH   ' : 'DIFFERS ', t);
}
const pd = 'C:/Users/Erez/.claude-staging/vetting-passes';
const live = fs.readdirSync(pd).filter((f) => f.endsWith('.json') && !f.startsWith('record-'));
console.log('unconsumed pass files:', live.length ? live.join(', ') : 'none');
console.log('consumed gen460 passes:', fs.readdirSync(pd).filter((f) => /gen460.*consumed/.test(f)).join(', ') || 'none');
