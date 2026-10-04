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

Other PCs: none — Erez confirmed 2026-10-04 that this is the only PC he uses Claude or Git on.

Not checkable from this PC: which of the other 37 `AIza…` values
are live keys (most are likely public app keys); whether Forge's token equals an exposed Atlassian value.
