# GEN-716 Phase 1 — "grounding flag" build: cold-pickup handoff

**Status:** design formed, `/vet-code` opened, Step 0 (gate self-check) PASSED. Resume at **Step 1 (design `/check` at max effort)**.
**Approved by Erez** (2026-09-14) to build after Phase 0. Nothing is built or installed yet.
**To resume:** a fresh session should read this file top to bottom, then run `/vet-code` from Step 1 using the design in section 3 as the artifact under review.

---

## 1. What this is (goal)

Replace **Phase 1** of `~/.claude/hooks/stop-claim-linter.js` — the lexical `CLAIM_PATTERNS` + nearby-"evidence-marker" detector — with a **grounding flag**: at "📌 For you" block-emit time, nudge the model to correct **high-stakes factual claims that are not grounded in the session's actual tool-call evidence**, without false-firing on claims legitimately grounded in *earlier* turns.

This is the replacement the retired GEN-450 claim-linter never was. The retired linter tried to judge *truth* lexically (a regex can't) and false-fired ~100% on legitimate cited numbers. The grounding flag judges **groundedness** (does evidence for the claim exist in the session?) — a tractable, lexical-proximity property — not truth.

### Honest scope (do NOT oversell)
- **Catches:** high-stakes claims with **no** supporting evidence anywhere in the session (the "catchable cluster" Phase 0 found — ticket-status stated without a re-fetch, restated prior-turn numbers, premature "panel says X").
- **Does NOT catch:** a claim that *is* grounded but **subtly overstated** (the class that keeps recurring — e.g. flattening a qualified finding). Phase 0 + best-practice research both say that class is not verifier-solvable; it stays with **Erez's pushback (human-in-the-loop)**. Building this flag does not change that.

---

## 2. Why (Phase 0 basis — all lower bounds)

Phase 0 (this session, artifacts in `notes/gen716-phase0/`, reproducible: `extract.py` → `sample.py` seed 716 → 6 independent annotators → `aggregate.py`):
- Population **872** "For you" blocks, window **2026-07-15 → 2026-09-14** (~9 wks, confirmed un-pruned).
- Random sample **100**: **4% block-level wrong-claim rate, 0/100 acted-on** — both **lower bounds** (count only same-turn-evidence + internal-inconsistency errors; 141 "unverifiable" claims may hide wrong ones grounded in earlier turns).
- Instrument checks done: precision spot-check of all 4 flagged-wrong blocks (genuine, 0 false flags); GEN-58 known-positive cross-check (the 2026-09-14 overstatement — the subtle class a verifier misses). NOT done: recall spot-check of the "unverifiable" set.
- The catchable errors cluster in 3–4 mechanical shapes → the flag targets exactly those.

Decision path: full "verify-and-correct-every-claim" loop was rejected (0 acted-on, cost, and the subtle class evades it). Erez then pushed back on deferring the best practice behind a monitor; the recommendation was corrected to **build the grounding flag now as the replacement, keep the current nudge live until it ships.** (That correction was logged to GEN-58 as a recurrence — see section 6.)

---

## 3. The design (artifact for the Step-1 `/check`)

**Modify `stop-claim-linter.js` in place** — NOT a new hook (a 5th Stop hook stacking its own `additionalContext` is the GEN-467 duplicate-"For you"-block bug; the file's header explains this). Reuse the file's injection channel, Phase-2 For-you guard, GEN-507 self-audit stage, watchdog, session-keyed state, ReDoS-safety, and fail-open stance. Replace only Phase 1's `CLAIM_PATTERNS` / `LIVE_MARKERS` / `NARRATIVE_MARKERS` / `claimCleared` / `findNakedClaims`.

**Detection — two stages:**
1. **Candidate high-stakes claims** in `last_assistant_message`: ticket-status assertions (`GEN-N is <status>`); counts/results (`42/42`, `N tickets filed`); outcomes (shipped/pushed/filed/installed/deployed/completed); exhaustiveness (`the only`, `nothing else`, `all N`). A refined **high-stakes-only** subset of the old patterns; drop low-signal shapes (bare "I can").
2. **Grounding check** per candidate: read the **session transcript** (`.jsonl` under `~/.claude/projects/<slug>/…`, path derived from `session_id`), gather `tool_result` text across the session (this turn + earlier turns), and test whether the claim's **key entity** appears in that evidence (ticket ID + status token; the number; the object of the outcome). No supporting evidence anywhere in the session → **FLAG (nudge)**. Grounded this turn OR earlier this session → **PASS silently** (this is the cross-turn false-fire fix that entity+marker matching alone can't do).

**Nudge:** reuse the existing `additionalContext` injection — "these high-stakes claims aren't backed by this session's tool evidence: […]; verify each against live state and correct silently before the block stands, or name what would resolve it." (Injected strings must still pass the file's reason-self-scan fixture — never match a detector pattern or a block opener.)

**Fixed design decisions / constraints:**
- **Nudge-only, never-block, fail-open.** Any error (transcript unreadable/locked, parse failure, missing `session_id`) → release silently toward no-nudge. Must never wedge, delay, or false-fire on a read failure.
- **Groundedness, not truth** (deliberate; see scope above).
- **Precision-first / bias to under-flag.** A false nudge erodes signal (the retired linter's core lesson). When unsure it's high-stakes or whether an entity match counts as grounding, don't flag.
- **Reuse, don't add a hook.**

**Open questions the Step-1 `/check` (max) MUST grapple with — the real risk areas:**
- **a) Cross-SESSION grounding gap (important).** The current session's transcript won't contain evidence from a *prior* session. A status legitimately set days ago ("GEN-640 is Done") would read as ungrounded → false-fire. The heuristic must handle this (options: only flag shapes typically established same-session; widen the read to recent transcripts; or accept some cross-session false nudges as the cheap direction — a `/check` call).
- **b) Entity-match precision/recall.** False-pass (entity coincidentally present in unrelated evidence) vs false-flag (grounded via paraphrase the match misses). Is entity-presence the right groundedness proxy?
- **c) In-hook transcript read cost & safety.** One disk read + parse per Stop, on a hook that fires into **shared state across ALL concurrent sessions** (file header). Must be bounded (cap bytes/lines, like `extract.py`), ReDoS-safe on parse, robust on path derivation, and fail-open. This is the #1 code-review target.

---

## 4. `/vet-code` resume point

- **Step 0 — DONE this session:** gate healthy (`enforceVetting` + `findVettingPassFile` present in `auto-approve.js`); `/code-review` + `check-reviewer` agent available; session model Opus 4.8 = floor (no model prompt needed for the passes; keep Pass B pinned to `opus`).
- **Step 1 — RESUME HERE:** `/check` the section-3 design at **max** effort. Feed the open questions (3a/3b/3c) in as the risk areas.
- **Step 1b:** vetting record (bind to working-copy `contentHash`).
- **Step 2:** build to a working copy (do NOT edit the live file until Step 7).
- **Step 3:** two code-review passes (Pass A in-session `/code-review` high; Pass B independent `check-reviewer`, pinned `opus`). Stress 3c especially (transcript read: cost, ReDoS, path robustness, concurrent-session shared-state).
- **Step 4:** live-verify with **input realism (mandatory)** — run against REAL "For you" block text from this machine's transcripts under `~/.claude/projects/` (text at `message.content[].text` on `"type":"assistant"` lines), not authored fixtures. **GEN-467 lesson: authored fixtures reword away the real trigger vocab and shipped a 100% real-world escape twice.** Assert new behavior AND a regression pass on the Phase-2 guard + self-audit stage. Confirm no false fire on real inputs (any false fire = FAIL pending Erez's sign-off).
- **Step 5:** show Erez, attest all checks, get explicit approval.
- **Steps 6–8:** mint pass → apply via the gated single-line channel → verify byte-identical + pass consumed.
- Not a background-launch change → **skip Step 4a/8a**.

---

## 5. Where things live

- Hook to modify: `C:\Users\Erez\.claude\hooks\stop-claim-linter.js` (~1079 lines; read it fully before editing).
- Phase 0 artifacts + design basis: `notes/gen716-phase0/`.
- Approved plan (broader arc): `C:\Users\Erez\.claude\plans\finish-the-retirement-you-hashed-bentley.md`.
- Ticket: **GEN-716** (primary, In Progress). Retirement of the old regex arm is **Part A / GEN-450**, vetted but **PARKED** — keep it parked until the grounding flag ships (don't leave a gap).

---

## 6. Outstanding debts / related follow-ups (do NOT lose)

- **GEN-58 Class-D index counter-bump (owed).** The recurrence trace IS logged to Vol. 8 (`3b36e495-d07c-815c-83c3-f57e03e42aee`, verified). Still owed: bump the Class-D header "seen Nx (last …)" + the 2026-09-14 element bullet to "seen 2x" on the main GEN-58 index page (185 KB — do a careful, exact-match edit, not a rushed search-replace).
- **Monitor + GEN-716 disposition (separate from the flag build).** The accepted posture also includes a two-arm monitor (GEN-58 caught-errors bar + quarterly independent re-audit) and keeping GEN-716 open until a monitor ticket lands. Erez approved the *flag build* specifically; treat the monitor as a related follow-up to file/confirm, not part of this build.
- **Retirement (Part A / GEN-450)** ships only *after* the grounding flag installs.
