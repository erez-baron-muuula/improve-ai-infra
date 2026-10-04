<!-- Saved 2026-09-30 from the session plan file (approved by Erez, /check-converged in 3 rounds). Supersedes the 2026-09-29 draft. Amended the same day: key-sheet guard added (Erez answered "yes" to the lock; guard design reviewed separately) and the install order changed. See HANDOFF.md for current status. -->

# GEN-638 step 2 — stop Claude sessions reading the key sheet

## STATUS 2026-10-04 — step 2 FULLY SHIPPED
The held Atlassian write path was redesigned and installed on 2026-10-04 (session f460f324). Design:
[`step2-redesign.md`](step2-redesign.md) (approved by Erez, /check-converged in 2 rounds). The script takes
a Jira key or Confluence page id instead of a URL, so the hook reads the target exactly. Installed, each
through /vet-code or /vet-rule with Erez's approval: `auto-approve.js` (anchored `atlassian-put` template,
target-bound `rest` pass, raw-curl sandbox exemption removed, Monitor writes refused), `atlassian-put.ps1`,
and `staging/SKILL.md`. Shipped copies, the installed diff and the tests are in
[`step2-shipped/`](step2-shipped/). Pending, needs Erez's Atlassian key stored on this PC: one real PUT
on Jira sandbox MD-3649 and one on Confluence sandbox page 1182400513, each re-fetched to confirm.
The text below describes the 2026-09-30 state and the rejected -Url design; it is kept as history.

## STATUS 2026-09-30 — mostly shipped; the Atlassian write path is HELD for a redesign
**Shipped and verified (session 092b3490):**
- `~/.claude/scripts/set-claude-key.ps1` (helper): 20 live checks and 8 simulated branch checks. On this PC, `PasswordVault.Add` overwrites an existing entry, so the rotation path works.
- `~/.claude/scripts/atlassian-get.ps1`: GET only. `-OutFile` is limited to TEMP.
- `slack-post.js` / `slack-pin.js` on Drive read `claude-slack-token` themselves. A dummy key was rejected by Slack as `invalid_auth`, which proves the read path.
- `auto-approve.js`: the key-sheet guard ONLY (`enforceKeySheetGuard`, Part A + Part B). The Drive-shortcut file-name match applies to shell and Monitor commands only (a real false fire on a sub-agent brief caused this narrowing). Tests:
  - 35/35 guard fixtures pass.
  - The pass-consumption assertion passes 3/3.
  - Real-traffic replay: 564 calls, 0 false fires, 17 intended changes (16 Drive previews, 1 past sheet read).
  - Pass B round 3 on the guard-only diff: PASS.
  - Live-fired: a Drive search without the flag was refused; with the flag it went through.
- Text: the global `CLAUDE.md` rule, the `notion-ticket-lookup` `SKILL.md` + `SECURE-LOOKUP-DESIGN.md`, the Documentation `CLAUDE.md` (commit 2264eaa), the InvoiceAutomation `CLAUDE.md` (commit bfbef93) and the Forge reminder task. Each was `/check`-converged and verified byte-identical to its reviewed copy.
**HELD (not installed):** `atlassian-put.ps1`, the staging-gate changes (the `atlassian-put` name branch, the sandbox-exemption rewrite, Monitor in the staging check) and the `staging/SKILL.md` text. The staging skill still names the sheet (line ~62); the live guard blocks any attempt to act on it, and no Atlassian key is stored yet anyway.
**Why held:** the sandbox exemption (a write to a registered sandbox needs no staging pass) failed Pass B three times. Each fix was a text match on the command, and the text differs from what PowerShell/Bash build and curl sends: a quote splice `MD-3649'/../MD-1'`, `%2e%2e` (curl 8.14+), `MD-3649'0'`. The `/vet-code` rule says to stop and surface the standoff rather than patch again (logged on GEN-58 Class E).
**Redesign for next session** (Pass B's own recommendation; follows GEN-508's exact-invocation lesson):
- (a) Exempt an `atlassian-put` call only when the WHOLE command matches one anchored template:
  - `-Url` is one fully quoted literal, with nothing adjacent;
  - its path, with the query cut, EXACTLY equals `rest/api/[23]/issue/<sandbox key>`, `wiki/rest/api/content/<sandbox id>` or `wiki/api/v2/pages/<sandbox id>`;
  - no `%`, `;`, `\` or dot-segments;
  - `-BodyFile` is quoted.
  - Anything else needs a pass.
- (b) `atlassian-put.ps1` (and `atlassian-get.ps1`) refuse a `-Url` containing `..`, `%`, `;`, `\` or `/./`.
- (c) Drop the raw-curl sandbox exemption (the staging skill sends writes through `atlassian-put`), which also closes the `-K` / `.curlrc` / `--variable` class.
- (d) Consume a staging pass only on a template-matching command.
- (e) Consider scanning Monitor under both Bash and PS chain rules.
- Starting points in `step2-held/`: `held-hook-changes.diff` (guard-only → the held version), `atlassian-put.ps1`, `staging.SKILL.reviewed.md` (the reviewed staging text, whose Step 0 grep list must then name the new template function), `test-hook-fixtures.js` (59 cases), `test-hook-corpus.js`, `test-pass-consume.js`.

## In plain terms (what approving this means for you)
- Claude will never open your `API tokens and keys - AI` sheet again. Each key Claude needs will come from Windows' own password store on the PC, and will never be shown in the chat or typed into a command. The sheet itself stays as it is; what to do with it is your call, later.
- **What you do:** on each PC, run one small command per key and paste the key into a hidden prompt, so Claude never sees it. Two keys need this: Atlassian (for the coloured redline edits to Jira/Confluence) and the Slack bot (pinning and posting). You can store today's keys now, or wait and store the new ones when you replace them in step 4. Until you store them, Claude will tell you it can't pin or post in Slack or do a redline edit, and will give you the exact command to run.
- **Nothing to do** for Notion (already stored), GitHub (Claude uses the login Git already keeps on this PC), or Gemini (it lives inside your Apps Script).
- **Next year's Forge renewal:** you type the new key into Forge's own login prompt yourself; Claude only checks that it worked.
- **Technical lock (you said yes, 2026-09-30):** Claude is blocked from every direct route to the sheet (Google Drive, typing its address into a browser, fetching it from the web, running a command against it), and Drive searches no longer return content previews, so a search can't copy the sheet's contents into the log by accident. **Not caught:** a copy of the sheet, reaching it by clicking around inside a browser, or a script file with the sheet's ID written inside it; step 3's end-of-session check is the backstop. (An earlier message said "by any route"; that overstated it.)
- **Effort for the build: xhigh.** These changes decide where your keys can end up, so they go through the full review process.
- An independent review panel checked this design over 3 rounds. It found 3 real problems, and all 3 are fixed below. The technical lock was reviewed separately after you approved it.

## Context
[GEN-638](https://app.notion.com/p/3b26e495d07c81f68d1aebc8428e377b) is a 5-step bundle. Step 1, which keeps keys off command lines, shipped on 2026-09-29. This is step 2 ([GEN-163](https://app.notion.com/p/3756e495d07c80c0bd21d87990523acb), with [GEN-425](https://app.notion.com/p/39c6e495d07c8182a59ed6ae3d9a2300) folded in).

Today several rules tell sessions to get keys from the `API tokens and keys - AI` sheet. Reading that sheet writes every key into the session log, which is the likely cause of the 2026-09-27 multi-key leak. Some of those recipes also put the key on a command line. The goal is for every key a session uses to come from a store on the PC itself, one that Erez fills and whose values never pass through Claude.

That has to land before step 4, where Erez replaces every exposed key with a new one, or the new keys would just leak the same way. This plan elaborates the approved `notes/gen638/plan.md` step 2.

Goals:
- **G1.** No rule, skill or scheduled task sends a session to the sheet.
- **G2.** Every key a session uses comes from a named store on this PC, put there by Erez without the value passing through Claude.
- **G3.** If a key is missing on a PC, the task stops and names the one command Erez runs to store it. It never falls back to the sheet or the chat.
- **G4.** The Documentation GitHub recipe no longer puts the token on a command line (GEN-425).
- **G5.** Nothing built here puts a key on a command line or prints it.
- **Non-regression.** Erez's approval gate for Jira/Confluence content writes (the staging gate) still catches every write.

## Where each key will come from
| Key | Used by today | New source |
|---|---|---|
| Notion | lookup script, staleness hook, ad-hoc REST | Credential Manager `claude-notion-token`, already in place. No change |
| GitHub | Documentation `CLAUDE.md` API reads of Muuula/MemoryPirates | Git's stored github.com login, read with `git credential fill` via the existing `hooks/refs/shell.md` pattern. Verified this session: HTTP 200 on the repo, token never on the command line or printed. No new entry |
| Atlassian API token | `staging` skill: REST GET for the rendered preview and fresh reads; REST PUT for the retained redline | New entry `claude-atlassian-token`, used only inside two new scripts |
| Slack bot token | `slack-pin.js` / `slack-post.js` (Drive `_Tooling/Claude/`) | New entry `claude-slack-token`, read by the scripts themselves |
| Forge token | `renew-forge-atlassian-token` scheduled task (~2027-06) | Erez runs `forge login` himself (it prompts). Forge keeps its own login. Claude only checks `forge whoami` |
| Gemini | Apps Script Script Properties | Unchanged. Only the stray sheet mention is removed |

## Build (in order)
1. **Key helper:** `~/.claude/scripts/set-claude-key.ps1` (new, via /vet-code; synced to every PC by `sync.ps1`).
   - Erez runs it in his own PowerShell window: `powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\.claude\scripts\set-claude-key.ps1" -Key slack`
   - `-Key` takes one of a fixed list: `notion`, `atlassian`, `slack`, each mapped to `claude-<key>-token`. This list is the single inventory of Claude's stored keys; step 3's tripwire reads it.
   - The value comes only from a masked prompt (`Read-Host -AsSecureString`). No parameter accepts a value.
   - It validates the value: non-empty, at least 20 characters, and only token-safe characters (no spaces, quotes or control characters). Invalid input stores nothing.
   - Storing has to work whether or not `PasswordVault.Add` overwrites an existing entry; the evidence is mixed (one web source says it replaces, while this project's GEN-322 bootstrap removed the old entry before re-adding, HISTORY.md line 3968). So:
     - it calls `Add`, and if that refuses because the entry exists, it removes the old entry and adds again;
     - it then reads the entry back and compares it with the typed value in memory, printing only "match" or "no match";
     - if the add fails after a remove, it says so plainly ("the old key was removed and the new one was not stored — run the helper again");
     - "no match" counts as a failure. After a plain `Add` it tries one remove-then-add and reads back again. If it still does not match, it prints no "stored" line, exits with an error, and tells Erez to run the helper again.
   - It confirms with "stored <key> on this PC (N characters)" and never prints the value.
   - `-List` prints which keys are stored on this PC, names only. Claude may run it to diagnose a missing key.
2. **Atlassian scripts** (new, via /vet-code), modelled on `~/.claude/scripts/notion-ticket-lookup.ps1`.
   - The HTTP method is fixed inside each script and cannot be set by any parameter. GEN-508's review found that a gate cannot reliably read a method passed as a parameter: PowerShell accepts shortened parameter names, and `$PSDefaultParameterValues` can inject values.
   - `atlassian-get.ps1 -Url <url> [-OutFile <path>]`: GET only, no body.
   - `atlassian-put.ps1 -Url <url> -BodyFile <path>`: PUT only.
   - Both scripts:
     - refuse any URL not under `https://muuula.atlassian.net/`;
     - read `claude-atlassian-token`. The account email (non-secret) is fixed in the script;
     - check the token's characters the way the lookup script does (line 47);
     - write a curl config line `user = "<email>:<token>"` (curl builds the Basic header) to a temp file, and run `curl.exe -q -sk -K <file> …`;
     - delete the file in `finally`, sweep their own leftovers older than 10 minutes, and never use `-v`;
     - print the response and the HTTP status. If the key is missing, stop with the G3 message.
3. **Staging gate + key-sheet guard:** `~/.claude/hooks/auto-approve.js` (locked; via /vet-code, then `update-config.ps1`).
   - In `isAtlassianMutatingHttp` (line 749), add one independent branch, checked first (before the existing host and curl-word early returns at lines 751–752, which a script call would never pass): a shell command that mentions `atlassian-put` anywhere is an Atlassian write. This follows GEN-508's lesson to trigger on the script's basename.
     - The existing handling at lines 800–839 then applies unchanged: a chained or multi-line command is hard-blocked, a sandbox URL is exempt, and anything else needs a staging pass.
     - `atlassian-get` needs no gate, because it cannot write.
     - Cost, stated in the code: a shell command that merely names the script (cat, grep) is treated as a write. Use the Read/Grep tools instead.
   - **Key-sheet guard** (Erez approved 2026-09-30), a new `enforceKeySheetGuard` called right after `blockIfProtected`. That is before every allow path, since the Drive read tools are bare-listed in `settings.json` and in `SAFE_TOOLS`. Both parts exit 2 and have no break-glass.
     - **Part A:** block any MCP tool (the Drive connector, both browsers), WebFetch or shell call whose input contains the sheet's Drive file id.
       - Local file tools are not covered: they cannot fetch a Google Sheet, and covering them would block editing the hook itself.
       - The refusal names both stores: Credential Manager (`set-claude-key.ps1`) and Git's stored login for GitHub.
     - **Part B:** block a Drive `search_files` or `list_recent_files` call unless `excludeContentSnippets` is `true`, because both return about 5,000 characters of each result by default. Claude re-runs with the flag and then opens only the file it needs.
     - `tool_input` is null-guarded, so a missing input cannot throw. An exit-1 throw is non-blocking and would skip every later gate.
     - The not-caught routes are written into the code comment and the Residual section below.

**Install order** (changed 2026-09-30 so nothing breaks in between):
- (a) Install the new scripts and the Slack scripts.
- (b) Make the text updates in item 5, except the staging skill.
- (c) Install `auto-approve.js`, with the guard and the `atlassian-put` branch. The guard never goes live while an instruction still sends sessions to the sheet (the Documentation GitHub recipe).
- (d) Update the staging skill text. This is what first points sessions at `atlassian-put.ps1`, so it lands only after that script's gate branch is live.

Between (a) and (c), `atlassian-put.ps1` exists without its gate branch. That is harmless: nothing points sessions at it until (d), and no Atlassian key is stored on this PC (`-List` printed "NOT set up" on 2026-09-30), so the script stops at the key read.
4. **Slack scripts:** `slack-pin.js` and `slack-post.js`. They are not a gated path, but they go through /vet-code because they handle a key.
   - They read `claude-slack-token` with the vetted pattern from `notion-fetch-staleness.js` (lines 144–156): a child PowerShell prints the value to a captured pipe. The value is never echoed and never appears in an error.
   - The token env vars (`SLACK_PIN_TOKEN` / `SLACK_BOT_TOKEN`) are removed, so no session ever types a token into a command.
   - If the key is missing, they stop with the G3 message. The message text still passes via `SLACK_MSG`, and the script header is updated.
5. **Text updates** (per the install order above: all except the staging skill before the hook; the staging skill after it):
   - Global `CLAUDE.md` rule "Never ask Erez to paste…" (/vet-rule + `update-global-rule.ps1`). Draft, which passed the rule-check lens:
     > "Never ask Erez to paste, share, or type API tokens, secrets, or credentials in the chat, and never open the key sheet (`API tokens and keys - AI`) in a session — reading it writes every key into the session log. Read each key at runtime from this PC's own store (Windows Credential Manager; Git's stored login for GitHub) into a variable that is never printed or put on a command line; the key list and the command that stores a key are in `~/.claude/scripts/set-claude-key.ps1`. If a key is not stored on this PC, stop and give Erez that command, to run in his own terminal — never fall back to the sheet or the chat."
   - `staging/SKILL.md`, lines 61–64 and 152–154: REST GET goes through `atlassian-get.ps1`, the retained-redline PUT through `atlassian-put.ps1` (/vet-rule).
   - `notion-ticket-lookup/SKILL.md` (line ~53) and `SECURE-LOOKUP-DESIGN.md` (bootstrap step): the one-time setup becomes the helper (/vet-rule).
   - Documentation `CLAUDE.md` (/check + Erez's approval; committed in that repo):
     - `## GITHUB`, lines 29–30: use Git's stored login via the `shell.md` pattern. If none exists on the PC, Erez signs in to GitHub once through Git in his own terminal, e.g. `git ls-remote https://github.com/Muuula/MemoryPirates`, which opens the sign-in. This closes GEN-425.
     - Slack pin line 95: the script reads its own key.
     - CORE RULES line 130: defer to the global rule.
   - InvoiceAutomation `CLAUDE.md` line 78: the Gemini key stays in Script Properties, and any key a session needs follows the global rule. No sheet mention. (/check + Erez's approval.)
   - `renew-forge-atlassian-token` scheduled task:
     - Erez runs `forge login` himself (with the TLS setting it needs) and Claude only confirms with `forge whoami`;
     - no sheet read and no token on a command line;
     - updated with the scheduled-tasks tool.
6. **Erez stores the Atlassian and Slack keys** with the helper, on each PC, whenever he chooses. Until then, those two features stop with the G3 message.
7. **Bookkeeping:**
   - Replace the draft `notes/gen638/step2-approach.md` with this reviewed design. It converged after 3 review rounds.
   - Update `notes/gen638/HANDOFF.md`, `HISTORY.md` and the ticket notes.
   - On approval, move GEN-163 and GEN-425 from To Do to In Progress. That is proposed here and covered by approving this plan.
   - Closing them is proposed at bundle step 5, per the approved plan.

## Verification
- **Helper.** The store function is tested with the existing dummy entry (`claude-dummy-test`):
  - invalid input is rejected and a valid value is stored;
  - storing a second, different value for the same key reads back as the second value (the rotation case);
  - `-List` shows names only, and no output contains a value;
  - a unit check covers the remove-then-add branch and its messages, which a PC where `Add` overwrites would never reach. Erez's first real run is the end-to-end check.
- **atlassian-get.**
  - Before the key is stored: the G3 message.
  - A non-Atlassian URL is refused.
  - After Erez stores the key: a GET of a known issue with `expand=renderedFields` returns 200.
- **Gate:** fixtures through the real hook (a written `.js` driving `auto-approve.js` via `spawnSync`/stdin):
  - an `atlassian-put` call without a pass is blocked;
  - chained or multi-line calls are blocked;
  - a sandbox-ticket URL takes the exempt path;
  - with a pass it is approved and the pass is consumed;
  - existing curl-arm fixtures are unchanged.
  - Then one real PUT on the registered sandbox ticket after the key is stored.
- **Key-sheet guard:** fixtures through the real hook.
  - Every route that carries the sheet's id is blocked: Drive read, download, metadata and copy; both browsers; WebFetch; Bash and PowerShell.
  - It is not blocked in Write, Edit, Read or Grep.
  - Drive search and recent-files listing without the flag are blocked, and allowed with it.
  - A missing or null input causes no crash.
- **Real-traffic replay** (/vet-code Step 4): real past tool calls from this machine's transcripts go through both the live and the working hook. It prints counts only, never content. Every changed decision must be an intended one.
- **Slack:** a missing key gives the G3 message. A temporary dummy value makes Slack answer `invalid_auth`, which proves the read path; then the dummy is removed.
- **All changed scripts:** /vet-code's Step 3 secret-on-command-line check.
- **Final sweep:** a grep of rules, skills and scheduled tasks finds no instruction to read the sheet.

## Residual (not solved by this step)
- **Per-PC setup.** Keys must be stored on each PC. Atlassian REST and Slack pin/post are unavailable until Erez stores those two keys: the current values now, or the new ones at step 4.
- **Key-sheet guard limits.** Step 3's end-of-session tripwire is the after-the-fact backstop for all of these:
  - A copy of the sheet has a new id, so it is not caught.
  - Reaching the sheet by clicking around inside a browser and then reading the page is not caught, because neither call carries the id.
  - A script file that contains the id, run by a command that doesn't name the id, is not caught.
  - Part B depends on today's Drive tool and parameter names (`search_files`, `list_recent_files`, `excludeContentSnippets`).
  - Sub-agent tool calls are covered only if hooks fire for sub-agents, which depends on the Claude Code version, as it does for the other gates.
- **Temp file.** The temp curl config file exists in TEMP while a request runs. It is swept after 10 minutes.
- **Name obfuscation.** A deliberately obfuscated script name evades the gate's text match. This is the same accepted limit as today's curl arm.
- **Forge.** Renewal stays a manual step for Erez.
- **GitHub on a new PC** needs a one-time Git sign-in.
