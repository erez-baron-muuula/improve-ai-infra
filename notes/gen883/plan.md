# Plan — reliable browser work: GEN-883 (+ GEN-742, GEN-928, GEN-914)

## In plain words

**What was wrong.** You switch the Claude app between your two Claude accounts on purpose. The app's link to the browser does not move when you switch. It stays on whichever account the app was on when the link was last built, and it is only rebuilt after a sleep/wake or an app restart. The Comet extension is signed in to one account only. So after a switch, browser work worked or failed by luck. That's why restarting Comet, refreshing a tab or signing in to Tableau never helped, and why restarting the Claude app did (confirmed today at 14:07–14:09).

**What we'll do** (your choice: keep switching, cover both accounts):
1. **One-time setup with you (about 10 minutes).**
   - Your second Comet profile gets the Claude extension signed in to your other Claude account. You type the password; Claude can't.
   - Both profiles stay open.
   - You sign in once in that profile to Tableau, Google, Snowflake and Azure.
   - From then on, whichever account the app is on, one browser answers, and nothing needs restarting.
2. **If it still breaks** (for example one profile is closed), Claude tells you the exact reason and the one fix in a single line, such as "open your second Comet profile" or "restart the Claude app", instead of a generic checklist.
3. **Scheduled checks test the browser first.** If it isn't reachable, you get one URGENT email with the exact fix and "this check did NOT run". They never report a pass.
4. **The same handling covers the other two browser problems:**
   - the window that looked minimized (GEN-928), where Claude checks the real window state and fixes it itself where it can;
   - tabs that hang and can't be closed (GEN-914), where Claude avoids leaving pages with unsaved edits.

   All of this reaches every session through the browser notes (GEN-742).

**Effort to execute: xhigh.** It involves building and live-testing small automations and a hook.

## Evidence

Source: `%LOCALAPPDATA%\Claude\Logs\main.log` (local time, UTC+3).
- **The app switches between two accounts in one org.** The accounts are `a47791bc` and `c68119fc`, org `13fa9673`. Each switch is logged ("[growthbook] refreshing for account change"). Switches: 10-15 (several), 10-19 09:28 → a47, 10-21 10:17:56 → c68.
- **The browser link ("Connecting to bridge …/chrome/<account>") moves only when it is rebuilt.**
  - 10-19: the app moved to a47 at 09:28 (line 22731). The link stayed on c68 and browser work kept working until 20:41:48 (line 32334), when the link was rebuilt on a47.
  - The extension, still on c68, was then missing overnight, and the 10-20 08:31 scheduled check failed.
  - 10-21: the link stayed on a47 from 08:33:50 (line 43574). The app moved to c68 at 10:17. The extension left a47 at 10:20:06 and was never seen again until the fix.
- **Comet-side actions didn't help.** These are recorded on GEN-883 and observed this session: a Comet restart, a Tableau sign-in, and switching the extension off and on (`list_connected_browsers` = `[]` at 12:36).
- **Confirmed by intervention.** The Claude app restarted at 14:07:00 (line 48285) on c68. The link was rebuilt on c68 at 14:09:36 (line 48885), about 2.5 minutes later, on first browser use. `list_connected_browsers` then returned device `fc836352`, inUse.
- **Ruled out.** The 10-16 and 10-19 00:18 drops were PC shutdowns ("Windows session ending (shutdown)"). Ordinary standby drops recover in about 3 s.
- **Inferred, verify in step 0:** c68 = info@, a47 = Erez's other account.

## Decision

Asked: "why do you switch accounts in the Claude app?" (A: stop switching / B: keep switching, cover both / C: keep switching, just get told). Erez, verbatim: "I switch on purpose and want to keep doing it." → **B**, with C's exact message as the fallback.

## Execution order

0. **Option B setup, with Erez.**
   - Confirm which account each Comet profile's extension is on (its settings page).
   - Erez signs the second profile's extension in to the other account, keeps both profiles open, and signs in to the sites there.
   - **Test:** switch the app's account, then force a link rebuild by restarting the app. This is for testing only; normal use needs no restart. Wait for "Connecting to bridge". Then check that `list_connected_browsers` shows one browser and that a browser step works. Repeat for the other account.
   - The second profile has a new device id, so `select_browser` may be needed once. If it is needed every time, the browser notes tell Claude to do it.
1. **Live check first, log second.**
   - Pass/fail is always the real tool (`list_connected_browsers` / `tabs_context_mcp`).
   - A small read-only script reads the app log only to explain a failure: the app's current account, the account the link is on, the time of the last extension sighting, and "since when". It never says "OK", and it says "reason unknown" if it can't parse the log.
2. **Browser hook (GEN-742 carrier, via /vet-code).**
   - Registered on PostToolUse and PostToolUseFailure for `mcp__claude-in-chrome__.*`, like the existing windows-mcp hooks in `settings.json`. Which of the two events fires gets confirmed in testing.
   - It injects the browser notes (GEN-742's gotchas) once per session.
   - On "not connected", it runs the explain script and injects the one-line reason and fix.
   - A hook cannot call MCP tools; it only explains.
3. **Scheduled tasks.**
   - Find the browser-using tasks by searching task files at build time (8 mention the browser today), and prune the stale ones.
   - Each gets a shared first step: live check → explain → one URGENT email with the fix and "did NOT run".
   - No keystroke or desktop-control repair runs unattended.
   - Confirm that hooks load in scheduled-task sessions.
4. **Outcome tally.** One line per not-connected event (cause, who fixed it) goes to a small log, and /wrap reports it. Re-evaluate bar: 2 or more events in a week after setup means B didn't hold.
5. **Wave 2.**
   - GEN-928: a window-state check that lists all Comet windows with their size and state, then a self-fix by restoring the window via PowerShell or `resize_window`, tested first.
   - GEN-914: no leaving pages with unsaved edits, a discard/cancel step before closing, and Task Manager → End process as the stuck-tab fallback.
   - Both go into the same hook and notes, after reproduction.
6. **Ticket bookkeeping.** Record the confirmed cause and Erez's decision on GEN-883, and add the account-switch gotcha to GEN-742. Add this case as evidence on GEN-855. All ticket writes go via /vet-ticket.

## Notes to include in browser.md (collected during setup)
- **Account picker defaults (Erez, 2026-10-21).** In the second Comet profile, some sites' sign-in picked info@muuula.com by default and Erez had to switch to his usual user by hand. Claude should do the same: whenever a site lands on, or offers, info@ where Erez's usual user is expected, choose the usual user from the site's account chooser. That's a click, never a password. If a password is asked, leave the page open and hand it to Erez.
- **Two extensions, one per Claude account.** At 16:55 the app (account c68) paired with the new profile's extension (device c6de10fa). The old one (fc836352) was no longer listed for c68. `list_connected_browsers` shows only the browser on the app's current account.

## Not bundled
- GEN-855 (blind watches report all clear): broader, Azure/MD-3654; it gets this case as evidence only.
- GEN-915 (which epic holds these tickets): filing admin.
- GEN-360 / GEN-293 (other connectors' flakiness): different tools.
- GEN-175 / GEN-680 / GEN-712 / GEN-778 (scheduled-task plumbing): not about the browser.

## Verification
- **Step 0 test:** both accounts reach a browser.
- **Hook:** simulate a "not connected" result and confirm the message names the real reason and fix.
- **Scheduled tasks:** a dry run with the browser unreachable sends one URGENT email and no pass.
- **Real life:** Erez switches accounts as usual for a week, with no browser outages, or each one comes with the exact fix.

## Residual
- B depends on both Comet profiles staying open. If one is closed, the fallback message says so.
- Website logins are per profile, so a site that logs you out needs re-signing in that profile.
- The app log is internal and could change format. The explain step then says "reason unknown", and the live check still catches the failure.
- Scheduled tasks don't run while the PC is asleep or the app is closed (desktop limitation).
- The app not following account switches is Anthropic's behaviour. Report it via /feedback; B works around it.
