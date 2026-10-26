// GEN-460 Step 8 live-fire: feed the INSTALLED auto-approve.js one real skip command and one backup
// command (decision only; nothing is executed). Expect skip -> allow, backup -> no allow.
const { spawnSync } = require('child_process');
const HOOK = 'C:/Users/Erez/.claude/hooks/auto-approve.js';
const S = "& 'G:\\My Drive\\AI Projects\\_Tooling\\Claude\\sync.ps1'";
for (const cmd of [S + " -TriageDecide 'spares' -As skip -Reason 'empty folder made by the Claude app'",
                   S + " -TriageDecide 'notes.md' -As backup -Reason 'shared notes file'"]) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: cmd }, session_id: 'livefire', cwd: 'C:/Users/Erez' }), encoding: 'utf8', timeout: 30000 });
  let dec = 'none'; try { dec = JSON.parse(r.stdout || '{}').hookSpecificOutput.permissionDecision || 'none'; } catch (e) {}
  console.log('exit', r.status, 'decision', dec, '::', cmd.slice(60));
}
