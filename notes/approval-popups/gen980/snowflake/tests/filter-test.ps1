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
  @{ ok = $false; q = "SELECT IDENTIFIER('AI_COMPLETE')('m','hi')" },
  @{ ok = $false; q = "SELECT IDENTIFIER /**/ ('UPP\x45R')('a')" },
  @{ ok = $false; q = "SELECT * FROM TABLE(TO_QUERY('SELECT A\x49_COMPLETE(''m'',''hi'')'))" },
  @{ ok = $false; q = "SELECT SNOWFLAKE.CORTEX.COMPLETE('m','hi')" },
  @{ ok = $false; q = "SELECT `"SNOWFLAKE`".`"CORTEX`".`"COMPLETE`"('m','hi')" },
  @{ ok = $false; q = 'SELECT SYSTEM$CANCEL_ALL_QUERIES(1)' },
  @{ ok = $false; q = 'USE WAREHOUSE RESEARCHING' },
  @{ ok = $false; q = 'ALTER SESSION SET QUERY_TAG = x' },
  @{ ok = $false; q = '(SELECT 1)' },
  @{ ok = $false; q = '-- only a comment' },
  @{ ok = $false; q = '/* unterminated SELECT 1' }
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
"filter cases: $pass passed, $fail wrong"
