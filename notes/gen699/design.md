# GEN-699 + GEN-663 — ticket-gate hardening, design (2026-10-12)

Target: `~/.claude/hooks/auto-approve.js` (the GEN-508 ticket-gate arm), via `/vet-code`.
Working copy: `notes/gen508-piece1/auto-approve.working.js`.
Tickets: [GEN-699](https://app.notion.com/p/3be6e495d07c81b3a305f239c24c6374) (items 1-4; item 5 split off),
[GEN-663](https://app.notion.com/p/3b36e495d07c81819e4fea6c5d02d33b) (items 1-3).
Approved plan: Phase 2 of `~/.claude/plans/i-want-to-work-ancient-barto.md`.

Line numbers below are the LIVE hook's as read 2026-10-12.

## 0. Re-base first

The working copy differs from the installed hook in both directions (live has GEN-453 practice-page code
etc.; the working copy has the GEN-639 invalidated `REST_SCRIPT_SHA256` sentinel and an old
`commandReferencesSandbox` staging exemption the live hook dropped). Installing it as-is would revert live
code. So: working copy := the installed hook's exact bytes (Node read/write), sha256 recorded; then apply
only the fixes below. The diff reviewed at Step 3 is therefore exactly these fixes.

The GEN-639 sentinel is NOT carried over: it belongs to the parked REST arm (not wired, so inert), which
piece 2 (GEN-635) owns. The README's "Open before the next ticket-gate hook change" note is updated to say
piece 2 must re-apply it.

## 1. Fixes

**A — GEN-663 #1: `ticketIdsIn` drops bare ids when a dashed id is present (2486-2506).**
Today: if any dashed uuid matches, return those immediately; bare 32-hex runs in the same value are never
collected. Fix: collect dashed matches, then replace each dashed match with a space, strip dashes from the
remainder, and collect bare 32+ hex runs from it as today (leading and trailing 32-char window).
Effect is one-directional: more ids, never fewer. The only verdict that depends on having FEWER ids is the
GEN-58 exemption (clause 1, "every id is exempt"), so the change can only turn an exempt write into a gated
one — the mixed-id case the finding describes. Stage 5 with ids is already 'in'. Housekeeping (stage 2)
does not read ids. Fix the function's comment ("Either error direction is safe") to say what it now does.

**B — GEN-663 #2: false comment at `restIsGen58Exempt` clause 3 (3030-3033).**
The comment says an upper-case exempt-file line would not match; `readExemptPages` lowercases first (2240),
so it does. Fix the comment, and state that a DASHED line is ignored. Behaviour unchanged: the GEN-58
rollover lane in `/vet-ticket` normalises before appending and its step 5 re-reads the file and confirms a
valid 32-hex line — that is the loud failure GEN-662's criterion asks for. Accepting dashed lines in the
reader would also require editing the `/vet-ticket` skill and the v8-arm assertion that pins today's
behaviour, for no observed case.

**C — GEN-663 #3: `TICKET_EXEMPT_ROOT_KEYS` restates `TICKET_HK_ROOT_KEYS` (1914-1936).**
Derive it: `new Set([...TICKET_HK_ROOT_KEYS, 'content', 'old_str', 'new_str', 'selection_with_ellipsis',
'position', 'content_updates'])`. Same 15 members as today (asserted by a test), so no behaviour change.
The comment says plainly that this ties the two together: adding a key to the housekeeping root set also
widens the GEN-58 content exemption's permitted root keys.

**D — GEN-699 #1: REVISE-then-PASS inversion in `ticketLastToken` (3447-3463).**
Today: the LAST `TICKET-REVIEW-VERDICT:` occurrence in a delivered message decides, so a message that says
`REVISE <hash>` and later quotes `PASS <hash>` reads as PASS. Fix: if ANY occurrence in the message parses
as `REVISE <this hash>`, return 'other' (refuse); otherwise unchanged (the last occurrence must be exactly
`PASS <this hash>`). Fail-toward-block. A REVISE for a DIFFERENT hash (an earlier round's payload) does not
count. The GEN-740 turn / hand-back logic in `ticketTokenVerdict` is untouched; this changes only the
per-message read it calls.
Known cost: a reviewer that writes the literal `REVISE <this hash>` in prose (e.g. quoting the instruction
with the real hash) is refused. The `/vet-ticket` brief already forbids writing the prefix anywhere but the
final line. The GEN-812 guard (`reviewer-verdict-guard.js` `lastToken`, 103-117) reads only the LAST token,
so it does NOT catch this case before delivery: such a report is refused by the gate as `no-token` after the
fact (fail-closed; the remedy is a re-review). The token-diff in section 3 measures how often real reviewers
did this. That guard file is not changed here (its own comment says it mirrors `ticketLastToken`; recorded
as a residual).
Also updated in the hook, because D makes them incomplete: the comments at 3266-3269 and 3445-3446 ("the
last occurrence wins"), and the `no-token` refusal text (3537-3543), which gains "or contains a REVISE for
this content anywhere in that reply". The `/vet-ticket` skill's wording ("the hook takes the last
occurrence", SKILL.md ~404-405, ~426) is still true and stricter-than-needed advice, so the skill is NOT
edited.
The existing v8-arm assertion "REVISE then PASS approves (not first-occurrence)" (test-gen508-v8-arm.js
441-446) pins exactly the old behaviour and is deliberately INVERTED by this change.

**E — GEN-699 #2 (JSON-literal string keys leaking into the GEN-58 clauses): EREZ DECIDES, recommendation
is to decline.** Erez approved "items 1-4"; dropping one is a scope change, so it goes to him as one
plain-language decision BEFORE the build, and GEN-699 does not go to Done until he has answered.
- Measured (`notes/gen699/measure-e.js`, run 2026-10-12 over the 1,189-payload corpus): **0** payloads have
  a JSON-literal string under a text field (`new_str`, `old_str`, `content`, `selection_with_ellipsis`).
- Today's behaviour never under-gates: a parsed JSON-literal `new_str` fails clause 4 (2292) and clause 6
  (2312), so such a log write needs one `/vet-ticket` review; keys a parse exposes can only fail a clause,
  never satisfy one. Nothing is lost and nothing escapes.
- The ticket's prescribed fix (a "structural keys" set ignoring keys reached through parsed strings) is
  unsafe: `data` is an envelope key, and real traffic sends enveloped payloads (`data` ×4 in the corpus), so
  a naive filter would hide `properties` / `archived` of a whole enveloped payload from the content-only
  check and clause 3; and if applied to clause 4, a stringified `content_updates` with an empty `new_str`
  would become an exempt wipe of log text.
- A narrower alternative exists (do not JSON-parse values under the text-only fields, keep the raw string
  for the marker scan). It is unreviewed, changes the content hash for such payloads, and alters the shared
  normaliser every Notion write passes through — for 0 observed cases.
- **If declined:** a pin test records today's behaviour as intended (a GEN-58-row `update_content` whose
  `new_str` is a JSON literal → gated `no-pass`; not out-of-scope, not `internal-error`), and GEN-699's body
  records item 2 as measured-and-declined (via `/vet-ticket`, Erez sees the card) before it goes to Done.
- **If he wants it fixed:** the narrower alternative gets its own design review before it joins this change.

**F — GEN-699 #3: unreadable / over-cap exempt file blocks writes that never needed it (stage 3, 2690-2701).**
Today `readExemptPages()` runs for every write that reaches stage 3, and an unreadable or over-cap file
blocks them all — creates, moves, duplicates, substance property edits, and GEN-58-row writes whose
exemption is hardcoded. Fix: only consult the file when it can change the verdict:
- if the tool is not update-page, or the write is not content-only → skip stage 3 entirely (the carve-out
  cannot apply);
- else if every page id is the hardcoded GEN-58 row → decide the carve-out with an EMPTY file set (no read);
- else read the file; unreadable / over-cap → block as today; otherwise decide as today.
No write moves to 'out' that was not 'out' before except (a) GEN-58-row content writes while the file is
broken, which are exempt by the hardcoded id regardless of the file, and (b) writes that were blocked only
by the broken file and now reach stages 4-5, where they are judged exactly as they would be with a healthy
file. With a healthy file, verdicts are identical.
The "every page id is the GEN-58 row" shortcut is vacuously true for an empty id list; it stays harmless
because `ticketIsGen58Exempt` returns false on no ids (2330). The code comment says so, and a test covers it.
The two refusal texts (3572-3573, 3579-3580) and the comment at 3568 say a broken file refuses "every
in-scope write"; after F that is false, so they are reworded to "content writes to pages other than the
GEN-58 row". (The hook comment near 2221 says `/wrap` reports the list; no `/wrap` reader exists. Surfacing
belongs to GEN-508 piece 3 / GEN-636 and is not added here.)

**G — GEN-699 #4: unbounded `stableStringify` recursion on the raw-input hash fallback (1116; 2629-2634).**
On the `!norm.ok` path the hash is taken over the raw input; a pathologically deep payload overflows the
stack. In the hook, `ticketScope`'s caller already catches the throw and refuses the write as
`internal-error` (fail-closed). In `ticketHashCli` the call (3858) is outside any try, so the CLI crashes
with a stack trace. Fix the CLI only: wrap the hash call, print a clear message ("too deeply nested to hash;
the hook refuses it; re-issue the call in the ordinary shape"), exit 3, print no hash. The shared
`stableStringify` (also used by the settings.json hooks diff) is not touched.

**H — GEN-699 item 5 (connector-id rotation blind spot): split off** to its own ticket via `/vet-ticket`,
per the approved plan. It is a detection mechanism needing its own surfacing design.

## 2. Tests (added to `test-gen508-v8-arm.js` / `test-gen508-contract.js`)
- A: a GEN-58-row content write whose id-ish value holds the GEN-58 dashed id AND a bare ticket id is gated
  (no-pass); the same value with only the GEN-58 id stays exempt.
- C: contract — `TICKET_EXEMPT_ROOT_KEYS` is derived from `TICKET_HK_ROOT_KEYS` (source pin) and has the 15
  expected members.
- D: the existing "REVISE then PASS approves" assertion is inverted (now blocks, `no-token`); plus
  `REVISE <old hash>` then `PASS <h>` → approves; prose quoting `PASS <h>` then final `PASS <h>` → approves;
  `REVISE <H-in-upper-case>` then `PASS <h>` → blocks.
- E (if declined): GEN-58-row `update_content` whose `new_str` is a JSON literal → `no-pass`.
- F: with an unreadable exempt file (a directory at its path) and with an over-cap file: GEN-58-row content
  write → falls through; GEN-58-row content write carrying a destructive key → NOT out (gated); create into
  another database → falls through; substance property edit on a ticket → no-pass (not exempt-list-*);
  content write to a non-GEN-58 page → exempt-list-unreadable / -overflow; a content write with no page id →
  not out.
- G: `--ticket-hash` on a payload nested past the stack limit → exit 3 with the NEW message text asserted
  (so a JSON-parse failure, also exit 3, cannot pass it), no hash, no stack trace.
- The two failing pins in the CONTRACT suite's section 5 (`--ticket-hash` allow-list regex): after the
  re-base, check each against what the GEN-743/645 commit (34dff9c) recorded, not merely against what is
  installed; update a pin only where that commit deliberately moved the regex, and say so.

## 3. Live-verify (real input)
- `node --check` on the working copy (GEN-663 acceptance).
- Corpus sweep (section K) with `GEN508_SWEEP_HOOK` = working copy: 0 bypasses, 0 threw.
- Verdict diff (`notes/gen699/verdict-diff.js`), installed hook vs working copy, over all 1,189 corpus
  payloads: every changed verdict listed and explained; expected: none. It compares scope / reason / why
  only — an id-set change on a payload that stays 'in' does not show, which is fine for safety.
- Token change against real reviewer output: every `check-reviewer` transcript on this machine that carries
  a `TICKET-REVIEW-VERDICT:` line, run through `--ticket-verify` on both hooks with the hash from its own
  final token; any ok→refused flip is a false fire and fails this step unless explained.
  (`notes/gen699/token-diff.js`; baseline 2026-10-12: 418 transcripts, installed hook ok 352 / no-token 60
  / reviewer-unverified 6.)
- Pass-consumption assertion in a fixture tree (vet-code Step 4).
- Immediately before install: confirm the installed hook's sha256 still equals the one recorded at the
  re-base (other sessions edit this file); if not, re-base and re-run everything above.

## 4. Residual
- B leaves dashed lines silently ignored by the reader; the lane's re-read is the only loud check.
- D can refuse a reviewer that writes `REVISE <this hash>` in prose, and the GEN-812 guard does not catch it
  before delivery (it reads the last token only).
- E (if declined) leaves the JSON-literal friction (0 observed).
- G leaves the hook's deep-payload refusal in `ticketScope` labelled `internal-error`.
- **Pre-existing, NOT fixed here, found during this review:** a tool call nested ~3,000+ levels deep crashes
  the WHOLE hook before any gate decides — `enforceKeySheetGuard`'s unguarded `JSON.stringify(ti)` (338)
  throws `RangeError`, the process exits 1, and Claude Code treats exit 1 as a non-blocking error, so the
  call proceeds unchecked. Verified 2026-10-12 by piping depth 3,000 / 8,000 / 20,000 / 100,000 Notion
  payloads to the installed hook: exit 1, stack trace from line 338, every time. Not reachable by ordinary
  traffic (no real tool call nests like this) and outside this change's scope, so it gets its own ticket.
