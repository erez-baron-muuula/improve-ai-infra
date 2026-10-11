# GEN-606 + GEN-802 — cold-pickup handoff (written 2026-10-11, step C update same day)

**Pick up here — READ "Step C status (session b4adc493)" FIRST.** Steps A, B and D are done and live. Step C was built, reviewed and fully tested on 2026-10-11 but **NOT installed**: Erez's feedback on the timing decision reopens the design (below). It is hook code, so it goes through `/vet-code` at **xhigh** effort on a strong-floor model (see `notes/effort-model-reference.md`).

## Step C status (session b4adc493, 2026-10-11) — built, NOT installed

**Erez's words on the open decision (verbatim):** "The for you is just meant to be a summary. No need to run the same logic twice. however, I also don't want to 83 out of 100 times, to fail."

**What he was answering.** Measured on 3,798 real past replies: the reminder would have fired 100 times (~1/day); an independent blind judge found 98/100 were real new-ticket proposals (84 clearly warranted, 6 not needed, 10 unclear from excerpt). But **83 of the 100 proposals sat inside a reply that already carried the For-you block** (the block is written in the main reply ~3/4 of the time despite the block-after-check convention; e.g. 2026-10-01..15: 326 blocks in first replies vs 98 in hook continuations). The 2026-10-08 incident (GEN-661 duplicate) is one of those 83. Options put to him: (1) fire before AND after the block (after the block: search, then add one plain sentence under it — risk of a repeated block); (2) fire only before the block (misses the 83%).

**Reading of his answer (confirm with him in one line before redesigning):** neither option. The For-you block is a summary of the reply, so the check should run ONCE, on the proposal itself, before the summary — not again on/after the block; and it must still catch the ~83% case. The likely design direction: make the proposal and its block land AFTER the end-of-turn check — i.e. get the For-you block out of the first reply in practice (the convention already says it belongs on the hook continuation), so the single "before the block" path (Mode A) covers nearly every proposal. Things to evaluate: why the model writes the block in the main reply 3/4 of the time (rule wording? the For-you note's own text?), whether a hook can make that reliable, and whether a Mode-A-only reminder then reaches ~all proposals. Alternative reading to rule out: he only meant "don't repeat the same explanation in my reply and again in the block" (communication feedback) — if so, it still doesn't pick an option.

**What exists (all in `notes/gen606/stepC/`):**
- `stop-foryou-nudge.working.js` — the complete working copy (live hook + search-first stage; For-you logic moved into `forYouNote()` unchanged). sha256 (LF) `dfc27cdef0a9f4ef3dd1e0033803ce310121a13ed4336a35bdef139eb7d1f256`. `working-vs-live.diff` against the live hook as of 2026-10-11.
- `design-v1.md`, `design-v2.md` — the design, evidence (E1–E10), and every review change.
- `rig/` — measurement scripts (they expect to run from a folder holding `corpus.jsonl` and a `working/` copy; `.gitignore` keeps raw-transcript outputs out of git). Fixtures: `notes/gen606/test-search-first.js` (74/74 on the working copy) + `notes/gen748/run-fixtures.js` (43/43) + `notes/gen767/test-pass-consume.js` (3/3).
- Vetting evidence: `/check` converged in 2 rounds (4 check-reviewers); code review 2 rounds each of Pass A (in-session) and Pass B (opus-5-5, PASS both rounds, minors fixed); 627-reply differential vs live: 480 identical, 147 reminder-only additions, 0 unexplained. Record: `~/.claude-staging/vetting-passes/gen606-stop-foryou-nudge.record.json` — bound to the hash above; **any redesign changes the hash, so the record must be re-done** (new /check on the new design). No pass was minted; nothing live changed.
- Stage behaviour worth keeping in a redesign: new-ticket-only detector (15 patterns + exclusions, tuned on the corpus); "search" = notion-search / query-data-sources / JQL / real REST query / a /vet-ticket run, NOT notion-fetch (counting fetch would have silenced the 10-08 incident); window = since Erez's last message (`origin.kind === "human"`); once per Erez message (uuid + prompt_id slots); log `search-first-nudges.jsonl` (fire + after rows) and switch file `search-first-switch.jsonl`; the /wrap readout (counts, re-evaluate bar, liveness) was designed but not built.
- Side finding (pre-existing, not from this change): under heavy parallel load (32 concurrent hook processes) BOTH the live and the new hook drop their output ~2/3 of the time — the 5 s stdin watchdog fires under CPU starvation. Irrelevant at normal load; noted in `rig/regress-corpus.js`.


## Tickets
- **GEN-606** "Check for an existing ticket before proposing where a finding should be recorded": https://app.notion.com/p/3b06e495d07c81138aa8d1d0d0423b43
  - Status: **In Progress**, the primary ticket, set 2026-10-11.
  - It stays In Progress until step C is installed.
- **GEN-802** "Stop asking Erez to re-approve a ticket filing he already approved": https://app.notion.com/p/3f36e495d07c8115ae7cc651851f1cd5
  - Status: To Do.
  - Its fix is now live (step A). Propose Review to Erez at close-out; he is the verifier.
  - Its body does not yet record the second instance: GEN-58 class U, 2026-10-11, GEN-804 close-out. Erez approved a plan step naming the write and was still asked again at the card. Step A covers that case.
- The approved plan, with full reasoning, is at `C:\Users\Erez\.claude\plans\i-want-to-work-shimmying-river.md` (outside this repo). The essentials are below.

## The problem, in one paragraph
Claude proposed tickets, or offered "fold into X or file new", without first searching the board. On 2026-08-02 the right home was GEN-218. On 2026-10-08 a duplicate was found only after Erez had approved the new ticket (GEN-661). Claude also showed a chat draft and then asked again at the /vet-ticket card (GEN-802). GEN-606's own text says "the fix should be enforced rather than more advice", so the plan includes a mechanical nudge (step C).

## Done (live, verified byte-identical to the reviewed text)
- **A. `~/.claude/skills/vet-ticket/SKILL.md`**
  - Description: start the skill before any chat draft or "should I file this?".
  - New **Step 0b**: the main session searches for an existing home before drafting a new ticket.
    - It cites the /wrap sub-step "Check for an existing home before creating", and Review-status tickets count as candidates.
    - A confident match becomes an append, or no write if the ticket already says it.
    - A match that declined this work goes back to Erez with a question about reopening.
    - A search that could not complete is recorded as "could not check" and never treated as no match.
  - Step 2: the brief carries the lane plus the search summary, or `Step 0b: skipped — <reason>`. Item 5 means the reviewer judges that summary; it has no Notion tool.
  - Step 4: the record gains `searchSummary`.
  - Step 5:
    - The card is the only approval and is preceded by no chat draft.
    - A one-line search result sits above the card.
    - An earlier explicit approval of a described write stands: file it and show the card as a report, asking only if the result goes beyond what he approved.
    - The mint sentence is adjusted to match.
  - sha256 of installed (LF-normalized) content: `a0e95345727d51dab8e0789fb42b371339b4a041b4bda60d8b842b1d5d8b246a`.
- **B. Global `~/.claude/CLAUDE.md`**, in the rule beginning "Before creating or materially changing a ticket in a tracker":
  - Three Team-Tasks priority sentences are replaced by one pointer to /vet-ticket. Net change: −581 chars.
  - Erez rejected the first version, which **added** two sentences: "Our instructions file is already too big."
  - His standing goal for that file (HISTORY 2026-08-05 (4)): "Done when nothing is loaded every session unless it's needed every session."
  - sha256: `ae146ca13d7725078d760b66b40a275a1ad37e87a209997d93184d41d5ab471e`.
- **Review trail:** check-records are in `~/.claude-staging/check-passes/gen606-*.record.json`, and both passes were consumed.
- **D. Read-only sweep** of /vet-rule, /vet-code, /staging and /approve-ticket for the same double ask: none found.
  - /vet-rule's mint write is designed to prompt as a second gate, but it doesn't fire under Erez's permission mode, so nothing needs changing. Note this on GEN-802 at close-out.
- **Reasoning failure logged:** GEN-58 Vol. 9, class G new element `[always-loaded addition with no offset]`. The always-loaded addition was proposed without checking Erez's size goal.

## Remaining: step C — automatic search reminder (via /vet-code)
**What it does.** At end of turn it fires when both of these hold:
- the finished reply proposes filing a ticket or names a ticket destination (wording patterns such as "file (it/this) as (a/its own/a new) ticket", "fold (it/this) into GEN-\d+", "should I file", "new ticket for");
- **no** Notion search or lookup ran since Erez's last real message. Lookups include `notion-search`, `notion-fetch`, the `notion-ticket-lookup.ps1` script, and a REST `databases/<id>/query`.

It then injects one line telling Claude to search the board first and lead with any match. Because the "For you" block is written after the Stop hooks run (the block-after-check convention in global CLAUDE.md), the nudge lands before the decision is put to Erez.

**Where.** Extend the existing `~/.claude/hooks/stop-foryou-nudge.js`. It already reads the turn's transcript tail (`followupState`, about lines 773–796) and has a once-per-(session, prompt) slot pattern (`claimRenudgeSlot`, about line 802). Caution: this hook's prompt text is coupled to global CLAUDE.md rules and is LOAD-BEARING, because the For-you block rides its continuation. It must exit silently on any error. If /vet-code's design /check prefers a separate small Stop hook, that is acceptable.

**Required design points.** These come from the plan's reviews.
- Fire at most once per turn, so the nudge can't re-fire on the block message.
- Signal path: each fire appends one line to a new append-only log, `~/.claude/hooks/search-first-nudges.jsonl` (ts, session_id, prompt_id, matched pattern).
- Add a **/wrap readout step**, modeled on Step 3e "Grounding-flag readout" (`~/.claude/skills/wrap/SKILL.md` lines 121–125):
  - It shows one line only on a session where the nudge fired: this session's count, the lifetime count, and the newest fire.
  - Erez decides from those numbers whether the patterns are worth keeping.
  - This is a skill edit, so it goes through `/vet-rule`. It was deliberately deferred until the hook exists.
- Live-fire against the real incident messages, which must fire:
  - the 2026-08-02 "fold into GEN-593 or file as its own ticket" offer (HISTORY entry 2026-08-02 (3); session `6cf57c87-c4cb-4168-8efe-7f9f32a9fb04`, per HISTORY line 95);
  - the 2026-10-08 new-ticket proposal for `test-gen508.js` (GEN-453 session `35cfb8b3-1487-41fc-ae5f-ad0d1e455e0b`).
  - Also run against real past replies that **should stay silent**, to measure noise as well as hits.
- Optional, for the design /check to weigh: GEN-802's single-ask fix is text-only. A second pattern could flag a chat draft of a ticket body when /vet-ticket hasn't run this turn. It is not required; decide in the /check.

**Accepted limits** (tell Erez in plain terms):
- It is a reminder, not a lock. Oddly worded suggestions can slip past it.
- A proposal written in the main reply rather than the "For you" block is already on screen when it fires.

## Close-out (after step C is installed)
1. Re-read the titles and bodies of GEN-606 and GEN-802 against what was built, and update them to reality through `/vet-ticket`. Erez approved the plan that includes these close-out writes, so the new Step 5 "earlier approval stands" applies.
2. GEN-606 → **Review**, assignee Erez. GEN-802 → propose Review, assignee Erez.
3. Verification note on both: over the next 5 ticket proposals, Erez sees a search result before any ask and is asked only once.
4. Consider whether the /check rule-check lens should gain a line on checking always-loaded additions against Erez's size goal and preferring a net-negative version. Per the GEN-58 class G lesson, this is a learning; at /wrap it is filed as a ticket.

## Pickup prompt for the new session
"Continue GEN-606 + GEN-802: read `notes/gen606/HANDOFF.md` in the Improve AI Infra repo — start at 'Step C status (session b4adc493)'. Confirm my reading of Erez's feedback in one line, then redesign step C so the search runs once, before the For-you summary, and still catches the ~83% of proposals that today land inside the block; reuse the built working copy; through /check then /vet-code. Effort xhigh."
