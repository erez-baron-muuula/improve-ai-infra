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
const crypto = require('crypto');                              // GEN-508: ticket-pass contentHash
const { execFileSync } = require('child_process');             // GEN-508: Team-Tasks page resolution

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

// GEN-564: the single shared pass-reader. Scans `dir` for an unexpired *.json pass whose parsed
// contents satisfy matchFn; returns its full path (does NOT consume) or null. `exclude` is an
// optional array of full pass-file paths to skip (so a multi-target call can't match one pass file
// for two targets); omit it (staging's case) and the `exclude &&` short-circuit makes it a no-op,
// identical to the pre-GEN-564 findPassFile. The three named readers below are thin wrappers that
// bind their own dir -- kept as separate names because vet-code/vet-rule SKILL.md Step-0 greps for
// findVettingPassFile / findCheckPassFile as a gate-integrity check (removing the names would make
// those skills fail-closed). Wrapper removal + grep repoint is deferred to GEN-565.
function findPassInDir(dir, matchFn, exclude) {
  let files;
  try { files = fs.readdirSync(dir); } catch (e) { return null; }
  const now = Date.now();
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(dir, f);
    if (exclude && exclude.includes(full)) continue;
    let pass;
    try { pass = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^﻿/, '')); } catch (e) { continue; }
    const exp = Date.parse(pass.expires || '');
    if (!exp || exp < now) continue;
    if (matchFn(pass)) return full;
  }
  return null;
}

// Find an unexpired pass file matching matchFn (does NOT consume). Returns full path or null.
function findPassFile(matchFn) {
  return findPassInDir(STAGING_PASS_DIR, matchFn);
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
// drift). The final protected-or-not decision is made by isProtectedCodeTarget's on-disk anchor: a
// MIS-resolved (real-but-wrong) path fails safe there (won't exist under the protected dirs). A NULL
// return, however, does NOT itself force a prompt -- it yields zero vetting targets, so an otherwise
// auto-approvable update-config invocation would fall open (this is exactly the GEN-503 bug: an
// unanchored -File match returned null for every -Op write-file). So null must only ever arise when
// the command genuinely does not target a protected code file, never from a parse slip. Returns a
// normalized key, or null if it cannot be determined (-> caller falls through to prompt).
function resolveUpdateConfigFile(command) {
  // Extract -File <value> (quoted or bare), the first occurrence. GEN-503: the leading (?:^|\s) anchor
  // is REQUIRED -- without it the `-file` TAIL of the token `write-file` (from `-Op write-file`) matches
  // first and captures the next token `-File` as the "filename", resolving to null and failing OPEN.
  // The anchor assumes flags are WHITESPACE-delimited (the only form update-config.ps1 is ever invoked
  // in: `& '...ps1' -Flag value`); a `(`/`;`-prefixed flag with no space would be missed, which is
  // fail-SAFE (null -> no target -> the smuggle-guard/scanChain already blocks chained forms upstream).
  const m = command.match(/(?:^|\s)-File\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  if (!m) return null;
  const raw = (m[1] || m[2] || m[3] || '').trim();
  if (!raw) return null;
  if (path.isAbsolute(raw) || raw.includes('\\') || raw.includes('/')) return normPath(raw);
  // Short logical name: read $ManagedFiles from the live update-config.ps1 to map name -> path.
  // Candidate locations, first EXISTING wins. In production only the Drive path exists, so it is
  // used; a copy under ~/.claude/scripts (checked first) lets a self-consistent tree resolve locally.
  // The on-disk anchor (isProtectedCodeTarget) is the real safety net against an unexpected/stale map:
  // a mis-resolved path won't exist under the protected dirs so it is not treated as protected. (Note
  // the honest limit: that anchor only catches a resolution to a real-but-wrong path; a NULL here
  // yields no target and does NOT by itself force a prompt -- see the header note. If no candidate is
  // found, return null.)
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
// GEN-503: the leading (?:^|\s) anchor mirrors resolveUpdateConfigFile's fix so the flag can never
// match a same-named TAIL of a preceding token (e.g. a `-file` inside `write-file`). ucArg's current
// callers (-Op, -ContentFile) fail SAFE today -- a misparse there returns null and settingsHooksChanged
// treats null conservatively (gate) -- so anchoring here is defense-in-depth, not a second fail-open
// fix; it is warranted because -Op feeds the settings.json hooks-registration gate.
function ucArg(command, flag) {
  const re = new RegExp('(?:^|\\s)-' + flag + '\\s+(?:"([^"]+)"|\'([^\']+)\'|(\\S+))', 'i');
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

// ---- GEN-562: fail-closed copy/move guard for protected hook/script destinations -------------
// The problem: a shell copy/move onto a protected hook/script can WRITE the file without consuming a
// vetting pass. vettingTargets' move/copy dest pattern (~line 918) anchors the destination to the
// LAST token of a segment (\s*$), so a trailing flag (`Copy-Item src DEST -Force` -- the real incident
// shape) makes it capture `-Force` instead of DEST -> zero targets -> enforceVetting falls through ->
// under bypass-permissions a fall-through is auto-approved = a SILENT write to protected code.
//
// The fix inverts the file's usual fail-safe stance FOR COPY/MOVE ONLY. Elsewhere the gate never
// hard-blocks what it can't confidently identify as a write (it falls through to a prompt, so an
// obscure write shape is no worse than a human seeing it). But a fall-through is a leak under
// bypass-permissions, and the requirement is must-not-leak. So for copy/move: can't-prove-safe = BLOCK.
//
// STRATEGY (this is the THIRD implementation; the first two were parse-based and each was defeated by a
// DIFFERENT shell-phrasing evasion a code-review pass found -- dir-vs-file dest; cmd/powershell wrapper
// nesting; a wrapper flag before -c; a module-qualified `Module\Copy-Item`; a quoted dest with an
// interior space the naive tokenizer split). Lesson: out-PARSING an adversarial shell string is
// whack-a-mole; a security gate can't rest on it. So this version does NOT parse. A copy/move command
// stays QUIET only if we can AFFIRMATIVELY prove it is safe; else BLOCK. Two crude, quote/wrapper-
// agnostic signals decide it (see enforceCopyMoveFailClosed): (1) a copy/move WORD appears (word-
// boundary, over-inclusive -- over-matching only blocks MORE, never leaks); (2) the command references
// the protected tree (absolute dir path as a raw substring -- unspoofable by quoting/spacing/nesting --
// OR a token that normPath()s into the tree). Plus: any DYNAMIC token ($var/%var%/subexpr/backtick/
// -EncodedCommand) in a copy command -> block (its runtime value could be a protected path we can't see).
//
// Ordered in main() AFTER enforceVetting, so a copy that carries a VALID pass is approved+consumed by
// enforceVetting (which process.exit(0)s) before this guard ever runs -- the sanctioned shell-copy
// apply path is preserved. configUnlocked() is checked first, so break-glass still bypasses.
//
// Protectedness is a path-SHAPE test (resolvesIntoProtectedDir) over the whole hooks\/scripts\ TREE,
// not isProtectedCodeTarget's existence+direct-child-.js/.ps1 anchor: a copy CREATING a new hook, or a
// copy whose dest is the protected DIRECTORY (file lands inside), must also block. Creating a new
// hook/script must go through /vet-code anyway, so this enforces existing policy. Scoped to THIS guard;
// isProtectedCodeTarget and its other callers are unchanged.
//
// HONEST RESIDUALS -- the "DISGUISED-VERB" family (deliberate, Erez-accepted; NOT airtight, and a
// FUNDAMENTAL ceiling of ANY command-TEXT gate -- the copy verb is hidden from static text until the
// shell decodes/expands it at runtime, so no text scanner can see it. This is the SAME ceiling the
// whole existing text-based gate already lives with; GEN-562 does not widen it. Closing it would mean
// blocking broad categories of normal commands, rejected as not worth it):
//   - PowerShell backtick-escape of the verb: `C` + backtick + `opy-Item`.
//   - A fully base64 `-EncodedCommand` payload whose decoded text we do not read.
//   - Bash brace expansion that reconstructs the verb/word: `{cp,src,dst}` (the shell expands it to
//     `cp src dst`; the literal `{cp,` is not recognizable as a command-position verb).
//   - A runtime-defined alias: `Set-Alias zz Copy-Item; zz ...` -- the alias name is not a known word.
// All four are the same class: the verb is not present as recognizable text until runtime. (NON-residual,
// FIXED: a ~-relative destination like `cp x ~/.claude/hooks/h.js` -- the verb IS plainly visible there,
// only the PATH needed resolving; commandTouchesProtectedTree now expands a leading ~ before resolving.)
//
// Cost of the crude signals (accepted -- must-not-leak over convenience): a copy that merely MENTIONS
// the tree blocks even if benign (e.g. backing a hook OUT to a safe dir, or a copy whose SOURCE is in
// the tree); route those through the tool path or break-glass.

// True iff `key` (already normalized by normPath) resolves to a path that IS, or lies ANYWHERE UNDER,
// the protected hooks\ or scripts\ dir -- whether or not it exists, regardless of extension/nesting.
// Broader than isProtectedCodeTarget (which requires a direct-child .js/.ps1 FILE): a copy/move
// destination may be the protected DIRECTORY itself (file lands inside as a new hook) or a subdir.
// Used by the fail-closed copy/move guard. Textual resolution only (inherits normPath: no symlink
// canonicalization -- the same residual the rest of the gate carries).
function resolvesIntoProtectedDir(key) {
  if (!key) return false;
  const k = key.replace(/\\+$/, ''); // strip trailing sep so `...\hooks\` matches `...\hooks`
  return k === HOOKS_DIR || k.startsWith(HOOKS_DIR + '\\') ||
         k === SCRIPTS_DIR || k.startsWith(SCRIPTS_DIR + '\\');
}

const COPY_MOVE_WORD_RE = /(?:^|[\s;&|('"`\\/])(?:copy-item|move-item|rename-item|cpi|move|mi|mv|rni|ren|rename|xcopy|robocopy|install)(?=$|[\s'"`)])|(?:^|[\s;&|('"`\\/])(?:copy|cp)(?=$|[\s'"`)])|\[(?:system\.)?io\.file\]::(?:copy|move)|\.(?:copyto|moveto)\s*\(/i;

function commandMentionsCopyMove(command) {
  return COPY_MOVE_WORD_RE.test(command);
}

// A token is a CONCRETE LITERAL path only if it has no shell-dynamic construct that could resolve, at
// runtime, to a path we can't see now: a variable ($x, %x%, $env:), a subexpression/backtick, an
// -EncodedCommand-style opaque payload, or a glob. If a copy command contains ANY such dynamic token,
// we cannot prove its destination is outside the protected tree -> fail-closed block. (Deliberately
// over-inclusive: a dynamic token anywhere in a copy command triggers a block even if it's the source,
// because we can't reliably tell source from dest across every shell shape -- and over-blocking is
// fail-closed-safe, never a leak.)
const DYNAMIC_TOKEN_RE = /[$%`]|-e(?:nc|ncodedcommand)?\b|\$\(|\bstart-process\b/i;

// Home dir (~) for tilde expansion -- HOOK_DIR is ~/.claude/hooks, so home is two levels up. A shell
// `~` is expanded by the shell at runtime (confirmed: the Bash tool maps ~ to the user home = the
// parent of ~/.claude), but Node's path.resolve does NOT expand it -- so a `cp x ~/.claude/hooks/h.js`
// would otherwise slip past both the absolute-substring test (starts with ~) and the token test
// (normPath leaves ~ literal). We expand a leading ~ ourselves before resolving.
const HOME_DIR = normPath(path.join(HOOK_DIR, '..', '..'));
function expandTilde(tok) {
  if (tok === '~') return HOME_DIR;
  if (tok.startsWith('~/') || tok.startsWith('~\\')) return HOME_DIR + '\\' + tok.slice(2);
  return tok;
}

// True iff the command references the protected tree: the absolute hooks\/scripts\ dir path appears as
// a substring of the normalized command (unspoofable by quoting/spacing/wrapper nesting -- a literal
// path substring survives all of them), OR any whitespace/quote-delimited token (after ~-expansion)
// normPath()s into the tree (catches a cwd-RELATIVE dest like `cp x hooks\h.js`, and a ~-relative dest
// like `cp x ~/.claude/hooks/h.js`, neither of which has the absolute substring).
function commandTouchesProtectedTree(command, cwd) {
  const normCmd = String(command).replace(/\//g, '\\').toLowerCase();
  if (normCmd.includes(HOOKS_DIR) || normCmd.includes(SCRIPTS_DIR)) return true;
  for (const raw of String(command).split(/[\s;&|()'"`,]+/)) {
    if (raw && resolvesIntoProtectedDir(normPath(expandTilde(raw), cwd))) return true;
  }
  return false;
}

// Fail-closed copy/move guard (rewritten after two code-review passes defeated two successive
// parse-based versions; see the strategy comment above). A copy/move command stays QUIET only if we can
// AFFIRMATIVELY prove it does not write into the protected tree; anything else BLOCKS (exit 2). "Prove
// safe" = the command has NO dynamic token (so every path is a concrete literal we can resolve now) AND
// none of those literals, nor any substring, touches the protected tree. So we block when a copy/move
// word co-occurs with EITHER (a) a reference to the protected tree, OR (b) any dynamic token whose
// runtime value we cannot see (variable/subexpression/encoded payload) -- can't-prove-safe = block.
function enforceCopyMoveFailClosed(tool, ti, command, cwd) {
  if (configUnlocked()) return;                 // break-glass: skip entirely (mirrors enforceVetting)
  if (!SHELL_TOOLS.has(tool)) return;           // shell tools only
  if (typeof command !== 'string' || !command) return;
  if (!commandMentionsCopyMove(command)) return; // no copy/move word anywhere -> not our concern
  if (commandTouchesProtectedTree(command, cwd)) return blockCopyMove(command); // (a) touches the tree
  if (DYNAMIC_TOKEN_RE.test(command)) return blockCopyMove(command);            // (b) can't prove safe
  // else: copy/move word present, all-concrete-literal, provably outside the tree -> safe, quiet.
}

function blockCopyMove(command) {
  process.stderr.write(
    'Refused (vetting lock -- copy/move fail-closed): this command uses a copy/move mechanism and ' +
    'references the protected hooks (~/.claude/hooks/*.js) or scripts (~/.claude/scripts/*.ps1) tree, ' +
    'so it is blocked -- a shell copy/move must not silently write protected code. Command: ' + command +
    '\nUse the /vet-code flow (which applies via the Write/Edit tool or update-config.ps1, consuming a ' +
    'vetting pass) instead of a shell copy. If this is a legitimate command that only mentions those ' +
    'paths (e.g. a read-only listing) or a genuine recovery, use break-glass (CLAUDE_CONFIG_UNLOCK / ' +
    'the .config-unlock sentinel).\n'
  );
  process.exit(2);
}

// Reads the vetting-passes dir. Separate dir keeps vetting + staging passes from cross-matching.
// Same unexpired-and-matchFn semantics. `exclude` is an optional array of full pass-file paths to
// skip (so a multi-target call can't match one pass file for two targets). GEN-564: thin wrapper
// over findPassInDir (kept as a named function for the SKILL.md Step-0 grep -- see findPassInDir).
function findVettingPassFile(matchFn, exclude) {
  return findPassInDir(VETTING_PASS_DIR, matchFn, exclude);
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

// Machine-checked mechanical-fix lane (spec #3). The resident rule lets a "purely mechanical fix
// (spelling/punctuation/whitespace/formatting)" SKIP /check -- but it still needs Erez's confirmation,
// so the lane DEFERS to the normal permission prompt, it does NOT silently allow (see enforceCheckDue,
// GEN-495). This MUST be verified from the actual before/after text, NEVER a self-declared label (a
// self-declared "mechanical" label is the single most likely bypass).
//
// DELIBERATELY NARROW (hardened by the /vet-code code-review panel): "mechanical" here means ONLY a
// change to HORIZONTAL-WHITESPACE runs -- the two strings must be IDENTICAL after every run of spaces
// and tabs is collapsed to a single space and leading/trailing horizontal whitespace on each line is
// trimmed. NOTHING else qualifies. An earlier design compared "word-token sequences" and ignored all
// non-word characters; the panel showed that fails OPEN, because a rules file encodes meaning in
// punctuation and structure (comparison operators >=/<=, markdown headings/list markers/code fences,
// [[link]] brackets, : vs ;, em-dash vs hyphen). Any change to ANY of those is now non-mechanical and
// takes the full check-record path. This lane exists only to spare a genuine reflow/indent/trailing-
// space tidy the /check panel (it still gets Erez's confirmation prompt); anything a human might read
// differently is NOT mechanical. Fails SAFE: a
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
//
// GEN-495 residual: exclusion (2) only fires when the CHANGED FRAGMENT itself contains ```. For a
// WRITE it is enough -- isMechanicalFix sees the whole file, so any fence anywhere makes it non-
// mechanical. But an EDIT/MultiEdit fragment can sit WHOLLY INSIDE a fence (space-only change, no ```
// in old_string/new_string) and still normalize-equal. checkDueTargets closes this by applying the
// SAME whole-file test to the Edit/MultiEdit branches: if the on-disk file contains ``` ANYWHERE, the
// edit is non-mechanical (fileHasFence below). Deliberately coarse and airtight -- it matches the
// Write path's own stance (a fenced file is never mechanical) rather than parsing fence positions,
// which this file's history warns against. Cost: a whitespace tidy to any fenced skill file now takes
// the confirmation/pass path instead of the mechanical-defer lane -- the SAFE direction, and after
// GEN-495's defer() change that "cost" is just one confirmation prompt, never a silent bypass.
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

// GEN-495 residual close for the Edit/MultiEdit fragment path: does the on-disk file contain ANY
// fenced-code-block marker (```)? If so, no fragment-level edit to it can ride the mechanical lane
// (spacing inside a fence may be meaning-bearing, and a fragment wholly inside a fence carries no ```
// of its own for isMechanicalFix to catch). Coarse on purpose -- mirrors the Write path, where any
// fence anywhere already forces non-mechanical. FAILS SAFE: an unreadable/missing file returns true
// (-> non-mechanical -> requires confirmation/pass), matching the try/catch stance in checkDueTargets.
function fileHasFence(key) {
  try { return fs.readFileSync(key, 'utf8').indexOf('```') !== -1; }
  catch (e) { return true; } // can't read -> assume fenced -> non-mechanical (fail safe)
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
          // Mechanical requires BOTH: the fragment is whitespace-only AND the file has no fence at all
          // (GEN-495 -- a fragment wholly inside a fence carries no ``` of its own for isMechanicalFix).
          // Division of labor: isMechanicalFix's own ``` bail catches a fence INTRODUCED by this edit
          // (in old_string/new_string); fileHasFence catches a pre-existing fence ELSEWHERE in the file,
          // so it reads the current on-disk content (pre-edit) -- that is sufficient for its job.
          mechanical = isMechanicalFix(ti.old_string, ti.new_string) && !fileHasFence(key);
        } else if (tool === 'Write' && ti && typeof ti.content === 'string') {
          const cur = fs.readFileSync(key, 'utf8').replace(/^﻿/, '');
          mechanical = isMechanicalFix(cur, ti.content.replace(/^﻿/, ''));
        } else if (tool === 'MultiEdit' && ti && Array.isArray(ti.edits)) {
          // Every sub-edit targeting THIS file must be mechanical for the call to be mechanical, and the
          // file must have no fence anywhere (GEN-495, same whole-file stance as the Edit branch).
          const subs = ti.edits.filter(e => e && normPath(e.file_path || ti.file_path || '', cwd) === key);
          mechanical = subs.length > 0 && !fileHasFence(key) && subs.every(e =>
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
    'horizontal-whitespace/indentation only, via the Edit tool, in a file with no fenced code block -- ' +
    'skips /check and instead defers to your normal confirmation prompt; it is not silently allowed.)\n'
  );
  process.exit(2);
}

// Check-before-present guard. For any tool call that would write to a check-due target, require a
// valid single-use check pass (target-bound) UNLESS the edit is a verified mechanical-only fix, which
// DEFERS to the normal confirmation prompt (not silently approved). Hard-block (exit 2) on miss;
// consume + approve on a matching pass; defer (return) on a mechanical-only fix or when no check-due
// target is involved. Honors break-glass. CHAINED shell commands cannot consume a pass (smuggle-hole fix);
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

  // A verified mechanical-only edit needs no /check -- but it is NOT silently auto-approved. The
  // governing rule (global CLAUDE.md, "Before adding or editing a rule in a CLAUDE.md file ...") says a
  // mechanical fix "still needs Erez's confirmation of the exact change but not a /check". So the
  // mechanical lane DEFERS to the normal permission prompt (that prompt IS Erez's confirmation), it
  // does NOT emit an allow decision. (GEN-495: this replaced an earlier approve() that suppressed the
  // prompt entirely -- silently allowing whitespace edits with no confirmation, which contradicted the
  // rule and failed open on the in-fence residual now closed by fileHasFence above.) If the call
  // touches EVEN ONE non-mechanical check-due target, it must be gated via a check pass (a mixed call
  // cannot ride the mechanical-defer lane).
  const nonMechanical = targets.filter(o => !o.mechanical);
  if (nonMechanical.length === 0) {
    return defer(); // mechanical-only -> fall through to Erez's confirmation prompt (no /check, no silent allow)
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

// Reads the check-passes dir. Separate dir keeps check + vetting + staging passes from cross-matching.
// Same unexpired-and-matchFn semantics. `exclude` is an optional array of full pass-file paths to skip
// (so a multi-target call can't match one pass file for two targets). GEN-564: thin wrapper over
// findPassInDir (kept as a named function for the SKILL.md Step-0 grep -- see findPassInDir).
function findCheckPassFile(matchFn, exclude) {
  return findPassInDir(CHECK_PASS_DIR, matchFn, exclude);
}

// ---- GEN-508: ticket-quality gate for Notion Team-Tasks writes --------------
// FOURTH sibling of the staging / vetting / check gates above, same shape: a PreToolUse guard over a
// single-use pass minted (only) by a skill -- here `/vet-ticket` -- into a dir OUTSIDE ~/.claude, so
// the mint always prompts Erez and that prompt IS the human gate.
//
// WHY: Claude repeatedly files or edits Team-Tasks tickets that violate the ticket-quality rules --
// most often a body that does not stand on its own, and/or missing/wrong priority-derivation fields
// (Urgency + Gain ratio -> Priority). The behavioural self-check rule for that is skipped under
// momentum. This makes an INDEPENDENT review a precondition of the write instead of a reminder.
//
// UNLIKE the file-target siblings, a Notion CREATE can be gated pre-hoc: the create payload names
// its own parent data source, so there is no "must exist on disk first" anchor problem. So every arm
// below gates BEFORE the write, creates included. "Airtight" is claimed only for the four MCP tools
// enumerated below: raw REST/curl Notion writes and all Jira writes are OUT of scope for this arm --
// a named gap, not coverage.
//
// ---------------------------------------------------------------------------------------------
// SCOPING IS PAYLOAD-SHAPE-INDEPENDENT. This is the whole point of the layer and the reason it was
// rebuilt (design-scoping-v3.md, converged over three /check rounds 2026-08-03). Two consecutive
// code-review rounds each found a fresh silent bypass of the SAME class: the old layer read specific
// field paths taken from the published tool schema, and real traffic does not always put the fields
// there. Measured against 1,313 complete payloads extracted from the session transcripts, the field-
// path approach silently approved: a whole payload re-serialised inside `{data: "<json>"}` (13), a
// create whose `parent` is nested inside `pages[0]` (3), `{__unparsedToolInput: {raw, len}}` (3), a
// parent given as `{data_source_url: "collection://<id>"}` whose key contains no "id" at all (3), an
// inner payload keyed `pageId` with no `command` (1), and an entirely different inner schema
// `{pages:[{id, properties, content:{type, edits[]}}]}` (1). So: no stage below reads a field path.
//
// Four stages, in this order:
//   1  NORMALISE  ticketNormalise() walks the payload, parses any embedded JSON string, hoists a
//                 single-key envelope, and collects every string / key / id-ish value under a budget.
//                 `ok === false` means WE COULD NOT SEE THE WHOLE PAYLOAD -> HARD BLOCK. This is the
//                 fail-closed anchor: stages 2-4 may conclude "out of scope" ONLY because stage 1
//                 guarantees they read everything.
//   2  HOUSEKEEP  a CLOSED-SHAPE exemption for pure workflow-metadata property edits. Free, and it
//                 runs before any network call, so a Status change can never be blocked by a Notion
//                 outage. Written as a closed shape (root keys must be a subset of five, property
//                 values must be primitives) rather than a list of dangerous names -- an allow-list
//                 of known-bad names is the very anti-pattern this rebuild deletes.
//   3  MARKER     search EVERY collected string for a Team-Tasks id, dash- and case-insensitively.
//                 A hit is in-scope with ZERO network calls, and it covers every create shape in the
//                 corpus -- top-level parent, nested parent, `data_source_url`, `collection://`, and
//                 the truncated raw text of a `__unparsedToolInput`.
//   4  RESOLVE    classify the remaining id-ish values against the Team-Tasks database, bounded.
//
// UNRESOLVED PAGE -> HARD-BLOCK, not defer. Erez's explicit call (2026-08-02): if the gate cannot
// tell whether a page is a work ticket, it stops. A defer() is silently auto-approved under
// defaultMode "auto" (the GEN-562 leak), so defer would not be "stops". Proportionate because
// `/vet-ticket` needs NO Notion access to mint -- an outage costs one review + one mint, never the
// global break-glass. For the same reason an internal throw in our own scoping blocks rather than
// returns, which supersedes design-converged.md's "Enforcement flow" step 5.
//
// GEN-58 CARVE-OUT is keyed on the SUBTREE, not on a command name. Checked live 2026-08-03: the
// reasoning-failure write-ups no longer live on the GEN-58 page but on child pages of it that roll
// over every ~25 entries, whose direct parent is the GEN-58 PAGE, not the Team-Tasks data source.
// Those volumes are therefore not Team-Tasks rows and were never in this gate's scope -- so this
// gate is NOT what keeps that log intact (that is GEN-453). What the carve-out has to prevent is
// stage 3 over-gating a write-up that happens to quote a Team-Tasks id in its text. Two earlier
// command-shape rules were falsified against the corpus first: of the 159 historical writes whose
// target was the GEN-58 page, the live `insert_content` rule covers 8 (5%) and the proposed
// "new_str starts with old_str" rule would cover at most 24 (15%).
//
// CONTENT HASH: a pass binds on `contentHash` ALONE, and the hash is of the NORMALISED, HOISTED
// payload -- `sha256Hex(stableStringify(ticketNormalise(tool_input).root))`. One tool call is one
// payload is one hash, so the hash already identifies the write exactly and the target string is
// only a human-readable label. Hashing the normalised root (not the raw input) is what makes the
// plain and `{data:"..."}`-enveloped forms of the same call hash identically; without the hoist step
// they would not, and every enveloped call would fail to match a pass minted from the drafted
// object. The single shared definition is reachable from outside via the `--ticket-hash` CLI mode at
// the bottom of this section, which is what `/vet-ticket` calls -- so the skill CANNOT drift from
// the hook, which citation alone could not guarantee.
//
// MAINTENANCE: the Notion MCP server UUID, the Team-Tasks ids, the GEN-58 page id and the
// housekeeping property names are hardcoded -- the same latent-rotation risk the sibling Notion
// hooks document. If ticket writes ever stop being gated, re-check these first.
const TICKET_PASS_DIR = path.join(STAGING_DIR, 'ticket-passes');
const TICKET_EVENTS_LOG = path.join(STAGING_DIR, 'ticket-gate-events.jsonl');
const PAGE_PARENT_CACHE = path.join(STAGING_DIR, 'notion-page-parents.json');
const NOTION_MCP_PREFIX = 'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__';
const NOTION_CREATE_TOOL = NOTION_MCP_PREFIX + 'notion-create-pages';
const NOTION_UPDATE_TOOL = NOTION_MCP_PREFIX + 'notion-update-page';
const NOTION_DUPLICATE_TOOL = NOTION_MCP_PREFIX + 'notion-duplicate-page';
const NOTION_MOVE_TOOL = NOTION_MCP_PREFIX + 'notion-move-pages';
// The four gated tools are the complete set of Notion MCP tools that can create or materially change
// a Team-Tasks ROW. The other six mutating tools are scoped out with a stated reason rather than left
// unnoticed: notion-update-data-source is schema-only (its grammar is ADD/DROP/RENAME/ALTER COLUMN
// plus title/description/in_trash/is_inline -- it cannot write a row's values; its destructive subset
// is already ask-gated by notion-schema-guard.js and a non-destructive ADD COLUMN fails safe here,
// since a renamed property drops out of the housekeeping deny-list and becomes substance);
// notion-create-comment touches neither body nor properties; notion-create-database creates a
// container, not a row; notion-create-view / notion-update-view change display only;
// notion-create-attachment attaches a file.
// Team-Tasks: REST database id + MCP collection (data source) id, dashless lowercase.
const TEAM_TASKS_IDS = new Set(['fe198002661848d7ae0456f8cee479f3', 'bd2cd17bf58f49938b95468e881272fa']);
// GEN-58 (QA Layer 5). The ticket page itself; its log-volume children are found by resolution.
const GEN58_PAGE_ID = '36d6e495d07c816e9e0cce265d694ab3';
// Live Team-Tasks property set (GET /v1/databases/<id>, 2026-08-02): Priority, Status, Urgency,
// Date Created, Assignee, Reason, Parent item, Attachment, Project, Type, Text, Children,
// Gain ratio, Remind me (days before), Due Date, ID, Name. Housekeeping = pure workflow metadata.
//
// SUBSTANCE IS A DENY-LIST, not an allow-list: anything not named here counts as substance. An
// allow-list would silently UN-gate a field the moment a Team-Tasks property is renamed; the
// deny-list rotates the safe way (an unknown key becomes substance -> gated). It also catches
// `Children`, the inverse-of-parent relation whose write silently re-parents pages.
const TICKET_HOUSEKEEPING_PROPS = new Set([
  'status', 'assignee', 'project', 'type', 'reason', 'due date',
  'remind me (days before)', 'date created', 'id', 'parent item'
]);
// Stage 2's closed shape: the ONLY root keys a housekeeping-exempt payload may carry.
const TICKET_HK_ROOT_KEYS = new Set(['page_id', 'pageId', 'id', 'command', 'properties']);
// Stage 4: id-ish keys whose value names a CONTAINER (a database / data source), not a page. Never
// resolved as pages. Matched on the WHOLE key name, so `page_or_database_ids` -- a list of pages --
// is not swallowed by the `database_id` entry. `data_source_url` is listed for completeness; its key
// name contains no "id", so it never reaches stage 4 at all and is covered by stage 3 instead.
const TICKET_CONTAINER_ID_KEYS = new Set(['data_source_id', 'database_id', 'data_source_url', 'collection_id']);
// Stage 1 budgets. Exceeding ANY of them sets ok = false, which hard-blocks.
const TN_MAX_DEPTH = 12;
const TN_MAX_NODES = 4000;
const TN_MAX_STRING_BYTES = 2 * 1024 * 1024;
const TN_MAX_UNWRAP = 8;
const TN_CPU_DEADLINE_MS = 2000;                                // covers stages 1-3 (the CPU stages)
// Known envelope key names. This one list IS a list of known names; the invariant that makes it safe
// -- and that a maintainer must re-check before ever adding a name -- is that the hoist can only
// discard a SOLE root key, and no name here is a field of any gated tool's schema (verified against
// the four live schemas and all 1,313 corpus payloads: `data` and `raw` occur only as envelopes,
// `input` and `arguments` never occur). Failing to hoist an unknown future wrapper is the SAFE
// direction: it is still walked, so stages 3 and 4 see through it, and the only cost is a pass that
// no longer matches -- which blocks and asks for a re-mint. Hoisting something that is NOT a wrapper
// is the unsafe direction, because stage 2 reads the hoisted root, and the invariant rules that out.
// `__unparsedToolInput` is here for uniformity only and is inert: it hoists to `{raw, len}`, which
// has two keys and so never reaches the plain form.
const TN_ENVELOPE_KEYS = new Set(['data', 'raw', 'input', 'arguments', '__unparsedToolInput']);
// Stage 4 cost bounds. One SHARED monotonic wall-clock budget for the whole call, checked before
// each subprocess -- not N independent timers -- so the arm cannot be killed by the hook's 60 s
// timeout, which under defaultMode "auto" would be a silent approve.
const TICKET_RESOLVE_MAX_IDS = 8;
const TICKET_RESOLVE_WALL_MS = 20000;
const TICKET_RESOLVE_PROC_MS = 5000;
// Pass-claim race: a batch pass being rewritten by another hook process is briefly absent from the
// dir, so a single scan can spuriously conclude "no pass" for a ticket Erez already approved.
const TICKET_PASS_RETRIES = 3;
const TICKET_PASS_RETRY_MS = 50;
// POSITIVES ONLY, and only as a speed-up. An earlier draft also cached negatives for 24h; that was a
// silent fail-open on an ordinary workflow -- a page edited while it was an ordinary page caches
// false, Erez then drags it into Team-Tasks IN THE NOTION UI (no notion-move-pages call, so no
// seeding), and for the next 24h every edit to that live ticket is waved through with no pass and no
// resolver call. A stale-known-negative must not be treated better than an unknown, which this gate
// hard-blocks. So a miss ALWAYS re-resolves; only a fresh positive short-circuits.
const TICKET_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;          // a ticket stays a ticket

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

// Dashless lowercase 32-hex, or '' if the value is not a Notion id.
function normNotionId(v) {
  const s = String(v == null ? '' : v).replace(/-/g, '').trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(s) ? s : '';
}

// Strip the qualifier forms notion-update-page uses for some property types
// (`date:Due Date:start`, `userDefined:ID`, `place:X:latitude`) down to the bare property name.
function ticketPropName(key) {
  let k = String(key == null ? '' : key);
  k = k.replace(/^(?:date|place|userDefined):/i, '');
  k = k.replace(/:(?:start|end|is_datetime|name|address|latitude|longitude|google_place_id)$/i, '');
  return k.trim().toLowerCase();
}

function ticketPropIsSubstance(key) {
  const n = ticketPropName(key);
  if (!n) return true;                  // an unreadable property name is not provably housekeeping
  return !TICKET_HOUSEKEEPING_PROPS.has(n);
}

// ---- stage 1: normalise -----------------------------------------------------
// ticketNormalise(tool_input) -> {ok, why, root, strings, keys, idish, deadline}
//
//   root     the payload with every embedded JSON string parsed in place and any single-key envelope
//            hoisted away. This is what stage 2 reads and what the content hash is taken over.
//   strings  every string encountered, key or value, parsed wrapper text included (stage 3 scans it).
//   keys     the set of every object key name in the tree (used to tell a content write from a
//            property write without reading a field path).
//   idish    every string value reached under a key whose name contains "id", tagged with the
//            nearest such key name (stage 4 resolves these).
//
// ok === false is a HARD BLOCK, never a fall-through. It means we could not read the payload end to
// end, so we cannot claim it is out of scope. Under defaultMode "auto" a fall-through would be a
// SILENT APPROVE of an unreviewed ticket write.
//
// SECURITY PROPERTIES, not style:
//  - the walk REBUILDS the tree rather than mutating `tool_input`, so nothing here can perturb the
//    guards that run after this one, and reconstructed objects are `Object.create(null)` so that a
//    payload key of `__proto__` becomes an ordinary own property instead of touching a prototype.
//  - the only plain-object write keyed by payload data is the page cache, and that key is a
//    validated 32-hex string by construction (see cachePageFlag).
//  - every regex applied to payload text is fixed-width and non-backtracking (`[0-9a-f]{32}` on a
//    dash-stripped copy). No alternation-with-repetition, no nested quantifiers, so no catastrophic
//    backtracking; the 2 MB string cap and the 2 s deadline bound the scan regardless.
function ticketNormalise(ti) {
  const strings = [];
  const keys = new Set();
  const idish = [];
  const st = { ok: true, why: '', nodes: 0, bytes: 0, deadline: Date.now() + TN_CPU_DEADLINE_MS };

  function bust(why) { st.ok = false; if (!st.why) st.why = why; return false; }

  function withinBudget() {
    if (st.nodes > TN_MAX_NODES) return bust('node-budget');
    if (st.bytes > TN_MAX_STRING_BYTES) return bust('string-budget');
    if (Date.now() > st.deadline) return bust('cpu-deadline');
    return true;
  }

  // The parse of a string that IS a JSON object/array, else undefined. Deliberately NOT "anything
  // JSON.parse accepts": a bare number or quoted string is data, not a wrapper.
  function asJson(s) {
    const t = s.trim();
    if (t === '' || (t[0] !== '{' && t[0] !== '[')) return undefined;
    let v;
    try { v = JSON.parse(t); } catch (e) { return undefined; }
    return (v && typeof v === 'object') ? v : undefined;
  }

  // wrapperPos: this string sits where only serialised JSON belongs (the whole tool_input, or a
  // value under an envelope key). Failing to parse THERE means the payload was truncated or mangled
  // and we are blind -> ok = false. Failing to parse anywhere else means nothing: five corpus
  // payloads carry ordinary body text opening with a markdown link or a bracketed tag
  // ("[Vol. 3](https://...)", "[D recurrence - scope-mis-assignment] 2026-07-15"), two of them
  // GEN-58 log writes, and a blanket "JSON-looking strings must parse" rule hard-blocked all five.
  function walk(node, depth, unwraps, idKey, wrapperPos) {
    st.nodes++;
    if (!withinBudget()) return node;
    if (depth > TN_MAX_DEPTH) { bust('depth-budget'); return node; }

    if (typeof node === 'string') {
      st.bytes += node.length;
      strings.push(node);
      if (!withinBudget()) return node;
      const parsed = asJson(node);
      if (parsed === undefined) {
        if (wrapperPos) bust('wrapper-unparsable');
        if (idKey) idish.push({ key: idKey, value: node });
        return node;
      }
      if (unwraps + 1 > TN_MAX_UNWRAP) { bust('unwrap-budget'); return node; }
      return walk(parsed, depth + 1, unwraps + 1, idKey, false);
    }

    if (Array.isArray(node)) {
      const out = [];
      for (let i = 0; i < node.length; i++) {
        if (!withinBudget()) return out;
        // An array index is not a key, so an id-ish key propagates through the array: the ids in
        // `page_or_database_ids: [...]` are reached under that key.
        out.push(walk(node[i], depth + 1, unwraps, idKey, false));
      }
      return out;
    }

    if (node && typeof node === 'object') {
      // Proof the harness truncated the payload before we ever saw it -- true in all 3 captured
      // `__unparsedToolInput` cases. Read by name off the original node; the truncated `raw` will
      // also fail the wrapper parse below, so this is belt-and-braces on a case we know is real.
      const un = node['__unparsedToolInput'];
      if (un && typeof un === 'object' && typeof un.raw === 'string' &&
          typeof un.len === 'number' && un.len > un.raw.length) bust('harness-truncated');

      const out = Object.create(null);
      for (const k of Object.keys(node)) {
        if (!withinBudget()) return out;
        st.bytes += k.length;
        strings.push(k);
        keys.add(k);
        // Innermost id-ish key wins; an id-ish key also propagates into nested containers, so an id
        // buried one level under `page_id` is still collected. Over-collecting only costs resolution
        // (bounded, and more gating); under-collecting would be a fail-open.
        const childIdKey = /id/i.test(k) ? k : idKey;
        out[k] = walk(node[k], depth + 1, unwraps, childIdKey, TN_ENVELOPE_KEYS.has(k));
      }
      return out;
    }
    return node;                                   // number, boolean, null
  }

  // A gated tool whose payload is not even an object/array/string is not provably out of scope.
  if (ti === null || (typeof ti !== 'object' && typeof ti !== 'string')) {
    return { ok: false, why: 'not-an-object', root: null, strings: strings, keys: keys, idish: idish, deadline: st.deadline };
  }

  let root = walk(ti, 0, 0, '', true);

  // Envelope hoisting. The walk substitutes a parsed wrapper IN PLACE, so a top-level `{data:"<json>"}`
  // becomes `{data:{...}}` -- the wrapper key survives and the enveloped and plain forms of the same
  // call do NOT produce the same tree. Stages 3 and 4 do not care (they read the whole tree either
  // way) but stage 2 and the content hash both read the root, so the wrapper has to go.
  let hoists = 0;
  while (root && typeof root === 'object' && !Array.isArray(root)) {
    const ks = Object.keys(root);
    if (ks.length !== 1 || !TN_ENVELOPE_KEYS.has(ks[0])) break;
    if (++hoists > TN_MAX_UNWRAP) { st.ok = false; if (!st.why) st.why = 'hoist-budget'; break; }
    root = root[ks[0]];
  }

  return { ok: st.ok, why: st.why, root: root, strings: strings, keys: keys, idish: idish, deadline: st.deadline };
}

// ---- stage 2: the housekeeping exemption (closed shape, no network) ---------
// The ONE path that lets a Team-Tasks write through without a pass, so it is written as a closed
// shape: exempt only on an exact match, and ANYTHING unrecognised gates. No list of dangerous names
// is needed or wanted -- that list is the anti-pattern this rebuild deletes.
//
// The captured alternate schema `{pages:[{id, properties:{Status}, content:{...edits}}]}` fails
// clause 1 on its root key `pages` and is gated, as it must be.
//
// design-converged.md's `update_verification` exemption is dropped: zero occurrences in 1,313
// payloads, i.e. exempt surface with no traffic behind it.
function ticketIsHousekeepingOnly(R) {
  if (!R || typeof R !== 'object' || Array.isArray(R)) return false;
  const keys = Object.keys(R);
  // 1 -- every root key is one of the five. An unknown key anywhere at the root fails.
  for (const k of keys) if (!TICKET_HK_ROOT_KEYS.has(k)) return false;
  // 2 -- a command, if present, is exactly update_properties.
  if (keys.indexOf('command') !== -1 && R.command !== 'update_properties') return false;
  // 3 -- properties must EXIST and be a plain object (clause 3 of the design presupposes it), and
  // every key of it must be housekeeping after the qualifier strip.
  if (keys.indexOf('properties') === -1) return false;
  const props = R.properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return false;
  for (const pk of Object.keys(props)) {
    if (ticketPropIsSubstance(pk)) return false;
    // 4 -- no nested object, which is what a content structure looks like. `null` counts as a
    // primitive: real housekeeping edits clear a relation with `"Assignee": null` / `"Parent item":
    // null`, and a naive `typeof v !== 'object'` test would exclude them (typeof null === 'object').
    const v = props[pk];
    if (v === null) continue;
    if (Array.isArray(v)) {
      if (!v.every(x => x === null || typeof x !== 'object')) return false;
      continue;
    }
    if (typeof v === 'object') return false;
  }
  return true;
}

// A write that touches the body and no database property. Decided from the KEY SET of the whole
// normalised tree, not a field path, so the alternate inner schema (whose `properties` sits inside
// `pages[0]`) is correctly seen as property-bearing and stays gated even on the GEN-58 page.
function ticketIsContentOnly(norm) {
  return !norm.keys.has('properties');
}

// ---- stage 3: marker scan (free, no network) --------------------------------
// true (a Team-Tasks id appears somewhere in the payload) / false / null (CPU deadline -> the caller
// treats it as unreadable and blocks). Dash- and case-insensitive, anywhere in any string, which is
// the direct expression of "look for the marker in the whole payload rather than at a field path".
// Over-gating is possible (a body that quotes the ids in prose -- this project's own docs do) and is
// the safe direction; the GEN-58 carve-out runs first precisely to spare the one case where a
// standing rule requires the write to be immediate.
function ticketMarkerScan(norm) {
  for (let i = 0; i < norm.strings.length; i++) {
    if ((i & 63) === 0 && Date.now() > norm.deadline) return null;
    const s = norm.strings[i];
    if (typeof s !== 'string' || s.length < 32) continue;
    const bare = s.replace(/-/g, '').toLowerCase();
    for (const m of TEAM_TASKS_IDS) if (bare.indexOf(m) !== -1) return true;
  }
  return false;
}

// ---- stage 4: id extraction and resolution ---------------------------------
// Every 32-hex id in a value -- dashed, bare, or inside a URL. A truncated uuid yields NOTHING,
// which is the point: it is a malformed target, not an absent one, and the caller blocks on it.
//
// A canonically dashed uuid is matched FIRST, on the raw value, because the dashes pin the id's
// boundaries exactly and no surrounding text can bleed into it. Only when there is no dashed form
// does the value get dash-stripped and scanned for hex runs -- which is what a bare id, an odd
// dashing, and a `/p/<id32>` URL all need.
//
// Measured over the 1,387 id-ish values in the corpus: 976 canonically dashed, 394 bare 32-hex, 9
// oddly dashed but still 32-hex once stripped, 6 `/p/<id32>` URLs, 2 malformed (the placeholder and
// the truncated uuid). NOT ONE dash-strips into a hex run longer than 32, so the ambiguous case is
// hypothetical -- it is handled by emitting the run's leading AND trailing 32-char window (a Notion
// share URL puts the id at the end of a title-derived slug, so a slug ending in hex characters would
// otherwise yield a wrong id), which costs one extra bounded candidate in a case that never occurs.
//
// Either error direction is safe: a missing id makes the target malformed (block) and a wrong id
// fails to resolve (unknown -> block). Neither can produce an out-of-scope verdict.
//
// Both patterns are character classes with a single quantifier -- no alternation, no nesting, so
// linear time with no backtracking, which is the property the 2 s deadline only has to backstop.
function ticketIdsIn(value) {
  const raw = String(value == null ? '' : value).toLowerCase();
  const out = [];
  const seen = new Set();
  const add = id => { if (!seen.has(id)) { seen.add(id); out.push(id); } };

  const dashed = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
  if (dashed) {
    for (const d of dashed) add(d.replace(/-/g, ''));
    return out;
  }
  const bare = raw.replace(/-/g, '');
  const re = /[0-9a-f]+/g;
  let m;
  while ((m = re.exec(bare)) !== null) {
    if (m[0].length < 32) continue;
    add(m[0].slice(0, 32));
    add(m[0].slice(-32));
  }
  return out;
}

// Split the id-ish values into candidate PAGES (resolved) and CONTAINERS (never resolved -- if a
// container were Team-Tasks, stage 3 already fired on the same string, so no separate local compare
// is needed here). `sawCandidateKey` distinguishes "no target field at all" from "a target field
// that yields no valid id", which are different verdicts.
function ticketSplitIds(idish) {
  const pageIds = [];
  const seen = new Set();
  let sawCandidateKey = false;
  let containerTeamTasks = false;
  for (const e of idish) {
    const ids = ticketIdsIn(e.value);
    if (TICKET_CONTAINER_ID_KEYS.has(String(e.key).toLowerCase())) {
      for (const id of ids) if (TEAM_TASKS_IDS.has(id)) containerTeamTasks = true;
      continue;
    }
    sawCandidateKey = true;
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      pageIds.push(id);
    }
  }
  return { pageIds: pageIds, sawCandidateKey: sawCandidateKey, containerTeamTasks: containerTeamTasks };
}

// ---- page cache (lives OUTSIDE ~/.claude on purpose) ------------------------
// settings.json allow-lists Write(C:\Users\Erez\.claude\*), so a cache inside that tree could be
// silently rewritten by a tool call to mark a real ticket out-of-scope with NO prompt. The hook's
// own fs writes are unaffected by the allow-list, so nothing is lost by keeping it in
// ~/.claude-staging alongside the pass dirs.
//
// Two positive flags per page: `tt` (confirmed Team-Tasks row) and `g58` (confirmed GEN-58 log
// volume). Both are positives-only; see TICKET_CACHE_TTL_MS.
function readPageParentCache() {
  try {
    const j = JSON.parse(fs.readFileSync(PAGE_PARENT_CACHE, 'utf8').replace(/^\uFEFF/, ''));
    return (j && typeof j === 'object') ? j : {};
  } catch (e) { return {}; }
}

// Record a CONFIRMED flag, pruning expired and flagless entries on the way so the file stays bounded
// at roughly the live working set instead of growing for every page ever touched. The 32-hex guard
// is what makes `c[id] = ...` safe: the only plain-object write keyed by payload-derived data in this
// whole layer cannot be `__proto__` or any other special name.
function cachePageFlag(id, flag) {
  try {
    if (!/^[0-9a-f]{32}$/.test(String(id))) return;
    const c = readPageParentCache();
    const now = Date.now();
    for (const k of Object.keys(c)) {
      const e = c[k];
      if (!e || typeof e !== 'object' || typeof e.ts !== 'number' ||
          now - e.ts > TICKET_CACHE_TTL_MS || (e.tt !== true && e.g58 !== true)) delete c[k];
    }
    const prev = (c[id] && typeof c[id] === 'object') ? c[id] : {};
    const next = { tt: prev.tt === true, g58: prev.g58 === true, ts: now };
    next[flag] = true;
    c[id] = next;
    fs.mkdirSync(STAGING_DIR, { recursive: true });
    fs.writeFileSync(PAGE_PARENT_CACHE, JSON.stringify(c));
  } catch (e) { /* cache is an optimization; never let it break the gate */ }
}

// true (fresh confirmed flag) or null (unknown -- caller must resolve). Never returns false.
function cachedPageFlag(id, flag) {
  try {
    const e = readPageParentCache()[id];
    if (!e || typeof e !== 'object' || e[flag] !== true || typeof e.ts !== 'number') return null;
    if (Date.now() - e.ts > TICKET_CACHE_TTL_MS) return null;
    return true;
  } catch (e) { return null; }
}

// Names kept from the previous build: design-converged.md and the ticket both refer to them.
function cachePageParent(id) { return cachePageFlag(id, 'tt'); }
function cachedPageParent(id) { return cachedPageFlag(id, 'tt'); }

// One shared resolution budget per gated call.
function ticketResolveBudget() {
  return { until: Date.now() + TICKET_RESOLVE_WALL_MS, left: TICKET_RESOLVE_MAX_IDS, pages: new Map() };
}

// The Credential-Manager token, fetched at most ONCE per process. undefined = not tried yet,
// null = unavailable (every id then resolves to unknown, which blocks).
let TICKET_TOKEN_MEMO;
function notionTokenOnce() {
  if (TICKET_TOKEN_MEMO !== undefined) return TICKET_TOKEN_MEMO;
  TICKET_TOKEN_MEMO = null;
  try {
    const ps =
      "$v=[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new();" +
      "$c=$v.Retrieve('claude-notion-token','claude-notion-token');$c.RetrievePassword();$c.Password";
    const tok = String(execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', timeout: TICKET_RESOLVE_PROC_MS }) || '').trim();
    if (tok) TICKET_TOKEN_MEMO = tok;
  } catch (e) { /* stays null */ }
  return TICKET_TOKEN_MEMO;
}

// ONE fetch per id per call, memoised on the budget, so the Team-Tasks question and the GEN-58
// question share a single round-trip. -> {ok, parentId} where parentId is the dashless id of
// whatever the page hangs off (data source, database, page or block), or '' for a workspace parent.
//
// The catch is TOTAL by design -- no token, network error, non-JSON, unexpected shape, timeout,
// 401/403/404/429/5xx, AND any bug in this function's own code all yield ok:false, which the callers
// turn into 'unknown' and the arm turns into a BLOCK. So a resolver fault can never widen into a
// silent approve. In particular there is no `404 => not a ticket` shortcut: a Notion 404 also means
// no-access-to-this-page and archived/trashed, so treating it as out-of-scope would silently
// reclassify a real ticket on the highest-volume path (edits are 1,043 of 1,313 corpus payloads).
function resolveNotionPage(id, budget) {
  if (budget.pages.has(id)) return budget.pages.get(id);
  let r = { ok: false, parentId: '' };
  try {
    if (budget.left > 0 && Date.now() < budget.until) {
      budget.left--;
      const tok = notionTokenOnce();
      if (tok) {
        const out = String(execFileSync('curl.exe', [
          '-sk', '-m', String(Math.ceil(TICKET_RESOLVE_PROC_MS / 1000)),
          '-w', '\\n%{http_code}',
          'https://api.notion.com/v1/pages/' + id,
          '-H', 'Authorization: Bearer ' + tok,
          '-H', 'Notion-Version: 2022-06-28'
        ], { encoding: 'utf8', timeout: TICKET_RESOLVE_PROC_MS + 1000 }) || '');
        const nl = out.lastIndexOf('\n');
        const code = nl === -1 ? '' : out.slice(nl + 1).trim();
        if (code === '200') {
          const par = JSON.parse(out.slice(0, nl)).parent;
          if (par && typeof par === 'object') {
            // Container parents first, so a Team-Tasks row resolves to the database rather than to
            // an unrelated page field; then page/block, which is how a log volume hangs off GEN-58.
            r = { ok: true, parentId: normNotionId(par.data_source_id || par.database_id || par.page_id || par.block_id || '') };
          }
        }
      }
    }
  } catch (e) { r = { ok: false, parentId: '' }; }
  budget.pages.set(id, r);
  return r;
}

// 'team-tasks' | 'other' | 'unknown'.
function classifyNotionId(id, budget) {
  if (cachedPageFlag(id, 'tt') === true) return 'team-tasks';
  const r = resolveNotionPage(id, budget);
  if (!r.ok) return 'unknown';
  if (r.parentId && TEAM_TASKS_IDS.has(r.parentId)) { cachePageFlag(id, 'tt'); return 'team-tasks'; }
  return 'other';
}

// 'in' | 'out' | 'unknown' -- is this page the GEN-58 ticket page or one of its log volumes?
// Hardcoding the volume ids instead was rejected: they roll over every ~25 entries and a stale id is
// a silently dead carve-out.
function gen58Subtree(id, budget) {
  if (id === GEN58_PAGE_ID) return 'in';
  if (cachedPageFlag(id, 'g58') === true) return 'in';
  // A page already confirmed to be a Team-Tasks ROW hangs off the data source, not off the GEN-58
  // page, so it cannot be a log volume -- and the GEN-58 row itself was caught on the line above.
  // Without this short-circuit every content edit to a known ticket would pay a round-trip forever.
  if (cachedPageFlag(id, 'tt') === true) return 'out';
  const r = resolveNotionPage(id, budget);
  if (!r.ok) return 'unknown';
  if (r.parentId === GEN58_PAGE_ID) { cachePageFlag(id, 'g58'); return 'in'; }
  return 'out';
}

// WHO READS THIS FILE, stated because a log nobody reads is not a signal.
//
// Five event kinds land here, and they split cleanly:
//  - the four `block` reasons (scope-error, scope-unreadable, no-target, bad-target, unresolved,
//    no-pass, stale-hash) are SELF-SURFACING and need no reader: each one is immediately followed by
//    blockTicketVetting, which exits 2 and prints why, so the call stops and Claude has to act on it
//    in the same turn. That is why piece 1 needs no aggregate monitor -- the failure mode here is
//    loud by construction, not silent. (Round 1 of the design claimed an aggregate monitor already
//    existed; it did not, and the fix was to make every failure loud rather than to build one.)
//  - `approve` and `claim-lost` are AGGREGATE-ONLY and are the reason this file exists. `claim-lost`
//    followed by a successful retry is the one genuinely silent event in the whole arm: it means two
//    hook processes contended over one batch pass, the write went through correctly, and nobody
//    hears about it.
//
// Their reader is piece 3 (the `/wrap` aggregate line), which MUST surface, in the wrap-up Erez
// already reads: the count of blocks by reason since the previous wrap, and -- separately -- a flag
// if any `claim-lost` occurred at all, since a single occurrence is what turns the pass-claim race
// from theoretical into observed. RE-EVALUATE BAR: if `claim-lost` is still zero after 50 gated
// writes have been logged here, the 3-attempt retry loop in enforceTicketVetting is dead weight and
// should be dropped rather than maintained.
//
// Until piece 3 ships, that is a NAMED GAP: these two event kinds accumulate unread. It is the right
// trade only because nothing in it can hide a bad write -- every write that fails to satisfy the
// gate has already stopped loudly by the time it is logged.
function logTicketGateEvent(entry) {
  try {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
    fs.appendFileSync(TICKET_EVENTS_LOG, JSON.stringify(Object.assign({ ts: new Date().toISOString() }, entry)) + '\n');
  } catch (e) { /* logging must never break a tool call */ }
}

// A short human-readable label for the block message and the audit log. NOT part of pass matching --
// that is the content hash alone -- so it is free to be readable rather than canonical.
function ticketLabel(tool, ids) {
  const short = (tool.indexOf(NOTION_MCP_PREFIX) === 0 ? tool.slice(NOTION_MCP_PREFIX.length) : tool).replace(/^notion-/, '');
  if (ids.length === 0) return short + ':in-payload';
  return short + ':' + ids.slice(0, 4).join('+') + (ids.length > 4 ? '+' + (ids.length - 4) + '-more' : '');
}

// ---- the scope verdict ------------------------------------------------------
// -> {scope:'out'}
//  | {scope:'in',    target, hash, ids, seedIds}
//  | {scope:'block', target, hash, ids, reason, why}
//
// PURE apart from the resolver's cache writes and its own memo: its caller wraps it in a catch, and a
// throw is treated as a BLOCK, so nothing here may leave the gate in a state that depends on having
// completed. The cache is only ever written with CONFIRMED positives, which a later block cannot
// invalidate (a blocked write does not change what the page is).
function ticketScope(tool, ti) {
  // Stage 1.
  const norm = ticketNormalise(ti);
  if (!norm.ok) {
    return { scope: 'block', reason: 'scope-unreadable', why: norm.why, target: ticketLabel(tool, []), hash: '', ids: [] };
  }
  const hash = sha256Hex(stableStringify(norm.root === undefined ? null : norm.root));

  // Stage 2 -- free, and BEFORE any resolution, so a housekeeping status change can never be
  // blocked by a Notion outage.
  if (ticketIsHousekeepingOnly(norm.root)) return { scope: 'out' };

  const split = ticketSplitIds(norm.idish);
  const label = ticketLabel(tool, split.pageIds);
  const budget = ticketResolveBudget();

  // GEN-58 carve-out. Content-bearing writes only: a property write on the GEN-58 ROW is still a
  // ticket-property write and stays gated. Runs BEFORE the marker scan, because over-gating a log
  // write-up that quotes a Team-Tasks id is exactly what it exists to prevent, and a standing rule
  // requires those writes to be immediate. 'unknown' does not exempt: a cold cache during a Notion
  // outage blocks a log write, whose escape is one /vet-ticket mint, not break-glass.
  if (tool === NOTION_UPDATE_TOOL && split.pageIds.length > 0 && ticketIsContentOnly(norm)) {
    let allIn = true;
    for (const id of split.pageIds) { if (gen58Subtree(id, budget) !== 'in') { allIn = false; break; } }
    if (allIn) return { scope: 'out' };
  }

  // Stage 3.
  const marker = ticketMarkerScan(norm);
  if (marker === null) {
    return { scope: 'block', reason: 'scope-unreadable', why: 'cpu-deadline', target: label, hash: '', ids: split.pageIds };
  }
  if (marker === true) {
    return { scope: 'in', target: label, hash: hash, ids: split.pageIds, seedIds: ticketSeedIds(tool, split) };
  }

  // Stage 4. Zero ids is not one case but two.
  if (split.pageIds.length === 0) {
    if (!split.sawCandidateKey) {
      // No target field anywhere. For a create this is the parentless workspace-level page the
      // corpus contains, and it is genuinely out of scope. For the other three tools a target is
      // structurally mandatory, so its absence means we misread the payload.
      if (tool === NOTION_CREATE_TOOL) return { scope: 'out' };
      return { scope: 'block', reason: 'no-target', target: label, hash: hash, ids: [] };
    }
    // A target field exists but yields no valid 32-hex (`page_id: "placeholder"`, a truncated uuid --
    // both real in the corpus). A malformed target is not evidence of harmlessness.
    return { scope: 'block', reason: 'bad-target', target: label, hash: hash, ids: [] };
  }
  let anyTicket = false, anyUnknown = false;
  for (const id of split.pageIds) {
    const v = classifyNotionId(id, budget);
    if (v === 'team-tasks') anyTicket = true;
    else if (v === 'unknown') anyUnknown = true;
  }
  if (anyTicket) return { scope: 'in', target: label, hash: hash, ids: split.pageIds, seedIds: ticketSeedIds(tool, split) };
  if (anyUnknown) return { scope: 'block', reason: 'unresolved', target: label, hash: hash, ids: split.pageIds };
  return { scope: 'out' };
}

// Ids worth seeding into the cache once a write is authorised. Only a move INTO Team-Tasks has any:
// the moved pages become tickets, so their first EDIT needs no round-trip. A create or a duplicate
// has NOTHING to seed -- Notion assigns the new page's id server-side and the payload never carries
// it -- so design-converged.md's "Seeding" paragraph, which claims seeding "on every gated
// create/duplicate/move", is wrong about what is possible rather than wrong about the code
// (design-scoping-v3 §7 left this open at build time; this is the resolution). A duplicate's SOURCE
// is already cached by classifyNotionId.
//
// The destination is read from CONTAINER-key ids, not from `new_parent` by path, and not from the
// bare marker scan: a move-OUT whose body merely mentions Team-Tasks must not poison the cache with
// 30-day false positives for pages it never moved in. If a future payload expresses the destination
// some other way we simply do not seed, costing one round-trip later.
function ticketSeedIds(tool, split) {
  if (tool !== NOTION_MOVE_TOOL || !split.containerTeamTasks) return [];
  return split.pageIds.slice();
}

// ---- pass matching and single-use consumption -------------------------------
// Reads the ticket-passes dir. A separate dir keeps ticket passes from cross-matching staging /
// vetting / check passes. Named wrapper over findPassInDir, per the family convention (and
// /vet-ticket's Step-0 gate-integrity grep looks for this name).
function findTicketPassFile(matchFn, exclude) {
  return findPassInDir(TICKET_PASS_DIR, matchFn, exclude);
}

// Matching is on `contentHash` ALONE (design-scoping-v3 §5). One tool call is one payload is one
// hash, so the hash identifies the write exactly; requiring the hook-derived TARGET string to match
// too would mean /vet-ticket had to reproduce the whole scoping scan or no pass would ever match --
// a failure whose only escape is break-glass. This also deletes the "two targets claiming one pass"
// bookkeeping and its `exclude` list.
function ticketPassMatches(pass, hash) {
  if (!pass || pass.kind !== 'ticket' || !hash) return false;
  const entries = Array.isArray(pass.targets) ? pass.targets : [{ contentHash: pass.contentHash }];
  return entries.some(e => e && typeof e.contentHash === 'string' && e.contentHash.trim().toLowerCase() === hash);
}

// Does ANY live pass name one of these page ids? Used only to tell the operator the difference
// between "you never got this reviewed" and "you got it reviewed and then changed the payload",
// which is otherwise a mysterious dead end costing a wasted re-mint to diagnose.
function ticketPassExistsForIds(ids) {
  if (!ids || ids.length === 0) return false;
  return !!findTicketPassFile(pass => {
    if (!pass || pass.kind !== 'ticket') return false;
    const entries = Array.isArray(pass.targets) ? pass.targets : [{ target: pass.target }];
    return entries.some(e => {
      const s = String(e && e.target != null ? e.target : '').replace(/-/g, '').toLowerCase();
      return s !== '' && ids.some(id => s.indexOf(id) !== -1);
    });
  });
}

// A 50 ms sync pause, no subprocess. Atomics.wait is the clean form on the main thread; the spin is
// only a fallback for a runtime that refuses it.
function ticketSleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch (e) { const until = Date.now() + ms; while (Date.now() < until) { /* spin */ } }
}

// Single-use is per ENTRY, not per file: Erez approves a card LIST in one action, so one mint must
// cover N tickets (minting N files would raise N prompts and defeat that).
//
// CLAIM BY RENAME, because the read-modify-write this replaces was not atomic: two hook processes
// could each read the same batch pass and each write back a copy missing only its own entry,
// resurrecting the other's. The rename is atomic, so exactly one process can win; the loser sees a
// throw, and its caller re-scans (the file is briefly absent while the winner rewrites it).
function consumeTicketPass(file, hash) {
  const claim = file + '.claim.' + process.pid + '.' + Date.now();
  try { fs.renameSync(file, claim); } catch (e) { return false; }   // lost the race -> caller re-scans
  try {
    const pass = JSON.parse(fs.readFileSync(claim, 'utf8').replace(/^\uFEFF/, ''));
    const rest = Array.isArray(pass.targets)
      ? pass.targets.filter(e => !(e && typeof e.contentHash === 'string' && e.contentHash.trim().toLowerCase() === hash))
      : [];
    if (!Array.isArray(pass.targets) || rest.length === 0) {
      fs.renameSync(claim, file + '.consumed.' + Date.now());       // single-target, or last entry
      return true;
    }
    pass.targets = rest;
    fs.writeFileSync(claim + '.tmp', JSON.stringify(pass));
    fs.renameSync(claim + '.tmp', file);                            // survivors, under the real name
    return true;
  } catch (e) {
    // We hold the claim and could not rewrite it. Retire it rather than put it back: a pass we
    // cannot rewrite would otherwise stay replayable for every entry it carries.
    try { fs.renameSync(claim, file + '.consumed.' + Date.now()); } catch (e2) { /* nothing left to do */ }
    return false;
  }
}

function blockTicketVetting(sc) {
  const reason = sc.reason || 'no-pass';
  let why = '';
  if (reason === 'scope-error') {
    why = ' The gate hit an internal error while working out whether this call touches a Team-Tasks' +
          ' ticket, so it cannot claim the call is out of scope.';
  } else if (reason === 'scope-unreadable') {
    why = ' The payload could not be read end to end (' + (sc.why || 'unknown') + '), so the gate' +
          ' cannot claim it is out of scope. /vet-ticket will refuse to mint for it too -- re-issue' +
          ' the call in the ordinary shape rather than hunting for a pass.';
  } else if (reason === 'no-target') {
    why = ' This call carries no readable target page, which for this tool is structurally' +
          ' impossible, so the gate treats it as a payload it misread rather than as harmless.';
  } else if (reason === 'bad-target') {
    why = ' Its target id is present but is not a valid Notion id (a placeholder, or a truncated' +
          ' uuid), so it cannot be resolved. A malformed target is not evidence of harmlessness.';
  } else if (reason === 'unresolved') {
    why = ' This page could not be resolved against the Team-Tasks database (no token / Notion' +
          ' unreachable / rate-limited / archived / unexpected response), so it is treated as in' +
          ' scope rather than waved through. If it is NOT a ticket, most of /vet-ticket\'s checklist' +
          ' does not apply -- say so at the card and mint on that basis, or use break-glass if' +
          ' Notion is down for the whole session.';
  } else if (reason === 'stale-hash') {
    why = ' A ticket pass EXISTS for this ticket, but it was minted for a DIFFERENT payload: the' +
          ' content changed after Erez approved it, or the same call is being sent in a different' +
          ' shape. Re-run /vet-ticket on the payload you are actually about to send. Do not' +
          ' hand-edit the pass.';
  }
  process.stderr.write(
    'Refused (ticket-quality gate): no ticket pass for ' + sc.target + '.' + why +
    ' A Team-Tasks create, duplicate, move, body edit, or substance-property edit must go through the' +
    ' /vet-ticket flow: an independent reviewer passes the draft against the ticket bar, Erez' +
    ' approves the summary card, and that mints a single-use pass. NOT gated: housekeeping-only' +
    ' property edits (status, assignee, project, type, reason, due date, reminder, parent item) and' +
    ' content writes inside the GEN-58 subtree.\n'
  );
  process.exit(2);
}

// Ticket-quality guard. Hard-blocks (exit 2) an in-scope Team-Tasks write with no matching pass;
// consumes the matching pass and approves; returns (falls through) for everything else. Honors
// break-glass.
function enforceTicketVetting(tool, ti) {
  // Tool test FIRST and OUTSIDE the try: it cannot throw, so a bug anywhere below can never make a
  // non-Notion call take the block path -- and, more importantly, the catch below can fail CLOSED
  // without risking every other tool call in the session.
  if (tool !== NOTION_CREATE_TOOL && tool !== NOTION_UPDATE_TOOL &&
      tool !== NOTION_DUPLICATE_TOOL && tool !== NOTION_MOVE_TOOL) return;
  if (configUnlocked()) return;                 // break-glass: skip the gate entirely
  let sc;
  try {
    sc = ticketScope(tool, ti);
  } catch (e) {
    // A throw in our own scoping is NOT a reason to let a Notion write through. defaultMode is
    // "auto", so returning here would be a SILENT APPROVE of an unreviewed ticket write, not a
    // prompt. Fail closed instead; break-glass is the escape. (This supersedes design-converged.md's
    // "Enforcement flow" step 5, which said to return.)
    logTicketGateEvent({ event: 'block', tool: tool, target: '<scope-error>', reason: 'scope-error' });
    return blockTicketVetting({ target: '<scope-error>', reason: 'scope-error', ids: [] });
  }
  if (!sc || sc.scope === 'out') return;
  if (sc.scope === 'block') {
    logTicketGateEvent({ event: 'block', tool: tool, target: sc.target, reason: sc.reason, why: sc.why });
    return blockTicketVetting(sc);
  }

  // In scope: a pass is required. Re-scan on a lost claim (and on a first-scan miss, which is the
  // same window seen from outside) before concluding no-pass, so one entry of a batch Erez already
  // approved is not spuriously blocked while another process is mid-rewrite. Still fail-closed:
  // retries exhausted -> block.
  let consumed = false;
  for (let attempt = 0; attempt < TICKET_PASS_RETRIES && !consumed; attempt++) {
    if (attempt > 0) ticketSleepSync(TICKET_PASS_RETRY_MS);
    const file = findTicketPassFile(p => ticketPassMatches(p, sc.hash));
    if (!file) continue;
    consumed = consumeTicketPass(file, sc.hash);
    if (!consumed) logTicketGateEvent({ event: 'claim-lost', tool: tool, target: sc.target, attempt: attempt + 1 });
  }
  if (!consumed) {
    const stale = ticketPassExistsForIds(sc.ids);
    const reason = stale ? 'stale-hash' : 'no-pass';
    logTicketGateEvent({ event: 'block', tool: tool, target: sc.target, reason: reason, hash: sc.hash });
    return blockTicketVetting({ target: sc.target, reason: reason, ids: sc.ids });
  }

  try { for (const id of (sc.seedIds || [])) cachePageFlag(id, 'tt'); } catch (e) { /* optimization */ }
  logTicketGateEvent({ event: 'approve', tool: tool, target: sc.target, hash: sc.hash });
  return approve('Auto-approved: ticket pass consumed (' + sc.target + ').');
}

// ---- the shared content-hash CLI -------------------------------------------
// `node auto-approve.js --ticket-hash <payload.json>` prints the contentHash /vet-ticket must mint.
//
// WHY A CLI RATHER THAN A CITED FORMULA: design-scoping-v3 §5 requires the skill to use the same
// ticketNormalise + stableStringify as the hook, and names skill/hook drift as a failure whose only
// escape is break-glass. The previous skill text asked for a ~6-line stableStringify to be
// reproduced by hand; ticketNormalise is ~100 lines and reproducing it by hand would guarantee the
// drift. One definition, called by both, removes the failure mode instead of documenting it.
//
// Read-only by construction: it parses a file, hashes, prints, exits. No fs write, no network. Exits
// 3 and prints NOTHING to stdout when the payload cannot be read end to end -- the same verdict the
// hook reaches -- so the skill cannot invent a hash for a payload that is going to be hard-blocked.
function ticketHashCli(argv) {
  const file = argv[argv.indexOf('--ticket-hash') + 1];
  if (!file) {
    process.stderr.write('ticket-hash: usage: node auto-approve.js --ticket-hash <payload.json>\n');
    return process.exit(3);
  }
  let ti;
  try {
    ti = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    process.stderr.write('ticket-hash: cannot read ' + file + ' as JSON.\n');
    return process.exit(3);
  }
  let norm;
  try { norm = ticketNormalise(ti); } catch (e) { norm = { ok: false, why: 'normalise-threw' }; }
  if (!norm.ok) {
    process.stderr.write('ticket-hash: this payload cannot be read end to end (' + (norm.why || 'unknown') +
      '). The hook will hard-block it, so do NOT mint a pass -- re-issue the call in the ordinary shape.\n');
    return process.exit(3);
  }
  process.stdout.write(sha256Hex(stableStringify(norm.root === undefined ? null : norm.root)) + '\n');
  return process.exit(0);
}

// /vet-ticket has to call the CLI above once per ticket. Deferring that call would raise a SECOND
// permission dialog per mint and defeat the one-approval-per-card-list design that is the whole
// point of the gate, so this exact invocation is approved outright.
//
// The script path is pinned to THIS FILE via __filename, which is load-bearing rather than tidy:
// without it, `node <any>\auto-approve.js --ticket-hash x.json` would be approved, and since edits
// inside Erez's project folders are themselves auto-approved, that would be arbitrary code execution
// with no prompt anywhere in the chain. Both paths must be quoted and free of every shell
// metacharacter, so nothing can be chained, expanded or redirected onto the end. Reading an
// arbitrary .json file and printing a hash of it is the entire blast radius that remains.
function isSafeTicketHash(command) {
  if (typeof command !== 'string' || /[\r\n]/.test(command)) return false;
  const m = command.trim().match(
    /^(?:&\s+)?"?node(?:\.exe)?"?\s+"([^"<>|&;`$]+auto-approve\.js)"\s+--ticket-hash\s+"([^"<>|&;`$]+\.json)"$/i
  );
  if (!m) return false;
  return m[1].replace(/\//g, '\\').toLowerCase() === String(__filename).replace(/\//g, '\\').toLowerCase();
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

// GEN-508: the shared content-hash CLI, handled before the stdin listener is attached because it
// takes its payload from a file argument rather than from the hook envelope. ticketHashCli always
// process.exit()s, so nothing below runs in that mode. Unreachable in normal PreToolUse operation,
// where argv carries no flags at all.
if (process.argv.indexOf('--ticket-hash') !== -1) ticketHashCli(process.argv);

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

  // GEN-562: fail-closed copy/move guard. Runs immediately AFTER enforceVetting so a copy carrying a
  // valid pass is approved+consumed (and process-exits) there first; this guard then hard-blocks (exit
  // 2) any remaining shell copy/move whose destination cannot be proven a non-protected concrete path
  // -- closing the silent-write leak a fall-through-to-prompt leaves under bypass-permissions. Honors
  // break-glass (configUnlocked checked first).
  enforceCopyMoveFailClosed(tool, input.tool_input, input.tool_input && input.tool_input.command, input.cwd);

  // GEN-485: check-before-present lock for rule/skill/CLAUDE.md edits. Runs before the allow-list so
  // an allow entry cannot bypass it; a verified mechanical-only fix DEFERS to the normal confirmation
  // prompt (GEN-495: no longer silently approved), a non-mechanical edit consumes a one-time check pass
  // on match (approve) or hard-blocks (exit 2) on miss, and anything with no check-due target falls
  // through. Target-anchored (fail-safe), same as enforceVetting.
  enforceCheckDue(tool, input.tool_input, input.tool_input && input.tool_input.command, input.cwd);

  // GEN-508: ticket-quality gate for Notion Team-Tasks writes. Runs before the allow-list so an
  // allow entry cannot bypass it; consumes a one-time ticket pass on match (approve), hard-blocks
  // (exit 2) on an in-scope write with no pass, falls through otherwise. Payload-anchored: a create
  // and a move-in carry their own Team-Tasks target, an edit/duplicate resolves the page (unknown ->
  // block, per GEN-508; a defer would be silently approved under bypass-permissions).
  enforceTicketVetting(tool, input.tool_input);

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
    if (isSafeTicketHash(cmd)) return approve('Auto-approved: shared ticket contentHash CLI (GEN-508)');
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
