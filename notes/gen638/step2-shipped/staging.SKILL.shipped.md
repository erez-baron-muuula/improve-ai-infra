---
name: staging
description: "Stage a content edit to a non-sandbox Jira ticket or Confluence page through draft -> approve -> mint-pass -> apply -> verify. Trigger on /staging, on any request to change a non-sandbox Jira summary/description or Confluence title/body, or when the auto-approve hook blocks such an edit with a 'staging lock' refusal."
---

# /staging — gated edits to non-sandbox Jira / Confluence content

Editing the **title or body of a non-sandbox Jira ticket or Confluence page** is hard-blocked by the
`auto-approve.js` PreToolUse hook (GEN-281) unless a valid one-time **staging pass** exists. This
skill is the ONLY sanctioned way to mint a pass: it drafts the change, shows Erez the rendered
result, mints the pass only on his approval (the mint write itself prompts him — that prompt IS the
gate), applies, and verifies.

The hook enforces the gate; this skill enforces the *process*. Never hand-mint a pass to skip a step.

**Scope of the gate** (what the hook blocks): `editJiraIssue` touching `summary`/`description`;
`updateConfluencePage` (body/title); any direct mutating-HTTP shell command (`curl` /
`Invoke-RestMethod` with a write verb, data flag, `--json`, or `-T`/`--upload-file`) to an
`atlassian.net` / `api.atlassian.com` host — which needs a pass even when it targets a sandbox; and
any shell command that names `atlassian-put` (the script REST writes go through — only its one exact
form, Step 5, is allowed; any other command naming it is refused with no override). Non-content Jira
fields (status, labels, fixVersions, assignee, …) are NOT gated — edit those directly.

---

## Step 0 — Gate self-check (fail closed)

Before minting ANY pass, confirm the hook's hardened bypass-guards are present. If they are not,
the gate has a hole — REFUSE and tell Erez the hook must be hardened first (do not proceed).

Check `C:\Users\Erez\.claude\hooks\auto-approve.js` contains BOTH:
- in `isAtlassianMutatingHttp`: the tokens `--json` and `--upload-file` (and `-T`) in the
  mutating-indicator alternation; and
- `matchAtlassianPutTemplate`: the anchored whole-command template that is the only form in which
  `atlassian-put.ps1` may run, and the only place its sandbox exemption is granted.

(Use the Grep tool — not a shell command, which would name the script and be refused — for
`--upload-file` and `matchAtlassianPutTemplate`. Both present → gate is whole → proceed.)

---

## Step 1 — Enumerate the exact change set

List precisely which fields will change, because **the hook requires one pass per Jira content
field**:
- Clean apply through the MCP tools:
  - Jira: is `summary` changing? is `description` changing? (one pass EACH)
  - Confluence: title and/or body (one pass per page — the Confluence pass is not field-scoped)
- REST apply through `atlassian-put.ps1` (the retained redline): one `rest` pass for that ticket or
  page, covering the whole PUT (target-scoped — see Step 4); no per-field passes
- Any other raw REST write the script does not cover (e.g. creating a Confluence page): one `shell`
  pass (NOT target-scoped — see Step 4)

Mint a pass for every field you will write. Apply all fields of one ticket in a SINGLE
`editJiraIssue` call so the hook consumes the passes atomically — never field-by-field (a second
call could block after the first already wrote, leaving a half-updated ticket).

---

## Step 2 — Draft and preview (rendered)

Goal: show Erez the change as it will actually render, not stripped plain text.

- **Preferred:** fetch the non-sandbox document's rendered form with a **non-mutating REST GET** (no pass
  needed — a GET is not gated):
  - Jira: `GET https://muuula.atlassian.net/rest/api/2/issue/<KEY>?expand=renderedFields`
  - Confluence: `GET …/wiki/rest/api/content/<id>?expand=body.view` (rendered) or `body.storage`
  - Make these GETs with `& "$HOME\.claude\scripts\atlassian-get.ps1" -Url "<url>"` (add
    `-OutFile "<path>"` to save the body; the path must be inside `%TEMP%`, e.g. the session
    scratchpad — the script refuses anywhere else). It reads the Atlassian key from Credential Manager and
    keeps it off the command line; if the key is not stored on this PC it stops and names the
    command Erez runs to store it — pass that on; never read the key sheet or ask for the key.
- **Rich content:** you may also draft the change on the registered `claude-sandbox` ticket or page
  (exempt from the gate — see Step 5 for how) and show its rendered view, so Erez sees true
  formatting/colour.
- Show Erez the BEFORE → AFTER (or redline) and state plainly what will change and where.
- If you cannot obtain a rendered form, show the structured content and say explicitly that it is
  not the rendered view.

---

## Step 3 — Approve

Get Erez's explicit approval of the specific change. At the same time, confirm the **apply mode**:
- **Retained redline (default):** the applied result keeps the strikethrough-old / coloured-new
  marks, so any reader sees what changed. This is the default for every staged edit. Requires the
  REST apply path (the MCP edit tools strip colour marks), which uses a `rest` pass.
- **Clean:** the non-sandbox document ends up with the final text, no change marks. Use only when
  Erez says so for this specific edit.

Default to retained redline; apply clean only on Erez's explicit say-so for the edit at hand.

---

## Step 3.5 — Check for an existing redline (before you apply)

Runs after apply-mode is set in Step 3, for **both** clean and redline applies — a clean apply
silently strips any existing colour/strike marks (Step 5), so you must never apply one over an
unresolved redline without Erez's say-so.

1. **Fetch the current marks correctly, then report to Erez either way.** The Step 2 preview fetch
   is rendered HTML / storage format, not ADF — do not scan it for marks. Do a fresh read of the
   raw content: Jira via a plain REST `GET` of `/rest/api/3/issue/<KEY>?fields=description` (v3
   returns native ADF with `textColor`/`strike` intact — the same mechanism Step 5 documents; a GET
   is not gated); Confluence via `body.storage` (colour/strike appear as its storage styling, not ADF
   marks). Both through `atlassian-get.ps1`. Then
   tell Erez the result — whether you found existing change-marks (and where) **or** found none.
   Always report the not-found case too, so Erez can flag a redline you missed before you apply.
   Detection is a heuristic, not proof: a "none found" is not a guarantee — the scan can miss a
   redline authored a different way (tracked-changes, a different mark pattern, marks nested in a
   table or panel), so Erez's flag overrides your scan.
2. **If no existing redline is found (and Erez flags none):** proceed to Step 4 as normal.
3. **On a hit, stop and ask Erez; never straighten, stack, or flatten on your own.** Present the
   finding and wait for his choice:
   1. **He accepts the existing redline himself** (resolves it in the Jira/Confluence UI) — you
      **re-fetch** to confirm it landed, then apply your edit on the resulting clean baseline.
   2. **He tells you to accept (straighten) it** — flatten it (green additions become normal text,
      red struck-through removals deleted, per the redline-straightening rule in the Documentation
      project's `CLAUDE.md` FORMATTING section), show him the flattened result, get his confirm,
      apply it, then make your edit on that clean baseline. You straighten only on his explicit
      instruction for this edit — never treat detected marks as approved-and-straightenable on your
      own.
   3. **He tells you to stack** the new redline on top of the existing one (available only when your
      edit is itself a redline, not a clean apply) — layer the new marks onto the existing ADF
      (Step 5's layering path), no straightening.
4. The straighten and stack paths still go through the normal mint-pass + apply gate (Steps 4–5) —
   this check adds a decision point ahead of that gate, it does not bypass it.

---

## Step 4 — Mint the pass(es)

A pass is a JSON file in `C:\Users\Erez\.claude-staging\passes\` (create the folder if missing).
This path is OUTSIDE `~/.claude`, so writing it always triggers a permission prompt — that prompt
is Erez's gate. **Mint with the Write tool** (clear path + content in the prompt). One file per
pass; the file name must end in `.json` (the hook ignores any other file).

Pass shapes (fields the hook matches — copy exactly):
- Jira:        `{"surface":"jira","target":"<ISSUE-KEY>","field":"summary","expires":"<ISO>"}`
  (one file per field; `field` is `summary` or `description`)
- Confluence:  `{"surface":"confluence","target":"<pageId>","expires":"<ISO>"}`
- REST script: `{"surface":"rest","target":"<ISSUE-KEY or pageId>","expires":"<ISO>"}` — for an
  `atlassian-put.ps1` call; the target must be exactly the key or page id that call names
- Raw REST:    `{"surface":"shell","expires":"<ISO>"}`  (NO target — see warning; only for a REST
  write `atlassian-put.ps1` does not cover)

`expires` = now + 15 minutes, ISO-8601. Get the timestamp from a read-only
`(Get-Date).ToUniversalTime().AddMinutes(15).ToString("o")` (PowerShell) immediately before
writing. `target` is matched case-insensitively, so any case is fine.

Order:
- Mint all Jira/Confluence/`rest` passes BEFORE the apply call; mint a `rest` pass last, right
  before its `atlassian-put.ps1` call.
- **The `shell` pass has NO target binding** — it satisfies *any* raw Atlassian mutating shell
  command and is single-use. Mint it **last, immediately before** the REST call, and make that call
  the very next action. Never mint it ahead of time (an unrelated Atlassian curl in the 15-min window
  would consume it, or it would unlock an unintended write).

The hook consumes a matching pass by renaming it (`*.consumed.<ts>`) — single use. A leftover
`.consumed.*` file is inert.

---

## Step 5 — Apply

- Retained redline (the default): ONE `atlassian-put.ps1` call carrying the marked-up body,
  immediately after minting its `rest` pass. Issue it in the **PowerShell tool**, ALONE, exactly in
  this form (the hook allows no other):
  `& "$HOME\.claude\scripts\atlassian-put.ps1" -Jira <KEY> -BodyFile "<path to JSON>"`
  or, for a page, `-ConfluencePage <pageId>` in place of `-Jira <KEY>`.
  - The key or page id goes unquoted, a Jira key in capitals as Jira shows it (`MD-1234`, not
    `md-1234`); the body path is a full local path (e.g. `C:\…\body.json`)
    in quotes, using only letters, digits, space and `_ . : \ / -`.
  - The script takes no URL; it builds it itself — Jira `/rest/api/3/issue/<KEY>` (v3, ADF body),
    Confluence `/wiki/rest/api/content/<pageId>` (v1, storage body).
  - **Confluence body:** must carry `version.number` = the page's current version + 1, plus `type`,
    `title` and `body.storage`. Read the current number from a fresh `atlassian-get.ps1` GET of the
    page (a plain GET returns `version`) immediately before building the body; a stale number is
    rejected.
  - Never call the script from another script, loop or job (a wrapper hides the call from the gate;
    the script refuses when it can tell). One target per call.
  - Never run any other shell command that names the script — it is refused, with no override.
    Read or search it with the Read/Grep tools; for git use `git add -A <folder>` and
    `git commit -F <message file>`.
  - Exit status: 0 only for an HTTP 2xx. "PUT rejected" (HTTP 4xx) = nothing was written; fix the
    body, re-mint, retry. "OUTCOME UNKNOWN" (curl failure, timeout, 5xx, no status) = the write may
    have landed — re-fetch the document before deciding anything.
- **Drafting on a sandbox** (the registered ticket or page): the same call with the sandbox key or
  page id — no pass needed. The body must change only that sandbox item itself: no links, parent,
  ancestors or other references that would add or move anything on a real ticket or page, because
  sandbox writes are not reviewed.
- Clean Jira (only when Erez asked for clean on this edit): ONE `editJiraIssue` carrying all changed
  content fields.
- Clean Confluence (only when Erez asked for clean on this edit): ONE `updateConfluencePage`.

**Authoring the retained-redline body (mechanics):** additions in green, removals in red
strikethrough, built with the editor's real list structure so they stay editable. Author as ADF
(`textColor` + `strike` marks) — the Atlassian MCP's markdown can't carry colour and silently strips
it, and it can't read existing marks back (`getJiraIssue` returns markdown even when
`responseContentFormat: adf` is requested). The Jira REST API v3 can: a GET of the `description`
field returns native ADF with `textColor`/`strike` marks intact, and a PUT writes ADF back (both
through the `atlassian-get.ps1` / `atlassian-put.ps1` scripts above). So when layering onto a prior
redline, fetch the existing ADF via REST and add the new marks to it rather than rebuilding blind;
rebuilding from scratch as structured ADF is a valid fallback.

The hook auto-approves the apply when it finds the matching pass(es); you will NOT get a second
prompt for the apply itself.

---

## Step 6 — Verify

Re-fetch the non-sandbox document (MCP read or REST GET) and confirm the change landed — per the global
post-mutation verification rule. Report the result to Erez plainly.

---

## Step 7 — Recovery (failure / expiry)

If the apply is blocked or fails (pass expired because the approval exchange ran long, network
error, MCP timeout, a rejected PUT):
- A consumed pass is gone — do not try to reuse it.
- If the script said OUTCOME UNKNOWN, re-fetch first: the write may already have landed.
- Re-mint a fresh pass (re-prompting Erez) and retry the single apply call.
- Explain to Erez in plain terms ("the edit didn't go through, re-trying with your approval") —
  never leave him staring at a raw hook error.
- Applying in a single call (Step 1/5) means a failure leaves the non-sandbox doc UNchanged, not
  half-changed.

---

## Build / setup state

- Each surface has **one** dedicated sandbox — a dedicated MD ticket, an AN ticket, and one page
  per Confluence space — located by its `claude-sandbox` label. If the lookup returns **more than
  one**, stop and ask. If a surface has **no** sandbox, set one up with Erez's OK before staging on
  it.
- Jira sandboxes (drafting targets, exempt from the gate) are registered in
  `C:\Users\Erez\.claude-staging\sandboxes.json`.
- The **Confluence sandbox is registered by page ID** in the same file's `confluence` array. It is
  populated by looking up the page carrying the `claude-sandbox` label
  (`searchConfluenceUsingCql`, `cql: label = "claude-sandbox"`) and writing its numeric page ID
  into the registry. **If `confluence` is empty, the Confluence draft/preview path is unavailable**
  — populate it first (or skip the sandbox draft and preview via REST GET only). Do not silently
  treat a non-sandbox Confluence page as a sandbox.
- REST writes need the Atlassian key stored on this PC (Credential Manager `claude-atlassian-token`,
  stored by Erez with `~/.claude/scripts/set-claude-key.ps1 -Key atlassian`). If it is missing, the
  scripts stop and name that command — pass it on to Erez; never read the key sheet or ask for the
  key.
