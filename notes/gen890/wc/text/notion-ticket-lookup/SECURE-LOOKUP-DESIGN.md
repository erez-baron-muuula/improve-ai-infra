# Secure GEN-NNN lookup — design v2 (post-review)

**Contents:** Status / handoff · Goal · Verified facts · Two true constraints · Recommended design (secret store, bootstrap, lookup, zero prompts, touching the store less) · Honest residual risks · What to update once settled · DB-id derivation

## STATUS / HANDOFF (read first)
DESIGN COMPLETE and CONVERGED via /check (3-lens panel, 2 rounds, all PASS round 2). BUILT and live as
`~/.claude/scripts/notion-ticket-lookup.ps1` (auth header via a temp curl config file since GEN-639).
This note is the durable handoff so a later session (e.g. Sonnet) can build it without re-deriving.

Build steps, in order:
1. EREZ (one-time, out of band, NOT a Claude tool call): prepare the placeholder snippet (below, to be
   authored) that adds the Notion token to Windows Credential Manager via the native
   [Windows.Security.Credentials.PasswordVault] API under target `claude-notion-token`. Erez pastes
   his real token into the placeholder in his OWN PowerShell window and runs it once. Token never
   enters a Claude session. (The native API was verified working on this machine with a dummy value.)
2. CLAUDE: rewrite C:\Users\Erez\.claude\skills\notion-ticket-lookup\SKILL.md so the PRIMARY single-id
   path is: pinned-anchor -> Credential-Manager-backed REST unique_id query -> ask Erez. Embed the
   exact lookup command (no token-shaped string in it). Cache the non-secret Team-Tasks DB id with a
   staleness/re-derive note. NOTE: SKILL.md is NOT one of the hook-protected files (those are
   settings.json, settings.local.json, global CLAUDE.md, auto-approve.js) — a normal Edit/Write works.
3. CLAUDE (optional, after step 1+2 work): offer the one-time allow-list add via update-config.ps1 so
   the lookup runs prompt-free. The allow-listed text references the store, never the token.
4. Expand the pinned-anchor list in SKILL.md to the most-referenced tickets (cuts REST frequency).
Rule reminder for the builder: per "Before adding or editing a rule in a CLAUDE.md file" — SKILL.md is
a skill, not CLAUDE.md, so the /check-before-edit rule does NOT gate it; but the skill REWRITE should
still be shown to Erez before applying per normal approval. The DB-id cache must carry a staleness
mechanism (re-derive on 404) per the no-time-varying-facts rule.

Verified-facts and full rationale follow below.

## Goal
Given a `GEN-NNN` id, reliably resolve it to its Notion page (URL + properties), with the Notion API
token NEVER appearing in: (a) the conversation/transcript, (b) an allow-listed command in
settings.local.json, or (c) any Drive-synced / git-committed file.

## Verified facts (checked live this session)
1. Notion REST `POST /v1/databases/<db-id>/query` with
   `{"filter":{"property":"ID","unique_id":{"equals":NNN}}}` returns the page. Works on current plan.
   Confirmed executed today. `unique_id.equals` takes the NUMERIC part only.
2. `notion-query-data-sources` is plan-gated here (returns the Business/Enterprise error) — not usable
   as a filtered query path today, though it remains allow-listed and would become the preferred
   zero-shell/zero-secret path on a plan upgrade. (Verified via runtime error in a prior session.)
3. `notion-search` (semantic) can't match by the ID property; `notion-fetch` resolves a page by URL/ID
   (no number, no token). Both are in the hook SAFE_TOOLS (auto-approved, read-only).
4. Leak surfaces enumerated: (a) the conversation/transcript; (b) settings.local.json allow-list
   (syncs to Drive + committed to config git); (c) the deferred-calls log — ALREADY redacted via
   redactSecrets()/secret-patterns.json, and in any case the safe command carries no literal token;
   (d) the gsheet (the existing, accepted at-rest store).
5. The auto-approve hook does not deny credential commands. Claude Code's built-in auto-mode
   classifier refuses a command containing a LITERAL credential — so inlining the token both leaks
   AND can be blocked mid-session. A command with no token-shaped substring is classifier-safe.
6. secret-patterns.json covers the Notion token: `(ntn_|secret_)[A-Za-z0-9]{36,}`.
7. The hook's shellCommandIsSafe() will NOT auto-approve the lookup command (its first segment isn't
   in the read-only safe-set, and `curl.exe` isn't either). So the command defers to the normal
   permission flow: one prompt the first time, or zero prompts after a one-time manual allow-list add.
   The allow-list entry would store the command text — which references the secret store, never the
   token value — so persisting it is safe.
8. Windows Credential Manager native API works on THIS machine (verified with a dummy value:
   store + retrieve + remove all succeeded). The `CredentialManager` PS module is NOT installed, so
   use the native `[Windows.Security.Credentials.PasswordVault]` API, not `Get-StoredCredential`.

## Two true constraints that shape everything
- **Token must never enter Claude's context.** Any step where Claude reads the token value (Drive MCP
  read of the gsheet, echoing it, inlining it) writes it to the transcript. So Claude can USE the
  token only by reference — a child process loads it from a store and uses it; only the API RESULT
  returns to Claude.
- **Therefore the token must already live in a store the shell can read without Claude seeing it, AND
  the bootstrap that puts it there must be done OUT OF BAND (not by Claude).**

## Recommended design

### Secret store: Windows Credential Manager (DPAPI-encrypted), NOT a plaintext file
- The token lives in Credential Manager under a fixed target (e.g. `claude-notion-token`).
- DPAPI-encrypted at rest, bound to Erez's Windows login. No new plaintext copy on disk. (A plaintext
  file in `.claude-secrets\` was the prior leaning; rejected because it adds a second cleartext copy
  with no encryption, no rotation signal, readable by any backup/AV/disk-image — a net new exposure
  for no benefit Credential Manager doesn't also give.)

### Bootstrap (ONE TIME, done BY EREZ, with no Claude involvement)
**SUPERSEDED 2026-09-30 (GEN-638 step 2):** the store step is now `~/.claude/scripts/set-claude-key.ps1
-Key notion`, which Erez runs in his own PowerShell window on each PC (masked prompt; also used to
store a new value after a rotation). The steps below are the original design, kept for history.
Claude cannot perform this without leaking the token. Erez does it once, in a bare PowerShell window
he opens himself:
1. Open the gsheet, copy the Notion token (`notion (Muuula 1)` row).
2. In his own PowerShell window (NOT a Claude tool call), run a short stored snippet that adds it to
   Credential Manager via the PasswordVault API. The token is typed/pasted by Erez locally; it never
   touches a Claude session.
(Claude can PREPARE the exact snippet text for him to paste — the snippet contains a placeholder, not
the token. Erez substitutes the value himself, locally.)
- If the token is rotated, Erez re-runs the same one-time step. (Same cadence as updating the sheet.)

### Lookup (every time — runs as a Claude shell tool call)
A single PowerShell command whose text contains NO token-shaped string:
1. Retrieve the token from Credential Manager into a process-local var via the PasswordVault API.
2. Derive the Team-Tasks DB id at runtime (or use a cached NON-secret id) — see below.
3. `curl.exe -q -sk -K <temp config file> -X POST https://api.notion.com/v1/databases/<db-id>/query`
   with the unique_id filter. The `Authorization: Bearer <retrieved-var>` header is written into the
   temp curl config file (deleted in `finally`), never passed on curl's command line (GEN-639; see
   the residual-risk note below). NEVER `-v` — verbose echoes the auth header. Output: the page
   URL/properties (the response body does not echo the auth header).
4. Claude reads the URL from stdout, then opens the ticket with `notion-fetch` (token-free, auto-approved).

### Achieving zero prompts (optional, one-time)
The lookup command defers (it's not in the auto safe-set). To make it promptless, add it ONCE to the
allow-list via `update-config.ps1`. The stored entry references the credential store, not the token,
so it is safe to persist/sync/commit. Until then, it's one prompt per lookup — acceptable for the
1-3 unpinned lookups in a typical session.

### Reduce how often the secret store is touched at all (do regardless)
Expand the skill's pinned-anchor list to the handful of most-frequently-referenced tickets (GEN-58 is
already pinned). Those resolve token-free via `notion-fetch` on the pinned URL. The REST path is then
only for genuinely-unpinned tickets.

## Honest residual risks (accepted, within the local-machine trust model)
- SUPERSEDED 2026-09-29 (GEN-639): this design first accepted the token briefly on curl.exe's command
  line. That turned out not to be a local-only exposure — a Node caller's spawn error printed the full
  command line into a session log (GEN-638). The header now goes in a temp curl config file (`-K`,
  with `-q` first), so the token is on no command line. Remaining residual: that config file exists in
  the user's TEMP folder for the request's duration, and survives if the process is killed before
  `finally`. The fixed lookup script sweeps such leftovers after 10 minutes on its next run: its own
  files and the skill's inline recipe's, which use the same `notion-ticket-lookup-cfg-<guid>.txt` names.
- The token-out-of-stdout guarantee holds provided curl is run with `-sk` and never `-v`, and the
  command never echoes the retrieved var. A failed retrieval errors with "not found", not the value.

## What to update once settled
The existing skill `C:\Users\Erez\.claude\skills\notion-ticket-lookup\SKILL.md` is the authoritative
record. The id-lookup procedure there must be rewritten so the PRIMARY path for a GEN-NNN is:
pinned-anchor -> Credential-Manager-backed REST query -> (only then) ask Erez. The current text only
documents REST under "enumerating by property" and still falls back to "ask Erez" for single-id.

## DB-id derivation (V4, non-secret)
The Team-Tasks database id is not a secret; it can be cached in the skill text, paired with a
staleness note (re-derive from a live Team-Tasks page's `ancestor-2-database` if a query 404s).
This avoids a token-bearing pre-call just to find the db id.
