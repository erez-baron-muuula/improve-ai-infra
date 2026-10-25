# Fewer, clearer approval pop-ups — proposal

## In plain words (for Erez)

**What's wrong today.** Most of your pop-ups come from Claude using your browser, and from approving plans. On 25 Oct the browser check asked you 48 times; 33 of them were in one Snowflake (game-data) session. Of the 22 we matched to what Claude was doing, 10 were harmless (closing a window, opening a menu, running a look-only query). The ones that mattered were in jargon ("USE ROLE ACCOUNTADMIN", "CREATE OR REPLACE"). Plans you approve open with technical detail. A built-in "too many pop-ups" alarm went off that day, but nobody told you.

**What changes for you, in 5 steps:**
1. **[Revised 2026-10-25 after Erez's question: the count is dropped — the scheduled 8 Nov GEN-924 check already measures the browser rate; a one-time before/after uses an existing script. Kept: the small fixes below.]** **A count you can see.** At the end of each session you get one line: how many pop-ups you clicked, and the main reasons. If the browser asks too often, it says so. We also fix a few small leaks: some tools you already allowed still ask; a setting may not be working; and we test whether "bypass mode" quietly switches off the browser safety check. *(effort: medium)*
2. **Plans start in plain words.** Every plan you're asked to approve opens with a short box: what changes for you, who is affected, whether it can be undone, what you need to do, and Claude's recommendation. A plan without it is sent back to Claude before you ever see it. *(effort: high)*
3. **Browser pop-ups say what's at stake.** The pop-up itself says, in business words, what kind of change it is, on which site, and whether it can be undone. For example: "This changes live game data in Snowflake. It may not be undoable." The browser check writes this from what it sees itself, not from Claude's description. *(effort: xhigh)*
4. **One approval per task in the browser.** Similar to "Allow for this task" in PC control. Before a multi-step job, Claude lists the steps it will take, in plain words, and asks "Ready?". The first pop-up of the job shows that list; approving it approves the list. Steps on the list then go ahead without asking. Anything not on the list is handled exactly as today (looking around goes ahead, anything else asks). Deletes, sends, payments and access changes always ask, even if listed. *(effort: xhigh)*
5. **(Optional, decided separately) A look-only Snowflake login for Claude.** Claude would get its own login that can only read data, never change it, so look-only queries need no browser and no pop-up. Changes would still go through you. This removes about 1 in 5 of that session's pop-ups. Its main value is safety: today Claude works in Snowflake as you, with full admin power. It needs a one-time admin setup that Claude prepares and you approve. *(effort: xhigh)*

**What stays the same.** Every send, delete, payment and access change still asks you on its own. A data change asks either on its own, or as a listed item in a task you approved (step 4). Nothing gets a blank check.

**Order.** Steps 1–3 first. Step 4 is built only after step 1's count has run for a couple of weeks and shows multi-step browser jobs still cause many pop-ups; if not, it is skipped.

**Existing tickets folded in.** GEN-924 (the browser check — this is its follow-up), GEN-873 (only the "plans you approve" part), GEN-624 (the setting that may not be working), GEN-920 (PC-control Allow button — looks already fixed; confirm and close), GEN-931 (the app's built-in browser panel isn't covered by the safety check — switch it off if possible, else cover it). Four new tickets: the count, allowed tools that still ask, the browser cards + task approval, and the Snowflake login. Left out on purpose: tickets about questions asked in chat rather than pop-ups (GEN-841, GEN-558, GEN-77), and the auto-mode refusal tickets (GEN-349, GEN-423) unless step 1 shows bypass mode drops the safety check.

**Effort to build.** Overall xhigh: steps 3–5 change safety checks and need the full review process; step 1 is medium and step 2 high.

**What you'll need to do.** Approve the plan (steps 1–3 now, step 4 only if the count shows it's needed); later, approve the one-time Snowflake setup if you choose step 5; after a few working sessions, tell us whether the pop-ups are clearer.

**What this won't fix.** Inside a task you approved, if Claude labels a click with the wording of a listed step when it is really doing something else, it can still go through (step 4). That's why the approval covers one site, one job, at most 10 minutes. The pop-ups for shell commands stay technical; they look rare (most are approved automatically), and step 1's count will confirm it — if not, we revisit them. Decide-in-chat questions (not pop-ups) are handled by other tickets.

---

## Technical detail

### Evidence (provenance)
- `~/.claude/hooks/browser-gate-asks.jsonl`: 48 "ask" events dated 2026-10-25 UTC as of 17:03 UTC (node tally this session); 33 in session 3df07a58 (Memory Islands, Snowflake). Matched to action text (transcript of that session): harmless-looking examples "Closes the Account Details dialog", "Opens the create (+) menu", "Runs the read-only status query" (x3); important ones "Runs USE ROLE ACCOUNTADMIN", "Runs CREATE OR REPLACE of the reviewed routine", page-script causes (risky-script / helper / typed-write, separate from "word"). Read-only query runs ≈ 6 of ~28 Snowflake asks; most were the routine change.
- Over-bar alarm: `browser-site-gate.js:683-688, 867-878` — fires once per session, only as context to Claude; fired 15:49:36 UTC (line 51 of the log); not relayed.
- 7-day transcript counts (history sub-agent, `permissionDecision.source` = user_temporary): ~96 Allow / 5 Reject; ExitPlanMode 22 (second largest); some allow-listed tools still prompted (list_scheduled_tasks, tabs_context_mcp, list_task_runs, get_settings, list_events) — sub-agent figure, re-verify in Step 1.
- `settings.json:577` `defaultMode` at top level; docs name `permissions.defaultMode` (soundness reviewer, code.claude.com/docs/en/settings) — GEN-624 real.
- Hook "ask" reason text is shown in the prompt (code.claude.com/docs/en/hooks).
- Text written just before a tool call is often stored as a reworded one-line note on 5.5 models; closing text is kept verbatim (`windows-mcp-approval.js:39-44`; Improving PC Processes HISTORY 80, 97; GEN-873).
- Snowflake access today: Snowsight as Erez (Memory Islands HISTORY:472); no snow/snowsql CLI (Get-Command); Python 3.13 present; a key-pair Tableau reader login exists (Memory Islands HISTORY:470).
- Outside practice: approval fatigue 93% accept (anthropic.com/engineering/claude-code-auto-mode); click-through and habituation (Akhawe & Felt USENIX Sec'13; Bravo-Lillo SOUPS'14); plain language + clear default helps (Felt et al., research.google); ask only for irreversible/other-affecting actions (Felt HotSec'12); least-privileged read-only role for agent SQL (docs.snowflake.com cortex-agents-mcp); plan-once approval (Magentic-UI; Claude Code plan mode).

### Step 1 — Count + plumbing (medium)
- Read-only counter over transcripts: clicks = `permissionDecision.source == user_temporary`, plus rejects; per session and per tool; plan approvals shown separately. Gate log used only for the browser cause breakdown (not added to the total — avoids double count). Browser measure = GEN-924's own: non-first-visit asks per 10 browser actions; bar ≤ 1. Fixed thresholds only (no week-over-week).
- PC-control: add one "window shown" log line in `windows-mcp-approval.js` (with Step 3/4 hook work, via /vet-code) so its pop-ups are countable; until then the line says PC windows are not counted.
- Surfacing: one line in the `/wrap` report (existing routine) with the count, causes, and an over-bar flag. Mid-session alarm stays as is (Claude relays); residual: an un-wrapped session's line is missed until the next wrap, which reads all sessions since the last report.
- New defect ticket (not GEN-222, whose premise was disproven, HISTORY:2749-2758): allow-listed tools still prompting; first check the `mcp__Claude_in_Chrome__*` vs `mcp__claude-in-chrome__*` spelling gap in the allow list.
- GEN-624: move `defaultMode` under `permissions` per docs (update-config.ps1), re-verify effective mode.
- Live test: does a hook "ask" show under bypassPermissions? If not → put to Erez as a decision: warn whenever bypass is on, and/or raise GEN-349/GEN-423 (classifier refusals that push him into bypass).
- GEN-920: header `windows-mcp-approval.js:7-8` says the fix is in; confirm with one live screenshot, propose closing.

### Step 2 — Plain-language plan box (high)
Extend `~/.claude/hooks/pretooluse-effort-tag-gate.js` (already inspects plan approvals, GEN-619, HISTORY:581) to refuse ExitPlanMode once when the plan file does not open with a "In plain words" section (what changes for you / who is affected / can it be undone / what you must do / recommendation). Via /vet-code. Covers GEN-873's plan surface (with GEN-694 folded there).

### Step 3 — Plain browser cards (xhigh)
Rewrite the gate's `ASK_TEXT` per cause so the card states, from what the gate itself reads: change category, site, undo status, and a plain caution ("only allow if this matches what Claude told you it would do"). For typed-write / scripts, the gate classifies the actual typed SQL/script (e.g. CREATE OR REPLACE → "replaces live code in Snowflake"). Claude's one-line summary is shown last, labelled unverified. No mid-turn announce-first bounce (that failed in GEN-908).

### Step 4 — Browser "Allow for this task" (xhigh)
- Declaration: taken from Claude's closing "Ready?" message (GEN-908 pattern), a "Browser task:" block listing the site and each change step in plain words, plus the exact SQL/script texts to be typed.
- Approval: the native prompt is yes/no only, so the first ask of the turn shows the declared task on the card; once that call has run (detected after the call), the pass is active for that turn on that site (limits: same turn, ≤10 min, ≤30 actions).
- Under the pass: typed text and scripts run only if they match a declared text exactly; a click runs only if it is on the declared site and its action summary is exactly one declared step line (punctuation aside — nothing added). A declared step still asks if the gate's existing danger check finds a delete / send / pay / share / grant / access-change meaning (the access and send/delete/pay families of `wordHit`, `browser-site-gate.js:96-112`). Everything undeclared follows today's rules unchanged (plain-look whitelist, `browser-site-gate.js:17-22`).
- Accepted residual (to state to Erez): Claude could attach a declared step's wording to a different click; the pass is narrow to bound this (one site, one turn, ≤10 min, ≤30 actions, declared texts matched exactly).

### Step 5 (optional, separate decision) — Snowflake read-only lane (xhigh)
Own Claude login (programmatic access token — single line, fits Credential Manager via set-claude-key.ps1; key-pair rejected: multi-line, `Assert-KeyShape` line 71), read-only role incl. the SNOWFLAKE database roles needed for ACCOUNT_USAGE, no procedure/task execution, own XS warehouse with a resource monitor and statement timeout, a network policy for the login (required for tokens on service logins, docs.snowflake.com/en/user-guide/programmatic-access-tokens), small query script. Confirm the token is single-line when first stored. Live-test in auto mode that the classifier lets the script run. Filed under the Memory Islands epic. Expected cut: ~20% of a Snowflake-change session's asks; all of a look-only session's.

### Tickets
Bundled: GEN-924 (follow-up), GEN-873 (plan surface only), GEN-624, GEN-920 (confirm/close), GEN-931 (built-in browser pane: after Step 4, turn the pane off if the app has a setting — verify — else extend the gate). New: pop-up counter, allow-listed-tools-still-prompt defect, browser card + task pass, Snowflake read-only lane (Memory Islands epic). Conditional: GEN-349/GEN-423 if bypass drops asks. Not bundled: GEN-841/558/77 (chat asks, not pop-ups), GEN-829 (adds a needed ask), GEN-222 (reader-side issue only).

### Alternatives rejected
- Trusted-sites list (skip first-visit ask): saves ~5 asks/day, removes the only human check on admin consoles (Snowflake, Play Console, Tableau); first-visit card is already plain.
- Loosen the harmless list again: measured and rejected twice in GEN-924.
- Auto-mode reviewer model for browser: blocks rather than asks, misses ~17% of overeager actions (Anthropic), nothing in bypass. Strongest case for it: no custom code.
- Sandbox: shell only, not native Windows.

### Review
Converged after 3 rounds of an independent 3-reviewer panel (failure-hunt, proportionality, fact-check). Open non-blocking note for the build: name exactly which danger words count as send/delete/pay (e.g. publish, transfer, revoke) when Step 4 goes through /vet-code.

### Verification
Counter before/after over ≥5 real browser sessions (bar ≤1 non-first-visit ask per 10 actions); live: plan without plain box is refused once; a Snowflake change card shows category + undo status; task pass lets declared steps through and asks on an undeclared one; (Step 5) a look-only query runs with no pop-up in auto mode; bypass test result recorded; Erez judges clarity.
