// Build the blind re-judge input: one redacted excerpt per fire (fires-v2.jsonl), no pattern names,
// no mode, shuffled order. Output: judge-input.txt (numbered items) + judge-key.json (item -> msgId).
const fs = require('fs');
const path = require('path');
const fires = fs.readFileSync(path.join(__dirname, 'fires-v2.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const byId = new Map();
for (const line of fs.readFileSync(path.join(__dirname, 'corpus.jsonl'), 'utf8').split('\n')) { if (!line) continue; const r = JSON.parse(line); byId.set(r.msgId, r); }
const ANCHOR = /\b(?:file|filing|draft|open|create|raise|capture)\b[^.?!\n]{0,100}\b(?:tickets?|follow-ups?|learning)\b|\btickets? (?:for|to|on|about|covering|that)\b|own (?:\w+[- ]){0,3}ticket|^[ \t>*-]*\**Title:?\**:/im;
function redact(s) {
  return s.replace(/\b(?:ntn_|secret_|ghp_|github_pat_|sk-|AIza|xox[abpr]-|ATATT)[A-Za-z0-9_\-]{8,}/g, '<REDACTED-KEY>')
          .replace(/\b[A-Fa-f0-9]{40,}\b/g, '<REDACTED-HEX>')
          .replace(/\b[A-Za-z0-9+/]{48,}={0,2}/g, '<REDACTED-B64>');
}
const items = [];
for (const f of fires) {
  const r = byId.get(f.msgId);
  if (!r) { items.push({ id: f.msgId, text: '(reply text not in corpus)', searchAge: f.searchAge }); continue; }
  const t = r.text;
  const m = ANCHOR.exec(t);
  const at = m ? m.index : 0;
  const a = Math.max(0, at - 500), b = Math.min(t.length, at + 450);
  items.push({ id: f.msgId, text: redact(t.slice(a, b)).replace(/\s+\n/g, '\n'), searchAge: f.searchAge, session: f.session });
}
// deterministic shuffle
let seed = 606; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
let out = '';
const key = {};
items.forEach((it, i) => {
  key[i + 1] = it.id;
  const prior = it.searchAge === -1 ? 'no board search anywhere earlier in the visible session'
    : 'the most recent board search was ' + it.searchAge + ' user message(s) earlier (for an unknown item)';
  out += '=== ITEM ' + (i + 1) + ' (session ' + it.session + '; ' + prior + ')\n...' + it.text + '...\n\n';
});
fs.writeFileSync(path.join(__dirname, 'judge-input.txt'), out);
fs.writeFileSync(path.join(__dirname, 'judge-key.json'), JSON.stringify(key));
console.log('items', items.length, 'chars', out.length);
