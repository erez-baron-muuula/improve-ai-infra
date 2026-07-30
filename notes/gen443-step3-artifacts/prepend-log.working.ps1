# prepend-log.ps1 -- Atomic, OS-locked prepend of one entry to a project HISTORY.md. (GEN-218)
#
# WHY THIS EXISTS
# Two concurrent Claude sessions on one machine share a single working directory, so
# when both prepend to the same HISTORY.md at /wrap the second on-disk write silently
# wins and erases the first (last-write-wins, BEFORE git ever runs). This is the same
# lost-update race GEN-103's update-config.ps1 fixed for global config -- and this helper
# reuses that SAME proven primitive: a FileShare::None OS lock held by this (long-lived)
# process across a whole read-reconcile-write critical section, auto-releasing on process
# death. A PreToolUse hook canNOT reproduce this (it exits after emitting its decision, so
# it holds no lock across the write) -- see GEN-218's APPROVED DESIGN for the full rationale.
#
# WHAT IT DOES (inside one lock acquisition, as one indivisible sequence)
#   1. Read the ENTIRE file (Get-Content -Raw) -- never a slice, never a pre-lock copy.
#   2. Reconcile against the live top entry using a session-scoped identity key:
#        top entry's key == THIS session's key  -> REPLACE that entry in place
#        else                                    -> PREPEND a new entry
#      (Session-scoped so a DIFFERENT session on the same ticket always PREPENDs and can
#       never overwrite another session's entry. The REPLACE path is the /wrap re-run /
#       across-/compact idempotency case -- it updates the top entry instead of duplicating.)
#   3. Insert/update the matching table-of-contents bullet (this helper OWNS TOC-block
#      detection + insertion, so two prepends can never interleave a TOC line into an
#      entry body -- the merge=union corruption mode GEN-218 verified and rejected).
#   4. Write the whole file back; release the lock.
#
# POSITION-AGNOSTIC (GEN-218 build decision, Erez option 1, 2026-07-19)
# The three project HISTORY.md files are currently laid out inconsistently (TOC at top /
# middle / bottom; TOC and entries not 1:1) -- that drift is GEN-443's separate job. This
# helper does NOT assume TOC-above-entries or a 1:1 match: it finds the TOC bullet run and
# the entry-heading run wherever they sit and prepends to each. If it cannot confidently
# find both anchors, it FAILS LOUD (writes a recovery file, touches nothing) rather than guess.
#
# CONTRACT
#   -Path        : absolute path to the target HISTORY.md
#   -SessionKey  : session-scoped identity key (the Claude session id). Drives the
#                  REPLACE-vs-PREPEND reconcile. REQUIRED.
#   -EntryFile   : path to a UTF-8 file holding the full entry body markdown, EXACTLY as it
#                  should appear in the file (including its leading '## <date> ...' heading
#                  line and trailing blank line, but NOT the '---' separator -- this helper
#                  owns separators). REQUIRED. Passed as a file (not an arg) because entries
#                  are large and multi-line and PS 5.1 mangles such args to native calls.
#   -TocLine     : the single '- <date> ... -- see below' TOC bullet line for this entry
#                  (no trailing newline). REQUIRED.
#   The entry's identity key is embedded by the CALLER as an HTML comment on the line
#   immediately after the '## <date>' heading:  <!-- session:<SessionKey> -->
#   This helper reads that marker to decide REPLACE vs PREPEND. It is invisible in rendered
#   markdown. (Chosen over "match the date heading text" because two sessions on the same
#   day would collide on date alone; the session id is unique per session.)
#
# INPUT CONTRACT -- ENFORCED, NOT ASSUMED (GEN-443 Step 3)
#   The EntryFile's LITERAL first line must be a '## <date>' heading -- nothing above it, not
#   even a blank line -- and -TocLine must start with '- <date>' and be a single line. A
#   violation exits 4 with a recovery file, target untouched (see EXIT CODES). Why enforced
#   rather than trusted: the
#   session marker is inserted at index 1 of whatever entry text is handed in and only
#   TRAILING blank lines are trimmed first, so an entry carrying a LEADING blank line places
#   the marker ABOVE its heading -- outside the '## <date>' block the reconcile scans -- and
#   the next same-session run then PREPENDS a silent DUPLICATE instead of replacing. Likewise
#   a TOC line lacking the '- ' prefix is invisible to Test-IsTocBullet, so the reconcile
#   inserts a SECOND bullet rather than updating the existing one. Both were live drift
#   sources in GEN-443; the callers now mandate the shape and this script enforces it.
#
# EXIT CODES
#   0 = success (prepended or replaced)
#   1 = could not acquire the lock within the retry budget (another session holds it).
#       The composed entry is written to a recovery file; caller must NOT commit/push.
#   2 = bad arguments / target or entry file not found
#   3 = CANNOT SAFELY WRITE THE TARGET. Either its structure was not recognized (no '- <date>'
#       TOC-bullet run, or no '## <date>' entry heading), OR an internal / write failure occurred
#       after the lock was taken (this session's own TOC bullet lost post-edit, TOC anchor lost
#       post-edit, insert point landing inside the new body, the >50% shrink guard tripping, or
#       the atomic write/replace failing). FAIL LOUD: target untouched, composed entry written to
#       a recovery file. HONEST GAP: the callers currently describe exit 3 to Erez as "structure
#       not recognized" only, so a disk-full or permission failure is reported with the wrong
#       CAUSE -- the ACTION they take (blocked wrap, keep the recovery file, no push) is correct
#       either way. Splitting internal/write failure into its own code is a tracked follow-up.
#   4 = INPUT CONTRACT VIOLATED -- the CALLER's own composed text is malformed: the EntryFile's
#       literal first line is not a '## <date>' heading, the body carries a second column-0
#       '## <date>' heading, -TocLine does not start with '- <date>', or -TocLine spans more than
#       one line (GEN-443 Step 3). FAIL LOUD: target
#       never even opened, composed entry written to a recovery file. Kept DISTINCT from 3 on
#       purpose -- 3 means "the target file is not shaped as expected", 4 means "what you handed
#       me is not shaped as expected". The callers branch on the exit code alone, so collapsing
#       the two would make a caller-side formatting slip indistinguishable from a damaged
#       HISTORY.md and escalate it the same way (found by GEN-443 Step 3 code review).
#
# A recovery file  <dir>\HISTORY.pending-<sessionkey>-<timestamp>.md  is written next to the
# target holding the would-be entry on every exit 1, 3 and 4. TWO honest gaps in that promise,
# both tracked as a follow-up, because the callers print the recovery path to Erez as fact:
#   (a) if the recovery write ITSELF fails, the run still exits with its documented code but there
#       is no file to point at -- it prints "RECOVERY FILE NOT WRITTEN" and the full entry text to
#       stderr instead;
#   (b) an unhandled .NET exception after the guard exits 1 with no recovery file at all -- e.g. a
#       non-IOException from the lock open (the retry loop catches only [System.IO.IOException]),
#       or reading the target if -Path resolved to a directory.
# In BOTH cases the CALLER's own temp copy of the composed entry is the surviving copy, which is
# why both callers are told to keep it until exit 0. No
# REACHABLE exit-2 path writes one, so on an exit 2 the CALLER's own temp copy of the entry is
# the surviving copy: the two not-found checks fail before any entry text has been read, and
# the empty-entry / empty-TocLine checks abort before the lock is taken. (The in-lock "entry
# body empty after trim" branch further down does call Write-Recovery before its exit 2, but it
# is unreachable: the pre-lock IsNullOrWhiteSpace check already guarantees at least one
# non-blank line, and only TRAILING blank lines are trimmed, so the body can never reduce to
# empty. Left in place as a belt-and-braces backstop rather than deleted -- noting it here so
# the exit-code contract above is not read as self-contradictory. Found by GEN-443 Step 3 code
# review, which proved the branch dead by static trace.)

param(
    [Parameter(Mandatory = $true)] [string]$Path,
    [Parameter(Mandatory = $true)] [string]$SessionKey,
    [Parameter(Mandatory = $true)] [string]$EntryFile,
    [Parameter(Mandatory = $true)] [string]$TocLine
)

$ErrorActionPreference = "Stop"

# ---- helper: write a recovery file so the entry text is never lost. ----
function Write-Recovery([string]$targetPath, [string]$sessionKey, [string]$entryText, [string]$why) {
    try {
        $dir = Split-Path -Parent $targetPath
        if (-not $dir) { $dir = "." }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        # Sanitize the session key for a filename (it is normally hex/uuid, but be safe).
        $safeKey = ($sessionKey -replace '[^A-Za-z0-9_-]', '_')
        $recovery = Join-Path $dir "HISTORY.pending-$safeKey-$stamp.md"
        $body = "# Unwritten HISTORY entry -- $why`n# Target: $targetPath`n# Session: $sessionKey`n# Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n#`n# Add this entry to the target by hand, or re-run once the blocker clears.`n`n$entryText"
        [IO.File]::WriteAllText($recovery, $body, (New-Object System.Text.UTF8Encoding $false))
        Write-Output "RECOVERY FILE WRITTEN: $recovery"
    } catch {
        # -ErrorAction Continue is REQUIRED, not cosmetic: $ErrorActionPreference is 'Stop' at
        # script scope, so a bare Write-Error here is TERMINATING. The pre-lock contract guard
        # calls this helper from outside any try/catch, so without it a failed recovery write
        # would crash the script unhandled -- losing the clean exit 4 AND the recovery file, and
        # returning 1 (the lock-timeout code) so the caller reports a recovery file that does not
        # exist. (Found by GEN-443 Step 3 code review, Pass A.)
        # Unmistakable marker so a caller (or a human reading stderr) can tell "the entry is in a
        # recovery file" from "there is no recovery file, here is the text". The exit code alone
        # cannot distinguish these, which is why the wording is this blunt.
        Write-Error "RECOVERY FILE NOT WRITTEN ($_) -- there is no HISTORY.pending-* file for this run. The full entry text follows so it is not lost:`n$entryText" -ErrorAction Continue
    }
}

# ---- shape predicates: the SINGLE definition of "what a TOC bullet is" and "what an entry
# heading is", shared by BOTH the pre-lock input-contract guard below and the in-lock anchor
# detection further down. Defined here at script scope, ahead of the guard, because PowerShell
# executes a script top-to-bottom and does NOT hoist function definitions -- a guard placed
# before a definition cannot call it. 'try' is not a scope boundary in PowerShell, so every
# in-'try' call site still resolves these. (GEN-443 Step 3: RELOCATED from inside the try
# block; both bodies are unchanged. One definition means the guard and the detector cannot
# drift apart -- the drift class this whole effort exists to remove.) ----

# A TOC bullet is a top-level '- ' list item whose text begins with a date token (a 4-digit
# year appears in the first ~40 chars).
function Test-IsTocBullet([string]$line) {
    if (-not $line.StartsWith("- ")) { return $false }
    $head = $line.Substring(2)
    if ($head.Length -gt 40) { $head = $head.Substring(0, 40) }
    return ($head -match '\b(19|20)\d{2}\b')
}

# An entry heading is a '## <date>' line.
function Test-IsEntryHeading([string]$line) {
    return ($line -match '^##\s+(19|20)\d{2}[-\d]')
}

# ---- validate arguments up front (before taking the lock). ----
# Each Write-Error below passes -ErrorAction Continue for the same reason the in-lock failure
# paths do: $ErrorActionPreference is 'Stop' at script scope, which makes a bare Write-Error
# TERMINATING, and these checks sit outside any try/catch -- so without it the script died on
# the Write-Error and the following 'exit 2' never ran, returning 1 (the documented lock-timeout
# code) instead. Verified by running the live script against a nonexistent -Path: it returned 1,
# not the documented 2, which also sent the caller down its "entry is safe in a recovery file"
# branch when no recovery file had been written. (Found by GEN-443 Step 3 code review.)
if (-not (Test-Path -LiteralPath $Path)) {
    Write-Error "Target HISTORY.md not found: $Path" -ErrorAction Continue
    exit 2
}
# Resolved HERE rather than after the validation block so the input-contract guard below can
# hand Write-Recovery the same absolute target path every other call site passes (a recovery
# file must land next to the target, not relative to the caller's working directory). Cannot
# fail: existence was just checked with the same -LiteralPath. (GEN-443 Step 3.)
$absPath = (Resolve-Path -LiteralPath $Path).Path
if (-not (Test-Path -LiteralPath $EntryFile)) {
    Write-Error "Entry file not found: $EntryFile" -ErrorAction Continue
    exit 2
}
$entryText = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $EntryFile).Path, [System.Text.Encoding]::UTF8)
# Strip a leading BOM if the entry file has one.
if ($entryText.Length -gt 0 -and $entryText[0] -eq [char]0xFEFF) { $entryText = $entryText.Substring(1) }
# Normalize ALL line-ending forms to LF right here, ONCE, before anything reasons about lines.
# This must precede the contract guard below so the guard's notion of "the first line" is the
# SAME as the writer's further down. Otherwise a lone-CR entry (classic Mac endings) splits into
# a first line for the guard but stays ONE line for the writer -- which would place the session
# marker after the whole body instead of after the heading, the exact marker misplacement the
# guard exists to prevent. (Found by GEN-443 Step 3 code review, Pass A. The later
# CRLF->LF normalization in the marker-insertion block is now redundant but harmless, and is
# left in place rather than removed to keep this change out of the write path.)
$entryText = $entryText -replace "`r`n", "`n"
$entryText = $entryText -replace "`r", "`n"
if ([string]::IsNullOrWhiteSpace($entryText)) {
    Write-Error "Entry file is empty: $EntryFile" -ErrorAction Continue
    exit 2
}
if ([string]::IsNullOrWhiteSpace($TocLine)) {
    Write-Error "TocLine is empty." -ErrorAction Continue
    exit 2
}

# ---- input-contract guard (GEN-443 Step 3): reject a malformed entry/TOC SHAPE loudly here,
# instead of accepting it and silently producing a duplicate entry or a second TOC bullet on a
# later run (see INPUT CONTRACT in the header for the two mechanisms). This runs BEFORE the
# lock is acquired, so on this path the target is never opened at all -- "touch nothing" is
# literal, not merely "not rewritten". ----
# The LITERAL first line, NOT the first non-blank line: the marker is inserted at index 1 and
# only TRAILING blanks are trimmed, so a leading blank line would pass a non-blank test and
# still misplace the marker. $entryText was normalized to LF above, so splitting on LF here uses
# the same line model the writer uses.
$nlIdx = $entryText.IndexOf("`n")
$entryFirstLine = if ($nlIdx -ge 0) { $entryText.Substring(0, $nlIdx) } else { $entryText }
if (-not (Test-IsEntryHeading $entryFirstLine)) {
    # Truncated only for the message, and only on this failure path.
    $shownFirstLine = if ($entryFirstLine.Length -gt 120) { $entryFirstLine.Substring(0, 120) + "..." } else { $entryFirstLine }
    # Recovery FIRST -- Write-Error terminates under $ErrorActionPreference='Stop'.
    Write-Recovery $absPath $SessionKey $entryText "entry contract violated: first line is not a '## <date>' heading"
    Write-Error "Entry contract violated: the EntryFile's LITERAL first line must be a '## <date>' heading, with nothing above it (not even a blank line). Got: '$shownFirstLine'. Target untouched; entry preserved in the recovery file." -ErrorAction Continue
    exit 4
}
# Exactly ONE '## <date>' heading, and it must be the FIRST line. A column-0 '## <date>' line
# anywhere in the BODY is read by the reconcile as the start of a DIFFERENT entry: the block-end
# scan further down stops at the next heading of any kind, so on a later same-session run the
# REPLACE keeps everything from that body line onward and re-emits it after a fresh '---'. The
# result is a phantom entry of stale text carrying no TOC bullet and no session marker, produced
# at exit 0 with a "Replaced existing entry" message, growing on every further run, and invisible
# to the >50% shrink guard because the file GROWS. Easy to produce by accident: quoting the
# mandated '## <date> -- <title>' heading shape in prose. Indent such a line, or use '###'.
# (Found by GEN-443 Step 3 code review, Pass B.)
$guardLines = $entryText -split "`n", -1
for ($gi = 1; $gi -lt $guardLines.Count; $gi++) {
    if (Test-IsEntryHeading $guardLines[$gi]) {
        $shownDup = if ($guardLines[$gi].Length -gt 120) { $guardLines[$gi].Substring(0, 120) + "..." } else { $guardLines[$gi] }
        Write-Recovery $absPath $SessionKey $entryText "entry contract violated: a second '## <date>' heading at entry line $($gi + 1)"
        Write-Error "Entry contract violated: the entry must contain exactly ONE '## <date>' heading -- its own FIRST line. Found another at entry line $($gi + 1): '$shownDup'. Indent it or use '###' so the reconcile cannot read it as a separate entry. Target untouched; entry preserved in the recovery file." -ErrorAction Continue
        exit 4
    }
}
if (-not (Test-IsTocBullet $TocLine)) {
    Write-Recovery $absPath $SessionKey $entryText "TOC contract violated: TocLine does not start with '- <date>'"
    Write-Error "TocLine contract violated: -TocLine must start with '- ' followed by a date. Got: '$TocLine'. Target untouched; entry preserved in the recovery file." -ErrorAction Continue
    exit 4
}
# A TOC line must also be ONE physical line. A multi-line -TocLine passes the shape test above
# (which only inspects the start of the string) but the session marker is appended to the END of
# it, landing on its LAST line -- which is then not a recognizable '- <date>' bullet, so the next
# same-session run cannot find this bullet and INSERTS A SECOND one: the very failure the shape
# check exists to prevent. (Found by GEN-443 Step 3 code review.)
if ($TocLine.IndexOfAny([char[]]@([char]13, [char]10)) -ge 0) {
    Write-Recovery $absPath $SessionKey $entryText "TOC contract violated: TocLine spans more than one line"
    Write-Error "TocLine contract violated: -TocLine must be a SINGLE line (it contains a CR or LF). Target untouched; entry preserved in the recovery file." -ErrorAction Continue
    exit 4
}

$LockFile = "$absPath.lock"

# ---- Step 1: acquire the per-file FileShare::None lock (same primitive as update-config.ps1). ----
# ~180s budget (60 * 3s), sized so two near-simultaneous /wrap runs on the same project
# rarely collide; heartbeat every ~15s so a long wait is visibly progressing.
$lockStream  = $null
$maxAttempts = 60
$retryDelayMs = 3000
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    try {
        $lockStream = [System.IO.File]::Open(
            $LockFile,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        break
    } catch [System.IO.IOException] {
        if ($attempt -lt $maxAttempts) {
            if ($attempt -eq 1 -or ($attempt % 5) -eq 0) {
                $elapsed = [Math]::Round(($attempt - 1) * $retryDelayMs / 1000)
                Write-Output "HISTORY.md lock held by another session; retrying (${attempt}/${maxAttempts}, ~${elapsed}s elapsed)..."
            }
            Start-Sleep -Milliseconds $retryDelayMs
        } else {
            $waited = [Math]::Round($maxAttempts * $retryDelayMs / 1000)
            Write-Recovery $absPath $SessionKey $entryText "lock timeout after ~${waited}s"
            Write-Error "Could not acquire HISTORY.md lock after ~${waited}s (another session holds it). Entry NOT written; caller must not commit/push." -ErrorAction Continue
            exit 1
        }
    }
}

try {
    Write-Output "Lock acquired: $LockFile"

    # ---- Step 2: read the ENTIRE file inside the lock. ----
    $raw = [IO.File]::ReadAllText($absPath, [System.Text.Encoding]::UTF8)
    if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }
    # Normalize to LF for processing; we will write back LF (git-friendly, matches existing files).
    $raw = $raw -replace "`r`n", "`n"
    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($l in ($raw -split "`n", -1)) { [void]$lines.Add($l) }

    # ---- Locate the TOC bullet run, using the script-scope Test-IsTocBullet defined above
    # (relocated there by GEN-443 Step 3 so the pre-lock contract guard and this detection
    # share ONE definition; the body is unchanged). ----

    # Find the HEAD of the real TOC RUN robustly, so a lone dated bullet inside an entry BODY is
    # never mistaken for the TOC anchor (GEN-218 /check round-2 finding 2). Priority:
    #   1. The first bullet carrying THIS tool's own '<!-- toc-session:' marker (bullets we wrote).
    #   2. Else the head of the first MAXIMAL RUN of >= 2 consecutive dated bullets (blank lines
    #      allowed between them) -- a real TOC is always a run; a stray body bullet is a singleton.
    #   3. Else (only a single dated bullet exists anywhere) the first dated bullet.
    # Operates on a supplied line list so it can be re-run against the post-edit output too.
    # $exStart/$exEnd (optional) exclude a half-open line range [exStart, exEnd) from ALL detection --
    # used to exclude the freshly-composed entry BODY from the post-edit scan, so a run of dated
    # '- <date>' bullets INSIDE that body can never be mistaken for the TOC run (a real HISTORY entry
    # body can contain such bullets; excluding the body is the only robust guard). (GEN-218 /vet-code
    # Pass B finding 1.) With no exclusion range, $exStart=$exEnd=-1 disables it.
    function Find-TocRunHead([System.Collections.Generic.List[string]]$L, [int]$exStart = -1, [int]$exEnd = -1) {
        # 1: marker-bearing bullet (outside the excluded range)
        for ($i = 0; $i -lt $L.Count; $i++) {
            if ($exStart -ge 0 -and $i -ge $exStart -and $i -lt $exEnd) { continue }
            if ((Test-IsTocBullet $L[$i]) -and $L[$i].Contains("<!-- toc-session:")) { return $i }
        }
        # 2: head of first run of >= 2 dated bullets (allowing blank lines within the run)
        $runHead = -1; $runCount = 0
        for ($i = 0; $i -lt $L.Count; $i++) {
            if ($exStart -ge 0 -and $i -ge $exStart -and $i -lt $exEnd) { $runHead = -1; $runCount = 0; continue }
            if (Test-IsTocBullet $L[$i]) {
                if ($runHead -lt 0) { $runHead = $i }
                $runCount++
                if ($runCount -ge 2) { return $runHead }
            } elseif ($L[$i] -ne "") {
                # a non-blank, non-bullet line breaks the run
                $runHead = -1; $runCount = 0
            }
        }
        # 3: fallback -- first dated bullet anywhere (single-bullet TOC), outside the excluded range
        for ($i = 0; $i -lt $L.Count; $i++) {
            if ($exStart -ge 0 -and $i -ge $exStart -and $i -lt $exEnd) { continue }
            if (Test-IsTocBullet $L[$i]) { return $i }
        }
        return -1
    }

    $tocFirstIdx = Find-TocRunHead $lines
    if ($tocFirstIdx -lt 0) {
        # Recovery FIRST -- Write-Error terminates under $ErrorActionPreference='Stop'.
        Write-Recovery $absPath $SessionKey $entryText "TOC anchor not found"
        Write-Error "TOC anchor not found (no '- <date>' bullet run) in $absPath. Structure not recognized; file untouched." -ErrorAction Continue
        exit 3
    }

    # ---- Locate the entry-heading run: the FIRST '## <date>' heading. New entry goes
    # immediately before it, with a '---' separator between the new entry and the old first.
    # Uses the script-scope Test-IsEntryHeading defined above (relocated there by GEN-443
    # Step 3; the body is unchanged). ----
    $entryFirstIdx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if (Test-IsEntryHeading $lines[$i]) { $entryFirstIdx = $i; break }
    }
    if ($entryFirstIdx -lt 0) {
        Write-Recovery $absPath $SessionKey $entryText "entry anchor not found"
        Write-Error "Entry anchor not found (no '## <date>' heading) in $absPath. Structure not recognized; file untouched." -ErrorAction Continue
        exit 3
    }

    # ---- Step 3: session-scoped reconcile -- does an entry for THIS session ALREADY exist,
    # ANYWHERE in the file (not only on top)? The caller embeds  <!-- session:<key> -->  on the
    # line just after the '## <date>' heading. We must find this session's entry wherever it sits,
    # because a CONCURRENT session may have prepended above it since this session first wrote --
    # if we only checked the top, this session would PREPEND a DUPLICATE second entry (and a second
    # identical marker, breaking the marker-uniqueness the REPLACE path relies on). (GEN-218 /check
    # round-1 duplicate-guard finding.) ----
    $marker = "<!-- session:$SessionKey -->"

    # Find this session's entry block [thisEntryStart, thisEntryEnd): the '## <date>' heading whose
    # block contains our marker, up to the next '## <date>' heading (or EOF).
    $thisEntryStart = -1
    $thisEntryEnd   = -1
    # Collect all entry-heading indices in order.
    $entryHeadIdxs = [System.Collections.Generic.List[int]]::new()
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if (Test-IsEntryHeading $lines[$i]) { [void]$entryHeadIdxs.Add($i) }
    }
    for ($h = 0; $h -lt $entryHeadIdxs.Count; $h++) {
        $start = $entryHeadIdxs[$h]
        $end   = if ($h + 1 -lt $entryHeadIdxs.Count) { $entryHeadIdxs[$h + 1] } else { $lines.Count }
        $found = $false
        for ($i = $start; $i -lt $end; $i++) { if ($lines[$i].Contains($marker)) { $found = $true; break } }
        if ($found) { $thisEntryStart = $start; $thisEntryEnd = $end; break }
    }
    $isReplace = ($thisEntryStart -ge 0)

    # Ensure the new entry body carries the session marker right after its heading, so a
    # future re-run of THIS session finds it and REPLACES instead of duplicating.
    $entryText = $entryText -replace "`r`n", "`n"
    $entryLines = [System.Collections.Generic.List[string]]::new()
    foreach ($l in ($entryText -split "`n", -1)) { [void]$entryLines.Add($l) }
    # Trim a single trailing empty line if present (we manage spacing ourselves).
    while ($entryLines.Count -gt 0 -and $entryLines[$entryLines.Count - 1] -eq "") {
        $entryLines.RemoveAt($entryLines.Count - 1)
    }
    if ($entryLines.Count -eq 0) {
        Write-Recovery $absPath $SessionKey $entryText "entry body empty after trim"
        Write-Error "Entry body reduced to empty after trimming. Aborting; file untouched." -ErrorAction Continue
        exit 2
    }
    # Insert the marker after the first line (the heading) if not already present anywhere in the body.
    $bodyHasMarker = $false
    foreach ($l in $entryLines) { if ($l.Contains($marker)) { $bodyHasMarker = $true; break } }
    if (-not $bodyHasMarker) {
        $entryLines.Insert(1, $marker)
    }

    # ---- TOC bullet carries the SAME session marker as the entry (as a trailing HTML comment,
    # invisible when rendered). This lets REPLACE find and update THIS session's own TOC bullet
    # instead of blindly overwriting whichever bullet happens to be first -- which could be a
    # DIFFERENT concurrent session's bullet (GEN-218 /check finding 1). ----
    $tocMarker = "<!-- toc-session:$SessionKey -->"
    $tocLineWithMarker = if ($TocLine.Contains($tocMarker)) { $TocLine } else { "$TocLine $tocMarker" }

    # Locate this session's EXISTING TOC bullet (pre-edit) if present -- matched by marker, not position.
    $existingTocIdx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ((Test-IsTocBullet $lines[$i]) -and $lines[$i].Contains($tocMarker)) { $existingTocIdx = $i; break }
    }
    # ---- Build the new file. REPLACE the session's existing block in place (wherever it sits),
    # or PREPEND before the first entry heading. ----
    $out = [System.Collections.Generic.List[string]]::new()
    # Track the freshly-composed entry's line range in $out so the TOC-anchor search can EXCLUDE it
    # (its body may contain dated '- ' bullets that must never be mistaken for the TOC run).
    $newEntryStart = -1; $newEntryEnd = -1

    if ($isReplace) {
        # REPLACE this session's entry block [thisEntryStart, thisEntryEnd) with the new body,
        # in place. Keep everything before and after. The replaced region may swallow the block's
        # trailing '---'+blanks (when the block isn't the last entry); we canonicalize the boundary
        # so we neither drop nor double a separator (GEN-218 /check finding 2, generalized to any
        # position). Keep the region BEFORE $thisEntryStart exactly as-is (its own leading separator
        # already sits there); after the new body, if a following entry remains, emit one '' /'---'/''.
        for ($i = 0; $i -lt $thisEntryStart; $i++) { [void]$out.Add($lines[$i]) }
        $newEntryStart = $out.Count
        foreach ($l in $entryLines) { [void]$out.Add($l) }
        $newEntryEnd = $out.Count
        $tailStart = $thisEntryEnd
        while ($tailStart -lt $lines.Count -and ($lines[$tailStart] -eq "" -or $lines[$tailStart] -eq "---")) { $tailStart++ }
        if ($tailStart -lt $lines.Count) {
            [void]$out.Add("")
            [void]$out.Add("---")
            [void]$out.Add("")
        }
        for ($i = $tailStart; $i -lt $lines.Count; $i++) { [void]$out.Add($lines[$i]) }
    } else {
        # PREPEND: new entry goes immediately before the first existing entry heading, '---'-separated.
        for ($i = 0; $i -lt $entryFirstIdx; $i++) { [void]$out.Add($lines[$i]) }
        $newEntryStart = $out.Count
        foreach ($l in $entryLines) { [void]$out.Add($l) }
        $newEntryEnd = $out.Count
        [void]$out.Add("")
        [void]$out.Add("---")
        [void]$out.Add("")
        for ($i = $entryFirstIdx; $i -lt $lines.Count; $i++) { [void]$out.Add($lines[$i]) }
    }

    # ---- Step 3b: insert/update the TOC bullet by MARKER identity, not position. Re-find the
    # anchors in $out by marker/content (indices shifted by the entry edit above). ----
    if ($isReplace -and $existingTocIdx -ge 0) {
        # REPLACE this session's own existing TOC bullet in place (found by marker in $out),
        # skipping the freshly-composed entry body range so a marker-bearing bullet the caller may
        # have embedded in the body prose is never mistaken for the real TOC bullet.
        $done = $false
        for ($i = 0; $i -lt $out.Count; $i++) {
            if ($i -ge $newEntryStart -and $i -lt $newEntryEnd) { continue }
            if ((Test-IsTocBullet $out[$i]) -and $out[$i].Contains($tocMarker)) {
                $out[$i] = $tocLineWithMarker; $done = $true; break
            }
        }
        if (-not $done) {
            # Marker vanished after the edit -- should not happen; fail loud rather than mis-place.
            Write-Recovery $absPath $SessionKey $entryText "own TOC bullet lost post-edit (internal)"
            Write-Error "This session's TOC bullet not found after edit -- internal error. File NOT written." -ErrorAction Continue
            exit 3
        }
    } else {
        # PREPEND a new TOC bullet at the HEAD OF THE TOC RUN. Re-find the run head robustly in $out,
        # EXCLUDING the freshly-composed entry body range [$newEntryStart,$newEntryEnd) so a run of
        # dated '- <date>' bullets INSIDE the new entry body can never be picked as the insert point
        # (GEN-218 /vet-code Pass B finding 1; real HISTORY bodies can contain such bullet lists).
        $insertAt = Find-TocRunHead $out $newEntryStart $newEntryEnd
        if ($insertAt -lt 0) {
            Write-Recovery $absPath $SessionKey $entryText "TOC anchor lost post-edit (internal)"
            Write-Error "TOC anchor lost after entry edit -- internal error. File NOT written." -ErrorAction Continue
            exit 3
        }
        # Guard: the insert point must be OUTSIDE the new entry body (defense in depth).
        if ($insertAt -ge $newEntryStart -and $insertAt -lt $newEntryEnd) {
            Write-Recovery $absPath $SessionKey $entryText "TOC insert point fell inside new entry body (internal)"
            Write-Error "Refusing to insert TOC bullet inside the new entry body -- internal error. File NOT written." -ErrorAction Continue
            exit 3
        }
        $out.Insert($insertAt, $tocLineWithMarker)
    }

    # ---- Step 4: write the whole file back (UTF-8 no BOM, LF line endings). ----
    $final = ($out -join "`n")
    # Guard: never write an empty or drastically-shrunken file.
    if ($final.Length -lt ($raw.Length * 0.5)) {
        Write-Recovery $absPath $SessionKey $entryText "sanity guard: output shrank >50%"
        Write-Error "Refusing to write: result ($($final.Length) chars) is <50% of original ($($raw.Length) chars). Possible corruption. File untouched." -ErrorAction Continue
        exit 3
    }
    # Atomic swap: write to a temp file on the SAME volume, then replace the target atomically.
    # A crash mid-write leaves the temp file corrupt but HISTORY.md intact, rather than a
    # half-written/truncated target. (GEN-218 /vet-code Pass A+B: honor the project's "use a
    # temp-file pattern for file rewrites" rule; a bare WriteAllText truncates-then-writes.)
    $tmpPath = "$absPath.tmp-$([System.IO.Path]::GetRandomFileName())"
    $bakPath = "$absPath.bak-$([System.IO.Path]::GetRandomFileName())"
    try {
        [IO.File]::WriteAllText($tmpPath, $final, (New-Object System.Text.UTF8Encoding $false))
        # [IO.File]::Replace is an atomic same-volume replace on Windows/.NET: no gap where the target
        # is absent. It REQUIRES a backup-path argument (a bare $null throws "path is not of a legal
        # form" on PS 5.1 / .NET 4.x), so we pass a temp backup path and delete it right after.
        # ignoreMetadataErrors=$true so ACL/attribute-copy quirks don't fail the replace.
        [IO.File]::Replace($tmpPath, $absPath, $bakPath, $true)
        if (Test-Path -LiteralPath $bakPath) { Remove-Item -LiteralPath $bakPath -ErrorAction SilentlyContinue }
    } catch {
        Write-Recovery $absPath $SessionKey $entryText "atomic write/replace failed: $_"
        if (Test-Path -LiteralPath $tmpPath) { Remove-Item -LiteralPath $tmpPath -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $bakPath) { Remove-Item -LiteralPath $bakPath -ErrorAction SilentlyContinue }
        Write-Error "Failed to write/replace ${absPath}: $_  Target likely unchanged; recovery written." -ErrorAction Continue
        exit 3
    }
    $verb = if ($isReplace) { "Replaced existing entry (same session)" } else { "Prepended new entry" }
    Write-Output "$verb in $absPath. TOC bullet $(if ($isReplace -and $existingTocIdx -ge 0) {'updated'} else {'inserted'})."
    exit 0
}
finally {
    if ($lockStream) {
        $lockStream.Close()
        $lockStream.Dispose()
        Remove-Item -LiteralPath $LockFile -ErrorAction SilentlyContinue
        Write-Output "Lock released."
    }
}
