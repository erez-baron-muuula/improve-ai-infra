# GEN-674 size stop: option E (converged /check, 3 lenses, 2 rounds, 2026-10-25)

Asked by Erez: "is there a better alternative we are missing? propose" (after the B+ / A question).

## Design
E = the approved core, with the forced click coming from a static Claude Code permission rule instead of a new hook.
1. `update-config.ps1` measures the exact bytes it will write (plan.md §1). Crossing 200 lines without `-ApproveSizeUpTo N` -> exit 6, nothing written. With the switch: also requires its full literal name on the invoking line (`$MyInvocation.Line`) and `-SizeOkQuote "<Erez's answer verbatim>"` (non-empty, single line, <=200 chars).
2. `~/.claude/settings.json` `permissions.ask`: `PowerShell(*ApproveSizeUpTo*)`, `Bash(*ApproveSizeUpTo*)`. Docs (https://code.claude.com/docs/en/permissions): ask rules prompt "even in auto mode" (l.223); a PreToolUse "allow" can't bypass them (l.631); an allow rule / "don't ask again" can't silence them (l.60); PowerShell wildcards at any position, case-insensitive (l.317, l.333). Not a security boundary (l.252); bypassPermissions skips prompts (l.83).
3. Exit-6 message: use the switch only after Erez answered, in this session, a chat question naming the new line count with a shorter version offered first (a /vet-rule card approval alone is not that OK); put `-ApproveSizeUpTo` and `-SizeOkQuote` before the text arguments; tool-call description states the new line count in plain words.
4. Next-session notice (sessionstart-backup-surfacer.js): "Your rules file is now N lines, over the 200 limit. On <date> Claude recorded it with your OK quoted as: '<quote>'. If that's not what you agreed, say so and I'll bring it back under 200." Quote via clean() + cap; `notified` set after emit, atomic write, preserves lines/sha256/approvedOn; reset on a second crossing; kept on carry-forward.
5. Kept from B+: vetting lock on the two Drive scripts; Case-3 refusal of direct shell writes to the global CLAUDE.md; session-start sha256 backstop; session-start check that the scripts still hold the stop, extended to the two ask rules.
6. Dropped vs B+: `size-approval-prompt.js`, grant files, approval-folder guard.
7. Step 1: add the ask rule, harmless probe via the PowerShell tool AND the Bash tool in auto mode, Erez clicks Deny each. Prompt shown -> proceed; not shown -> stop (fallback D = no click, notice only, only with Erez's OK).

## Decision and step 1 result
- 2026-10-25, Erez (to "Which way should the size stop go in?"): "Go with option E. Start with the one-click prompt test."
- Step 1 PASSED 2026-10-25: test ask rules `PowerShell(*approvesizeuptoTEST*)` / `Bash(*approvesizeuptoTEST*)` put in this project's `.claude/settings.local.json` (not the locked global settings.json; settings reload live per https://code.claude.com/docs/en/settings "When edits take effect"). Auto mode, desktop app: `Write-Output approvesizeuptoTEST` (PowerShell tool) and `echo approvesizeuptoTEST` (Bash tool) each showed Erez a prompt; he clicked Deny on both and neither ran. Test rules removed afterwards.

## Build-time advisories (from the panel)
- Put the literal-name + quote checks in `update-global-rule.ps1` too (prefix-abbreviated `-ApproveSize` binds on the wrapper).
- Refuse the switch when `Get-PSCallStack` shows a call from another script file (helper `.ps1` route), or list it as a residual.
- Verify `$MyInvocation.Line` with the real multi-line here-string shape, direct and via the wrapper, and `powershell -File`.
- Confirm the real invocation form triggers the ask rule at install.
- Check how `permissions.ask` gets into the locked settings.json (config-json-edit.js documents add-allow/remove-allow only).
- Nuisance prompts: keep the switch name out of routine commands (greps, commit messages).
- `-SizeOkQuote` + notice are optional per the holistic lens (audit trail only); kept because the quote is visible in the prompt.

## Residuals
bypassPermissions skips the prompt; windows-mcp PowerShell not covered (script + notice still apply); record file writable by Claude's tools (outside the good-faith threat model, plan.md:21); rare shell write shapes onto the rules file caught only at next session start; the prompt shows the raw command, not a plain sentence.

Size: ~/.claude/CLAUDE.md 186 -> 186 / 200 lines; settings.json +2 lines; surfacer growth measured at build (<=9,000 chars).
Effort: xhigh.
