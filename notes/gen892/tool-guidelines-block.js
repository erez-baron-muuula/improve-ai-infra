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
const LIMIT_WORD_RE = /\b(lines?|characters?|tokens?|KB|limits?|caps?|capped|truncat\w*)\b|CLAUDE\.md|SKILL\.md|MEMORY\.md|\bskills?\b|\bcommands?\b|\bhooks?\b|\b(sub-?)?agents?\b/i;
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
          let next;
          try { next = new URL(res.headers.location, url).toString(); } catch (e) { return resolve({ error: 'bad redirect (' + e.message + ')' }); }
          return resolve(getPage(next, redirects + 1));
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
// Same file on disk (device and inode), whatever the spelling; false when either cannot be read.
function sameFile(a, b) {
  try {
    const x = fs.statSync(a, { bigint: true });
    const y = fs.statSync(b, { bigint: true });
    return x.ino === y.ino && x.dev === y.dev;
  } catch (_) {
    return false;
  }
}
// Both sides through realpath (8.3 names, junctions); a path that does not exist yet keeps its resolved form.
// sameFile above also catches spellings realpath keeps apart (an admin-share path to the same disk).
function isInside(child, parent) {
  const real = p => { try { return fs.realpathSync.native(path.resolve(p)); } catch (_) { return path.resolve(p); } };
  const rel = path.relative(real(parent).toLowerCase(), real(child).toLowerCase());
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
    { encoding: 'utf8', timeout: 300000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
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
  const list = a => (Array.isArray(a) ? a : []);
  const objs = list(limits.limits).filter(l => l && l.id === change.limit);
  if (change.limit === 'skill-after-compaction') objs.push(...list(limits.houseRules).filter(h => h && h.id === 'gate-skill-runbook'));
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
  // A name assigned a literal number: `const|let|var NAME =`, `$Name =` (optionally `[int]$Name =`), or an
  // object property `NAME:`; digits may use `_` separators.
  const re = /(?:\b(?:const|let|var)\s+|(?:\[\w+\])?\$|[{,]\s*)?\b([A-Za-z_][\w]*)\s*(?:=(?!=)|:)\s*(\d[\d_]*)\s*(?:[;,)}]|\/\/|#|$)/;
  const hits = [];
  for (const f of files) {
    let lines = [];
    try { lines = fs.readFileSync(f, 'utf8').split(/\r?\n/); } catch (_) { continue; }
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|#|\*|\/\*)/.test(line)) return; // a comment line is not an assignment
      const m = re.exec(line);
      if (!m || /^FALLBACK_/i.test(m[1])) return;
      const v = Number(m[2].replace(/_/g, ''));
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
  const refuse = why => {
    out.ok = false;
    warn('refused: ' + why);
    process.stdout.write(JSON.stringify(out, null, 1) + '\n');
  };
  // A flag given without its value (or followed by another flag) is refused, never read as a path.
  for (const f of ['--pages-dir', '--root']) {
    const v = arg(f);
    if (process.argv.includes(f) && (!v || v.startsWith('--'))) return refuse(f + ' needs a folder after it');
  }
  const pagesDir = arg('--pages-dir');
  const root = path.resolve(arg('--root') || path.dirname(HERE));
  const project = path.dirname(path.dirname(HERE));
  if (pagesDir && (isInside(root, project) || sameFile(path.join(root, 'anthropic-guidelines.json'), path.join(path.dirname(HERE), 'anthropic-guidelines.json')))) {
    return refuse('--pages-dir needs --root outside ' + project + ', so test pages never touch the real files');
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
      let appliedExpected = null;
      const today = checkUtc.slice(0, 10);
      const tmp = limitsFile + '.tmp-' + process.pid;
      try {
        let text = limitsText;
        const expected = JSON.parse(JSON.stringify(limits));
        for (const c of out.changes) {
          const e = expected.limits.find(x => x && x.id === c.limit);
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
        }
        const rows = out.changes.map(c => ({ changeId: crypto.randomBytes(6).toString('hex'), limit: c.limit, field: c.field, old: c.old, new: c.new,
          page: c.page, sentence: c.sentence, date: today, ts: checkUtc, status: 'applied', overLimit: c.overLimit }));
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        // Start on a new line even if the log was hand-edited without a final newline.
        const appendRows = list => {
          let lead = '';
          try { const cur = fs.readFileSync(logFile, 'utf8'); if (cur.length && !cur.endsWith('\n')) lead = '\n'; } catch (_) { /* new log */ }
          fs.appendFileSync(logFile, lead + list.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
        };
        appendRows(rows);
        try {
          // Another session may have edited the limits file during the downloads and the size sweep.
          if (fs.readFileSync(limitsFile, 'utf8') !== limitsText) throw new Error('the limits file changed during this run');
          fs.renameSync(tmp, limitsFile);
        } catch (e) {
          appendRows(rows.map(r => ({ changeId: r.changeId, status: 'not-applied', ts: checkUtc, reason: e.message })));
          throw new Error('the new limits file did not replace the old one (' + e.message + ')');
        }
        out.applied = rows;
        appliedExpected = expected;
      } catch (e) {
        try { fs.unlinkSync(tmp); } catch (_) { /* gone */ }
        for (const c of out.changes) addCandidate(c.limit, c.field, c.page, 'apply-failed', [c.new], c.old, e.message);
        warn('apply failed, nothing changed: ' + e.message);
      }
      // After the apply's own try, so a problem here can never report an applied change as failed.
      if (appliedExpected) {
        try {
          for (const c of out.changes) out.textToUpdate.push(...textToUpdate(appliedExpected, c));
        } catch (e) {
          warn('could not list the text to update: ' + e.message);
        }
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
  try {
    return guidelinesReadoutLinesUnsafe(now, live);
  } catch (e) {
    return ['⚠ Guidelines watch: readout failed (' + ((e && e.message) || e) + ')'];
  }
}
function guidelinesReadoutLinesUnsafe(now, live) {
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

