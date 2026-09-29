<!-- Saved 2026-09-29 from the session plan file (approved, /check-converged). See HANDOFF.md for current status. -->

# Plan: GEN-638 (rotate exposed credentials) + the tickets that make it stick

## Context

[GEN-638](https://app.notion.com/p/3b26e495d07c81f68d1aebc8428e377b) (Backlog, assigned to Erez, filed 2026-08-04): the Notion token leaked into a session log when a helper script crashed and Node printed the script's arguments. The ticket asks Erez to rotate it.

What a read-only scan found on 2026-09-29 (PowerShell over 3,197 files in `~/.claude/projects`, printing only counts and redacted context):
- **The current Notion token appears in 3 files**: session logs from 2026-09-20 and 2026-09-27, plus `Improve AI Infra/notes/gen716-phase0/blocks.jsonl` (git-ignored). The 2026-08-04 log itself wasn't found. It was probably removed by Claude Code's roughly 30-day log cleanup (`cleanupPeriodDays`), but that isn't confirmed.
- **The 2026-09-20 copy leaked the same way as the original**: a Node dump of the arguments to a curl call it spawned. So the cause GEN-638 names is still active.
- **The 2026-09-27 log has one line listing many keys together**: Google/Gemini, GitHub, Notion, Slack, Atlassian and others. It's most likely a whole read of the `API tokens and keys - AI` sheet, but that's inferred: the permission check blocked a closer look. This is the risk [GEN-163](https://app.notion.com/p/3756e495d07c80c0bd21d87990523acb) describes, and it's how the Slack, GitHub and Atlassian keys got exposed. None of them went through the argument leak.
- **Distinct values found, by key type**: Notion 1, GitHub 2, Slack 1, Atlassian 3, Google 38. Many of the Google keys are probably harmless public keys. This session also printed several of these by accident, because the redaction masked only the Notion token.
- **Code that still puts the token in a command's arguments** (confirmed by grep): `~/.claude/hooks/notion-fetch-staleness.js:140`, `~/.claude/scripts/notion-ticket-lookup.ps1:33` (locked), `skills/notion-ticket-lookup/SKILL.md:64` (a recipe that ad-hoc scripts copy), `hooks/refs/shell.md:16`, and `Documentation/CLAUDE.md:30` ([GEN-425](https://app.notion.com/p/39c6e495d07c8182a59ed6ae3d9a2300)).

So rotating only the Notion token isn't enough. More keys are exposed, and both leak paths (command arguments and whole-sheet reads) are still open. Any key rotated now would leak again the next time one of those paths fires.

## Bundle

| Ticket | In? | Why |
|---|---|---|
| GEN-638 rotate | Yes, broadened | Covers every exposed working key, not just Notion |
| [GEN-639](https://app.notion.com/p/3b26e495d07c8151bd7bd5b1e980062f) no tokens in command arguments | Yes, before rotation | The same leak happened again on 2026-09-20 |
| GEN-425 Documentation GitHub recipe | Yes, folded into 639 | Same defect in a rule file. Its proposed `$(cat file)` still puts the value into the arguments, so use curl's header-from-file form instead |
| GEN-163 whole-sheet reads expose every key | Yes, before rotation | This is how the Slack, GitHub and Atlassian keys leaked |
| [GEN-722](https://app.notion.com/p/3db6e495d07c8169a3d9fdb14462a814) log-derived data committed | No | Different mechanism (commit-time scanning). Once the keys are rotated, the old copies are useless |
| GEN-358 / GEN-704 / GEN-424 backup secret scanner | No | They're about tuning the backup scanner, not today's exposure |
| GEN-321 verify the credential-denial detector | No | It tests a permission-denial detector, which is unrelated to leaks or rotation |

## Steps

1. **Close the argument leak (GEN-639 + GEN-425).**
   - Pass headers to curl from a temporary file (`-H @file` or `--config`), deleted in a `try/finally`. `notion-ticket-lookup.ps1` already uses this pattern for its body file, and curl supports it from 7.55 on.
   - Wrap every spawn so a failure returns a cleaned error, never the argument list.
   - Files and their paths through the gates:
     - `notion-fetch-staleness.js`: `/vet-code`
     - `notion-ticket-lookup.ps1`: `/vet-code`, then `update-config.ps1`
     - notion-ticket-lookup `SKILL.md` and `hooks/refs/shell.md`: `/vet-rule`
     - Documentation `CLAUDE.md` `## GITHUB`: `/check`, then Erez's approval
   - **Lint:** add a check to `/vet-code` that refuses any stored secret passed in a command's arguments (Bearer headers, `-u user:token`, `?key=` in URLs). Every hook and script change already passes through `/vet-code`, so this runs on every future change.
2. **Stop reading the key sheet in sessions (GEN-163).**
   - Each key Claude uses gets its own named entry in Windows Credential Manager, the way the Notion token already works (GEN-322).
   - Add a small helper that Erez runs in his own terminal. It prompts for a key and stores it, so the value never passes through Claude.
   - Credential Manager is per-machine, so Erez runs the helper on **every PC he uses Claude on**.
   - If a key is missing on a PC, scripts stop with the message "key X not set up on this PC — run the helper". They never fall back to the sheet or ask for the value in chat.
   - Update the global `CLAUDE.md` rule (starts "Never ask Erez to paste") and the `staging` skill so they point at Credential Manager (`/vet-rule`).
   - What happens to the sheet itself is Erez's call.
3. **Tripwire for leaks nobody has thought of.**
   - Add a `/wrap` step that checks whether any stored Credential Manager value appears in the current session's log. It reports only the key's name, as "rotate X" in the "For you" block.
   - Safety constraints, enforced in its `/vet-code` pass:
     - Comparison is plain in-memory text matching.
     - The secret is never passed to another program, and no pattern is built from it.
     - Every error path reports the key's name only, never its value.
4. **Erez rotates.**
   - First, Claude lists each exposed key's actual users (scripts, MCP connectors, Apps Script) so nothing is missed.
   - Erez then rotates each key in the service that issued it and stores the new value with the step-2 helper on each PC.
   - The Gemini key goes into the Apps Script project's Script Properties (`GEMINI_API_KEY`), entered by Erez.
5. **Verify.**
   - Every user from the step-4 list still works.
   - A re-scan shows the new values appear in 0 logs.
   - Update the titles, bodies and status of GEN-638, 639, 425 and 163 to match what was built. GEN-638's title becomes "Rotate every credential exposed in session logs".

Order: steps 1–3 are Claude's work and fit in one session, so the extra time the old keys stay live is short. Rotating first would mean Erez rotates everything twice.

## Verification

- A deliberately failing curl call (unreachable host) through each fixed script: the output contains no token.
- The `/vet-code` lint refuses a test script that passes a secret as an argument.
- The tripwire, run against a test log that contains a fake stored value, flags it by name only. Against a clean log it stays silent.
- The step-5 re-scan shows 0 hits for every new value, with counts only.

## Residual risk

- The tripwire only runs at `/wrap`. A session that ends without `/wrap` isn't checked until a later one runs it.
- The old keys stay live until step 4. There's no sign they were misused, and the logs are local only: `sync.ps1` excludes `*.jsonl`.
- The auto-mode permission check may block the tripwire's read of stored values. If so, it needs a permission rule, which is Erez's call.

## Effort

- Steps 1–3 (security-sensitive hook and script changes through `/vet-code` and `/vet-rule`): xhigh. Kept there despite the strong model because a mistake here leaks keys.
- Steps 4–5 (guided walk-through and checks): medium.
