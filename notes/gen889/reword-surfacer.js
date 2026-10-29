// GEN-889: rewords the "Relay this to Erez ..." / "Tell Erez in the For you block ..." orders in
// the sessionstart-backup-surfacer.js working copy as statements of fact. Each old text must
// match exactly the expected number of times, or nothing is written.
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, 'wc', 'hooks', 'sessionstart-backup-surfacer.js');
let t = fs.readFileSync(f, 'utf8');
const TOP = 'Erez has not seen this yet; it belongs at the top of the first response.';
const pairs = [
  ["'Relay this to Erez at the top of your first response. Run log: ~/.claude/session-backup-state/runs.log.'",
   "'" + TOP + " Run log: ~/.claude/session-backup-state/runs.log.'", 1],
  ['Relay this to Erez at the top of your first response.\';\nfunction repoKeyOf',
   TOP + '\';\nfunction repoKeyOf', 1],
  ["'at each /wrap. Relay this to Erez at the top of your first response. Details: ~/.claude/backup-sweep-failures.jsonl.'",
   "'at each /wrap. " + TOP + " Details: ~/.claude/backup-sweep-failures.jsonl.'", 1],
  ["      'Relay this to Erez at the top of your first response.'\n",
   "      '" + TOP + "'\n", 1],
  ["'Relay this to Erez at the top of your first response. Run log: ~/.claude/account-session-sync/changes.log.'",
   "'" + TOP + " Run log: ~/.claude/account-session-sync/changes.log.'", 1],
  ["      'Tell Erez in the 📌 For you block of your first reply.'\n",
   "      'Erez has not been told; it belongs in the 📌 For you block of the first reply.'\n", 1],
  ['Tell Erez once, in the 📌 For you block ` +\n      `of your first reply, in plain words with that quote, and ask whether it is what he agreed; if not, offer to bring the ` +\n      `file back to ${limit} lines or fewer.`;',
   'Erez has not been told; it belongs once in the 📌 For you block ` +\n      `of the first reply, in plain words with that quote, with the question whether it is what he agreed; if not, the offer is to ` +\n      `bring the file back to ${limit} lines or fewer.`;', 1],
  ["'with no OK from Erez on record for its current text. Tell Erez in the 📌 For you block of your first reply, ' +\n    `in plain words, and offer to bring it back to ${limit} lines or fewer.`",
   "'with no OK from Erez on record for its current text. Erez has not been told; it belongs in the 📌 For you block of the first reply, ' +\n    `in plain words, with an offer to bring it back to ${limit} lines or fewer.`", 1],
  ["return out.join(' ') + ' Tell Erez in the 📌 For you block of your first reply, in plain words.';",
   "return out.join(' ') + ' Erez has not been told; it belongs in the 📌 For you block of the first reply, in plain words.';", 1],
  ["'Tell Erez in the 📌 For you block of your first reply, in plain words, and offer to restore it (GEN-674).'",
   "'Erez has not been told; it belongs in the 📌 For you block of the first reply, in plain words, with an offer to restore it (GEN-674).'", 1],
  ["'ACTION: Relay this to Erez immediately at the top of your first response. For each SUSPECTED SECRET, the repo was NOT pushed anywhere; Erez must rule on the flagged content before it can be backed up.'",
   "'Erez has not seen this yet; it belongs at the very top of the first response. For each SUSPECTED SECRET, the repo was NOT pushed anywhere, and it stays unbacked-up until Erez rules on the flagged content.'", 1],
  ["'Relay this to Erez at the top of your first response so a failed backup is not missed. Most kinds retry automatically next sweep.'",
   "'Erez has not seen this yet; it belongs at the top of the first response, so a failed backup is not missed. Most kinds retry automatically next sweep.'", 1],
];
let bad = 0;
for (const [oldS, newS, want] of pairs) {
  const got = t.split(oldS).length - 1;
  if (got !== want) { bad++; console.log('MISMATCH (' + got + '):', oldS.slice(0, 70)); continue; }
  t = t.split(oldS).join(newS);
}
if (bad) { console.log('nothing written'); process.exit(1); }
fs.writeFileSync(f, t, 'utf8');
console.log('replaced', pairs.length, '; orders left:', (t.match(/Relay this to Erez|Tell Erez in the|ACTION:/g) || []).length);
