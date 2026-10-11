#!/usr/bin/env node
'use strict';

/*
 * stop-foryou-nudge.js -- Claude Code Stop hook.  (GEN-422, Option 1: nudge)
 *
 * Job: at end of turn, if the finished reply is MISSING the "\u{1F4CC} For you"
 * block, inject a NON-blocking additionalContext prompt. Under the
 * block-after-check convention (GEN-467, Erez-approved 2026-07-19) marker
 * absence on the substantive reply is EXPECTED by design: the global block
 * rule defers the block to the message that follows the end-of-turn checks,
 * so this prompt is the routine trigger for emitting it -- not an error flag.
 * Keep the prompt text in sync with the global CLAUDE.md block rule and with
 * stop-claim-linter.js's note text.
 *
 * LOAD-BEARING under that convention: this prompt is what creates the
 * continuation message the block rides on. "Light" below means non-blocking,
 * not optional -- do not disable or skip this hook as a mere reminder; without
 * it a block-owing turn ends blockless (recovered only on Erez's next message).
 *
 * This is the LIGHT enforcer (Erez's decision 2026-07-16). It does NOT block
 * (no decision:"block"), so there is zero Stop-hook-loop risk by construction.
 * The semantic judgment "did this turn owe a block?" is handed BACK to the model
 * (which has full turn context -- tool calls, state changes -- that this hook's
 * payload lacks); the hook only detects marker ABSENCE and nudges.
 *
 * Detection is deliberately crude and asymmetric:
 *   - If the marker IS present -> stay silent (no nudge). Accepts that a bare or
 *     vacuous marker passes; presence != adequacy is a known, accepted limit.
 *   - If the marker is ABSENT -> nudge. The nudge is a reminder to self-check,
 *     NOT an assertion that a block was required -- so a false nudge on a turn
 *     that genuinely needed none costs only the model re-reading one sentence.
 *
 * EFFORT-TAG ENRICHMENT (GEN-466/GEN-473 lineage, added 2026-07-21): the global
 * block rule also requires that when a block puts a DECISION / choice of next
 * steps to Erez, each proposed path carry an "(effort[, model])" tag grounded in
 * notes/effort-model-reference.md. That was pure self-policed prose -> tags went
 * missing (Failure 1) and, when present, were fabricated rather than looked up
 * (Failure 2). This hook now enriches the SAME block-absent nudge (never a new
 * fire of its own; it rides the continuation re-nudge too -- see FOLLOW-UP
 * RE-NUDGE) when the finished reply shows an option/decision STRUCTURE but no
 * effort tag:
 *   - Failure 1: remind the model to tag each path when it writes the block.
 *   - Failure 2: inject the STABLE part of the effort reference (Parts 1-2 only;
 *     Part 3's benchmark numbers are stale-prone) so the model self-checks the
 *     number AS it writes it on the continuation.
 * Design converged through a 3-round independent /check panel (2026-07-21):
 *   - Detection keys on the effort VOCABULARY (low|medium|high|xhigh|max) near a
 *     model name, NEVER on bare parenthesis shape -- a naive "(x, y)" match
 *     false-fires on prose like "(verified, not from memory)".
 *   - The enrichment rides the block-ABSENT nudge only. It is NOT gated on
 *     tag-presence: the tag only ever appears on the continuation turn, where
 *     the block is written, and a block-carrying message is never nudged (a
 *     tag-gated inject there would recreate the GEN-467 duplicate-block bug).
 *     Injecting with the nudge puts the reference in the continuation's INPUT --
 *     the only correct timing, since a Stop hook can only feed the next turn.
 *     (Since GEN-748 the nudge, enrichment included, can also fire on a
 *     continuation that did tool work without writing the block -- see FOLLOW-UP
 *     RE-NUDGE below. It still never fires on a message carrying the marker.)
 *   - This adds NO new stdin dependency (no effort field is read); it consumes
 *     only last_assistant_message, exactly like the base nudge.
 * Honest ceiling: Failure 1 (SOME tag present) is reliably nudged; Failure 2 is
 * a self-check nudge only -- no hook can verify the level fits the kind of work.
 *
 * MODEL-TAG DIRECTIVE (Part A of the model-choice-control work, 2026-08-16):
 * Erez wants effort-only tags at/above his floor, and effort + a
 * "recommend going higher" note below it (since GEN-767 the floor depends on
 * the kind of work -- see TWO FLOORS BY KIND OF WORK) -- with full control over the model
 * (see the global CLAUDE.md tag rule, "model portion ... follow the directive
 * the end-of-turn Stop hook injects"). The Stop payload carries NO model field
 * (verified across 34 real payloads in gen450-stop-probe.jsonl), so this hook
 * reads the session model from the transcript's last main-agent assistant entry
 * (reconstructed by message.id), guarded by matching that entry's text against
 * the payload's last_assistant_message, then classifies it against the model
 * list and injects an explicit directive. The directive is emitted on EVERY
 * real block-absent nudge (every floor case + an "unconfirmed" fallback), so
 * "no directive present" for the block-writer means only "hook not installed."
 * The block-writer reconciles the named model against its own environment banner
 * and fails safe on mismatch, so a stale/lagging read degrades to "show the
 * model" rather than a wrong recommendation. See scratchpad Part A design +
 * a 3-round /check panel (2026-08-16) for the full rationale.
 *
 * TWO FLOORS BY KIND OF WORK (GEN-767, 2026-10-04): Erez replaced the single
 * Opus-4.8 floor with a minimum per kind of work ("The minimum should be
 * determined by the type of work that is needed"). STRONG floor = judgment and
 * correctness-critical work (incl. /vet-code); STANDARD floor = coding /
 * agentic / tool-heavy work and well-specified authoring, only at high effort
 * or above; mechanical work has no minimum; a mixed/unclear path takes the
 * strong floor. This hook can see the session model but NOT a path's kind of
 * work or the session's effort setting, so the directive tells the block-writer
 * which floors the session model meets and leaves the per-path call to it (the
 * same judgment that sets the path's effort -- advisory-strength, stated in the
 * reference file's honest-ceiling note). A model at or above the STRONG floor
 * gets the pre-GEN-767 "omit the model" text byte-for-byte; the CLI's `class`
 * stays the STRONG-floor class, so /vet-code (which must stay on the strong
 * floor) and /wrap read it unchanged.
 *
 * MODEL LIST, READ LIVE (GEN-705, 2026-09-24): the model tier ranking and the
 * floor sets are NOT inlined here any more -- they are read at runtime from
 * Part 2 of notes/effort-model-reference.md in the Improve AI Infra repo (the
 * single source of truth; see modelListPath). Any read/parse failure makes
 * every model "unconfirmed" (the directive's existing fail-safe) and drops the
 * tier sentence from the effort reference. The Part 2 tier line (the wholly
 * bold line) and the two labelled "Model floor -- strong / standard" lines'
 * "At or above it (...)" / "Below it (...)" lists are MACHINE-READ -- change
 * their format only together with this file. The same file doubles as a CLI
 * (see runCli) so /wrap and /vet-code reuse this exact classifier instead of
 * keeping their own copy.
 *
 * Fails open: any error -> no output, exit 0. Never disrupts turn end.
 *
 * SEARCH-FIRST STAGE (GEN-606 step C, 2026-10-11): a second, independent job in
 * the same process and the same single output write (so it inherits the GEN-467
 * one-write etiquette -- see stop-claim-linter.js's "WHY IT LIVES HERE"). When
 * the finished reply proposes a NEW ticket and no board search has succeeded
 * since Erez's last message, it adds a note asking for that search: appended to
 * the For-you note when that fires (mode A), or emitted ALONE when the block is
 * already on screen (mode B -- the one place this hook notes a block-carrying
 * reply, deliberately, measured and switchable off; see the stage's own header
 * above runHook). It runs after forYouNote() and can only add text; it never
 * changes or removes the For-you note.
 *
 * FOLLOW-UP RE-NUDGE (GEN-748, 2026-09-29): a Stop with stop_hook_active true
 * ends a continuation that some Stop hook's note opened. This hook used to exit
 * there unconditionally, so when a continuation IT opened was used to do the
 * rest of the work (2026-09-27: a whole /wrap, 36 tool calls) and ended without
 * the block, nothing nudged and the block was lost. Now the SAME nudge is
 * emitted on such a Stop only when ALL hold:
 *   1. this hook opened the continuation: the LAST system/stop_hook_summary
 *      entry in the transcript tail (FOLLOWUP_TAIL_BYTES, wider than the model
 *      read's window) has a hookAdditionalContext string starting
 *      with FORYOU_NOTE_PREFIX. The summary is written only after every Stop
 *      hook of that event has finished, so it can never be the CURRENT Stop's
 *      (a sibling hook's attachment for the current Stop may already be
 *      flushed; its summary cannot be). A continuation opened only by another
 *      hook's note stays silent -- those notes ask for no block in response;
 *   2. at least one main-chain tool call came after that summary (real work
 *      happened in the continuation);
 *   3. the finished reply (last_assistant_message) is non-empty and lacks the
 *      marker, and no main-chain assistant text after that summary carries it
 *      (an empty payload could hide a block the lagging transcript hasn't got);
 *   4. a slot is free: at most RENUDGE_CAP re-nudges per (session_id,
 *      prompt_id), claimed by exclusive file create in EMPTY_FIRE_DIR.
 * A text-only continuation is never re-nudged: measured over the 243 real
 * continuations whose content the transcripts show in order (2026-09-29),
 * that trigger would have fired 3 times, all on content already delivered,
 * where a re-nudge would duplicate it. Anything
 * missing or unreadable (no transcript, no summary in the tail, a state-dir
 * error) -> silent, i.e. the pre-GEN-748 behaviour.
 *
 * Loop-safety: this hook never blocks. A re-nudge needs NEW tool calls after
 * the latest note (its own note becomes the next anchor), is capped per
 * prompt_id (the same on a first Stop and its note-driven follow-up --
 * hooks/gen450-stop-probe.jsonl), and sits under the harness's own
 * 8-consecutive-continuation cap (hooks reference, "Stop decision control").
 * A continuation that writes the block, or ends without tool calls, ends the
 * chain.
 */

// The model emits the block header in several real forms (verified against a
// 33-payload Stop log): "📌 **For you**" (bold, the dominant form), "📌 For you"
// (plain), "**📌 For you". So match tolerantly: the pushpin (optionally with the
// U+FE0F emoji-presentation selector), up to 64 whitespace chars, up to two
// Markdown asterisks, up to 64 whitespace chars, then "For you". A strict
// literal "📌 For you" would MISS the dominant bold form and false-nudge most
// compliant turns.
// The runs are BOUNDED (GEN-684, 2026-09-29): the old unbounded \s* runs
// backtracked quadratically when a pin was followed by a long whitespace run
// that never resolved to "For you" (8.4s at 100K chars, measured 2026-09-29),
// on the full uncapped message, after the watchdog is cleared -- nothing could
// interrupt it. Bounded, it is ~0ms; recognition was unchanged over all 13,140
// real assistant texts on this machine (1,273 matches before and after). The
// \uFE0F? form was unmatched before; accepting it keeps a block written that
// way from drawing a false re-nudge (and a duplicate block).
// NOTE (GEN-467): this regex is copied VERBATIM into stop-cred-denial-surface.js
// (its defer condition) -- if you change it here, change it there too. And
// before adding any NEW Stop hook that emits additionalContext, read the
// GEN-467 etiquette comment in stop-cred-denial-surface.js first -- but know
// that comment still describes the PRE-convention world (defer-on-marker as
// the norm); its refresh is tracked on GEN-467. The current doctrine is the
// block-after-check convention in the global CLAUDE.md block rule.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKER_RE = /\u{1F4CC}\uFE0F?\s{0,64}\*{0,2}\s{0,64}For you/u;

// This hook's note opens with this text; the follow-up re-nudge (header) keys
// on it in the transcript to tell a continuation THIS hook opened. Build the
// note from it so the two cannot drift.
const FORYOU_NOTE_PREFIX = 'For-you check, automatic';

// --- Effort-tag enrichment detection (see header comment) ---------------------
// An effort-vocabulary token adjacent to a model name = a present tag. Anchored
// on the effort words, never on parenthesis shape. The window (up to ~24 chars
// between effort word and model, either order) covers "(xhigh, Opus 5)" and
// "Opus 5 at high effort" without matching unrelated prose that happens to
// contain a parenthetical. Model family names are the current Claude tiers.
const EFFORT_WORD = 'low|medium|high|xhigh|max';
const MODEL_WORD = 'Opus|Sonnet|Haiku|Fable';
const TAG_PRESENT_RE = new RegExp(
  '(?:\\b(?:' + EFFORT_WORD + ')\\b[^.\\n]{0,24}\\b(?:' + MODEL_WORD + ')\\b)' +
  '|(?:\\b(?:' + MODEL_WORD + ')\\b[^.\\n]{0,24}\\b(?:' + EFFORT_WORD + ')\\b)',
  'i'
);
// Part A: an effort-ONLY tag must also count as "tag present", else a correct
// strong-model tag like "(xhigh)" (model deliberately omitted) reads as
// tag-missing and the effort enrichment re-nags every strong-model turn. This
// matches a parenthetical that STARTS with an effort word, optionally followed
// by ", <model>..." -- so "(xhigh)" and "(xhigh, Opus 5)" and
// "(high, Sonnet 5 -- recommend ...)" all count, while prose like "(high
// stakes)" / "(low risk)" / "(medium effort)" does NOT (the effort word is not
// immediately followed by ")" or ", <model>"). Governs ONLY the effort
// reminder, never the model directive.
const EFFORT_ONLY_TAG_RE = new RegExp(
  '\\(\\s*(?:' + EFFORT_WORD + ')\\b(?:\\s*,\\s*(?:' + MODEL_WORD + ')[^)]*)?\\s*\\)',
  'i'
);
// Option/decision STRUCTURE proxy (explicitly a bounded proxy, GEN-501 style).
// A DECISION signal is required; a bare option list alone does NOT qualify --
// numbered/lettered lists are common in ordinary status replies (completed-work
// summaries, step recaps), so a bare list would false-fire constantly (Pass-B
// advisory, 2026-07-21). The decision signal is: an explicit decision phrase, OR
// an interrogative (a question mark) -- i.e. the reply is actually ASKING Erez
// to choose, not just enumerating. An option list REINFORCES but cannot stand
// alone. A missed structure only costs a missed reminder (base nudge still fires).
const OPTION_LIST_RE = /^[ \t]*(?:\d+[.)]|[a-eA-E][.)])\s+\S/m;
const DECISION_PHRASE_RE = /\byour call\b|\bgo\/no-go\b|\bwhich\b[^?\n]{0,80}\?|\bwhich (?:do you|would you|of these)\b|\bdo you want (?:me to|to)\b/i;
// A question mark ONLY counts as a decision signal when paired with an option
// list (a bare "?" in prose is not a decision) -- keeps precision high.
const INTERROGATIVE_RE = /\?/;

function hasDecisionStructure(msg) {
  if (DECISION_PHRASE_RE.test(msg)) return true;
  // An option list is a decision only when the reply also poses a question.
  return OPTION_LIST_RE.test(msg) && INTERROGATIVE_RE.test(msg);
}
function hasEffortTag(msg) {
  return TAG_PRESENT_RE.test(msg) || EFFORT_ONLY_TAG_RE.test(msg);
}

// --- Model list: live read of notes/effort-model-reference.md Part 2 (GEN-705) --
// Floors = whatever the reference file's two labelled "Model floor -- strong"
// and "Model floor -- standard" lines say (GEN-767). Classification uses the
// EXPLICIT "At or above it (...)" and "Below it (...)" lists on those lines,
// never tier-line position (the tier line carries "?" unverified or
// effort-dependent orders). Matching is by exact
// (name, major, minor) tuple -- NOT string prefix: "claude-opus-5" is a literal
// prefix of "claude-opus-5-5", so prefix matching cannot tell a listed model
// from a newer one, and it would also accept odd variants like
// "claude-opus-5-5-fast". A dated suffix (claude-haiku-4-5-20251001) is ignored.
// Resolved lazily (inside getModelList's try) so an os.homedir() failure can
// never crash the hook at load time.
function modelListPath() {
  return path.join(os.homedir(), 'AI Projects', 'Improve AI Infra', 'notes', 'effort-model-reference.md');
}
// Version numbers carry no leading zeros (so "claude-opus-05-5" is unlisted,
// not silently read as Opus 5.5); a minor is 0 or 1-99.
const DISPLAY_NAME_RE = /^([A-Za-z]+)\s+([1-9]\d*)(?:\.(0|[1-9]\d?))?$/;
const MODEL_ID_RE = /^claude-([a-z]+)-([1-9]\d*)(?:-(0|[1-9]\d?))?(?:-(20\d{6}))?$/;
// Not a model: Claude Code writes this on locally-synthesized assistant entries.
const SYNTHETIC_MODEL = '<synthetic>';

function parseDisplayName(s) {
  const label = String(s).trim();
  const m = DISPLAY_NAME_RE.exec(label);
  if (!m) return null;
  return { label: label, name: m[1].toLowerCase(), major: parseInt(m[2], 10), minor: m[3] ? parseInt(m[3], 10) : 0 };
}

function parseModelId(id) {
  const m = MODEL_ID_RE.exec(String(id == null ? '' : id));
  if (!m) return null;
  return { name: m[1], major: parseInt(m[2], 10), minor: m[3] ? parseInt(m[3], 10) : 0 };
}

function tupleKey(e) { return e.name + '-' + e.major + '-' + e.minor; }

// The two floors (GEN-767), in the order they are reported. STRONG is the
// back-compat floor: list.atAbove / list.below and the CLI's `class` are its.
const FLOOR_BARS = ['strong', 'standard'];
// A floor line's label: "Model floor", a dash (em, en or hyphen), then the bar
// name. Only applied to a line that also carries "At or above it (", so a
// heading like "Model floors -- ..." or prose naming a floor cannot match.
const FLOOR_LABEL_RE = /Model floor\s*[\u2014\u2013-]+\s*(strong|standard)\b/i;

// Parse one floor line's two lists. Returns { bar: {atAbove, below} } or
// { error }.
function parseFloorLine(line, barName) {
  const aa = /At or above it \(([^)]*)\)/.exec(line);
  const bb = /Below it \(([^)]*)\)/.exec(line);
  if (!aa || !bb) return { error: '"At or above it (...)" / "Below it (...)" lists not found on the ' + barName + ' Model floor line' };
  const parseSet = (s) => s.split(',').map((x) => x.trim()).filter(Boolean).map(parseDisplayName);
  const atAbove = parseSet(aa[1]);
  const below = parseSet(bb[1]);
  if (!atAbove.length || !below.length) return { error: 'a ' + barName + ' floor list is empty' };
  if (atAbove.some((e) => !e) || below.some((e) => !e)) return { error: 'a ' + barName + ' floor list entry is not a "<Name> <major>[.<minor>]" model name' };
  const aaKeys = new Set(atAbove.map(tupleKey));
  if (below.some((e) => aaKeys.has(tupleKey(e)))) return { error: 'a model is in both the at-or-above and below lists of the ' + barName + ' floor' };
  return { bar: { atAbove: atAbove, below: below } };
}

// Parse the reference file's text. Returns { list, error }: list is
// { atAbove: [...], below: [...] (both = the STRONG floor's, back-compat),
//   bars: { strong: {atAbove, below}, standard: {atAbove, below} },
//   tier: [{label, sep}], warnings: [...] }
// or null with a one-line error. Pure (no I/O) so it can be fixture-tested.
function parseModelListText(text) {
  const lines = String(text).split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) { if (/^## Part 2\b/.test(lines[i])) { start = i; break; } }
  if (start === -1) return { list: null, error: 'Part 2 section not found' };
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) { if (/^## /.test(lines[j])) { end = j; break; } }
  let tierText = null;
  const floorLines = {};
  for (let k = start + 1; k < end; k++) {
    const l = lines[k];
    // Tier line: the first WHOLLY bold line that contains a ">" separator (so a
    // bold note placed above it cannot be taken for the ranking).
    if (tierText === null) {
      const tm = /^\*\*([^*]+)\*\*\s*$/.exec(l);
      if (tm && tm[1].indexOf('>') !== -1) tierText = tm[1];
    }
    // Floor lines: EVERY line carrying BOTH "Model floor" and the "At or above
    // it (" list (so a note that merely mentions a floor cannot hijack one),
    // each identified by its label. An unlabelled one (e.g. the pre-GEN-767
    // single-floor line) or a repeated label is ambiguous -> fail safe (every
    // model unconfirmed) rather than guess which floor it is.
    if (l.indexOf('Model floor') !== -1 && l.indexOf('At or above it (') !== -1) {
      const lm = FLOOR_LABEL_RE.exec(l);
      if (!lm) return { list: null, error: 'a Model floor line in Part 2 has no "strong" / "standard" label' };
      const name = lm[1].toLowerCase();
      if (floorLines[name] !== undefined) return { list: null, error: 'two Model floor lines are labelled "' + name + '"' };
      floorLines[name] = l;
    }
  }
  const bars = {};
  for (const name of FLOOR_BARS) {
    if (floorLines[name] === undefined) return { list: null, error: '"Model floor -- ' + name + '" line (with its "At or above it (...)" list) not found in Part 2' };
    const r = parseFloorLine(floorLines[name], name);
    if (r.error) return { list: null, error: r.error };
    bars[name] = r.bar;
  }

  // Tier line: names separated by ">" (ordered) or "?" (order unverified). It
  // only feeds the rendered effort sentence -- classification uses the floor
  // lists -- so a missing or malformed tier line is a WARNING, never a reason
  // to disable classification.
  const tier = [];
  const tierWarnings = [];
  if (tierText === null) {
    tierWarnings.push('tier line (a wholly bold line with ">" separators) not found in Part 2');
  } else {
    const parts = tierText.split(/\s*([>?])\s*/);
    for (let p = 0; p < parts.length; p += 2) {
      const label = parts[p].trim();
      if (!label) { tierWarnings.push('tier line has an empty entry (stray separator)'); continue; }
      tier.push({ label: label, sep: p + 1 < parts.length ? parts[p + 1] : null });
    }
    if (tier.length) tier[tier.length - 1].sep = null;
  }

  // A model at or above the strong floor but BELOW the standard floor is an
  // inconsistent file (good enough for judgment work, not for coding) -- and
  // it is exactly what swapped strong/standard labels look like, which would
  // otherwise pass a weak model as strong (so /vet-code would run a
  // safety-critical review on it unasked). Fail safe, like an unlabelled or
  // duplicated floor line.
  const stdBelowKeys = new Set(bars.standard.below.map(tupleKey));
  for (const e of bars.strong.atAbove) {
    if (stdBelowKeys.has(tupleKey(e))) return { list: null, error: 'model "' + e.label + '" is at or above the strong floor but below the standard floor (are the strong/standard labels swapped?)' };
  }

  // Cross-checks, all WARNINGS (classification still works): each floor must
  // list every tier-line model and nothing off the tier line.
  const warnings = tierWarnings;
  const tierKeys = new Set();
  const tierEntries = [];
  for (const t of tier) {
    const e = parseDisplayName(t.label);
    if (!e) { warnings.push('tier-line entry "' + t.label + '" is not a model name'); continue; }
    tierKeys.add(tupleKey(e));
    tierEntries.push(e);
  }
  for (const name of FLOOR_BARS) {
    const b = bars[name];
    const setKeys = new Set(b.atAbove.concat(b.below).map(tupleKey));
    for (const e of tierEntries) {
      if (!setKeys.has(tupleKey(e))) warnings.push('tier-line model "' + e.label + '" is in neither ' + name + ' floor list (it classifies as unlisted there)');
    }
    for (const e of b.atAbove.concat(b.below)) {
      if (tierText !== null && !tierKeys.has(tupleKey(e))) warnings.push(name + ' floor-list model "' + e.label + '" is not on the tier line');
    }
  }
  return { list: { atAbove: bars.strong.atAbove, below: bars.strong.below, bars: bars, tier: tier, warnings: warnings }, error: null };
}

function loadModelList(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { list: null, error: 'reference file unreadable (' + (e && e.code ? e.code : 'error') + '): ' + filePath };
  }
  try {
    return parseModelListText(text);
  } catch (e) {
    return { list: null, error: 'reference file parse threw' };
  }
}

// Read once per process. Never throws.
let cachedModelList = null;
function getModelList() {
  if (!cachedModelList) {
    try { cachedModelList = loadModelList(modelListPath()); } catch (e) { cachedModelList = { list: null, error: 'model list load threw' }; }
  }
  return cachedModelList;
}

// Classes:
//   listed-at-above   -- exactly listed at or above the floor
//   listed-below      -- exactly listed below the floor
//   newer-in-family   -- not listed, but same name AND major as a listed
//                        at-or-above model with minor >= the smallest listed
//                        minor there (Erez's option B, 2026-09-24: a newer or
//                        in-between point release of a strong family); callers
//                        treat it as at-or-above and flag "add it to the list"
//   unlisted          -- anything else: new name, new major (claude-opus-6),
//                        odd suffix, an older version, a newer version of a
//                        BELOW-floor family (deliberately not auto-graded --
//                        it could have crossed the floor), a family that also
//                        has an entry BELOW the floor, or no list at all
function classifyModelId(id, list) {
  const p = parseModelId(id);
  if (!p || !list) return 'unlisted';
  const same = (e) => e.name === p.name && e.major === p.major && e.minor === p.minor;
  if (list.atAbove.some(same)) return 'listed-at-above';
  if (list.below.some(same)) return 'listed-below';
  // The in-family rule assumes strength rises with the minor version. If the
  // list itself demotes a model of this same name+major below the floor, that
  // assumption is visibly false for this family -> no auto-grading.
  if (list.below.some((e) => e.name === p.name && e.major === p.major)) return 'unlisted';
  const fam = list.atAbove.filter((e) => e.name === p.name && e.major === p.major);
  if (fam.length && p.minor >= Math.min.apply(null, fam.map((e) => e.minor))) return 'newer-in-family';
  return 'unlisted';
}

// The model's class against EACH floor (GEN-767), via classifyModelId on that
// floor's own lists. No list -> 'unlisted' for both.
function classifyByBar(id, list) {
  const out = {};
  for (const name of FLOOR_BARS) {
    out[name] = classifyModelId(id, list && list.bars ? list.bars[name] : null);
  }
  return out;
}

function meetsFloor(cls) { return cls === 'listed-at-above' || cls === 'newer-in-family'; }

// "Fable 5.1 > Fable 5 ~ Opus 5.5 > ..." ("~" marks an order that is
// unverified or depends on effort).
function renderTierList(list) {
  if (!list) return '';
  let s = '';
  let unverified = false;
  for (const t of list.tier) {
    s += t.label;
    if (t.sep === '?') { s += ' ~ '; unverified = true; } else if (t.sep) { s += ' > '; }
  }
  return s + (unverified ? ' ("~" = relative order unverified or effort-dependent)' : '');
}

// Read the session model from the transcript's LAST main-agent (isSidechain!==
// true) assistant message, reconstructed by message.id across all its lines
// (a single logical message can split across multiple JSONL lines when it has
// more than one content block). Trust the model ONLY if that reconstructed text
// equals the payload's last_assistant_message (exact, or trailing-whitespace-
// trimmed) -- the guard that proves we read THIS finished turn, not a stale or
// still-lagging entry. Returns the model string, or null on any miss/error.
// (The isSidechain filter is belt-and-suspenders: in the current architecture
// sub-agent turns live in separate subagents/agent-*.jsonl files, so the main
// transcript has no sidechain lines -- the filter is harmless and future-proofs
// against that changing.) Reconstruction validated 14/14 exact against real
// payloads (scratchpad/partA-matchrate-probe2.js, 2026-08-16).
// The transcript TAIL as parsed entries (malformed lines skipped), or null on
// any error. Shared by readSessionModel and the follow-up re-nudge check; read
// fresh on each call (not cached), so the model read sees any line flushed
// since the re-nudge check -- the double read happens only when a re-nudge
// fires. Only the tail is read, not the whole file: this hook fires on
// essentially every substantive turn and a session transcript grows to many
// MB, so a full readFileSync would add hot-path latency and, past Node's max
// string length, would throw. The re-nudge check reads a wider window than the
// model read: its anchor summary sits at the START of the continuation, and the
// motivating 2026-09-27 continuation alone was 296 KB (36 tool calls).
const TAIL_BYTES = 512 * 1024;
const FOLLOWUP_TAIL_BYTES = 2 * 1024 * 1024;
function readTranscriptTail(transcriptPath, tailBytes) {
  try {
    if (!transcriptPath || typeof transcriptPath !== 'string') return null;
    const want = tailBytes || TAIL_BYTES;
    let raw;
    const size = fs.statSync(transcriptPath).size;
    if (size > want) {
      const fd = fs.openSync(transcriptPath, 'r');
      try {
        const buf = Buffer.alloc(want);
        const n = fs.readSync(fd, buf, 0, want, size - want);
        raw = buf.toString('utf8', 0, n);
      } finally {
        fs.closeSync(fd);
      }
      // Drop the first (possibly partial) line, incl. any split multi-byte char.
      const nl = raw.indexOf('\n');
      raw = nl >= 0 ? raw.slice(nl + 1) : '';
    } else {
      raw = fs.readFileSync(transcriptPath, 'utf8');
    }
    const parsed = [];
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]) continue;
      try { parsed.push(JSON.parse(lines[i])); } catch (e) { /* skip malformed line */ }
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

function readSessionModel(transcriptPath, payloadText) {
  try {
    if (!transcriptPath || typeof payloadText !== 'string' || !payloadText) return null;
    // The last main-agent assistant message's lines sit at the end of the
    // transcript and fit comfortably in the tail window; if a message were
    // somehow larger than the window the reconstruction is partial, the
    // match-guard fails, and we return null (UNCONFIRMED) -- a truncated tail
    // can never yield a WRONG model, only an unconfirmed one.
    const parsed = readTranscriptTail(transcriptPath);
    if (!parsed) return null;
    let lastIdx = -1;
    for (let i = parsed.length - 1; i >= 0; i--) {
      const e = parsed[i];
      if (e && e.type === 'assistant' && e.isSidechain !== true && e.message) { lastIdx = i; break; }
    }
    if (lastIdx === -1) return null;
    const id = parsed[lastIdx].message.id;
    const model = parsed[lastIdx].message.model;
    if (!model) return null;
    let text = '';
    for (let i = 0; i < parsed.length; i++) {
      const e = parsed[i];
      if (e && e.type === 'assistant' && e.isSidechain !== true && e.message && e.message.id === id && Array.isArray(e.message.content)) {
        for (let j = 0; j < e.message.content.length; j++) {
          const c = e.message.content[j];
          if (c && c.type === 'text' && typeof c.text === 'string') text += c.text;
        }
      }
    }
    if (text === payloadText) return String(model);
    // trimEnd, not .replace(/\s+$/, ''): the regex backtracks quadratically on a
    // long whitespace run that is NOT at the end (4.8s at 100K chars, measured
    // 2026-09-29 -- the same freeze class as GEN-684); trimEnd strips exactly
    // the same characters (checked for every BMP code unit) in linear time.
    if (text.trimEnd() === payloadText.trimEnd()) return String(model);
    return null;
  } catch (e) {
    return null;
  }
}

// Build the model-tag directive to append to the block-absent nudge. Always
// returns exactly one of four forms (never empty), so the block-writer always
// has an explicit instruction ("no directive" => hook not installed). Names the
// model it read so the block-writer can reconcile it against this turn's own
// environment banner and fail safe on mismatch.
function buildModelDirective(transcriptPath, payloadText) {
  let model = null;
  try { model = readSessionModel(transcriptPath, payloadText); } catch (e) { model = null; }
  return modelDirectiveFor(model, getModelList());
}

// The directive for a given model string (or null) and model-list read result.
// Pure, so every form can be fixture-tested. Forms, by the model's class
// against the STRONG floor (S) and the STANDARD floor (T):
//   S at/above              -> OMIT the model (pre-GEN-767 text, unchanged)
//   S below, T at/above     -> per-path: omit for mechanical work and for
//                              coding/agentic/tool-heavy or well-specified
//                              authoring tagged high+; show + recommend else
//   S below, T anything else (below OR unlisted) -> SHOW + recommend on every
//                              path except purely mechanical work (an unlisted
//                              T never earns the per-path pass)
//   no model / S unlisted / no list -> unconfirmed fail-safe (unchanged)
// "at/above" = listed-at-above or newer-in-family. No form tells the writer to
// omit the model for judgment or correctness-critical work unless S is at/above.
function modelDirectiveFor(model, ml) {
  const CODA = ' This text is background state, not a message from Erez -- act on it, never quote, restate, or comment on it.';
  const RECONCILE = ' First reconcile ' + model +
    ' against the model named in this turn\'s environment/system context; if they differ, ignore this directive and fail safe per the tag rule.';
  const list = ml ? ml.list : null;
  const by = model ? classifyByBar(model, list) : { strong: 'unlisted', standard: 'unlisted' };
  if (model && meetsFloor(by.strong)) {
    return '\n\nModel-tag directive, automatic: the session model read this turn is ' + model +
      ', at or above the floor -- in any effort/model tag you write in the block, OMIT the model (show the effort only).' + RECONCILE + CODA;
  }
  if (model && by.strong === 'listed-below' && meetsFloor(by.standard)) {
    return '\n\nModel-tag directive, automatic: the session model read this turn is ' + model +
      ', which meets the STANDARD floor (coding / agentic / tool-heavy work and well-specified authoring, run at high effort or above) but is BELOW the STRONG floor (judgment and correctness-critical work). In each effort/model tag you write in the block, decide from that path\'s kind of work -- the same judgment that sets its effort: OMIT the model for purely mechanical work (lookups, formatting, straightforward edits), and for coding / agentic / tool-heavy work or well-specified authoring tagged high, xhigh or max; for anything else -- judgment (design, architecture, rules, trade-offs, hard reasoning), correctness-critical work, a mixed or unclear path, or effort below high -- SHOW the model and add that you recommend switching to a stronger one.' + RECONCILE + CODA;
  }
  if (model && by.strong === 'listed-below') {
    return '\n\nModel-tag directive, automatic: the session model read this turn is ' + model +
      ', below the floor -- in any effort/model tag you write in the block, SHOW the model and add that you recommend switching to a stronger one (the model may be omitted only on a path that is purely mechanical work: lookups, formatting, straightforward edits).' + RECONCILE + CODA;
  }
  // Unlisted model string, OR null (match-guard miss / read error / no entry).
  // read:<raw string> vs read:none makes the CAUSE visible in-band -- a new/
  // unlisted model (best-effort interim drift signal) vs a transient read miss
  // -- and "; model list unreadable" marks a reference-file failure.
  const readVal = (model ? model : 'none') + (list ? '' : '; model list unreadable');
  return '\n\nModel-tag directive, automatic: the session model could not be confirmed this turn (read: ' + readVal +
    ') -- fail safe: in any effort/model tag, show the model from this turn\'s environment/system context, marked unconfirmed, and add no recommendation of your own.' + CODA;
}

// The stable effort reference. Part 1 of notes/effort-model-reference.md is
// model-independent by the file's own statement, so it stays inlined; the
// model tier list (Part 2) comes from the live read above and is simply
// omitted if the reference file can't be read. Part 3 (CursorBench numbers) is
// deliberately EXCLUDED -- it is flagged stale-prone in the source file. If
// Part 1 changes materially in the source, refresh this literal.
const EFFORT_PRINCIPLES =
  'Effort-by-work-kind (stable, model-independent): coding / agentic / ' +
  'tool-heavy -> xhigh; design, architecture, hard reasoning, trade-off ' +
  'analysis -> high (minimum); simple / mechanical / latency-sensitive ' +
  '(transcription, formatting, straightforward edits, lookups) -> low; ' +
  'correctness matters more than cost/latency -> max. medium = the step-down ' +
  'for well-specified work that is more than trivial (e.g. authoring from a ' +
  'settled spec).';
const EFFORT_DROP_ONE =
  'a stronger model can often drop one effort level for the same work and ' +
  'hold quality -- pick the effort the WORK needs, then adjust down if the ' +
  'current model is strong.';

function buildEffortReference() {
  let tierList = '';
  try { tierList = renderTierList(getModelList().list); } catch (e) { tierList = ''; }
  if (tierList) return EFFORT_PRINCIPLES + ' Model tiers strongest->weakest: ' + tierList + '; ' + EFFORT_DROP_ONE;
  return EFFORT_PRINCIPLES + ' A' + EFFORT_DROP_ONE.slice(1);
}

// --- CLI mode (GEN-705) -------------------------------------------------------
// Used by /wrap and /vet-code so they reuse THIS classifier. Only entered when
// argv[2] is one of the three known commands; anything else (incl. no args,
// the registered form) runs the hook. Each command prints ONE JSON line and
// exits 0; bad usage -> stderr + exit 1. Never exit 2 here: for a Stop hook
// exit 2 is a BLOCKING code (it would force the turn to continue). Never
// reads stdin, never writes files. exitCode (not process.exit) so a piped
// stdout is flushed before the process ends.
// `class` is the STRONG-floor class (the pre-GEN-767 meaning, which /vet-code
// and /wrap rely on); `byBar` adds the class against each floor.
function describeModel(id, ml) {
  const p = parseModelId(id);
  const byBar = classifyByBar(id, ml.list);
  return {
    model: id,
    class: byBar.strong,
    byBar: byBar,
    name: p ? p.name : null,
    family: p ? p.name + '-' + p.major : null,
    listError: ml.error
  };
}

// Distinct message.model values on type:"assistant" lines of a (sub-agent)
// transcript, streamed in 64 KB chunks so a very large file is never read
// whole. Lines are assembled from chunk pieces (linear, not re-concatenating a
// growing carry buffer). SYNTHETIC_MODEL entries are skipped. allSidechain is
// true only when every assistant entry carries isSidechain:true -- a sub-agent
// transcript does (verified on real files), a main-session transcript does
// not -- so a caller can refuse a path that points at the wrong file.
function readTranscriptModels(filePath) {
  const models = [];
  const seen = new Set();
  let assistantCount = 0;
  let sidechainCount = 0;
  const handleLine = (s) => {
    if (s.indexOf('"assistant"') === -1) return;
    let e;
    try { e = JSON.parse(s); } catch (err) { return; }
    if (!e || e.type !== 'assistant' || !e.message) return;
    assistantCount++;
    if (e.isSidechain === true) sidechainCount++;
    if (typeof e.message.model !== 'string') return;
    const m = e.message.model;
    if (m === SYNTHETIC_MODEL || seen.has(m)) return;
    seen.add(m);
    models.push(m);
  };
  let fd;
  try { fd = fs.openSync(filePath, 'r'); } catch (e) { return { models: models, allSidechain: false, error: 'transcript unreadable (' + (e && e.code ? e.code : 'error') + ')' }; }
  try {
    const CHUNK = 64 * 1024;
    const buf = Buffer.alloc(CHUNK);
    let pending = [];
    let n;
    while ((n = fs.readSync(fd, buf, 0, CHUNK, null)) > 0) {
      const chunk = Buffer.from(buf.subarray(0, n));
      let startAt = 0;
      let idx;
      while ((idx = chunk.indexOf(10, startAt)) !== -1) {
        pending.push(chunk.subarray(startAt, idx));
        handleLine(Buffer.concat(pending).toString('utf8'));
        pending = [];
        startAt = idx + 1;
      }
      if (startAt < chunk.length) pending.push(chunk.subarray(startAt));
    }
    if (pending.length) handleLine(Buffer.concat(pending).toString('utf8'));
  } catch (e) {
    return { models: models, allSidechain: false, error: 'transcript read failed (' + (e && e.code ? e.code : 'error') + ')' };
  } finally {
    try { fs.closeSync(fd); } catch (e) { /* ignore */ }
  }
  const allSidechain = assistantCount > 0 && sidechainCount === assistantCount;
  return { models: models, allSidechain: allSidechain, error: models.length ? null : 'no assistant model found in transcript' };
}

const CLASS_RANK = { 'unlisted': 0, 'listed-below': 1, 'newer-in-family': 2, 'listed-at-above': 3 };

function runCli(args) {
  const out = (o) => { process.stdout.write(JSON.stringify(o) + '\n'); };
  const cmd = args[0];
  if (cmd === '--classify' && args.length === 2) {
    out(describeModel(args[1], getModelList()));
    process.exitCode = 0;
    return;
  }
  if (cmd === '--agent-transcript' && args.length === 2) {
    const ml = getModelList();
    const r = readTranscriptModels(args[1]);
    const described = r.models.map((m) => describeModel(m, ml));
    let worst = described.length ? described[0].class : 'unlisted';
    for (const d of described) { if (CLASS_RANK[d.class] < CLASS_RANK[worst]) worst = d.class; }
    if (r.error) worst = 'unlisted';
    out({ models: described, class: worst, allSidechain: r.allSidechain, error: r.error, listError: ml.error });
    process.exitCode = 0;
    return;
  }
  if (cmd === '--selftest' && args.length === 1) {
    const ml = getModelList();
    out({
      ok: !!ml.list,
      referencePath: (function () { try { return modelListPath(); } catch (e) { return null; } })(),
      error: ml.error,
      warnings: ml.list ? ml.list.warnings : [],
      atAbove: ml.list ? ml.list.atAbove.map((e) => e.label) : [],
      below: ml.list ? ml.list.below.map((e) => e.label) : [],
      bars: ml.list ? FLOOR_BARS.reduce((o, n) => {
        o[n] = { atAbove: ml.list.bars[n].atAbove.map((e) => e.label), below: ml.list.bars[n].below.map((e) => e.label) };
        return o;
      }, {}) : {},
      tierList: renderTierList(ml.list)
    });
    process.exitCode = 0;
    return;
  }
  process.stderr.write('usage: node stop-foryou-nudge.js --classify <model-id> | --agent-transcript <path> | --selftest\n');
  process.exitCode = 1;
}

// State dir for this hook's caps: the empty-message fire sentinel (see
// detection comment below; one anomalous empty-payload fire per session), the
// follow-up re-nudge slots (see header), and the search-first stage's
// once-per-Erez-message slots and per-session "after" pending files (see that
// stage). Everything in it is TTL-pruned so
// it can't grow unbounded. Same pattern as stop-claim-linter.js's STATE_DIR.
// (fs/os/path are required at the top of the file.)
const EMPTY_FIRE_DIR = path.join(os.tmpdir(), 'claude-foryou-nudge-state');
const EMPTY_FIRE_TTL_MS = 24 * 60 * 60 * 1000;
const RENUDGE_CAP = 2;

// Follow-up state for the re-nudge (see header), relative to the LAST
// stop_hook_summary entry in the parsed tail: did this hook's note open the
// continuation, how many main-chain tool calls came after it, and did any
// main-chain assistant text after it carry the marker. Pure (fixture-tested).
// null when there is no tail or no summary in it.
function followupState(entries) {
  if (!Array.isArray(entries)) return null;
  let s = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e && e.type === 'system' && e.subtype === 'stop_hook_summary') { s = i; break; }
  }
  if (s === -1) return null;
  const ctx = entries[s].hookAdditionalContext;
  const openedByThisHook = Array.isArray(ctx) &&
    ctx.some((c) => typeof c === 'string' && c.indexOf(FORYOU_NOTE_PREFIX) === 0);
  let toolCalls = 0;
  let markerAfter = false;
  for (let i = s + 1; i < entries.length; i++) {
    const e = entries[i];
    if (!e || e.type !== 'assistant' || e.isSidechain === true || !e.message || !Array.isArray(e.message.content)) continue;
    for (const c of e.message.content) {
      if (!c) continue;
      if (c.type === 'tool_use') toolCalls++;
      else if (c.type === 'text' && typeof c.text === 'string' && MARKER_RE.test(c.text)) markerAfter = true;
    }
  }
  return { openedByThisHook: openedByThisHook, toolCalls: toolCalls, markerAfter: markerAfter };
}

// Claim one of RENUDGE_CAP re-nudge slots for this (session, prompt) by
// exclusive create, so two concurrent Stop processes can never both take the
// same slot. true = claimed; false = cap reached OR any state error (the
// re-nudge path fails toward silence, the pre-GEN-748 behaviour).
function claimRenudgeSlot(sessionId, promptId) {
  try {
    const sid = String(sessionId || 'nosession').replace(/[^\w.-]/g, '_');
    const pid = String(promptId || 'noprompt').replace(/[^\w.-]/g, '_');
    fs.mkdirSync(EMPTY_FIRE_DIR, { recursive: true });
    pruneEmptyFireDir();
    for (let n = 1; n <= RENUDGE_CAP; n++) {
      const p = path.join(EMPTY_FIRE_DIR, 'renudge.' + sid + '.' + pid + '.' + n);
      try {
        fs.closeSync(fs.openSync(p, 'wx'));
        return true;
      } catch (e) {
        if (!e || e.code !== 'EEXIST') return false;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

function pruneEmptyFireDir() {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(EMPTY_FIRE_DIR)) {
      const p = path.join(EMPTY_FIRE_DIR, name);
      try {
        if (now - fs.statSync(p).mtimeMs > EMPTY_FIRE_TTL_MS) { fs.unlinkSync(p); }
      } catch (e) { /* skip this entry */ }
    }
  } catch (e) { /* dir missing or unreadable -> nothing to prune */ }
}

// --- Search-first stage (GEN-606 step C) -------------------------------------
// Job: when the finished reply PROPOSES A NEW TICKET (an offer, a question, a
// commitment, a plan step, or a ticket draft shown in chat) and no board search
// has succeeded since Erez's last message, add a note asking Claude to search
// for an existing home before Erez decides -- the search-before-proposing that
// GEN-606 found missing (2026-08-02, 2026-10-08) and that /vet-ticket Step 0b
// defines. A reminder, not a lock: oddly worded proposals slip past.
//
// Two modes, picked by whether the For-you note above fires on this Stop:
//   A (it fires: no block written yet) -> SF_NOTE_WITH_BLOCK is appended to it,
//     so the block is written leading with the search result. Any pattern.
//   B (it is silent: the block is already on screen, or the continuation was
//     not this hook's) -> SF_NOTE_ALONE is emitted alone, asking for the search
//     and one plain sentence of result, never a second block. Only when the
//     reply puts a decision to Erez (putsDecision) -- a plain "I'll file it"
//     commitment reaches /vet-ticket, whose Step 0b searches before filing.
//     Its text must NOT start with FORYOU_NOTE_PREFIX, so the follow-up
//     re-nudge never treats its continuation as one this hook opened to get a
//     block. Mode B goes against the GEN-467 rule that notes stay silent after
//     a shown block (stop-signal-surface.js header), so it ships with its
//     duplicate-block risk MEASURED -- see the "after" log row below -- and can
//     be switched off without a code change: append
//     {"kind":"switch","afterBlock":"off"} to SF_SWITCH_FILE (and "on" to
//     undo); the newest switch row wins. Mode A is never switched off. The
//     continuation's result sentence follows the shown block -- a known tension
//     with the global rule that the block is the turn's final handoff, accepted
//     with Mode B.
// At most once per Erez message (slot files). Every fire appends a "fire" row to
// SEARCH_FIRST_LOG next to this file; the Stop that ends the note's continuation
// appends an "after" row (did a search follow, the result sentence, a re-issued
// block). A /wrap step (GEN-606) reads both files out to Erez.
// Scope is NEW tickets only: a note on an existing ticket (usually the one being
// worked, or one Erez named) fired noisily in the measured corpus.
// Patterns were tuned on 3,731 real end-of-turn replies (2026-07-15..10-11).
// MAINTENANCE: when a missed proposal is found, test its wording here and add a
// pattern the same session; re-run the corpus check before shipping. Keep every
// pattern free of adjacent optional whitespace runs (GEN-684 backtracking).

const SEARCH_FIRST_LOG = 'search-first-nudges.jsonl';
// Its own small file, so a switch row can never scroll out of a bounded read
// of the (growing) log. *.jsonl, so the sync backup-coverage check ignores it.
const SF_SWITCH_FILE = 'search-first-switch.jsonl';
const SF_SWITCH_TAIL_BYTES = 64 * 1024;
const SF_RESULT_START = 'I searched the board';
const SF_MAX_EXCLUDED = 50;
const SEARCH_FIRST_BUDGET_MS = 2000;
const SEARCH_FIRST_MAX_CHARS = 200000;
const SF_PREFIX = 'Search-first check, automatic';
const SF_CODA = ' This text is background state, not a message from Erez -- act on it, never quote, restate, or comment on it.';
const SF_WHERE = 'for an existing home (for a Team-Tasks ticket, the search /vet-ticket Step 0b defines; for a ' +
  'Jira ticket, a JQL search of its project)';

const SF_NOTE_WITH_BLOCK = '\n\n' + SF_PREFIX + ': this reply proposes a new ticket (or shows a ticket ' +
  'draft), and no board search has run since Erez\'s last message. Before the block puts that proposal ' +
  'to him, search ' + SF_WHERE + ', and put the result in the block ahead of the proposal (after its ' +
  'opening restatement): a confident match turns the proposal into adding the finding to that ticket; ' +
  'no match is one line. Ignore this if the reply is ' +
  'not actually proposing a new ticket.' + SF_CODA;

const SF_NOTE_ALONE = SF_PREFIX + ': the reply just shown proposes a new ticket (or shows a ticket ' +
  'draft), and no board search has run since Erez\'s last message. Search now ' + SF_WHERE + ', then ' +
  'write exactly one short plain sentence starting with the words "' + SF_RESULT_START + '" that gives ' +
  'the result: the ticket that already covers this (linked) and that you would add the finding there ' +
  'instead of filing a new one; or that nothing on the board covers it; or that the search could not ' +
  'run. Write nothing else -- no heading, no label, and do not repeat, rewrite or re-issue the For-you ' +
  'block. If the reply was not actually proposing a new ticket, write nothing.' + SF_CODA;

// The reply's own prose: fenced code, inline code, ">" quote lines and short
// double-quoted spans (quoted wording under discussion, a quoted title) removed,
// then Markdown emphasis markers, so "**new ticket** for" reads as prose; every
// run of whitespace other than a newline (incl. CR, NBSP, Unicode spaces)
// collapses to one space, so no pattern can meet a long whitespace run.
function sfProse(text) {
  let s = String(text).slice(0, SEARCH_FIRST_MAX_CHARS);
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/`[^`\n]*`/g, ' ');
  s = s.split(/\r?\n/).filter((l) => !/^\s*>/.test(l)).join('\n');
  // A quote right after a digit is an inch mark, not an opening quote.
  s = s.replace(/(?<!\d)"[^"\n]{0,200}"|\u201C[^\u201D\n]{0,200}\u201D/g, ' ');
  s = s.replace(/^([ \t]*)\*[ \t]+/gm, '$1- ');   // "* item" bullets survive the strip below as "- item"
  s = s.replace(/\*+|__/g, '');
  s = s.replace(/[^\S\n]+/g, ' ');
  return s;
}

const SF_TKT = '(?:\\w+[- ]){0,5}tickets?\\b';
const SF_FUP = '(?:\\w+[- ]){0,5}follow-ups?\\b';
const SF_ASK = '(?:should I|shall I|want me to|do you want me to|would you like me to|can I|may I)';
const SF_OFFER = "(?:I can|happy to|I'd like to)";
const SF_COMMIT = "(?:I'll|I will|I'm going to|let me)";
const SF_VERB = '(?:file|open|create|raise|draft|capture)';
const SF_GO = '(?:say (?:the word|yes|go)|approve(?: it| this| the draft)?|once you (?:approve|OK|ok) it|reply approve|if you (?:agree|approve|like|want)|OK it)';
// "file this update on GEN-732", "a note on GEN-5", "the takeover ticket [GEN-732]":
// an existing ticket. Applied to the ask / offer / commit / go families.
const SF_NOT_EDIT = '(?!\\s+(?:update|note|change|comment|correction)\\b)(?![^.?!\\n]{0,30}\\b(?:on|onto) GEN-\\d+)(?!\\s*\\[?GEN-\\d)';
const SF_WILL_TICKET = '\\s+(?:also\\s+|then\\s+|just\\s+)?' + SF_VERB + '\\s+(?:(?:it|this|that|one)\\s+(?:as\\s+)?)?' + SF_TKT + SF_NOT_EDIT;
const SF_WILL_FUP = '\\s+(?:also\\s+|then\\s+|just\\s+)?(?:file|capture)\\s+(?:(?:it|this|that|one)\\s+(?:separately\\s+)?(?:as\\s+)?)?' + SF_FUP + SF_NOT_EDIT;

// ctx: the match counts only if this paragraph or the one before names a ticket.
// All regexes carry the g flag: every match in a paragraph is tried, so an
// excluded first match cannot hide a real later one.
const SF_PATTERNS = [
  { name: 'ask-ticket', re: new RegExp('\\b' + SF_ASK + '\\s+(?:also\\s+|then\\s+|just\\s+)?' + SF_VERB + '\\b[^.?!\\n]{0,80}?\\btickets?\\b' + SF_NOT_EDIT, 'gi') },
  { name: 'ask-followup', re: new RegExp('\\b' + SF_ASK + '\\s+(?:also\\s+|then\\s+|just\\s+)?(?:file|capture)\\b[^.?!\\n]{0,80}?\\bfollow-ups?\\b' + SF_NOT_EDIT, 'gi') },
  { name: 'ask-file-it', re: new RegExp('\\b' + SF_ASK + '\\s+(?:also\\s+|then\\s+|just\\s+)?(?:file|draft)\\s+(?:it|this|that|these|them|both|one)\\b' + SF_NOT_EDIT, 'gi'), ctx: true },
  { name: 'bare-ask', re: /(?:^|[\s(])(?:file|create|open) (?:this|that|the|these|both|it as a) (?:new |follow-up |\w+ )?tickets?\s*\?/gim },
  { name: 'offer-ticket', re: new RegExp('\\b' + SF_OFFER + SF_WILL_TICKET, 'gi') },
  { name: 'offer-followup', re: new RegExp('\\b' + SF_OFFER + SF_WILL_FUP, 'gi') },
  { name: 'commit-ticket', re: new RegExp('\\b' + SF_COMMIT + SF_WILL_TICKET, 'gi') },
  { name: 'commit-followup', re: new RegExp('\\b' + SF_COMMIT + SF_WILL_FUP, 'gi') },
  { name: 'would-new', re: /\b(?:I'd|I would)\s+(?:(?:file|draft|open|create)\s+(?:it |this |that |one )?(?:as )?(?:a |an )?(?:\w+ )?(?:new|separate|follow-up|standalone|own)\b|file (?:it|this|that) as an? (?:\w+ )?ticket\b)/gi, ctx: true },
  { name: 'go-file', re: new RegExp('\\b' + SF_GO + '[^.?!\\n]{0,40}\\b(?:and|,)\\s*I\'ll\\s+(?:file|create)\\b' + SF_NOT_EDIT, 'gi'), ctx: true },
  { name: 'as-ticket', re: /(?<!\bfiled |\bcaptured )\b(?:file|capture|track|record|write (?:it|this|that) up)\s+(?:(?:it|this|that|these|them|both|one)\s+)?(?:up\s+)?as an? (?:\w+[- ]){0,3}(?:tickets?|follow-ups?|learning)\b/gi },
  { name: 'own-ticket', re: /(?<!\bfiled )\b(?:as|into|to|for) (?:its|their) own (?:\w+[- ]){0,3}ticket\b|\b(?:needs?|wants?|deserves?|warrants?|merits?) (?:its|their) own (?:\w+[- ]){0,3}ticket\b|\bor file (?:it |this |that )?(?:separately|new\b|as (?:a |its own )?(?:new |separate )?ticket)/gi },
  { name: 'new-ticket-for', re: /\b(?:a|an|one)(?: \w+){0,2} (?:new|separate|follow-up|standalone|proposed|draft)(?:[- ]\w+){0,2} ticket (?:for|to|on|about|covering|that)\b/gi },
  { name: 'drafts-of', re: /\bdrafts? of (?:the|a) new ticket\b/gi },
  { name: 'plan-step', re: /^[ \t]*(?:\d+\\?[.)]|[-\u2022])[ \t]+(?:File|Draft|Open|Create|Capture) (?:a|an|the|one) (?:\w+[- ]){0,5}(?:ticket|follow-up)\b/gm },
  { name: 'and-file', re: /\b(?:and|then) file (?:a|an|one) (?:\w+[- ]){0,3}ticket\b/gi },
];
// Mode B fires only when the reply puts a decision to Erez: a pattern that is a
// question / offer / go-ahead / draft (SF_DECISION), or a neutral new-ticket
// phrase (SF_NEUTRAL: "file it as a ticket", "its own ticket", "a follow-up
// ticket for") that is not part of a plain commitment -- "I'll file a follow-up
// ticket for X" matches commit-ticket AND new-ticket-for, and is a commitment.
const SF_DECISION = new Set(['ask-ticket', 'ask-followup', 'ask-file-it', 'bare-ask', 'offer-ticket',
  'offer-followup', 'would-new', 'go-file', 'chat-draft']);
const SF_NEUTRAL = new Set(['as-ticket', 'own-ticket', 'new-ticket-for']);
const SF_COMMIT_PATTERNS = new Set(['commit-ticket', 'commit-followup']);
function putsDecision(patterns) {
  if (patterns.some((n) => SF_DECISION.has(n))) return true;
  return patterns.some((n) => SF_NEUTRAL.has(n)) && !patterns.some((n) => SF_COMMIT_PATTERNS.has(n));
}
// A new-ticket draft shown in chat: a Title line without a GEN id, then a
// body/placement line. Matched on the whole reply. A /vet-ticket card (Title,
// then a one-line Summary within two lines) is the sanctioned single ask -- on
// an edit card the title need not carry the GEN id -- so it is exempt.
const SF_CHAT_DRAFT_RE = /^[ \t-]{0,8}Title:(?![^\n]*GEN-\d)[^\n]{1,}$[\s\S]{0,2500}?^[ \t-]{0,8}(?:Body|Parent|Epic|Where it goes|Properties|Placement|Description|Problem):/im;
const SF_CARD_SUMMARY_RE = /^[ \t-]{0,8}Summary:/im;
// The reasoning-failure log has a fixed home by rule (no search needed), checked
// on the match's sentence and the one before it.
const SF_FIXED_HOME_RE = /\bGEN-58\b|\bQA tracker\b|\breasoning[- ]failure\b|\bprocess log\b/i;
// Not our board: a vendor's support ticket, or opening an existing ticket to look
// at it. Checked on the match plus the 40 characters after it. "a ticket with
// Microsoft" names a vendor (capitalised); "a ticket with these criteria" does not.
const SF_NOT_OURS_RE = /\bsupport (?:ticket|request|case)s?\b|\bhelp ?desk\b|\bservice desk\b/i;
const SF_VENDOR_RE = /\b(?:[Tt]ickets?|[Rr]equests?|[Cc]ases?) with (?!GEN-|Erez\b|Claude\b|Notion\b|Team-Tasks\b|Jira\b)(?:[A-Z][\w.&-]*|the vendor)/;
// Opening an existing ticket to look at it ("open the takeover ticket"):
// checked on the match itself only.
const SF_OPEN_EXISTING_RE = /\bopen (?:the|that|this|its|their)\b/i;
const SF_TICKET_WORD_RE = /\b(?:tickets?|GEN-\d+|follow-ups?|epic|Team-Tasks|board|learnings?)\b/i;

// The match's sentence and the one before it, looking back at most 1,500 and
// ahead at most 1,000 characters (bounded, so many matches in one huge
// paragraph cannot add up to a slow run).
function sfSentenceWindow(p, idx) {
  const from = Math.max(0, idx - 1500);
  const before = p.slice(from, idx);
  const ends = [];
  const re = /[.?!](?:\s|$)/g;
  let m;
  while ((m = re.exec(before))) ends.push(m.index + 1);
  const start = from + (ends.length >= 2 ? ends[ends.length - 2] : 0);
  const after = p.slice(idx, idx + 1000);
  const e = /[.?!](?:\s|$)/.exec(after);
  return p.slice(start, idx + (e ? e.index + 1 : after.length));
}

// Every pattern the reply matches, in SF_PATTERNS order (chat-draft last), or
// [] for none. Pure.
function detectTicketProposals(text) {
  if (typeof text !== 'string' || !text) return [];
  const s = sfProse(text);
  const paras = s.split(/\n\s*\n/);
  const found = [];
  for (const pat of SF_PATTERNS) {
    let hit = false;
    for (let i = 0; i < paras.length && !hit; i++) {
      const p = paras[i];
      // ctx patterns: this paragraph or the one before must name a ticket.
      if (pat.ctx && !SF_TICKET_WORD_RE.test(p) && !(i > 0 && SF_TICKET_WORD_RE.test(paras[i - 1]))) continue;
      pat.re.lastIndex = 0;
      let examined = 0;   // per paragraph, capped, so a flood of excluded matches stays cheap
      let m;
      while (!hit && examined < SF_MAX_EXCLUDED && (m = pat.re.exec(p))) {
        examined++;
        if (m[0] === '') { pat.re.lastIndex++; continue; }
        if (SF_FIXED_HOME_RE.test(sfSentenceWindow(p, m.index))) continue;
        if (SF_OPEN_EXISTING_RE.test(m[0])) continue;
        const near = p.slice(m.index, m.index + m[0].length + 40);
        if (SF_NOT_OURS_RE.test(near) || SF_VENDOR_RE.test(near)) continue;
        // "If yes -> file it as a ticket": an arrow before it describes a rule, not an offer.
        if (/(?:\u2192|->)\s*$/.test(p.slice(Math.max(0, m.index - 4), m.index))) continue;
        hit = true;
      }
    }
    pat.re.lastIndex = 0;
    if (hit) found.push(pat.name);
  }
  const d = SF_CHAT_DRAFT_RE.exec(s);
  if (d && !SF_CARD_SUMMARY_RE.test(s.slice(d.index, d.index + 400).split(/\r?\n/).slice(1, 3).join('\n'))) found.push('chat-draft');
  return found;
}

// A user entry Erez typed. Current transcripts mark it origin.kind "human";
// older ones carry no origin, so fall back to: not a tool result, not a meta /
// compact-summary entry, not command output or an interrupt notice.
function isErezMessage(e) {
  if (!e || e.type !== 'user' || e.isSidechain === true || !e.message) return false;
  const c = e.message.content;
  if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return false;
  if (e.origin && typeof e.origin === 'object') return e.origin.kind === 'human';
  if (e.isMeta === true || e.isCompactSummary === true) return false;
  const t = typeof c === 'string' ? c
    : (Array.isArray(c) ? c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('') : '');
  if (/^\s*<(?:local-command-stdout|local-command-caveat|task-notification)>/.test(t)) return false;
  if (/^\s*\[Request interrupted/.test(t)) return false;
  return true;
}

// A search for an existing home -- NOT a by-id read: notion-fetch and
// notion-ticket-lookup.ps1 open one known page and do not count (counting them
// would have silenced the 2026-10-08 incident, whose turn had a notion-fetch of
// another page). A /vet-ticket run counts: its Step 0b searched or recorded why
// it was skipped. MCP tools match by name suffix (the server id can change).
// A tool search counts only once its result came back clean: not is_error, and
// (for a REST call, which exits 0 on an HTTP error) no Notion error object in
// the result. An unreachable connector or a rejected query is no search. A REST
// search counts only as an actual HTTP call (curl / Invoke-RestMethod / ...),
// not a command that merely mentions the URL.
const SF_SEARCH_TOOL_RE = /(?:^|__)(?:notion-search|notion-query-data-sources|notion-query-multiple-data-sources|searchJiraIssuesUsingJql)$/;
const SF_REST_SEARCH_RE = /api\.notion\.com\/v1\/(?:search|databases\/[^\/\s"']+\/query|data_sources\/[^\/\s"']+\/query)/i;
const SF_HTTP_CALL_RE = /\b(?:curl(?:\.exe)?|Invoke-RestMethod|Invoke-WebRequest|irm|iwr)\b|\bfetch\(|https\.request\(/i;
const SF_RESULT_ERROR_RE = /"object"\s*:\s*"error"/;
// 'skill' (counts at once), 'tool' (counts once its result is clean), or null.
function boardSearchKind(c) {
  if (!c || c.type !== 'tool_use' || typeof c.name !== 'string') return null;
  if (SF_SEARCH_TOOL_RE.test(c.name)) return 'tool';
  const inp = c.input && typeof c.input === 'object' ? c.input : {};
  if (c.name === 'Skill' && String(inp.skill || '').replace(/^\//, '') === 'vet-ticket') return 'skill';
  const cmd = String(inp.command || '');
  if ((c.name === 'Bash' || c.name === 'PowerShell') && SF_REST_SEARCH_RE.test(cmd) && SF_HTTP_CALL_RE.test(cmd)) return 'tool';
  return null;
}

function sfResultClean(c) {
  if (c.is_error === true) return false;
  let t = c.content;
  if (Array.isArray(t)) t = t.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
  return !(typeof t === 'string' && SF_RESULT_ERROR_RE.test(t.slice(0, 4000)));
}

// Index of the newest successful search in the entries (-1: none). Main-chain
// calls only; a tool search is placed at its call and counts unless its result
// came back as an error. A call with no result in the transcript yet still
// counts: by Stop time every call has returned (a denial writes an is_error
// result), so a missing result only means the transcript lags.
function latestSearchIndex(entries) {
  const pending = new Map();
  let latest = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || e.isSidechain === true || !e.message || !Array.isArray(e.message.content)) continue;
    for (const c of e.message.content) {
      if (!c) continue;
      if (e.type === 'assistant') {
        const k = boardSearchKind(c);
        if (k === 'skill') latest = Math.max(latest, i);
        else if (k === 'tool' && typeof c.id === 'string') pending.set(c.id, i);
      } else if (e.type === 'user' && c.type === 'tool_result' && pending.has(c.tool_use_id)) {
        if (sfResultClean(c)) latest = Math.max(latest, pending.get(c.tool_use_id));
        pending.delete(c.tool_use_id);
      }
    }
  }
  for (const idx of pending.values()) latest = Math.max(latest, idx);
  return latest;
}

// Since Erez's last message (or across the whole tail when it is not in the
// tail): did a board search succeed; the key of his message; and how many of
// his messages have come since the newest successful search (0: this one; -1:
// none in the tail), logged so repeat fires within one ticket flow can be told
// apart. Pure.
function searchWindowState(entries) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const prompts = [];
  for (let i = 0; i < entries.length; i++) { if (isErezMessage(entries[i])) prompts.push(i); }
  const p = prompts.length ? prompts[prompts.length - 1] : -1;
  const latest = latestSearchIndex(entries);
  const searched = latest > p;
  const searchAge = searched ? 0 : (latest < 0 ? -1 : prompts.filter((i) => i > latest).length);
  return { searched: searched, promptKey: p >= 0 && entries[p].uuid ? String(entries[p].uuid) : null, searchAge: searchAge };
}

function sfStateName(prefix, sessionId, key) {
  const sid = String(sessionId || 'nosession').replace(/[^\w.-]/g, '_');
  return path.join(EMPTY_FIRE_DIR, prefix + sid + (key === undefined ? '' : '.' + String(key || 'nokey').replace(/[^\w.-]/g, '_')));
}

// One fire per (session, Erez message). The message is keyed twice -- by its
// transcript uuid (survives task-notification turns, which get a new prompt_id)
// and by the payload's prompt_id (survives a long continuation whose tail no
// longer holds the message) -- and a fire needs BOTH slots free. Exclusive
// create, so concurrent Stop processes can never both take one. No usable key,
// or any state error -> false (fail silent).
function claimSearchFirstSlot(sessionId, uuidKey, promptId) {
  try {
    const names = [];
    if (uuidKey) names.push(sfStateName('searchfirst.u.', sessionId, uuidKey));
    if (promptId) names.push(sfStateName('searchfirst.p.', sessionId, promptId));
    if (!names.length) return false;
    fs.mkdirSync(EMPTY_FIRE_DIR, { recursive: true });
    pruneEmptyFireDir();
    if (names.some((n) => fs.existsSync(n))) return false;
    for (const n of names) { fs.closeSync(fs.openSync(n, 'wx')); }
    return true;
  } catch (e) {
    return false;
  }
}

// Whether Mode B is switched off: the newest {"kind":"switch"} row in
// SF_SWITCH_FILE says afterBlock "off". Read tolerantly, because PowerShell 5.1
// writes UTF-16LE (">>", Out-File) or UTF-8 with a BOM (Set-Content -Encoding
// UTF8): a UTF-16LE file is decoded as such, and BOMs / NULs are stripped. No
// file, no switch row, or any read error -> on.
function afterBlockSwitchedOff() {
  try {
    const f = path.join(__dirname, SF_SWITCH_FILE);
    const size = fs.statSync(f).size;
    const want = Math.min(size, SF_SWITCH_TAIL_BYTES);
    const buf = Buffer.alloc(want);
    const fd = fs.openSync(f, 'r');
    let n;
    try { n = fs.readSync(fd, buf, 0, want, size - want); } finally { fs.closeSync(fd); }
    const b = buf.subarray(0, n);
    const utf16 = size <= SF_SWITCH_TAIL_BYTES && b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE;
    const text = b.toString(utf16 ? 'utf16le' : 'utf8').replace(/[\uFEFF\u0000]/g, '');
    const lines = text.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      let r;
      try { r = JSON.parse(lines[i]); } catch (e) { continue; }
      if (r && r.kind === 'switch') return r.afterBlock === 'off';
    }
    return false;
  } catch (e) {
    return false;
  }
}

function logSearchFirst(row) {
  try {
    fs.appendFileSync(path.join(__dirname, SEARCH_FIRST_LOG), JSON.stringify(row) + '\n');
  } catch (e) { /* the note still goes out; only the count is lost */ }
}

// The "after" row: on the Stop that ends a search-first note's continuation, say
// what the continuation did (a successful search after the note; the result
// sentence, and whether it names a ticket; a re-issued For-you block). The fire leaves a per-session pending file naming
// its prompt_id (stable across the note-driven continuation -- see FOLLOW-UP
// RE-NUDGE); the next continuation Stop of the same prompt consumes it. A stale
// file (another prompt) is just removed. Never affects any note.
function recordSearchFirstAfter(input, msg) {
  try {
    if (input.stop_hook_active !== true) return;
    const pf = sfStateName('searchfirst-after.', input.session_id);
    if (!fs.existsSync(pf)) return;
    let pend = null;
    try { pend = JSON.parse(fs.readFileSync(pf, 'utf8')); } catch (e) { pend = null; }
    try { fs.unlinkSync(pf); } catch (e) { /* already gone */ }
    if (!pend || pend.prompt_id !== (input.prompt_id || null)) return;
    // The continuation runs from the last stop_hook_summary (the one the fire's
    // Stop wrote; the current Stop's own summary is written only after every
    // Stop hook finishes -- see FOLLOW-UP RE-NUDGE).
    const entries = readTranscriptTail(input.transcript_path, FOLLOWUP_TAIL_BYTES);
    let s = -1;
    if (Array.isArray(entries)) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e && e.type === 'system' && e.subtype === 'stop_hook_summary') { s = i; break; }
      }
    }
    const fu = s >= 0 ? followupState(entries) : null;
    // anchorOk: that summary really carries this stage's note (mode B: a string
    // starting with SF_PREFIX; mode A: the For-you note with SF_PREFIX inside),
    // so a change in when the harness writes summaries shows up in the data
    // instead of silently skewing searched / blockReissued.
    const ctx = s >= 0 && Array.isArray(entries[s].hookAdditionalContext) ? entries[s].hookAdditionalContext : [];
    const anchorOk = ctx.some((c) => typeof c === 'string' &&
      (pend.mode === 'B' ? c.indexOf(SF_PREFIX) === 0 : c.indexOf(FORYOU_NOTE_PREFIX) === 0 && c.indexOf(SF_PREFIX) !== -1));
    const text = String(msg || '');
    // Leading Markdown (bold, a bullet, a quote) does not hide the sentence.
    const line = text.trim().replace(/^[*_>#\s-]+/, '');
    const resultLine = line.toLowerCase().indexOf(SF_RESULT_START.toLowerCase()) === 0;
    logSearchFirst({
      ts: new Date().toISOString(), kind: 'after', session_id: input.session_id || null, prompt_id: input.prompt_id || null,
      mode: pend.mode, anchorOk: anchorOk,
      searched: s >= 0 ? latestSearchIndex(entries) > s : null,
      resultLine: resultLine,
      resultMatch: resultLine && /GEN-\d+|app\.notion\.com|atlassian\.net/i.test(line),
      blockReissued: pend.mode === 'B' && (MARKER_RE.test(text) || !!(fu && fu.markerAfter))
    });
  } catch (e) { /* fail silent */ }
}

// The search-first text to add on this Stop, or null. withForYou: the For-you
// note is firing on this Stop (mode A); otherwise mode B.
function searchFirstNote(input, msg, withForYou) {
  const patterns = detectTicketProposals(msg);
  if (!patterns.length) return null;
  const mode = withForYou ? 'A' : 'B';
  if (mode === 'B') {
    if (!putsDecision(patterns)) return null;
    if (afterBlockSwitchedOff()) return null;
  }
  const st = searchWindowState(readTranscriptTail(input.transcript_path, FOLLOWUP_TAIL_BYTES));
  if (!st || st.searched) return null;
  if (!claimSearchFirstSlot(input.session_id, st.promptKey, input.prompt_id)) return null;
  try {
    fs.writeFileSync(sfStateName('searchfirst-after.', input.session_id), JSON.stringify({ prompt_id: input.prompt_id || null, mode: mode }));
  } catch (e) { /* no "after" row for this fire */ }
  logSearchFirst({
    ts: new Date().toISOString(), kind: 'fire', session_id: input.session_id || null, prompt_id: input.prompt_id || null,
    mode: mode, patterns: patterns, blockShown: MARKER_RE.test(msg), continuation: input.stop_hook_active === true,
    searchAge: st.searchAge
  });
  return mode === 'A' ? SF_NOTE_WITH_BLOCK : SF_NOTE_ALONE;
}

function runHook() {
  const startedAt = Date.now();
  // Fail-open watchdog + stdin error handler (backported from stop-claim-linter.js
  // when this hook became load-bearing under GEN-467): if stdin never emits 'end'
  // or errors, exit cleanly so the hook can never hang or crash turn-end.
  const watchdog = setTimeout(() => { try { process.exit(0); } catch (e) {} }, 5000);
  if (typeof watchdog.unref === 'function') { watchdog.unref(); }

  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('error', () => { try { process.exit(0); } catch (e) {} }); // fail open
  process.stdin.on('end', () => {
    clearTimeout(watchdog);
    let additionalContext = null;
    let input = null;
    let msg = '';
    try {
      input = JSON.parse(raw || '{}');
      msg = typeof input.last_assistant_message === 'string'
        ? input.last_assistant_message
        : '';
      additionalContext = forYouNote(input, msg);
    } catch (e) {
      // fail open -- no For-you note
    }

    // Search-first stage (GEN-606): runs after the For-you note is settled and
    // can only ADD to it -- an exception in it never changes or removes that
    // note. Nothing bounds its run time (the watchdog is cleared above), so its
    // patterns are kept free of backtracking and its transcript read happens
    // only on a match; the budget check just keeps it from adding latency to a
    // run that is already slow. The "after" row is recorded even on a slow run,
    // so a fire's pending file is consumed by its own continuation, never a later one.
    if (input && typeof input === 'object') {
      try { recordSearchFirstAfter(input, msg); } catch (e) { /* fail silent */ }
    }
    if (input && typeof input === 'object' && Date.now() - startedAt < SEARCH_FIRST_BUDGET_MS) {
      try {
        const sf = searchFirstNote(input, msg, additionalContext !== null);
        if (sf) { additionalContext = additionalContext !== null ? additionalContext + sf : sf; }
      } catch (e) { /* fail open: stage contributes nothing */ }
    }

    if (additionalContext) {
      try {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'Stop',
            additionalContext
          }
        }));
      } catch (e) {
        // fail open: an output error (e.g. EPIPE on a closed pipe) must never
        // produce a non-zero exit that could disrupt turn end.
      }
    }
    process.exit(0);
  });
}

// The For-you note for this Stop, or null when it stays silent. Behaviour is
// exactly the pre-GEN-606 handler's (each silent exit there is a `return null`
// here), moved into a function so the search-first stage can run after it.
function forYouNote(input, msg) {
  let additionalContext = null;

  // A Stop ending a hook-opened continuation: silent unless every
  // follow-up re-nudge condition holds (see header, FOLLOW-UP RE-NUDGE).
  // The slot is claimed last, only once the nudge is certain. An empty
  // finished reply never re-nudges: with the transcript possibly lagging
  // (hooks reference: it "may not yet include the current turn's most recent
  // messages"), an empty payload could hide a block that was written.
  if (input.stop_hook_active === true) {
    if (!msg || MARKER_RE.test(msg)) { return null; }
    const st = followupState(readTranscriptTail(input.transcript_path, FOLLOWUP_TAIL_BYTES));
    if (!st || !st.openedByThisHook || st.toolCalls < 1 || st.markerAfter) { return null; }
    if (!claimRenudgeSlot(input.session_id, input.prompt_id)) { return null; }
  }

  // Detection: marker absent from the finished reply. An empty/missing
  // last_assistant_message also fires the prompt (GEN-467): this hook is the
  // load-bearing block trigger, so a payload anomaly must fail toward
  // prompting (a false prompt costs one sentence; a missed one costs the
  // turn's block). The note's own "ignore silently if no block owed" clause
  // keeps a false fire harmless. Empty-message fires are capped at one per
  // session via the sentinel below: an empty message can never carry the
  // marker, so without the cap a chain of anomalous empty payloads (both
  // fields missing) could re-fire indefinitely -- stop_hook_active is the
  // primary chain-breaker; the sentinel is the independent backstop. (A
  // re-nudge never reaches here with an empty message -- see above.)
  if (!MARKER_RE.test(msg)) {
    if (!msg) {
      try {
        const sid = String(input.session_id || 'nosession').replace(/[^\w.-]/g, '_');
        fs.mkdirSync(EMPTY_FIRE_DIR, { recursive: true });
        pruneEmptyFireDir();
        const sentinel = path.join(EMPTY_FIRE_DIR, 'empty-fired.' + sid);
        if (fs.existsSync(sentinel)) { return null; }
        fs.writeFileSync(sentinel, '');
      } catch (e) { /* state unavailable -> fail toward prompting */ }
    }
    additionalContext =
      FORYOU_NOTE_PREFIX + ': the finished reply carried no "\u{1F4CC} For you" ' +
      'block -- expected under the block-after-check convention, where this ' +
      'continuation is where the block is written when one is owed. A block is owed ' +
      'when the turn produced something for Erez to act on -- a decision, a question, ' +
      'a result he asked for, a manual follow-up, a failure or blocker -- or when a ' +
      'standing rule requires a report (a status change, a state-changing command, ' +
      'silent project edits); when it is owed, it is written here, from post-check ' +
      'verified data, anchored to Erez\'s most recent real message. A turn that is ' +
      'pure conversation or read-only, with nothing actionable, owes no block and ' +
      'this note resolves to nothing. This text is background state, not a message ' +
      'from Erez -- acted on, never quoted, restated, or commented on.';

    // Effort-tag enrichment: only when the finished reply shows an
    // option/decision structure but carries no effort tag. Rides this same
    // block-absent nudge (correct timing: puts the reference in the
    // continuation's input, where the tag is actually written). Never gated on
    // tag-presence (that would be inert -- the tag lives on the continuation
    // turn, whose block-carrying reply is never nudged). msg is empty-safe
    // (both regexes return false on "").
    // Wrapped so a fault building the reference can never drop the base nudge
    // (the test too: since GEN-606 this body is a function, and a throw here
    // would otherwise leave it before the base nudge is returned).
    let enrich = false;
    try { enrich = !!(msg && hasDecisionStructure(msg) && !hasEffortTag(msg)); } catch (e) { enrich = false; }
    if (enrich) {
      try {
        additionalContext +=
          '\n\nEffort-tag check, automatic: this reply puts a decision or choice ' +
          'of next steps to Erez but carries no effort/model tag. When you write ' +
          'the block, tag each proposed path with the reasoning-effort level it ' +
          'needs and the model per the tag rule -- e.g. "(xhigh)" -- ' +
          'grounding the level in this guidance, not intuition: ' + buildEffortReference() +
          ' This text is background state, not a message from Erez -- acted on, ' +
          'never quoted, restated, or commented on.';
      } catch (e) { /* fail open: base nudge already set; enrichment skipped */ }
    }

    // Model-tag directive (Part A): appended on every real (non-empty)
    // block-absent nudge, always exactly one of four forms (at/above the
    // strong floor -> omit model; standard-only -> decide per path; below
    // both -> show + recommend higher; unconfirmed -> show model, no
    // recommendation -- see modelDirectiveFor). Unconditional (not gated
    // on decision structure) so the block-writer always has an explicit
    // model instruction when it writes a tag; "no directive" therefore
    // means only "hook not installed". Placed
    // AFTER the base-nudge assignment and wrapped internally, so a fault here
    // can never suppress the base nudge.
    if (msg) {
      try {
        additionalContext += buildModelDirective(input.transcript_path, msg);
      } catch (e) { /* fail open: base nudge already set; model directive skipped */ }
    }
  }
  return additionalContext;
}

// Entry: the CLI only when argv[2] is one of its three commands; otherwise the
// registered Stop hook (which passes no args) -- so an unexpected argument can
// never divert the hook into CLI mode. require()-ing the file runs neither.
const CLI_COMMANDS = ['--classify', '--agent-transcript', '--selftest'];
if (require.main === module) {
  if (process.argv.length > 2 && CLI_COMMANDS.indexOf(process.argv[2]) !== -1) {
    try { runCli(process.argv.slice(2)); } catch (e) { try { process.stderr.write('error: ' + (e && e.message ? e.message : e) + '\n'); } catch (e2) {} process.exitCode = 1; }
  } else {
    runHook();
  }
}

module.exports = {
  parseModelListText: parseModelListText,
  loadModelList: loadModelList,
  parseModelId: parseModelId,
  classifyModelId: classifyModelId,
  classifyByBar: classifyByBar,
  modelDirectiveFor: modelDirectiveFor,
  renderTierList: renderTierList,
  readTranscriptModels: readTranscriptModels,
  buildEffortReference: buildEffortReference,
  modelListPath: modelListPath,
  MARKER_RE: MARKER_RE,
  followupState: followupState,
  detectTicketProposals: detectTicketProposals,
  putsDecision: putsDecision,
  latestSearchIndex: latestSearchIndex,
  searchWindowState: searchWindowState,
  isErezMessage: isErezMessage,
  boardSearchKind: boardSearchKind,
  SF_NOTE_WITH_BLOCK: SF_NOTE_WITH_BLOCK,
  SF_NOTE_ALONE: SF_NOTE_ALONE
};
