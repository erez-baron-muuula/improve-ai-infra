#!/usr/bin/env node
// release-review-tool.js -- mechanical helpers for the /release-review skill (GEN-871).
//
// Everything here is read-only except `record-run`, which appends one line to runs.jsonl
// and rewrites state.json (both in this folder). No network call carries a credential.
//
// Commands (one per call; every command prints JSON or one plain line):
//   collect --after <ver> [--through <ver>] [--out <file>] [--changelog <file>]
//       Versions newer than --after (and up to --through, if given), oldest first, each with
//       its npm publish date and its changelog lines, IDE-only lines removed. With --out, writes
//       the JSON below to that file and prints only a summary (version list, line count). JSON:
//       { latest, after, through, versions:[{version,date,lines[]}], droppedIde:[{version,line}],
//         undated:[versions with no npm date] }
//   verify <claims.json> [--changelog <file>]
//       claims.json = [{ "version": "2.1.295", "text": "<words quoted from the line>" }, ...]
//       For each claim, finds every version whose section has a line containing `text`
//       (case- and whitespace-insensitive). Prints JSON [{version,text,ok,foundIn[]}];
//       ok = the claimed version is among foundIn. Exit 1 if any claim is not ok.
//   installed
//       The Claude Code version recorded in the newest session transcript on this PC.
//   readout
//       The one /wrap line (or nothing when there is nothing to report). Never throws:
//       prints "Release review: readout failed (<reason>)" instead.
//   pending
//       Prints the findings.jsonl "pending" rows (written just before a Notion write) that have
//       no later final row for the same key+target -- the writes a crashed run may have left
//       half-done. Prints [] when none.
//   record-run <run.json>
//       Appends the run row to runs.jsonl; for a live run that completed ("outcome":"ok"),
//       also advances state.json lastReviewedVersion to run.through -- but refuses "ok" (exit 1)
//       while any pending row is unresolved. Prints the new state.
//
// Sources: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
//          https://registry.npmjs.org/@anthropic-ai/claude-code  (field `time`)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const HERE = __dirname;
const STATE = path.join(HERE, 'state.json');
const RUNS = path.join(HERE, 'runs.jsonl');
const CHANGELOG_URL = 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md';
const NPM_URL = 'https://registry.npmjs.org/@anthropic-ai/claude-code';
const ALERT_DAYS = 10;

function die(msg, code) { process.stderr.write(msg + '\n'); process.exit(code || 2); }

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function get(url, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'release-review-tool', Accept: '*/*' }, timeout: 60000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' from ' + url)); }
      let b = '';
      res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => resolve(b));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout fetching ' + url)));
    req.on('error', reject);
  });
}

function parseVer(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function cmpVer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// Splits CHANGELOG.md into [{version, lines[]}] in file order (newest first).
// A section starts at a "## <x.y.z>" heading; its lines are the "- " bullets under it
// (continuation lines are folded into the bullet above them).
function parseChangelog(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const h = /^##\s+(\d+\.\d+\.\d+)\s*$/.exec(raw);
    if (h) { cur = { version: h[1], lines: [] }; out.push(cur); continue; }
    if (!cur) continue;
    if (/^\s*[-*]\s+/.test(raw)) cur.lines.push(raw.replace(/^\s*[-*]\s+/, '').trim());
    else if (raw.trim() && cur.lines.length && /^\s+/.test(raw)) cur.lines[cur.lines.length - 1] += ' ' + raw.trim();
  }
  if (!out.length) throw new Error('changelog has no "## x.y.z" headings -- format changed?');
  return out;
}

// IDE-only: the line names an IDE surface and no surface we use. Conservative on purpose --
// keeping an IDE line costs a little reading; dropping a real line loses a finding.
const IDE_RE = /\b(VS ?Code|VSCode|JetBrains|IntelliJ|PyCharm|WebStorm|Cursor IDE|Windsurf)\b/i;
const OURS_RE = /\b(terminal|CLI|Desktop|Windows|macOS|Linux|all surfaces|everywhere|SDK|claude\.ai|cloud session)\b/i;
function isIdeOnly(line) { return IDE_RE.test(line) && !OURS_RE.test(line); }

async function loadChangelog() {
  const f = arg('--changelog');
  if (f) return fs.readFileSync(f, 'utf8');
  return get(CHANGELOG_URL);
}

async function cmdCollect() {
  const after = arg('--after');
  const through = arg('--through');
  if (!parseVer(after)) die('collect: --after <x.y.z> is required');
  if (through && !parseVer(through)) die('collect: --through must be x.y.z');
  const sections = parseChangelog(await loadChangelog());
  const npm = JSON.parse(await get(NPM_URL));
  const times = (npm && npm.time) || {};
  const picked = sections
    .filter(s => cmpVer(s.version, after) > 0 && (!through || cmpVer(s.version, through) <= 0))
    .sort((a, b) => cmpVer(a.version, b.version));
  const droppedIde = [];
  const undated = [];
  const versions = picked.map(s => {
    const keep = [];
    for (const l of s.lines) { if (isIdeOnly(l)) droppedIde.push({ version: s.version, line: l }); else keep.push(l); }
    const date = times[s.version] || null;
    if (!date) undated.push(s.version);
    return { version: s.version, date, lines: keep };
  });
  const latest = sections.map(s => s.version).sort(cmpVer).pop();
  const result = { latest, after, through: through || null, versions, droppedIde, undated };
  const out = arg('--out');
  if (out) {
    // Write the full result to a file and print only a summary, so no shell output limit can
    // truncate the changelog lines the run is about to review.
    fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n', 'utf8');
    const lines = versions.reduce((n, v) => n + v.lines.length, 0);
    process.stdout.write(JSON.stringify({ out, latest, versions: versions.map(v => v.version), lines, droppedIde: droppedIde.length, undated }) + '\n');
  } else {
    process.stdout.write(JSON.stringify(result) + '\n');
  }
}

function norm(s) { return String(s || '').toLowerCase().replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim(); }

async function cmdVerify() {
  const file = process.argv[3];
  if (!file || file.startsWith('--')) die('verify: claims file required');
  const claims = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(claims) || !claims.length) die('verify: claims must be a non-empty array');
  const sections = parseChangelog(await loadChangelog());
  let bad = 0;
  const out = claims.map(c => {
    const t = norm(c.text);
    if (t.length < 12) { bad++; return { version: c.version, text: c.text, ok: false, foundIn: [], error: 'text too short to be specific (min 12 chars)' }; }
    const foundIn = sections.filter(s => s.lines.some(l => norm(l).includes(t))).map(s => s.version);
    const ok = foundIn.includes(String(c.version).trim());
    if (!ok) bad++;
    return { version: c.version, text: c.text, ok, foundIn };
  });
  process.stdout.write(JSON.stringify(out, null, 1) + '\n');
  process.exit(bad ? 1 : 0);
}

function cmdInstalled() {
  const root = path.join(os.homedir(), '.claude', 'projects');
  let best = null;
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(dir, f);
      const m = fs.statSync(full).mtimeMs;
      if (!best || m > best.m) best = { full, m };
    }
  }
  if (!best) die('installed: no session transcripts found', 1);
  const fd = fs.openSync(best.full, 'r');
  const size = fs.fstatSync(fd).size;
  const len = Math.min(size, 2 * 1024 * 1024);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, size - len);
  fs.closeSync(fd);
  const all = buf.toString('utf8').match(/"version":"(\d+\.\d+\.\d+)"/g);
  if (!all) die('installed: no version field in the newest transcript tail', 1);
  const v = /"version":"([^"]+)"/.exec(all[all.length - 1])[1];
  process.stdout.write(JSON.stringify({ installed: v, from: best.full, at: new Date(best.m).toISOString() }) + '\n');
}

function readJsonl(f) {
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}

function cmdReadout() {
  try {
    const now = Date.now();
    const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;
    if (!state) { console.log('Release review: readout failed (state.json missing)'); return; }
    const live = readJsonl(RUNS).filter(r => r.mode === 'live');
    const unfiled = fs.readdirSync(HERE).filter(f => /^unfiled-.*\.md$/i.test(f));
    const last = live.length ? live[live.length - 1] : null;
    const sinceMs = last ? Date.parse(last.ts) : Date.parse(state.installedUtc || '');
    const days = isNaN(sinceMs) ? null : Math.floor((now - sinceMs) / 86400000);
    const parts = [];
    if (days === null) parts.push('⚠ Release review: could not tell when it last ran (bad date in state.json/runs.jsonl)');
    else if (days > ALERT_DAYS) parts.push('⚠ Release review: no run in ' + days + ' days' + (last ? ' (last ' + last.ts.slice(0, 10) + ')' : ' (never ran since install)') + ' — check the weekly task "release-review-weekly" is enabled and the Claude app was open');
    if (last && last.outcome !== 'ok') parts.push('⚠ Release review: last run ' + last.ts.slice(0, 10) + ' did not finish (' + (last.note || last.outcome) + ')');
    if (last) {
      const n = a => (Array.isArray(a) ? a.length : (a || 0));
      const filed = n(last.filed), appended = n(last.appended), unblocked = n(last.unblocked), waiting = n(last.waiting);
      const recent = (now - Date.parse(last.ts)) < 7 * 86400000;
      if ((recent && filed + appended + unblocked > 0) || waiting > 0 || unfiled.length) {
        parts.push('Release review: last run ' + last.ts.slice(0, 10) + ' (' + last.from + ' → ' + last.through + '): ' +
          filed + ' new ticket(s), ' + appended + ' note(s) added, ' + unblocked + ' moved Blocked → To Do, ' +
          waiting + ' waiting for your yes/no as of that run' + (state.digestTicket ? ' in ' + state.digestTicket : '') + ', ' +
          unfiled.length + ' not filed' + (unfiled.length ? ' (' + unfiled.map(f => path.join(HERE, f)).join(', ') + ')' : ''));
      }
    } else if (unfiled.length) {
      parts.push('Release review: ' + unfiled.length + ' finding file(s) not filed: ' + unfiled.map(f => path.join(HERE, f)).join(', '));
    }
    if (parts.length) console.log(parts.join('\n'));
  } catch (e) {
    console.log('Release review: readout failed (' + (e && e.message ? e.message : e) + ')');
  }
}

// Rows with status "pending" whose key+target has no LATER non-pending row.
function unresolvedPending() {
  const rows = readJsonl(path.join(HERE, 'findings.jsonl'));
  const open = new Map();
  for (const r of rows) {
    const id = r.key + '|' + r.target;
    if (r.status === 'pending') open.set(id, r); else open.delete(id);
  }
  return [...open.values()];
}

function cmdPending() {
  process.stdout.write(JSON.stringify(unresolvedPending()) + '\n');
}

function cmdRecordRun() {
  const file = process.argv[3];
  if (!file) die('record-run: run file required');
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['run', 'mode', 'from', 'through', 'outcome']) if (!run[k]) die('record-run: missing "' + k + '"');
  if (!['live', 'dry'].includes(run.mode)) die('record-run: mode must be live or dry');
  if (!['ok', 'failed'].includes(run.outcome)) die('record-run: outcome must be ok or failed');
  if (!parseVer(run.from) || !parseVer(run.through)) die('record-run: from/through must be x.y.z');
  run.ts = new Date().toISOString();
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  if (run.mode === 'live' && run.outcome === 'ok') {
    // Write-ahead check: every "pending" row (written before a Notion write) must have a later
    // final row for the same key+target, in any run, or the run cannot be recorded ok.
    const open = unresolvedPending();
    if (open.length) die('record-run: refusing outcome "ok" -- ' + open.length + ' pending finding(s) have no final row: ' +
      open.map(r => r.key + ' -> ' + r.target).join('; ') + '. Reconcile them (Step 0) or record the run as failed.', 1);
    if (cmpVer(run.through, state.lastReviewedVersion) < 0) die('record-run: through ' + run.through + ' is older than lastReviewedVersion ' + state.lastReviewedVersion);
    state.lastReviewedVersion = run.through;
    state.lastRunUtc = run.ts;
    if (run.digestTicket) {
      if (!/^GEN-\d+$/.test(run.digestTicket)) die('record-run: digestTicket must be a plain "GEN-<n>" string');
      state.digestTicket = run.digestTicket;
    }
  }
  fs.appendFileSync(RUNS, JSON.stringify(run) + '\n', 'utf8');
  const tmp = STATE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, STATE);
  process.stdout.write(JSON.stringify(state) + '\n');
}

const cmd = process.argv[2];
const table = { collect: cmdCollect, verify: cmdVerify, installed: cmdInstalled, readout: cmdReadout, pending: cmdPending, 'record-run': cmdRecordRun };
if (!table[cmd]) die('usage: release-review-tool.js collect|verify|installed|readout|pending|record-run ...');
Promise.resolve().then(table[cmd]).catch(e => die(cmd + ' failed: ' + (e && e.message ? e.message : e), 1));
