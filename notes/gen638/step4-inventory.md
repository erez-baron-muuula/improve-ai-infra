# GEN-638 step 4 — exposed keys and what uses them (2026-10-04)

Built by searching this PC only, by name, never by value: `~/.claude` (scripts, hooks, skills, scheduled tasks, settings, `.claude.json`),
`C:\Users\Erez\AI Projects`, `G:\My Drive\AI Projects`, the game repos' GitHub workflows, Windows Task Scheduler,
the Claude scheduled tasks, Credential Manager entry names, and user/machine environment variable names.
No log or key-sheet content was read.

| # | Key | Exposed value(s) | Still-live users found | Breaks when the old value is cancelled |
|---|---|---|---|---|
| 1 | **Notion** internal-integration token (Credential Manager `claude-notion-token`) | The CURRENT value (tripwire: 2 session logs) | `~/.claude/hooks/notion-fetch-staleness.js` (fails silently); `~/.claude/scripts/notion-ticket-lookup.ps1` + its skill's inline recipe; ad-hoc Notion REST recipes in skills/refs. Scheduled tasks `gen549-unblock-check`, `gen549-unblock-check-2`, `gen561-park-return-test` read it but are all disabled. One-off `notion-subitem-backfill/*.js`, not-installed `gen508-piece1/notion-rest-write.ps1`. | Every PC where it is stored, until the new value is stored there. The claude.ai Notion connector is a separate sign-in and is NOT affected. |
| 2 | **Atlassian** API tokens | 3 OLD values (the current one, stored 2026-10-04, is clean) | Current scripts (`atlassian-get.ps1`, the write script) use the NEW token. **Forge CLI** keeps its own Atlassian token (Credential Manager `Atlassian/Ecosystem`, renewal reminder task `renew-forge-atlassian-token`, ~2027-06); not known whether it is one of the 3 exposed values. | Forge CLI, if its token is one of them; any other PC still holding an old value. The claude.ai Atlassian connector is a separate sign-in. |
| 3 | **GitHub** personal access tokens | 2 OLD values (this PC's current Git login is clean) | No GitHub Actions workflow in `MemoryPirates` or `Memory Islands Dev` reads a secret. Git on this PC uses a different login. | Git on any OTHER PC whose stored login is one of them. |
| 4 | **Slack** bot token | 1 value | `G:\My Drive\AI Projects\_Tooling\Claude\slack-post.js` and `slack-pin.js` (read `claude-slack-token`, not stored on this PC). | Slack posting/pinning from Claude on any PC that has it stored. |
| 5 | **Gemini** API key (`AIza…`) | Among 38 `AIza…` values found | InvoiceAutomation Apps Script, Script Property `GEMINI_API_KEY` (`Code.js` lines ~29, 365, 714, 1943, 2000, 2549): the daily invoice run. | The invoice run, until the new key is in Script Properties. |
| 6 | Other keys in the key sheet | The 2026-09-27 log line holds the whole sheet | Unknown from this PC — only Erez can see the sheet's rows. | Treat every value in the sheet as exposed. |

Not found anywhere: MCP servers configured with keys (none in `.claude.json` / desktop config), key-like environment
variables, Windows scheduled tasks using keys, other Apps Script projects (only InvoiceAutomation has `.clasp.json`).

Notion progress: Erez refreshed the "Muuula 1" token on 2026-10-04 with "Revoke in 7 days", so the OLD token stays valid
until 2026-10-11 21:16 GMT+3. Step 5 must confirm after that time that the old token is rejected.
New token stored the same day: Notion `users/me` answers "Muuula 1", `notion-ticket-lookup.ps1 -Id 638` works, and
`key-leak-tripwire.ps1 -All` (4,275 files) shows notion **clean**. Since the old value was in 2 logs, that also proves the
stored value changed.

Gemini progress: 2026-10-04 Erez found the old key in AI Studio, created a new one in the same project and put it in
Script Property `GEMINI_API_KEY`; he then deleted the old key in AI Studio (same day). Proof is the next daily run (no side-effect-free Gemini test
exists in `Code.js`): scheduled task `gen638-gemini-key-check` reads the run logs 2026-10-05 10:00.
2026-10-05 check: NOT YET PROVEN. Only run since the switch (2026-10-05 05:32 UTC) completed but found 0 new invoice emails, so no Gemini call was made; no key errors logged. Needs a later run or a manual "Process this invoice now" on a real invoice.
2026-10-06 check: PASS. The 2026-10-06 05:32 UTC daily run processed a real invoice (Israel Electric Corporation) with Gemini answers (vendor match, filing decision); further Gemini calls ran 07:23-12:30 UTC. Logs 2026-10-03..06 show no HTTP 400/403, "API key not valid", API_KEY_INVALID, PERMISSION_DENIED or "API key expired".

Slack progress: 2026-10-05 Product Bot has no revoke option in its settings, so Erez removed the app from the workspace
(Manage apps → Configuration → Remove App), which cancels its keys, then reinstalled it and stored the new bot key with the
helper. Verified: read-only `auth.test` returns ok (team Muuula, bot user pin_bot); `key-leak-tripwire.ps1 -All` (4,301 files)
shows all 4 stored keys clean. Removal drops the bot from its channels: re-invite to #tbd (C02PCFC1PJA) and #product
(C030LSACURX), the two in `slack-posts.jsonl`; any other channel it pinned in shows up as a pin failure.

Atlassian progress: 2026-10-05 Erez's token list showed only 3 tokens: "Claude Code – Erez PC – 2026-10" (never used),
"…2026-10 2" (the stored one) and "Forge" (made 2026-06-04). So the older exposed values were already revoked or expired.
Erez revoked the never-used one; `atlassian-get.ps1` on `/rest/api/2/myself` still works. Forge: the Forge token was
treated as exposed (it was probably in the key sheet). Erez created a new plain 1-year token, ran `forge login`, and revoked
the old "Forge" token. After that, `forge whoami --verbose` made a live GraphQL call that returned Erez Baron, which proves
Forge is on the new token. The reminder task `renew-forge-atlassian-token` moved to 2027-09-14 (expiry ~2027-10-05).

GitHub progress: 2026-10-05 Git on this PC signs in with a GitHub OAuth login (`gho_` type), not a personal access token.
Erez's token lists showed: classic "Erez" (repo; expired 2026-08-31) and fine-grained "documentation" (never used; would
have expired 2027-09-04). Erez deleted both. `git ls-remote` on the private Muuula/MemoryPirates repo still works afterwards.

Key sheet rows (Erez listed the names 2026-10-05): Jira, Google ai key, github_pat, notion (Muuula 1), Slack Pin Bot,
Atlassian forge, PlayerInfo Redis. The first six are covered above.

PlayerInfo Redis progress: 2026-10-05. Azure has two caches: muuula-test (Basic, test-infra) and Muuula-Production
(Premium). Host-name scan of the logs: only muuula-test appears. In-memory key comparison over 4,340 logs: muuula-test's
SECONDARY key was in 2 logs (the sheet-leak log 9f9b18c6 and a63a1394), its primary in 0, and the production keys in 0.
Vault MuuulaUnityVault `RedisConnectionString` (used by 6 function apps via REDIS_SECRET_NAME: 5 in test-infra plus
Muuula-MemoryPirates-0-11-1) uses the PRIMARY key, and no vault secret uses the secondary. `RedisConnection.cs` reads
REDIS_SECRET_NAME, falling back to the REDIS_CONNECTION_STRING env var. Pre-mortem /check: PASS. With Erez's go-ahead,
Claude ran `az redis regenerate-keys --key-type Secondary -o none` (exit 0). Re-check: 0 logs hold either current test
key, and the vault secret still matches the primary key. Az needs `AZURE_CLI_DISABLE_CONNECTION_VERIFICATION=1` on this
PC (TLS interception). Eden is being offboarded (Erez, 2026-10-05), so no heads-up was sent.

Step 4 result: every key-sheet row is replaced or cancelled. Still open for step 5: Gemini first-real-run proof; and
after 2026-10-11 21:16 GMT+3, confirm the old Notion token no longer works.

Other PCs: none — Erez confirmed 2026-10-04 that this is the only PC he uses Claude or Git on.

Not checkable from this PC: which of the other 37 `AIza…` values
are live keys (most are likely public app keys); whether Forge's token equals an exposed Atlassian value.
