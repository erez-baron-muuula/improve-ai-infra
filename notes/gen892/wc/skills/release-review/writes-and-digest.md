# Release review — Step 8 write formats and the Step 9 digest

**Contents:** Step 8 note, new ticket and unblock formats · Step 9 digest section and the `waiting` count

Moved out of `SKILL.md` to keep it within the size kept after compaction (GEN-971). Read it at Step 8
and Step 9, every run.

## Step 8 — the three writes

- **Note on an affected ticket** (append): one dated block at the end of the body —
  `**Release review YYYY-MM-DD — Claude Code 2.1.NNN:** <the change, plain words> — <what it means for this ticket>. Docs: <url>.`
  A body append is material, so re-derive `Urgency`, `Gain ratio` and `Priority` per `/vet-ticket`
  Step 1, and raise urgency only with a stated reason.
- **New ticket** (create): named by outcome; body stands on its own (problem, why it matters, the
  release and docs link, the files or tickets involved, next action, who verifies); parent the
  AI-infra epic GEN-86 unless the domain is another project's (global "route by domain" rule); the
  Task template applied (check it exists); type task; status the one actually true (normally To Do);
  unassigned unless only Erez can do it; priority fields derived.
- **Unblock** (Blocked → To Do), only when Step 6.3 holds and the global `CLAUDE.md` "Ticket status"
  exception allows it: first the gated note `**Unblocked by release review YYYY-MM-DD — Claude Code 2.1.NNN:** <capability>. Was blocked on: "<quoted blocker>". Docs: <url>. Available: installed <version>; <plan note>.`
  — with the three conditions and the quoted blocker in the reviewer's brief so it judges the unblock
  itself — and re-fetch it. Only if the note landed, set Status to To Do (a status-only update) and
  re-fetch. If the note fails, do not touch the status.

## Step 9 — the digest section

Each live run appends ONE dated section, plain language, Erez-facing:

```
## Run YYYY-MM-DD — Claude Code 2.1.AAA → 2.1.BBB (N versions; installed 2.1.III)
[Re-evaluate line, if any]
Filed: GEN-x <title> — why (one line each)
Notes added: GEN-y — one line each
Moved Blocked → To Do: GEN-z — the capability; say "back to Blocked" to reverse
Waiting for your yes/no:
  1. <proposal, its reason, the ticket> — yes / no
Not filed this run: <items, why (cap / review did not pass / error)> — saved in <recovery file>
Unverified, maybe later: <one line each>
Arrives in a version not installed yet: <one line each, if any>
Reviews: <n> written, <n> needed more than one review round, <n> not filed
```

Before appending, read the digest's earlier sections and count yes/no items not yet struck through
(answered items are struck and moved to a "Decided" section by the session where Erez answers); that
count plus this run's new ones is the run's `waiting`. In `dry`, write the section to the dry-run file
instead. In `supervised`, the digest append is one of the N writes.
