#!/usr/bin/env node
'use strict';
// GEN-767 real-input regression: replay the final assistant reply of real
// session transcripts on this machine through two versions of
// stop-foryou-nudge.js and compare their outputs.
// Usage: node corpus-regress.js <new hook> <baseline hook> [maxFiles=300] [--as <model-id>]
// --as rewrites the model on a TEMP COPY of each transcript (decision-boundary
// check for a model no real session ran on yet). Prints counts only, plus up to
// 5 redacted (truncated) examples of any unexpected difference.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const NEW = process.argv[2];
const BASE = process.argv[3];
const MAX = parseInt(process.argv[4] || '300', 10);
const asIdx = process.argv.indexOf('--as');
const AS = asIdx !== -1 ? process.argv[asIdx + 1] : null;
const ROOT = path.join(os.homedir(), '.claude', 'projects');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gen767-corpus-'));
const TAIL = 512 * 1024;

function listTranscripts() {
  const out = [];
  for (const proj of fs.readdirSync(ROOT)) {
    const pd = path.join(ROOT, proj);
    let ents; try { ents = fs.readdirSync(pd, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        const f = path.join(pd, e.name);
        try { out.push({ f: f, m: fs.statSync(f).mtimeMs }); } catch (err) { /* skip */ }
      }
    }
  }
  return out.sort((a, b) => b.m - a.m).slice(0, MAX).map((x) => x.f);
}

function tailText(f) {
  const size = fs.statSync(f).size;
  if (size <= TAIL) return fs.readFileSync(f, 'utf8');
  const fd = fs.openSync(f, 'r');
  try { const buf = Buffer.alloc(TAIL); const n = fs.readSync(fd, buf, 0, TAIL, size - TAIL); const raw = buf.toString('utf8', 0, n); const nl = raw.indexOf('\n'); return nl >= 0 ? raw.slice(nl + 1) : ''; } finally { fs.closeSync(fd); }
}

// Last main-chain assistant message's text, reconstructed by message.id (as the hook does).
function lastReply(text) {
  const rows = [];
  for (const l of text.split(/\r?\n/)) { if (!l) continue; try { rows.push(JSON.parse(l)); } catch (e) { /* skip */ } }
  let last = -1;
  for (let i = rows.length - 1; i >= 0; i--) { const e = rows[i]; if (e && e.type === 'assistant' && e.isSidechain !== true && e.message) { last = i; break; } }
  if (last === -1) return null;
  const id = rows[last].message.id;
  let t = '';
  for (const e of rows) {
    if (e && e.type === 'assistant' && e.isSidechain !== true && e.message && e.message.id === id && Array.isArray(e.message.content)) {
      for (const c of e.message.content) { if (c && c.type === 'text' && typeof c.text === 'string') t += c.text; }
    }
  }
  return { text: t, model: rows[last].message.model };
}

function run(hook, tp, msg) {
  const payload = JSON.stringify({ session_id: 'gen767-corpus', prompt_id: 'p', transcript_path: tp, last_assistant_message: msg, stop_hook_active: false });
  const r = cp.spawnSync(process.execPath, [hook], { input: payload, encoding: 'utf8', timeout: 20000 });
  let ctx = '';
  try { ctx = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : ''; } catch (e) { ctx = '<<unparseable>>'; }
  return { code: r.status, ctx: ctx };
}

const OLD_LEGEND = '("~" = relative order unverified)';
const NEW_LEGEND = '("~" = relative order unverified or effort-dependent)';
const form = (ctx) => {
  if (!ctx) return 'silent';
  if (ctx.indexOf('meets the STANDARD floor') !== -1) return 'mixed';
  if (ctx.indexOf(', at or above the floor --') !== -1) return 'omit';
  if (ctx.indexOf(', below the floor --') !== -1) return 'below';
  if (ctx.indexOf('could not be confirmed') !== -1) return 'unconfirmed';
  return 'no-directive';
};

const stats = { files: 0, used: 0, skipped: 0, identical: 0, legendOnly: 0, expectedDirectiveChange: 0, unexpected: 0, nonzeroExit: 0, forms: {}, models: {} };
const examples = [];
for (const f of listTranscripts()) {
  stats.files++;
  let text; try { text = tailText(f); } catch (e) { stats.skipped++; continue; }
  const lr = lastReply(text);
  if (!lr || !lr.text) { stats.skipped++; continue; }
  let tp = f;
  let model = lr.model;
  if (AS) {
    tp = path.join(TMP, 'as-' + stats.files + '.jsonl');
    const rewritten = text.split(/\r?\n/).map((l) => {
      if (!l) return l;
      try { const e = JSON.parse(l); if (e && e.type === 'assistant' && e.message && typeof e.message.model === 'string') { e.message.model = AS; return JSON.stringify(e); } } catch (err) { /* keep */ }
      return l;
    }).join('\n');
    fs.writeFileSync(tp, rewritten);
    model = AS;
  }
  stats.used++;
  stats.models[model] = (stats.models[model] || 0) + 1;
  const a = run(NEW, tp, lr.text);
  const b = run(BASE, tp, lr.text);
  if (a.code !== 0 || b.code !== 0) stats.nonzeroExit++;
  const fa = form(a.ctx);
  stats.forms[fa] = (stats.forms[fa] || 0) + 1;
  if (a.ctx === b.ctx) { stats.identical++; continue; }
  if (a.ctx === b.ctx.split(OLD_LEGEND).join(NEW_LEGEND)) { stats.legendOnly++; continue; }
  // Directive differs: expected only where the model is below the STRONG floor
  // and listed (old "below" form -> new "mixed" or new "below" with mechanical clause).
  const cutA = a.ctx.indexOf('\n\nModel-tag directive'), cutB = b.ctx.indexOf('\n\nModel-tag directive');
  const headSame = cutA !== -1 && cutB !== -1 && a.ctx.slice(0, cutA) === b.ctx.slice(0, cutB).split(OLD_LEGEND).join(NEW_LEGEND);
  if (headSame && form(b.ctx) === 'below' && (fa === 'mixed' || fa === 'below')) { stats.expectedDirectiveChange++; continue; }
  stats.unexpected++;
  if (examples.length < 5) examples.push({ file: path.basename(f), model: model, newForm: fa, baseForm: form(b.ctx), newHead: a.ctx.slice(0, 160), baseHead: b.ctx.slice(0, 160) });
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(JSON.stringify(stats, null, 1));
if (examples.length) console.log('UNEXPECTED (truncated):\n' + JSON.stringify(examples, null, 1));
process.exitCode = stats.unexpected || stats.nonzeroExit ? 1 : 0;
