# GEN-953 step 2, rework: pop-up wording that can never read milder than today (design v2.1)

Revision of `design-v2.md` after its design review (round 1: three independent reviewers, all REVISE). Changes are listed under "Round-1 revisions" at the end.

## In plain words (for Erez)

**What you'll see.** Every browser pop-up for a change opens with **today's warning sentence for that kind of action, unchanged in meaning** (for a click: "This may change, send, delete, pay, share or grant something."; for typed database commands: "…a database command that changes or deletes data."). After it, the check may **add** a sharper warning it found itself by reading the typed command or page script, such as "Among other things, the check sees that it deletes tables, rows or other database objects" or "…that it changes who has access". It never adds anything milder, and it never repeats Claude's description back as if the check had confirmed it. A case the check misses therefore only loses the extra warning; the pop-up is never milder than today.

**Layout, most important first:** the warning, the site, one line "Undo is not guaranteed; allow only if Claude told you in the chat it would do this.", and **Claude's own description last**, labelled "not checked".

**What this does not fix yet.** Claude's own description (the last part) stays as technical as Claude writes it, e.g. "Runs USE ROLE ACCOUNTADMIN". On a third to nearly half of pop-ups (clicks) that description is the only part naming the specific action, so expect those to stay partly technical until the next step. Making Claude write those in plain business words is a separate step, because the same descriptions drive when a pop-up appears and need their own testing; I'd file it as its own ticket.

**Unchanged:** when a pop-up appears (same number of pop-ups).

**Effort:** xhigh. About 1.5 hours including both code reviews, then your install approval and a short live test.

---

## Technical detail

### Goal and the guarantee
Goal (Erez, 2026-10-25): pop-ups must not look trivial when they are not, and must not be too technical. Erez, 2026-10-26: "I tend to say rework, unless you think there's a better alternative we are missing. search for best practices for this topic in official and unofficial sites, take into account all that we have tried working on this topic, and in general in our project, and come up with the best solution possible once it has converged."

**Guarantee:** for every ask, each change cause's opening sentence carries at least today's danger meaning (table below, checked against live `~/.claude/hooks/browser-site-gate.js:479-498`), and additions are drawn only from a closed list of *severe* kinds, each prefixed "Among other things". So no part of the card can read milder than today's sentence, whatever the pattern lists miss.

### Opening sentences (committed table; tests assert these exactly)
| Cause | Today (live :479-498) | v2.1 opening sentence |
|---|---|---|
| word (every word ask) | "This action may change, send, delete, pay, share or grant something: …" | "This may change, send, delete, pay, share or grant something." |
| typed-write | "Typing a database command that changes or deletes data." | "{Typing / The script runs / Typing or a page script runs} a database command that changes or deletes data." |
| helper-args | "A page script passes a helper something other than a read-only query." | "A page script hands code an earlier script left on the page something other than a look-only query, which can change or delete data or send it." |
| risky-script | "A page script that can change the page or send data." | same |
| script-helper | "A page script that calls a helper an earlier script set up, which can change the page or send data." | "A page script reuses code an earlier script left on the page, which can change the page or send data." + today's "approving lets later calls go ahead…" meaning |
| high-stakes | "High-stakes site (h): every click, key and form fill asks." | "h is a high-stakes site, so every click, key and form fill there asks." |
| follow-up, typed-enter, uploads, unclassified, deny-loop | today's text | today's meaning, "gate" → "check" (as v1) |
| new-site | "First action on h this session. Approving lets Claude open, look around and search there…; anything that may change, send or delete something still asks." | alone: as v1. With any change cause on the same card: "It is also Claude's first action on h this session; if you allow it, Claude can look around there without asking again." (no "anything that may change… still asks", so it cannot read as "this one is not a change") |

### Additions (closed list, severe kinds only)
- Format: "Among other things, the check sees that it …" + every matched severe kind, worst first.
- From typed text and script strings (SQL, read as v1 does: comments stripped before and after blanking quoted values, both with and without backslash escapes, plus a comments-kept read; `wc\browser-site-gate.js` `sqlKind`): deletes tables, rows or other database objects (DROP / TRUNCATE / DELETE / REMOVE @ / **INSERT OVERWRITE** / **MERGE … THEN DELETE**); changes who has access; copies data to or from storage outside the database; replaces or changes live tables, views or code; runs a saved database program, which can change anything.
- From page scripts (v1 `SCRIPT_KINDS`, worst first): runs code that is hidden or hard to read; **sends data from the page to a server**; clicks, submits or presses things; opens another address, which can carry page data there; changes the site's data saved on this computer.
- COPY keeps v1's consequence: "copies data to or from storage outside the database, which can send data out".
- **Never shown:** mild kinds ("adds or changes data", "creates a new database object", "changes what is on the page or in a form"), and anything derived from Claude's description (v1's `WORD_KINDS` labels are removed).
- Cut or unreadable text (over 20,000 characters, or a quoted value that never closes): "The check could not read all of it."

### Claude's words (last, "not checked")
- Card ends with "Claude says (not checked): '…'; '…'". Nothing from the check follows it; a count of hidden ones goes inside the label ("Claude says (not checked; 2 more not shown): …").
- Summaries that hit the decision's own danger lists (`wordHit`, computed in `decide()` on the full summary, in memory only) are always shown; plain ones fill up to 6. Each is cut at 100 characters with "…".
- Whitespace collapsed (covers U+2028/U+2029); `\p{Cc}` and `\p{Cf}` removed (text-direction overrides; Node 22.16 check: U+202E and U+200F match `\p{Cf}`); quote marks and look-alikes mapped to `'` (v1's list plus `\p{Quotation_Mark}`). The defence that matters is position plus label; the mapping is a convenience.
- Helper names (chosen by Claude's scripts) are no longer shown in the check's sentences.

### Order
"Browser safety check:" → change sentences, worst cause first, each followed by its additions → new-site sentence → "Site: …" (sites not already named) → "Undo is not guaranteed; allow only if Claude told you in the chat it would do this." (any change cause) → Claude's words.

### Unchanged from v1
Built after the decision is made and logged; any error falls back to today's text; nothing new saved or logged; `TEXT_CAP` 20,000; no decision change.

### Tests
1. The opening-sentence table above, asserted exactly per cause.
2. Oracle test: generated typed texts and scripts that hide a dangerous statement (DELETE, DROP, TRUNCATE, INSERT OVERWRITE, GRANT, MERGE…DELETE) behind each trick — apostrophe in a `--` or `/* */` comment, `$$…$$`, `"…"`, backtick name, a split across two script strings, `\'` escapes, the 20,000-character cap — next to a harmless labelled statement (only inputs the unchanged decision still asks on). Assert, per cause the decision fired: that cause's table sentence is present; every addition starts "Among other things"; the check's sentences all come before "Claude says"; and every sentence the check speaks passes the allow-list check in 3; record (not assert) whether the severe label also appears, as an accuracy figure. Script case: a script that both sends data and navigates; assert "sends data from the page to a server" is named before "opens another address".
3. Replay over all real calls (3,232 calls, 702 asks as of v1's run): 0 decision and 0 state differences; **allow-list check:** every sentence before "Claude says (not checked)" is either a row of the opening-sentence table, an "Among other things…" line built only from the closed severe list, the site line, the caution line or "could not read all of it" — so any new mild phrase added while coding fails the test; every word card contains the word opening sentence; card length median / 90th percentile / max reported against today (141 / 275 / 1,772, design.md) and v1 (227 / 331 / 666).
4. Named cases from the reviews: `$$it's$$`, `"it's"`, backtick, cross-string apostrophe, `\'`, comment apostrophes, REPLACE INTO, INSERT OVERWRITE, MERGE…DELETE, U+202E in a summary, "Runs CREATE OR REPLACE of the reviewed routine" click, "Confirms suspending the qa@muuula.com account", "Runs the approved supervised CALL".
5. Existing tests updated; both code-review passes; secret scan; pass-consumption fixture; live test with Erez on a Snowflake change card, a page-script card and one long **word** card (display of reasons longer than ~160 characters is unverified: code.claude.com/docs/en/hooks gives no limit; the changelog only notes a wrapping fix for emoji in reason text). Pass bar: Claude's words on the long word card are visible in full. If they are cut, word cards move Claude's words before the caution line (on word cards they are the only part naming the action) and the live test is repeated; that change also updates "nothing from the check follows Claude's words" and the replay allow-list rule together, through the same review.

### Alternatives considered
- **Fixed sentences only (no additions).** Cannot understate, no pattern code. Strongest case: simplest, and the "never milder" guarantee holds trivially. Not chosen: the approved plan's headline is naming the sharp cases ("replaces live code"), and NN/g and Microsoft both say to be specific about the consequence; with additions limited to severe kinds, a miss costs only the extra line. This remains the fallback if v2.1 fails code review.
- **Specific labels from Claude's description** (v1, v2): removed. On real replay cards they labelled "Confirms suspending the qa@muuula.com account" and "Runs the approved supervised CALL…" as "accept, confirm or approve something" (`cards.txt` 1158, 1708) — the check repeating Claude's words in its own voice.
- **A real SQL parser package.** The hooks use only Node built-ins (grep of `require(` across `~/.claude/hooks/*.js`); a Snowflake-dialect parser is a large third-party package inside a safety hook, for accuracy of an extra line only.
- **An AI-written explanation.** Page text or SQL comments could talk it into a reassuring line (approval-text misrepresentation, arXiv 2609.21081); delay and cost; Anthropic's auto-mode classifier misses 17% of overeager actions (anthropic.com/engineering/claude-code-auto-mode).
- **Danger marker (emoji).** An unmarked miss then looks safe by contrast; rendering unverified.
- **Raw command in the reason line.** The app's details box already shows it; jargon.
- **Carry the typed command's kind to the following "Run" click** (so the click that runs CREATE OR REPLACE also says "replaces live code"). Useful, but it stores state across calls; proposed for the later per-task approval step.

### Follow-ups (filed after approval)
- **Plain-business action descriptions from Claude** (new ticket): Claude's `action_summary` wording drives both the pop-up's last part and when the check asks, so changing it needs its own replay and vetting.
- Step 4 (look-only Snowflake login, GEN-953's numbering; "step 5" in the approved plan file) remains Erez's separate decision; it removes most risky typed-SQL pop-ups at the source (least privilege, OWASP LLM06:2025).

### Sources
Microsoft warning messages (learn.microsoft.com/en-us/windows/win32/uxguide/mess-warn, "Be specific": when unsure, "use wording that indicates that there are other possibilities. Otherwise, users might be misled"; "Avoid overwarning"); NN/g confirmation dialogs (nngroup.com/articles/confirmation-dialog: be specific, don't cry wolf); Anthropic auto-mode post (93% of prompts accepted; approval fatigue; 17% false negatives); Loopjacking, arXiv 2609.21081 (what is shown must be what runs). Habituation studies (Anderson et al., JMIS 33(3) 2016; Vance et al., MISQ 2018) concern warnings whose look varies; cited only for "repeated identical warnings get ignored", not as support for wording.

### Size
size: skipped (no limit in `notes/anthropic-guidelines.json` applies to a hook source file or its ask text).

### Residual
- Claude's own description stays technical until the follow-up; on about 45% of pop-ups (word asks, `cards.txt` count) it is the only action-specific part.
- The "Run" click after a typed command gets only the general click sentence (follow-up above).
- Severe-kind lists still miss cases; a miss now only drops the extra line.
- Long-card display unverified until the live test; the check's words come first so any cut falls on Claude's words.
- Text only: frequency is step 3's job.

### Round-1 revisions (design review 2026-10-26, three Opus reviewers)
1. All three: v2's softer click sentence ("The check cannot confirm this only looks at the page") was milder than today on commit clicks ("Clicks Apply", "Runs CREATE OR REPLACE …"). → Every word ask now opens with today's sentence.
2. Holistic + pre-mortem: labels from Claude's description spoke in the check's voice and were often wrong-and-mild on real cards. → Removed.
3. All three: specific SQL labels could narrow the warning ("adds or changes data" for a hidden DROP or INSERT OVERWRITE), and the "other commands it cannot name" net was itself a fixed list. → Additions limited to a closed list of severe kinds, prefixed "Among other things"; mild kinds never shown; the "other commands" net dropped; INSERT OVERWRITE and MERGE…DELETE added to "deletes"; v1's multi-way SQL reading kept (handles comment apostrophes and `\'`).
4. Pre-mortem: the floor-presence test was true by construction. → Exact opening-sentence table, oracle test with hidden dangerous statements, replay check that no mild or description-derived label appears.
5. Holistic: jargon in Claude's own descriptions unaddressed. → Stated plainly to Erez; follow-up ticket proposed.
7. Round 2 (pre-mortem, NEW-FROM-REVISION): dropping "sends data" from the script additions left a payments-site sending script described only as "moves the page" (`cards.txt` 133-223). → "sends data from the page to a server" restored right after hidden code; "moves" reworded "opens another address, which can carry page data there"; script oracle case added. Round-2 advisories adopted: allow-list sentence check in the replay; COPY consequence restored; long live-test card is a word card, with a fallback order; first-visit clause kept; high-stakes keeps "form fill"; scale of the remaining jargon stated in plain words. Accepted knowingly: the comments-kept SQL read can add a severe line for a statement that sits only in a comment (an extra warning, the safe direction).
9. Round 3 (pre-mortem, PASS; finding 5 RESOLVED). Converged: round 1 three REVISE; round 2 holistic PASS, soundness PASS, pre-mortem one NEW-FROM-REVISION; round 3 pre-mortem PASS. Advisories adopted: plain-words example uses the closed-list wording; the long-card fallback updates its two dependent rules together. Noted, not changed: "opens another address" and the saved-data kind can over- or under-describe (history moves, clipboard, background helpers); both sit after an opening sentence that already says "can change the page or send data".
8. Round 2 (soundness, PASS) advisories adopted: high-stakes keeps "high-stakes" and drops the site-type list; oracle asserts per cause against the table and excludes inputs the unchanged decision misses; long-card pass bar; "a third to nearly half" (247-311 of 702 word cards, `cards.txt`).
6. Advisories adopted: today's verb form kept ("changes or deletes"); script-helper row added; helper names out of the check's sentences; nothing after Claude's words; 100-character quotes; new-site sentence shortened when a change cause is present; caution line shortened and pointed at "in the chat"; length stats vs today and v1; citation corrected (JMIS 2016) and habituation no longer used to justify wording; effort re-estimated.
