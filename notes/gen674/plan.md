# Plan: GEN-674 bundle, shrinking the always-loaded global rules file

## In plain words (for Erez)
**What this fixes.** Your main instructions file is read in full at the start of every session. That slows sessions down and is over Anthropic's recommended size. The plan makes it smaller without losing any rule. After Wave 0, the honest range is about 13-17% smaller with today's tools, or up to about 35% if Wave 3's "first-action hold" is built (see `notes/gen674/inventory.md`). The levers:
- Overlapping rules are merged and wordy ones tightened.
- Rules needed only in certain situations move into short notes that appear automatically when that situation comes up: working on tickets, editing rules, writing messages to other people.
- A guard is added so the file can't grow back.

**What you'll see.** Five working sessions. Each ends with one approval card showing exactly what changes, and nothing changes without your OK. Your rules keep their meaning. Some will simply appear only when relevant.

**Steps and effort:**
1. **Decide the "can this rule move?" test (high).** I'll ask you one plain question: should a rule move out only when its note is guaranteed to arrive before the moment the rule matters? Saying yes is safer but frees less space.
2. **Tidy the rules every session needs (high).** Merge duplicates, shorten wording, fix the contradictions the audit found, add section headings.
3. **Rework the rules about how I report to you (xhigh).** This covers the "For you" block, staying quiet on success, and the effort tags. Some automatic checks quote these rules, so they are updated together. You decide how chatty I should be during long work, because the audit found I go too quiet.
4. **Build the situation-triggered notes and move rules into them (xhigh).** Each note has its own trigger, so they never crowd each other out. Every move is tested live before you approve it.
5. **Add the regrowth guard (high).** Any future proposal that grows the file must come with a smaller version first.

**Your cost:** one decision in step 1, one in step 3, and five approval cards. **Risk:** a moved rule could be missing in a session whose wording never triggers its note. Triggers are kept broad, and a rule stays put if its trigger can't be relied on.

**Other tickets this closes:** 12 related open tickets are folded in (listed below). Two look already out of date, and I'll propose closing them. The Invoice Automation rules file comes after, as its own job.

Effort to execute: xhigh overall (steps 3 and 4); steps 1, 2 and 5 at high.

## Context
GEN-674 (child of GEN-882): the global `~/.claude/CLAUDE.md` loads into every session. Measured 2026-10-20 (Node): 207 lines, 49,439 code points.
- **Acceptance:** 200 lines or fewer AND a real character reduction from 49,439, or a documented exception Erez approves.
- **Approved finish line (2026-08-05):** "nothing is loaded every session unless it's needed every session". Rules relocate rather than being deleted.
- **Approved conditions:** search the hooks and skills that quote a rule before touching it, and move no rule without a named trigger that reliably fires.
- **Not yet approved:** the stricter movability test (GEN-341). It is Step 1's decision.

**Research (3 read-only agents and 3 /check reviewers, 2026-10-20):**
- Rough split by characters: about 55% every-session, about 38% trigger-only, about 7% duplicating a hook or skill. This is an estimate.
- Quoting hooks: `stop-foryou-nudge.js`, `stop-claim-linter.js`, `pretooluse-effort-tag-gate.js`, `auto-approve.js` (chain rule, around :688), and the signal hooks.
- Quoting skills: /suggest (cites about 10 rules by opening phrase), /vet-rule (:61-63), /wrap `step1-capture.md`, config-health, audit-rules.
- `inject-topic-refs.js`:
  - It has one shared prompt cue (Notion-only) for all topics.
  - The 10,000-character cap is shared by every topic in one registration (lines 199-212). A note that doesn't fit is deferred to the next matching call.
  - `fitToCap` cuts above about 9,500 characters.
  - Markers are per topic and per sub-agent, and reset after compaction.
  - Sub-agents get only tool triggers, never prompt cues.

## Bundle
**Folded into GEN-674 and closed with it:**
- GEN-341 (movability test)
- GEN-126 (merge overlapping clusters)
- GEN-158 (merge reply-format rules)
- GEN-172 (conciseness, global file only)
- GEN-862 (two "ask which ones" rules become one)
- GEN-476 (absorbed in the merge, no growth)
- GEN-477 (dependency markers go in the hooks)
- GEN-741 (Backlog vs Blocked clause, offset in the same rule)
- GEN-897 item F2 (one-item-at-a-time vs batched cards)
- GEN-131 (section headings only)
- GEN-300 (leftover shell items, decided by the test)
- GEN-581 (target-loaded check on every move)
- The 2026-10-18 audit findings on this file

**Last wave of the bundle:** GEN-837 (Highest), with GEN-173 merged in.

**Kept separate, done after:**
- GEN-888 and GEN-667 (Invoice Automation file)
- GEN-130 (blocked on GEN-93)
- GEN-231, GEN-262, GEN-227 (any additions must fit the new size; prefer skills)
- GEN-700, GEN-891, the rest of GEN-897, GEN-666, GEN-507, GEN-291, GEN-813

**To propose closing:** GEN-132 (memory files gone) and GEN-296 (wording gone).

## Waves (each its own session; one /check panel and one approval card each)
**Wave 0: decision and inventory (high).**
1. Put the stricter test to Erez in plain words.
2. Write `notes/gen674/inventory.md`, listing per rule:
   - its class (every-session / trigger / duplicate);
   - for trigger rules, the named prompt cue AND tool trigger, and whether the note arrives before the action the rule governs;
   - for duplicate rules, the enforcing file:line and whether its scope is the same as or wider than the rule's (example: L65's /vet-ticket covers only Notion, so its Jira part stays);
   - every hook and skill that quotes it;
   - whether a sub-agent must follow it. Sub-agents get no prompt cues, so such a rule needs a tool trigger before its first governed call, or it stays.
3. Re-estimate the savings from the inventory and restate the target.

**If Erez rejects the stricter test:** rules that must govern the first matching action stay resident. The target is recomputed from the inventory, and if 200 lines can't be met without forcing moves, a documented exception goes to him.

**Wave 1: tidy every-session rules no hook quotes (high; /vet-rule).**
- Contents: merges (126, 862, 476), the conciseness pass (172), audit fixes for "re-examine from scratch" (L43), step-at-a-time vs act-don't-ask (L67/L99), F2, GEN-741, removal of ticket-number tags, and section headings.
- Rules that skills quote by opening phrase (e.g. /suggest, /vet-rule:62) get their skill quotes updated in the same change.
- No moves. No hook-quoted rules.

**Wave 2: reporting rules plus the hooks that quote them (xhigh; /vet-rule and /vet-code).**
- Rules: silence (L79), three buckets (L81), "For you" block (L83), effort tag (L85, including the pinned model name), silent edits (L87).
- Merge them (158). Erez decides the silence/heartbeat behaviour.
- Re-sync `stop-foryou-nudge.js`, `stop-claim-linter.js` and `pretooluse-effort-tag-gate.js` in the same change, with dependency markers in each (477).

**Wave 3: on-demand notes (xhigh; /vet-code, /vet-rule).**
- **New topics,** each with its own prompt cue, tool trigger and hook registration, so each has its own cap and none is deferred:
  - "tickets": prompt cues Notion/Jira/GEN-/ticket; tool trigger any Notion or Jira MCP call, including reads.
  - "rule editing": cues CLAUDE.md, rule, skill, hook; tool trigger Edit/Write on a CLAUDE.md, a skill or a refs file.
  - "outward comms": cues Slack, Jira, Confluence, email, release notes; tool trigger a Slack/Gmail/Atlassian write.
- **Code change:** `inject-topic-refs.js` itself changes. Today `fires()` uses the shared Notion cue list, so each topic needs its own cue-pattern field and a new `TOPICS` entry.
- **Registration:** `settings.json` is locked, so it changes through `update-config.ps1`.
- **Rule-editing timing:** that note's tool trigger fires after the point where /check should already have run. Its rules move only if the prompt cue reliably arrives first; otherwise they stay resident.
- **Co-firing:** measure the combined size when all three new notes fire together (up to about 28K) during the live-fire.
- **Matchers:** keep each new registration's tool matcher narrow (the named MCP tools, Edit|Write), never Bash, to limit per-call cost.
- **Cue test:** a Slack-only prompt fires "outward comms" and not the Notion topics.
- **Load and timing:** on one Notion call, record the combined context load of "tickets" plus the existing Notion notes, and time the extra hook processes.
- **Moving rules:** only rules that pass the Wave 0 test move. Small single-topic rules go to existing notes or skills only where the inventory shows room. Nothing is added to `notion.md` or `jira.md`.
- **Duplicates become one-line pointers** only where the inventory shows the enforcer's scope is at least as wide as the rule. The chain rule stays, because the `auto-approve.js` refusal quotes it.
- **Same change:** update every citing skill (the /suggest ledger, /wrap `step1-capture.md`, /vet-rule). Leave a one-line index in the resident file.

**Wave 4: regrowth guard, GEN-837 + GEN-173 (high; /vet-rule).**
- /check returns REVISE on net growth of an always-loaded file and offers the pointer or offset version first. It builds on GEN-893.
- Guard text goes in reference files with one-line pointers, because `vet-rule/SKILL.md` is near its cap.

**Close-out:**
- The global file is 200 lines or fewer AND its characters are well below 49,439, or Erez approves an exception.
- Re-read each folded ticket against what was built, then close it.
- Propose closing GEN-132 and GEN-296.

## Sizes (measured 2026-10-20, Node, code points)
- `~/.claude/CLAUDE.md`: 207 lines → target 200 or fewer (estimate ~150), against a recommended limit of 200 lines. Characters 49,439 → about 41-43K without the Wave 3 hold, up to about 31-33K with it (Wave 0 estimate; characters have no limit).
- Each new topic note: under 9,500 characters, against a hard cap of 10,000 per registration.
- `vet-rule/SKILL.md`: 11,348 → no net growth, against a hard cap of 12,000.
- `wrap/SKILL.md`: 11,877 → untouched, against a hard cap of 12,000.
- `check/SKILL.md` 12,575 and `suggest/SKILL.md` 11,417: pointer-sized edits only, well under the 20,000-character re-attach cut.
- `notion.md` and `jira.md`: no additions.

## Verification (each wave)
- Size check before and after.
- A cross-reference script: every rule opening quoted in hooks and skills still exists. Pattern: `notes/gen845/xref-check-*.js`.
- Hook tests through the real integration.
- Wave 3 live-fire:
  - each cue alone;
  - co-firing cues in one prompt (e.g. "update the ticket and the rule"), checking every note arrives whole;
  - a sub-agent tool trigger.
- Install byte-identical to the reviewed text, then sync the config.

## Residual
- A moved rule is absent if neither its words nor its tools come up. Triggers are broad, a resident index names each note, and only rules passing the test move.
- After compaction, notes return on the next matching prompt or tool call.
- Savings are estimates until Wave 0.
- Don't run /wrap in a parallel session during a wave (GEN-813).
- Broad cues will fire some notes in sessions that don't strictly need them. That costs context but is harmless.
