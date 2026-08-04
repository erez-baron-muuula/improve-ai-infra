# GEN-508 piece 1 — code review findings (all 27)

**Provenance.** `/code-review` at max effort on 2026-08-03 over
`notes/gen508-piece1/auto-approve.working.js` and its docs: 10 independent finder angles
(5 correctness + 3 cleanup + altitude + conventions), one verifier per surviving candidate,
then a gap sweep. Four-plus angles converged independently on the worst items.

27 real defects survived verification. 15 went to the report panel (capped at 15); the other
12 were cut **by the cap only** and are equally real. This file is the durable copy — both
lists previously existed only in the review panel UI and a temp scratchpad.

Reviewer agent ids, for a future `/vet-code` Step 1b record: finders `a8ba802e6f032b513`,
`a3639fc8b1a12ea14`, `aaf71af160ac61d9c`, `a96f121dec2dcfd46`, `ab3d3840895cc0d79`;
sweep `a664d87fc3bd8928d`.

**Status key**
- `FIX` — in code that survives the redesign; must be fixed.
- `GONE` — the code holding it is deleted by the redesign.
- `CARRY` — the code is replaced, but the requirement behind the finding must carry into the
  replacement.
- `RESOLVED` — answered by the redesign itself, not by a code change.

Redesign context: the human-approval premise failed and was removed. The authoritative statement
of the new design is the rewritten premise section of `design-converged.md` in this folder (step 1
of the approved plan); until that rewrite lands, this file's finding 1 is the fullest account.

---

## Reported findings (1–15)

### 1. `RESOLVED` — the human-approval premise (auto-approve.working.js:1440)
*category: correctness · verdict: PLAUSIBLE*

The whole design rests on "the mint always prompts Erez and that prompt IS the human gate", but
the pass dir is covered by no permission rule, so under defaultMode "auto" the mint write may be
silently approved — letting Claude review, mint and consume its own pass with no human in the
loop.

> Verified from live settings.json: defaultMode is "auto", permissions.deny is empty, and NO
> allow entry mentions .claude-staging. The mint is a Write to
> `~/.claude-staging/ticket-passes/pass-*.json`: not in PROTECTED_FILES, not a protected code
> target, and isAutoApprovableEdit requires a PROJECT_ROOTS prefix it does not have — so main
> reaches `logDeferred(input); return defer()`. NOT introduced by this diff: the staging, vetting
> and check gates all rest on the same premise, so this is a pre-existing hole in four gates.
> What would confirm it: one observed mint attempt during live-verify.

**Outcome.** Confirmed and then some. Measured: every user turn runs under
`bypassPermissions`, and a PreToolUse hook's `ask` is *silently discarded* in that mode
(hook fed the exact payload returned `ask`; the same command then executed with no prompt).
The reviewer's suspicion that the comments conflated "auto" with "bypass-permissions" was
correct. **Resolved by removing the approval requirement entirely** — the gate now refuses
until a review record exists, which works in every mode. Also lands on GEN-281 / GEN-376 /
GEN-485, whose blocking still works but whose stated rationale is false.

### 2. `FIX` — pass-scan sits outside the fail-closed try/catch (:2287)
*correctness · CONFIRMED*

The pass-scan/consume/approve half of `enforceTicketVetting` sits outside the try/catch that
exists to fail closed, so a malformed pass file makes the hook exit with no permission decision —
a silent approve of the ungated write.

> A single file `junk.json` containing literal `null` is enough. `findPassInDir` does
> `try { pass = JSON.parse(...) } catch { continue; }` and then, OUTSIDE that inner try,
> `const exp = Date.parse(pass.expires || '')` — which throws TypeError on null. Executed in an
> isolated sandbox with scope 'in': UNCAUGHT TypeError escaping `enforceTicketVetting` entirely,
> no decision emitted. Contents `[]`, `"a string"`, `123` all correctly exit(2) — only null slips.

### 3. `FIX` — GEN-58 carve-out lost its command test (:2089)
*correctness · CONFIRMED*

Rekeying the carve-out from command names to subtree membership silently widened it from
append-only to every content command, so a whole-body wipe of the GEN-58 ticket — including
deletion of its child pages — is approved with no pass and no network call.

> The diff deleted `TICKET_APPEND_COMMANDS = new Set(['insert_content','insert_content_after'])`
> and its guard ("Append-only; a rewrite of that page is still gated"), replacing it with
> `if (allIn) return { scope: 'out' };` with no command test. Executed:
> `replace_content` + `new_str:""` + `allow_deleting_content:true` → scope "out", 0 calls.
> `allow_deleting_content` also deletes child pages — i.e. the rolled-over log volumes holding
> every reasoning-failure write-up. Erez authorised exempting content WRITES in the subtree;
> permission to delete the subtree is not a write within it.

### 4. `FIX` — `gen58Subtree` checks the cached flag before the tt test (:2006)
*correctness · CONFIRMED*

The 30-day `g58` flag is consulted before `tt`, so it functions as a long-lived NEGATIVE for
"is a Team-Tasks row" — precisely the stale-negative fail-open the cache's own comment says was
deliberately removed.

> `if (cachedPageFlag(id, 'g58') === true) return 'in';` sits above the tt short-circuit, and
> `cachePageFlag` preserves prior flags and prunes only by TTL, never clearing one. A volume that
> caches `{g58:true}` and later gains `tt:true` reads as exempt for up to 30 days. Executed with
> that cache state: scope "out", 0 calls. The TTL is justified by "a ticket stays a ticket" —
> true for `tt` (which only adds gating), false for `g58` (which removes it).

### 5. `FIX` — `ticketIsContentOnly` keys on the literal lowercase name (:1786)
*correctness · CONFIRMED*

Content-vs-property is decided from the single literal key `'properties'`, so any other spelling
widens the one exemption that returns out-of-scope on a confirmed Team-Tasks row — the only place
in the layer where an unrecognised key name *reduces* gating.

> `return !norm.keys.has('properties');` is the whole test; `norm.keys` holds exact names with no
> case folding. Executed: `Properties` → "out", `props` → "out", lowercase → "in". So a
> Priority/Text/Children write on the GEN-58 row is approved on capitalisation alone — and
> `Children` is the inverse-of-parent relation that silently re-parents pages. Contradicts the
> section header's claim that "no stage below reads a field path".

### 6. `FIX` — a malformed id is silently dropped when any valid id accompanies it (:2102)
*correctness · CONFIRMED*

`bad-target` fires only when the payload yields ZERO extractable ids, so a malformed target id
plus any valid id is silently dropped and the call goes out of scope.

> `ticketSplitIds` records nothing for a value that yields no id, so a malformed id leaves no
> trace and `if (split.pageIds.length === 0)` is never reached. Executed: `notion-move-pages`
> with `["3806e495-d07c-81b3-8e37-e21aded65", "<valid id>"]` → scope "out", 1 call — a silent
> approve of a move-out, which de-lists rows and drops every database property. The first element
> is the truncated uuid from the design's own corpus. The old code blocked this as
> `move:unparsable`.

### 7. `CARRY` — consume approves without verifying a matching entry was removed (:2202)
*correctness · CONFIRMED*

`consumeTicketPass` returns true — and so approves the write — without checking that an entry
matching this hash was actually removed, and the legacy single-target branch never compares
`contentHash` at all.

> `pass.targets = rest;` is reached whenever rest is non-empty, including when the filter removed
> nothing. Executed: `consumeTicketPass(file, 'aaaa')` against a pass whose only entry is
> `contentHash 'bbbb'` returned true and left the file intact. The legacy form with no hash
> comparison anywhere also returned true.

**Carry-over requirement:** the claim-by-rename machinery is being replaced by a plain `unlink`,
which deletes this code — but the new implementation must still refuse unless it removed a record
whose hash matches, and must compare the hash on every code path.

### 8. `FIX` — block verdicts never reach the record directory (:2275)
*correctness · CONFIRMED*

Every `scope:'block'` short-circuits before the pass directory is read, so
`unresolved` / `bad-target` / `no-target` cannot be cleared by a pass — contradicting the refusal
message and the skill, which both promise a mint as the escape, leaving break-glass as the only
route.

> `if (sc.scope === 'block')` returns before the consume loop, which is reached only for 'in'.
> On a 429, `ticketScope` yields `{scope:'block', reason:'unresolved', hash:<valid>}`; the refusal
> then says "mint on that basis" and the skill repeats "the escape is one review plus one mint —
> not break-glass". Minting a matching pass and re-issuing gives the identical block. The deleted
> code called `findTicketPassFile` for every target *including* unresolved ones. Distinct from
> the cpu-deadline finding, where hash is `''` — here the hash is present, correct, and unusable.

### 9. `FIX` — the stage-1 CPU deadline is spent by the carve-out's network calls (:2093)
*correctness · CONFIRMED*

The 2 s deadline is minted at the start of `ticketNormalise` but the carve-out spends two
subprocesses before `ticketMarkerScan` consults it, so ordinary latency turns the
highest-volume payload shape into an unrecoverable block no pass can satisfy.

> `ticketMarkerScan(norm)` runs AFTER the resolver loop, and checks
> `Date.now() > norm.deadline` (+2000 ms). The carve-out's two subprocesses are each allowed
> `TICKET_RESOLVE_PROC_MS = 5000` — 10× the deadline they must finish inside. Measured in a fresh
> sandbox per row so both subprocesses are paid as in the real hook: 0/300/600/900 ms → "in";
> **1100 ms → block/cpu-deadline**; 1500 ms → same. Live timings put PasswordVault at 240–420 ms
> and curl at 430–560 ms, i.e. 700–1000 ms typical — immediately below the cliff, so a cold start
> or VPN crosses it intermittently. `hash` is `''` here, so **no record can ever match**, and the
> refusal falsely claims the hash CLI will refuse too. Affects 1,043 of 1,313 corpus payloads.

### 10. `FIX` — a 404 from the narrower integration token blocks ordinary work (:1977)
*correctness · CONFIRMED*

Only HTTP 200 yields a resolution, and the internal integration token's share scope is narrower
than the MCP connector's OAuth scope, so pages the connector can edit but the integration was
never shared into return 404 → unknown → block, gating ordinary non-ticket work workspace-wide.

> `if (code === '200')` is the sole path setting `ok:true`; every other status → 'unknown' →
> block/unresolved. Measured against the live credential with a well-formed but unshared id:
> BLOCK(2) in 1.26 s on an ordinary non-ticket doc edit. The refusal blames a transient outage
> rather than a permanent share-scope mismatch that will never resolve on its own. Combined with
> finding 8, the only route through is break-glass. **Most likely finding to make the installed
> gate unusable in daily work.**

### 11. `FIX` — container-key ids are never resolved and fail open (:1861)
*correctness · CONFIRMED*

Container-key ids are skipped and never resolved, and the same `continue` also skips setting
`sawCandidateKey`, so a create whose parent names an unrecognised data source degrades to a
silent approve rather than a loud block — the only arm that fails open on an unknown id.

> Executed: `parent.data_source_id = "9999…"` (32 hex) → scope "out", 0 calls. The live
> `notion-create-pages` description states a database with more than one data source forces the
> caller to pick a specific `data_source_id` — so the day Team-Tasks gains a second data source,
> every ticket create is silently approved. The MAINTENANCE note describes this outcome without
> flagging that it happens silently, on the highest-value arm.

### 12. `FIX` — the GEN-58 volume rollover *create* is hard-blocked (:2086)
*correctness · CONFIRMED*

The carve-out is gated on `tool === NOTION_UPDATE_TOOL`, so creating the next log volume under
the GEN-58 page — which this same file says happens every ~25 entries — is hard-blocked and needs
a mint, the one write a standing rule requires to be immediate and pause-free.

> Executed: create with `parent.page_id = <GEN-58>` → scope "in" after 1 call, because
> `parent.page_id` is not a container key, so the GEN-58 id becomes a candidate page and resolves
> to the Team-Tasks data source. The design requires the carve-out to be keyed on the SUBTREE
> precisely because "the cost of getting it wrong is a hard block on a write a standing rule
> mandates be immediate". The one advisory that touched this case did not notice it is the
> rollover.

### 13. `FIX` — the sweep's fail-open detector cannot detect fail-opens (test-gen508.js:378)
*test-coverage · CONFIRMED*

All three excuse buckets are computed by calling the very functions whose fail-open they exist to
detect, so the headline assertion (0 unexplained out-of-scope verdicts across 1,313 payloads) is
structurally incapable of catching the bug class the sweep was built for.

> The create bucket excuses a create exactly when `ticketSplitIds` found no candidate key — also
> the signature of a create whose Team-Tasks parent the normaliser failed to see; its justifying
> comment assumes the thing under test. The housekeeping bucket is decided by
> `ticketIsHousekeepingOnly` itself. The gen58 bucket uses `ids.pageIds.every(...)`, and
> `[].every()` is **true**, so any update reaching 'out' with zero extracted ids is filed as a
> legitimate GEN-58 exemption. Concretely: drop the parent subtree from `walk`, re-run, and the
> sweep still prints UNEXPLAINED 0. **This sweep is the evidence the rebuild was justified on.**

### 14. `FIX` — envelope keys are asserted at every depth, not just at a real envelope (:1715)
*correctness · CONFIRMED*

`wrapperPos` is asserted for every `TN_ENVELOPE_KEYS` name at any depth and regardless of whether
it is a sole key, so an ordinary non-JSON string under a key literally named `data`, `raw`,
`input` or `arguments` hard-blocks the write with a reason and remedy that do not apply.

> The invariant the design relies on concerns the HOIST ("can only ever discard a sole root
> key"), but the same set is passed as `wrapperPos` at every level, and a non-parse there calls
> `bust('wrapper-unparsable')` → hard block. Executed: an ordinary `insert_content` payload with
> `"data":"n/a"` → block/wrapper-unparsable. The operator is told to "re-issue in the ordinary
> shape" for a payload that already is, and the hash CLI exits 3 — break-glass only. `input` and
> `arguments` were added despite the comment recording they never occur in the corpus, so they
> contribute only this block surface. Assert at the root and at a detected single-key envelope
> only.

### 15. `FIX` — every refusal points at a skill that is not installed (:2244)
*correctness · CONFIRMED*

Every refusal message and the `--ticket-hash` CLI direct the operator to a `/vet-ticket` skill
that does not exist on disk, so installing this arm before the skill makes every in-scope
Team-Tasks write unrunnable except through global break-glass.

> `~/.claude/skills` contains approve-ticket, audit-rules, check, config-health, content-review,
> document-feature, notion-howto, notion-ticket-lookup, review-design, shell-howto, staging,
> suggest, vet-code, vet-rule, wrap — no vet-ticket. The only unblock is `configUnlocked()`,
> which is also checked by three sibling gates, so the workaround disables four gates for the
> session. **Install hook and skill together.**

---

## Cut by the cap only (16–27)

Verbatim from the review's overflow notes. Ranked roughly by severity within each group.

### Correctness — false blocks

### 16. `FIX` — `ticketIdsIn` both-windows defeats the GEN-58 carve-out (:1845)
A URL-form volume id (`https://www.notion.so/Vol-3-<id32>`) dash-strips to a 33-char hex run, so
BOTH windows are emitted; the carve-out requires EVERY candidate to resolve `'in'`, the bogus one
404s, so the log write blocks. Verified: `ticketIdsIn` → `["336d6e495…4ab","36d6e495…ab3"]`,
verdict `in` (2 calls) instead of `out`. I introduced the both-windows rule this session; the
measured corpus has zero payloads that need it. Simplest fix: drop the leading window, or make
the carve-out tolerate a single unresolvable extra when another candidate is `'in'`.

### 17. `FIX` — housekeeping closed shape omits `icon`/`cover`/`is_skill`/`allow_async` (:1758)
`notion-update-page`'s schema says these can be set alongside any command. Verified:
`{page_id, command:'update_properties', properties:{Status:'Done'}}` → `out`, 0 calls; the same
payload plus `icon:'🚀'` with Notion down → `block/unresolved`. That breaks the stated invariant
that a housekeeping status change can never be blocked by an outage.

### 18. `FIX` — `ticketIdsIn` early-returns on canonically-dashed ids (:1835)
Discards a bare id in the same value. Contrived trigger, but it falsifies the comment at
1823-1824 ("Neither can produce an out-of-scope verdict") — a decoy id that resolves 200 to a
non-ticket parent yields `'other'` → `out`.

### Correctness — hygiene / observability

### 19. `GONE` — `.claim.<pid>.<ts>` never reaped on the survivors path (:2191)
Verified: after one consume of a two-entry batch the dir holds `orphan.json` plus
`orphan.json.claim.777.<ts>` containing BOTH original entries. Not replayable today only because
`findPassInDir` filters on `.json`. Grows unbounded; `cleanup-sweep.ps1` protects
`.claude-staging` so nothing reaps it. *Deleted with claim-by-rename.*

### 20. `FIX` — `execFileSync` omits `stdio` (:1942, :1968)
Child stderr is inherited, so a missing vault entry prints a PowerShell
`MethodInvocationException` onto the hook's own stderr, prefixing the exit-2 refusal text that
Claude has to act on. Fix: `stdio: ['ignore', 'pipe', 'ignore']`.

### 21. `FIX` — `ticketSeedIds` returns every non-container id (:2139)
A move payload carrying an incidental id under an id-ish key (e.g. `after_id` naming a GEN-58 log
volume) seeds a 30-day `tt` positive on it, and `gen58Subtree` short-circuits `tt → 'out'`,
silently revoking that volume's carve-out. Also: a move-in expressed as
`data_source_url: "collection://…"` (3 real corpus instances) never sets `containerTeamTasks`, so
it never seeds at all.

### 22. `GONE` — `claim-lost` conflates two different events (:2290)
The catch path in `consumeTicketPass` retires a claim it could not rewrite — destroying every
other unconsumed entry of the batch — and logs the same `claim-lost` as a benign race. That
falsifies the reader spec above `logTicketGateEvent` ("the write went through correctly") and
corrupts the re-evaluate bar ("if `claim-lost` is still zero after 50 gated writes, drop the
retry loop"), which will now be tripped by data-loss events. *Deleted with claim-by-rename —
but the event log's reader spec and re-evaluate bar must be rewritten for whatever replaces it.*

### 23. `FIX` — `isSafeTicketHash` is inert pre-install (:2353)
The regex requires the script path to end `auto-approve.js` and then equal `__filename`; while the
file is `auto-approve.working.js` it can never match, so `/vet-code`'s live-verify measures the
wrong thing and the carve-out first becomes active only once installed, unexercised. Verified:
`false` for the working-copy name, `true` for the installed name.

### Test coverage — the suite certifies the wrong thing

### 24. `FIX` — the prototype-pollution test tests nothing (test-gen508.js:246)
`__proto__:` in an object literal is a prototype setter, so the key never becomes an own property
and `walk` never sees it; A21 would pass verbatim even with plain `{}` instead of
`Object.create(null)`. The real hazard the guard prevents is *key swallowing*: with `{}`,
`out['__proto__'] = <obj>` sets the node's prototype and the key vanishes from
`Object.keys(norm.root)`, so stage 2's closed-shape check stops seeing it. A21c uses the
JSON.parse form but asserts only the scope verdict, never that the key survived.

### 25. `FIX` — the token-failure path is untestable in the harness (test-gen508.js:49)
The stub always returns a token and `TICKET_TOKEN_MEMO` is module-scoped, so "no token → every id
unknown → block" — the most likely real resolver failure — is asserted nowhere, and
`resolver.tokenCalls` is incremented but never read, so a regression that re-fetches the token per
id (8 subprocesses per call) would still pass 97/97.

### Doc / code disagreements that would mislead the next builder

### 26. `GONE` — the skill says `target` is free-form; the hook needs the page id inside it
`vet-ticket-SKILL.md:207` vs `auto-approve.working.js:2170`. `ticketPassExistsForIds` dash-strips
`target` and requires it to contain a 32-hex id, so following the skill's own advice ("the ticket
id, or `create in Team-Tasks`") permanently disables the `stale-hash` diagnostic. Test C5 passes
only because `mint()` uses the canonical form the skill just retired — so the suite covers a path
no real mint can reach. I introduced this disagreement this session. *Resolved by dropping
`target` matching entirely (hash-only).*

### 27. `FIX` — Step 8's post-write check FAILs on every successful filing
`vet-ticket-SKILL.md:254`. The ticket-record Step 4 writes lives in the same dir as a live
`*.json` naming the same target and hash, and nothing removes it, so "a still-live `*.json` pass
entry for this target ⇒ FAIL" fires every time. They differ only by `kind` and the absent
`expires`, neither of which Step 8 mentions. Same step still refers to a `consume-failed` event
the rebuilt code no longer emits.

---

## Tally against the redesign

> # ⛔ THIS TALLY IS STALE — 2026-08-04
>
> **`design-converged.md` §13 is authoritative for every finding's status.** The design collapsed on
> 2026-08-03 (the network resolver, the parent cache and both TTLs are deleted), and **8 of the 22 open
> `FIX` items dissolved with them**: findings **4, 5, 6, 9, 10, 20, 21, 25** are now `GONE`. The current
> counts are **14 `FIX` / 1 `CARRY` / 11 `GONE` / 1 `RESOLVED`**, and §13 gives the per-finding reason.
>
> Two corrections to statements made in-session that a reader might otherwise inherit: findings **11 and
> 16 do NOT dissolve** (11 is closed by a rule change — unknown container ⇒ block — measured at zero
> cost; 16 stays a `FIX` with zero corpus instances), and findings **17 and 18** survive with *reduced*
> harm, since both previously ended in a network-dependent block and now merely over-gate.
>
> The per-finding text below is unchanged and still accurate as a description of each defect. Only the
> table that stood here was wrong, and it is left visible with this box rather than silently rewritten,
> because a stale status table is exactly the propagation failure the design's own history is about.

The original table, as written 2026-08-03 and now superseded by `design-converged.md` §13:

| Status | Count | Findings |
|---|---|---|
| `FIX` | 22 | 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 23, 24, 25, 27 |
| `GONE` | 3 | 19, 22, 26 — code deleted by the redesign |
| `CARRY` | 1 | 7 — requirement must carry into the `unlink` replacement |
| `RESOLVED` | 1 | 1 — answered by the redesign itself |

The withdrawn claim: **"97/97 tests passing, zero fail-opens across 1,313 payloads" is not
evidence of anything** and must not be restated. Finding 13 is why.
