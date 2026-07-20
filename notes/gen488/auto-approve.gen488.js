#!/usr/bin/env node
'use strict';

/*
 * auto-approve.js -- Claude Code PreToolUse hook.  (GEN-76)
 *
 * Purpose: auto-approve a conservative, read-only "safe-set" so Erez is not
 * prompted for harmless calls, and log every call it does NOT approve so the
 * end-of-session reviewer can learn which recurring calls to promote.
 *
 * Safety stance:
 *   - Never returns "deny" in v1. Worst case is a normal permission prompt.
 *   - Any error / unrecognized input => defer silently (normal prompt fires).
 *   - For shell commands, approves only if EVERY chained segment is a known
 *     read-only command. A mix of safe + unknown defers the whole line.
 *   - Redirections (> >>), command substitution ($() / backticks), env refs
 *     (${...}), background (&) and newlines are never auto-approved.
 *   - GEN-337(e): a single-line command that CHAINS (; && ||) a state-changing
 *     segment with anything else is hard-blocked (exit 2) with an educational
 *     refusal -- one risky command per tool call. All-read-only chains still
 *     auto-approve; anything the chain scanner cannot read with certainty
 *     (odd quoting, substitution, control-flow one-liners) falls through to
 *     the normal permission prompt, never a block and never an approve.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK_DIR = __dirname;
const LOG_FILE = path.join(HOOK_DIR, 'deferred-calls.jsonl');
const SETTINGS_FILE = path.join(HOOK_DIR, '..', 'settings.json');

// ---- secret redaction (GEN-233) --------------------------------------------
// Patterns live in a shared JSON file (secret-patterns.json) also read by
// sync.ps1's backup-boundary scan, so the two never drift. redactSecrets()
// replaces any token-shaped substring with [REDACTED] before a command is
// written to the deferred-calls log. If the patterns file is missing or
// malformed, redactSecrets THROWS; logDeferred catches that and logs
// [REDACTION-UNAVAILABLE] rather than the raw value -- never the secret.
const PATTERNS_FILE = path.join(HOOK_DIR, 'secret-patterns.json');

function loadSecretRegexes() {
  const raw = fs.readFileSync(PATTERNS_FILE, 'utf8').replace(/^﻿/, '');
  const defs = JSON.parse(raw);
  if (!Array.isArray(defs) || defs.length === 0) {
    throw new Error('secret-patterns.json is empty or not an array');
  }
  return defs.map(d => new RegExp(d.regex, 'g'));
}

function redactSecrets(str) {
  if (typeof str !== 'string' || str === '') return str;
  const regexes = loadSecretRegexes(); // throws on missing/malformed -> caller handles
  let out = str;
  for (const re of regexes) out = out.replace(re, '[REDACTED]');
  return out;
}

// ---- decision helpers ------------------------------------------------------

function approve(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
}

function defer(additionalContext) {
  // No decision output => normal permission flow (allow-list / prompt) applies.
  // GEN-488: an optional advisory string may ride along. additionalContext is a
  // documented PreToolUse field that injects text into the model's context WITHOUT
  // reporting a permission decision, so the flow is identical to a silent exit
  // (same channel inject-shell-refs.js uses). Only the SHELL_TOOLS defer passes an
  // argument; every other call site stays argument-less (behavior unchanged).
  if (typeof additionalContext === 'string' && additionalContext !== '') {
    try {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: additionalContext
        }
      }));
    } catch (e) {
      // Advisory only -- never let the nudge break a defer.
    }
  }
  process.exit(0);
}

function logDeferred(input) {
  try {
    const rawCommand = (input.tool_input && input.tool_input.command) || undefined;
    let safeCommand = rawCommand;
    if (rawCommand !== undefined) {
      try {
        safeCommand = redactSecrets(rawCommand);
      } catch (e) {
        safeCommand = '[REDACTION-UNAVAILABLE]';
      }
    }
    const entry = {
      ts: new Date().toISOString(),
      tool: input.tool_name,
      command: safeCommand,
      cwd: input.cwd,
      session: input.session_id
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (e) {
    // Logging must never break a tool call.
  }
}

// ---- safe-set definitions --------------------------------------------------

// Tools that never mutate anything.
const SAFE_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'ToolSearch',
  // Read-only web research tools (never mutate).
  'WebSearch', 'WebFetch',
  // Read-only MCP tools (Drive reads, Notion reads) — never mutate.
  'mcp__29434d4d-f523-42ae-803a-2fb8d7bd3ee2__read_file_content',
  'mcp__29434d4d-f523-42ae-803a-2fb8d7bd3ee2__get_file_metadata',
  'mcp__29434d4d-f523-42ae-803a-2fb8d7bd3ee2__search_files',
  'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__notion-fetch',
  'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__notion-search',
  // Read-only Jira/Confluence/Slack MCP tools (lookups only, never mutate).
  'mcp__9da13451-799f-4bf6-9a8f-58fe25fc6c80__getJiraIssue',
  'mcp__9da13451-799f-4bf6-9a8f-58fe25fc6c80__searchJiraIssuesUsingJql',
  'mcp__9da13451-799f-4bf6-9a8f-58fe25fc6c80__getTransitionsForJiraIssue',
  'mcp__9da13451-799f-4bf6-9a8f-58fe25fc6c80__searchConfluenceUsingCql',
  'mcp__ee781d17-0ee1-4573-b0c9-81cacb12ca45__slack_read_thread',
  // Read-only session-management tools — list/search only, never mutate.
  'mcp__ccd_session_mgmt__list_sessions',
  'mcp__ccd_session_mgmt__search_session_transcripts', 'mcp__ad11ec05-9322-406d-a216-82b609f5efef__search_threads', 'mcp__ad11ec05-9322-406d-a216-82b609f5efef__get_thread',
]);

// Tools whose payload is a shell command string we must classify.
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

// ---- auto-approve file edits within Erez's project folders ----------------
// Suppress prompts for Edit/Write/MultiEdit whose targets all resolve inside a
// project root, and append each to the durable per-session change log so the
// end-of-turn report can surface them. Carve-outs (.git internals, secrets,
// signing keystores) and protected config files (blocked above) still prompt.
// path.resolve collapses '..' so a traversal cannot escape a root prefix.
// (Symlinks inside a root pointing outside it are NOT dereferenced -- a known
// low-risk gap requiring deliberate symlink creation.)
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
// NOTE (GEN-488): classifyNudgeParent selects the 'ai projects' entry below by
// name-match as the projects CONTAINER root. If this list is renamed or restructured,
// update that selector too (it fails open: no match -> that nudge clause silently no-ops).
const PROJECT_ROOTS = ['c:\\users\\erez\\ai projects\\', 'c:\\users\\erez\\memorypirates\\'];
const SECRET_EXTS = new Set(['.pem', '.key', '.pfx', '.p12', '.jks', '.keystore']);
const EDITS_LOG = path.join(HOOK_DIR, 'auto-approved-edits.jsonl');

function normForMatch(p, cwd) {
  return path.resolve(cwd || '', p).replace(/\//g, '\\').toLowerCase();
}

function isAutoApprovableEdit(p, cwd) {
  const key = normForMatch(p, cwd);
  if (!PROJECT_ROOTS.some(root => key.startsWith(root))) return false;
  const segs = key.split('\\');
  if (segs.includes('.git')) return false;
  const base = segs[segs.length - 1] || '';
  if (base === '.env' || base.startsWith('.env.')) return false;
  const dot = base.lastIndexOf('.');
  if (dot >= 0 && SECRET_EXTS.has(base.slice(dot))) return false;
  return true;
}

function logApprovedEdits(input, paths) {
  try {
    const ts = new Date().toISOString();
    for (const p of paths) {
      const abs = path.resolve(input.cwd || '', p);
      let existed = null;
      try { existed = fs.existsSync(abs); } catch (e) {}
      fs.appendFileSync(EDITS_LOG, JSON.stringify({
        ts, tool: input.tool_name, file: abs, existed, session: input.session_id
      }) + '\n');
    }
  } catch (e) {
    // Logging must never break a tool call.
  }
}

// ---- GEN-103: hard-block direct edits to protected config files ------------
// These files may only be changed via update-config.ps1, which serializes every
// edit behind a single global lock. A direct Edit/Write here could silently
// clobber another session's change (the exact bug that dropped two allow entries
// on 2026-06-02). We exit(2) -- a blocking error that overrides the allow-list,
// unlike a soft "deny" which an allow entry can still let through.
const PROTECTED_FILES = new Set([
  'c:\\users\\erez\\.claude\\settings.json',
  'c:\\users\\erez\\.claude\\settings.local.json',
  'c:\\users\\erez\\.claude\\claude.md',
  'c:\\users\\erez\\.claude\\hooks\\auto-approve.js',
  'c:\\users\\erez\\.claude\\scripts\\notion-ticket-lookup.ps1',
]);
const BLOCK_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Break-glass override tokens. These are the SOLE durable home for the override
// info (the resident CLAUDE.md only points here), so both the runtime check AND
// the refusal message below read from these same constants -- the message can
// never describe an override that does not work. A self-check at module load
// (bottom of file) guards against the message being deleted outright. (GEN-337)
const UNLOCK_ENV_VAR = 'CLAUDE_CONFIG_UNLOCK';
const UNLOCK_SENTINEL = path.join(HOOK_DIR, '..', '.config-unlock');

// Escape hatch so a broken locked-edit tool can never lock you out permanently.
function configUnlocked() {
  if (process.env[UNLOCK_ENV_VAR] === '1') return true;
  try { return fs.existsSync(UNLOCK_SENTINEL); } catch (e) { return false; }
}

function resolveProtectedKey(p, cwd) {
  try {
    const abs = path.isAbsolute(p) ? p : path.resolve(cwd || '', p);
    return abs.replace(/\//g, '\\').toLowerCase();
  } catch (e) {
    return String(p).replace(/\//g, '\\').toLowerCase();
  }
}

// Collect the file path(s) a tool call targets, by tool type.
// Edit/Write/NotebookEdit -> tool_input.file_path; MultiEdit may nest paths in edits[].
function targetPaths(tool, ti) {
  if (!ti) return [];
  const out = [];
  if (ti.file_path) out.push(ti.file_path);
  if (tool === 'MultiEdit' && Array.isArray(ti.edits)) {
    for (const e of ti.edits) { if (e && e.file_path) out.push(e.file_path); }
  }
  return out;
}

// Builds the protected-file refusal message. The override info (UNLOCK_ENV_VAR,
// UNLOCK_SENTINEL) is interpolated from the shared constants, so it cannot drift
// from the actual runtime check in configUnlocked(). blockIfProtected passes this
// return value to stderr UNMODIFIED so the self-check below validates what a user
// actually sees. (GEN-337)
function buildRefusalMessage(p) {
  return 'Refused: ' + p + ' is a protected config file. A direct edit can silently ' +
    'overwrite another session\'s change. Edit it via update-config.ps1 ' +
    '(or update-global-rule.ps1 for CLAUDE.md). Emergency override: set env ' +
    UNLOCK_ENV_VAR + '=1 or create the file ' + UNLOCK_SENTINEL + '.\n';
}

function blockIfProtected(tool, ti, cwd) {
  if (!BLOCK_TOOLS.has(tool)) return;
  if (configUnlocked()) return;
  for (const p of targetPaths(tool, ti)) {
    if (PROTECTED_FILES.has(resolveProtectedKey(p, cwd))) {
      process.stderr.write(buildRefusalMessage(p));
      process.exit(2);
    }
  }
}

// Self-check (GEN-337): the resident CLAUDE.md no longer carries the break-glass
// override string; this refusal message is its only durable home. Assert on every
// hook load that the built message still contains both override tokens, so a future
// edit that strips or guts the message is caught on the very next tool call rather
// than silently. Fails CLOSED via exit(2) -- NOT a bare throw: for a PreToolUse hook
// only exit(2) blocks the call; a throw exits 1, which is NON-blocking and would let
// the bad edit through (the general fail-open stance at the top of this file is
// deliberately overridden here, exactly as blockIfProtected does). The whole check is
// wrapped so ANY internal error also routes to exit(2), never a fail-open throw.
(function assertOverrideInfoPresent() {
  try {
    const msg = buildRefusalMessage('<self-check>');
    if (msg.indexOf(UNLOCK_ENV_VAR) !== -1 && msg.indexOf(UNLOCK_SENTINEL) !== -1) return;
    process.stderr.write(
      'auto-approve.js self-check FAILED: the protected-file refusal message no longer ' +
      'contains the break-glass override info (env ' + UNLOCK_ENV_VAR + ' / sentinel ' +
      UNLOCK_SENTINEL + '). This message is the SOLE durable home for that info -- a ' +
      'recent edit stripped it. Restore it (see buildRefusalMessage) before continuing. ' +
      'Recover a wedged session out-of-band: set env ' + UNLOCK_ENV_VAR + '=1.\n'
    );
  } catch (e) {
    process.stderr.write('auto-approve.js self-check crashed: ' + (e && e.message) + '\n');
  }
  process.exit(2);
})();

// git subcommands that never write.
const SAFE_GIT_SUBS = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'describe', 'blame', 'shortlog']);
const SAFE_GIT_BRANCH_FLAGS = new Set(['-v', '-vv', '-a', '--all', '-l', '--list', '--show-current', '-r', '--remotes']);
const SAFE_GIT_REMOTE_FIRST = new Set(['-v', '--verbose', 'show', 'get-url']);

// Standalone read-only commands / cmdlets (compared lowercased).
const SAFE_STANDALONE = new Set([
  'pwd', 'whoami', 'hostname', 'ls', 'dir',
  'grep', 'findstr', 'select-string',
  'get-location', 'get-childitem', 'test-path', 'get-date',
  'get-content', 'compare-object', 'cd', 'set-location', 'cat', 'tail', 'head', 'wc', 'nl', 'cut', 'tr', 'comm', 'column', 'basename', 'dirname', 'realpath', 'file', 'stat', 'strings', 'jq', 'echo', 'printf', 'test', 'type', 'which', 'printenv', 'netstat', 'tasklist', 'du', 'df', 'uname', 'get-item', 'get-itemproperty', 'get-process', 'get-member', 'get-command', 'get-help', 'get-module', 'get-variable', 'get-service', 'get-filehash', 'resolve-path', 'split-path', 'join-path', 'convertfrom-json', 'convertto-json', 'out-string', 'measure-object'
]);

function tokenize(seg) {
  return seg.trim().split(/\s+/).filter(Boolean);
}

function segmentIsSafe(seg) {
  const t = tokenize(seg);
  if (t.length === 0) return false;
  const cmd = t[0].toLowerCase();

  if (cmd === 'git') {
    const sub = (t[1] || '').toLowerCase();
    if (!sub) return false;
    if (SAFE_GIT_SUBS.has(sub)) return true;
    if (sub === 'branch') return t.slice(2).every(a => SAFE_GIT_BRANCH_FLAGS.has(a));
    if (sub === 'remote') return t.length === 2 || SAFE_GIT_REMOTE_FIRST.has((t[2] || '').toLowerCase());
    return false;
  }
  if (cmd === 'node') return t[1] === '-v' || t[1] === '--version';
  if (cmd === 'npm') return ['ls', 'list', '-v', '--version'].includes((t[1] || '').toLowerCase());
  // clasp: only the read-only `clasp logs` (bare form) is safe; push/run/etc. mutate.
  if (cmd === 'clasp') return (t[1] || '').toLowerCase() === 'logs' && t.length === 2;
  if (cmd === 'find') { const bad = new Set(['-delete','-exec','-execdir','-ok','-okdir','-fprint','-fprintf','-fprint0','-fls']); return t.slice(1).every(a => !bad.has(a.toLowerCase())); }
  return SAFE_STANDALONE.has(cmd);
}

// Exact-match allow for the internal config-sync script (push local -> Drive).
// Only the From-Claude direction is approved. An optional -CommitMessage is
// permitted, but its value forbids quotes/backtick/$ to block PowerShell
// string interpolation and command substitution.
function isSafeSyncFromClaude(command) {
  if (typeof command !== 'string') return false;
  const re = /^&\s+(['"])G:\\My Drive\\AI Projects\\_Tooling\\Claude\\sync\.ps1\1\s+-Direction\s+From-Claude(\s+-CommitMessage\s+(['"])[^'"`$]*\3)?\s*$/i;
  return re.test(command.trim());
}

// Exact-match allow for the fixed Notion ticket-id lookup script (GEN-316).
// Only the bare invocation with a numeric-only argument is approved -- a wildcard
// couldn't enforce "digits only, nothing else" the way this full-match regex can.
// No `m` flag: ^ and $ anchor to the WHOLE string, so an embedded newline can't
// smuggle a second command past this check.
function isSafeNotionTicketLookup(command) {
  if (typeof command !== 'string') return false;
  const re = /^&\s+(['"])C:\\Users\\Erez\\\.claude\\scripts\\notion-ticket-lookup\.ps1\1\s+\d{1,6}\s*$/i;
  return re.test(command.trim());
}

// Exact-match allow for the compact-gate marker files (GEN-348). /wrap Step 4
// releases the gate with `touch "$HOME/.claude/.loggate-ok-$CLAUDE_SESSION_ID"`,
// and the loggate one-time self-test writes `.loggate-verified`; the auto-mode
// classifier misreads both as log tampering when they reach the prompt. Only a
// bare `touch` of these two documented marker names directly under $HOME/.claude
// is approved. No `m` flag: ^ and $ anchor the WHOLE string, so an embedded
// newline cannot smuggle a second command past this check.
function isSafeLoggateTouch(command) {
  if (typeof command !== 'string') return false;
  const re = /^touch\s+"\$HOME\/\.claude\/\.loggate-(ok-(\$CLAUDE_SESSION_ID|[0-9a-fA-F][0-9a-fA-F-]{7,63})|verified)"\s*$/;
  return re.test(command.trim());
}

function shellCommandIsSafe(command) {
  if (typeof command !== 'string' || command.trim() === '') return false;
  // Reject redirections and command substitution / env-expansion / newlines.
  if (/[<>`]/.test(command)) return false;
  if (command.includes('$(') || command.includes('${')) return false;
  if (/[\r\n]/.test(command)) return false;
  // Reject background '&' (a single &, not part of '&&').
  if (/(^|[^&])&([^&]|$)/.test(command)) return false;
  // Split on separators: && || ; |  and require EVERY segment to be safe.
  const segments = command.split(/&&|\|\||;|\|/).map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every(segmentIsSafe);
}

// ---- GEN-337(e): mixed-risk chain guard -------------------------------------
// Enforces the resident CLAUDE.md rule "Never chain shell commands on a single
// line when they differ in risk": a single-line command that chains (; && ||) a
// non-read-only segment with anything else is hard-blocked with exit(2) and an
// educational refusal. Design points (all /check-panel-converged):
//   - Quote-aware, per-shell scanner (tool_name picks bash vs PS rules). Quoted
//     spans are opaque: a ';' inside a commit message or JSON body never counts.
//   - Fail-open-to-a-PROMPT: AMBIGUOUS scans (substitution, unbalanced quotes)
//     and any internal error fall through to the normal permission prompt --
//     never a block, never an approve. (Contrast assertOverrideInfoPresent,
//     which fails CLOSED: that guards static constants; this parses live input,
//     and a human still sees the command at the prompt.)
//   - Control-flow one-liners (for/if/try...; brace blocks) are not splittable
//     into independent commands, so they fall through to the prompt instead of
//     a block whose "split it" advice would be impossible to follow.
//   - Pipes and multi-line commands are OUT of v1 scope: both already never
//     auto-approve when mutating, so they always surface at a prompt.
//   - Blocks are logged to chain-blocks.jsonl (redacted), NOT to the
//     deferred-calls log, which keeps its promotion-candidate meaning.
const CHAIN_BLOCKS_LOG = path.join(HOOK_DIR, 'chain-blocks.jsonl');

const BASH_CTRL_KEYWORDS = new Set(['for', 'while', 'until', 'if', 'case', 'do', 'then', 'else', 'elif', 'fi', 'done', 'esac', 'function', 'select']);
const PS_CTRL_KEYWORDS = new Set(['foreach', 'for', 'while', 'do', 'until', 'if', 'else', 'elseif', 'try', 'catch', 'finally', 'function', 'switch', 'param', 'begin', 'process', 'end', 'trap']);

// Scans a SINGLE-LINE command for top-level chain separators (; && ||) with
// shell-aware quote handling. Returns:
//   { verdict: 'NO-CHAIN' }                          -- no top-level separator
//   { verdict: 'CHAINED', segments, bare }           -- segments = top-level parts
//                                                       (quoted spans blanked),
//                                                       bare = unquoted text only
//   { verdict: 'AMBIGUOUS' }                         -- cannot read with certainty
// AMBIGUOUS triggers: $( or ${ anywhere active, bash backticks, bash heredoc <<,
// unbalanced quotes at end of input. Single '&' (bash background) and single '|'
// (pipes) are deliberately NOT separators here (v1 scope; both already never
// auto-approve when mutating).
function scanChain(command, tool) {
  const isPS = (tool === 'PowerShell');
  const s = String(command);
  let seg = '', bare = '';
  const segs = [];
  let i = 0;
  const n = s.length;
  let state = 'none'; // none | sq (single-quoted) | dq (double-quoted)
  while (i < n) {
    const c = s[i];
    const d = (i + 1 < n) ? s[i + 1] : '';
    if (state === 'sq') {
      if (c === "'") {
        if (isPS && d === "'") { i += 2; continue; } // PS: doubled '' = literal quote
        state = 'none'; i++; continue;
      }
      i++; continue; // POSIX: NOTHING is special inside '...' (no escapes)
    }
    if (state === 'dq') {
      if (!isPS && c === '\\') { i += 2; continue; }              // bash: \ escapes next
      if (isPS && c === '`') { i += 2; continue; }                // PS: ` escapes next
      if (isPS && c === '"' && d === '"') { i += 2; continue; }   // PS: doubled "" = literal quote
      // Substitution is ACTIVE inside double quotes in both shells.
      if (c === '$' && (d === '(' || d === '{')) return { verdict: 'AMBIGUOUS' };
      if (!isPS && c === '`') return { verdict: 'AMBIGUOUS' };    // bash backtick substitution
      if (c === '"') { state = 'none'; i++; continue; }
      i++; continue;
    }
    // state === 'none' (outside any quote)
    if (!isPS && c === '\\') { seg += ' '; bare += ' '; i += 2; continue; } // bash: \; is a literal ;
    if (c === '`') {
      if (isPS) { seg += ' '; bare += ' '; i += 2; continue; }    // PS: `; is a literal ;
      return { verdict: 'AMBIGUOUS' };                            // bash: backtick substitution
    }
    if (c === "'") { state = 'sq'; seg += ' '; bare += ' '; i++; continue; }
    if (c === '"') { state = 'dq'; seg += ' '; bare += ' '; i++; continue; }
    if (c === '$' && (d === '(' || d === '{')) return { verdict: 'AMBIGUOUS' };
    if (!isPS && c === '<' && d === '<') return { verdict: 'AMBIGUOUS' };   // heredoc
    if (c === ';') { segs.push(seg); seg = ''; bare += ' ; '; i++; continue; }
    if (c === '&' && d === '&') { segs.push(seg); seg = ''; bare += ' && '; i += 2; continue; }
    if (c === '|' && d === '|') { segs.push(seg); seg = ''; bare += ' || '; i += 2; continue; }
    seg += c; bare += c; i++;
  }
  if (state !== 'none') return { verdict: 'AMBIGUOUS' }; // unbalanced quote
  segs.push(seg);
  const parts = segs.map(x => x.trim()).filter(Boolean);
  if (segs.length > 1 && parts.length > 1) return { verdict: 'CHAINED', segments: parts, bare };
  return { verdict: 'NO-CHAIN' };
}

// True if the unquoted text contains shell control-flow syntax -- such a line is
// one logical construct, not a chain of independently-issuable commands, so the
// "split it" refusal advice cannot apply. False positives here are safe: they
// route to the normal prompt, not past it.
function hasControlConstruct(bare, tool) {
  if (/[{}]/.test(bare)) return true; // brace / script block outside quotes
  const kw = (tool === 'PowerShell') ? PS_CTRL_KEYWORDS : BASH_CTRL_KEYWORDS;
  return String(bare).toLowerCase().split(/[^a-z]+/).some(t => t && kw.has(t));
}

function logChainBlock(input) {
  try {
    const rawCommand = (input.tool_input && input.tool_input.command) || undefined;
    let safeCommand = rawCommand;
    if (rawCommand !== undefined) {
      try {
        safeCommand = redactSecrets(rawCommand);
      } catch (e) {
        safeCommand = '[REDACTION-UNAVAILABLE]';
      }
    }
    fs.appendFileSync(CHAIN_BLOCKS_LOG, JSON.stringify({
      ts: new Date().toISOString(),
      tool: input.tool_name,
      command: safeCommand,
      cwd: input.cwd,
      session: input.session_id
    }) + '\n');
  } catch (e) {
    // Logging must never break a tool call.
  }
}

// The guard. Called in the SHELL_TOOLS branch after every approve path has
// declined. Either exits 2 (mixed-risk chain, splittable) or returns so the
// caller falls through to logDeferred + defer (normal prompt).
function blockMixedChain(input, tool, cmd) {
  let firstUnsafe = null;
  try {
    if (typeof cmd !== 'string' || /[\r\n]/.test(cmd)) return; // multi-line: out of scope -> prompt
    const r = scanChain(cmd, tool);
    if (r.verdict !== 'CHAINED') return;                        // NO-CHAIN / AMBIGUOUS -> prompt
    if (r.segments.every(segmentIsSafe)) return;                // all read-only: not mixed-risk
    if (hasControlConstruct(r.bare, tool)) return;              // one logical construct -> prompt
    firstUnsafe = r.segments.find(sg => !segmentIsSafe(sg)) || '';
  } catch (e) {
    return; // any internal error -> normal prompt path (fail open to a PROMPT)
  }
  // Decision made inside the try; act outside it so nothing re-routes the exit.
  logChainBlock(input);
  process.stderr.write(
    'Refused: this single line chains a state-changing or unrecognized command (starting at "' +
    String(firstUnsafe).slice(0, 80) + '") together with other commands. Per the global CLAUDE.md rule ' +
    '"Never chain shell commands on a single line when they differ in risk", issue each command as its ' +
    'own separate tool call so risky operations are reviewed independently. Chaining is only acceptable ' +
    'when every part is read-only and safe. If this line is one logical operation that cannot be split, ' +
    'reformulate it (e.g. as a multi-line command), which goes to a normal permission prompt instead.\n'
  );
  process.exit(2);
}

// Bare tool-name entries already allow-listed in settings.json (no parens).
// These never prompt anyway, so we neither approve nor log them.
function bareAllowList() {
  try {
    const json = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const allow = (json.permissions && json.permissions.allow) || [];
    return new Set(allow.filter(a => typeof a === 'string' && !a.includes('(')));
  } catch (e) {
    return new Set();
  }
}

// ---- GEN-281: staging lock for non-sandbox Jira/Confluence content edits ----------
// Block a content write to a non-sandbox Jira ticket / Confluence page unless a valid,
// single-use staging pass exists -- minted by the staging skill only after Erez
// approves the rendered redline. Pass + sandbox registry live in ~/.claude-staging
// (a sibling of ~/.claude, deliberately OUTSIDE the Write(~/.claude/*) allow-list),
// so creating either always prompts and cannot be forged silently. Covers the MCP
// edit tools (front door) AND direct mutating-HTTP shell commands to Atlassian
// (side door). On a pass match the pass is consumed (renamed) and the call
// approved; on a miss the call is hard-blocked with exit(2) -- the same
// override-proof block the protected-config guard uses, so an allow-list entry
// (updateConfluencePage is allow-listed) cannot let it through. Drafting on a
// registered sandbox is exempt. Binding is target+field (not a content hash):
// robust against any change in how a tool serializes its payload.
const STAGING_DIR = path.join(HOOK_DIR, '..', '..', '.claude-staging');
const STAGING_PASS_DIR = path.join(STAGING_DIR, 'passes');
const SANDBOX_REGISTRY = path.join(STAGING_DIR, 'sandboxes.json');
const EDIT_JIRA_TOOL = 'mcp__9da13451-799f-4bf6-9a8f-58fe25fc6c80__editJiraIssue';
const UPDATE_CONF_TOOL = 'mcp__9da13451-799f-4bf6-9a8f-58fe25fc6c80__updateConfluencePage';
const JIRA_CONTENT_FIELDS = ['summary', 'description'];

function loadSandboxRegistry() {
  try {
    const raw = fs.readFileSync(SANDBOX_REGISTRY, 'utf8').replace(/^﻿/, '');
    const j = JSON.parse(raw);
    return {
      jira: Array.isArray(j.jira) ? j.jira.map(s => String(s).toLowerCase()) : [],
      confluence: Array.isArray(j.confluence) ? j.confluence.map(s => String(s).toLowerCase()) : []
    };
  } catch (e) {
    return { jira: [], confluence: [] };
  }
}

// Find an unexpired pass file matching matchFn (does NOT consume). Returns full path or null.
function findPassFile(matchFn) {
  let files;
  try { files = fs.readdirSync(STAGING_PASS_DIR); } catch (e) { return null; }
  const now = Date.now();
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(STAGING_PASS_DIR, f);
    let pass;
    try { pass = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^﻿/, '')); } catch (e) { continue; }
    const exp = Date.parse(pass.expires || '');
    if (!exp || exp < now) continue;
    if (matchFn(pass)) return full;
  }
  return null;
}

// Atomic single-use consume: rename before the call is allowed, so a crash leaves
// the pass consumed (not replayable) rather than re-usable.
function consumePassFile(full) {
  try { fs.renameSync(full, full + '.consumed.' + Date.now()); return true; } catch (e) { return false; }
}

function blockStaging(reason) {
  process.stderr.write(
    'Refused (staging lock): ' + reason + ' This is a non-sandbox Jira/Confluence content edit and must ' +
    'go through the staging flow: draft on the claude-sandbox, get Erez to approve the rendered ' +
    'result, then mint a one-time staging pass. Use the staging skill instead of editing the non-sandbox ' +
    'document directly.\n'
  );
  process.exit(2);
}

// True if the shell command is a mutating HTTP call aimed at an Atlassian host.
function isAtlassianMutatingHttp(command) {
  if (typeof command !== 'string' || command === '') return false;
  if (!/atlassian\.net|api\.atlassian\.com/i.test(command)) return false;
  if (!/\b(curl|curl\.exe|invoke-restmethod|invoke-webrequest|iwr|irm|wget)\b/i.test(command)) return false;
  return /(-X|--request)\s*['"]?(PUT|POST|PATCH|DELETE)\b/i.test(command)
    || /-Method\s+['"]?(Put|Post|Patch|Delete)\b/i.test(command)
    || /(^|\s)(-d|--data|--data-raw|--data-binary|--data-urlencode|--json|-T|--upload-file|-Body|-InFile)\b/i.test(command);
}

function commandReferencesSandbox(command, reg) {
  const lc = String(command).toLowerCase();
  const hit = k => {
    if (!k) return false;
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(?<![a-z0-9])' + esc + '(?![a-z0-9])').test(lc);
  };
  return reg.jira.some(hit) || reg.confluence.some(hit);
}

// Staging guard. Hard-blocks (exit 2) a non-sandbox content write lacking a matching pass;
// consumes a matching pass and approves; otherwise returns (falls through to normal
// handling). Only acts on the two MCP edit tools and Atlassian-bound mutating shell
// commands -- every other tool returns untouched.
function enforceStaging(tool, ti, command) {
  const reg = loadSandboxRegistry();

  if (tool === EDIT_JIRA_TOOL && ti) {
    const fields = (ti.fields && typeof ti.fields === 'object') ? ti.fields : {};
    const contentFields = JIRA_CONTENT_FIELDS.filter(f => Object.prototype.hasOwnProperty.call(fields, f));
    if (contentFields.length === 0) return; // non-content fields (status/labels/fixVersions/...) pass freely
    const target = String(ti.issueIdOrKey || '').toLowerCase();
    if (target && reg.jira.includes(target)) return; // drafting on a sandbox ticket -> exempt
    const found = contentFields.map(f => ({
      f,
      file: findPassFile(p => p.surface === 'jira' && String(p.target).toLowerCase() === target && p.field === f)
    }));
    const missing = found.find(n => !n.file);
    if (missing) blockStaging('No staging pass for Jira ' + (ti.issueIdOrKey || '?') + ' field "' + missing.f + '".');
    for (const n of found) consumePassFile(n.file);
    return approve('Auto-approved: staging pass consumed (Jira ' + (ti.issueIdOrKey || '?') + ').');
  }

  if (tool === UPDATE_CONF_TOOL && ti) {
    const target = String(ti.pageId || '').toLowerCase();
    if (target && reg.confluence.includes(target)) return; // drafting on the sandbox page -> exempt
    const file = findPassFile(p => p.surface === 'confluence' && String(p.target).toLowerCase() === target);
    if (!file) blockStaging('No staging pass for Confluence page ' + (ti.pageId || '?') + '.');
    consumePassFile(file);
    return approve('Auto-approved: staging pass consumed (Confluence ' + (ti.pageId || '?') + ').');
  }

  if (SHELL_TOOLS.has(tool) && isAtlassianMutatingHttp(command)) {
    // GEN-337(e): a chained command must never ride through on a staged write's
    // approval -- isAtlassianMutatingHttp() substring-matches, so without this
    // pre-check `curl ...atlassian... -d ... && <anything>` would consume a pass
    // and silently approve the smuggled tail. CHAINED -> hard-block, pass NOT
    // consumed. AMBIGUOUS/multi-line/error -> return without approving (pass
    // untouched; the command falls through to normal handling -> prompt).
    let chainVerdict;
    try {
      chainVerdict = /[\r\n]/.test(String(command)) ? 'AMBIGUOUS' : scanChain(command, tool).verdict;
    } catch (e) {
      chainVerdict = 'AMBIGUOUS';
    }
    if (chainVerdict === 'CHAINED') {
      process.stderr.write(
        'Refused: a command that chains other commands (; && ||) onto an Atlassian write cannot ' +
        'consume a staging pass -- the chained part would be approved sight-unseen. Issue the ' +
        'Atlassian write as its own single tool call, then the other command(s) separately.\n'
      );
      process.exit(2);
    }
    if (chainVerdict !== 'NO-CHAIN') return;
    if (commandReferencesSandbox(command, reg)) return; // editing a sandbox via REST -> exempt
    const file = findPassFile(p => p.surface === 'shell');
    if (!file) blockStaging('No staging pass for a direct Atlassian write command.');
    consumePassFile(file);
    return approve('Auto-approved: staging pass consumed (direct Atlassian write).');
  }
}

// ---- GEN-376: vetting lock for live hook/script code changes ----------------
// Block any change to a live hook (~/.claude/hooks/*.js) or script (~/.claude/scripts/*.ps1)
// unless a valid, single-use VETTING PASS exists -- minted by the /vet-code skill only after
// the change has been through /check (design) + /code-review (diff) + live-verify, and Erez
// approves the mint. Pass lives in ~/.claude-staging/vetting-passes (a sibling of ~/.claude,
// OUTSIDE the Write(~/.claude/*) allow-list) so minting always prompts and cannot be forged
// silently. Same override-proof exit(2) block the staging/protected guards use.
//
// TARGET-CENTRIC, not command-shape-centric (the /check-panel-converged design decision): the
// gate fires whenever an operation WOULD write to a protected path, by ANY mechanism -- a direct
// Edit/Write/MultiEdit, or a shell command (update-config.ps1 with any -Op, Set-Content, Move-Item,
// redirection, etc.). It decides purely by ANCHORING ON THE PROTECTED DIRS: a candidate is a
// protected target only if it verifiably resolves to an EXISTING file under hooks\ or scripts\ with
// a .js/.ps1 extension. This makes both mis-parse and unknown-mechanism fail SAFE: a path that does
// not verifiably resolve under those dirs falls through to a normal prompt, never a silent approve.
// New-file CREATION (target does not exist yet) therefore falls through to a prompt too -- the
// /vet-code skill owns forcing the vet on new files (the hook can only gate modification).
//
// Composition with blockIfProtected: auto-approve.js and notion-ticket-lookup.ps1 are in BOTH
// PROTECTED_FILES and the protected-by-extension set. blockIfProtected already exit(2)s any direct
// edit-tool write to them (concurrency lock); that STAYS. So their only edit path is the shell
// update-config.ps1 call, which this guard gates. A change to auto-approve.js thus needs BOTH the
// update-config.ps1 path (concurrency) AND a vetting pass (vetting) -- no conflict, different props.
const VETTING_PASS_DIR = path.join(STAGING_DIR, 'vetting-passes');
const HOOKS_DIR = path.join(HOOK_DIR).replace(/\//g, '\\').toLowerCase();               // ~/.claude/hooks
const SCRIPTS_DIR = path.join(HOOK_DIR, '..', 'scripts').replace(/\//g, '\\').toLowerCase();
const UPDATE_CONFIG_RE = /update-config\.ps1/i;
// The GLOBAL settings.json (~/.claude/settings.json) is a hook-REGISTRATION surface: its `hooks`
// section wires script paths to events. A change to `hooks` changes what code runs, so it is vetting-
// gated -- but ONLY when the `hooks` section actually differs (a theme/model/env edit is NOT gated,
// to avoid alert-fatigue that would erode the gate). Scoped to the global file only; project-level
// <project>/.claude/settings.json is a separate, currently-open surface tracked as its own follow-up.
const GLOBAL_SETTINGS_KEY = path.join(HOOK_DIR, '..', 'settings.json').replace(/\//g, '\\').toLowerCase();

// Normalize a path to the lowercased backslash form used for all comparisons here.
function normPath(p, cwd) {
  try {
    const abs = path.isAbsolute(p) ? p : path.resolve(cwd || '', p);
    // path.resolve on a real fs also canonicalizes '..'; realpathSync would resolve symlinks but
    // may throw for a not-yet-existing file, so we resolve textually and existence-check separately.
    return abs.replace(/\//g, '\\').toLowerCase();
  } catch (e) {
    return String(p).replace(/\//g, '\\').toLowerCase();
  }
}

// True iff `key` (already normalized) is an EXISTING file directly under hooks\ or scripts\ with a
// .js/.ps1 extension. Existence is the anchor -- a mis-resolved path won't exist there, so it fails
// safe (returns false -> not treated as protected -> normal prompt), never a silent approve.
function isProtectedCodeTarget(key) {
  if (!key) return false;
  const inHooks = key.startsWith(HOOKS_DIR + '\\') && key.endsWith('.js');
  const inScripts = key.startsWith(SCRIPTS_DIR + '\\') && key.endsWith('.ps1');
  if (!inHooks && !inScripts) return false;
  // Must not be a nested subdir file masquerading (e.g. hooks\refs\x.js is refs, not a live hook).
  // Direct-child check: exactly one path segment after the dir.
  const baseDir = inHooks ? HOOKS_DIR : SCRIPTS_DIR;
  const rest = key.slice(baseDir.length + 1);
  if (rest.includes('\\')) return false; // nested -> not a live hook/script
  try { return fs.existsSync(key) && fs.statSync(key).isFile(); } catch (e) { return false; }
}

// Resolve update-config.ps1's -File value (short logical name OR literal path) to a normalized abs
// path, by reading the LIVE $ManagedFiles map from the script itself (one source of truth, cannot
// drift). The final protected-or-not decision is made by isProtectedCodeTarget's on-disk anchor, so
// even a wrong resolution here fails safe (won't exist under the protected dirs). Returns a
// normalized key, or null if it cannot be determined (-> caller falls through to prompt).
function resolveUpdateConfigFile(command) {
  // Extract -File <value>  (quoted or bare), the first occurrence.
  const m = command.match(/-File\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  if (!m) return null;
  const raw = (m[1] || m[2] || m[3] || '').trim();
  if (!raw) return null;
  if (path.isAbsolute(raw) || raw.includes('\\') || raw.includes('/')) return normPath(raw);
  // Short logical name: read $ManagedFiles from the live update-config.ps1 to map name -> path.
  // Candidate locations, first EXISTING wins. In production only the Drive path exists, so it is
  // used; a copy under ~/.claude/scripts (checked first) lets a self-consistent tree resolve locally.
  // The on-disk anchor (isProtectedCodeTarget) is the real safety net, so an unexpected/stale map
  // only ever fails safe (mis-resolved path won't exist under the protected dirs -> prompt). If no
  // candidate is found, return null -> caller falls through to a prompt.
  const scriptCandidates = [
    path.join(HOOK_DIR, '..', 'scripts', 'update-config.ps1'),
    'G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1',
  ];
  for (const sp of scriptCandidates) {
    let text;
    try { text = fs.readFileSync(sp, 'utf8'); } catch (e) { continue; }
    // Match lines like:  "auto-approve.js" = Join-Path $ClaudeBase "hooks\auto-approve.js"
    const re = new RegExp('"' + raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '"\\s*=\\s*Join-Path\\s+\\$(\\w+)\\s+"([^"]+)"', 'i');
    const mm = text.match(re);
    if (!mm) continue;
    const baseVar = mm[1], rel = mm[2];
    // Resolve the base var the same way the script does ($ClaudeBase = ~/.claude;
    // $MemoryBase = ~/.claude/projects/C--Users-Erez/memory). Any other base var -> null (prompt).
    // The on-disk anchor is the real safety net; this only needs to be right for the code targets.
    const claudeBase = path.join(HOOK_DIR, '..'); // ~/.claude
    const base = /^claudebase$/i.test(baseVar) ? claudeBase
      : /^memorybase$/i.test(baseVar) ? path.join(claudeBase, 'projects', 'C--Users-Erez', 'memory')
      : null;
    if (!base) return null;
    return normPath(path.join(base, rel));
  }
  return null;
}

// Extract a specific update-config.ps1 argument value (quoted or bare). Returns the string or null.
function ucArg(command, flag) {
  const re = new RegExp('-' + flag + '\\s+(?:"([^"]+)"|\'([^\']+)\'|(\\S+))', 'i');
  const m = command.match(re);
  if (!m) return null;
  return (m[1] || m[2] || m[3] || '').trim() || null;
}

// Stable-stringify a value so hooks-section comparison is order-insensitive for objects (JSON key
// order can differ) but preserves array order (hook execution order matters).
function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

// Decide whether an update-config.ps1 edit to the GLOBAL settings.json CHANGES the `hooks` section.
// Returns true (gate it), false (hooks unchanged -> don't gate), or null (can't tell -> caller
// treats as "gate it" conservatively for a settings.json write, since an unknowable hooks delta must
// not slip through). Only write-file (-ContentFile) and text-replace (-OldText/-NewText) can touch
// hooks; add-allow/remove-allow only touch permissions.allow and never reach here.
function settingsHooksChanged(command) {
  let cur;
  try { cur = JSON.parse(fs.readFileSync(GLOBAL_SETTINGS_KEY, 'utf8').replace(/^﻿/, '')); }
  catch (e) { return null; } // can't read current -> can't prove unchanged -> conservative
  const curHooks = stableStringify(cur.hooks);
  const op = (ucArg(command, 'Op') || '').toLowerCase();
  let next;
  if (op === 'write-file') {
    const cf = ucArg(command, 'ContentFile');
    if (!cf) return null;
    try { next = JSON.parse(fs.readFileSync(cf, 'utf8').replace(/^﻿/, '')); }
    catch (e) { return null; } // content not readable/parseable -> conservative
  } else if (op === 'text-replace') {
    // text-replace args (OldText/NewText) are arbitrary strings that, for a settings.json edit, are
    // JSON full of embedded quotes/braces and may be backtick- or quote-escaped in the shell command.
    // We CANNOT reliably reconstruct the post-replace content by parsing them out of the command
    // string (a truncated extraction would wrongly conclude "hooks unchanged" -- a false negative
    // that lets a hooks-wiping edit through). So we do NOT try: any text-replace to settings.json is
    // gated conservatively (return null -> caller gates). This is over-inclusive ONLY for the
    // unparseable op; write-file stays precise (theme-only edits are not gated). A text-replace that
    // genuinely doesn't touch hooks pays one vetting pass -- acceptable, and rare for settings.json.
    return null;
  } else {
    return false; // other ops (add-allow/remove-allow) structurally can't touch hooks
  }
  return stableStringify(next.hooks) !== curHooks;
}

// Collect the normalized protected-code target(s) a tool call would write to, or [] if none.
// Edit tools: their file_path(s). Shell tools: scan the command for known write mechanisms that
// land on a protected path. Anything unrecognized -> [] (caller falls through to prompt).
function vettingTargets(tool, ti, command, cwd) {
  const out = [];
  if (EDIT_TOOLS.has(tool) || tool === 'NotebookEdit') {
    for (const p of targetPaths(tool, ti)) {
      const k = normPath(p, cwd);
      if (isProtectedCodeTarget(k)) out.push(k);
    }
    return out;
  }
  if (SHELL_TOOLS.has(tool) && typeof command === 'string' && command) {
    // Case 1: an update-config.ps1 invocation. The WRITE TARGET is its -File arg (resolved). We do
    // NOT treat the script's OWN path (update-config.ps1, a .ps1 under scripts\) as a target -- it's
    // the tool being RUN, not written -- and the dest-pattern scan below deliberately can't match it
    // because it only matches destinations of write cmdlets/redirects, not a bare `& script.ps1`.
    // (No early return: a single non-chained segment could be `& update-config.ps1 -File <x> > hook.js`
    // where -File is unresolvable but the `>` redirect still writes a hook -- Case 2 must still run.)
    if (UPDATE_CONFIG_RE.test(command)) {
      const k = resolveUpdateConfigFile(command);
      if (k && isProtectedCodeTarget(k) && !out.includes(k)) out.push(k);
      // Global settings.json hook-REGISTRATION arm: if this update-config edit targets the global
      // settings.json AND changes (or might change) the `hooks` section, gate it. A theme/model/env
      // edit leaves hooks identical -> not gated (no alert-fatigue). Unknowable delta (null) -> gate
      // conservatively (an unprovable hooks change must not slip through). Target key = the settings
      // path itself (its own pass), distinct from code-file targets.
      if (k === GLOBAL_SETTINGS_KEY) {
        const changed = settingsHooksChanged(command);
        if (changed !== false && !out.includes(GLOBAL_SETTINGS_KEY)) out.push(GLOBAL_SETTINGS_KEY);
      }
    }
    // Case 2: direct write mechanisms whose DESTINATION is a protected path. Match only tokens in a
    // WRITE-DESTINATION POSITION for a recognized write mechanism -- NOT every token that names a
    // protected path (a position-agnostic scan wrongly hard-blocks read-only refs like
    // `Copy-Item hook.js backup` or `node hook.js`, and cannot be made exhaustive anyway). The
    // design's fail-safe stance means anything we DON'T confidently identify as a write falls through
    // to a normal prompt -- never a silent approve, and never a spurious hard block. Recognized
    // write-destination patterns (PowerShell + POSIX), each capturing the destination path token:
    // NOTE (GEN-488): three of these patterns (redirect, PS content-writers, .NET
    // writers -- NOT move/copy) are duplicated VERBATIM in redirectNudgeContext --
    // BY DESIGN, not for refactoring into a shared helper: this vetting gate is a
    // security mechanism and must stay independent of that advisory feature. A change
    // here does not propagate there (and must not); the nudge's -o/--output pattern
    // is nudge-only and must NOT be added here.
    const destPatterns = [
      /(?:^|[\s;&|(])>>?\s*("([^"]+)"|'([^']+)'|([^\s;&|)]+))/g,                 // > file / >> file (redirect)
      /\b(?:Set-Content|Add-Content|Out-File|Tee-Object)\b[^\n]*?(?:-(?:Path|FilePath|LiteralPath)\s+)?("([^"]+)"|'([^']+)'|([^\s;&|)]+))/gi, // PS content-writers
      /\b(?:Move-Item|Copy-Item|mv|cp|rename|Rename-Item)\b[^\n]*?("([^"]+)"|'([^']+)'|([^\s;&|)]+))\s*$/gi, // move/copy DEST (last token of segment)
      /\[IO\.File\]::(?:WriteAllText|WriteAllLines|WriteAllBytes|AppendAllText)\(\s*("([^"]+)"|'([^']+)')/gi, // .NET writers
    ];
    for (const re of destPatterns) {
      let t;
      while ((t = re.exec(command)) !== null) {
        // The destination is whichever capture group holds the path (quoted groups or bare group).
        const tok = (t[2] || t[3] || t[4] || t[1] || '');
        if (!tok) continue;
        const k = normPath(tok, cwd);
        if (isProtectedCodeTarget(k) && !out.includes(k)) out.push(k);
      }
    }
    // NOTE: this recognizes the common write shapes; an unrecognized write mechanism (obscure cmdlet,
    // dynamic path via a variable) is NOT hard-blocked here -- it falls through to a normal permission
    // prompt (a human sees it), consistent with the fail-safe stance. The HARD guarantee stays: the
    // sanctioned update-config.ps1 path and the edit tools cannot write a protected file without a
    // pass; other shell shapes are no worse than today (a prompt).
  }
  return out;
}

function blockVetting(reason) {
  process.stderr.write(
    'Refused (vetting lock): ' + reason + ' This is a change to a live hook/script and must go through ' +
    'the /vet-code flow: /check the design, /code-review the diff, live-verify, then mint a one-time ' +
    'vetting pass (which prompts Erez). Use the /vet-code skill instead of editing the live file directly.\n'
  );
  process.exit(2);
}

// Vetting guard. For any tool call that would write to a protected hook/script path, require a valid
// single-use vetting pass (target-bound). Hard-block (exit 2) on miss; consume + approve on match;
// fall through (return) when no protected target is involved. Honors break-glass. CHAINED shell
// commands cannot consume a pass (smuggle-hole fix); AMBIGUOUS/error -> return (prompt).
function enforceVetting(tool, ti, command, cwd) {
  if (configUnlocked()) return;              // break-glass: skip vetting gate entirely
  let targets;
  try {
    targets = vettingTargets(tool, ti, command, cwd);
  } catch (e) {
    return; // any internal error -> fall through to normal handling (prompt)
  }
  if (!targets || targets.length === 0) return; // no protected target -> not our concern

  // Shell smuggle-hole guard: a CHAINED command must not consume a pass (the chained tail would ride
  // through sight-unseen). CHAINED -> hard-block; AMBIGUOUS/multiline/error -> return (prompt).
  if (SHELL_TOOLS.has(tool)) {
    let verdict;
    try {
      verdict = /[\r\n]/.test(String(command)) ? 'AMBIGUOUS' : scanChain(command, tool).verdict;
    } catch (e) { verdict = 'AMBIGUOUS'; }
    if (verdict === 'CHAINED') {
      process.stderr.write(
        'Refused: a command that chains other commands (; && ||) onto a hook/script write cannot ' +
        'consume a vetting pass -- the chained part would be approved sight-unseen. Issue the write ' +
        'as its own single tool call.\n'
      );
      process.exit(2);
    }
    if (verdict !== 'NO-CHAIN') return; // AMBIGUOUS -> prompt
  }

  // Resolve a DISTINCT matching, unexpired pass file for EVERY protected target BEFORE consuming any
  // -- so a multi-target call either fully passes or fully blocks, never half-consuming a pass on a
  // call that will then block on a later target. (A single pass file can't cover two targets: each
  // resolved file is recorded and excluded from the next lookup.) Then consume all. The only residual
  // race is cross-process (two hook invocations both find the same file before either renames it);
  // that is acceptable -- two concurrent writes to the SAME protected file is not a real workflow and
  // the worst case is a duplicate approve, not a silent bypass of an UNvetted change.
  const files = [];
  for (const target of targets) {
    const file = findVettingPassFile(
      p => p.kind === 'vetting' && String(p.target || '').replace(/\//g, '\\').toLowerCase() === target,
      files // exclude already-claimed pass files so two targets can't share one pass
    );
    if (!file) blockVetting('No vetting pass for ' + target + '.');
    files.push(file);
  }
  for (const file of files) consumePassFile(file);
  return approve('Auto-approved: vetting pass consumed (' + targets.join(', ') + ').');
}

// Like findPassFile but reads the vetting-passes dir. Separate dir keeps vetting + staging passes
// from cross-matching. Same unexpired-and-matchFn semantics. `exclude` is an optional array of full
// pass-file paths to skip (so a multi-target call can't match one pass file for two targets).
function findVettingPassFile(matchFn, exclude) {
  let files;
  try { files = fs.readdirSync(VETTING_PASS_DIR); } catch (e) { return null; }
  const now = Date.now();
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(VETTING_PASS_DIR, f);
    if (exclude && exclude.includes(full)) continue;
    let pass;
    try { pass = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^﻿/, '')); } catch (e) { continue; }
    const exp = Date.parse(pass.expires || '');
    if (!exp || exp < now) continue;
    if (matchFn(pass)) return full;
  }
  return null;
}

// ---- GEN-485: check-before-present lock for rule/skill/CLAUDE.md edits -------
// A rule/skill/CLAUDE.md edit that is DUE a /check panel must not be presented or applied for
// approval without the panel having run on the exact text. A standing rule already required this and
// was skipped under task momentum (the incident this closes). So this REUSES the vetting-lock pattern
// above (target-anchored PreToolUse guard + single-use, target-bound pass minted only after review,
// via a Write to a dir OUTSIDE ~/.claude so the mint prompts Erez) for a SECOND class of protected
// target, with a LIGHTER evidence bar: one converged /check (minted by the /vet-rule skill), not
// /vet-code's code-review*2 + live-verify gauntlet. Distinct pass type ("check", not "vetting") and a
// distinct dir so the two never cross-match.
//
// Fail-safe stance is identical to enforceVetting: a candidate is a check-due target ONLY if it
// verifiably resolves to an EXISTING protected rule/skill/command/CLAUDE.md file. A path that does not
// so resolve falls through to a normal prompt, never a silent approve. New-file CREATION therefore
// falls through to a prompt too -- the /vet-rule skill owns forcing the review on new files (the hook
// can only gate MODIFICATION of an existing file). configUnlocked() break-glass is honored (shared,
// pre-existing accepted residual -- same as enforceVetting).
//
// Scope of THIS build (GEN-485 Option A): global CLAUDE.md, ~/.claude/skills/**, ~/.claude/commands/**.
// Per-project <root>/**/CLAUDE.md is a tracked follow-up (GEN-490), not covered here.
const CHECK_PASS_DIR = path.join(STAGING_DIR, 'check-passes');
const SKILLS_DIR = path.join(HOOK_DIR, '..', 'skills').replace(/\//g, '\\').toLowerCase();      // ~/.claude/skills
const COMMANDS_DIR = path.join(HOOK_DIR, '..', 'commands').replace(/\//g, '\\').toLowerCase();   // ~/.claude/commands
const GLOBAL_CLAUDE_MD = path.join(HOOK_DIR, '..', 'CLAUDE.md').replace(/\//g, '\\').toLowerCase(); // ~/.claude/CLAUDE.md
// update-global-rule.ps1 is a thin wrapper that calls update-config.ps1 -File "CLAUDE.md" (verified
// 2026-07-20), so a command that invokes it targets the global CLAUDE.md unconditionally -- and it
// carries NO -File arg, so resolveUpdateConfigFile cannot see it. We match it by name and treat the
// target as the global CLAUDE.md directly (spec #4: gate at the SCRIPT path, not just direct edits).
const UPDATE_GLOBAL_RULE_RE = /update-global-rule\.ps1/i;

// True iff `key` (already normalized) is an EXISTING check-due protected file:
//   - global CLAUDE.md (~/.claude/CLAUDE.md), OR
//   - a skill file under ~/.claude/skills/<name>/... ending in .md  (skills are NESTED -- spec #5:
//     skills live at skills/<name>/SKILL.md, so we must NOT require a direct child; we require at
//     least one path segment between skills\ and the file), OR
//   - a command file directly under ~/.claude/commands/ ending in .md (commands are FLAT -- spec #5).
// Existence is the anchor: a mis-resolved path won't exist -> returns false -> normal prompt, never a
// silent approve. NOT covered: per-project CLAUDE.md (GEN-490).
function isCheckDueTarget(key) {
  if (!key) return false;
  let matchesShape = false;
  if (key === GLOBAL_CLAUDE_MD) {
    matchesShape = true;
  } else if (key.startsWith(SKILLS_DIR + '\\') && key.endsWith('.md')) {
    // Skills are nested: require a subdir between skills\ and the file (skills\<name>\file.md).
    // A file sitting directly in skills\ (skills\x.md) is not a real skill and is NOT gated here.
    const rest = key.slice(SKILLS_DIR.length + 1);
    if (rest.includes('\\')) matchesShape = true;
  } else if (key.startsWith(COMMANDS_DIR + '\\') && key.endsWith('.md')) {
    // Commands are flat: exactly one segment after commands\ (commands\name.md).
    const rest = key.slice(COMMANDS_DIR.length + 1);
    if (!rest.includes('\\')) matchesShape = true;
  }
  if (!matchesShape) return false;
  try { return fs.existsSync(key) && fs.statSync(key).isFile(); } catch (e) { return false; }
}

// Machine-checked mechanical-fix lane (spec #3). The resident rule exempts a "purely mechanical fix
// (spelling/punctuation/whitespace/formatting)" from needing /check. This MUST be verified from the
// actual before/after text, NEVER a self-declared label (a self-declared "mechanical" label is the
// single most likely bypass).
//
// DELIBERATELY NARROW (hardened by the /vet-code code-review panel): "mechanical" here means ONLY a
// change to HORIZONTAL-WHITESPACE runs -- the two strings must be IDENTICAL after every run of spaces
// and tabs is collapsed to a single space and leading/trailing horizontal whitespace on each line is
// trimmed. NOTHING else qualifies. An earlier design compared "word-token sequences" and ignored all
// non-word characters; the panel showed that fails OPEN, because a rules file encodes meaning in
// punctuation and structure (comparison operators >=/<=, markdown headings/list markers/code fences,
// [[link]] brackets, : vs ;, em-dash vs hyphen). Any change to ANY of those is now non-mechanical and
// takes the full check-record path. This lane exists only to wave through a genuine reflow/indent/
// trailing-space tidy; anything a human might read differently is NOT mechanical. Fails SAFE: a
// non-string input, or any residual difference after whitespace collapse, returns false.
//
// Newlines are NOT collapsed: adding/removing a line break can join or split rules, which changes
// meaning, so a change in line structure is non-mechanical. Only within-line horizontal runs collapse.
//
// TWO EXCLUSIONS close a residual the code-review panel surfaced (whitespace that is itself meaning-
// bearing): (1) if EITHER side contains a TAB, bail to non-mechanical -- tab-vs-space and tab width
// are significant in tab-sensitive embedded content (Makefiles, YAML, here-docs) a skill file may
// quote. (2) if EITHER side contains a fenced-code-block marker (```), bail -- indentation/spacing
// INSIDE a fence can be semantically significant (embedded YAML/Python/JSON), and collapsing it would
// wave a meaning change through. Both are the SAFE direction (shrink the exempt set); a genuine
// space-only reflow/reindent of ordinary prose still qualifies, which is all this lane is for.
function isMechanicalFix(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string') return false;
  if (before === after) return false; // no change at all is not this lane's concern (handled elsewhere)
  if (before.indexOf('\t') !== -1 || after.indexOf('\t') !== -1) return false;   // tab-significant content
  if (before.indexOf('```') !== -1 || after.indexOf('```') !== -1) return false; // fenced-block content
  // Normalize ONLY horizontal spaces: collapse runs of ' ' to one, trim each line's ends, keep
  // newlines (\n) intact so line structure still counts as meaningful. CRLF is normalized to LF first
  // so a pure line-ending change also reads as mechanical (harmless) but a real newline add/remove does not.
  const norm = s => s.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/ +/g, ' ').replace(/^ | $/g, '')).join('\n');
  return norm(before) === norm(after);
}

// Collect the normalized check-due target(s) a tool call would write to, plus whether each is a
// verified mechanical-only edit (which does NOT require a pass). Returns an array of
// {target, mechanical}. Only Edit/Write/MultiEdit can be mechanical (structured before/after text);
// every shell-reached target is non-mechanical. Shell tools are still scanned for the target itself:
// the update-config.ps1 / update-global-rule.ps1 script paths (spec #4) and direct write mechanisms.
// Anything unrecognized -> [] (caller falls through to prompt). Mirrors vettingTargets' structure.
function checkDueTargets(tool, ti, command, cwd) {
  const out = [];
  const push = (key, mechanical) => {
    if (key && isCheckDueTarget(key) && !out.some(o => o.target === key)) out.push({ target: key, mechanical: !!mechanical });
  };
  if (EDIT_TOOLS.has(tool) || tool === 'NotebookEdit') {
    // For a single-target Edit we can machine-check the mechanical lane from old_string/new_string.
    // For Write (whole-file overwrite) we compare the new content against the on-disk file. MultiEdit
    // and multi-path writes: if ANY sub-edit is non-mechanical the whole call is non-mechanical.
    for (const p of targetPaths(tool, ti)) {
      const key = normPath(p, cwd);
      if (!isCheckDueTarget(key)) continue;
      let mechanical = false;
      try {
        if (tool === 'Edit' && ti && typeof ti.old_string === 'string' && typeof ti.new_string === 'string') {
          mechanical = isMechanicalFix(ti.old_string, ti.new_string);
        } else if (tool === 'Write' && ti && typeof ti.content === 'string') {
          const cur = fs.readFileSync(key, 'utf8').replace(/^﻿/, '');
          mechanical = isMechanicalFix(cur, ti.content.replace(/^﻿/, ''));
        } else if (tool === 'MultiEdit' && ti && Array.isArray(ti.edits)) {
          // Every sub-edit targeting THIS file must be mechanical for the call to be mechanical.
          const subs = ti.edits.filter(e => e && normPath(e.file_path || ti.file_path || '', cwd) === key);
          mechanical = subs.length > 0 && subs.every(e =>
            typeof e.old_string === 'string' && typeof e.new_string === 'string' && isMechanicalFix(e.old_string, e.new_string));
        }
      } catch (e) { mechanical = false; } // can't determine -> not mechanical -> requires a pass
      push(key, mechanical);
    }
    return out;
  }
  if (SHELL_TOOLS.has(tool) && typeof command === 'string' && command) {
    // SHELL WRITES ARE NEVER MECHANICAL (hardened by the code-review panel). A shell command's
    // -OldText/-NewText (or file content) cannot be reliably reconstructed from the command string --
    // PS quoting, backticks, here-strings, and embedded quotes truncate or mangle any extraction (the
    // existing settingsHooksChanged, ~line 804, refuses to parse text-replace args for exactly this
    // reason and gates conservatively). A *successful but wrong* extraction fed to isMechanicalFix
    // could compare equal and fail OPEN. So every check-due target reached via a shell command is
    // pushed as non-mechanical (requires a pass). The mechanical lane is reserved for the Edit/Write/
    // MultiEdit tools above, where before/after text is a structured payload field, not shell-parsed.
    //
    // Case 1: update-global-rule.ps1 -- thin wrapper for the global CLAUDE.md text-replace (no -File
    // arg, so resolveUpdateConfigFile can't see it; match by name and target the global CLAUDE.md).
    if (UPDATE_GLOBAL_RULE_RE.test(command)) {
      push(GLOBAL_CLAUDE_MD, false);
    }
    // Case 2: update-config.ps1 invocation -- resolve its -File to a target (catches -File "CLAUDE.md"
    // -> global CLAUDE.md, and any future check-due managed name).
    if (UPDATE_CONFIG_RE.test(command)) {
      const k = resolveUpdateConfigFile(command);
      if (k && isCheckDueTarget(k)) push(k, false);
    }
    // Case 3: direct write mechanisms whose DESTINATION is a check-due path (Set-Content, redirect,
    // Move/Copy dest, .NET writers) -- same destination-position patterns enforceVetting uses. Reuses
    // the same fail-safe stance: an unrecognized write shape is not matched here and falls through to a
    // normal prompt.
    const destPatterns = [
      /(?:^|[\s;&|(])>>?\s*("([^"]+)"|'([^']+)'|([^\s;&|)]+))/g,
      /\b(?:Set-Content|Add-Content|Out-File|Tee-Object)\b[^\n]*?(?:-(?:Path|FilePath|LiteralPath)\s+)?("([^"]+)"|'([^']+)'|([^\s;&|)]+))/gi,
      /\b(?:Move-Item|Copy-Item|mv|cp|rename|Rename-Item)\b[^\n]*?("([^"]+)"|'([^']+)'|([^\s;&|)]+))\s*$/gi,
      /\[IO\.File\]::(?:WriteAllText|WriteAllLines|WriteAllBytes|AppendAllText)\(\s*("([^"]+)"|'([^']+)')/gi,
    ];
    for (const re of destPatterns) {
      let t;
      while ((t = re.exec(command)) !== null) {
        const tok = (t[2] || t[3] || t[4] || t[1] || '');
        if (!tok) continue;
        push(normPath(tok, cwd), false);
      }
    }
  }
  return out;
}

function blockCheckDue(reason) {
  process.stderr.write(
    'Refused (check-before-present lock): ' + reason + ' This is a rule/skill/CLAUDE.md edit that is ' +
    'DUE a /check panel. It must go through the /vet-rule flow: run /check on the exact proposed text ' +
    'to convergence, then mint a one-time check pass (which prompts Erez and shows him the verdict). ' +
    'Use the /vet-rule skill instead of editing the file directly. (A purely mechanical fix -- ' +
    'horizontal-whitespace/indentation only, via the Edit tool -- is exempt and would not be blocked.)\n'
  );
  process.exit(2);
}

// Check-before-present guard. For any tool call that would write to a check-due target, require a
// valid single-use check pass (target-bound) UNLESS the edit is a verified mechanical-only fix. Hard-
// block (exit 2) on miss; consume + approve on match; fall through (return) when no check-due target
// is involved. Honors break-glass. CHAINED shell commands cannot consume a pass (smuggle-hole fix);
// AMBIGUOUS/error -> return (prompt). Mirrors enforceVetting exactly, with the mechanical-lane carve-out.
function enforceCheckDue(tool, ti, command, cwd) {
  if (configUnlocked()) return;              // break-glass: skip the gate entirely
  let targets;
  try {
    targets = checkDueTargets(tool, ti, command, cwd);
  } catch (e) {
    return; // any internal error -> fall through to normal handling (prompt)
  }
  if (!targets || targets.length === 0) return; // no check-due target -> not our concern

  // Shell smuggle-hole guard runs FIRST -- BEFORE the mechanical-approve below -- so a CHAINED command
  // can never be waved through on the mechanical lane (a "mechanical" head with a smuggled `&& <tail>`
  // would otherwise ride through sight-unseen; that exact ordering hole was caught by the code-review
  // panel). CHAINED -> hard-block; AMBIGUOUS/multiline/error -> return (prompt). (Shell writes are also
  // never classified mechanical now, but this ordering is the structural guarantee, not that fact.)
  if (SHELL_TOOLS.has(tool)) {
    let verdict;
    try {
      verdict = /[\r\n]/.test(String(command)) ? 'AMBIGUOUS' : scanChain(command, tool).verdict;
    } catch (e) { verdict = 'AMBIGUOUS'; }
    if (verdict === 'CHAINED') {
      process.stderr.write(
        'Refused: a command that chains other commands (; && ||) onto a rule/skill/CLAUDE.md write ' +
        'cannot consume a check pass -- the chained part would be approved sight-unseen. Issue the ' +
        'write as its own single tool call.\n'
      );
      process.exit(2);
    }
    if (verdict !== 'NO-CHAIN') return; // AMBIGUOUS -> prompt
  }

  // A verified mechanical-only edit needs no pass. But if the call touches EVEN ONE non-mechanical
  // check-due target, it must be gated (a mixed call cannot be waved through on the mechanical lane).
  const nonMechanical = targets.filter(o => !o.mechanical);
  if (nonMechanical.length === 0) {
    return approve('Auto-approved: mechanical-only rule/skill/CLAUDE.md fix (horizontal-whitespace only, no other change).');
  }

  // Resolve a DISTINCT matching, unexpired check pass for EVERY non-mechanical target BEFORE consuming
  // any -- so a multi-target call either fully passes or fully blocks. Then consume all. (Same
  // all-or-nothing + cross-process-race stance as enforceVetting.)
  const files = [];
  for (const o of nonMechanical) {
    const file = findCheckPassFile(
      p => p.kind === 'check' && String(p.target || '').replace(/\//g, '\\').toLowerCase() === o.target,
      files // exclude already-claimed pass files so two targets can't share one pass
    );
    if (!file) blockCheckDue('No check pass for ' + o.target + '.');
    files.push(file);
  }
  for (const file of files) consumePassFile(file);
  return approve('Auto-approved: check pass consumed (' + nonMechanical.map(o => o.target).join(', ') + ').');
}

// Like findVettingPassFile but reads the check-passes dir. Separate dir keeps check + vetting + staging
// passes from cross-matching. Same unexpired-and-matchFn semantics. `exclude` is an optional array of
// full pass-file paths to skip (so a multi-target call can't match one pass file for two targets).
function findCheckPassFile(matchFn, exclude) {
  let files;
  try { files = fs.readdirSync(CHECK_PASS_DIR); } catch (e) { return null; }
  const now = Date.now();
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(CHECK_PASS_DIR, f);
    if (exclude && exclude.includes(full)) continue;
    let pass;
    try { pass = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^﻿/, '')); } catch (e) { continue; }
    const exp = Date.parse(pass.expires || '');
    if (!exp || exp < now) continue;
    if (matchFn(pass)) return full;
  }
  return null;
}

// ---- GEN-488: advisory redirect-target nudge (prevention, NOT a safety mechanism) ----
// Fires a one-line additionalContext warning when a shell command's redirect target
// LITERALLY resolves to a junk-prone directory (GEN-373 evidence: top-level strays):
// directly in the home dir, directly in a PROJECT_ROOTS entry, or directly in an
// individual project folder (a direct child of the 'ai projects' container entry).
// It rides on the SHELL_TOOLS defer (see defer()) and can never change an
// approve/defer/block decision. Best-effort literal parse only -- accepted misses
// (variable-built paths, here-strings/multi-line, no-space redirects like `echo hi>f`,
// piped Export-*, move/copy destinations, staging/vetting pass-consumption approves)
// are design-approved.
// Fail-open is absolute: ANY uncertainty or internal error returns null (no warning).

// Quoted-span scanner for the nudge. Returns an array of [start, end) index spans of
// quoted regions, or null when quoting is unbalanced/uncertain (caller then skips the
// nudge entirely -- fail open). A simplified SIBLING of scanChain's quote state
// machine, deliberately NOT a modification or reuse of scanChain (that function is
// security-critical -- mixed-chain block + staging/vetting smuggle-hole guards -- and
// only exposes unquoted text for CHAINED verdicts; blanking-based reuse would also
// blank quoted PATHS like "> \"C:\\Users\\Erez\\out file.txt\"", which the nudge must
// still see). Wrong-span error modes here can only suppress or skip a warning, never
// alter a decision.
function quotedSpansForNudge(s, tool) {
  const isPS = (tool === 'PowerShell');
  const spans = [];
  let state = 'none'; // none | sq | dq
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const d = (i + 1 < s.length) ? s[i + 1] : '';
    if (state === 'sq') {
      if (c === "'") {
        if (isPS && d === "'") { i++; continue; } // PS: doubled '' = literal quote
        spans.push([start, i + 1]); state = 'none';
      }
      continue;
    }
    if (state === 'dq') {
      if (!isPS && c === '\\') { i++; continue; }              // bash: \ escapes next
      if (isPS && c === '`') { i++; continue; }                // PS: ` escapes next
      if (isPS && c === '"' && d === '"') { i++; continue; }   // PS: doubled "" = literal
      if (c === '"') { spans.push([start, i + 1]); state = 'none'; }
      continue;
    }
    // state === 'none'
    if (!isPS && c === '\\') { i++; continue; }  // bash: escaped char outside quotes
    if (isPS && c === '`') { i++; continue; }    // PS: escaped char outside quotes
    if (c === "'") { state = 'sq'; start = i; continue; }
    if (c === '"') { state = 'dq'; start = i; continue; }
  }
  return state === 'none' ? spans : null; // unbalanced quote -> uncertain -> null
}

// Best-effort absolute path of the CURRENT session's scratchpad, derived at fire time
// (never hardcoded/stale): <tmp>\claude\<slug>\<session_id>\scratchpad, where slug is
// the project dir with every non-alphanumeric char replaced by '-'. Named in the
// warning only if it actually exists on disk; otherwise a generic phrase -- a wrong
// path would misdirect, a generic one cannot.
function scratchpadHintForNudge(input) {
  try {
    const base = process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || '';
    const sid = (input && typeof input.session_id === 'string') ? input.session_id : '';
    if (base && sid) {
      const slug = String(base).replace(/[^A-Za-z0-9]/g, '-');
      const cand = path.join(os.tmpdir(), 'claude', slug, sid, 'scratchpad');
      if (fs.existsSync(cand)) return cand;
    }
  } catch (e) {
    // fall through to the generic phrase
  }
  return 'the session scratchpad directory';
}

// Classify a resolved parent dir (lowercased backslash form) as a junk-prone location
// phrase, or null. Parent-dir-EXACT matching, deliberately NOT subtree: a subtree match
// would warn on every legitimate deep write (AppData, .claude, project subfolders) and
// erode trust in the nudge. PROJECT_ROOTS semantics differ per entry: 'ai projects\' is
// a CONTAINER of project folders (so a stray lands depth-1 under it), while
// 'memorypirates\' IS a repo root itself -- the direct-child clause applies only to the
// container entry. If the container entry is ever renamed/removed, containerRoot is
// null and that clause silently no-ops (fail open).
function classifyNudgeParent(parent, home) {
  if (parent === home) return 'the home directory';
  const containerRoot = PROJECT_ROOTS.find(r => r.indexOf('\\ai projects\\') !== -1) || null;
  for (const root of PROJECT_ROOTS) {
    if (parent + '\\' === root) {
      return root === containerRoot ? 'the AI Projects folder' : 'a project root';
    }
  }
  if (containerRoot && parent.indexOf(containerRoot) === 0 &&
      parent.slice(containerRoot.length).indexOf('\\') === -1) {
    return 'a project root'; // direct child of the container = an individual project folder
  }
  return null;
}

// The nudge itself. Returns the one-line advisory string, or null (= say nothing).
// Called ONLY on the SHELL_TOOLS defer path in main(), after every guard and approve
// carve-out has already had its say -- it decorates a defer that is already happening.
function redirectNudgeContext(input, tool, cmd) {
  try {
    if (typeof cmd !== 'string' || cmd === '') return null;
    // Single-line only: heredoc/here-string bodies carry arbitrary prose in which '>'
    // shapes are common (commit messages etc.) -- unparseable, so say nothing.
    if (/[\r\n]/.test(cmd)) return null;
    const spans = quotedSpansForNudge(cmd, tool);
    if (spans === null) return null; // unbalanced/uncertain quoting -> no nudge
    // Spans ascend, so stop scanning once a span starts past idx.
    const insideSpan = idx => {
      for (const sp of spans) {
        if (sp[0] > idx) return false;
        if (idx < sp[1]) return true;
      }
      return false;
    };
    // Destination patterns: the first three are duplicated VERBATIM from vettingTargets'
    // destPatterns -- duplicated BY DESIGN, do not refactor into a shared helper: the
    // vetting gate is a security mechanism and must stay independent of this advisory
    // feature (see the matching comment in vettingTargets). vettingTargets' move/copy
    // pattern is deliberately NOT used here: the ticket's scope is output REDIRECTION
    // (> >> -o Out-File), and mv/cp destinations are routinely directories
    // ("Copy-Item x C:\Users\Erez\Downloads"), which this file-target geometry would
    // misread as home-dir strays -- a recurring FALSE warning, the one failure mode an
    // advisory nudge must not have. The last (-o/--output) pattern is nudge-only and
    // must NOT be added to the vetting gate.
    const destPatterns = [
      /(?:^|[\s;&|(])>>?\s*("([^"]+)"|'([^']+)'|([^\s;&|)]+))/g,                 // > file / >> file (redirect)
      /\b(?:Set-Content|Add-Content|Out-File|Tee-Object)\b[^\n]*?(?:-(?:Path|FilePath|LiteralPath)\s+)?("([^"]+)"|'([^']+)'|([^\s;&|)]+))/gi, // PS content-writers
      /\[IO\.File\]::(?:WriteAllText|WriteAllLines|WriteAllBytes|AppendAllText)\(\s*("([^"]+)"|'([^']+)')/gi, // .NET writers
      /(?:^|\s)(?:-o|--output)\s+("([^"]+)"|'([^']+)'|([^\s;&|)]+))/g,           // curl/wget-style -o (nudge-only)
    ];
    const OUTPUT_FLAG_PATTERN = 3; // index of the -o/--output pattern (see its guard below)
    const home = normPath(path.join(HOOK_DIR, '..', '..')); // c:\users\erez
    const cwd = (input && typeof input.cwd === 'string' && input.cwd) ? input.cwd : null;
    for (let pi = 0; pi < destPatterns.length; pi++) {
      const re = destPatterns[pi];
      let t;
      while ((t = re.exec(cmd)) !== null) {
        // Reject a match that starts inside a quoted span: a '>' (or cmdlet name)
        // inside a quoted string is prose, not a redirect ("fix a > b", jq '.x > 5').
        // For the redirect pattern a span boundary cannot sit between the match start
        // and the '>' (the char immediately before '>' must be an unquoted boundary
        // char, and a span's last char is always a quote), so match-start is a safe
        // proxy for the operator position.
        if (insideSpan(t.index)) continue;
        const wasQuoted = !!(t[2] || t[3]);
        let tok = (t[2] || t[3] || t[4] || t[1] || '');
        if (!tok) continue;
        tok = tok.toLowerCase();
        // Skip tokens that cannot be literal paths: variables/expansions, flags
        // mis-captured by the lazy cmdlet pattern, null sinks, fd dups.
        if (tok.indexOf('$') !== -1 || tok.indexOf('%') !== -1) continue;
        if (tok.charAt(0) === '-') continue;
        if (tok === 'nul' || /^\/dev\//.test(tok)) continue;
        if (/^&\d/.test(tok)) continue;
        // -o/--output is also a generic option flag ("set -o pipefail",
        // "ssh -o Option=val"); require a path-shaped operand (separator or dot)
        // before treating it as an output file.
        if (pi === OUTPUT_FLAG_PATTERN && !/[\\/.]/.test(tok)) continue;
        if (tok.charAt(0) === '~') {
          // Expand only a BARE ~/x or ~\x (the Bash tool's home shorthand). A QUOTED
          // tilde is literal in bash (no expansion happens), and ~user/... or bare ~
          // are not literal-path shapes we can resolve -- skip those.
          if (wasQuoted || (tok.indexOf('~/') !== 0 && tok.indexOf('~\\') !== 0)) continue;
          tok = home + '\\' + tok.slice(2);
        }
        // Without a known shell cwd a RELATIVE token would resolve against the hook
        // process's own cwd -- a path the command will not write. Absolute-only then.
        if (!cwd && !path.isAbsolute(tok)) continue;
        const key = normForMatch(tok, cwd);
        const where = classifyNudgeParent(path.dirname(key), home);
        if (where) {
          return 'Redirect nudge (advisory only -- this call is NOT blocked): its output target "' +
            key + '" lands directly in ' + where + ', where stray output files become junk ' +
            '(GEN-373). For temporary output, prefer the session scratchpad: ' +
            scratchpadHintForNudge(input) + '.';
        }
      }
    }
    return null;
  } catch (e) {
    return null; // advisory only -- any uncertainty means no warning, never a break
  }
}

// ---- main ------------------------------------------------------------------

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    return defer();
  }

  const tool = input.tool_name;
  if (!tool) return defer();

  // GEN-103: enforce the locked-edit path for protected config files.
  // Runs first; exits 2 to override any matching allow-list entry.
  blockIfProtected(tool, input.tool_input, input.cwd);

  // GEN-281: staging lock for non-sandbox Jira/Confluence content edits (front + side door).
  // Runs before the allow-list so an allow entry cannot bypass it; consumes a one-time
  // pass on match (approve), hard-blocks (exit 2) on miss, falls through otherwise.
  enforceStaging(tool, input.tool_input, input.tool_input && input.tool_input.command);

  // GEN-376: vetting lock for live hook/script code changes. Runs before the allow-list so an
  // allow entry cannot bypass it; consumes a one-time vetting pass on match (approve), hard-blocks
  // (exit 2) on miss, falls through otherwise. Target-anchored on the protected dirs (fail-safe).
  enforceVetting(tool, input.tool_input, input.tool_input && input.tool_input.command, input.cwd);

  // GEN-485: check-before-present lock for rule/skill/CLAUDE.md edits. Runs before the allow-list so
  // an allow entry cannot bypass it; a verified mechanical-only fix is approved, a non-mechanical edit
  // consumes a one-time check pass on match (approve) or hard-blocks (exit 2) on miss, and anything
  // with no check-due target falls through. Target-anchored (fail-safe), same as enforceVetting.
  enforceCheckDue(tool, input.tool_input, input.tool_input && input.tool_input.command, input.cwd);

  // Already allow-listed by settings (bare names) => no action, no log.
  if (bareAllowList().has(tool)) return defer();

  // Read-only tools.
  if (SAFE_TOOLS.has(tool)) return approve('Auto-approved: read-only tool');

  // Shell tools: approve only if every chained segment is read-only.
  if (SHELL_TOOLS.has(tool)) {
    const cmd = input.tool_input && input.tool_input.command;
    if (isSafeSyncFromClaude(cmd)) return approve('Auto-approved: config-sync (From-Claude)');
    if (isSafeNotionTicketLookup(cmd)) return approve('Auto-approved: notion-ticket-lookup.ps1 (GEN-316)');
    if (isSafeLoggateTouch(cmd)) return approve('Auto-approved: compact-gate marker (GEN-348)');
    if (shellCommandIsSafe(cmd)) return approve('Auto-approved: read-only shell command(s)');
    // GEN-337(e): hard-block a mixed-risk chain (exits 2) or fall through to the prompt.
    blockMixedChain(input, tool, cmd);
    // GEN-488: advisory redirect-target nudge rides on this defer. It runs strictly
    // AFTER every guard and approve carve-out, so it can never alter a decision;
    // belt-and-suspenders try/catch at the call site on top of the function's own.
    let nudge = null;
    try { nudge = redirectNudgeContext(input, tool, cmd); } catch (e) { nudge = null; }
    logDeferred(input);
    return defer(nudge);
  }

  // GEN-223: auto-approve /check's read-only reviewer sub-agents (no prompt, no log noise).
  // Robust to the PreToolUse field name (subagent_type / agent_type) for the agent type.
  if (tool === 'Agent') {
    const ti = input.tool_input || {};
    const at = ti.subagent_type || ti.agent_type || ti.subagentType;
    if (at === 'check-reviewer') return approve('Auto-approved: /check read-only reviewer');
  }

  // Auto-approve project-folder file edits; log each silently-approved change
  // to the durable per-session record for the end-of-turn report.
  if (EDIT_TOOLS.has(tool)) {
    const paths = targetPaths(tool, input.tool_input);
    if (paths.length > 0 && paths.every(p => isAutoApprovableEdit(p, input.cwd))) {
      logApprovedEdits(input, paths);
      return approve('Auto-approved: edit within project folder');
    }
  }

  // Everything else: defer + log for the end-of-session reviewer.
  logDeferred(input);
  return defer();
});
