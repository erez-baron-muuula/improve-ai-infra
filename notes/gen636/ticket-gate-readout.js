#!/usr/bin/env node
// ticket-gate-readout.js -- GEN-636: the /wrap reader for the ticket-quality gate's aggregate signals.
//
// NOT A HOOK. It is not registered in settings.json and never runs on a tool call. It lives in hooks/
// only so that every edit to it -- including re-calibrating a bar -- goes through /vet-code
// (isProtectedCodeTarget gates hooks/*.js), because its bars are safety thresholds. /wrap Step 3i runs:
//     node "C:/Users/Erez/.claude/hooks/ticket-gate-readout.js"
// and relays each printed line verbatim. EMPTY OUTPUT MEANS EVERY BAR IS CLEAR.
//
// Inputs (read-only; this script writes nothing and keeps no state):
//   <staging>/ticket-gate-events.jsonl      the gate's append-only decision log (auto-approve.js)
//   <staging>/ticket-passes/*.json          Step-4 ticket-records (kind "ticket-record") and consult
//                                           files (kind "ticket-consult"); *.consumed.* passes skipped
//   <staging>/ticket-gate-exempt-pages.txt  the GEN-58 exemption list
//   <claude>/wrap-surfaced-not-filed-*.md   no-project /wrap recovery files
//
// Design, bars, baselines and recorded departures: notes/gen636/design.md in the Improve AI Infra repo
// (https://github.com/erez-baron-muuula/improve-ai-infra). Re-calibrate with notes/gen636/baseline.js.
//
// CLI (the overrides exist for fixtures): node ticket-gate-readout.js [--now <ISO>] [--staging <dir>]
//   [--claude-dir <dir>]. Exit code is ALWAYS 0. Each row runs in its own try/catch, so one bad input
//   cannot hide the other rows; a top-level failure prints one "Ticket-gate readout failed:" line.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const W = 40;                       // rate window (approves)
const EXEMPT_CAP = 4096;            // must equal TICKET_EXEMPT_CAP in auto-approve.js
const EXEMPT_BAR = 3686;            // 90% of the cap
const UNATTENDED = new Set(['wrap-step1', 'wrap-step3c', 'scheduled']);

// THE classification of every event kind and block reason auto-approve.js can log. Row 15 names any
// value missing from here; notes/gen636/test-readout.js extracts the hook's literals and checks this
// table both ways. Classes: monitored (a row below reads it), self-surfacing (exits 2 and prints its
// reason, so Claude acts in the same turn -- counting it adds noise, not signal), audit-only (allowed by
// design; no decision depends on its rate), not-wired (REST arm, unreachable until GEN-635 wires it --
// listed so row 15 names it if it ever appears).
const CLASS = {
  event: {
    'approve': 'monitored', 'block': 'monitored', 'break-glass-skip': 'monitored', 'sandbox-exempt': 'audit-only',
  },
  reason: {
    'internal-error': 'monitored', 'consume-failed': 'monitored', 'connector-mismatch': 'monitored',
    'exempt-list-overflow': 'monitored', 'exempt-list-unreadable': 'monitored',
    'no-pass': 'self-surfacing', 'stale-content': 'self-surfacing', 'bad-target': 'self-surfacing',
    'unreadable-payload': 'self-surfacing', 'bad-record': 'self-surfacing', 'unknown-record-key': 'self-surfacing',
    'expiry-too-far': 'self-surfacing', 'bad-verdict': 'self-surfacing', 'reviewer-unverified': 'self-surfacing',
    'no-token': 'self-surfacing', 'transcript-too-large': 'self-surfacing', 'practice-page-plain-only': 'self-surfacing',
    'rest-not-via-script': 'not-wired', 'rest-template-cannot-express': 'not-wired', 'rest-signal-no-target': 'not-wired',
    'rest-form-unrecognised': 'not-wired', 'rest-script-mismatch': 'not-wired', 'body-file-unreadable': 'not-wired',
  },
};

function parseArgs(argv) {
  const o = { now: Date.now(), staging: path.join(os.homedir(), '.claude-staging'), claude: path.join(os.homedir(), '.claude') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--now' && v !== undefined) { const t = Date.parse(v); if (!isNaN(t)) o.now = t; i++; }
    else if (a === '--staging' && v !== undefined) { o.staging = v; i++; }
    else if (a === '--claude-dir' && v !== undefined) { o.claude = v; i++; }
  }
  return o;
}

const iso = t => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const days = ms => Math.floor(ms / DAY);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const cleanJson = s => s.replace(/^\uFEFF/, '');
// Date.parse that cannot throw: a JSON value like {"toString": 1} makes plain Date.parse throw before any
// row runs, which would blank the whole readout. Non-strings are simply "no time".
const pd = v => (typeof v === 'string' ? Date.parse(v) : NaN);

function loadEvents(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { return { missing: e && e.code === 'ENOENT', unreadable: !(e && e.code === 'ENOENT'), lines: [], events: [] }; }
  const lines = cleanJson(text).split(/\r?\n/).filter(l => l.trim() !== '');
  const events = [];
  lines.forEach((l, i) => {
    let o = null;
    try { o = JSON.parse(l); } catch (e) { o = null; }
    events.push(isObj(o) ? { ok: true, i: i, e: o, t: pd(o.ts) } : { ok: false, i: i });
  });
  return { missing: false, unreadable: false, lines: lines, events: events };
}

function loadPasses(dir) {
  // byHash maps a content hash to EVERY record carrying it (the same payload can be reviewed twice, e.g.
  // re-filed after a failed write); recFor() picks the one that belongs to a given approve.
  const out = { records: [], consults: [], byHash: new Map() };
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return out; }
  for (const f of names) {
    if (!f.endsWith('.json') || f.indexOf('.consumed.') !== -1) continue;
    const full = path.join(dir, f);
    let o, st;
    try { o = JSON.parse(cleanJson(fs.readFileSync(full, 'utf8'))); } catch (e) { continue; }
    if (!isObj(o)) continue;
    try { st = fs.statSync(full); } catch (e) { st = null; }
    const mt = st ? st.mtimeMs : NaN;
    if (o.kind === 'ticket-record') {
      // Record time = file mtime (system-written). draftedUtc is typed by the model and was seen
      // hand-rounded and shared across a batch, so it is only the fallback.
      const t = !isNaN(mt) ? mt : pd(o.draftedUtc);
      const rec = { f: f, o: o, t: t };
      out.records.push(rec);
      if (typeof o.contentHash === 'string') {
        const k = o.contentHash.trim().toLowerCase();
        if (!out.byHash.has(k)) out.byHash.set(k, []);
        out.byHash.get(k).push(rec);
      }
    } else if (o.kind === 'ticket-consult') {
      const opened = pd(o.openedUtc);
      out.consults.push({ f: f, o: o, t: !isNaN(opened) ? opened : mt });
    }
  }
  return out;
}

// Same predicate as readExemptPages() in auto-approve.js: distinct lines that are exactly 32 lowercase hex
// after trim + lowercase; everything else ignored. A test compares the two counts on the same file.
function countExempt(file) {
  let text;
  try { text = cleanJson(fs.readFileSync(file, 'utf8')); }
  catch (e) { return e && e.code === 'ENOENT' ? 0 : null; }
  const ids = new Set();
  for (const ln of text.split(/\r?\n/)) {
    const s = ln.trim().toLowerCase();
    if (/^[0-9a-f]{32}$/.test(s)) ids.add(s);
  }
  return ids.size;
}

const KNOWN_SOURCES = new Set(['interactive', 'wrap-step1', 'wrap-step3c', 'scheduled']);
const KNOWN_LANES = new Set(['ticket', 'non-ticket', 'gen58-rollover']);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// A prior review round counts only if it names a real agent id (the hook's own agent-id shape), so a copied
// template placeholder or "none" cannot pose as a round and mask row 8's lenient-reviewer warning.
const AGENT_ID = /^[A-Za-z0-9_-]{4,64}$/;
const isMulti = r => !!r && Array.isArray(r.o.priorReviewerAgentIds) &&
  r.o.priorReviewerAgentIds.some(x => typeof x === 'string' && AGENT_ID.test(x) && !/^<|^none$|^n\/?a$/i.test(x));
// A record counts as TAGGED only with a known source value: a null, empty or misspelt value is treated as
// untagged (row 11) and named by row 15, so a skill writing a wrong value cannot silence both.
const hasSource = r => !!r && has(r.o, 'source') && KNOWN_SOURCES.has(r.o.source);
const isUnattended = r => !!r && UNATTENDED.has(r.o.source);
// String() that cannot throw: a JSON value like {"toString": null} makes plain String() throw a TypeError.
const str = v => { try { return String(v); } catch (e) { return '[unprintable]'; } };
const oneLine = s => str(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ');

// Module-level so the top-level catch can still print every row already computed.
const out = [];

// Computes fn once, on first use, INSIDE whichever row first asks -- so a throw is reported by that row
// (and every later row that needs it) instead of aborting the whole readout.
function lazy(fn) {
  let done = false, val, err;
  return () => {
    if (!done) { done = true; try { val = fn(); } catch (e) { err = e; } }
    if (err) throw err;
    return val;
  };
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  const now = opt.now;
  const say = s => out.push('Ticket gate: ' + oneLine(s));
  const row = (n, fn) => { try { fn(); } catch (e) { say('row ' + n + ' could not be computed (' + str(e && e.message || e).slice(0, 160) + ')'); } };

  const EVENTS_FILE = path.join(opt.staging, 'ticket-gate-events.jsonl');
  const ev = loadEvents(EVENTS_FILE);
  const passes = loadPasses(path.join(opt.staging, 'ticket-passes'));
  const good = ev.events.filter(x => x.ok).map(x => Object.assign({}, x.e, { _t: x.t }));
  const inWeek = e => !isNaN(e._t) && e._t >= now - WEEK;
  const week = good.filter(inWeek);
  const approves = good.filter(e => e.event === 'approve');
  // The record for an approve: among records with its hash, the newest one written no later than a few
  // minutes after the approve (the record is written before the write; mtime can trail by seconds);
  // failing that, the newest overall.
  const recOf = e => {
    if (typeof e.hash !== 'string') return null;
    const list = passes.byHash.get(e.hash.trim().toLowerCase());
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];
    const cutoff = isNaN(e._t) ? Infinity : e._t + 5 * 60 * 1000;
    const byNewest = list.slice().sort((a, b) => (b.t || 0) - (a.t || 0));
    return byNewest.find(r => !isNaN(r.t) && r.t <= cutoff) || byNewest[0];
  };
  const newest = list => list.reduce((m, e) => (isNaN(e._t) ? m : Math.max(m, e._t)), -Infinity);
  const when = list => { const t = newest(list); return t === -Infinity ? '' : ' (newest ' + iso(t) + ')'; };

  // 0a -- the log itself is missing or unreadable: every other line below is blind.
  row('0a', () => {
    if (ev.missing) say('the gate\'s event log is MISSING (' + EVENTS_FILE + ') -- the gate is not logging, or its path drifted. Check auto-approve.js; every other ticket-gate line is blind until the log is back.');
    else if (ev.unreadable) say('the gate\'s event log could not be read (' + EVENTS_FILE + ') -- every other ticket-gate line is blind until it reads clean.');
  });

  // 0b -- unparseable lines among the last 100 (about two weeks at the current rate).
  row('0b', () => {
    const bad = ev.events.slice(-100).filter(x => !x.ok).length;
    if (bad >= 3) say(bad + ' of the last 100 lines of the gate\'s event log are not valid JSON -- the log is being corrupted. Diagnose the writer; the line clears once the bad lines scroll out or are trimmed.');
  });

  // 0c -- ticket-records written this week, but no approve logged this week.
  row('0c', () => {
    if (ev.missing || ev.unreadable) return;
    const recs = passes.records.filter(r => !isNaN(r.t) && r.t >= now - WEEK).length;
    const appr = week.filter(e => e.event === 'approve').length;
    if (recs >= 3 && appr === 0) say('no gate approvals logged in 7 days despite ' + recs + ' drafted ticket-records -- logging may be dead, or the drafts were never filed. Check the hook is still logging.');
  });

  const blocksWeek = reason => week.filter(e => e.event === 'block' && e.reason === reason);

  // Row 1 counts internal-errors whether they blocked or were cleared under break-glass: either way the
  // gate's own code failed, and that diagnosis must not be lost to row 5's "switch break-glass off".
  row(1, () => {
    const l = week.filter(e => (e.event === 'block' || e.event === 'break-glass-skip') && e.reason === 'internal-error');
    if (l.length >= 2) say(l.length + ' internal-error blocks in 7 days' + when(l) + ' -- the gate\'s own code is failing, not the traffic. Investigate auto-approve.js.');
  });
  row(2, () => {
    const l = blocksWeek('consume-failed');
    if (l.length >= 1) say(l.length + ' consume-failed block(s) in 7 days' + when(l) + ' -- a matched pass could not be consumed (locked or read-only file). See /vet-ticket Step 9.');
  });
  row(3, () => {
    const blocked = week.filter(e => e.event === 'block' && e.reason === 'connector-mismatch');
    const through = week.filter(e => e.event === 'break-glass-skip' && e.reason === 'connector-mismatch');
    const l = blocked.concat(through);
    if (l.length >= 1) say('Notion writes from an unrecognised connector id in 7 days' + when(l) + ': ' + blocked.length +
      ' refused, ' + through.length + ' let through UNREVIEWED under break-glass -- the Notion connector id changed. If not' +
      ' already done, update NOTION_MCP_PREFIX via /vet-code (steps: blockConnectorMismatch in auto-approve.js; the id' +
      ' may differ per Claude app, so ask Erez before changing it).');
  });
  row(4, () => {
    const l = week.filter(e => e.event === 'block' && (e.reason === 'exempt-list-overflow' || e.reason === 'exempt-list-unreadable'));
    if (l.length >= 1) say(l.length + ' GEN-58 exemption-list block(s) in 7 days' + when(l) + ' -- the list is over its cap or unreadable. See the block message for the fix.');
  });
  // Row 5 covers EVERY break-glass skip, connector-mismatch included: break-glass also unlocks the protected
  // config files and the copy/move guard, so "turn it off" is the decision-relevant half of the signal and
  // must not depend on which reason triggered the skip (Pass B, 2026-10-13).
  row(5, () => {
    const l = week.filter(e => e.event === 'break-glass-skip');
    if (l.length >= 1) say('the ticket gate let ' + l.length + ' Notion write(s) through UNREVIEWED under break-glass in 7 days' + when(l) +
      ' -- confirm break-glass is switched off (env CLAUDE_CONFIG_UNLOCK / the .config-unlock sentinel); it also unlocks the protected config files.');
  });

  row(6, () => {
    const last = approves.slice(-W);
    const n = last.filter(e => e.waived === true).length;
    if (n > 10) say(n + ' of the last ' + last.length + ' gated writes were waived (bar: more than 10) -- the waive lane is firing too often; revisit the gate\'s scope.');
  });
  row('6b', () => {
    const l = week.filter(e => e.event === 'approve' && e.waived === true && isUnattended(recOf(e)));
    if (l.length >= 1) say(l.length + ' waived filing(s) from an UNATTENDED run in 7 days' + when(l) + ' -- an unattended run cannot have Erez\'s waive. Investigate.');
  });

  // The attended window: the last 40 matched approves whose record is not tagged unattended. Untagged
  // records count as attended -- that is how the historical baseline was built.
  const attendedL = lazy(() => approves.map(recOf).filter(r => r && !isUnattended(r)).slice(-W));
  row(7, () => {
    const attended = attendedL();
    if (attended.length < W) return;
    const n = attended.filter(isMulti).length;
    if (n > 16) say(n + ' of the last ' + W + ' reviewed tickets needed more than one review round (bar: more than 16; history 3-16) -- the reviewer is stricter than ever seen. Check the reviewer brief.');
  });
  row(8, () => {
    const attended = attendedL();
    if (attended.length < W) return;
    const n = attended.filter(isMulti).length;
    if (n <= 2) say('only ' + n + ' of the last ' + W + ' reviewed tickets needed a second review round (history 3-16) -- the reviewer may have gone lenient. Spot-check a few recent filings against the ticket bar.');
  });

  // Tag cut-over: T0 = earliest record time among records carrying a `source` key.
  const T0L = lazy(() => passes.records.reduce((m, r) => (hasSource(r) && !isNaN(r.t) && (m === null || r.t < m) ? r.t : m), null));

  row(9, () => {
    const T0 = T0L();
    if (T0 === null) return;
    const laned = approves.map(recOf).filter(r => r && r.t >= T0 && Object.prototype.hasOwnProperty.call(r.o, 'lane')).slice(-W);
    if (laned.length < 20) return;
    const n = laned.filter(r => r.o.lane === 'non-ticket').length;
    if (n > 2) say(n + ' of the last ' + laned.length + ' gated writes were to non-ticket pages (bar: more than 2) -- the "every gated Notion page is a ticket" premise is drifting. Revisit the gate\'s scoping.');
  });
  row(10, () => {
    const last = approves.slice(-W);
    const n = last.filter(e => !recOf(e)).length;
    if (n > 4) say(n + ' of the last ' + last.length + ' gated writes have no matching ticket-record (bar: more than 4; history 0-3) -- /vet-ticket record-keeping has slipped, and the review-round lines lose data.');
  });
  row(11, () => {
    const T0 = T0L();
    if (T0 === null) return;
    const from = Math.max(T0 + 60 * 60 * 1000, now - WEEK);
    const l = passes.records.filter(r => !hasSource(r) && !isNaN(r.t) && r.t > from);
    if (l.length >= 2) say(l.length + ' ticket-record(s) written in the last 7 days without a valid source tag (newest ' + iso(l.reduce((m, r) => Math.max(m, r.t), -Infinity)) + ') -- /vet-ticket stopped writing it, so unattended filings are no longer excluded from the review-round lines. Clears 7 days after tagging resumes.');
  });
  row(12, () => {
    const n = countExempt(path.join(opt.staging, 'ticket-gate-exempt-pages.txt'));
    if (n === null) return;     // unreadable -> the hook blocks with exempt-list-unreadable; row 4 reports it
    if (n > EXEMPT_BAR) say('the GEN-58 exemption list holds ' + n + ' of ' + EXEMPT_CAP + ' ids (bar: more than ' + EXEMPT_BAR + ') -- something is appending ids that are not log volumes. Find it, then trim.');
  });
  row(13, () => {
    const closed = v => v === true || v === 'true' || v === 'abandoned';
    const open = passes.consults.filter(c => !closed(c.o.resolved));
    for (const c of open.slice(0, 5)) {
      const age = isNaN(c.t) ? '?' : days(now - c.t);
      say('a ticket question to Erez is still open (' + age + ' day(s), ' + str(c.o.target || '?').slice(0, 60) + '): "' +
          str(c.o.question || '').slice(0, 140) + '" -- ask again, or mark it abandoned (' + c.f + ').');
    }
    if (open.length > 5) say((open.length - 5) + ' more open ticket question(s) in ' + path.join(opt.staging, 'ticket-passes') + '.');
  });
  row(14, () => {
    let names;
    try { names = fs.readdirSync(opt.claude); } catch (e) { return; }
    const l = names.filter(f => /^wrap-surfaced-not-filed-.*\.md$/i.test(f));
    if (l.length >= 1) say(l.length + ' /wrap capture file(s) still waiting to be filed: ' + l.slice(0, 5).join(', ') +
                           (l.length > 5 ? ', ...' : '') + ' -- run /vet-ticket on each, then rename it to wrap-surfaced-filed-*.md.');
  });
  row(15, () => {
    const unknown = new Map();
    // This week's events, PLUS any of the last 100 whose ts is missing or unparseable -- an unknown event
    // shape with no usable ts must not be invisible here just because it cannot be placed in the week.
    const scan = week.concat(ev.events.slice(-100).filter(x => x.ok && isNaN(x.t)).map(x => x.e));
    for (const e of scan) {
      const ek = str(e.event);
      if (!Object.prototype.hasOwnProperty.call(CLASS.event, ek)) { unknown.set('event "' + ek + '"', (unknown.get('event "' + ek + '"') || 0) + 1); continue; }
      if ((ek === 'block' || ek === 'break-glass-skip')) {
        const rk = str(e.reason);
        const cls = Object.prototype.hasOwnProperty.call(CLASS.reason, rk) ? CLASS.reason[rk] : null;
        if (cls === null || cls === 'not-wired') {
          const k = (cls === 'not-wired' ? 'not-wired reason "' : 'reason "') + rk + '"';
          unknown.set(k, (unknown.get(k) || 0) + 1);
        }
      }
    }
    // A ticket-record's `source` value outside the known set (null, empty, misspelt) is the same kind of
    // drift: name it, so a skill writing a wrong value is visible rather than silently "attended".
    for (const r of passes.records) {
      if (isNaN(r.t) || r.t < now - WEEK) continue;
      if (has(r.o, 'source') && !KNOWN_SOURCES.has(r.o.source)) {
        const k = 'record source "' + str(r.o.source).slice(0, 40) + '"';
        unknown.set(k, (unknown.get(k) || 0) + 1);
      }
      // Same for `lane`: a misspelt value would never count as non-ticket and silence row 9.
      if (has(r.o, 'lane') && !KNOWN_LANES.has(r.o.lane)) {
        const k = 'record lane "' + str(r.o.lane).slice(0, 40) + '"';
        unknown.set(k, (unknown.get(k) || 0) + 1);
      }
    }
    if (unknown.size) say('the gate logged signal(s) nothing classifies in 7 days: ' +
      Array.from(unknown.entries()).map(([k, n]) => k + ' x' + n).join(', ') +
      ' -- add them to the CLASS table in ticket-gate-readout.js (via /vet-code) with a bar or a stated reason.');
  });

  if (out.length) process.stdout.write(out.join('\n') + '\n');
}

if (require.main === module) {
  try { main(); }
  catch (e) {
    // Print every row already computed BEFORE the failure line, so a late throw cannot hide an earlier alarm.
    if (out.length) process.stdout.write(out.join('\n') + '\n');
    process.stdout.write('Ticket-gate readout failed: ' + oneLine(str(e && e.message || e)).slice(0, 200) + '\n');
  }
  process.exitCode = 0;
}

module.exports = { CLASS: CLASS, countExempt: countExempt };
