# GEN-980 — Tableau session-API reads and gate-verified read-only Snowsight runs (design v2, not built)

Request (Erez, 2026-10-28, verbatim): "Yes, design the Tableau data-read and read-only Snowflake run changes next, and bring me the reviewed proposal".
Bar (Erez, GEN-924): "I don't want to approve everything, and I don't want to give you a blank check". Every send, delete, payment and access change must still ask.
Ticket done-bar: an installed change cuts at least a further 10% of browser pop-ups in the replay. **Neither option below reaches it** (see table); the rest would have to come from the ticket's other levers.

Recommendation: build Rule A (Tableau) now; do not build Rule B (Snowsight) — its measured cut is small, it needs the most new machinery, and review round 1 found two ways a write could slip through it. For Snowflake, the look-only Snowflake login (alternative 1) is the stronger route.

v2 changes from review round 1: SQL is read as JavaScript decodes it (escapes hid a `;`), the unanchored direct-fetch Tableau shape and the `window.` wrapper are dropped, the Snowsight record is specified (own store, one run per fill, 10-minute limit, length check), the click carve-out is gone from the measurement, Ctrl+Shift+Enter is dropped, a post-install signal is added, the notes edit is drafted and measured, and the done-bar shortfall is stated.

## Measurement (real live rules, real transcripts)

Tool: `measure.js` (this folder). It replays the LIVE gate `~/.claude/hooks/browser-site-gate.js` over every transcript on this PC (14 days exist; a 30-day run is identical) and overlays each rule: an asking item is waived only if the rule recognizes it AND every cause that item asks for on its own is one the rule answers; the rest of the call is re-decided by the live gate with that item replaced by a screenshot of the same tab.

Baseline: 708 pop-ups. Source: `out.json` (14 days).

| Option | Pop-ups removed | Share | Basis |
|---|---|---|---|
| A. Tableau reads (wrapper shape only) | 28 | 4.0% | Claude's past scripts exactly as written |
| B. Snowsight run, past habits | 6 | 0.8% | past home-made fills counted as the standard fill |
| B'. the standard fill itself no longer asking | 7 net (15 calls) | 1.0% | same projection |
| B. Snowsight run, if every query were filled (not typed) | 21 | 3.0% | further projection: typed queries counted as fills |
| A + B + B', past habits | 41 | 5.8% | |
| A + B + B', every query filled | 56 | 7.9% | |

With the exact standard fill text, B removes 0 on past data: no past script used it. B's numbers are projections that depend on Claude copying the new text from its notes.
Every waived item in `flipped-ceiling.txt` is a read: Tableau calls only getWorkbooks, getDatasources, getExtractTasks, getDataAlerts, getSchedules, getFlows, getUsers, getBackgroundJobs; Snowsight runs are SELECT, SHOW or DESC. Still asking: the `deleteDatasources` script, the extract-refresh attempts, GRANT/CREATE runs.
Tableau, why not more: of 45 asking Tableau script items, 17 stay — 11 have no recognized call (mostly calls to a `window.__vz` helper stored by an earlier script, and `window.__vz` definitions), 5 use the direct `fetch('/vizportal/...getX')` form (dropped: its body is not anchored), 1 loops over method names in a variable. If Claude follows the notes (declare the wrapper in each script), most of these would pass too — not measured.

## Rule A — Tableau session-API reads (recommended)

A page script on a tab whose last-known page is `<one label>.online.tableau.com`, e.g. `us-west-2b.online.tableau.com` (the same page lookup today's helper rule uses) passes without a pop-up when ALL hold:
1. It declares one or more wrappers of exactly this structure (whitespace, quote style and the names `W`, `m`, `p`, `x`, `r` free; nothing else):
   `const|let|var W = [async] (m, p[ = {}]) => (await fetch('/vizportal/api/web/v1/' + m, {method: 'POST', headers: {'Content-Type': 'application/json[;charset=UTF-8]', 'X-XSRF-TOKEN': x}, body: JSON.stringify({method: m, params: p})})).json();`
   or the same with `fetch(...).then(r => r.json())`. When the two parameters are named exactly `method` and `params`, the body may use the shorthand `JSON.stringify({method, params})` (the same two values). The wrapper is matched in full: the method name can reach the URL and body only through `m`. `W` must not be the name of a helper an earlier script stored on that site (else a call could reach the stored one).
2. Every use of `W` in the script comes after its declaration and is `W('<M>', ...)` with a string literal `<M>` on this closed list: getWorkbooks, getDatasources, getDataConnections, getExtractTasks, getDataAlerts, getSessionInfo, getUsers, getSchedules, getFlows, getBackgroundJobs (the methods Claude has used to read, plus those named in its browser notes). Anything else — another name, a name in a variable, `W` passed around — asks.
3. With the wrappers and their calls blanked out, the rest of the script (including the call arguments) passes today's script check unchanged: no risky pattern (so no other `fetch`, no `window.` assignment, no escapes), no reload, no call to any stored helper. Today's database-write check still runs on the whole text.
4. Such a script does not mark its tab as possibly moved (a fetch cannot navigate, and the rest passed the risky-pattern check), so back-to-back reads need no screenshot between them. (Build note: both `moves()` and its use in `record()`/`applyDecision` need this; the measurement keeps the old "moved" mark, which changes only invisible re-read requests, never pop-ups.)
No new state. A `window.__vz` stored by an earlier script keeps today's helper rule.

## Rule B — gate-verified read-only Snowsight run (designed; not recommended)

- Standard fill (the only fill shape): `(v => { v.dispatch({changes: {from: 0, to: v.state.doc.length, insert: <one string literal>}}); v.focus(); return v.state.doc.length; })(document.querySelector('iframe').contentDocument.querySelector('.cm-content').cmView.view)` on an `app.snowflake.com` tab.
- Read-only test, on the literal's value as JavaScript builds it: refused (not read-only) if it holds `${`, any backslash escape other than `\\ \n \t \r \' \" \``, a backslash in the decoded SQL, `$$`, `--`, `//`, `/*`, or the words PROCEDURE, FUNCTION or CALL outside quoted strings; otherwise every statement (split on `;` and `->>`, quoted strings set aside) must start with SELECT, WITH, SHOW, DESC/DESCRIBE, EXPLAIN, LIST or LS, and today's database-write check must find nothing. USE is not on the list.
- Editor record: kept in its own store in the gate's state (not inside the per-tab page record, which is rebuilt on every tab report), checked when the state file is loaded. Before any call runs, every record on a site is cleared by any item on that site except screenshots, waits, scrolls, zooms, hovers, page/text reads, tab listing/opening/closing and pure-read scripts (no risky pattern, no stored-helper call, no write) — including any fill, and including calls that are then refused. After a standard fill has run, the record is set only if the script returned exactly the decoded SQL's length; it also clears on a browser switch or a tab report showing that tab on another page.
- The run: a key action on that tab whose whole text is an optional `Escape` and/or `ctrl+a`, then `ctrl+Enter` or `ctrl+Return`, within 10 minutes of the fill. A read-only record and a summary naming no danger word waive the "not a plain look" ask; every other cause stays (first visit, follow-up after a role/permission control, stale or unknown tab, high-stakes site). The run uses the record up: one fill, one run. Clicks on Run stay as today.
- B': a read-only standard fill passes without a pop-up; any other fill asks as today.
- Snowflake docs (both read in full by a reviewer): Workspaces lists Ctrl+Enter "Run selected" (https://docs.snowflake.com/en/user-guide/ui-snowsight/workspaces-working); the legacy worksheets page lists Ctrl+Enter "Run selected" and Ctrl+Alt+Enter "Run all" (https://docs.snowflake.com/en/user-guide/ui-snowsight-worksheets). Neither says what Ctrl+Enter runs with nothing selected; with `ctrl+a` first, or with the whole editor read-only, it does not matter.
- Risks B would add: a SELECT can still send data out through a custom function built for it (external functions, or functions with external network access — documented, invoked by plain SELECT), so build step 1 would be `SHOW USER FUNCTIONS IN ACCOUNT`, `SHOW EXTERNAL FUNCTIONS IN ACCOUNT` and `SHOW INTEGRATIONS`, re-run at each live check, and a function added later is not covered; a SELECT can advance a sequence (NEXTVAL) and spends warehouse credits; it runs under whatever role the worksheet has; the fill overwrites the open worksheet's saved text (today that is already silent after the first approved fill); anything typing into that editor that the gate cannot see (Erez by hand, another desktop tool) between fill and run would be run.

## Signal after install (Rule A; and B if built)

- The gate logs each waived call to its existing log `browser-gate-asks.jsonl` as `{event: "waived", rule: "tableau-read", site, methods}` (B: `rule: "snowsight-run"`/`"snowsight-fill"`, first 80 characters of the SQL). No page text beyond that.
- Who reads it and when: a self-trigger scheduled at install for two weeks later runs a replay (`measure.js`-style, on post-install transcripts) and reads the "waived" lines, and reports the result to Erez in its For-you block. (The gate's earlier one-time noise check reads only ask/deny lines, so it is not the reader.) Until then nothing watches the waived lines; that is the accepted gap.
- Bar: Rule A stays if it removes at least 15 pop-ups in those two weeks and every waived call names only listed methods; otherwise it is revisited or removed. Any waived call found doing anything other than a read removes the rule at once.

## Also in the build (not gate code)

`~/.claude/hooks/refs/browser.md` — Tableau line: replace "Read data through the page's session API: ... Methods: ..." with the wrapper text, "declare it in each script; call it only as `vz('<method>', {...})` with the name in quotes (not stored on `window`, not in a variable)", and the 10 methods. Drafted in full as `browser.md.draft` (`make-browser-draft.js`).
size: C:\Users\Erez\.claude\hooks\refs\browser.md 7,989 → 8,402 / 10,000 characters (hard; hook-injected-text)
(With B as well, `browser.md.both.draft`: size: C:\Users\Erez\.claude\hooks\refs\browser.md 7,989 → 8,736 / 10,000 characters (hard; hook-injected-text).)
Build notes from review: require matching opening and closing quotes, escape `$` in the parameter names put into the pattern, and allow the `{method, params}` shorthand only when both parameters carry those names (the measurement accepted each separately; no past flip depends on that).
Tests: cases in the gate's test suite for the shape (including the notes' exact text with its cookie line, the `{method, params}` shorthand and the `p = {}` default) and each refusal (unlisted method, method in a variable, use before declaration, wrapper with an extra statement, a second `fetch`, a `window.` assignment, an escape); regression replay: every decision outside the rule identical to the live gate.
Effort: Rule A about one working session through /vet-code (gate change, tests, notes line, replay). Rule B about two more (state store, clearing points in Pre and Post, tests).

## Risks Rule A adds (honest residual)

1. The method list is Tableau's own undocumented page methods. Their names say "get" and Claude has only used them to read, but Tableau publishes no promise that a "get" method changes nothing. (Unverified; nowhere to check.)
2. A script written on purpose to dodge the pattern list still gets past (existing accepted limit; unchanged).
3. The check reads the script, not the server: if Tableau ever made one of these 10 methods do something else, the gate would not notice. The post-install log would show which methods ran.

## Alternatives considered

1. Look-only Snowflake login (GEN-953 candidate (e), Erez's separate decision): Snowflake itself refuses writes for that user. For it to remove pop-ups the gate would still need to know a query runs as that user — e.g. Claude runs look-only queries outside the browser with that user's key (no browser at all), since the gate cannot see which login a Snowsight tab uses and a site-wide exemption was already rejected. Strongest guarantee; costs an admin creating the user and key, and a small query tool (none exists on this PC today).
2. Tableau via its official REST API with a personal access token, outside the browser: documented read endpoints, no browser pop-ups; costs a stored token Erez creates, new tooling, and the internal page methods' data may differ.
3. Rule A plus Rule B (designed above): 41–56 removed instead of 28, but B adds a per-site record with several clearing points, rests on Claude copying a new fill text (0 exact past matches), and its read-only SQL test had two bypasses in the first review.
4. Also allow the direct `fetch('/vizportal/...getX', {...})` form: +4 on past data, but its params and the rest of its body are free text (a later duplicate `method:` key wins in JavaScript), so it is not an exact shape.
5. Let a click on Run count: more removed (not measured), but the gate cannot see what a click hits.
6. Rejected before (not revisited): a trusted-sites list; loosening the harmless-wording list. Per-task approval: parked by Erez.
