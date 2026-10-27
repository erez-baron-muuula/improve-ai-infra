# GEN-953 step 2, v2.4: short pop-up wording, site first

Revision of `design-v2.3.md` (converged 2026-10-27 after 3 review rounds). Everything in v2.3 stays (wording table, guarantee, Claude's description right after the first sentence group, tests) except the two changes below, made after convergence because a corrected measurement showed the site was often out of view.

## Why
v2.3 reported "site within 3 lines on 98%". Its measurement searched the whole card for " on <host>", which also matched site names inside Claude's own descriptions (round-3 reviewers flagged the method). With Claude's words excluded, the real figure was 63% by line 3: on click cards the "Site:" line came after Claude's description.

## The two changes
1. **The site leads the card:** "On h: <first sentence> …" ("Last seen on h: …" when a stuck-tab cause is present), for every site the first sentence does not itself name (first-visit, high-stakes and permission-control sentences name theirs). The separate "Site: …" line is gone.
2. **Shorter label for Claude's words:** `Claude says: "…" (not checked).` (the "(not checked)" mark, with any "N more not shown" count, now follows the quotes), so Claude's description starts about 14 characters earlier.

## In plain words (for Erez)
Every pop-up now starts with the site, then what kind of action it is, then Claude's own description marked "not checked", then any other reason, then "Undo not guaranteed; allow only if expected." Examples (real):
- "On en.wikipedia.org: May change, send, delete, pay, share or grant something. Claude says: "Puts the cursor in the Wikipedia search box" (not checked). Undo not guaranteed; allow only if expected."
- "On app.snowflake.com: Typing a database command that changes or deletes data. Among other things, it replaces or changes live code or tables. Claude says: "Types the reviewed routine" (not checked). May change, send, delete, … Undo not guaranteed; allow only if expected."
- "On payments.google.com: A page script that can change the page or send data. Among other things, it sends data to a server and opens another address, which can carry data. Undo not guaranteed; allow only if expected."
- "Right after a role, permission, owner or billing control on github.com; often the action that applies it. Claude says: "Opens the Contents access menu" (not checked). Undo not guaranteed; allow only if expected."

**What fits (all 720 real pop-ups, word-wrapped at 63 characters a line, `replay.js` 2026-10-27; Claude's words excluded when looking for the site or the undo note):** the site is visible by line 2 on all 709 that name one; the first 20 characters of Claude's description are within 3 lines on all 360 that carry one (by line 2 on 61%); the undo note within 3 lines on 70% of change pop-ups (the undo note, and any further reasons, are what fall into the scroll area). The opening sentence is always visible.

## Measured
62 sessions, 3,271 calls, 720 asks; 0 decision and 0 state differences vs the pre-GEN-953 hook; every card passes `cardcheck.js` (committed wording incl. "On h:"/"Last seen on h:"; each cause's opening sentence present; Claude's part once, with only one opening sentence and no undo note before it). Whole card median 182, p90 267, max 1,065 (pre-GEN-953 141 / 275 / 1,772). 164 tests pass (`tests.js`).

## Live test pass bar (unchanged from v2.3, plus a high-stakes click)
On a real click card, a click right after a permission control with and without a danger word, and a high-stakes click: Erez can read the site, the opening sentence and the start of Claude's description without scrolling.

## Residual (in addition to v2.3's)
- "On h:" adds the host's length to the front; on a very long host (e.g. a 46-character Snowflake login host) Claude's description can start on line 3 or later.
- Claude's quote now ends with "(not checked)" after it rather than having the label before; the label "Claude says:" still precedes the quote.

## Size
size: skipped (no limit in `notes/anthropic-guidelines.json` applies to a hook source file or its ask text).
