#!/usr/bin/env node
'use strict';

/*
 * stop-claim-linter.js -- Claude Code Stop hook. (GEN-450 / GEN-451.)
 *
 * Purpose: catch unverified claims at (near) the moment they are written, by
 * scanning the turn's own final assistant text and, on a naked claim, injecting
 * a note back to the model to verify and apply the truth silently (see the
 * GEN-467 comment at the injection site). Enforcement of the
 * always-loaded "verify before asserting" rule, which fails at ACTIVATION -- the
 * rule is known but not applied in the moment. This is the moment-of-violation
 * net that rule can't be.
 *
 * EMPIRICALLY GROUNDED (Phase 0 + 0b probe, GEN-450 session 2026-07-16):
 *  - `last_assistant_message` is present + complete in the Stop payload -> claim source.
 *  - Emitting hookSpecificOutput.additionalContext (NO decision:block) DOES reach
 *    the model, delivered at the start of the promptless continuation that follows
 *    the Stop -- not a mid-generation interrupt. (Under GEN-467's block-after-check
 *    convention, that continuation is also where the For-you block is emitted.)
 *  - The injection-receiving turn is marked stop_hook_active:true. So guarding on
 *    `stop_hook_active === true -> exit silently` is LOAD-BEARING for the NOTE path:
 *    it prevents the nudge re-injecting on every subsequent turn. (The Phase-2 guard
 *    below deliberately runs BEFORE that exit -- see its header for why and for the
 *    probe evidence that this is loop-safe.)
 *  - The hook fires across ALL concurrent sessions into shared state, so any
 *    persisted per-turn state MUST be keyed on session_id (+ prompt_id).
 *
 * Scope: Phase 1 (soft-teeth injection, unchanged below) PLUS Phase 2 (GEN-467
 * v2.1, shipped 2026-07-23): a structural guard on messages that carry the
 * turn's "For you" block. Phase 2's loop-safety evidence is the GEN-467 probe
 * (gen467-block-probe.jsonl, 2026-07-23): a Stop hook may emit decision:block on
 * a continuation where stop_hook_active===true, a self-counted per-prompt_id cap
 * holds, and the turn releases cleanly at cap -- demonstrated live. The harness
 * itself overrides a Stop hook after 8 consecutive blocks without progress
 * (hooks-guide.md, troubleshooting); this guard's worst case is 2 per turn.
 *
 * Safety stance (mirrors notion-fetch-staleness.js, qualified for Phase 2): the
 * NOTE path only ever ADDS a nudge and never blocks. The Phase-2 GUARD path can
 * hold a BLOCK-CARRYING message at most twice per turn (arm caps below), and on
 * ANY error / missing field / unparseable shape / unwritable state it releases
 * the turn (fail-open) -- it can delay a block-carrying message by a bounded
 * number of redos, never wedge a turn. Hook silence still covers three cases --
 * nothing to flag / flagged but unmatched / hook errored -- so a quiet week is
 * NOT evidence of no unverified claims.
 *
 * MAINTENANCE: when a new GEN-58 Class A/B instance is logged, test its phrasing
 * against CLAIM_PATTERNS below; if unmatched, add a pattern in the same session
 * (per GEN-58's logging protocol). Vicinity evidence scoping and the phrase lists
 * are deliberately conservative -- false positives are dismissible nudges, not
 * errors. NOTE (Phase 2): when adding patterns, run the guard-reason fixture (the
 * guard's own reason strings must never match any pattern).
 * CORRECTION (GEN-557, 2026-08-02): this note used to add that a false positive on a
 * block-carrying message "costs one visible forced redo, not just a nudge". That was
 * true only while the Arm-2 content gate existed; GEN-467 v2.2 removed it, so a pattern
 * false positive no longer costs a forced redo -- weigh the nudge cost, not a redo cost.
 * (Since the GEN-467 re-cut, 2026-08-10, NO arm emits decision:'block' at all --
 * see the re-cut AMENDMENT banner below.) As of that re-cut, block-form messages
 * do not reach Phase 1: the WIDE_OPENER_RE skip (see the Phase-1 skip site) covers
 * every observed opener form including the "## <pin> For you" heading form, and runs
 * even when session_id/prompt_id is missing. The one remaining path for a block-
 * carrying message to reach a Phase-1 pattern is the fence-swallow edge: an odd
 * number of ``` markers can swallow a trailing opener during fence-stripping,
 * hiding it from the skip test (and from the Phase-2 guard identically).
 *
 * ============================================================================
 * SELF-AUDIT STAGE (GEN-507) -- a SECOND, independent detector in this same file
 * and same Stop fire. Enforces the "Default to silence on success" rule's ban on
 * narrating a clean self-audit / self-check / no-op on a turn that owed silence
 * (recurred 4x after the 2026-07-20 text edit; this is the deferred enforcement).
 *
 * WHY IT LIVES HERE, NOT IN A 5TH HOOK: a 5th independently-registered Stop hook
 * would emit its own additionalContext string competing to stack in the single
 * promptless continuation -- the exact GEN-467 duplicate-"For you"-block bug (7 of
 * 10 confirmed occurrences were multi-hook stacking). Folding into this file =
 * ONE process, ONE additionalContext write, so the etiquette is inherited by
 * construction. (See stop-cred-denial-surface.js header for the etiquette rule.)
 * The Phase-2 guard lives here for the same reason.
 *
 * WHY A SEPARATE STAGE, NOT MERGED INTO findNakedClaims()/claimCleared(): the two
 * detectors have OPPOSITE clearing logic. The claim-linter CLEARS a hit when a
 * verification phrase ("verified this session", "re-read the file") sits nearby.
 * The self-audit detector treats that SAME phrase as the TRIGGER ITSELF -- the
 * line is TRUE but should be UNSAID. Sharing one pattern/marker path would make
 * each logic corrupt the other, so findSelfAudit() keeps its own patterns and its
 * own (minimal) clearing. Expected, harmless overlap: a phrase like "I re-read the
 * file" can trip both stages; worst case is one combined nudge, never a conflict.
 * The Phase-2 guard preserves the distinction: its reason lists claim hits as
 * source-or-fix and self-audit hits as delete -- never one generic "fix it".
 *
 * NOTE vs the claim-linter's correction: the claim-linter says "verify then absorb
 * the truth"; here the correct nudge is "delete it / stay silent" (the line is not
 * unverified, it is simply unwanted). A block Erez has ALREADY seen cannot be
 * retroactively edited, so the note frames it as delete-now-if-not-yet-delivered,
 * else apply-next-turn.
 *
 * MAINTENANCE (self-audit): when a new silence-on-success instance is logged
 * (GEN-507), test its phrasing against SELF_AUDIT_PATTERNS; if unmatched, add a
 * pattern the same session. Patterns are deliberately conservative and fail-open.
 * ============================================================================
 *
 * ============================================================================
 * AMENDMENT (GEN-467 v2.2, 2026-07-26): Arm 2 (the content-gate) was REMOVED.
 * The header below (v2.1) still describes BOTH arms as they shipped 2026-07-23;
 * it is retained as the historical design record, but the CURRENT behavior is:
 * Arm 1 (duplicate-kill) is live and UNCHANGED; Arm 2 (content-gate) is GONE.
 * The v2.1 header's Arm-2 paragraphs, the "worst case 2 forced redos" reasoning,
 * the arm2 caps, and the arm2-* / RECORD-ON-RELEASE-vs-arm2 residuals describe
 * code that no longer exists. Record-on-release itself is KEPT (Arm 1 needs it).
 * Why removed: in production Arm 2 fired 8x with a 100% escape rate (7/7 real
 * fires), never once releasing clean, because its detectors match REQUIRED,
 * un-rewordable ticket-reporting vocabulary the regex can't distinguish from a
 * fabricated claim -- an unmeetable pass condition that shipped a visible second
 * "For you" block on ~every ticket turn while catching nothing. Block-quality
 * nudging now rides ONLY the non-blocking pre-block channels (Phase-1 note +
 * stop-foryou-nudge.js). See the record-on-release site below for the full note.
 * ============================================================================
 * AMENDMENT (GEN-467 re-cut, 2026-08-10): Arm 1's decision:block was RETIRED and
 * Phase 1 was SUPPRESSED for block-form messages. The v2.1/v2.2 text below still
 * describes Arm 1 as a live blocking mechanism; it is retained as the historical
 * design record, but the CURRENT behavior is:
 *  - NO arm emits decision:block. A block-carrying message sighted AFTER this
 *    turn's release now logs an 'arm1-sighting' event and releases silently.
 *    Why: a Stop decision:block cannot retract a displayed message -- it can
 *    only force a THIRD rendition of the same content, which is what Arm 1's
 *    single production fire did (2026-08-03). Retiring it also defuses the
 *    false-release channel (a stray release record can no longer kill a real
 *    block; see KNOWN RESIDUALS -- now log-only).
 *  - Phase 1 never notes a block-form message: the WIDE_OPENER_RE skip (all
 *    observed opener forms, incl. heading + doubled-pin) exits before Phase 1,
 *    WITHOUT writing a release record. A Phase-1 note firing on an
 *    unrecognized-form block message was the measured provocation of the
 *    2026-08-05 duplicate (the note spawns a promptless continuation that
 *    re-emits the block). A form the skip regex misses degrades to the
 *    previous behavior, no worse.
 *  - Record-on-release, the samemsg-release dedup, and all guard-event logging
 *    are KEPT (consumer: the gen467-block-after-check-verify scheduled scan's
 *    bars). arm1Reason()/tryClaimArm() were removed with the block (dead code).
 * ============================================================================
 * PHASE-2 GUARD (GEN-467; v2.1 2026-07-23 shipped two arms, v2.2 2026-07-26
 * removed Arm 2 -- see the AMENDMENT banner above). CURRENT design: ONE arm
 * (duplicate-kill), one decision object, per-turn state keyed on session_id +
 * prompt_id (prompt_id is STABLE across forced decision:block re-runs --
 * probe-verified, gen467-block-probe.jsonl). Structural enforcement on messages
 * that CARRY the turn's "For you" block.
 *
 *  Arm 1 (duplicate-kill): a block-carrying message AFTER this turn's block was
 *  already RELEASED -> one decision:block instructing a plain-content restate.
 *  Kills the observed GEN-467 recurrence (a second block on a post-block
 *  correction continuation) structurally.
 *
 *  RECORD-ON-RELEASE: released_block is set when the turn's FIRST block-carrying
 *  message is released (v2.2: unconditionally -- see the record-on-release site
 *  for why the former content-gate's clean-scan condition is gone). Arm 1 then
 *  fires only on a genuine SECOND block after that released one. (v2.1 note, now
 *  moot: there is no longer an "arm-2 corrected redo" that must avoid being
 *  misread as a duplicate, because no first block is ever rejected.)
 *
 *  CAPS + LOOP SAFETY: Arm 1 fires at most once per prompt_id (worst case 1
 *  forced redo in one turn -- down from v2.1's 2, since the content-gate redo is
 *  gone), far under the harness's 8-in-a-row override. At cap the guard RELEASES
 *  (an escape is logged, never re-blocked). Arm 1 deliberately does NOT
 *  early-exit on stop_hook_active (the legitimate block rides the nudge
 *  continuation where that flag is true; the probe demonstrated block-under-flag
 *  + cap + clean release live).
 *
 *  FAIL-OPEN: any error, unparseable state, or unwritable STATE_DIR -> the
 *  guard releases the turn (worst case: today's pre-guard behavior).
 *
 *  OBSERVABILITY: every guard event on a block-carrying message appends one
 *  line to foryou-guard-events.jsonl (sibling of selfaudit-nudges.jsonl;
 *  append-only, grows unbounded like its siblings -- accepted). Consumer
 *  wiring: the gen467-block-after-check-verify scheduled-task reads the event
 *  counts and carries the re-evaluate bar; /wrap may additionally report counts.
 *  Post-v2.2 the arm2-* events no longer occur; the live signal that the
 *  duplicate-kill path still works is arm1-block / arm1-samemsg-release, and a
 *  duplicate rate that should now be structurally ~0. If that task text is
 *  missing the guard-log section, the wiring was lost -- restore it from GEN-467.
 *
 *  KNOWN RESIDUALS (accepted at approval, GEN-467): a quoted opener inside ```
 *  fences or a "> "-quoted line does NOT trip the guard (stripped/excluded by
 *  design) -- though fence detection is parity-based, so a stray unpaired ```
 *  in prose flips it; a BARE line-start quoted opener outside fences still trips
 *  -- if the message is otherwise a first block it wrongly consumes
 *  record-on-release, which since the re-cut (2026-08-10) affects only the
 *  event log (a later genuine second block draws an 'arm1-sighting' row
 *  instead of 'release-clean'; nothing is blocked) -- rare, bounded,
 *  user-invisible. On the guard's
 *  first-Stop leg (flag false), stop-signal-surface may co-fire additionalContext
 *  on the same event; harmless here (the guard's first-block path is now a silent
 *  record-and-exit, not a block). A PERSISTENT STATE_DIR failure leaves the guard
 *  inert for its duration (release recorded nowhere, so post-release sightings
 *  log as fresh releases) -- pre-guard behavior. End-of-session last-turn edge (no next pass
 *  exists) is shared with stop-cred-denial-surface.js's accepted edge.
 * ============================================================================
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Per-turn dedup marker dir. Lives in the OS temp dir, NOT under ~/.claude/hooks
// (that dir is backup-tracked + vetting-protected; transient state there triggers
// perpetual backup-coverage warnings). Markers are keyed on session_id + prompt_id
// so concurrent sessions never collide. Pruned on each run (see pruneState).
const STATE_DIR = path.join(os.tmpdir(), 'claude-claim-linter-state');
const STATE_TTL_MS = 24 * 60 * 60 * 1000; // markers older than this are swept
const MAX_SCAN_CHARS = 200000;            // length cap: bound worst-case regex work

// Fail-open prune: delete markers older than the TTL so the dir can't grow
// unbounded across sessions over time. Any error -> skip silently.
function pruneState() {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(STATE_DIR)) {
      const p = path.join(STATE_DIR, name);
      try {
        if (now - fs.statSync(p).mtimeMs > STATE_TTL_MS) { fs.unlinkSync(p); }
      } catch (e) { /* skip this entry */ }
    }
  } catch (e) { /* dir missing or unreadable -> nothing to prune */ }
}

// ---- Claim shapes -----------------------------------------------------------
// Each pattern is a naked-claim detector. A match is a CANDIDATE; it is only
// nudged if NOT cleared by an evidence marker near the match (see claimCleared).
// Word-boundary / phrase anchored to keep false positives low. Case-insensitive.
// Each entry tags its class EXPLICITLY ('A' | 'B') rather than relying on array
// position -- so adding a pattern (the MAINTENANCE path) can never silently
// re-classify its neighbours. Class only affects evidence-clearing: a narrative
// source clears an A claim but NOT a B claim (see claimCleared).
const CLAIM_PATTERNS = [
  // -- Class A: capability
  { cls: 'A', re: /\bI (?:can|can't|cannot)\b/i },
  { cls: 'A', re: /\bis(?:n't| not)? available\b/i },
  { cls: 'A', re: /\bdoes(?:n't| not) exist\b/i },
  { cls: 'A', re: /\bthere (?:is|are) no\b/i },
  // -- Class A: config / value
  { cls: 'A', re: /\bdefaults? to\b/i },
  { cls: 'A', re: /\bis configured\b/i },
  { cls: 'A', re: /\bexpires? (?:after|on|in)\b/i },
  // -- Class A: outcome
  { cls: 'A', re: /\b(?:it |the \w+ )?(?:filed|completed|succeeded|worked)\b/i },
  { cls: 'A', re: /\bran clean(?:ly)?\b/i },
  // -- Class A: exhaustiveness
  { cls: 'A', re: /\bthe only\b/i },
  { cls: 'A', re: /\bnothing else\b/i },
  { cls: 'A', re: /\balready covered\b/i },
  // -- Class A: poison marker (self-asserted verification without provenance)
  { cls: 'A', re: /\(verified\)/i },
  // -- Class B: status / recency recitals
  { cls: 'B', re: /\bGEN-\d+ (?:is|was) (?:open|done|closed|in progress|backlog|awaiting|blocked)\b/i },
  { cls: 'B', re: /\bthe latest\b/i },
  { cls: 'B', re: /\bhas(?:n't| not) been done\b/i },
  // -- Class B: tracker-absence
  { cls: 'B', re: /\bno (?:ticket|issue|entry) (?:for|exists)\b/i },
  // -- Class B: narrow ticket-content claim
  { cls: 'B', re: /\bGEN-\d+ (?:removed|says|is about|adds?|changes?)\b/i },
  // -- Class B: verify-miss family (GEN-537, from GEN-58 logged instances). All Class B
  //    (a narrative/self-report source citation must NOT clear them; only a LIVE_MARKER does).
  //    Deliberately NOT covering "GEN-X is now <status>" (Erez's call 2026-07-22): that surface
  //    is indistinguishable from the REQUIRED correct status-report prose emitted after setting a
  //    status, so nudging it would erode the signal -- the accepted false-negative tradeoff.
  // affirmative dup-filing recital ("already filed", not the negative line-134/absence line-136 forms)
  { cls: 'B', re: /\balready (?:filed|created|been (?:filed|created|done))\b/i },
  // stale-status recital ("still open") -- the un-numbered form line 132 misses; "now" excluded per above
  { cls: 'B', re: /\bstill (?:open|done|closed|blocked|in progress|pending)\b/i },
  // success-from-self-report: render round-trip ("renders cleanly") -- distinct from line-124 "ran cleanly"
  { cls: 'B', re: /\brenders? (?:cleanly|correctly|fine|properly)\b/i },
  // success-from-self-report: framed bare-outcome self-claim ("it's done/verified"); apostrophe optional + curly
  { cls: 'B', re: /\b(?:it['’]?s|that['’]?s|this is) (?:done|complete|verified)\b/i },
];

// ---- Evidence markers -------------------------------------------------------
// A marker NEAR the claim (within CLEAR_WINDOW chars of the match, not merely
// somewhere in the paragraph) clears it. Vicinity-scoping (not whole-paragraph)
// per code-review: a stray filename or "re-read" elsewhere in a long paragraph
// must NOT clear an unrelated claim -- that would silently suppress real nudges
// and, worse, make the 3-week residual evaluation read falsely low.
// Live-state markers clear any claim; a narrative-source citation clears Class A
// but NOT Class B (a B claim IS "trusted a stale narrative source", so citing one
// doesn't clear it).
// Deliberately CONSERVATIVE marker set: dropped the bare self-defeating markers
// (a lone "unverified" -- historically present in this hook's own note text -- and the
// bare-word "re-read/re-fetch/queried"), and tightened the generic-filename and
// line-ref markers, all of which over-cleared.
const CLEAR_WINDOW = 120; // chars on each side of the claim match to scan for a marker
const LIVE_MARKERS = [
  /\b[A-Za-z]:[\\/][^\s)]+\.[A-Za-z0-9]{1,5}\b/,        // windows file path w/ extension
  /\bhttps?:\/\/\S+/i,                                  // url
  /\bexit (?:code |status )?\d+\b/i,                    // command-output reference
  /\b(?:re-?fetched|re-?read (?:the|via|from)|query result|command output|live[- ]state)\b/i,
  /\b(?:as )?verified (?:this session|live|against|via|by (?:reading|running))\b/i, // active verification phrase
  /\bline \d+\b/i,                                      // explicit line reference (not bare ":NN")
];
const NARRATIVE_MARKERS = [
  /\bHISTORY\.md\b/i,
  /\b(?:session )?summary\b/i,
  /\bfrom memory\b/i,
  /\brecall(?:ed|ing)?\b/i,
];

function windowAround(text, index, matchLen) {
  const start = Math.max(0, index - CLEAR_WINDOW);
  const end = Math.min(text.length, index + matchLen + CLEAR_WINDOW);
  return text.slice(start, end);
}

// Does an evidence marker appear within CLEAR_WINDOW of the claim match?
function claimCleared(vicinity, isClassB) {
  for (const m of LIVE_MARKERS) { if (m.test(vicinity)) return true; }
  if (!isClassB) {
    for (const m of NARRATIVE_MARKERS) { if (m.test(vicinity)) return true; }
  }
  return false;
}

function findNakedClaims(text) {
  const hits = [];
  const seen = new Set();
  for (const pat of CLAIM_PATTERNS) {
    const re = new RegExp(pat.re.source, pat.re.flags.includes('g') ? pat.re.flags : pat.re.flags + 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index === re.lastIndex) { re.lastIndex++; } // guard against zero-width match loop
      const vicinity = windowAround(text, m.index, m[0].length);
      if (claimCleared(vicinity, pat.cls === 'B')) continue;
      // Same hard length cap as self-audit hits (SELF_AUDIT_MAX_HIT): the
      // outcome pattern's optional "the \w+ " prefix can bind an arbitrarily
      // long token, and hits are now echoed into the guard's reason + log too.
      const hit = m[0].trim().slice(0, SELF_AUDIT_MAX_HIT);
      if (seen.has(hit)) continue; // dedup identical phrasings
      seen.add(hit);
      hits.push(hit);
      if (hits.length >= 5) return hits; // cap: enough to nudge; avoids spam
    }
  }
  return hits;
}

// ---- Self-audit detection (GEN-507) -----------------------------------------
// A self-audit / self-check / no-op narration is TRUE but should be UNSAID on a
// turn that owed silence. Each pattern matches first-person narration of the act
// of checking/verifying, a clean-audit recital, or a no-op cleanup. These are
// deliberately anchored to FIRST-PERSON self-reference so they don't fire on
// ordinary factual reporting (e.g. "the file was not changed" as a genuine result
// Erez asked for). Case-insensitive. Kept SEPARATE from CLAIM_PATTERNS on purpose
// (see the SELF-AUDIT STAGE header): the two detectors' clearing logics are
// opposite and must never share a pattern/marker path.
// Two kinds of pattern. `needsClean:true` means the phrase is only a self-audit
// smell when a CLEAN / NO-OP signal sits nearby -- the bare first-person verb ("I
// checked...") is NOT flagged on its own, because it also opens a REQUIRED report
// ("I checked the retry queue -- two invoices stuck") or a SANCTIONED retry
// announcement ("I checked, and I'm retrying") -- both of which the rules permit.
// The banned thing is specifically narrating a CLEAN result. Patterns without the
// flag are specific enough to be self-audit smells on their own.
const SELF_AUDIT_PATTERNS = [
  // -- first-person "I <verified/checked/...>" -- flagged ONLY with a nearby clean/
  //    no-op signal (see SELF_AUDIT_CLEAN_MARKERS), so required reports and retry
  //    announcements that use the same verbs are not caught.
  { re: /\bI (?:verified|checked|re-?read|re-?examined|re-?confirmed|confirmed|double-?checked)\b/i, needsClean: true },
  // -- clean-audit recitals (specific enough to flag on their own)
  { re: /\bcame back clean\b/i },
  { re: /\bno (?:unverified|state) (?:assertions?|was changed|changes?)\b/i },
  { re: /\bnothing (?:else )?(?:was )?touched\b/i },
  { re: /\bno block (?:is|was) owed\b/i },
  { re: /\bnot a memory claim\b/i },
  { re: /\bfrom (?:this turn'?s?|the turn'?s?) own state\b/i },
  { re: /\bverified (?:from|against) (?:this|the) turn'?s?\b/i },
  // -- narrating a no-op cleanup (a fired timer/wakeup with nothing to do).
  //    Gap is bounded + newline-excluded ([^.\n]{0,200}?) NOT open-ended [^.]* --
  //    an open gap scans the whole period-free tail from every "timer fired" start
  //    (quadratic: a 200k period-free message took ~1.6s in a ReDoS probe); the
  //    bounded lazy gap holds the same match to within one clause at ~4ms worst-case.
  { re: /\b(?:timer|wakeup|wake-up|schedule[d]?) fired\b[^.\n]{0,200}?\bnothing (?:to do|left)\b/i },
  { re: /\bnothing (?:to do|left to do)[,;]? (?:so )?cancel+ing\b/i },
  // -- GEN-557: verification-walkthrough narration. The recurrence was a post-nudge
  //    clean-audit recital addressed to Erez -- an enumerated roll-call of threads,
  //    each "done, verified", closing with an exhaustiveness self-defense and a
  //    "Nothing to correct". All six patterns below were measured against 4,356 real
  //    turn-final messages (the actual last_assistant_message values this hook
  //    receives, rebuilt from on-disk transcripts; 2,585 of them reachable by this
  //    stage -- see the Phase-2 note). Rig + per-pattern evidence: GEN-557.
  //    ALL FIGURES IN THIS BLOCK WERE MEASURED 2026-08-02 and are dated deliberately:
  //    the corpus SHRINKS as Claude Code prunes transcripts (4,580 messages from 170
  //    transcripts on 07-30; 4,356 from 157 on 08-02), so an undated count cannot be
  //    told apart from a stale one. Re-baseline, don't compare to these.
  //    [ \t]* not \s*: \s matches a newline, which would let a bullet ending in a bare
  //    tick join the next line starting with "closed". (BLOCK_OPENER_RE also uses [ \t]
  //    rather than \s, though for a different reason -- backtracking, not line-joining.)
  //    ['’] because the file's own CLAIM_PATTERNS
  //    handle both apostrophe forms; no curly form appears in the corpus, so this is
  //    consistency insurance, not an observed miss.
  { re: /✓[ \t]*closed\b/i },
  { re: /\bthat['’]?s the complete set\b/i },
  { re: /\bholds as written\b/i },
  { re: /\bexhaustiveness claim\b[^.\n]{0,80}?\b(?:holds|stands|is accurate|checks out|survives)\b/i },
  //    The dominant pattern (111 of the 113). Every one of the 125 reachable,
  //    unquoted real instances was the target class ("...all sourced this turn.
  //    Nothing to correct."), so it is NOT position-anchored and NOT needsClean-
  //    gated: both were considered and measured as unnecessary, not skipped.
  //    RESIDUAL: 125/125 describes this user's past phrasing, not a property of the
  //    regex. It will fire on a legitimate requested result ("the panel found nothing
  //    to fix"), as will the tick pattern on a required status line ("✓ Closed
  //    GEN-550"). Partly -- NOT fully -- defused by the Phase-2 guard skipping messages
  //    it recognises as block-carrying, where required reports live. Do not lean on that
  //    further than it goes: the guard misses the "## <pin> For you" heading form (78 of
  //    4,356 real turns, 2026-08-02) and is bypassed when session_id/prompt_id is
  //    missing, and the ONE real message that came closest to a false fire on the
  //    roll-call pattern below was reachable for exactly that reason. The remaining
  //    mitigation is the nudge text itself, which says to keep a report a standing rule
  //    requires.
  { re: /\bnothing to (?:correct|fix)\b/i },
  //    Ticket shape (a): the bulleted "done, verified" roll-call. Requires TWO such
  //    lines within 400 chars -- the roll-call signature that a single REQUIRED
  //    status line cannot produce. The one-line form was measured and REJECTED: it
  //    fired on a legitimate "where things stand" report ("- **GEN-550 -- shipped,
  //    verified, Done.**"). This form fires on exactly 1 of 2,585 real turns: the
  //    recurrence this ticket was filed for. Gap is bounded and contains no nested
  //    quantifier -- 200k adversarial near-miss input probes at ~5ms.
  //    ACCEPTED RESIDUAL: a required status report that bullet-lists 2+ items as
  //    "X -- shipped, verified" inside 400 chars WOULD fire (the real message above
  //    was one comma short). Accepted because a false nudge is dismissible and the
  //    alternative -- no coverage for shape (a) at all -- was the open finding.
  //    ACCEPTED RESIDUAL, and the sharpest one here: a fenced or indented EXAMPLE of the
  //    roll-call shape FIRES, and a fenced example in a message explaining this very
  //    ticket is its most likely non-target appearance -- the same self-referential hole
  //    the quote test exists to close.
  //    THE CAUSE IS THIS PATTERN, NOT THE GUARD. Anchoring at a line start means there is
  //    never same-line text before the match, so NO same-line-prefix test can ever protect
  //    it -- buildSuppressionMask is not deficient here. Fence masking was tried as a
  //    guard-side fix and removed (see there) because unbalanced markers silenced whole
  //    messages. So the cheaper place to fix this is the pattern: anchor on something
  //    other than a line start, or additionally require non-bullet context. GEN-592 tracks
  //    it and carries that option. Meanwhile a blockquoted example
  //    ("> - GEN-1 - done, verified") does NOT fire, since the anchor rejects "> ", and the
  //    cost of the residual is one dismissible nudge.
  { re: /^[ \t]*[-*]\s.*\b(?:done|filed|shipped|applied|resolved)[,;]\s*(?:and\s+)?verified\b[\s\S]{0,400}?^[ \t]*[-*]\s.*\b(?:done|filed|shipped|applied|resolved)[,;]\s*(?:and\s+)?verified\b/im },
];

// A CLEAN / NO-OP signal near a `needsClean` phrase confirms it is clean-result
// narration (the banned kind) rather than a substantive report. Deliberately
// broad on the clean side -- missing one just means no nudge (safe direction).
const SELF_AUDIT_CLEAN_MARKERS = [
  /\bclean\b/i, /\bno issues?\b/i, /\bnothing\b/i, /\bas expected\b/i,
  /\balready (?:correct|right|fine|clean)\b/i, /\bno (?:change|problem|error)/i,
  /\bfine\b/i, /\bmatch(?:es|ed)?\b/i, /\bconfirmed (?:it|that|the)\b/i,
  /\bnot (?:a memory|from memory|stale)\b/i, /\bno block\b/i,
];

// Hard cap on a stored/echoed hit: no matched substring is ever quoted into the
// injected note or the log longer than this. Defensive -- even a future unbounded
// pattern can't turn a hit into a context/log blow-up (Pass B, GEN-507).
const SELF_AUDIT_MAX_HIT = 200;

// A self-audit hit is only cleared when it is the DIRECT SUBJECT the user asked
// about -- i.e. Erez explicitly requested confirmation that a check ran. We cannot
// see the user's prompt from the Stop payload, so this clearing is deliberately
// NARROW and text-local: it only fires when the SAME message quotes an explicit
// verification REQUEST near the phrase (e.g. "you asked me to verify", "as you
// asked, I checked"). This is conservative by design -- when unsure we DO nudge,
// because a false nudge is dismissible. This is NOT the claim-linter's evidence
// clearing (which does the opposite); it is a much smaller "was this explicitly
// requested" exception.
const SELF_AUDIT_CLEAR_WINDOW = 140;
const SELF_AUDIT_CLEAR_MARKERS = [
  /\byou asked (?:me )?to (?:verify|check|confirm|re-?read|double-?check)\b/i,
  /\bas (?:you )?(?:asked|requested)\b/i,
  /\bper your (?:request|ask)\b/i,
];

function selfAuditCleared(vicinity) {
  for (const m of SELF_AUDIT_CLEAR_MARKERS) { if (m.test(vicinity)) return true; }
  return false;
}

// Is there a clean/no-op signal in the vicinity? Gates `needsClean` patterns.
function hasCleanSignal(vicinity) {
  for (const m of SELF_AUDIT_CLEAN_MARKERS) { if (m.test(vicinity)) return true; }
  return false;
}

// A QUOTED phrase is being DISCUSSED, not asserted. This stage's own subject matter
// makes that routine: messages about the linter quote the exact phrasings the patterns
// match ("the flagged phrasings (\"filed\", \"I checked\") are in that already-delivered
// block"). GEN-557 v1 fired on a message that merely quoted its own ticket's fixture
// while explaining it -- structurally the GEN-467 failure of nudging a message for
// TALKING about a thing rather than DOING it.
//
// A position is suppressed when, on its own line, it is preceded by an odd number of
// straight double-quotes or backticks, or by an unclosed smart open-quote.
//
// WHY A WHOLE-MESSAGE MASK, not a per-match test: the first implementation sliced the
// line prefix and ran .match(/"/g) over it per match. That is O(line length) per match,
// and since a suppressed or duplicate match never increments `hits`, the call count is
// uncapped -- a 200k single-line message went from ~17ms to ~10,100ms (a ~600x
// regression). Nothing in-process bounds that: clearTimeout(watchdog) is the FIRST
// statement of the stdin 'end' handler, so all scanning runs after the 5s watchdog is
// disarmed, and settings.json registers this hook with no timeout. The mask is one
// linear pass, then O(1) per match. The bound is structural, not merely measured: a
// masked match short-circuits BEFORE the vicinity slice and the clearing regexes, so
// per-match cost is never above the pre-change cost, and total cost is the pre-change
// cost plus one linear pass. (Micro-benchmarks here proved noisy run to run -- rely on
// that argument and the order of magnitude, not on a specific ms comparison.)
//
// FENCE HANDLING WAS TRIED AND REMOVED -- do not re-add it this way. A version of this
// mask also suppressed anything inside a ``` fence, to stop a fenced EXAMPLE of a
// pattern from firing. Code review found the cure worse than the disease: fence state is
// parity over line-start markers, so a single unbalanced marker -- an unterminated
// snippet, a typo, a fenced example that itself contains a fence opener -- silenced every
// pattern for the rest of the message (measured: one stray marker masked 91% of a test
// message), including the 10 patterns that predate GEN-557. Erez's call, 2026-08-02: drop
// it rather than paper over it. The underlying problem is real and still open -- see
// GEN-592, which tracks finding a mechanism that does not inherit fence-parity fragility.
//
// RESIDUALS -- they fail in BOTH directions, so read each one's direction before relying
// on it. None can wedge a turn or force a redo; the self-audit path only ever injects a
// note. Over-suppression yields a MISSED nudge; under-suppression yields a SPURIOUS one
// (the fenced/illustrative-example case, tracked on GEN-592).
//  - MISSED-nudge direction: cannot tell quoting-to-discuss from quoting-to-say, so
//    scare-quoted or inline-code'd narration escapes: `It "came back clean" on both
//    files.` The corpus evidence below bounds only shapes that HAVE occurred; it says
//    nothing about that one, which is one keystroke away. Do not read the measurement as
//    covering it.
//  - SPURIOUS-nudge direction: parity is per LINE, so a multi-line quoted block is not
//    covered, a ``` fenced block is not covered (see above), and single-quoted spans are
//    not covered. Each of those leaves the pre-guard behaviour, which is a FIRE -- an
//    illustrative example reads as an assertion.
//  - Suppression is tested at the MATCH START only, so a match straddling a quoted span
//    is judged by the side it starts on (either direction, depending on the side).
// NOT masked, worth stating so nobody assumes otherwise: the claim-linter's own note text
// contains the literal "no block is owed", which matches a pre-GEN-557 pattern -- a
// standing violation of this file's guard-reason fixture. Straight-quote parity before
// that phrase is always even, so this mask does not suppress it and the violation still
// surfaces when the fixture runs. Pre-existing, filed separately; the mask neither caused
// nor hid it.
//
// SCOPE: applies to ALL SELF_AUDIT_PATTERNS -- the six added by GEN-557 AND the 10 that
// shipped before it. That widening changes already-vetted behaviour, so it was measured
// first and then chosen explicitly by Erez on 2026-08-02 (the narrower per-pattern-flag
// alternative was built and offered alongside it). Measured 2026-08-02 on 4,356 real
// turn-final messages: against the shipped patterns in isolation it changes 6 turns and
// fully silences 4, all 4 inspected and all 4 genuine quoted references, with no genuine
// hit wrongly suppressed anywhere in the corpus. The full evidence and per-pattern
// breakdown live on GEN-557 -- kept there, not restated here, so there is one place to
// update as the corpus changes.
// MAINTENANCE: a pattern added later is covered automatically. If one ever needs to opt
// OUT, gate the call site on a per-pattern flag rather than weakening this test.
//
// Walks the text line by line -- deliberately plain, so the per-line parity stays
// checkable by eye. Linear in text length; one byte per character (<=200KB at
// MAX_SCAN_CHARS).
function buildSuppressionMask(text) {
  const n = text.length;
  const mask = new Uint8Array(n);
  let i = 0;
  while (i <= n) {
    let eol = text.indexOf('\n', i);
    if (eol === -1) { eol = n; }
    // Prefix parity, identical in meaning to the per-match test it replaced: state
    // reflects only the characters strictly before k on this line.
    let dq = 0, bt = 0, smart = 0;
    for (let k = i; k < eol; k++) {
      mask[k] = ((dq & 1) === 1 || (bt & 1) === 1 || smart > 0) ? 1 : 0;
      const c = text.charCodeAt(k);
      if (c === 34) { dq++; }
      else if (c === 96) { bt++; }
      else if (c === 0x201C) { smart++; }
      else if (c === 0x201D) { smart--; }
    }
    i = eol + 1;
  }
  return mask;
}

// Find self-audit narration hits. Sentence/position-agnostic BY DESIGN: a self-
// audit line is flagged wherever it appears IN THE MESSAGES THIS STAGE SEES, with no
// sentence- or position-membership exemption -- the recurrence that prompted GEN-507
// was a self-audit line placed inside a "For you" block, so an exemption of that kind
// would have swallowed the target case.
// CORRECTION (GEN-557, 2026-08-02): this comment used to say the line is flagged
// "INCLUDING inside a 'For you' block". That stopped being true when GEN-467 v2.2
// removed the Arm-2 content gate: the Phase-2 guard now exits on EVERY branch before
// Phase 1 reaches this function, so a message the guard RECOGNISES as block-carrying
// is not scanned at all (1,771 of 4,356 real turns, 40.7%, measured 2026-08-02).
// The stale wording itself is tracked on GEN-584.
// Do NOT read the 40.7% as "no block-carrying message reaches here" -- but since the
// GEN-467 re-cut (2026-08-10) the reachable set is much smaller: the WIDE_OPENER_RE
// Phase-1 skip covers every observed opener form (heading + doubled-pin included) and
// runs even when session_id/prompt_id is missing, so of the three bypass paths
// documented before the re-cut, ONE remains: the opener test runs on stripFences(msg),
// so an odd number of ``` markers can swallow a trailing opener along with the
// unpaired fence -- hiding the block from the skip test (and from the Phase-2 guard
// identically) and letting the message reach these patterns. That edge predates the
// re-cut, is disclosed in the re-cut banner, and has no ticket of its own; it is
// written up in the GEN-557 rig README under "Found on the way". Confirm
// before assuming it is tracked anywhere. The
// hook does NOT try to decide whether the line is a permitted correction vs a
// banned self-audit; that semantic call is handed to the model receiving the nudge
// (which has full turn context this hook lacks).
function findSelfAudit(text) {
  const hits = [];
  const seen = new Set();
  // One linear pass, then O(1) per match. Built here rather than tested per match --
  // the per-match form was O(line length) and uncapped. The measurement and the
  // structural bound are stated once, at buildSuppressionMask; not repeated here.
  const suppressed = buildSuppressionMask(text);
  for (const pat of SELF_AUDIT_PATTERNS) {
    const re = new RegExp(pat.re.source, pat.re.flags.includes('g') ? pat.re.flags : pat.re.flags + 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index === re.lastIndex) { re.lastIndex++; } // guard against zero-width match loop
      // A match inside a quote or an inline code span is DISCUSSION, not narration.
      // NOT fences -- those are deliberately uncovered; see buildSuppressionMask for
      // the semantics, the full residual list, and why the fence attempt was dropped.
      // Applies to ALL patterns, new and pre-GEN-557 (Erez's explicit call, 2026-08-02).
      if (suppressed[m.index] === 1) continue;
      const start = Math.max(0, m.index - SELF_AUDIT_CLEAR_WINDOW);
      const end = Math.min(text.length, m.index + m[0].length + SELF_AUDIT_CLEAR_WINDOW);
      const vicinity = text.slice(start, end);
      if (selfAuditCleared(vicinity)) continue;
      // A needsClean pattern (the bare first-person verb) only counts as a self-
      // audit smell when a clean/no-op signal sits nearby -- otherwise it is a
      // permitted report or retry announcement, so skip it. Test the clean signal
      // on the vicinity EXCLUDING the match span itself: otherwise a trigger word
      // that is also a clean-marker (e.g. verb "confirmed" vs marker "confirmed
      // that") self-satisfies the gate, making it vacuous for that verb and nudging
      // a genuine failure report ("I confirmed that the deploy failed"). (Pass B.)
      if (pat.needsClean) {
        const around = text.slice(start, m.index) + ' ' + text.slice(m.index + m[0].length, end);
        if (!hasCleanSignal(around)) continue;
      }
      // .replace collapses whitespace FIRST: the roll-call pattern matches across two
      // bullet lines, and a multi-line hit is echoed into the nudge and the durable log.
      const hit = m[0].trim().replace(/\s+/g, ' ').slice(0, SELF_AUDIT_MAX_HIT); // cap
      if (seen.has(hit)) continue;
      seen.add(hit);
      hits.push(hit);
      if (hits.length >= 5) return hits; // cap
    }
  }
  return hits;
}

// Durable, append-only log of self-audit detections (GEN-507). Mirrors
// stop-signal-surface.js's append-only pattern: one JSON line per detection so
// /wrap can report the session's self-audit-nudge count -- the re-evaluate signal
// GEN-507's lifecycle needs (built because it recurred; retire/retune if it goes
// quiet or proves noisy). Lives under ~/.claude/hooks alongside its sibling logs
// (credential-denials.jsonl, signal-surface-pending.jsonl). Grows unbounded like
// those siblings, which is accepted. Fail-open: any write error is swallowed --
// the nudge itself never depends on the log succeeding.
const SELF_AUDIT_LOG = path.join(__dirname, 'selfaudit-nudges.jsonl');
function logSelfAudit(sessionId, promptId, hits) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      session_id: sessionId,
      prompt_id: promptId,
      hits: hits.slice(0, 5),
    }) + '\n';
    fs.appendFileSync(SELF_AUDIT_LOG, line);
  } catch (e) { /* fail open -- log is best-effort, never blocks the nudge */ }
}

// ---- Phase-2 guard (GEN-467 v2.1) -------------------------------------------
// See the PHASE-2 GUARD header block above for design, evidence, and residuals.

// Block-opener detection: a line START carrying the pushpin-titled "For you"
// header. Line-start anchoring (not marker-anywhere) is deliberate -- a block
// QUOTED mid-prose must not trip the guard (round-1 panel). Covers all three
// observed forms from the nudge hook's 33-payload log (stop-foryou-nudge.js
// lines 71-74): "📌 **For you**", "📌 For you", AND "**📌 For you" (asterisks
// BEFORE the pin -- code-review Pass A caught that the first draft missed it).
// A markdown-blockquote line ("> 📌 For you") is deliberately NOT an opener:
// quoting a block is the common reason that prefix appears (code-review Pass B).
// This regex intentionally DIVERGES from the siblings' marker-anywhere
// MARKER_RE (stop-foryou-nudge.js line 83, copied into stop-cred-denial-
// surface.js): the siblings ask "is a block mentioned?", this guard asks "does
// a block START here?" -- keep the two concepts separate when syncing marker
// formats (the nudge file's known-copies comment is the canonical list).
// Whitespace inside the opener is [ \t] only (all observed forms are single-
// line); \s here would let a pushpin followed by thousands of blank lines
// backtrack quadratically on the full-length scan (Pass B round 2).
const BLOCK_OPENER_RE = /^[ \t]{0,3}\*{0,2}\u{1F4CC}[ \t]*\*{0,2}[ \t]*For you/imu;

// WIDE opener recognizer (GEN-467 re-cut, 2026-08-10; this exact regex was
// reviewed in the 2026-08-09/10 code-review passes as the "widened" form).
// Matches ALL observed block-opener forms -- the narrow three above PLUS the
// markdown-heading prefix ("## <pin> For you", any #{1,6}) and repeated pins,
// which were 106 of 403 real block-carrying messages since 07-28 (26%) and
// invisible to BLOCK_OPENER_RE; the 2026-08-05 duplicate escaped through
// exactly that blindness. USED ONLY by the Phase-1 skip below -- it never
// feeds record-on-release or the Phase-2 guard, so a match here can never
// create a release record. Line-anchored (a quoted opener mid-prose must not
// match) and fence-stripped by the caller. Whitespace runs are [ \t] only and
// BOUNDED at {0,16} -- both load-bearing (code-review 2026-08-09): \s would
// join across blank lines, and the UNBOUNDED [ \t]* form backtracks
// quadratically when adjacent runs compete over one long same-line space run
// (measured: a pin + 40K spaces ~2s in .test(), extrapolating ~45s at the 190K
// full-length scan; the bounded form is ~0ms at 190K and matches all 407 real
// openers since 07-28, m-widen2.js corpus). The leading indent keeps {0,3}
// (markdown's indented-code cutoff). Do not describe this regex as "linear" --
// it is bounded-backtracking, safe because the runs are capped.
// stop-signal-surface.js carries a NAMED COPY of this regex + stripFences for
// its suppression self-test -- keep the two files in sync (this file is the
// canonical copy).
const WIDE_OPENER_RE = /^[ \t]{0,3}(?:#{1,6}[ \t]{0,16})?\*{0,2}(?:\u{1F4CC}[ \t]{0,16})+\*{0,2}[ \t]{0,16}For you/imu;

// Fenced code spans are stripped before the opener test: a block opener quoted
// inside ``` fences (drafts, examples -- common in this project) must neither
// trip the guard NOR poison record-on-release (Pass B finding 1: a released
// false-positive would make arm 1 kill the turn's REAL block later). Handles
// an unterminated trailing fence. Linear single pass; runs on the FULL message
// (see the opener-test call site for why full, not capped).
function stripFences(t) {
  return t.replace(/```[\s\S]*?(?:```|$)/g, '');
}

// Durable, append-only guard-event log (sibling of selfaudit-nudges.jsonl; same
// accepted unbounded-growth stance). One line per guard decision on a block-
// carrying message. Consumer: the gen467-block-after-check-verify scheduled
// scan (the sole reader). Fail-open: a write error never affects the decision.
const GUARD_LOG = path.join(__dirname, 'foryou-guard-events.jsonl');
function logGuardEvent(sessionId, promptId, event, detail) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      session_id: sessionId,
      prompt_id: promptId,
      event: event,
      detail: detail || null,
    }) + '\n';
    fs.appendFileSync(GUARD_LOG, line);
  } catch (e) { /* fail open */ }
}

// Per-turn guard state: ONE PRESENCE file beside the note-dedup markers in
// STATE_DIR, swept by the same TTL prune. guard.<sid>.<pid>.released marks
// RECORD-ON-RELEASE ("a block-carrying message was released this turn" -- set
// only on release, never on a rejected sight; see the header block for the
// trace). (The .arm1/.arm2 claim files and tryClaimArm() were removed with
// their arms -- v2.2 removed Arm 2, the 2026-08-10 re-cut retired Arm 1's
// decision:block; nothing claims a blocking shot anymore.)
function guardFile(sid, pid, suffix) {
  return path.join(STATE_DIR, 'guard.' + sid + '.' + pid + '.' + suffix);
}
// A short digest of the released message is stored IN the release record so a
// same-message Stop re-fire (Phase 1 treats that as plausible; its dedup
// marker exists for exactly that) is recognized and released silently instead
// of arm-1-attacking the very message the guard just released (Pass B round 2).
function msgDigest(t) {
  try { return crypto.createHash('sha256').update(String(t), 'utf8').digest('hex').slice(0, 16); }
  catch (e) { return ''; }
}
// Returns the stored digest string if released, else null. Unreadable -> null
// (treat as not released: arm 2, the milder arm, is the fail-open direction).
function readReleased(sid, pid) {
  try { return fs.readFileSync(guardFile(sid, pid, 'released'), 'utf8'); }
  catch (e) { return null; }
}
// Best-effort release record; returns whether it verifiably persisted (the
// caller logs the miss -- a lost release record degrades arm 1 to inert for
// this turn, the fail-open direction, never a wrong block).
function markReleased(sid, pid, digest) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(guardFile(sid, pid, 'released'), digest || '');
    return true;
  } catch (e) { return false; }
}

// Injected-string CONSTRAINT (round-1 panel, verified by the reason-self-scan
// fixture): every string this file injects (the Phase-1 noteParts below) must
// never match any CLAIM_PATTERNS / SELF_AUDIT_PATTERNS entry, and must not
// contain a line-start block opener -- otherwise the hook's own instruction
// could re-trip a detector or the opener regexes on a later pass. Run the
// fixture when editing.
// (arm2Reason removed with the Arm-2 content-gate in GEN-467 v2.2, 2026-07-26;
// arm1Reason removed with Arm 1's decision:block in the GEN-467 re-cut,
// 2026-08-10 -- the guard no longer emits any block, so no reason strings remain.)

// ---- Main -------------------------------------------------------------------
// Fail-open watchdog: if stdin never emits 'end' (harness anomaly), exit cleanly
// anyway so the hook can never hang and wedge turn-end. unref() so this timer
// itself never keeps the process alive.
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

    let text = input.last_assistant_message;
    if (typeof text !== 'string' || !text) { process.exit(0); }
    // Length cap: bound worst-case regex work on a very long message. Truncation
    // only risks missing a claim in the tail -- the safe direction (never a wedge).
    if (text.length > MAX_SCAN_CHARS) { text = text.slice(0, MAX_SCAN_CHARS); }

    const sid = String(input.session_id || 'nosession').replace(/[^\w.-]/g, '_');
    const pid = String(input.prompt_id || 'noprompt').replace(/[^\w.-]/g, '_');

    pruneState(); // fail-open sweep of stale markers (bounds STATE_DIR growth)

    // ---- PHASE-2 GUARD: runs BEFORE the stop_hook_active exit, because the
    // legitimate block rides the nudge continuation where that flag is true
    // (probe-verified loop safety -- see the PHASE-2 GUARD header). Handles
    // block-carrying messages fully, then exits; non-block messages fall
    // through to the unchanged Phase-1 note path below.
    //
    // The opener test runs on the FULL, fence-stripped message, not the capped
    // copy: the block sits at the END of a message by convention, so head-
    // truncation at MAX_SCAN_CHARS could hide a tail opener from the guard
    // (code-review Pass A). Both regexes are linear, so full-length is safe.
    //
    // The guard is SKIPPED (not defaulted) when session_id or prompt_id is
    // missing: shared fallback keys would let one turn's release record kill a
    // DIFFERENT turn's legitimate block (Pass B). Phase 1 keeps its own
    // fallback behavior unchanged.
    //
    // NO-BLOCKER INVARIANT (documented for future hook authors): the release
    // record means "this guard released a block-carrying message". Since the
    // GEN-467 re-cut (2026-08-10) NO Stop hook in this config emits
    // decision:block at all -- this file included -- so released === delivered
    // and nothing can retract or redo a displayed message. A future blocking
    // hook would break that invariant AND reopen the triple-rendition harm
    // that retired Arm 1 -- check the re-cut banner above before adding one.
    if (typeof input.session_id === 'string' && input.session_id &&
        typeof input.prompt_id === 'string' && input.prompt_id &&
        BLOCK_OPENER_RE.test(stripFences(input.last_assistant_message))) {
      const released = readReleased(sid, pid);
      if (released !== null) {
        // Same-message re-fire (a Stop double-fire on the message the guard
        // just released): release silently -- arm-1-attacking it would
        // manufacture the near-duplicate this guard exists to kill (Pass B).
        if (released !== '' && released === msgDigest(input.last_assistant_message)) {
          logGuardEvent(sid, pid, 'arm1-samemsg-release');
          process.exit(0);
        }
        // A DIFFERENT block-carrying message AFTER this turn's block was
        // already released: the GEN-467 duplicate shape. Since the re-cut
        // (2026-08-10) this is a SIGHTING, not a block: a Stop decision:block
        // cannot retract the displayed message -- it can only force a third
        // rendition of the same content (Arm 1's one production fire,
        // 2026-08-03). Log it for the scheduled scan's bars and release.
        // Duplicate prevention now happens at the injectors (the Phase-1 skip
        // below + stop-signal-surface.js's suppression), which stop the
        // provoking note before the continuation exists.
        logGuardEvent(sid, pid, 'arm1-sighting');
        process.exit(0);
      }
      // First (not-yet-released) block-carrying message of the turn: RELEASE
      // and record it (record-on-release), with the released message's digest
      // so a same-message re-fire is recognized above.
      //
      // GEN-467 v2.2 (2026-07-26): the Arm-2 CONTENT-GATE was REMOVED here.
      // It re-scanned this first block-carrying message with findNakedClaims/
      // findSelfAudit and emitted decision:block on any uncleared hit, to force
      // a clean re-emission. In production (foryou-guard-events.jsonl) that gate
      // fired 8x with a 100% escape rate (7/7 real fires -> arm2-escape on the
      // same prompt_id): every forced redo STILL tripped a detector and hit the
      // cap, shipping a second, user-visible "For you" block. The cause is not
      // the model failing to fix real claims -- it is that the detectors match
      // REQUIRED, un-rewordable ticket-reporting vocabulary ("filed", "GEN-N
      // says", "already filed") that a bare regex cannot tell apart from a
      // fabricated claim without provenance the hook has no access to. So the
      // pass condition was unmeetable by legitimately-sourced content: a
      // permanent-escape gate that delivered the doubling harm and none of its
      // intended benefit (a Stop decision:block cannot EDIT a message -- it only
      // forces a NEW one, and the blocked one stays visible). Quality nudging of
      // the block now rides ONLY the non-blocking pre-block channels (the Phase-1
      // note below + stop-foryou-nudge.js), which inject into the continuation
      // BEFORE the block is written and have never produced a duplicate.
      //
      // What is DELIBERATELY KEPT: this record-on-release write. The sighting
      // path above fires only when readReleased() returns non-null, i.e. only
      // after a block-carrying message was released and recorded HERE. The
      // record also feeds the samemsg-release dedup and the scheduled scan's
      // exposure counting -- removing this write would blind all three. The
      // former content-gate's own clean path already ended in exactly this
      // markReleased()/log; with the gate gone, it is unconditional for the
      // turn's first block-carrying message. Post-re-cut liveness:
      // findNakedClaims/findSelfAudit/MAX_SCAN_CHARS remain used by the Phase-1
      // note path below; BLOCK_OPENER_RE/stripFences/readReleased/markReleased/
      // msgDigest remain used by the guard + sighting path; WIDE_OPENER_RE is
      // used by the Phase-1 skip; arm1Reason/tryClaimArm and the arm1-block/
      // arm1-escape/arm1-stateless-release events were removed with Arm 1's
      // decision:block (2026-08-10), as arm2Reason/arm2-* were with v2.2.
      const persisted = markReleased(sid, pid, msgDigest(input.last_assistant_message));
      logGuardEvent(sid, pid, 'release-clean', { persisted: persisted });
      process.exit(0);
    }

    // ---- PHASE-1 SKIP for block-form messages (GEN-467 re-cut, 2026-08-10).
    // Any message carrying a recognisable block opener in ANY observed form is
    // never Phase-1-noted: the note is the measured provocation of the
    // duplicate (it spawns a promptless continuation that re-emits the block
    // -- the 2026-08-05 chain). Skip-only: deliberately does NOT write a
    // release record (a wide match must never arm the guard or the
    // false-release channel). Runs on the FULL fence-stripped message (same
    // rationale as the guard's opener test above) and does NOT require
    // session/prompt ids -- the ids are only for the countable log row, where
    // the sanitized fallbacks are fine. A form this regex misses degrades to
    // the pre-re-cut behavior: the note fires, and its own text tells the
    // model not to emit a second block.
    if (WIDE_OPENER_RE.test(stripFences(input.last_assistant_message))) {
      logGuardEvent(sid, pid, 'phase1-skip-blockform');
      process.exit(0);
    }

    // ---- PHASE 1 (unchanged): the soft note path for non-block messages.
    // LOAD-BEARING re-injection guard (probe-confirmed): the turn that RECEIVES an
    // injection is marked stop_hook_active:true. Without this, the nudge would
    // re-fire every subsequent turn. Exit silently on a re-fire.
    if (input.stop_hook_active === true) { process.exit(0); }

    // Two INDEPENDENT detectors run over the same message text (see the SELF-AUDIT
    // STAGE header for why they are separate). Either firing warrants a nudge.
    const claims = findNakedClaims(text);
    const auditHits = findSelfAudit(text);
    // Widened early-exit (GEN-507): exit only when BOTH detectors are empty, so a
    // self-audit-only turn still nudges (the original guard exited on claims alone).
    if (claims.length === 0 && auditHits.length === 0) { process.exit(0); }

    // Per-turn dedup, session-scoped. prompt_id identifies the turn; session_id
    // isolates concurrent sessions. If we've already nudged this exact turn, stay
    // silent (defensive -- Stop normally fires once per turn, but be safe). Applies
    // to the whole turn's nudge regardless of which detector(s) fired.
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      const marker = path.join(STATE_DIR, sid + '.' + pid);
      if (fs.existsSync(marker)) { process.exit(0); }
      fs.writeFileSync(marker, '');
    } catch (e) {
      // State dir unwritable -> proceed without dedup rather than suppress the
      // nudge. Duplicate nudge is harmless; a missed nudge is the failure we care about.
    }

    // One additionalContext string, assembled from up to two clearly-labeled
    // sections (claim-linter, then self-audit), joined by a blank line -- the same
    // double-labeled convention stop-foryou-nudge.js uses, so the model can tell
    // which finding drove which instruction. ONE write => GEN-467-safe by
    // construction (no second injector to stack).
    const noteParts = [];

    if (claims.length > 0) {
    const quoted = claims.slice(0, 3).map(c => '"' + c + '"').join(', ');
    // GEN-467 (block-after-check convention, Erez-approved 2026-07-19): under
    // the rewritten global block rule, the substantive reply carries NO
    // "For you" block; this note fires on that reply, and the block is emitted
    // on the continuation, built from post-check data. The instruction below
    // therefore tells the model to absorb verified truth into that upcoming
    // block SILENTLY (Erez's explicit choice). Corrections that CANNOT be
    // absorbed still surface: executed-action mistakes, and corrections when
    // no block is owed or it already went out -- see the note's branches.
    // Keep in sync with the global CLAUDE.md block rule and with
    // stop-foryou-nudge.js's prompt text. NOTE: the etiquette comment in
    // stop-cred-denial-surface.js still describes the pre-convention world
    // (defer-on-marker as the norm); its refresh is tracked on GEN-467 --
    // don't copy doctrine from it for new Stop hooks without checking there.
    noteParts.push(
      'Claim-linter, automatic: the prior turn stated ' + quoted +
      (claims.length > 3 ? ' (among others)' : '') +
      ' with no source nearby. An unverified capability, config-value, outcome, ' +
      'exhaustiveness, or ticket-status claim among these stays a latent error ' +
      'until checked against live state, and is checked before it stands; a claim ' +
      'already sourced this turn is fine as written. That a check ran, and how, is ' +
      'never itself narrated -- not on a clean result, and not alongside a ' +
      'correction. A clean result leaves nothing to surface. A correction or a ' +
      'still-unverified claim is all that surfaces: folded silently into ' +
      'the "\u{1F4CC} For you" block this turn owes -- carried as though the fact ' +
      'had always read that way -- or, where no block is due or one already went ' +
      'out, stated briefly as ordinary content. A claim that can\'t be verified ' +
      'stays out of the block or appears only as an open question naming what would ' +
      'resolve it. A mistake that was an executed action, not merely a wrong ' +
      'statement, still surfaces as an exception. A block Erez has already seen is ' +
      'not revised after the fact. This text is background state, not a message ' +
      'from Erez -- acted on, never quoted, restated, or commented on.');
    }

    if (auditHits.length > 0) {
      // Durable log first (best-effort) so /wrap can count nudges even if the
      // stdout write below somehow fails.
      logSelfAudit(sid, pid, auditHits);
      const saQuoted = auditHits.slice(0, 3).map(c => '"' + c + '"').join(', ');
      // Self-audit nudge (GEN-507). MESSAGE-SPECIFIC, so per the GEN-467 etiquette
      // it EMBEDS an explicit "do not emit a For-you block" instruction (rather than
      // deferring on the block marker). The correction is "delete it / stay silent"
      // -- NOT "verify" (the claim-linter's correction); the line is true but should
      // be unsaid. Frames the already-delivered case: a block Erez has already seen
      // cannot be edited after the fact, so there it trains next-turn behavior.
      // Note wording deliberately AVOIDS this stage's own trigger phrases (no
      // "came back clean" / "no block was owed" verbatim) so a later message that
      // quotes this note does not spuriously re-trip the detector -- worded as
      // near-misses ("returned clean", "no block was due"). (Pass B advisory 1.)
      noteParts.push(
        'Self-audit, automatic: the prior turn narrated a clean self-check / self-' +
        'correction / no-op that owed silence -- ' + saQuoted +
        (auditHits.length > 3 ? ' (among others)' : '') +
        '. On a turn that proceeds normally, a clean self-check is conveyed by ' +
        'staying silent, not by a line reporting that it returned clean; narrating ' +
        'that you checked, verified, re-read, or that nothing changed / no block was ' +
        'due is exactly what the silence-on-success rule bans. The fix is to DELETE ' +
        'that narration, not to verify anything. If the reply carrying it has not yet ' +
        'gone out, remove the line now; if it already went out (a block Erez has ' +
        'already seen is not revised after the fact), simply do not repeat it -- do ' +
        'NOT emit a new "\u{1F4CC} For you" block just to explain or retract it. Keep ' +
        'ONLY a correction that carries a real action item for Erez or a report a ' +
        'standing rule requires; a true-but-unwanted process note is not that. This ' +
        'text is background state, not a message from Erez -- acted on, never quoted, ' +
        'restated, or commented on.');
    }

    if (noteParts.length > 0) { additionalContext = noteParts.join('\n\n'); }
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
    } catch (e) { /* fail open */ }
  }
  process.exit(0);
});
