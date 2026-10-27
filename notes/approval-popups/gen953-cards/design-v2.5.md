# GEN-953 step 2, v2.5: site first, the "unchecked" mark before Claude's words

Revision of `design-v2.4.md` after its review (holistic and pre-mortem REVISE, soundness PASS). Everything in v2.3/v2.4 stays except the points below.

## Changes from v2.4
1. **The mark goes back before the quote, shorter:** `Claude says (unchecked): "…"; "…" and N more.` (v2.3 had `Claude says (not checked): "…"`, v2.4 `Claude says: "…" (not checked).`). With the mark before the quote, it is in view wherever the start of the quote is. (Holistic and pre-mortem: in v2.4 "(not checked)" fell below line 3 on 53 of the 80 permission-control cards.)
2. **Site prefix only when the first sentence names no site.** First-visit, high-stakes and permission-control sentences name their own host; any other site then follows as "Also on h." (instead of "On h2: … control on h1", which could read as if the control were on h2). A site name over 40 characters shows its last 39 after "…"; at most two names are listed, then "and N more". (Pre-mortem advisory: an unlimited prefix could push the check's sentence out of view.)
3. **Two apostrophes cannot fake a closing quote:** after quote marks in Claude's words become `'`, a run of them becomes one.
4. **Checker:** opening sentences for the stuck-tab, no-summary and fixed causes are required too; a stuck tab with a site must say "Last seen on". The test that no longer tested anything now checks the card opens with "On payments.google.com:".

## In plain words (for Erez)
Pop-ups open with the site (or with a sentence naming it), then what kind of action it is, then Claude's own description marked "unchecked", then any other reason, then "Undo not guaranteed; allow only if expected." Examples (real):
- "On en.wikipedia.org: May change, send, delete, pay, share or grant something. Claude says (unchecked): "Puts the cursor in the Wikipedia search box". Undo not guaranteed; allow only if expected."
- "Right after a role, permission, owner or billing control on github.com; often the action that applies it. Claude says (unchecked): "Opens the Contents access menu". Undo not guaranteed; allow only if expected."
- "On payments.google.com: A page script that can change the page or send data. Among other things, it sends data to a server and opens another address, which can carry data. Undo not guaranteed; allow only if expected."

**What fits (all 720 real pop-ups, word-wrapped at 63 characters a line; `replay.js` 2026-10-27, Claude's words excluded when looking for anything else):**
- the site: by line 2 on all 708 that name one at the start or in the first sentence;
- the first sentence, complete: within 3 lines on all 720, by line 2 on 94%;
- Claude's description with its "unchecked" mark, first 20 characters: within 3 lines on all 360 that carry one, by line 2 on 6% (line 3 is the partly faded line in your screenshot; the live test checks it is readable);
- the undo note: within 3 lines on 70% of change pop-ups (the undo note, and any further reasons, are what fall into the scroll area).

Trade-off against v2.3: the site moved from mostly line 3 to always line 1-2; Claude's description moved from mostly line 2 to line 3.

## Measured
62 sessions, 3,271 calls, 720 asks; 0 decision and 0 state differences vs the pre-GEN-953 hook; every card passes `cardcheck.js`. Whole card median 181, p90 265, max 1,063 (pre-GEN-953 141 / 275 / 1,772). 179 tests pass.

## Live test pass bar
On a real plain click, a click right after a permission control (with and without a danger word) and a high-stakes click: Erez can read the site, the opening sentence, and the "unchecked" mark with the start of Claude's description, without scrolling.

## Residual
- Claude's description sits on line 3 (faded) on most click cards; if the live test shows it unreadable, the fallback is to drop the "On h:" prefix on click cards and name the site after Claude's words.
- Page-script cards carry no description of what Claude is doing; the planned follow-up on plain-language descriptions from Claude covers scripts too.

## Size
size: skipped (no limit in `notes/anthropic-guidelines.json` applies to a hook source file or its ask text).
