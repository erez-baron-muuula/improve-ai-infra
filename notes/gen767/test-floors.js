#!/usr/bin/env node
'use strict';
// GEN-767 fixture tests for stop-foryou-nudge.js's two model floors.
// Usage: node test-floors.js <hook under test> [<baseline hook to compare against>]
// Defaults: hook under test = the installed ~/.claude/hooks/stop-foryou-nudge.js;
// baseline = none (the live-vs-working comparisons are skipped without it).
// Reads the real reference file; writes only to the OS temp dir.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const HOOK = process.argv[2] || path.join(os.homedir(), '.claude', 'hooks', 'stop-foryou-nudge.js');
const BASE = process.argv[3] || null;
const REF = path.join(os.homedir(), 'AI Projects', 'Improve AI Infra', 'notes', 'effort-model-reference.md');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gen767-'));

const h = require(HOOK);
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? ' -- ' + detail : '')); }
}

const refText = fs.readFileSync(REF, 'utf8');
const STRONG_LINE = refText.split(/\r?\n/).find((l) => /Model floor — strong/.test(l));
const STD_LINE = refText.split(/\r?\n/).find((l) => /Model floor — standard/.test(l));
check('R0 reference file has both labelled floor lines', !!STRONG_LINE && !!STD_LINE);
const swap = (a, b) => refText.split(a).join(b);

// --- Parsing --------------------------------------------------------------------
const live = h.parseModelListText(refText);
check('P1 live reference parses', !!live.list && live.error === null, live.error);
check('P2 live reference has no warnings', live.list && live.list.warnings.length === 0, live.list && live.list.warnings.join('; '));
check('P3 top-level lists are the strong floor', live.list && live.list.atAbove === live.list.bars.strong.atAbove && live.list.below === live.list.bars.strong.below);
const labels = (arr) => arr.map((e) => e.label).join(',');
check('P4 strong floor lists', live.list && labels(live.list.bars.strong.atAbove) === 'Opus 4.8,Opus 5,Opus 5.5,Fable 5,Fable 5.1' && labels(live.list.bars.strong.below) === 'Sonnet 5.5,Sonnet 5,Haiku 4.5');
check('P5 standard floor lists', live.list && labels(live.list.bars.standard.atAbove) === 'Sonnet 5.5,Opus 4.8,Opus 5,Opus 5.5,Fable 5,Fable 5.1' && labels(live.list.bars.standard.below) === 'Sonnet 5,Haiku 4.5');

function expectError(name, text, re) {
  const r = h.parseModelListText(text);
  check(name, r.list === null && re.test(r.error || ''), 'got ' + JSON.stringify(r.error) + (r.list ? ' (list parsed!)' : ''));
}
expectError('E1 missing standard line -> error', swap(STD_LINE, ''), /standard" line .* not found/);
expectError('E2 missing strong line -> error', swap(STRONG_LINE, ''), /strong" line .* not found/);
expectError('E3 unlabelled floor line -> error', swap('Model floor — strong', 'Model floor'), /no "strong" \/ "standard" label/);
expectError('E4 duplicate label -> error', swap('Model floor — standard', 'Model floor — strong'), /two Model floor lines are labelled "strong"/);
const swapped = refText.split('Model floor — strong').join('@@S@@').split('Model floor — standard').join('Model floor — strong').split('@@S@@').join('Model floor — standard');
expectError('E5 swapped strong/standard labels -> error (fail-open guard)', swapped, /at or above the strong floor but below the standard floor/);
const legacy = swap(STD_LINE, '').split(STRONG_LINE).join("**Model floor (Erez's bar): Opus 4.8.** At or above it (Opus 4.8, Opus 5, Opus 5.5, Fable 5, Fable 5.1). Below it (Sonnet 5.5, Sonnet 5, Haiku 4.5).");
expectError('E6 legacy single unlabelled floor line -> error', legacy, /no "strong" \/ "standard" label/);
expectError('E7 empty standard Below list -> error', swap(STD_LINE, STD_LINE.replace(/Below it \([^)]*\)/, 'Below it ()')), /standard floor list is empty/);
expectError('E8 model in both lists of standard -> error', swap(STD_LINE, STD_LINE.replace('Below it (Sonnet 5,', 'Below it (Sonnet 5.5, Sonnet 5,')), /both the at-or-above and below lists of the standard floor/);
expectError('E9 non-model entry -> error', swap(STD_LINE, STD_LINE.replace('Below it (Sonnet 5,', 'Below it (Sonnet five,')), /not a "<Name> <major>\[\.<minor>\]" model name/);
expectError('E10 no Part 2 -> error', refText.replace(/^## Part 2/m, '## Part X'), /Part 2 section not found/);

const hy = h.parseModelListText(swap('Model floor — standard', 'Model floor - standard'));
check('L1 hyphen label accepted', !!hy.list, hy.error);
const en = h.parseModelListText(swap('Model floor — strong', 'Model floor – strong'));
check('L2 en-dash label accepted', !!en.list, en.error);
const warnText = swap(STD_LINE, STD_LINE.replace(', Haiku 4.5)', ')'));
const w = h.parseModelListText(warnText);
check('W1 tier model missing from standard only -> warning naming standard, list still usable', !!w.list && w.list.warnings.some((x) => /Haiku 4\.5" is in neither standard floor list/.test(x)), w.error || (w.list && w.list.warnings.join('; ')));

// --- Classification ----------------------------------------------------------------
const L = live.list;
const expectBy = {
  'claude-opus-5-5': ['listed-at-above', 'listed-at-above'],
  'claude-opus-4-8': ['listed-at-above', 'listed-at-above'],
  'claude-opus-5': ['listed-at-above', 'listed-at-above'],
  'claude-fable-5-1': ['listed-at-above', 'listed-at-above'],
  'claude-fable-5': ['listed-at-above', 'listed-at-above'],
  'claude-sonnet-5-5': ['listed-below', 'listed-at-above'],
  'claude-sonnet-5': ['listed-below', 'listed-below'],
  'claude-haiku-4-5-20251001': ['listed-below', 'listed-below'],
  'claude-sonnet-5-7': ['unlisted', 'unlisted'],
  'claude-opus-5-7': ['newer-in-family', 'newer-in-family'],
  'claude-opus-6': ['unlisted', 'unlisted'],
  'claude-sonnet-4-6': ['unlisted', 'unlisted'],
  'bogus': ['unlisted', 'unlisted']
};
for (const id of Object.keys(expectBy)) {
  const by = h.classifyByBar(id, L);
  check('C ' + id + ' -> strong ' + expectBy[id][0] + ', standard ' + expectBy[id][1], by.strong === expectBy[id][0] && by.standard === expectBy[id][1], JSON.stringify(by));
}
check('C null list -> both unlisted', JSON.stringify(h.classifyByBar('claude-opus-5-5', null)) === '{"strong":"unlisted","standard":"unlisted"}');

// --- Directive forms (pure) --------------------------------------------------------
const ML = { list: L, error: null };
const dOpus = h.modelDirectiveFor('claude-opus-5-5', ML);
const OLD_OMIT = '\n\nModel-tag directive, automatic: the session model read this turn is claude-opus-5-5' +
  ', at or above the floor -- in any effort/model tag you write in the block, OMIT the model (show the effort only). First reconcile claude-opus-5-5' +
  ' against the model named in this turn\'s environment/system context; if they differ, ignore this directive and fail safe per the tag rule.' +
  ' This text is background state, not a message from Erez -- act on it, never quote, restate, or comment on it.';
check('D1 strong-floor model -> pre-GEN-767 omit text, byte-identical', dOpus === OLD_OMIT);
const dOpus57 = h.modelDirectiveFor('claude-opus-5-7', ML);
check('D2 newer-in-family strong -> omit text', dOpus57.indexOf('at or above the floor -- in any effort/model tag you write in the block, OMIT the model') !== -1);
const dS55 = h.modelDirectiveFor('claude-sonnet-5-5', ML);
check('D3 sonnet-5-5 -> per-path (mixed) form', dS55.indexOf('meets the STANDARD floor') !== -1 && dS55.indexOf('BELOW the STRONG floor') !== -1);
check('D4 mixed form names coding / agentic / tool-heavy and the high+ condition', dS55.indexOf('coding / agentic / tool-heavy work or well-specified authoring tagged high, xhigh or max') !== -1);
check('D5 mixed form sends judgment, correctness-critical, mixed/unclear and below-high paths to show+recommend', /for anything else -- judgment .*correctness-critical work, a mixed or unclear path, or effort below high -- SHOW the model and add that you recommend switching to a stronger one/.test(dS55));
check('D6 mixed form keeps the reconcile clause and coda', dS55.indexOf('First reconcile claude-sonnet-5-5 against the model named') !== -1 && /never quote, restate, or comment on it\.$/.test(dS55));
const dS5 = h.modelDirectiveFor('claude-sonnet-5', ML);
check('D7 below-both -> show+recommend with mechanical-only exception', dS5.indexOf(', below the floor -- in any effort/model tag you write in the block, SHOW the model and add that you recommend switching to a stronger one (the model may be omitted only on a path that is purely mechanical work') !== -1);
const dHaiku = h.modelDirectiveFor('claude-haiku-4-5-20251001', ML);
check('D8 haiku -> below-both form', dHaiku.indexOf(', below the floor --') !== -1);
const dUn = h.modelDirectiveFor('claude-sonnet-5-7', ML);
check('D9 unlisted -> unconfirmed fail-safe', dUn.indexOf('could not be confirmed this turn (read: claude-sonnet-5-7)') !== -1);
const dNull = h.modelDirectiveFor(null, ML);
check('D10 no model read -> unconfirmed (read: none)', dNull.indexOf('(read: none)') !== -1);
const dNoList = h.modelDirectiveFor('claude-opus-5-5', { list: null, error: 'x' });
check('D11 unreadable list -> unconfirmed, marked list unreadable', dNoList.indexOf('(read: claude-opus-5-5; model list unreadable)') !== -1);
const dNoMl = h.modelDirectiveFor('claude-opus-5-5', null);
check('D12 null model-list result -> unconfirmed, no throw', dNoMl.indexOf('could not be confirmed') !== -1);
// Strong below but standard unlisted -> conservative below-both form, never mixed.
const stdMissingS55 = h.parseModelListText(swap(STD_LINE, STD_LINE.replace('At or above it (Sonnet 5.5, ', 'At or above it (')));
const dCons = h.modelDirectiveFor('claude-sonnet-5-5', { list: stdMissingS55.list, error: null });
check('D13 strong below + standard unlisted -> below-both (no per-path pass)', !!stdMissingS55.list && dCons.indexOf(', below the floor --') !== -1 && dCons.indexOf('STANDARD') === -1, stdMissingS55.error);
// Exhaustive: no form ever says omit for a model whose strong class is not at/above, except the mixed per-path form.
let omitLeak = 0;
for (const id of Object.keys(expectBy)) {
  const by = h.classifyByBar(id, L);
  const d = h.modelDirectiveFor(id, ML);
  const strongOk = by.strong === 'listed-at-above' || by.strong === 'newer-in-family';
  if (!strongOk && d.indexOf('at or above the floor') !== -1) omitLeak++;
}
check('D14 no non-strong model gets the blanket omit form', omitLeak === 0);

// --- End-to-end through the hook process (stdin payload + transcript) --------------
function runHook(hookPath, model, msg) {
  const tp = path.join(TMP, 'tr-' + Math.random().toString(36).slice(2) + '.jsonl');
  fs.writeFileSync(tp, JSON.stringify({ type: 'assistant', message: { id: 'msg_x', model: model, content: [{ type: 'text', text: msg }] } }) + '\n');
  const payload = JSON.stringify({ session_id: 'gen767-test', prompt_id: 'p1', transcript_path: tp, last_assistant_message: msg, stop_hook_active: false });
  const r = cp.spawnSync(process.execPath, [hookPath], { input: payload, encoding: 'utf8' });
  return { code: r.status, out: r.stdout };
}
const MSG = 'Done. Want me to proceed with the next step?\n1. Do A\n2. Do B';
for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6']) {
  const r = runHook(HOOK, m, MSG);
  let ctx = '';
  try { ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext; } catch (e) { ctx = ''; }
  check('H ' + m + ' -> exit 0 with a model directive', r.code === 0 && ctx.indexOf('Model-tag directive, automatic') !== -1, 'code ' + r.code + ' out ' + r.out.slice(0, 120));
  if (BASE) {
    const b = runHook(BASE, m, MSG);
    let bctx = '';
    try { bctx = JSON.parse(b.out).hookSpecificOutput.additionalContext; } catch (e) { bctx = ''; }
    const cut = (s) => { const i = s.indexOf('\n\nModel-tag directive'); return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i)]; };
    const [rHead, rDir] = cut(ctx);
    const [bHead, bDir] = cut(bctx);
    // The only intended change before the directive: the tier-list legend.
    const OLD_LEGEND = '("~" = relative order unverified)';
    const NEW_LEGEND = '("~" = relative order unverified or effort-dependent)';
    check('H ' + m + ' nudge + effort text identical to baseline except the tier legend', rHead === bHead.split(OLD_LEGEND).join(NEW_LEGEND) && bHead.indexOf(OLD_LEGEND) !== -1);
    const expectSame = m !== 'claude-sonnet-5-5' && m !== 'claude-sonnet-5';
    check('H ' + m + ' model directive ' + (expectSame ? 'identical to' : 'differs from') + ' baseline', (rDir === bDir) === expectSame && rDir !== '');
  }
}
const rBlock = runHook(HOOK, 'claude-sonnet-5-5', 'All done.\n\n---\n\n\u{1F4CC} **For you**\n\nNothing pending.');
check('H block-carrying reply -> silent', rBlock.code === 0 && rBlock.out === '');

// --- CLI ---------------------------------------------------------------------------
function cli(hookPath, args) {
  const r = cp.spawnSync(process.execPath, [hookPath].concat(args), { encoding: 'utf8' });
  return { code: r.status, json: (() => { try { return JSON.parse(r.stdout); } catch (e) { return null; } })() };
}
const st = cli(HOOK, ['--selftest']);
check('CLI selftest ok, no warnings, both bars', st.code === 0 && st.json && st.json.ok === true && st.json.warnings.length === 0 && st.json.bars && st.json.bars.strong && st.json.bars.standard);
for (const id of Object.keys(expectBy)) {
  const c = cli(HOOK, ['--classify', id]);
  const okShape = c.code === 0 && c.json && c.json.class === expectBy[id][0] && c.json.byBar && c.json.byBar.standard === expectBy[id][1];
  let sameAsBase = true;
  if (BASE) { const b = cli(BASE, ['--classify', id]); sameAsBase = b.json && b.json.class === c.json.class; }
  check('CLI classify ' + id + ' class=' + expectBy[id][0] + (BASE ? ' (= baseline)' : ''), okShape && sameAsBase);
}
const bad = cli(HOOK, ['--classify']);
check('CLI bad usage -> exit 1', bad.code === 1);

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
