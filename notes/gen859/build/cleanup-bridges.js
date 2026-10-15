// One-off (GEN-859): remove from Phase-0 test COPIES the phone-link ids that belong to the original account's
// entry (set difference), keeping any ids the copy's own account added; restore the copy's file date.
// Usage: node cleanup-bridges.js <copyAccountUuid> <originalAccountUuid> <id> [<id> ...]
// Refuses to touch the copy's folder if that account is the signed-in one.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(process.env.APPDATA, 'Claude', 'claude-code-sessions');
const ORG = '13fa9673-ac05-4484-9d1a-93741a41beed';
const [copyAcct, origAcct, ...ids] = process.argv.slice(2);
const cfg = fs.readFileSync(path.join(process.env.APPDATA, 'Claude', 'config.json'), 'utf8');
const active = (/"lastKnownAccountUuid"\s*:\s*"([0-9a-f-]{36})"/.exec(cfg) || [])[1];
if (!active || active === copyAcct) { console.log(`refused: ${copyAcct} is the signed-in account (or unknown)`); process.exit(1); }
for (const id of ids) {
  const copy = path.join(ROOT, copyAcct, ORG, `local_${id}.json`);
  const orig = path.join(ROOT, origAcct, ORG, `local_${id}.json`);
  if (!fs.existsSync(copy) || !fs.existsSync(orig)) { console.log(id, 'skip: missing copy or original'); continue; }
  const st = fs.statSync(copy);
  const c = JSON.parse(fs.readFileSync(copy, 'utf8'));
  const o = JSON.parse(fs.readFileSync(orig, 'utf8'));
  const foreign = new Set(o.bridgeSessionIds || []);
  const before = c.bridgeSessionIds || [];
  const after = before.filter(x => !foreign.has(x));
  if (after.length === before.length) { console.log(id, 'nothing to remove', JSON.stringify(before)); continue; }
  if (after.length) c.bridgeSessionIds = after; else delete c.bridgeSessionIds;
  const tmp = path.join(path.dirname(copy), `.local_${id}.json.${process.pid}.sync.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(c), 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.utimesSync(tmp, st.atime, st.mtime);
  fs.renameSync(tmp, copy);
  console.log(id, `removed ${before.length - after.length}, kept ${after.length}`, 'date kept:', Math.abs(fs.statSync(copy).mtimeMs - st.mtimeMs) < 1000);
}
