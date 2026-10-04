# GEN-638 step 2 — redesign of the held Atlassian write path

## In plain terms (what approving this means for you)
- **What's on hold:** the piece that lets Claude save a coloured redline edit straight into Jira or Confluence, using the Atlassian key from your PC's password store. It stopped because the safety check meant to catch "this edit needs your approval" kept being fooled. The check read the web address Claude typed, and three times a reviewer found a way to write an address that *looked* like the practice ticket while really pointing at a real one.
- **The fix:** the save script will no longer take a web address at all. It takes only a ticket key (like `MD-1234`) or a Confluence page number, and builds the address itself. Keys and page numbers are plain letters, digits and dashes, so there is nothing to disguise: what the safety check reads is exactly what the script uses.
- **What you'll notice:** nothing new. Redline edits to real tickets still need your approval each time. One improvement: that approval will be tied to the specific ticket or page, not a blanket "any Atlassian edit" approval as today.
- **Still needs you later (unchanged):** storing the Atlassian key on each PC with the helper command. Until then the script stops and gives you that command. The final real save test on the practice ticket waits for that.
- **What it still can't stop:** Claude deliberately disguising the script's name, or writing its own code to do the save. No safety check that works by reading commands can see that. You accepted this limit on 2026-09-30, and it is unchanged.
- **Review:** an independent panel of three reviewers checked this plan over two rounds. They found two real problems, and both are fixed:
  - the install order would have left a gap;
  - Confluence saves were missing a required version number.
  - They also raised the disguised-name trick. They then agreed it is the known limit above, not a new hole. A test now records it.
- **Effort: xhigh.** This decides whether an edit can skip your approval, so it goes through the full review process.

## Context
[GEN-638](https://app.notion.com/p/3b26e495d07c81f68d1aebc8428e377b) step 2 ([GEN-163](https://app.notion.com/p/3756e495d07c80c0bd21d87990523acb)) shipped on 2026-09-30, except the Atlassian write path. That path is `atlassian-put.ps1`, the staging-gate changes in `~/.claude/hooks/auto-approve.js`, and the `staging` skill text. It failed independent code review (Pass B) three times, because the sandbox exemption was a text match on a free-form `-Url`. Each patch was beaten by a form where the command text differed from what PowerShell or curl actually uses: a quote splice `MD-3649'/../MD-1'`, `%2e%2e`, and `MD-3649'0'`. The `/vet-code` rule says to stop and redesign, not patch again. Spec: `notes/gen638/step2-approach.md` STATUS. Held files: `notes/gen638/step2-held/`.

**Root cause:** the hook and the script read the target differently (hook = raw text, script = the value after PowerShell parsing, curl = the URL after normalisation). Any design that matches a URL in text has this gap.

**Redesign principle:** remove the free-form URL, so that the text the hook reads is provably the value the script receives.

**Alternatives considered and rejected:**
- *Moving the sandbox and pass decision into the script.* This duplicates the pass and registry logic in a second runtime, which recreates the two-readers problem.
- *Dropping the REST sandbox exemption entirely.* This would force a pass for every practice-ticket draft. That breaks low-stakes drafting for no security gain, since the bareword template makes the exemption sound.

## Design

### 1. `atlassian-put.ps1` (new file, `~/.claude/scripts/`; starting point `step2-held/atlassian-put.ps1`)
- Replace `-Url` with two mutually exclusive parameter sets, plus `-BodyFile`:
  - `-Jira <KEY>`: the key must fully match `\A[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,6}\z` (case-sensitive). The URL is built as `https://muuula.atlassian.net/rest/api/3/issue/<KEY>`. This is v3, the ADF endpoint the redline flow actually used (Documentation `HISTORY.md` ~line 611). The held text said v2, which is wrong for ADF.
  - `-ConfluencePage <id>`: the id must fully match `\A[1-9][0-9]{0,15}\z`. At most 16 digits, so a bare number is parsed exactly, never as a rounded double. The URL is built as `https://muuula.atlassian.net/wiki/rest/api/content/<id>` (v1, as used before).
- No query string, no URL parameter, nothing that is concatenated without validation.
- Everything else stays as already reviewed:
  - the key comes from Credential Manager;
  - a temp curl config with `-q -K` carries the key;
  - `finally` deletes the temp file, and a 10-minute sweep removes leftovers;
  - the method is fixed to PUT;
  - `-g`, ASCII-only.
- Header usage line: `& "$HOME\.claude\scripts\atlassian-put.ps1" -Jira MD-1234 -BodyFile "<path>"`.

### 2. Staging gate (`~/.claude/hooks/auto-approve.js`, in `enforceStaging`, live ~line 835)
- **New, checked first: `matchAtlassianPutTemplate(command)`.** It returns `{kind, target}` only if the WHOLE command matches one anchored template, and otherwise returns null.
  - The form is: `& "$HOME\.claude\scripts\atlassian-put.ps1" -(Jira|ConfluencePage) <target> -BodyFile <'path' or "path">`.
  - Separators are spaces and tabs only, and the command is rejected if it contains `\r` or `\n`.
  - `<target>` is an unquoted bareword in the same charset and pattern as the script's validators. A bareword of `[A-Za-z0-9-]` cannot expand, splice or carry a second value in PowerShell, which closes all three Pass B attacks by construction.
  - The body path, inside its quotes, excludes `` ` ``, `$`, both quote characters, `;`, `|`, `&`, `<` and `>`.
  - Parameter names must be exact and in that order. Abbreviated (`-J`), colon (`-Jira:X`) and non-ASCII-dash forms do not match.
- **Decision for any Bash, PowerShell or Monitor command that contains `atlassian-put`:**
  - The tool is PowerShell and the template matches:
    - the captured target is lowercased and tested by exact set membership (`reg.jira.includes(t)` / `reg.confluence.includes(t)`), never by a whole-command scanner;
    - target in the sandbox registry (`jira` list for `-Jira`, `confluence` list for `-ConfluencePage`) → exempt (return);
    - otherwise → it needs an unexpired pass `{"surface":"rest","target":"<target>"}`, matched case-insensitively. Consume it and approve. With no pass, `blockStaging`.
  - Anything else → hard refuse (exit 2), with nothing consumed. The refusal message shows the one allowed form and says: to inspect the file, use the Read or Grep tools, not a shell command. This covers non-template shapes, the Bash-tool form, Monitor, other paths and copies, and incidental mentions such as `cat` or `git add <that file>`.
    - The existing `configUnlocked()` break-glass clears this refusal only. It is a mechanical refusal, not a content judgement, so this keeps the GEN-641 precedent of not creating a lock-out with no escape. A pass miss on a template call stays unbreakable.
- **Existing raw-curl / `Invoke-RestMethod` arm (`isAtlassianMutatingHttp`):**
  - Drop its sandbox exemption (live line 902), and delete `commandReferencesSandbox`, which then has no caller. A raw Atlassian write now always needs a `shell` pass, whatever URL it names. This closes the `-K`, `.curlrc` and `--variable` class too.
  - Add `Monitor`: an Atlassian write detected in a Monitor command is hard-refused (Monitor is never a sanctioned write path). This avoids the open question of which shell's chain rules apply to Monitor.
  - The chained / multi-line handling for Bash and PowerShell is unchanged.
- **Not taken from `held-hook-changes.diff`:** the `atlassian-put` line inside `isAtlassianMutatingHttp`, and `commandTargetsOnlySandbox`. The new branch replaces both. The guard-only parts of the live hook are untouched.

### 3. `atlassian-get.ps1` — no change
- It cannot write, and its host check is already anchored (`https://muuula.atlassian.net/` followed directly by `/`), so the key cannot be sent elsewhere.
- Adding the `..`/`%` refusal from the hold note would buy no security, and would cost another vet cycle on a shipped and verified script.

### 4. `staging/SKILL.md` text (`/vet-rule`; start from `step2-held/staging.SKILL.reviewed.md`)
- **Step 0 integrity grep:**
  - add `matchAtlassianPutTemplate`;
  - drop the `commandReferencesSandbox` / `(?<![a-z0-9])` item, which would otherwise fail-close forever once that function is deleted;
  - drop `commandTargetsOnlySandbox` and the `atlassian-put`-in-`isAtlassianMutatingHttp` item;
  - keep the whole existing write-indicator bullet (`--json` / `-T` / `--upload-file`) unchanged.
- **Step 1 / Step 4 pass shapes:**
  - add the `rest` pass `{"surface":"rest","target":"<KEY or pageId>","expires":"<ISO>"}`, target-bound;
  - the `shell` pass stays only for a raw REST call, such as page creation, which these scripts do not cover.
- **Step 5:** the retained-redline PUT is `& "$HOME\.claude\scripts\atlassian-put.ps1" -Jira <KEY> -BodyFile "<json>"` (or `-ConfluencePage <id>`), as ONE command on its own in the PowerShell tool.
  - Fix the endpoint text: Jira v3 for ADF.
  - **Confluence body:** v1 content PUT requires `version.number` = the current version + 1, plus `type`, `title` and `body.storage`. Read the current number from a fresh `atlassian-get` GET of the page immediately before building the body. A plain GET already returns `version`, so no `expand` is needed. A stale number is rejected, and the call then needs a re-mint.
- **Step 2:** the GETs go through `atlassian-get.ps1`. This is already in the reviewed text.
- **Sandbox drafting:** use the same `atlassian-put` call with the sandbox key. It is exempt, so no pass is needed.

## Install order
1. **`auto-approve.js` first**, via `/vet-code` + `update-config.ps1`, with the diff passed by file path.
   - The live hook cannot recognise the new URL-free call: there is no `atlassian.net` in its text, so it would fall through to approval. So the script must not exist before its gate does.
   - Until the script is installed, the new branch only refuses things, which is harmless.
   - From this point on, any shell command that spells out `atlassian-put` (`git add <that file>`, `cat`) is refused. For bookkeeping, use the Write, Read and Grep tools, and `git add -A <folder>`.
2. **`atlassian-put.ps1`** via `/vet-code`, written with the Write tool. That is not a shell command, so the new refusal does not touch it.
   - Unit-test the script's validators on a scratchpad working copy whose file name does NOT contain `atlassian-put` (e.g. `ap-put.working.ps1`). Otherwise the hook refuses the test commands.
   - Delete that copy once the tests pass.
3. `staging/SKILL.md` via `/vet-rule`. This is what first points sessions at the script.
4. Bookkeeping:
   - replace `step2-held/` with the shipped versions;
   - update `step2-approach.md` STATUS, `HANDOFF.md` and the `gen638-bundle` memory;
   - HISTORY via `/loghistory` or `/wrap`;
   - a note on GEN-163.

## Verification
- **Hook fixtures** (rewrite `step2-held/test-hook-fixtures.js`, driving the real hook via `spawnSync`):
  - template + sandbox → exempt;
  - template + non-sandbox, no pass → blocked;
  - with a matching `rest` pass → approved, and that pass is consumed;
  - a pass for a different target → blocked, and it is not consumed.
  - **Attack corpus, all refused or blocked with nothing consumed:**
    - the three Pass B forms;
    - `%2e%2e`;
    - quoted or `$()` or backtick targets;
    - `-J`, `-Jira:`, an en-dash `–Jira`;
    - a second target;
    - trailing args, `;`, `&&`, a newline;
    - the Bash form `powershell -File …`;
    - Monitor;
    - a script copy under TEMP;
    - `.\atlassian-put.ps1`;
    - a 17-digit page id;
    - a lowercase or homoglyph key.
  - **Curl arm:** a sandbox URL now needs a `shell` pass; a Monitor curl write is refused; the existing chained / multi-line fixtures are unchanged.
  - **Key-sheet guard:** its 35 fixtures still pass.
  - **Known-accepted residual, pinned:** a fixture for `& ("…atlassian-pu" + "t.ps1") -Jira MD-1 …` asserts today's outcome, which is that the gate does not match. A future change that alters it then shows up in the test.
  - **Drift check:** a fixture reads the target-validator regexes out of the installed `atlassian-put.ps1` and runs the same accept/reject corpus through them and through the hook template. Both must agree on every case, so the hook and the script cannot silently diverge later.
- **Real-traffic replay** (/vet-code Step 4): live vs working hook over past calls, counts only. Every changed decision must be intended.
- **Script:**
  - bad keys and page ids are refused before any key read;
  - with no key stored, it gives the "not set up — run the helper" message;
  - a `/vet-code` Step 3 secret-on-command-line check.
- **Live, now (no key needed).** First re-check with `set-claude-key.ps1 -List` that no Atlassian key is stored, so these runs cannot write. If one is stored, skip the non-sandbox case.
  - the PowerShell template on sandbox `MD-3649` runs and stops at "key not set up", which proves the exemption and the script path;
  - a non-sandbox key with no pass is refused by the hook;
  - with a `rest` pass, it is approved, the pass is consumed, and the script stops at the key read (nothing is written).
- **Live, after Erez stores the Atlassian key:** add this to the handoff as a pending check.
  - One real PUT on Jira sandbox `MD-3649`, then a re-fetch to confirm.
  - One on the Confluence sandbox page `1182400513`, with the version increment, then a re-fetch to confirm.

## Residual
- **Deliberate evasion is not caught by any text gate.** Examples: a script name assembled at run time (`& ("…atlassian-pu" + "t.ps1") …`), a renamed copy, or Claude's own few lines of REST code reading the key from Credential Manager.
  - This was an accepted residual in the approved step 2 design (`step2-approach.md` Residual, "Name obfuscation", 2026-09-30).
  - Closing it for this one script would not close the class: the own-code route stays open, and no text match can see it.
  - What this redesign fixes is different: the gate's own exemption logic being wrong for a call it *does* recognise. That is what Pass B broke three times.
- Raw REST writes not covered by the scripts (e.g. Confluence page creation by POST) still use the untargeted `shell` pass.
- An incidental shell mention of `atlassian-put` is refused (the break-glass clears it). Use the Read and Grep tools instead.
