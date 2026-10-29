# GEN-980 — root-cause answer (v3, after /check round 2)

Erez's question (2026-10-28, verbatim): "maybe there's a better way we are missing here? something that touches the root cause of the problem"
His bar (GEN-924, verbatim): "I don't want to approve everything, and I don't want to give you a blank check".

## Root cause

1. Why the Tableau rule keeps failing review: the gate must decide, from a JavaScript program's text, whether it only reads. Text can't prove that (three review rounds each found new disguises; both reviewers also confirmed the live gate already misses disguised writes, e.g. `const F = window.fetch; F(url, {method:'DELETE'})`). Any further rule of this kind will keep failing the same way.
2. The sound fix for DATA READS is to take them out of the browser, through a login the service itself limits to reading, so nothing has to be judged. It costs the same machinery wherever it's used: a stored key, a small script, and an approval rule so the script runs without a shell prompt.
3. Tableau is a small slice of the pop-ups.

## Where the pop-ups are, like for like

| Route | What it could remove | Basis |
|---|---|---|
| Tableau read-only reader | up to about 32 of 708 (4.5%) | 14-day replay (`design.md` lines 17-28) minus alerts-only reads with no confirmed scope (8), mixed (3), and 2 writes that must still ask |
| Snowflake read-only login, reads moved out of the browser | unmeasured; at least 92 Snowflake query-run asks of 708 (13%) exist, and more Snowflake asks besides | `dump-snow.txt` (92 `###` headers) holds only query runs (run clicks and Enter presses, `dump.js` line 43 filter); script fills (15 asking calls, `design.md` line 21), typed queries and other Snowflake asks are not in it. Some runs are real writes (GRANT/CREATE) that must still ask; the read/write split is not measured. `design.md`'s 0.8–3% measured a narrower thing (a gate rule for Snowsight runs), not moving reads out. Most of these runs ask with the "word" cause, so this row overlaps the next one: do not add them |
| Clicks the gate doesn't recognise as a plain look ("word" asks) | unmeasured | 113 of 209 asks in the last 7 days (`~/.claude/hooks/browser-gate-asks.jsonl`, 2026-10-21..28, counted by `scratchpad/asks-breakdown.js`); pushed at `browser-site-gate.js` line 441 under `SUMMARY_MODE = 'whitelist'` (line 182, Erez's GEN-924 choice). The log keeps no site and no summary for these, and some are dangerous-word hits that should keep asking |

By site, last 7 days: Snowflake at least 42 of 209 asks, Tableau at least 16 (lower bounds: a "word" ask logs no site). No route is measured to reach the ticket's 10% bar; Snowflake is the only one whose known volume (13%+, reads and writes together) is above it.

## Recommendation: park the Tableau change; measure before building anything else

- Park GEN-980's Tableau part. The script rule can't be made sound, and the reader (below) costs the full machinery and adds a standing key that can do admin writes, for about 4.5%.
- Next, measure (analysis of saved sessions only, no build):
  - Snowflake: of every asking call on a Snowflake tab (counted per pop-up, not only the 92 query runs), how many are reads that a read-only login could take over. If that is well above Tableau's 28–32, design the Snowflake login (design.md alternative 1). Its advantage over Tableau: Snowflake can give a login a role that can only read, so a leaked key can't change anything (it can still read whatever that role sees, so the role is scoped in that design).
  - Clicks: from the saved sessions, what the 113 "word" clicks actually were, and how many are harmless looks the wording rule misses. Only then decide whether anything about that rule should change; it is Erez's deliberate choice, so any change goes back to him.
- File a separate ticket for the live gate's existing disguised-write holes.

## The alternative: a read-only Tableau reader outside the browser

What it is: Erez (a Tableau site admin) creates a "Direct trust" connected app once; Claude builds a small script that signs a short-lived token carrying only read scopes and calls a fixed list of list/get requests.
- Tableau bounds the token: "All subsequent REST API requests using the Tableau access token are then bounded by the scopes in the JWT." (https://help.tableau.com/current/online/en-us/connected_apps_scopes.htm). Read scopes exist per method: tableau:content:read, tableau:tasks:read, tableau:users:read, tableau:jobs:read, tableau:flows:read (REST reference pages under https://help.tableau.com/current/api/rest_api/en-us/REST/). No read scope found for data-driven alerts. Whether methods with no scope at all are refused is not stated; the script's fixed list is the boundary for those.
- Costs: Erez's one-time setup (~10 minutes, guided); a new script; an edit to the key-storing script (it accepts only notion/atlassian/slack today, `set-claude-key.ps1` line 20) plus a file for the app's non-secret ids; and an approval rule in the auto-approve hook (a locked file) so each reader call runs without a shell prompt — without it, the pop-ups just move to the shell. All three code changes go through the full code review.
- The trade against "no blank check": the app's secret can sign a token with ANY scope (no admin-side cap found in the docs), and any shell command can read it from Credential Manager. Mitigations: scopes fixed in the script; kill switch = disable the app in Tableau.

## Other routes considered

- Read Tableau's own admin pages with the browser's look-only tools (navigate within an approved site and read page text; neither asks, `browser-site-gate.js` lines 89-92, 412-419): no build, no new key; slower, lists may be paged, some data isn't on any page. Fine as an occasional workaround.
- Keep patching the script rule: rejected (root cause 1).
- A separate limited Tableau account: rejected — the reads are admin-level and Tableau has no read-only admin role.
