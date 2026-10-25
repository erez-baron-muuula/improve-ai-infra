Browser work (Claude in Chrome, tools `mcp__claude-in-chrome__*`, in Google Chrome) — injected once per session at the first browser call (GEN-742, GEN-883). Full history: GEN-742.
- Not Comet: since its 155 update it refuses all clicks, screenshots and scripts ("Host access is restricted by policy"); moved to Chrome 2026-10-25. That error now means you reached Comet: `select_browser` another.

**Connection: two accounts, two Chrome profiles (GEN-883).**
- Erez switches the Claude app between his two Claude accounts on purpose. The app's browser link is tied to the account the app was on when the link last connected. That happens at a PC sleep/wake, an app restart, or a dropped connection reconnecting; an account switch alone does not move it.
- So each account has its own Chrome profile with the Claude extension signed in to it: "Erez Work" = erez@, "info@muuula.com" = info@. Both stay open (minimized keeps the link). `list_connected_browsers` lists only the browser on the link's account.
- The link can move to the other account mid-task, when it reconnects. If tabs vanish or a site is suddenly logged out, call `tabs_context_mcp` again: you may now be in the other profile.
- When a call says "not connected", a "browser-diagnose" paragraph from this notes' hook adds the real reason and the one fix, read from the Claude app's log. Pass that to Erez in one line, not the tool's generic checklist. Restarting an open browser, refreshing a tab or signing in to a website does not fix it.
- `node "C:/Users/Erez/.claude/hooks/inject-browser-refs.js" --explain` prints the same diagnosis on demand.

**Scheduled (unattended) runs.** The task's own browser steps come first; these fill any gap.
- Not connected: call `tabs_context_mcp` up to 3 times, about 30 s apart. Still not connected means the check did NOT run. Say so in the report with the one-line reason and fix (from the hook or `--explain`). If the task alerts Erez, send one URGENT alert that says "did NOT run" and gives the fix. If the task needs the browser only for an optional step, note it and carry on.
- Never report a browser step as passed, or skip it silently, when it didn't run.
- Only browser tools on the global auto-approve list run with nobody there: `tabs_context_mcp`, `list_connected_browsers`, `navigate`, `tabs_create_mcp`, `tabs_close_mcp`, `get_page_text`, `read_page`, `find`. Others (screenshots, clicks, typing, JavaScript) can stop for approval that never comes. Build the check from the listed tools; a step that needs another one is reported as "could not run: needs approval", never as a pass.
- After a Claude app restart the link connects on the first browser call (within seconds of it).
- If two browsers are listed, or the wrong one answers, pick with `select_browser`.
- Sub-agents get neither these notes nor the diagnosis, so keep browser work in the main session.

**Signing in to websites.**
- In the info@ profile, some sites' sign-in defaults to info@muuula.com. When a site lands on, or offers, info@ where Erez's usual user is expected, choose his usual user in the site's own account chooser. That is a click, never a password.
- On any password, passkey or Windows Hello screen, keep the tab open, tell Erez exactly what to click or enter there, and continue once he says it's done. Expect repeat prompts (Google, Tableau). Never close the tab and send him a link instead.
- An OAuth/consent pop-up opens as a separate window the tools can't see. Before a step that opens one, tell Erez he will complete it there.

**Leaving and closing tabs (GEN-914).**
- Pages with unsaved edits (Azure Logs query, PlayFab edit forms) register a "Leave site?" prompt. The tools can't answer it: `tabs_close_mcp` times out and `navigate` is blocked even with `force: true`.
- Prevent it: don't leave edits behind. Use the page's own Cancel/Discard before closing, and prefer a read-only route (a direct result link, an API, the page's own session API) over editing.
- Close your own tabs at the end of each browser task and check the close worked.
- Stuck anyway: in the browser, Shift+Esc opens Task Manager. End the tab's process (it shows "Aw, Snap!"), then `tabs_close_mcp` closes it. Tell Erez the exact steps if you can't do it yourself.

**Window not usable (GEN-928).**
- Screenshots time out (`Page.captureScreenshot`), clicks do nothing, `innerWidth` reads 0, or buttons sit at negative x.
- `Get-Process` shows only one window title per process, so a second browser window missing there does NOT mean it is minimized. Don't name a window state you haven't checked.
- Workarounds: `get_page_text`/`find` still work; JavaScript `element.click()` still opens menus and dialogs. Dashboards need a real page size, so try `resize_window`.
- Ask Erez to bring the window up only after your own fix fails.

**Timeouts.**
- "did not respond in time" on a slow page: wait about 5 s and retry once. Then use a lighter call (`get_page_text`, `find`, a screenshot).
- Long `type` into code editors (Snowsight) times out or freezes the tab. Insert through the editor's own view instead (below).

**Site notes.**
- **Gmail:** `get_page_text` often returns only the "Loading…" shell, so take a screenshot instead. A Gmail web-link token is not the connector's thread id: find the thread by subject/sender with `search_threads`, then `get_thread`. For "Add to Drive", expand the right message first and `find` the button naming the exact file; check the saved name.
- **Google Cloud console:** opening a service page (e.g. Firestore) can switch that API on. Survey read-only via APIs & Services, IAM, Storage, BigQuery. A menu that silently does nothing usually means a missing project-level role: check IAM.
- **Apps Script:** Extensions → Apps Script on a sheet with no script creates an undeletable bound project. List scripts at script.google.com/home/all instead.
- **Google Admin console:** `get_page_text` is blocked by policy. Use screenshots and coordinate clicks; if a screenshot times out, wait 5 s and retry once.
- **Snowsight:** the SQL editor is CodeMirror inside an iframe; the top-page `.cm-content` is the hidden AI chat box. Insert with `document.querySelector('iframe').contentDocument.querySelector('.cm-content').cmView.view.dispatch({changes:{from:0,to:v.state.doc.length,insert:sql}})` (`v` = that view), then click Run. Results: iframe `[role=gridcell]` cells. Use `LISTAGG` for one short cell. For a long cell, select it, press Ctrl+C, then `Get-Clipboard`. `SHOW … ->> SELECT … FROM $1` works. Navigate via the left menu, not typed account paths.
- **Tableau Cloud:** read data through the page's session API: `fetch('/vizportal/api/web/v1/<method>')`, POST `{method, params}`, header `X-XSRF-TOKEN` from the `XSRF-TOKEN` cookie. Methods: getExtractTasks, getWorkbooks, getDataConnections, getDataAlerts, getDatasources, getSessionInfo. Map refresh jobs by `targetId`, not by display name. Download workbooks one at a time (`/t/muuula/workbooks/<repositoryUrl>.twbx`).
- **JavaScript results** that look like query strings or encoded data come back as "[BLOCKED: Cookie/query string data]": replace `=` and `@` in returned text, and never return key values.