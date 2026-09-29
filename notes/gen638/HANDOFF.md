# GEN-638 bundle — cold-pickup handoff (read this first)

**Ticket:** [GEN-638](https://app.notion.com/p/3b26e495d07c81f68d1aebc8428e377b), In Progress (primary). Bundled with
[GEN-639](https://app.notion.com/p/3b26e495d07c8151bd7bd5b1e980062f) (Done 2026-09-29),
[GEN-163](https://app.notion.com/p/3756e495d07c80c0bd21d87990523acb) and
[GEN-425](https://app.notion.com/p/39c6e495d07c8182a59ed6ae3d9a2300) (both still open, they are step 2).
**Approved plan:** [`plan.md`](plan.md) in this folder (converged `/check`, 2 rounds; approved by Erez 2026-09-29).
**Step 1 detailed design:** [`step1-approach.md`](step1-approach.md) (converged `/check`, 4 rounds).
**Last updated:** 2026-09-29 (session `6588823e-9859-4fb6-9a96-c308ce4a7a02`).

## SAFETY — before touching anything in this bundle

- **Never print a secret, and redact by ALLOWLIST, never by blocklist.** When inspecting anything that may
  hold secrets (session logs, tool results, the key sheet), print only counts, positions and type labels —
  never raw context with the "known" secret masked. On 2026-09-29 a blocklist redaction printed several
  live keys into a session log (logged on GEN-58, Class R).
- **Never read the whole `API tokens and keys - AI` sheet in a session** (Drive MCP read_file_content dumps
  every key into the log — the likely cause of the 2026-09-27 multi-key leak). Step 2 exists to remove the
  need.
- **Never put a key on a command line** — see `~/.claude/hooks/refs/shell.md` and the notion-ticket-lookup
  skill for the safe patterns (temp curl config file with `-q` first; from PowerShell NEVER pipe to
  `curl -K -` — PS 5.1 prepends a BOM).
- A concrete elaboration of a converged plan step is a NEW proposal: run `/check` on it before asking Erez to
  approve it (logged twice on GEN-58, Class K).

## Status by step

| Step | What | Status |
|---|---|---|
| 1 | Close the command-line leak (GEN-639 + recipes + /vet-code check) | **DONE 2026-09-29** — details below |
| 2 | Stop reading the key sheet in sessions (GEN-163), incl. GEN-425's Documentation `CLAUDE.md` GitHub recipe | **NEXT** — not started |
| 3 | End-of-session tripwire (`/wrap` step that flags any stored Credential Manager value appearing in the session log) | Not started |
| 4 | Erez rotates every exposed working key and stores new values via the step-2 helper on each PC | Not started (needs Erez) |
| 5 | Verify every key user still works; re-scan shows 0 hits of new values; update GEN-638/163/425 | Not started |

### Step 1 — what shipped (all installed, reviewed, live-verified; installed + Drive copies hash-match the reviewed copies)
- `~/.claude/hooks/notion-fetch-staleness.js` (/vet-code): Notion REST call is in-process (Node https); token only in
  request headers; silent on every failure (8 s idle timeout + 10 s hard deadline; missing credential; no stderr).
- `~/.claude/scripts/notion-ticket-lookup.ps1` (locked; /vet-code + update-config.ps1): header via temp curl config
  file (`-q -sk -m 30 -K <file>`), deleted in `finally`; 10-minute sweep of leftover `notion-ticket-lookup-{cfg,body}-<guid>`
  files; stderr warning (path only) if undeletable; fail-closed token character check.
- Recipes (/vet-rule): notion-ticket-lookup `SKILL.md` (script first; safe inline recipe using the same temp-file
  names so the sweep covers it), `SECURE-LOOKUP-DESIGN.md` (argv residual corrected), `hooks/refs/shell.md` (GitHub
  safe pattern incl. `TOK=$(... | git credential fill | sed ...)`; PS→native stdin BOM note).
- `/vet-code` skill: Step 3 "Secret-on-command-line check" (mandatory) + Step 5 attestation of any unfixed hit.
- GEN-508's not-installed `notes/gen508-piece1/notion-rest-write.ps1` + its design block fixed; the STAGED
  `auto-approve.working.js` pin set to a non-hex sentinel (commit `4df1d25`); live hook untouched (REST arm unwired).

## Step 2 — what the next session should do (design is in plan.md step 2; the concrete elaboration needs its own /check)

Known targets that still point sessions at the key sheet (verify live before relying — these are 2026-09-29 facts):
- Global `~/.claude/CLAUDE.md` rule starting "Never ask Erez to paste, share, or type API tokens" (locked; `/vet-rule`
  + `update-global-rule.ps1`).
- `~/.claude/skills/staging/SKILL.md` (~line 62) — names the sheet.
- `C:\Users\Erez\AI Projects\Documentation\CLAUDE.md` `## GITHUB` (lines ~29-30: sheet as the PAT source + a
  token-on-command-line curl recipe = GEN-425), the Slack pin-token line (~95), and its CORE RULES (~130). Project
  CLAUDE.md edits need `/check` + Erez's approval.
- `G:\My Drive\AI Projects\_Tooling\Claude\slack-post.js` / `slack-pin.js` read `SLACK_BOT_TOKEN`/`SLACK_PIN_TOKEN`
  from env — whoever sets those env vars must read Credential Manager, not the sheet.
- The GitHub PAT is ALREADY retrievable from Windows GCM via `git credential fill` (Bash tool) — an existing vault
  path; prefer it over a new entry.
- Design constraints already agreed (plan.md step 2): one named Credential Manager entry per key Claude uses; a helper
  Erez runs in his own terminal that prompts for a value and stores it (value never passes through Claude); run it on
  EVERY PC; scripts fail with "key X not set up on this PC — run the helper", never fall back to the sheet or chat.
  What happens to the sheet itself is Erez's call.

## Step 4 inputs (exposure found 2026-09-29; counts only)
Distinct values by type across all session logs + git-ignored `notes/gen716-phase0/*.jsonl`: Notion 1 (the live
token), GitHub PAT 2, Slack 1, Atlassian 3, Google `AIza…` 38 (many likely public/harmless). The Gemini key's live copy
is Apps Script Script Properties `GEMINI_API_KEY` (Erez enters the new value himself). Before step 4, list each key's
actual users so nothing breaks unnoticed. Logs are local only (`sync.ps1` excludes `*.jsonl`).

## Effort
Steps 2–3: xhigh (security-sensitive rule/skill/hook changes). Steps 4–5: medium.
