# Gate mechanics shared by /vet-code and /vet-rule

**Contents:** Parameters · 1. The record · 2. Evidence precondition, then mint · 3. Apply · 4. Recovery · 5. Break-glass OPEN/CLOSE commands

The record, evidence check, mint, apply, recovery and break-glass mechanics that `/vet-code` and
`/vet-rule` both use. Each runbook names the step at which to read this file. A change to this file
changes BOTH gates: run its `/check` against both runbooks and keep the table below true for both.

## Parameters — substitute YOUR skill's column before acting

The text below uses bracketed names. Replace each with the value from the column of the skill you are
running; read this table first, whichever section a runbook sends you to. The hook reads each gate's passes only from that gate's own directory and only with that
gate's own `kind`, so a pass minted with the other column's values is never found and the write stays
blocked.

| Name used below | `/vet-code` | `/vet-rule` |
|---|---|---|
| `[PASS_DIR]` | `~/.claude-staging/vetting-passes/` | `~/.claude-staging/check-passes/` |
| `[RECORD]` | vetting record | check-record |
| `[RECORD_KIND]` | `vetting-record` | `check-record` |
| `[PASS]` | vetting pass | check pass |
| `[PASS_KIND]` | `vetting` | `check` |
| `[GUARD]` (the hook function that consumes the pass) | `enforceVetting` | `enforceCheckDue` |
| Extra record fields | `passBAgentIds`, `belowFloorSignoff` | none |
| `[STEP_MINT]` (evidence check + mint) | Step 6 | Step 4 |
| `[STEP_APPLY]` (apply) | Step 7 | Step 5 |
| `[STEP_VERIFY]` (verify installed) | Step 8 | Step 6 |
| `[STEP_RECOVERY]` (recovery) | Step 9 | Step 8 |

Both skills write the record at Step 1b. A paragraph marked **`/vet-code` only** or **`/vet-rule`
only** applies to that skill alone.

---

## 1. The record (Step 1b)

Immediately after `/check` converges, write a **[RECORD]** to `[PASS_DIR]` (create the dir if
missing) capturing the evidence, bound to THIS exact change:

```json
{ "kind": "[RECORD_KIND]",
  "target": "<abs path of the file being changed, lowercased>",
  "contentHash": "<sha256 of the NORMALIZED full working-copy content: UTF-8, LF line endings>",
  "checkReviewerAgentIds": ["<the agentId the Agent tool returned for EACH check-reviewer spawned by Step 1's /check this session, e.g. a0047388047ab127d>"],
  "checkVerdict": "converged",
  "capturedVerdicts": "<the panel's final verdicts, copied in so the record is self-contained>",
  "draftedUtc": "<ISO-8601 UTC now>",
  "passBAgentIds": ["<appended at Step 3: the agentId of each Pass B run>"],
  "belowFloorSignoff": "<only if Erez approved a below-floor run at Step 3: the session model ID>" }
```

The last two fields are **`/vet-code` only**; a `/vet-rule` record ends at `draftedUtc`.

Copy the verdicts IN so the record is self-contained — this preserves the audit trail if a `/compact`
later deletes the transcripts; it does NOT let [STEP_MINT] mint without the transcripts (that check is
fail-closed on their on-disk existence). Bind by `target` + `contentHash` (full normalized content,
NOT a diff — a diff is non-reproducible under Windows CRLF/autocrlf and a moving git baseline). Record
the real `agentId` of every `check-reviewer` you spawned in Step 1's `/check` panel (the Agent tool
returns it on each call — confirm the first time you exercise this that the returned id matches the
on-disk `agent-<agentId>.jsonl` filename); [STEP_MINT] uses these to locate the on-disk transcripts. If
a whole skill folder changed across several files, write one record per changed file (each with its
own `contentHash`); the `checkReviewerAgentIds` are the same across those records when one panel
reviewed the whole change.

**`/vet-code` only:** Capture them now, at Step 1b — BEFORE Step 3's Pass B spawns its own separate
`check-reviewer` sub-agent — so the two sets are never conflated: Step 6's reviewer-evidence check is
scoped to Step 1's `/check` reviewers only, and Pass B is recorded separately in `passBAgentIds`
(added at Step 3) and checked by Step 6's Pass B model check. (`passBAgentIds` is `/vet-code`-only —
`/vet-rule` has no Pass B.)

---

## 2. Evidence precondition, then mint ([STEP_MINT])

BEFORE minting, verify that the evidence is real, not self-asserted:
- the [RECORD] for THIS target exists;
- its `contentHash` equals the CURRENT normalized working-copy hash (nothing changed since vetting);
- `checkVerdict` is `converged`;
- the `check-reviewer` transcripts this panel produced **exist on disk** and were reviewer runs, not
  self-assertion. This harness persists every sub-agent transcript under this session's own folder:
  `~/.claude/projects/<project-slug>/$CLAUDE_SESSION_ID/subagents/` — one `agent-<agentId>.jsonl`
  plus an `agent-<agentId>.meta.json` sidecar per sub-agent. Locate the `subagents` dir robustly:
  read `$CLAUDE_SESSION_ID` via the Bash tool (it is not exported to the PowerShell tool), then find
  the `<project-slug>` folder under `~/.claude/projects/` that contains a `$CLAUDE_SESSION_ID`
  subdirectory — do NOT hand-derive the slug from a transform rule (the slug replaces every `\`, `/`,
  `:`, and space in the absolute working-directory path with `-`, so a naive "/ and spaces" rule is
  wrong on Windows and would send you to a nonexistent dir; listing the folder that actually holds
  your session id avoids the guess). First confirm `checkReviewerAgentIds` is present and
  **non-empty** — an empty array is itself a failing check, since a record citing no reviewer is not
  evidence, and a bare "for EACH" loop over it would otherwise pass vacuously and mint with no review.
  For EACH `agentId` in the record's `checkReviewerAgentIds`, confirm that both files exist, that the
  `.meta.json` reads `"agentType":"check-reviewer"`, and that the minimum `timestamp` across all lines
  of the `.jsonl` is **`<= draftedUtc`** (scan every line for its `timestamp` field and take the
  earliest — do not assume a fixed line position). The `agentType` match proves these were reviewer
  runs and the ordering proves the panel ran before the record was drafted.

Any check fails → REFUSE to mint; tell Erez what's missing/stale and re-run `/check` rather than
forcing it.

**`/vet-code` only:** also run the **Pass B model check** in
`C:/Users/Erez/.claude/skills/vet-code/reviews.md` before minting; it fails closed the same way.

Then mint the **[PASS]** — a JSON file in `[PASS_DIR]`:

```json
{ "kind": "[PASS_KIND]", "target": "<abs path, lowercased>", "expires": "<now + 15 min, ISO-8601 UTC>" }
```

Mint with the Write tool (clear path + content). This dir is OUTSIDE `~/.claude`, so the write
prompts Erez — that prompt IS the gate. **`/vet-rule` only:** you MUST show him the check-record's
converged verdict + finding count inline in the same moment (not a bare file-write dialog), so his
approval is of a review outcome, not a rubber-stamped file write. One pass per target; a multi-target
change needs one each. Get the timestamp from a read-only
`(Get-Date).ToUniversalTime().AddMinutes(15).ToString("o")` immediately before writing.

---

## 3. Apply ([STEP_APPLY]) — one write per target

**The whole coherent change MUST land in ONE write per target; never split it across a sequence of
`Edit`s.** The [PASS] is **single-use** — it authorizes ONE gated write to the target and is consumed
on that write (the hook gates per tool CALL, not per sub-edit): the first `Edit` consumes it, every
later `Edit` — including a revert of the first — is then re-blocked, stranding the file half-applied.
A change touching more than one non-adjacent region must therefore land in ONE call, not a series of
`Edit`s — prefer a full-file channel (`-ContentFile`, or a full-file `Write`), which needs no fragment
matching and cannot leave a region unmatched. **`/vet-rule` only:** a single `MultiEdit` call also
consumes just one pass and is acceptable.

**Whenever the apply is a full-file write, prefer `-ContentFile` over a re-typed `Write`.** `[GUARD]`
matches a pass by TARGET only — it never compares content — so a `Write` whose body drifted from the
reviewed working copy is approved by the gate and installs unreviewed bytes; only [STEP_VERIFY]'s
hash re-read catches it, after the pass is spent. `-ContentFile` copies the hash-verified file, so
what lands is the reviewed bytes rather than a re-typing of them. Do not weigh whether the file is
"small enough to re-emit" — that judgement is itself the failure mode.

The `-ContentFile` command is `update-config.ps1 -File "<literal absolute path>" -Op write-file
-ContentFile "<working copy>"`, as one line: it byte-copies the hash-verified working copy, the gate
resolves the literal `-File` path to the same normalized key the pass is bound to, and the pass is
consumed. It must be a LITERAL path: a `$env:`-style or variable form is not resolvable by the gate,
so it yields no target and falls through unconsumed while PowerShell still writes the file. This route
modifies an existing file only — it aborts before writing if the target does not exist. The hook finds
the matching pass, consumes it (renames `*.consumed.<ts>`), and approves — no second prompt.

**Issue the gated write as a SINGLE LINE.** Since GEN-641, a gated write the hook cannot read with
certainty is REFUSED outright (`exit 2`, pass untouched), not deferred to a prompt — and `[GUARD]`
cannot read a multi-line command (it scores it `MULTILINE`). So a *multi-line* `update-config.ps1`
apply, even a correct unchained one, does not go through at all: the call is blocked and its pass is
neither looked up nor consumed. A trailing exit-code capture or a follow-up check on the same line
makes the command multi-line — issue anything like that as its own separate tool call. A one-line
`update-config.ps1 -File <name> -Op write-file -ContentFile <path>` (or a single Edit/Write tool call)
is consumed cleanly. Do not spread the apply across multiple lines or a `$var =` preamble. (The MULTILINE check scores only shell
`command` text, so this applies to a SHELL apply such as `update-config.ps1`; an
`Edit`/`Write`/`MultiEdit` tool call is not `command` text and is not scored `MULTILINE`, though it
still must be a single tool CALL per the one-write rule above.)

**`/vet-code` only — the channel.** Apply via **the gated channel — this is the ONLY sanctioned apply
path** — for the concurrency-locked files (`auto-approve.js`, `notion-ticket-lookup.ps1`,
`settings.json`) that means `update-config.ps1` (`-Op write-file` from the verified working copy, or
`text-replace`); for any other hook or script, either a direct Edit/Write tool call or that same
single-line `-ContentFile` command. Apply all fields/targets of one logical change without leaving it
half-applied.

**`/vet-code` only — do NOT apply via a shell copy/move** (`Copy-Item`/`cp`/`mv`/etc.). Two reasons:
(1) it is not the gated channel — for a copy that CREATES a new protected file (or otherwise carries
no pass the existing-file `enforceVetting` path matches), GEN-562's `enforceCopyMoveFailClosed`
hard-blocks it; for a copy onto an EXISTING protected file that happens to carry a valid pass,
`enforceVetting` (which runs first) would approve+consume it — so a shell copy is at best redundant
with the tool path and at worst hard-blocked, never a reason to prefer it. (Note: "regardless of pass"
is NOT accurate — the block is the passless/new-file case; the point is a shell copy is unsanctioned,
not that it is universally impossible.) (2) historically (GEN-436) a shell-`cp` apply left the minted
pass UNCONSUMED and still valid until its TTL — defeating the single-use guarantee. The gated channel
consumes the pass; a shell copy does not.

**`/vet-code` only — definition of done for the apply (GEN-436 bar):** applying a vetted change can
NEVER leave a still-valid, unconsumed vetting pass behind (Step 8 re-confirms this). The gated
single-line channel enforces it by consuming the pass on approve. If a write ever lands WITHOUT
consuming its pass — e.g. a non-tool apply such as a shell copy (the multi-line case can no longer
reach this state: since GEN-641 it is REFUSED before it can write, per Step 4 and the SINGLE-LINE
note above) — **verified pass RETIREMENT is mandatory**: delete the still-live pass file and confirm
it is gone (a `*.json` still present in `~/.claude-staging/vetting-passes/` for this target = FAIL)
before reporting the apply complete.

**If a write nonetheless lands partially** and a follow-up is blocked, do NOT leave the file
half-applied: retire any still-live pass (`/vet-code`: per the paragraph above), re-mint
([STEP_MINT]), then re-apply the COMPLETE working copy as one write (prefer the `-ContentFile`
channel) to restore the vetted end-state. Re-minting costs Erez a second approval prompt — say so
plainly rather than reaching for a second `Edit`, which is blocked anyway.

---

## 4. Recovery (failure / expiry) ([STEP_RECOVERY])

- A consumed pass is gone — don't reuse it; re-mint (re-prompting Erez; `/vet-rule`: re-showing the
  verdict) and retry the single apply.
- If the working copy changed after the record was written, the `contentHash` won't match — re-vet
  rather than force it (`/vet-code`: re-run `/check`/`/code-review` as appropriate; `/vet-rule`:
  re-run `/check` on the new text).
- Break-glass: `CLAUDE_CONFIG_UNLOCK=1` (per-process, gone when the session ends, no token needed) or
  the `.config-unlock` sentinel skips the gate entirely (the same escape the concurrency, vetting and
  check locks use) — for recovering a wedged session only, never routine. The sentinel survives a
  session restart ONLY when a valid accountability token accompanies it — otherwise the GEN-462
  reaper deletes it at the next session start; open and close it with the OPEN/CLOSE commands below.

---

## 5. Break-glass OPEN/CLOSE commands (sentinel + reaper token)

Since GEN-462, a `.config-unlock` sentinel not accounted for by a valid token is deleted by the
`sessionstart-configunlock-reaper.js` hook at every session start. To open the break-glass so it
survives, create the sentinel and its token together (the token lives outside `~/.claude`, so
writing it prompts Erez — that visible prompt is what makes the open accountable).

Run each block as ONE PowerShell call, keeping the multi-line shape exactly as shown — never
collapsed to a single `;`-chained line — after first editing the three leading assignments the OPEN
block calls out ("exactly as shown" refers to the shape; those three values are what you change).
The multi-line shape is load-bearing: the chain-guard in `auto-approve.js` hard-blocks a single line
that chains state-changing commands, while a multi-line command that touches no gated target — as
these do not, since the token and sentinel are not gated files — falls through to a normal permission
prompt, the accountability prompt this design wants. (This is a DIFFERENT path from the single-line
rule in the apply section above and in `/vet-code` Step 4's consumption assertion: there the target
IS gated, so since GEN-641 a multi-line command is refused outright, not prompted. Same word
"multi-line", opposite outcome, because of whether a gated target is involved.)

**OPEN** — first edit the three assignments to the actual use (plain ASCII; keep quotes and
backslashes OUT of the values — the block hard-stops if it finds either, since they would break the
token JSON; the reaper reads only `expires` — `flow`/`reason` are for a human reading the token
later): `$hrs = 1` for a brief same-turn recovery you will CLOSE before the turn ends; `$hrs = 24`
for a wedged-session recovery that must survive a session restart. If the token expires before you
finish, the sentinel is reaped at the next session start — expected and cheap; just re-run OPEN.

Caution: the token filename is fixed (`breakglass.json`), so two overlapping OPENs overwrite each
other's `expires` (and CLOSE deletes only that name). Rare for one operator — but don't nest opens:
close one before opening another.

```powershell
$hrs = 24
$flow = "manual"
$reason = "wedged-session recovery"
if ($flow -match '["\\]' -or $reason -match '["\\]') { throw "flow/reason must be plain ASCII with no quotes or backslashes (they would break the token JSON)." }
$d = "$env:USERPROFILE\.claude-staging\config-unlock-passes"
New-Item -ItemType Directory -Force $d | Out-Null
$exp = (Get-Date).ToUniversalTime().AddHours($hrs).ToString('yyyy-MM-ddTHH:mm:ssZ')
Set-Content -Path "$d\breakglass.json" -Value ('{"expires":"' + $exp + '","flow":"' + $flow + '","reason":"' + $reason + '"}') -Encoding ASCII
if (-not (Test-Path "$env:USERPROFILE\.claude\.config-unlock")) { New-Item -ItemType File "$env:USERPROFILE\.claude\.config-unlock" | Out-Null }
```

**CLOSE** — always delete BOTH files (a leftover unexpired token would account for ANY sentinel
during its window, weakening the reaper). The two `Test-Path` lines must both print `False` — if
either prints `True`, the delete failed (e.g. a file lock): surface it, don't assume closed.

```powershell
Remove-Item "$env:USERPROFILE\.claude\.config-unlock" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\.claude-staging\config-unlock-passes\breakglass.json" -Force -ErrorAction SilentlyContinue
Test-Path "$env:USERPROFILE\.claude\.config-unlock"
Test-Path "$env:USERPROFILE\.claude-staging\config-unlock-passes\breakglass.json"
```
