# GEN-953 step 2, v2.6: code-review fixes on top of v2.5

Supersedes the wording details of `design-v2.5.md` where they differ; everything else in v2.5 stands.

## Changes (2026-10-27, after the second and third independent code reviews)
1. **Stuck tab with a second reason** (review finding, material): when the first sentence is a stuck tab
   ("Claude could not confirm which page this tab is on.") or a missing summary, it says nothing about the
   action itself. Such a card now reads: that sentence; any other stuck/missing-summary sentence; the next
   reason's sentence with what the check sees in it; "Last seen on h." (stale tab only); then Claude's
   words; then the rest. Before, the next reason's warning fell below the visible lines. A site the next
   reason's sentence already names is not repeated as "Last seen on" or "Sites in this request".
   Trade-off: on such cards Claude's description and the last-seen site move down (about line 3).
2. **Reused page code** (accuracy): "If allowed, later calls to it go ahead unless the call itself has a
   database change or a risky step." This is what the check does (it re-asks only when the call text
   carries a database write, fails the read-query test or matches the risky-script pattern; what the
   stored code does is not re-checked) and keeps the pre-GEN-953 meaning ("unless they carry a database
   write or a risky pattern"). v2.5 said "…unless the check flags them" (vague); an interim v2.6 draft
   said "…unless they change data or look risky", which promised more than the check does (caught by the
   third review).
3. **Claude's words, look-alike quotes**: letters outside the Latin, Greek, Cyrillic and Hebrew scripts,
   and the stroke letters ǀ ǁ ǂ ǃ (U+01C0-01C3), װ ױ ײ (U+05F0-05F2) and Ꞌ ꞌ (U+A78B/C), become an
   apostrophe, like other quote look-alikes. Accepted: Hebrew letters such as yod stay; two of them can
   look like a quote.
4. **Reused-code sentence kept for batches of several scripts**: the helper sentence is dropped as a
   repeat only when the request has a single page script and no typed text.
5. **Wording as shipped** (aligning v2.5's text with the code): the mark reads "Claude says (unverified):";
   a site name over 40 characters shows "…" and its last 39 characters, and the full list ends the card.

## Measured (replay of every past browser action; sweep of every reason and pair of reasons)
- Real pop-ups (720, from 3,271 past actions): 0 decision changes; site by line 2 on all that name one;
  first sentence by line 3 on all; Claude's words start within 3 lines on 358 of 360; undo note within 3
  lines on 69% of change pop-ups; second reason within 3 lines on 4 of 70 two-reason pop-ups; the
  reused-code note (22 pop-ups) starts within the visible lines and ends on line 4.
- Every reason and pair (1,058 built cards, `sweep.js`): the first sentence is within 3 lines on all.
  What a 3-line box cannot also hold on longer cards (the second reason, the undo note, Claude's words
  after a script or database sentence) scrolls, by the v2.3 order (first reason, then Claude's words).
