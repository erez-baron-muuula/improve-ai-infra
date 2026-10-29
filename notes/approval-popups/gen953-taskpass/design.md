# GEN-953 step 3 — browser task approval (one approval per listed browser job) — design v2

> **PARKED 2026-10-28, not installed.** Erez: "Park the task approval (keep it built, not installed) and
> start on GEN-980 instead." Why: the second independent code review found 3 more bypasses (list hidden
> by Markdown link syntax, look-alike letters dodging stop words, a listed Enter sending a chat message);
> the holding fix (list in a verbatim code block, plain-character steps/texts, no key presses) cuts the
> measured saving from ~14% to ~8% (44 of 98 let-through items were key presses). The working copy
> `wc/browser-site-gate.js` (177 tests, replay 0 diffs) includes all fixes through review round 2, not
> round 3's. Vetting record `~/.claude-staging/vetting-passes/record-gen953-taskpass-browser-site-gate.js.json`
> is stale (hash predates the fixes). To resume: apply the allowlist re-derivation, re-run both reviews.

Ticket: GEN-953 (https://app.notion.com/p/4046e495d07c8133845ef08726ff480c), "Remaining steps" item 3
(called step 4 in `../plan-approved-2026-10-25.md`). Erez, 2026-10-28, chose to build it now instead of
waiting for the 8 Nov count: "Start building the one-approval-per-browser-task step now; don't wait for
the 8 Nov count." He then approved the design's defaults: "Yes, build the browser task approval as
designed, with those defaults."

Targets: `~/.claude/hooks/browser-site-gate.js` (working copy `wc/browser-site-gate.js`); a "Task approval"
section in `~/.claude/hooks/refs/browser.md` (draft `refs-browser.md`, built by `build-refs.js`); one added
step in the 8 Nov check `~/.claude/scheduled-tasks/gen924-browser-gate-noise-check/SKILL.md`.

v2 changes after /check round 1: the page-script waiver is dropped; the card offer is short, placed after
the card's first sentence, and made only when it fits the visible lines; a rejected list is told to
Claude only; typed text is read for deletes/access/sends at item time and all listed texts together at
declaration time; key presses are limited to named keys; size lines added; signal bar added; live tests
listed.

## In plain words

Before a multi-step browser job, Claude ends its message with a "Browser task:" list (the site, each
step in the exact words it will use, any exact text it will type), says plainly what will still ask,
and asks "Ready?". After Erez replies, the first pop-up on that site adds one sentence: "Allowing also
approves Claude's listed N-step task here for 10 min." Once that call has run (so Erez allowed it), a
click, key, typing or form fill on that site whose description is a listed step goes ahead without a
pop-up, for 10 minutes or 30 actions, in that turn only. Still asks, even when listed: wording or typed
text that sends, deletes, pays or changes access; pastes; plain-letter key presses; uploads; every page
script; first visits; the action after a role/permission control; and everything on mail, Slack,
Notion, Jira, bank and PayPal sites.

## Measured need

Replay of the live gate over 14 days of this PC's transcripts (scratchpad `ask-analysis.js`): 694 asks,
137 first-visit only. The "~379 remain" figure assumed every ask of a multi-ask turn could be listed —
a loose upper bound, since page scripts, follow-ups, stuck tabs and the wide stop list never waive.
Realistic figure (`realism.js 14`, working copy, lists built from each turn's own real summaries and
typed texts, as if Claude had listed exactly what it then did): 708 → 609 asks (−14%; −17% of
non-first-visit asks); 76 lists, 66 offers made, 25 offer cards skipped for not fitting (mostly
first-visit cards), 99 items let through, 0 with a stop word. Remaining asks by cause: 153 word, 139
first visit, 106 page script, 83 follow-up, 33 high-stakes, 32 stuck tab. Logged on GEN-58 (class P).

## The declaration

Lines of Claude's message, one block per message:

```
Browser task: Add Erez as a recipient of the Process Tracking alert
Site: us-west-2b.online.tableau.com
Step: Opens the Process Tracking alert
Step: Types Erez's email into the recipients box
Step: Saves the alert
Text: "erez@muuula.com"
```

- `Browser task:` 1–200 characters. `Site:` exactly one, a web host by `hostOf()`, not high-stakes.
  `Step:` 1–20, each 1–160 characters, compared ignoring case, extra spaces and one trailing period.
  `Text:` 0–10, each `"..."` on one line — the text is everything between the first and last double
  quote (so inner quotes are allowed), 1–2,000 characters.
- No control/invisible/line-separator characters in any line; a second `Browser task:` line, a
  malformed field line, a limit crossed, or a block inside an unclosed `<!--` rejects the block.
- Read as the PC-control task pass reads its block (windows-mcp-approval.js `priorDeclaration`): the
  last text block holding a valid one, after Erez's previous own message and before the message that
  started this turn, with no browser call after it and no file edit after it in its own turn; only when
  this turn was started by Erez (`origin.kind === "human"`), matched on the hook input `prompt_id`
  ("UUID identifying the user prompt currently being processed", code.claude.com/docs/en/hooks;
  verified this session: a PC-control state file named with the hook's prompt_id matches the
  transcript `promptId` of Erez's "yes" in session 24deb6f4). A block only in the next-step box (a tool
  input) is not read — the refs note says to put it in the message text.
- The transcript's last 32 MB (as the PC pass) is read once per turn, before the state lock is taken: a
  peek at the state file skips the read when this turn is already recorded. Inside the lock an
  existing record for the same turn is never overwritten. A read failure is "no task" (logged as
  `task-read-error`), never a rejected list.
- Listed texts are read by the gate together (`sqlKind` joins them, so a statement split across texts
  is read whole); if they include a delete, an access change or a send out, no listed text is typed
  without a pop-up (Claude is told).

## Offer and activation

- Offered on the first `ask` of the turn whose interactive/script/navigate items are all on `Site:`,
  when at least one listed step has no stop word. The sentence `Allowing also approves Claude's listed
  N-step task here for 10 min.` (N = steps without a stop word) is placed right after the card's first
  sentence (the call's own reason still leads; the sentence reads as the exception to "changes still
  ask"). If that sentence would end past line 3 at 63 characters a line, no offer is made on that card
  (logged `task-offer-skipped`); a later card on the site may carry it.
- One offer per turn. The offered call's pending entry (keyed by `tool_use_id`) carries the turn id; its
  PostToolUse/PostToolUseFailure (docs: PostToolUseFailure "doesn't fire for ... a permission denial";
  PostToolUse runs after success) brings the task into force: `start = now`, `used = 0`. A refused card
  activates nothing; no second offer that turn.
- Allow-listed tools: `navigate` is on the global allow list (settings.json), yet the gate's `ask` on a
  navigate shows a card: the 27 Oct live test's first-visit card on simple.wikipedia.org was a navigate
  ask (browser-gate-asks.jsonl 2026-10-27T17:17:13Z) whose call was answered at 18:43 (transcript
  af1e772b), and Erez reported seeing it (GEN-953 step 2 "Live test"). Re-checked in this build's live test.
- PostToolUse of the activating call tells Claude the rules and to list, in its next For-you block, the
  steps that went ahead without a pop-up. A rejected block is told to Claude once (first PostToolUse of
  the turn), with the reason, and Claude is told to tell Erez in one line; nothing is added to the card.

## What goes ahead under the task (anything else asks as today)

Only a click / key / type / drag / form fill, when: same `prompt_id`; `0 ≤ now − start ≤ 10 min`;
`used < 30`; the tab is known, not stale, on `Site:` exactly; no browser switch earlier in the call;
the site is not high-stakes; every ask cause of the item is `word` and/or `typed-write`; its
`action_summary` matches a listed step; the summary has no stop word; any typed/filled value is a string
equal to a listed text, has no line break, and `sqlKind` finds no delete / access / send-out kind in it;
a key press is only named keys (Return, Tab, Escape, arrows, Home/End, Page Up/Down, Space, F1–F12, with
modifiers) or a letter/digit held with Ctrl/Alt/Cmd, never a paste chord and never Delete/Backspace.
Never waived: `new-site`, `follow-up`, `typed-enter`, `high-stakes`, deny causes, uploads, shortcuts,
every page-script cause. Each waived item counts toward `used` (not on a denied call). A browser
switch ends the task (both before the call runs and after).

**Stop words** (explicit lists in the code, tested): every alternative of `WORDS_EN` except `confirm`
and `save` (a test asserts `STOP_EN` equals `WORDS_EN` minus exactly those two), `WORDS_HE`,
`DANGER_NOUN`, and: drop, truncate, purge, generate, paste, clipboard, clear site data/cache/history,
change/reset password, update credentials, shut down, stop an instance/server/service/job/task,
subscribe, upgrade, downgrade, comment on, billing, invoice, checkout, read and write, editor,
expiration, scope, create … token/key/user/account/credential/invite/link/secret/webhook/integration,
and the visibility words (anyone, everyone, public, private, visibility, restricted, can view/edit/
comment, view-only, viewer, commenter). Deliberately NOT stop words (a listed job's ordinary steps):
turn on/off, toggle, enable, start/trigger a refresh/run/job, create a task/job/project/rule, retry,
run now, commit.

## State, logs and signals

- `state.task = { pid, status: none|invalid|ready|offered|active|ended, site, task, steps, texts,
  textsDropped, error, start, used, told }`, validated in `normalizeState` (anything odd → no task).
- Log lines (no page text): `task-invalid`, `task-read-error`, `task-offer`, `task-offer-skipped`,
  `task-on`; waived items in the existing `pass` sample with `task: true` and the summary's first six words.
- Readers: (1) Claude's For-you block after each task (it is told to list what went ahead). (2) The
  8 Nov check gets one added step: from the install time on, count offers, activations and waived
  actions, list waived summaries for a spot check, and report the non-site ask rate before vs after
  install and with vs without waived actions. Bar it reports against: if after install there are 0
  activations, or waived actions remove fewer than 1 in 10 of non-first-visit asks, the task approval
  is not paying off — say so and propose retiring or reshaping it; any waived summary with a stop word
  is a bug to fix at once.
- Size: `size: C:\Users\Erez\.claude\hooks\refs\browser.md 7,768 → 8,775 / 10,000 characters (hard;
  hook-injected-text)` (config-health-scan.ps1 size-check on `refs-browser.md`). The injector's own cap
  is 9,500 shared with any "not connected" diagnosis on the same call; when both don't fit, the notes
  wait for the next browser call (existing behaviour).

## Verification

- Replay: all past browser calls through live and working copy, no task: 0 decision, state or card-text
  differences (done: 66 files, 3,400 calls, 756 asks, 0/0/0; 0 past transcripts hold a block).
- Unit tests: parser (each rejection), stop words (drift test vs WORDS_EN, each family), keys, typed
  DROP/TRUNCATE/GRANT/DELETE FROM/COPY INTO @/INSERT OVERWRITE under neutral summaries ask, fragment-split
  DROP across texts drops all texts, offer fit, expiry (time, 31st action, other turn, other session),
  partly-waived batch, browser switch, high-stakes site, follow-up, paste, stale tab.
- Integration through the real hook process (stdin JSON, fixture state/log dirs, fixture transcript):
  offer → no Post → nothing waived; offer → Post → listed step passes, unlisted asks; rejected block →
  Claude note.
- Realism: synthetic blocks from each past turn's own real summaries → realistic waived count, and 0
  waived items with a stop word.
- Live (with Erez): a short listed task on a harmless site: the offer card shows the sentence in view;
  allowing it lets listed steps through; an unlisted step asks; a refused offer (second run) lets nothing
  through.

## Unchanged

Every decision when no valid block exists; the gate never returns "allow"; any error asks.

## Accepted residuals (to state to Erez)

- A listed step is matched on Claude's own wording; a click described as a listed step but landing on
  something else goes through (bounded: one site, one turn, 10 min, 30 actions, stop words).
- The card shows only the step count; Erez relies on the list in the "Ready?" message he just answered.
- Milder database changes in typed text (update rows, replace code, run a routine) go through when
  listed — as the approved plan allows; the plan's "Deletes, sends, payments and access changes always
  ask" is enforced by wording and the gate's reading of typed text, not by knowing what a click does.
- Long multi-line texts and page scripts cannot be listed; they still ask.
- Gain needs Claude to stop and list the job first; adaptive look-only work gets nothing unless listed;
  exact wording will sometimes miss and simply ask.
- A program running as Erez could edit the state file or transcript (same accepted risk as today).
