# GEN-953 step 2, v2.2: the same pop-up wording, short enough to fit what is visible

Revision of `design-v2.1.md` (installed 2026-10-26). Everything in v2.1 stays (guarantee, closed list of serious additions, Claude's words last and "not checked", tests) except the wording length below.

## In plain words (for Erez)

**Why.** In the live test (2026-10-26) your screenshot showed the pop-up's explanation box shows only about 3 lines (about 65 characters a line, roughly 190 characters); the rest is in a small scroll area. Half of v2.1's pop-ups were longer than that, so the site, the undo note and Claude's description fell out of view.

**What changes.** Same meaning, fewer words, most important first. Example (typing a database command in Snowflake):
- v2.1 (342 characters): "Browser safety check: Typing a database command that changes or deletes data. Among other things, the check sees that it replaces or changes live tables, views or code. … Undo is not guaranteed; allow only if Claude told you in the chat it would do this. Claude says (not checked): …"
- v2.2 (279; the check's own part 199): "Typing a database command that changes or deletes data. Among other things, it replaces or changes live code or tables. May change, send, delete, pay, share or grant something. Undo not guaranteed. Site: app.snowflake.com. Claude says (not checked): "Types the reviewed routine"."

**Result on all 720 real pop-ups:** the check's own words fit in about 3 lines on 96% of pop-ups (median 139 characters; v2.1 median 267 for the whole card). Claude's description stays last; on a single action it is also shown in full in the app's details box under the explanation ("Action summary").

**Given up to make it fit:** the "Browser safety check:" opening (the pop-up title already says what is asking) and the second half of the caution ("allow only if Claude told you in the chat it would do this"), now just "Undo not guaranteed."

**Unchanged:** when a pop-up appears; never milder than the wording before GEN-953.

---

## Technical detail

### Measured (replay of every real browser call, `replay.js`, 2026-10-26)
62 sessions, 3,271 calls, 720 asks; 0 decision and 0 state differences against the pre-GEN-953 hook (`live-baseline.js`). Whole card: median 160, p90 238, max 1,044 (pre-GEN-953 141 / 275 / 1,772; v2.1 267 / 374 / 1,134). The check's own part (before "Claude says"): median 139, p90 185, max 295; 96% within 195 characters. Visible-line estimate from Erez's screenshot: line 1 "Browser safety check: Typing a database command that changes or" = 64 characters; 2.5-3 lines visible before the scroll fade.

### Wording table (v2.1 → v2.2); pre-GEN-953 text in live-baseline.js `ASK_TEXT` :479-498
| Cause | v2.2 | Pre-GEN-953 (floor to keep) |
|---|---|---|
| word | "May change, send, delete, pay, share or grant something." | "This action may change, send, delete, pay, share or grant something: …" |
| typed-write | "{Typing / A page script runs / Typing or a page script runs} a database command that changes or deletes data." | "Typing a database command that changes or deletes data." |
| helper-args | "A page script runs more than a lookup through code left on the page; it can change, delete or send data." (left out when typed-write is on the same card, whose sentence already says the script runs a command that changes or deletes data) | "A page script passes a helper something other than a read-only query." |
| risky-script | "A page script that can change the page or send data." | same |
| script-helper | "A page script reuses code left on the page; it can change the page or send data." + "If allowed, later uses of it go ahead unless risky." | "…calls a helper an earlier script set up, which can change the page or send data." + "approving lets later calls to it go ahead this session unless they carry a database write or a risky pattern." |
| high-stakes | "High-stakes site (h): every click, key and form fill asks." | same |
| follow-up | "Follows a role, permission, owner or billing control on h; often the click that applies it." | "The action right after a role, permission, owner or billing control on h (often the one that applies it)." |
| new-site alone | "First action on h this session. If allowed, Claude can look around there without asking; changes, sends and deletes still ask." | "First action on h this session. Approving lets Claude open, look around and search there without asking again this session; anything that may change, send or delete something still asks." |
| new-site with a change | "Also the first action on h this session; if allowed, Claude can look around there without asking." | (v2.1 rule) |
| others | today's text, "gate" → "check" | |
| caution | "Undo not guaranteed." | (none before GEN-953) |
| additions | "Among other things, it …" | (v2.1: "Among other things, the check sees that it …") |

Serious kinds (closed list, unchanged in meaning): SQL "deletes data or database objects", "changes who has access", "copies data in or out of the database", "replaces or changes live code or tables", "runs a saved program that can change anything"; script "runs hidden code", "sends data to a server", "clicks or submits things", "opens another address, which can carry data", "changes the site's saved data".

Order: change sentences (worst cause first) with their additions → new-site sentence → "Undo not guaranteed." → "Site: …" → "Claude says (not checked): …".

### Size
size: skipped (no limit in `notes/anthropic-guidelines.json` applies to a hook source file or its ask text).

### Residual
- 4% of cards still run past 3 lines; what falls off is the site line (and on 2 two-cause script cards, part of the second sentence).
- Claude's description is usually below the fold; on a single action it is in the details box; on a batch it is only in the raw request list (as it was before GEN-953 for non-word causes).
- "Undo not guaranteed." drops the explicit "allow only if Claude told you in the chat" instruction.
