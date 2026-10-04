<!-- Saved 2026-10-04 from the session plan file (approved by Erez; /check converged in 2 rounds). See HANDOFF.md for current status. Build note (2026-10-04): the GitHub read feeds `git credential fill` from a temp file through cmd.exe's byte-exact `<` redirect, not through .NET Process.StandardInput -- on this PC the PowerShell host's console input encoding is UTF-8 WITH a BOM (checked: GetPreamble().Length = 3), and .NET creates the StandardInput writer with that encoding and flushes the BOM at start, which is the corruption shell.md line 20 describes. The intent (no PowerShell pipe; the temp file holds only protocol/host) is unchanged. -->

# GEN-638 step 3 — end-of-session key-leak tripwire

> **STATUS 2026-10-04 — SHIPPED** (session 59955ba8). The script is installed at `~/.claude/scripts/key-leak-tripwire.ps1` and `/wrap` has Step 0b. Copies and tests are in [`step3/`](step3/). Code review changed four things below; Erez approved each before install.
> 1. A run that found a key is never the incremental mark, so a found key is re-reported at every wrap until it is replaced. This replaces the "Repeat findings" bullet in section 2.
> 2. The mark is the last-APPENDED clean run, not the run with the highest start time.
> 3. A full scan is also forced when:
>    - a key name was not checked by the mark run;
>    - the mark is dated in the future;
>    - `~/.claude/projects` is missing, which is reported as a problem.
> 4. GitHub is read via `cmd.exe <` from a temp file, not via .NET StandardInput (see the build note above).
>
> The `/wrap` text also says:
> - a merge into an already-open ticket that tracks replacing the key satisfies the ticket requirement;
> - "never open a found file" wins over re-reading this session's own transcript after a `/compact`.
>
> Status and results: [`HANDOFF.md`](HANDOFF.md).

## In plain terms (what approving this means for you)

- **What it does:** every time you run `/wrap`, Claude checks whether any of the keys it uses (Notion, Atlassian, Slack, and your GitHub login) has shown up in a Claude session's record on this PC since the last check. The check never shows or sends the key anywhere; it only says *which* key, in *which* session.
- **If a key shows up:** your end-of-session summary says so in plain words, with what to do (make a new key, store it with the usual one-line command, cancel the old one), and a ticket assigned to you is filed so it isn't forgotten. The ticket stays open until the key is replaced.
- **Calls I made for you (veto any):**
  - **It covers sessions you never wrapped.** It checks everything written since the last check, not just the current session, so a session you closed without `/wrap` is caught at your next wrap. Cost: a small record file on this PC remembers when it last checked.
  - **GitHub is included**, because Claude uses your GitHub login and it was exposed before. Cost: one extra moving part. If it can't be read safely, I'll tell you and leave GitHub out.
  - **The desktop app's agent-mode sessions are included too.** It costs nothing extra.
- **First run, at install:** a one-time full sweep of every old session on this PC. It should flag the Notion key (already known to be exposed; if it doesn't, the check itself is broken) and will tell us whether the GitHub and Atlassian keys are too. That list feeds step 4, where you replace keys.
- **What it can't do:** stop a leak as it happens, or recognise a key that was disguised or cut in half. Keys Claude doesn't keep on this PC (Gemini, Forge) aren't checked.
- **Possible snag:** Claude's automatic permission check might block the run. If so, the fix is a narrow exception for this exact command. That's a separate small change, and your call when it comes up.
- **Effort for the build: xhigh.** Same as steps 1–2: this code handles your keys, so it goes through the full review process.
- **Review:** an independent review panel checked this design over 2 rounds. It found one real problem: a found key could hide a broken check in the same run. That's fixed below.

## Context

[GEN-638](https://app.notion.com/p/3b26e495d07c81f68d1aebc8428e377b) is a 5-step bundle to stop API keys leaking into Claude session logs and then replace every exposed key. Steps 1–2 shipped (keys off command lines; keys come from Windows Credential Manager instead of the key sheet). Step 3, from the approved `notes/gen638/plan.md`:

> Add a `/wrap` step that checks whether any stored Credential Manager value appears in the current session's log. It reports only the key's name, as "rotate X" in the "For you" block. Safety constraints, enforced in its `/vet-code` pass: comparison is plain in-memory text matching; the secret is never passed to another program, and no pattern is built from it; every error path reports the key's name only, never its value.
> Residual: the tripwire only runs at `/wrap`; a session that ends without `/wrap` isn't checked until a later one runs it. The auto-mode permission check may block the tripwire's read of stored values.

It is the after-the-fact backstop for leak routes nobody has closed (named in `step2-approach.md` Residual: a copy of the key sheet, a sheet reached by clicking through a browser, a script that holds the sheet id, a future script bug).

## Facts this design rests on (checked this session)

- Key inventory: `~/.claude/scripts/set-claude-key.ps1` lines 13–14 and 29–33 — `$KeyTargets` = notion → `claude-notion-token`, atlassian → `claude-atlassian-token`, slack → `claude-slack-token`; header says "the GEN-638 step-3 tripwire reads it". Script is dot-source-safe (line 148–149 guard).
- On this PC the vault holds `claude-notion-token`, `claude-atlassian-token`, 2× `claude-dummy-test`; Slack is not stored (PasswordVault `RetrieveAll()` names only).
- GitHub: Git's stored login is one Windows credential, target `git:https://github.com` (`cmdkey /list`, names only). The global rule names it as a key store Claude reads. Piping text from PowerShell 5.1 into `git credential fill` fails (BOM/CRLF; `hooks/refs/shell.md` line 20).
- Session logs: `~/.claude/projects/<project>/<session>.jsonl`, plus `<session>/subagents/` (110 folders) and `<session>/tool-results/` (48 folders; this session's own saved outputs land there). Total 3,517 files / 748.5 MB; 75 files / 18 MB changed in the last 24 h; largest single log 20.9 MB.
- The desktop app's agent-mode sessions keep their own transcripts under `%APPDATA%\Claude\local-agent-mode-sessions\…\.claude\projects\…jsonl` (Get-ChildItem listing this session: 657 files, incl. that `.jsonl` path). `%APPDATA%\Claude\claude-code-sessions\*.json` holds session metadata only (top-level field-name listing of the largest file this session: ids, cwd, title, model, permission settings…; no transcript).
- `sync.ps1` never syncs `*.jsonl` (header line 48; coverage ignore list line 541), so a `.jsonl` state file stays per-PC.
- Permission mode defaults to `auto` (`settings.json` line 294). Precedent: when the auto-mode check blocked the sanctioned Notion lookup script, an exact-command allow was added to `auto-approve.js` (`isSafeNotionTicketLookup`, lines 443–447, used at 4123; GEN-316).
- Known positive control: the 2026-09-29 scan found the current Notion token in two session logs (2026-09-20, 2026-09-27) plus a git-ignored derived file (`plan.md` Context).

## Design

### 1. A read-only scan script: `~/.claude/scripts/key-leak-tripwire.ps1` (new, via /vet-code)

**Which keys:** every key in the helper's `$KeyTargets` (read by dot-sourcing the helper inside a function, so its names can't collide with the tripwire's), plus Git's stored GitHub login. A key not stored on this PC gets the status `not-stored` (reported, not an error). Any value under 20 characters is not checked (would false-fire) and gets `too-short`.
- Vault keys: read in-process with `PasswordVault.Retrieve` + `RetrievePassword()`, the helper's own pattern (`set-claude-key.ps1` lines 56–60).
- GitHub: `git credential fill` started with .NET `Process` and its two input lines (`protocol=https`, `host=github.com`, LF endings) written as raw ASCII bytes straight to its input stream — no PowerShell pipe, so none of the BOM/CRLF corruption `shell.md` line 20 describes. Sign-in prompts are disabled for that child only (`GCM_INTERACTIVE=never`, `GIT_TERMINAL_PROMPT=0`), with a time limit; the `password=` line is parsed in-process and stderr is discarded. This mechanism is unproven on this PC: /vet-code must show it returns the stored login and that a host with no login returns at once with no sign-in window. If it can't, GitHub drops out and becomes a stated residual.

**Which files:** every file under `~/.claude/projects` and `%APPDATA%\Claude\local-agent-mode-sessions` whose last-write time is at or after (last completed scan's start − 5 minutes). No completed scan yet on this PC → all files. `-All` forces all files (used for the install-time baseline and the step-5 re-scan).

**How it matches:** each file is read as UTF-8 text with read/write sharing (so live logs can be read), and checked with `String.IndexOf(value, Ordinal)`. No regex, `-match`, `-like`, `Select-String`, external search tool, or derived variants (encoded forms, prefixes).

**What it prints (allowlist):** one JSON object — scan start/end, mode, files scanned, and per key one of `clean | found | not-stored | too-short | could-not-check`; for `found`, the matching files' paths (project folder, session id, file name) and last-write dates. Problems are fixed reason codes (`inventory-missing`, `vault-read-failed`, `github-read-failed`, `file-unreadable` + path). It turns PowerShell tracing off first (as the Atlassian write script does, since a trace can echo variable values), wraps everything in one top-level catch, never prints an exception message, never lets a value leave the process, and clears the secret variables after the scan. A file that vanishes between listing and reading (log cleanup) is skipped, not a problem.

**Exit code:** 0 = complete and clean; 2 = at least one key found (even if something else failed); 1 = could not complete (a stored key couldn't be read, the inventory is missing, or a file couldn't be read). `not-stored` and `too-short` are statuses, not problems.

**State:** appends one line per run to `~/.claude/hooks/key-tripwire-scans.jsonl` (same JSON as printed: names, paths, counts — no values). The "last completed scan" is the latest line whose run had no problems. An incomplete run doesn't move it, so the next wrap re-covers the same files (a key that stays unreadable therefore shows ⚠ at every wrap until fixed). Per-PC, never synced.

### 2. `/wrap` gets a new "Step 0b — Key check", run before "Capture unresolved items" (via /vet-rule)

Slotted as Step 0b (after "Determine the active project", before Step 1) so no existing step number or cross-reference changes, and so a finding becomes a ticket in the same wrap. It runs in every session, project or not.
- Run the script once from the PowerShell tool, alone.
- **Read the JSON whatever the exit code, and report every item in it** — a found key never hides a separate problem in the same run:
  - each `found` key → a "Key check" line in the For-you block, in plain words: which key, where (project and date — not secret, and needed so Erez and the next session know which session leaked), and what to do: make a new key at the service that issued it, store it with the helper command (GitHub: sign in again through Git), then revoke the old one. It is also an unresolved item for Step 1: ticket "Rotate the <name> key — its value appeared in a session log", assigned to Erez, under the AI-infra epic. While one with that exact title is still open, Step 1's exact-title check skips it (no second ticket; the For-you line still appears). Recorded in the HISTORY entry on its own line.
  - each problem — any key with status `could-not-check`, and every entry in the problems list (`inventory-missing`, `vault-read-failed`, `github-read-failed`, `file-unreadable`) → ⚠ in the roll-up with a one-line reason; the next wrap re-checks the same files automatically.
  - nothing found and no problems → ✓ only.
- **Exit code as a cross-check:** if the JSON can't be read, exit 2 → "a key was found but the details couldn't be read — run the check again before anything else"; exit 1 → ⚠; exit 0 → ⚠ "couldn't confirm the result".
- Any found key or problem forces the full report.
- **Repeat findings:** a key keeps showing "found" at every wrap only while a still-growing log contains it, or while a failed run keeps the same files in scope; the line repeats each time (no new ticket, per Step 1's duplicate check) until the key is replaced, which is the stop condition.
- **Never open a flagged file** with Read/Grep/shell to "look" — that would copy the key into the current session. Investigate only with counts/positions.

### 3. Permission check

Run it as a plain `& "C:\Users\Erez\.claude\scripts\key-leak-tripwire.ps1"`. If the live install test shows the auto-mode check blocking it, the fix is an exact-command allow in `auto-approve.js` like the Notion lookup's — a separate /vet-code change, Erez's call at that point.

## Alternatives considered

- **An automatic hook instead of a /wrap step — at every session start, or at every session's end.** Strongest reason: covers sessions that never run /wrap, without waiting for the next wrap. Not chosen: a hook change plus settings registration (locked config), seconds added to every session, and a session-end hook has no one to tell (the session is closing), so it would still need /wrap or the next session to surface the result — while scanning "everything since the last check" at /wrap already reaches sessions that skipped /wrap, one wrap later.
- **Pattern scan instead of exact stored values** (the existing `hooks/secret-patterns.json`, or an off-the-shelf scanner such as gitleaks/trufflehog). Strongest reason: also finds keys that aren't stored on this PC (old keys, other services). Not chosen: hits on dead/old keys, examples and test dummies; it can't say which live key to replace; showing what matched risks printing the key; an outside tool is a new dependency and would have to be handed the logs or the value.
- **Only the current session's log (the plan's literal wording).** Strongest reason: no state file. Not chosen: a session that ends without /wrap would then never be checked, which contradicts the plan's own residual ("until a later one runs it").
- **Every credential in Windows Credential Manager (75+ entries).** Strongest reason: catches keys nobody listed. Not chosen: loads Erez's personal saved passwords into the scan, false hits on short/common values, and the approved step-2 design named the helper's list as the tripwire's inventory.

## Verification

- **Unit test (no real key involved):** the test generates a random value in-process, stores it under a test-only vault entry of its own (not the existing `claude-dummy-test` entries, which it leaves untouched), writes it into a temp "log", runs the scan functions with a one-key test inventory and the temp folder; asserts "found" by name, a clean file stays clean, a found key plus a forced problem both appear in one run's JSON, exit codes 0/1/2, and — checked in-process, printing only pass/fail — that nothing the script printed or appended contains the value. Then removes exactly that test entry and the temp files. GitHub: the stored login is read on 5 consecutive runs (status `clean` or `found`, never `could-not-check`; one failure = not proven), and a host with no stored login returns quickly with no sign-in window.
- **/vet-code:** two code-review passes, including the secret-on-command-line check.
- **Live baseline (`-All`) at install:** must report Notion `found` (independent anchor: the 2026-09-29 scan) and state GitHub/Atlassian as found or clean. These are the already-known exposures: they go into the step-4 list in `notes/gen638/HANDOFF.md`, not into new tickets (GEN-638 step 4 covers them). Then an ordinary run must scan only recent files and finish in seconds.
- **/wrap text:** /check on the exact step text inside /vet-rule.

## Build steps (after approval; each gate step stops for Erez where its skill says so)

1. Save this approved design as `notes/gen638/step3-approach.md`; working copies and tests go in `notes/gen638/step3/`.
2. Write `key-leak-tripwire.ps1` (ASCII-only) and its tests, reusing the helper's inventory and vault-read pattern (`set-claude-key.ps1`) and the tracing-off line from `atlassian-put.ps1`.
3. `/vet-code` the script: two code-review passes (one in-session, one independent), the unit tests, the 5× GitHub read check, then install to `~/.claude/scripts/`.
4. Live: run `-All` once (baseline: Notion must show `found`), record the key names and file counts in HANDOFF's step-4 list, then run an ordinary check (recent files only, seconds) and note whether the permission check prompted or blocked it.
5. If it was blocked: propose the exact-command exception as its own `/vet-code` change, for Erez to decide.
6. `/vet-rule` the `/wrap` Step 0b text: `/check` on the exact text, then show Erez the verdict and apply only after he approves.
7. Bookkeeping: HANDOFF step table, `plan.md` status line, the GEN-638 memory note, then commit `notes/gen638` (with `git add -A <folder>` and `git commit -F <file>`).

## Residual (not solved)

- Only exact matches: an encoded, split or truncated copy of a key is missed.
- Keys not stored on this PC (Gemini in Apps Script, Forge's own login, old already-replaced values) aren't checked.
- Copies outside the session folders (hook logs, git-ignored derived files in project folders, desktop-app diagnostic logs) aren't scanned; the key also already appeared in a session log in every route seen so far.
- A leak during the wrap itself, or in a session that never wraps, is caught at the next /wrap on that PC — not instantly.
- Detection is after the fact: the key has already reached the session by then.
