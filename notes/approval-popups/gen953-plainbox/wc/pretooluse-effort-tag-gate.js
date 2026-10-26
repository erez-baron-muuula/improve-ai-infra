#!/usr/bin/env node
'use strict';

/*
 * pretooluse-effort-tag-gate.js -- Claude Code PreToolUse hook (GEN-619), and
 * the PostToolUse after-box note on the same box tool (GEN-941, see below).
 *
 * Job: every decision put to Erez carries the reasoning-effort level its work
 * needs. Since 2026-10-15 the desktop app's next-step box (mcp__ccd_turn__wrap_up:
 * a question + answer buttons) is where most decisions reach him, and nothing
 * covered it -- 0 of 27 box questions on 2026-10-18 carried a level. Plan
 * approvals (ExitPlanMode) carried one in about 14 of 120. This hook checks
 * both at the moment they are about to be shown:
 *   - Box with a question (`ask`): every reply button that starts work needs an
 *     effort tag in its label, e.g. "Yes (xhigh)". Whole-label declines ("Not
 *     now", "No, leave it") and app-action buttons (commit/PR/merge -- their
 *     labels are the app's) are exempt.
 *   - Plan approval: the plan text needs a line like "Effort to execute: xhigh".
 *   - Plan approval (GEN-953): the plan opens with a plain-words section for
 *     Erez -- its first section heading after the title names it ("In plain
 *     words (for Erez)", "In plain terms", "How it works for Erez"). Only the
 *     heading (or a whole-line bold label like "**In plain words**") is
 *     checked; the five things it must say are in the refusal.
 *     A plan missing both gets ONE refusal naming both fixes.
 * A miss is blocked ONCE with the effort guide in the reason, so the level is
 * picked from notes/effort-model-reference.md while the box/plan is written.
 * Design: scratchpad gen619-design.md, /check-converged 2026-10-18.
 *
 * Blocking verb: exit code 2 + reason on stderr -- NOT JSON permissionDecision
 * "deny". The box tool is on the settings.json allow list, and an allow entry
 * can let a soft deny through (see auto-approve.js "GEN-103" header); exit 2
 * stops the call before permission rules are evaluated. Never outputs "allow".
 *
 * Loop safety: at most one block per (session, tool) per BLOCK_WINDOW_MS. The
 * state file is written BEFORE blocking; if it cannot be written, the hook
 * defers (a broken temp dir can never produce a block loop). A retry inside
 * the window passes even if still untagged (logged "passed-after-deny"). A
 * tagged pass clears the state so a later, separate box is gated again.
 *
 * The box's `ask` is <=100 chars with "no reason or recommendation", so a
 * "recommend a stronger model" note has no home in it: the model note belongs
 * in the For-you block, and the AFTER-BOX NOTE below brings the Stop hook's
 * model directive (modelDirectiveFor) to the message that writes it.
 *
 * SUMMARY CHECK -- REMOVED 2026-10-25 (GEN-941). From 2026-10-18 (GEN-619) a
 * box question was also refused when no "<pin U+1F4CC> For you" block had been
 * written earlier in the turn, because on Claude Code 2.1.299 nothing after a
 * box question reached the model (transcript b46dcb2a lines 985-995). On
 * 2.1.304 (2026-10-21) that no longer holds: end-of-turn notes arrived 8-16 s
 * after each of 4 box questions (transcript 9a30a127), and the app's box tool
 * now tells Claude to write its full answer after the box. Writing the block
 * before the box as well made Claude say everything twice, and text written
 * right before a tool call is sometimes condensed and never shown (GEN-873).
 * The global CLAUDE.md block rule now puts the block in the closing message
 * after a question box, so that refusal is gone. The button and plan checks
 * are unchanged.
 *
 * AFTER-BOX NOTE (GEN-941): the same file is also registered as a PostToolUse
 * hook on the box and dispatches on hook_event_name. After a box is shown it
 * adds one background note for the closing message, by whether this turn's
 * main-chain assistant text already holds a block HEADER (the pin at the start
 * of a line, not a mention in prose; the turn starts at the last user entry
 * carrying an origin, or an Erez message in older transcripts):
 *   - question box, no block yet: write the block now as the closing message,
 *     once, with the effort guide and the model directive;
 *   - question box, block header already in the turn: close with one line if
 *     that was this turn's current block, else write it now (guide + directive);
 *   - recap-only box, no block yet: the effort guide and the model directive
 *     for any block this turn (where it goes stays the rule's call);
 *   - recap-only box, block already written: no note.
 * With no turn start in the transcript tail, a header anywhere in the tail
 * counts as written; with neither (or no transcript) the status is "unknown",
 * handled as "no block yet" -- the question-box note then says to close with
 * one line if a block already went out. It never blocks: exit 0, output only
 * on stdout, any error -> no note.
 * Delivery verified 2026-10-25 on 2.1.304 (GEN-941 step 0): a PostToolUse
 * note on this tool reached the model after a question box and before its
 * closing message (transcript ede96a74, line 822). Whether Claude then follows
 * it is measured by the GEN-941 week check (notes/foryou-repeat/boxscan.js in
 * the Improve AI Infra repo reads the after-box rows of this hook's log).
 *
 * Fails open: any error -> exit 0, no output. Sub-agent calls (payload carries
 * agent_id; they share the parent session_id) are skipped.
 *
 * Signal: every outcome is appended to effort-tag-gate.jsonl next to this file;
 * the GEN-619 one-week check reads it (see that ticket).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const BOX_TOOL = 'mcp__ccd_turn__wrap_up';
const PLAN_TOOL = 'ExitPlanMode';
const LOG_FILE = path.join(__dirname, 'effort-tag-gate.jsonl');
const STATE_DIR = path.join(os.tmpdir(), 'claude-effort-gate-state');
// Long enough for a plan edited over several tool calls to come back.
const BLOCK_WINDOW_MS = 300 * 1000;
const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const PLAN_MAX_BYTES = 1024 * 1024;

// Copied VERBATIM from stop-foryou-nudge.js EFFORT_ONLY_TAG_RE (its strict
// "tag" form: a parenthetical that STARTS with an effort word, optionally
// ", <model>"; "(high stakes)" / "(max 3)" do not count). The exported one is
// preferred when present; keep this copy identical (a fixture asserts it).
const EFFORT_ONLY_TAG_RE_COPY = new RegExp(
  '\\(\\s*(?:low|medium|high|xhigh|max)\\b(?:\\s*,\\s*(?:Opus|Sonnet|Haiku|Fable)[^)]*)?\\s*\\)',
  'i'
);

// A reply button is exempt only when its WHOLE label is a decline, so
// "Keep going", "Keep and fix", "No-op cleanup", "No, use B" still need a tag.
const DECLINE_RE = /^(?:not now|not yet|later|no|nope|no thanks|skip|cancel|wait|hold off|stop|keep|leave)(?:[ ,]+(?:it|them|this|that|as is|for now|for later|here|the \w+|not needed|leave it|keep it))*\.?$/i;

// A button that starts no work but isn't a plain decline ("Keep To Do", "I'll
// do it myself") may be marked "(none)" instead of a level.
const NO_WORK_TAG_RE = /\(\s*none\s*\)/i;

// Plans state the level in many real forms (corpus 2026-09-20..10-18): a label
// line -- "Effort to execute: xhigh", "**Effort level:** **xhigh**", "Execution
// effort: medium", "Step 3 ... -- effort: xhigh", "Effort to run this plan:
// build and test (high, Opus 5.5)" -- or a heading ("## Effort", "## Execution
// effort", "## Effort / model") whose next non-empty lines carry the level.
// "effort" must be a whole word not followed by "-" or a letter, so
// "effort-model-reference.md" never counts. Deliberately lenient: a false
// pass costs one untagged plan; a false block costs a redo on every plan.
const LEVEL_WORD_RE = /\b(?:low|medium|high|xhigh|max)\b/i;
const PLAN_EFFORT_LINE_RE = /\beffort(?![-\w])[^\n]{0,80}?\b(?:low|medium|high|xhigh|max)\b/i;
const PLAN_EFFORT_HEADING_RE = /^\s*#{1,6}\s[^\n]*\beffort(?![-\w])/i;

// GEN-953: the heading of a plan's plain-words section. Real forms: "In plain
// words (for Erez)", "In plain terms", "Context (plain language)", "How it
// works for Erez". "for Erez's OK" / "for Erez to confirm" are not it.
const PLAIN_HEADING_RE = /\bplain(?:ly)?\b|\bfor Erez\b(?!['\u2019]s\b|\s+to\b)/i;
const MD_HEADING_RE = /^ {0,3}(#{1,6})[ \t]+([\s\S]+)$/;
// A whole-line bold pseudo-heading counts only when it is itself plain, so
// "**Tickets**" or "**Effort to execute: xhigh**" above the section is ignored.
const BOLD_LINE_RE = /^\s*\*\*(.+?)\*\*:?\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})([\s\S]*)$/;
const PLAIN_LINE_MAX = 300;
const PLAIN_ASK = 'Put a first section right under the title, headed "## In plain words (for Erez)" (or ' +
  'move your existing plain-words section there), that ' +
  'tells Erez in plain, non-technical words: what changes for him, who is affected, whether it can be ' +
  'undone, what he must do, and your recommendation. Technical detail goes below it.';

// A For-you block HEADER: the pin at the start of a line (after optional
// whitespace, a quote marker, a heading mark, emphasis or a rule -- real blocks
// use "<pin> **For you**" and "## <pin> For you", pin = U+1F4CC), optional
// U+FE0F, optional bold, then "For you". A mention in prose ('the "<pin> For
// you" block') does not
// count. Bounded runs only (no backtracking blow-up -- see GEN-684).
const BLOCK_HEADER_RE = /(?:^|\n)[ \t>*_#-]{0,12}\u{1F4CC}\uFE0F?[ \t]{0,8}\*{0,2}[ \t]{0,8}For you/u;
// Same window as stop-foryou-nudge.js FOLLOWUP_TAIL_BYTES: one long turn alone
// has measured 296 KB, and a turn whose start is outside the tail is skipped.
const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;

const FALLBACK_GUIDE =
  'Effort by kind of work: coding / agentic / tool-heavy -> xhigh; design, ' +
  'architecture, trade-offs -> high (minimum); simple / mechanical (lookups, ' +
  'formatting, straightforward edits) -> low; correctness-critical -> max; ' +
  'medium = well-specified work more than trivial. Source: notes/effort-model-reference.md ' +
  'in the Improve AI Infra repo.';

function log(entry) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(Object.assign({ ts: new Date().toISOString() }, entry)) + '\n');
  } catch (e) { /* logging never breaks a tool call */ }
}

// Shared pieces from the Stop hook, loaded defensively: a broken edit there
// must not silently switch this gate off -- it falls back and logs it. The
// tag regex is rebuilt from .source with flag "i" only, so a /g or /y flag
// added there later can't make .test() stateful here. The effort guide (which
// reads the reference file) is built lazily -- only on the block path.
function loadShared(base) {
  let H = null;
  try {
    H = require('./stop-foryou-nudge.js');
  } catch (e) {
    log(Object.assign({ outcome: 'require-failed' }, base));
  }
  let tagRe = EFFORT_ONLY_TAG_RE_COPY;
  try {
    if (H && H.EFFORT_ONLY_TAG_RE instanceof RegExp) tagRe = new RegExp(H.EFFORT_ONLY_TAG_RE.source, 'i');
  } catch (e) { tagRe = EFFORT_ONLY_TAG_RE_COPY; }
  const guide = () => {
    try { return (H && H.buildEffortReference()) || FALLBACK_GUIDE; } catch (e) { return FALLBACK_GUIDE; }
  };
  // Older origin-less transcripts: the Stop hook's isErezMessage when loaded.
  const isErez = (H && typeof H.isErezMessage === 'function') ? H.isErezMessage : () => false;
  // The block's model note: on a box turn whose block is in the closing message
  // the Stop hook stays silent, so the after-box note carries its directive.
  // '' on any error.
  const directive = (model) => {
    try { return H ? H.modelDirectiveFor(model, H.loadModelList(H.modelListPath())) : ''; } catch (e) { return ''; }
  };
  return { guide: guide, tagRe: tagRe, isErez: isErez, directive: directive };
}

// The model of the last main-chain assistant entry in the tail, or null.
function lastModel(entries) {
  if (!Array.isArray(entries)) return null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e && e.type === 'assistant' && e.isSidechain !== true && e.message && typeof e.message.model === 'string' && e.message.model !== '<synthetic>') return e.message.model;
  }
  return null;
}

// The transcript tail as parsed entries (first, possibly partial line
// dropped; malformed lines skipped), or null on any error.
function readTail(transcriptPath) {
  try {
    if (!transcriptPath || typeof transcriptPath !== 'string') return null;
    const size = fs.statSync(transcriptPath).size;
    let raw;
    if (size > TRANSCRIPT_TAIL_BYTES) {
      const fd = fs.openSync(transcriptPath, 'r');
      try {
        const buf = Buffer.alloc(TRANSCRIPT_TAIL_BYTES);
        const n = fs.readSync(fd, buf, 0, TRANSCRIPT_TAIL_BYTES, size - TRANSCRIPT_TAIL_BYTES);
        raw = buf.toString('utf8', 0, n);
      } finally { fs.closeSync(fd); }
      const nl = raw.indexOf('\n');
      raw = nl >= 0 ? raw.slice(nl + 1) : '';
    } else {
      raw = fs.readFileSync(transcriptPath, 'utf8');
    }
    const out = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch (e) { /* skip */ }
    }
    return out;
  } catch (e) {
    return null;
  }
}

// A turn starts on a non-tool-result user entry carrying an origin (Erez's
// message, a task notification, another agent's message -- all carry one and
// a promptId; none appear mid-turn in the measured transcripts), or, in older
// origin-less transcripts, on an Erez message.
function isTurnStart(e, isErez) {
  if (!e || e.type !== 'user' || e.isSidechain === true || !e.message) return false;
  const c = e.message.content;
  if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return false;
  if (e.origin && typeof e.origin === 'object') return true;
  try { return !!isErez(e); } catch (x) { return false; }
}

// 'present' | 'missing' | 'unknown'. With no turn start in the tail, the whole
// tail belongs to the current turn: a header there is 'present'; without one
// the turn's earlier part is unseen, so 'unknown' (never a refusal).
function turnBlockStatus(entries, isErez) {
  if (!Array.isArray(entries)) return 'unknown';
  let start = -1;
  for (let i = entries.length - 1; i >= 0; i--) { if (isTurnStart(entries[i], isErez)) { start = i; break; } }
  for (let i = start + 1; i < entries.length; i++) {
    const e = entries[i];
    if (!e || e.type !== 'assistant' || e.isSidechain === true || !e.message || !Array.isArray(e.message.content)) continue;
    for (const c of e.message.content) {
      if (c && c.type === 'text' && typeof c.text === 'string' && BLOCK_HEADER_RE.test(c.text)) return 'present';
    }
  }
  return start === -1 ? 'unknown' : 'missing';
}

// --- Pure decision functions (exported for fixtures / corpus replay) --------

// Box: returns { applies, untagged: [labels] }. applies=false -> no question.
function boxUntagged(toolInput, tagRe) {
  const ti = toolInput || {};
  if (typeof ti.ask !== 'string' || !ti.ask.trim()) return { applies: false, untagged: [], workButtons: 0 };
  const actions = Array.isArray(ti.actions) ? ti.actions : [];
  const untagged = [];
  let workButtons = 0;
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    if (a.action) continue; // app action: label is the app's
    const label = typeof a.label === 'string' ? a.label.trim() : '';
    if (!label) continue;
    if (DECLINE_RE.test(label)) continue;
    workButtons++;
    if (!tagRe.test(label) && !NO_WORK_TAG_RE.test(label)) untagged.push(label);
  }
  return { applies: true, untagged: untagged, workButtons: workButtons };
}

function planHasEffort(planText) {
  const lines = String(planText).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (PLAN_EFFORT_LINE_RE.test(lines[i])) return true;
    if (PLAN_EFFORT_HEADING_RE.test(lines[i])) {
      // The heading's next three non-empty lines, stopping at the next heading.
      let seen = 0;
      for (let j = i + 1; j < lines.length && seen < 3; j++) {
        if (!lines[j].trim()) continue;
        if (/^\s*#{1,6}\s/.test(lines[j])) break;
        seen++;
        if (LEVEL_WORD_RE.test(lines[j])) return true;
      }
    }
  }
  return false;
}

// true = the first section of the plan (after a "# " title) is a plain-words
// section. Lines inside code fences are ignored. No section at all -> false.
function planOpensPlain(planText) {
  // Split on \n only (a stray \r is harmless below); /\r*\n/ is quadratic on a long \r run.
  const lines = String(planText).split('\n');
  let fence = null;
  let titleSeen = false;
  for (let i = 0; i < lines.length; i++) {
    // A fence per CommonMark: a backtick fence's info string has no backtick
    // (so "```x```" is inline code), and a closing fence has no info string.
    const f = FENCE_RE.exec(lines[i]);
    if (f && !(f[1][0] === '`' && f[2].indexOf('`') !== -1)) {
      if (fence === null) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = MD_HEADING_RE.exec(lines[i]);
    if (h) {
      const plain = PLAIN_HEADING_RE.test(h[2]);
      if (h[1].length === 1 && !titleSeen && !plain) { titleSeen = true; continue; }
      return plain;
    }
    // A label is short; the cap bounds the lazy match on a long line.
    const b = lines[i].length <= PLAIN_LINE_MAX ? BOLD_LINE_RE.exec(lines[i]) : null;
    if (b && PLAIN_HEADING_RE.test(b[1])) return true;
  }
  return false;
}

function readPlanText(toolInput) {
  const ti = toolInput || {};
  if (typeof ti.plan === 'string' && ti.plan) return ti.plan;
  const p = ti.planFilePath;
  if (typeof p !== 'string' || !p) return null;
  const plansDir = path.resolve(os.homedir(), '.claude', 'plans');
  const resolved = path.resolve(p);
  if (resolved.toLowerCase().indexOf(plansDir.toLowerCase() + path.sep) !== 0) return null;
  const st = fs.statSync(resolved);
  if (!st.isFile() || st.size > PLAN_MAX_BYTES) return null;
  return fs.readFileSync(resolved, 'utf8');
}

// --- Block-once state -------------------------------------------------------

// Keyed per turn too (prompt_id) when the payload has one, so a refusal that is
// never retried can't wave through the NEXT turn's box inside the window.
function stateFile(sessionId, tool, promptId) {
  const sid = String(sessionId || 'nosession').replace(/[^\w.-]/g, '_');
  const pid = promptId ? '.' + String(promptId).replace(/[^\w.-]/g, '_') : '';
  return path.join(STATE_DIR, 'denied.' + sid + '.' + tool.replace(/[^\w.-]/g, '_') + pid);
}

function prune() {
  try {
    const now = Date.now();
    for (const n of fs.readdirSync(STATE_DIR)) {
      const p = path.join(STATE_DIR, n);
      try { if (now - fs.statSync(p).mtimeMs > STATE_TTL_MS) fs.unlinkSync(p); } catch (e) { /* skip */ }
    }
  } catch (e) { /* nothing to prune */ }
}

// true = inside the window of a recent block (let the retry through).
function recentlyBlocked(file) {
  try { return Date.now() - fs.statSync(file).mtimeMs < BLOCK_WINDOW_MS; } catch (e) { return false; }
}

// true = state recorded, so blocking is safe.
function recordBlock(file) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    prune();
    fs.writeFileSync(file, String(Date.now()));
    return true;
  } catch (e) {
    return false;
  }
}

function clearBlock(file) {
  try { fs.unlinkSync(file); } catch (e) { /* absent */ }
}

function block(reason) {
  try { process.stderr.write(reason); } catch (e) { /* ignore */ }
  process.exitCode = 2;
}

function boxReason(untagged, guide) {
  return 'Box check (GEN-619): this question to Erez is not ready to show. ' +
    'These answer buttons start work but show no effort level: ' +
    untagged.map((l) => '"' + l + '"').join(', ') + '. Add to each the reasoning-effort level that option\'s ' +
    'work needs, short form like "Yes (xhigh)" (label still <= 24 chars). Plain declines ("Not now") need ' +
    'nothing; a button that starts no work otherwise can be marked "(none)". A model note, if one is owed, ' +
    'goes in the For-you block, not the box. Pick the level from this guide, not intuition: ' + guide;
}

function planReason(missing, guide) {
  const noPlain = missing.indexOf('plain') !== -1;
  const noEffort = missing.indexOf('effort') !== -1;
  const what = noPlain && noEffort ? 'does not open in plain words and has no effort level for carrying it out'
    : noPlain ? 'does not open in plain words' : 'has no effort level for carrying it out';
  const fixes = [];
  if (noPlain) fixes.push(PLAIN_ASK);
  if (noEffort) fixes.push('Add a line "Effort to execute: <level>" to the plan file (model per the global tag rule).');
  return 'Plan check (GEN-619/GEN-953): this plan goes to Erez for approval but ' + what + '. ' +
    fixes.join(' ') + ' Then call ExitPlanMode again.' +
    (noEffort ? ' Pick the level from this guide, not intuition: ' + guide : '');
}

function decide(input) {
  const tool = input && input.tool_name;
  if (tool !== BOX_TOOL && tool !== PLAN_TOOL) return;
  const base = { session: input.session_id || null, tool: tool };
  if (input.agent_id) { log(Object.assign({ outcome: 'subagent' }, base)); return; }
  const shared = loadShared(base);
  const file = stateFile(input.session_id, tool, input.prompt_id);

  let missing;
  let reason;
  let untagged = [];
  const planMissing = [];
  if (tool === BOX_TOOL) {
    const r = boxUntagged(input.tool_input, shared.tagRe);
    if (!r.applies) { log(Object.assign({ outcome: 'no-ask' }, base)); return; }
    untagged = r.untagged;
    missing = untagged.length > 0;
    if (!missing && r.workButtons === 0) { clearBlock(file); log(Object.assign({ outcome: 'exempt-only' }, base)); return; }
    reason = () => boxReason(untagged, shared.guide());
  } else {
    let text = null;
    try { text = readPlanText(input.tool_input); } catch (e) { text = null; }
    if (text === null) { log(Object.assign({ outcome: 'plan-unavailable' }, base)); return; }
    if (!planHasEffort(text)) planMissing.push('effort');
    if (!planOpensPlain(text)) planMissing.push('plain');
    missing = planMissing.length > 0;
    reason = () => planReason(planMissing, planMissing.indexOf('effort') !== -1 ? shared.guide() : '');
  }

  const short = untagged.map((l) => l.slice(0, 40));
  const why = tool === PLAN_TOOL ? { missing: planMissing } : {};
  if (!missing) {
    clearBlock(file);
    log(Object.assign({ outcome: 'tagged' }, base));
    return;
  }
  if (recentlyBlocked(file)) {
    // Let the retry through, and clear the state so a LATER separate box is
    // gated again (the call is shown now and the turn moves on -- no loop).
    clearBlock(file);
    log(Object.assign({ outcome: 'passed-after-deny', untagged: short }, why, base));
    return;
  }
  // Build the reason BEFORE recording state, so a failure building it can never
  // leave a recorded block with nothing shown.
  const text = reason();
  if (!recordBlock(file)) {
    log(Object.assign({ outcome: 'error', detail: 'state-write-failed', untagged: short }, base));
    return;
  }
  log(Object.assign({ outcome: 'blocked', untagged: short }, why, base));
  block(text);
}

// --- After-box note (PostToolUse) -------------------------------------------

const PIN = String.fromCodePoint(0x1F4CC);
const AFTER_CODA = ' This text is background state, not a message from Erez -- act on it, never quote, restate, or comment on it.';

// The note for a shown box, or null for none. Pure, so fixtures drive every
// branch. directive '' (an error building it) -> the note still ends with the
// background-state coda.
function afterBoxNote(hasAsk, blockStatus, guide, directive) {
  if (blockStatus === 'present' && !hasAsk) return null;
  const tagging = 'Tag each proposed path in the block with the reasoning-effort level its work needs, picked from ' +
    'this guide, not intuition: ' + guide;
  const tail = directive || AFTER_CODA;
  if (blockStatus === 'present') {
    return 'After-box note, automatic (GEN-941): a "' + PIN + ' For you" block header appears earlier this turn. ' +
      'If that was this turn\'s block and it is still current, close with one line at most -- do not repeat it; ' +
      'otherwise write the block now as your closing message, once. If you write one: ' + tagging + tail;
  }
  if (hasAsk) {
    return 'After-box note, automatic (GEN-941): your question went to the next-step box. Write the "' + PIN +
      ' For you" block now as your closing message -- the last thing this turn, written once and standing on its ' +
      'own, with each option\'s explanation and trade-off; it does not ask again a question the box shows (if the ' +
      'box\'s result says the question is not shown, ask it in the block instead). If a block ' +
      'already went out earlier this turn, close with ' +
      'one line instead of repeating it. ' + tagging + tail;
  }
  return 'After-box note, automatic (GEN-941): if this turn owes a "' + PIN + ' For you" block, write it once. ' +
    tagging + tail;
}

// PostToolUse on the box: the note to add, or null. Never blocks.
function afterBox(input) {
  if (!input || input.tool_name !== BOX_TOOL) return null;
  const base = { session: input.session_id || null, tool: BOX_TOOL, event: 'PostToolUse' };
  if (input.agent_id) { log(Object.assign({ outcome: 'after-box-subagent' }, base)); return null; }
  const ti = input.tool_input || {};
  const hasAsk = typeof ti.ask === 'string' && !!ti.ask.trim();
  const shared = loadShared(base);
  let entries = null;
  try { entries = readTail(input.transcript_path); } catch (e) { entries = null; }
  const blockStatus = turnBlockStatus(entries, shared.isErez);
  const model = lastModel(entries);
  const note = (blockStatus === 'present' && !hasAsk)
    ? null
    : afterBoxNote(hasAsk, blockStatus, shared.guide(), shared.directive(model));
  log(Object.assign({ outcome: note ? 'after-box-note' : 'after-box-silent', ask: hasAsk, block: blockStatus, model: model }, base));
  return note;
}

function runHook() {
  const watchdog = setTimeout(() => { try { process.exit(0); } catch (e) { /* ignore */ } }, 5000);
  if (typeof watchdog.unref === 'function') watchdog.unref();
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('error', () => { try { process.exit(0); } catch (e) { /* ignore */ } });
  process.stdin.on('end', () => {
    // The watchdog stays armed after stdin ends. decide() is synchronous, so the
    // timer cannot interrupt a stall inside it (its reads are local and capped);
    // it covers a stalled stdin or stderr flush. It is unref'd, so it never
    // delays a normal exit.
    let input = null;
    try {
      input = JSON.parse(raw || '{}');
      // A PostToolUse payload carries tool_response; one missing its event
      // name must still never reach decide(), which can exit 2.
      const post = input && (input.hook_event_name === 'PostToolUse' ||
        (!input.hook_event_name && Object.prototype.hasOwnProperty.call(input, 'tool_response')));
      if (post) {
        const note = afterBox(input);
        if (note) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: note } }));
      } else {
        decide(input);
      }
    } catch (e) {
      process.exitCode = 0;
      try { log({ outcome: 'error', detail: String(e && e.message || e).slice(0, 200), tool: input && input.tool_name || null, event: input && input.hook_event_name || null }); } catch (e2) { /* ignore */ }
    }
  });
}

if (require.main === module) runHook();

module.exports = {
  boxUntagged: boxUntagged,
  planHasEffort: planHasEffort,
  planOpensPlain: planOpensPlain,
  planReason: planReason,
  readPlanText: readPlanText,
  turnBlockStatus: turnBlockStatus,
  isTurnStart: isTurnStart,
  afterBoxNote: afterBoxNote,
  afterBox: afterBox,
  boxReason: boxReason,
  BLOCK_HEADER_RE: BLOCK_HEADER_RE,
  DECLINE_RE: DECLINE_RE,
  NO_WORK_TAG_RE: NO_WORK_TAG_RE,
  PLAN_EFFORT_LINE_RE: PLAN_EFFORT_LINE_RE,
  PLAN_EFFORT_HEADING_RE: PLAN_EFFORT_HEADING_RE,
  PLAIN_HEADING_RE: PLAIN_HEADING_RE,
  EFFORT_ONLY_TAG_RE_COPY: EFFORT_ONLY_TAG_RE_COPY
};
