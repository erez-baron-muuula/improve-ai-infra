// GEN-892 + GEN-971: build the working copies of the release-review skill: SKILL.md gains the guidelines
// watch sentence (Step 1) and loses its Step 8 write templates and Step 9 digest format, which move to
// writes-and-digest.md (new). Exact-text replacements from the live SKILL.md, each matching once.
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = 'C:/Users/Erez/.claude/skills/release-review/SKILL.md';
const DIR = path.join(__dirname, 'wc', 'skills', 'release-review');
let text = fs.readFileSync(SRC, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const moved = [];
function rep(from, to, keep) {
  from = from.replace(/\r?\n/g, eol);
  to = to.replace(/\r?\n/g, eol);
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error('expected 1 match, found ' + n + ' for: ' + from.slice(0, 80));
  text = text.replace(from, () => to);
  if (keep) moved.push(keep);
}

// Step 0: a crashed run's guidelines output is carry-over too.
rep('2. Read `state.json`, `findings.jsonl`, and any `unfiled-*.md` (carry-over). Carry-over items are\n',
    '2. Read `state.json`, `findings.jsonl`, and any `unfiled-*.md` and `guidelines-pending-*.json`\n' +
    '   (carry-over; the latter per `guidelines-watch.md`). Carry-over items are\n');

// Step 1: the guidelines watch runs before the no-op stop.
rep('- No new versions and no new Help Center entries → record a no-op run (Step 10, `through` =\n' +
    '  `from`) and stop. That is a normal, quiet outcome.\n',
    '- Guidelines watch (GEN-892): run it now, as `guidelines-watch.md` in this folder says.\n' +
    '- No new versions, no new Help Center entries and nothing from the guidelines watch to write →\n' +
    '  record a no-op run (Step 10, `through` = `from`) and stop. That is a normal, quiet outcome.\n');

// Step 7: guidelines keys re-arm.
rep('  `unblocked`, `proposed` or `reverted` → skip (a `proposed` item Erez has not answered is still on\n' +
    '  the digest; do not re-list it).\n',
    '  `unblocked`, `proposed` or `reverted` → skip (a `proposed` item Erez has not answered is still on\n' +
    '  the digest; do not re-list it). `guidelines:` keys follow the re-arm rule in `guidelines-watch.md`.\n');

// Step 8: the three write templates move to writes-and-digest.md.
const STEP8_OLD =
  '- **Note on an affected ticket** (append): one dated block at the end of the body —\n' +
  '  `**Release review YYYY-MM-DD — Claude Code 2.1.NNN:** <the change, plain words> — <what it means for this ticket>. Docs: <url>.`\n' +
  '  A body append is material, so re-derive `Urgency`, `Gain ratio` and `Priority` per `/vet-ticket`\n' +
  '  Step 1, and raise urgency only with a stated reason.\n' +
  '- **New ticket** (create): named by outcome; body stands on its own (problem, why it matters, the\n' +
  '  release and docs link, the files or tickets involved, next action, who verifies); parent the\n' +
  '  AI-infra epic GEN-86 unless the domain is another project\'s (global "route by domain" rule); the\n' +
  '  Task template applied (check it exists); type task; status the one actually true (normally To Do);\n' +
  '  unassigned unless only Erez can do it; priority fields derived.\n' +
  '- **Unblock** (Blocked → To Do), only when Step 6.3 holds and the global `CLAUDE.md` "Ticket status"\n' +
  '  exception allows it: first the gated note `**Unblocked by release review YYYY-MM-DD — Claude Code 2.1.NNN:** <capability>. Was blocked on: "<quoted blocker>". Docs: <url>. Available: installed <version>; <plan note>.`\n' +
  '  — with the three conditions and the quoted blocker in the reviewer\'s brief so it judges the unblock\n' +
  '  itself — and re-fetch it. Only if the note landed, set Status to To Do (a status-only update) and\n' +
  '  re-fetch. If the note fails, do not touch the status.\n';
rep(STEP8_OLD,
  'Before doing this step, read `writes-and-digest.md` in this folder (the note, new-ticket and unblock\n' +
  'formats).\n' +
  '- **Note on an affected ticket** (append): re-derive the priority fields.\n' +
  '- **New ticket** (create): by the ticket-drafting rules.\n' +
  '- **Unblock** (Blocked → To Do), only when Step 6.3 holds and the global `CLAUDE.md` "Ticket status"\n' +
  '  exception allows it: the gated note first; the status flip only after the note is confirmed.\n', STEP8_OLD);

// Step 9: the digest format and the waiting count move to writes-and-digest.md.
const STEP9_OLD =
  'reply in any session "release review: yes to 2, no to 3"), and put its GEN id in the run row\'s\n' +
  '`digestTicket`. Each live run appends ONE dated section, plain language, Erez-facing:\n' +
  '\n' +
  '```\n' +
  '## Run YYYY-MM-DD — Claude Code 2.1.AAA → 2.1.BBB (N versions; installed 2.1.III)\n' +
  '[Re-evaluate line, if any]\n' +
  'Filed: GEN-x <title> — why (one line each)\n' +
  'Notes added: GEN-y — one line each\n' +
  'Moved Blocked → To Do: GEN-z — the capability; say "back to Blocked" to reverse\n' +
  'Waiting for your yes/no:\n' +
  '  1. <proposal, its reason, the ticket> — yes / no\n' +
  'Not filed this run: <items, why (cap / review did not pass / error)> — saved in <recovery file>\n' +
  'Unverified, maybe later: <one line each>\n' +
  'Arrives in a version not installed yet: <one line each, if any>\n' +
  'Reviews: <n> written, <n> needed more than one review round, <n> not filed\n' +
  '```\n' +
  '\n' +
  'Before appending, read the digest\'s earlier sections and count yes/no items not yet struck through\n' +
  '(answered items are struck and moved to a "Decided" section by the session where Erez answers); that\n' +
  'count plus this run\'s new ones is the run\'s `waiting`. In `dry`, write the section to the dry-run file\n' +
  'instead. In `supervised`, the digest append is one of the N writes.\n';
rep(STEP9_OLD,
  'reply in any session "release review: yes to 2, no to 3"), and put its GEN id in the run row\'s\n' +
  '`digestTicket`. Each live run appends ONE dated section, plain language, Erez-facing, in the format in\n' +
  '`writes-and-digest.md` (re-read it if you no longer have it), which also says how to count the run\'s\n' +
  '`waiting`; it includes the guidelines lines `guidelines-watch.md` names. In `dry`, write the section to\n' +
  'the dry-run file instead. In `supervised`, the digest append is one of the N writes.\n', STEP9_OLD);

// Step 11: the report names applied limit changes.
rep('Delete `run.lock`. The final message (the scheduled run\'s summary) is short and plain: versions\n' +
    'reviewed, what was filed',
    'Delete `run.lock`. The final message (the scheduled run\'s summary) is short and plain: versions\n' +
    'reviewed, limit changes applied, what was filed');

// Step 10.2: settled guidelines-pending files are deleted.
rep('   or its substance, the verified versions, the docs URL, and why it was not written. Rename an older\n' +
    '   recovery file to `filed-<stamp>.md` once all its items are written.\n',
    '   or its substance, the verified versions, the docs URL, and why it was not written. Rename an older\n' +
    '   recovery file to `filed-<stamp>.md` once all its items are written. Delete settled\n' +
    '   `guidelines-pending-*.json` files (`guidelines-watch.md`).\n');

// Step 10.5: the guidelines files join the commit list.
rep('   `notes/release-review/state.json`, `runs.jsonl`, `findings.jsonl` and this run\'s recovery or\n' +
    '   dry-run file — each only if it exists.',
    '   `notes/release-review/state.json`, `runs.jsonl`, `findings.jsonl`, this run\'s recovery or\n' +
    '   dry-run file, and the guidelines files `guidelines-watch.md` lists — each only if it exists.');

fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'SKILL.md'), text, 'utf8');

// writes-and-digest.md: the moved text, verbatim, under a short header.
const ref =
  '# Release review — Step 8 write formats and the Step 9 digest\n\n' +
  '**Contents:** Step 8 note, new ticket and unblock formats · Step 9 digest section and the `waiting` count\n\n' +
  'Moved out of `SKILL.md` to keep it within the size kept after compaction (GEN-971). Read it at Step 8\n' +
  'and Step 9, every run.\n\n' +
  '## Step 8 — the three writes\n\n' + moved[0].replace(/\r\n/g, '\n') + '\n' +
  '## Step 9 — the digest section\n\n' +
  'Each live run appends ONE dated section, plain language, Erez-facing:\n' +
  moved[1].replace(/\r\n/g, '\n').split('`digestTicket`. Each live run appends ONE dated section, plain language, Erez-facing:\n')[1]
    .replace('Reviews: <n> written, <n> needed more than one review round, <n> not filed\n',
      'Guidelines watch: <its lines, as guidelines-watch.md says; omit when none>\n' +
      'Reviews: <n> written, <n> needed more than one review round, <n> not filed\n')
    .replace(' In `dry`, write the section to the dry-run file\ninstead. In `supervised`, the digest append is one of the N writes.\n', '\n');
fs.writeFileSync(path.join(DIR, 'writes-and-digest.md'), ref.replace(/\n/g, eol), 'utf8');
console.log('wrote SKILL.md and writes-and-digest.md in', DIR);
