# GEN-679 — banked working set + rig (mid-/vet-code handoff, 2026-08-11)

State at banking: the GEN-679 fix to the live `~/.claude/hooks/stop-signal-surface.js` is FULLY BUILT
and fully vetted EXCEPT one step — the formal `/code-review` re-run (Pass A after the fix round),
which Erez chose to run in a new session. NOTHING IS INSTALLED; the live hook is untouched.
**The authoritative pickup instructions live on the GEN-679 ticket's "Resume note (2026-08-11)" —
read that first; this README only documents the banked files.**

| Path | What it is |
|---|---|
| `working/stop-signal-surface.js` | The vetted working copy. Normalized (LF) sha256 `56af932278e0ada78a567c7f617bffed7ad509a4709bac88b147b65c093eb1fa` — must match the vetting record's `contentHash` at mint time. |
| `working/gen679.diff` | Working-copy-vs-live diff at banking time. Regenerate before Pass A if the live file changed. |
| `working/doc-edits.md` | The exact, panel-converged texts of the two doc edits (wrap SKILL.md parts 1a–1g — check-gated; gen467 scan SKILL.md Edit 2 — ungated) plus the post-install maintenance note. |
| `rig/livefire.js` | 37-fixture live-fire + 300-real-message differential/realism replay + /wrap-reader replay. |
| `rig/consume.js` | Pass-consumption assertion suite (5 checks, fixture gate tree). |
| `rig/copier.js` | Rig bootstrap: byte-copies the live hook (baseline) and live auto-approve.js (fixture gate); asserts hash match. |
| `bank.js` | The script that produced this folder (paths inside reference the origin session's scratchpad). |

**Re-running the rig from here:** the rig scripts locate the hook under test at `../stop-signal-surface.js`
relative to themselves (the origin layout). To re-run: create a scratch dir, copy
`working/stop-signal-surface.js` into it as `stop-signal-surface.js`, copy `rig/` next to it, run
`node rig/copier.js` then `node rig/consume.js` then `node rig/livefire.js` (livefire takes ~5–7 min:
~900 node spawns). Re-runs against a changed live hook re-baseline; never diff against printed numbers.

**Regime note:** all banked evidence was produced against the live hook at sha12 `03ce725f5087`
(the GEN-467 re-cut install of 2026-08-10). After GEN-679 installs, `rig/copier.js`'s baseline copy
and the differential replay measure the NEW live regime.
