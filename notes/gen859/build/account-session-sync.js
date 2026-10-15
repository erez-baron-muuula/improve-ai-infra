// SessionStart + Stop hook -- GEN-859: keep the Claude desktop app's per-account session lists in sync.
//
// The desktop app (Code tab) keeps one sidebar list per signed-in account, as one file per session:
//   %APPDATA%\Claude\claude-code-sessions\<accountUuid>\<orgUuid>\local_<uuid>.json
// The conversations themselves are shared (~/.claude/projects), so copying a list entry into the other
// account's folder makes the session appear there at its next sign-in (verified 2026-10-15, GEN-859 Phase 0).
//
// RULE ZERO: only the signed-OUT account's folder is ever written. The signed-in account is read from
// %APPDATA%\Claude\config.json (lastKnownAccountUuid) and re-read before every write; if it changes
// mid-run (Erez switched accounts) the run stops at once.
//
// Each run, for the signed-in account (source) -> the other account (destination), per shared org folder:
//   1. Deletions: every source deleted_<uuid> marker (content = delete time T, epoch ms) is made true in the
//      destination -- its local_<uuid>.json moved to the sync's trash and the marker present -- unless the
//      destination entry is newer than T (revived there). State-based, so an interrupted run finishes later.
//      At most MAX_REMOVALS removals per run; more than that is refused and reported.
//   2. Copies: a source entry missing in the destination is copied if its conversation file exists; an entry
//      present in both is copied when the source file is newer. A destination marker older than the source
//      entry means the session was revived in the source: the marker goes to the trash and the entry is copied.
//      Phone link (bridgeSessionIds) is account-specific: a new copy carries none, an update keeps the
//      destination's own. Write = temp file + validate + mtime set to the source's + rename.
//
// NEVER SILENT: problems go to ~/.claude/backup-sweep-failures.jsonl (kind 'account-sync-error'), which
// sessionstart-backup-surfacer.js shows at the next session start, de-duplicated to once per 24 h per
// problem. The surfacer also warns when ~/.claude/account-session-sync/last-success falls 24 h behind the
// newest list change, and when the off switch (~/.claude/account-session-sync/disabled) is set.
//
// APP-LOAD CHECK: each run records how many entries it left in the signed-out account's list; at the next
// session start in that account, the app's own log line "Loaded N persisted sessions from <list>" must account
// for them, else an app update may have stopped accepting copied entries -- reported like any other problem.
//
// FAILS OPEN: never blocks or prints to stdout; always exits 0. Budget: 3 s at SessionStart, 8 s at Stop,
// `--budget <seconds>` for a manual catch-up run (`node account-session-sync.js --budget 600 < payload`).
// A run that hits its budget is "incomplete" and does not stamp last-success.

const fs = require('fs');
const os = require('os');
const path = require('path');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`);
const LOCAL_RE = new RegExp(`^local_(${UUID})\\.json$`);
const MARKER_RE = new RegExp(`^deleted_(${UUID})$`);
const CLI_HEAD_RE = new RegExp(`"cliSessionId"\\s*:\\s*"(${UUID})"`);
const CONFIG_RE = new RegExp(`"lastKnownAccountUuid"\\s*:\\s*"(${UUID})"`);
const TMP_RE = /^\..*\.sync\.tmp$/;

const TOLERANCE_MS = 2000;
const MAX_REMOVALS = 10;
const LOCK_STALE_MS = 2 * 60 * 1000;
const TMP_ORPHAN_MS = 10 * 60 * 1000;
const TRASH_KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const REPORT_EVERY_MS = 24 * 60 * 60 * 1000;
const HEAD_BYTES = 4096;
const RECENT_MIN_MS = 10 * 60 * 1000;        // a brand-new session may not have its conversation file yet
const RECENT_MAX_MS = 24 * 60 * 60 * 1000;
const LOG_ROTATE_BYTES = 2 * 1024 * 1024;
const SENT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const BUDGET_MS = { SessionStart: 3000, Stop: 8000, manual: 600000 };

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const STATE_DIR = path.join(CLAUDE_DIR, 'account-session-sync');
const QUEUE_FILE = path.join(CLAUDE_DIR, 'backup-sweep-failures.jsonl');
const APP_DIR = path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Claude');
const SESSIONS_ROOT = path.join(APP_DIR, 'claude-code-sessions');
const CONFIG_FILE = path.join(APP_DIR, 'config.json');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const APP_LOG_DIR = path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'Claude', 'Logs');
const APP_LOGS_NEWEST_FIRST = ['main.log', 'main1.log', 'main2.log'];
const LOADED_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) \[info\] Loaded (\d+) persisted sessions from (.+?)(?: \((\d+) archived deferred[^)]*\))?\s*$/;
const LOG_TIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) /;
const APP_VERSION_RE = /appVersion: '([0-9.]+)'/g;
const LOAD_GAP_ALLOWED = 2;
const LOAD_LOG_GRACE_MS = 2 * 60 * 1000;
const LOAD_READ_RETRY_MS = 3 * 24 * 60 * 60 * 1000; // a log unreadable for longer than this is reported

const pause = new Int32Array(new SharedArrayBuffer(4));
function sleep(ms) { Atomics.wait(pause, 0, 0, ms); }

function stderr(msg) {
  try { process.stderr.write(`account-session-sync: ${msg}\n`); } catch (e) { /* nothing more to do */ }
}

class SwitchedAccount extends Error {}

// ---- state files ----------------------------------------------------------------------------------------

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function appendLog(rec) {
  try {
    fs.appendFileSync(path.join(STATE_DIR, 'changes.log'), JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n', 'utf8');
  } catch (e) {
    stderr(`could not write changes.log (${e && e.message})`);
  }
}

// One record per problem key per REPORT_EVERY_MS, in the shared failure queue (same shape and retry as
// sessionstart-session-backup.js). The queue is shared with background writers: retry ~5 s.
function report(ctx, key, detail) {
  const reported = readJson(path.join(STATE_DIR, 'reported.json'), {}) || {};
  reported.sent = reported.sent || {};
  const last = Number(reported.sent[key]) || 0;
  const now = Date.now();
  // A repeat inside the de-dup window is not re-reported and does not hold back last-success (it would
  // only add a second, stale-sync alert for a cause Erez was already told about) -- except in a manual run,
  // whose operator must see every problem in its printed result.
  if (last && now - last >= 0 && now - last < REPORT_EVERY_MS) {
    if (ctx.event === 'manual') ctx.problems.push(key);
    return;
  }
  ctx.problems.push(key);
  const rec = JSON.stringify({
    ts: new Date(now).toISOString(),
    machine: os.hostname(),
    session: ctx.sessionId,
    repo: '(account session sync)',
    kind: 'account-sync-error',
    detail: String(detail).slice(0, 600),
    surfaced: false
  }) + '\n';
  for (let attempt = 1; ; attempt++) {
    try {
      fs.appendFileSync(QUEUE_FILE, rec, 'utf8');
      break;
    } catch (e) {
      if (attempt >= 50) { stderr(`could not write failure record (${e && e.message}): ${detail}`); return; }
      sleep(100);
    }
  }
  reported.sent[key] = now;
  try { writeAtomic(path.join(STATE_DIR, 'reported.json'), JSON.stringify(reported)); } catch (e) { stderr(`could not save reported.json (${e && e.message})`); }
}

// ---- account detection ----------------------------------------------------------------------------------

function readActiveAccount() {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const m = CONFIG_RE.exec(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (m) return m[1];
    } catch (e) { /* retried below */ }
    if (attempt === 1) sleep(200);
  }
  return null;
}

function guard(ctx) {
  const now = readActiveAccount();
  if (now === null) throw new SwitchedAccount('config-unreadable');
  if (now !== ctx.active) throw new SwitchedAccount('account-switched');
}

// cliSessionId per entry file, cached by path + mtime in head-cache.json so a turn-end run opens only the
// files that changed since the last run (instead of every entry's head).
let headCache = null;
let headCacheDirty = false;
function headCliId(file, st) {
  if (headCache === null) headCache = readJson(path.join(STATE_DIR, 'head-cache.json'), {}) || {};
  const stat = st || statOrNull(file);
  const hit = headCache[file];
  if (stat && hit && hit.m === stat.mtimeMs) return hit.c;
  let fd;
  let cli = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    const m = CLI_HEAD_RE.exec(buf.toString('utf8', 0, n));
    cli = m ? m[1] : null;
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* ignore */ }
  }
  if (stat) { headCache[file] = { m: stat.mtimeMs, c: cli }; headCacheDirty = true; }
  return cli;
}

function saveHeadCache() {
  if (!headCacheDirty || headCache === null) return;
  for (const f of Object.keys(headCache)) if (!fs.existsSync(f)) delete headCache[f]; // forget removed entries
  try { writeAtomic(path.join(STATE_DIR, 'head-cache.json'), JSON.stringify(headCache)); } catch (e) { stderr(`could not save head cache (${e && e.message})`); }
}

function folderFindCli(dir, cliId) {
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return null; }
  for (const n of names) if (LOCAL_RE.test(n) && headCliId(path.join(dir, n)) === cliId) return n;
  return null;
}

// ---- filesystem helpers ---------------------------------------------------------------------------------

function statOrNull(file) {
  try { return fs.statSync(file); } catch (e) { return null; }
}

function withRetry(fn) {
  for (let attempt = 1; ; attempt++) {
    try { return fn(); } catch (e) {
      if (attempt >= 4 || !(e && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES'))) throw e;
      sleep(200);
    }
  }
}

function markerTime(file, st) {
  try {
    const n = Number(String(fs.readFileSync(file, 'utf8')).trim());
    if (Number.isFinite(n) && n > 0) return n;
  } catch (e) { /* fall back to mtime */ }
  return st ? st.mtimeMs : 0;
}

function trashPath(ctx, name) {
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(STATE_DIR, 'trash', day);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${ctx.other.slice(0, 8)}-${Date.now()}-${name}`);
}

function moveToTrash(ctx, file, name) {
  guard(ctx);
  const dest = trashPath(ctx, name);
  try {
    withRetry(() => fs.renameSync(file, dest));
  } catch (e) {
    if (e && e.code === 'ENOENT') return false;
    if (e && e.code === 'EXDEV') { // different volume: copy then delete
      fs.copyFileSync(file, dest);
      withRetry(() => fs.unlinkSync(file));
    } else {
      throw e;
    }
  }
  ctx.lastWriteTs = Date.now();
  appendLog({ action: 'trash', file, to: dest });
  return true;
}

function parseWithRetry(file) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (attempt === 1) sleep(300); }
  }
  return undefined;
}

let transcriptNames = null;
function transcriptExists(cliId) {
  if (transcriptNames === null) {
    transcriptNames = new Set();
    let dirs = [];
    try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }); } catch (e) { /* none */ }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      let files = [];
      try { files = fs.readdirSync(path.join(PROJECTS_DIR, d.name)); } catch (e) { continue; }
      for (const f of files) if (f.endsWith('.jsonl')) transcriptNames.add(f.toLowerCase());
    }
  }
  return transcriptNames.has(`${cliId}.jsonl`);
}

// ---- the sync ---------------------------------------------------------------------------------------------

function cleanOrphanTmps(dir, now) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return; }
  for (const n of names) {
    if (!TMP_RE.test(n)) continue;
    const st = statOrNull(path.join(dir, n));
    if (st && now - st.mtimeMs > TMP_ORPHAN_MS) try { fs.unlinkSync(path.join(dir, n)); } catch (e) { /* next run */ }
  }
}

function pruneTrash(now) {
  const root = path.join(STATE_DIR, 'trash');
  let days = [];
  try { days = fs.readdirSync(root); } catch (e) { return; }
  for (const d of days) {
    const t = Date.parse(`${d}T00:00:00Z`);
    if (Number.isFinite(t) && now - t > TRASH_KEEP_MS) try { fs.rmSync(path.join(root, d), { recursive: true, force: true }); } catch (e) { /* next run */ }
  }
}

function syncDeletions(ctx, srcDir, dstDir, srcNames) {
  const plan = [];
  for (const n of srcNames) {
    const m = MARKER_RE.exec(n);
    if (!m) continue;
    const id = m[1];
    const srcMarker = path.join(srcDir, n);
    const T = markerTime(srcMarker, statOrNull(srcMarker));
    const dstLocal = path.join(dstDir, `local_${id}.json`);
    const dstMarker = path.join(dstDir, n);
    const dl = statOrNull(dstLocal);
    if (dl && dl.mtimeMs > T + TOLERANCE_MS) continue; // revived/updated in the destination after the delete
    plan.push({ id, T, dstLocal: dl ? dstLocal : null, dstMarker, markerMissing: !statOrNull(dstMarker) });
  }
  const removals = plan.filter(p => p.dstLocal).length;
  if (removals > ctx.maxRemovals) {
    report(ctx, `deletion-cap:${ctx.other}`, `a single sync would remove ${removals} sessions from the other account's list (limit ${ctx.maxRemovals}); nothing was removed. If those deletions are intended, run it once by hand: node "${__filename}" --max-removals ${removals} (with an empty JSON object on stdin; it prints its result).`);
    return;
  }
  for (const p of plan) {
    perEntry(ctx, `deletion of ${p.id}`, () => {
      if (p.dstLocal && moveToTrash(ctx, p.dstLocal, `local_${p.id}.json`)) ctx.counts.removed++;
      if (p.markerMissing) {
        guard(ctx);
        try {
          fs.writeFileSync(p.dstMarker, String(p.T), { encoding: 'utf8', flag: 'wx' });
          ctx.lastWriteTs = Date.now();
          appendLog({ action: 'marker', dst: p.dstMarker });
          ctx.counts.markers++;
        } catch (e) {
          if (!(e && e.code === 'EEXIST')) throw e;
        }
      }
    });
  }
}

function copyEntry(ctx, srcFile, srcStat, dstDir, name, isNew) {
  const obj = parseWithRetry(srcFile);
  if (obj === undefined || obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    ctx.parseFails[srcFile] = (ctx.prevParseFails[srcFile] || 0) + 1;
    if (ctx.parseFails[srcFile] >= 2) report(ctx, `parse:${srcFile}`, `a session-list entry could not be read on two runs in a row, so it is not being copied to the other account: ${srcFile}`);
    return;
  }
  const dstFile = path.join(dstDir, name);
  if (isNew) {
    delete obj.bridgeSessionIds;
  } else {
    // The destination's own phone links must survive an update: if its file can't be read right now,
    // leave it alone and retry next run rather than overwrite it without them.
    const dstObj = parseWithRetry(dstFile);
    if (!dstObj || typeof dstObj !== 'object' || Array.isArray(dstObj)) throw new Error(`could not read the other account's copy (${dstFile})`);
    if (Object.prototype.hasOwnProperty.call(dstObj, 'bridgeSessionIds')) obj.bridgeSessionIds = dstObj.bridgeSessionIds;
    else delete obj.bridgeSessionIds;
  }
  const text = JSON.stringify(obj);
  const tmp = path.join(dstDir, `.${name}.${process.pid}.sync.tmp`);
  guard(ctx);
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    JSON.parse(fs.readFileSync(tmp, 'utf8'));
    fs.utimesSync(tmp, srcStat.atime, srcStat.mtime);
    guard(ctx);
    withRetry(() => fs.renameSync(tmp, dstFile));
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* orphan cleanup catches it */ }
    throw e;
  }
  ctx.lastWriteTs = Date.now();
  appendLog({ action: isNew ? 'copy' : 'update', src: srcFile, dst: dstFile });
  if (isNew) ctx.counts.copied++; else ctx.counts.updated++;
}

// One entry's failure (a locked file, say) is skipped so it cannot stall every later entry, and collected;
// the run reports all of them as ONE record (no queue flood if a whole folder goes bad). An account switch
// still stops the whole run.
function perEntry(ctx, what, fn) {
  try {
    fn();
  } catch (e) {
    if (e instanceof SwitchedAccount) throw e;
    ctx.entryFailures.push(`${what}: ${(e && e.code) || ''} ${(e && e.message) || e}`.slice(0, 200));
  }
}

// "Recently used" by the entry's own lastActivityAt (the app re-saves some old entries when it loads a list,
// which bumps the file date without any use); the file date is only the fallback.
const ACTIVITY_HEAD_RE = /"lastActivityAt"\s*:\s*(\d{12,14})/;
function isRecent(file, st) {
  let t = st.mtimeMs;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    const m = ACTIVITY_HEAD_RE.exec(buf.toString('utf8', 0, n));
    if (m) t = Number(m[1]);
  } catch (e) {
    /* fall back to the file date */
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* ignore */ }
  }
  const age = Date.now() - t;
  return age > RECENT_MIN_MS && age < RECENT_MAX_MS;
}

function syncEntries(ctx, srcDir, dstDir, srcNames) {
  // Newest first, so a run that hits its budget has synced the sessions most likely to matter.
  const entries = [];
  for (const name of srcNames) {
    const m = LOCAL_RE.exec(name);
    if (!m) continue;
    const st = statOrNull(path.join(srcDir, name));
    if (st) entries.push({ name, id: m[1], st });
  }
  entries.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  for (const { name, id, st: srcStat } of entries) {
    if (Date.now() > ctx.deadline) { ctx.incomplete = true; return; }
    const srcFile = path.join(srcDir, name);
    ctx.seenEntries++;
    ctx.attempted.add(srcFile);
    perEntry(ctx, name, () => {
      const dstMarker = path.join(dstDir, `deleted_${id}`);
      const dmStat = statOrNull(dstMarker);
      if (dmStat && srcStat.mtimeMs <= markerTime(dstMarker, dmStat) + TOLERANCE_MS) return; // deleted there later
      const dstStat = statOrNull(path.join(dstDir, name));
      if (!dstStat) {
        const cli = headCliId(srcFile, srcStat);
        if (!cli || !transcriptExists(cli)) {
          ctx.counts.dead++;
          // A session in use recently that cannot be copied means an assumption broke (id format, transcript
          // location): report it instead of skipping it like an old, already-broken entry.
          if (srcStat.mtimeMs > Date.now() - RECENT_MAX_MS && isRecent(srcFile, srcStat)) ctx.liveUncopyable.push(name);
          return;
        }
        if (dmStat) moveToTrash(ctx, dstMarker, `deleted_${id}`); // revived in the source after the delete
        copyEntry(ctx, srcFile, srcStat, dstDir, name, true);
      } else if (srcStat.mtimeMs > dstStat.mtimeMs + TOLERANCE_MS) {
        if (dmStat) moveToTrash(ctx, dstMarker, `deleted_${id}`);
        copyEntry(ctx, srcFile, srcStat, dstDir, name, false);
      }
    });
  }
}

function run(ctx) {
  if (fs.existsSync(path.join(STATE_DIR, 'disabled'))) return 'disabled';
  let accounts;
  try {
    accounts = fs.readdirSync(SESSIONS_ROOT, { withFileTypes: true }).filter(d => d.isDirectory() && UUID_RE.test(d.name)).map(d => d.name);
  } catch (e) {
    report(ctx, 'no-sessions-root', `the desktop app folder exists but its session lists could not be read (${e && e.message})`);
    return 'problem';
  }
  if (accounts.length !== 2) {
    report(ctx, `account-count:${accounts.length}`, `expected exactly 2 accounts' session lists, found ${accounts.length}; nothing was synced`);
    return 'problem';
  }
  ctx.active = readActiveAccount();
  if (!ctx.active || !accounts.includes(ctx.active)) {
    report(ctx, 'active-unknown', `could not tell which account is signed in (config value ${ctx.active || 'missing'}); nothing was synced`);
    return 'problem';
  }
  ctx.other = accounts.find(a => a !== ctx.active);
  const activeRoot = path.join(SESSIONS_ROOT, ctx.active);
  const otherRoot = path.join(SESSIONS_ROOT, ctx.other);
  const orgs = fs.readdirSync(activeRoot, { withFileTypes: true })
    .filter(d => d.isDirectory() && UUID_RE.test(d.name) && fs.existsSync(path.join(otherRoot, d.name)))
    .map(d => d.name);
  if (orgs.length === 0) {
    report(ctx, 'no-shared-org', 'the two accounts share no organisation folder; nothing was synced');
    return 'problem';
  }

  // Cross-check the config signal against this session's own entry (payload session_id = cliSessionId):
  // listed only under the other account, or its copy there is NEWER than here (the sync never makes a
  // destination newer than its source, so only the app writing there does) -> the other account is live.
  ctx.crossCheck = 'no-session-id';
  if (ctx.sessionId && UUID_RE.test(ctx.sessionId)) {
    ctx.crossCheck = 'not-found';
    for (const org of orgs) {
      const name = folderFindCli(path.join(activeRoot, org), ctx.sessionId);
      if (!name) continue;
      ctx.crossCheck = 'active';
      const here = statOrNull(path.join(activeRoot, org, name));
      const there = statOrNull(path.join(otherRoot, org, name));
      if (here && there && there.mtimeMs > here.mtimeMs + TOLERANCE_MS) ctx.crossCheck = 'other-newer';
      break;
    }
    if (ctx.crossCheck === 'not-found') {
      for (const org of orgs) {
        if (folderFindCli(path.join(otherRoot, org), ctx.sessionId)) { ctx.crossCheck = 'other'; break; }
      }
    }
    if (ctx.crossCheck === 'other' || ctx.crossCheck === 'other-newer') {
      report(ctx, 'crosscheck', `the app says ${ctx.active} is signed in, but this session's entry under ${ctx.other} is ${ctx.crossCheck === 'other' ? 'the only one' : 'newer'}; nothing was synced`);
      return 'problem';
    }
  }

  const now = Date.now();
  ctx.orgs = orgs;
  if (ctx.event === 'SessionStart' || ctx.event === 'manual') pruneTrash(now);
  ctx.reachedSync = true;
  for (const org of orgs) {
    const srcDir = path.join(activeRoot, org);
    const dstDir = path.join(otherRoot, org);
    cleanOrphanTmps(dstDir, now); // leftovers in the signed-in folder are cleaned once it is signed out
    const srcNames = fs.readdirSync(srcDir);
    // Tripwire: an app update that renames or reshapes the files must not look like "nothing to do".
    const locals = srcNames.filter(n => LOCAL_RE.test(n));
    const withId = locals.filter(n => headCliId(path.join(srcDir, n)) !== null).length;
    if ((srcNames.length > 20 && locals.length === 0) || (locals.length > 20 && withId * 2 < locals.length)) {
      report(ctx, `tripwire:${org}`, `the signed-in account's list (${srcDir}) has ${srcNames.length} files, ${locals.length} named local_<id>.json, ${withId} with a readable session id; the app may have changed its format. Nothing was synced.`);
      return 'problem';
    }
    syncDeletions(ctx, srcDir, dstDir, srcNames);
    syncEntries(ctx, srcDir, dstDir, srcNames);
    if (ctx.incomplete) break;
  }
  // After the sync (its log reads must not eat the sync's own start-up budget); once per switch.
  if (ctx.event === 'SessionStart' || ctx.event === 'manual') {
    try { checkAppLoad(ctx); } catch (e) { report(ctx, 'load-check-error', `the check that the app still loads copied sessions failed (${(e && e.message) || e})`); }
  }
  if (ctx.entryFailures.length) {
    report(ctx, 'entry-failures', `${ctx.entryFailures.length} session(s) could not be synced this run and are retried at the next message; first: ${ctx.entryFailures.slice(0, 3).join(' | ')}`);
  }
  if (ctx.liveUncopyable.length) {
    report(ctx, 'live-uncopyable', `${ctx.liveUncopyable.length} recently used session(s) could not be copied to the other account because their session id or conversation file was not found (either they were opened and never used, or the app changed how it stores sessions); first: ${ctx.liveUncopyable.slice(0, 3).join(', ')}`);
  }
  if (ctx.incomplete) return 'incomplete';
  return ctx.problems.length ? 'problem' : 'complete';
}

// The lock records the holder's own deadline, so a long manual catch-up is not mistaken for a dead run;
// it counts as stale only LOCK_STALE_MS after the holder's deadline (a crashed or killed run).
// ---- app-load check (Erez, 2026-10-15: catch an app update that stops accepting copied entries) ----------
//
// Nothing but this hook writes a signed-out account's folder, so the number of entries it leaves there is
// exactly what the app should load at the next sign-in. Each run records that number (dest-counts.json);
// at the next SessionStart in that account, the app's own log line "Loaded N persisted sessions from <folder>
// (K archived deferred …)" is compared with it. Fewer loaded than recorded (beyond LOAD_GAP_ALLOWED), or no
// such line at all, is reported: the app may have changed how it loads its lists.

function logLineTime(m) {
  // Log times are local wall-clock time with no offset.
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

function recordDestCounts(ctx) {
  if (!ctx.other || !ctx.orgs || !ctx.orgs.length) return;
  // If the destination has just become the signed-in account (Erez switched during the run), the app may
  // already have loaded it: a snapshot now would post-date that load and later read as "load not logged".
  const file = path.join(STATE_DIR, 'dest-counts.json');
  if (readActiveAccount() !== ctx.active) {
    // No snapshot -- but if this run already changed that list, the previous snapshot is wrong now:
    // drop it, so the next switch is not checked at all rather than checked against a stale count.
    if (ctx.lastWriteTs) {
      try {
        const counts = readJson(file, {}) || {};
        for (const org of ctx.orgs) delete counts[`${ctx.other}\\${org}`];
        writeAtomic(file, JSON.stringify(counts));
      } catch (e) { stderr(`could not drop a stale destination count (${e && e.message})`); }
    }
    return;
  }
  try {
    const counts = readJson(file, {}) || {};
    for (const org of ctx.orgs) {
      let names = [];
      try { names = fs.readdirSync(path.join(SESSIONS_ROOT, ctx.other, org)); } catch (e) { continue; }
      counts[`${ctx.other}\\${org}`] = { count: names.filter(n => LOCAL_RE.test(n)).length, ts: ctx.lastWriteTs || ctx.runStart };
    }
    writeAtomic(file, JSON.stringify(counts));
  } catch (e) { stderr(`could not record destination counts (${e && e.message})`); }
}

// The first "Loaded … from <folder>" line after `since`, searching the app's rotated logs newest-file-first
// and stopping once a file starts before `since`. Returns { found, loaded, at, version, rotated, readError }:
// rotated=true only when real, readable, correctly-timestamped logs exist but all start after `since` (the
// switch's line was rotated away: nothing can be concluded). Missing logs or unrecognised timestamps are NOT
// "rotated" -- that is the kind of app change this check exists to catch, so it reads as not found.
function findLoadAfter(folder, since) {
  const want = folder.toLowerCase();
  let best = null;
  let version = null;
  let covered = false;
  let readError = false;
  let filesRead = 0;
  let allTimestamped = true;
  let oldestFirst = null;
  for (const name of APP_LOGS_NEWEST_FIRST) {
    let text;
    try {
      text = fs.readFileSync(path.join(APP_LOG_DIR, name), 'utf8');
    } catch (e) {
      if (!(e && e.code === 'ENOENT')) readError = true; // a locked/unreadable log: conclude nothing this time
      continue;
    }
    if (!text.trim()) continue; // a just-rotated, still-empty log says nothing either way
    filesRead++;
    if (version === null) for (const v of text.matchAll(APP_VERSION_RE)) version = v[1]; // newest = last in the newest file
    const lines = text.split('\n');
    for (const line of lines) {
      const m = LOADED_RE.exec(line);
      if (!m || m[8].trim().toLowerCase() !== want) continue;
      const at = logLineTime(m);
      if (at > since && (!best || at < best.at)) best = { at, loaded: Number(m[7]) + (m[9] ? Number(m[9]) : 0) };
    }
    const first = LOG_TIME_RE.exec(lines.find(l => LOG_TIME_RE.test(l)) || '');
    if (!first) { allTimestamped = false; continue; }
    oldestFirst = logLineTime(first);
    if (oldestFirst <= since) { covered = true; break; }
  }
  const rotated = !best && !covered && filesRead > 0 && allTimestamped && oldestFirst !== null && oldestFirst > since;
  return { found: !!best, loaded: best ? best.loaded : null, at: best ? best.at : null, version, rotated, readError, filesRead };
}

function checkAppLoad(ctx) {
  const stateFile = path.join(STATE_DIR, 'load-check.json');
  const counts = readJson(path.join(STATE_DIR, 'dest-counts.json'), {}) || {};
  const checked = readJson(stateFile, {}) || {};
  checked.unconfirmed = checked.unconfirmed || {}; // per list: the app version already reported as "could not confirm"
  let changed = false;
  for (const org of ctx.orgs) {
    const key = `${ctx.active}\\${org}`;
    const rec = counts[key];
    if (!rec || !Number.isFinite(rec.ts) || !Number.isFinite(rec.count) || checked[key] === rec.ts) continue;
    const folder = path.join(SESSIONS_ROOT, ctx.active, org);
    const r = findLoadAfter(folder, rec.ts);
    if (r.found) {
      delete checked.unconfirmed[key]; // the line is back: a later miss (same version) must be reported again
      ctx.loadCheck = { expected: rec.count, loaded: r.loaded, gap: rec.count - r.loaded, version: r.version };
      if (rec.count - r.loaded > LOAD_GAP_ALLOWED) {
        report(ctx, `load-gap:${key}`, `after switching to account ${ctx.active.slice(0, 8)}, the Claude app loaded ${r.loaded} sessions, but its list held ${rec.count} at the last sync before the switch; the app may no longer accept sessions copied from the other account (app version ${r.version || 'unknown'}). Check the sidebar after switching.`);
      }
    } else if (Date.now() - rec.ts < LOAD_LOG_GRACE_MS || (r.readError && Date.now() - rec.ts < LOAD_READ_RETRY_MS)) {
      continue; // the load may not be logged yet, or a log is briefly locked: look again next time
    } else if (r.rotated) {
      ctx.loadCheck = 'log-rotated';
    } else {
      ctx.loadCheck = 'not-found';
      // Reported once per app version and list (kept in load-check.json, which is never pruned): a log
      // that moved or was reworded cannot be fixed by Erez, so it must not repeat at every switch.
      const ver = r.version || 'unknown';
      if (checked.unconfirmed[key] !== ver) {
        const where = r.readError
          ? `could not read the Claude app's log in ${APP_LOG_DIR} for several days`
          : r.filesRead === 0
          ? `could not find the Claude app's log in ${APP_LOG_DIR}`
          : 'could not find the line where the Claude app logs loading this account\'s session list';
        report(ctx, `load-unconfirmed:${key}:${ver}`, `${where}, so it is unconfirmed that sessions copied from the other account were loaded after the switch; the app (version ${ver}) may have changed, and this check needs updating. Check the sidebar after switching.`);
        checked.unconfirmed[key] = ver;
      }
    }
    checked[key] = rec.ts;
    changed = true;
  }
  if (changed) try { writeAtomic(stateFile, JSON.stringify(checked)); } catch (e) { stderr(`could not save load-check state (${e && e.message})`); }
}

function acquireLock(deadline) {
  const lock = path.join(STATE_DIR, 'lock');
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, ts: Date.now(), until: deadline }), { flag: 'wx' });
      return lock;
    } catch (e) {
      if (!(e && e.code === 'EEXIST')) throw e;
      const held = readJson(lock, null);
      const until = held && Number.isFinite(held.until) ? held.until : (held && Number.isFinite(held.ts) ? held.ts : 0);
      if (Date.now() < until + LOCK_STALE_MS) return null;
      try { fs.unlinkSync(lock); } catch (e2) { /* raced: retry */ }
    }
  }
  return null;
}

function main(raw, argv) {
  const started = Date.now();
  let payload = {};
  try { payload = JSON.parse(raw || '{}') || {}; } catch (e) { stderr(`could not parse hook payload (${e && e.message})`); }
  const bIdx = argv.indexOf('--budget');
  const manual = bIdx >= 0 || argv.includes('--max-removals');
  const event = manual ? 'manual' : (payload.hook_event_name === 'SessionStart' ? 'SessionStart' : 'Stop');
  let budget = BUDGET_MS[event];
  if (manual && bIdx >= 0) {
    const s = Number(argv[bIdx + 1]);
    if (Number.isFinite(s) && s > 0) budget = s * 1000;
  }
  const sessionId = typeof payload.session_id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(payload.session_id) ? payload.session_id : 'unknown-session';
  const mIdx = argv.indexOf('--max-removals');
  const maxRemovals = manual && mIdx >= 0 && Number.isInteger(Number(argv[mIdx + 1])) && Number(argv[mIdx + 1]) >= 0
    ? Number(argv[mIdx + 1]) : MAX_REMOVALS;
  const ctx = {
    event, sessionId, maxRemovals, deadline: started + budget, problems: [], incomplete: false, seenEntries: 0,
    counts: { copied: 0, updated: 0, removed: 0, markers: 0, dead: 0 }, parseFails: {}, prevParseFails: {},
    attempted: new Set(), entryFailures: [], liveUncopyable: [], active: null, other: null, crossCheck: null,
    runStart: started, lastWriteTs: 0, orgs: null, reachedSync: false, loadCheck: null
  };
  if (!fs.existsSync(APP_DIR)) return; // nothing to do on a PC without the desktop app; stay silent
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch (e) { stderr(`could not create state dir (${e && e.message})`); return; }
  const prev = readJson(path.join(STATE_DIR, 'reported.json'), {}) || {};
  ctx.prevParseFails = prev.parseFails || {};

  let lock = null;
  let outcome;
  try {
    lock = acquireLock(ctx.deadline);
    if (!lock) { appendLog({ event, outcome: 'skipped-locked' }); return; }
    outcome = run(ctx);
  } catch (e) {
    if (e instanceof SwitchedAccount) {
      outcome = `aborted:${e.message || 'account-switched'}`;
    } else {
      outcome = 'problem';
      report(ctx, `crash:${(e && e.code) || 'error'}`, `the account session sync stopped partway (${(e && e.message) || e}); it retries at the next message`);
    }
  } finally {
    if (ctx.reachedSync) recordDestCounts(ctx);
    if (lock) try { fs.unlinkSync(lock); } catch (e) { /* stale-lock takeover handles it */ }
  }

  // Parse-failure counts: files attempted this run keep a count only if they failed again (a success
  // clears them); files a budget-cut run never reached keep their previous count.
  try {
    const rep = readJson(path.join(STATE_DIR, 'reported.json'), {}) || {};
    const carried = {};
    for (const [f, n] of Object.entries(ctx.prevParseFails)) if (!ctx.attempted.has(f) && fs.existsSync(f)) carried[f] = n;
    rep.parseFails = { ...carried, ...ctx.parseFails };
    writeAtomic(path.join(STATE_DIR, 'reported.json'), JSON.stringify(rep));
  } catch (e) { stderr(`could not save parse-failure counts (${e && e.message})`); }
  saveHeadCache();

  if (outcome === 'complete') {
    try { writeAtomic(path.join(STATE_DIR, 'last-success'), String(Date.now())); } catch (e) { stderr(`could not stamp last-success (${e && e.message})`); }
  }
  const runLine = {
    event, outcome, ms: Date.now() - started, active: ctx.active, other: ctx.other, crossCheck: ctx.crossCheck,
    seen: ctx.seenEntries, ...ctx.counts, ...(ctx.loadCheck ? { loadCheck: ctx.loadCheck } : {})
  };
  appendLog(runLine);
  if (manual) stderr(`${JSON.stringify(runLine)}${ctx.problems.length ? ' problems: ' + ctx.problems.join(', ') : ''}`);
  housekeeping();
}

// Keep the state files bounded: rotate changes.log past LOG_ROTATE_BYTES (one previous file kept) and
// forget de-dup timestamps older than SENT_KEEP_MS.
function housekeeping() {
  try {
    const log = path.join(STATE_DIR, 'changes.log');
    const st = statOrNull(log);
    if (st && st.size > LOG_ROTATE_BYTES) fs.renameSync(log, log + '.1');
  } catch (e) { stderr(`could not rotate changes.log (${e && e.message})`); }
  try {
    const file = path.join(STATE_DIR, 'reported.json');
    const rep = readJson(file, null);
    if (rep && rep.sent) {
      const now = Date.now();
      let changed = false;
      for (const k of Object.keys(rep.sent)) if (!(now - Number(rep.sent[k]) < SENT_KEEP_MS)) { delete rep.sent[k]; changed = true; }
      if (changed) writeAtomic(file, JSON.stringify(rep));
    }
  } catch (e) { stderr(`could not prune reported.json (${e && e.message})`); }
}

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', c => (raw += c));
  process.stdin.on('end', () => {
    try { main(raw, process.argv.slice(2)); } catch (e) { stderr(`failed open (${e && e.message})`); }
    process.exitCode = 0;
  });
}

module.exports = { main, findLoadAfter, LOCAL_RE, MARKER_RE, CONFIG_RE };
