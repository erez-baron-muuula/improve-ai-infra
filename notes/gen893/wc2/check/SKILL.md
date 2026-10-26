---
name: check
description: "Run an independent reviewer panel on a proposal and iterate to convergence. Trigger on /check or a request to review/converge the last answer or proposal — designs, rules, CLAUDE.md edits, or courses of action (not code; use code-review)."
---

# /check — review to convergence

You are the ORCHESTRATOR. Your job is to take a proposal (a design, a rule/`CLAUDE.md` edit, or a course of action) and run it through a panel of **fresh, independent reviewer sub-agents** — iterating revise -> re-review until it **converges** (no reviewer holds an open material finding) or you must escalate.

The value comes entirely from **independence**: the reviewers did not write the proposal and have no stake in approving it. This catches confident errors that self-review misses. Do not rubber-stamp, and do not let your own authorship bias leak into the panel.

This skill **refines the proposed answer in the conversation only**. It NEVER edits the user's source files in place — even if the artifact under review is a file edit, you revise the *proposed text in chat*; the user applies the final converged version themselves.

There is **one depth**: when invoked, you always run the full panel to convergence. There is no quick/single-pass tier. (If the user wants only the first round, they read round 1 and tell you to stop — the work is untouched.)

---

## Phase 0 — Identify the artifact and scope

1. **Find the artifact under review.**
   - Retroactive ("check that" / "review the last answer to convergence"): the artifact is your own most recent substantive proposal in the conversation.
   - Proactive ("...and review it to convergence" inside a request): the artifact is the answer you are about to give — produce your best proposal first, then review it.
   - If it is genuinely ambiguous what to review, ask the user one short question. Otherwise proceed.

2. **Confirm it is in scope.** Designs, rules/`CLAUDE.md` edits, and courses of action are in scope. **Code is out of scope** — point the user to `/code-review`. A plain factual lookup or a finished mechanical task generally needs no convergence review; say so rather than spinning up a panel for nothing.

3. **State the original user goal verbatim.** Capture, word for word, what the user actually asked for. This exact text goes into every reviewer brief (a paraphrase can inject a false premise). Hold it as `GOAL`.

---

## Phase 1 — Assemble the panel (adaptive)

Spawn fresh independent reviewer sub-agents via the **Agent tool**. Pick lenses by what the artifact is:

- **Pre-mortem** — ALWAYS. Adversarial failure-mode hunt. **This lens also carries the premise-challenge brief** (see below).
- **Holistic / proportionality** — ALWAYS. Does it deliver all goals with the least machinery; is there a simpler/wider/unconventional way; is anything a goal needs missing. Its smallest-design test mirrors `/suggest` check 4; edit both together.
- **Soundness + grounding** — ALWAYS. Internal logic; and a "show your work" provenance check on load-bearing claims.
- **Rule-check** — ONLY when the artifact is a proposed rule or a `CLAUDE.md` edit. Reads the live rules file first, then checks the rule properly.

**Spawn every applicable lens in parallel** (one message, multiple Agent calls).

**Reviewer agent + model:** spawn each reviewer via the Agent tool with `subagent_type: check-reviewer` (read-only tools, no permission prompts) and `model: sonnet`. Independence comes from fresh context, not model tier — do not switch tiers for decorrelation. Two exceptions, both bump to `model: opus`:
- The user signals difficulty ("check this hard" / "really scrutinize this") -> use Opus from round 1.
- You reach the round cap without converging (see Phase 3) -> bump the final round to Opus.

---

## Phase 2 — Brief each reviewer

Every brief MUST contain, in this order:

1. **The independence framing** — "You did not write this; you have no stake in approving it; do not rubber-stamp; do not invent issues to seem thorough."
2. **`GOAL` verbatim** — the original user request, word for word.
3. **The artifact under review** — inline, in full.
4. **The lens-specific task** (templates below).
5. **The material definition** — "MATERIAL = would cause real harm or defeat the user's goal. A preference or nice-to-have is NOT material and must never block."
6. **The exact verdict-block template** (below) — tell them to end with it verbatim.
7. **On re-review only:** the prior round's findings, and the re-review scoping rule (Phase 3).
8. **The provenance rule**, verbatim, so reviewers can apply it: "Treat any claim presented as verified that lacks inline provenance — a file/line, command output, or doc URL — as unverified."

**Provenance gate (on the orchestrator, before spawning):** every load-bearing fact you place in a brief must carry its provenance inline — the file/line, command output, or doc URL where you verified it this session — or be explicitly labeled unverified. Memory, a sub-agent's relay, or a source that covers only an adjacent capability (one that verifies a related but different fact) does not count as verification.

**Premise-challenge (goes in the PRE-MORTEM brief):** "You are additionally designated to CHALLENGE THE PREMISES the author treats as settled — not just the proposal. Is any assumption being relied on actually false or unverified? A false premise propagates to the whole review. Where the proposal depends on how a platform or vendor tool behaves — including a behavior it leaves for a later live test — look that behavior up yourself in the vendor's own docs and changelog (search the changelog, read long pages in full, follow pointers to other pages); a contradiction there is material."

### Verdict-block template (reviewers end with EXACTLY this)

```
---VERDICT---
STATUS: PASS | REVISE
MATERIAL FINDINGS: (numbered. For each: the flaw + why it is material + a concrete fix. On re-review, tag each finding you carry over as one of: RESOLVED / RECURRENCE / NEW-FROM-REVISION. Write "none" if PASS.)
ADVISORY (non-blocking): (optional notes, including "verify before relying" grounding flags; or "none")
```

### Lens task templates

- **Pre-mortem:** "Run a pre-mortem. List concrete failure modes across correctness, cost, time/effort, maintenance, edge cases, and assumptions/dependencies. For each: is it handled? Surface unstated assumptions; flag any claim asserted from memory rather than verified. State honest residual risks. Check that each proposed fix does not spawn a new problem. If the proposal builds a signal-producing mechanism for a later decision, confirm its surfacing path (per `/suggest` check 4a) is designed in, not deferred to a residual." (+ the premise-challenge paragraph above.)
- **Holistic:** "Restate the goals. Is there a solution delivering ALL of them with minimum effort/complexity and maximum accuracy? Search wider — include unconventional, indirect, or 'hacky' mechanisms. Is each part of the proposal actually needed (smallest design that still meets every goal)? If it creates or grows a size-limited file, does it carry the size checker's `size:` lines and follow check 4b of `C:/Users/Erez/.claude/skills/suggest/SKILL.md`? A departure from 4b is MATERIAL. Is anything a goal requires missing? If the proposal builds a signal-producing mechanism for a later decision, confirm its surfacing path (per `/suggest` check 4a) is designed in, not deferred. Conclude 'nothing better' only after a genuine from-scratch pass."
- **Soundness + grounding:** "Check that each claim/mechanism logically holds and the proposal is internally consistent. Then a grounding pass: for every LOAD-BEARING claim, is it cheaply checkable (then it should be checked), actually FALSE (this BLOCKS — material), or unverified-but-load-bearing (flag as 'verify before relying' — ADVISORY, non-blocking)?"
- **Rule-check (only for a rule / `CLAUDE.md` edit):** "FIRST read the live rules file the rule targets (global: `C:\Users\Erez\.claude\CLAUDE.md`; or the project `CLAUDE.md`). THEN check the proposed rule for: conciseness; clarity (no fuzzy/undefined terms, no double readings); accuracy; generality (not over-fit to its triggering example; an example earns its place only when removing it would change the behavior the rule produces — i.e. the wording would otherwise be genuinely ambiguous, or it shows a literal form the prose cannot reproduce; flag any example that is decorative, could instead be stated as a qualifier in prose, or uses the real-world event that prompted the rule); non-redundant (NAME the existing rules you compared against); non-conflicting (NAME any rule it could conflict with); clears-the-bar (changes future behavior, will recur, not already covered, timeless, not a fact that belongs in HISTORY/memory); effective (would actually produce the intended behavior); positively phrased (states the behavior to take, not only what to avoid, where that keeps the meaning without materially adding length — unless a genuine prohibition [safety, scope limits, hard constraints], which stays an explicit negative); cross-references (a rule that refers to another rule names it by a distinctive quoted phrase from it, such as its opening words, or a whole section by its heading — never by position, which breaks silently when rules are reordered or merged); right home (correct file and section — and the right *kind*: a skill if it would only fire when the user invokes a named task; a hook if it fires automatically on a system event (tool call, file op) needing no judgment; otherwise a rule); and load tier (for any rule/text destined for an always-loaded file [global or project `CLAUDE.md`, read every session regardless of relevance, so each addition carries a standing per-session cost]: the test is NOT 'does it apply at some decision point' [almost everything does] but whether a reliable prior signal — a specific named context, tool, or task — becomes active before the decision and would cue Claude to look the rule up on demand; if such a signal exists, the rule can live in a separate reference file or skill reached by a one-line always-loaded pointer [propose that, to cut per-session cost]; if there is no such signal [Claude would act wrongly with no cue to check], keep it always-loaded; reliability wins ties — a pointer can't guard a 'forgot-to-check' failure, so keep it always-loaded when in doubt)."

---

## Phase 3 — The convergence loop

Keep a `ROUND` counter, starting at 1.

1. **Collect verdicts.** Read every reviewer's verdict block.
2. **Converged?** If every live lens returns `STATUS: PASS` (zero open material findings — advisory flags do NOT block), you are **converged**. Go to Phase 4 (converged exit).
3. **Otherwise revise.** Address each material finding by revising the *proposed answer in chat* (never the source file). You may NOT silently overrule a material finding a reviewer holds:
   - If you agree -> fix it.
   - If you think the finding rests on a false premise or is factually wrong, **verify it from a primary source** and resolve it on that evidence (record what you checked). Resolving-by-evidence is allowed; dismissing-by-assertion is not.
4. **Re-review.** Increment `ROUND`. Re-spawn the lenses that still held findings (fresh agents), giving them the revised artifact AND their prior findings. **Re-review is on-scope only:** they judge whether each prior material finding is now RESOLVED, and may raise a genuinely NEW material issue only if it was *introduced by the revision* or *changes the recommendation*. **No fresh wishlist** of new minor preferences. The orchestrator counts the reviewers' own tags — you cannot close a finding a reviewer still tags RECURRENCE.
5. Loop back to step 2.

---

## Phase 4 — Stop / escalate

**Converged exit:** present the final converged proposal to the user, plus any ADVISORY notes (clearly marked non-blocking). State that it converged and in how many rounds.

**Escalate (surface the standoff, do not loop forever)** when ANY of:
- the **same material finding survives two fix attempts** (tagged RECURRENCE twice), OR
- two lenses **irreconcilably conflict** (resolving one re-opens the other), OR
- you hit the **3-round cap** (`ROUND` would exceed 3) without converging. At the cap, run the final round on `model: opus` before escalating.

On escalate: present BOTH positions plainly to the user — your proposal and the still-open finding(s) — name the accepted residual risks, and stop. Do not pretend convergence you did not reach.

---

## Output discipline

- The internal markers (verdict blocks, tags, round counter) are your bookkeeping — do not dump raw reviewer transcripts on the user. Report: the outcome, the material findings and how each resolved, advisory notes, and round count.
- Never edit the user's source files as part of `/check`. The converged text is yours to hand back; applying it is the user's call (and follows the normal approval rules). Convergence is a quality signal, not the user's go-ahead: if an approval question was open before this panel ran, re-surface it with the converged result and wait for the user's explicit reply before anything is applied — unless the user's own prior instruction already made a converged `/check` the trigger to proceed.
