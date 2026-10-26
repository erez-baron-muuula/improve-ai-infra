# /vet-code — live-verify (Steps 4, 4a), install check (Step 8) and the antivirus re-check (Step 8a)

**Contents:** Step 4 live-verify (input realism; pass-consumption assertion) · Step 4a antivirus-survival check · Step 8 verify installed · Step 8a arm the checkpoint-2 re-check

Reference for `/vet-code` Steps 4, 4a, 8 and 8a. The runbook is
`C:/Users/Erez/.claude/skills/vet-code/SKILL.md`. Why these checks exist (incident history, honest
limits) is in `C:/Users/Erez/.claude/skills/vet-code/background.md`.

---

## Step 4 — Live-verify

Exercise the change through its REAL caller, not a hand-rolled repro (per the shell how-to rule):
fixtures that pipe real inputs to the hook and assert the decision (approve/block/defer via exit
code + stdout), a real integration run, etc. For a hook, a fake self-consistent `.claude` tree lets
`__dirname`-derived paths resolve to fixtures. Confirm both the new behavior AND a regression pass on
existing behavior.

### Step 4 input realism (mandatory for any guard, gate, or detector — GEN-566)

For a change to anything that inspects input and decides allow/block/flag, a real CALLER is not
enough — the INPUT must be real too. Live-fire MUST include inputs taken from actual production
traffic for the surface the mechanism guards: for a Stop-hook content check, the real final
assistant-turn text of past turns, read from this machine's own session transcripts under
`~/.claude/projects/` (on disk that text sits at `message.content[].text` on `"type":"assistant"`
lines — the runtime payload name `last_assistant_message` is not a key in the file); for a
PreToolUse command guard, the real tool-call inputs recorded in the same transcripts.

**Breadth, so this cannot pass vacuously.** When a real corpus of the mechanism's own past decisions
exists — a detector's nudge log, a guard's denial log — run the WHOLE corpus. Otherwise use at least
10 real inputs, chosen to exercise the decision boundary: some that plausibly SHOULD fire, and some
carrying the required, un-rewordable wording real turns contain and that must NOT fire. Samples
chosen for being easy to pass do not meet this step.

**Bar.** Any false fire on a real input FAILS this step. Proceed only on Erez's explicit sign-off of
that specific residual after he has seen the count; never downgrade it to an advisory yourself.

**Where it is reported.** Step 5's attestation, alongside the fixture outcome: corpus size or sample
count, fires, and false fires. (Not the Step 1b vetting record — that is frozen before Step 4 runs
and has no field for it.) Where real input genuinely cannot be sampled for that surface, state that
in the Step 5 attestation and justify why the authored set is representative.

**Redact before quoting.** Real inputs can carry secrets, tokens, or personal content. Quote only
what a finding needs, truncate long matches, and replace any credential-shaped substring with a
placeholder — the attestation holds counts and redacted excerpts, never a raw dump.

### Step 4 pass-CONSUMPTION assertion (mandatory for any pass-gated target — GEN-506/GEN-562)

Exercising the decision is NOT enough on the sanctioned apply path: you must also assert the pass is
CONSUMED, not merely deferred. Provenance: GEN-503 was a fail-open where every `-Op write-file`
bypassed the gate and shipped through a *passing* /vet-code run because live-verify only checked the
decision, never that the pass was consumed — a gate that defers-instead-of-consumes on its own
sanctioned path is a fail-open only a consume-assertion catches.

**Run this in the FIXTURE tree, not against the real target — this is Step-4 live-verify, which
precedes Erez's Step-5 approval and the Step-6 mint, so there is no real pass yet and a real protected
write here would invert the approve-before-apply invariant.** Use the same fake self-consistent
`.claude` tree the rest of Step 4 uses: a fixture `hooks/`+`scripts/` with a throwaway protected
fixture file, a fixture `~/.claude-staging/vetting-passes/` dir, and a disposable fixture pass minted
into it. Feed the fixture hook the sanctioned apply command as a real caller would. Assert, in ONE
observation:
1. **With a valid (fixture) pass present** → the call is APPROVED **and** the pass file is CONSUMED
   (renamed to `*.consumed.<ts>` in the fixture vetting-passes dir — the live hook consumes via
   `consumePassFile`, `fs.renameSync(full, full + '.consumed.' + Date.now())`). Confirm the rename
   actually happened — list the dir before and after; a still-live `*.json` pass after an approved
   apply is a FAIL (exactly the GEN-503 defer-instead-of-consume fail-open), not a pass.
2. **With NO pass present** → the same sanctioned apply command is BLOCKED (exit 2), never silently
   approved.

**SINGLE-LINE requirement (do not skip — this is a real, distinct fail-open).** `enforceVetting`
cannot read a multi-line shell command (it scores it `MULTILINE`), and since GEN-641 a gated write it
cannot read is REFUSED outright — `exit 2`, pass untouched — not deferred to a prompt. So a
*multi-line* `update-config.ps1` apply, even a correct unchained one, does NOT go through: the call is
blocked and its pass is never looked up or consumed. Therefore: (a) the sanctioned apply command at
Step 7 MUST be issued as a SINGLE LINE; and (b) this Step-4 assertion must exercise BOTH shapes —
confirm the single-line form is APPROVED and CONSUMES the pass (case 1 above) AND confirm the
multi-line form of the same command is REFUSED (exit 2) and does NOT consume the pass — so the gap is
proven, not skipped. A run that only tests the single-line form has NOT met this step. (Do not conflate
this with the Break-glass section's multi-line commands (`gate-mechanics.md` section 5): those touch NO gated target, so the chain
guard lets them fall through to a prompt; here the target IS gated, which is exactly why GEN-641
refuses the unreadable multi-line form.)

This assertion is a required part of Step 4 whenever the change touches a pass-gated file; a run that
only asserts approve/block on the FIXTURE hook but never observes the `*.consumed.<ts>` rename (and the
single-line-consumes-vs-multi-line-refused difference) has NOT met Step 4.

**The FIXTURE-before-apply form is required; a real-path check AFTER apply is not a substitute.** Case 2
cannot be run against the real target before apply: if the gate fell open, that no-pass write would
install unapproved bytes ahead of Erez's Step-5 approval, inverting the approve-before-apply invariant.
And after apply, nothing observed on the real path can still gate anything — the pass is spent and the
reviewed bytes are already installed. A post-apply observation there is Step 8's own GEN-436
confirmation: complementary to this assertion, never a replacement for it.

---

## Step 4a — Antivirus-survival check (background-launch changes ONLY)

Functional correctness is NOT enough for a change that launches background/detached work: a change
can pass every check above, run once cleanly, and be QUARANTINED by the machine's antivirus minutes
later — silently killing it in production. (This is a real incident: a fully-vetted backup-spawner
hook pushed a real backup ref during live-verify, installed clean, then Avast killed the generated
`.vbs` minutes afterward.) So for these changes, functional-correctness alone can NOT complete the
vet — an antivirus-survival check is mandatory.

**Applies when** the change spawns/detaches an OS process, writes-and-runs a script file, or
registers a scheduled task (powershell/cmd/wscript/cscript, drop-and-run a script, schtasks, a
detached `spawn`, etc.). The test is the EFFECT: does this change cause new background execution on
the machine? A change that indirectly causes a launch counts — e.g. writing a scheduled-task XML a
registrar picks up, or dropping a file into a Startup folder — even if no literal spawn call appears
in the diff. It does NOT apply to a change that edits config/data which does not itself cause any new
background launch — a deliberate scope boundary, not an oversight. Ordinary (non-background-launch)
hook/script edits skip this step entirely.

**Record the change's real trigger.** Identify and write down what actually fires this code path in
production — SessionStart, PC logon / scheduled task, `/wrap`, etc. Record it because it sets
checkpoint 2's DWELL length (see Step 8a) — a rare trigger needs a longer dwell and an explicit
recurrence confirmation. Do NOT assume SessionStart.

**Checkpoint 1 — in-session (necessary, NOT sufficient).** After exercising the change through its
real caller, confirm the artifacts it is MEANT to persist still exist at their paths AND its
downstream effect actually landed (ref pushed / marker written) — not merely that the launcher was
invoked. This catches a synchronous or fast antivirus kill. It does NOT prove antivirus-safe: the
incident above passed this exact check and died minutes later. So checkpoint 1 alone cannot complete
the pass.

**Checkpoint 2 — survival after antivirus has had unbounded real-world time.** The change is
applied (Step 7) but its antivirus-survival stays PROVISIONAL. After a dwell long enough for antivirus
to have acted (cloud reputation, definition catch-up, idle scan), re-verify the artifact/effect
survived. The re-check is anchored to a DWELL from apply, NOT to the change's literal own trigger
firing again: survival is trigger-agnostic — a quarantined artifact is gone regardless of what would
have launched it — so one dwell-based re-check catches a kill for ANY in-scope trigger. (Set the dwell
from the recorded trigger's cadence, and for a rare trigger also confirm it actually recurred — see
Step 8a.) This is the checkpoint that would have caught the original incident.

Checkpoint 2 needs a FIRING mechanism, not a passive note — a ticket sitting in Review does not fire
when the trigger next occurs, and relying on a future session to spontaneously remember would
silently recreate the exact miss this step exists to prevent. The firing mechanism
([GEN-435](https://app.notion.com/p/39e6e495d07c8199a8e5c6757df22a8d), landed) is a **per-change
one-time scheduled task** created at Step 8a (which runs right after Step 8 confirms install) — NOT a
passive Review-ticket note. A wall-clock dwell timer is a valid carrier for checkpoint 2 even though
it does not fire on the change's literal own trigger: survival is **trigger-agnostic** — a quarantined
artifact is gone regardless of what would have launched it — so a re-check a suitable dwell after apply
proves "survived unbounded antivirus time" for every trigger type. (Do not reflexively object that the
timer "isn't the own trigger"; the SessionStart-hardcoded design that GEN-435 rejected was wrong for a
different reason — it silently mis-fired for non-SessionStart triggers — which a dwell-from-apply timer
does not.) The change's ticket still goes to **Review, not Done** at apply, and moves to Done only when
the armed re-check actually fires and confirms survival.

**Human fallback (only where no artifact/effect is programmatically observable).** Require an
explicit observation window that covers at least the in-session exercise; the checkpoint-2 re-check
still applies. A human "nothing popped up" glance within seconds is NOT sufficient on its own —
antivirus can act minutes later.

**Do NOT parse the antivirus's own quarantine store.** It is vendor-specific (Windows Defender's
`MpCmdRun` tooling does not port to Avast), its folder is access-restricted, and its log schema is
undocumented and brittle. The outcome-based check above catches ANY antivirus silently killing the
process, without coupling to one vendor.

---

## Step 8 — Verify installed (full text)

Re-read the installed file and confirm it is byte-identical to the approved working copy (the
`contentHash`). Report the exit status of the apply (success/failure) plainly. For a hook, a quick
live-fire (pipe one real input) confirms it loaded. **Also confirm NO valid vetting pass for this
target remains** in `~/.claude-staging/vetting-passes/` (GEN-436 bar): the gated apply should have
consumed it to `*.consumed.<ts>`; a still-live `*.json` pass for this target after apply is a FAIL —
retire it and investigate why it wasn't consumed (that is the GEN-503 defer-instead-of-consume class).

The ticket-gate marker-liveness paragraph of Step 8 stays in the runbook itself (other skills cite it
there).

---

## Step 8a — Arm the checkpoint-2 re-check (background-launch changes ONLY)

Runs ONLY for a change Step 4a classified as background-launch, and ONLY **after Step 8 confirms the
change installed byte-identically** — never on a half-applied or failed apply (a re-check armed against
a change that never really landed would false-alarm). This is the automatic firing mechanism Step 4a's
checkpoint 2 requires (GEN-435).

Create ONE one-time scheduled task via `create_scheduled_task` (the same mechanism as the live
`~/.claude/scheduled-tasks/gen430-avast-recheck` precedent — copy its shape):
- **`fireAt` = now + DWELL.** Set DWELL from the recorded trigger's expected recurrence cadence, NOT a
  blind constant: ~24h for a per-session / daily-ish trigger; longer for a rare trigger (e.g. a
  weekly/monthly scheduled task). For a rare trigger the task's prompt must **confirm the recorded
  trigger actually recurred** (not merely that time elapsed) before treating survival as conclusive.
  (Honest residual: 24h is a working default, not a measured Avast latency bound — the one real
  incident killed within minutes, well inside it, but there is no confirmed upper bound.)
- **A fully self-contained prompt** — the future session that runs it has NO memory of this one. Embed:
  the change summary; the **bare Notion page UUID** of its ticket (NOT a title or URL, which drift on
  rename); the recorded real trigger; and the exact artifacts + downstream effect that must have
  survived.
- **The prompt re-checks survival the gen430 way:** artifacts still present AND the downstream effect
  still holds (e.g. scheduled task still registered / backup ref still pushed) AND ask Erez whether any
  antivirus popup/quarantine occurred since apply AND scan the relevant durable failure queue.
- **Distinguish a KILL from a legitimate supersession:** if the artifact changed because a later
  legitimate `/vet-code` pass superseded it (checkable against the vetting-pass record or git history),
  that is NOT an antivirus kill — do not propose a revert.
- **On survived** → move the change's ticket Review → Done with a dated note. **On kill** → loud alert
  + propose reverting to the safe baseline; leave the ticket open.

**Do not report the `/vet-code` run complete for a background-launch change until you have named, in
your handoff, the created task's id + `fireAt` time.** This is the in-session backstop: it makes a
FORGOTTEN arming visible synchronously (rather than silently never firing). Combined with
`create_scheduled_task`'s own approval dialog (which Erez sees at creation — a real-time forcing
function; the dialog behavior is the tool's own, taken as given from the live scheduled-task precedent,
not independently re-proven here) and Step 5's PENDING attestation, a skipped arming cannot pass
unnoticed within the session.

**If the arm cannot be created** — `create_scheduled_task` is unavailable or errors, or Erez declines
the approval prompt — do NOT silently report complete with checkpoint 2 uncovered. Fall back: put an
explicit note on the change's Review ticket that checkpoint 2 has **NO automated firing** and rides on
manual follow-up (what to re-check + the recorded trigger + dwell), assigned so its owner is
unambiguous, and tell Erez in the handoff. (This is the narrow remnant of the pre-GEN-435 manual carry,
scoped to the arming-failed/declined case only — the happy path is now automated.)
