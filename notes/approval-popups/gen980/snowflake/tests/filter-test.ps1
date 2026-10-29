. 'C:\Users\Erez\AI Projects\Improve AI Infra\notes\approval-popups\gen980\snowflake\snowflake-read.ps1' -SqlFile 'x'
$an1416 = [IO.File]::ReadAllText('C:\Users\Erez\AppData\Local\Temp\claude\C--Users-Erez-AI-Projects-Improve-AI-Infra\88d16f1c-a32f-4372-b5d7-a53fa190260a\scratchpad\sftests\t8-an1416.sql')
$cases = @(
  @{ ok = $true;  q = 'SELECT 1' },
  @{ ok = $true;  q = "  -- note`n/* c */ select count(*) from t" },
  @{ ok = $true;  q = 'WITH a AS (SELECT 1 AS x) SELECT x FROM a' },
  @{ ok = $true;  q = 'SHOW TABLES IN SCHEMA DATALAKE.MRR ->> SELECT COUNT(*) FROM $1' },
  @{ ok = $true;  q = 'DESC TABLE DATALAKE.MRR.EVENTS' },
  @{ ok = $true;  q = 'describe user CLAUDE_READER' },
  @{ ok = $true;  q = 'EXPLAIN SELECT 1' },
  @{ ok = $true;  q = $an1416 },
  @{ ok = $false; q = 'CREATE SCHEMA SNOWFLAKE_LEARNING_DB.X' },
  @{ ok = $false; q = "/* SELECT */ CREATE STAGE s URL='s3://b/'" },
  @{ ok = $false; q = "-- SELECT`nCOPY INTO @s FROM (SELECT 1)" },
  @{ ok = $false; q = 'SHOW TABLES ->> CREATE TABLE t AS SELECT * FROM $1' },
  @{ ok = $false; q = 'SHOW TABLES ->> SELECT 1 ->> GRANT SELECT ON TABLE t TO ROLE PUBLIC' },
  @{ ok = $false; q = 'WITH p AS PROCEDURE() RETURNS INT LANGUAGE SQL AS $$ BEGIN RETURN 1; END $$ CALL p()' },
  @{ ok = $false; q = 'BEGIN CREATE SCHEMA X; END' },
  @{ ok = $false; q = "EXECUTE IMMEDIATE 'CREATE SCHEMA X'" },
  @{ ok = $false; q = 'CALL DATALAKE.PUBLIC.INVALID_APPLY_AUTOMATIONS()' },
  @{ ok = $false; q = "SELECT AI_COMPLETE('m', 'hi')" },
  @{ ok = $false; q = "select ai_classify(x, ['a','b']) from t" },
  @{ ok = $false; q = "SELECT `"AI_COMPLETE`"('m','hi')" },
  @{ ok = $false; q = "SELECT SNOWFLAKE.CORTEX.COMPLETE('m','hi')" },
  @{ ok = $false; q = 'SELECT SYSTEM$CANCEL_ALL_QUERIES(1)' },
  @{ ok = $false; q = 'USE WAREHOUSE RESEARCHING' },
  @{ ok = $false; q = 'ALTER SESSION SET QUERY_TAG = x' },
  @{ ok = $false; q = '(SELECT 1)' },
  @{ ok = $false; q = '-- only a comment' }
)
$pass = 0; $fail = 0
foreach ($c in $cases) {
  $allowed = $true
  try { Assert-LookOnly $c.q } catch { $allowed = $false }
  if ($allowed -eq $c.ok) { $pass++ } else { $fail++; 'WRONG: expected ' + $(if ($c.ok) { 'allow' } else { 'refuse' }) + ' -> ' + $c.q.Substring(0, [Math]::Min(80, $c.q.Length)) }
}
"filter cases: $pass passed, $fail wrong"
