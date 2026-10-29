# GEN-980 lever (e) + GEN-953 step 4 — look-only Snowflake login: HAND-OVER (2026-10-29)

Read this first. Approved plan: `C:\Users\Erez\.claude\plans\piped-shimmying-octopus.md` (Erez approved it 2026-10-28; converged /check, 2 rounds). Tickets: GEN-980 (In Progress), GEN-953 step 4. Neither ticket has this build recorded yet.

## What exists now

**Snowflake (account `IUTDPNK-QL40012`, host `iutdpnk-ql40012.snowflakecomputing.com`, account TIMEZONE = UTC):**
- Role `CLAUDE_READ`: USAGE on DATALAKE + MEMORY_PIRATES and their 8 schemas; SELECT on all + future tables/views (db and schema level); database roles SNOWFLAKE.USAGE_VIEWER, GOVERNANCE_VIEWER, OBJECT_VIEWER. No procedure/function USAGE.
- Warehouse `CLAUDE_WH` (X-Small, auto-suspend 60 s, statement timeout 300 s) with resource monitor `CLAUDE_MONITOR` (10 credits/month, notify 80%, suspend-immediate 100%).
- User `CLAUDE_READER` (TYPE=SERVICE), named key pair `CLAUDE_PC_1` with ROLE_RESTRICTION CLAUDE_READ, PREVENT_UNLOAD_TO_INLINE_URL = TRUE and PREVENT_UNLOAD_TO_INTERNAL_STAGES = TRUE (user level).
- Erez's Snowsight workspace has a worksheet `claude-reader-setup.sql` (scratch; holds the last ALTER USER).
- As-run SQL and notes: `setup.sql` in this folder.

**This PC:**
- Private key in Windows Credential Manager `claude-snowflake-reader` (base64 PKCS#8 DER, one line, 1624 chars), made by `snowflake-reader-setup.ps1` (this folder; Erez ran it; reviewed by an independent Opus reviewer, PASS). Public key + fingerprint in `%TEMP%\snowflake-reader-public-key.txt` (fp `SHA256:/4sNlkVof4Vk1QLAuV6ZaZayaNnFNxxBoGDybIF7wSI=`).
- Read script WORKING COPY: `snowflake-read.ps1` (this folder) — NOT installed. SQL API + key-pair JWT signed with .NET RSACng; Windows certificate checks ON. (ODBC route abandoned: .NET 1024-char connection-string cap, and the driver's own CA list rejects Avast Web/Mail Shield's re-signing root.)
- Working copies, NOT installed: `wc/auto-approve.js` (adds `isSafeSnowflakeRead`, exact-match rule, + wiring line; node --check OK), `wc/set-claude-key.ps1` (adds `'snowflake-reader' = 'claude-snowflake-reader'` to $KeyTargets + `$SetupCommands` hint; tested: -List, ValidateSet refusal, tripwire inventory). Combined diff: `wc/vet.diff` (rebuild before review: the read script changed after it).
- `notes/gen638/step3/test-key-leak-tripwire.ps1` line 73 already updated to expect the 4th key.

## Tests passed (all through the read script as CLAUDE_READER)
Who-am-I; count matches Snowsight (INVALID_EVENTS 27,269); 200,000-row multi-page result complete (8 s); SHOW works; CREATE TABLE / UPDATE / GRANT refused (privilege); two statements refused; COPY INTO s3 inline URL refused (001081); COPY INTO @~ refused (003191); dates formatted, UTC; 8 Nov AN-1416 query works with `routine_md5` from SNOWFLAKE.ACCOUNT_USAGE.PROCEDURES = e89a77547a1bf0c2a395fc7cf06b0f4a (matches the expected value).

## Reviews so far (/vet-code)
- Design /check (plan panel) reviewer ids: a8412708211f4c6aa, ac22649694ade73c2, a9673474e5b0f126b (round 1), a38d240f91e93bd23, a8a161747178db6a2, a74c280baace0b742 (round 2). Session 88d16f1c-a32f-4372-b5d7-a53fa190260a — their transcripts are in THAT session's subagents folder; a new session must follow /vet-code Step 6's rules for cross-session evidence (GEN-687 is open on exactly this) or re-run /check on the design.
- Pass A (in-session /code-review high) x2; Pass B (independent Opus) x2: a88bdee73ccdea338, a96cb0c20c60b2a65.
- Pass B round 2 found (REVISE): Snowflake's PUBLIC role (inherited by every role) gives CLAUDE_READ (a) SNOWFLAKE_LEARNING_ROLE = CREATE SCHEMA in SNOWFLAKE_LEARNING_DB — CONFIRMED live (a probe schema was created and dropped) — enabling own-schema + named external stage + COPY INTO = data out with no prompt; (b) CORTEX_USER / USE AI FUNCTIONS = AI spend outside CLAUDE_MONITOR; also USAGE/OPERATE on warehouse RESEARCHING.
- FIX applied in the working copy (NOT yet independently reviewed): `Assert-LookOnly` — statement must start with SELECT/WITH/SHOW/DESC/DESCRIBE/EXPLAIN after leading comments; every `->>` step after the first must be SELECT; WITH may not contain `AS PROCEDURE/FUNCTION` or CALL; refuses CORTEX, `AI_xxx(` and `SYSTEM$`. Tests: 26/26 crafted cases (`scratchpad` filter-test.ps1 — copy below); real-corpus replay of 154 statements Claude sent to Snowsight in 30 days: all 26 real writes refused, 122 reads allowed, 0 real reads refused (4 USE + 1 stray word refused). Also: row cap 2,000,000, control chars stripped on screen, .partial + rename, 7-day pruning, link rejection, JWT in script scope, cancel after 420 s.
- Known gap: reads that call Erez's own UDFs (e.g. MEMORY_PIRATES.LEXICON.OBJECT_MERGE) fail for CLAUDE_READ (no function USAGE, by design) and stay in Snowsight.

## Remaining steps, in order
1. **Independent review of the filter** (Erez chose this; xhigh): rebuild `wc/vet.diff`, Pass B (check-reviewer, `model: opus`) + Pass A. Brief: try to get a write, data-out, or AI spend past `Assert-LookOnly` in one statement.
2. **Install card** to Erez (/vet-code Step 5), then install IN THIS ORDER: (a) create `C:\Users\Erez\.claude\scripts\snowflake-read.ps1` from the working copy (new file, Write tool); (b) add `'c:\\users\\erez\\.claude\\scripts\\snowflake-read.ps1'` to PROTECTED_FILES in `wc/auto-approve.js` (Pass B advisory; PROTECTED_FILES blocks even creation, so the script must exist first), re-check, then install auto-approve.js via `update-config.ps1 -Op write-file -ContentFile` with a vetting pass; (c) install set-claude-key.ps1 the same way. Verify hashes; live-fire the approve rule.
3. **Notes** (/check + Erez approval): one line in the Snowsight bullet of `~/.claude/hooks/refs/browser.md` (look-only queries go through `snowflake-read.ps1`, tool timeout 480000 ms; Snowsight for changes/admin; size now ~8,9xx/10,000 — measure) and one line in the Memory Islands Dev `CLAUDE.md`.
4. **8 Nov check** (`~/.claude/scheduled-tasks/an1415-backups-check/SKILL.md`, fires 2026-11-08 09:00): switch its query to the script (query text in `scratchpad`-copy `t8-an1416.sql` below — uses ACCOUNT_USAGE.PROCEDURES filtered on catalog/schema/DELETED IS NULL), tool timeout 480000; keep the run-once guard, email and Jira steps.
5. **Erez's separate decision** (one question, plain words): revoke from Snowflake's PUBLIC role (affects every login) SNOWFLAKE_LEARNING_ROLE and SNOWFLAKE.CORTEX_USER, optionally REQUIRE_STORAGE_INTEGRATION_FOR_STAGE_CREATION/OPERATION = TRUE; check usage first (SHOW SCHEMAS IN DATABASE SNOWFLAKE_LEARNING_DB; Cortex use in QUERY_HISTORY; SHOW STAGES IN ACCOUNT). Optional: `ALTER USER CLAUDE_READER SET DEFAULT_SECONDARY_ROLES = ()`.
6. **Record** on GEN-980 and GEN-953 (/vet-ticket): what was built, test results, the PUBLIC-role finding and its fix, the measurement plan (count CLAUDE_READER queries by USER_NAME, not by tag — piped SHOW sub-statements run untagged), Done-when per the tickets.

## Test files (copied here from the session scratchpad)
See `tests/` in this folder: filter-test.ps1, filter-realism.ps1 + extract-sql.js (corpus), t3-check.ps1, t8-an1416.sql. They still name the old session's scratchpad paths (corpus JSON, sftests folder): repoint those to your own scratchpad, re-run extract-sql.js first to rebuild the corpus.
