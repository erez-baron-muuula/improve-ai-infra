# GEN-638 bundle — cold-pickup handoff (read this first)

**Ticket:** [GEN-638](https://app.notion.com/p/3b26e495d07c81f68d1aebc8428e377b), In Progress (primary). Bundled with
[GEN-639](https://app.notion.com/p/3b26e495d07c8151bd7bd5b1e980062f) (Done 2026-09-29),
[GEN-163](https://app.notion.com/p/3756e495d07c80c0bd21d87990523acb) and
[GEN-425](https://app.notion.com/p/39c6e495d07c8182a59ed6ae3d9a2300) (both still open, they are step 2).
**Approved plan:** [`plan.md`](plan.md) in this folder (converged `/check`, 2 rounds; approved by Erez 2026-09-29).
**Step 1 detailed design:** [`step1-approach.md`](step1-approach.md) (converged `/check`, 4 rounds).
**Last updated:** 2026-10-04 (session `59955ba8-477c-4c99-85e6-8948f28c04bc`: step 3 SHIPPED — the key-leak tripwire is installed and wired into `/wrap` as Step 0b; see "Step 3 — status 2026-10-04" below. Earlier the same day, session `f460f324` finished step 2).

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
| 2 | Stop reading the key sheet in sessions (GEN-163), incl. GEN-425's Documentation `CLAUDE.md` GitHub recipe | **DONE 2026-10-04** — everything shipped; the Atlassian write path ([GEN-765](https://app.notion.com/p/3ea6e495d07c8168add0d12ac3fee87f)) was redesigned ([`step2-redesign.md`](step2-redesign.md)) and installed and live-verified (real PUTs to both sandboxes succeeded). |
| 3 | End-of-session tripwire (`/wrap` step that flags any stored Credential Manager value appearing in the session log) | **DONE 2026-10-04** — `~/.claude/scripts/key-leak-tripwire.ps1` installed (/vet-code) and `/wrap` Step 0b added (/vet-rule); design [`step3-approach.md`](step3-approach.md), shipped copies + tests in [`step3/`](step3/) |
| 4 | Erez rotates every exposed working key and stores new values via the step-2 helper on each PC | Not started (needs Erez). **NEXT (medium).** |
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

## Step 3 — status 2026-10-04 (session 59955ba8) — read this first

- **Shipped, each with Erez's approval:**
  - `~/.claude/scripts/key-leak-tripwire.ps1` (/vet-code). Design /check converged in 2 rounds. Pass A (in-session /code-review high) ran 2 rounds: 10 findings, 8 fixed, 1 skipped as a residual, 1 needing no change. Pass B (Opus 5.5) ran 2 rounds; round 1 had 2 material findings, both fixed; round 2 PASS. 72/72 tests (`step3/test-key-leak-tripwire.ps1`; random in-memory test value, never a real key). The installed file hash-matches `step3/key-leak-tripwire.ps1`.
  - `~/.claude/skills/wrap/SKILL.md`: new **Step 0b — Key check**, plus the frontmatter description and the report-label list (/vet-rule; /check converged in 2 rounds, 4 lenses; the exact text is in `step3/wrap-step0b.md`; installed hash `ce031bcc…`).
- **What it does:** reads every key in `set-claude-key.ps1`'s list plus Git's stored GitHub login, in memory only. It plain-text-matches each value against every file under `~/.claude/projects` and `%APPDATA%\Claude\local-agent-mode-sessions` written since the last clean run. It prints JSON with names, paths, dates, counts and codes only, and exits 2 = found, 1 = could not complete, 0 = clean. Per-PC state lives in `~/.claude/hooks/key-tripwire-scans.jsonl`.
- **Changed from the approved design during code review** (Erez saw and approved these before install):
  - A run that FOUND a key is never the incremental mark, so a found key is re-reported at every run until it is replaced.
  - The mark is the last-appended clean run, not the run with the highest start time.
  - A key name the mark run didn't check forces a full scan.
  - A mark dated in the future forces a full scan.
  - A missing `~/.claude/projects` is a problem, not "clean".
  - GitHub is read through `cmd.exe <` from a temp file. The design said raw bytes to .NET StandardInput, but this host's console input encoding adds a BOM there.
- **Live results (install-time `-All` baseline, 4,226 files, ~7 s, no problems):**
  - **notion found** in 2 session logs, confirmed independently by a byte-level search:
    - `C--Users-Erez-AI-Projects-Improve-AI-Infra\f00041c7-…jsonl`, content dated 2026-08-03/04. This is the original GEN-638 leak session; `plan.md` wrongly says that log "wasn't found".
    - `C--Users-Erez-AI-Projects-InvoiceAutomation\9f9b18c6-…jsonl`, 2026-09-27.
  - **atlassian** (the new key stored 2026-10-04): clean.
  - **github**: the CURRENT Git login is clean.
  - **slack**: not stored on this PC.
- **Consequence until step 4:** Notion is still exposed, so no clean mark exists. Every `/wrap` therefore re-scans everything (~7 s) and reports Notion. Expected.
- **Permission check:** the plain `& "…\key-leak-tripwire.ps1"` call from the PowerShell tool ran with no prompt or block, so no auto-approve exception was needed.
- **GEN-58:** logged a Class T new element on Vol. 8: the incremental mark advanced past a just-reported finding. Index bumped: T seen 6x; Vol. 8 has 31 write-ups and its roll-over is overdue.
- **Residuals:**
  - Only exact matches are caught, not encoded or split copies.
  - Keys not stored on this PC (Gemini, Forge, old values) aren't checked.
  - Copies outside the session folders aren't scanned.
  - Detection is after the fact.
  - A clock wrong by >5 min that is corrected between runs can skip files.
  - A replaced value is checked only against logs written since the mark, so run `-All` after replacing a key (already in Step 0b's instructions).

## Step 2 — status 2026-10-04 (session f460f324)

- **Redesign shipped** (plan [`step2-redesign.md`](step2-redesign.md), approved by Erez, /check 2 rounds). Installed, each with Erez's approval:
  - `~/.claude/hooks/auto-approve.js` (/vet-code: 2 Pass A + 2 Pass B rounds on Opus, final Pass B "safe to ship"; 110/110 fixtures; replay of 602 real calls: 13 intended changes, 0 unexplained). Any Bash/PowerShell/Monitor command naming `atlassian-put` must be the exact anchored PowerShell template, else it is refused with NO break-glass. Non-sandbox targets need `{"surface":"rest","target":"<key or page id>"}`. Raw curl writes always need a `shell` pass (the sandbox exemption was removed). Monitor Atlassian writes are refused.
  - `~/.claude/scripts/atlassian-put.ps1` (/vet-code: 33/33 unit + drift checks; a fake-key PUT to MD-3649 got 404 and exit 1). Takes `-Jira <KEY>` or `-ConfluencePage <id>`, never a URL; exits 0 only on HTTP 2xx; refuses calls nested in another script; local drive-letter body path only.
  - `~/.claude/skills/staging/SKILL.md` (/vet-rule: /check PASS round 1).
- **Live-verified without a key:** the sandbox call is allowed and stops at the key read; a non-sandbox call with no pass is refused; with a `rest` pass it is approved and the pass consumed.
- **Live success verified 2026-10-04:** Erez stored a NEW Atlassian key on this PC (Atlassian token name "Claude Code – Erez PC – 2026-10 2"). Unchanged-content PUTs: MD-3649 returned 204 (identical on re-fetch); page 1182400513 returned 200, version 3 → 4 (identical on re-fetch). The older exposed Atlassian keys are still valid: revoke them at step 4, after checking what still uses them.
- **Working rule from now on:** never type `atlassian-put` in a shell command, not even in `cat`, `grep`, `git add <file>` or a `git commit -m` message. It is refused with no override. Use the Read/Grep/Write tools, `git add -A <folder>`, and `git commit -F <file>`. A future /vet-code of the script must apply with the Write tool and hash by folder (see the script header).
- **Shipped copies + tests:** [`step2-shipped/`](step2-shipped/). [`step2-held/`](step2-held/) is SUPERSEDED (history only).
- **Follow-up filed:** [GEN-766](https://app.notion.com/p/3ef6e495d07c8158a0fad3c85a2d40d9) covers older weaknesses in the shared pass reader: a malformed pass can crash it open; a failed consume still approves in the MCP and curl arms; and break-glass lets a multi-line curl write through without a pass. It is not part of GEN-638.
- **Next-session opener:** [`NEXT-SESSION.md`](NEXT-SESSION.md) has a ready-to-paste first message.

## Step 2 — status 2026-09-30 (session 092b3490) — superseded by the 2026-10-04 status above

- **Shipped:** `~/.claude/scripts/set-claude-key.ps1`, `~/.claude/scripts/atlassian-get.ps1`, the Drive Slack scripts (they read `claude-slack-token`), the key-sheet guard in `auto-approve.js`, the global `CLAUDE.md` key rule, the notion-ticket-lookup skill + design doc, the Documentation and InvoiceAutomation `CLAUDE.md` edits (pushed), and the Forge reminder task. Evidence records are in `~/.claude-staging/{vetting,check}-passes/gen638s2-*`.
- **Next session — the held Atlassian write path:** redesign the staging-gate sandbox exemption as an exact whole-command template, harden `atlassian-put.ps1`'s URL check, drop the raw-curl sandbox exemption, then install `atlassian-put.ps1` + the hook change + the staging skill text via `/vet-code` + `/vet-rule`. The spec and all starting files are in `step2-approach.md` (STATUS) and `step2-held/`.
- **Erez's manual follow-up:** store the Atlassian and Slack keys with the helper, on each PC, in his own PowerShell window. Until he does, Slack pin/post stops with a message naming the command, and Atlassian REST is unavailable. He can store the current values now or wait for the new ones at step 4.
- **Guard facts that constrain future work:**
  - Once live, the guard refuses any non-local tool call containing the sheet's Drive id, and any shell/Monitor command naming its `.gsheet` shortcut.
    - Pass diffs to reviewers by file path, not inline.
    - Keep the id inside script files.
    - Run sweeps for the file name with the Grep tool.
  - Drive `search_files` / `list_recent_files` need `excludeContentSnippets: true`.
- **Noticed, not ours:** `Documentation/CLAUDE.md` carries another session's UNCOMMITTED edits (a HISTORY appender rule, an end-session content-review check, and removal of the "Erez is non-technical" line). They were left unstaged and untouched; only the GEN-638 lines were committed.

## Step 2 — what the next session should do (original, superseded by the status above; design is in plan.md step 2)

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
**Update 2026-10-04 (tripwire baseline):**
- Of the keys stored on this PC, only **Notion** is still found in logs (2 files, see "Step 3 — status").
- The current Atlassian key and the current GitHub login are clean.
- The exposed GitHub, Slack and Atlassian values below are OLD values that are no longer stored here, so the tripwire can't see them. They still need revoking at the service that issued them.
- After rotating, run `& "C:\Users\Erez\.claude\scripts\key-leak-tripwire.ps1" -All` (step 5's re-scan).

**Original 2026-09-29 counts:**
Distinct values by type across all session logs + git-ignored `notes/gen716-phase0/*.jsonl`: Notion 1 (the live
token), GitHub PAT 2, Slack 1, Atlassian 3, Google `AIza…` 38 (many likely public/harmless). The Gemini key's live copy
is Apps Script Script Properties `GEMINI_API_KEY` (Erez enters the new value himself). Before step 4, list each key's
actual users so nothing breaks unnoticed. Logs are local only (`sync.ps1` excludes `*.jsonl`).

## Effort
Steps 2–3: xhigh (security-sensitive rule/skill/hook changes). Steps 4–5: medium.
