// GEN-638 step 2 -- /vet-code Step 4 input realism. Replays REAL past tool calls from this
// machine's session transcripts through the LIVE hook and the WORKING copy (each in its own
// fixture tree) and compares decisions. SAFETY: session logs hold live keys, so this prints
// ONLY counts, tool names and category flags -- never any input content.
// Usage: node test-hook-corpus.js
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HERE = __dirname;
const PROJECTS = 'C:/Users/Erez/.claude/projects';
const LIVE_CLAUDE = 'C:/Users/Erez/.claude';
const SHEET_ID = '139jAZeYXzh14gkTY4goGuCybc-Vo5idOPyGJbk2kpX8';
const SHELL_SAMPLE = 600;

function walk(dir, out) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.jsonl')) out.push(p);
  }
}

// ---- collect tool_use inputs
const files = []; walk(PROJECTS, files);
const all = [], seen = new Set();
const LOCAL = new Set(['Read','Write','Edit','MultiEdit','NotebookEdit','Grep','Glob']);
for (const f of files) {
  let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  for (const line of txt.split('\n')) {
    if (line.indexOf('"tool_use"') === -1) continue;
    let j; try { j = JSON.parse(line); } catch (e) { continue; }
    const content = j && j.message && Array.isArray(j.message.content) ? j.message.content : [];
    for (const c of content) {
      if (!c || c.type !== 'tool_use' || typeof c.name !== 'string') continue;
      const item = { tool: c.name, input: c.input };
      const k = c.name + '|' + JSON.stringify(c.input || null); if (seen.has(k)) continue; seen.add(k); all.push(item);
    }
  }
}
const isHot = it => { if (LOCAL.has(it.tool)) return false; const t = JSON.stringify(it.input || ''); return t.indexOf(SHEET_ID) !== -1 || /__(search_files|list_recent_files)$/.test(it.tool) || /atlassian/i.test(t); };
const hot = all.filter(isHot);
const rest = all.filter(it => !isHot(it));
const step = Math.max(1, Math.floor(rest.length / 400));
const sample = rest.filter((_, i) => i % step === 0).slice(0, 400);
const corpus = hot.concat(sample);
const surface = hot, shellHot = [], shellSample = sample, shellRest = rest;

// ---- fixture trees
function setupTree(root, hookSource) {
  fs.rmSync(root, { recursive: true, force: true });
  const hooks = path.join(root, '.claude', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.mkdirSync(path.join(root, '.claude-staging', 'passes'), { recursive: true });
  fs.writeFileSync(path.join(hooks, 'auto-approve.js'), fs.readFileSync(hookSource));
  fs.writeFileSync(path.join(hooks, 'secret-patterns.json'), fs.readFileSync(path.join(LIVE_CLAUDE, 'hooks', 'secret-patterns.json')));
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), fs.readFileSync(path.join(LIVE_CLAUDE, 'settings.json')));
  fs.writeFileSync(path.join(root, '.claude-staging', 'sandboxes.json'), fs.readFileSync('C:/Users/Erez/.claude-staging/sandboxes.json'));
  return path.join(hooks, 'auto-approve.js');
}
const liveHook = setupTree(path.join(HERE, 'corpus-live'), path.join(LIVE_CLAUDE, 'hooks', 'auto-approve.js'));
const workHook = setupTree(path.join(HERE, 'corpus-work'), (process.env.HOOK_UNDER_TEST || path.join(HERE, 'auto-approve.working.js')));

function runHook(hook, item) {
  return new Promise(resolve => {
    const env = Object.assign({}, process.env); delete env.CLAUDE_CONFIG_UNLOCK;
    const p = spawn(process.execPath, [hook], { env });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    const t = setTimeout(() => p.kill(), 20000);
    p.on('close', code => {
      clearTimeout(t);
      let dec = 'none'; try { const j = JSON.parse(out || '{}'); dec = (j.hookSpecificOutput && j.hookSpecificOutput.permissionDecision) || 'none'; } catch (e) { dec = 'unparsed'; }
      const why = code === 2 ? (err.indexOf('key-sheet guard') !== -1 ? (err.indexOf('previews') !== -1 ? 'guardB' : 'guardA') : (err.indexOf('staging lock') !== -1 ? 'staging' : 'other-block')) : '';
      resolve({ code, dec, why });
    });
    p.stdin.end(JSON.stringify({ tool_name: item.tool, tool_input: item.input, session_id: 'corpus', cwd: 'C:\\Users\\Erez\\AI Projects\\Improve AI Infra' }));
  });
}

(async () => {
  const CONC = 12; let idx = 0;
  const diffs = {}; let same = 0, n = 0;
  const intended = { guardB: 0, guardA: 0, stagingPut: 0 };
  async function worker() {
    while (idx < corpus.length) {
      const item = corpus[idx++];
      const [a, b] = await Promise.all([runHook(liveHook, item), runHook(workHook, item)]);
      n++;
      if (a.code === b.code && a.dec === b.dec) { same++; continue; }
      const t = JSON.stringify(item.input || '');
      const isDriveList = /__(search_files|list_recent_files)$/.test(item.tool) && !(item.input && item.input.excludeContentSnippets === true);
      const hasId = t.indexOf(SHEET_ID) !== -1;
      const mentionsPut = /atlassian-put|atlass~[0-9]/i.test(t);
      const cmd = item.input && typeof item.input.command === 'string' ? item.input.command : '';
      const rawWrite = /atlassian\.net|api\.atlassian\.com/i.test(cmd) && /\b(curl|curl\.exe|invoke-restmethod|invoke-webrequest|iwr|irm|wget)\b/i.test(cmd);
      let cls = 'UNEXPLAINED';
      if (b.why === 'staging' && mentionsPut) { cls = 'intended: names atlassian-put (shape refusal)'; intended.stagingPut++; }
      else if (b.why === 'staging' && item.tool === 'Monitor' && rawWrite) { cls = 'intended: Monitor Atlassian write refused'; }
      else if (b.why === 'staging' && a.code === 0 && rawWrite && /md-3649|an-1406|1182400513/i.test(t)) { cls = 'intended: raw-curl sandbox exemption dropped'; }
      const key = cls + ' | ' + item.tool.replace(/^mcp__[0-9a-f-]{36}__/, 'mcp__<uuid>__') + ' | live ' + a.code + '/' + a.dec + ' -> work ' + b.code + '/' + b.dec + (b.why ? ' (' + b.why + ')' : '');
      diffs[key] = (diffs[key] || 0) + 1;
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('transcript files scanned: ' + files.length);
  console.log('corpus: ' + corpus.length + ' calls (MCP/WebFetch ' + surface.length + ', shell mentioning atlassian/id ' + shellHot.length + ', shell sample ' + shellSample.length + ' of ' + shellRest.length + ')');
  console.log('identical decisions: ' + same + ' / ' + n);
  for (const k of Object.keys(diffs).sort()) console.log('  ' + diffs[k] + ' x ' + k);
  const unexplained = Object.keys(diffs).filter(k => k.indexOf('UNEXPLAINED') === 0).reduce((s, k) => s + diffs[k], 0);
  console.log('UNEXPLAINED (false fires or regressions): ' + unexplained);
  fs.rmSync(path.join(HERE, 'corpus-live'), { recursive: true, force: true });
  fs.rmSync(path.join(HERE, 'corpus-work'), { recursive: true, force: true });
})();
