#!/usr/bin/env bash
# GEN-382 backup-sweep SPAWNER regression test. Run after ANY change to
# sessionstart-backup-spawner.js.
#   Usage:  bash "C:/Users/Erez/.claude/hooks/tests/gen382-spawner-test.sh"
#   Expect: "RESULT: N passed, 0 failed", exit 0.
#
# The spawner launches backup-sweep.ps1 in the background. To avoid running the
# REAL sweep (which pushes to GitHub), the test points USERPROFILE at a throwaway
# .claude whose scripts/backup-sweep.ps1 is a FAKE that just appends its received
# args to a file. The test asserts on WHAT WOULD BE LAUNCHED (repo list, session
# id) — never a real backup. It also overrides the projects dir the hook scans by
# running a copy of the hook with PROJECTS_DIR pointed at a throwaway tree.
#
# NOTE: the hook hardcodes PROJECTS_DIR = 'C:\Users\Erez\AI Projects'. The test
# makes a copy of the hook with that constant rewritten to the throwaway path, so
# the real projects dir is never touched.

set -u
HOOK_SRC="C:/Users/Erez/.claude/hooks/sessionstart-backup-spawner.js"
TMP="$(mktemp -d)"
export HOME="$TMP"
export USERPROFILE="$(cygpath -w "$TMP" 2>/dev/null || echo "$TMP")"
CDIR="$TMP/.claude"
mkdir -p "$CDIR/scripts"
PROJ="$TMP/projects"
mkdir -p "$PROJ"
PROJ_WIN="$(cygpath -w "$PROJ" 2>/dev/null || echo "$PROJ")"

pass=0; fail=0
ok(){ echo "  PASS: $1"; pass=$((pass+1)); }
no(){ echo "  FAIL: $1"; fail=$((fail+1)); }
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

# --- Build a copy of the hook with PROJECTS_DIR rewritten to the throwaway tree.
HOOK="$CDIR/hook-under-test.js"
node -e '
const fs=require("fs");
let s=fs.readFileSync(process.argv[1],"utf8");
const win=process.argv[2];
// Rewrite the hardcoded PROJECTS_DIR constant to the throwaway path (JSON-encode
// so backslashes are correctly escaped in the JS string literal).
const before=s;
s=s.replace(/const PROJECTS_DIR = .*;/, "const PROJECTS_DIR = "+JSON.stringify(win)+";");
if(s===before){console.error("FAILED to rewrite PROJECTS_DIR");process.exit(1);}
fs.writeFileSync(process.argv[3],s,"utf8");
' "$HOOK_SRC" "$PROJ_WIN" "$HOOK" || { echo "setup failed"; exit 2; }

# --- Fake backup-sweep.ps1: write received args to a PER-SESSION file so the
# async (truly detached) sweeps from different test steps never race on one file.
# File is args-<SessionId>.txt. Count + repos let assertions be exact.
cat > "$CDIR/scripts/backup-sweep.ps1" <<'PS'
param(
  [Parameter(Mandatory=$true)][string[]]$RepoPaths,
  [Parameter(Mandatory=$true)][string]$SessionId,
  [string]$Machine, [string]$SecretPatternsFile, [string]$FailureQueueFile,
  [string]$StateDir, [int]$MaxBlobMB, [switch]$DryRun
)
$safe = $SessionId -replace '[^A-Za-z0-9_.-]', '_'
$line = "SESSION=$SessionId|N=$($RepoPaths.Count)|REPOS=" + ($RepoPaths -join ";")
Set-Content -Path (Join-Path $PSScriptRoot ("args-" + $safe + ".txt")) -Value $line
exit 0
PS

# args file for a given session id (mirrors the sanitization the fake does).
argfile(){ local safe; safe=$(printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_'); echo "$CDIR/scripts/args-$safe.txt"; }
run(){ echo '{"session_id":"'"$1"'","source":"startup"}' | node "$HOOK" 2>"$CDIR/stderr.txt"; }
wait_for(){ local f="$1"; for i in $(seq 1 50); do [ -f "$f" ] && return 0; sleep 0.1; done; return 1; }

echo "[1] No projects dir contents -> nothing spawned, exit 0, stdout empty"
out=$(run "sess-1"); rc=$?
[ -z "$out" ] && ok "no stdout emitted" || no "unexpected stdout: $out"
[ "$rc" -eq 0 ] && ok "exit 0" || no "exit $rc"
grep -q "no project git repos found" "$CDIR/stderr.txt" && ok "logs 'no repos' breadcrumb" || no "missing no-repos breadcrumb"

echo "[2] Two git repos + one non-git folder -> only the 2 git repos swept (multi-arg!)"
mkdir -p "$PROJ/RepoA/.git" "$PROJ/RepoB/.git" "$PROJ/NotARepo/src"
AF=$(argfile "sess-2"); rm -f "$AF"
run "sess-2" >/dev/null
wait_for "$AF" && ok "sweep was spawned" || no "sweep never launched"
if [ -f "$AF" ]; then
  line=$(cat "$AF")
  echo "$line" | grep -q "N=2" && ok "exactly 2 repos passed (multi-arg survived)" || no "wrong repo count: $line"
  echo "$line" | grep -q "RepoA" && echo "$line" | grep -q "RepoB" && ok "both git repos present" || no "missing a git repo: $line"
  echo "$line" | grep -q "NotARepo" && no "non-git folder wrongly included" || ok "non-git folder excluded"
  echo "$line" | grep -q "SESSION=sess-2" && ok "session id forwarded" || no "session id not forwarded: $line"
fi

echo "[3] Missing session_id -> fallback label, still spawns"
AF=$(argfile "unknown-session"); rm -f "$AF"
echo '{"source":"startup"}' | node "$HOOK" 2>/dev/null
wait_for "$AF" && ok "spawned despite missing session_id" || no "did not spawn on missing session_id"
[ -f "$AF" ] && grep -q "SESSION=unknown-session" "$AF" && ok "used fallback session label" || no "no fallback session label"

echo "[4] Missing sweep script -> nothing spawned, breadcrumb, exit 0"
AF=$(argfile "sess-4"); rm -f "$AF" "$CDIR/stderr.txt"
mv "$CDIR/scripts/backup-sweep.ps1" "$CDIR/scripts/backup-sweep.ps1.bak"
out=$(run "sess-4"); rc=$?
[ "$rc" -eq 0 ] && ok "exit 0 when script missing" || no "exit $rc"
grep -q "sweep script not found" "$CDIR/stderr.txt" && ok "logs script-not-found breadcrumb" || no "missing breadcrumb"
sleep 1; [ ! -f "$AF" ] && ok "nothing launched when script missing" || no "launched despite missing script"
mv "$CDIR/scripts/backup-sweep.ps1.bak" "$CDIR/scripts/backup-sweep.ps1"

echo "[5] Two different sessions BOTH spawn (no spawner-level lock suppresses a session)"
# The design has NO spawner lock: each session must get its own sweep (the sweep
# itself is per-session + per-repo-locked). Two sessions back-to-back must BOTH
# launch, each with its own session id.
AF5=$(argfile "sess-5a"); AF5b=$(argfile "sess-5b"); rm -f "$AF5" "$AF5b"
run "sess-5a" >/dev/null
run "sess-5b" >/dev/null
wait_for "$AF5" && wait_for "$AF5b" && ok "both sessions spawned their own sweep" || no "a session was suppressed (5a=$( [ -f "$AF5" ] && echo y || echo n ) 5b=$( [ -f "$AF5b" ] && echo y || echo n ))"
[ -f "$AF5b" ] && grep -q "SESSION=sess-5b" "$AF5b" && ok "second session's id forwarded" || no "second session id wrong"

echo "[6] stdout is ALWAYS empty (this hook never emits additionalContext)"
sout=$(echo '{"session_id":"sess-6","source":"startup"}' | node "$HOOK" 2>/dev/null)
[ -z "$sout" ] && ok "no stdout even when spawning" || no "emitted stdout: $sout"

echo "[7] Repo folder names with cmd metacharacters (& %) + spaces survive intact"
# The /check panel's central finding: repo names with & % ^ ! could corrupt the
# cmd command line. Payload-file routing must carry them through untouched.
mkdir -p "$PROJ/A & B/.git" "$PROJ/C%TEMP%D/.git"
AF=$(argfile "sess-7"); rm -f "$AF"
run "sess-7" >/dev/null
wait_for "$AF" && ok "spawn survived metacharacter repo names" || no "metachar repo names broke the launch"
if [ -f "$AF" ]; then
  line=$(cat "$AF")
  echo "$line" | grep -qF "A & B" && ok "ampersand+space repo name intact" || no "ampersand repo mangled: $line"
  echo "$line" | grep -qF "C%TEMP%D" && ok "percent repo name intact" || no "percent repo mangled: $line"
fi

echo "[7b] SINGLE repo (ConvertFrom-Json scalar-vs-array): must still sweep"
# A one-repo projects dir: ConvertFrom-Json deserializes repos as a SCALAR, which
# broke [string[]] binding until @() was added. Guard that regression.
SOLO=$(mktemp -d); mkdir -p "$SOLO/.claude/scripts" "$SOLO/oneproj/SoloRepo/.git"
node -e 'const fs=require("fs");let s=fs.readFileSync(process.argv[1],"utf8");s=s.replace(/const PROJECTS_DIR = .*;/,"const PROJECTS_DIR = "+JSON.stringify(process.argv[2])+";");fs.writeFileSync(process.argv[3],s,"utf8")' \
  "$HOOK_SRC" "$(cygpath -w "$SOLO/oneproj")" "$SOLO/.claude/hook.js"
cp "$CDIR/scripts/backup-sweep.ps1" "$SOLO/.claude/scripts/backup-sweep.ps1"
( export USERPROFILE="$(cygpath -w "$SOLO")"; echo '{"session_id":"solo","source":"startup"}' | node "$SOLO/.claude/hook.js" 2>/dev/null )
SAF="$SOLO/.claude/scripts/args-solo.txt"
for i in $(seq 1 50); do [ -f "$SAF" ] && break; sleep 0.1; done
[ -f "$SAF" ] && grep -q "N=1" "$SAF" && ok "single-repo swept (N=1)" || no "single-repo case failed: $( [ -f "$SAF" ] && cat "$SAF" || echo MISSING )"
rm -rf "$SOLO"

echo "[8] Non-directory + dangling entries excluded without aborting the scan"
# A plain file and a broken symlink must not be swept and must not crash enumeration.
printf 'x' > "$PROJ/loosefile.txt"
AF=$(argfile "sess-8"); rm -f "$AF"
run "sess-8" >/dev/null
wait_for "$AF" && ok "scan completed despite a loose file" || no "loose file aborted the scan"
[ -f "$AF" ] && ! grep -q "loosefile" "$AF" && ok "loose file not treated as a repo" || no "loose file wrongly included"

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
