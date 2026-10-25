# GEN-460 build — handoff (2026-10-25, session 05ba3467)

Plan: `C:\Users\Erez\.claude\plans\come-up-with-a-vivid-dewdrop.md` (approved by Erez 2026-10-25).
Nothing is installed. Live files are unchanged by this work.

## Open decision (Erez's)
The "retire a removed hook" add-on failed independent review three times (auto-lift broke the two-PC case;
the explicit lift does not restore the hook on PCs whose sync baseline still lists it). Put to Erez:
- **Drop it (recommended):** remove `retired`, the lift, the deleted-here To-Claude guard and the retire
  mention check; deleted hooks behave as before (a To-Claude pull brings them back, inert). One-off:
  delete the stale `G:\My Drive\AI Projects\_Tooling\Claude\hooks\stop-wmcp-denial-surface.js` (unregistered,
  not on this PC, kept in git history) — destructive, needs Erez's OK. Also drop `retired` from the
  auto-approve regex.
- **Keep fixing:** per-PC "lift applied" tracking that drops the baseline entry so the pull re-fetches.

## What is in build/
- `sync.working.ps1` — working copy of `G:\My Drive\AI Projects\_Tooling\Claude\sync.ps1` (baseline:
  `sync.live-baseline.ps1`; re-check the live file still matches it before install — GEN-655).
- `auto-approve.working.js` — live `~/.claude/hooks/auto-approve.js` (as of 19:32Z, incl. another
  session's GEN-932 change) + two GEN-460 additions (`isSafeSyncTriageDecide` + its call). If the live
  hook changed again, rebuild with `rebase-hook.js` (it reads the old working copy and the live file).
- `run-fixture-tests.ps1` (113/113 passing on the last copy), `test-hook.js` (23/23; pass-consumption +
  allow-shape + 304 real commands, 0 decision changes). Both expect the scratchpad layout
  (`..\gen460\sync.ps1`, `..\gen460\auto-approve.js`) — pass `-Script` / edit `WC` to point here.

## /vet-code state
Design /check converged (2 rounds). Vetting records: `~/.claude-staging/vetting-passes/record-gen460-*.json`
(contentHash is STALE — the copy changed after; update it before minting). Pass A: 2 rounds; Pass B: 4 runs
(ids in the records). Remaining after the decision: apply it, re-run fixtures, one more Pass A + Pass B,
real `-CoverageOnly` dry run on `~/.claude` (expect 40 hooks and one marker-file skip line), Step 5
approval card, mint, install both files (sync.ps1 via Write — not hook-gated; auto-approve.js via
`update-config.ps1 -Op write-file -ContentFile`), real From-Claude sync, then close-out (GEN-460 →
Review; propose GEN-356 / GEN-809 → Done).
