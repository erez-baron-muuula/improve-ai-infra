#!/usr/bin/env node
// release-review-tool.js -- mechanical helpers for the /release-review skill (GEN-871).
//
// Everything here is read-only except `record-run`, which appends one line to runs.jsonl
// and rewrites state.json (both in this folder), and `guidelines-check` (GEN-892, below), which
// writes guidelines-state.json and, with --apply, the limits file, its change log and page copies.
// No network call carries a credential.
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
//       prints "Release review: readout failed (<reason>)" instead. Also prints the guidelines
//       watch's stored warnings and a stalled-watch alarm (GEN-892); a limit change it applied
//       is not shown here (it goes in the weekly digest).
//   pending
//       Prints the findings.jsonl "pending" rows (written just before a Notion write) that have
//       no later final row for the same key+target -- the writes a crashed run may have left
//       half-done. Prints [] when none.
//   record-run <run.json>
//       Appends the run row to runs.jsonl; for a live run that completed ("outcome":"ok"),
//       also advances state.json lastReviewedVersion to run.through -- but refuses "ok" (exit 1)
//       while any pending row is unresolved. Prints the new state.
//
//   guidelines-check [--apply] [--pages-dir <dir> --root <dir>]
//       GEN-892. Downloads Anthropic's 7 guideline pages and checks every anchored limit in
//       notes/anthropic-guidelines.json (an anchor is the exact words around the number on a page).
//       A plain run writes only release-review/guidelines-state.json (checkUtc, warnings; a found
//       change becomes the warning "change detected, not applied"). --apply (live runs) also sets
//       applyUtc, applies a changed number to the limits file (a row in guidelines-changes.jsonl
//       first, then the file, after the size checker has loaded it), and saves page copies under
//       release-review/docs/ (git-ignored) with their hashes. --root is the notes folder (default:
//       the real one); --pages-dir reads <id>.md test pages instead of downloading and is refused
//       unless --root is outside the project. Prints JSON { ok, apply, pages, unchanged, changes,
//       applied, candidates, textToUpdate, changedParagraphs, strayCopies, warnings }. Never throws;
//       exit 0.
//
// Sources: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
//          https://registry.npmjs.org/@anthropic-ai/claude-code  (field `time`)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const childProcess = require('child_process');

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
    else if (days > ALERT_DAYS) parts.push('⚠ Release review: no run in ' + days + ' days' + (last ? ' (last ' + last.ts.slice(0, 10) + ')' : ' (no live run since install)') + ' — ' +
      (state.supervisedPassedUtc ? 'check the weekly task "release-review-weekly" is enabled and the Claude app was open'
        : 'the first supervised run has not been done yet, so weekly runs only read and write nothing'));
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
    parts.push(...guidelinesReadoutLines(now, live));
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

// ---- guidelines-check (GEN-892) -------------------------------------------------------------------
// Watches Anthropic's published size limits for the files that steer Claude. Usage in the header.
// Design and review: notes/gen892/plan.md (approved 2026-10-26) and notes/gen892/build-design.md.
const GUIDELINES_SINCE_UTC = '2026-10-29T00:00:00Z'; // GEN-892 install day; re-set if installed later
const GUIDELINE_PAGES = [
  { id: 'memory', url: 'https://code.claude.com/docs/en/memory.md' },
  { id: 'skills', url: 'https://code.claude.com/docs/en/skills.md' },
  { id: 'hooks', url: 'https://code.claude.com/docs/en/hooks.md' },
  { id: 'sub-agents', url: 'https://code.claude.com/docs/en/sub-agents.md' },
  { id: 'large-codebases', url: 'https://code.claude.com/docs/en/large-codebases.md' },
  { id: 'best-practices', url: 'https://code.claude.com/docs/en/best-practices.md' },
  { id: 'skill-best-practices', url: 'https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices.md' },
];
const CONFIG_HEALTH = path.join(os.homedir(), '.claude', 'skills', 'config-health', 'config-health-scan.ps1');
const UPDATE_CONFIG = 'G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1';
// A changed paragraph is shown only when it mentions a limit word or one of our file kinds.
const LIMIT_WORD_RE = /\b(lines?|characters?|tokens?|KB|limits?|caps?|capped|truncat\w*)\b|CLAUDE\.md|SKILL\.md|MEMORY\.md|\bskills?\b|\bcommands?\b|\bhooks?\b/i;
const NUM_RE = '(\\d{1,3}(?:,\\d{3})+|\\d+)';

// Like get(), but resolves (never rejects) with { status, type, body } or { error }.
function getPage(url, redirects) {
  redirects = redirects || 0;
  return new Promise(resolve => {
    let req;
    try {
      req = https.get(url, { headers: { 'User-Agent': 'release-review-tool', Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1' }, timeout: 60000 }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
          res.resume();
          return resolve(getPage(new URL(res.headers.location, url).toString(), redirects + 1));
        }
        let b = '';
        res.setEncoding('utf8');
        res.on('data', c => { b += c; });
        res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), body: b }));
        res.on('error', e => resolve({ error: e.message }));
      });
    } catch (e) {
      return resolve({ error: e.message });
    }
    req.on('timeout', () => req.destroy(new Error('timeout fetching ' + url)));
    req.on('error', e => resolve({ error: e.message }));
  });
}

function normText(s) { return String(s).replace(/[`*]/g, '').replace(/\s+/g, ' '); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function sha256(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }
function readJsonOr(f, dflt) { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch (_) { return dflt; } }
function writeJsonAtomic(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, f);
}
function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent).toLowerCase(), path.resolve(child).toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Why a downloaded page cannot be judged, or null.
function pageProblem(r, prev) {
  if (!r || r.error) return 'download failed (' + ((r && r.error) || 'no response') + ')';
  if (r.status !== 200) return 'HTTP ' + r.status;
  if (!/^\s*text\/(markdown|plain)\b/i.test(r.type)) return 'not markdown (content type "' + r.type + '")';
  if (/^\s*<(?:!doctype|html)\b/i.test(r.body)) return 'an HTML page, not markdown';
  if (prev && prev.size > 0 && r.body.length < prev.size * 0.5) return 'only ' + r.body.length + ' characters, under half of the ' + prev.size + ' stored';
  return null;
}

// The distinct numbers (scaled) found as: before, optional whitespace, one number, optional whitespace, after.
function anchorMatches(normPage, a) {
  const re = new RegExp('(?<![A-Za-z0-9])' + escapeRe(normText(a.before).trim()) + '\\s*' + NUM_RE + '\\s*' +
    escapeRe(normText(a.after).trim()) + '(?![A-Za-z0-9])', 'gi');
  const nums = [];
  let firstAt = -1;
  let m;
  while ((m = re.exec(normPage))) {
    const n = Number(m[1].replace(/,/g, '')) * (a.scale || 1);
    if (!nums.includes(n)) nums.push(n);
    if (firstAt < 0) firstAt = m.index;
  }
  return { nums, firstAt };
}

function judgeAnchor(nums, current) {
  if (!nums.length) return { status: 'candidate', reason: 'not-found' };
  if (nums.length === 1 && nums[0] === current) return { status: 'unchanged' };
  if (nums.length > 1) return { status: 'candidate', reason: nums.includes(current) ? 'old-and-new' : 'several-numbers' };
  const ratio = nums[0] / current;
  if (ratio >= 0.25 && ratio <= 4) return { status: 'change', value: nums[0] };
  return { status: 'candidate', reason: 'out-of-range' };
}

// The sentence around a match in normalized page text, at most 300 characters.
function sentenceAt(normPage, at) {
  if (at < 0) return '';
  let s = normPage.lastIndexOf('. ', at);
  s = s < 0 ? 0 : s + 2;
  let e = normPage.indexOf('. ', at);
  e = e < 0 ? normPage.length : e + 1;
  return normPage.slice(Math.max(s, at - 200), Math.min(e, at + 280)).trim().slice(0, 300);
}

// [start, end) of the JSON object holding "id": "<id>" inside the limits file text.
function limitSpan(text, id) {
  const idRe = new RegExp('"id"\\s*:\\s*"' + escapeRe(id) + '"', 'g');
  const hits = text.match(idRe) || [];
  if (hits.length !== 1) throw new Error('limit "' + id + '" appears ' + hits.length + ' times in the limits file');
  const at = text.search(new RegExp('"id"\\s*:\\s*"' + escapeRe(id) + '"'));
  const start = text.lastIndexOf('{', at);
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return [start, i + 1];
  }
  throw new Error('limit "' + id + '": its object never closes');
}

// Replace one field's value inside one limit's object; the field must occur exactly once there.
function setInLimit(text, id, field, newValue) {
  const [s, e] = limitSpan(text, id);
  const obj = text.slice(s, e);
  const valueRe = typeof newValue === 'number' ? '-?\\d+(?:\\.\\d+)?' : '"(?:[^"\\\\]|\\\\.)*"';
  const re = new RegExp('("' + escapeRe(field) + '"\\s*:\\s*)' + valueRe, 'g');
  const n = (obj.match(re) || []).length;
  if (n !== 1) throw new Error('limit "' + id + '": field "' + field + '" found ' + n + ' times');
  return text.slice(0, s) + obj.replace(re, (m0, key) => key + JSON.stringify(newValue)) + text.slice(e);
}

function runSizeSweep(guidelinesFile) {
  const r = childProcess.spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CONFIG_HEALTH, '-Action', 'size-sweep', '-GuidelinesFile', guidelinesFile],
    { encoding: 'utf8', timeout: 300000, windowsHide: true });
  if (r.error) throw new Error('the size checker could not run (' + r.error.message + ')');
  let j = null;
  try { j = JSON.parse(String(r.stdout || '').replace(/^\uFEFF/, '')); } catch (_) { /* below */ }
  if (!j) throw new Error('the size checker printed no JSON');
  if (j.ok !== true) throw new Error('the size checker did not load the new limits file (' + (j.error || 'ok is not true') + ')');
  return j;
}

// Whole-number occurrences of n (with or without thousands commas) in one string.
function hasNumber(s, n) {
  const plain = String(n);
  const comma = plain.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const alts = plain === comma ? escapeRe(plain) : escapeRe(plain) + '|' + escapeRe(comma);
  return new RegExp('(?<![\\d,.])(?:' + alts + ')(?![\\d,]|\\.\\d)').test(s);
}

// Prose in the limits file that still states the old number of a changed limit.
function textToUpdate(limits, change) {
  const out = [];
  const objs = (limits.limits || []).filter(l => l.id === change.limit);
  if (change.limit === 'skill-after-compaction') objs.push(...(limits.houseRules || []).filter(h => h.id === 'gate-skill-runbook'));
  for (const o of objs) {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v !== 'string' || k === 'id' || k === 'verified' || (o.id === 'memory-md-load' && k === 'value')) continue;
      if (hasNumber(v, change.old)) out.push({ limit: o.id, field: k, old: change.old, text: v.slice(0, 300) });
    }
  }
  return out;
}

// Identifiers that hold a literal copy of a limit instead of reading the limits file (FALLBACK_* names are fine).
function strayCopies() {
  const home = os.homedir();
  const files = [];
  const listDir = (dir, ext) => { try { for (const f of fs.readdirSync(dir)) if (f.toLowerCase().endsWith(ext)) files.push(path.join(dir, f)); } catch (_) { /* missing */ } };
  const walk = (dir, ext) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const d of ents) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { if (d.name !== 'node_modules') walk(p, ext); } else if (d.name.toLowerCase().endsWith(ext)) files.push(p);
    }
  };
  listDir(path.join(home, '.claude', 'hooks'), '.js');
  listDir(path.join(home, '.claude', 'scripts'), '.ps1');
  walk(path.join(home, '.claude', 'skills'), '.ps1');
  if (fs.existsSync(UPDATE_CONFIG)) files.push(UPDATE_CONFIG);
  const re = /(?:\b(?:const|let|var)\s+|\$)([A-Za-z_][\w]*)\s*=\s*(\d+)\s*(?:[;,)]|\/\/|#|$)/;
  const hits = [];
  for (const f of files) {
    let lines = [];
    try { lines = fs.readFileSync(f, 'utf8').split(/\r?\n/); } catch (_) { continue; }
    lines.forEach((line, i) => {
      const m = re.exec(line);
      if (!m || /^FALLBACK_/i.test(m[1])) return;
      const v = Number(m[2]);
      if ((/CAP|KEEP|LIMIT|MAX_CONTEXT/i.test(m[1]) && [10000, 9500, 9000].includes(v)) || (/RULES_?LINE/i.test(m[1]) && v === 200)) {
        hits.push({ file: f, line: i + 1, name: m[1], value: v });
      }
    });
  }
  return hits;
}

async function cmdGuidelinesCheck() {
  const checkUtc = new Date().toISOString();
  const out = { ok: true, apply: process.argv.includes('--apply'), checkUtc, pages: {}, unchanged: 0, changes: [], applied: [],
    candidates: [], textToUpdate: [], changedParagraphs: [], strayCopies: [], warnings: [] };
  const warn = w => out.warnings.push(w);
  const pagesDir = arg('--pages-dir');
  const root = path.resolve(arg('--root') || path.dirname(HERE));
  const project = path.dirname(path.dirname(HERE));
  if (pagesDir && isInside(root, project)) {
    out.ok = false;
    warn('refused: --pages-dir needs --root outside ' + project + ', so test pages never touch the real files');
    process.stdout.write(JSON.stringify(out, null, 1) + '\n');
    return;
  }
  const limitsFile = path.join(root, 'anthropic-guidelines.json');
  const rr = path.join(root, 'release-review');
  const logFile = path.join(rr, 'guidelines-changes.jsonl');
  const stateFile = path.join(rr, 'guidelines-state.json');
  const docsDir = path.join(rr, 'docs');
  const prevState = readJsonOr(stateFile, null);
  const state = prevState && typeof prevState === 'object' ? JSON.parse(JSON.stringify(prevState)) : { sinceUtc: checkUtc };
  if (!state.sinceUtc) state.sinceUtc = checkUtc;
  if (!state.pages || typeof state.pages !== 'object') state.pages = {};
  state.checkUtc = checkUtc;
  if (out.apply) state.applyUtc = checkUtc;
  const addCandidate = (limit, field, page, reason, found, current, detail) => out.candidates.push({
    key: 'guidelines:' + limit + ':' + reason, limit, field, page, reason, found, current, detail: detail || null });
  try {
    const limitsText = fs.readFileSync(limitsFile, 'utf8');
    const limits = JSON.parse(limitsText.replace(/^\uFEFF/, ''));
    const watched = (limits.limits || []).filter(l => l && Array.isArray(l.anchors) && l.anchors.length);

    // 1. Pages.
    const pageRaw = {};
    const pageNorm = {};
    for (const p of GUIDELINE_PAGES) {
      let r;
      if (pagesDir) {
        const f = path.join(pagesDir, p.id + '.md');
        r = fs.existsSync(f) ? { status: 200, type: 'text/markdown; charset=utf-8', body: fs.readFileSync(f, 'utf8') } : { error: 'no test page ' + f };
        const meta = readJsonOr(path.join(pagesDir, p.id + '.meta.json'), null);
        if (meta && !r.error) Object.assign(r, meta);
      } else {
        r = await getPage(p.url);
      }
      const problem = pageProblem(r, state.pages[p.id]);
      if (problem) {
        out.pages[p.id] = { ok: false, problem };
        warn('page ' + p.id + ': ' + problem + '; its anchors were not checked');
        continue;
      }
      pageRaw[p.id] = r.body;
      pageNorm[p.id] = normText(r.body);
      out.pages[p.id] = { ok: true, size: r.body.length };
    }

    // 2. Anchors, grouped by limit and field.
    const groups = new Map();
    for (const l of watched) {
      for (const a of l.anchors) {
        const field = a.field || 'value';
        const k = l.id + '|' + field;
        if (!groups.has(k)) groups.set(k, { limit: l, field, current: l[field], items: [] });
        const item = { anchor: a, page: a.page };
        if (!GUIDELINE_PAGES.some(p => p.id === a.page)) { item.skipped = true; warn('limit ' + l.id + ': anchor on unknown page "' + a.page + '"'); }
        else if (pageNorm[a.page] === undefined) item.skipped = true;
        else Object.assign(item, anchorMatches(pageNorm[a.page], a));
        groups.get(k).items.push(item);
      }
    }
    const missingByPage = {};
    for (const g of groups.values()) for (const it of g.items) if (!it.skipped && !it.nums.length) missingByPage[it.page] = (missingByPage[it.page] || 0) + 1;
    for (const [pg, n] of Object.entries(missingByPage)) {
      if (n < 2) continue;
      out.pages[pg] = { ok: false, problem: n + ' anchors not found' };
      warn('page ' + pg + ': ' + n + ' anchors not found, so the page looks rewritten or broken; its anchors were not judged');
      for (const g of groups.values()) for (const it of g.items) if (it.page === pg) it.skipped = true;
    }
    for (const g of groups.values()) {
      const { limit, field, current } = g;
      if (!Number.isInteger(current)) { addCandidate(limit.id, field, null, 'current-not-a-number', [], current); continue; }
      const judged = g.items.filter(it => !it.skipped).map(it => Object.assign(it, judgeAnchor(it.nums, current)));
      const cands = judged.filter(it => it.status === 'candidate');
      for (const it of cands) addCandidate(limit.id, field, it.page, it.reason, it.nums, current);
      if (cands.length) continue;
      const changed = judged.filter(it => it.status === 'change');
      if (!changed.length) { out.unchanged += judged.length; continue; }
      const values = [...new Set(changed.map(it => it.value))];
      if (values.length > 1 || changed.length < judged.length) {
        addCandidate(limit.id, field, changed[0].page, 'anchors-disagree', judged.map(it => it.value || current), current);
        continue;
      }
      const skippedPages = g.items.filter(it => it.skipped).map(it => it.page);
      if (skippedPages.length) {
        warn('change for ' + limit.id + (field !== 'value' ? '.' + field : '') + ' (' + current + ' -> ' + values[0] + ') waits: page ' + skippedPages.join(', ') + ' could not be checked');
        continue;
      }
      out.changes.push({ limit: limit.id, field, old: current, new: values[0], page: changed[0].page,
        sentence: sentenceAt(pageNorm[changed[0].page], changed[0].firstAt) });
    }

    // 3. Apply (live runs) or report (plain runs).
    if (out.changes.length && !out.apply) {
      for (const c of out.changes) warn('change detected, not applied: ' + c.limit + (c.field !== 'value' ? '.' + c.field : '') + ' ' + c.old + ' -> ' + c.new + ' (' + c.page + ' page; the next live run applies it)');
    }
    if (out.changes.length && out.apply) {
      const today = checkUtc.slice(0, 10);
      const tmp = limitsFile + '.tmp-' + process.pid;
      try {
        let text = limitsText;
        const expected = JSON.parse(JSON.stringify(limits));
        for (const c of out.changes) {
          const e = expected.limits.find(x => x.id === c.limit);
          text = setInLimit(text, c.limit, c.field, c.new);
          e[c.field] = c.new;
          text = setInLimit(text, c.limit, 'verified', today);
          e.verified = today;
          if (c.limit === 'memory-md-load') {
            const disp = e.valueLines + ' lines or ' + (e.valueBytes % 1000 === 0 ? e.valueBytes / 1000 + 'KB' : e.valueBytes + ' bytes');
            text = setInLimit(text, c.limit, 'value', disp);
            e.value = disp;
          }
        }
        if (JSON.stringify(JSON.parse(text.replace(/^\uFEFF/, ''))) !== JSON.stringify(expected)) throw new Error('the edited limits file did not parse to the expected values');
        fs.writeFileSync(tmp, text, 'utf8');
        const sweep = runSizeSweep(tmp);
        for (const c of out.changes) {
          c.overLimit = (sweep.findings || []).filter(f => f && f.limitId === c.limit && f.severity === 'breach').map(f => f.file);
          out.textToUpdate.push(...textToUpdate(expected, c));
        }
        const rows = out.changes.map(c => ({ changeId: crypto.randomBytes(6).toString('hex'), limit: c.limit, field: c.field, old: c.old, new: c.new,
          page: c.page, sentence: c.sentence, date: today, ts: checkUtc, status: 'applied', overLimit: c.overLimit }));
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        fs.appendFileSync(logFile, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
        try {
          fs.renameSync(tmp, limitsFile);
        } catch (e) {
          fs.appendFileSync(logFile, rows.map(r => JSON.stringify({ changeId: r.changeId, status: 'not-applied', ts: checkUtc, reason: e.message })).join('\n') + '\n', 'utf8');
          throw new Error('the new limits file could not replace the old one (' + e.message + ')');
        }
        out.applied = rows;
      } catch (e) {
        try { fs.unlinkSync(tmp); } catch (_) { /* gone */ }
        for (const c of out.changes) addCandidate(c.limit, c.field, c.page, 'apply-failed', [c.new], c.old, e.message);
        warn('apply failed, nothing changed: ' + e.message);
      }
    }

    // 4. Page copies: changed paragraphs against the saved copy; live runs save the new copy and its hash.
    const paras = s => s.split(/\r?\n\s*\r?\n/).map(x => normText(x).trim()).filter(Boolean);
    for (const [id, body] of Object.entries(pageRaw)) {
      const copy = path.join(docsDir, id + '.md');
      let old = null;
      try { old = fs.readFileSync(copy, 'utf8'); } catch (_) { /* first run: baseline */ }
      if (old !== null && normText(old) !== normText(body)) {
        const oldSet = new Set(paras(old));
        const added = paras(body).filter(x => !oldSet.has(x));
        const relevant = added.filter(x => LIMIT_WORD_RE.test(x));
        out.changedParagraphs.push({ page: id, shown: relevant.slice(0, 10).map(x => x.slice(0, 600)), notShown: added.length - Math.min(relevant.length, 10) });
      }
      if (out.apply) {
        const h = sha256(body);
        if (old === null || sha256(old) !== h) {
          fs.mkdirSync(docsDir, { recursive: true });
          fs.writeFileSync(copy, body, 'utf8');
        }
        state.pages[id] = { sha256: h, size: body.length };
      }
    }

    // 5. Stray copies of a limit in our hooks and scripts.
    out.strayCopies = strayCopies();
    for (const s of out.strayCopies) warn('stray copy of a limit: ' + s.file + ':' + s.line + ' ' + s.name + ' = ' + s.value + ' (read the limits file, or name it FALLBACK_*)');
  } catch (e) {
    out.ok = false;
    warn('guidelines check failed: ' + ((e && e.message) || e));
  }
  state.warnings = out.warnings.slice();
  try { writeJsonAtomic(stateFile, state); } catch (e) { out.ok = false; out.warnings.push('could not write ' + stateFile + ' (' + e.message + ')'); }
  process.stdout.write(JSON.stringify(out, null, 1) + '\n');
}

// Failure-only lines about the guidelines watch for the /wrap readout (GEN-892).
function guidelinesReadoutLines(now, live) {
  const lines = [];
  const gs = readJsonOr(path.join(HERE, 'guidelines-state.json'), null);
  if (gs && Array.isArray(gs.warnings)) for (const w of gs.warnings) lines.push('⚠ Guidelines watch: ' + w);
  const last = live.length ? live[live.length - 1] : null;
  const lastOk = last && last.outcome === 'ok' && (now - Date.parse(last.ts)) <= ALERT_DAYS * 86400000;
  if (!lastOk) return lines; // a stalled or failed release review has its own alarm above
  const since = Date.parse(GUIDELINES_SINCE_UTC);
  let baseMs = NaN;
  if (gs && gs.applyUtc) baseMs = Date.parse(gs.applyUtc);
  else if (gs && gs.sinceUtc) baseMs = Date.parse(gs.sinceUtc);
  else if (live.some(r => Date.parse(r.ts) > since)) baseMs = since;
  if (!isNaN(baseMs) && now - baseMs > ALERT_DAYS * 86400000) {
    lines.push('⚠ Guidelines watch: no live check of Anthropic\'s size limits in ' + Math.floor((now - baseMs) / 86400000) + ' days' +
      (gs && gs.applyUtc ? ' (last ' + gs.applyUtc.slice(0, 10) + ')' : ' (never)') +
      ' while release reviews are running: check that the weekly run still runs guidelines-check --apply (release-review guidelines-watch.md).');
  }
  return lines;
}

const cmd = process.argv[2];
const table = { collect: cmdCollect, verify: cmdVerify, installed: cmdInstalled, readout: cmdReadout, pending: cmdPending, 'record-run': cmdRecordRun, 'guidelines-check': cmdGuidelinesCheck };
if (!table[cmd]) die('usage: release-review-tool.js collect|verify|installed|readout|pending|record-run|guidelines-check ...');
Promise.resolve().then(table[cmd]).catch(e => die(cmd + ' failed: ' + (e && e.message ? e.message : e), 1));
