# GEN-508 — fix the core, not the symptoms

## Context

GEN-508 is a "ticket-quality gate": a PreToolUse hook arm (`enforceTicketVetting` in
`~/.claude/hooks/auto-approve.js`) plus a `/vet-ticket` skill, meant to force an independent reviewer
sub-agent to check ticket-quality rules before any Notion ticket create/edit reaches the wire. It is designed
to convergence and built to working copies (`notes/gen508-piece1/`), but **nothing has ever been installed** —
the live hook is untouched.

It has been through six design rounds, a "collapse," a mechanism replacement (v7→v8), and a narrowing to the
Notion-MCP surface (piece 1a). Yet the last review round (three cold Opus reviewers, 2026-08-05) still returned
three BLOCKING findings, plus open items and two design decisions. Each session patches the latest findings
and the next finds more. Erez's instruction: **fix the core, not the symptoms** — which is the project's own
"stop-and-re-derive" rule applied to GEN-508 itself.

> **Correction (recorded so it isn't re-proposed):** an earlier draft of this plan diagnosed the transcript-
> token verification as out-of-scope "anti-forgery" machinery and recommended deleting it. A `/check` panel,
> grounding in `design-converged.md` §6.2 (:1447-1510) and §14 (:2249-2259), refuted that: the token check is
> the **in-scope omission defense** — it proves the sanctioned review actually ran on *this* content, closing
> holes §6.2 says need **no forgery** (a `verdict:REVISE` slipping through; citing an unrelated reviewer's
> agentId). Deleting it would reopen the exact momentum-omission failure the gate exists to stop. This plan
> keeps the check and fixes the real core.

## The core diagnosis (verified against the code and the design this session)

The mechanism is fundamentally **sound for its threat model** (§1: stop Claude *skipping* the review; deliberate
evasion is out of scope). The finding-stream does **not** come from a wrong architecture. It comes from one
root, plus a set of genuine defects that sit on top of it:

**Root — no executable layer checks the cross-artifact contract.** Every recurring finding has the same shape
(the design's own appendix names it): *a guarantee asserted in one artifact whose realisation lives in another
that doesn't exist, isn't wired, or isn't checked.* The hook, the skill, the exempt-file, and the design each
assert things the others don't realise, and the test suite checks the hook's **exit codes but not its reasons**
and never tests the hook↔skill seam at all. That is why the same class of defect (five skill/hook drifts across
three rounds; a carve-out fixed three times) keeps returning. Fixing this root is what stops the stream.

The blocking findings live at their true homes (not all in one "half" — the earlier "scope sound / auth rotten"
split was imprecise; the content hash is shared state computed inside `ticketScope` at :2252):
- **Authorization mechanism:** BLOCKING 2 (hash doesn't bind the tool), BLOCKING 3 (skill re-asserts a
  disproven premise), the expiry ceiling gap.
- **Scope/exemption realisation:** BLOCKING 1 (GEN-58 exemption has a writer that doesn't exist), #6 (a
  rotated data source reads as out-of-scope), #4 (break-glass voids the gate unlogged).
- **The test layer itself:** it can't see whether the right branch fired — the root, made concrete.

## Step 1 — Verify the load-bearing unknown FIRST (gates everything, before any decision)

**Does PreToolUse even fire for sub-agent-originated tool calls?** Unverified (design §14, :2270). If it does
not, a sub-agent files an unreviewed ticket straight past the gate and *no* record work matters — the fix would
be a different enforcement point. Six rounds have reviewed the lock without confirming the door is bolted on.

- Live experiment: spawn a sub-agent, have it attempt a gated Notion write on a Team-Tasks row, observe whether
  `enforceTicketVetting` runs (event-log row / refusal).
- Fires → proceed. Does not fire → stop and re-derive the enforcement *layer*; report to Erez before more work.
- This runs before the Step-2 decision, because a negative result changes coverage scope and would re-open it.

## Step 2 — Reconfirm the feature is still wanted (Erez's call, proportionality)

After six rounds and a never-installed ~1,766-line arm for a behavior a CLAUDE.md rule already asks for, "fix
the core" warrants one explicit reconfirmation before more building. Name the lighter levers plainly so the
choice is informed; **recommendation: keep the hard gate** (a behavioral rule alone is exactly what has been
failing under momentum):
- *Detect-and-surface only* (log un-reviewed ticket writes, no block) — much lighter, but drops the settled
  "airtight stop on an unverified write."
- *Single-use pass without the content-hash* (drop the normaliser + `--ticket-hash` CLI) — simpler, but loses
  the "payload edited after review re-blocks" catch, which is itself an anti-momentum property.

## Step 3 — Fix the core root: make the cross-artifact contract executable

This is the deepest fix and the one that stops the finding-stream. In the test suite
(`test-gen508-v8-arm.js` / `test-gen508-harness.js`):
- **Reason-level assertions:** every block assertion checks the *reason*, not just `exit 2` (today ~18
  assertions check only the exit code, so a block for the wrong reason — or a dead carve-out — stays green).
- **Cover the untested branches** (enumerated so the layer is complete on the first pass): the expiry ceiling,
  `isSafeTicketHash`, `transcript-too-large`, `consume-failed`, `internal-error`, both `scope:'out'` returns,
  the waive assertion (today it leaves a valid sidecar + token on disk, so it never exercises the bypass it
  names), and section D's fictional root-`old_str` shape. (Re-verify the "~18 exit-2-only" count against the
  suite — it comes from the README's own audit.)
- **Move the corpus fail-open sweep into the gating suite** (today it lives only in the stale `test-gen508.js`,
  so no running test asserts any quantitative fail-open claim).
- **Add a hook↔skill contract test:** grep the skill for the killed premises and fail if present; assert the
  skill's literal record/pass template round-trips the hook's readers; assert the hash has one definition
  (the `--ticket-hash` CLI) called by both; and pin the `--ticket-hash` shell allow-list entries (the
  self-approve regex ~:3277 and `isSafeTicketHash` ~:3543) so a CLI-argv change can't silently drop the pin.
  This is what stops the recurring skill/hook drift.
- **Optional, gated:** assess whether any transcript-parser precision can be reduced *without* reopening §6.2's
  traps (brief-in-same-file, self-explaining-reviewer, doc-string quoting) — and only if a test can pin the
  result. The parser's core job (assistant-authored + sidecar `agentType: check-reviewer` + last
  `TICKET-REVIEW-VERDICT: PASS <hash>`) stays; do not delete it.

## Step 4 — Fix the genuine engineering defects (all needed regardless of Step 2)

In `auto-approve.working.js`, each shipped with a Step-3 assertion:
- **BLOCKING 2 — fold the tool into the key.** `ticketContentHash` hashes the payload alone (:2243-2247);
  `ticketRecordMatches` matches on it alone (:2926); a pass minted for `update-page` was spent on
  `notion-duplicate-page` (which spawns a live ticket). Change the key to
  `sha256(stableStringify({surface:'notion-mcp', tool, root}))`, **including the `!norm.ok` fallback digest at
  :2246** (or BLOCKING 2 reopens on the unreadable-payload path). The fold point is the one shared
  `ticketContentHash` (:2243), called by both the hook (via `ticketScope` :2252) and the `--ticket-hash` CLI —
  so the formula changes in one place, but the record-format contract changes across the coupled sites (the
  exact class that caused five prior drifts, so treat them all as in-scope): the CLI's argument contract; the
  skill's invocation (it calls `--ticket-hash` with no tool argument today); and the `--ticket-hash` shell
  allow-list entry (`isSafeTicketHash` / its regex ~:3277-3543 — one mechanism) which must still match the new
  argv. **The Step-3 contract test must assert the fix at the formula level — a cross-tool NEGATIVE: a record
  minted for tool X must NOT clear a write under tool Y** (the live BLOCKING 2 repro: an `update-page` record
  spent on `duplicate-page`); a `--tool` arg threaded through the plumbing while `ticketContentHash` still
  ignores it would otherwise pass a naive test.
- **Expiry ceiling — enforce it, but NOT in the shared reader.** `findPassInDir` (:655-656) checks only
  `exp < now`, so a 2099 expiry approves. Put the ceiling in the **ticket-scoped** path (e.g. `ticketRecordMatches`,
  which already receives the parsed pass) or as a per-caller cap — **do not add it to `findPassInDir`**, which
  is the single shared reader for the staging/vetting/check-due dirs; a ticket-sized 15-min cap there would
  reject longer-TTL sibling passes, including `/vet-code`'s — the gate that installs this very hook (a
  self-bricking path).
- **Closed-shape record validation** (reject unknown keys) — subsumes the "field written and read by nothing"
  class.
- **BLOCKING 3 — full premise sweep (a root instance).** Remove the disproven "the mint write prompts him —
  that prompt IS the gate" premise and the false "raw REST writes can't run silently" claim **everywhere they
  appear**: hook comments, `vet-ticket-SKILL.md` (Steps 2/5/7, the Honest-ceiling), and design §14 — not just
  the skill's opening. Step 3's contract test then guards against re-drift.

## Step 5 — Fix the scope/exemption defects (each carries an Erez decision)

- **BLOCKING 1 — build the missing GEN-58 exemption writer.** The hook reads `ticket-gate-exempt-pages.txt`
  (:1978) but nothing writes it, and the hardcoded seed is the ticket *row* (`GEN58_PAGE_ID`) not the log
  *volume*, so every real reasoning-failure log write hard-blocks — against the standing "log immediately"
  rule. Third fix to this carve-out → do not re-derive it semantically a third time. Recommended: build the
  `/vet-ticket` GEN-58 lane as the single writer (verify the volume's parentage off the blocking path, append
  the volume id) **and fix the seed** to reach the volume children. Erez's design call.
- **#6 — a rotated/second Team-Tasks data source reads as out-of-scope and silently approves, unlogged**
  (:3082; `containerTeamTasks` computed at :2160, read nowhere). **Do NOT "fail closed on unrecognised
  container"** — the only container recognition is `TEAM_TASKS_IDS` membership, so "unrecognised" = *every*
  non-Team-Tasks database, and fail-closed would gate every other-DB create workspace-wide (breaking the
  stated "create into another database → free" guarantee). Be honest about detection: **there is none today** —
  the `'out'` return logs no event (:3082), and §10's drift counter measures *over*-gating on gated writes, so
  it cannot see this *under*-gating escape (it would read a false all-clear). So a rotation is a silent approve
  of unreviewed creates until noticed by hand. The **core fix** (matching "fix the core, not symptoms") is a
  **marker-liveness probe** that lives *outside* the hot hook path (at install and/or `/wrap`, where network is
  already allowed — not reintroducing the network hop the collapse removed): query the live Team-Tasks data-
  source id(s) and alert if they diverge from the data-source member of the hardcoded `TEAM_TASKS_IDS` — a
  set/superset check, so a *new additional* source counts as divergence — and it must **fail loud on a lookup
  error** (a probe that reads "couldn't check" as "all clear" recreates the same false-all-clear). The
  alternative is to accept it as a disclosed residual with §14's maintenance note as the only mitigation.
  Erez's call — probe (piece 1a install-check + a `/wrap` line, or defer the `/wrap` half to piece 3/GEN-636 —
  but install-only leaves a mid-life rotation undetected until the next install) vs. accepted residual — with
  the true cost (silent bypass until acted on, and detection is not prevention: the window stays open until the
  ids are updated by hand) stated, not a gate-vs-block severity axis.
- **#4 — break-glass voids the whole gate, session-wide, unlogged** (`if (configUnlocked()) return;` at :3069,
  before `ticketScope` and before any logging). The content-approval sibling `enforceStaging` clears break-glass
  for **mechanical blocks only**, never the pass-MISS (:758-765). Match that: move `configUnlocked()` down so it
  clears only mechanical blocks (`internal-error`, `unreadable-payload`), never the content decision
  (`no-pass`/`bad-verdict`/`reviewer-unverified`); **log every break-glass skip**; and design its reader — a
  gate-void is at least as decision-worthy as a waive, so surface it immediately in the "For you" stream (piece
  3's "blocks-by-reason" line never covers a *skip*). This change carries its **own** doc sweep — §7, §14, and
  skill Step 9 currently say break-glass suspends the ticket gate entirely — separate from BLOCKING 3's premise
  sweep. Erez's call on whether a wedged session keeps any escape.

## Step 6 — Install path

Once Steps 1-5 are done and the suite is green: run the **full** `/vet-code` — a fresh Pass A **and** Pass B
(Pass B pinned to the strongest tier, per this project's own documented tier lesson) over the combined diff,
because Steps 3-5 add substantial new hook code that has never been code-reviewed and the round-three fixes
still owe a Pass B. Then live-verify (including Step 1's sub-agent-firing result in the install context), write
the Step-1b vetting record, mint the vetting pass, **install the hook and skill together** (a hook-only install
refuses every gated write while pointing at an unrunnable `/vet-ticket`), and run the post-install check.

## Out of scope (explicitly)

- **Piece 2 (raw REST/curl arm + Jira)** = GEN-635. REST code stays built-but-unwired. Note: the transcript-
  verification machinery is shared across the sibling gates and the parked REST arm reconnects "as a
  reconnection not a rebuild" — so any Step-3/Step-4 change to the shared contract must be ported to the
  siblings and recorded for piece 2 (REST carries the only DELETE operations).
- **Piece 3 (aggregate signal readers, the `/wrap` blocks-by-reason line)** = GEN-636.
- **Self-mintable pass directories** (GEN-670/671/672) — deliberate evasion, excluded by the threat model.
- **Reviewer competence** (a real but shallow review) — neither design solves it (§14); not a regression.

## Verification (end-to-end)

- `node test-gen508-v8-arm.js` green with the new reason-level + branch + contract assertions.
- `node test-gen508-rest-parked.js` still exits 0 at its parked baseline.
- The corpus fail-open sweep (now in the gating suite) reports 0 unexplained out-of-scope verdicts.
- Live: Step 1's sub-agent-firing experiment passes; an "edit" pass cannot clear a "duplicate" (BLOCKING 2); a
  far-future expiry is rejected (and no sibling gate is locked out); a real GEN-58 log write to a volume child
  falls through (BLOCKING 1); a rotated container surfaces a drift signal (#6); a break-glass skip emits a log
  row and surfaces immediately (#4).
- `/vet-code` post-install check confirms the live hook + skill behave as the suite predicts.

## Critical files

- `notes/gen508-piece1/auto-approve.working.js` — hash `:2243`, matcher `:2926`, break-glass `:3069`, shared
  reader/expiry `:655`, container `:2160`/`:3082`, exempt seed `:1650`/`:1978`, enforceStaging break-glass
  scoping `:758-765`, PASS-path forensics `:3147-3157`.
- `notes/gen508-piece1/vet-ticket-SKILL.md` — GEN-58 writer lane, killed premises (Steps 2/5/7, Honest-ceiling),
  the `--ticket-hash` invocation (no tool arg today), waive text.
- `notes/gen508-piece1/test-gen508-v8-arm.js` + `test-gen508-harness.js` — Step 3 assertions/contract test.
- `notes/gen508-piece1/design-converged.md` — §1 threat model (:304), §6.2 the token (:1447), §14 honest limits
  (:2249).
- `notes/gen508-piece1/README.md` — the three round histories and the open-items list.

## Notes for execution (not code)

- GEN-508 is the session's primary ticket; set it In Progress once we leave plan mode and begin (can't mutate
  in plan mode).
- Steps 2, 5 (BLOCKING 1 approach, #6 remedy, #4 scope) carry Erez decisions — bring each to him one at a time
  during execution, not as a batch.
- Every code change goes through `/vet-code`; every design/skill-rule change through the normal check flow.
- A reasoning-failure (the inverted "delete the forensics" diagnosis) is to be logged to GEN-58 once out of
  plan mode.
