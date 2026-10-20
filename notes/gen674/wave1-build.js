// GEN-674 Wave 1: build working copies of the global CLAUDE.md and two skills from the live files.
// Each replacement must match exactly once; the script aborts otherwise. Output goes to OUT_DIR.
// Usage: node wave1-build.js <outDir>
const fs = require('fs');
const path = require('path');
const HOME = process.env.USERPROFILE;
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node wave1-build.js <outDir>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

function apply(src, pairs, label) {
  let s = src;
  for (const [oldT, newT] of pairs) {
    const n = s.split(oldT).length - 1;
    if (n !== 1) { console.error(label + ': expected 1 match, got ' + n + ' for: ' + oldT.slice(0, 70)); process.exit(2); }
    s = s.replace(oldT, () => newT);
  }
  return s;
}

const RULES = [
  // GEN-126: self-review cluster; L111 and L121 fold into L37 (L125 already covers filing learnings).
  ["Self-check everything. Correct me when I'm wrong. No flattery.",
   "Self-check everything. Correct me when I'm wrong. No flattery. Learn from mistakes in the conversation and don't repeat them."],
  ["Learn from mistakes in the conversation; don't repeat them.\n\n", ""],
  ["When making a mistake, suggest what changes need to be made to the general instructions or if not applicable, to a project's instructions.\n\n", ""],
  // GEN-172: tighten L35.
  ["Don't defer uncritically to assertions from third parties (dev team, reviewers, external stakeholders). When someone rejects or judges a proposal — especially with a one-word label like \"unsafe,\" \"too hard,\" or \"won't work\" — evaluate the claim on its merits before accepting it. If the reasoning doesn't hold up, or wasn't given, push back and ask for the specific objection. Deferring out of politeness or to authority is not a reason to drop a sound idea. But challenge only when it's actionable — when it could change a decision, outcome, or next step. Once you've accepted someone's conclusion, don't keep correcting their reasoning or word choice; educating people is not our job. This applies to everyone, not only Erez.",
   "Don't defer uncritically to assertions from third parties (dev team, reviewers, external stakeholders). When someone rejects or judges a proposal — especially with a one-word label like \"unsafe,\" \"too hard,\" or \"won't work\" — evaluate the claim on its merits; if the reasoning doesn't hold up or wasn't given, push back and ask for the specific objection. Politeness or authority is not a reason to drop a sound idea. Challenge only when it could change a decision, outcome, or next step, and once you've accepted someone's conclusion, stop correcting their reasoning or wording. This applies to everyone, not only Erez."],
  // GEN-172: tighten L41.
  ["Verify before asserting or restating — no claims from memory. This covers: capabilities (\"I can do X\") — check the code, run a command, or confirm from documentation before stating it; evidence-based claims used to support a decision (cost, stability, performance, comparison numbers, \"X works well\") — verify from the source; and facts inherited from a session summary or continuation context — these are point-in-time snapshots, not current truth, and a summary counts as memory: before restating any time-varying value carried over this way (context-window %, date, ticket status, counts, file state), re-read it from live state; and the origin of content already in the conversation — before asserting a line is injected, foreign, or not your own, check the transcript for its actual source (your own turn, the user, or tool/hook-injected text) rather than judging by its surface form, since your own output under a degraded-context or error condition can look unfamiliar.",
   "Verify before asserting or restating — no claims from memory. This covers: capabilities (\"I can do X\") — confirm from the code, a command, or documentation; evidence-based claims behind a decision (cost, stability, performance, comparisons, \"X works well\") — verify from the source; facts carried over from a session summary or continuation context, which count as memory — re-read any time-varying value (context-window %, date, ticket status, counts, file state) from live state before restating it; and the origin of content already in the conversation — before asserting a line is injected, foreign, or not your own, check the transcript for its actual source (your own turn, the user, or tool/hook-injected text), since your own output under a degraded-context or error condition can look unfamiliar."],
  // Audit 2026-10-18 (M2/F4): L43 steered thinking depth.
  ["For any non-routine answer (design, architecture, trade-offs, uncertain territory): treat the first pass as a draft. Rate confidence internally. If not high, re-examine from scratch before responding.",
   "For any non-routine answer (design, architecture, trade-offs, uncertain territory), present it only when you are confident in it; if you are not, vet it against real sources first or switch to an option you can vet, and if neither settles it, say what is uncertain and what would settle it."],
  // Positional reference fix in L45.
  ["and to Done or Review (per the verification check below) when its work is complete.",
   "and to Done or Review (per \"Before any ticket goes to Done or Review\") when its work is complete."],
  // GEN-862: one rule for "which ones does this answer cover" (L55 + L119).
  ["When recording a decision, quote Erez's answer verbatim and name the exact question it answered. If one answer could cover more than one open decision, ask which ones before recording it.",
   "When recording a decision, quote Erez's answer verbatim and name the exact question it answered. When one reply could cover more than one open question or part — a \"yes\" to a multi-part question, or an answer that fits several open decisions — ask which ones it covers before acting on or recording it."],
  ["Treat autocomplete suggestions as prompts, not answers. If user replies \"yes\" to a multi-part question, ask which parts they're confirming before proceeding.",
   "Treat autocomplete suggestions as prompts, not answers."],
  // GEN-741: Backlog vs Blocked for Erez's own decisions; offset by trimming the option-names sentence.
  ["waiting on something else to happen first → Backlog; ready to be worked → To Do; held by a specific blocker, including one awaiting Erez's own input → Blocked;",
   "waiting on something else to happen first, including a decision Erez hasn't been asked for → Backlog; ready to be worked → To Do; held by a specific blocker, including one awaiting Erez's own input on a question already put to him → Blocked;"],
  ["Read the tracker's live status options before writing, since the option names above can change, and honour any project-specific exception that fixes a ticket type's status.",
   "Read the tracker's live status options first (names can change) and honour any project-specific exception that fixes a ticket type's status."],
  // Audit F3: step-at-a-time vs act-don't-ask. Opening kept (quoted by the deploy rule).
  ["Break tasks into steps. One step at a time; wait for confirmation before continuing.",
   "Break tasks into steps. One step at a time; wait for confirmation before continuing past a step that needs Erez's decision (the kinds named in \"When presenting anything to Erez\"); mechanical steps, and steps he has already approved, proceed."],
  // Drop the QA-layer legend; reword its two uses.
  ["QA-layer legend (used by the verification rules): Layer 1 = exception narration (silent on success; see \"Default to silence on success\"); Layer 2 = end-of-turn checklist; Layer 3 = programmatic post-checks; Layer 4 = snapshot + diff of adjacent state; Layer 5 = independent reviewer.\n\n", ""],
  ["Surface unexpected deltas — not just whether the intended change landed (Layer 3 covers that).",
   "Surface unexpected deltas — not just whether the intended change landed (the \"After tool calls that mutate state\" check covers that)."],
  ["log it on GEN-58 (QA Layer 5) immediately,", "log it on GEN-58 (the reasoning-failure log) immediately,"],
  // Audit F2 + GEN-172: one item at a time vs card lists; tighten.
  ["When presenting anything to Erez for approval or a decision, give exactly one item at a time and wait, and don't surface or preview later items until the current one is resolved -- never a long block or multi-part list to sign off at once. Erez is non-technical: frame every choice in plain real-world terms (what it means, what the trade-off costs him), never as technical assumptions, config values, or implementation detail. If a choice cannot be made meaningful without jargon, translate it or make the call yourself and just tell him. More generally, default to acting rather than asking: do anything you can do yourself — investigating state, reading code/diffs/logs, completing mechanical or already-authorized work — without handing it back to Erez or asking permission. Reserve asking for genuine decisions that are his: design, ticket status, risky/destructive operations, and rule-file edits. When an item being presented for approval is due a `/check` panel — by standing rule or by a commitment in its governing ticket or plan, even one worded against a later step (e.g. 'before applying') — run the panel on the concrete proposal first and present the converged result, so approval covers the vetted version. A quick directional go/no-go may precede the panel; final approval may not. (Generalizes the check-before-present ordering in 'Before adding or editing a rule in a CLAUDE.md file' and 'When the user asks a question'.)",
   "When presenting anything to Erez for approval or a decision, give exactly one item at a time and wait, and don't surface or preview later items until the current one is resolved -- never a long block or multi-part list to sign off at once; a set of items that a skill's own procedure puts to Erez in a single approval ask (such as a ticket summary card) counts as one item. Erez is non-technical: frame every choice in plain real-world terms (what it means, what the trade-off costs him), never as technical assumptions, config values, or implementation detail; if a choice cannot be made meaningful without jargon, translate it or make the call yourself and just tell him. More generally, default to acting rather than asking: do anything you can do yourself — investigating state, reading code/diffs/logs, completing mechanical or already-authorized work — without handing it back to Erez; reserve asking for genuine decisions that are his: design, ticket status, risky/destructive operations, and rule-file edits. When an item being presented for approval is due a `/check` panel — by standing rule or by a commitment in its governing ticket or plan, even one worded against a later step — run the panel on the concrete proposal first and present the converged result, so approval covers the vetted version; a quick directional go/no-go may precede the panel, final approval may not."],
  // GEN-172: L107 detail lives in the /wrap skill.
  ["**End of session (\"end session\" / \"wrap up\") — run as the last actions, after all other session work is complete:** invoke the `/wrap` skill, which performs the full wrap-up (captures unresolved items as Notion tickets, the config-health pass, auto-approval scan, HISTORY.md update + git push, config sync, and the active project's closing steps).",
   "**End of session (\"end session\" / \"wrap up\"):** as the last actions, after all other session work, invoke the `/wrap` skill (it performs the full wrap-up)."],
  // GEN-172: L117.
  ["Numbered lists never restart mid-list. Continue the count across sections and headers. Use n\\. escaped markdown (e.g. 3\\., 4\\.) for every list item except the very first item of the very first section — this applies to all items in all subsequent sections, including item 2 onward within any section that follows a section break. Never rely on markdown's auto-numbering after the opening item. When in doubt, escape every item.",
   "Numbered lists never restart mid-list: continue the count across sections and headers. Write every item except the very first of the very first section as escaped markdown (e.g. 3\\., 4\\.), never relying on markdown's auto-numbering; when in doubt, escape every item."],
  // GEN-476 + GEN-126: pushback and contradiction tracking in one rule.
  ["When the user pushes back, distinguish (a) new information/argument that changes the answer, vs. (b) emotional tone or rephrasing. Only update the answer based on (a). For (b), restate the reasoning and don't retreat.",
   "When the user pushes back, distinguish (a) new information or argument that changes the answer from (b) emotional tone or rephrasing; update only on (a), and for (b) restate the reasoning and don't retreat. Track contradictions within a conversation: if you assert X and later not-X, that can signal caving to pressure — surface it (\"I said X earlier and now I'm saying not-X — let me work out which is right\") before continuing. A correction absorbed into the turn's not-yet-emitted \"📌 For you\" block is not such a contradiction."],
  ["Track contradictions within a conversation. If you assert X and then assert not-X, that's not normal correction — it's a signal of caving to social pressure. Surface it explicitly: \"I said X earlier and now I'm saying not-X — let me work out which is right\" before continuing.\n\n", ""],
  // GEN-172: L173.
  ["proceed through the standard deploy step (e.g. `clasp push`, `git push`) automatically once the implementation is approved and complete, rather than stopping to ask; this is the deploy step of \"default to acting rather than asking\" and, for this step, overrides the general pause in \"Break tasks into steps. One step at a time\" and the \"risky/destructive operations\" hesitation. Still confirm first when the deploy carries an elevated, distinct risk beyond shipping the approved change — e.g. a force-push or history rewrite, pushing to the wrong remote/branch or to a production target with no rollback and broad blast radius — in which case surface that specific risk per",
   "proceed through the standard deploy step (e.g. `clasp push`, `git push`) automatically once the implementation is approved and complete; this is the deploy step of \"default to acting rather than asking\" and overrides the pause in \"Break tasks into steps. One step at a time\" and the \"risky/destructive operations\" hesitation. Still confirm first when the deploy carries an elevated, distinct risk beyond shipping the approved change — e.g. a force-push or history rewrite, the wrong remote/branch, or a production target with no rollback and broad impact — and surface that risk per"],
  // Locked-config note trimmed; ticket-number tag removed.
  ["The shared config files `settings.json`, `settings.local.json`, the global `CLAUDE.md`, `hooks/auto-approve.js`, and `scripts/notion-ticket-lookup.ps1` are locked — direct edits are refused. Edit them via `G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1` (or `update-global-rule.ps1` for `CLAUDE.md`); to *delete* text, call `update-config.ps1` directly (the wrapper requires a non-empty `-NewText`). The refusal message names the emergency override. (GEN-103)",
   "Locked config files (`settings.json`, `settings.local.json`, the global `CLAUDE.md`, `hooks/auto-approve.js`, `scripts/notion-ticket-lookup.ps1`) change only via `G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1` (or `update-global-rule.ps1` for `CLAUDE.md`); to *delete* text, call `update-config.ps1` directly, since the wrapper requires a non-empty `-NewText`."],
  // GEN-172: L202.
  ["The environment readout's \"Shell\" / \"Platform\" fields describe where tool commands execute, not which Claude Code client the user is using. Claude Code runs in the terminal CLI, the desktop app, the web app, and IDE extensions — all of them report a shell (e.g. PowerShell). Never infer the user's interface surface from the shell readout. When an answer depends on the client surface (UI affordances, keyboard shortcuts, \"tap\" vs \"click\", how output is rendered), ask which client they're in rather than assuming terminal.",
   "The environment readout's \"Shell\" / \"Platform\" fields describe where tool commands run, not which Claude Code client Erez is using (terminal, desktop app, web and IDE all report a shell). When an answer depends on the client (UI affordances, keyboard shortcuts, \"tap\" vs \"click\", rendering), ask which one he's in rather than assuming terminal."],
];

const SUGGEST = [
  ["Extends the always-loaded \"For any non-routine answer… treat the first pass as a draft, rate\nconfidence, re-examine if not high\" rule (which is cited, not restated) with the",
   "Extends the always-loaded \"For any non-routine answer… present it only when you are confident\nin it\" rule (which is cited, not restated) with the"],
];

const CONFIG_HEALTH = [
  ["(2) framework terms with an in-file definition (e.g. the QA-layer legend's \"Layer 1-5\"),",
   "(2) framework terms with an in-file definition,"],
];

const targets = [
  [path.join(HOME, '.claude', 'CLAUDE.md'), RULES, 'CLAUDE.md'],
  [path.join(HOME, '.claude', 'skills', 'suggest', 'SKILL.md'), SUGGEST, 'suggest-SKILL.md'],
  [path.join(HOME, '.claude', 'skills', 'config-health', 'SKILL.md'), CONFIG_HEALTH, 'config-health-SKILL.md'],
];
for (const [src, pairs, name] of targets) {
  const before = fs.readFileSync(src, 'utf8');
  const after = apply(before, pairs, name);
  fs.writeFileSync(path.join(OUT, name), after);
  const lines = s => s.split('\n').length;
  console.log(name + ': lines ' + lines(before) + ' -> ' + lines(after) + ', chars ' + [...before].length + ' -> ' + [...after].length);
}
