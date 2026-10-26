---
name: vet-code
description: "Vet and apply a change to a live Claude-infra hook or script (~/.claude/hooks/*.js, ~/.claude/scripts/*.ps1) — or a settings.json hooks-registration change — through the mandatory /check + two code-review passes (one in-session, one independent sub-agent) + live-verify flow, then mint the single-use vetting pass the auto-approve hook requires. Trigger on /vet-code, on any request to change/create a hook or script, or when the auto-approve hook blocks such a change with a 'vetting lock' refusal."
---

# /vet-code — gated, vetted changes to live hook/script code

A live hook, script, or `hooks`-section change is hard-blocked by `auto-approve.js` unless a valid,
single-use **vetting pass** exists; this skill is the only sanctioned way to mint one.
**The hook enforces the gate; this skill enforces the process.** Never hand-mint a pass to skip a step.

**How to use this runbook.** Each step lists what must not be skipped; where it says "Before doing
this step, read `<file>`", open that file first on every run, even after a compaction.
`gate-mechanics.md` in this folder is shared with `/vet-rule` (use its `/vet-code` column): changing
it changes both gates. History: `background.md` in this folder. Editing this skill: keep this file
at 12,000 characters or fewer and under 500 lines (size checker, `/suggest` 4b); new detail goes in a reference file.

---

## Scope — what is gated (and what this skill covers)

- Any live hook file `~/.claude/hooks/*.js` (direct-child only; `hooks/refs/*` is not a hook).
- Any live script `~/.claude/scripts/*.ps1`.
- A change to the `hooks` section of the global `~/.claude/settings.json` (registering/disabling a
  hook = changing what code runs). A `text-replace` to settings.json is gated conservatively (its
  args can't be reliably parsed to prove hooks are untouched); a `write-file` is gated only if the
  `hooks` section actually differs (theme/model/permission edits are NOT gated).
- **NEW files:** the hook can only gate MODIFICATION of an existing file (it anchors on on-disk
  existence). Creating a NEW hook/script falls through to a normal prompt — so YOU must run this
  skill for a new file too, and run the full vet before creating it.
- **NOT in scope (separate follow-up):** project-level `<project>/.claude/settings.json` hook
  registration — a distinct, currently-ungated surface tracked separately. Don't rely on this skill
  to gate those.

## Diagnostic-probe fast-path — the ONE narrowed lane (read this before Step 0)

A throwaway observe-only probe may skip Steps 1, 1b and 3 only when live registration is genuinely
required AND it is read-only, has no decision logic and is torn down the same session; when in doubt
it does not qualify. Mint-approval (Steps 6–8) and teardown are never skipped. Before using this
lane, read `C:/Users/Erez/.claude/skills/vet-code/probe-fastpath.md`.

---

## Step 0 — Gate self-check (fail closed)

- Grep `~/.claude/hooks/auto-approve.js` for `enforceVetting` and `findVettingPassFile`; either
  missing → REFUSE and tell Erez the hook must be fixed first.
- `/code-review` not available → STOP; no pass may be minted. Never degrade to a lighter check.
- Confirm the Agent tool and the `check-reviewer` sub-agent type are available.
- Read the exact model ID from this turn's environment banner and run
  `node "C:/Users/Erez/.claude/hooks/stop-foryou-nudge.js" --classify <model-id>`. `listed-at-above`
  or `newer-in-family` → proceed (for the latter, tell Erez to add it to Part 2 of
  `notes/effort-model-reference.md`); `listed-below`, `unlisted`, no model or no JSON → say so now:
  Step 3 stops for Erez's call.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/reviews.md` (Step 0).

## Step 1 — Design review (/check)

Run `/check` on the DESIGN of the change (what it should do and how), to convergence. This produces
`check-reviewer` sub-agent transcripts in this session — the evidence the mint step verifies.

## Step 1b — Write the vetting record

Right after `/check` converges, write the vetting record into `~/.claude-staging/vetting-passes/`:
bound by `target` + `contentHash` (full normalized working copy), with the `agentId` of every Step 1
`check-reviewer` — captured NOW, before Pass B, whose ids go in `passBAgentIds` instead.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/gate-mechanics.md` (table, section 1).

## Step 2 — Build to a WORKING COPY

Build the change in a scratch/working copy (e.g. under the scratchpad), NOT the live file. For an
edit to auto-approve.js or notion-ticket-lookup.ps1 the live file is doubly locked anyway.

## Step 3 — Code review (two passes: one in-session, one independent)

- **Pass A:** in-session `/code-review` at HIGH effort on the working-copy-vs-live diff.
- **Pass B:** Agent tool, `subagent_type: check-reviewer`, given ONLY that diff as literal text plus
  an adversarial brief (floor: fail-open; data-loss/crash) — nothing of Pass A's findings. Pin its
  `model` to the session's own family alias (`opus` / `fable`), never a stronger family; append each
  run's `agentId` to `passBAgentIds`, never to `checkReviewerAgentIds`.
- Step 0 found the model below the floor, unlisted or unknown → STOP and ask Erez before either pass;
  if he signs off, record `belowFloorSignoff` first.
- Fix every real finding from both. Non-trivial fixes → re-run BOTH once; still failing → stop and
  surface it to Erez. For `auto-approve.js`, `node --check` the working copy.
- The secret-on-command-line check (GEN-639) on the working copy is mandatory.
- Both passes are mandatory on every full run; only the probe fast-path skips them.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/reviews.md` (Step 3).

## Step 4 — Live-verify

- Exercise the change through its REAL caller; confirm the new behavior AND a regression pass.
- **Step 4 input realism** (any guard, gate or detector): include real production inputs from this
  machine's transcripts — the whole corpus of past decisions if one exists, else at least 10 real
  inputs at the decision boundary. Any false fire FAILS unless Erez signs off after seeing the
  count. Redact before quoting.
- **Step 4 pass-CONSUMPTION assertion** (any pass-gated target), in a FIXTURE tree, never the real
  target: valid pass → approved AND renamed `*.consumed.<ts>`; no pass → blocked (exit 2); the
  multi-line form of the same command → refused (exit 2), pass NOT consumed.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/live-verify.md` (Step 4).

### Step 4a — Antivirus-survival check (background-launch changes ONLY)

If the change causes new background execution, judged by effect (it spawns or detaches a process,
writes and runs a script, or registers a scheduled task, even indirectly): record its real trigger; pass
checkpoint 1 in-session (artifacts still present AND downstream effect landed); checkpoint 2 stays
PROVISIONAL and is armed at Step 8a; the ticket goes to Review, not Done. Never parse the
antivirus's quarantine store.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/live-verify.md` (Step 4a).

## Step 5 — Show Erez + approve

Attest with results: the `/check` verdict; both passes' merged outcome; the Pass B model check, run
now (the model each Pass B actually used, read from its transcript); live-verify counts; the
secret-on-command-line outcome; for a guard/gate/detector, input-realism corpus size, fires and
false fires; after Step 4a, exactly "survived in-session (checkpoint 1); next-trigger survival
PENDING (trigger: X)" — never "antivirus-verified safe". Get his explicit approval to apply.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/reviews.md` (Step 5), plus
its Step 6 Pass B model check, which runs here.

## Step 6 — Evidence precondition, then mint

Before minting: the record for THIS target exists; its `contentHash` equals the current working
copy; `checkVerdict` is converged; `checkReviewerAgentIds` is non-empty and each transcript is on
disk, `check-reviewer`, earliest `timestamp` <= `draftedUtc`; the Pass B model check passes. Any
check fails → REFUSE to mint. Then mint `"kind": "vetting"` (15-minute expiry) into
`~/.claude-staging/vetting-passes/` with the Write tool — that prompt IS the gate. One pass per target.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/gate-mechanics.md` (section 2)
and `C:/Users/Erez/.claude/skills/vet-code/reviews.md` (Step 6 — Pass B model check).

## Step 7 — Apply

ONE write per target, never a sequence of `Edit`s; prefer `update-config.ps1 -File "<literal
absolute path>" -Op write-file -ContentFile "<working copy>"`; issue the gated write as a SINGLE LINE
(a multi-line one is refused, exit 2); `auto-approve.js`, `notion-ticket-lookup.ps1` and
`settings.json` only via `update-config.ps1`; never a shell copy/move; never leave a still-valid,
unconsumed pass behind. A partial landing → retire any live pass, re-mint, re-apply the whole
working copy as one write.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/gate-mechanics.md` (section 3).

## Step 8 — Verify installed

Confirm the installed file is byte-identical to the approved working copy (`contentHash`); report the
apply's exit status plainly; for a hook, live-fire one real input. Confirm NO valid vetting pass for
this target remains in `~/.claude-staging/vetting-passes/`: a still-live `*.json` is a FAIL (GEN-436
bar) — retire it and investigate. Before doing this step, read
`C:/Users/Erez/.claude/skills/vet-code/live-verify.md` (Step 8).

**Ticket-gate hook only (GEN-508 #6):** if the installed target is `auto-approve.js` and it contains
`enforceTicketVetting` (the ticket-gate arm), also run the `/vet-ticket` **Marker-liveness probe** against
the just-installed hook. A `DIVERGENCE` or `LOOKUP-ERROR` here is an install FAILURE — and because Step 7
has already written and consumed the pass, the hook is now live and blind to its board, so **revert to the
prior hook (or fix `TEAM_TASKS_IDS` and re-verify) before relying on the gate, surface it to Erez, and do
NOT report the gate live** (a gate that cannot confirm its own board must not stay switched on). No-op for
every other target.

## Step 8a — Arm the checkpoint-2 re-check (background-launch changes ONLY)

Only for a Step 4a change, after Step 8 confirms a byte-identical install: create ONE one-time
scheduled task (`create_scheduled_task`, shaped like `gen430-avast-recheck`), `fireAt` = now + a
DWELL from the trigger's cadence, self-contained prompt. The run is not complete until your handoff
names the task id + `fireAt`; if it can't be created, note "NO automated firing" on the Review
ticket and tell Erez.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/live-verify.md` (Step 8a).

## Step 9 — Recovery (failure / expiry)

A consumed pass is gone: re-mint (re-prompting Erez) and retry the single apply. A changed working
copy → re-vet, never force. Break-glass is for a wedged session only.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/gate-mechanics.md` (section 4).

## Break-glass OPEN/CLOSE commands (sentinel + reaper token)

The OPEN and CLOSE PowerShell blocks are in
`C:/Users/Erez/.claude/skills/vet-code/gate-mechanics.md` (section 5). First edit the OPEN block's
three leading values (`$hrs`, `$flow`, `$reason`), then run each block as ONE multi-line call in
exactly that shape, never collapsed to a `;`-chained line; after CLOSE both `Test-Path` lines must
print `False`.
