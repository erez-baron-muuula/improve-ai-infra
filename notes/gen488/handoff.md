# GEN-488 handoff — resume the /vet-code flow at Step 5 (show Erez + approve)

Written 2026-07-20 (~11:30 local) by the Fable 5 session `e3e00658-0915-4262-a1f9-0dd412ee3cee`,
which ran the GEN-488 build through /vet-code Steps 0–4 completely. Erez ran out of credits
mid-session and may resume in a fresh session. This doc + the files beside it are the full
context. Ticket: GEN-488 (https://app.notion.com/p/3a26e495d07c819492aee2172a207231),
Status = In Progress (correct; do not reset).

## What was built
Component 1 of the GEN-373 build plan: an ADVISORY-ONLY, NON-BLOCKING "redirect nudge" inside
`auto-approve.js` (the PreToolUse hook). When a Bash/PowerShell command that is about to DEFER
(normal permission prompt) has a literal redirect/write target landing DIRECTLY in the home
dir, a PROJECT_ROOTS entry, or an individual project folder (depth-1 child of `ai projects`),
the hook emits `hookSpecificOutput.additionalContext` JSON (exit 0) steering output to the
current session's scratchpad (derived at fire time, existence-validated, generic-phrase
fallback). It cannot alter approve/defer/block decisions and fails open everywhere.

## Files in this folder (authoritative copies)
- `auto-approve.gen488.js` — the VERIFIED working copy (full file, based on live as of
  2026-07-20 10:49:03, WHICH INCLUDES GEN-485). This is the file to install.
- `design-converged.md` — the /check-converged design (3 rounds; includes the round-3
  quoted-span revision and the Step-3 code-review hardenings).
- `diff-v2.txt` — working copy vs live diff both review passes ran on (189+ additive lines;
  only `defer()`'s body replaced; two comment-only hunks in existing code).
- `verify-harness.ps1` — the 22-case live-verify harness. NOTE: it hardcodes the ORIGINAL
  session's scratchpad path (`...\e3e00658-...\scratchpad`) for the fake `.claude` tree and
  work dir; to re-run in a new session, either leave those paths (they exist until temp
  cleanup) or update `$scratch`. Result in the original run: 22/22 PASS.

## Vetting evidence (all complete)
- Step 0 gate self-check: PASS (enforceVetting + findVettingPassFile present; /code-review and
  check-reviewer available; session on Fable 5, the strongest tier — the reason this ticket
  was restarted onto Fable 5 in the first place).
- Step 1 /check on the design: CONVERGED in 3 rounds. Round 1: pre-mortem REVISE (factory
  ambiguity → resolved by duplicating patterns instead of refactoring vettingTargets);
  holistic PASS; soundness PASS. Round 2: pre-mortem re-review PASS (RESOLVED). Round 3
  (author-found quoted-`>` false-positive class, e.g. `git commit -m "fix a > b"`): PASS.
- Step 1b vetting record: `C:\Users\Erez\.claude-staging\vetting-passes\gen488-auto-approve-vetting-record.json`
  — self-contained (verdicts + transcript timestamps copied in). Its `contentHash` and
  `workingCopy` fields are kept in sync with `auto-approve.gen488.js` IN THIS FOLDER.
- Step 3 code review, TWO passes, BOTH on Fable 5 (Pass B attested "claude-fable-5" in its
  verdict), run TWICE (initial + re-run after fixes):
  - Round 1 findings fixed: mv/cp pattern REMOVED from the nudge (false fires on
    `Copy-Item x C:\Users\Erez\Downloads`, `npm run cp:assets`); `-o/--output` now requires a
    path-shaped operand (kills `set -o pipefail`, `ssh -o Option=val` false fires); relative
    tokens skipped when payload `cwd` is missing; quoted `~` no longer expanded (bash doesn't);
    insideSpan early-break; cross-reference comments on both pattern copies + PROJECT_ROOTS.
  - Round 2: Pass A re-review PASS (all six fixes RESOLVED, no new defects); fresh cold Pass B
    PASS (no material findings). `node --check` clean on the working copy.
  - Accepted advisories (do NOT re-litigate): stdout write-then-exit truncation risk mirrors
    the pre-existing approve() pattern; theoretical ReDoS in the duplicated lazy patterns
    (pre-existing in vettingTargets); tiny residual false/missed-fire pockets, all
    advisory-only and fail-open.
- Step 4 live-verify: 22/22 PASS through the real caller (payloads piped to the hook installed
  in a fake self-consistent `.claude` tree). 5 fire cases (Out-File/`>`/`~/`/`-o`/relative-in-
  project-root), 11 correct-silence cases (quoted prose, jq, set -o, scratchpad target,
  subfolders, multi-line, unbalanced quote, ssh -o, quoted ~, mv), 6 decision-regression cases
  (read-only approve ×2, mixed-chain block, protected-file block, vetting lock, GEN-485 check
  lock) — decisions unchanged. Step 4a (antivirus) does NOT apply: no background launches.

## CRITICAL context: concurrent-session near-collision
Another session installed GEN-485 (check-before-present lock) into the LIVE auto-approve.js at
2026-07-20 10:49:03 — seconds AFTER this session's first working-copy snapshot. The first diff
would have DELETED GEN-485 if applied. The working copy was rebased onto the current live file;
GEN-485 was verified byte-intact in it by two independent reviewers and by the live-verify
GEN-485 block case. LESSON FOR THE RESUMING SESSION: immediately before Step 7 apply, re-check
the live file (`Get-Item` mtime; expect 72274 bytes / 2026-07-20 10:49:03 unless legitimately
changed) and re-diff against the working copy. If live changed again, REBASE AGAIN (re-copy
live, re-apply the GEN-488 hunks from diff-v2.txt, node --check, quick re-verify) — never
write-file over a moved baseline.

## Remaining steps (vet-code Steps 5–8)
1. **Refresh the record if needed:** recompute sha256 of the working copy (UTF-8, CRLF→LF
   normalized) and confirm it equals the record's `contentHash`; update the record if the
   working copy legitimately changed. Hash of `auto-approve.gen488.js` at handoff:
   `f19cffe73f42c27398ee98a29e45c9bb7ea8de339c91dfcfc5ab4dfb0a9ac035`.
2. **Step 5:** show Erez the change (summary + attestations above) and get EXPLICIT approval to
   apply. Nothing before this counts as approval.
3. **Step 6:** verify evidence precondition (record exists, contentHash matches current working
   copy, checkVerdict converged), then mint the pass — Write to
   `C:\Users\Erez\.claude-staging\vetting-passes\gen488-apply-pass.json`:
   `{ "kind": "vetting", "target": "c:\\users\\erez\\.claude\\hooks\\auto-approve.js", "expires": "<now+15min ISO UTC>" }`
   (get the timestamp via `(Get-Date).ToUniversalTime().AddMinutes(15).ToString("o")` just
   before writing; the Write permission prompt IS Erez's gate).
4. **Step 7:** re-check live file (see above), then apply via
   `& 'G:\My Drive\AI Projects\_Tooling\Claude\update-config.ps1' -Op write-file -File auto-approve.js -ContentFile '<this folder>\auto-approve.gen488.js'`
   (single, unchained tool call — a chained command can't consume the pass). The hook consumes
   the pass and approves. Report the exit status explicitly.
5. **Step 8:** re-read the installed file, confirm byte-identical to the working copy (hash
   above), quick live-fire (pipe one fire-case payload from verify-harness.ps1 to the real
   installed hook) to confirm it loaded.
6. **Ticket:** re-read GEN-488 title/description vs what was built (they match the built
   approach; the handoff section in the ticket is now historical), then set Status = Done —
   live-verified in-session, no later verification needed. Also surface to Erez per the
   standing rule: the auto-approved-edits log entries already reported on 2026-07-20 (~11:25)
   including the unrecognized new file `Improve AI Infra\notes\x.md` (08:55, no session id) —
   Erez hadn't yet replied about it at handoff time.

## Cleanup after install (optional, low priority)
Delete the fixture tree + probe files in the old session scratchpad (`fakehome\`,
`verify-work\`, `tmp-probe.txt` if created) — or leave them for temp cleanup; they are inert.
The GEN-373 cleanup sweep (parent ticket) is the systemic answer to strays.
