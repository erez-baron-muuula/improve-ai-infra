// Measure the working copy's search-first decision over every real end-of-turn reply on disk,
// using its OWN functions (detectTicketProposals, searchWindowState) on the transcript prefix
// the hook would see at that Stop. Mode: A = no block in the reply and not a continuation
// (the For-you note fires); B = block in the reply, or a continuation (For-you silent unless
// its re-nudge conditions hold -- treated as B here). Writes fires-v2.jsonl (excerpts only).
// usage: node measure-v2.js [workingCopyPath]
const fs = require('fs');
const path = require('path');
const wc = require(process.argv[2] || path.join(__dirname, 'working', 'stop-foryou-nudge.js'));
const root = path.join(process.env.USERPROFILE, '.claude', 'projects');
const DECISION = new Set(['ask-ticket', 'ask-followup', 'ask-file-it', 'bare-ask', 'offer-ticket', 'offer-followup', 'would-new', 'go-file', 'as-ticket', 'own-ticket', 'new-ticket-for', 'chat-draft']);
const out = [];
let replies = 0, matched = 0, searchedOut = 0, modeBNonDecision = 0;
for (const proj of fs.readdirSync(root)) {
  let files; try { files = fs.readdirSync(path.join(root, proj)).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of files) {
    let s; try { s = fs.readFileSync(path.join(root, proj, f), 'utf8'); } catch (e) { continue; }
    const entries = [];
    for (const line of s.split('\n')) { if (!line) continue; try { entries.push(JSON.parse(line)); } catch (e) {} }
    const msgs = new Map(); const order = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || e.type !== 'assistant' || e.isSidechain === true || !e.message || !Array.isArray(e.message.content)) continue;
      const id = e.message.id || ('noid-' + i);
      if (!msgs.has(id)) { msgs.set(id, { first: i, text: '', tool: false, ts: e.timestamp }); order.push(id); }
      const m = msgs.get(id);
      for (const c of e.message.content) {
        if (c && c.type === 'text' && typeof c.text === 'string') m.text += c.text;
        if (c && c.type === 'tool_use') m.tool = true;
      }
    }
    for (const id of order) {
      const m = msgs.get(id);
      if (!m.text || m.tool) continue;
      replies++;
      const pats = wc.detectTicketProposals(m.text);
      if (!pats.length) continue;
      matched++;
      const prefix = entries.slice(0, m.first);
      const st = wc.searchWindowState(prefix);
      if (st.searched) { searchedOut++; continue; }
      // continuation: a stop_hook_summary after Erez's last message
      let p = -1; for (let i = prefix.length - 1; i >= 0; i--) { if (wc.isErezMessage(prefix[i])) { p = i; break; } }
      let cont = false; for (let i = p + 1; i < prefix.length; i++) { const e = prefix[i]; if (e && e.type === 'system' && e.subtype === 'stop_hook_summary') { cont = true; break; } }
      const marker = wc.MARKER_RE.test(m.text);
      const mode = (!marker && !cont) ? 'A' : 'B';
      if (mode === 'B' && !wc.putsDecision(pats)) { modeBNonDecision++; continue; }
      const prose = m.text.replace(/\s+/g, ' ');
      out.push({ session: f.slice(0, 8), msgId: id, ts: (m.ts || '').slice(0, 10), mode, marker, cont, patterns: pats, searchAge: st.searchAge, excerpt: prose.slice(0, 0) });
    }
  }
}
// excerpts come from the prototype's matcher for readability
const proto = require('./detector.js');
const byId = new Map();
for (const line of fs.readFileSync(path.join(__dirname, 'corpus.jsonl'), 'utf8').split('\n')) { if (!line) continue; const r = JSON.parse(line); byId.set(r.msgId, r.text); }
for (const o of out) { const t = byId.get(o.msgId); const d = t ? proto.detect(t) : null; o.excerpt = d ? d.excerpt : (t ? t.slice(0, 160).replace(/\s+/g, ' ') : ''); }
fs.writeFileSync(path.join(__dirname, 'fires-v2.jsonl'), out.map(o => JSON.stringify(o)).join('\n') + '\n');
const modeA = out.filter(o => o.mode === 'A').length, modeB = out.length - modeA;
const ages = {}; for (const o of out) ages[o.searchAge] = (ages[o.searchAge] || 0) + 1;
console.log(JSON.stringify({ replies, matched, searchedOut, modeBNonDecisionSkipped: modeBNonDecision, fires: out.length, modeA, modeB, sessions: new Set(out.map(o => o.session)).size, searchAge: ages }));
