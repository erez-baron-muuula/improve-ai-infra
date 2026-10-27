# GEN-953 step 2 — browser pop-ups say what is at stake (design)

## Goal
Erez, 2026-10-25: "I keep getting approval pop ups that looks trivial, and I approve them and think maybe there weren't supposed to happen. Also, some approval I approve without reading too deeply since it's too technical for me".
Approved plan (2026-10-26, `~/.claude/plans/suggest-what-next-on-hazy-pillow.md`): the browser pop-up says, in business words, what kind of change it is, on which site, "undo not guaranteed" (never a reassurance), a caution, and Claude's own summary last, marked as Claude's. Same number of pop-ups: wording only, no decision change.

## What Erez sees (probe, 2026-10-26, two screenshots from Erez)
The desktop pop-up: title "Allow Claude to use Computer (claude-in-chrome)?", then the hook's `permissionDecisionReason` in grey **at the top, in full** (a ~160-character reason wrapped onto 3 lines, nothing cut), then a details box with Claude's raw request (a field table for one action; for a batch, raw JSON in a scroll box, opened scrolled to the bottom). Docs agree: PreToolUse `permissionDecisionReason` "For `"ask"`, shown to the user in the permission prompt" (code.claude.com/docs/en/hooks). So the reason line is the one place to put plain words, and it should stay short.

## Change (`~/.claude/hooks/browser-site-gate.js`, working copy `wc/`, built by `build.js` from the live file + `plain-reason.js`)
1. `decide()` additionally collects, for the pop-up only: the text of each javascript_tool item that asked and each typed text that hit `typed-write` (capped at 20,000 characters), Claude's `action_summary` of each interaction that asked beyond a new-site ask (80 characters), and that interaction's site. Carried on the result as `texts`, `claims`, `where`. Not saved to state, not logged. No existing line of decision logic changes.
2. New `plainReason(res)`; `reasonFor` tries it and falls back to the old text (`legacyReasonFor`) on any error. The ask is already decided and logged before the text is built (handlePre), and a throw there still answers "ask" (main's catch), so text code cannot turn an ask into a pass.
3. Wording, in order: what kind of change → site (if not already named) → `Claude says: "…"` (up to 6 summaries) → for a change: "Undo is not guaranteed. Allow only if this matches what Claude told you it would do." → "(browser safety check)".
   - typed-write: "Typing / The script runs a database command that …", worst kind first: deletes data or database objects; replaces or changes live tables, views or code; changes who has access; calls a stored routine or system function, which can change anything; adds or changes data; creates a new database object; else "the check cannot confirm only reads data". Read with comments and SQL string values set aside; in a script only quoted texts are read (JavaScript has its own delete/update).
   - risky-script: "A page script that …" up to two of: sends data from the page to a server; clicks, submits or presses things; moves the page to another address; changes the site's data saved on this computer; changes what is on the page or in a form; runs code that is hidden or hard to read; else today's "can change the page or send data".
   - word: "This may …" from the danger Claude's own summary names (delete/remove; spend money or change a plan; send, post or publish; share or change who can see it; change who has access; upload a file; accept, confirm or approve); else "The check cannot confirm this only looks at the page." (dropped when a more specific reason is on the same pop-up).
   - high-stakes: "<site> is a sensitive site (mail, chat, payments or tickets), so every click and keystroke there asks." Now with Claude's summary (today it shows none).
   - new-site, follow-up, script-helper, helper-args, typed-enter: same meaning, plainer words. Other causes keep today's text, with "gate" → "check".

## Round-1 revisions (design /check)
- Pre-mortem (material, fixed): `sqlKind` now reads the command four ways — comments stripped then string values blanked, and string values blanked then comments stripped, each with standard and backslash-escaped quoting — and shows the worst kind, so a `--`, `/*` or `\'` inside a string value cannot hide a later DROP (tests: `insert into t values ('--'); drop table t; select '--'`, the `/*` variant, `('a--b')`, `('a\'b')`, a quote inside a comment).
- Pre-mortem (material, fixed): a script or typed text longer than the 20,000 characters read is marked `cut`; the pop-up then says "a database command that is too long for the check to read in full, so it can change anything" (never a milder kind) and, for a script, "…, and more the check could not read".
- Holistic advisories adopted: a plain click with no danger word leads with Claude's own words ("Claude says: "Selects the account". The check cannot confirm this only looks at the page."); a summary that calls itself read-only gets no danger label from its other words; "helper" → "code an earlier script left on the page"; "stored routine or system function" → "saved database program".
- Soundness advisories adopted: unclassified actions (no-state, non-web-tab, unreadable batch/url, non-web url, unknown tool, deny-loop asks) also get "Undo is not guaranteed" and the caution; jQuery `$.ajax/post/get` counts as sending data.
- Now 84 tests; replay unchanged at 0 decision / 0 state differences.

## Samples (real replay)
- Snowflake typed routine: "Typing a database command that replaces or changes live tables, views or code. Site: app.snowflake.com. Claude says: "Types the reviewed routine". Undo is not guaranteed. Allow only if this matches what Claude told you it would do. (browser safety check)"
- Today for the same: "This action may change, send, delete, pay, share or grant something: "…". Typing a database command that changes or deletes data. (browser gate, GEN-924)"
- Plain select of an account: "The check cannot confirm this only looks at the page. Site: play.google.com. Claude says: "Selects the Muuula developer account". Undo is not guaranteed. …"

## Evidence
- Replay of every real browser call in `~/.claude/projects` (61 sessions, 3,232 calls, 702 asks, 213 denies), live vs working copy in-process, step by step: 0 decision differences, 0 state differences, 0 text errors (`replay.js`, `cards.txt`).
- Pop-up text length over those 702 asks: median 227, 90th percentile 331, max 666 characters (today: 141 / 275 / 1,772).
- 72 tests (`tests.js`): every label, worst-first, comments, string values, `USE ROLE` not a change, JS `delete` not SQL, caps, hostile input under 500 ms, state holds no texts, and 5 end-to-end runs of the real hook process live vs working copy (same decision, exit code and log lines).

## Not doing
- No change to when a pop-up appears (step 3, after the 8 Nov count).
- No site-name dictionary (hosts are shown as is).
- The details box under the reason (Claude's raw request) is drawn by the app, not the hook; it stays.

## Residual
- For ordinary clicks the kind comes from Claude's own summary, so a misleading summary gives a misleading label (marked "Claude says"; same trust as today).
- Labels are pattern-based; an unlisted pattern falls back to today's generic wording.
