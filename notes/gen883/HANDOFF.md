# GEN-883 bundle — handoff (state as of 2026-10-25)

Tickets: GEN-883 (primary, In Progress) https://app.notion.com/p/3fa6e495d07c812db9f9dc734fbe1659 ·
GEN-742 browser notes https://app.notion.com/p/3e86e495d07c81398465c1667e8881af ·
GEN-928 window unusable https://app.notion.com/p/3ff6e495d07c8136921ec9adc1991f8b ·
GEN-914 stuck tabs https://app.notion.com/p/3fe6e495d07c811ebedcf84a47522a65.
Approved plan: `plan.md` in this folder (Erez approved it; read it first).

## Root cause (confirmed 2026-10-21 by intervention)
Erez switches the Claude desktop app between two Claude accounts on purpose (info@ = account id prefix
c68119fc, erez@ = a47791bc, same org 13fa9673). The app's browser link ("Connecting to bridge
.../chrome/<account>" in %LOCALAPPDATA%\Claude\Logs\main.log) stays on the account the app was on when
the link last connected (sleep/wake, app restart, or a dropped connection reconnecting); an account
switch alone does not move it. The Comet extension follows only the account it is signed in to.
Restarting the Claude app brought the browser back (14:07 restart -> 14:09:36 link on c68, paired).

## Erez's decision
Asked "why do you switch accounts in the Claude app?" -> verbatim: "I switch on purpose and want to keep
doing it." -> Option B: two Comet profiles, each Claude extension on a different account, both kept open.
DONE 2026-10-21: original profile's extension = erez@muuula.com; new profile named "info@muuula.com" =
info@ (device c6de10fa paired on c68 at 16:55). Erez signed in to the work sites in the new profile; some
sites default to info@ and he switches to his usual user (noted in browser.md). NOT yet tested: the erez@
side (switch app to erez@, quit Claude from tray, reopen, run a browser call).

## Built and LIVE (installed 2026-10-25 via /vet-code, backed up to Drive + git)
- `~/.claude/hooks/inject-browser-refs.js` (source of truth copy: `inject-browser-refs.js` here).
  PostToolUse "ToolSearch|mcp__(claude-in-chrome|Claude_in_Chrome)__.*" + PostToolUseFailure, timeout 15.
  Injects refs/browser.md once per session; on "not connected" injects the reason + one fix from the app
  log; settle (wait/retry once) for events <90 s old; tally in hooks/browser-events.jsonl with an in-hook
  re-evaluate bar (2+ separate outages in 7 days). `--explain` CLI prints the diagnosis.
- `~/.claude/hooks/refs/browser.md` (GEN-742 lessons condensed + new account notes), `refs/browser-accounts.json`.
- Vetting records: `~/.claude-staging/vetting-passes/gen883-*.record.json`. Verified: byte-identical
  install, settings pass consumed, live fire injected the notes, `--explain` resolves labels.
- Tests: `node smoke.js` (25 checks; run from scratch copy layout: it expects the hook beside it),
  `node realism.js` (2,534 real browser results: 28 fires, 0 false).
- sync.ps1 $FileMap now includes the hook.

## Remaining (in order)
1. Scheduled tasks (plan step 3): find browser-using tasks by searching `~/.claude/scheduled-tasks/*/SKILL.md`
   (8 mentioned the browser on 10-21; prune stale ones). Make each one's not-connected handling explicit
   (its own retries, could-not-run / URGENT alert with the hook's fix, never a pass; optional-browser tasks
   just note it). Confirm hooks load in scheduled-task sessions (unverified). (xhigh)
2. Wave 2 into the same hook/notes, after reproduction: GEN-928 window-state check + self-fix; GEN-914
   leave-page prevention + stuck-tab fallback. Any hook change goes through /vet-code. (xhigh)
3. Tickets via /vet-ticket: record cause + decision (quote above) on GEN-883; add account-switch +
   info@-default lessons to GEN-742; add this case as evidence on GEN-855. GEN-883 -> Review when 1-3 done,
   Erez verifies over a week. Also: report "app browser link doesn't follow account switch" to Anthropic
   via /feedback (Erez). (medium)
4. Optional erez@-side test (above), with Erez.

Known accepted residuals: banner-wording dependence (detection keys on "Claude in Chrome is not
connected"); labels go stale if an extension is re-signed to another account; DST-hour age skew;
lastDown only searched in the 2 MB log tail.
