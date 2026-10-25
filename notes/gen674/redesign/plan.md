# GEN-674: rules-file size stop, redesigned

## In plain words (for Erez)
**What it does.** Your always-loaded rules file (`~/.claude/CLAUDE.md`, 186 lines today) can't grow past 200 lines unless you click Allow on Claude Code's own approval prompt, which states the new line count. If it ever gets past 200 some other way, the next session's first reply tells you in the "For you" block.

**Why this time it holds.** Last time the stop tried to work out from the command's wording what the file would become, and reviewers found four wordings that slipped past it. Now the measuring happens inside the one script that writes the file, on the exact text it is about to write, so the command's wording no longer matters. When something is missing or unclear (no approval, an unreadable file, a hidden or misspelled approval switch), the change is refused. Your approval only counts for the very next command after the prompt; any later command throws it away.

**Your cost.** At install: one approval card, and one short test where you click Deny on a prompt and then Allow. Later, each time a change would cross 200 lines: Claude asks in chat and offers a shorter version first; if you still want it, you click Allow once on one prompt. You approve one extra review pass if Claude only found out when the script refused, or if you click Deny. Your Allow is good for 10 minutes from when the prompt appears and only for that one command; if another session runs a command in between, Claude has to ask again. The prompt should also reach your phone through Remote Control; that part is not yet confirmed, and I'll check it in the test if you're away from the PC.

**Options I did not pick:**
- Approving by typing "yes" in chat, checked against the conversation record: works from your phone too, but the safety check would have to read and interpret the chat record, which is the kind of parsing that failed review last time.
- A pop-up window from the script: only usable at the PC, and it blocks other config changes while it waits.
- A permission rule alone, without the new hook: a hidden or misspelled switch would then go through without a prompt.

Effort to execute: xhigh (build, two code reviews, live test).

**Review:** a three-lens /check panel converged in 2 rounds. Round 1 (all three lenses) caught that the approval folder's name was part of the new hook's file name, so the safety guard would have blocked its own install; the pre-mortem also caught that an approval written before your click could outlive a Deny. Both fixed. Advisory notes not adopted: simplifying how an approved over-limit file stays "approved" after a later trim (kept, it's small and tested); making the new hook block every shell command if it crashes (rejected: one bug would lock Claude out of all commands; the hook instead clears old approvals before doing anything else).

## Context
- GEN-674 headroom step, Part 2. Erez's rule (2026-10-21): refuse any change that takes the global `CLAUDE.md` over its line limit unless he explicitly OKs it. The held hook-only build (`notes/gen674/sizestop-insert.txt`) failed both independent code reviews on four bypasses (wrapper with no target, decoy `-Op add-allow`, path aliasing, forged transcript line), all from reading command text. Erez: "redesign in a fresh session". Direction given: measure in the writer scripts, one approval switch, session-start backstop.
- Threat model, stated so reviewers judge against it: a guard against mistakes by a good-faith Claude (any command shape, any write route it might reasonably use), not a wall against a determined script. Same stance as the PC-control pass guard (`hooks/auto-approve.js:369-380`, GEN-903). Deliberate forgery stays possible and is caught only by the backstop.
- Verified facts the design rests on:
  - `update-global-rule.ps1:27` only calls `update-config.ps1 -File "CLAUDE.md" -Op text-replace`; `:28` passes the exit code through. One measuring point covers both.
  - `update-config.ps1`: new content is final at `:164` (text-replace) and after `:226` (write-file), after the Drive pull (`:138`) and before the pending-sync marker (`:174`, `:228`). Exit codes 0-5 used; an `exit` inside the `try` releases the lock (`:250-256`). `add-allow`/`remove-allow` cannot write a Markdown file (`config-json-edit.js:51-54`).
  - Neither script is locked today: not in `PROTECTED_FILES` (`auto-approve.js:209-219`) nor the vetting lock (`isProtectedCodeTarget`, `:1065-1076`). In auto mode (`settings.json:510`) an edit to them can pass without Erez.
  - A check pass binds to target only (`gate-mechanics.md:127-129`) and is consumed before the script runs (`auto-approve.js:1761-1762`). A direct shell write to the global file (Case 3, `:1653-1670`) with a pass is approved and skips both scripts.
  - Docs, https://code.claude.com/docs/en/hooks (fetched this session): "A hook's "ask" also forces a permission prompt in auto mode: the classifier can still deny the tool call, but it can't approve the call silently."; for "ask" the reason is "shown to the user in the permission prompt"; "precedence is deny > defer > ask > allow". `auto-approve.js` emits `allow` (`:70-79`) or nothing (`:81-100`), never `defer`. PermissionDenied "doesn't run when you manually deny a permission dialog" (pre-mortem reviewer's fetch).
  - Not verified: whether a hook "ask" prompts in `acceptEdits`/`bypassPermissions`, whether it still prompts after an "always allow" rule matches, and whether Remote Control lets the prompt be answered from the phone (https://code.claude.com/docs/en/remote-control only says push notifications cover permission prompts).

## Design
### 1. Measure in `update-config.ps1` (G:\My Drive\AI Projects\_Tooling\Claude\)
- New helpers: `Get-RulesLineCount` (copy of `config-health-scan.ps1` `Get-LineCount`, `:909-914`: LF count, +1 if not LF-terminated, 0 if empty, BOM ignored) and `Get-RulesLineLimit` (`min(anthropic-guidelines.json` `claude-md-lines`.value, 200)`, 200 on any read/parse problem; the file can only lower it).
- New last parameter `[int]$ApproveSizeUpTo`. Grant/record folder derived from `$ClaudeBase`'s parent: `.claude-staging\` + `rulesize` + `-ok` (two parts in source; a name no planned file, script, test or phrase contains).
- After the new content is final and before the marker/write (text-replace and write-file only):
  - **Is the target the rules file?** Read the bytes of the resolved absolute path the script will write (`Resolve-Path -LiteralPath` result, as at `:172`/`:218`) and of `~\.claude\CLAUDE.md`; equal bytes = the rules file. Every alias (`.\CLAUDE.md`, trailing dot, 8.3 name, hard link) and the Drive copy match; no path parsing. If either read fails and the target's file name (trailing dots/spaces trimmed) is `CLAUDE.md`, refuse.
  - Refuse new content holding a bare CR (CR not followed by LF): it would undercount.
  - **Crossing** = new lines > limit AND new lines > current lines. Shrinking or same size always passes.
  - Crossing without `-ApproveSizeUpTo` → **exit 6** before writing anything (no marker, no Drive push, lock released). Message: current → new lines and characters, the limit, and what to do: ask Erez in plain words, offering a version at or under the limit first; if he agrees, run `update-config.ps1 -File "CLAUDE.md" -Op text-replace|write-file ... -ApproveSizeUpTo <new lines>` with the switch spelled in full, as its own tool call (not in a parallel batch), with a 10-minute tool timeout, and he clicks Allow once (not "always"); revised text restarts /check; this run's check pass is spent (a Deny spends it too), so re-mint it (vet-rule recovery). Also says: the approval lasts 10 minutes from when the prompt appears and only for that command; another command run in between (any session) cancels it; in an `acceptEdits` or `bypassPermissions` session no approval is recorded, so the crossing waits for a normal session.
  - Crossing with `-ApproveSizeUpTo N`: proceed only if N ≥ new lines AND the grant (part 2) exists, is unexpired and has `lines` ≥ new lines; delete the grant; otherwise exit 6 naming which check failed ("another command ran after the click; ask again" for a missing grant).
  - **Approval record** (`record.json` in the same folder), written right after the local write and before the Drive push: result ≤ limit → delete it; result > limit after an approved crossing → `{lines: <measured new lines>, sha256: <lower-case hex sha256 of the written bytes>, approvedOn}`; result > limit after a shrink/equal write → carry the record forward (new `lines` and `sha256`) only if the old record's `sha256` matched the bytes before this write, else leave it. The surfacer hashes the same way.
- Header documents exit 6 and the switch. `update-global-rule.ps1` code unchanged (exit 6 passes through; it has no switch, so a crossing goes via `update-config.ps1`).

### 2. Erez's OK: Claude Code's own prompt (new hook `hooks/size-approval-prompt.js`)
- PreToolUse, matcher `Bash|PowerShell|Monitor|mcp__windows-mcp__PowerShell`, registered in `settings.json` (no `onFailure: block`, see Review). Runs on every such call (one extra node start per shell call).
- Every run, first, before reading its input: delete any existing grant (`grant.json`). On a lock/permission error retry a few times about 100 ms apart, then overwrite it with an expired tombstone; only if that also fails, block the call (exit 2) with a message naming the file's full path so Erez can delete it. So a grant can only ever serve the very next command after its own prompt.
- If the command text contains `approvesizeupto` anywhere (case-folded like `enforceWmcpPassGuard`): print `permissionDecision: "ask"` with the reason "Claude asks to let your always-loaded rules file grow to N lines (Anthropic recommends at most 200). Click Allow once only if you agreed to this in the chat." (if no number is readable: "...grow past 200 lines; the command gives no line count, so it will be refused"). Then write the grant `{lines: N, expires: now + 10 min}` as the very last statement (inside try/catch, then `exit 0`) when ALL hold: the text names `update-config.ps1`; a literal number follows the switch name (smallest if several); the input has no `agent_id`; `permission_mode` is `default` or `auto`.
- Any error after the name is seen still yields "ask" and no grant.
- Fail-closed by construction: a hidden, abbreviated (`-Approve`), splatted, positional or wrapper-file switch never triggers the hook, so no grant exists for that command and the script refuses. A leftover grant from a denied or blocked prompt is deleted by the hook run of the very next shell/Monitor call, before that call runs. A decoy (the name inside a quoted value or a grep) only adds a prompt; its grant dies with the next call.
- Residual: a command run outside any hooked call (a background job started earlier, another program) within 10 minutes of a denied prompt could use the grant; that takes a deliberate act. A hook that fails to even start (a broken edit) leaves an old grant in place until the next working run; the vetting lock on the hook makes that unlikely.

### 3. `auto-approve.js` (one vetted change)
- a. Vetting lock extended to the two Drive scripts (`update-config.ps1`, `update-global-rule.ps1`), so the stop's own code can't change without /vet-code.
- b. Guard the `rulesize-ok` folder like the PC-control pass folder: generalize `enforceWmcpPassGuard` to a list of folder names (built from parts), refusing any Claude tool input naming one. Reading stays allowed.
- c. In `enforceCheckDue`, refuse a Case 3 (direct shell write) target that is the global `CLAUDE.md`, even with a pass, pointing to `update-config.ps1`. Case 1/2 unchanged.

### 4. Backstop: `hooks/sessionstart-backup-surfacer.js`
- Add `rulesFileSizeLine` to the check list at `:151`. If `CLAUDE.md` is over the limit and the record's `sha256` doesn't equal the file's current sha256: "Rules-file size: `~/.claude/CLAUDE.md` is N lines, over its L-line limit, with no OK from Erez on record for its current text. Tell Erez in the 📌 For you block of your first reply, in plain words, and offer to bring it back to L lines or fewer." Unreadable file → a one-line "could not measure" note. Otherwise silent. About 400 characters, inside the hook's 9,000 cap. Any write outside the script while over the limit therefore shows up.

### 5. Bundled small fix
- `hooks/deny-askuserquestion.js:8-9` stale header comment (from GEN-674's 2026-10-21 note).

### Not changed (residual)
- `config-health` `/wrap` sweep still says BREACH for an approved exception (truthful; extend only if an exception is ever recorded).
- Writes the hook can't recognise as writes to the file reach it without measurement and are caught only by the backstop: the Drive copy of `CLAUDE.md` (lands locally on the next pull), `node -e`/`python -c`/`sed -i`, variable paths, break-glass, edits to `sync.ps1`/`config-json-edit.js`.
- Line-count rule now in three places (config-health, the script, the surfacer); tests compare them.
- Project `CLAUDE.md` files (Invoice Automation 257 lines, GEN-888) and a character cap: out of scope.
- The wrapper gap in the existing check-due and vetting gates stays with GEN-938.
- The record is per-PC: another PC that pulls an approved over-limit file will show the session-start line (truthful there).
- Once the folder guard is live, no shell command, description or commit message may hold the folder name whole; logs call it "the size-approval folder".

## Sizes
- size: `~/.claude/CLAUDE.md` 186 → 186 / 200 lines (unchanged)
- size: surfacer injected text +~400 characters, within its 9,000 cap / 10,000 hook limit
- No skill file changes.

## Build and vet (one /vet-code run, xhigh)
1. This plan converged through /check before Erez's approval.
2. Working copies in the scratchpad, built by a script with exact-once replacements (pattern: `notes/gen674/sizestop-build.js`): `update-config.ps1`, `auto-approve.js`, `sessionstart-backup-surfacer.js`, `deny-askuserquestion.js`, new `size-approval-prompt.js`, `settings.json` (hooks entry).
3. Tests (new harness `notes/gen674/sizestop2-test.js`, reusing `sizestop-test.js` helpers):
   - Script: a fixture copy of `update-config.ps1` with `$ClaudeBase`, `$SyncScript`, `$JsonEditor` and the guidelines path pointed at a fixture tree (the grant/record folder follows `$ClaudeBase`) and a stub sync script; no test hook in the real script. Cases: 200/201, trailing LF, BOM, bare CR, shrink/equal/grow while over, limit 190/300/abc/missing, aliases (`.\CLAUDE.md`, trailing dot, hard link, byte-equal copy), every held "refused shape" (`-Fi`, `-File:`, positional, decoy, `powershell -File` wrapper, `$var` ContentFile, `` `n `` NewText) reaching the same measurement, grant none/expired/too low/valid/used twice, switch below result, `update-global-rule.ps1` passing exit 6 through, record lifecycle, no write and no marker on refusal.
   - Prompt hook through the real hook process: switch present → ask then grant; old grant deleted on every call; decoy/grep → ask; absent → no output; `$n` value → ask, no grant; no `update-config.ps1` in text → ask, no grant; `agent_id` → no grant; modes `acceptEdits`/`bypassPermissions` → ask, no grant; delete failure → exit 2.
   - `auto-approve.js`: folder guard (the hook's own path, the test harness path, settings text and log wording must NOT trip it), Case 3 refusal (including an update-config call whose rule text holds a `> <CLAUDE.md path>` fragment), vetting lock on the two scripts; replay `sizestop-corpus.js` (17 global-file commands) and `sizestop-corpus-other.js` (163 others) for no new false refusals.
   - Backstop: under/over/record matches/record stale/unreadable, including a record written by the real (fixture) script, not hand-built. The three line counters agree on every fixture.
   - No caller of `update-config.ps1`/`update-global-rule.ps1` (skills, scripts) treats exit 6 as something else.
4. Pass A `/code-review` high + Pass B independent reviewer (adversarial: fail-open, data loss).
5. Approval card → mint → apply (scripts first; they are not locked until `auto-approve.js` lands) → verify sha256 of each installed file → sync config.
6. Live-verify with Erez, right after install:
   - A byte-equal scratch copy of `CLAUDE.md` as target (not check-due, measured as the rules file): crossing without the switch → exit 6, file and marker untouched; with the switch → prompt shows the reason in auto mode; Deny → nothing written and the next shell call clears the grant; Allow → written, grant consumed. The test record holds the scratch copy's hash, so it can never match the real file.
   - "ask" beats "allow" here: a command `auto-approve.js` allows on its own (checked by a fixture run first) that carries the switch text → the prompt still appears; Erez clicks Deny.
   - If Erez is away, one prompt answered from the phone.
   - Session-start line checked with a fixture run.
   - Rollback if no prompt appears: unregister the new hook (restore the pre-change `settings.json`); with no grants ever written, every crossing is then refused until fixed.
7. GEN-674 note, then Waves 2-4 as planned.
