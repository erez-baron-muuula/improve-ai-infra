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
| `auto-approve.working.js` | Full working copy of the hook with the `enforceTicketVetting` arm, **rebuilt against design v8 on 2026-08-05, then narrowed to the MCP surface the same day** (§4.5 present but unwired). Purely additive against the live hook: 6 hunks, 1,558 lines added, **0 removed** — the narrowing removed only lines this change had itself added, so it deletes nothing live. Passes `node --check`. **Re-based on the live hook of 2026-08-05 09:14** — it had changed mid-session (GEN-641's `blockUnreadableGatedCommand`), so an earlier copy would have silently dropped that guard; re-check for drift before any install. |
| `notion-rest-write.ps1` | The script that will be the only permitted route for a raw Notion REST write (design §4.5). **Deferred to piece 2 with the arm — it is NOT installed and its path is no longer in `PROTECTED_FILES`**, so piece 2 can create it. Its sha256 is still pinned in the hook. **LF line endings, no BOM** — a CRLF normalisation breaks the pin and blocks every gated REST write (fail-closed, reason `rest-script-mismatch`). Pin: `38897e5b4aa874ed…`, computed from the code block in `design-converged.md` §4.5, not from this file. Install it BEFORE re-adding its path to `PROTECTED_FILES`, not after. |
| `gen508-hook.diff` | The same change as a unified diff against the live hook, for review. Regenerated 2026-08-05. |
| `test-gen508-v8-arm.js` | **The suite that gates the install, and it must be GREEN: 27 assertions, 0 failing.** Runs the hook as a real PreToolUse process (JSON on stdin, exit code as the verdict). Covers the MCP surface, the `--ticket-hash` CLI, the full record path, latency, and three assertions that the REST arm really is unwired. **Not** the deliverable-8 rebuild: it has no fail-open corpus sweep. |
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

**27 assertions, all passing, exit 0** — verified 2026-08-05 against the unwired hook. This is the
suite that gates the install. It spawns the hook as a real PreToolUse process, so what it tests is
what will run, and it needs no corpus and no network.

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

An earlier version of this section claimed 48 assertions all passing. The count was right — 27 + 25 is
52 today only because the split added four new assertions — but that run was not reproducible from the
committed files, because the suite spawned a hook filename that is not in this folder.

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
adds, so the diff against the live hook is **still purely additive: 1,558 lines added, 0 removed**,
across the same 6 hunks.

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

**Still to do:** the second `/code-review` (Erez must launch it — and the change has moved substantially
since the first, so it reviews a different diff), then `/vet-code` steps 4–8: live verification, the
Step 1b vetting record, the card, the mint, the install, and the post-install check.

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
