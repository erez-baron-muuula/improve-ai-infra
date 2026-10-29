param([string]$Script = 'C:\Users\Erez\AI Projects\Improve AI Infra\notes\approval-popups\gen980\snowflake\snowflake-read.ps1')
# Crafted cases for the look-only filter (Get-LookOnlySql). Run in the PowerShell tool.
. $Script -SqlFile 'x'
$an1416 = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 't8-an1416.sql'))
$CR = [string][char]13; $LF = [string][char]10
$cases = @(
  @{ ok = $true;  q = 'SELECT 1' },
  @{ ok = $true;  q = "  -- note`n/* c */ select count(*) from t" },
  @{ ok = $true;  q = "-- note`r`nSELECT 1" },
  @{ ok = $true;  q = 'WITH a AS (SELECT 1 AS x) SELECT x FROM a' },
  @{ ok = $true;  q = 'SHOW TABLES IN SCHEMA DATALAKE.MRR ->> SELECT COUNT(*) FROM $1' },
  @{ ok = $true;  q = 'DESC TABLE DATALAKE.MRR.EVENTS' },
  @{ ok = $true;  q = 'describe user CLAUDE_READER' },
  @{ ok = $true;  q = 'EXPLAIN SELECT 1' },
  @{ ok = $true;  q = "SELECT `tx FROM t" },
  @{ ok = $true;  q = 'SELECT COUNT(*) FROM INFORMATION_SCHEMA.FUNCTIONS WHERE FUNCTION_NAME = ''X''' },
  @{ ok = $true;  q = $an1416 },
  @{ ok = $false; q = 'CREATE SCHEMA SNOWFLAKE_LEARNING_DB.X' },
  @{ ok = $false; q = "/* SELECT */ CREATE STAGE s URL='s3://b/'" },
  @{ ok = $false; q = "-- SELECT`nCOPY INTO @s FROM (SELECT 1)" },
  @{ ok = $false; q = '-- x' + $CR + 'CREATE TABLE t AS' + $LF + 'SELECT 1' },
  @{ ok = $false; q = '-- x' + $CR + 'CREATE SCHEMA SNOWFLAKE_LEARNING_DB.S /*' + $LF + 'SELECT */' },
  @{ ok = $false; q = '// x' + $CR + 'COPY INTO @s FROM t' + $LF + 'SELECT 1' },
  @{ ok = $false; q = '-- x' + [string][char]0x0B + 'CREATE TABLE t AS' + $LF + 'SELECT 1' },
  @{ ok = $false; q = '-- x' + [string][char]0x85 + 'CREATE TABLE t AS' + $LF + 'SELECT 1' },
  @{ ok = $false; q = '-- x' + [string][char]0x2028 + 'CREATE TABLE t AS' + $LF + 'SELECT 1' },
  @{ ok = $false; q = '-- x' + [string][char]0x2029 + 'CREATE TABLE t AS' + $LF + 'SELECT 1' },
  @{ ok = $false; q = 'SHOW TABLES ->> CREATE TABLE t AS SELECT * FROM $1' },
  @{ ok = $false; q = 'SHOW TABLES ->> -- x' + $LF + 'CREATE TABLE t AS SELECT * FROM $1' },
  @{ ok = $false; q = 'SHOW TABLES ->> /* SELECT */ CREATE TABLE t AS SELECT * FROM $1' },
  @{ ok = $false; q = 'SHOW TABLES ->> SELECT 1 ->> GRANT SELECT ON TABLE t TO ROLE PUBLIC' },
  @{ ok = $false; q = 'SHOW TABLES ->> SELECT_X' },
  @{ ok = $false; q = 'SELECT_X 1' },
  @{ ok = $false; q = 'WITH p AS PROCEDURE() RETURNS INT LANGUAGE SQL AS $$ BEGIN RETURN 1; END $$ CALL p()' },
  @{ ok = $false; q = 'WITH p AS/**/PROCEDURE() RETURNS INT LANGUAGE SQL AS $$ BEGIN RETURN 1; END $$ CALL/**/p()' },
  @{ ok = $false; q = 'BEGIN CREATE SCHEMA X; END' },
  @{ ok = $false; q = "EXECUTE IMMEDIATE 'CREATE SCHEMA X'" },
  @{ ok = $false; q = 'CALL DATALAKE.PUBLIC.INVALID_APPLY_AUTOMATIONS()' },
  @{ ok = $false; q = "SELECT AI_COMPLETE('m', 'hi')" },
  @{ ok = $false; q = "select ai_classify(x, ['a','b']) from t" },
  @{ ok = $false; q = "SELECT `"AI_COMPLETE`"('m','hi')" },
  @{ ok = $false; q = "SELECT AI_COMPLETE/* c */('m','hi')" },
  @{ ok = $false; q = "SELECT AI_COMPLETE -- c`n('m','hi')" },
  @{ ok = $false; q = 'SELECT AI_COMPLETE' + [string][char]0x200B + "('m','hi')" },
  @{ ok = $false; q = 'SELECT AI_COMPLETE' + [string][char]0xFEFF + "('m','hi')" },
  @{ ok = $true;  q = "SELECT 'caf" + [string][char]0xE9 + "' AS word" },
  @{ ok = $false; q = "SELECT IDENTIFIER('AI_COMPLETE')('m','hi')" },
  @{ ok = $false; q = 'SELECT summarize_agg(review) FROM t' },
  @{ ok = $false; q = "SELECT * FROM TABLE(SNOWFLAKE.ML.BULK_PROCESS_DOCUMENT('@s', 'm'))" },
  @{ ok = $false; q = 'SELECT * FROM TABLE("SNOWFLAKE" . "ML".TOP_INSIGHTS(a, b))' },
  @{ ok = $false; q = "SELECT SNOWFLAKE.NOTIFICATION.TEXT_PLAIN('x')" },
  @{ ok = $false; q = "SELECT my_model!PREDICT(GET_PRESIGNED_URL(@s, 'f.pdf'), 1)" },
  @{ ok = $false; q = "SELECT svc!SEARCH /* c */ ('q')" },
  @{ ok = $false; q = 'SELECT my_model!"PREDICT"(x, 1)' },
  @{ ok = $false; q = 'SELECT my_model ! /* c */ PREDICT(x, 1)' },
  @{ ok = $true;  q = "SELECT 'Hello! World' AS greeting" },
  @{ ok = $false; q = 'SELECT MODEL(db.sch.m)!"PREDICT"(col) FROM db.sch.t' },
  @{ ok = $false; q = 'SELECT my_service!"predict"(col) FROM t' },
  @{ ok = $false; q = 'SELECT * FROM SNOWFLAKE.MODELS."ARCTIC-EXTRACT"' },
  @{ ok = $false; q = 'WITH mv AS MODEL db.sch.m VERSION v1 SELECT mv!"predict"(c) FROM t' },
  @{ ok = $false; q = 'SELECT * FROM (WITH p AS PROCEDURE () RETURNS TABLE () LANGUAGE SQL AS $$ SELECT 1 $$ SELECT * FROM TABLE(p()))' },
  @{ ok = $true;  q = 'SELECT COUNT(*) FROM t WHERE a != (SELECT 1) AND b <> 2' },
  @{ ok = $true;  q = 'SELECT * FROM SNOWFLAKE.ACCOUNT_USAGE.TASK_HISTORY LIMIT 1' },
  @{ ok = $false; q = "SELECT IDENTIFIER /**/ ('UPP\x45R')('a')" },
  @{ ok = $false; q = "SELECT * FROM TABLE(TO_QUERY('SELECT A\x49_COMPLETE(''m'',''hi'')'))" },
  @{ ok = $false; q = "SELECT SNOWFLAKE.CORTEX.COMPLETE('m','hi')" },
  @{ ok = $false; q = "SELECT `"SNOWFLAKE`".`"CORTEX`".`"COMPLETE`"('m','hi')" },
  @{ ok = $false; q = 'SELECT SYSTEM$CANCEL_ALL_QUERIES(1)' },
  @{ ok = $false; q = 'USE WAREHOUSE RESEARCHING' },
  @{ ok = $false; q = 'ALTER SESSION SET QUERY_TAG = x' },
  @{ ok = $false; q = '(SELECT 1)' },
  @{ ok = $false; q = '-- only a comment' },
  @{ ok = $false; q = '/* unterminated SELECT 1' },
  @{ ok = $false; q = '/*/ SELECT */ CREATE SCHEMA a' },
  @{ ok = $false; q = '/*/ x */ CREATE SCHEMA a' },
  @{ ok = $false; q = 'SELECT 1' + [string][char]0x90 },
  @{ ok = $true;  q = 'SELECT COUNT(*) FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AI_FUNCTIONS_USAGE_HISTORY' },
  @{ ok = $true;  q = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'gen980-measure.sql')) }
)
$pass = 0; $fail = 0
foreach ($c in $cases) {
  $allowed = $true
  try { [void](Get-LookOnlySql $c.q) } catch { $allowed = $false }
  if ($allowed -eq $c.ok) { $pass++ } else { $fail++; 'WRONG: expected ' + $(if ($c.ok) { 'allow' } else { 'refuse' }) + ' -> ' + ($c.q.Substring(0, [Math]::Min(80, $c.q.Length)) -replace '[\x00-\x1F\x85]', '?') }
}
# The text sent must start with the first word itself (leading comments removed).
$sent = Get-LookOnlySql "-- a`n/* b */  SELECT 1"
if ($sent -cne 'SELECT 1') { $fail++; 'WRONG: sent text is [' + $sent + ']' } else { $pass++ }
# A long run of comments after an AI-like name must not make the check hang (backtracking).
$slow = 'SELECT AI_X' + ('/**/' * 60) + ' FROM t'
$sw = [Diagnostics.Stopwatch]::StartNew()
try { [void](Get-LookOnlySql $slow) } catch { }
if ($sw.Elapsed.TotalSeconds -gt 1) { $fail++; 'WRONG: comment run took ' + [int]$sw.Elapsed.TotalSeconds + ' s' } else { $pass++ }
# PS 5.1 reads a BOM-less script as Windows-1252, so the script itself must be pure ASCII.
$bytes = [IO.File]::ReadAllBytes($Script)
$nonAscii = @($bytes | Where-Object { $_ -gt 0x7E -or ($_ -lt 0x20 -and $_ -ne 9 -and $_ -ne 10 -and $_ -ne 13) }).Count
if ($nonAscii -ne 0) { $fail++; "WRONG: the script holds $nonAscii non-ASCII or control bytes" } else { $pass++ }
"filter cases: $pass passed, $fail wrong"
