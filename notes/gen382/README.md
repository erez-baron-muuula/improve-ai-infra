# GEN-382 — Airtight backup

**Status as of 2026-07-15:** INSTALLED and live. Both `backup-sweep.ps1` and
`sessionstart-backup-spawner.js` here are durable copies of the versions currently installed
at `~/.claude/scripts/` and `~/.claude/hooks/` respectively (kept in sync as of this date;
verify by hash if in doubt). The GEN-430 no-flash rewrite (inline/attached windowless launch +
5-min attempt-throttle + internal `-OverallDeadlineSeconds` + `-NetTimeoutSeconds` + stale-artifact
reaper + 77/78 durable-failure sentinel handshake) shipped 2026-07-15; see GEN-430 for that
history and the two post-install checks (no-flash, Avast-quiet) still on Erez.

These are durable copies, not the source of truth — the live files at `~/.claude/` are. Any change
goes through `/vet-code` against the live files, then re-sync these copies. The older
`HANDOFF-2026-07-12b.md` and `backup-sweep-design-v2.md` capture the Phase-0/Phase-A build state and
predate the GEN-430 rewrite — read them for background, not current behavior.

Files:
- `backup-sweep.ps1` — durable copy of the live sweep script.
- `sessionstart-backup-spawner.js` — durable copy of the live SessionStart hook.
- `sessionstart-backup-surfacer.js` — durable copy of the failure-surfacer hook.
- `backup-sweep-design-v2.md` — the original converged design spec (pre-GEN-430).
- `phase0-findings.md` — the three Phase-0 spike results.
- `HANDOFF-2026-07-12b.md` — historical Phase-A continuation handoff (pre-GEN-430).

Notion tickets: GEN-382 (original), GEN-430 (no-flash + AV-safe rewrite).
