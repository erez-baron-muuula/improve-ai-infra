---
name: vet-rule
description: "Vet and apply a rule/skill/CLAUDE.md edit that is DUE a /check panel, through: run /check on the exact proposed text to convergence, write a check-record referencing the real check-reviewer transcripts, show Erez the verdict, mint the single-use check pass the auto-approve hook requires, apply, verify. Trigger on /vet-rule, or when the auto-approve hook blocks such an edit with a 'check-before-present lock' refusal."
---

# /vet-rule — gated, /check-vetted edits to rules, skills, and CLAUDE.md

Editing the global `~/.claude/CLAUDE.md`, a skill (`~/.claude/skills/<name>/…`), or a command
(`~/.claude/commands/<name>.md`) is **hard-blocked** by the `auto-approve.js` PreToolUse hook
(GEN-485) when the edit is DUE a `/check` panel, unless a valid, single-use **check pass** exists.
This skill is the ONLY sanctioned way to mint one: it runs `/check` on the exact proposed text,
records the evidence, shows Erez the verdict, mints the pass on his approval (the mint write itself
prompts him — that prompt IS the human gate), applies, and verifies.

**The hook enforces the gate; this skill enforces the process.** Never hand-mint a pass to skip the
`/check`. Do NOT run this skill for a hook/script edit — that is `/vet-code`.

**How to use this runbook.** Each step lists what must not be skipped. Where it says "Before doing
this step, read `<file>`", open that file first on every run, including after a compaction. The
record, mint, apply, recovery and break-glass mechanics live in
`C:/Users/Erez/.claude/skills/vet-code/gate-mechanics.md`, shared with `/vet-code`: use its
**`/vet-rule` column** (`~/.claude-staging/check-passes/`, kinds `check-record` and `check`).
Rationale and honest limits: `C:/Users/Erez/.claude/skills/vet-rule/background.md`. When editing this
skill, keep this file at 12,000 characters or fewer and under 500 lines (size checker, `/suggest`
4b); put new detail in a reference file.

---

## Scope — what is gated (and what this skill covers)

- The global `~/.claude/CLAUDE.md` (its only real write path is `update-global-rule.ps1` /
  `update-config.ps1 -File "CLAUDE.md"`, since a direct edit is already hard-locked by GEN-103; the
  hook gates that script path).
- Any skill file under `~/.claude/skills/<name>/…` ending in `.md` (skills are NESTED — the whole
  skill folder is in scope, including `SKILL.md` and any `.md` reference files it ships).
- Any command file directly under `~/.claude/commands/` ending in `.md` (commands are FLAT).
- **Mechanical-fix lane (verified by the hook, not self-declared):** a change confined to
  HORIZONTAL-WHITESPACE only — the two texts are identical after collapsing space runs and trimming
  each line's ends, with NO other difference (no punctuation, word, tab, newline-structure, or
  in-fenced-code-block change) — skips `/check` but is NOT silently approved: the hook defers it to
  your normal confirmation prompt (that prompt is the human gate). So a genuine pure-whitespace tidy
  does not need this skill — but it still surfaces for your confirmation, it does not pass unseen.
  Anything beyond horizontal whitespace — a changed word or punctuation mark, a tab, an added/removed
  line break, OR a whitespace change sitting inside a fenced code block (where spacing can be
  meaning-bearing, e.g. embedded YAML/Python/JSON) — is NOT mechanical and requires the full flow,
  regardless of how minor it seems. This is narrower than the global `CLAUDE.md` mechanical-fix
  exception (spelling, punctuation, formatting): the hook can verify only horizontal whitespace, so
  a spelling or punctuation fix to a gated file still runs this flow.
- **NEW files:** the hook can only gate MODIFICATION of an existing file (it anchors on on-disk
  existence). Creating a NEW skill/command/rule file falls through to a normal prompt — so YOU must
  run this skill for a new file too, and run `/check` before creating it. (That create write
  itself needs no pass and no break-glass — it is the normal-prompt fall-through described here; see
  Step 7.)
- **NOT in scope (separate follow-up):** per-project `<project>/CLAUDE.md` files — a distinct surface
  tracked as GEN-490. Don't rely on this skill to gate those yet.

## When this skill is DUE (the judgment it enforces)

Run this skill whenever you are about to present or apply a rule/skill/CLAUDE.md edit that is due a
`/check` — i.e. a substantive change to a rule, a skill's instructions, or a course-of-action
procedure. This is the exact judgment the standing rules ("Before adding or editing a rule in a
`CLAUDE.md` file …" and the check-before-present clause of "When presenting anything to Erez for
approval or a decision") already require; the hook is the backstop that makes skipping it impossible
under momentum, not a replacement for making the call. When in doubt whether an edit is due a
`/check`, it is — run the flow.

---

## Step 0 — Gate self-check (fail closed)

Before vetting anything, confirm the hook's check-before-present guard is present and intact. If not,
the gate has a hole — REFUSE and tell Erez the hook must be fixed first (via `/vet-code`). Grep
`~/.claude/hooks/auto-approve.js` for `enforceCheckDue` and `findCheckPassFile`; both present → proceed.

Confirm the Agent tool and the `check-reviewer` sub-agent type are available (Step 1's `/check` needs
them). And confirm `/check` is available in this session (it's a session skill). If `/check` is not
available, STOP: the vetting bar (a converged `/check` on the text) cannot be met, so no pass may be
minted. Tell Erez plainly; do not degrade to a lighter review.

## Step 1 — Run /check on the EXACT proposed text (to convergence)

Run `/check` on the concrete, final proposed text of the edit — not a paraphrase, not the design idea,
the literal words that will land in the file, with each target's `size:` lines from the size
checker (`/suggest` check 4b) in the artifact. Iterate to convergence (or escalate per `/check`'s own
rules). This produces `check-reviewer` sub-agent transcripts in THIS session — the evidence Step 4
verifies. If `/check` escalates rather than converging, STOP and surface the standoff to Erez; do not
mint on an unconverged panel.

If the edit spans multiple files (e.g. a rule plus the skill that enforces it), each file is its own
gated target and needs its own pass — but a single `/check` panel reviewing the whole coherent change
covers them all; record the same converged verdict against each target.

## Step 1b — Write the check-record

Right after `/check` converges, write one check-record per changed file into
`~/.claude-staging/check-passes/`: bound by `target` + `contentHash` (full normalized working copy),
with the real `agentId` of every `check-reviewer` this panel spawned and the verdicts copied in.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/gate-mechanics.md` (table, section 1).

## Step 2 — Have the final text ready as a working copy

Hold the exact converged text (the bytes that will be written). For a `CLAUDE.md` text-replace, that
is the precise `OldText`/`NewText`. For a skill/command file, that is the full new file content. The
`contentHash` in the record is computed over this. Do NOT edit the text after this point — any change
invalidates the record (Step 4's hash check will fail) and requires re-running `/check`.

## Step 3 — Show Erez + approve

Show Erez the change and ATTEST the `/check` ran, with its result: converged (in how many rounds) or
escalated, the material findings and how each resolved, and any advisory notes. Sizes: run the size
checker on each target's whole proposed file (for a `CLAUDE.md` text-replace, the full live file
with the replacement applied, never the `OldText`/`NewText` alone; again after any revision) and
paste its `sizeLines` verbatim, every line for every target, plus one plain sentence per target ("well within all
limits", "at 95% of its hard cap"); a summary alone is not a size line. A target that breaks
check 4b goes back to Step 1. Get his explicit approval to apply.

## Step 4 — Evidence precondition, then mint

Before minting: the check-record for THIS target exists; its `contentHash` equals the current working
copy; `checkVerdict` is converged; `checkReviewerAgentIds` is non-empty and each transcript is on
disk, `check-reviewer`, earliest `timestamp` <= `draftedUtc`. Any check fails → REFUSE to mint and
re-run `/check`. Then mint `"kind": "check"` (15-minute expiry) into `~/.claude-staging/check-passes/`
with the Write tool, showing Erez the converged verdict + finding count in the same moment. One pass
per target.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/gate-mechanics.md` (section 2).

## Step 5 — Apply

ONE write per target, never a sequence of `Edit`s; for an existing skill/command file prefer
`update-config.ps1 -File "<literal absolute path>" -Op write-file -ContentFile "<working copy>"` (a
single full-file `Write` or `MultiEdit` is acceptable); issue a shell apply as a SINGLE LINE (a
multi-line one is refused, exit 2). For the global `CLAUDE.md`: `update-global-rule.ps1` only for
single-line replacement text; otherwise a full-file `-ContentFile` overwrite built from the WHOLE
live file. A partial landing → re-mint and re-apply the whole working copy as one write.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/gate-mechanics.md` (section 3);
for the global `CLAUDE.md`, also `C:/Users/Erez/.claude/skills/vet-rule/claude-md-apply.md`.

## Step 6 — Verify installed

Re-read the installed file and confirm it matches the approved working copy (the `contentHash`; for a
`CLAUDE.md` text-replace, confirm the `NewText` is present and the `OldText` is gone). Report the exit
status of the apply (success/failure) plainly.

## Step 7 — New-file / bootstrap creation

The hook cannot gate a file that does not yet exist (it anchors on on-disk existence). To create a
NEW gated file (a new skill/command, or a new rule file), OR to install this gate's own machinery for
the first time:
1. Run Steps 1–3 exactly as for a modification (run `/check` on the new file's full text, record it,
   show Erez, get approval), then STOP before Step 4's mint: a new file needs no check pass, because
   the gate anchors on on-disk existence and cannot fire on a file that does not exist yet.
2. The create write itself needs no pass and no break-glass: because the gate cannot fire on a
   not-yet-existing file, the write falls through to a normal permission prompt — the same as
   `/vet-code`'s Scope for a brand-new hook. Every subsequent edit to that file is gated normally.

## Step 8 — Recovery (failure / expiry)

A consumed pass is gone: re-mint (re-prompting Erez, re-showing the verdict) and retry the single
apply. Changed text → re-run `/check`, never force. Break-glass is for a wedged session only.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-code/gate-mechanics.md` (section 4).

## Break-glass OPEN/CLOSE commands (sentinel + reaper token)

The OPEN and CLOSE PowerShell blocks are in
`C:/Users/Erez/.claude/skills/vet-code/gate-mechanics.md` (section 5). First edit the OPEN block's
three leading values (`$hrs`, `$flow`, `$reason`), then run each block as ONE multi-line call in
exactly that shape, never collapsed to a `;`-chained line; after CLOSE both `Test-Path` lines must
print `False`.
