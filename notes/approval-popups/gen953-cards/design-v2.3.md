# GEN-953 step 2, v2.3: short pop-up wording, ordered so the decisive facts are in view

Revision of `design-v2.2.md` after its design review (round 1: three Opus reviewers, all REVISE). Same meaning and guarantee as installed v2.1 (`design-v2.1.md`: opening sentence per cause at least as strong as the pre-GEN-953 text, additions only from a closed list of serious kinds, Claude's words marked "not checked"), with shorter wording and a new order.

## In plain words (for Erez)

**Why.** Your screenshot (2026-10-26) showed the explanation box shows about 3 lines (63 characters on line 1); the rest is in a small scroll area. v2.1's pop-ups were mostly longer than that.

**What you'll see, most important first:**
1. What kind of action it is, and any sharper warning the check found ("Typing a database command that changes or deletes data. Among other things, it replaces or changes live code or tables."). If the check cannot confirm which page the tab is on, that comes first.
2. Claude's own description, marked "not checked", whenever there is one (on a click it is the only part naming what the click does).
3. The site.
4. Any other reason, then "Undo not guaranteed; allow only if expected."

Real examples:
- Click: "May change, send, delete, pay, share or grant something. Claude says (not checked): "Puts the cursor in the Wikipedia search box". Site: en.wikipedia.org. Undo not guaranteed; allow only if expected."
- Click right after a permission control: "Right after a role, permission, owner or billing control on github.com; often the action that applies it. Claude says (not checked): "Opens the Contents access menu". Undo not guaranteed; allow only if expected."
- Page script on a payments site: "A page script that can change the page or send data. Among other things, it sends data to a server and opens another address, which can carry data. Site: payments.google.com. Undo not guaranteed; allow only if expected."

**What fits (all 720 real pop-ups, word-wrapped at 63 characters a line):** on every pop-up that carries Claude's description (360), its first 20 characters are within 3 lines (by line 2 on 74%); the site within 3 lines on 98% of the 709 that name one (by line 2 on 43%); the undo note within 3 lines on 68% of change pop-ups (it comes last, so on longer cards it is the part in the scroll area). The opening sentence is always visible.

**Given up:** the "Browser safety check:" opening (the pop-up title, "Allow Claude to use Computer (claude-in-chrome)?", names the tool, not the check; Claude's words stay labelled "Claude says (not checked)", so the unlabelled sentences are the check's). Claude's description is cut at 80 characters (as before GEN-953).

**Also fixed (found in review):** the installed version's first-visit pop-up left out that allowing it lets Claude **search** there without asking; restored.

---

## Technical detail

### Order (plainReason)
Groups per cause (sentence + its "Among other things" and "could not read" lines), worst cause first (stuck-tab causes, typed-write, helper-args, risky-script, script-helper, high-stakes, follow-up, word, typed-enter, others; new-site last). Card = first group → Claude's part (whenever the card has one) → "Site: …" (every site except one the first group names, including first-visit sites on change cards; "Site (last seen): …" when a stuck-tab cause is present) → remaining groups → "Undo not guaranteed; allow only if expected." (any change cause). Duplicate sentences are shown once.

### Wording (pre-GEN-953 floor in `live-baseline.js` `ASK_TEXT` :479-498)
| Cause | v2.3 |
|---|---|
| word | "May change, send, delete, pay, share or grant something." |
| typed-write | "{Typing / A page script runs / Typing or a page script runs} a database command that changes or deletes data." |
| helper-args | "A page script runs more than a lookup through code left on the page; it can change, delete or send data." — left out only when typed-write is on the card and no typed text is (its sentence then reads "A page script runs a database command that changes or deletes data"). |
| risky-script | "A page script that can change the page or send data." |
| script-helper | "A page script reuses code left on the page; it can change the page or send data." + "If allowed, later uses of it go ahead unless the check flags them." |
| high-stakes | "High-stakes site (h): every click, key and form fill asks." |
| follow-up | "Right after a role, permission, owner or billing control on h; often the action that applies it." |
| new-site alone | "First action on h this session. If allowed, Claude can look around and search there without asking; changes, sends and deletes still ask." |
| new-site with a change | "Also the first action on h this session; if allowed, Claude can look around and search there without asking." |
| others | pre-GEN-953 text, "gate" → "check" |
| caution | "Undo not guaranteed; allow only if expected." |
| additions | "Among other things, it …" from: SQL "deletes data or database objects", "changes who has access", "copies data in or out of the database", "replaces or changes live code or tables", "runs a saved program that can change anything"; script "runs hidden code", "sends data to a server", "clicks or submits things", "opens another address, which can carry data", "changes the site's saved data". (Shorter wording; the COPY line no longer adds "which can send data out", "out of the database" carries it.) |

### Measured (`replay.js`, 2026-10-27)
62 sessions, 3,271 calls, 720 asks; 0 decision and 0 state differences vs the pre-GEN-953 hook; every card passes the committed-wording check (`cardcheck.js`: every check sentence from the table or the closed list; each cause's opening sentence present; Claude's part once, with only one opening sentence before it and no Site line or undo note). Whole card median 184, p90 267, max 1,068 (pre-GEN-953 141 / 275 / 1,772; v2.1 267 / 374 / 1,134). Visibility by simulated wrap at 63 characters (`replay.js`, measured on the 20th character of Claude's first quote, the end of the site name, the end of "Undo not guaranteed"): as in the plain-words section. 164 tests pass (`tests.js`), including the hidden-danger oracle (opening sentence on every card; serious kind named on 24 of 48).

### Live test pass bar
On a real click card, a click right after a permission control with no danger word, and a click right after a permission control with one: Erez can read the opening sentence and the start of Claude's description without scrolling.

### Size
size: skipped (no limit in `notes/anthropic-guidelines.json` applies to a hook source file or its ask text).

### Residual
- The undo note is in the scroll area on about 32% of change cards (it comes last).
- Box size is undocumented (code.claude.com/docs/en/hooks gives no limit; the changelog's only related entry is a wrapping fix for emoji in reason text); the 63-character line is from one screenshot at Erez's usual window size.
- Batches with many click descriptions still run long; their descriptions come early, so the undo note and later reasons go below the fold.

### Round-1 revisions (2026-10-27)
1. Holistic + pre-mortem (material): click cards hid Claude's description (the only part naming the click) on line 3 or below, worst on clicks right after a permission control. → Claude's part right after the first sentence on click cards (v2.1's planned fallback, applied); fit now measured on Claude's words by simulated wrap.
2. Pre-mortem (material): the site fell out of view on long script cards, including payments. → Site right after the first sentence (or after Claude's part on clicks).
3. Soundness (material): the first-visit sentence dropped "search" (also in installed v2.1). → "look around and search there".
### Round-2 revisions (2026-10-27; all three reviewers, same finding)
5. Material: Claude's part came early only on cards with the word cause, so the 21 clicks right after a permission control with no danger word (description on line 4) and the 21 high-stakes clicks (line 3) were left out, and the figures excluded them. → Claude's part right after the first group on every card that has one; figures re-measured over all 360 such cards; live-test bar adds a no-danger-word permission-control click.
6. Advisories adopted: first-visit sites on change cards also go on the early Site line; stuck-tab sentence first; "Site (last seen)" only for stuck-tab causes; "Right after a role…" (not "Follows"); measurement uses the real quote position and a site match that cannot hit Claude's words.

### Round-1 advisories
4. Advisories adopted: "allow only if expected" restored in short form; "unless the check flags them"; "Site (last seen)" on stuck-tab cards; "often the action that applies it"; helper sentence kept in mixed typed+script batches; fit reported by wrap simulation and as a range; the title claim corrected; like-for-like length comparison.
