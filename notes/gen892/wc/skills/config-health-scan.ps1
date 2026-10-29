# config-health-scan.ps1 -- deterministic helper for the /config-health skill (GEN-271).
#
# This script ONLY does the parts that are mechanically decidable. It NEVER edits
# any settings / config / content file and NEVER decides semantic questions
# (redundancy, contradiction, staleness, locality, enforceability) -- those are the
# calling skill's LLM job. It DOES write its own state files (the weekly-nudge timer
# and the settings-health keep-list); those are not config/content.
#
# It emits a single JSON object to stdout and always exits 0 (so a native/git
# command's exit code can never leak to /wrap and masquerade as a step failure;
# read the JSON "ok" field instead of the exit code).
#
# Actions:
#   -Action detect-global    -> has the live global CLAUDE.md changed since the last config sync?
#                               (diff of live file vs the git-history HEAD copy)
#   -Action detect-project   -> did THIS session edit a project CLAUDE.md? (session-filtered edit logs)
#   -Action scan             -> run the mechanical checks + candidate extraction on -Target
#   -Action scan-settings    -> scan the two settings files (add -FullReaudit to bypass the keep-list)
#   -Action settings-nudge   -> weekly heads-up gate (piggybacks on /wrap)
#   -Action keep-record      -> record reviewer-approved keeps into the keep-list, by index,
#                               from a prior scan-settings result (-ScanResult, -KeepIndices, -Nonce)
#   -Action size-sweep       -> (GEN-886) measure every file that steers Claude against the size
#                               limits in -GuidelinesFile; one finding per breach / near-limit / note
#   -Action size-check       -> (GEN-886) measure ONE file (-Target) against the limits that apply to
#                               -AsIfPath (default: -Target), so a draft kept elsewhere is measured
#                               as if it were the real file. (GEN-893) Its sizeLines output gives
#                               one "size:" line per applicable limit, near a limit or not; with an
#                               -AsIfPath that exists, each line reads <now> -> <proposed>.
#   -Action size-weekly      -> (GEN-890) weekly size check at /wrap: is it due (-SizeStateFile), and
#                               which findings need a ticket; lists the linked tickets whose status
#                               the caller must fetch from Notion. Writes nothing.
#   -Action size-decide      -> (GEN-890) given those statuses (-TicketsJson), decide per finding:
#                               file / link / escalate / skip / deferred / error. Writes nothing.
#   -Action size-record      -> (GEN-890) save filed tickets, escalations and pruned keys from
#                               -RecordJson into the state file; "completed" advances the weekly date.
#   -Action mark-reviewed also reports the weekly size check overdue (ok:false, marker still
#   written) when its state file is missing or its last run is -SizeWeeklyDays or more old.
#
# Command files (GEN-926): ~/.claude/commands/*.md (-CommandsDir) are measured like a skill's
# description (listing cap and portable note); the docs give commands the same frontmatter fields
# as skills, but do not name commands under the cap, so that coverage is inferred.
#
# Size limits (GEN-886): every number comes from the thresholds file (-GuidelinesFile), never from
# this script. Characters are Unicode code points (as Node's [...text].length), except the skill
# compaction measure, which counts UTF-16 units of the text Claude Code re-attaches after a
# compaction (the "Base directory for this skill:" line + the body without frontmatter), because
# that is what Claude Code was observed to cut (see the thresholds file's counting block).
#
# All paths are parameters with live defaults so nothing time-varying is baked in.

param(
    [ValidateSet('detect-global', 'detect-project', 'scan', 'scan-settings', 'settings-nudge', 'keep-record', 'mark-reviewed', 'size-sweep', 'size-check', 'size-weekly', 'size-decide', 'size-record')]
    [string]$Action = 'scan',

    [string]$Target,

    [string]$GlobalClaude     = 'C:\Users\Erez\.claude\CLAUDE.md',
    [string]$GitHistoryRepo   = 'C:\Users\Erez\.claude-git-history',
    [string]$GlobalMarkerFile = 'C:\Users\Erez\.claude\.config-health-global-marker',

    [string]$SessionId,
    [string]$ProjectClaude,
    [string]$AutoApprovedLog = 'C:\Users\Erez\.claude\hooks\auto-approved-edits.jsonl',
    [string]$DeferredLog     = 'C:\Users\Erez\.claude\hooks\deferred-calls.jsonl',

    # GEN-886 size-limit params
    [string]$GuidelinesFile    = 'C:\Users\Erez\AI Projects\Improve AI Infra\notes\anthropic-guidelines.json',
    [string]$ProjectsRoot      = 'C:\Users\Erez\AI Projects',
    [string]$ClaudeProjectsDir = 'C:\Users\Erez\.claude\projects',
    [string]$AsIfPath,

    [string]$SkillsDir    = 'C:\Users\Erez\.claude\skills',
    [string]$CommandsDir  = 'C:\Users\Erez\.claude\commands',
    [string]$AgentsDir    = 'C:\Users\Erez\.claude\agents',
    [string]$HooksDir     = 'C:\Users\Erez\.claude\hooks',
    [string]$SettingsJson = 'C:\Users\Erez\.claude\settings.json',

    # GEN-290 settings-health params
    [string]$SettingsLocalJson = 'C:\Users\Erez\.claude\settings.local.json',
    [string]$SecretPatterns    = 'C:\Users\Erez\.claude\hooks\secret-patterns.json',
    [string]$NudgeStateFile    = 'C:\Users\Erez\.claude\.settings-health-nudge',
    [int]$NudgeDays            = 7,

    # GEN-290 keep-list ("review each approved entry at most once") params
    [string]$KeepListFile  = 'C:\Users\Erez\.claude\.settings-health-keep.json',
    [int]$KeepReauditDays  = 90,
    [switch]$FullReaudit,
    [string]$ScanResult,
    [string]$KeepIndices,
    [string]$Nonce,

    # GEN-890 weekly size check params
    [string]$ClaudeHome       = 'C:\Users\Erez\.claude',
    [string]$SizeStateFile    = 'C:\Users\Erez\.claude\.size-sweep-state.json',
    [int]$SizeWeeklyDays      = 7,
    [int]$SizeEscalateDays    = 28,
    [int]$SizeFileCap         = 3,
    [string]$TicketsJson,
    [string]$RecordJson,
    [string]$AsOf
)

$ErrorActionPreference = 'Stop'

# Force UTF-8 decoding of native (git) stdout. PowerShell decodes a native command's output
# with [Console]::OutputEncoding, which defaults to the OEM codepage (e.g. 437/850) on a
# stock shell -- that mangles git's UTF-8 bytes (an em-dash becomes a 3-char garble) so the
# HEAD-vs-live comparison differs on every non-ASCII char and reports changed:true spuriously.
# Setting it
# explicitly removes the dependency on whatever codepage /wrap's shell happened to launch
# with. try/catch: the setter can throw when stdout has no attached console; falling back to
# the ambient encoding is acceptable.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# Claude Code built-in slash commands that have no skill folder. Referenced commands
# matching a skill folder or this set are valid; anything else with no registry to
# check is reported "unverified", never "missing" (plugin skills live off-disk).
$BuiltinCommands = @(
    'compact','clear','model','context','help','cost','status','doctor','hooks',
    'permissions','mcp','resume','login','logout','init','review','agents','config',
    'bug','vim','fast','release-notes','terminal-setup','memory'
)

function Emit($obj) {
    # Depth 8 covers our nested arrays/objects. PS 5.1 ConvertTo-Json is fine here.
    $obj | ConvertTo-Json -Depth 8
}

function Get-KnownArtifacts {
    # Build the allowlist at runtime so it can never rot (no static skill list).
    $skills = @()
    if (Test-Path $SkillsDir) {
        $skills = Get-ChildItem -Path $SkillsDir -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }
    }
    $agents = @()
    if (Test-Path $AgentsDir) {
        $agents = Get-ChildItem -Path $AgentsDir -File -ErrorAction SilentlyContinue | ForEach-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.Name) }
    }
    # MCP tool names declared in settings.json permission entries look like
    # mcp__<server-id>__<tool-name>; strip the prefix to the human tool name.
    $mcpTools = @()
    if (Test-Path $SettingsJson) {
        try {
            $raw = Get-Content -Raw -Path $SettingsJson -Encoding UTF8
            $matches = [regex]::Matches($raw, 'mcp__[^_]+(?:_[^_]+)*__([A-Za-z0-9_-]+)')
            foreach ($m in $matches) { $mcpTools += $m.Groups[1].Value }
            $mcpTools = $mcpTools | Sort-Object -Unique
        } catch { }
    }
    return [pscustomobject]@{ skills = $skills; agents = $agents; mcpTools = $mcpTools }
}

# FAIL-OPEN result for detect-global: any uncertainty -- missing/empty/unresolvable
# marker, unreadable repo, or ANY git read that errors -- returns changed:true with the
# WHOLE live file as the scan scope, so detection can NEVER silently decide "nothing
# changed". This function never writes the marker.
function New-FailOpenResult($globalClaude, $reason) {
    $live = ''
    try { $live = Get-Content -Raw -Path $globalClaude -Encoding UTF8 } catch {}
    return [pscustomobject]@{
        ok = $true; action = 'detect-global'; file = $globalClaude
        changed = $true; changeSource = 'fail-open (marker/repo unavailable)'
        markerWarning = $reason; marker = $null; diff = $live
    }
}

# detect-global (GEN-271 high-water-mark): PURE READ -- decides whether the global
# CLAUDE.md needs a health review and yields the scoping diff. It NEVER writes the marker
# (only -Action mark-reviewed does, AFTER findings are surfaced). "Changed" = committed
# edits to CLAUDE.md since the last reviewed commit (the marker) OR the live file differs
# from HEAD (an uncommitted / emergency-override edit). Missing/invalid marker or ANY git
# read that errors routes to fail-open (changed:true, whole-file scope) -- never a silent
# quiet. git diff returns 0 (no diff) or 1 (diff) on success; only codes >= 2 are errors.
function Invoke-DetectGlobal {
    if (-not (Test-Path $GlobalClaude)) {
        return [pscustomobject]@{ ok = $false; action = 'detect-global'; error = "global CLAUDE.md not found: $GlobalClaude" }
    }
    if (-not (Test-Path $GitHistoryRepo)) { return (New-FailOpenResult $GlobalClaude "git-history repo not found: $GitHistoryRepo") }

    $liveText = $null
    try { $liveText = Get-Content -Raw -Path $GlobalClaude -Encoding UTF8 } catch { return (New-FailOpenResult $GlobalClaude 'could not read live global CLAUDE.md') }
    if ($null -eq $liveText) { $liveText = '' }

    # PS 5.1 wraps native git stderr as a NativeCommandError; under the script-wide
    # $ErrorActionPreference='Stop' that throws even with 2>$null. Use 'Continue' and gate
    # strictly on $LASTEXITCODE; restore the preference in finally.
    $eapPrev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $headContent = & git -C $GitHistoryRepo show HEAD:CLAUDE.md 2>$null
        if ($LASTEXITCODE -ne 0) { return (New-FailOpenResult $GlobalClaude 'could not read HEAD:CLAUDE.md from git-history repo') }
        $headText = ($headContent -join "`n")
        $liveVsHead = ($liveText.TrimEnd("`r","`n") -ne $headText.TrimEnd("`r","`n"))

        # marker = the git-history commit reviewed last. Missing/empty/unresolvable -> fail-open.
        $marker = $null
        if (Test-Path -LiteralPath $GlobalMarkerFile) {
            try { $marker = (Get-Content -Raw -Path $GlobalMarkerFile -Encoding UTF8).Trim() } catch { $marker = $null }
        }
        if (-not $marker) { return (New-FailOpenResult $GlobalClaude "marker missing or empty: $GlobalMarkerFile") }
        & git -C $GitHistoryRepo cat-file -e ($marker + '^{commit}') 2>$null
        if ($LASTEXITCODE -ne 0) { return (New-FailOpenResult $GlobalClaude "marker commit not resolvable: $marker") }

        # committed edits to CLAUDE.md since the marker (path-scoped). 0/1 ok, >= 2 error.
        $committedDiff = (& git -C $GitHistoryRepo diff $marker HEAD -- CLAUDE.md 2>$null) -join "`n"
        if ($LASTEXITCODE -gt 1) { return (New-FailOpenResult $GlobalClaude 'git diff <marker> HEAD failed') }
        $committedNonEmpty = [bool]($committedDiff -and $committedDiff.Trim())

        # scoping diff for the override path (live vs HEAD content). 0/1 ok, >= 2 -> drop the diff.
        $liveDiff = ''
        if ($liveVsHead) {
            $tmp = [System.IO.Path]::GetTempFileName()
            try {
                $enc = New-Object System.Text.UTF8Encoding($false)
                [System.IO.File]::WriteAllText($tmp, $headText, $enc)
                $liveDiff = (& git diff --no-index --unified=2 -- $tmp $GlobalClaude 2>$null) -join "`n"
                if ($LASTEXITCODE -gt 1) { $liveDiff = '' }
            } finally { Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue }
        }

        $changed = $committedNonEmpty -or $liveVsHead
        if ($committedNonEmpty) {
            $src = 'since-last-review (marker)'; $diffOut = $committedDiff
        } elseif ($liveVsHead) {
            $src = 'uncommitted/override (live vs HEAD)'; $diffOut = $liveDiff
        } else {
            $src = 'none (no change since last review)'; $diffOut = ''
        }
        return [pscustomobject]@{
            ok = $true; action = 'detect-global'; file = $GlobalClaude
            changed = $changed; changeSource = $src; marker = $marker; markerWarning = $null; diff = $diffOut
        }
    } finally {
        $ErrorActionPreference = $eapPrev
    }
}

# mark-reviewed (GEN-271): the ONLY writer of the high-water-mark marker. Records the
# git-history repo's current HEAD as "reviewed". The calling skill issues this STRICTLY
# AFTER surfacing findings to the user (surface-then-advance) -- never inside detect. If it
# never runs (interruption), the marker stays put and the edits re-surface next time.
function Invoke-MarkReviewed {
    if (-not (Test-Path $GitHistoryRepo)) {
        return [pscustomobject]@{ ok = $false; action = 'mark-reviewed'; error = "git-history repo not found: $GitHistoryRepo" }
    }
    $eapPrev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $sha = & git -C $GitHistoryRepo rev-parse HEAD 2>$null
    $ErrorActionPreference = $eapPrev
    if ($LASTEXITCODE -ne 0 -or -not $sha) {
        return [pscustomobject]@{ ok = $false; action = 'mark-reviewed'; error = 'could not read HEAD of git-history repo' }
    }
    $sha = ([string]$sha).Trim()
    try {
        $enc = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($GlobalMarkerFile, $sha, $enc)
    } catch {
        return [pscustomobject]@{ ok = $false; action = 'mark-reviewed'; error = "could not write marker: $($_.Exception.Message)" }
    }
    # GEN-890: the weekly size check's overdue alarm. /wrap always runs this action last, and
    # surfaces a non-ok result in one line, so a weekly check that silently stopped is noticed.
    $overdue = Get-SizeWeeklyOverdue
    if ($overdue) {
        return [pscustomobject]@{ ok = $false; action = 'mark-reviewed'; marker = $GlobalMarkerFile; sha = $sha; markerWritten = $true; error = $overdue }
    }
    return [pscustomobject]@{ ok = $true; action = 'mark-reviewed'; marker = $GlobalMarkerFile; sha = $sha }
}

function Read-SessionEdits($logPath, $sid) {
    $hits = @()
    if (-not (Test-Path $logPath)) { return $hits }
    $lines = Get-Content -Path $logPath -Encoding UTF8 -ErrorAction SilentlyContinue
    foreach ($ln in $lines) {
        if (-not $ln) { continue }
        try { $o = $ln | ConvertFrom-Json } catch { continue }
        if ($o.session -ne $sid) { continue }
        # auto-approved-edits.jsonl: {tool,file,...}; deferred-calls.jsonl: {tool,command,...}.
        $f = $null
        if ($o.PSObject.Properties.Name -contains 'file') { $f = $o.file }
        if ($f -and ($f -match 'CLAUDE\.md$')) { $hits += $f }
    }
    return ($hits | Sort-Object -Unique)
}

function Invoke-DetectProject {
    if (-not $SessionId) {
        return [pscustomobject]@{ ok = $false; action = 'detect-project'; error = 'SessionId is required for detect-project' }
    }
    $edited = @()
    $edited += Read-SessionEdits $AutoApprovedLog $SessionId
    $edited += Read-SessionEdits $DeferredLog $SessionId
    $edited = $edited | Sort-Object -Unique

    if ($ProjectClaude) {
        $norm = $ProjectClaude.TrimEnd('\')
        $changed = @($edited | Where-Object { $_.TrimEnd('\') -ieq $norm }).Count -gt 0
    } else {
        $changed = $edited.Count -gt 0
    }

    # Scoping aid (best-effort): if the project is a git repo, the uncommitted working-tree
    # diff of CLAUDE.md helps the LLM focus on what changed. Caveat: a mid-session commit
    # makes this show nothing -- the edit log above is the authoritative trigger.
    $diff = ''
    if ($changed -and $ProjectClaude -and (Test-Path $ProjectClaude)) {
        $root = Split-Path -Parent $ProjectClaude
        if (Test-Path (Join-Path $root '.git')) {
            $name = Split-Path -Leaf $ProjectClaude
            Push-Location $root
            try {
                $eapPrev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
                $d = & git diff HEAD --unified=2 -- $name 2>$null
                $ErrorActionPreference = $eapPrev
                if ($LASTEXITCODE -eq 0 -and $d) { $diff = ($d -join "`n") }
            } catch { } finally { Pop-Location }
        }
    }

    return [pscustomobject]@{
        ok = $true; action = 'detect-project'; sessionId = $SessionId
        editedClaudeFiles = $edited; project = $ProjectClaude
        changed = $changed; diff = $diff
    }
}

function Invoke-Scan {
    if (-not $Target -or -not (Test-Path $Target)) {
        return [pscustomobject]@{ ok = $false; action = 'scan'; error = "target file not found: $Target" }
    }
    $lines = Get-Content -Path $Target -Encoding UTF8
    $nLines = $lines.Count
    $raw = Get-Content -Raw -Path $Target -Encoding UTF8
    $nChars = $raw.Length

    $findings = @()      # the script's OWN mechanical findings (high confidence)
    $danglingRefs = @()  # confirmed-missing or unverified artifact references
    $candidates = @()    # paths/IDs/dates EXTRACTED for the LLM to judge stale-vs-stable

    # ---- positional cross-reference phrases (banned by the cross-ref rule) ----
    $posPatterns = @(
        '(?i)\b(rule|protocol|section|guideline|paragraph|entry|note)s?\s+(above|below)\b',
        '(?i)\b(above|below)\s+(rule|protocol|section|guideline)s?\b',
        '(?i)\bthe\s+(above|below|preceding|following)\s+(rule|protocol|section)\b'
    )
    # ---- TODO/FIXME markers ----
    $todoPattern = '\b(TODO|FIXME|XXX|HACK)\b'

    for ($i = 0; $i -lt $nLines; $i++) {
        $line = $lines[$i]
        $lno = $i + 1
        foreach ($p in $posPatterns) {
            $m = [regex]::Match($line, $p)
            if ($m.Success) {
                $findings += [pscustomobject]@{ kind = 'positional-cross-ref'; line = $lno; match = $m.Value; text = $line.Trim() }
                break
            }
        }
        $mt = [regex]::Match($line, $todoPattern)
        if ($mt.Success) {
            $findings += [pscustomobject]@{ kind = 'todo-marker'; line = $lno; match = $mt.Value; text = $line.Trim() }
        }
    }

    # ---- duplicate headings ----
    $headings = @{}
    for ($i = 0; $i -lt $nLines; $i++) {
        $hm = [regex]::Match($lines[$i], '^(#{1,6})\s+(.*\S)\s*$')
        if ($hm.Success) {
            $key = $hm.Groups[2].Value.Trim().ToLower()
            if (-not $headings.ContainsKey($key)) { $headings[$key] = @() }
            $headings[$key] += ($i + 1)
        }
    }
    foreach ($k in $headings.Keys) {
        if ($headings[$k].Count -gt 1) {
            $findings += [pscustomobject]@{ kind = 'duplicate-heading'; heading = $k; lines = $headings[$k] }
        }
    }

    # ---- size limits (GEN-886; replaces the old 300-line budget) ----
    # Isolated: a failure here (thresholds file missing/corrupt, a measuring error) never costs
    # the rest of this scan's output.
    $sizeFindings = $null
    $sizeCheckError = $null
    $sizeClass = $null
    try {
        $sizeCore = Invoke-SizeCheckCore $Target $Target
        $sizeFindings = @($sizeCore.findings)
        if ($sizeCore.cls) { $sizeClass = $sizeCore.cls.class }
    } catch {
        $sizeFindings = $null
        $sizeCheckError = $_.Exception.Message
    }

    # ---- artifact-existence (dangling refs) + candidate extraction ----
    $known = Get-KnownArtifacts
    $allCommands = @($known.skills) + $BuiltinCommands
    $tokenMatches = [regex]::Matches($raw, '`([^`]+)`')
    $seenTok = @{}
    foreach ($tm in $tokenMatches) {
        $tok = $tm.Groups[1].Value.Trim()
        if ($seenTok.ContainsKey($tok)) { continue }
        $seenTok[$tok] = $true

        # slash command / skill reference
        $sc = [regex]::Match($tok, '^/([a-z][a-z0-9-]+)$')
        if ($sc.Success) {
            $name = $sc.Groups[1].Value
            if ($allCommands -notcontains $name) {
                $danglingRefs += [pscustomobject]@{ ref = $tok; type = 'slash-command'; status = 'unverified'; note = 'no matching skill folder or known built-in; may be a plugin skill' }
            }
            continue
        }
        # absolute path reference -> deterministically checkable
        if ($tok -match '^[A-Za-z]:\\') {
            $clean = $tok -replace '[`*_).,;:]+$',''
            if (-not (Test-Path $clean)) {
                $danglingRefs += [pscustomobject]@{ ref = $clean; type = 'path'; status = 'missing'; note = 'absolute path does not exist on disk' }
            }
            continue
        }
        # bare artifact filename (script/config/hook) -> search known roots
        if ($tok -match '^[\w.-]+\.(ps1|js|json|jsonl|md)$') {
            $roots = @($SkillsDir, $AgentsDir, $HooksDir, (Split-Path -Parent $GlobalClaude))
            $found = $false
            foreach ($r in $roots) {
                if ((Test-Path $r) -and (Get-ChildItem -Path $r -Recurse -Filter $tok -File -ErrorAction SilentlyContinue | Select-Object -First 1)) { $found = $true; break }
            }
            if (-not $found) {
                $danglingRefs += [pscustomobject]@{ ref = $tok; type = 'artifact-file'; status = 'unverified'; note = 'not found under known roots; may live elsewhere (e.g. Drive tooling)' }
            }
            continue
        }
    }

    # ---- candidate extraction (NOT findings -- handed to the LLM for staleness judgment) ----
    for ($i = 0; $i -lt $nLines; $i++) {
        $lno = $i + 1
        foreach ($m in [regex]::Matches($lines[$i], '[A-Z]{2,}-\d+')) {
            $candidates += [pscustomobject]@{ type = 'ticket-id'; value = $m.Value; line = $lno }
        }
        foreach ($m in [regex]::Matches($lines[$i], '\d{4}-\d{2}-\d{2}')) {
            $candidates += [pscustomobject]@{ type = 'date-iso'; value = $m.Value; line = $lno }
        }
        foreach ($m in [regex]::Matches($lines[$i], '[A-Za-z]:\\[^\s`*)<>"|]+')) {
            $candidates += [pscustomobject]@{ type = 'path'; value = $m.Value; line = $lno }
        }
    }

    return [pscustomobject]@{
        ok = $true; action = 'scan'; file = $Target
        stats = [pscustomobject]@{ lines = $nLines; chars = $nChars }
        sizeClass = $sizeClass
        sizeFindings = $sizeFindings
        sizeCheckError = $sizeCheckError
        mechanicalFindings = $findings
        danglingRefs = $danglingRefs
        extractedCandidates = $candidates
        note = 'mechanicalFindings + danglingRefs are the script''s high-confidence findings; extractedCandidates are NOT findings -- the calling skill judges stale-vs-stable.'
    }
}

# ============================================================================
# Settings-health (GEN-290): scan settings.json + settings.local.json for
# duplicate / contradictory / dead / structurally-dead permission entries,
# dead hook paths, dead MCP-server entries (enumerated for manual verification),
# and env-block secrets. DETERMINISTIC only -- judgmentCandidates are flagged
# for the calling skill's independent verification pass; nothing is applied.
# ============================================================================

function Read-PermFile($path) {
    $res = [pscustomobject]@{ exists = $false; allow = @(); deny = @(); hooks = $null; env = $null }
    if (-not $path -or -not (Test-Path $path)) { return $res }
    try { $j = Get-Content -Raw -Path $path -Encoding UTF8 | ConvertFrom-Json } catch { return $res }
    $res.exists = $true
    if ($j.permissions) {
        if ($j.permissions.allow) { $res.allow = @($j.permissions.allow) }
        if ($j.permissions.deny)  { $res.deny  = @($j.permissions.deny) }
    }
    if ($j.hooks) { $res.hooks = $j.hooks }
    if ($j.PSObject.Properties.Name -contains 'env') { $res.env = $j.env }
    return $res
}

# Flag an allow entry that looks structurally non-recurring (a one-shot tied to a
# specific past action, or a captured shell fragment). Returns a reason or $null.
# Heuristic / high-recall: the verification pass + human approval prune it.
function Test-JunkCandidate($entry) {
    if ($entry -match '(?i)\b(node\s+(-e|--eval)|python3?\s+-c|py\s+-c)\b') { return 'inline one-off command (node -e / python -c) -- tied to a specific past action, will not recur as written' }
    if ($entry -match '(?i)(tmp_|temp_|[\\/]tmp[\\/]|dbg[-_]|tool-results|\\projects\\C--)') { return 'references a temp / session-scoped path that does not persist' }
    if ($entry -match '^(?i)(bash|powershell)\(\s*"[^"]*"\s*\)$') { return 'specifier is a bare quoted literal -- looks like a captured fragment, not a real command' }
    foreach ($f in @('ConvertFrom-Json','ConvertTo-Json','Out-String','xxd','tasklist','cat','cd /tmp','cat > ')) {
        if ($entry -match ('^(?i)(bash|powershell)\(\s*' + [regex]::Escape($f))) { return "looks like a captured shell fragment ('$f'), not a reusable allow pattern" }
    }
    return $null
}

# Extract hook command script paths and test their existence (deterministic).
function Get-HookPaths($hooksObj) {
    $out = @()
    if (-not $hooksObj) { return $out }
    foreach ($evt in $hooksObj.PSObject.Properties) {
        foreach ($block in @($evt.Value)) {
            if ($block.hooks) {
                foreach ($h in @($block.hooks)) {
                    if ($h.command) {
                        $cmd = [string]$h.command
                        $pm = [regex]::Match($cmd, '"([A-Za-z]:[\\/][^"]+)"')
                        if (-not $pm.Success) { $pm = [regex]::Match($cmd, '([A-Za-z]:[\\/][^\s"]+)') }
                        if ($pm.Success) {
                            $p = $pm.Groups[1].Value
                            $out += [pscustomobject]@{ event = $evt.Name; command = $cmd; path = $p; exists = [bool](Test-Path -LiteralPath $p -ErrorAction SilentlyContinue) }
                        }
                    }
                }
            }
        }
    }
    return $out
}

# Group MCP allow entries by server id (mcp__<server>__<tool>) for manual liveness
# verification -- there is no machine-readable registry of currently-live servers.
function Get-McpServers($entries) {
    $map = @{}
    foreach ($e in $entries) {
        $m = [regex]::Match($e, '^mcp__(.+?)__(.+)$')
        if ($m.Success) {
            $id = $m.Groups[1].Value
            if (-not $map.ContainsKey($id)) { $map[$id] = 0 }
            $map[$id] = $map[$id] + 1
        }
    }
    $out = @()
    foreach ($k in ($map.Keys | Sort-Object)) { $out += [pscustomobject]@{ server = $k; toolCount = $map[$k] } }
    return $out
}

function Scan-EnvSecrets($envObj, $patternsFile, $fileLabel) {
    $findings = @()
    if (-not $envObj) { return $findings }
    $patterns = @()
    if ($patternsFile -and (Test-Path $patternsFile)) {
        try { $patterns = @(Get-Content -Raw -Path $patternsFile -Encoding UTF8 | ConvertFrom-Json) } catch { $patterns = @() }
    }
    foreach ($prop in $envObj.PSObject.Properties) {
        $val = [string]$prop.Value
        foreach ($p in $patterns) {
            $rx = if ($p.regex) { $p.regex } elseif ($p.pattern) { $p.pattern } else { $null }
            if (-not $rx) { continue }
            try { if ([regex]::IsMatch($val, $rx)) { $findings += [pscustomobject]@{ file = $fileLabel; key = $prop.Name; matched = $p.name } } } catch {}
        }
    }
    return $findings
}

# ---- keep-list (GEN-290): entries the reviewer/user already adjudicated KEEP ----
# Stored as a JSON object mapping each EXACT decoded allow-entry string -> the ISO
# date it was recorded. Used to suppress already-reviewed entries from the judgment
# batch so the cleanup reviews each at most once, WITHOUT ever skipping their first
# review or skipping any other (dedup / subsumption / etc.) check. The JSON round-trip
# keeps backslash/quote-heavy entries exact. This is the script's own state file --
# not a locked config file -- so it is read/written directly here.

function Read-KeepList($path) {
    $map = @{}
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { return $map }
    try {
        $raw = (Get-Content -Raw -Path $path -Encoding UTF8).Trim()
        if (-not $raw) { return $map }
        $o = $raw | ConvertFrom-Json
    } catch { return $map }
    if ($o -isnot [psobject] -and $o -isnot [pscustomobject]) { return $map }
    foreach ($p in $o.PSObject.Properties) { $map[[string]$p.Name] = [string]$p.Value }
    return $map
}

function Write-KeepList($path, $map) {
    # Serialize with sorted keys for stable diffs. Empty map -> '{}' (ConvertTo-Json
    # on an empty object is unreliable in PS 5.1, so handle that case explicitly).
    if (-not $map -or $map.Count -eq 0) {
        $json = '{}'
    } else {
        $obj = [ordered]@{}
        foreach ($k in ($map.Keys | Sort-Object)) { $obj[$k] = $map[$k] }
        $json = ($obj | ConvertTo-Json -Depth 4)
    }
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($path, $json, $enc)
}

# Age stats for the keep-list, driven by the OLDEST stored entry date (NOT the file
# mtime) -- so a recent record for one entry cannot mask a stale older one.
function Get-KeepListStats($map, $reauditDays) {
    if (-not $map -or $map.Count -eq 0) {
        return [pscustomobject]@{ count = 0; ageDays = 0; oldest = $null; old = $false }
    }
    $now = Get-Date
    $oldest = $null
    foreach ($k in $map.Keys) {
        try { $d = [datetime]::Parse($map[$k]) } catch { continue }
        if ($null -eq $oldest -or $d -lt $oldest) { $oldest = $d }
    }
    $age = if ($oldest) { [int][math]::Floor((($now - $oldest)).TotalDays) } else { 0 }
    return [pscustomobject]@{
        count   = $map.Count
        ageDays = $age
        oldest  = $(if ($oldest) { $oldest.ToString('yyyy-MM-dd') } else { $null })
        old     = ($map.Count -gt 0 -and $oldest -and $age -ge $reauditDays)
    }
}

function Invoke-ScanSettings {
    $main  = Read-PermFile $SettingsJson
    $local = Read-PermFile $SettingsLocalJson
    if (-not $main.exists -and -not $local.exists) {
        return [pscustomobject]@{ ok = $false; action = 'scan-settings'; error = 'neither settings file found' }
    }

    $tagged = @()
    foreach ($e in $main.allow)  { $tagged += [pscustomobject]@{ file = 'settings.json'; entry = [string]$e } }
    foreach ($e in $local.allow) { $tagged += [pscustomobject]@{ file = 'settings.local.json'; entry = [string]$e } }
    $allEntries = @($tagged | ForEach-Object { $_.entry })

    # duplicates within a file
    $dupWithin = @()
    foreach ($grp in ($tagged | Group-Object file)) {
        foreach ($eg in ($grp.Group | Group-Object entry)) {
            if ($eg.Count -gt 1) { $dupWithin += [pscustomobject]@{ file = $grp.Name; entry = $eg.Name; count = $eg.Count } }
        }
    }

    # duplicates across the two files
    $dupCross = @()
    if ($main.exists -and $local.exists) {
        $mainSet = @{}
        foreach ($e in $main.allow) { $mainSet[[string]$e] = $true }
        $seen = @{}
        foreach ($e in $local.allow) {
            $s = [string]$e
            if ($mainSet.ContainsKey($s) -and -not $seen.ContainsKey($s)) { $dupCross += [pscustomobject]@{ entry = $s }; $seen[$s] = $true }
        }
    }

    # contradictions: an allow entry that also appears in a deny list
    $denySet = @{}
    foreach ($e in $main.deny)  { $denySet[[string]$e] = 'settings.json' }
    foreach ($e in $local.deny) { $denySet[[string]$e] = 'settings.local.json' }
    $contradictions = @()
    $seenC = @{}
    foreach ($t in $tagged) {
        if ($denySet.ContainsKey($t.entry) -and -not $seenC.ContainsKey($t.entry)) {
            $contradictions += [pscustomobject]@{ entry = $t.entry; allowedIn = $t.file; deniedIn = $denySet[$t.entry] }
            $seenC[$t.entry] = $true
        }
    }

    # subsumption (advisory): a bare tool name subsumes Tool(specifier)
    $bareTools = @{}
    foreach ($e in $allEntries) { if ($e -notmatch '\(' -and $e -notmatch '^mcp__') { $bareTools[$e.Trim()] = $true } }
    $subsumption = @()
    foreach ($t in $tagged) {
        $m = [regex]::Match($t.entry, '^\s*([^(]+?)\s*\(')
        if ($m.Success) {
            $tool = $m.Groups[1].Value.Trim()
            if ($bareTools.ContainsKey($tool)) { $subsumption += [pscustomobject]@{ file = $t.file; narrowEntry = $t.entry; subsumedBy = $tool } }
        }
    }

    # dead hook paths (deterministic)
    $deadHooks = @()
    foreach ($hp in (Get-HookPaths $main.hooks))  { if (-not $hp.exists) { $deadHooks += [pscustomobject]@{ file = 'settings.json'; event = $hp.event; path = $hp.path; command = $hp.command } } }
    foreach ($hp in (Get-HookPaths $local.hooks)) { if (-not $hp.exists) { $deadHooks += [pscustomobject]@{ file = 'settings.local.json'; event = $hp.event; path = $hp.path; command = $hp.command } } }

    # judgment candidates (flagged for the verification pass). Flagging is UNCHANGED
    # over the full entry set; we then SUPPRESS any entry already on the keep-list
    # (already adjudicated KEEP) so the reviewer sees only the unreviewed delta. The
    # keep-list filter touches ONLY this judgment bucket -- every other check above
    # (dup-within/cross, contradictions, subsumption, dead hooks, MCP, env) ran over
    # the full set and is unaffected. -FullReaudit bypasses the keep-list entirely.
    $keepMap = Read-KeepList $KeepListFile
    $candidatesAll = @()
    foreach ($t in $tagged) {
        $reason = Test-JunkCandidate $t.entry
        if ($reason) { $candidatesAll += [pscustomobject]@{ file = $t.file; entry = $t.entry; reason = $reason } }
    }
    $candidates = @()
    $suppressed = 0
    foreach ($c in $candidatesAll) {
        if (-not $FullReaudit -and $keepMap.ContainsKey($c.entry)) { $suppressed++ }
        else { $candidates += $c }
    }

    # MCP servers present (enumerated for manual liveness verification)
    $mcp = Get-McpServers $allEntries

    # env secrets
    $envFindings = @()
    $envFindings += Scan-EnvSecrets $main.env  $SecretPatterns 'settings.json'
    $envFindings += Scan-EnvSecrets $local.env $SecretPatterns 'settings.local.json'
    $envPresent = ($null -ne $main.env) -or ($null -ne $local.env)
    $envNote = if ($envPresent) { 'env block present -- values scanned against secret-patterns.json' } else { 'no env block in either file; extend this scan if one is added (TODO)' }

    $nudgeCount = $dupWithin.Count + $dupCross.Count + $contradictions.Count + $deadHooks.Count + $candidates.Count

    # One-time nonce binding this exact scan to any later keep-record call, so the
    # indices the reviewer adjudicated can never be applied against a different/re-run
    # scan (keep-record rejects a -ScanResult whose nonce does not match -Nonce).
    $nonce = [guid]::NewGuid().ToString()

    return [pscustomobject]@{
        ok = $true; action = 'scan-settings'
        nonce = $nonce
        fullReaudit = [bool]$FullReaudit
        files = [pscustomobject]@{ main = $SettingsJson; mainExists = $main.exists; local = $SettingsLocalJson; localExists = $local.exists }
        deterministic = [pscustomobject]@{
            duplicatesWithinFile = $dupWithin
            duplicatesCrossFile  = $dupCross
            contradictions       = $contradictions
            deadHookPaths        = $deadHooks
        }
        mcpServersForVerification = $mcp
        judgmentCandidates  = $candidates
        judgmentCandidatesSuppressed = $suppressed
        subsumptionAdvisory = $subsumption
        env = [pscustomobject]@{ present = $envPresent; secretFindings = $envFindings; note = $envNote }
        stats = [pscustomobject]@{ allowMain = $main.allow.Count; allowLocal = $local.allow.Count; allowTotal = $allEntries.Count }
        nudgeCount = $nudgeCount
        note = 'deterministic.* are high-confidence (safe to remove); judgmentCandidates require the independent verification pass; judgmentCandidatesSuppressed were already adjudicated KEEP (on the keep-list) and hidden -- use -FullReaudit to re-surface them; mcpServersForVerification need a manual liveness check (no machine-readable live registry); subsumptionAdvisory is advisory only (never auto-remove). After applying approved drops, call -Action keep-record with the kept indices to record them.'
    }
}

# Record reviewer/user-approved KEEP verdicts into the keep-list, BY INDEX, from the
# exact scan-settings result the reviewer saw. Only adjudicated keeps are recorded --
# never an un-reviewed or dropped entry, so the list can never silently "bless" an
# entry the process did not actually review. Indices (integers) are transcription-safe.
# The new keep-list = (existing keep-list entries STILL present in a settings file,
# dates preserved) UNION (the kept entries, dated today; existing date preserved if
# already present); entries no longer present in either settings file are pruned.
function Invoke-KeepRecord {
    if (-not $ScanResult -or -not (Test-Path -LiteralPath $ScanResult)) {
        return [pscustomobject]@{ ok = $false; action = 'keep-record'; error = "scan-result file not found: $ScanResult" }
    }
    try { $scan = Get-Content -Raw -Path $ScanResult -Encoding UTF8 | ConvertFrom-Json }
    catch { return [pscustomobject]@{ ok = $false; action = 'keep-record'; error = 'scan-result file is not valid JSON' } }

    if (-not $Nonce) {
        return [pscustomobject]@{ ok = $false; action = 'keep-record'; error = 'Nonce is required -- pass the "nonce" field from the scan-settings output you adjudicated.' }
    }
    if ([string]$scan.nonce -ne [string]$Nonce) {
        return [pscustomobject]@{ ok = $false; action = 'keep-record'; error = 'nonce mismatch: the scan-result was produced by a different / re-run scan than the one whose indices you computed. Re-run scan-settings, re-adjudicate, and pass the fresh nonce.' }
    }

    $jc = @($scan.judgmentCandidates)
    $idxList = @()
    if ($KeepIndices) {
        foreach ($p in ($KeepIndices -split '[,\s]+')) {
            if ($p -eq '') { continue }
            $n = 0
            if ([int]::TryParse($p, [ref]$n)) { $idxList += $n }
            else { return [pscustomobject]@{ ok = $false; action = 'keep-record'; error = "KeepIndices contains a non-integer token: '$p'" } }
        }
    }
    $kept = @()
    foreach ($n in $idxList) {
        if ($n -lt 0 -or $n -ge $jc.Count) {
            return [pscustomobject]@{ ok = $false; action = 'keep-record'; error = "index $n out of range (0..$($jc.Count - 1))" }
        }
        $kept += [string]$jc[$n].entry
    }

    # Current settings allow entries (both files) -- the universe used to prune.
    $main  = Read-PermFile $SettingsJson
    $local = Read-PermFile $SettingsLocalJson
    $present = @{}
    foreach ($e in $main.allow)  { $present[[string]$e] = $true }
    foreach ($e in $local.allow) { $present[[string]$e] = $true }

    $existing = Read-KeepList $KeepListFile
    $today = (Get-Date).ToString('yyyy-MM-dd')
    $new = @{}
    $pruned = @()
    foreach ($k in $existing.Keys) {
        if ($present.ContainsKey($k)) { $new[$k] = $existing[$k] }
        else { $pruned += $k }
    }
    $added = @()
    foreach ($e in $kept) {
        if (-not $new.ContainsKey($e)) { $new[$e] = $today; $added += $e }
    }
    Write-KeepList $KeepListFile $new

    return [pscustomobject]@{
        ok = $true; action = 'keep-record'; keepListFile = $KeepListFile
        recorded = $added; recordedCount = $added.Count
        prunedAbsent = $pruned; prunedCount = $pruned.Count
        keepListTotal = $new.Count
    }
}

# Weekly heads-up gate: piggybacks on /wrap. If >= NudgeDays since the last nudge,
# run the deterministic scan, return the candidate count, and reset the timer (so
# the cadence is ~weekly regardless of how often /wrap runs). No agent here.
function Invoke-SettingsNudge {
    $days = if ($NudgeDays -gt 0) { $NudgeDays } else { 7 }
    $now = Get-Date
    $due = $true
    $last = $null
    if ($NudgeStateFile -and (Test-Path $NudgeStateFile)) {
        try {
            $raw = (Get-Content -Raw -Path $NudgeStateFile -Encoding UTF8).Trim()
            $last = [datetime]::Parse($raw)
            if (($now - $last).TotalDays -lt $days) { $due = $false }
        } catch { $due = $true }
    }
    if (-not $due) {
        return [pscustomobject]@{ ok = $true; action = 'settings-nudge'; due = $false; lastNudge = $(if ($last) { $last.ToString('yyyy-MM-dd') } else { $null }); intervalDays = $days }
    }
    $scan = Invoke-ScanSettings
    $count = 0
    if ($scan.ok) { $count = $scan.nudgeCount }
    if ($NudgeStateFile) {
        try { Set-Content -Path $NudgeStateFile -Value ($now.ToString('yyyy-MM-dd')) -Encoding UTF8 -NoNewline } catch {}
    }
    # Keep-list re-audit reminder: drift-proof (driven by the OLDEST stored entry date,
    # not the file mtime). When the list is old, prompt a -FullReaudit even if nothing
    # NEW is stale (the shouldNudge:false path) -- but never force a re-review.
    $ks = Get-KeepListStats (Read-KeepList $KeepListFile) $KeepReauditDays
    $reauditMsg = $(if ($ks.old) { "Settings keep-list has $($ks.count) entry(ies); the oldest was approved $($ks.ageDays) days ago (>= $KeepReauditDays) -- consider a full re-audit: run /config-health settings full." } else { $null })
    return [pscustomobject]@{
        ok = $true; action = 'settings-nudge'; due = $true
        nudgeCount = $count
        shouldNudge = ($count -gt 0)
        intervalDays = $days
        keepListCount = $ks.count
        keepListAgeDays = $ks.ageDays
        keepListOld = $ks.old
        keepListReauditDays = $KeepReauditDays
        reauditMessage = $reauditMsg
        message = $(if ($count -gt 0) { "It's been at least $days days; about $count settings permission entries look stale -- run /config-health settings to review." } else { $null })
    }
}

# ============================================================================
# Size limits (GEN-886): measure the files that steer Claude against the limits
# in the thresholds file (-GuidelinesFile). READ-ONLY: writes nothing.
# Every number comes from that file; this code only knows HOW to measure each
# limit id. An id in the file that this code does not measure is reported
# (unhandledLimits), and an id this code measures that the file lacks fails
# the run, so the two can never drift apart silently.
# ============================================================================

$script:SizeMeasuredIds = @('hook-injected-text', 'skill-after-compaction', 'skill-md-lines',
    'skill-description-listing', 'skill-description-portable', 'claude-md-lines',
    'memory-md-load', 'reference-file-toc', 'gate-skill-runbook')

# YAML double-quoted escapes that map to one character (case-sensitive keys).
$script:SizeYamlEscapes = New-Object 'System.Collections.Generic.Dictionary[string,int]'
$script:SizeYamlEscapes['0'] = 0;   $script:SizeYamlEscapes['a'] = 7;    $script:SizeYamlEscapes['b'] = 8
$script:SizeYamlEscapes['t'] = 9;   $script:SizeYamlEscapes["`t"] = 9;   $script:SizeYamlEscapes['n'] = 10
$script:SizeYamlEscapes['v'] = 11;  $script:SizeYamlEscapes['f'] = 12;   $script:SizeYamlEscapes['r'] = 13
$script:SizeYamlEscapes['e'] = 27;  $script:SizeYamlEscapes[' '] = 32;   $script:SizeYamlEscapes['"'] = 34
$script:SizeYamlEscapes['/'] = 47;  $script:SizeYamlEscapes['\'] = 92;   $script:SizeYamlEscapes['N'] = 0x85
$script:SizeYamlEscapes['_'] = 0xA0; $script:SizeYamlEscapes['L'] = 0x2028; $script:SizeYamlEscapes['P'] = 0x2029

function Get-NormPath([string]$p) {
    return ([System.IO.Path]::GetFullPath($p)).TrimEnd('\').ToLowerInvariant()
}

function Format-SizeNum($n) {
    return ([double]$n).ToString('#,##0.##', [System.Globalization.CultureInfo]::InvariantCulture)
}

function ConvertTo-SizeNumber($v, [string]$what) {
    $d = 0.0
    $ok = ($null -ne $v) -and [double]::TryParse([string]$v, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$d)
    if (-not $ok -or [double]::IsNaN($d) -or [double]::IsInfinity($d) -or $d -le 0) { throw "thresholds file: $what is missing, not a number, or not above 0" }
    return $d
}

function Read-SizeLimits {
    if (-not $GuidelinesFile -or -not (Test-Path -LiteralPath $GuidelinesFile -PathType Leaf)) {
        throw "thresholds file not found: $GuidelinesFile"
    }
    $g = $null
    try { $g = Get-Content -Raw -LiteralPath $GuidelinesFile -Encoding UTF8 | ConvertFrom-Json }
    catch { throw "thresholds file is not valid JSON: $GuidelinesFile" }
    if (-not $g -or -not $g.counting -or -not $g.limits) { throw "thresholds file lacks its counting or limits block: $GuidelinesFile" }
    $byId = @{}
    foreach ($e in @($g.limits))     { if ($e -and $e.id) { $byId[[string]$e.id] = [pscustomobject]@{ e = $e; house = $false } } }
    foreach ($e in @($g.houseRules)) { if ($e -and $e.id) { $byId[[string]$e.id] = [pscustomobject]@{ e = $e; house = $true } } }
    foreach ($id in $script:SizeMeasuredIds) {
        if (-not $byId.ContainsKey($id)) { throw "thresholds file lacks limit '$id', which the scan measures" }
    }
    $unhandled = @($byId.Keys | Where-Object { $script:SizeMeasuredIds -notcontains $_ } | Sort-Object)
    $cpt = ConvertTo-SizeNumber $g.counting.charsPerToken 'counting.charsPerToken'
    $ratio = ConvertTo-SizeNumber $g.counting.nearLimitRatio 'counting.nearLimitRatio'
    if ($cpt -le 0) { throw 'thresholds file: counting.charsPerToken must be above 0' }
    if ($ratio -le 0 -or $ratio -ge 1) { throw 'thresholds file: counting.nearLimitRatio must be between 0 and 1' }
    $limits = @{}
    foreach ($id in $script:SizeMeasuredIds) {
        $e = $byId[$id].e
        $kind = if ($byId[$id].house) { 'house' } else { [string]$e.kind }
        if ($kind -ne 'house' -and $kind -ne 'hard' -and $kind -ne 'recommended') {
            throw "thresholds file: limit '$id' has kind '$kind' (expected hard or recommended)"
        }
        $o = [ordered]@{ id = $id; kind = $kind; reportAs = [string]$e.reportAs }
        if ($id -eq 'memory-md-load') {
            $o['valueLines'] = ConvertTo-SizeNumber $e.valueLines "$id.valueLines"
            $o['valueBytes'] = ConvertTo-SizeNumber $e.valueBytes "$id.valueBytes"
        } else {
            $o['value'] = ConvertTo-SizeNumber $e.value "$id.value"
        }
        if ($id -eq 'reference-file-toc') { $o['tocWindowLines'] = [int](ConvertTo-SizeNumber $e.tocWindowLines "$id.tocWindowLines") }
        if ($id -eq 'gate-skill-runbook') {
            $names = @(@($e.skills) | Where-Object { $_ } | ForEach-Object { ([string]$_).ToLowerInvariant() })
            if ($names.Count -eq 0) { throw "thresholds file: house rule '$id' lists no skills" }
            $o['skills'] = $names
        }
        $limits[$id] = [pscustomobject]$o
    }
    return [pscustomobject]@{
        limits = $limits; charsPerToken = $cpt; nearLimitRatio = $ratio; unhandled = $unhandled; file = $GuidelinesFile
        skipped = (New-Object System.Collections.ArrayList); errors = (New-Object System.Collections.ArrayList)
        measurements = (New-Object System.Collections.ArrayList)
    }
}

# File text as Claude Code would read it: UTF-8, a leading BOM dropped. bytes = size on disk.
function Read-SizeText([string]$path) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $text = (New-Object System.Text.UTF8Encoding($false)).GetString($bytes)
    if ($text.Length -gt 0 -and [int]$text[0] -eq 0xFEFF) { $text = $text.Substring(1) }
    return [pscustomobject]@{ text = $text; bytes = $bytes.Length }
}

# Unicode code points = UTF-16 length minus the low halves of surrogate pairs.
function Get-CodePointCount([string]$s) {
    if (-not $s) { return 0 }
    return $s.Length - [regex]::Matches($s, '[\uDC00-\uDFFF]').Count
}

# wc -l semantics, plus a final line that has no newline after it.
function Get-LineCount([string]$s) {
    if (-not $s) { return 0 }
    $n = [regex]::Matches($s, "`n").Count
    if ($s[$s.Length - 1] -ne [char]10) { $n++ }
    return $n
}

# SKILL.md -> frontmatter text (or $null) + body, as Claude Code attaches it: the text after the
# closing --- line, leading blank lines removed.
function Split-SizeFrontmatter([string]$text) {
    $m = [regex]::Match($text, '\A---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|\z)')
    if (-not $m.Success) { return [pscustomobject]@{ frontmatter = $null; body = $text } }
    $body = [regex]::Replace($text.Substring($m.Length), '\A(?:\r?\n)+', '')
    return [pscustomobject]@{ frontmatter = $m.Groups[1].Value; body = $body }
}

function New-SizeScalar([string]$status, [string]$reason, $value) {
    return [pscustomobject]@{ status = $status; reason = $reason; value = $value }
}

# YAML line folding, enough to count characters: a line break inside a flow scalar becomes one
# space (blanks around it dropped); an empty line becomes a newline.
function Join-SizeFolded([string]$first, $cont) {
    $s = $first
    foreach ($c in @($cont)) {
        if ($null -eq $c -or $c.Trim() -eq '') { $s += "`n" }
        elseif ($s.EndsWith("`n")) { $s += $c.Trim() }
        else { $s = $s.TrimEnd() + ' ' + $c.Trim() }
    }
    return $s
}

# One YAML scalar value -> its text. Reads only the forms our skills use (double-quoted,
# single-quoted, plain); anything else is 'unsupported' (valid YAML this scan does not read) or
# 'invalid' (YAML rejects it, and Claude Code then loads the skill with no fields).
function ConvertFrom-SizeYamlScalar([string]$first, $cont) {
    $first = $first.TrimEnd()
    if ($first.StartsWith('"')) {
        $raw = Join-SizeFolded $first.Substring(1) $cont
        $sb = New-Object System.Text.StringBuilder
        $k = 0
        $closed = $false
        while ($k -lt $raw.Length) {
            $ch = $raw[$k]
            if ($ch -eq [char]34) { $closed = $true; $k++; break }
            if ($ch -ne [char]92) { [void]$sb.Append($ch); $k++; continue }
            if ($k + 1 -ge $raw.Length) { return (New-SizeScalar 'invalid' 'a backslash ends the text' $null) }
            $nx = [string]$raw[$k + 1]
            $code = 0
            if ($script:SizeYamlEscapes.TryGetValue($nx, [ref]$code)) { [void]$sb.Append([char]$code); $k += 2; continue }
            $hexLen = 0
            if ($nx -ceq 'x') { $hexLen = 2 } elseif ($nx -ceq 'u') { $hexLen = 4 } elseif ($nx -ceq 'U') { $hexLen = 8 }
            if ($hexLen -eq 0) { return (New-SizeScalar 'invalid' ('unknown escape \' + $nx) $null) }
            if ($k + 2 + $hexLen -gt $raw.Length) { return (New-SizeScalar 'invalid' ('unfinished \' + $nx + ' escape') $null) }
            $hex = $raw.Substring($k + 2, $hexLen)
            if ($hex -notmatch '^[0-9A-Fa-f]+$') { return (New-SizeScalar 'invalid' ('bad \' + $nx + ' escape') $null) }
            $cp = [Convert]::ToInt64($hex, 16)
            if ($cp -gt 0x10FFFF) { return (New-SizeScalar 'invalid' ('bad \' + $nx + ' escape') $null) }
            if ($cp -ge 0xD800 -and $cp -le 0xDFFF) { [void]$sb.Append([char][int]$cp) }
            else { [void]$sb.Append([char]::ConvertFromUtf32([int]$cp)) }
            $k += 2 + $hexLen
        }
        if (-not $closed) { return (New-SizeScalar 'invalid' 'no closing double quote' $null) }
        $tail = $raw.Substring($k).Trim()
        if ($tail -and -not $tail.StartsWith('#')) { return (New-SizeScalar 'invalid' 'text after the closing quote' $null) }
        return (New-SizeScalar 'ok' $null $sb.ToString())
    }
    if ($first.StartsWith("'")) {
        $raw = Join-SizeFolded $first.Substring(1) $cont
        $sb = New-Object System.Text.StringBuilder
        $k = 0
        $closed = $false
        while ($k -lt $raw.Length) {
            $ch = $raw[$k]
            if ($ch -eq [char]39) {
                if ($k + 1 -lt $raw.Length -and $raw[$k + 1] -eq [char]39) { [void]$sb.Append([char]39); $k += 2; continue }
                $closed = $true; $k++; break
            }
            [void]$sb.Append($ch); $k++
        }
        if (-not $closed) { return (New-SizeScalar 'invalid' 'no closing single quote' $null) }
        $tail = $raw.Substring($k).Trim()
        if ($tail -and -not $tail.StartsWith('#')) { return (New-SizeScalar 'invalid' 'text after the closing quote' $null) }
        return (New-SizeScalar 'ok' $null $sb.ToString())
    }
    if ($first -match '^[|>]') { return (New-SizeScalar 'unsupported' 'block scalar (| or >)' $null) }
    if ($first -match '^[\[\{&\*!%@`]') { return (New-SizeScalar 'unsupported' 'flow collection, anchor, alias or tag' $null) }
    # GEN-969: a first-line value that is only a comment is no value; YAML then takes the continuation
    # lines, if any, as the value.
    if ($first.StartsWith('#')) { $first = '' }
    $val = Join-SizeFolded $first $cont
    $hashAt = $val.IndexOf(' #')
    if ($hashAt -ge 0) { $val = $val.Substring(0, $hashAt) }
    $val = $val.Trim()
    # GEN-969: YAML's empty forms; a plain ~ or null (any of its three spellings) is an empty value.
    if ($val -ceq '~' -or $val -ceq 'null' -or $val -ceq 'Null' -or $val -ceq 'NULL') { $val = '' }
    return (New-SizeScalar 'ok' $null $val)
}

# SKILL.md frontmatter -> description, when_to_use, disable-model-invocation.
function Read-SizeFrontmatter($fm) {
    $res = [ordered]@{ status = 'ok'; reason = $null; description = $null; whenToUse = $null; noModelInvocation = $false }
    if ($null -eq $fm) { $res.status = 'unsupported'; $res.reason = 'no frontmatter block'; return [pscustomobject]$res }
    $lines = @($fm -split '\r?\n')
    $i = 0
    while ($i -lt $lines.Count) {
        $km = [regex]::Match($lines[$i], '^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$')
        if (-not $km.Success) { $i++; continue }
        $key = $km.Groups[1].Value
        $rest = if ($km.Groups[2].Success) { $km.Groups[2].Value } else { '' }
        $j = $i + 1
        $cont = @()
        while ($j -lt $lines.Count -and ($lines[$j] -match '^[ \t]' -or $lines[$j] -eq '')) { $cont += $lines[$j]; $j++ }
        if ($key -eq 'disable-model-invocation') {
            $res.noModelInvocation = ($rest.Trim() -eq 'true')
        } elseif ($key -eq 'description' -or $key -eq 'when_to_use') {
            $p = ConvertFrom-SizeYamlScalar $rest $cont
            if ($p.status -ne 'ok') {
                if ($res.status -eq 'ok') { $res.status = $p.status; $res.reason = ('{0}: {1}' -f $key, $p.reason) }
            } elseif ($key -eq 'description') { $res.description = $p.value }
            else { $res.whenToUse = $p.value }
        }
        $i = $j
    }
    return [pscustomobject]$res
}

# Which limits apply to a path. Returns $null when none do.
function Get-SizeClass([string]$path) {
    $p = Get-NormPath $path
    $leaf = [System.IO.Path]::GetFileName($p)
    if ($p -eq (Get-NormPath $GlobalClaude)) { return [pscustomobject]@{ class = 'claude-md' } }
    $skills = Get-NormPath $SkillsDir
    if ($p.StartsWith($skills + '\')) {
        $seg = $p.Substring($skills.Length + 1).Split('\')
        if ($seg[0] -eq 'synced' -or $seg.Count -lt 2) { return $null }
        if ($seg.Count -eq 2 -and $seg[1] -eq 'skill.md') {
            return [pscustomobject]@{ class = 'skill'; skillName = $seg[0]; skillFolder = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($path)) }
        }
        if ($leaf -ne 'skill.md' -and $leaf.EndsWith('.md')) { return [pscustomobject]@{ class = 'skill-ref' } }
        return $null
    }
    $refs = Get-NormPath (Join-Path $HooksDir 'refs')
    if ($p.StartsWith($refs + '\')) {
        if ($p.Substring($refs.Length + 1) -notmatch '\\' -and $leaf.EndsWith('.md')) { return [pscustomobject]@{ class = 'hook-ref' } }
        return $null
    }
    $projs = Get-NormPath $ClaudeProjectsDir
    if ($p.StartsWith($projs + '\') -and $p.Substring($projs.Length + 1) -match '^[^\\]+\\memory\\memory\.md$') {
        return [pscustomobject]@{ class = 'memory-md' }
    }
    if ($CommandsDir) {
        $cmds = Get-NormPath $CommandsDir
        if ($p.StartsWith($cmds + '\') -and $p.Substring($cmds.Length + 1) -notmatch '\\' -and $leaf.EndsWith('.md')) {
            return [pscustomobject]@{ class = 'command' }
        }
    }
    if ($leaf -eq 'claude.md' -or $leaf -eq 'claude.local.md') { return [pscustomobject]@{ class = 'claude-md' } }
    return $null
}

# GEN-893: every measured value, near a limit or not, kept apart from the findings so the
# findings output (sweep, size-check, scan) is unchanged. size-check turns these into sizeLines.
function Add-SizeMeasure($ctx, $lim, [string]$measure, $value, $limitValue, [string]$extra) {
    if ($null -eq $ctx.measurements) { return }
    [void]$ctx.measurements.Add([pscustomobject]@{
        key = ('{0}|{1}' -f $lim.id, $measure); limitId = $lim.id; kind = $lim.kind; reportAs = $lim.reportAs
        measure = $measure; value = $value; limit = $limitValue; extra = $extra
    })
}

# One finding when value is over the limit (breach, or note for a reportAs:note limit) or over
# nearLimitRatio x limit (near); $null otherwise. key = path|limit id|measure.
function New-SizeFinding($ctx, [string]$asIf, $lim, [string]$measure, $value, $limitValue, [string]$detail) {
    if ($lim.id -ne 'reference-file-toc') { Add-SizeMeasure $ctx $lim $measure $value $limitValue '' }
    if ($value -gt $limitValue) {
        $sev = if ($lim.reportAs -eq 'note') { 'note' } else { 'breach' }
    } elseif ($lim.id -ne 'reference-file-toc' -and $value -gt ($ctx.nearLimitRatio * $limitValue)) {
        $sev = 'near'
    } else {
        return $null
    }
    $line = '{0} {1} {2} {3}: {4} {5} (limit {6}){7}' -f $sev.ToUpperInvariant(), $lim.kind, $lim.id, $asIf, (Format-SizeNum $value), $measure, (Format-SizeNum $limitValue), $detail
    return [pscustomobject]@{
        key = ('{0}|{1}|{2}' -f (Get-NormPath $asIf), $lim.id, $measure); file = $asIf; limitId = $lim.id; kind = $lim.kind
        severity = $sev; measure = $measure; value = $value; limit = $limitValue; line = $line
    }
}

function New-SizeNote($ctx, [string]$asIf, $lim, [string]$measure, [string]$text) {
    Add-SizeMeasure $ctx $lim $measure $null $null $text
    return [pscustomobject]@{
        key = ('{0}|{1}|{2}' -f (Get-NormPath $asIf), $lim.id, $measure); file = $asIf; limitId = $lim.id; kind = $lim.kind
        severity = 'note'; measure = $measure; value = $null; limit = $null
        line = ('NOTE format {0} {1}: {2}' -f $lim.id, $asIf, $text)
    }
}

# Measure the content of $contentPath against the limits that apply to $asIf.
function Measure-SizeFile($ctx, [string]$contentPath, [string]$asIf, $cls) {
    $out = @()
    $t = Read-SizeText $contentPath
    $text = $t.text
    $L = $ctx.limits
    if ($cls.class -eq 'claude-md') {
        $lim = $L['claude-md-lines']
        $f = New-SizeFinding $ctx $asIf $lim 'lines' (Get-LineCount $text) $lim.value ('; {0} characters' -f (Format-SizeNum (Get-CodePointCount $text)))
        if ($f) { $out += $f }
    } elseif ($cls.class -eq 'hook-ref') {
        $lim = $L['hook-injected-text']
        $f = New-SizeFinding $ctx $asIf $lim 'characters' (Get-CodePointCount $text) $lim.value ''
        if ($f) { $out += $f }
    } elseif ($cls.class -eq 'memory-md') {
        $lim = $L['memory-md-load']
        $f = New-SizeFinding $ctx $asIf $lim 'lines' (Get-LineCount $text) $lim.valueLines ''
        if ($f) { $out += $f }
        $f = New-SizeFinding $ctx $asIf $lim 'bytes' $t.bytes $lim.valueBytes ''
        if ($f) { $out += $f }
    } elseif ($cls.class -eq 'skill-ref') {
        $lim = $L['reference-file-toc']
        $n = Get-LineCount $text
        $head = @(($text -split '\r?\n') | Select-Object -First $lim.tocWindowLines)
        $hasToc = @($head | Where-Object { $_ -match '(?i)^\s*(#{1,6}\s.*\bcontents\b|\*\*.*\bcontents\b.*\*\*)' }).Count -gt 0
        Add-SizeMeasure $ctx $lim 'lines' $n $lim.value ('contents heading: ' + $(if ($hasToc) { 'yes' } else { 'no' }))
        if ($n -gt $lim.value) {
            if (-not $hasToc) {
                $f = New-SizeFinding $ctx $asIf $lim 'lines' $n $lim.value ('; no table of contents in the first {0} lines' -f $lim.tocWindowLines)
                if ($f) { $out += $f }
            }
        }
    } elseif ($cls.class -eq 'skill') {
        $sp = Split-SizeFrontmatter $text
        # What Claude Code re-attaches after a compaction: this header + the body (see counting block).
        $attached = 'Base directory for this skill: ' + $cls.skillFolder + "`n`n" + $sp.body
        $lim = $L['skill-after-compaction']
        $tokens = [math]::Ceiling($attached.Length / $ctx.charsPerToken)
        $f = New-SizeFinding $ctx $asIf $lim 'tokens' $tokens $lim.value ('; {0} characters re-attached at {1} characters per token' -f (Format-SizeNum $attached.Length), (Format-SizeNum $ctx.charsPerToken))
        if ($f) { $out += $f }
        $lim = $L['skill-md-lines']
        $f = New-SizeFinding $ctx $asIf $lim 'body lines' (Get-LineCount $sp.body) $lim.value ''
        if ($f) { $out += $f }
        $out += @(Measure-SizeDescription $ctx $asIf $sp.frontmatter $false)
        $lim = $L['gate-skill-runbook']
        if ($lim.skills -contains $cls.skillName) {
            $f = New-SizeFinding $ctx $asIf $lim 'characters' (Get-CodePointCount $text) $lim.value '; whole file'
            if ($f) { $out += $f }
        }
    } elseif ($cls.class -eq 'command') {
        $out += @(Measure-SizeDescription $ctx $asIf (Split-SizeFrontmatter $text).frontmatter $true)
    }
    return $out
}

# A skill's or command's description against the listing cap and the portable note.
# $isCommand: a command with no frontmatter or no description gets its own note (the listing then
# uses other text, which this scan does not measure); a skill keeps the GEN-886 behaviour.
function Measure-SizeDescription($ctx, [string]$asIf, $fm, [bool]$isCommand) {
    $out = @()
    $L = $ctx.limits
    $fmr = Read-SizeFrontmatter $fm
    $noDesc = 'description not in frontmatter; the listing uses other text, which this scan does not measure'
    if ($fmr.noModelInvocation) {
        [void]$ctx.skipped.Add(('{0}: description checks skipped (disable-model-invocation: the description is not loaded)' -f $asIf))
    } elseif ($isCommand -and $null -eq $fm) {
        $out += New-SizeNote $ctx $asIf $L['skill-description-listing'] 'readable' $noDesc
    } elseif ($fmr.status -eq 'invalid') {
        $out += New-SizeNote $ctx $asIf $L['skill-description-listing'] 'readable' ('description not readable as YAML ({0}); per the skills doc the skill then loads with no frontmatter fields, so this scan cannot measure its description' -f $fmr.reason)
    } elseif ($fmr.status -ne 'ok') {
        $out += New-SizeNote $ctx $asIf $L['skill-description-listing'] 'readable' ('description in a form this scan does not read ({0}); check it by hand' -f $fmr.reason)
    } elseif ($isCommand -and ($null -eq $fmr.description -or $fmr.description.Trim() -eq '')) {
        $out += New-SizeNote $ctx $asIf $L['skill-description-listing'] 'readable' $noDesc
    } else {
        $desc = if ($null -ne $fmr.description) { $fmr.description } else { '' }
        $listing = Get-CodePointCount $desc
        if ($fmr.whenToUse) { $listing += 1 + (Get-CodePointCount $fmr.whenToUse) }
        $lim = $L['skill-description-listing']
        $f = New-SizeFinding $ctx $asIf $lim 'characters' $listing $lim.value '; description + when_to_use'
        if ($f) { $out += $f }
        $lim = $L['skill-description-portable']
        $f = New-SizeFinding $ctx $asIf $lim 'characters' (Get-CodePointCount $desc) $lim.value '; description'
        if ($f) { $out += $f }
    }
    return $out
}

function New-SizeResult([string]$action, $ctx, $findings, [int]$measured, $extra) {
    $order = @{ breach = 0; near = 1; note = 2 }
    $sorted = @(@($findings) | Where-Object { $_ } | Sort-Object @{ Expression = { $order[$_.severity] } }, @{ Expression = { $_.key } })
    $lines = @($sorted | ForEach-Object { $_.line })
    foreach ($u in @($ctx.unhandled)) { $lines += ("UNMEASURED limit '{0}' is in the thresholds file but this scan does not measure it" -f $u) }
    foreach ($er in @($ctx.errors)) { $lines += ('ERROR ' + $er) }
    $o = [ordered]@{
        ok = $true; action = $action; guidelinesFile = $ctx.file; charsPerToken = $ctx.charsPerToken
        counts = [pscustomobject]@{
            breach = @($sorted | Where-Object { $_.severity -eq 'breach' }).Count
            near   = @($sorted | Where-Object { $_.severity -eq 'near' }).Count
            note   = @($sorted | Where-Object { $_.severity -eq 'note' }).Count
            errors = @($ctx.errors).Count
            filesMeasured = $measured
        }
        findings = $sorted; lines = $lines
        unhandledLimits = @($ctx.unhandled); skipped = @($ctx.skipped); errors = @($ctx.errors)
    }
    if ($extra) { foreach ($k in @($extra.Keys)) { $o[$k] = $extra[$k] } }
    return [pscustomobject]$o
}

# Single-file core, shared by size-check and scan.
function Invoke-SizeCheckCore([string]$contentPath, [string]$asIf) {
    $ctx = Read-SizeLimits
    $cls = Get-SizeClass $asIf
    $findings = @()
    if ($cls) { $findings = @(Measure-SizeFile $ctx $contentPath $asIf $cls) }
    return [pscustomobject]@{ ctx = $ctx; cls = $cls; findings = $findings }
}

function Invoke-SizeCheck {
    if (-not $Target -or -not (Test-Path -LiteralPath $Target -PathType Leaf)) {
        return [pscustomobject]@{ ok = $false; action = 'size-check'; error = "target file not found: $Target" }
    }
    # Resolve both against the PowerShell location, so a relative path means the same file to
    # Test-Path above and to the .NET file reads below.
    $tgt = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Target)
    $asIf = if ($AsIfPath) { $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($AsIfPath) } else { $tgt }
    $r = Invoke-SizeCheckCore $tgt $asIf
    $cls = if ($r.cls) { $r.cls.class } else { $null }
    # "now" = the real file at -AsIfPath, measured on its own, when it exists and is not the draft.
    $nowState = 'same'
    $now = @{}
    if ($cls -and (Get-NormPath $asIf) -ne (Get-NormPath $tgt)) {
        if (Test-Path -LiteralPath $asIf -PathType Leaf) {
            # An unreadable real file must not cost the draft's own measurements.
            try {
                $r0 = Invoke-SizeCheckCore $asIf $asIf
                foreach ($m in @($r0.ctx.measurements)) { $now[$m.key] = $m }
                $nowState = 'existing'
            } catch {
                $nowState = 'unavailable'
                [void]$r.ctx.errors.Add(('could not measure the real file {0}: {1}' -f $asIf, $_.Exception.Message))
            }
        } else {
            $nowState = 'new'
        }
    }
    $sizeLines = @(Format-SizeLines $asIf $cls $r.ctx $nowState $now)
    $res = New-SizeResult 'size-check' $r.ctx $r.findings $(if ($cls) { 1 } else { 0 }) ([ordered]@{ target = $tgt; asIfPath = $asIf; class = $cls; sizeLines = $sizeLines })
    if (-not $cls) { $res.lines = @(('No size limits apply to {0}' -f $asIf)) + @($res.lines) }
    return $res
}

# GEN-893: one "size:" line per applicable limit, in /suggest check 4b's form:
#   size: <file> <now> -> <proposed> / <limit> <unit> (<kind>[, note]; <limit id>[; extra])
# <now> is "new" for a file that does not exist yet; with no separate real file (-AsIfPath not
# given, or the same file), the line shows one value and no arrow.
function Format-SizeLines([string]$asIf, $cls, $ctx, [string]$nowState, $now) {
    if (-not $cls) { return @(('size: skipped (no size limits apply to {0})' -f $asIf)) }
    $arrow = ' ' + [string][char]0x2192 + ' '
    $out = @()
    foreach ($m in @($ctx.measurements)) {
        $tag = $m.kind
        if ($m.reportAs -eq 'note') { $tag += ', note' }
        $tag += '; ' + $m.limitId
        if ($null -eq $m.value) {
            $out += ('size: {0} {1} not measured: {2} ({3})' -f $asIf, $m.measure, $m.extra, $tag)
            continue
        }
        if ($m.extra) { $tag += '; ' + $m.extra }
        $val = Format-SizeNum $m.value
        if ($nowState -eq 'new') {
            $val = 'new' + $arrow + $val
        } elseif ($nowState -eq 'unavailable') {
            $val = 'now unavailable' + $arrow + $val
        } elseif ($nowState -eq 'existing') {
            $n = $now[$m.key]
            $nv = if ($n -and $null -ne $n.value) { Format-SizeNum $n.value } else { 'not measured' }
            $val = $nv + $arrow + $val
        }
        $out += ('size: {0} {1} / {2} {3} ({4})' -f $asIf, $val, (Format-SizeNum $m.limit), $m.measure, $tag)
    }
    # A limit the real file was measured on but the draft was not (e.g. the draft drops its
    # description): show the old value so the change is not hidden.
    if ($nowState -eq 'existing') {
        $seen = @{}
        foreach ($m in @($ctx.measurements)) { $seen[$m.key] = $true }
        foreach ($k in @($now.Keys | Sort-Object)) {
            $n = $now[$k]
            if ($seen.ContainsKey($k) -or $null -eq $n.value) { continue }
            $tag = $n.kind
            if ($n.reportAs -eq 'note') { $tag += ', note' }
            $tag += '; ' + $n.limitId
            $out += ('size: {0} {1}{2}not measured / {3} {4} ({5})' -f $asIf, (Format-SizeNum $n.value), $arrow, (Format-SizeNum $n.limit), $n.measure, $tag)
        }
    }
    foreach ($s in @($ctx.skipped)) { $out += ('size: skipped ({0})' -f $s) }
    if ($out.Count -eq 0) { $out += ('size: skipped (no limit measured for {0})' -f $asIf) }
    return $out
}

# Working folders Claude has run in, read from the newest top-level session log of each
# ~/.claude/projects/<dir> (regex on the first 50 lines; some lines are megabytes, too big for
# ConvertFrom-Json). Worktrees and folders that no longer exist are skipped.
function Get-SizeSessionCwds($ctx) {
    $out = @()
    if (-not $ClaudeProjectsDir -or -not (Test-Path -LiteralPath $ClaudeProjectsDir -PathType Container)) {
        [void]$ctx.errors.Add("Claude projects folder not found: $ClaudeProjectsDir")
        return $out
    }
    foreach ($d in @(Get-ChildItem -LiteralPath $ClaudeProjectsDir -Directory -ErrorAction SilentlyContinue)) {
        $log = @(Get-ChildItem -LiteralPath $d.FullName -File -Filter '*.jsonl' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
        if ($log.Count -eq 0) { continue }
        $cwd = $null
        $sr = $null
        $fsh = $null
        try {
            # Share ReadWrite: the newest log is usually open for writing by a live session.
            $fsh = [System.IO.File]::Open($log[0].FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            $sr = New-Object System.IO.StreamReader($fsh, [System.Text.Encoding]::UTF8)
            for ($n = 0; $n -lt 50 -and -not $cwd; $n++) {
                $ln = $sr.ReadLine()
                if ($null -eq $ln) { break }
                $m = [regex]::Match($ln, '"cwd":"((?:[^"\\]|\\.)*)"')
                if ($m.Success) { $cwd = [regex]::Unescape($m.Groups[1].Value) }
            }
        } catch {
            [void]$ctx.errors.Add(('could not read {0}: {1}' -f $log[0].FullName, $_.Exception.Message))
        } finally {
            if ($sr) { $sr.Dispose() } elseif ($fsh) { $fsh.Dispose() }
        }
        if (-not $cwd) { [void]$ctx.errors.Add(('no working folder in the first 50 lines of {0}' -f $log[0].FullName)); continue }
        if ($cwd -match '\\\.claude\\worktrees\\') { continue }
        if (-not (Test-Path -LiteralPath $cwd -PathType Container)) { continue }
        $out += $cwd
    }
    return $out
}

# $cls = $null -> classify the path here (inside the try, so one bad path is logged, not fatal).
function Add-SizeTarget($ctx, $map, [string]$path, $cls) {
    $k = $null
    try {
        if (-not $cls) { $cls = Get-SizeClass $path }
        if (-not $cls) { return }
        $k = Get-NormPath $path
    } catch {
        [void]$ctx.errors.Add(('could not resolve {0}: {1}' -f $path, $_.Exception.Message))
        return
    }
    if (-not $map.Contains($k)) { $map[$k] = [pscustomobject]@{ path = [System.IO.Path]::GetFullPath($path); cls = $cls } }
}

function Invoke-SizeSweep {
    $ctx = Read-SizeLimits
    $targets = [ordered]@{}

    # CLAUDE.md files Claude loads: the global file; CLAUDE.md, .claude\CLAUDE.md and
    # CLAUDE.local.md at each project root (AI Projects folders + folders from the session logs);
    # CLAUDE.md and CLAUDE.local.md in every folder above a root, up to the drive root.
    $roots = New-Object System.Collections.ArrayList
    if ($ProjectsRoot -and (Test-Path -LiteralPath $ProjectsRoot -PathType Container)) {
        foreach ($d in @(Get-ChildItem -LiteralPath $ProjectsRoot -Directory -ErrorAction SilentlyContinue)) { [void]$roots.Add($d.FullName) }
    } else {
        [void]$ctx.errors.Add("projects folder not found: $ProjectsRoot")
    }
    foreach ($c in @(Get-SizeSessionCwds $ctx)) { [void]$roots.Add($c) }
    $cands = New-Object System.Collections.ArrayList
    [void]$cands.Add($GlobalClaude)
    $seenDirs = @{}
    foreach ($r in $roots) {
        foreach ($n in @('CLAUDE.md', '.claude\CLAUDE.md', 'CLAUDE.local.md')) { [void]$cands.Add((Join-Path $r $n)) }
        $dir = [System.IO.Path]::GetDirectoryName($r.TrimEnd('\'))
        while ($dir) {
            $dk = $dir.ToLowerInvariant()
            if ($seenDirs.ContainsKey($dk)) { break }
            $seenDirs[$dk] = $true
            [void]$cands.Add((Join-Path $dir 'CLAUDE.md'))
            [void]$cands.Add((Join-Path $dir 'CLAUDE.local.md'))
            $dir = [System.IO.Path]::GetDirectoryName($dir)
        }
    }
    $claudeCls = [pscustomobject]@{ class = 'claude-md' }
    foreach ($c in $cands) { if (Test-Path -LiteralPath $c -PathType Leaf) { Add-SizeTarget $ctx $targets $c $claudeCls } }

    # Skills (not the Anthropic-synced ones under skills\synced) and their reference .md files.
    if (Test-Path -LiteralPath $SkillsDir -PathType Container) {
        foreach ($d in @(Get-ChildItem -LiteralPath $SkillsDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'synced' })) {
            $sk = Join-Path $d.FullName 'SKILL.md'
            if (Test-Path -LiteralPath $sk -PathType Leaf) { Add-SizeTarget $ctx $targets $sk $null }
            foreach ($f in @(Get-ChildItem -LiteralPath $d.FullName -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -eq '.md' -and $_.Name -ne 'SKILL.md' })) {
                Add-SizeTarget $ctx $targets $f.FullName $null
            }
        }
    } else {
        [void]$ctx.errors.Add("skills folder not found: $SkillsDir")
    }

    # Hook reference notes.
    $refsDir = Join-Path $HooksDir 'refs'
    if (Test-Path -LiteralPath $refsDir -PathType Container) {
        foreach ($f in @(Get-ChildItem -LiteralPath $refsDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -eq '.md' })) {
            Add-SizeTarget $ctx $targets $f.FullName $null
        }
    } else {
        [void]$ctx.errors.Add("hook refs folder not found: $refsDir")
    }

    # Command files (GEN-926). A missing commands folder is not an error: there may be none.
    if ($CommandsDir -and (Test-Path -LiteralPath $CommandsDir -PathType Container)) {
        foreach ($f in @(Get-ChildItem -LiteralPath $CommandsDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -eq '.md' })) {
            Add-SizeTarget $ctx $targets $f.FullName $null
        }
    }

    # MEMORY.md files.
    if (Test-Path -LiteralPath $ClaudeProjectsDir -PathType Container) {
        foreach ($d in @(Get-ChildItem -LiteralPath $ClaudeProjectsDir -Directory -ErrorAction SilentlyContinue)) {
            $mm = Join-Path $d.FullName 'memory\MEMORY.md'
            if (Test-Path -LiteralPath $mm -PathType Leaf) { Add-SizeTarget $ctx $targets $mm $null }
        }
    }

    $findings = @()
    $measured = 0
    foreach ($k in @($targets.Keys)) {
        $t = $targets[$k]
        try {
            $findings += @(Measure-SizeFile $ctx $t.path $t.path $t.cls)
            $measured++
        } catch {
            [void]$ctx.errors.Add(('could not measure {0}: {1}' -f $t.path, $_.Exception.Message))
        }
    }
    return (New-SizeResult 'size-sweep' $ctx $findings $measured $null)
}

# ============================================================================
# Weekly size check (GEN-890). Runs from /wrap's config-health pass, at most once per
# -SizeWeeklyDays. This script decides; the caller only reads ticket status from Notion,
# files or raises tickets, and hands the outcome back to size-record. State file shape:
#   { "lastRun": "yyyy-MM-dd" | null,
#     "items": { "<finding key>": { pageId, ticketId, filedValue, filedUtc, escalated } } }
# ============================================================================

function Get-SizeAsOfDate {
    if ($AsOf) { return ([datetime]::ParseExact($AsOf, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)).Date }
    return (Get-Date).Date
}

function Read-SizeState {
    if (-not (Test-Path -LiteralPath $SizeStateFile -PathType Leaf)) { return $null }
    $raw = Get-Content -Raw -LiteralPath $SizeStateFile -Encoding UTF8
    $o = $raw | ConvertFrom-Json
    $items = @{}
    if ($o.items) { foreach ($p in $o.items.PSObject.Properties) { $items[$p.Name] = $p.Value } }
    $last = $null
    if ($o.lastRun) { $last = [datetime]::ParseExact([string]$o.lastRun, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture) }
    return [pscustomobject]@{ lastRun = $last; items = $items }
}

function Write-SizeState($state) {
    $itemsOut = [ordered]@{}
    foreach ($k in @($state.items.Keys | Sort-Object)) { $itemsOut[$k] = $state.items[$k] }
    $lastOut = if ($state.lastRun) { $state.lastRun.ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture) } else { $null }
    $json = [pscustomobject]([ordered]@{ lastRun = $lastOut; items = [pscustomobject]$itemsOut }) | ConvertTo-Json -Depth 6
    $tmp = $SizeStateFile + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $SizeStateFile -PathType Leaf) { [System.IO.File]::Replace($tmp, $SizeStateFile, [NullString]::Value) }
    else { [System.IO.File]::Move($tmp, $SizeStateFile) }
}

# $null when fine; otherwise one plain sentence for mark-reviewed's overdue alarm.
function Get-SizeWeeklyOverdue {
    try {
        $st = Read-SizeState
        if ($null -eq $st) { return ('marker written; the weekly size check has no state file ({0}), so it is not running' -f $SizeStateFile) }
        $today = Get-SizeAsOfDate
        if ($null -eq $st.lastRun) { return 'marker written; the weekly size check has never completed a run' }
        $ageDays = ($today - $st.lastRun.Date).Days
        $lastTxt = $st.lastRun.ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
        if ($ageDays -lt 0) { return ('marker written; the weekly size check''s last run is dated in the future ({0}), so its timer cannot be trusted' -f $lastTxt) }
        if ($ageDays -ge $SizeWeeklyDays) { return ('marker written; the weekly size check is overdue (last completed {0}, {1} days ago)' -f $lastTxt, $ageDays) }
        return $null
    } catch {
        return ('marker written; the weekly size check''s state could not be checked ({0}): {1}' -f $SizeStateFile, $_.Exception.Message)
    }
}

# A path shown in titles: ~/.claude/... or AI Projects/..., forward slashes.
function Get-SizeDisplayPath([string]$file) {
    $full = [System.IO.Path]::GetFullPath($file)
    $home0 = [System.IO.Path]::GetFullPath($ClaudeHome).TrimEnd('\')
    $proj0 = [System.IO.Path]::GetFullPath($ProjectsRoot).TrimEnd('\')
    if ($full.ToLowerInvariant().StartsWith($home0.ToLowerInvariant() + '\')) { return ('~/.claude/' + $full.Substring($home0.Length + 1).Replace('\', '/')) }
    if ($full.ToLowerInvariant().StartsWith($proj0.ToLowerInvariant() + '\')) { return ([System.IO.Path]::GetFileName($proj0) + '/' + $full.Substring($proj0.Length + 1).Replace('\', '/')) }
    return $full.Replace('\', '/')
}

function Test-SizeInScope([string]$file) {
    $p = Get-NormPath $file
    foreach ($root in @($ClaudeHome, $ProjectsRoot)) {
        if ($root -and $p.StartsWith((Get-NormPath $root) + '\')) { return $true }
    }
    return $false
}

# Findings that need a ticket: every breach and note, plus near-limit findings on HARD limits
# (going over a hard limit silently cuts what Claude sees). Files outside ~/.claude and the
# AI Projects folder are skipped on purpose (not ours to fix).
function Get-SizeCandidates($ctx, $findings) {
    $order = @{ breach = 0; note = 1; near = 2 }
    $out = @()
    foreach ($f in @($findings)) {
        if (-not $f) { continue }
        if ($f.severity -eq 'near' -and $f.kind -ne 'hard') { continue }
        if (-not (Test-SizeInScope $f.file)) { continue }
        $disp = Get-SizeDisplayPath $f.file
        if ($f.limitId -eq 'hook-injected-text') {
            $title = 'Keep refs/{0} under the injection limit' -f [System.IO.Path]::GetFileName($f.file)
        } elseif ($f.severity -eq 'note') {
            $title = 'Fix the frontmatter of {0} so its description can be read' -f $disp
        } else {
            $title = 'Keep {0} within its {1} size limit' -f $disp, $f.limitId
        }
        if ($f.severity -eq 'note') {
            $tgt = 'fix the format problem so the file can be measured'
        } elseif ($f.severity -eq 'near') {
            $tgt = 'below {0} {1} ({2:0}% of the {3} limit)' -f (Format-SizeNum ([math]::Floor($ctx.nearLimitRatio * $f.limit))), $f.measure, ($ctx.nearLimitRatio * 100), (Format-SizeNum $f.limit)
        } else {
            $tgt = 'at or under {0} {1}' -f (Format-SizeNum $f.limit), $f.measure
        }
        $out += [pscustomobject]@{
            key = $f.key; file = $f.file; display = $disp; severity = $f.severity; kind = $f.kind; limitId = $f.limitId
            measure = $f.measure; value = $f.value; limit = $f.limit; line = $f.line; title = $title; target = $tgt
            rank = $order[$f.severity]
        }
    }
    return @($out | Sort-Object rank, key)
}

function Invoke-SizeWeekly {
    $st = Read-SizeState
    $today = Get-SizeAsOfDate
    $lastOut = if ($st -and $st.lastRun) { $st.lastRun.ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture) } else { $null }
    if ($st -and $st.lastRun -and ($today - $st.lastRun.Date).Days -lt $SizeWeeklyDays) {
        return [pscustomobject]@{ ok = $true; action = 'size-weekly'; due = $false; lastRun = $lastOut; intervalDays = $SizeWeeklyDays }
    }
    $sweep = Invoke-SizeSweep
    $ctx = Read-SizeLimits
    $items = if ($st) { $st.items } else { @{} }
    $cands = @(Get-SizeCandidates $ctx $sweep.findings)
    $need = @()
    foreach ($c in $cands) {
        $lk = $items[$c.key]
        $c | Add-Member -NotePropertyName linked -NotePropertyValue $(if ($lk) { [pscustomobject]@{ pageId = $lk.pageId; ticketId = $lk.ticketId } } else { $null })
        if ($lk -and $need -notcontains $lk.pageId) { $need += $lk.pageId }
    }
    return [pscustomobject]@{
        ok = $true; action = 'size-weekly'; due = $true; lastRun = $lastOut; stateFile = $SizeStateFile
        stateMissing = ($null -eq $st); candidates = $cands; needStatus = $need; sweepErrors = @($sweep.errors)
    }
}

# -TicketsJson: { "<pageId>": { "status": "To Do", "createdTime": "2026-10-15T20:47:59.741Z", "gain": "2" }, ... }
function Invoke-SizeDecide {
    if (-not $TicketsJson -or -not (Test-Path -LiteralPath $TicketsJson -PathType Leaf)) {
        return [pscustomobject]@{ ok = $false; action = 'size-decide'; error = "tickets file not found: $TicketsJson" }
    }
    $tix = Get-Content -Raw -LiteralPath $TicketsJson -Encoding UTF8 | ConvertFrom-Json
    $st = Read-SizeState
    $items = if ($st) { $st.items } else { @{} }
    $today = Get-SizeAsOfDate
    $sweep = Invoke-SizeSweep
    $ctx = Read-SizeLimits
    $cands = @(Get-SizeCandidates $ctx $sweep.findings)
    $openEsc = @('To Do', 'In Progress')
    $openOther = @('Backlog', 'Blocked', 'Review')
    $filed = 0
    $decisions = @()
    foreach ($c in $cands) {
        $lk = $items[$c.key]
        $act = 'file'; $why = 'no ticket yet'; $tkt = $null; $prio = $null
        if ($lk) {
            $tkt = [pscustomobject]@{ pageId = $lk.pageId; ticketId = $lk.ticketId }
            $tp = if ($tix) { $tix.PSObject.Properties[[string]$lk.pageId] } else { $null }
            if (-not $tp) {
                $act = 'error'; $why = 'linked ticket status not supplied'
            } else {
                $t = $tp.Value
                $status = [string]$t.status
                if ($openEsc -contains $status -or $openOther -contains $status) {
                    $act = 'link'; $why = "ticket open ($status)"
                    if ($openEsc -contains $status -and -not $lk.escalated) {
                        $created = [datetime]::MinValue
                        $okTime = [datetime]::TryParse([string]$t.createdTime, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$created)
                        if (-not $okTime) {
                            $act = 'error'; $why = 'linked ticket created time missing or unreadable'
                        } else {
                            $ageDays = ($today - $created.ToUniversalTime().Date).Days
                            if ($ageDays -gt $SizeEscalateDays) {
                                $act = 'escalate'; $why = "ticket open $ageDays days"
                                $prio = if ([string]$t.gain -eq '1') { 'Highest' } else { 'High' }
                            }
                        }
                    }
                } elseif ($status -eq 'Wont Do') {
                    $act = 'skip'; $why = 'ticket closed as Wont Do (accepted exception)'
                } elseif ($status -eq 'Done') {
                    $filedNum = 0.0
                    $hasFiled = ($null -ne $lk.filedValue) -and [double]::TryParse([string]$lk.filedValue, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$filedNum)
                    if ($c.severity -eq 'near' -and $hasFiled -and $c.value -le $filedNum) {
                        $act = 'skip'; $why = 'ticket Done; still near the limit but not grown since it was filed'
                    } else {
                        $act = 'file'; $why = 'ticket Done but the problem is back'
                    }
                } else {
                    $act = 'error'; $why = "linked ticket has an unexpected status '$status'"
                }
            }
        }
        if ($act -eq 'file') {
            $filed++
            if ($filed -gt $SizeFileCap) { $act = 'deferred'; $why = "over the $SizeFileCap-tickets-per-wrap cap; filed next week" }
        }
        $decisions += [pscustomobject]@{
            action = $act; reason = $why; key = $c.key; file = $c.file; severity = $c.severity; kind = $c.kind
            limitId = $c.limitId; measure = $c.measure; value = $c.value; limit = $c.limit; line = $c.line
            title = $c.title; target = $c.target; ticket = $tkt; priority = $prio
        }
    }
    # Prune links whose finding is gone, but never after an incomplete sweep: a missing folder
    # would otherwise drop every link and re-file every ticket next week.
    $live = @{}
    foreach ($c in $cands) { $live[$c.key] = $true }
    $prune = @()
    if (@($sweep.errors).Count -eq 0) { $prune = @($items.Keys | Where-Object { -not $live.ContainsKey($_) } | Sort-Object) }
    return [pscustomobject]@{
        ok = $true; action = 'size-decide'; asOf = $today.ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture); decisions = $decisions; prune = $prune
        counts = [pscustomobject]@{
            file = @($decisions | Where-Object { $_.action -eq 'file' }).Count
            escalate = @($decisions | Where-Object { $_.action -eq 'escalate' }).Count
            deferred = @($decisions | Where-Object { $_.action -eq 'deferred' }).Count
            error = @($decisions | Where-Object { $_.action -eq 'error' }).Count
        }
        sweepErrors = @($sweep.errors)
    }
}

# -RecordJson: { "filed": [ { key, pageId, ticketId, value } ], "escalated": [ key ], "prune": [ key ], "completed": true }
function Invoke-SizeRecord {
    if (-not $RecordJson -or -not (Test-Path -LiteralPath $RecordJson -PathType Leaf)) {
        return [pscustomobject]@{ ok = $false; action = 'size-record'; error = "record file not found: $RecordJson" }
    }
    $rec = Get-Content -Raw -LiteralPath $RecordJson -Encoding UTF8 | ConvertFrom-Json
    $st = Read-SizeState
    if ($null -eq $st) { $st = [pscustomobject]@{ lastRun = $null; items = @{} } }
    $nowUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $nFiled = 0; $nEsc = 0; $nPruned = 0
    foreach ($k in @($rec.prune)) { if ($k -and $st.items.ContainsKey([string]$k)) { $st.items.Remove([string]$k); $nPruned++ } }
    foreach ($fr in @($rec.filed)) {
        if (-not $fr -or -not $fr.key -or -not $fr.pageId) { continue }
        $st.items[[string]$fr.key] = [pscustomobject]([ordered]@{ pageId = [string]$fr.pageId; ticketId = [string]$fr.ticketId; filedValue = $fr.value; filedUtc = $nowUtc; escalated = $false })
        $nFiled++
    }
    foreach ($k in @($rec.escalated)) {
        if (-not $k) { continue }
        $e = $st.items[[string]$k]
        if ($e) {
            $st.items[[string]$k] = [pscustomobject]([ordered]@{ pageId = $e.pageId; ticketId = $e.ticketId; filedValue = $e.filedValue; filedUtc = $e.filedUtc; escalated = $true })
            $nEsc++
        }
    }
    if ($rec.completed -eq $true) { $st = [pscustomobject]@{ lastRun = (Get-SizeAsOfDate); items = $st.items } }
    Write-SizeState $st
    $lastOut = if ($st.lastRun) { $st.lastRun.ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture) } else { $null }
    return [pscustomobject]@{ ok = $true; action = 'size-record'; stateFile = $SizeStateFile; filed = $nFiled; escalated = $nEsc; pruned = $nPruned; lastRun = $lastOut; items = $st.items.Count }
}

try {
    switch ($Action) {
        'detect-global'  { Emit (Invoke-DetectGlobal) }
        'detect-project' { Emit (Invoke-DetectProject) }
        'scan'           { Emit (Invoke-Scan) }
        'scan-settings'  { Emit (Invoke-ScanSettings) }
        'settings-nudge' { Emit (Invoke-SettingsNudge) }
        'keep-record'    { Emit (Invoke-KeepRecord) }
        'mark-reviewed'  { Emit (Invoke-MarkReviewed) }
        'size-sweep'     { Emit (Invoke-SizeSweep) }
        'size-check'     { Emit (Invoke-SizeCheck) }
        'size-weekly'    { Emit (Invoke-SizeWeekly) }
        'size-decide'    { Emit (Invoke-SizeDecide) }
        'size-record'    { Emit (Invoke-SizeRecord) }
    }
} catch {
    Emit ([pscustomobject]@{ ok = $false; action = $Action; error = $_.Exception.Message })
}

# Deterministic clean exit so no native/git exit code leaks to the caller.
$LASTEXITCODE = 0
exit 0
