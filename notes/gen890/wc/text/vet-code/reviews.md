# /vet-code — model check, the two code reviews, and what to attest

**Contents:** Step 0 gate self-check · Step 3 code review (two passes) · Step 5 what to attest · Step 6 Pass B model check

Reference for `/vet-code` Steps 0, 3, 5 and 6 (the Pass B model check). The runbook is
`C:/Users/Erez/.claude/skills/vet-code/SKILL.md`; the shared record/mint/apply mechanics are in
`C:/Users/Erez/.claude/skills/vet-code/gate-mechanics.md`.

---

## Step 0 — Gate self-check (fail closed): full text

Before vetting anything, confirm the hook's vetting guard is present and intact. If not, the gate has
a hole — REFUSE and tell Erez the hook must be fixed first. Grep `~/.claude/hooks/auto-approve.js` for
`enforceVetting` and `findVettingPassFile`; both present → proceed.

Also confirm `/code-review` is available in this session (it's a session skill). If it is NOT
available, STOP: the vetting bar (which requires a code review of the diff) cannot be met, so no pass
may be minted. Tell Erez plainly; do not degrade to a lighter check.

Confirm the Agent tool and the `check-reviewer` sub-agent type are available (Step 3's Pass B needs
them). And classify the session's model tier: read the exact model ID from this turn's
environment/system-context banner (not from memory) and run
`node "C:/Users/Erez/.claude/hooks/stop-foryou-nudge.js" --classify <model-id>`. That is the one
classifier for the model floor — it reads the floor and tier lists live from
`notes/effort-model-reference.md` in the Improve AI Infra repo, so this skill keeps no copy of the
list. Act on the `class` it prints:
- `listed-at-above` — at or above the floor; no model prompt is needed.
- `newer-in-family` — not listed yet, but a newer point release of a listed at-or-above family
  (Erez's 2026-09-24 decision): treat it as at or above the floor — no stop — and tell Erez the model
  should be added to Part 2 of that file.
- `listed-below` or `unlisted` (the latter also covers "the file can't be read"; its `listError` then
  says why) — or the banner names no model, or the command fails or prints no JSON: say so now and
  don't start vetting silently; Step 3 will pause for Erez's call on the model before running the
  passes.

This is a WARNING at this step (Step 0 otherwise fail-closes only on a missing vetting guard or missing
`/code-review`); the model decision itself is made at Step 3, where the passes run.

---

## Step 3 — Code review (two passes: one in-session, one independent)

Run TWO code-review passes on the working-copy-vs-live diff and fix every real finding from both
before this step is met. A single pass, even at high effort, can confidently certify code clean while
missing real bugs; a second pass run by a reviewer with no knowledge of the first catches misses the
first anchored past. The catch comes from the second reviewer's fresh context, not from more effort.

- **Pass A — in-session `/code-review` at HIGH effort.** Full power: it reviews the live working tree
  and can run live checks. It is NOT independent — it runs in this session and shares its context — so
  it is the power pass, not the blind one.
- **Pass B — an independent read-only reviewer sub-agent** (Agent tool, `subagent_type: check-reviewer`),
  given ONLY the diff (the same working-copy-vs-live diff this step reviews) plus the adversarial brief
  below — nothing of Pass A's findings. The main session computes the diff first and passes it as
  literal text in the sub-agent prompt, since the sub-agent has no shell of its own. This is the blind
  pass: genuine cold independence, but static — it can't run shell or live-probe, so the encoding/lock-style
  fail-opens that need execution to surface are caught by Pass A or by Step 4, not by Pass B. If Step 4
  later surfaces a fail-open of that kind, loop the fix back through this step's re-review rather than
  shipping it straight through.
- **Model.** Independence comes from Pass B's fresh context, not from model tier, so don't switch tiers
  to decorrelate. This gate guards code that runs unattended with elevated trust and can fail open (leak
  a secret, wave through a dangerous command, lose data), so it wants a capable reviewer — but the model
  is Erez's to choose, and this skill must never reach for a stronger model family/tier on its own. Use
  Step 0's classification of the session model. **If it was `listed-at-above` or `newer-in-family`**
  (at or above Erez's floor, per `notes/effort-model-reference.md` in the Improve AI Infra repo):
  run both passes on the session's tier — Pass A inherits the session model; pin Pass B's Agent call
  **explicitly** to the session's family via the Agent tool's `model` alias (`opus` for an Opus session,
  `fable` for a Fable session), since the `check-reviewer` agent otherwise defaults to Sonnet, silently
  below the floor. The alias resolves to that family's current version, so Pass B runs in the session's
  own family — at or above the session's version, and never a different, stronger family; it never
  reaches Fable unless the session is already on Fable. Record the `agentId` the Agent tool returns for
  EACH Pass B run (including a re-run after fixes) by appending it to the vetting record's
  `passBAgentIds` array — never to `checkReviewerAgentIds` — leaving the record's other fields as they
  are; Step 6's Pass B model check reads each one's own transcript to verify it actually ran in the
  intended family and not the Sonnet default. No prompt, no cross-family escalation. **Otherwise** —
  Step 0 classified the session model `listed-below` or `unlisted`, the banner named no model, or the
  classify command failed — STOP before running the passes and ask Erez: a safety-critical review is
  about to run below his bar; his call is (i) proceed on the current model with his explicit sign-off,
  or (ii) abort and re-invoke `/vet-code` from a stronger session. If he chooses (i), record his
  sign-off in the vetting record as `"belowFloorSignoff": "<the session model ID>"` BEFORE running the
  passes, then run both passes as above — Pass B pinned to the session's own family alias, its
  `agentId` appended to `passBAgentIds` — so Step 6 can tell his approved run from a silent downgrade.
  Never proceed silently and never escalate to a
  stronger family/tier without his sign-off. (Pass B is now pinned to the session's family rather than a
  fixed top tier, so both passes share the session's family; the old 'weak Pass A is only a warning
  because Pass B stays strong' reasoning no longer applies — below-floor is a real stop point Erez
  decides, not a silent degrade. If the design ever drops Pass B or lets Pass A gate something Pass B
  doesn't, revisit this.)

Brief Pass B adversarially, against the vetted file's own failure-consequence: assume it is unsafe and try to
make it fail in the way that matters for what it does. At minimum:
- **Fail-open** — can the file's guard/gate be made to wrongly approve, pass, or treat-as-safe something
  it must block? (e.g. a secret slipping past a scanner via an odd encoding; a permission check waved
  through by a malformed input; an unreadable/locked file treated as clean.)
- **Data-loss / crash** — an unhandled exception that aborts a run partway; a destructive op (move,
  overwrite, restore) that can lose data; a partial-failure state left behind.

Add any further adversarial angle the specific change suggests — these two are the floor, not the whole
list. Merge both passes' findings, dedupe (by file+line, or by description for whole-file findings), and
fix every real one. If the fixes are non-trivial, re-run BOTH passes once more; if real findings still
persist after that, stop and surface the standoff to Erez rather than looping further. For
`auto-approve.js` specifically, run `node --check` on the working copy as part of this step — a syntax
error there would brick the gate for the next session.

**Secret-on-command-line check (mandatory, GEN-639).** Before this step is met, search the working
copy for a secret placed where a command line would carry it, and fix every real hit — or show it to
Erez at Step 5 with why it is safe. The shapes: an `Authorization`/`Bearer`/`X-Api-Key`/`api-key`
header value that is an element of a spawn/exec argument array (e.g. `execFileSync('curl.exe',
['-H', 'Authorization: Bearer ' + token])`) or follows `-H`/`--header` on a native-exe command line;
`-u <user>:<variable>` basic auth; a URL query (`?key=`, `&token=`, `access_token=`) built from a
variable. A secret belongs in an in-process request header, an environment variable the child
inherits, or a temp curl config file passed with `-K` (`-q` first) — never in argv, which a process
listing can read and a Node spawn error prints in full (the GEN-638 leak). A starting search:
`rg -n -i "authorization|bearer|x-api-key|api[-_]?key|\s-u\s+\S+:\S|[?&](key|api_key|apikey|token|access_token)=" <working copy>`
— then judge each hit by where the value GOES, not by the word alone (an in-process headers object
or a config-file write is fine). It is a heuristic for the known shapes, not a proof.

Both passes are mandatory on every full `/vet-code` run; the sole exception is the diagnostic-probe
fast-path (see `C:/Users/Erez/.claude/skills/vet-code/probe-fastpath.md`), which skips Steps 1/1b/3
under its own three-condition gate and NOTHING else. Every file that reaches this gate runs unattended
with elevated trust, so there is no "is this one dangerous enough?" judgment call to make — that
judgment is exactly the thing that fails. This refusal holds for any code that *persists* past the
session; the fast-path's conditions do not reintroduce it — they gate on a probe being *plainly torn
down same session* (no persistent blast radius at all), not on a graded danger assessment.

---

## Step 5 — Show Erez + approve: what to attest (full text)

Show Erez the change and ATTEST the checks ran, with results: the `/check` verdict; the merged
code-review outcome from both passes (A: in-session `/code-review`; B: independent cold sub-agent),
including the result of Step 6's Pass B model check, run now — the resolved model ID each Pass B run
actually used, read from its own transcript, not merely that the call meant to pin it (a silent revert
to the default tier defeats the point exactly where it matters most); the live-verify pass/fail
counts; and the Step 3 secret-on-command-line check — every real hit left unfixed, and why it is safe
(or that there were none). For a guard, gate, or detector,
also attest the Step 4 input-realism outcome explicitly — corpus size or real-sample count, fires,
and false fires (or that real input could not be sampled, and why the authored set is
representative); a generic "live-verify passed" does not cover it, and any false fire on real input
needs his sign-off here. Get his explicit approval to apply.

**For a background-launch change (Step 4a ran):** attest EXACTLY what antivirus-survival was verified
— "survived in-session (checkpoint 1); next-trigger survival PENDING (trigger: X)" — and NEVER
"antivirus-verified safe." Because verification completes only at the next trigger, the change's
ticket goes to **Review, not Done**; the pending re-check is armed as a one-time scheduled task at
Step 8a (not carried as a passive note), and the ticket moves to Done only when that task fires and
checkpoint 2 clears.

---

## Step 6 — Pass B model check (GEN-527)

Run this alongside the shared evidence check in `gate-mechanics.md` section 2, before minting.

**Pass B model check (GEN-527).** Confirm the record's `passBAgentIds` is present and **non-empty**
(the same vacuous-loop reason as in `gate-mechanics.md` section 2). For EACH id, in the same `subagents` dir, confirm the
`agent-<id>.meta.json` reads `"agentType":"check-reviewer"`, then run
`node "C:/Users/Erez/.claude/hooks/stop-foryou-nudge.js" --agent-transcript "<subagents dir>/agent-<id>.jsonl"`
and require ALL of:
- `error` is null;
- `allSidechain` is `true` — the file really is a sub-agent transcript, not the main session's;
- every entry in `models` has the same `name` as the session model's `name` from Step 0's
  `--classify` (Pass B ran in the session's own family, per Step 3);
- the overall `class` is `listed-at-above` or `newer-in-family` — the command reports the weakest of
  every model the run used, so a mid-run fallback to a weaker model fails. The one exception: when
  the record carries `belowFloorSignoff` (Erez approved running below the floor at Step 3), any
  `class` is accepted, because the check above still requires Pass B to have stayed in the family he
  approved — a drift to any other family still fails.
Use only this command's output for the model: the `.meta.json` `model` field is the requested alias
(e.g. `opus`), never the model that actually ran. Any check fails → REFUSE to mint, tell Erez which
Pass B run failed and what model it resolved to. (Step 5 already ran this check to show him the
result; re-run it here, since it is read-only and the record may have changed since.)
