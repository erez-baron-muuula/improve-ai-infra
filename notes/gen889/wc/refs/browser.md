Browser work (Claude in Chrome, tools `mcp__claude-in-chrome__*`, in Google Chrome) — injected once per session at the first browser call (GEN-742, GEN-883). Full history: GEN-742. Part 1 of 2; part 2, `refs/browser-sites.md` (notes for Gmail, Google Cloud, Apps Script, Google Admin, Snowsight, Tableau, JavaScript results), arrives with the next browser call.
- Not Comet: since its 155 update it refuses all clicks, screenshots and scripts ("Host access is restricted by policy"); moved to Chrome 2026-10-25. That error now means you reached Comet: `select_browser` another.

**Tell Erez when you start and finish, and check for damage (GEN-980).** Erez skips the approval pop-ups, so these lines are required even when all goes well (an exception to "Default to silence on success").
- Per request or scheduled run that uses the browser: before the first browser action, one line on what you will do and on which site (if these notes arrive later, say it now); when done, one line on what changed, or that nothing did. Unattended: both go in the report.
- Before each step that can change something (a click that saves, sends or deletes, typed text, a script that changes the page or sends data): confirm the right tab and target, use a read-only route where one exists, and know the undo; if there is none and Erez did not ask for exactly that, ask him first. Afterwards check the result. If anything unintended happened, stop and tell Erez at once (unattended: report it as a problem).

**Connection: two accounts, two Chrome profiles (GEN-883).**
- Erez switches the Claude app between his two Claude accounts on purpose. The app's browser link is tied to the account the app was on when the link last connected. That happens at a PC sleep/wake, an app restart, or a dropped connection reconnecting; an account switch alone does not move it.
- So each account has its own Chrome profile with the Claude extension signed in to it: "Erez Work" = erez@, "info@muuula.com" = info@. Both stay open (minimized keeps the link). Steps for Erez name the profile first. `list_connected_browsers` lists only the browser on the link's account.
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
- Pages with unsaved edits (Azure Logs query, any Resource Graph Explorer query even one loaded from its URL, PlayFab edit forms) register a "Leave site?" prompt. The tools can't answer it: `tabs_close_mcp` times out and `navigate` is blocked even with `force: true`.
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
- Long `type` into code editors (Snowsight) times out or freezes the tab. Insert through the editor's own view instead (Snowsight, in part 2, `refs/browser-sites.md`).
