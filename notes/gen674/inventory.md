# GEN-674 Wave 0: inventory of the global rules file

Baseline, measured 2026-10-20 with Node (code points) on `~/.claude/CLAUDE.md`:
- 207 lines, 49,439 characters.
- The size check reports `BREACH recommended claude-md-lines` (206 vs 200).

Plan: `~/.claude/plans/come-up-with-a-rippling-nebula.md` (approved 2026-10-20).

## Decision
Question: "How strict should the 'can this rule move?' test be?"
- Option 1, strict: a rule moves only if its note is sure to arrive before the first moment the rule matters; otherwise it stays.
- Option 2, looser: it moves as long as some reliable trigger exists.

Erez: "strict" (2026-10-20).

The test used below: a rule leaves the resident file only if a delivery mechanism guarantees its text is in context before the first action or reply the rule governs. Otherwise it stays.

## Delivery mechanisms that meet the strict test
- **G1, skill-carried.** The governed action only ever happens inside a skill run that a hook gate forces:
  - Notion ticket writes go through /vet-ticket, forced by the auto-approve ticket gate.
  - Global and skill rule edits go through /vet-rule plus /check, forced by the check-before-present lock.
  - The rule's text lives in that skill or its reference file.
- **G2, Read-before-Edit. Not used.** Its only source is a code comment (`inject-edit-refs.js:7-10`), with no docs citation, and no verdict below relies on it.
- **G3, the rule's own trigger phrase.** The rule fires only on a phrase in Erez's prompt (e.g. "apply learnings"), so a prompt cue on that phrase is guaranteed to arrive first.
- **G4, first-action hold. Not built; Wave 3 candidate.** A PreToolUse hook refuses the first governed write of a session once, with the note text as the reason, so the retry is composed with the rule in context. Today's tool-triggered notes arrive with the call, which is too late under the strict test. A note still arrives when another hook blocks the call (`inject-topic-refs.js:30-32`), so G4's value is forcing the call to be composed again, not delivering the note. The auto-approve chain guard and `deny-askuserquestion.js` refuse with the rule in the reason; the latter refuses every call, not just the first.
- **Refusal text.** Already live where a guard refuses the action and its message states the rule.
- **Not enough on its own:** a prompt cue on topic words (Notion, Jira, Slack…). The prompt may not contain the word before the governed moment.

## Where the "Quoted by" column comes from
- **Generated:** `quote-map.js` writes `quote-map.txt`. For each rule it searches the rule's first 6 words plus listed key phrases, case-insensitively, across `~/.claude/{skills,hooks,scripts,commands,agents}`, `settings.json` and every project `CLAUDE.md`.
- **Limits:**
  - Key-term hits (e.g. "GEN-58", "For you\" block") overcount, because they list every mention, not only quotes.
  - Paraphrased citations are missed.
  - Re-run the script before each wave, and treat its output plus the list below as the quote list. The table column shows only the main ones.
- **Added by hand (found by reviewers; the script misses them):**
  - `release-review/SKILL.md:192-196` cites L45 (the Blocked→To Do exception, an unattended authorization), L57, L59 and L63 ("Task template applied").
  - `wrap/step1-capture.md:20` cites the always-loaded-rule bar (L123/L125).
  - `/suggest` `SKILL.md:3,38,125,133` cite L39, L113, L43, L33/L153.
- **Comments inside locked hooks that quote rules:**
  - `auto-approve.js:1528,1680,1736` quote L129, including its "purely mechanical fix" clause. W1 keeps that clause's wording; any change to it moves to Wave 2 (hook wave).
  - `auto-approve.js:509,688` quote L75.

## Verdict per rule
Key:
- **KEEP**: stays resident (every session, or no guaranteed-before mechanism).
- **MOVE**: moves now via a named G mechanism.
- **COND**: moves only if Wave 3 builds G4 and live tests pass; otherwise KEEP.
- **PTR**: an enforcer already covers the full scope, so the rule is dropped or becomes a pointer.
- **W1/W2**: tidied in that wave.

Character counts are per line (Node).

| Line | Rule | Chars | Verdict | Mechanism / scope note | Quoted by |
|---|---|---|---|---|---|
| 1-3 | Projects directory + new project | 529 | KEEP | — | — |
| 5-11 | Projects table | 1,058 | KEEP | read by /wrap, audit-rules, cleanup-sweep | wrap SKILL:15, step1-capture:23, audit-rules:19, cleanup-sweep.ps1:34 |
| 13 | List projects if no task | 273 | KEEP | — | — |
| 19 | Personal context | 263 | KEEP | — | audit-rules:20 |
| 23-29 | Conflicts, concise, which file, link everything | 981 | KEEP, W1 tighten | — | — |
| 31 | Slack threading | 400 | COND | G4 on Slack send/schedule/draft | — |
| 33-43 | Honesty, third parties, self-check, /suggest pointer, verify, draft | 2,477 | KEEP, W1 (L43 audit fix, L35/L41 tighten) | — | /suggest:3,125,133 |
| 45 | Ticket status | 1,153 | COND | prompt cue + G4 on first tracker write | — |
| 47-51 | Done vs Review | 755 | COND | same | cited by L65 |
| 53 | Follow-up ticket assignee | 210 | COND | Notion: G1 into /vet-ticket review; Jira: G4 | — |
| 55 | Record decisions verbatim | 187 | KEEP, W1 merge with L119 (GEN-862) | applies to HISTORY and notes too | — |
| 57 | Status at creation | 1,022 | COND | Notion: G1 (/vet-ticket); Jira: G4. W1 adds GEN-741 clause, offset | step1-capture:26, readouts-3b-3c:20 |
| 59 | Route by domain | 370 | COND | Notion covered by vet-ticket `review.md:102` (G1); Jira: G4 | step1-capture:23 (quote already drifted) |
| 61 | Name by outcome | 326 | COND | Notion covered by vet-ticket `review.md:101` (G1); Jira: G4 | — |
| 63 | Team-Tasks template | 91 | MOVE | G1 for creates (the ticket gate, `auto-approve.js` ~1773-1912). Goes into a step of `vet-ticket/SKILL.md` itself, not only a reference file; check that file's 12,000-character cap. Not in `notion-write.md` or vet-ticket today | step1-capture:26 ("the standing Team-Tasks rule") |
| 65 | Draft full ticket proposal | 1,357 | COND (partial) | Notion: vet-ticket (G1) covers it. Jira: /staging covers summary/description edits only, not creation, so the Jira part stays unless G4. The GEN-58 exception clause stays with L191 | step1-capture:6, L57, L191 |
| 67 | One step at a time | 84 | KEEP, W1 (audit F3 vs L99) | — | L173 |
| 69 | Feedback items one at a time | 219 | KEEP | — | — |
| 71 | Create follow-up tickets immediately | 264 | COND | with tickets | — |
| 73 | Question is not authorization; /check | 1,150 | KEEP, W1 tighten | — | /suggest:29,148; L99 |
| 75 | No mixed-risk chaining | 243 | KEEP | the guard misses mixed-risk pipes (narrower scope) | auto-approve.js:688, refs/shell.md:8 |
| 77 | QA-layer legend | 283 | W1 drop | reword its two uses (L93 "Layer 3", L191 "QA Layer 5") in plain words | — |
| 79-87 | Silence, buckets, For-you block, effort tag, silent edits | 8,261 | KEEP, W2 rework | — | stop-foryou-nudge, stop-claim-linter, pretooluse-effort-tag-gate |
| 89-91 | End-of-turn QA, verify mutations | 1,060 | KEEP, W1 tighten | Notion part partly duplicated by notion-write-verify | — |
| 93 | Snapshot before destructive ops | 750 | KEEP, W1 tighten | Notion part is already a pointer | — |
| 95 | Ask before unrequested info | 35 | KEEP | — | — |
| 97 | Review requests to everyone | 359 | COND | G4 on comms writes | — |
| 99 | One item at a time; plain terms; act | 1,440 | KEEP, W1 (F2, F3) | — | /vet-rule:62, /suggest:149,167 |
| 101 | No internal rule names | 437 | KEEP | — | — |
| 103 | Research before outward comms | 838 | KEEP | drafting happens in chat before any tool call; topic words not guaranteed | — |
| 105-107 | /compact, /wrap | 1,153 | KEEP, W1 tighten L107 | the /wrap skill holds the detail | — |
| 109 | Memory consolidation | 189 | KEEP | small; a new trigger is not worth building | — |
| 111, 121 | Learn from mistakes; suggest rule fixes | 197 | W1 merge into L125's first sentence | — | — |
| 113 | Check existing capability | 504 | KEEP | — | /suggest:38 |
| 115 | Validate extracted numbers | 575 | COND | "data" trigger (node/python/az/Sheets reads) + G4; not guaranteed today | — |
| 117-119 | Numbered lists; autocomplete/yes | 584 | KEEP, W1 (119 merge, GEN-862) | — | — |
| 123 | New-rule bar | 662 | COND | G1 if the /check rule-check lens's clears-the-bar covers it, including skill/hook proposals; scope check in W3 | — |
| 125 | Surface learnings; where a rule lives | 1,406 | Split: first sentence KEEP; "where a rule lives" COND → /check rule-check lens (right home, load tier) | lens runs only on rule/CLAUDE.md edits; check hook/skill proposals | L181 |
| 127 | Signal surfacing | 536 | KEEP | — | /suggest:76, /check briefs, signal hooks |
| 129 | /check before CLAUDE.md edits | 623 | KEEP, W1 tighten, leaving the "purely mechanical fix" clause word for word | project files aren't hook-gated (narrower scope) | /vet-rule:61, L181, auto-approve.js:1528,1680,1736 (comments) |
| 131 | Rule-drafting style | 1,013 | MOVE, keeping a pointer | Move the detail into the /check rule-check lens (`check/SKILL.md:79`, which already has positive phrasing and example-earns-place), adding the quoted-phrase cross-reference clause. Keep a pointer of about 130 characters inside L129, because project CLAUDE.md files aren't lock-gated (`vet-rule/SKILL.md:54-55`) and drafting happens before /check runs. The /check-before-presenting rule (L129) catches a non-conforming draft before Erez sees it | — |
| 133 | Redline convention | 165 | KEEP | — | — |
| 135 | Assumptions before code | 824 | KEEP, W1 tighten | governs chat before any write | — |
| 137, 141-145 | One question; slash commands; pushback; literal identifiers | 844 | KEEP | — | — |
| 139 | AskUserQuestion pointer | 199 | PTR → drop | `deny-askuserquestion.js` refuses every call with the full redirect (full scope); update its comment at :9 | deny-askuserquestion.js:9 |
| 147 | Mutation ID from target URL | 262 | COND | with tickets (G4 on first tracker write) | — |
| 149-151 | Unknown abbreviations; contradictions | 530 | KEEP, W1 (151 merge, GEN-476) | — | — |
| 153 | Destructive: expect vs can't predict | 442 | KEEP | — | /suggest:134, L173 |
| 155-157 | Display vs content; move references | 722 | KEEP | — | — |
| 159 | Rendered form before claiming rendering | 327 | COND | a claim always follows a tracker call, so a tool-triggered note on Notion/Atlassian calls arrives first, but Slack/other surfaces aren't covered | — |
| 161 | No time-varying facts in rule/memory files | 438 | KEEP | memory writes have no guaranteed trigger | config-health:54 |
| 163-169 | Like-for-like; subsumption; exhaustiveness; platform limits | 1,903 | KEEP, W1 tighten | — | /suggest:62 |
| 171 | Brief sub-agents verbatim | 292 | KEEP | the governed action is the Agent call itself | — |
| 173 | Deploy step | 927 | KEEP, W1 tighten | the decision is made in chat before any deploy call | — |
| 177 | Credentials | 629 | KEEP | safety | — |
| 181 | "Apply learnings" | 637 | MOVE | G3: fires only on that phrase. Needs a new phrase cue in `inject-topic-refs.js` with a loose pattern ("apply (the\|these)? learnings"), live-tested. L125 already holds the substance | step1-capture:6 |
| 183 | Dev-facing content | 627 | COND | content-review runs before presenting in the Documentation project only; Slack not covered | — |
| 187 | Refs pointer | 369 | KEEP, becomes the resident index of notes | — | inject-jira-refs.js:8 |
| 189 | `notion-duplicate-page` | 348 | COND | vet-ticket gate covers duplicates into Team-Tasks; other databases not covered | refs/notion.md:1, inject-notion-refs.js:9, auto-approve.js:2750 |
| 191-193 | GEN-58 logging | 1,499 | KEEP, W1 tighten | — | notion-ticket-lookup:129 |
| 195-198 | Shell safety notes | 1,095 | KEEP | they guard the first shell call (GEN-300 answer: stay) | refs/shell.md:1, inject-shell-refs.js:13, shell-howto:3 |
| 200 | Locked config files | 470 | W1 trim to about 250 | The refusal (`auto-approve.js:261-266`) names `update-config.ps1` without its folder or the delete route, and `claude-md-apply.md` omits both. Keep the full path and the "to delete, call `update-config.ps1` directly" tip; drop the file list the refusal already gives | — |
| 202 | Shell readout ≠ client | 523 | KEEP, W1 tighten | — | — |
| 204 | Sub-agents can't run shell | 312 | KEEP | — | — |
| 206 | Analytics | 618 | COND | with the L115 data trigger | — |

## Savings estimate (characters, approximate)
- **MOVE + PTR + W1 drops/merges, certain:** L63 91, L131 about 880 net of its pointer, L181 637, L139 199, L200 about 220, L77 283, L121 138 ≈ 2,450.
- **W1/W2 tightening of resident rules:** ≈ 4,000–6,000. This is an estimate; it depends on the reviewed wording.
- **COND if G4 is built and passes Wave 3 live tests:**

  | Group | Lines | Chars |
  |---|---|---|
  | Tickets | 45, 47-51, 53, 57, 59, 61, 65 (part), 71, 147 | ≈ 5,300 |
  | Comms | 31, 97, 183 | ≈ 1,400 |
  | Rule editing | 123, 125 (part) | ≈ 1,700 |
  | Data | 115, 206 | ≈ 1,200 |
  | Other | 159, 189 | ≈ 700 |

**Outcomes:**
- **Without G4:** about 49.4K → 41–43K characters, about 190–195 lines. That meets the 200-line target with a real cut of about 13–17%.
- **With G4:** up to about 31–33K characters and 150–160 lines. This is a ceiling: several COND rows stay partly resident even with G4 (Slack parts of L159 and L183; Jira parts of L53 and L65; the data trigger isn't built).
- **Opportunity:** the Notion halves of L53, L57, L59 and L61 (creation-time) could move into /vet-ticket now through G1, with only the Jira halves left resident. Decide in Wave 3.

## Delivery detail for the rules that move or might move
"Sub-agent?" asks whether a sub-agent could take the governed action. Sub-agents get no prompt cues (`inject-topic-refs.js` marks per `agent_id`); unattended runs (scheduled /release-review, /wrap) act in the main session.

| Rules | Prompt cue | Tool trigger / hold | Sub-agent? |
|---|---|---|---|
| L63 (MOVE) | — | /vet-ticket step, forced by the ticket gate on Team-Tasks creates | No: ticket writes run in the main session; the gate also applies to sub-agent calls |
| L131 (MOVE, pointer kept) | — | /check rule-check lens, forced by L129 and the lock | No |
| L181 (MOVE) | "apply (the\|these)? learnings" | — | No: Erez's phrase only |
| L139, L200 | — | refusal text | — |
| Tickets: L45, L47-51, L53, L57, L59, L61, L65 (Jira part), L71, L147 | GEN-, Notion, Jira, ticket | G4 hold on the first Notion/Jira write of the session (property-only edits too, since the ticket gate exempts them) | Rare: sub-agents are briefed read-only; G4 must also fire per `agent_id` |
| Comms: L31, L97, L183 | Slack, email, Jira, Confluence | G4 by extending `confirm-send.js` (already gates the 5 Slack send tools, `:34-40`); Gmail/Atlassian writes to add | No |
| Rule editing: L123, L125 (part) | CLAUDE.md, rule, skill, hook | /check rule-check lens (G1) if it covers skill and hook proposals; else stays | No |
| Data: L115, L206 | — | G4 on node/python/az runs and Sheets reads: costly, low value | Possible (read-only MCP queries) |
| L159, L189 | — | tracker-call note / ticket gate | No |

## Considered and rejected
- **Native path-scoped `~/.claude/rules/*.md`** (`paths:` frontmatter, loads on Read/Write/Edit of a matching file; docs: code.claude.com/docs/en/memory, "Path-specific rules"). Fits only file-scoped rules (L131, L161), about 1.5K. Whether `paths:` works in the user-level folder is untested. L131 already moves via /check. Revisit only if L161 needs it.
- **Injection keyed to the working folder (project CLAUDE.md or SessionStart):** fails the strict test, because deploy, analytics, outward comms and dev-facing work aren't confined to one folder.
- **Splitting shared Notion/Jira rules** (L57, L59, L61, L65): move the Notion half to /vet-ticket now (G1) and keep a short Jira line. This could save 2-3K without G4. Taken forward as a Wave 3 option (see Outcomes).

## Wave 3 must also fix
- Rules that quote a moved rule. L191 and L57 quote L65's opening, L65 quotes L47's ("Before any ticket goes to Done or Review"), and L45 refers to "the verification check below" by position. Rewrite each, or leave a stub.
- Skill quotes. Update `wrap/step1-capture.md:6` (L181) and `:26` (L63) and `:23` (L59, already drifted) in the same change.
- `release-review/SKILL.md:192-196`: its authorization for the unattended Blocked→To Do move cites L45. Update it in the same change as any L45 move.
- Strict-test wording on the approval cards: the /check lens and the vet-ticket review are checks that run after drafting, not notes that arrive before it. They guarantee nothing non-conforming reaches Erez or Notion. Say so plainly on the Wave 1 and Wave 3 cards.
- The plain-words plan said "about a third smaller". The honest range is about 13-17% without G4 and up to about 35% with it. Restate this on the next card.
- The `/vet-ticket` gate exempts property-only edits on existing rows (`TICKET_HOUSEKEEPING_PROPS`, `auto-approve.js` ~1945). Status rules L45 and L47-51 can never be G1; they stay COND on G4.

## For Wave 3 (open design point)
G4, the first-action hold, is what turns most COND rules into MOVE under the strict test. Its cost is one refused-and-retried call per session per topic, the first time that kind of write happens. It goes through /check and Erez's approval at Wave 3 as a proposal. Without it, COND rules stay.
