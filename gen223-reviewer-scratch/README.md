# GEN-223 Phase 1 — Independent reviewer (scratch build)

> **DEFERRED (June 2026) — not the active plan.** Erez chose a manually-triggered review
> over this automatic Stop-hook gate. This build is preserved as a working fallback for
> possible future revival; see `DECISION.md`.

Scratch build + verification of the "working reviewer" from
[GEN-223](https://app.notion.com/p/37b6e495d07c80c0ba48fd80fb9edb0b)'s locked design.
This folder is a **test harness only** — it is NOT wired into daily/global config.

## What this is

A Claude Code **agent-type `Stop` hook**: when the assistant tries to end a turn,
a fresh, independent reviewer sub-agent (Sonnet) decides whether the turn may end.
It runs Erez's three review questions automatically — rule-check, pre-mortem,
holistic — and either lets the turn end or sends the assistant back with feedback.

- `reviewer-prompt.txt` — the reviewer protocol (the locked GEN-223 protocol, **minus**
  the Phase-1.5 claim-trigger). The source of truth; edit this.
- `.claude/settings.json` — the hook config, **generated** from `reviewer-prompt.txt`.
  Do not hand-edit the embedded prompt; regenerate (see below).

### Verdict → hook output mapping
The hook contract is `{"ok": true}` (allow stop) or `{"ok": false, "reason": "..."}`
(send back). The reviewer maps its verdicts onto that:
- **PASS** → `{"ok": true}`
- **REVISE** → `{"ok": false, "reason": "[[GEN223-REVISE:N]] ..."}`
- **ESCALATE** (after 2 REVISE rounds) → `{"ok": false, "reason": "[[GEN223-ESCALATE]] ..."}`
- **NEEDS DEEP REVIEW** → `{"ok": false, "reason": "[[GEN223-DEEPREVIEW]] ..."}`

Round counting, off-switch, re-review detection, and the deep-review valve all work
by the reviewer reading `transcript_path` and grepping for the `[[GEN223-...]]` markers.
Recursion guard is automatic: the hook is on `Stop` only, so the reviewer's own
sub-agents (which end on `SubagentStop`) are never themselves reviewed.

## Regenerate settings.json after editing the prompt

```
node -e "const fs=require('fs');const p=fs.readFileSync('reviewer-prompt.txt','utf8');const cfg={hooks:{Stop:[{hooks:[{type:'agent',prompt:p,model:'claude-sonnet-4-6',timeout:120,statusMessage:'Independent reviewer checking this turn (GEN-223)...'}]}]}};fs.writeFileSync('.claude/settings.json',JSON.stringify(cfg,null,2));"
```

## How it was verified (headless, no touch to global config)

Hooks were loaded with `--settings <this folder>\.claude\settings.json` and observed
with `--output-format stream-json --include-hook-events`.

Confirmed:
- The agent-type `Stop` hook **fires** in the real integration.
- **PASS** on a plain factual answer (Step-1 fast bail) → clean `end_turn`, 1 turn.
- **REVISE** on a flawed course of action → `[[GEN223-REVISE:1]]` with concrete material
  findings; the reviewer read and cited the live global `CLAUDE.md`.
- **Re-review** with 1 prior marker → `[[GEN223-REVISE:2]]`.
- **ESCALATE** with 2 prior markers → `[[GEN223-ESCALATE]]` with both positions.
- **Off-switch**: a user message ending "skip review" → `{"ok": true}` even with a flawed proposal.
- Composition: the full reviewer runs as a real hook, reads the live rules file, and renders a verdict.

## Key platform findings (matter for promotion)

1. **Model must be the full id `claude-sonnet-4-6`** — the `sonnet` alias is silently
   dropped by `-p` settings validation, so the hook never fires. (Full-id will need
   updating when the Sonnet version changes.)
2. **Agent-type hooks are experimental** but confirmed firing here. The originally-named
   fallback (prompt-type) is NOT viable for this reviewer — prompt hooks have no tool
   access and so cannot read the transcript or the rules file. A command-hook wrapping a
   headless `claude --bare -p` reviewer is the real fallback if the agent hook regresses.
3. **Cost**: the reviewer (a Sonnet agent) fires on **every** turn-end, then fast-exits
   if there's nothing to review. Observed ~$0.06 for a trivial turn and ~$0.15 for a full
   reviewed turn. A Haiku-triage tier could cut this (Phase 2 tuning).
4. **Output discipline**: the protocol now forces bare-JSON output (no prose/markdown).

## Promotion to daily use (the separate, approval-gated step)

The global `~/.claude/settings.json` is locked; add the `Stop` hook block via
`update-config.ps1` (not a direct edit). Promotion is gated on Erez's go-ahead.
