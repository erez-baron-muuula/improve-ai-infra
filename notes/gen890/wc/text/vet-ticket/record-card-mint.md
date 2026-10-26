# /vet-ticket — Steps 3 to 7: notes, record, card, mint, waive, evidence check

**Contents:** Step 3 resolve every note · Step 4 write the ticket-record · Step 5 show the card, then mint · Step 6 the waive lane · Step 7 evidence precondition

Full detail for runbook (`SKILL.md`) Steps 3 to 7. Read the section for the step you are on before
doing it, every run. Step 7 executes immediately before the Step 5 mint write.

---

## Step 3 — Resolve every note before filing

A `PASS` with notes does not file as-is. For each note, either amend the ticket or dismiss it with a
stated reason, and record that resolution in the ticket-record's `noteResolutions` field (Step 4) — the card no longer shows the notes (Step 5), so the ticket-record is where every note and its resolution live. Notes are where a
reviewer parks a real problem without failing the ticket; an unresolved one must never ride along
inside an approval.

## Step 4 — Write the ticket-record

Write a **ticket-record** into `~/.claude-staging/ticket-passes/` (create the dir if missing). This
file is the audit trail, **not** the thing the hook reads — it carries no `expires`, so the hook's
pass scan skips it entirely. The Step-5 pass is what clears the gate, and every field the hook needs
has to be on that file, flat at its top level.

```json
{ "kind": "ticket-record",
  "target": "<see Step 5 target forms>",
  "contentHash": "<the line --ticket-hash printed>",
  "reviewerAgentId": "<the agentId of the reviewer whose PASS token binds this hash>",
  "priorReviewerAgentIds": ["<any earlier REVISE rounds, for the audit trail>"],
  "verdict": "PASS",
  "capturedFindings": "<the reviewer's verdict block, copied in so the record is self-contained>",
  "noteResolutions": "<each note and how it was resolved>",
  "searchSummary": "<Step 0b's search and candidates; 'n/a' where Step 0b was skipped>",
  "waived": false,
  "waiveReason": null,
  "source": "interactive",
  "lane": "ticket",
  "draftedUtc": "<ISO-8601 UTC now>" }
```

**`source` and `lane` feed `/wrap` Step 3i, the ticket-gate readout.** `source` is `interactive` by
default; `/wrap` Steps 1 and 3c set `wrap-step1` / `wrap-step3c`, and any other unattended run — one
with no Erez present to answer a card, such as a scheduled task — sets `scheduled`. `lane` is `ticket`, `non-ticket` (the non-ticket lane) or
`gen58-rollover` (the rollover lane). Use these exact values: the readout counts only them and names any
other value as drift. **Never copy either key into the Step-5 pass** — its keys are closed
(`TICKET_PASS_KEYS`), and the hook refuses an extra one with `unknown-record-key`.

**One reviewer id, singular.** The hook verifies exactly one reviewer — that agent's sidecar
`agentType` and that agent's own PASS token — so `reviewerAgentId` names the reviewer whose token
binds the hash you are about to mint, which after a REVISE round is the LAST reviewer, not the first.
Earlier rounds go in `priorReviewerAgentIds`, which nothing enforces and which exists only so the
history is not lost.

## Step 5 — Show Erez the card, then mint

**The card is the only approval, and the first time Erez sees the proposal.** Bring a ticket write to
him only as this card, after Steps 0b–4 have run — never as a chat draft or a "should I file this?"
beforehand: a chat draft followed by the card asks him twice (GEN-802), and an approval given before
the Step 0b search can land a near-duplicate (GEN-606). If Erez already explicitly approved this write
— he asked for it, or approved a plan step naming its target and purpose — that approval stands: run
the steps, and if the reviewed result stays within what he described, file it and show the card as a
report, not a question; ask only when it goes beyond that, including when Step 0b turned it into an
append to an existing ticket. Lead each card with one line from its Step 0b search
summary — what was searched and the nearest candidate ruled out and why, the match found, or "could
not check" — written above the card, not as a fifth field. When Step 0b turned the write into an
append, the card's title is that ticket's ID and name, and its one-line summary says what is being
added. If Erez asks for changes at the card, revise, re-hash and re-review (Steps 1–2), and show the
revised card — one new approval, for the changed content.

Show a **summary card per ticket — not the body** (Erez's instruction, 2026-08-02; trimmed to four fields 2026-08-17). The card carries **exactly four fields**: the **title**; a **one-line summary** of what the ticket is for; the **epic / parent** — its `Parent item`, named as the epic when that parent is an epic (you set it, and its `Type`/level tells you), otherwise the parent ticket; and the **derived Priority**. Nothing else goes on the card — not the cross-referenced ticket IDs, not the other properties (type, status, assignee, Urgency, Gain ratio), and not the reviewer's verdict or its notes. (The GEN-58 rollover lane and the non-ticket lane file a plain page with no Team-Tasks properties: their card shows the title, the one-line summary, and the parent page, and omits Priority — there is none to show.) Still offer to show the full body on request. Several pending filings are shown together as one card list and approved in one action. **Unattended exception (GEN-702):** `/wrap` Steps 1 and 3c run this whole flow with NO card — a standing override so the wrap does not stop for approval. There this card step is skipped (nothing shown; the mint proceeds silently), the Step 6 waive lane is unavailable (it needs Erez), and a filing that cannot reach a PASS is surfaced in `/wrap`'s report instead of filed — see `wrap/SKILL.md` Step 1 for that lane's bounded-retry (2 rounds) and reporting rules. **The same exception covers the scheduled `/release-review` job (GEN-871)**, run by the `release-review-weekly` scheduled task, ticket-record `source` `scheduled`: no card, no waive lane, the same 2-round bound, and an item that cannot reach a PASS goes to that job's recovery file instead of being filed — see `release-review/SKILL.md`. It is the only scheduled task this exception covers; any other unattended filer needs its own approved extension.

His approval means "file this", not "I endorse this wording" — the body's quality rests on the
reviewer. Because the card no longer shows the reviewer's notes, when they were substantive say so in plain terms as you present the card (the resolutions are in the ticket-record for the detail); likewise flag an unusually large card list.

**Before you write the pass, run the Step 7 evidence precondition.** Step 7 is numbered after this step
but executes first: it re-verifies the reviewer's transcript, token, and hash immediately before the
mint. Run pre-mint, its checks read the equivalent fields on the **Step-4 ticket-record** (the pass does
not exist yet — Step 7's "checked on the pass file" wording assumes the ordinary post-mint order).
Minting first risks an unexplained hard-block after the write, when a failed precondition here costs
only a re-review.

Then mint the **ticket pass** into `~/.claude-staging/ticket-passes/` with the Write tool. Do NOT rely
on that write to prompt him — under his bypassPermissions mode it falls through silently — so his
approval must come from the **card you show inline BEFORE the mint** (or the earlier explicit approval described above), never from a file-write dialog
that may never appear.

```json
{ "kind": "ticket",
  "surface": "notion-mcp",
  "contentHash": "<the 64-hex line --ticket-hash printed>",
  "reviewerAgentId": "<the same agentId as the record>",
  "verdict": "PASS",
  "waived": false,
  "target": "<human-readable label>",
  "expires": "<now + 15 min, ISO-8601 UTC>" }
```

**Flat, and one hash per file.** The hook reads `kind`, `contentHash`, `verdict`, `waived`,
`reviewerAgentId` and `expires` off the top level of this one file. Nesting any of them — inside a
`targets` array or anywhere else — means the hook never sees them: it finds no matching pass and
hard-blocks with `no-pass`, which looks identical to never having run a review at all. `surface` and
`target` are diagnostic only and are never matched on.

**The hook matches on `contentHash` alone.** `target` is a human-readable label — it appears in the
refusal message and the audit log, and getting it wrong costs nothing. Write something a person can
recognise: the ticket id, or `create in Team-Tasks`. (Earlier drafts made the hook derive a canonical
target string and match on it, which would have obliged this skill to reproduce the whole scoping
scan; that is now the hash's job.)

`verdict` and `waived` are a cheap pre-filter the hook applies before it opens the transcript — they
are not the authority and cannot substitute for the reviewer's token. A pass carrying
`verdict: "REVISE"` and no waive blocks with `bad-verdict`; one carrying `verdict: "PASS"` whose named
reviewer never emitted the token blocks with `no-token`.

Get the timestamp from a read-only `(Get-Date).ToUniversalTime().AddMinutes(15).ToString("o")`
immediately before writing.

**ONE pass file authorises ONE write.** The batch `targets[]` array and its partial-consumption
machinery are gone: the hook consumes a matched pass by renaming the whole file to
`*.consumed.<ts>`, so the first write it authorises retires it completely. A card list covering
several tickets therefore needs one pass file per ticket, each with its own hash and its own reviewer
token, written in the same approved moment.

Known consequence, not a design claim: each of those files is a separate reviewed pass — its own hash
and its own reviewer token — so a multi-ticket card list is several mints, not one. Do not try to
collapse them by putting several hashes in one file — the hook cannot read them.

## Step 6 — The waive lane (Erez's per-case override)

When the reviewer holds findings that cannot be fixed and Erez wants it filed anyway: show him the
outstanding findings in plain terms and ask. On his affirmative, set `waived: true` + `waiveReason` +
the outstanding findings in the record, **and set `waived: true` on the pass as well** — the pass is
the only file the hook opens, so a waive recorded solely in the record blocks with `bad-verdict`. Then
mint normally. Erez's explicit affirmative in chat (above) is the waive's authority; there is no
separate mint-write confirmation, because under his permission mode that write does not prompt.

The waived pass carries the SAME `TICKET_PASS_KEYS` shape as Step 5's, with `waived: true` and
**`reviewerAgentId` omitted** (a waive cites no reviewer). Keep `waiveReason` and the outstanding
findings in the **ticket-record only** — `waiveReason` is not a `TICKET_PASS_KEYS` member, so copying it
onto the pass makes the hook refuse with `unknown-record-key`:

```json
{ "kind": "ticket",
  "surface": "notion-mcp",
  "contentHash": "<the 64-hex line --ticket-hash printed>",
  "verdict": "PASS",
  "waived": true,
  "target": "<human-readable label>",
  "expires": "<now + 15 min, ISO-8601 UTC>" }
```

A waive is the ONLY path that skips the reviewer checks: on `waived: true` the hook verifies no
sidecar and looks for no token, so a waived pass needs no `reviewerAgentId` and Erez's explicit chat
answer is the entire evidence base. That is why it is per-write, and why it is never the answer to a
token that merely failed to match — re-review that instead.

**Declining the mint is NOT a waive**: it leaves the write blocked, which is the gate working. The
waive is scoped to this one write and never touches the global break-glass.

## Step 7 — Evidence precondition (run immediately before the mint write)

- `reviewerAgentId` is present and non-empty, unless `waived === true` — a pass citing no reviewer is
  not evidence.
- `~/.claude/projects/<project-slug>/$CLAUDE_SESSION_ID/subagents/agent-<id>.jsonl` and its
  `.meta.json` both exist; the sidecar reads `"agentType":"check-reviewer"`; and the minimum
  `timestamp` across all lines of the `.jsonl` is `<= draftedUtc`. Read `$CLAUDE_SESSION_ID` via the
  Bash tool (it is not exported to PowerShell), and find the `<project-slug>` folder by listing
  `~/.claude/projects/` for the one containing that session id — do not hand-derive the slug.
- **The token is present, correct, and the reviewer's last delivered word — ask the hook.** Run the
  hook's reviewer-verdict check on that same `.jsonl` (the one in THIS session's `subagents` folder
  located above), with the `contentHash` from Step 1:

  ```bash
  node "C:\Users\Erez\.claude\hooks\auto-approve.js" --ticket-verify "<that subagents dir>\agent-<id>.jsonl" --hash <contentHash>
  ```

  It must print `ok` (exit 0). It runs the same code the gate runs at write time — the sidecar check and
  the full read under "Where the hook looks, exactly" (Step 2, in `review.md`) — so it cannot drift from
  the gate; do not re-trace that read by hand. Any other word is the reason the write would block (`no-token`,
  `reviewer-unverified`, `bad-record`, `transcript-too-large`): re-review rather than mint — except a
  `no-token` on a report that reads as a finished review: first SendMessage that same reviewer asking it
  to re-send its full report ending with the verdict block, token last, then re-run this check;
  re-review only if it still isn't `ok`. Like the
  Step 1 hash call, that exact invocation is auto-approved; keep both paths quoted and the hash as the
  last token. The file must be the one under this session's folder: the gate looks only there, so a
  transcript from another session can print `ok` here and still block at write time. The command does
  NOT check the `draftedUtc` ordering — the bullet above still does. (Before 2026-08-05 this step
  scanned all assistant records flat; until 2026-09-27 it re-traced the hook's read in prose, which
  drifted when the hook learned to read hand-backs.)
- Re-run `--ticket-hash` on the payload and confirm it still prints the `contentHash` in the record
  (nothing edited since review). Re-running it, rather than trusting the recorded value, is the point.
- `verdict === 'PASS'` **or** `waived === true`, checked on the pass file.
- Every note has a recorded resolution (Step 3).

Any check fails → REFUSE to mint; say what is missing and re-review rather than forcing it.
