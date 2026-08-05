# GEN-508 piece 1a — build artifacts (REST arm parked 2026-08-05)

Working copies for the ticket-quality gate. **Nothing here is installed** — the live
`~/.claude/hooks/auto-approve.js` is untouched, and installing it goes through `/vet-code`.

**SCOPE, changed 2026-08-05: piece 1a is the Notion MCP surface ONLY.** Erez chose to install that
half first and defer the raw REST/curl arm (§4.5) to piece 2. The REST code is still in the working
hook but is **NOT WIRED** — nothing reaches it. Shipping it as built would have refused every raw REST
write with no working escape: its pinned script is not on disk, so the pin check fails for all of
them, and listing that script's path in `PROTECTED_FILES` blocked creating it. That is worse than the
pre-install state, in which the surface is simply unchecked. Read the NOT WIRED banner above §4.5
before touching it — it names the three things that must be true before reconnection, one of which is
a live fail-open (`restJsonKeys` stops collecting past its depth cap and then reports the body clean).

The authoritative handoff is the **"BUILD STATE"** section of
[GEN-508](https://app.notion.com/p/3a36e495d07c81fb9a55ddc315639c7f). Read that first; this folder is
the artifacts it refers to.

| File | What it is |
|------|-----------|
| `design-scoping-v3.md` | **Retired as a normative source** (2026-08-03, v6): it was merged into `design-converged.md`, because the two-document split was itself the defect three `/check` lenses diagnosed. Kept only for its §1 corpus-shape table and §3 measurements, which are cited from the design. **Do not build from it.** |
| `auto-approve.working.js` | Full working copy of the hook with the `enforceTicketVetting` arm, **rebuilt against design v8 on 2026-08-05, then narrowed to the MCP surface the same day** (§4.5 present but unwired). Purely additive against the live hook: 7 hunks, 1,603 lines added, **0 removed** — the narrowing removed only lines this change had itself added, so it deletes nothing live. **The 7th hunk (live `auto-approve.js:637`) is the only one that touches pre-existing code**, and it is an insertion, not a rewrite: a one-line guard in the shared `findPassInDir` before the original line, which is untouched. The second code review found that reader fail-OPEN on a pass file containing the literal `null` — see "Second code review" below. Passes `node --check`. **Re-based on the live hook of 2026-08-05 09:14** — it had changed mid-session (GEN-641's `blockUnreadableGatedCommand`), so an earlier copy would have silently dropped that guard; re-check for drift before any install. |
| `notion-rest-write.ps1` | The script that will be the only permitted route for a raw Notion REST write (design §4.5). **Deferred to piece 2 with the arm — it is NOT installed and its path is no longer in `PROTECTED_FILES`**, so piece 2 can create it. Its sha256 is still pinned in the hook. **LF line endings, no BOM** — a CRLF normalisation breaks the pin and blocks every gated REST write (fail-closed, reason `rest-script-mismatch`). Pin: `38897e5b4aa874ed…`, computed from the code block in `design-converged.md` §4.5, not from this file. Install it BEFORE re-adding its path to `PROTECTED_FILES`, not after. |
| `gen508-hook.diff` | The same change as a unified diff against the live hook, for review. Regenerated 2026-08-05. |
| `test-gen508-v8-arm.js` | **The suite that gates the install, and it must be GREEN: 63 assertions, 0 failing.** Runs the hook as a real PreToolUse process (JSON on stdin, exit code as the verdict). Covers the MCP surface, the `--ticket-hash` CLI, the full record path, latency, and three assertions that the REST arm really is unwired. **Not** the deliverable-8 rebuild: it has no fail-open corpus sweep. |
| `test-gen508-rest-parked.js` | The REST assertions, **parked for piece 2**: 25 assertions, of which **19 fail by design** while §4.5 is unwired. It exits 0 at exactly that baseline and non-zero if the number moves either way — fewer means someone rewired the arm and this file must move back into the suite above; more means something else broke. Failures here are NOT a regression. |
| `test-gen508-harness.js` | Shared harness for both suites (hook spawn, helpers, fixtures, cleanup). Extracted at the split so the two files cannot drift the way the housekeeping list once did. It also fixes the bug that made the old suite unrunnable: it spawned `working-v8.js`, a filename not in this folder, so every assertion failed at spawn. |
| `test-gen508.js` | The OLD behavioural suite, written against the pre-collapse layer. **Stale** — it exercises the resolver and cache the collapse deleted. Superseded pending the deliverable-8 rebuild. |
| `build-corpus.js` | Regenerates the payload corpus `test-gen508.js` part B needs. |
| `vet-ticket-SKILL.md` | Working copy of the new `/vet-ticket` skill (not yet installed at `~/.claude/skills/vet-ticket/`). **Realigned to the v8 hook contract on 2026-08-05**: it had still documented the v7 pass shape — a nested `targets[]` array, plural `reviewerAgentIds`, no `verdict`/`waived` on the pass, and no reviewer verdict token — any one of which would have hard-blocked every ticket write, leaving break-glass as the only route. The regression guard for the nested shape is now an assertion in the main suite. Still describes REST as out of scope, which is correct again under piece 1a. |
| `design-converged.md` | **Read this second, after the ticket — it is the single normative document for piece 1.** Currently **v8** (2026-08-04): §4.5's raw-REST mechanism was replaced after five rounds found the same class of hole five times, and the replacement went through three more `/check` rounds. Its own top box carries the review state. `v8-measurement-scripts.txt` beside it is the provenance for §4.5's numbers. |

## Running the tests

```bash
node test-gen508-v8-arm.js
```

**63 assertions, all passing, exit 0** — verified 2026-08-05 against the unwired hook, after the
third round of fixes. This is the suite that gates the install. It spawns the hook as a real
PreToolUse process, so what it tests is what will run, and it needs no corpus and no network.

Eleven of those are the second review's regression guards, in three groups:
- A pass file containing `null`, `[]`, `0`, `false` or `"str"` must REFUSE rather than crash. Only
  `null` ever crashed; the other four are there so a later narrowing cannot silently reopen them.
- A record whose `contentHash` carries the trailing newline `--ticket-hash` prints, or differs in case,
  must still APPROVE — the guard against the lockout the review's own first fix introduced.
- `duplicate-page` / `move-pages` / `create-pages` with a housekeeping-shaped payload must be GATED,
  and `update-page` housekeeping must STILL fall through, so the tool-scoping cannot be over-applied.

Twenty-five more are the **third** round's guards, in sections F–I (see "Round three" below): the
verdict token read from delivered text only and from the final message only; the sub-agent transcript
path; the real `content_updates[]` shape both ways (exempt when it is a log edit, gated when it empties
one); and the two refusal texts that named no usable fix.

**One assertion in this suite was changed rather than added, and that is the finding worth carrying:**
the GEN-58 exemption test used to send `{command:'update_content', old_str, new_str}` at the root — a
shape the live `notion-update-page` schema cannot produce. It was green on a payload the tool never
sends while every real GEN-58 log edit hard-blocked. An assertion over a fictional payload is worse
than no assertion: it reports coverage it does not have, and it is why this survived two review rounds.

```bash
node test-gen508-rest-parked.js
```

The 25 parked REST assertions, **19 failing by design, exit 0** at that baseline. Run it to confirm the
deferral has neither widened nor narrowed; it prints what to do if it has.

Both suites derive every path from the hook's own directory and clean up after themselves — the
fixtures, the fake session directory, and the repo-local `.claude-staging` the hook resolves two levels
up — so they can be run from anywhere. The parked suite additionally creates `notes/scripts/` with a
**copy** of the pinned script (the path the hook resolves for it) and removes it afterwards, so the pin
tests tamper with the copy rather than with this folder's own script, whose bytes the pin is taken over.

An earlier version of this section claimed 48 assertions all passing. The count was right — 38 + 25 is
63 today only because the split added four new assertions and the second code review added eleven — but
that run was not reproducible from the committed files, because the suite spawned a hook filename that
is not in this folder.

The rest of this section describes the **stale** suite (`test-gen508.js`), kept until the
deliverable-8 rebuild lands. It was written against the pre-collapse layer and exercises the resolver
and cache that no longer exist:

```bash
node test-gen508.js
```

That covered parts A (edge cases), C (pass round-trip) and D (the shared hash CLI) — 95 assertions.

**Part B is the fail-open detector and it needs the corpus, which is deliberately not committed**
(it contains ticket bodies). Regenerate it first — it reads `~/.claude/projects/**/*.jsonl`, takes a
couple of minutes, and writes `notion-payload-corpus.jsonl` beside itself:

```bash
node build-corpus.js
```

Then re-run `node test-gen508.js` and part B sweeps all 1,313 real payloads twice. What it asserts:
with the resolver stubbed to say *everything is a ticket*, no payload may come back out-of-scope
unless it is a housekeeping edit, a GEN-58-subtree content write, or a create with no page target.
Anything else in that bucket is a silent bypass — which is exactly how the two previous versions of
this layer failed, both times found only after the fact.

Last run: **97 passed, 0 failed**; 0 unexplained out-of-scope verdicts across 1,313 payloads.

## What changed when the REST arm was parked (2026-08-05, later the same day)

Five attachment points removed, so §4.5 became unreachable. All five sit inside the block this change
adds, so the diff against the live hook stayed **purely additive: 0 removed**. (The line counts in
this section were 1,558 across 6 hunks at the time of the parking; the second code review's fixes
took them to 1,581 across 7 hunks. Still 0 removed.)

- `enforceTicketVetting` no longer treats shell tools as in scope (`isShell` gone). That single change
  is what makes the whole arm unreachable; the rest close side doors.
- The `--ticket-hash-shell` dispatch under `main` is gone. `ticketHashShellCli` stays defined, so piece
  2 is a reconnection rather than a rebuild.
- `isSafeTicketHash` is narrowed to `--ticket-hash` on a `.json` payload. The `-shell` mode is
  deliberately not allow-listed: it would hand back a hash binding a record to a surface this build
  does not gate — "a record exists for a write nothing checked," which is what the gate exists to stop.
- `notion-rest-write.ps1` is out of `PROTECTED_FILES` (see its table row for the ordering rule).
- A NOT WIRED banner over §4.5, naming the three preconditions and the attachment points to restore.

Also corrected in that banner: §4.5 previously claimed raw REST "carries the ONLY destructive
operations in the surface." It does not. The MCP arm's move-out — which de-lists a row and drops every
database property — plus `replace_content` and `allow_deleting_content` are all destructive, and all
three ARE gated by piece 1a. The claim mattered because it was an argument for not deferring.

## What changed in the v8 rebuild (2026-08-05)

**Deleted, and must not come back:** the page resolver and its network call, the parent cache and both
its TTLs, the resolve budget, the `unknown` verdict, the batch `targets[]` array with its
partial-consumption machinery, the claim-by-rename rewrite, and the 3-attempt retry loop. The arm now
makes **no subprocess call and no network call on any path**. Cache seeding went with the cache, so the
second reviewer note below is moot and is kept only as the audit trail.

**Changed:** the housekeeping exemption is five fields, not ten (`Parent item`, `Due Date`,
`Remind me`, `Date Created` and `ID` are now substance); the GEN-58 carve-out reads a local id list
instead of asking Notion; every reason string now matches the design's derived set.

**New:** the verdict-token check — the arm reads the named reviewer's own sub-agent transcript,
assistant-authored records only, and requires the **last** `TICKET-REVIEW-VERDICT:` to read
`PASS <contentHash>`. Without it a record carrying `verdict: "REVISE"` cleared the gate, because that
field was written and read by nothing. And the whole raw-REST arm (§4.5): one anchored template over
one pinned script, three refusal classes, `--ticket-hash-shell`.

## Earlier: what changed in the scoping rebuild (2026-08-03)

The old layer read specific field paths from the published tool schema. Real traffic does not always
put the fields there, so two consecutive code-review rounds each found a fresh silent bypass of the
same class. The rebuild makes payload shape stop mattering: normalise the whole payload, then look for
a Team-Tasks id anywhere in it — with `ok = false` from the normaliser as a hard block, so no later
stage can claim "out of scope" without having read everything.

Two build-time decisions worth a reviewer's attention, because neither is spelled out in the design:

- **The content hash is now reachable as a CLI** — `node auto-approve.js --ticket-hash <payload.json>`
  — and `/vet-ticket` calls it instead of reproducing the formula. The design required the skill to
  use the same normaliser as the hook; that normaliser is ~100 lines, and a hand-rolled copy would
  drift, which is a failure whose only escape is break-glass. That invocation is added to the
  shell auto-approve list (it only reads a file and prints a hash), pinned to the hook's own
  `__filename` so a planted `auto-approve.js` elsewhere cannot ride the allow entry.
- **Cache seeding on create/duplicate is impossible, not merely unimplemented.** `design-converged.md`
  claims seeding happens "on every gated create/duplicate/move"; Notion assigns the new page's id
  server-side, so a create or duplicate payload has no id to seed. Only move-in seeds. The claim was
  wrong about what is possible, not about the code.

## Still open

**First `/code-review` is DONE** (2026-08-05, xhigh): 14 findings. Five are fixed — the four skill/hook
format mismatches and the stale batch-pass description. Nine remain open, of which these are the ones
that matter, and all three belong to the parked REST arm or its docs:

- `restJsonKeys` fails OPEN on its depth/node caps, so a destructive key nested past 12 levels is
  invisible to the REST GEN-58 exemption. The MCP walk hard-blocks on the same overflow. **Fix before
  reconnecting §4.5.**
- `/vet-ticket` documents no REST lane at all (no canonical invocation, no `--ticket-hash-shell` step).
- Nothing writes `ticket-gate-exempt-pages.txt`: the skill has no GEN-58 lane, so the exemption list
  stays empty and each new log volume needs a full review, against the standing "log immediately" rule.

**Second code review is DONE** (2026-08-05). Three cold reviewers, each blind to the first pass, to each
other, and to every document in this folder — they were given the diff, the working file, and the goal
verbatim, nothing else. **Procedural caveat: it did NOT run on the strongest tier.** `/vet-code` Step 3
requires Pass B pinned to the top model; that tier returned 529 Overloaded on five consecutive attempts
across the whole session, so the panel ran one tier down and was then re-run on Opus 5 at Erez's explicit
direction ("re-run the review on this model, and not the highest"). That is a deliberate, recorded
deviation from Step 3, not an oversight.

Three fixes applied and verified live:

- **`findPassInDir` failed OPEN on a pass file containing the literal `null`.** `null` is valid JSON, so
  the reader's own try/catch never fired and `pass.expires` threw a TypeError nothing caught — a non-2
  exit, which is not a refusal. The gated write went through, and would have kept going through on every
  gated call until the file was deleted by hand. Reproduced live (exit 1, no refusal), fixed, re-verified
  (refusal restored), and guarded by five new assertions. **This was PRE-EXISTING live code**, shared with
  the staging, vetting and check-due pass dirs, so the fail-open was live in three already-installed gates
  — including the one guarding this hook's own code. Fixing it here means the fix reaches the live hook
  only when piece 1a installs; a sooner fix needs its own `/vet-code`.
- **The matched record was trusted on a second read that never re-checked its `contentHash`.**
  `findTicketPassFile` matches on its own read and returns only a path. Now re-asserted. Defence-in-depth
  with no test behind it — the branch needs a concurrent rewrite of the same filename to reach, which a
  single-process suite cannot drive. Said so in the suite rather than implying coverage.
- **The wiring comment claimed the gate covers "the four MCP write tools AND raw REST/curl."** It does
  not — REST is unwired in piece 1a. That comment is what whoever wires piece 2 would have read.

**Open, and Erez's call — the waive lane.** Two reviewers independently flagged that a waive skips the
entire reviewer-verification block, which is by design (the skill documents it). What is NOT by design:

- `/vet-ticket` says the mint write into `~/.claude-staging/ticket-passes/` "prompts him", and calls that
  prompt the waive's "second, deliberate confirmation". **It does not prompt.** Verified against the live
  hook: that write falls through, and this design's own §2 established that a fall-through in Erez's
  permission mode is a silent approve. So the waive's second confirmation does not exist. This is a skill
  and doc fix, not a hook fix — and it is the same class as §2's original premise correction, reintroduced.
- The skill writes `expires` as now + 15 min, but the hook only checks `expires < now` — never an upper
  bound. A record with a far-future expiry is honoured indefinitely (verified: 2099 approves). The 15-min
  discipline is advisory, not enforced. A cap belongs in the hook, per the same "one definition, called by
  both" argument the design already makes for the hash.

Not fixed pending that decision, because both touch how a waive is justified rather than how it is read.

**Corrected from this review's own first write-up:** the cross-session waive-reuse risk was initially
graded CRITICAL on the reasoning that a leftover waive lets an unreviewed write through. That reasoning
was wrong — the record binds to the content hash, so a stale waive can only clear a write of the exact
content Erez waived. The harm is a duplicate write, not an unreviewed one. The severe finding in this
area is the phantom mint prompt above, which only surfaced on reading the skill.

**Also confirmed, and out of scope by the stated threat model:** all four pass directories are writable
with no gate at all (verified against the live hook, with a control proving the test valid). Minting
yourself a pass is deliberate evasion, which §1's threat model explicitly excludes. It is recorded here
because the design believed the dir being outside `~/.claude` bought a prompt, and it does not — so the
mitigation counted on is absent. Belongs in its own ticket about the shared pass mechanism, not here.

### Round two — re-run on Opus 5, and what it found

Erez directed the re-run explicitly: *"fix the confirmed defects now, then re-run the review on this model,
and not the highest."* So Pass B ran on **Opus 5**, not Fable 5. Per `notes/effort-model-reference.md` the
two are within ~0.5 pt on coding at half the cost, so this is a defensible reading of Step 3's
"strongest available" — but it is Erez's call on the record, not the skill's default.

**The tier difference was not marginal.** The Opus panel found nine findings the lower-tier panel missed
entirely, and caught **two defects in the lower-tier round's own fixes**. That is direct evidence for
Step 3's tier requirement; worth remembering next time capacity pressure makes a substitution look fine.

**Reviewer agent ids, for the `/vet-code` Step 1b / Step 5 evidence record.** All `check-reviewer`,
2026-08-05, session `1f35b63a-78f2-43e3-8dfd-21793f22dcc1`. Transcripts and sidecars persist at
`~/.claude/projects/C--Users-Erez-AI-Projects-Improve-AI-Infra/<session>/subagents/agent-<id>.{jsonl,meta.json}`;
each sidecar carries the `model` field, so the tier claim below is checkable rather than asserted.

| id | lens | model (from sidecar) |
|---|---|---|
| `aa5e9c37f8f8d62c5` | scope fail-open | `opus` |
| `a299c3235e0c8fa4e` | record forgery / replay / crash | `opus` |
| `a92a96d6f57ec0c3e` | premises + new surface | `opus` |
| `a79b10d4039d7d7e6` | scope fail-open (round one) | `sonnet` |
| `a02191cc91f12e1ac` | record forgery (round one) | `sonnet` |
| `a29e92047c312ee15` | premises (round one) | `sonnet` |
| `a13a8ab1b834407dc` | capacity probe only, no review | `sonnet` |

Recorded here because the id-to-lens mapping existed only in the session chat and would not survive a
compact; the design document set the same precedent for the v7 `/check` rounds. Five earlier Opus-pinned
attempts returned 529 Overloaded and produced no transcripts, which is why the round-one panel ran on
`sonnet` at all — see the procedural caveat above.

**Fixed in round two** (all three verified live, suite green at 38):

- **The round-one hash re-assert was itself two defects.** Written as a bare `rec.contentHash !== sc.hash`,
  it was *stricter* than the matcher it re-asserted (`ticketRecordMatches` trims and lower-cases), so a
  record carrying the trailing newline `--ticket-hash` prints matched the finder and then failed the
  re-assert as `bad-record` — whose remedy text says re-run `/vet-ticket`, which regenerates an identical
  record. A closed lockout loop escapable only by break-glass. It was also the first dereference of `rec`,
  and `JSON.parse('null')` succeeds, so it moved a crash site *earlier* than the null guard added one edit
  before. Now `if (!ticketRecordMatches(rec, sc.hash))` — same predicate, null-safe. Logged to GEN-58
  (class D, new element; Vol. 8).
- **The housekeeping exemption was not tool-scoped**, so `notion-duplicate-page` with
  `{page_id, properties:{Status}}` returned `out` — and a duplicate **spawns a live ticket**, i.e. a create
  reaching Notion with no record. Now scoped to `update-page`, matching the GEN-58 carve-out below it,
  which was already scoped that way and is what flagged this as the oversight.

### Round three — the four ordinary bugs, fixed 2026-08-05

Erez chose: *"fix the four ordinary bugs now and re-review."* All four were re-confirmed against live
code or the live tool schema before being touched — not taken from the round-two write-up — and each has
regression assertions behind it. Diff went **7 hunks / 1,603 added → 7 hunks / 1,766 added, still 0
removed**; suite 38 → **63, all passing**.

- **The verdict token was read from the reviewer's `thinking` blocks and `tool_use` arguments.** The
  scan `JSON.stringify`'d each whole assistant record, so restricting it to assistant-authored *records*
  was not the same as restricting it to what the reviewer *delivered*. Characterised against real
  transcripts first: assistant records carry exactly `text`, `thinking` and `tool_use` blocks. Now an
  **allow-list of `text` blocks** — which also excludes `redacted_thinking` and every block type a future
  schema adds, by construction rather than by a deny-list someone must remember to extend. Second half of
  the same fix: "last" now means the last occurrence in the reviewer's **final delivered message**, not
  the last in the file, so the code finally means what the refusal text ("does not END on") and the
  design comment ("its verdict is what it ends on") always claimed. Grounded, not assumed — across all
  1,206 sub-agent transcripts in this project, 1,204 end with an `assistant [text]` record and nothing
  after it. Harness-authored `isApiErrorMessage` records are skipped, because all 14 of those here carry
  a text block (the 529s from this session) and one landing after a valid verdict would shadow it.
- **`ticketSessionDir` was one directory too deep for a sub-agent caller.** A sub-agent's
  `transcript_path` is `<sessionDir>/subagents/agent-<self>.jsonl`, so stripping `.jsonl` alone left
  every sidecar lookup resolving to `<…>/agent-<self>/subagents/…`, a path that cannot exist — so a
  legitimately minted record was refused as `reviewer-unverified`, a block whose stated remedy could not
  clear it. It now climbs out of a `subagents` directory. **This does not settle whether PreToolUse fires
  for sub-agent calls at all** — that is still open and belongs to `/vet-code`'s live verification. It
  makes the path correct *if* it fires.
- **The GEN-58 carve-out never fired for a real `update_content`, and the obvious fix opened a wipe
  path.** Checked against the live schema: `update_content` carries its edits in
  `content_updates: [{old_str, new_str, replace_all_matches?}]`, and root `new_str` belongs to
  `replace_content` alone — a command clause 2 already refuses. So clause 5 rejected every real log edit
  on an unrecognised root key (demonstrated on the working hook: all three real shapes blocked), *and*
  clause 4's emptiness test was dead code that had never once fired. Permitting the key without fixing
  clause 4 would have made an **emptying** edit exempt. Both changed together: clause 4 is now a
  recursive walk over the whole normalised tree — no `new_str` anywhere may be empty — and clause 6 admits
  `content_updates` as a closed shape. Written over the tree rather than a field path deliberately:
  naming a field path is the exact mistake that produced this defect, and the one the 2026-08-03 scoping
  rebuild already removed from stage 1.
- **Three comment-vs-code mismatches, all now made true rather than reworded.** (a) The hash *assembly*
  was two byte-identical copies while the CLI's own comment argued that one definition called by both is
  what removes drift — now one `ticketContentHash`, called by both. What was duplicated is a *decision*
  (which value is hashed when the payload cannot be read end to end), and the new assertion is that a
  record minted from the CLI's fallback digest clears the gate's block. (b) The CLI's NOTE promised a
  record "CAN match" for every unreadable payload; false for `normalise-threw`, where the hook refuses as
  `internal-error` **before** it reads any record. That case now exits non-zero and prints no hash, on the
  same reasoning `ticketHashShellCli` already uses — a refusal now beats a wasted reviewer run and a
  mystery afterwards. (c) `exempt-list-overflow` ended "find that bug rather than trimming the list",
  naming no fix at all: nothing prunes the list, so while it is over-cap every in-scope write is refused
  and break-glass was the only route out. It now says find the appender *and then* trim, and names the
  file.

**A fifth defect, found while realigning the skill to the token change and fixed with it:**
`vet-ticket-SKILL.md` still listed all **ten** pre-v8 housekeeping properties as "NOT gated". The v8 hook
exempts **five** — `Due Date`, `Remind me`, `Date Created`, `ID` and `Parent item` became substance — so
the skill told you five gated edits were free. The hook fails closed, so the cost is a confusing refusal
rather than an unreviewed write, but a skill looser than its gate sends you round a loop. Also added
there: the exemption is tool-scoped to `update-page`, and the two token-contract corrections. **This is
the fifth skill/hook contract mismatch found across three rounds** (four in round one, this in round
three) — the pattern is that the skill is edited when the hook's *mechanism* changes and not when its
*data* changes, and the suite only tests the hook.

**Noted, not changed:** `TICKET_CONTENT_COMMANDS` admits `insert_content_after` and
`insert_content_before`, neither of which exists in today's `notion-update-page` command enum. Harmless
now (such a payload fails at Notion), but it pre-exempts whatever semantics a future schema attaches to
those names. Narrowing is the safe direction and is left as its own reviewed change rather than folded
into this one.

### Round three's own review — three cold Opus panels, and the fix that did not reach real traffic

Three `check-reviewer` sub-agents on Opus 5, each given the diff, the working file, the suite and the goal
verbatim, forbidden from reading any `.md` in this folder except the skill (for contract comparison only).
**All three returned REVISE.** Agent ids, for the Step 1b / Step 5 evidence record — session
`1f35b63a-78f2-43e3-8dfd-21793f22dcc1`, all `check-reviewer`, all `opus`:

| id | lens |
|---|---|
| `a08c95cf87b8974e1` | did the new changes introduce a defect (lockout / fail-open / over-strict) |
| `ae4fe1e34604338b1` | evidence forgery, replay, bypass + adversarial audit of the suite |
| `a2b729e891f5fe8e0` | false premises and hook/skill contract drift |

**BLOCKING 1 — the GEN-58 fix does not reach real log traffic.** Found independently by two reviewers,
then confirmed empirically here. Real reasoning-failure write-ups do **not** target the ticket row whose
id is hardcoded as `GEN58_PAGE_ID`; they target a log-**volume child page**, which reaches the carve-out
only via `~/.claude-staging/ticket-gate-exempt-pages.txt`. **That file does not exist and nothing writes
it** — the hook's comment names `/vet-ticket`'s GEN-58 lane as its single writer and the skill has no such
lane. Measured: a volume-child `insert_content` BLOCKS; seed the volume id into the list and it falls
through, so the mechanism is sound and unpopulated. Round three's own assertions used the row id, so the
suite is green over the one target that was already exempt. **Logged to GEN-58 as class R, new element
(Vol. 8; header 4x → 5x).** Not patched: this is the third fix to the same carve-out, and the standing
rule is to stop and re-examine rather than patch again. It is Erez's design call.

**BLOCKING 2 — the MCP content hash does not bind the tool, so a record clears the same payload on a
different tool.** Verified live: one record minted for `{page_id, command:'update_properties',
properties:{Urgency}}` reviewed as an update-page edit was spent on **`notion-duplicate-page`** and
APPROVED — and a duplicate spawns a live ticket. `ticketContentHash` takes the payload alone; the REST
arm folds its surface tag into the hash and the MCP arm folds in nothing. Both tools declare
`additionalProperties: {}` and require only their own keys, so one object is schema-valid for both. The
comment claiming *"one tool call is one payload is one hash, so the hash identifies the write exactly"* is
false. Not fixed: the fix changes the record format contract across hook + CLI + skill, which is the
class that produced four defects in round one, so it is not a one-liner.

**BLOCKING 3 — the skill reinstates the void "the mint write prompts him" premise**, in three places, plus
a new one: it tells the reader raw REST Notion writes *"are still forced to an interactive `ask` by
notion-schema-guard.js … so neither runs silently"*, which the hook's own header contradicts for the same
mechanism. The premise half was already open (above); the REST claim is new. The live refusal text also
still says *"and every raw Notion REST write"* must go through `/vet-ticket`, which `if (!isMcp) return;`
makes false.

**Fixed in round three after the review, both defects this round introduced:**
- `ticketDeliveredText` returned `''` for a whitespace-only text block, so an empty trailing record became
  "the final message" and shadowed a real verdict behind it. Real transcripts write ~one content block per
  record, so that is an ordinary shape. Whitespace now counts as nothing delivered. Three assertions added.
- The comment claiming *"the code, the comment and the refusal text all say the same thing"* about ending
  on the token overstated it: the match is not anchored to the end of the message, so text may follow.
  Anchoring was considered and rejected (a trailing sentence would become a false refusal); the comment now
  says what the code does. Suite 63 → **66**.

**Material suite findings accepted and not yet acted on** (from the adversarial audit): section D still
uses the fictional root-`old_str` shape; eighteen assertions test only `exit 2` with no reason check, so a
wholly dead carve-out would still leave twelve of them green; `fellThrough` cannot distinguish a
fall-through from an approve; the expiry check, `isSafeTicketHash`, `transcript-too-large`,
`consume-failed`, `internal-error` and two `scope:'out'` branches have no assertion at all; the waive
assertion leaves a valid sidecar and token on disk, so it never exercises the bypass it names; and the
corpus fail-open sweep is in the stale suite, so no quantitative claim in the hook's comments is asserted
by anything that runs.

**Open, and NOT fixed — these need decisions or careful work, not blind one-liners:**

- **Break-glass skips the whole gate, session-wide, logging nothing** (both reviewers, independently, HIGH).
  `if (configUnlocked()) return;` sits before `ticketScope`, so it is the one branch that neither blocks,
  approves, nor logs. Reachable by following a *sibling gate's own written remedy* for an unrelated command.
  The precedent cuts the other way: `enforceStaging` deliberately has **no** global break-glass, because
  "a pass-MISS must stay unbreakable, since that is Erez's content approval" — which is the same argument
  here. Also, the reaper's alarm text says four locks; this makes it five and was not updated.
- **The waive is bound to the content hash and nothing else**, and the hook enforces no *ceiling* on
  `expires` — the skill's 15-minute discipline is advisory. Plus the skill's claim that the mint write
  "prompts him" is false (verified), so the waive's documented second confirmation does not exist.
- **A create into a second or rotated Team-Tasks data source returns `out`** → silent approve, with no
  event-log row either. `containerTeamTasks` is computed and returned but read nowhere. The guard above it
  tests *unreadable*, not *unrecognised*. Fixing this properly is a design call: blocking every
  unrecognised container would gate non-Team-Tasks creates workspace-wide.
- **Whether PreToolUse fires for sub-agent-originated tool calls at all is still unverified** — the other
  half of what round two called "the sub-agent path is broken in both directions". The path arithmetic
  half is fixed (round three above); this half is not a code question. If hooks do not fire there, a
  sub-agent could file an unreviewed ticket straight past the gate. It needs a live experiment, so it
  belongs to `/vet-code`'s verification step, before install.
- **Apply-order constraint: the hook and the skill must install together.** `~/.claude/skills/vet-ticket/`
  is not on disk — which is the *expected* state, since the skill is a GEN-508 deliverable and this
  folder's own file table has always described it as "not yet installed". The finding is narrower than the
  reviewer's framing (and narrower than this README's first version of this bullet, which presented it as
  a discovery): the hook's refusal messages name `/vet-ticket` as the remedy and the hook has no load-time
  check that it is present, so a hook-only install refuses every gated write while pointing at something
  unrunnable. Two escapes exist from that state, not one — the unlogged break-glass above, or hand-minting
  a record into the unprotected pass dir — and both are worse than not installing. So: one line for
  `/vet-code` step 8, not a code defect.
**Still to do:** decide the two open items above that are Erez's call, then `/vet-code` steps 4–8: live
verification, the Step 1b vetting record, the card, the mint, the install, and the post-install check.
The round-three fixes still owe a Pass B of their own — see below.

Two named gaps that must not be lost, both carried into the piece-2/piece-3 tickets when they are
filed:

- **Whether PreToolUse hooks fire for sub-agent-originated tool calls is still unverified.** If they
  do not, a sub-agent could file an unreviewed ticket straight past this gate. It needs a live
  experiment, so it belongs to `/vet-code`'s verification step, before install — not to the code.
- **`ticket-gate-events.jsonl` has no reader yet.** The `block` events are self-surfacing (each one
  exits 2 and prints why, in the same turn), so nothing there can hide. But `approve` is aggregate-only
  and accumulates unread until piece 3 adds the `/wrap` line. That line must show blocks-by-reason
  since the previous wrap. The rationale is in the comment above `logTicketGateEvent`.

  **Correction, 2026-08-05:** an earlier version of this entry also asked for a flag on `claim-lost`
  and set a re-evaluate bar of "if `claim-lost` is still zero after 50 gated writes, drop the 3-attempt
  retry loop." Both are void: v8 deleted the claim-by-rename machinery and the retry loop with it, and
  the hook emits only `approve`, `block` and `consume-failed` — there is no `claim-lost` event to
  count, so piece 3 must not wire a counter for one. A zero there would have read as "healthy" when it
  actually meant "never instrumented."
