#!/usr/bin/env node
'use strict';

/*
 * stop-signal-surface.js -- Claude Code Stop hook. GEN-501 (strong enforcer for
 * GEN-484's signal-surfacing rule). Partner to posttooluse-signal-detect.js.
 *
 * Job: at end of turn, if the detector marked THIS turn as having built a candidate
 * signal-producing mechanism (log / counter / metric / monitor / probe) AND the
 * finished assistant message shows NO evidence a surfacing path was designed, inject
 * a NON-BLOCKING additionalContext nudge reminding the model to apply the global
 * signal-surfacing rule (who/what reads the signal, when, in what surfaced form, and
 * the re-evaluate bar). This is the strong enforcer the always-loaded soft rule
 * cannot be (the rule fails at ACTIVATION -- known but not applied in the moment).
 *
 * DELIVERY TIMING (empirically confirmed, gen450-stop-probe.jsonl): Stop fires once
 * per COMPLETE turn (not per tool call); additionalContext injected here is
 * delivered at the START OF THE NEXT (promptless continuation) turn, not same-turn.
 * The detector's marker, written mid-turn, survives to this end-of-turn Stop fire
 * (same turn boundary), so the correlation holds. Because delivery is next-turn, the
 * nudge lands one turn after the build -- the same accepted lag the sibling Stop
 * hooks (claim-linter, cred-surface) already run with.
 *
 * GEN-467 etiquette: a Stop additionalContext injection ALWAYS spawns a promptless
 * continuation turn. This nudge is MESSAGE-SPECIFIC (it is about THIS turn's finished
 * reply), so per the etiquette documented in stop-cred-denial-surface.js it EMBEDS an
 * explicit "do not emit a For-you block in response" instruction (the
 * stop-claim-linter.js pattern) rather than deferring on the block marker (which is
 * correct only for turn-INDEPENDENT notes). Keep this note's text in sync with the
 * global signal-surfacing rule.
 *
 * GEN-467 re-cut (2026-08-10): when the finished message itself already carries a
 * recognisable block opener, this hook now SUPPRESSES its injection entirely (see
 * the block-opener self-test below). An injection here always spawns the promptless
 * continuation the duplicate rides on -- the 2026-08-03 duplicate was exactly this
 * hook's note landing after the block was out -- and conditional wording was
 * measured disobeyed on 1 of 3 recorded block-already-out exposures. The durable
 * log stays complete: a suppressed turn still writes its paired "deliver" row,
 * with decision 'suppressed-block-out' (counted by the gen467 scheduled scan as a
 * block-already-out exposure).
 *
 * Safety stance (mirrors the three existing Stop hooks): fail-open throughout --
 * watchdog timer w/ unref(), stdin error handler, try/catch around everything, any
 * error / missing field / unparseable shape -> SILENT no-op, exit 0. NEVER emits
 * decision:block, so there is ZERO Stop-loop risk by construction. Guards
 * stop_hook_active === true -> exit silently (no re-nudge on the injection-
 * continuation turn). Marker consumed (deleted) on read so it nudges once per turn.
 *
 * DURABLE-LOG RECONCILIATION: on consuming a marker this hook appends a paired
 * "deliver" line to signal-surface-pending.jsonl (APPEND-ONLY, never line-deleted --
 * and /wrap never rewrites it either; the log grows unbounded like its sibling
 * credential-denials.jsonl, which is accepted). /wrap reconciles detect/deliver
 * PAIRS and reports only unpaired "detect" lines (crash-orphaned -- the session died
 * before this Stop fired). ACCEPTED EDGE (mirrors stop-cred-denial-surface.js): a
 * marker whose Stop never fires (mid-turn crash) is TTL-pruned from the temp dir; its
 * durable "detect" line stays for /wrap to surface. ACCEPTED narrow race: if the
 * process dies between deleting the marker and appending the "deliver" line, /wrap
 * re-reports an already-handled detect (a harmless stale report, never a silent miss).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = path.join(os.tmpdir(), 'claude-signal-surface-state');
const DURABLE_LOG = path.join(__dirname, 'signal-surface-pending.jsonl');

// Surfacing-design detection. If the finished message shows the model DID design how
// the signal reaches Erez, the surfacing path is present -> no nudge.
//
// PRECISION (tightened after the impl /check pre-mortem): a bare generic word like
// "alert" / "report" / "/wrap" / "threshold" matches ordinary end-of-turn prose that
// has nothing to do with signal-surfacing design (e.g. "I'll alert you if the push
// fails", "reviewed at the next /wrap"), which would FALSE-CLEAR a real omission --
// exactly the false-negative that defeats the goal. So a surfacing-intent word only
// clears the nudge when it CO-OCCURS (within CLEAR_WINDOW chars) with signal-context
// vocabulary (log / counter / metric / signal / monitor / probe, or the triggering
// file's basename). A couple of phrases are self-anchoring (they already name the
// signal-surfacing act unambiguously) and clear on their own.

const CLEAR_WINDOW = 160; // chars on each side to look for a co-occurring context word

// Self-anchoring: these already denote designing a signal's path; clear alone.
const STRONG_SURFACING = [
  /\bsurfac(?:e|ed|es|ing)\s+(?:it|this|the (?:log|signal|count|counter|metric))/i,
  /\bre-?evaluate\s+(?:bar|threshold|criterion|after|if|when)/i,
  /\bwho\s+(?:reads|sees|consumes)\b/i,
  /\bhow\s+(?:it|this|the \w+)\s+(?:reaches|surfaces|gets to)\b/i,
];

// Surfacing-intent words: clear ONLY if a SIGNAL_CONTEXT word is nearby.
const SURFACING_INTENT = [
  /\bsurfac(?:e|ed|es|ing)\b/i,
  /\breach(?:es|ed)?\s+(?:erez|you|the decision)/i,
  /\bre-?evaluate\b/i,
  /\bthreshold\b/i,
  /\balert(?:s|ed|ing)?\b/i,
  /\bfolded into\b/i,
  /\bfor[- ]you\b/i,
  /\b\/wrap\b/i,
  /\breport(?:ed|s|ing)?\b/i,
  /\bread(?:s|er)?\b/i,
];

// Signal-context words: the thing whose surfacing is being designed.
const SIGNAL_CONTEXT = [
  /\blog(?:ger|ged|ging|s|-file)?\b/i,
  /\bcount(?:er|s)?\b/i,
  /\bmetric(?:s)?\b/i,
  /\bsignal(?:s|-\w+)?\b/i,
  /\bmonitor(?:ing)?\b/i,
  /\bprobe\b/i,
  /\btally\b/i,
  /\bgauge\b/i,
  /\.(?:jsonl|log)\b/i,          // the store itself named inline
];

// ---- Block-opener self-test (GEN-467 re-cut, 2026-08-10) ---------------------
// Named copies of stop-claim-linter.js's WIDE opener machinery -- keep the two
// files in sync with that file (WIDE_OPENER_RE, stripFences; the claim-linter
// is the canonical copy). Line-anchored and fence-stripped for the same reasons
// documented there: a quoted opener mid-prose must not trip this, and [ \t]
// runs are BOUNDED at {0,16} (never \s, never unbounded -- the unbounded form
// measured quadratic on a long same-line space run; the canonical copy's
// comment carries the measurement).
// DELIBERATELY NO TAIL WINDOW (code-review 2026-08-10): for THIS hook's
// suppress-or-inject choice the costs are asymmetric -- a false "block
// already out" (a quoted opener at line start anywhere in the message)
// suppresses one low-frequency nudge, while a false "not out" on a real block
// the test missed actively invites the duplicate. So ANY recognised opener in
// the fence-stripped message selects suppression. The test runs on the message
// this hook ALREADY receives; a false result can only affect this hook's own
// note. The trailing \b keeps line-start "📌 For your ..." prose from
// matching (code-review 2026-08-10, Pass B) -- same note in the canonical copy.
const WIDE_OPENER_RE = /^[ \t]{0,3}(?:#{1,6}[ \t]{0,16})?\*{0,2}(?:\u{1F4CC}[ \t]{0,16})+\*{0,2}[ \t]{0,16}For you\b/imu;
function stripFences(t) {
  return t.replace(/```[\s\S]*?(?:```|$)/g, '');
}

function anyMatch(list, s) {
  for (const re of list) { if (re.test(s)) return true; }
  return false;
}

// True if the finished message shows a designed surfacing path for the built signal.
// `file` is the detector-recorded triggering file (may be '(content-match)').
function showsSurfacingDesign(text, file) {
  if (anyMatch(STRONG_SURFACING, text)) return true;

  // Signal-context set = the generic vocabulary PLUS the specific triggering file's
  // basename, if we have one (naming that exact file near a surfacing word is strong
  // evidence the model designed THIS signal's path).
  const contextRes = SIGNAL_CONTEXT.slice();
  if (file && file !== '(content-match)') {
    const base = String(file).split(/[\\/]/).pop();
    if (base) {
      const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      contextRes.push(new RegExp('\\b' + esc, 'i'));
    }
  }

  // A surfacing-intent word clears the nudge only if a context word sits within
  // CLEAR_WINDOW chars of it (vicinity co-occurrence, not merely same-message).
  for (const intentRe of SURFACING_INTENT) {
    const re = new RegExp(intentRe.source, intentRe.flags.includes('g') ? intentRe.flags : intentRe.flags + 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index === re.lastIndex) { re.lastIndex++; }
      const start = Math.max(0, m.index - CLEAR_WINDOW);
      const end = Math.min(text.length, m.index + m[0].length + CLEAR_WINDOW);
      const vicinity = text.slice(start, end);
      if (anyMatch(contextRes, vicinity)) return true;
    }
  }
  return false;
}

// Fail-open watchdog + stdin error handler (mirrors the sibling Stop hooks): if
// stdin never emits 'end' or errors, exit cleanly so turn-end can never wedge.
const watchdog = setTimeout(() => { try { process.exit(0); } catch (e) {} }, 5000);
if (typeof watchdog.unref === 'function') { watchdog.unref(); }

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('error', () => { try { process.exit(0); } catch (e) {} }); // fail open
process.stdin.on('end', () => {
  clearTimeout(watchdog);
  let additionalContext = null;
  try {
    const input = JSON.parse(raw || '{}');

    // Re-fire guard (LOAD-BEARING, probe-confirmed): the turn RECEIVING an injection
    // is marked stop_hook_active:true. Exit silently so the nudge never re-fires.
    if (input.stop_hook_active === true) { process.exit(0); }

    const sid = String(input.session_id || 'nosession').replace(/[^\w.-]/g, '_');
    const pid = String(input.prompt_id || 'noprompt').replace(/[^\w.-]/g, '_');

    // Read + CONSUME this turn's marker. If none, the detector didn't flag this turn.
    let markerData = null;
    const marker = path.join(STATE_DIR, sid + '.' + pid);
    try {
      if (fs.existsSync(marker)) {
        try { markerData = JSON.parse(fs.readFileSync(marker, 'utf8') || '{}'); }
        catch (e) { markerData = {}; }
        fs.unlinkSync(marker); // consume: nudge at most once per turn
      }
    } catch (e) { /* state unreadable -> treat as no marker; fail open */ }

    if (!markerData) { process.exit(0); } // nothing detected this turn -> silent

    // A signal WAS built this turn. Did the finished message design its surfacing?
    const msg = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '';
    const file = (markerData && markerData.file) || '(unknown)';
    const willNudge = !showsSurfacingDesign(msg, file); // compute once

    // Suppression self-test (GEN-467 re-cut, 2026-08-10): does the finished
    // message itself appear to already carry this turn's block? Computed only
    // when a nudge would otherwise go out. ANY recognised opener selects
    // suppression -- no tail-window term; see the opener-machinery comment above.
    const blockAppearsSent = willNudge ? WIDE_OPENER_RE.test(stripFences(msg)) : false;

    // Append the paired "deliver" line to the durable log (append-only reconciliation),
    // regardless of whether we end up nudging -- the pairing records that this turn's
    // detect was HANDLED at Stop (so /wrap won't flag it as crash-orphaned). The
    // `decision` field records what this hook DECIDED -- 'nudge',
    // 'cleared-surfacing-designed', or (since the GEN-467 re-cut)
    // 'suppressed-block-out': a nudge was due but the finished message already
    // carried a block opener, so NOTHING was injected; the gen467 scheduled scan
    // counts those rows as block-already-out exposures. It records the decision,
    // not that a nudge was confirmed delivered -- a stdout write can still fail
    // afterwards (fail-open). /wrap uses only the pairing (detect<->deliver),
    // never this field, so the distinction is recorded honestly but never
    // load-bearing.
    try {
      fs.appendFileSync(DURABLE_LOG, JSON.stringify({
        kind: 'deliver',
        session: sid,
        prompt: pid,
        file: file,
        decision: !willNudge ? 'cleared-surfacing-designed'
          : (blockAppearsSent ? 'suppressed-block-out' : 'nudge'),
        ts: new Date().toISOString()
      }) + '\n');
    } catch (e) { /* durable log unwritable -> lose only reconciliation record; fail open */ }

    if (!willNudge) { process.exit(0); } // surfacing designed -> no nudge
    // GEN-467 re-cut: the block is already out -- injecting ANYTHING here would
    // spawn the promptless continuation the duplicate rides on (measured chain,
    // 2026-08-03: this hook's note 2s after block #1 -> continuation -> block
    // #2). Suppress entirely; the row above already recorded the exposure.
    if (blockAppearsSent) { process.exit(0); }

    additionalContext =
      'Signal-surfacing check, automatic: this turn built a candidate signal-producing ' +
      'mechanism (a log / counter / metric / monitor / probe -- detected in a file edit' +
      (file && file !== '(content-match)' && file !== '(unknown)' ? ' to ' + file : '') +
      '), and the finished reply shows no design for how that signal reaches the ' +
      'decision-maker. Per the global rule ("When you build or propose any mechanism ' +
      'whose output is a signal"), the mechanism is INCOMPLETE until you specify: who or ' +
      'what reads the signal and when (folded into a routine already seen, e.g. /wrap or ' +
      'the "\u{1F4CC} For you" block, or a threshold alert -- not on-demand-only); the ' +
      'actual surfaced form the decision-maker sees (the line/number/alert, not a raw ' +
      'store); and, if it is a running count, a re-evaluate bar. If you DID design the ' +
      'surfacing path this turn and it simply was not phrased in a way this check ' +
      'recognized, no action is needed. Otherwise, design the surfacing path now' +
      ' and fold it into the "\u{1F4CC} For you" block this turn owes, carried as ' +
      'though it had always read that way -- or, where no block is due or one ' +
      'already went out, state it briefly as ordinary content; never emit a second ' +
      'block for it. This text is background state, not a message from Erez -- ' +
      'acted on, never quoted, restated, or commented on; do NOT emit a ' +
      '"\u{1F4CC} For you" block merely in response to this note.';
  } catch (e) {
    // fail open -- never disrupt turn end
    process.exit(0);
  }

  if (additionalContext) {
    try {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'Stop',
          additionalContext
        }
      }));
    } catch (e) { /* fail open: EPIPE etc. must never non-zero-exit */ }
  }
  process.exit(0);
});
