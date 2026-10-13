// GEN-636: fixtures for ticket-gate-readout.js. Usage:
//   node test-readout.js [readoutPath] [hookPath]
// Defaults: the working copies in this repo (notes/gen636/ticket-gate-readout.js,
// notes/gen508-piece1/auto-approve.working.js). Every fixture runs in its own temp dir via --staging /
// --claude-dir / --now, so nothing touches the real ~/.claude-staging.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const READOUT = path.resolve(process.argv[2] || path.join(__dirname, 'ticket-gate-readout.js'));
const HOOK = path.resolve(process.argv[3] || path.join(__dirname, '..', 'gen508-piece1', 'auto-approve.working.js'));
const NOW = Date.parse('2026-10-13T12:00:00Z');
const DAY = 86400000;
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + String(detail).slice(0, 400) : '')); }
}
const T = ms => new Date(ms).toISOString();

let seq = 0;
function fixture(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gen636-'));
  const staging = path.join(root, 'staging'), claude = path.join(root, 'claude'), passes = path.join(staging, 'ticket-passes');
  fs.mkdirSync(passes, { recursive: true }); fs.mkdirSync(claude, { recursive: true });
  if (!spec.noLog) {
    const lines = (spec.events || []).map(e => typeof e === 'string' ? e : JSON.stringify(Object.assign({ source: 'unknown' }, e)));
    fs.writeFileSync(path.join(staging, 'ticket-gate-events.jsonl'), lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  }
  for (const r of spec.records || []) {
    const f = path.join(passes, (r.name || ('rec-' + (++seq))) + '.json');
    const o = Object.assign({ kind: 'ticket-record', contentHash: r.hash, priorReviewerAgentIds: r.rounds > 1 ? Array(r.rounds - 1).fill('a0000000000000001') : [],
                              verdict: 'PASS', waived: !!r.waived, draftedUtc: T(r.drafted != null ? r.drafted : r.t) }, r.extra || {});
    fs.writeFileSync(f, (r.bom ? '﻿' : '') + JSON.stringify(o), 'utf8');
    const mt = new Date(r.t); fs.utimesSync(f, mt, mt);
  }
  for (const c of spec.consults || []) fs.writeFileSync(path.join(passes, 'consult-' + (++seq) + '.json'), JSON.stringify(Object.assign({ kind: 'ticket-consult' }, c)), 'utf8');
  if (spec.exempt != null) fs.writeFileSync(path.join(staging, 'ticket-gate-exempt-pages.txt'), spec.exempt, 'utf8');
  for (const w of spec.wrapFiles || []) fs.writeFileSync(path.join(claude, w), 'x', 'utf8');
  for (const p of spec.extraPassFiles || []) fs.writeFileSync(path.join(passes, p.name), p.body, 'utf8');
  return { staging, claude, root };
}
function readout(fx, now) {
  const r = spawnSync(process.execPath, [READOUT, '--now', T(now || NOW), '--staging', fx.staging, '--claude-dir', fx.claude], { encoding: 'utf8' });
  return { code: r.status, lines: (r.stdout || '').split('\n').filter(Boolean), err: r.stderr || '' };
}
// n approves (matched to records) spread over the last few hours; opts.multi = how many multi-round,
// opts.waived = how many waived, opts.unmatched = how many with no record, opts.source/lane for records.
function approvesSpec(n, opts) {
  opts = opts || {};
  const events = [], records = [];
  for (let i = 0; i < n; i++) {
    const t = NOW - (n - i) * 60000, hash = 'h' + (++seq) + 'x' + i;
    const waived = i < (opts.waived || 0);
    events.push({ ts: T(t), event: 'approve', tool: 'mcp__x__notion-update-page', surface: 'notion-mcp', target: 'p', hash: hash, waived: waived });
    if (i >= n - (opts.unmatched || 0)) continue;
    const extra = {};
    if (opts.source) extra.source = typeof opts.source === 'function' ? opts.source(i) : opts.source;
    if (opts.lane) extra.lane = typeof opts.lane === 'function' ? opts.lane(i) : opts.lane;
    records.push({ hash: hash, t: t - 1000, rounds: i < (opts.multi || 0) ? 2 : 1, waived: waived, extra: extra });
  }
  return { events, records };
}
const has = (r, s) => r.lines.some(l => l.indexOf(s) !== -1);
const silent = r => r.code === 0 && r.lines.length === 0;
const blk = (reason, ageDays, event) => ({ ts: T(NOW - (ageDays || 0) * DAY - 1000), event: event || 'block', tool: 't', target: 'x', reason: reason });

console.log('== real data (point in time; re-run at install) ==');
{
  const r = spawnSync(process.execPath, [READOUT, '--now', T(Date.now())], { encoding: 'utf8' });
  check('the real staging dir + real ~/.claude print NOTHING today', r.status === 0 && (r.stdout || '') === '', r.stdout);
}

console.log('\n== baseline: a healthy synthetic window is silent ==');
{
  const s = approvesSpec(40, { multi: 8, waived: 1 });
  const r = readout(fixture(s));
  check('40 approves, 8 multi-round, 1 waived -> silent', silent(r), r.lines.join(' | '));
}

console.log('\n== 0a/0b/0c: the log itself ==');
{
  const r = readout(fixture({ noLog: true }));
  check('0a: missing events log -> line', has(r, 'event log is MISSING') && r.code === 0, r.lines.join(' | '));
  const s = approvesSpec(10);
  s.events.splice(3, 0, '{bad', 'not json', 'null');
  check('0b: 3 unparseable among the last 100 -> line', has(readout(fixture(s)), 'not valid JSON'));
  const s2 = approvesSpec(10); s2.events.splice(3, 0, '{bad', 'not json');
  check('0b: 2 unparseable -> silent', silent(readout(fixture(s2))));
  const s3 = approvesSpec(10); s3.events.unshift('{bad', 'x', 'y');
  for (let i = 0; i < 100; i++) s3.events.push({ ts: T(NOW - 5000), event: 'sandbox-exempt', tool: 't', target: 'p' });
  check('0b: 3 unparseable that have scrolled out of the last 100 -> silent', silent(readout(fixture(s3))));
  const rec3 = [1, 2, 3].map(i => ({ hash: 'q' + i, t: NOW - i * DAY }));
  check('0c: 3 records this week, 0 approves this week -> line',
        has(readout(fixture({ events: [{ ts: T(NOW - 9 * DAY), event: 'approve', hash: 'old', waived: false }], records: rec3 })), 'no gate approvals logged in 7 days'));
  check('0c: 2 records, 0 approves -> silent',
        silent(readout(fixture({ events: [], records: rec3.slice(0, 2) }))));
}

console.log('\n== 1-5: one-off alarms in 7 days ==');
{
  check('1: 2 internal-error in 7d -> line', has(readout(fixture({ events: [blk('internal-error', 1), blk('internal-error', 2)] })), 'internal-error blocks'));
  check('1: 1 internal-error -> silent', silent(readout(fixture({ events: [blk('internal-error', 1)] }))));
  check('1: 2 internal-error but one is 8 days old -> silent', silent(readout(fixture({ events: [blk('internal-error', 1), blk('internal-error', 8)] }))));
  check('2: 1 consume-failed -> line', has(readout(fixture({ events: [blk('consume-failed', 3)] })), 'consume-failed'));
  check('2: consume-failed 8 days old -> silent', silent(readout(fixture({ events: [blk('consume-failed', 8)] }))));
  check('3: connector-mismatch block -> line', has(readout(fixture({ events: [blk('connector-mismatch', 0)] })), 'unrecognised connector id'));
  const r3b = readout(fixture({ events: [blk('connector-mismatch', 0), blk('connector-mismatch', 0, 'break-glass-skip')] }));
  check('3: connector-mismatch refused + let through -> row 3 counts both', has(r3b, '1 refused, 1 let through UNREVIEWED'), r3b.lines.join(' | '));
  check('5: a connector-mismatch break-glass skip ALSO fires row 5 (switch break-glass off)', has(r3b, 'confirm break-glass is switched off'), r3b.lines.join(' | '));
  check('4: exempt-list-overflow -> line', has(readout(fixture({ events: [blk('exempt-list-overflow', 1)] })), 'exemption-list block'));
  check('4: exempt-list-unreadable -> line', has(readout(fixture({ events: [blk('exempt-list-unreadable', 1)] })), 'exemption-list block'));
  check('5: break-glass-skip (internal-error) -> line', has(readout(fixture({ events: [blk('internal-error', 1, 'break-glass-skip')] })), 'confirm break-glass is switched off'));
  const rOne = readout(fixture({ events: [blk('consume-failed', 2)] }));
  check('one-off lines name the newest event time', has(rOne, '(newest 2026-10-11T'), rOne.lines.join(' | '));
  check('self-surfacing blocks (no-pass, bad-record, practice-page-plain-only, ...) are silent',
        silent(readout(fixture({ events: ['no-pass', 'bad-record', 'practice-page-plain-only', 'unknown-record-key', 'expiry-too-far', 'no-token', 'transcript-too-large', 'unreadable-payload', 'bad-target', 'bad-verdict', 'reviewer-unverified'].map(x => blk(x, 1)) }))));
  check('sandbox-exempt events are silent', silent(readout(fixture({ events: [blk(undefined, 1, 'sandbox-exempt')] }))));
}

console.log('\n== 6/6b: waives ==');
{
  check('6: 11 of 40 waived -> line', has(readout(fixture(approvesSpec(40, { waived: 11, multi: 8 }))), 'were waived'));
  check('6: 10 of 40 waived -> silent', silent(readout(fixture(approvesSpec(40, { waived: 10, multi: 8 })))));
  const s = approvesSpec(5, { waived: 1, source: 'wrap-step1' });
  check('6b: a waived approve whose record is tagged wrap-step1 -> line', has(readout(fixture(s)), 'UNATTENDED run'));
  const s2 = approvesSpec(5, { waived: 1, source: 'interactive' });
  check('6b: a waived interactive approve -> silent (row 6b)', !has(readout(fixture(s2)), 'UNATTENDED run'));
}

console.log('\n== 7/8: review rounds in the attended window ==');
{
  check('7: 17 of 40 multi-round -> line', has(readout(fixture(approvesSpec(40, { multi: 17 }))), 'stricter than ever seen'));
  check('7: 16 of 40 -> silent', silent(readout(fixture(approvesSpec(40, { multi: 16 })))));
  check('8: 2 of 40 multi-round -> line', has(readout(fixture(approvesSpec(40, { multi: 2 }))), 'may have gone lenient'));
  check('8: 3 of 40 -> silent', silent(readout(fixture(approvesSpec(40, { multi: 3 })))));
  check('7/8: fewer than 40 matched approves -> silent even at 0 multi', silent(readout(fixture(approvesSpec(39, { multi: 0 })))));
  // Unattended filings (all first-round) are EXCLUDED: 40 attended with 5 multi + 30 unattended first-round
  // would read 5/40 attended (silent), not a diluted window.
  const a = approvesSpec(40, { multi: 5, source: 'interactive', lane: 'ticket' });
  const u = approvesSpec(30, { multi: 0, source: 'wrap-step1', lane: 'ticket' });
  // put the unattended ones LAST so a naive last-40 would be 30 unattended + 10 attended (= 0 multi -> false row 8)
  u.events.forEach(e => { e.ts = T(Date.parse(e.ts) + 1000); });
  const r = readout(fixture({ events: a.events.concat(u.events), records: a.records.concat(u.records) }));
  check('8: unattended filings are excluded from the window (no false lenient line)', !has(r, 'may have gone lenient'), r.lines.join(' | '));
}

console.log('\n== 9/11: tag cut-over ==');
{
  // T0 at NOW-2d (first tagged record). Untagged records BEFORE T0 within 7 days must not fire row 11.
  const tagged = approvesSpec(3, { source: 'interactive', lane: 'ticket' });
  tagged.records.forEach(rc => { rc.t = NOW - 2 * DAY; });
  const pre = [1, 2, 3, 4].map(i => ({ hash: 'pre' + i, t: NOW - 3 * DAY - i * 3600000 }));
  check('11: untagged records BEFORE the cut-over are silent', silent(readout(fixture({ events: tagged.events, records: tagged.records.concat(pre) }))));
  const post2 = [1, 2].map(i => ({ hash: 'post' + i, t: NOW - 1 * DAY + i * 1000 }));
  check('11: two untagged after T0+1h within 7 days -> line',
        has(readout(fixture({ events: tagged.events, records: tagged.records.concat(post2) })), 'without a valid source tag'));
  check('11: one untagged after T0+1h -> silent',
        silent(readout(fixture({ events: tagged.events, records: tagged.records.concat(post2.slice(0, 1)) }))));
  const graced = [1, 2].map(i => ({ hash: 'grace' + i, t: NOW - 2 * DAY + 30 * 60000 + i }));
  check('11: untagged inside the 1h grace after T0 -> silent',
        silent(readout(fixture({ events: tagged.events, records: tagged.records.concat(graced) }))));
  // Old episode: T0 at NOW-20d, untagged after T0+1h but older than 7 days -> silent (it clears itself).
  const oldTag = approvesSpec(1, { source: 'interactive' }); oldTag.records.forEach(rc => { rc.t = NOW - 20 * DAY; });
  const oldUntagged = [1, 2].map(i => ({ hash: 'old' + i, t: NOW - 10 * DAY + i }));
  check('11: untagged after T0+1h but older than 7 days -> silent',
        silent(readout(fixture({ events: oldTag.events, records: oldTag.records.concat(oldUntagged) }))));
  // mtime wins over draftedUtc: draftedUtc claims "recent", mtime says "before T0" -> silent.
  const lying = [1, 2].map(i => ({ hash: 'lie' + i, t: NOW - 5 * DAY, drafted: NOW - 1000 * i }));
  check('11: record time follows mtime, not a disagreeing draftedUtc',
        silent(readout(fixture({ events: tagged.events, records: tagged.records.concat(lying) }))));
  // Row 9: lane drift, only after >= 20 lane-tagged.
  const lane = approvesSpec(30, { source: 'interactive', lane: i => (i < 3 ? 'non-ticket' : 'ticket'), multi: 6 });
  check('9: 3 non-ticket of 30 lane-tagged -> line', has(readout(fixture(lane)), 'non-ticket pages'));
  const lane2 = approvesSpec(30, { source: 'interactive', lane: i => (i < 2 ? 'non-ticket' : 'ticket'), multi: 6 });
  check('9: 2 non-ticket -> silent', silent(readout(fixture(lane2))));
  const lane3 = approvesSpec(19, { source: 'interactive', lane: i => (i < 5 ? 'non-ticket' : 'ticket') });
  check('9: fewer than 20 lane-tagged -> silent even at 5 non-ticket', silent(readout(fixture(lane3))));
  const noTag = approvesSpec(30, { lane: i => (i < 5 ? 'non-ticket' : 'ticket'), multi: 6 });
  check('9: no source-tagged record yet (no cut-over) -> silent', silent(readout(fixture(noTag))));
}

console.log('\n== 10: unmatched approves ==');
{
  check('10: 5 of 40 unmatched -> line', has(readout(fixture(approvesSpec(40, { multi: 8, unmatched: 5 }))), 'no matching ticket-record'));
  check('10: 4 of 40 unmatched -> silent', silent(readout(fixture(approvesSpec(40, { multi: 8, unmatched: 4 })))));
}

console.log('\n== 12: exemption list (same predicate as the hook) ==');
{
  const id = i => (i.toString(16).padStart(32, '0'));
  const many = n => Array.from({ length: n }, (_, i) => id(i)).join('\n');
  check('12: 3,687 ids -> line', has(readout(fixture({ events: [], exempt: many(3687) })), 'exemption list holds 3687'));
  check('12: 3,686 ids -> silent', silent(readout(fixture({ events: [], exempt: many(3686) }))));
  check('12: duplicates and junk lines are not counted (3,686 distinct + dups + junk -> silent)',
        silent(readout(fixture({ events: [], exempt: many(3686) + '\n' + many(50) + '\n# comment\nnot-an-id\n' + 'A'.repeat(32).toLowerCase().replace(/a/g, 'g') }))));
  // Compare against the hook's own readExemptPages on the same file.
  const src = fs.readFileSync(HOOK, 'utf8');
  const m = src.match(/function readExemptPages\(\) \{[\s\S]*?\n\}\n/);
  check('the hook source has readExemptPages', !!m);
  check('the readout\'s cap matches the hook\'s TICKET_EXEMPT_CAP (4096)', /const TICKET_EXEMPT_CAP = 4096;/.test(src) &&
        /const EXEMPT_CAP = 4096;/.test(fs.readFileSync(READOUT, 'utf8')));
  if (m) {
    const sample = '﻿' + id(1) + '\r\n' + id(1).toUpperCase() + '\n  ' + id(2) + '  \n' + id(3) + '-x\n\n# c\n' + id(4) + '\n';
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gen636x-')), 'ex.txt');
    fs.writeFileSync(f, sample, 'utf8');
    const hookCount = new Function('fs', 'TICKET_EXEMPT_FILE', 'TICKET_EXEMPT_CAP', m[0] + '\nreturn readExemptPages().ids.size;')(fs, f, 4096);
    const mine = require(READOUT).countExempt(f);
    check('readout count equals the hook\'s readExemptPages count on a messy file (' + mine + ' vs ' + hookCount + ')', mine === hookCount && mine === 3);
  }
}

console.log('\n== 13/14: left-behind items ==');
{
  const r = readout(fixture({ events: [], consults: [{ target: 'abc', question: 'Which epic?', openedUtc: T(NOW - 3 * DAY), resolved: false }] }));
  check('13: an open consult -> line with age, target and question', has(r, 'still open (3 day(s), abc): "Which epic?"'), r.lines.join(' | '));
  check('13: resolved:true -> silent', silent(readout(fixture({ events: [], consults: [{ target: 'a', question: 'q', openedUtc: T(NOW), resolved: true }] }))));
  check('13: resolved:"abandoned" -> silent', silent(readout(fixture({ events: [], consults: [{ target: 'a', question: 'q', openedUtc: T(NOW), resolved: 'abandoned' }] }))));
  check('14: a wrap-surfaced-not-filed file -> line', has(readout(fixture({ events: [], wrapFiles: ['wrap-surfaced-not-filed-20261013.md'] })), 'waiting to be filed'));
  check('14: a renamed wrap-surfaced-filed file -> silent', silent(readout(fixture({ events: [], wrapFiles: ['wrap-surfaced-filed-20261013.md'] }))));
}

console.log('\n== 15: unclassified signals ==');
{
  check('15: an unknown event kind -> line', has(readout(fixture({ events: [blk(undefined, 1, 'claim-lost')] })), 'event "claim-lost"'));
  check('15: an unknown block reason -> line', has(readout(fixture({ events: [blk('brand-new-reason', 1)] })), 'reason "brand-new-reason"'));
  check('15: a not-wired REST reason that appears -> line', has(readout(fixture({ events: [blk('rest-not-via-script', 1)] })), 'not-wired reason "rest-not-via-script"'));
  check('15: an unknown reason older than 7 days -> silent', silent(readout(fixture({ events: [blk('brand-new-reason', 8)] }))));
  check('15: an unknown event kind with NO ts (in the last 100 lines) -> still reported',
        has(readout(fixture({ events: [{ event: 'mystery-kind', tool: 't' }] })), 'event "mystery-kind"'));
}

console.log('\n== code-review fixes ==');
{
  check('13: resolved:"true" (string) counts as closed -> silent',
        silent(readout(fixture({ events: [], consults: [{ target: 'a', question: 'q', openedUtc: T(NOW), resolved: 'true' }] }))));
  // Same hash reviewed twice: an old interactive record and a newer wrap-step1 record. A waived approve logged
  // BETWEEN them belongs to the OLD record, so row 6b (waived + unattended) must stay silent.
  const h = 'dup-hash-1';
  const r = readout(fixture({
    events: [{ ts: T(NOW - 2 * DAY), event: 'approve', tool: 't', target: 'p', hash: h, waived: true }],
    records: [{ name: 'dup-old', hash: h, t: NOW - 2 * DAY - 60000, waived: true, extra: { source: 'interactive' } },
              { name: 'dup-new', hash: h, t: NOW - 1 * DAY, extra: { source: 'wrap-step1' } }] }));
  check('a duplicate content hash joins the approve to the record written just before it (no false 6b)', !has(r, 'UNATTENDED run'), r.lines.join(' | '));
}

console.log('\n== Pass B fixes ==');
{
  // A misspelt / empty source value is NOT a valid tag: it does not set the cut-over, counts as untagged for
  // row 11, and is named by row 15.
  const tagged = approvesSpec(2, { source: 'interactive' }); tagged.records.forEach(rc => { rc.t = NOW - 3 * DAY; });
  const bad = [1, 2].map(i => ({ hash: 'bad' + i, t: NOW - DAY + i, extra: { source: i === 1 ? 'wrap' : '' } }));
  const r = readout(fixture({ events: tagged.events, records: tagged.records.concat(bad) }));
  check('11: records with an invalid source value count as untagged', has(r, 'without a valid source tag'), r.lines.join(' | '));
  check('15: an invalid record source value is named', has(r, 'record source "wrap"') && has(r, 'record source ""'), r.lines.join(' | '));
  const onlyBad = readout(fixture({ events: [], records: [{ hash: 'b1', t: NOW - DAY, extra: { source: 'wrap' } }, { hash: 'b2', t: NOW - DAY, extra: { source: 'wrap' } }] }));
  check('an invalid source value does not create a cut-over (row 11 silent, row 15 names it)',
        !has(onlyBad, 'without a valid source tag') && has(onlyBad, 'record source "wrap"'), onlyBad.lines.join(' | '));
  // Newlines in a consult's text cannot split a relayed line.
  const nl = readout(fixture({ events: [], consults: [{ target: 'a\nb', question: 'line1\nline2\r\nline3', openedUtc: T(NOW), resolved: false }] }));
  check('13: newlines in a consult are flattened (one line, prefixed)', nl.lines.length === 1 && nl.lines[0].indexOf('Ticket gate:') === 0 && nl.lines[0].indexOf('line1 line2 line3') !== -1, nl.lines.join(' | '));
  // A non-string hash on an approve cannot throw the join.
  const s = approvesSpec(40, { multi: 8 }); s.events[5].hash = { toString: null }; s.events[6].hash = 12345;
  const rh = readout(fixture(s));
  // Final Pass B advisories.
  const tsObj = readout(fixture({ events: ['{"ts":{"toString":1},"event":"approve","hash":"x","waived":false}'],
                                  consults: [{ target: 'a', question: 'q', openedUtc: { toString: 1 }, resolved: false }] }));
  check('a non-string ts / openedUtc cannot blank the readout (no "readout failed")', tsObj.code === 0 && !has(tsObj, 'readout failed'), tsObj.lines.join(' | '));
  check('1: internal-errors cleared under break-glass still count toward row 1',
        has(readout(fixture({ events: [blk('internal-error', 1), blk('internal-error', 1, 'break-glass-skip')] })), 'internal-error blocks'));
  const badLane = readout(fixture({ events: [], records: [{ hash: 'l1', t: NOW - DAY, extra: { source: 'interactive', lane: 'nonticket' } }] }));
  check('15: an invalid lane value is named', has(badLane, 'record lane "nonticket"'), badLane.lines.join(' | '));
  const ph = approvesSpec(40, { multi: 0 });
  ph.records.slice(0, 10).forEach(rc => { rc.extra = { priorReviewerAgentIds: ['<any earlier REVISE rounds, for the audit trail>'] }; });
  check('8: template placeholders in priorReviewerAgentIds do not count as review rounds (lenient line still fires)',
        has(readout(fixture(ph)), 'may have gone lenient'));
  const weird = readout(fixture({ events: ['{"ts":"' + T(NOW - 1000) + '","event":{"toString":null}}', '{"ts":"' + T(NOW - 1000) + '","event":"block","reason":{"toString":null}}'] }));
  check('15: an un-stringable event/reason value is named, not a row failure', has(weird, '[unprintable]') && !has(weird, 'could not be computed'), weird.lines.join(' | '));
  check('a non-string approve hash does not throw (no "could not be computed", no "failed")',
        rh.code === 0 && !has(rh, 'could not be computed') && !has(rh, 'readout failed'), rh.lines.join(' | '));
}

console.log('\n== robustness ==');
{
  const s = approvesSpec(40, { multi: 8 });
  s.records[0].bom = true; s.records[1].hash = s.records[1].hash.toUpperCase();
  check('BOM-prefixed records and uppercase hashes still join (silent)', silent(readout(fixture(s))));
  const r = readout(fixture({ events: [], extraPassFiles: [{ name: 'null.json', body: 'null' }, { name: 'arr.json', body: '[1]' }, { name: 'bad.json', body: '{' },
                                                               { name: 'x.consumed.123.json', body: '{"kind":"ticket-record"}' }] }));
  check('null / array / malformed / consumed pass files are skipped without a throw', silent(r), r.lines.join(' | ') + r.err);
  check('empty staging dir (no files at all) -> only the missing-log line', (() => { const x = readout(fixture({ noLog: true })); return x.lines.length === 1 && x.code === 0; })());
  const nodir = spawnSync(process.execPath, [READOUT, '--staging', path.join(os.tmpdir(), 'does-not-exist-gen636'), '--claude-dir', path.join(os.tmpdir(), 'nope-gen636')], { encoding: 'utf8' });
  check('nonexistent dirs -> exit 0, only the missing-log line', nodir.status === 0 && (nodir.stdout || '').trim().split('\n').length === 1, nodir.stdout + nodir.stderr);
  // A row-level throw prints only its own line: force row 13 to throw via a consult whose target getter throws is
  // not expressible in JSON, so instead give a records dir entry that is a DIRECTORY named *.json (readFileSync throws EISDIR -> skipped).
  const fx = fixture({ events: [] }); fs.mkdirSync(path.join(fx.staging, 'ticket-passes', 'dir.json'));
  check('a directory named *.json in ticket-passes is skipped (exit 0, silent)', silent(readout(fx)));
  const records = Array.from({ length: 3 }, (_, i) => ({ hash: 'nd' + i, t: NOW - i * 1000 }));
  const fx2 = fixture({ events: approvesSpec(1).events, records: records });
  for (const f of fs.readdirSync(path.join(fx2.staging, 'ticket-passes'))) {
    const p = path.join(fx2.staging, 'ticket-passes', f); const o = JSON.parse(fs.readFileSync(p, 'utf8')); delete o.draftedUtc; fs.writeFileSync(p, JSON.stringify(o));
  }
  check('records without draftedUtc do not throw', readout(fx2).code === 0);
}

console.log('\n== coverage: every event/reason the hook can log is in CLASS, and CLASS has nothing extra ==');
{
  const src = fs.readFileSync(HOOK, 'utf8');
  const events = new Set(), reasons = new Set();
  for (const m of src.matchAll(/event:\s*'([a-z-]+)'/g)) events.add(m[1]);
  for (const m of src.matchAll(/reason:\s*'([a-z-]+)'/g)) reasons.add(m[1]);
  // Reasons chosen by a ternary on a line that assigns a reason (exempt-list-*, stale-content/no-pass) --
  // scanned ONLY inside the three functions whose reasons reach the event log, so a CLI's own message
  // ternary (e.g. --ticket-hash-shell's 'exempt' : 'not-canonical') is not mistaken for a logged reason.
  for (const fname of ['enforceTicketVetting', 'ticketScope', 'ticketShellScope']) {
    const body = src.match(new RegExp('function ' + fname + '\\([\\s\\S]*?\\n\\}\\n'));
    check('found the body of ' + fname + ' for the ternary scan', !!body);
    if (!body) continue;
    for (const line of body[0].split('\n')) {
      if (!/reason/.test(line)) continue;
      for (const m of line.matchAll(/\?\s*'([a-z-]+)'\s*:\s*'([a-z-]+)'/g)) { reasons.add(m[1]); reasons.add(m[2]); }
    }
  }
  // ticketTokenVerdict's non-ok returns are logged as the block reason (`reason: v`).
  const tv = src.match(/function ticketTokenVerdict\([\s\S]*?\n\}\n/);
  if (tv) for (const m of tv[0].matchAll(/return '([a-z-]+)';/g)) if (m[1] !== 'ok') reasons.add(m[1]);
  // REST-arm classifier returns (not wired, but listed).
  for (const m of src.matchAll(/return '(rest-[a-z-]+)';/g)) reasons.add(m[1]);
  const { CLASS } = require(READOUT);
  const missingE = [...events].filter(e => !(e in CLASS.event));
  const missingR = [...reasons].filter(r => !(r in CLASS.reason));
  const extraE = Object.keys(CLASS.event).filter(e => !events.has(e));
  const extraR = Object.keys(CLASS.reason).filter(r => !reasons.has(r));
  check('every hook event literal is classified (' + events.size + ' found)', missingE.length === 0, 'missing: ' + missingE);
  check('every hook reason literal is classified (' + reasons.size + ' found)', missingR.length === 0, 'missing: ' + missingR);
  check('CLASS has no event the hook never logs', extraE.length === 0, 'extra: ' + extraE);
  check('CLASS has no reason the hook never logs', extraR.length === 0, 'extra: ' + extraR);
  check('connector-mismatch is extracted from the hook (the GEN-834 branch is present)', reasons.has('connector-mismatch'));
}

console.log('\n' + (fail === 0 ? 'ALL PASS: ' : 'FAILURES: ') + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail === 0 ? 0 : 1;
