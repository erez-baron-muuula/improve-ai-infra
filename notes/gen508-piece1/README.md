# GEN-508 piece 1 — build artifacts (scoping layer rebuilt 2026-08-03)

Working copies for the Notion half of the ticket-quality gate. **Nothing here is installed** — the
live `~/.claude/hooks/auto-approve.js` is untouched, and installing it goes through `/vet-code`.

The authoritative handoff is the **"BUILD STATE"** section of
[GEN-508](https://app.notion.com/p/3a36e495d07c81fb9a55ddc315639c7f). Read that first; this folder is
the artifacts it refers to.

| File | What it is |
|------|-----------|
| `design-scoping-v3.md` | **Retired as a normative source** (2026-08-03, v6): it was merged into `design-converged.md`, because the two-document split was itself the defect three `/check` lenses diagnosed. Kept only for its §1 corpus-shape table and §3 measurements, which are cited from the design. **Do not build from it.** |
| `auto-approve.working.js` | Full working copy of the hook with the `enforceTicketVetting` arm, **rebuilt against design v8 on 2026-08-05**. Purely additive against the live hook: 6 hunks, 1,531 lines added, **0 removed**. Passes `node --check`. **Re-based on the live hook of 2026-08-05 09:14** — it had changed mid-session (GEN-641's `blockUnreadableGatedCommand`), so an earlier copy would have silently dropped that guard; re-check for drift before any install. |
| `notion-rest-write.ps1` | The script that is the **only** permitted route for a raw Notion REST write (design §4.5). Its sha256 is pinned in the hook. **LF line endings, no BOM** — a CRLF normalisation breaks the pin and blocks every gated REST write (fail-closed, reason `rest-script-mismatch`). Pin: `38897e5b4aa874ed…`, computed from the code block in `design-converged.md` §4.5, not from this file. |
| `gen508-hook.diff` | The same change as a unified diff against the live hook, for review. Regenerated 2026-08-05. |
| `test-gen508-v8-arm.js` | Behavioural suite for the rebuilt arm: **48 assertions, all passing**, run against the hook as a real PreToolUse process (JSON on stdin, exit code as the verdict). Covers both surfaces, all three REST refusal classes, the pin, both hash CLIs and the full record path. **Not** the deliverable-8 rebuild: it has no fail-open corpus sweep. |
| `test-gen508.js` | The OLD behavioural suite, written against the pre-collapse layer. **Stale** — it exercises the resolver and cache the collapse deleted. Superseded pending the deliverable-8 rebuild. |
| `build-corpus.js` | Regenerates the payload corpus `test-gen508.js` part B needs. |
| `vet-ticket-SKILL.md` | Working copy of the new `/vet-ticket` skill (not yet installed at `~/.claude/skills/vet-ticket/`). |
| `design-converged.md` | **Read this second, after the ticket — it is the single normative document for piece 1.** Currently **v8** (2026-08-04): §4.5's raw-REST mechanism was replaced after five rounds found the same class of hole five times, and the replacement went through three more `/check` rounds. Its own top box carries the review state. `v8-measurement-scripts.txt` beside it is the provenance for §4.5's numbers. |

## Running the tests

```bash
node test-gen508-v8-arm.js
```

48 assertions against the **current** (v8) arm, all passing as of 2026-08-05. It spawns the hook as a
real PreToolUse process, so what it tests is what will run. It needs no corpus and no network. Note it
builds its fixtures relative to the hook's own directory, so it must be run from a directory whose
`../../.claude-staging` it may create — the scratchpad, not the repo.

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

`/code-review` (twice — Erez must launch it), then `/vet-code` steps 4–8: live verification, the
Step 1b vetting record, the card, the mint, the install, and the post-install check.

Two named gaps that must not be lost, both carried into the piece-2/piece-3 tickets when they are
filed:

- **Whether PreToolUse hooks fire for sub-agent-originated tool calls is still unverified.** If they
  do not, a sub-agent could file an unreviewed ticket straight past this gate. It needs a live
  experiment, so it belongs to `/vet-code`'s verification step, before install — not to the code.
- **`ticket-gate-events.jsonl` has no reader yet.** The `block` events are self-surfacing (each one
  exits 2 and prints why, in the same turn), so nothing there can hide. But `approve` and
  `claim-lost` are aggregate-only and accumulate unread until piece 3 adds the `/wrap` line. That
  line must show blocks-by-reason since the previous wrap, plus a flag if any `claim-lost` occurred
  at all. Re-evaluate bar: **if `claim-lost` is still zero after 50 gated writes, drop the 3-attempt
  retry loop** rather than maintain it. The rationale is in the comment above `logTicketGateEvent`.
