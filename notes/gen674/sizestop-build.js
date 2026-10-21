// GEN-674 headroom step, part 2: build working copies of auto-approve.js (size stop) and
// deny-askuserquestion.js (stale header comment) from the live files. Each replacement must match
// exactly once; the build aborts otherwise. Usage: node sizestop-build.js <outDir>
const fs = require('fs');
const path = require('path');
const HOME = process.env.USERPROFILE;
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node sizestop-build.js <outDir>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const HOOKS = path.join(HOME, '.claude', 'hooks');
const INSERT = fs.readFileSync(path.join(__dirname, 'sizestop-insert.txt'), 'utf8').replace(/\r\n/g, '\n');

function apply(src, pairs, label) {
  let s = src;
  for (const [oldT, newT] of pairs) {
    const n = s.split(oldT).length - 1;
    if (n !== 1) { console.error(label + ': expected 1 match, got ' + n + ' for: ' + oldT.slice(0, 80)); process.exit(2); }
    s = s.replace(oldT, () => newT);
  }
  return s;
}

const OLD_LOOP =
  "  // Resolve a DISTINCT matching, unexpired check pass for EVERY non-mechanical target BEFORE consuming\n" +
  "  // any -- so a multi-target call either fully passes or fully blocks. Then consume all. (Same\n" +
  "  // all-or-nothing + cross-process-race stance as enforceVetting.)\n" +
  "  const files = [];\n" +
  "  for (const o of nonMechanical) {\n" +
  "    const file = findCheckPassFile(\n" +
  "      p => p.kind === 'check' && String(p.target || '').replace(/\\//g, '\\\\').toLowerCase() === o.target,\n" +
  "      files // exclude already-claimed pass files so two targets can't share one pass\n" +
  "    );\n" +
  "    if (!file) blockCheckDue('No check pass for ' + o.target + '.');\n" +
  "    files.push(file);\n" +
  "  }\n";

const NEW_LOOP =
  "  // GEN-674: hard size stop for the global CLAUDE.md (see sizeStopCheck). Decided before any pass is\n" +
  "  // looked up or consumed; a crossing then needs a pass carrying a valid sizeApproval.\n" +
  "  let sizeGate = null;\n" +
  "  if (nonMechanical.some(o => o.target === GLOBAL_CLAUDE_MD)) {\n" +
  "    try {\n" +
  "      const r = sizeStopCheck(tool, command, cwd);\n" +
  "      if (r.measured && r.result > r.limit && r.result > r.current) {\n" +
  "        const lh = sizeLatestHumanText(input);\n" +
  "        sizeGate = { result: r.result, current: r.current, limit: r.limit, chars: r.chars,\n" +
  "          latest: typeof lh.text === 'string' ? lh.text : null, asked: typeof lh.asked === 'string' ? lh.asked : null,\n" +
  "          latestError: lh.error || null };\n" +
  "      }\n" +
  "    } catch (e) {\n" +
  "      sizeStopRefuse('internal error in the size stop (' + (e && e.message) + '); refusing rather than letting the write through.');\n" +
  "    }\n" +
  "  }\n" +
  "\n" +
  "  // Resolve a DISTINCT matching, unexpired check pass for EVERY non-mechanical target BEFORE consuming\n" +
  "  // any -- so a multi-target call either fully passes or fully blocks. Then consume all. (Same\n" +
  "  // all-or-nothing + cross-process-race stance as enforceVetting.)\n" +
  "  const files = [];\n" +
  "  for (const o of nonMechanical) {\n" +
  "    const gate = (sizeGate && o.target === GLOBAL_CLAUDE_MD) ? sizeGate : null;\n" +
  "    const file = findCheckPassFile(\n" +
  "      p => p.kind === 'check' && String(p.target || '').replace(/\\//g, '\\\\').toLowerCase() === o.target &&\n" +
  "        (!gate || sizeApprovalOk(p, gate)),\n" +
  "      files // exclude already-claimed pass files so two targets can't share one pass\n" +
  "    );\n" +
  "    if (!file) {\n" +
  "      if (gate) sizeStopRefuse(sizeCrossingRefusal(gate));\n" +
  "      blockCheckDue('No check pass for ' + o.target + '.');\n" +
  "    }\n" +
  "    files.push(file);\n" +
  "  }\n";

const AA = [
  ["// Check-before-present guard. For any tool call that would write to a check-due target, require a\n",
   INSERT + "// Check-before-present guard. For any tool call that would write to a check-due target, require a\n"],
  ["function enforceCheckDue(tool, ti, command, cwd) {\n", "function enforceCheckDue(tool, ti, command, cwd, input) {\n"],
  // GEN-674: Case 2 fails closed to the global CLAUDE.md for an update-config.ps1 INVOCATION whose
  // -File the regex cannot resolve, or that mentions CLAUDE.md anywhere (prefix, colon, positional
  // and decoy-in-a-literal forms), so the size stop's strict parse decides it instead of a miss.
  ["      const k = resolveUpdateConfigFile(command);\n      if (k && isCheckDueTarget(k)) push(k, false);\n    }\n",
   "      const k = resolveUpdateConfigFile(command);\n      if (k && isCheckDueTarget(k)) push(k, false);\n" +
   "      // GEN-674: for an update-config.ps1 INVOCATION, also read -File with the size stop's strict\n" +
   "      // tokenizer. If it cannot read the command plainly (prefix -Fi, colon -File:, positional\n" +
   "      // arguments), finds no -File, or resolves a different file from the regex above (a decoy -File\n" +
   "      // inside an earlier literal), treat the call as a write to the global CLAUDE.md, so the size\n" +
   "      // stop's strict parse decides it rather than the call slipping past with no target. The\n" +
   "      // settings-only ops (add-allow / remove-allow) never touch CLAUDE.md and may omit -File.\n" +
   "      if (UPDATE_CONFIG_INVOKE_RE.test(command) && !/(?:^|\\s)-Op\\s+[\"']?(?:add|remove)-allow[\"']?(?:\\s|$)/i.test(command)) {\n" +
   "        const st = sizeUpdateConfigTarget(command, cwd);\n" +
   "        if (!st.ok || !st.key || st.key === GLOBAL_CLAUDE_MD || st.key !== k) push(GLOBAL_CLAUDE_MD, false);\n" +
   "      }\n" +
   "    }\n"],
  ["const UPDATE_CONFIG_RE = /update-config\\.ps1/i;\n",
   "const UPDATE_CONFIG_RE = /update-config\\.ps1/i;\n" +
   "// GEN-674: the command itself starts by invoking update-config.ps1 (optionally via the & call operator).\n" +
   "const UPDATE_CONFIG_INVOKE_RE = /^\\s*(?:&\\s*)?(?:\"[^\"]*|'[^']*|[^\\s'\"]*)update-config\\.ps1/i;\n"],
  [OLD_LOOP, NEW_LOOP],
  ["  enforceCheckDue(tool, input.tool_input, input.tool_input && input.tool_input.command, input.cwd);\n",
   "  enforceCheckDue(tool, input.tool_input, input.tool_input && input.tool_input.command, input.cwd, input);\n"],
];

const DENY = [
  [" * asking inline in the conversation as prose. Once proven live, the resident\n * rule in the global CLAUDE.md shrinks to a one-line pointer at this file.\n",
   " * asking inline in the conversation as prose. The resident rule was removed\n * from the global CLAUDE.md (GEN-674), so REASON below is now the rule's only\n * copy: keep it complete.\n"],
];

for (const [name, pairs] of [['auto-approve.js', AA], ['deny-askuserquestion.js', DENY]]) {
  const src = fs.readFileSync(path.join(HOOKS, name), 'utf8');
  const crlf = /\r\n/.test(src);
  const norm = src.replace(/\r\n/g, '\n');
  let out = apply(norm, pairs, name);
  if (crlf) out = out.replace(/\n/g, '\r\n');
  fs.writeFileSync(path.join(OUT, name), out, 'utf8');
  console.log(name + ': ' + norm.split('\n').length + ' -> ' + out.split(/\r?\n/).length + ' lines' + (crlf ? ' (CRLF kept)' : ''));
}
