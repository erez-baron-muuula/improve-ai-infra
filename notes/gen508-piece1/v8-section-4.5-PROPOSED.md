> # ⚠ NOT NORMATIVE — a proposal awaiting Erez's approval, 2026-08-04
>
> **`design-converged.md` is the single normative document. This file is not.** It exists only because
> three `/check` rounds of work would otherwise have lived in a session-scoped scratchpad across a
> `/compact`. Nothing here has been applied to `design-converged.md`, whose §4.5 still carries the
> `[round 5 — do not build from this section]` box over gate 1 and gate 2.
>
> **Do not build from this file, and do not treat it as a second source of truth** — v7's own worst
> defect was exactly a two-document split, diagnosed and collapsed on 2026-08-03. On approval, this
> content is applied *into* `design-converged.md` (replacing §4.5, plus the wiring deltas listed at the
> end) and **this file is deleted**. If you are reading it and `design-converged.md` §4.5 no longer
> carries the do-not-build box, this file is stale — delete it.
>
> Its measurement provenance is `v8-measurement-scripts.txt` in this folder (ten scripts, bundled).

## PROPOSED — v8 replacement for §4.5, plus its wiring deltas  (round-3 text)

*Replaces §4.5 of `notes/gen508-piece1/design-converged.md` in full. `/check` rounds 1 and 2 both
returned REVISE from all three lenses; the round-by-round record is at the end.*

---

### 4.5 The raw REST/curl arm `[v8 — mechanism replaced]`

**Erez's decision, 2026-08-04: cover this surface in piece 1** (§4.0.1). His second decision, at the
end of the same session: **replace the mechanism** rather than patch it a sixth time.

**Why the mechanism changed.** Five `/check` rounds each found a different way a body reached Notion
that the record's hash did not cover, and round 5's holistic lens named the cause: v7 tried to
*understand an arbitrary shell command*. That requires having foreseen every channel a body or a URL
can arrive through — including two that are not in the command at all (curl's `.curlrc`, PowerShell's
`$PSDefaultParameterValues`). `auto-approve.js` already answers this class the other way, with an
**anchored recogniser for one exact invocation**, in three places:

| live precedent | line | shape |
|---|---|---|
| `isSafeSyncFromClaude` | `:334` | `^&\s+(['"])<literal script path>\1 -Direction From-Claude(…)?\s*$` |
| `isSafeNotionTicketLookup` | `:345` | `^&\s+(['"])<literal script path>\1\s+\d{1,6}\s*$` |
| `isSafeLoggateTouch` | `:358` | `^touch\s+"<two literal marker names>"\s*$` |

All three are anchored `^…$` over the whole trimmed string with **no `m` flag**, and `:343`–`:344`
states the property this arm relies on: *"^ and $ anchor to the WHOLE string, so an embedded newline
can't smuggle a second command past this check."*

`checkDueTargets` supplies the argument in prose rather than a fourth precedent — its recognisers are
unanchored substring matches (`UPDATE_GLOBAL_RULE_RE = /update-global-rule\.ps1/i`, `:1172`) and its
case 3 is a destination-pattern parse, so it is **not** an instance of the anchored form. What it does
supply is the reasoning, at `:1306`–`:1313`: a shell write's content "cannot be reliably reconstructed
from the command string", and *"a **successful but wrong** extraction fed to `isMechanicalFix` could
compare equal and fail OPEN."* That is exactly the failure v7 shipped five times.

**Why the obvious version of the replacement does not work, measured rather than assumed.** Round 5
proposed an anchored template over the *curl command itself*. Replayed against the corpus
(`measure-template.js`, 2026-08-04), that template matches **0 of 236** real raw-REST write commands.
The feature counts below come from `measure-idiom.js` over the same 236:

| feature of the 236 commands Part 4a's rule counts as writes | count |
|---|---|
| retrieve the Notion token from the Windows Credential Vault **inside the same command** | 234 |
| are 11 lines or longer | 176 |
| write the body file in the same command | 148 |
| parse the response in the same command | 200 |
| are a single line | **1** |

On this machine as configured there is no Notion-token environment variable, so a single-line curl
command cannot authenticate: the vault retrieval is four statements. **That is a property of the
current setup, not an impossibility** — a session-scoped token env var would make a curl-only template
viable with no new file, and it is **rejected** rather than closed, for three reasons: it would expose a
live token to every child process for a whole session, it needs its own setter mechanism, and it needs
two templates (Bash and PowerShell). Recorded this way deliberately: overclaimed closure is this
document's own recurring defect.

**The mechanism: one recognised invocation of one project-owned script; everything else refused.**

#### The script, in full, because the pin depends on the text and not on a description

`~/.claude/scripts/notion-rest-write.ps1`. Its **text is part of this design** — an earlier draft
specified it behaviourally and claimed a pinned hash would "close creation", which round 2 falsified: a
pin computed from a just-created file blesses whatever was created, and creation itself is silently
approved (`auto-approve.js:712`–`:713` with §2). The pin closes *changes*; only reviewing the text
closes the *initial* contents. So the text is here, the pin is derived from it, and §12 carries an
install assertion that the on-disk file's sha256 equals the value recorded with this design.

```powershell
# notion-rest-write.ps1 -- the ONLY route by which a raw Notion REST write may reach the API.
# GEN-508 piece 1. auto-approve.js recognises an anchored invocation of this script and binds a
# review record to {surface, method, url, sha256(body)}. This file's sha256 is pinned in
# auto-approve.js; a mismatch hard-blocks every gated REST write (reason rest-script-mismatch).
#
# MAINTENANCE INVARIANT: every parameter declared HERE must be REQUIRED by the hook's template, so an
# ambient $PSDefaultParameterValues entry can never bind one. (CmdletBinding's own common parameters
# -Verbose/-ErrorAction/... are exempt: none of them can supply a body, a method or a URL. Adding a
# script parameter of our own that is optional re-opens the channel.) Any change to this file must
# update the pinned hash in auto-approve.js in the same change.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('POST','PATCH','DELETE')] [string] $Method,
  [Parameter(Mandatory = $true)][ValidatePattern('^https://api\.notion\.com/v1/')] [string] $Url,
  [Parameter(Mandatory = $true)] [string] $BodyFile
)
$ErrorActionPreference = 'Stop'

# The hook owns the URL grammar. This script's own check is narrower in purpose: it refuses to be
# repurposed as a general HTTP client, so a future template change cannot turn it into one.
if ($BodyFile -ne 'NONE') {
  if (-not [System.IO.Path]::IsPathRooted($BodyFile)) { throw 'BodyFile must be absolute, or NONE.' }
  if (-not (Test-Path -LiteralPath $BodyFile -PathType Leaf)) { throw "BodyFile not found: $BodyFile" }
}

# Token from the Windows Credential Vault, never from the GATED command -- so no command the hook sees
# carries it and no reviewer transcript persists it. (It does land in this child curl process's argv,
# visible to a local process listing -- unchanged from today's inline-curl practice, and stated so the
# claim is not read as broader than it is.)
$vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
$cred  = $vault.Retrieve('claude-notion-token','claude-notion-token')
$cred.RetrievePassword()

# curl by ABSOLUTE path, so a profile-defined `function curl.exe` cannot shadow it, with -q FIRST --
# the only thing that stops curl reading %USERPROFILE%\.curlrc, which accepts `data = @file`.
$curl = 'C:\Windows\System32\curl.exe'
$curlArgs = @('-q','-sS','-X',$Method,$Url,
              '-H',"Authorization: Bearer $($cred.Password)",
              '-H','Notion-Version: 2022-06-28',
              '-H','Content-Type: application/json',
              '-w',"`nHTTP=%{http_code}`n")
if ($BodyFile -ne 'NONE') { $curlArgs += @('--data-binary', "@$BodyFile") }
& $curl @curlArgs   # response body + the HTTP= line land on the pipeline; no Write-Output (a profile
                    # function could shadow it) and no redirect
# NOTE for callers: curl without -f exits 0 on a Notion 4xx, so a non-zero exit here means a transport
# failure, NOT a rejected write. Read the HTTP= line to know whether the write was accepted.
exit $LASTEXITCODE
```

Each choice closes a channel that killed a v7 draft, and closes it **inside one small pinned file**
rather than in a grammar over arbitrary text:

- **`-q` first.** From this machine's own curl manual: *"If used as the first parameter on the command
  line, the curlrc config file is not read or used."* Round 5's finding 3 is closed by construction, not
  by scanning a command for `-q`.
- **curl by absolute path** (`C:\Windows\System32\curl.exe`, verified present; curl 8.19.0) cannot be
  shadowed.
- **No `-k`, and this is measured rather than inherited.** Every one of the 236 corpus write commands
  uses `-sk` or `-sSk`, and a round-3 lens was right to ask whether TLS verification actually works here
  before shipping a pinned script that omits it — if it did not, the one permitted route would fail on
  every call and the fix would cost a script edit plus a pin update. Checked directly, 2026-08-04:
  `curl.exe -q -sS -o /dev/null -w "HTTP=%{http_code}" https://api.notion.com/v1/users/me` returned
  **`HTTP=401`**, i.e. the handshake and certificate validation completed and Notion answered (a
  certificate failure produces no HTTP code at all). So `-k` in the corpus is habit, not necessity, and
  the script verifies TLS — which also means the token is not sent over an unverified channel.
- **The invocation carries `-NoProfile`**, so the script runs in a fresh process with no profile and an
  empty `$PSDefaultParameterValues`. That is why no ambient *PowerShell session* state can bend the
  script; the all-parameters-mandatory invariant is belt and braces. It is **not** a claim about the
  whole environment: a child process inherits environment variables, and curl honours `https_proxy`,
  `ALL_PROXY`, `CURL_CA_BUNDLE` and `SSL_CERT_FILE` regardless of `-q`. Those could redirect or
  re-trust the connection without touching the body; evasion rather than omission, no worse than
  today's inline-curl practice, and recorded rather than covered by a broader sentence.
- **`Invoke-RestMethod` / `Invoke-WebRequest` are not admissible as the client**, and this is a
  correctness exclusion, not a preference: a **caller's** ambient
  `$PSDefaultParameterValues['Invoke-RestMethod:Body']` binds a body the command text does not mention,
  and the hook sees command text, never session state. Verified locally, PS 5.1.26100.8875: with
  `$PSDefaultParameterValues = @{'Get-ChildItem:Filter' = '*.zzzz'}` set, a call passing only `-Path`
  returned **0** items against **2,746** unfiltered; `Invoke-RestMethod`'s `Body` and `InFile` sit in one
  parameter set (`__AllParameterSets`), so there is not even a parameter-set error to fall back on.

#### The recogniser

Anchored, whole-command, no `m` flag. **Inter-token separators are `[ \t]+` — space and tab only, never
`\s+` and not even `[^\S\n]+`.** Round 2 found that `\s+` matches a newline, so a newline-separated
invocation would satisfy an anchored whole-string match while both shells split it into two statements:
the write would never run, and a single-use record would have been minted and consumed for nothing.
Round 3 found the first fix incomplete — `[^\S\n]+` still admits `\r`, `\v`, `\f` and a non-breaking
space, none of which either shell treats as a token separator, so the same failure survived in a rarer
form.

```
^powershell(\.exe)?[ \t]+-NoProfile[ \t]+-ExecutionPolicy[ \t]+Bypass[ \t]+-File[ \t]+"<script>"
 [ \t]+-Method[ \t]+(POST|PATCH|DELETE)
 [ \t]+-Url[ \t]+"<url>"
 [ \t]+-BodyFile[ \t]+"<body>"[ \t]*$
```

- `<script>` — an **absolute** path, no `"`, `$` or backtick, accepted only if `normPath()` (`:732`)
  resolves it to `~/.claude/scripts/notion-rest-write.ps1`. Absolute is required for the same reason
  `<body>` is: `--ticket-hash-shell` has no payload `cwd`, so a relative path could let the skill and
  the hook resolve different files.
- `<url>` — `https://api.notion.com/v1/(pages|blocks|databases)` optionally followed by
  `/<32-hex-or-dashed-id>` and optionally `/children`. **No query string, no `$`, no backtick, no brace
  or bracket** — which also means curl's URL globbing can never expand one URL slot into several
  requests, with no need for `-g`. `/v1/comments` is **not** admitted, because `notion-create-comment`
  is scoped out of piece 1 (§4.0.1's table); the consequence, stated rather than left implied, is that a
  REST comment write has **no REST route at all** and must go through the MCP tool.
- `<body>` — the literal `NONE`, or an **absolute** path with no `$`, backtick or `"`.
- `PUT` is excluded **as a choice**, not on a claim about Notion's API: no corpus write uses it, and a
  `PUT` therefore refuses, which is the safe direction. Endpoint families not listed refuse the same way,
  and the fix is a reviewed extension when a real write needs one — not a widening in advance.

**On the "house idiom" claim, corrected in round 1.** The *prefix* is this project's shape for calling a
locked script — `commands/loghistory.md:20` invokes `prepend-log.ps1` as
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "…"`, from the Bash tool. The **argument
convention is not**: that live line wraps every path in `$(cygpath -w "…")`, which the template's
no-`$` slots reject. So a Bash caller must pass a **literal Windows path**
(`"C:\Users\Erez\.claude\scripts\notion-rest-write.ps1"`, which survives bash double-quoting unchanged,
because backslash is only special there before `$`, backtick, `"`, `\` or newline). The refusal text
prints that literal form, and a fixture asserts a Bash-tool-issued literal-path invocation matches.

#### Two branches, and no third

- **Branch A — the command references the write script at all.** Triggered when the command contains the
  basename `notion-rest-write` (case-insensitive) **or** any whitespace-delimited token that `normPath()`
  resolves to the script. It must then match the template **exactly**, or hard-block
  **`rest-form-unrecognised`**. On a match, **the pin is checked first** — before the slots, the body read
  and the exemption — because the exempt lane returns without a hash and would otherwise let a GEN-58
  append run under a modified script, which is precisely what the pin exists to prevent. Then extract
  `{method, url, bodyFile}`. This is the record path.
- **Branch B — otherwise** → run the detector. Not a detected Notion write → return, untouched. Detected
  → hard-block, with the class chosen below.

**Branch A triggers on the name anywhere, and that is load-bearing.** Round 1 found the earlier
"starts with the invocation prefix" version **fails open**, and all three lenses reached it
independently. Traced and then measured (`measure-round2.js` part D): for
`$r = powershell.exe … -File "…notion-rest-write.ps1" -Method POST -Url "https://api.notion.com/v1/pages" -BodyFile "…"`
the **live** detector returns false — `HTTP_CLIENT_RE` (`notion-schema-guard.js:131`) matches no token in
the invocation because curl now lives inside the script; `-BodyFile` does not match `BODY_FLAG_RE`
(`:134`, `-Body\b` fails before `F`); and POST is absent from both hard write-verb patterns (`:138`,
`:139`). Under `bypassPermissions` a not-detected command is a **silent approve**, so a page create —
filing a ticket, the headline operation this gate exists for — would have executed with no record. The
same held for a `cd` prefix, a chained prefix, the `&` call-operator form both mirrored recognisers use,
and the dominant multiline idiom.

Two independent triggers now close it, in different places, which is why the combination is not
redundant: the **basename** catches the one shape no detector can see — PowerShell binds unambiguous
parameter prefixes, so `-M POST -U "…" -B "…"` carries no `-Method` token at all (measured undetectable)
— and the **dropped client-name gate** catches an invocation whose script path is obfuscated past
`normPath`, because `PS_METHOD_RE` (`:133`) *does* include `Post`, so with the gate gone the invocation
is detected on the soft signal plus a non-read URL.

Cost of the name-anywhere trigger, stated: a *shell* command that merely mentions the script — `cat`ing
it, grepping for it — hard-blocks. Clearable (the `Read` tool is untouched), and it is the direction this
arm prefers.

**The chain guard is deleted. What that changes, corrected in round 3.** An earlier draft said v7
"returned on `AMBIGUOUS`/multiline, which is a silent approve". That was wrong about v7's own arm: v7
hard-blocked **both** `CHAINED` (`rest-chained`) and `AMBIGUOUS`/multiline (`rest-chain-unreadable`) —
`:896`–`:899`, wired at `:1262` and `:1322`. The *returning* behaviour is `enforceCheckDue`'s
(`:1394`), which v7 explicitly diverged from. The correct statement is: the guard is **redundant** under
v8, not a repaired fall-through. An anchored whole-string template cannot match a chained or multiline
command, so branch A hard-blocks those; branch B hard-blocks every detected command regardless of
chaining; and a command the detector never sees was unaffected by the guard under v7 too, because v7 ran
`scanChain` *after* detection. Outcomes preserved, one mechanism fewer. **Do not restore it** — it would
add an `AMBIGUOUS` path this arm does not need.

#### Detection — one widening adopted on evidence, one rejected on evidence

The detector is copied from `notion-schema-guard.js` (`isNotionMutatingHttp` `:158`, `pathIsNotionRead`
`:144`, `NOTION_HOST_RE` `:130`, `HTTP_CLIENT_RE` `:131`, `WRITE_METHOD_RE` `:132`, `PS_METHOD_RE`
`:133`, `BODY_FLAG_RE` `:134`, `EXPLICIT_WRITE_VERB_RE` `:138`, `PS_WRITE_VERB_RE` `:139` — all re-read
2026-08-04). Copied, not `require`d: `auto-approve.js` is locked, and a gating-critical decision does not
belong in an unlocked file. Under v8 the detector only ever refuses, so a widening can only add refusals.

1. **The client-name gate (`:161`) is dropped entirely.** Measured over all **1,247** distinct shell
   commands mentioning `api.notion.com` (`measure-detector.js`): the live rule flags **242**, and
   dropping the gate flags **242** — **+0** — while it is what detects the canonical invocation for
   `-Method POST`, which the gated variant does not. **Recorded because it was a near-miss of the same
   class this section exists to end:** the round-1 draft kept the gate for the weaker body-flag signal,
   reasoning that dropping it could refuse a read carrying something like `grep -d`. That reasoning was
   wrong twice — the variant measured identical, and the false-positive class it was meant to prevent is
   **already realised 29 times under the live rule itself** — and the "refinement" opened the POST
   fail-open. The `+0` is historical-corpus-only and cannot speak to future traffic: going forward, a
   read-only command that mentions the host and carries a `-d`-family flag hard-blocks (class 3 below).
2. **Two native-call patterns are added** — `["']?method["']?\s*:\s*['"](POST|PUT|PATCH|DELETE)` and
   `\.(post|put|patch|delete)\s*\(` — because the existing write regexes match CLI-flag syntax only and
   would miss `node -e "fetch(u,{method:'PATCH'})"`. The first tolerates a quoted key so
   `{"method":"POST"}` matches. **They are split exactly as the CLI patterns are** (round-2 advisory): a
   native `PATCH`/`PUT`/`DELETE` joins the **hard** set, which bypasses the read allow-list; a native
   `POST` joins the **soft** set, which the read allow-list can veto — otherwise a `node -e` fetch to a
   `/query` **read** would hard-block. Measured +0 on the corpus, so the fixture asserts the patterns fire
   rather than claiming a measured gap — **and the fixture must encode the split**, because the
   measurement scripts do not: they place both native patterns in the hard set, which is a strictly
   *more*-detecting predicate than the one specified here. Every count below therefore comes from the
   more-detecting variant, and since that variant is a superset with an identical total, no count changes;
   what does change is that adopting the split extends §14's residual (b) to cover a **native** `POST`
   write whose first Notion URL is a read path, alongside the CLI `POST` case already recorded there.
3. **A third widening was designed, measured, and rejected.** `pathIsNotionRead` (`:146`) inspects only
   the **first** `api.notion.com` URL, so a body-bearing POST whose first URL is a `/query` read is
   classified read even if a later URL is a write. Requiring *every* URL to be a read path would close
   that — and flags **11 additional commands, every one of which is a read** (`verify-d3.js`): they pair a
   `/query` POST with a `GET /v1/blocks/<id>/children`, a read that is not on the POST-read allow-list.
   Eleven refusals of read-only work for zero real writes, so it is **not adopted**. The residual it would
   have closed has zero corpus instances and is recorded in §14. **The rule this establishes: a widening
   is measured before adoption, not after.**
4. **Coverage of the arm's detector against the write population is measured, not assumed**
   (`measure-round2.js` part A): of the 236 commands Part 4a's rule calls writes, the arm's detector
   misses **0**. A miss would be a silent approve, so this is the assertion that matters most.

**The corpus counts, and the correction that applies to all of them.** ~233 (Part 4's rule), 236 (Part
4a's rule, reimplemented in `measure-template.js`), 242 (the live rule = this arm's detector). Each is
attributed wherever it appears; none is retro-corrected. **29 of them are not writes** — Bash *read*
commands whose only write signal is `tr -d '\r'` matching `BODY_FLAG_RE`'s single-letter `-d`
(`measure-classes.js`, and `measure-falsepos.js` confirms all 29 are flagged by the live rule too, so
the detection is inherited). So the raw-REST **write** population is ~213.

**The arithmetic, spelled out because 236 + 29 > 242 otherwise looks like a contradiction:** the 29 are
not a set added to the 236 — at least 23 of them are *inside* it. Part 4a's rule treats a `-d`-bearing
command as a write unless a `/query` or `/search` URL appears, and a plain `GET` read carries neither, so
`tr -d '\r'` put those reads into the "236" as well. That is why every cost figure quoted against a
denominator of 236 includes some reads, and why the write population is ~213 under either rule.
§4.0.1's "~15% of write traffic" is therefore simultaneously **an overcount** by those reads and **a
floor** with respect to writes whose URL never appears in the command text — both are true, for different
reasons, and the section says both rather than replacing one word with the other.

#### The three refusal classes on branch B, discriminated by the write verb

Round 2 found the round-2 text specifying one predicate (URL-grammar admissibility) and measuring
another, and the mismatch inverted the advice for two real classes. The discriminator is the **method
flag**, not the URL:

| class | condition | measured, of 242 | reason and remedy |
|---|---|---|---|
| 3 | **no** method flag — the detector fired on a soft body flag | **29** | **`rest-signal-no-target`** — if this is not a Notion write, use the long form (`tr --delete '\r'`, verified working in this Bash); if it is, add an explicit `-X`/`-Method` and reissue via the script |
| 2 | a method flag is present, and **no** Notion URL in the command is both literal and template-expressible — an unadmitted family such as `/v1/comments`, a query string, or only `/query`-style read URLs — **and** no URL is interpolated | **3** | **`rest-template-cannot-express`** — use the MCP tool, or extend the template and the script (a reviewed change). **This is the over-gating signal §10 watches** |
| 1 | **otherwise** — a method flag with a template-expressible literal URL, or with an interpolated URL | **210** | **`rest-not-via-script`** — reissue as the canonical invocation; where the URL is a variable, substitute the literal page id, because the reviewer must be able to see which page is written |

The classes are listed in evaluation order, and class 1 is the `otherwise` branch rather than a
condition of its own — a round-3 lens found the earlier ordering described class 1 as a positive
condition while the implementation assigned it in an `else`, so a command the two descriptions disagreed
about would be given a remedy that cannot be satisfied. Class 2's condition must **not** exclude read
URLs before deciding "no expressible URL": a command with a hard write verb whose only literal Notion
URLs are `/query` paths belongs in class 2 (whose remedy is the MCP tool), because class 1's remedy —
reissue as the canonical invocation — is unsatisfiable for a URL the template refuses, and would send the
caller round the loop `rest-not-via-script` → `rest-form-unrecognised` → `rest-not-via-script`.

An interpolated URL is class 1, not class 2: it means the *caller* wrote a variable, and the fix is a
substitution — not that the template is too narrow. Getting that wrong is not hypothetical: the first run
of `measure-classes.js` treated an interpolated URL as inexpressible and put **127** commands in the
over-gating bucket, which would have made §10's only over-gating signal fire on more than half of all
traffic from day one and told Erez to loosen the template when nothing was wrong with it.

**Two properties of this classification that matter more than its accuracy.** First, **every class
hard-blocks** — the class selects only the refusal text and the monitor row, so a misclassification can
never open a hole. Second, the discriminator is textual and cannot associate a verb with a particular
URL, so a command mixing a `/query` POST with a non-read URL can land in class 1 or 2 while being
read-only; measured at **1** command, and the refusal names the tokens it matched so the reader can see
why.

#### The exemption, now over slots

Exempt iff **all** hold:

1. `method` is `PATCH` or `POST`;
2. `url`'s path is exactly `/v1/blocks/<id>/children` — the append-children endpoint, i.e. the REST form
   of a log append;
3. `<id>`, lower-cased with dashes stripped, is the hardcoded GEN-58 page id or a valid line in the
   exemption file (§5.1 clause 1). §5.1 defines those lines as "exactly 32 hex characters" with no case
   normalisation, so an upper-case line would not match — safe direction (it gates), stated so it is not
   discovered later;
4. the body file **parses as JSON** and none of the **keys** `archived`, `in_trash`,
   `allow_deleting_content` appears anywhere in it. Keys, not a substring scan: GEN-58 write-ups routinely
   contain the *word* "archived" in prose (this document does, at `:1967`), so a substring test would gate
   ordinary log appends. A body that does not parse as JSON is not exempt — also the safe direction.

Round 5's finding 2 is closed structurally: the template guarantees **exactly one URL with a literal id
in a known slot**, so "every id is exempt" cannot be satisfied by the empty set, a second `-Url` cannot
match the template, and the `32-hex` vs `32-hex-or-dashed` asymmetry disappears because one
normalisation runs once, in one place.

**The exemption is checked *after* the template match**, so a GEN-58 log append over REST must also use
the canonical invocation. Deliberate: the alternative is an exemption lane reading raw command text, the
mechanism being deleted. Small in practice — the prescribed route for a log append is the MCP
`insert_content` tool, which has its own exemption (§5.1) and is untouched — and a refusal here is a
self-correcting reissue, not a pause, so the standing "log immediately, no approval pause" rule is not
touched.

**The exemption file's own failure modes get their own reasons on this path** — `exempt-list-overflow`
and `exempt-list-unreadable`, exactly as §7 step 3 wires them for the MCP path. v7 left the shell path
reading that file with no reason of its own, so an unreadable or over-cap list would have inherited
`internal-error`, which §10 reserves for arm bugs.

#### The binding

```
contentHash = sha256Hex(stableStringify({ surface: "notion-rest",
                                          method:  "<METHOD slot, upper-case>",
                                          url:     "<URL slot, verbatim>",
                                          bodySha: "<sha256Hex of the body file bytes, or null>" }))
```

**Bound:** the surface tag, the method, the URL verbatim, and the body bytes via their digest — and,
because the script takes exactly three mandatory parameters and nothing else, everything else in the
request is fixed by the script file. **Not bound by the hash:** the client, the headers, the
`Notion-Version`, the token/workspace, the script's own code, and the identity of the body file and the
script at execution time. Those rest on the pin and on `enforceVetting`, not on the hash. `surface` is in
the hash input, so a REST hash cannot collide with an MCP payload hash — a different thing from the
record's diagnostic `surface` *field*, which §6.1 says is never matched on.

`bodySha` is a digest rather than the bytes because the binding is identical and the hash input stays
small. A missing, unreadable or over-cap body file (shared 2 MB) is a hard block, reason
**`body-file-unreadable`**; nothing truncates.

#### The script pin, and exactly what it does and does not close

**The pin:** the script's sha256 is a constant in `auto-approve.js`, and the arm hard-blocks
(**`rest-script-mismatch`**) when the on-disk file does not match. One ~40-line read, no subprocess,
inside the 250 ms budget (§7.2).

**The pinned value is computed from the code block in this document, not from the file on disk** — and
that direction is the whole point. Derived the other way round, §12's install assertion would compare
the created file against a hash taken from the created file and pass unconditionally, so a script created
with `-q` dropped would verify clean and the closure that the initial contents now rest on would be
vacuous. **Where the pin is computed and how a mismatch is diagnosed, since branch A blocks the obvious
route:** `Get-FileHash "…\notion-rest-write.ps1"` contains the basename, so it hard-blocks once the arm
is live. Two routes exist and are named rather than left to be discovered — the install fixture
(deliverable 8, which computes the digest as part of the assertion), and `configUnlocked()`'s break-glass
(§7 step 1), which skips the arm entirely. Both appear in the `rest-script-mismatch` escape.

**What it closes:** post-install modification by any mechanism, delete-and-recreate, and any write that
slips past `enforceVetting`. That last one is not hypothetical: `enforceVetting`'s header describes
target-centric protection by any mechanism (`:705`–`:713`), but `vettingTargets` (`:873`–`:938`)
recognises only `update-config.ps1`'s `-File` plus four destination patterns and states at `:931`–`:935`
that an unrecognised write mechanism falls through to a normal permission prompt — which under
`bypassPermissions` is a silent approve. The pin is what actually covers that gap, and `Remove-Item` is
absent from those destination patterns, which is why delete-and-recreate needed covering at all.

**What it does not close, stated because an earlier draft claimed it did:** (a) the *initial* contents —
creation is silently approved and a pin computed from the created file blesses whatever was created, so
the initial contents are covered by **the reviewed script text above plus §12's install assertion**, not
by the pin; (b) the check-to-execution window — the hook reads and hashes the script at decision time and
the script runs afterwards, exactly as open as the body-file window, so **the script joins the body file
in §14's TOCTOU residual**.

What *is* inherited: once the file exists, `PROTECTED_FILES` (`:200`–`:206`) hard-blocks direct
edit-tool writes to it, giving the same two-lock composition `auto-approve.js` and
`notion-ticket-lookup.ps1` already have (`:715`–`:719`).

**One operational fragility, disclosed:** the file is Drive-synced and git-committed, so a CRLF↔LF
normalisation in transit silently breaks the pin and blocks every gated REST write. Fail-closed with a
named reason, so it is a cost and not a hole — the install step records which byte form is hashed.

#### Reasons and escapes — seven rows, eight reason strings, clearability stated per row

(`exempt-list-overflow` and `exempt-list-unreadable` share a row because they share a remedy; §10's
reason set lists both, so the two counts are stated here rather than left to disagree.)

| reason | what fired it | escape | clearable by rewriting? |
|---|---|---|---|
| `rest-not-via-script` | class 1 above | reissue as the canonical invocation, with a literal page id | yes |
| `rest-template-cannot-express` | class 2 above | the MCP tool, or a reviewed extension of the template **and** the script | **no** — a reviewed change |
| `rest-signal-no-target` | class 3 above | the long-form flag, or an explicit method plus the canonical invocation | yes |
| `rest-form-unrecognised` | a script reference that is not the exact template — extra token, missing or abbreviated parameter, wrong order, interpolated or relative path, newline separation | reissue exactly as printed | yes |
| `body-file-unreadable` | body file missing, unreadable, or over 2 MB | fix the path, **or the file** | partly |
| `rest-script-mismatch` | on-disk script ≠ pinned hash | restore the script, or update the pin through the locked-edit path; compute or diagnose the digest via the install fixture or under `configUnlocked()` break-glass, since `Get-FileHash` on that path carries the basename and branch A blocks it | **no** — a repair |
| `exempt-list-overflow` / `exempt-list-unreadable` | the GEN-58 exemption file is over cap or unreadable | manual; nothing auto-prunes (§5.1) | **no** |

**All of these fire before a hash exists**, so §7 step 4's "every block carries a matchable hash"
guarantee is scoped to the MCP path and to `unreadable-payload`. Round 5's finding 5 — that v7's gate-1
refusal was, by §7.1's own table, "Not a record path" — is therefore **narrowed, not closed**: three of
the seven are not clearable by rewriting, and the table says which.

#### What it costs, measured rather than inferred

- **210 of the 242 detected commands are writes that must be reissued** as the canonical invocation, and
  the arm's detector misses none of the 236 Part-4a writes, so this is a measurement rather than an
  inference.
- **The read side breaks too, and this is a cost the round-2 draft hid behind the word "inherited".**
  The *detection* of the 29 `tr -d` read commands is inherited from the live rule — but the live rule
  emits `ask`, which this arm's own §2 shows is inert, so **all 29 execute today and would hard-block
  under v8**. They are the standard Bash Notion **read** idiom, and raw curl for reads is the currently
  recommended, currently ungated path. The fix is one token (`tr --delete '\r'`), and it goes into the
  same three instruction surfaces below.
- **3 commands have no canonical route at all** (class 2) and must use the MCP tool.
- **The rewrite is not a one-off, and the instruction surfaces are ship blockers rather than
  follow-ups.** Three live surfaces prescribe `--data-binary "@$bodyFile"` for Notion REST bodies:
  `hooks/refs/notion.md:15`, `skills/notion-howto/SKILL.md:21`, `skills/shell-howto/SKILL.md:30`. The
  first is **hook-injected on every Notion-mentioning turn**, so it is re-taught fresh every session;
  until all three change, every raw-REST write begins with a refused command **forever** and the
  migration cost never amortises. They join deliverable 11 as `/vet-rule`-gated edits that must land
  **before or with** the arm, with the carve-out stated precisely — the `--data-binary "@file"` guidance
  stays correct for Notion **reads**; a **write** uses the canonical invocation, whose literal line each
  surface gains — plus the `tr --delete` switch. Two of the three carry a second passage
  (`hooks/refs/notion.md:29`, `skills/notion-howto/SKILL.md:22`) describing a *prompt* on raw REST writes
  that §2 shows does not exist; bring the whole passage to reality, not only the cited line.
- **The body file moves to its own tool call** (148 of 236 currently write it in-command), and a response
  that must be machine-parsed costs **one extra tool call**, because a pipe into `ConvertFrom-Json` would
  break the anchor (200 of 236 currently parse in-command).
- **Read-then-write in one command stops being possible.** 63 of 236 also contain a Notion read, but in
  only **1** does the write textually reference a variable set at a read call site
  (`measure-readwrite.js`; a floor). So the window this opens is ~1 command in 236 and one tool call wide
  — materially smaller than the MCP-cache staleness (GEN-377) that is the documented reason raw REST is
  used for live-state writes.
- **Is this Option C by another route?** No, and the comparison is made rather than left implied. Under
  Option C the 8 measured writes with no MCP equivalent — 5 `DELETE /v1/blocks`, 2 `POST`/body
  `/v1/databases`, 1 `PATCH /v1/databases` (Part 4a) — would be strandable with no route, and the
  documented reason for using REST (a write decided from a read that must not come from the MCP cache)
  would be lost. Under v8 each of those has a working route: one canonical invocation plus one review.
  The exception is `/v1/comments`, which has no REST route by choice.

#### What this deletes and adds

**Deletes from v7:** gate 1 in full (the every-token rule, the recognised-client clause, the URL clause,
the thirteen-item body-less flag list, the three structural clauses); gate 2 in full (the four-row
flag-convention table, the four-form qualifying-argument test); the chain guard and its two reasons; and
the command-text half of the token clause. **Adds:** one ~40-line script (text above), one anchored
recogniser, one sentinel value, one pinned hash, and one `PROTECTED_FILES` entry.

**A smaller variant, considered and rejected.** Collapse the three slots to one — `-Spec "<abs path>"`
naming a JSON file holding `{method, url, body}` — hashing that file's bytes. **Rejected on the stronger
of two arguments:** it moves the method and the URL *out of the command text*, so they leave the
template-match binding and join the body inside the execution-time TOCTOU residual — a spec-file swap
between the hook's decision and the script's read could redirect a reviewed body to a different page, or
turn a `PATCH` into a `DELETE`. Under the three-slot form both are fixed at decision time. (The weaker
argument, that the hook would still need the method and URL before hashing so the same validation would
run in two files, also holds.)

**The token never appears in a gated command, so v7's safety clause narrows.** The invocation has no
token slot, and a command carrying a literal token cannot match the template. What remains is that the
**body file** is shown to the reviewer and therefore persisted in a transcript, so `/vet-ticket` still
refuses when the *body* contains a literal Notion token (`ntn_`/`secret_`). The command-text half is
deleted as structurally impossible.

**The normaliser is untouched.** The JSON walker never sees shell text; this path assembles its own
four-field hash input and shares only `stableStringify` and the digest.

**`notion-schema-guard`'s shell arm stays where it is** — it emits `ask`, inert under
`bypassPermissions`, so it neither helps nor conflicts, and it is the only mechanism that would resume
working if a genuine prompt were ever restored (§14).

**The residual that must not be closed by widening, kept from v7 because §12 cites it.** A Notion write
whose URL never appears in the command text — because it lives inside a `.js`/`.ps1`/`.py` file the
command runs, **or because it is assembled from a variable set by an earlier command** — is invisible to
the detector. Extending the match to "the script file this command runs contains `api.notion.com`"
**must not be adopted**: it cannot distinguish a read from a write inside a script, and
`scripts/notion-ticket-lookup.ps1` performs Notion REST *reads* on an ordinary ticket lookup, so the rule
would gate a routine read every time a skill resolves a GEN id. Piece 2 owns it. **v8 makes this sharper,
not looser:** the canonical script is itself exactly such a file, and it is admitted **by name and by
pinned hash** — one audited exception rather than an open category.

---

### Wiring deltas (everything else in the document that changes)

| location | change |
|---|---|
| **`:1` title** | "v7" → "v8". |
| **`:17` (v7 summary table)** | says §4.5 "binds the record to the command text plus every referenced body file" — false under v8. Replace with the four-field binding. |
| **`:37`–`:38` + `:139`–`:143`** | the "NOT converged … gate 1 and gate 2 must not be built from … that choice is Erez's" banner is replaced by the v8 record: the choice was made, the mechanism replaced, the section re-reviewed across three rounds. |
| **`:734`–`:739`** | the `/vet-ticket` **block→page walk** requirement (for a REST target addressing a block, walk `GET /v1/blocks/{id}` → `parent` until the parent is a page, capped, exhaustion ⇒ full ticket review) is stated **only** inside §4.5, so "replaces §4.5 in full" would silently delete a normative deliverable requirement. It still applies — the template admits `/v1/blocks/<id>` without `/children` — so it is carried into §8 as a numbered skill requirement. |
| **`:896`–`:899`, `:1262`, `:1322`** | v7's chain-guard paragraph, its §7-step-3s wiring and its two §7.1 rows go with the guard. |
| **§6.1 (incl. `:1132`–`:1137`)** | `--ticket-hash-shell <command-file>` keeps its name and its extra non-zero-exit condition; its input is the canonical invocation line and its output the four-field hash; the `{shell, bodies}` formula at `:1133` is replaced. |
| **§7 step 3s** | rewritten to the two branches: A (name-anywhere → template → **pin check** → slots → body read → exemption → hash) and B (detector → one of three classes → return only when not detected). The pin check precedes the exemption, because the exempt lane returns with no hash. No `scanChain` call. `exempt-list-*` wired in. |
| **§7 step 4** | the shell path's pre-hash blocks are the **seven** in the reason table; step 4's matchable-hash guarantee is scoped to the MCP path and `unreadable-payload`. |
| **§7.1** | v7's five shell rows are replaced by the seven-row table above, with clearability per row. |
| **§7.1 install assertions** | the round-trip fixture asserts `--ticket-hash-shell`'s hash equals the arm's for a canonical invocation with a real body file, **and** that a Bash-tool-issued literal-path invocation matches the template. |
| **§8 (incl. `:1396`)** | "the drafted payload … is the command string plus any body file it references" becomes the four-field input; §8 also gains the block→page walk requirement carried out of §4.5. |
| **§10 reason set** | loses `rest-chained`, `rest-chain-unreadable`, `body-shape-unrecognised`, `body-source-unrecognised`; gains `rest-not-via-script`, `rest-template-cannot-express`, `rest-signal-no-target`, `rest-form-unrecognised`, `rest-script-mismatch`, and `exempt-list-overflow`/`exempt-list-unreadable` on the shell path. |
| **§10 raw-REST monitor row** | one reason → one remedy, with the **baseline proportions** so a rate has something to be read against: `rest-not-via-script` (210/242 at baseline) → callers and instruction surfaces, **not** an over-gating signal; `rest-template-cannot-express` (3/242) → **the** over-gating signal, extend the template; `rest-signal-no-target` (29/242) → a read tripping the `-d` pattern, switch to the long form; `rest-form-unrecognised` → caller error; `body-file-unreadable` → a path bug; `rest-script-mismatch` → investigate immediately. |
| **§10 coverage counter (`:1560`)** | its bar reads near-zero gated raw-REST writes as "the detector has stopped matching". Under v8 near-zero is the **expected** initial state, since every existing call site refuses until rewritten. Restate as template-matched writes **plus** `rest-not-via-script` blocks, so migration lag and detector failure are distinguishable. |
| **§12 row 4** | grows by the script, its reviewed text, its pinned hash and its `PROTECTED_FILES` entry; row count stays 14. Its "adds ~15% of write traffic" is corrected: v8 **refuses** that traffic until each call site is rewritten, and the ~15% is both an overcount (29 reads) and a floor (writes whose URL is not in the command). |
| **§12 deliverable 11** | gains the three instruction surfaces as `/vet-rule`-gated edits that must land **before or with** the arm, with the read/write carve-out, the whole-passage correction at `hooks/refs/notion.md:29` and `skills/notion-howto/SKILL.md:22`, and the `tr --delete` switch. |
| **§12 deliverables 8 and 9** | the script joins the fixture set; a new install assertion checks the on-disk script's sha256 equals the value computed from **this document's code block**; the no-subprocess assertion is restated as being about **the arm** — the script is a subprocess when it runs, but it runs after the hook has decided. |
| **§12 — a live end-to-end install verification** `[round 3]` | the round-3 additions assert a digest and exercise hook-side fixtures, but nothing proves the script can complete one real write. Blocking install step: run one canonical invocation end to end against a scratch Notion page, confirm the `HTTP=` line reports 2xx, and confirm the record was consumed. Without it, the arm could refuse every other route while the only permitted route has never been shown to work. |
| **§12 install steps** | the new script needs a `sync-baseline.json` entry and a Drive sync, or the config-health pass reads it as drift; its edit route is `update-config.ps1`'s literal-path branch, since it has no `$ManagedFiles` entry; and the install records which byte form (CRLF or LF) the pin hashes. |
| **§12.1 `:1710`** | its decision box states the corrected fact as "the hash covers the command text plus every referenced body file" — contradicted by v8's own binding. Replace. |
| **§12.1 `:1827`–`:1835`** | restates the coverage sentence *and instructs copying it into the GEN-508 ticket*; `:1830`–`:1832` records that this exact paragraph already carried an overstated coverage sentence once, for that exact reason. Update to v8's wording. |
| **§14 (`:1924`–`:1926`)** | the coverage sentence's **main** qualifier changes, not only its second exempt case: coverage is every Notion create/edit through the four MCP write tools **or issued through the canonical REST invocation**; everything else on the shell surface is refused, and §14 already says refused is not coverage. |
| **§14 residuals** | add: (a) a write whose URL never appears in the command text — inside a script the command runs, or assembled from a variable set earlier (piece 2); (b) a POST write, CLI **or** native-call, whose first Notion URL is a read path and which carries no explicit `PUT`/`PATCH`/`DELETE` verb (zero corpus instances; the native half is the cost of the hard/soft split above); (c) **the body file *and the script*** can change between the hook's decision and execution — a TOCTOU, evasion not omission, same stance as §14's second bullet; (d) `Invoke-RestMethod` is inadmissible by design, so a PowerShell-native client has no gated route; (e) a script invocation whose path text contains neither the basename nor a `normPath`-resolving token (a glob, an 8.3 short name, a concatenated path) **combined with** abbreviated parameters carries no detectable token — evasion rather than omission, and no instruction surface teaches such a form; (f) environment-variable channels curl honours regardless of `-q` (`https_proxy`, `ALL_PROXY`, `CURL_CA_BUNDLE`, `SSL_CERT_FILE`) can redirect or re-trust the connection without touching the hashed body. |
| **§14 (`:1932`–`:1937`)** | the install-split bullet says "the natural seam is hook + skill first, with the `/wrap` and `CLAUDE.md` edits as a second change". v8 **narrows that seam**: the three instruction-surface edits join `/wrap` Steps 1 and 3c as ship blockers, because without them the arm refuses both the taught write idiom and the taught read idiom. The seam is "hook + skill + the three instruction edits", or the arm does not ship. |
| **§4.0.1** | add the live-rule count (242) with its attribution, and the correction that 29 of the counted commands are reads — making the write population ~213 and "~15%" both an overcount and a floor, for different reasons. Part 4's and Part 4a's own numbers are left alone. |

---

### Review record

**Round 1** (three lenses, Opus, all **REVISE**): `a5520d958283913f5` (pre-mortem), `ae95f46cd9937bf80`
(holistic), `a71332e4fc961d056` (soundness).
**Round 2** (same three lenses, fresh agents, Opus, all **REVISE**): `a47f60f81c99f222e` (pre-mortem),
`ad9f126606f01dc55` (holistic), `a69167658feb1f4f9` (soundness).
**Round 3, the cap round** (same three lenses, fresh agents, Opus): pre-mortem **PASS**, holistic
**PASS**, soundness **REVISE** on one new finding. `aaeb67faf37333c26`, `a919b2c8d19b7f5fd`,
`a73f6211ea9d9e28a`. Every carried finding from rounds 1 and 2 was tagged **RESOLVED** by its own lens.

**Round 3's one open finding, resolved by evidence rather than by another revision** (which is what the
`/check` protocol allows when a finding rests on a checkable premise): the soundness lens noted that the
newly-normative script text drops `-k` while all 236 corpus write commands use `-sk`/`-sSk`, and that if
TLS verification failed here the single permitted route would fail on every call — expensively, because
the script's bytes are pinned. Its premise was that verification probably fails, which is why `-k` is
universal in the corpus. Checked directly: a `-q -sS` call with no `-k` to `https://api.notion.com/v1/users/me`
returned `HTTP=401`, so verification works and `-k` is habit. The script keeps TLS verification, the check
is recorded above with its provenance, and the lens's second ask — a **live end-to-end install
verification**, since nothing else proved the permitted route can complete a write — is adopted as a
blocking install step.

**Not run: a fourth round.** Three rounds is the cap; the finding above is closed on evidence and the
remaining round-3 items were advisories, all of which are folded into the text above (the `[ \t]+`
separator, the pin check moving ahead of the exemption, the pin being computed from this document rather
than from the created file, the pin-computation route, the class-ordering and class-2 correction, the
hard/soft split's effect on residual (b), the `-NoProfile` and token-in-argv scope corrections, the
`HTTP=`-line caller note, and four measurement-attribution fixes).

**The finding that mattered, found independently by all three round-1 lenses: the replacement's own
first draft fails open on POST** — the sixth instance of the recurring class, created by the fix, because
moving curl inside the script removed the token the detector needs. Fixed by the name-anywhere branch-A
trigger plus dropping the client-name gate, and **verified by measurement rather than by reasoning**. All
three round-2 lenses tagged it **RESOLVED**.

**Round 2's other outcomes.** Holistic tagged both its findings RESOLVED and, after a fresh from-scratch
search, judged the mechanism proportionate and found nothing smaller that meets the goals. Soundness
tagged its POST and house-idiom findings RESOLVED. Three things recurred or were introduced by the
round-1 fixes and are fixed here: the reason-classification predicate (specified one way, measured
another — now discriminated by the write verb and re-measured at 210/3/29 of 242), the claim that the
pinned hash "closes creation" and closes the script's TOCTOU (it closes neither; the script's text is now
part of the design and the script joins the TOCTOU residual), and a false account of what v7's chain
guard did (v7 hard-blocked `AMBIGUOUS`; the returning behaviour is `enforceCheckDue`'s). Two recurrences
of "the claim is broader than the fact" — the clearability sentence and the wiring table — are fixed by
enumerating rather than summarising: seven reasons with clearability stated per row, and every stale
statement given its own table row, including the two in §12.1 that land in the GEN-508 ticket.

**Advisories adopted in this round:** horizontal-whitespace-only separators (a newline-separated
invocation would otherwise match the anchored template, mint and consume a record, and never run the
write); the native-call patterns split hard/soft exactly as the CLI patterns are, so a `node -e` read to
`/query` is not hard-blocked; `<script>` required absolute; the read-side cost given its own bullet; the
`/v1/comments` consequence stated; the "+0" widening result scoped to the historical corpus; the CRLF/LF
pin fragility, the `update-config.ps1` literal-path edit route, and the `sync-baseline.json` entry
recorded as install steps; `enforceVetting`'s "any mechanism" claim corrected against `vettingTargets`
(`:873`–`:938`, falls through at `:931`–`:935`) with the pin named as what covers the gap; the `-Spec`
rejection re-argued on the stronger ground; §14 residual (a) widened to its real class; and `PS_METHOD_RE`
(`:133`) cited as the fact that makes the adopted fix work.
