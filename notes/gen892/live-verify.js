// GEN-892 Step 4 live-verify: each changed hook, live and working copy, run on the same real inputs with
// today's real limits file must give identical output (every limit equals its built-in number today).
// The surfacer runs against a fixture home holding copies of the real global CLAUDE.md and limits file, so
// it cannot advance the real backup-notice cursor. Also: both rules-limit readers on the real files.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LIVE = 'C:/Users/Erez/.claude/hooks';
const WC = path.join(__dirname, 'wc', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gen892-live-'));
const WCDIR = path.join(TMP, 'hooks');
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (d ? ' -- ' + String(d).slice(0, 400) : '')); } };

// Working copies beside a copy of the real refs folder.
fs.mkdirSync(path.join(WCDIR, 'refs'), { recursive: true });
for (const f of fs.readdirSync(WC)) fs.writeFileSync(path.join(WCDIR, f), fs.readFileSync(path.join(WC, f)));
for (const f of fs.readdirSync(path.join(LIVE, 'refs'))) {
  const p = path.join(LIVE, 'refs', f);
  if (fs.statSync(p).isFile()) fs.writeFileSync(path.join(WCDIR, 'refs', f), fs.readFileSync(p));
}
const norm = s => String(s || '').split(path.join(WCDIR, 'refs')).join('<refs>').split(path.join(LIVE, 'refs').replace(/\//g, '\\')).join('<refs>')
  .split(path.join(LIVE, 'refs')).join('<refs>').split(WCDIR).join('<hooks>').split(LIVE.replace(/\//g, '\\')).join('<hooks>').split(LIVE).join('<hooks>');
function run(dir, file, args, input, env) {
  const r = spawnSync(process.execPath, [path.join(dir, file), ...args], { input: JSON.stringify(input), encoding: 'utf8', env: Object.assign({}, process.env, env || {}), timeout: 60000 });
  // Compare the decoded text (in the raw JSON a Windows path is escaped and would not normalise).
  let text = r.stdout;
  try { const j = JSON.parse(r.stdout); text = JSON.stringify(Object.assign({}, j, { hookSpecificOutput: Object.assign({}, j.hookSpecificOutput, { additionalContext: norm(j.hookSpecificOutput.additionalContext) }) })); } catch (e) { /* not JSON: compare raw */ }
  return { out: norm(text), err: r.stderr, status: r.status };
}
let n = 0;
const sid = () => 'gen892live' + Date.now() + (++n);
function same(name, file, args, mkInput, env) {
  const a = run(LIVE, file, args, mkInput(), env);
  const b = run(WCDIR, file, args, mkInput(), env);
  check(name + ': identical output (' + a.out.length + ' chars)', a.out === b.out && a.status === b.status && b.status === 0, 'live ' + a.out.slice(0, 200) + ' | wc ' + b.out.slice(0, 200) + ' | ' + b.err);
}

same('notion hook, Notion prompt', 'inject-notion-refs.js', [], () => ({ prompt: 'update GEN-892 in Notion', session_id: sid() }));
same('notion hook, unrelated prompt', 'inject-notion-refs.js', [], () => ({ prompt: 'hello', session_id: sid() }));
same('shell hook, first Bash call', 'inject-shell-refs.js', [], () => ({ tool_name: 'Bash', session_id: sid() }));
same('topic hook, notion-write notion-read on a Notion prompt', 'inject-topic-refs.js', ['notion-write', 'notion-read'], () => ({ hook_event_name: 'UserPromptSubmit', prompt: 'Notion GEN-892', session_id: sid() }));
same('topic hook, five topics on a curl call', 'inject-topic-refs.js', ['notion-vetticket', 'notion-rest', 'shell-tools', 'shell-ps', 'shell-scripting'],
  () => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'curl.exe -s https://api.notion.com/v1/pages/x' }, session_id: sid() }));
same('browser hook, a Chrome tool call', 'inject-browser-refs.js', [],
  () => ({ hook_event_name: 'PostToolUse', tool_name: 'mcp__claude-in-chrome__navigate', tool_input: {}, tool_response: 'ok', session_id: sid() }));
// skill-restore on this session's real transcript
const transcript = 'C:/Users/Erez/.claude/projects/C--Users-Erez-AI-Projects-Improve-AI-Infra/eb070cde-bf96-4a1a-9bc7-0c11c87c340e.jsonl';
same('skill-restore after compaction (this session)', 'sessionstart-skill-restore.js', [], () => ({ source: 'compact', transcript_path: transcript }));

// Surfacer on a fixture home with the real global CLAUDE.md and limits file.
const home = path.join(TMP, 'home');
const notes = path.join(home, 'AI Projects', 'Improve AI Infra', 'notes');
fs.mkdirSync(path.join(notes, 'release-review'), { recursive: true });
fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
fs.writeFileSync(path.join(notes, 'anthropic-guidelines.json'), fs.readFileSync(path.join(__dirname, '..', 'anthropic-guidelines.json')));
fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), fs.readFileSync('C:/Users/Erez/.claude/CLAUDE.md'));
const env = { USERPROFILE: home, HOME: home };
const s1 = run(LIVE, 'sessionstart-backup-surfacer.js', [], { hook_event_name: 'SessionStart', source: 'startup', session_id: sid() }, env);
const s2 = run(WCDIR, 'sessionstart-backup-surfacer.js', [], { hook_event_name: 'SessionStart', source: 'startup', session_id: sid() }, env);
check('surfacer, real CLAUDE.md and limits file: identical output', s1.out === s2.out && s2.status === 0, 'live ' + s1.out.slice(0, 300) + ' | wc ' + s2.out.slice(0, 300) + ' | ' + s2.err);
check('surfacer: no GUIDELINES LIMITS line on the real files', !s2.out.includes('GUIDELINES LIMITS'), s2.out.slice(0, 300));

// Shared reader on the real files.
const reader = require(path.join(WC, 'guidelines-limits.js'));
const real = id => reader.readLimit(id, id === 'claude-md-lines' ? { fallback: 200, min: 50, max: 800 } : id === 'hook-injected-text' ? { fallback: 10000, min: 2000, max: 100000 } : { fallback: 5000, min: 1000, max: 20000 });
check('reader on the real limits file: 10000 / 200 / 5000, no warning or error',
  real('hook-injected-text').value === 10000 && real('claude-md-lines').value === 200 && real('skill-after-compaction').value === 5000 &&
  !real('hook-injected-text').warning && !real('claude-md-lines').error, JSON.stringify([real('hook-injected-text'), real('claude-md-lines'), real('skill-after-compaction')]));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* leave it */ }
process.exit(fail ? 1 : 0);
