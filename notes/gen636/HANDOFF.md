# GEN-636 + GEN-834 handoff: cold pickup (written 2026-10-13)

- [GEN-636](https://app.notion.com/p/3b26e495d07c81d7ba0eda927747315a): In Progress.
- [GEN-834](https://app.notion.com/p/3f76e495d07c8130912ee2f998459e39): still To Do on the board. Its build is done (see below).
- Plan approved by Erez: `~/.claude/plans/i-want-to-work-deep-nebula.md`.
- Design, converged after 3 `/check` rounds, plus build notes: `notes/gen636/design.md`. Treat it as the spec.

## DONE in session db195981 (do not redo)

**Hook installed.** `~/.claude/hooks/auto-approve.js` was installed via full `/vet-code`.
- sha256 `fe95a72855b5cd8fed8126965f9a000aa5facce2aae4e8e3757efe0c781ef79f`.
- The working copy is `notes/gen508-piece1/auto-approve.working.js`.
- **GEN-834 change:** a Notion write tool from a non-watched connector id is refused as `connector-mismatch`, and break-glass can clear it. Plus comment fixes.
- **Install checks:**
  - pass consumed;
  - marker-liveness MATCH;
  - suites: arm 279/279, contract 36/36, REST parked 6/25 baseline unchanged;
  - corpus sweep: 0 bypasses over 1,189 payloads;
  - pass-consume 3/3 under both gates;
  - real tool-name replay: 1 fire, on a garbled id the harness rejects before hooks. Erez signed off on it.
- Vetting record: `~/.claude-staging/vetting-passes/gen834-auto-approve-vetting-record.json`.

**Readout installed** (new file, not a registered hook): `~/.claude/hooks/ticket-gate-readout.js`.
- sha256 `ef28d917c3bfd8b825aaf6f0ad70237336630286d405f7f90a754bd522f42740`, byte-identical to `notes/gen636/ticket-gate-readout.js`.
- Prints nothing on today's real data.
- Tests: `node notes/gen636/test-readout.js` gives 86/86. Pass `<readout> <hook>` paths to target the installed files.
- Added to `sync.ps1 $FileMap`; the sync was run.

**Supporting scripts in `notes/gen636/`:**
- `baseline.js`: bar calibration;
- `lane-baseline.js`;
- `prefix-scan-tooluse.js`;
- `tool-name-replay.js`.

## REMAINING: Part C, the skill edits (design §5; apply via `/vet-rule`, which needs `/check` + Erez's OK)

The readout is installed but **nothing calls it yet**, and no ticket-record carries `source`/`lane` yet.

1. **`~/.claude/skills/vet-ticket/SKILL.md`**
   - **Step 4 ticket-record template** (~:470-481). Add two keys:
     - `"source"`: `interactive` by default; `wrap-step1` / `wrap-step3c` for `/wrap`; `scheduled` for any other unattended run.
     - `"lane"`: `ticket | non-ticket | gen58-rollover`.
     - Add one sentence: both feed `/wrap` Step 3i. **Never copy them into the Step-5 pass**, whose keys are closed (`TICKET_PASS_KEYS`); the hook would refuse with `unknown-record-key`.
     - The readout only counts these exact values; anything else is named as drift.
   - **Step 2 consult path** (~:449-453). Before stopping to consult Erez, write
     `~/.claude-staging/ticket-passes/consult-<slug>-<yyyymmddHHMM>.json`:
     `{"kind":"ticket-consult","target":"<id or 'new'>","question":"<one line>","session":"<$CLAUDE_SESSION_ID>","openedUtc":"<ISO>","resolved":false}`
     - Leave out `expires`.
     - When the consult is settled, in any session, overwrite the file with `"resolved":true`, or `"abandoned"` if Erez dropped it, plus `"resolvedUtc"`.
     - The unattended `/wrap` lane writes none.
   - **Stale text:**
     - :40-45: the GEN-636 pointer should become "`/wrap` Step 3i"; the break-glass list gains `connector-mismatch`.
     - :250-261: replace the "rotation check not built yet" caveat with "the hook now refuses a rotated id (GEN-834)".
     - :640 and :660: both should point to "`/wrap` Step 3i".
     - :676-687: add `connector-mismatch` to the mechanical, break-glass-clearable set. Note that clearing it means NO content review.
     - **Do NOT change the `consume-failed` wording at ~:651.** It is accurate.
2. **`~/.claude/skills/wrap/SKILL.md`**
   - **Steps 1 (:43) and 3c (:88):** set the ticket-record `source` to `wrap-step1` / `wrap-step3c`.
   - **Step 1 (:45):** once a recovery file's items are filed, rename it to `wrap-surfaced-filed-<ts>.md`.
   - **Step 1 (:47):** replace "…are GEN-636" with "the durable cross-session aggregate is Step 3i". Keep the per-run tally.
   - **New Step 3i "Ticket-gate readout (GEN-636)"**, after Step 3h and in its shape:
     - run `node "C:/Users/Erez/.claude/hooks/ticket-gate-readout.js"` and relay each line verbatim under a "Ticket gate" sub-heading;
     - empty output means a checkmark only;
     - if it fails or prints "readout failed", say so in one line;
     - each line goes on its own line in the Step 4 HISTORY entry and forces the full Step 7 report;
     - read-only;
     - acting on the consult (row 13) and recovery-file (row 14) lines is a follow-up, never a `/wrap` action.
3. **Line numbers drift.** Grep before editing. Re-verify each claim from the live files.

## Then close out

- **Verify.** One real interactive gated Notion write after the skill edit should produce a ticket-record with `source:"interactive"` and `lane:"ticket"`. Confirm the readout joins it (run it; still silent).
- **GEN-834.** Rewrite the body to what was built, via `/vet-ticket`, then **propose Done** to Erez. It is not the primary ticket, so the status change is his call.
- **GEN-636.** Rewrite the body via `/vet-ticket` and record the deviations from design §9. Then set Review and schedule a self-check. GEN-636 → Done only once the first real `/wrap` that files a ticket produces a `source:"wrap-step1"` record and the readout stays silent.
- **Propose to Erez at close, one item at a time:**
  - a 3-month recalibration reminder (re-run `baseline.js`), as a GEN-636 sub-item;
  - making the sibling Notion hooks rotation-aware (`notion-write-verify`, `notion-fetch-staleness`, `notion-schema-guard`), as a GEN-834 sub-item;
  - the break-glass "re-map to the watched name" option (design §8).
- **Open topic (park; nothing to fix here).** `sync.ps1` warns that `~/.claude/state/` (one file, `mcp-discover-verdicts.json`, created 2026-10-13 ~06:30Z) isn't covered by the backup set. Session db195981 did not create it. It belongs on [GEN-460](https://app.notion.com/p/) (backup-coverage triage); look up the URL with `notion-ticket-lookup.ps1 460`.
