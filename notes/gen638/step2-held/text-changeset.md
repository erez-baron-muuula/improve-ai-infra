# GEN-638 step 2 — text change set (for /check)

## global — `C:/Users/Erez/.claude/CLAUDE.md`

**Old:**
```text
Never ask Erez to paste, share, or type API tokens, secrets, or credentials in the chat. Always read them from the designated secure storage: `G:\My Drive\AI Projects\API tokens and keys - AI.gsheet`. This applies in Claude Code.
```
**New:**
```text
Never ask Erez to paste, share, or type API tokens, secrets, or credentials in the chat, and never open the key sheet (`API tokens and keys - AI`) in a session — reading it writes every key into the session log. Read each key at runtime from this PC's own store (Windows Credential Manager; Git's stored login for GitHub) into a variable that is never printed or put on a command line; the supported key names and the command that stores a key are in `~/.claude/scripts/set-claude-key.ps1`. If a key is not stored on this PC, stop and give Erez that command, to run in his own terminal — never fall back to the sheet or the chat.
```

## lookup-skill — `C:/Users/Erez/.claude/skills/notion-ticket-lookup/SKILL.md`

**Old:**
```text
primary single-id lookup mechanism. It requires Erez to have run the one-time
   bootstrap (GEN-322) — if the credential isn't stored yet, it will fail and you fall
   through to step 4.
```
**New:**
```text
primary single-id lookup mechanism. It requires the Notion key to be stored on this PC
   (Erez stores it with `~/.claude/scripts/set-claude-key.ps1 -Key notion`) — if it isn't,
   the lookup fails: give Erez that command, then fall through to step 4.
```

**Old:**
```text
Requires the Notion API token stored in Windows Credential Manager (GEN-322 one-time
bootstrap by Erez).
```
**New:**
```text
Requires the Notion API token stored in Windows Credential Manager (entry
`claude-notion-token`; Erez stores or replaces it with `~/.claude/scripts/set-claude-key.ps1 -Key notion`).
```

## lookup-design — `C:/Users/Erez/.claude/skills/notion-ticket-lookup/SECURE-LOOKUP-DESIGN.md`

**Old:**
```text
### Bootstrap (ONE TIME, done BY EREZ, with no Claude involvement)

```
**New:**
```text
### Bootstrap (ONE TIME, done BY EREZ, with no Claude involvement)
**SUPERSEDED 2026-09-30 (GEN-638 step 2):** the store step is now `~/.claude/scripts/set-claude-key.ps1
-Key notion`, which Erez runs in his own PowerShell window on each PC (masked prompt; also used to
store a new value after a rotation). The steps below are the original design, kept for history.

```

## staging-skill — `C:/Users/Erez/.claude/skills/staging/SKILL.md`

**Old:**
```text
Check `C:\Users\Erez\.claude\hooks\auto-approve.js` contains BOTH:
```
**New:**
```text
Check `C:\Users\Erez\.claude\hooks\auto-approve.js` contains ALL of:
```

**Old:**
```text
- in `commandReferencesSandbox`: a boundary-anchored match (`(?<![a-z0-9])` … `(?![a-z0-9])`),
  NOT a bare `lc.includes(k)`.

(Grep for `--upload-file` and `(?<![a-z0-9])`. Both present → gate is whole → proceed.)
```
**New:**
```text
- in `commandReferencesSandbox`: a boundary-anchored match (`(?<![a-z0-9])` … `(?![a-z0-9])`),
  NOT a bare `lc.includes(k)`;
- in `isAtlassianMutatingHttp`: the `atlassian-put` name match — the ONLY thing that detects a
  write sent through `atlassian-put.ps1` (curl runs inside the script, invisible to the other
  tests); and
- `commandTargetsOnlySandbox`, which grants the sandbox exemption only when every Atlassian
  address in the command is a sandbox one.

(Grep for `--upload-file`, `(?<![a-z0-9])`, `atlassian-put` and `commandTargetsOnlySandbox`. All
present → gate is whole → proceed.)
```

**Old:**
```text
`Invoke-RestMethod` with a write verb, data flag, `--json`, or `-T`/`--upload-file`) to an
`atlassian.net` / `api.atlassian.com` host. Non-content
```
**New:**
```text
`Invoke-RestMethod` with a write verb, data flag, `--json`, or `-T`/`--upload-file`) to an
`atlassian.net` / `api.atlassian.com` host, and any shell command that names `atlassian-put` (the
script the retained-redline PUT goes through). Non-content
```

**Old:**
```text
  - Authenticate per the global rules: read the Atlassian API token from the secure store
    (`G:\My Drive\AI Projects\API tokens and keys - AI.gsheet`) — never ask Erez to paste it — and
    use `curl -sk` (outbound TLS verification is disabled on this machine; see the global
    cert-verification rule).
```
**New:**
```text
  - Make these GETs with `& "$HOME\.claude\scripts\atlassian-get.ps1" -Url "<url>"` (add
    `-OutFile "<path>"` to save the body). It reads the Atlassian key from Credential Manager and
    keeps it off the command line; if the key is not stored on this PC it stops and names the
    command Erez runs to store it — pass that on; never read the key sheet or ask for the key.
```

**Old:**
```text
  Confluence content PUT) carrying the marked-up body — immediately after minting the `shell` pass.
  Use `curl -sk` and the token from the secure store.
```
**New:**
```text
  Confluence content PUT) carrying the marked-up body — immediately after minting the `shell` pass.
  Send it with `& "$HOME\.claude\scripts\atlassian-put.ps1" -Url "<url>" -BodyFile "<json file>"`
  as ONE single-line command on its own. The gate treats any shell command naming that script as
  the write, so run nothing else that names it between minting and sending (it would consume the
  pass), and inspect the script with the Read tool, not a shell command.
```

**Old:**
```text
a PUT writes ADF back (Basic auth,
`curl -sk` per the outbound-TLS rule).
```
**New:**
```text
a PUT writes ADF back (both through
the `atlassian-get.ps1` / `atlassian-put.ps1` scripts above).
```

## documentation — `C:/Users/Erez/AI Projects/Documentation/CLAUDE.md` (CRLF file)

**Old:**
```text
- Access: GitHub Personal Access Token — read from Google Drive MCP by searching for file titled `API tokens and keys - AI`; the token is in the row labeled `github_pat`
- GitHub API calls: use curl with SSL verification disabled: `curl -sk -H "Authorization: Bearer <token>" <url>`
```
**New:**
```text
- Access: the GitHub login Git already stores on this PC — read it at runtime with `git credential fill` from the Bash tool, per the GitHub pattern in `~/.claude/hooks/refs/shell.md`; never read the key sheet. If Git has no github.com login on this PC, ask Erez to sign in once in his own terminal (e.g. `git ls-remote https://github.com/Muuula/MemoryPirates` opens the GitHub sign-in)
- GitHub API calls: the token (`TOK`, from `git credential fill` as in that shell.md pattern) goes in a curl config fed on stdin, never on the command line: `printf 'header = "Authorization: Bearer %s"\n' "$TOK" | curl -q -sk -K - <url>` (`-q` first; `-sk` for this machine's TLS interception)
```

**Old:**
```text
, setting the `SLACK_PIN_TOKEN` env var from the "Slack Pin Bot" row of the key sheet.
```
**New:**
```text
. The script reads the bot's key from Credential Manager itself; if it says the key is not set up on this PC, pass the command it names on to Erez.
```

**Old:**
```text
(beside the pin script — see the script's own header for exact usage, env vars, and token source)
```
**New:**
```text
(beside the pin script — see the script's own header for exact usage and where it reads its key)
```

**Old:**
```text
- Never ask Erez to paste, share, or type API tokens, secrets, or credentials in the chat — always read them from `G:\My Drive\AI Projects\API tokens and keys - AI.gsheet`
```
**New:**
```text
- Never ask Erez to paste, share, or type API tokens, secrets, or credentials in the chat; keys come from this PC's own store per the global rule, never from the key sheet
```

## invoice — `C:/Users/Erez/AI Projects/InvoiceAutomation/CLAUDE.md`

**Old:**
```text
- Never ask Erez to paste, share, or type any API token, secret, or credential in the chat — always read from `G:\My Drive\AI Projects\API tokens and keys - AI.gsheet` or Script Properties as appropriate
```
**New:**
```text
- Never ask Erez to paste, share, or type any API token, secret, or credential in the chat; the app's own secrets live in Script Properties, and any key a session needs comes from this PC's own store per the global rule, never from the key sheet
```

