# GEN-488 — Design: advisory redirect-target nudge in auto-approve.js

## Goal (from ticket + approved build plan)
A best-effort, **advisory-only, non-blocking** check inside the `auto-approve.js` PreToolUse
hook: when a Bash/PowerShell command's redirect target LITERALLY resolves to the home dir or a
project root, inject a one-line warning steering output to the current session's scratchpad.
It must NOT block, must NOT change the approve/defer/block decision, and must fail open
(any uncertainty → no warning, never a broken call).

## Verified facts this design rests on
- **PreToolUse output contract (verified via claude-code-guide agent against official docs):**
  `hookSpecificOutput.additionalContext` is a documented PreToolUse field ("String added to
  Claude's context for this operation"). Emitting ONLY additionalContext with exit 0 leaves the
  permission flow exactly as if the hook were silent ("Exit code 0 with no output means the hook
  has no decision to report... staying silent doesn't approve it"; additionalContext "is kept
  from every hook and passed to Claude together"). It can also legally coexist with
  `permissionDecision` (not needed here). Live proof in this environment: `inject-shell-refs.js`
  ships additionalContext-only output today and never alters decisions.
- **Redirect-carrying shell commands cannot reach the ORDINARY approve paths** of this hook:
  `shellCommandIsSafe` rejects any command containing `<`, `>`, or backtick (line 346), and the
  three exact-match approve carve-outs (sync/ticket-lookup/loggate) are full-string-anchored
  regexes with no room for a redirect. Two narrow approve paths CAN pass a redirect-carrying
  command: `enforceStaging`/`enforceVetting` pass-consumption approves (both run before the
  SHELL_TOOLS branch and don't screen for `>`). Those are rare, human-gated (a pre-minted pass),
  and are declared an explicit accepted miss below — the nudge attaches to the defer path, which
  is where every ordinary redirect-carrying command lands.
- **Hook env/stdin (verified):** hooks receive `CLAUDE_PROJECT_DIR` env var; stdin JSON has
  `cwd` (current working dir at call time, tracks `cd`) and `session_id`. No scratchpad env var
  exists. Scratchpad path formula verified on disk:
  `<os.tmpdir()>\claude\<slug>\<session_id>\scratchpad` where slug = project dir with every
  non-alphanumeric char replaced by `-` (confirmed against this session's real scratchpad).

## Change design

### 1. Delivery — extend `defer()` with an optional advisory payload
`defer(additionalContext)`: when passed a non-empty string, write
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":<text>}}` to stdout,
then `process.exit(0)` as today. When called with no argument (every existing call site),
behavior is byte-identical to today (no output). Only ONE call site passes the argument: the
shell-tools defer at the end of the SHELL_TOOLS branch.

### 2. Placement — shell defer path only, after every guard
In the `SHELL_TOOLS` branch, after `blockMixedChain` returns (i.e. the command is definitively
going to defer):
```js
const nudge = redirectNudgeContext(input, cmd);   // string or null; never throws
logDeferred(input);
return defer(nudge);
```
- Runs strictly AFTER blockIfProtected / enforceStaging / enforceVetting / approve carve-outs /
  blockMixedChain — so it cannot convert any decision; it only decorates a defer that was
  already happening.
- Approve paths need no nudge (redirects can't reach them); block paths need none (the command
  won't run).

### 3. Detection — nudge-own pattern list, vetting gate byte-untouched
The nudge declares its OWN destination-pattern list INSIDE `redirectNudgeContext`: THREE of
the four `destPatterns` regex literals from `vettingTargets` duplicated VERBATIM (redirect,
PS content-writers, .NET writers — the move/copy pattern is deliberately EXCLUDED per the
Step-3 code-review panel: the ticket's scope is output redirection, and mv/cp destinations
are routinely directories, e.g. `Copy-Item x C:\Users\Erez\Downloads`, which the file-target
geometry would misread as home-dir strays — a recurring FALSE warning), plus one nudge-only
pattern for `-o <path>` / `--output <path>` (the ticket names `-o`), guarded to require a
path-shaped operand (contains a separator or dot) so generic option flags (`set -o pipefail`,
`ssh -o Option=val`) never fire it. Two further code-review hardenings: a QUOTED `~` capture
is skipped rather than expanded (bash does not expand a quoted tilde), and when the payload
carries no usable `cwd`, relative tokens are skipped (they would otherwise resolve against
the hook process's own cwd — a path the command will not write). `vettingTargets` is NOT modified in any way — zero diff to the vetting gate, so no
possibility of widening or regressing that security-critical path (the round-1 panel's material
finding and the holistic reviewer's blast-radius advisory both resolve this way). The
duplication is deliberate and annotated with a cross-reference comment on BOTH copies
("duplicated by design — see the matching comment in vettingTargets/redirectNudgeContext; a
change to one copy does not and must not affect the other: the vetting gate is a security
mechanism, the nudge is advisory"). Regex literals inside the function body compile to fresh
RegExp objects on every call, so no `/g` `lastIndex` state can leak between invocations or into
`vettingTargets`.

**Quoted-content and multi-line suppression (round-3 revision — closes a false-positive
class the panel did not surface):** the destination regexes are quote-blind, so a `>` INSIDE a
quoted string (`git commit -m "fix a > b"`, `jq '.count > 5'`, `awk '$1 > 2'`) would capture
the following token, which resolves against `cwd` — and since `cwd` usually IS a project root,
these everyday commands would fire spurious nudges, eroding trust (a converged design
principle). Two suppressions, both fail-open:
- **Single-line only.** If the command contains `\r` or `\n`, return null immediately —
  heredoc/here-string bodies carry arbitrary text (commit messages etc.) that no span scanner
  can classify. Matches the chain guard's own v1 single-line scope.
- **Quoted-span filter.** A small nudge-own scanner `quotedSpans(cmd, tool)` walks the string
  with the same per-shell quote rules `scanChain` uses (bash: `\` escapes, `'...'` literal,
  `"..."`; PS: backtick escapes, doubled `''`/`""`) and returns an array of `[start, end)`
  quoted spans — or null when quoting is unbalanced/uncertain (→ no nudge, fail open). It is a
  simplified sibling of `scanChain`'s state machine, NOT a modification of it (`scanChain` is
  security-critical and stays untouched; it cannot be reused directly because it only exposes
  unquoted text for CHAINED verdicts, and blanking-based reuse would also blank quoted PATHS —
  `> "C:\Users\Erez\out file.txt"` — which are exactly the targets we must still see, since
  home/project paths contain spaces and are typically quoted). Each destination-pattern match
  is kept only if its match-start index falls OUTSIDE every quoted span: `> "path"` keeps (the
  operator is unquoted; the quoted path is still captured), `"a > b"` is rejected (operator
  inside the span).

For each captured destination token, in `redirectNudgeContext`:
- Lowercase the raw token FIRST, then apply skip-checks against the lowercased form. Skip
  tokens that cannot be literal paths: containing `$` or `%` (variable/expansion), starting
  with `-` (a flag mis-captured by the lazy cmdlet pattern — an inherited, pre-existing
  fuzziness of the duplicated move/copy pattern, guarded here), equal to `nul` or matching
  `^/dev/` (null sinks), or matching `^&\d` (fd dup). These are the design's accepted misses
  (variable-built paths etc.) plus false-positive guards.
- Expand a leading `~/` or `~\` to the home dir (catches `> ~/junk.txt` from the Bash tool —
  a real home-dir junk shape).
- Resolve with the existing `normForMatch(tok, input.cwd)` (path.resolve against cwd,
  lowercase, backslashes). Note: this deliberately resolves RELATIVE literal paths against the
  call's known `cwd` — the stdin `cwd` field is harness-tracked, so "unknown CWD" from the
  build plan does not apply here; a relative literal like `> out.txt` issued from a project
  root is the single most common junk shape and is cheap to catch. Variable-built and otherwise
  non-literal paths remain accepted misses.

### 4. Trigger geometry — "lands DIRECTLY in" (parent-dir-exact, not subtree)
Warn iff `path.dirname(resolvedTarget)` equals one of:
- the home dir itself (`c:\users\erez`) — derived as `path.join(HOOK_DIR,'..','..')` normalized,
  consistent with how the file derives STAGING_DIR (no new hardcoded path, no new import);
- a `PROJECT_ROOTS` entry itself (`c:\users\erez\ai projects`, `c:\users\erez\memorypirates`) —
  a stray directly in the projects container or directly in the MemoryPirates repo root;
- a DIRECT CHILD of `c:\users\erez\ai projects\` (i.e. an individual project/repo root — where
  `full_decompressed.bin`-style strays landed). Computed from the PROJECT_ROOTS constant, not a
  second hardcoded list. (The two PROJECT_ROOTS entries have different semantics — `ai projects\`
  is a container of repos, `memorypirates\` IS a repo — so the depth-1-child clause applies only
  to the container entry.)
A subtree-wide match (anywhere under home / under a project) is deliberately NOT used: it would
warn on every legitimate deep write (AppData, .claude, project subfolders) and erode trust in
the nudge. Junk evidence from GEN-373 is exclusively top-level strays. The scratchpad itself is
deep under `AppData\Local\Temp`, so it can structurally never match — no explicit exclusion
needed (but the geometry guarantees it).

### 5. Scratchpad path in the warning — derived at fire time, existence-validated
```
base = process.env.CLAUDE_PROJECT_DIR || input.cwd   (first non-empty)
slug = base with /[^A-Za-z0-9]/g → '-'
cand = path.join(os.tmpdir(), 'claude', slug, input.session_id, 'scratchpad')
```
Use `cand` in the warning text only if `fs.existsSync(cand)`; otherwise the warning says
"the session scratchpad directory" generically. Never hardcoded, never stale: derived per call
from live env/stdin, validated on disk. Requires adding `const os = require('os')` (pattern
already used by sibling hook inject-shell-refs.js).

### 6. Warning text (one line, advisory-explicit)
`Redirect nudge (advisory only — this call is NOT blocked): its output target "<resolved path>"
lands directly in <the home directory | the AI Projects folder | a project root>, where stray
output files become junk (GEN-373). For temporary output, prefer the session scratchpad:
<path or generic phrase>.`

### 7. Fail-open (absolute, belt-and-suspenders)
The entire body of `redirectNudgeContext` is wrapped in try/catch returning null, AND the call
site wraps the call in its own try/catch (matching the file's defensive style around
`vettingTargets`). Any parse uncertainty, missing field (`cmd` undefined, `session_id` absent),
or fs error → no warning, decision flow untouched. The nudge writes no files, reads no new
files beyond the existsSync probe, and adds no logging (deferred-calls logging already covers
these commands).

## Explicitly out of scope (design-approved accepted misses)
Variable-built paths, `%VAR%`/`$env:` expansions, here-strings, piped `Export-*`, bash
process substitution, `2>` fd-prefixed redirects, no-space redirects (`echo hi>file` — the
duplicated pattern requires a boundary char before `>`, which also keeps `2>` safely out),
Edit/Write tool targets (covered by a different mechanism), cmdlets with the destination in a
later named-arg position that the lazy pattern mis-captures (skipped via the `-` guard), and
redirect-carrying commands approved by the staging/vetting pass-consumption paths (rare,
human-gated, never reach the SHELL_TOOLS defer). The cleanup sweep (GEN-373) remains the real
backstop.
