// GEN-892: build the working copies of the live hooks and scripts this change edits, from the live files,
// by exact-text replacements (each must match exactly once). Writes notes/gen892/wc/. Reads only the live files.
'use strict';
const fs = require('fs');
const path = require('path');

const HOOKS = 'C:/Users/Erez/.claude/hooks';
const WC = path.join(__dirname, 'wc');

function edit(src, dst, pairs) {
  let text = fs.readFileSync(src, 'utf8');
  // Every target uses CRLF line endings; write the replacements the same way.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  for (const [rawFrom, rawTo] of pairs) {
    const from = rawFrom.replace(/\r?\n/g, eol);
    const to = rawTo.replace(/\r?\n/g, eol);
    const n = text.split(from).length - 1;
    if (n !== 1) throw new Error(path.basename(src) + ': expected 1 match, found ' + n + ' for: ' + from.slice(0, 80));
    text = text.replace(from, () => to);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, text, 'utf8');
  console.log('wrote', dst);
}

// ---- inject-notion-refs.js and inject-shell-refs.js (same constants and cut note) ----
const CAP_OLD =
  "const CAP = 10000;  // Claude Code's per-string limit on injected text\n" +
  "const KEEP = 9000;  // over the cap, keep whole lines up to this many characters\n";
const CAP_NEW =
  "// Claude Code's per-string limit on injected text. Since GEN-892 it follows notes/anthropic-guidelines.json\n" +
  "// (hook-injected-text) through guidelines-limits.js; FALLBACK_CAP is used when that cannot be read.\n" +
  "const FALLBACK_CAP = 10000;\n" +
  "let CAP = FALLBACK_CAP;\n" +
  "try {\n" +
  "  const c = require('./guidelines-limits.js').readLimit('hook-injected-text', { fallback: FALLBACK_CAP, min: 2000, max: 100000 }).value;\n" +
  "  if (Number.isInteger(c)) CAP = c;\n" +
  "} catch (e) { /* missing or broken reader: keep the fallback */ }\n" +
  "const KEEP = CAP - 1000;  // over the cap, keep whole lines up to this many characters\n" +
  "const fmtNum = n => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');\n";
const NOTE_OLD_1 = "characters, over the 10,000-character limit on injected text, so only the lines above are included.";
const NOTE_NEW_1 = "characters, over the ' + fmtNum(CAP) + '-character limit on injected text, so only the lines above are included.";
const NOTE_OLD_2 = "needs splitting: it is over the 10,000-character limit.)';";
const NOTE_NEW_2 = "needs splitting: it is over the ' + fmtNum(CAP) + '-character limit.)';";

for (const name of ['inject-notion-refs.js', 'inject-shell-refs.js']) {
  edit(path.join(HOOKS, name), path.join(WC, 'hooks', name), [[CAP_OLD, CAP_NEW], [NOTE_OLD_1, NOTE_NEW_1], [NOTE_OLD_2, NOTE_NEW_2]]);
}

// ---- inject-topic-refs.js ----
edit(path.join(HOOKS, 'inject-topic-refs.js'), path.join(WC, 'hooks', 'inject-topic-refs.js'), [
  [CAP_OLD, CAP_NEW],
  [NOTE_OLD_1, NOTE_NEW_1],
  [NOTE_OLD_2, NOTE_NEW_2],
  ["left out to stay under the 10,000-character limit on injected text: ' +",
   "left out to stay under the ' + fmtNum(CAP) + '-character limit on injected text: ' +"],
]);

// ---- inject-browser-refs.js ----
edit(path.join(HOOKS, 'inject-browser-refs.js'), path.join(WC, 'hooks', 'inject-browser-refs.js'), [
  ["const INJECT_CAP = 9500; // under Claude Code's 10,000-character limit on injected text\n",
   "// 500 under Claude Code's per-string limit on injected text, which since GEN-892 follows\n" +
   "// notes/anthropic-guidelines.json (hook-injected-text) through guidelines-limits.js.\n" +
   "const FALLBACK_NOTES_CAP = 10000;\n" +
   "let INJECT_CAP = FALLBACK_NOTES_CAP - 500;\n" +
   "try {\n" +
   "  const c = require('./guidelines-limits.js').readLimit('hook-injected-text', { fallback: FALLBACK_NOTES_CAP, min: 2000, max: 100000 }).value;\n" +
   "  if (Number.isInteger(c)) INJECT_CAP = c - 500;\n" +
   "} catch (e) { /* missing or broken reader: keep the fallback */ }\n"],
]);

// ---- sessionstart-backup-surfacer.js ----
edit(path.join(HOOKS, 'sessionstart-backup-surfacer.js'), path.join(WC, 'hooks', 'sessionstart-backup-surfacer.js'), [
  ["for (const check of [projectBackupStaleLine, sessionBackupStaleLine, accountSyncStaleLine, rulesFileSizeLine, sizeStopIntactLine]) {",
   "for (const check of [projectBackupStaleLine, sessionBackupStaleLine, accountSyncStaleLine, rulesFileSizeLine, sizeStopIntactLine, guidelinesLimitsLine]) {"],
  ["const MAX_CONTEXT_CHARS = 9000;\n",
   "// Claude Code's per-string limit on hook text, minus 1,000 of room. Since GEN-892 the limit follows\n" +
   "// notes/anthropic-guidelines.json (hook-injected-text) through guidelines-limits.js; see guidelinesLimitsLine.\n" +
   "const FALLBACK_NOTES_CAP = 10000;\n" +
   "const NOTES_CAP_OPTS = { fallback: FALLBACK_NOTES_CAP, min: 2000, max: 100000 };\n" +
   "let limitsReader = null;\n" +
   "let limitsReaderError = null;\n" +
   "try { limitsReader = require('./guidelines-limits.js'); } catch (e) { limitsReaderError = (e && (e.code || e.message)) || 'unknown error'; }\n" +
   "function readLimitSafe(id, opts) {\n" +
   "  if (!limitsReader) return { value: opts.fallback, error: 'the shared reader hooks/guidelines-limits.js could not be loaded (' + limitsReaderError + ')' };\n" +
   "  try {\n" +
   "    const r = limitsReader.readLimit(id, opts);\n" +
   "    return r && Number.isInteger(r.value) ? r : { value: opts.fallback, error: 'the shared reader returned no number for ' + id };\n" +
   "  } catch (e) {\n" +
   "    return { value: opts.fallback, error: 'the shared reader failed (' + ((e && e.message) || 'unknown error') + ')' };\n" +
   "  }\n" +
   "}\n" +
   "const MAX_CONTEXT_CHARS = readLimitSafe('hook-injected-text', NOTES_CAP_OPTS).value - 1000;\n"],
  ["const RULES_LINE_CAP = 200;\n", "const FALLBACK_RULES_LINE_CAP = 200;\n"],
  ["  let limit = RULES_LINE_CAP;\n" +
   "  try {\n" +
   "    const g = JSON.parse(stripBomText(fs.readFileSync(path.join(home, 'AI Projects', 'Improve AI Infra', 'notes', 'anthropic-guidelines.json'), 'utf8')));\n" +
   "    const entry = g && Array.isArray(g.limits) ? g.limits.find(x => x && x.id === 'claude-md-lines') : null;\n" +
   "    if (entry && Number.isInteger(entry.value) && entry.value > 0 && entry.value < limit) limit = entry.value;\n" +
   "  } catch (e) {\n" +
   "    /* unreadable or malformed -> 200 (the file can only lower the limit) */\n" +
   "  }\n",
   "  // GEN-892: the limits file may lower the limit; it raises it only with a matching logged Anthropic change\n" +
   "  // (guidelines-limits.js). Problems fall back to 200 and are reported by guidelinesLimitsLine.\n" +
   "  const limit = readLimitSafe('claude-md-lines', { fallback: FALLBACK_RULES_LINE_CAP, min: 50, max: 800, home }).value;\n"],
  ["// GEN-674: one line when the size stop itself looks removed; else null.",
   "// GEN-892: one line when the limits the hooks and the rules-file gate read from notes/anthropic-guidelines.json\n" +
   "// fell back to their built-in numbers: the shared reader or the limits file could not be read, or the file holds\n" +
   "// a raised value with no matching applied row in the weekly guidelines watch's change log\n" +
   "// (notes/release-review/guidelines-changes.jsonl). Else null.\n" +
   "function guidelinesLimitsLine(claudeDir) {\n" +
   "  const home = path.join(claudeDir, '..');\n" +
   "  const fmtNum = n => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');\n" +
   "  const notes = readLimitSafe('hook-injected-text', Object.assign({ home }, NOTES_CAP_OPTS));\n" +
   "  const rules = readLimitSafe('claude-md-lines', { fallback: FALLBACK_RULES_LINE_CAP, min: 50, max: 800, home });\n" +
   "  const out = [];\n" +
   "  const err = notes.error || rules.error;\n" +
   "  if (err) out.push(`GUIDELINES LIMITS — ${err}, so the hooks are using their built-in limits (${fmtNum(FALLBACK_NOTES_CAP)}-character notes cap, ${FALLBACK_RULES_LINE_CAP}-line rules-file limit) instead of notes/anthropic-guidelines.json.`);\n" +
   "  if (rules.warning) out.push(`GUIDELINES LIMITS — rules-file limit in the limits file (${rules.warning.value}) does not match a logged Anthropic change; using ${FALLBACK_RULES_LINE_CAP}.`);\n" +
   "  if (notes.warning) out.push(`GUIDELINES LIMITS — notes cap in the limits file (${notes.warning.value}) does not match a logged Anthropic change; using ${fmtNum(FALLBACK_NOTES_CAP)}.`);\n" +
   "  if (!out.length) return null;\n" +
   "  return out.join(' ') + ' Tell Erez in the 📌 For you block of your first reply, in plain words.';\n" +
   "}\n\n" +
   "// GEN-674: one line when the size stop itself looks removed; else null."],
]);

// ---- sessionstart-skill-restore.js ----
edit(path.join(HOOKS, 'sessionstart-skill-restore.js'), path.join(WC, 'hooks', 'sessionstart-skill-restore.js'), [
  ["const SKILL_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;\n",
   "const SKILL_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;\n" +
   "// The amount of each skill kept after compaction. Since GEN-892 it follows notes/anthropic-guidelines.json\n" +
   "// (skill-after-compaction) through guidelines-limits.js; FALLBACK_SKILL_TOKENS is used when that cannot be read.\n" +
   "const FALLBACK_SKILL_TOKENS = 5000;\n" +
   "function skillTokens() {\n" +
   "  try {\n" +
   "    const v = require('./guidelines-limits.js').readLimit('skill-after-compaction', { fallback: FALLBACK_SKILL_TOKENS, min: 1000, max: 20000 }).value;\n" +
   "    return Number.isInteger(v) ? v : FALLBACK_SKILL_TOKENS;\n" +
   "  } catch (e) {\n" +
   "    return FALLBACK_SKILL_TOKENS;\n" +
   "  }\n" +
   "}\n"],
  ["'instructions (about 5,000 tokens each, 25,000 in total), and older ones can be dropped entirely, so ' +",
   "'instructions (about ' + String(skillTokens()).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + ' tokens each, 25,000 in total), and older ones can be dropped entirely, so ' +"],
]);

// ---- update-config.ps1 (Drive) ----
const UC = 'G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1';
edit(UC, path.join(WC, 'drive', 'update-config.ps1'), [
  ['$RulesLineCap   = 200\r\n', '$FALLBACK_RULES_LINE_CAP = 200\r\n'],
  ['$GuidelinesFile = Join-Path $UserHome "AI Projects\\Improve AI Infra\\notes\\anthropic-guidelines.json"\r\n',
   '$GuidelinesFile = Join-Path $UserHome "AI Projects\\Improve AI Infra\\notes\\anthropic-guidelines.json"\r\n' +
   '$GuidelinesLog  = Join-Path $UserHome "AI Projects\\Improve AI Infra\\notes\\release-review\\guidelines-changes.jsonl"\r\n'],
  ['# The line limit: 200, or the claude-md-lines value in the size-limits file when that is a smaller\r\n' +
   '# positive whole number. Any read or parse problem leaves 200, so the file can only lower the limit.\r\n' +
   'function Get-RulesLineLimit {\r\n' +
   '    $lineLimit = $RulesLineCap\r\n',
   '# The new value of the last applied row for this limit and field in the weekly guidelines watch\'s change log\r\n' +
   '# (GEN-892), ignoring rows whose changeId was later marked not-applied; $null when there is none or the log\r\n' +
   '# cannot be read. A malformed line is skipped. Same rules as hooks\\guidelines-limits.js loggedValue.\r\n' +
   'function Get-LoggedLimitValue([string]$LimitId, [string]$FieldName) {\r\n' +
   '    $logLines = $null\r\n' +
   '    try { $logLines = [System.IO.File]::ReadAllLines($GuidelinesLog, [System.Text.Encoding]::UTF8) } catch { return $null }\r\n' +
   '    $logRows = New-Object System.Collections.ArrayList\r\n' +
   '    foreach ($logLine in $logLines) {\r\n' +
   '        if (-not $logLine -or -not $logLine.Trim()) { continue }\r\n' +
   '        try { $logRow = $logLine | ConvertFrom-Json; if ($logRow -is [System.Management.Automation.PSCustomObject]) { [void]$logRows.Add($logRow) } } catch { }\r\n' +
   '    }\r\n' +
   '    $notAppliedIds = New-Object \'System.Collections.Generic.HashSet[string]\' ([System.StringComparer]::Ordinal)\r\n' +
   '    foreach ($logRow in $logRows) { if ($logRow.status -ceq \'not-applied\' -and $logRow.changeId) { [void]$notAppliedIds.Add([string]$logRow.changeId) } }\r\n' +
   '    for ($rowIndex = $logRows.Count - 1; $rowIndex -ge 0; $rowIndex--) {\r\n' +
   '        $logRow = $logRows[$rowIndex]\r\n' +
   '        $rowField = if ($logRow.field) { [string]$logRow.field } else { \'value\' }\r\n' +
   '        # Exact case and a whole-number new value, as the JS reader requires (-cne: PowerShell compares\r\n' +
   '        # strings case-insensitively by default).\r\n' +
   '        if ($logRow.status -cne \'applied\' -or $logRow.limit -cne $LimitId -or $rowField -cne $FieldName) { continue }\r\n' +
   '        if ($logRow.changeId -and $notAppliedIds.Contains([string]$logRow.changeId)) { continue }\r\n' +
   '        $loggedNew = $logRow.new\r\n' +
   '        if (-not ($loggedNew -is [int] -or $loggedNew -is [long] -or $loggedNew -is [double] -or $loggedNew -is [decimal])) { return $null }\r\n' +
   '        return $loggedNew\r\n' +
   '    }\r\n' +
   '    return $null\r\n' +
   '}\r\n' +
   '\r\n' +
   '# The line limit (GEN-892): the claude-md-lines value in the size-limits file when it is a whole number from 50\r\n' +
   '# to 800 and either at or below 200, or above 200 and equal to the last applied claude-md-lines row in the\r\n' +
   '# weekly guidelines watch\'s change log. Anything else, or any read or parse problem, leaves 200, so a hand edit\r\n' +
   '# of the limits file can lower the limit but not raise it. Same rules as hooks\\guidelines-limits.js: keep the\r\n' +
   '# two in step.\r\n' +
   'function Get-RulesLineLimit {\r\n' +
   '    $lineLimit = $FALLBACK_RULES_LINE_CAP\r\n'],
  ['                    if ($limitNumber -eq [Math]::Floor($limitNumber) -and $limitNumber -gt 0 -and $limitNumber -lt $lineLimit) {\r\n' +
   '                        $lineLimit = [int]$limitNumber\r\n' +
   '                    }\r\n',
   '                    if ($limitNumber -eq [Math]::Floor($limitNumber) -and $limitNumber -ge 50 -and $limitNumber -le 800) {\r\n' +
   '                        if ($limitNumber -le $FALLBACK_RULES_LINE_CAP) {\r\n' +
   '                            $lineLimit = [int]$limitNumber\r\n' +
   '                        } else {\r\n' +
   '                            $loggedLimit = Get-LoggedLimitValue \'claude-md-lines\' \'value\'\r\n' +
   '                            if ($null -ne $loggedLimit -and [double]$loggedLimit -eq $limitNumber) { $lineLimit = [int]$limitNumber }\r\n' +
   '                        }\r\n' +
   '                    }\r\n'],
]);

// ---- config-health-scan.ps1 (GEN-969) ----
const CH = 'C:/Users/Erez/.claude/skills/config-health/config-health-scan.ps1';
edit(CH, path.join(WC, 'skills', 'config-health-scan.ps1'), [
  ["    $val = Join-SizeFolded $first $cont\r\n" +
   "    $hashAt = $val.IndexOf(' #')\r\n" +
   "    if ($hashAt -ge 0) { $val = $val.Substring(0, $hashAt) }\r\n" +
   "    return (New-SizeScalar 'ok' $null $val.Trim())\r\n",
   "    # GEN-969: a first-line value that is only a comment is no value; YAML then takes the continuation\r\n" +
   "    # lines, if any, as the value.\r\n" +
   "    if ($first.StartsWith('#')) { $first = '' }\r\n" +
   "    $val = Join-SizeFolded $first $cont\r\n" +
   "    $hashAt = $val.IndexOf(' #')\r\n" +
   "    if ($hashAt -ge 0) { $val = $val.Substring(0, $hashAt) }\r\n" +
   "    $val = $val.Trim()\r\n" +
   "    # GEN-969: YAML's empty forms; a plain ~ or null (any of its three spellings) is an empty value.\r\n" +
   "    if ($val -ceq '~' -or $val -ceq 'null' -or $val -ceq 'Null' -or $val -ceq 'NULL') { $val = '' }\r\n" +
   "    return (New-SizeScalar 'ok' $null $val)\r\n"],
]);
