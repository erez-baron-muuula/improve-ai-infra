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
 *   - GEN-641 narrows the "defer silently" stance above in ONE place: once a
 *     pass-gate has already MATCHED the call as one it governs, a command shape
 *     the scanner cannot read (multi-line, substitution, unbalanced quote,
 *     internal scan error) is REFUSED (exit 2), not deferred -- a deferral is a
 *     silent approve whenever the ambient permission mode is bypassPermissions.
 *     "Matched" is deliberately weaker than "resolved a real write target": see
 *     the staging caveat in blockUnreadableGatedCommand's own comment.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');                              // GEN-508: review-record contentHash

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
  // (same channel inject-shell-refs.js uses). Two call sites pass an argument: the
  // SHELL_TOOLS defer (the GEN-488 redirect nudge) and the GEN-508 ticket-gate
  // break-glass advisory (ticketBreakGlassSkip); every other call site is argument-less.
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
  // GEN-508 piece 2 adds notion-rest-write.ps1 here, together with the REST arm that pins its bytes.
  // It is NOT listed while that arm is unwired: protecting a path this hook does not yet depend on
  // would buy nothing and would block the script's own creation, since PROTECTED_FILES is matched on
  // the path whether or not the file exists.
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

// ---- GEN-641: a gated command the scanner cannot read is REFUSED, not waved through ----------
// Called by enforceStaging / enforceVetting / enforceCheckDue ONLY AFTER that gate has matched the
// call as one it governs -- a RESOLVED protected/check-due target for the latter two, an identified
// Atlassian mutating write for staging. So this does NOT block the merely-unidentified: the file's
// usual fail-safe stance stays, and an unrecognized write shape still yields no target and falls
// through. What it blocks is a call the gate already owns whose surrounding command cannot be proven
// to contain nothing else.
//   Narrow caveat for staging, stated because the contract above does not cover it: its sandbox
//   EXEMPTION (commandReferencesSandbox) is evaluated AFTER this point, so an unreadable command that
//   only touches the sandbox is refused too. That ordering is deliberate -- a multi-line command can
//   name a sandbox key on one line and write a production page on another -- and its call site
//   honours break-glass for THIS block only, so the false positive is always clearable.
//
// Why the stance is inverted here. The three sites used to `return` on the comment "AMBIGUOUS ->
// prompt". A prompt only happens in a permission mode that gives one, and the permission mode is
// ambient and mutable: in a session running under bypassPermissions a PreToolUse fall-through is a
// silent approve, so these gates enforced nothing there while appearing to. exit(2) refuses in every
// mode. (GEN-641 holds the measurement; deliberately not restated here as a count, which would go
// stale in the file.) Same must-not-leak reasoning GEN-562's copy/move guard already applies here:
// can't-prove-safe = BLOCK.
//
// A remedy must always exist, or a refusal becomes a lock-out. Two shapes cover every sanctioned
// apply: (1) re-issue the write as ONE single-line command; (2) where the CONTENT itself spans lines
// -- a PowerShell here-string payload cannot be made single-line, and the global CLAUDE.md prescribes
// exactly that form for text containing a literal `$` -- put the content in a temp file and apply it
// with `update-config.ps1 -File <name> -Op write-file -ContentFile <path>`, which is single-line by
// construction. Break-glass stays the last resort for a wedged session.
function blockUnreadableGatedCommand(verdict, gateLabel, remedy) {
  const why = verdict === 'MULTILINE'
    ? 'it spans multiple lines, so the gate cannot prove the gated write is the only command in it'
    : verdict === 'SCAN-ERROR'
      ? 'the gate hit an internal error while scanning it, so it cannot prove what the command runs'
      : 'it contains shell substitution, a heredoc, or an unbalanced quote the scanner cannot ' +
        'resolve, so the gate cannot prove what the command runs';
  process.stderr.write(
    'Refused (' + gateLabel + '): the gate cannot read this command with certainty (' + why +
    '), so it cannot be matched against the single-use pass this write requires. ' + remedy +
    ' Issue the gated write as ONE single-line command with literal (not variable or substituted) ' +
    'paths, and put anything else -- capturing an exit code, a follow-up check -- in its own tool ' +
    'call. If the CONTENT being written spans lines (e.g. a PowerShell here-string payload), put it ' +
    'in a temp file and apply it with `-Op write-file -ContentFile <path>`, which is single-line by ' +
    'construction.\n'
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
    // GEN-508 second-review fix: `null` is valid JSON, so the parse above SUCCEEDS and leaves
    // `pass === null`; `pass.expires` then throws a TypeError that nothing on this path catches. An
    // uncaught throw here exits non-2, which is not a refusal -- the gated call proceeds, and keeps
    // proceeding for every call this gate covers until the file is deleted by hand. Verified live
    // before this fix (exit 1, no refusal on stderr) and after (refusal restored). `[]`, `0` and
    // `false` never threw: they box or return undefined, so only `null` reaches the TypeError.
    // This guard is the one line in this change that touches PRE-EXISTING code, deliberately: the
    // same reader serves the staging, vetting and check-due pass dirs, so the fail-open was live in
    // all three before GEN-508 added a fourth caller.
    if (!pass || typeof pass !== 'object') continue;
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
    // consumed. GEN-641: MULTILINE/AMBIGUOUS/SCAN-ERROR also hard-block (pass untouched) rather than
    // returning -- a return here is a silent approve under bypassPermissions, see
    // blockUnreadableGatedCommand. The Atlassian write is already identified at this point.
    let chainVerdict;
    try {
      chainVerdict = /[\r\n]/.test(String(command)) ? 'MULTILINE' : scanChain(command, tool).verdict;
    } catch (e) {
      chainVerdict = 'SCAN-ERROR';
    }
    if (chainVerdict === 'CHAINED') {
      process.stderr.write(
        'Refused: a command that chains other commands (; && ||) onto an Atlassian write cannot ' +
        'consume a staging pass -- the chained part would be approved sight-unseen. Issue the ' +
        'Atlassian write as its own single tool call, then the other command(s) separately.\n'
      );
      process.exit(2);
    }
    if (chainVerdict !== 'NO-CHAIN') {
      // GEN-641: break-glass clears THIS block only. enforceStaging deliberately has no global
      // break-glass -- a pass-MISS must stay unbreakable, since that is Erez's content approval. But
      // this refusal is mechanical (unreadable command shape), not a content judgment, and
      // isAtlassianMutatingHttp text-matches the WHOLE command, so a multi-line command that merely
      // quotes an Atlassian URL plus a curl data flag (e.g. a heredoc writing notes about a REST
      // call) lands here without writing anything to Jira/Confluence at all. Leaving that
      // unclearable would be a new lock-out with no escape; blockStaging below is untouched.
      if (configUnlocked()) return;
      // `return` the call, not just call it: terminal today (the helper exits), and if the helper
      // ever stops exiting this fails to a DEFER instead of falling into the pass lookup below.
      return blockUnreadableGatedCommand(chainVerdict, 'staging lock',
        'Draft on the claude-sandbox, or re-issue the Atlassian write on its own. If this command is ' +
        'NOT actually writing to Jira/Confluence and only quotes an Atlassian URL in text it writes ' +
        'elsewhere, do not reissue it as a shell command at all -- write the file with the Edit or ' +
        'Write tool, which this gate does not touch.');
    }
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
  // through sight-unseen). CHAINED -> hard-block. GEN-641: MULTILINE/AMBIGUOUS/SCAN-ERROR also
  // hard-block rather than returning -- the protected target is already resolved at this point, and a
  // return here is a silent approve under bypassPermissions. See blockUnreadableGatedCommand.
  if (SHELL_TOOLS.has(tool)) {
    let verdict;
    try {
      verdict = /[\r\n]/.test(String(command)) ? 'MULTILINE' : scanChain(command, tool).verdict;
    } catch (e) { verdict = 'SCAN-ERROR'; }
    if (verdict === 'CHAINED') {
      process.stderr.write(
        'Refused: a command that chains other commands (; && ||) onto a hook/script write cannot ' +
        'consume a vetting pass -- the chained part would be approved sight-unseen. Issue the write ' +
        'as its own single tool call.\n'
      );
      process.exit(2);
    }
    if (verdict !== 'NO-CHAIN') {
      // `return` the call, not just call it: terminal today (the helper exits), and if the helper
      // ever stops exiting this fails to a DEFER instead of falling into the pass lookup below.
      return blockUnreadableGatedCommand(verdict, 'vetting lock',
        "Re-issue the hook/script write on its own -- /vet-code's Apply step already requires " +
        'exactly this single-line shape.');
    }
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
  // panel). CHAINED -> hard-block. GEN-641: MULTILINE/AMBIGUOUS/SCAN-ERROR also hard-block rather
  // than returning -- the check-due target is already resolved at this point, and a return here is a
  // silent approve under bypassPermissions. See blockUnreadableGatedCommand. This runs BEFORE the
  // mechanical-defer lane below, which is why an unreadable command can never ride that lane either.
  // (Shell writes are also never classified mechanical now, but this ordering is the structural
  // guarantee, not that fact.)
  if (SHELL_TOOLS.has(tool)) {
    let verdict;
    try {
      verdict = /[\r\n]/.test(String(command)) ? 'MULTILINE' : scanChain(command, tool).verdict;
    } catch (e) { verdict = 'SCAN-ERROR'; }
    if (verdict === 'CHAINED') {
      process.stderr.write(
        'Refused: a command that chains other commands (; && ||) onto a rule/skill/CLAUDE.md write ' +
        'cannot consume a check pass -- the chained part would be approved sight-unseen. Issue the ' +
        'write as its own single tool call.\n'
      );
      process.exit(2);
    }
    if (verdict !== 'NO-CHAIN') {
      // `return` the call, not just call it: terminal today (the helper exits), and if the helper
      // ever stops exiting this fails to a DEFER instead of falling into the mechanical lane below.
      return blockUnreadableGatedCommand(verdict, 'check-before-present lock',
        'Re-issue the rule/skill/CLAUDE.md write on its own; note that an -OldText/-NewText ' +
        'here-string payload is multi-line by construction and can never be gated, so a rule edit ' +
        'whose text spans lines must go via -Op write-file -ContentFile.');
    }
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

// ---- GEN-508: ticket-quality gate for Notion writes (v8) --------------------
// FOURTH sibling of the staging / vetting / check gates above, same shape: a PreToolUse guard over a
// single-use REVIEW RECORD minted (only) by a skill -- here `/vet-ticket`.
//
// WHY: Claude repeatedly files or edits Team-Tasks tickets that violate the ticket-quality rules --
// most often a body that does not stand on its own, and/or missing/wrong priority-derivation fields
// (Urgency + Gain ratio -> Priority). The behavioural self-check rule for that is skipped under
// momentum. This makes an INDEPENDENT review a precondition of the write instead of a reminder.
//
// THREAT MODEL, stated once because everything here is answered against it: this gate exists to stop
// the review being SKIPPED -- omitted under momentum, or lost across a context compaction. It is NOT
// a defence against a Claude deliberately evading a rule it knows about. Against omission, refusing
// until a verifiable record exists is sufficient: the default path hits a wall, and omission cannot
// accidentally produce a record.
//
// THE PREMISE CORRECTION THAT SHAPES EVERY BRANCH BELOW. Earlier versions rested on "the record write
// prompts Erez, and that prompt IS the human gate". Both halves are false. Every user turn carries
// permissionMode "bypassPermissions", in which a PreToolUse `ask` is SILENTLY DISCARDED and any
// fall-through is a SILENT APPROVE. And a permission prompt shows a file path and a hash -- it could
// never have distinguished a sham review from a real one. So: no branch here may end in `ask` or in a
// fall-through for an in-scope write, and the three things that replace the human gate are all
// machine-checkable -- refuse until a record exists, verify the named reviewer really ran AND
// returned PASS on THIS content, and send a disputed finding to a fresh reviewer (skill-side).
// process.exit(2) is the one verb that works in this mode; it overrides the allow-list too.
//
// UNLIKE the file-target siblings, a Notion CREATE can be gated pre-hoc: the create payload names its
// own parent data source, so there is no "must exist on disk first" anchor problem. Every arm below
// gates BEFORE the write, creates included.
//
// ---------------------------------------------------------------------------------------------
// WHAT v8 DELETED, because a maintainer reading git history needs to know these are gone on purpose
// and must not come back:
//   * THE PAGE RESOLVER and its network call. "The collapse", 2026-08-03: Erez asked whether Notion
//     pages can simply be treated as tickets. Measured -- 307 of 318 edited pages are live Team-Tasks
//     rows, and exactly ONE of 1,081 references is a genuine non-ticket page (0.09%) -- so treating
//     every page as a ticket costs about one over-gated write in a thousand. The resolver existed
//     only to avoid that cost, and it dragged in everything below.
//   * THE PARENT CACHE and both its TTLs. A cache is only worth holding for a GATING-REMOVING fact,
//     and under "every page is a ticket" learning that a page IS a ticket changes no branch. The one
//     gating-removing fact left is the GEN-58 log subtree, which is a plain id list (see below).
//   * THE RESOLVE BUDGET, the "unknown" verdict and the slow-hook race exposure -- all of them
//     existed to manage resolver latency on a blocking path that no longer makes any call.
//   * THE BATCH `targets[]` ARRAY, its partial-consumption machinery, the claim-by-rename rewrite and
//     the 3-attempt retry loop. The batch array existed only to collapse N permission dialogs into
//     one, and there is no dialog. One record is one write; consumption is a plain rename.
// NET: this arm makes NO subprocess call and NO network call on ANY path. That is asserted by the
// test suite, not just claimed here, because it is what keeps the arm in the class verified to block.
//
// ---------------------------------------------------------------------------------------------
// SCOPING IS PAYLOAD-SHAPE-INDEPENDENT. Two consecutive code-review rounds each found a fresh silent
// bypass of the SAME class: the old layer read specific field paths taken from the published tool
// schema, and real traffic does not always put the fields there. Measured against 1,313 complete
// payloads from the session transcripts, the field-path approach silently approved: a whole payload
// re-serialised inside `{data: "<json>"}` (13), a create whose `parent` is nested inside `pages[0]`
// (3), `{__unparsedToolInput: {raw, len}}` (3), a parent given as `{data_source_url:
// "collection://<id>"}` whose key contains no "id" at all (3), an inner payload keyed `pageId` with
// no `command` (1), and an entirely different inner schema (1). So: NO stage below reads a field path.
//
// THE MCP PATH, in order:
//   1  NORMALISE  ticketNormalise() walks the payload, parses any embedded JSON string, hoists a
//                 single-key envelope, and collects every string / key / id-ish value under a budget.
//                 `ok === false` means WE COULD NOT SEE THE WHOLE PAYLOAD -> HARD BLOCK. This is the
//                 fail-closed anchor: every later stage may conclude "out of scope" ONLY because
//                 stage 1 guarantees it read everything.
//   2  HOUSEKEEP  a CLOSED-SHAPE exemption for pure workflow-metadata property edits. Runs FIRST of
//                 the classifiers so a Status change can never be blocked by anything about the
//                 exemption file.
//   3  EXEMPT     the GEN-58 log-subtree carve-out, keyed on PAGE IDENTITY (a hardcoded id plus a
//                 local list), never on what an append "ought to look like".
//   4  MARKER     search EVERY collected string for a Team-Tasks id, dash- and case-insensitively.
//   5  IDS        every page id is a ticket; zero-ids splits into two different verdicts.
//
// THE SHELL PATH is §4.5 and is a different mechanism entirely -- see its own header below.
//
// CONTENT HASH: a record binds on `contentHash` ALONE, and on the MCP path the hash is of the
// NORMALISED, HOISTED payload -- `sha256Hex(stableStringify(ticketNormalise(tool_input).root))`. One
// tool call is one payload is one hash, so the hash already identifies the write exactly and `target`
// is only a human-readable label. Hashing the normalised root (not the raw input) is what makes the
// plain and `{data:"..."}`-enveloped forms of the same call hash identically; without the hoist every
// enveloped call would fail to match a record minted from the drafted object. The single shared
// definition is reachable from outside via the `--ticket-hash` CLI at the bottom of this section,
// which is what `/vet-ticket` calls -- so the skill CANNOT drift from the hook.
//
// MAINTENANCE: the Notion MCP server UUID, the Team-Tasks ids, the GEN-58 page id, the housekeeping
// property names and the pinned script hash are hardcoded -- the same latent-rotation risk the
// sibling Notion hooks document. If ticket writes ever stop being gated, re-check these first. The
// housekeeping list rotates SAFELY (an unknown property name becomes substance, i.e. more gating);
// the Team-Tasks marker pair does NOT -- if the data source is ever replaced, the marker scan stops
// firing and creates into the new one read as out of scope.
const TICKET_PASS_DIR = path.join(STAGING_DIR, 'ticket-passes');
const TICKET_EVENTS_LOG = path.join(STAGING_DIR, 'ticket-gate-events.jsonl');
// The ONE gating-removing fact held on disk (see readExemptPages for its bound).
const TICKET_EXEMPT_FILE = path.join(STAGING_DIR, 'ticket-gate-exempt-pages.txt');
const TICKET_EXEMPT_CAP = 4096;
const NOTION_MCP_PREFIX = 'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__';
const NOTION_CREATE_TOOL = NOTION_MCP_PREFIX + 'notion-create-pages';
const NOTION_UPDATE_TOOL = NOTION_MCP_PREFIX + 'notion-update-page';
const NOTION_DUPLICATE_TOOL = NOTION_MCP_PREFIX + 'notion-duplicate-page';
const NOTION_MOVE_TOOL = NOTION_MCP_PREFIX + 'notion-move-pages';
// GEN-508 BLOCKING 2: the content hash folds a canonical, prefix-independent TOOL TAG, so a record
// minted for one tool cannot be spent on the same payload under another. This is load-bearing rather
// than tidy: notion-duplicate-page SPAWNS a live ticket, and both duplicate-page and update-page
// declare additionalProperties:{} and require only their own keys, so one object is schema-valid for
// both -- an update record cleared a duplicate write until the tool entered the hash. The tag is the
// SHORT operation name, not the full mcp__<uuid>__ tool string, so (a) /vet-ticket can name it without
// knowing the server id, and (b) the --ticket-hash allow-list regex can pin it to a fixed enum with no
// metacharacters. ticketToolTag maps the hook's full tool name; the --ticket-hash CLI takes the tag
// directly (validated against TICKET_TOOL_TAGS). ONE tag string is folded by both call sites, so the
// hook and the skill cannot drift on it -- the same one-definition-called-by-both argument the hash
// assembly already makes.
const TICKET_TOOL_TAG = {
  [NOTION_CREATE_TOOL]: 'create',
  [NOTION_UPDATE_TOOL]: 'update',
  [NOTION_DUPLICATE_TOOL]: 'duplicate',
  [NOTION_MOVE_TOOL]: 'move'
};
const TICKET_TOOL_TAGS = new Set(['create', 'update', 'duplicate', 'move']);
// Full tool name -> canonical tag. The hook only ever calls this for the four gated tools (isMcp is
// checked first), but an unmapped value falls back to its raw string so it still produces a DISTINCT
// hash rather than silently colliding with a canonical tag.
function ticketToolTag(tool) {
  return TICKET_TOOL_TAG[tool] || String(tool == null ? '' : tool);
}
// The four gated tools are the complete set of Notion MCP tools that can create or materially change
// a Team-Tasks ROW. The other six mutating tools are scoped out with a stated reason rather than left
// unnoticed: notion-update-data-source is schema-only (its grammar is ADD/DROP/RENAME/ALTER COLUMN
// plus title/description/in_trash/is_inline -- it cannot write a row's values; its destructive subset
// is already ask-gated by notion-schema-guard.js, which under bypassPermissions means NOT gated at
// all -- a named residual closed by piece 2); notion-create-comment touches neither body nor
// properties; notion-create-database creates a container, not a row; notion-create-view /
// notion-update-view change display only; notion-create-attachment attaches a file.
// Team-Tasks: REST database id + MCP collection (data source) id, dashless lowercase.
const TEAM_TASKS_IDS = new Set(['fe198002661848d7ae0456f8cee479f3', 'bd2cd17bf58f49938b95468e881272fa']);
// GEN-58 (QA Layer 5). The ticket page itself is hardcoded; its log-volume children roll over every
// ~25 write-ups and live in TICKET_EXEMPT_FILE, maintained by /vet-ticket's GEN-58 lane.
const GEN58_PAGE_ID = '36d6e495d07c816e9e0cce265d694ab3';
//
// HOUSEKEEPING = pure workflow metadata. FIVE fields, and the count is the point: an earlier draft
// listed TEN, while Erez's settled decision names three categories ("status / labels / assignee"), so
// seven had been added by my own judgment and never surfaced to him as a judgment call. Measurement
// settled the rest rather than judgment:
//  - `Reason` is a select with exactly three workflow options (not defined / Event Pending / Ticket
//    Pending), so it cannot carry substance. Settled by TYPE. It is the only one Erez did not name.
//  - `Due Date`, `Remind me (days before)`, `Date Created` and `ID` are DROPPED: zero occurrences
//    across 414 real property updates, i.e. exempt surface with no traffic behind it. (The last two
//    are system-managed and not writable at all.)
//  - `Parent item` MOVED TO SUBSTANCE. It is one half of a relation whose other half (`Children`)
//    was already substance, and the same graph edge written from either end has the same effect, so
//    exempting one and gating the other was indefensible. There is also a recorded destructive-op
//    incident class for writing it. Cost: 13 payloads of 414 (3.1%), each now paying one review.
//  - `Type` and `Project` stay because Erez named them ("labels"); both carry zero traffic.
//
// SUBSTANCE IS A DENY-LIST, not an allow-list: anything not named here counts as substance. An
// allow-list would silently UN-gate a field the moment a Team-Tasks property is renamed; the
// deny-list rotates the safe way, and this is DEMONSTRATED rather than asserted -- `Importance`
// appears in 164 real payloads and no longer exists in the schema (`Urgency` replaced it), and every
// such name is treated as substance.
//
// This list is stated ONCE in this file. An earlier design stated it twice, ten lines apart, and the
// two disagreed.
const TICKET_HOUSEKEEPING_PROPS = new Set(['status', 'assignee', 'type', 'project', 'reason']);
// Stage 2's closed shape: the ONLY root keys a housekeeping-exempt payload may carry. The last four
// are in the live notion-update-page schema and can be set alongside any command; omitting them made
// a Status change plus an icon gate for nothing.
const TICKET_HK_ROOT_KEYS = new Set([
  'page_id', 'pageId', 'id', 'command', 'properties', 'icon', 'cover', 'is_skill', 'allow_async'
]);
// The GEN-58 exemption's clause 5: root keys permitted on an exempt CONTENT write -- the stage-2 set
// plus the fields the four content commands carry.
//
// `content_updates` WAS MISSING, and its absence was a hard block on every real edit. Checked against
// the live notion-update-page schema on 2026-08-05: `update_content` carries its edits in
// `content_updates: [{old_str, new_str, replace_all_matches?}]`, and root `new_str` belongs to
// `replace_content` ALONE -- a command clause 2 already refuses. So a real GEN-58 log edit failed
// clause 5 on an unrecognised root key and was refused outright, against the standing rule that
// reasoning-failure entries are logged immediately. Demonstrated on the working hook: all three real
// `content_updates` shapes blocked, while the root `old_str`/`new_str` shape the suite had been
// asserting -- a shape the tool cannot receive -- fell through. An assertion over a fictional payload
// is worse than none: it is what let this survive two review rounds.
//
// Root `old_str` and `selection_with_ellipsis` are NOT in today's schema either, and are kept here
// only because removing them narrows the exemption on a surface this change did not review. Narrowing
// is the safe direction, so it is a separate change, not a silent one.
const TICKET_EXEMPT_ROOT_KEYS = new Set([
  'page_id', 'pageId', 'id', 'command', 'properties', 'icon', 'cover', 'is_skill', 'allow_async',
  'content', 'old_str', 'new_str', 'selection_with_ellipsis', 'position', 'content_updates'
]);
// `content_updates` is admitted as a CLOSED shape, for the same reason the root key set is closed: an
// unrecognised member is not evidence of harmlessness. Keys are the live schema's three; `old_str` and
// `new_str` are required there, and an element carrying neither cannot be checked for emptiness.
const TICKET_CU_KEYS = new Set(['old_str', 'new_str', 'replace_all_matches']);
// The four content commands the GEN-58 carve-out admits. `replace_content` is NOT among them: it is
// the exact form in which a real payload emptied a 6,138-character block, and clause 3 below refuses
// the flag that makes a whole-subtree wipe reachable.
//
// NOTE, 2026-08-05: only `insert_content` and `update_content` exist in today's notion-update-page
// command enum -- `insert_content_after` and `insert_content_before` do not, so two of these four
// admit a name the tool cannot currently send. Harmless today (such a payload fails at Notion), but it
// pre-exempts whatever semantics a future schema attaches to those names. Narrowing the set is the
// safe direction and is left as its own reviewed change rather than folded into this one.
const TICKET_CONTENT_COMMANDS = new Set([
  'insert_content', 'insert_content_after', 'insert_content_before', 'update_content'
]);
// Keys whose mere PRESENCE disqualifies an exempt write, with any value. Blunter than necessary and
// costs nothing today (zero occurrences in 273 subtree writes); if a future Notion client starts
// sending `allow_deleting_content: false` defensively, narrow to truthy values rather than removing.
const TICKET_DESTRUCTIVE_KEYS = new Set(['archived', 'in_trash', 'allow_deleting_content']);
// id-ish keys whose value names a CONTAINER (a database / data source), not a page. `data_source_url`
// is listed for completeness; its key name contains no "id", so it never reaches the id split at all
// and is covered by the marker scan instead.
const TICKET_CONTAINER_ID_KEYS = new Set(['data_source_id', 'database_id', 'data_source_url', 'collection_id']);
// Stage 1 budgets. Exceeding ANY of them sets ok = false, which hard-blocks.
const TN_MAX_DEPTH = 12;
const TN_MAX_NODES = 4000;
const TN_MAX_STRING_BYTES = 2 * 1024 * 1024;
const TN_MAX_UNWRAP = 8;
const TN_CPU_DEADLINE_MS = 2000;
// Known envelope key names. This one list IS a list of known names; the invariant that makes it safe
// -- and that a maintainer must re-check before ever adding a name -- is that the hoist can only
// discard a SOLE root key, and no name here is a field of any gated tool's schema (verified against
// the four live schemas and all 1,313 corpus payloads: `data` and `raw` occur only as envelopes,
// `input` and `arguments` never occur). Failing to hoist an unknown future wrapper is the SAFE
// direction: it is still walked, so the marker scan sees through it, and the only cost is a record
// that no longer matches -- which blocks. Hoisting something that is NOT a wrapper is the unsafe
// direction, because stage 2 reads the hoisted root, and the invariant rules that out.
const TN_ENVELOPE_KEYS = new Set(['data', 'raw', 'input', 'arguments', '__unparsedToolInput']);
// Shared caps. The body cap is the same 2 MB the normaliser uses for payload strings; nothing
// truncates -- an over-cap body is a hard block, because a truncated body would be hashed as
// something Notion never receives.
const TICKET_BODY_CAP_BYTES = 2 * 1024 * 1024;
const TICKET_TRANSCRIPT_CAP_BYTES = 4 * 1024 * 1024;
// GEN-508 expiry CEILING: the maximum distance into the FUTURE a ticket record's `expires` may sit from
// now. The skill mints now+15min; this cap sits generously above that so a freshly-minted pass is never
// falsely rejected, while a far-future expiry (a 2099 record was honoured indefinitely) is. It is the
// UPPER bound; findPassInDir enforces only the lower bound (already-expired -> not returned). Enforced in
// the ticket-scoped path, NOT in findPassInDir -- that shared reader also serves longer-TTL sibling
// passes (staging / vetting / check-due, incl. /vet-code's) that a ticket-sized cap would lock out.
const TICKET_MAX_TTL_MS = 20 * 60 * 1000;
// GEN-508 closed-shape: the COMPLETE set of keys a ticket PASS may carry. enforceTicketVetting refuses a
// matched pass with any key outside this set (reason unknown-record-key), closing the "field written and
// read by nothing" class -- a pass whose extra field the hook silently ignores is drift or tampering,
// not a shape /vet-ticket mints. This governs ONLY the kind:"ticket" PASS the hook reads; the audit-trail
// RECORD (kind:"ticket-record", carrying capturedFindings / priorReviewerAgentIds / etc.) is a different
// object the hook never reads -- it has no `expires`, so findPassInDir skips it, and its kind is not
// "ticket". The /vet-ticket Step-5 mint template writes exactly these keys; the contract test pins that.
const TICKET_PASS_KEYS = new Set(['kind', 'surface', 'contentHash', 'reviewerAgentId', 'verdict', 'waived', 'target', 'expires']);

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function sha256HexBuf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Dashless lowercase 32-hex, or '' if the value is not a Notion id.
function normNotionId(v) {
  const s = String(v == null ? '' : v).replace(/-/g, '').trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(s) ? s : '';
}

// Strip the qualifier forms notion-update-page uses for some property types
// (`date:Due Date:start`, `userDefined:ID`, `place:X:latitude`) down to the bare property name.
// A SUFFIXED RELATION KEY such as `Related to Team-Tasks (Parent item)` does NOT reduce to
// `Parent item` and is therefore substance -- which is correct, and is also the form
// notion-schema-guard's matcher looks for.
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
//   strings  every string encountered, key or value, parsed wrapper text included.
//   keys     the set of every object key name in the tree (used to tell a content write from a
//            property write without reading a field path).
//   idish    every string value reached under a key whose name contains "id", tagged with the
//            nearest such key name.
//
// ok === false is a HARD BLOCK, never a fall-through. It means we could not read the payload end to
// end, so we cannot claim it is out of scope. Under bypassPermissions a fall-through would be a
// SILENT APPROVE of an unreviewed ticket write.
//
// SECURITY PROPERTIES, not style:
//  - the walk REBUILDS the tree rather than mutating `tool_input`, so nothing here can perturb the
//    guards that run after this one, and reconstructed objects are `Object.create(null)` so that a
//    payload key of `__proto__` becomes an ordinary own property instead of touching a prototype.
//  - NO plain object anywhere in this layer is keyed by payload-derived data (the page cache that
//    used to be the one exception is deleted); payload-keyed collections are Set/Map.
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
  // payloads carry ordinary body text opening with a markdown link or a bracketed tag, two of them
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
        // buried one level under `page_id` is still collected. Over-collecting only costs more
        // gating; under-collecting would be a fail-open.
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

  // Envelope hoisting. The walk substitutes a parsed wrapper IN PLACE, so a top-level
  // `{data:"<json>"}` becomes `{data:{...}}` -- the wrapper key survives and the enveloped and plain
  // forms of the same call do NOT produce the same tree. The marker scan does not care (it reads the
  // whole tree either way) but stage 2 and the content hash both read the root, so the wrapper goes.
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
// The ONE path that lets a Team-Tasks write through with no record on the property side, so it is
// written as a closed shape: exempt only on an exact match, and ANYTHING unrecognised gates.
//
// The captured alternate schema `{pages:[{id, properties:{Status}, content:{...edits}}]}` fails
// clause 1 on its root key `pages` and is gated, as it must be.
//
// A key spelled `Properties` or `props` is simply not in the permitted set, so it gates. There is no
// longer any branch anywhere in which an unrecognised key name REDUCES gating.
//
// The `update_verification` exemption an earlier design carried is dropped: zero occurrences in
// 1,313 payloads, i.e. exempt surface with no traffic behind it.
function ticketIsHousekeepingOnly(R) {
  if (!R || typeof R !== 'object' || Array.isArray(R)) return false;
  const keys = Object.keys(R);
  // 1 -- every root key is permitted. An unknown key anywhere at the root fails.
  for (const k of keys) if (!TICKET_HK_ROOT_KEYS.has(k)) return false;
  // 2 -- a command, if present, is exactly update_properties.
  if (keys.indexOf('command') !== -1 && R.command !== 'update_properties') return false;
  // 3 -- properties must EXIST and be a plain object, and every key of it must be housekeeping
  // after the qualifier strip.
  if (keys.indexOf('properties') === -1) return false;
  const props = R.properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return false;
  for (const pk of Object.keys(props)) {
    if (ticketPropIsSubstance(pk)) return false;
    // 4 -- no nested object, which is what a content structure looks like. `null` counts as a
    // primitive: real housekeeping edits clear a relation with `"Assignee": null`, and a naive
    // `typeof v !== 'object'` test would exclude them (typeof null === 'object').
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

// ---- the GEN-58 exemption: the one gating-removing fact held on disk --------
// Erez's settled rule (2026-08-03, "I choose A"): exempt every content-bearing write within the
// GEN-58 subtree; keep property edits on the GEN-58 ticket ROW itself gated normally. A standing
// global rule requires those log writes "immediately, as each instance is identified" and exempts
// them from the draft-for-approval pause -- and the bar this gate enforces ("the body stands on its
// own", "the priority fields are derived") is a TICKET bar that does not apply to a log body.
//
// KEYED ON PAGE IDENTITY, not on what an append ought to look like. Two earlier attempts to
// characterise "a log append" semantically were both falsified against real traffic (5% and 15%
// coverage of 159 writes) before Erez stopped the third attempt.
//
// THIS REVERSES THE DESIGN'S OWN CACHE-INTEGRITY PRINCIPLE ("never hold a fact that DECREASES
// gating"), deliberately, and the BOUND is what makes it acceptable rather than the location: under
// bypassPermissions a file write is silently allowed anywhere, so NO path gives this file any
// integrity protection, and two earlier versions that reasoned "outside ~/.claude => prompted =>
// safe" were void. The bound:
//   * an entry un-gates CONTENT-COMMAND writes on exactly the one page it names -- including a real
//     ticket, if a wrong id is ever appended. It can never un-gate a property edit, a destructive
//     command, or anything on any other page.
//   * the file is append-only and READ-ONLY TO THIS HOOK. The hook never writes it; /vet-ticket's
//     GEN-58 lane is the single writer, and it verifies parentage over the network first.
//   * its contents are SURFACED, not silent: /wrap reports the entry count and any ids added since
//     the last report, with a re-evaluate bar at 90% of the cap.
//
// -> {ok, why, ids:Set}. ok === false is a HARD BLOCK with its own reason, never a silent
// truncation: a gate that cannot read its own exemption list must stop, not guess. The cap is 4,096
// (not the 128 an earlier draft used, which was a latent DEADLOCK -- once full, a new volume stops
// being recognised, and the design's own escape re-appends and re-fails forever).
function readExemptPages() {
  let text;
  try {
    text = fs.readFileSync(TICKET_EXEMPT_FILE, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    // A MISSING file is not an error: it is the ordinary state before the first volume rollover.
    if (e && e.code === 'ENOENT') return { ok: true, why: '', ids: new Set() };
    return { ok: false, why: 'unreadable', ids: new Set() };
  }
  const ids = new Set();
  const lines = text.split(/\r?\n/);
  for (const ln of lines) {
    const s = ln.trim().toLowerCase();
    if (s === '') continue;
    // "exactly 32 hex characters" -- no dash tolerance and no case normalisation beyond lowercasing
    // the line, which is what /vet-ticket writes. Anything else is ignored rather than rejected, so
    // a comment or a stray blank cannot break the list.
    if (!/^[0-9a-f]{32}$/.test(s)) continue;
    ids.add(s);
    if (ids.size > TICKET_EXEMPT_CAP) return { ok: false, why: 'over-cap', ids: ids };
  }
  return { ok: true, why: '', ids: ids };
}

function ticketIdIsExempt(id, exempt) {
  return id === GEN58_PAGE_ID || exempt.ids.has(id);
}

// A write that touches the body and no database property. Decided from the KEY SET of the whole
// normalised tree, not a field path, so the alternate inner schema (whose `properties` sits inside
// `pages[0]`) is correctly seen as property-bearing and stays gated even on the GEN-58 page.
function ticketIsContentOnly(norm) {
  return !norm.keys.has('properties');
}

// Does any key ANYWHERE in the normalised tree name a destructive flag? Key-scoped on purpose:
// GEN-58 write-ups routinely contain the WORD "archived" in prose, so a substring scan over text
// would gate ordinary log appends.
function ticketHasDestructiveKey(norm) {
  for (const k of norm.keys) if (TICKET_DESTRUCTIVE_KEYS.has(String(k).toLowerCase())) return true;
  return false;
}

// Clause 4, over the WHOLE normalised tree rather than the root. Written this way because naming a
// field path is the precise mistake that produced this defect, and the same mistake the 2026-08-03
// scoping rebuild already removed from stage 1: root `new_str` is unreachable for all four admitted
// commands, so the original root-only test could never fire once, while the emptying edit it existed
// to catch sat one level down in `content_updates[]`. Adding `content_updates` to the permitted root
// keys WITHOUT this would have made an emptying edit exempt -- a wipe path opened by the fix for a
// block. The two must change together.
//
// Any nesting a future schema invents is covered, and the walk fails CLOSED on anything it cannot
// read, including its own depth guard. Termination is not an assumption: this walks the normaliser's
// OUTPUT, which is bounded to TN_MAX_DEPTH deep and TN_MAX_NODES wide and is a freshly-built tree
// (every node is a new object), so it cannot carry a cycle from the input.
function ticketNoEmptyNewStr(node, depth) {
  if (depth > TN_MAX_DEPTH + 2) return false;
  if (Array.isArray(node)) {
    for (const v of node) if (!ticketNoEmptyNewStr(v, depth + 1)) return false;
    return true;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (k === 'new_str' && (typeof v !== 'string' || v.trim() === '')) return false;
      if (!ticketNoEmptyNewStr(v, depth + 1)) return false;
    }
    return true;
  }
  return true;                                                    // scalar: nothing to check
}

// Clause 6. Absent `content_updates` is fine (`insert_content` does not carry it); present, it must be
// the exact live-schema shape. An `update_content` with no `content_updates` at all is malformed for
// the tool and unrecognised here, so it gates -- the carve-out exempts a shape it recognises, never a
// shape it merely failed to reject.
function ticketContentUpdatesOk(R) {
  const has = Object.prototype.hasOwnProperty.call(R, 'content_updates');
  if (!has) return R.command !== 'update_content';
  const cu = R.content_updates;
  if (!Array.isArray(cu) || cu.length === 0) return false;
  for (const el of cu) {
    if (!el || typeof el !== 'object' || Array.isArray(el)) return false;
    for (const k of Object.keys(el)) if (!TICKET_CU_KEYS.has(k)) return false;
    if (typeof el.old_str !== 'string' || typeof el.new_str !== 'string') return false;
  }
  return true;
}

// The GEN-58 closed shape. Exempt iff ALL hold -- so anything unrecognised gates.
//  1  EVERY extracted id is the hardcoded GEN-58 id or a valid line in the file. *Every*, not *any*:
//     `any` would let a payload naming both a volume and a live ticket escape the gate. Zero of 273
//     subtree writes carry an id outside the subtree, so `every` is free.
//  2  `command` is present and is one of the four content commands.
//  3  no destructive key appears anywhere.
//  4  no `new_str` ANYWHERE in the payload is empty or whitespace-only. Costs 1 write in 273 (0.37%)
//     -- one real write legitimately empties a 6,138-character block -- so this is a genuine cost,
//     not a free win, and its escape is one /vet-ticket run. (A clause refusing a merely SHORTER
//     new_str was considered and rejected: shrinking is ordinary editing here.)
//  5  every root key is in the permitted set.
//  6  `content_updates`, the shape `update_content` really takes, matches the live schema exactly.
function ticketIsGen58Exempt(norm, pageIds, exempt) {
  if (pageIds.length === 0) return false;
  for (const id of pageIds) if (!ticketIdIsExempt(id, exempt)) return false;      // 1
  const R = norm.root;
  if (!R || typeof R !== 'object' || Array.isArray(R)) return false;
  if (!TICKET_CONTENT_COMMANDS.has(R.command)) return false;                      // 2
  if (ticketHasDestructiveKey(norm)) return false;                                // 3
  if (!ticketNoEmptyNewStr(R, 0)) return false;                                   // 4
  for (const k of Object.keys(R)) if (!TICKET_EXEMPT_ROOT_KEYS.has(k)) return false; // 5
  if (!ticketContentUpdatesOk(R)) return false;                                   // 6
  return true;
}

// ---- the marker scan (free, no network) -------------------------------------
// true (a Team-Tasks id appears somewhere in the payload) / false / null (CPU deadline -> the caller
// treats it as unreadable and blocks). Dash- and case-insensitive, anywhere in any string, which is
// the direct expression of "look for the marker in the whole payload rather than at a field path".
// It covers every create shape in the corpus -- top-level parent, nested parent, `data_source_url`,
// `collection://`-prefixed, and the truncated raw text of a `__unparsedToolInput`.
// Over-gating is possible (a body that quotes the ids in prose -- this project's own docs do) and is
// the safe direction; the GEN-58 carve-out runs FIRST precisely to spare the one case where a
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

// ---- id extraction ---------------------------------------------------------
// Every 32-hex id in a value -- dashed, bare, or inside a URL. A truncated uuid yields NOTHING,
// which is the point: it is a malformed target, not an absent one, and the caller blocks on it.
//
// A canonically dashed uuid is matched FIRST, on the raw value, because the dashes pin the id's
// boundaries exactly and no surrounding text can bleed into it. Only when there is no dashed form
// does the value get dash-stripped and scanned for hex runs -- which is what a bare id, an odd
// dashing, and a `/p/<id32>` URL all need.
//
// Measured over the 1,387 id-ish values in the corpus: 976 canonically dashed, 394 bare 32-hex, 9
// oddly dashed but still 32-hex once stripped, 6 `/p/<id32>` URLs, 2 malformed. NOT ONE dash-strips
// into a hex run longer than 32, so the ambiguous case is hypothetical -- it is handled by emitting
// the run's leading AND trailing 32-char window (a Notion share URL puts the id at the end of a
// title-derived slug), which costs one extra bounded candidate in a case that never occurs.
//
// Either error direction is safe: a missing id makes the target malformed (block) and a wrong id is
// still treated as a page (gated). Neither can produce an out-of-scope verdict.
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

// Split the id-ish values into PAGES and CONTAINERS. `sawCandidateKey` distinguishes "no target
// field at all" from "a target field that yields no valid id", which are different verdicts.
// `containerId` records whether a container was named at all, because an unrecognised container is
// a BLOCK (see the scope table) rather than an out-of-scope verdict.
function ticketSplitIds(idish) {
  const pageIds = [];
  const seen = new Set();
  let sawCandidateKey = false;
  let sawContainerKey = false;
  let containerTeamTasks = false;
  let containerReadable = false;
  for (const e of idish) {
    const ids = ticketIdsIn(e.value);
    if (TICKET_CONTAINER_ID_KEYS.has(String(e.key).toLowerCase())) {
      sawContainerKey = true;
      if (ids.length > 0) containerReadable = true;
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
  return {
    pageIds: pageIds,
    sawCandidateKey: sawCandidateKey,
    sawContainerKey: sawContainerKey,
    containerTeamTasks: containerTeamTasks,
    containerReadable: containerReadable
  };
}

// WHO READS THE EVENT LOG, stated because a log nobody reads is not a signal.
//
// Every hard-block here is SELF-SURFACING: it exits 2 and prints why, so the call stops and Claude
// has to act on it in the same turn. What is NOT self-surfacing is the AGGREGATE -- rates over a
// window -- and that is what this file exists for. Its reader is the `/wrap` line set (deliverable
// 12): waive rate, re-review rate, raw-REST blocks BY REASON with their baseline proportions, the
// `/wrap`-originated slice on its own, the "not a ticket" drift counter, the exemption-file count,
// and repeated `internal-error`. Each has a bar and prints only above it.
//
// `source` records which routine originated the write. HOOK-ORIGINATED events record
// `source: "unknown"` BY CHOICE, not by impossibility -- a session-scoped marker file that a routine
// touches and this same hook reads is an existing idiom in this codebase (isSafeLoggateTouch), so the
// hook COULD be told. It is not worth a second marker mechanism with its own orphan-cleanup, because
// the slice counters need only the skill's events, which do carry the tag. Stated so it is not
// discovered when a counter reads zero.
function logTicketGateEvent(entry) {
  try {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
    fs.appendFileSync(TICKET_EVENTS_LOG,
      JSON.stringify(Object.assign({ ts: new Date().toISOString(), source: 'unknown' }, entry)) + '\n');
  } catch (e) { /* logging must never break a tool call */ }
}

// GEN-508 #4: break-glass on the ticket gate clears ONLY a MECHANICAL block -- one where the gate could
// not read the write at all (internal-error, unreadable-payload) -- NEVER a content/auth decision
// (no-pass, stale-content, bad-target, bad-record, unknown-record-key, expiry-too-far, bad-verdict,
// reviewer-unverified, no-token/transcript-too-large, consume-failed, exempt-list-*). This mirrors
// enforceStaging, which deliberately has no global break-glass because a pass-MISS is Erez's content
// approval and must stay unbreakable. The prior `if (configUnlocked()) return` at the top of
// enforceTicketVetting voided the WHOLE gate, unlogged -- a silent, session-wide hole. Now every skip
// is LOGGED and SURFACED: a gate-void is at least as decision-worthy as a waive.
const TICKET_BREAKGLASS_REASONS = new Set(['internal-error', 'unreadable-payload']);
function ticketBreakGlassSkip(tool, target, reason) {
  logTicketGateEvent({ event: 'break-glass-skip', tool: tool, target: target, reason: reason });
  // defer() injects the advisory into the model's context AND exit(0)s -- terminal, so no other guard runs
  // and there is no double stdout write. For the four MCP write tools that reach here this is behaviourally
  // identical to the natural fall-through, PLUS the advisory the immediate-surfacing reader needs.
  return defer('NOTE (ticket-gate break-glass): config-unlock is active, so the ticket-review gate cleared ' +
    'a MECHANICAL block it could not evaluate (' + reason + ') on ' + target + ' and let this Notion write ' +
    'proceed UNREVIEWED. The gate is not evaluating writes it cannot read while break-glass is on. Surface ' +
    'this in your next "\u{1F4CC} For you" block, and turn break-glass off (env ' + UNLOCK_ENV_VAR + ' / the ' +
    '.config-unlock sentinel) once the wedged task is done. Content-review blocks (no-pass, bad-verdict, ' +
    'reviewer-unverified) are NOT cleared by break-glass -- use one /vet-ticket review + mint instead.');
}

// A short human-readable label for the block message and the audit log. NOT part of record matching
// -- that is the content hash alone -- so it is free to be readable rather than canonical.
function ticketLabel(tool, ids) {
  const short = (tool.indexOf(NOTION_MCP_PREFIX) === 0 ? tool.slice(NOTION_MCP_PREFIX.length) : tool).replace(/^notion-/, '');
  if (!ids || ids.length === 0) return short + ':in-payload';
  return short + ':' + ids.slice(0, 4).join('+') + (ids.length > 4 ? '+' + (ids.length - 4) + '-more' : '');
}

// ---- the MCP scope verdict --------------------------------------------------
// -> {scope:'out'}
//  | {scope:'in',    surface:'notion-mcp', target, hash, ids}
//  | {scope:'block', surface:'notion-mcp', target, hash, ids, reason, why}
//
// A 'block' verdict still carries a HASH wherever one can be computed, because a record must be able
// to clear it (see step 4 of the flow). An earlier version short-circuited every block before the
// record directory was read, so an unreadable-payload block could not be cleared by a record even
// though the refusal text and the skill both promised it could -- leaving break-glass as the only
// route.
//
// PURE: no network, no subprocess, no fs write. Its caller wraps it in a catch and treats a throw as
// a BLOCK.
// THE content-hash assembly, in ONE place, called by the gate and by the CLI the skill runs.
//
// It used to be stated twice, in byte-identical copies here and in ticketHashCli -- while the comment
// above that CLI argued that reproducing shared logic "would guarantee the drift" and that "one
// definition, called by both, removes the failure mode instead of documenting it". The normaliser was
// shared; this was not, so the comment overstated what the code did. A copy is not a definition, and
// what is duplicated here is a DECISION, not a formula: which value gets hashed when the payload could
// not be read end to end. If the two copies ever disagreed on that, no record the skill mints would
// match, and break-glass is the only escape from that state.
//
// When ok === false the BODY is taken over the RAW parsed input instead, by the same stableStringify.
// This matters: an earlier version emitted hash '' on an unreadable payload, so NO record could ever
// match and break-glass was the only door.
//
// GEN-508 BLOCKING 2: the digest is taken over {surface, tool:<tag>, root:<body>}, NOT the body alone,
// so the hash binds the TOOL as well as the payload. The tag MUST be folded on BOTH the ok and the
// !norm.ok paths, or the fallback digest reopens the cross-tool hole on the unreadable-payload branch.
function ticketContentHash(norm, ti, tag) {
  const body = norm.ok
    ? (norm.root === undefined ? null : norm.root)
    : (ti === undefined ? null : ti);
  return sha256Hex(stableStringify({ surface: 'notion-mcp', tool: String(tag == null ? '' : tag), root: body }));
}

function ticketScope(tool, ti) {
  // Stage 1.
  const norm = ticketNormalise(ti);
  const hash = ticketContentHash(norm, ti, ticketToolTag(tool));
  if (!norm.ok) {
    return { scope: 'block', surface: 'notion-mcp', reason: 'unreadable-payload', why: norm.why,
             target: ticketLabel(tool, []), hash: hash, ids: [] };
  }

  // Stage 2 -- free, and BEFORE the exemption file is opened at all, so a housekeeping-only property
  // edit can never be blocked by anything about that file.
  //
  // TOOL-SCOPED to update-page, which the first version of this line was not. The exemption exists for
  // a pure property edit (status / labels / assignee) on an EXISTING row; it is not a property about
  // the payload shape alone. Unscoped, it was also offered to notion-duplicate-page, where
  // `{page_id, properties:{Status}}` satisfies every clause and returned 'out' -- and a duplicate
  // SPAWNS A LIVE TICKET, which is squarely inside Erez's "create and edit" decision and is the
  // hazard the global CLAUDE.md calls out by name. create-pages and move-pages fail clause 1 on their
  // real payload shapes anyway (`parent`/`pages` and `page_or_database_ids`/`new_parent`), so this
  // scoping strictly narrows the exemption and cannot introduce a false block. The GEN-58 carve-out
  // below was already tool-scoped the same way, which is what flagged this one as the oversight.
  if (tool === NOTION_UPDATE_TOOL && ticketIsHousekeepingOnly(norm.root)) return { scope: 'out' };

  const split = ticketSplitIds(norm.idish);
  const label = ticketLabel(tool, split.pageIds);

  // Stage 3 -- the GEN-58 carve-out. The exemption file is read HERE, and its cap is checked here,
  // with its own two reasons: an unreadable or over-cap list must not fall into the generic
  // internal-error bucket, which is reserved for a genuine bug in this arm.
  const exempt = readExemptPages();
  if (!exempt.ok) {
    const reason = exempt.why === 'over-cap' ? 'exempt-list-overflow' : 'exempt-list-unreadable';
    return { scope: 'block', surface: 'notion-mcp', reason: reason, target: label, hash: hash, ids: split.pageIds };
  }
  if (tool === NOTION_UPDATE_TOOL && ticketIsContentOnly(norm) &&
      ticketIsGen58Exempt(norm, split.pageIds, exempt)) {
    return { scope: 'out' };
  }

  // Stage 4 -- the marker.
  const marker = ticketMarkerScan(norm);
  if (marker === null) {
    return { scope: 'block', surface: 'notion-mcp', reason: 'unreadable-payload', why: 'cpu-deadline',
             target: label, hash: hash, ids: split.pageIds };
  }
  if (marker === true) return { scope: 'in', surface: 'notion-mcp', target: label, hash: hash, ids: split.pageIds };

  // Stage 5 -- every page is a ticket. The table below is §4.3's, one row per branch.
  if (split.pageIds.length === 0) {
    if (!split.sawCandidateKey) {
      if (tool === NOTION_CREATE_TOOL) {
        // A create with a CONTAINER but no marker is a create into another database -- free. A
        // create with a container key whose id is unreadable is a BLOCK: that was a measured
        // fail-open (a create whose parent named an unrecognised data source was silently
        // approved), and the live tool description warns that a database with more than one data
        // source forces the caller to name a specific data_source_id -- so the day Team-Tasks gains
        // a second data source, every ticket create would have been silently approved. Zero of 263
        // create payloads have an unreadable parent, so failing closed is free.
        if (split.sawContainerKey && !split.containerReadable) {
          return { scope: 'block', surface: 'notion-mcp', reason: 'bad-target', why: 'unreadable-container',
                   target: label, hash: hash, ids: [] };
        }
        if (split.sawContainerKey) return { scope: 'out' };
        // No id-ish key and no parent key anywhere: a workspace-level create (1 real instance).
        if (!norm.keys.has('parent')) return { scope: 'out' };
        // `parent` present but no extractable id at all.
        return { scope: 'block', surface: 'notion-mcp', reason: 'bad-target', why: 'parent-without-id',
                 target: label, hash: hash, ids: [] };
      }
      // For the other three tools a target is structurally mandatory, so its absence means we
      // misread the payload rather than that the call is harmless.
      return { scope: 'block', surface: 'notion-mcp', reason: 'bad-target', why: 'no-target',
               target: label, hash: hash, ids: [] };
    }
    // A target field exists but yields no valid 32-hex (`page_id: "placeholder"`, a truncated uuid
    // -- both real in the corpus). A malformed target is not evidence of harmlessness, and it can no
    // longer REDUCE gating: a malformed id never matches an exemption entry, and the exemption
    // requires every id to match.
    return { scope: 'block', surface: 'notion-mcp', reason: 'bad-target', why: 'unparseable-id',
             target: label, hash: hash, ids: [] };
  }
  // At least one page id, no marker, not exempt: under "every page is a ticket" this is in scope,
  // with no network call and no cache. ~1 reference in 1,081 is a genuine non-ticket page, and
  // /vet-ticket's non-ticket lane is what keeps that cost off Erez.
  return { scope: 'in', surface: 'notion-mcp', target: label, hash: hash, ids: split.pageIds };
}

// ============================================================================
// ---- §4.5: the raw REST/curl arm -- BUILT, NOT WIRED (piece 2) -------------
// ============================================================================
// *** NOT WIRED: nothing in this hook reaches this arm. Do not reconnect it without the three fixes
// *** listed below. It is kept in place so piece 2 is a reconnection rather than a rebuild.
//
// Erez decided on 2026-08-04 to cover this surface in piece 1, then on 2026-08-05 to install the MCP
// surface first and defer this one. The reason for deferring is not just cost: shipping this arm as
// built would REFUSE every raw REST write with no working escape, because the pinned script is not on
// disk (so restScriptPinOk() fails for all of them) and listing its path in PROTECTED_FILES blocked
// creating it. That is worse than the pre-install state, in which the surface is simply unchecked.
//
// BEFORE RECONNECTING, three things must be true. The first is a live fail-open, not a nicety:
//   1  restJsonKeys STOPS COLLECTING at TN_MAX_DEPTH / TN_MAX_NODES and returns silently, so a
//      destructive key nested deeper than 12 levels is invisible to clause 4 of restIsGen58Exempt and
//      the write is exempted. The MCP walk calls bust() and hard-blocks on the same overflow; this
//      side must do the same -- a truncated scan is not evidence of a clean body.
//   2  /vet-ticket must document this surface -- the canonical invocation, the --ticket-hash-shell
//      step, and the notion-rest record. It currently tells the reader REST is out of scope entirely.
//   3  The pinned script must be installed AND its path re-added to PROTECTED_FILES, in that order.
//
// THE THREE ATTACHMENT POINTS removed for piece 1a, so reconnection is mechanical: the isShell branch
// in enforceTicketVetting, the --ticket-hash-shell dispatch under `main`, and the -shell mode of
// isSafeTicketHash. Everything in this section is otherwise unchanged and already reviewed.
//
// Raw REST is ~15% of Notion write traffic and carries destructive operations. It is NOT the only
// destructive surface, and an earlier version of this comment claimed it was: the MCP arm's move-out
// (which drops every database property), `replace_content`, and `allow_deleting_content` are all
// destructive, and all three ARE gated by piece 1a.
//
// WHY THIS IS NOT A COMMAND PARSER, which is the single most important comment in this section.
// FIVE successive review rounds each found a DIFFERENT way a body reached Notion that the record's
// hash did not cover: a parenthesised sub-expression, an unexpanded variable, a piped body, an
// unlisted data flag / `-K` config file / `@props` splat, and finally the ordinary prescribed form
// itself. The cause was not any one rule -- it was the MECHANISM. Understanding an arbitrary shell
// command requires having foreseen every channel a body or a URL can arrive through, including two
// that are not in the command at all (curl's `.curlrc`, PowerShell's `$PSDefaultParameterValues`).
//
// So v8 does what this file already does three times elsewhere -- isSafeSyncFromClaude,
// isSafeNotionTicketLookup, isSafeLoggateTouch -- and recognises ONE EXACT INVOCATION, anchored over
// the whole string with NO `m` flag, so an embedded newline cannot smuggle a second command past the
// check. Everything else is refused. The failure direction inverts from fail-open to over-refuse.
//
// TWO BRANCHES, AND NO THIRD:
//   A  the command REFERENCES the write script at all -> it must match the template EXACTLY, or
//      hard-block. This is the only path to a record.
//   B  otherwise -> run the detector. Not a detected Notion write -> return untouched. Detected ->
//      hard-block, with one of three classes.
//
// BRANCH A TRIGGERS ON THE NAME ANYWHERE, and that is load-bearing rather than belt-and-braces. The
// first draft of v8 triggered on "starts with the invocation prefix", and all three review lenses
// independently found it FAILS OPEN on POST: moving curl inside the script removes the only token
// notion-schema-guard's client regex matches, `-BodyFile` cannot match its `-Body\b`, and POST is
// absent from both hard write-verb patterns -- so an assignment-prefixed or chained canonical POST
// (a page create: filing a ticket, the headline operation this gate exists for) was neither
// prefix-matched NOR detected, and under bypassPermissions that is a silent approve. Two independent
// triggers now close it: the BASENAME catches the one shape no detector can see (PowerShell binds
// unambiguous parameter prefixes, so `-M POST -U "..." -B "..."` carries no `-Method` token at all),
// and DROPPING the client-name gate catches an invocation whose script path is obfuscated past
// normPath, because the PS method regex does include `Post`.
// Cost, stated: a shell command that merely MENTIONS the script -- cat-ing it, grepping for it --
// hard-blocks. Clearable (the Read tool is untouched), and it is the direction this arm prefers.
//
// NO CHAIN GUARD. v7 had one and it is deleted as REDUNDANT, not as a repaired fall-through (v7
// hard-blocked both CHAINED and AMBIGUOUS). An anchored whole-string template cannot match a chained
// or multiline command, so branch A hard-blocks those; branch B hard-blocks every detected command
// regardless of chaining. DO NOT RESTORE IT -- it would add an AMBIGUOUS path this arm does not need.
const REST_SCRIPT_BASENAME = 'notion-rest-write';
const REST_SCRIPT_PATH = path.join(HOOK_DIR, '..', 'scripts', 'notion-rest-write.ps1');
const REST_SCRIPT_KEY = normPath(REST_SCRIPT_PATH);
// THE PIN. sha256 of the script text, computed from the CODE BLOCK IN design-converged.md §4.5 --
// NOT from the file on disk, and that direction is the whole point: derived the other way round, the
// install assertion would compare the created file against a hash taken from the created file and
// pass unconditionally, so a script created with `-q` dropped would verify clean.
// Byte form hashed: LF line endings, no BOM, trailing newline. 47 lines, 3,077 bytes. The file is
// Drive-synced and git-committed, so a CRLF normalisation in transit BREAKS this pin and blocks every
// gated REST write -- fail-closed with a named reason (rest-script-mismatch), which is a cost rather
// than a hole, but the install must record which form it wrote.
// WHAT THE PIN CLOSES: post-install modification by any mechanism, delete-and-recreate, and any write
// that slips past enforceVetting -- which is not hypothetical, because vettingTargets recognises only
// specific write mechanisms and states that an unrecognised one falls through to a permission prompt,
// i.e. a silent approve here, and `Remove-Item` is absent from its destination patterns.
// WHAT IT DOES NOT CLOSE: (a) the INITIAL contents -- creation is silently approved, and a pin taken
// from a just-created file blesses whatever was created, so the initial contents rest on the reviewed
// script text in the design plus the install assertion; (b) the check-to-execution window -- this
// hook reads and hashes the script at decision time and the script runs afterwards, exactly as open
// as the body-file window. Both are recorded as residuals, not covered by a broader sentence.
const REST_SCRIPT_SHA256 = '38897e5b4aa874edb6c07e869f9f0c0eccabaee3bc0b65ec794a72d8a741f84c';
// The URL grammar. Deliberately narrow, and every exclusion buys something: no query string and no
// `$`/backtick/brace/bracket, which also means curl's URL globbing can never expand one URL slot
// into several requests (no need for `-g`), and a reviewer can always see WHICH page is written.
// `/v1/comments` is NOT admitted, because notion-create-comment is scoped out of piece 1 -- the
// consequence, stated rather than left implied, is that a REST comment write has NO REST route at all
// and must go through the MCP tool. `PUT` is excluded as a CHOICE, not on a claim about Notion's API:
// no corpus write uses it, so a PUT refuses, which is the safe direction.
const REST_URL_SRC =
  'https://api\\.notion\\.com/v1/(?:pages|blocks|databases)' +
  '(?:/(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?' +
  '(?:/children)?';
const REST_URL_ONLY_RE = new RegExp('^' + REST_URL_SRC + '$', 'i');
// THE TEMPLATE. Anchored, whole-command, NO `m` flag.
//
// INTER-TOKEN SEPARATORS ARE `[ \t]+` -- SPACE AND TAB ONLY, never `\s+` and not even `[^\S\n]+`.
// Round 2 found that `\s+` matches a NEWLINE, so a newline-separated invocation would satisfy an
// anchored whole-string match while both shells split it into two statements: the write would never
// run, and a single-use record would have been minted and consumed for nothing. Round 3 found the
// first fix incomplete -- `[^\S\n]+` still admits `\r`, `\v`, `\f` and a non-breaking space, none of
// which either shell treats as a token separator, so the same failure survived in a rarer form.
//
// The path slots exclude `"`, `$` and backtick, and are required ABSOLUTE (checked below), because
// --ticket-hash-shell has no payload cwd: a relative path could let the skill and the hook resolve
// different files.
const REST_TEMPLATE_RE = new RegExp(
  '^powershell(?:\\.exe)?[ \\t]+-NoProfile[ \\t]+-ExecutionPolicy[ \\t]+Bypass[ \\t]+-File[ \\t]+' +
  '"([^"$`\\r\\n]+)"' +
  '[ \\t]+-Method[ \\t]+(POST|PATCH|DELETE)' +
  '[ \\t]+-Url[ \\t]+"(' + REST_URL_SRC + ')"' +
  '[ \\t]+-BodyFile[ \\t]+"([^"$`\\r\\n]+)"' +
  '[ \\t]*$',
  'i'
);
// ---- the detector, copied from notion-schema-guard.js ----------------------
// COPIED, not `require`d: auto-approve.js is a locked file, and putting a gating-critical decision in
// an unlocked one trades tamper-resistance for tidiness. A fixture test over a shared corpus asserts
// the copy is a SUPERSET of schema-guard's matcher. Under v8 the detector ONLY EVER REFUSES, so a
// widening can only add refusals.
//
// THE CLIENT-NAME GATE IS DROPPED ENTIRELY, and this is recorded because it was a near-miss of the
// exact class this section exists to end. Measured over all 1,247 distinct shell commands mentioning
// api.notion.com: the live gated rule flags 242, and dropping the gate flags 242 -- +0 -- while it is
// what detects the canonical invocation for `-Method POST`, which the gated variant does not. The
// round-1 draft KEPT the gate for the weaker body-flag signal, reasoning that dropping it could
// refuse a read carrying something like `grep -d`. That reasoning was wrong twice: the variant
// measured identical, and the false-positive class it was meant to prevent is ALREADY REALISED 29
// times under the live rule itself -- and the "refinement" was the direct cause of the POST
// fail-open above. The +0 is historical-corpus-only and cannot speak to future traffic: going
// forward, a read-only command that mentions the host and carries a `-d`-family flag hard-blocks.
const REST_NOTION_HOST_RE = /api\.notion\.com/i;
const REST_WRITE_METHOD_RE = /(-X|--request)\s*['"]?(PUT|POST|PATCH|DELETE)\b/i;
const REST_PS_METHOD_RE = /-Method\s+['"]?(Put|Post|Patch|Delete)\b/i;
const REST_BODY_FLAG_RE = /(^|\s)(-d|--data|--data-raw|--data-binary|--data-urlencode|--json|-T|--upload-file|-Body|-InFile)\b/i;
const REST_EXPLICIT_WRITE_VERB_RE = /(-X|--request)\s*['"]?(PUT|PATCH|DELETE)\b/i;
const REST_PS_WRITE_VERB_RE = /-Method\s+['"]?(Put|Patch|Delete)\b/i;
// TWO NATIVE-CALL PATTERNS ADDED, because the regexes above match CLI-FLAG SYNTAX ONLY and would
// miss `node -e "fetch(u,{method:'PATCH'})"`. The quoted-key tolerance is so `{"method":"POST"}`
// matches. They are SPLIT EXACTLY AS THE CLI PATTERNS ARE: a native PATCH/PUT/DELETE joins the HARD
// set, which bypasses the read allow-list; a native POST joins the SOFT set, which the read
// allow-list can veto -- otherwise a `node -e` fetch to a `/query` READ would hard-block. Measured +0
// on the corpus, so this is a shape-coverage add, not a measured gap, and the fixture asserts the
// patterns fire (and asserts the SPLIT) rather than claiming traffic exists.
const REST_NATIVE_HARD_METHOD_RE = /["']?method["']?\s*:\s*['"](PUT|PATCH|DELETE)\b/i;
const REST_NATIVE_HARD_CALL_RE = /\.(put|patch|delete)\s*\(/i;
const REST_NATIVE_SOFT_METHOD_RE = /["']?method["']?\s*:\s*['"]POST\b/i;
const REST_NATIVE_SOFT_CALL_RE = /\.post\s*\(/i;

// Known read endpoints (allow-list, NOT a blacklist -- Notion's query/search reads also POST).
// MAINTENANCE: this can go stale if Notion ships new POST-based read endpoints outside the
// query/search family; re-verify when Notion's API changes.
//
// A THIRD WIDENING WAS DESIGNED, MEASURED AND REJECTED, and the rejection is recorded here so nobody
// re-adds it: this inspects only the FIRST api.notion.com URL, so a body-bearing POST whose first URL
// is a `/query` read is classified read even if a later URL is a write. Requiring EVERY URL to be a
// read path would close that -- and flags 11 additional commands, every one of which is a read (they
// pair a `/query` POST with a `GET /v1/blocks/<id>/children`). Eleven refusals of read-only work for
// zero real writes. The residual it would have closed has zero corpus instances and is recorded in
// the design's residual list. THE RULE THIS ESTABLISHES: a widening is measured BEFORE adoption.
function restPathIsNotionRead(command) {
  const m = command.match(/https?:\/\/api\.notion\.com(\/[^\s'"]*)?/i);
  const p = (m && m[1]) ? m[1] : '';
  const pathOnly = p.split(/[?#]/)[0];
  if (/\/query\/?$/i.test(pathOnly)) return true;
  if (/^\/v1\/search\/?$/i.test(pathOnly)) return true;
  return false;
}

// Is this shell command a mutating HTTP call to api.notion.com? Returns true only when we can
// positively identify a Notion write.
function restIsNotionMutatingHttp(command) {
  if (typeof command !== 'string' || command === '') return false;
  if (!REST_NOTION_HOST_RE.test(command)) return false;

  const explicitWrite = REST_EXPLICIT_WRITE_VERB_RE.test(command) ||
                        REST_PS_WRITE_VERB_RE.test(command) ||
                        REST_NATIVE_HARD_METHOD_RE.test(command) ||
                        REST_NATIVE_HARD_CALL_RE.test(command);
  const postOrBody = REST_WRITE_METHOD_RE.test(command) ||
                     REST_PS_METHOD_RE.test(command) ||
                     REST_BODY_FLAG_RE.test(command) ||
                     REST_NATIVE_SOFT_METHOD_RE.test(command) ||
                     REST_NATIVE_SOFT_CALL_RE.test(command);

  if (!explicitWrite && !postOrBody) return false;              // no write signal at all
  if (!explicitWrite && restPathIsNotionRead(command)) return false;  // read allow-list wins
  return true;
}

// Does the command carry ANY method flag? This -- not the URL -- is the discriminator between the
// three refusal classes. An earlier draft SPECIFIED one predicate (URL-grammar admissibility) and
// MEASURED another, and the mismatch inverted the advice for two real classes.
function restHasMethodFlag(command) {
  return REST_WRITE_METHOD_RE.test(command) || REST_PS_METHOD_RE.test(command) ||
         REST_NATIVE_HARD_METHOD_RE.test(command) || REST_NATIVE_HARD_CALL_RE.test(command) ||
         REST_NATIVE_SOFT_METHOD_RE.test(command) || REST_NATIVE_SOFT_CALL_RE.test(command);
}

// Choose the refusal class. Listed in EVALUATION order, and class 1 is the `otherwise` branch rather
// than a positive condition of its own -- an earlier ordering described class 1 positively while the
// implementation assigned it in an else, so a command the two descriptions disagreed about would be
// given a remedy that cannot be satisfied.
//
// Class 2's condition must NOT exclude read URLs before deciding "no expressible URL": a command
// with a hard write verb whose only literal Notion URLs are `/query` paths belongs in class 2 (whose
// remedy is the MCP tool), because class 1's remedy -- reissue as the canonical invocation -- is
// unsatisfiable for a URL the template refuses, and would send the caller round the loop
// rest-not-via-script -> rest-form-unrecognised -> rest-not-via-script.
//
// An INTERPOLATED URL is class 1, not class 2: it means the CALLER wrote a variable, and the fix is a
// substitution -- not that the template is too narrow. Getting that wrong is not hypothetical: the
// first measurement run treated an interpolated URL as inexpressible and put 127 commands in the
// over-gating bucket, which would have made the over-gating monitor fire on more than half of all
// traffic from day one and told Erez to loosen the template when nothing was wrong with it.
//
// BASELINE PROPORTIONS, measured over the 242 detected commands: class 1 = 210, class 2 = 3,
// class 3 = 29. Two properties of this classification matter more than its accuracy: EVERY class
// hard-blocks, so a misclassification can never open a hole -- the class selects only the refusal
// text and the monitor row; and the discriminator is textual and cannot associate a verb with a
// particular URL, so a command mixing a `/query` POST with a non-read URL can land in class 1 or 2
// while being read-only (measured at 1 command), which is why the refusal names what it matched.
function restRefusalClass(command) {
  if (!restHasMethodFlag(command)) return 'rest-signal-no-target';                       // class 3
  const urls = command.match(/https?:\/\/api\.notion\.com[^\s'"]*/gi) || [];
  let anyInterpolated = false;
  let anyExpressible = false;
  for (const u of urls) {
    if (/[$`{}[\]]/.test(u)) { anyInterpolated = true; continue; }
    if (REST_URL_ONLY_RE.test(u)) anyExpressible = true;
  }
  if (!anyExpressible && !anyInterpolated) return 'rest-template-cannot-express';         // class 2
  return 'rest-not-via-script';                                                           // class 1
}

// Does this command reference the write script at all? Name anywhere, OR any whitespace-delimited
// token that normPath-resolves to it. See the branch-A note above for why both are needed.
function restReferencesScript(command, cwd) {
  if (typeof command !== 'string' || command === '') return false;
  if (command.toLowerCase().indexOf(REST_SCRIPT_BASENAME) !== -1) return true;
  for (const tok of command.split(/\s+/)) {
    const t = tok.replace(/^["']+|["']+$/g, '');
    if (t === '') continue;
    try { if (normPath(t, cwd) === REST_SCRIPT_KEY) return true; } catch (e) { /* not a path */ }
  }
  return false;
}

// Read the pinned script and compare. One ~47-line read, no subprocess, inside the latency budget.
// -> true (matches) | false (differs, missing, unreadable -- all hard-block the same way, because a
// gate that cannot verify its only permitted route must stop).
function restScriptPinOk() {
  try {
    const buf = fs.readFileSync(REST_SCRIPT_PATH);
    return sha256HexBuf(buf) === REST_SCRIPT_SHA256;
  } catch (e) { return false; }
}

// Collect every KEY name in a parsed JSON value. Key-scoped for the same reason as the MCP side: a
// GEN-58 write-up routinely contains the WORD "archived" in prose, so a substring test over the body
// bytes would gate ordinary log appends.
function restJsonKeys(v, out, depth) {
  if (depth > TN_MAX_DEPTH || out.size > TN_MAX_NODES) return;
  if (Array.isArray(v)) { for (const x of v) restJsonKeys(x, out, depth + 1); return; }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) { out.add(String(k).toLowerCase()); restJsonKeys(v[k], out, depth + 1); }
  }
}

// The REST exemption, now over SLOTS rather than over command text. Exempt iff ALL hold:
//  1  method is PATCH or POST;
//  2  the URL path is exactly /v1/blocks/<id>/children -- the append-children endpoint, i.e. the REST
//     form of a log append;
//  3  <id>, lower-cased with dashes stripped, is the hardcoded GEN-58 page id or a valid line in the
//     exemption file. (The file's own lines are "exactly 32 hex characters" with no case
//     normalisation, so an upper-case line would not match -- the safe direction, stated so it is
//     not discovered later.)
//  4  the body file PARSES AS JSON and none of the destructive KEYS appears anywhere in it. A body
//     that does not parse as JSON is NOT exempt -- also the safe direction.
//
// The template guarantees EXACTLY ONE URL with a literal id in a known slot, so an earlier finding --
// "every id is exempt" satisfiable by the empty set, plus a second non-exempt URL riding the exempt
// lane -- is closed structurally: a second -Url cannot match the template, and one normalisation
// runs once, in one place.
//
// CHECKED AFTER the template match, so a GEN-58 log append over REST must ALSO use the canonical
// invocation. Deliberate: the alternative is an exemption lane reading raw command text, which is the
// mechanism being deleted. Small in practice -- the prescribed route for a log append is the MCP
// insert_content tool, which has its own exemption and is untouched -- and a refusal here is a
// self-correcting reissue, not a pause, so the standing "log immediately, no approval pause" rule is
// not touched.
function restIsGen58Exempt(method, url, bodyBuf, exempt) {
  if (method !== 'PATCH' && method !== 'POST') return false;                               // 1
  const m = String(url).match(/^https:\/\/api\.notion\.com\/v1\/blocks\/([^/]+)\/children$/i);
  if (!m) return false;                                                                    // 2
  const id = normNotionId(m[1]);
  if (!id || !ticketIdIsExempt(id, exempt)) return false;                                   // 3
  if (bodyBuf === null) return false;              // a bodyless append is not a log append
  let parsed;
  try { parsed = JSON.parse(bodyBuf.toString('utf8').replace(/^\uFEFF/, '')); } catch (e) { return false; }
  const keys = new Set();
  restJsonKeys(parsed, keys, 0);
  for (const k of TICKET_DESTRUCTIVE_KEYS) if (keys.has(k)) return false;                   // 4
  return true;
}

// ---- the shell scope verdict ------------------------------------------------
// -> null (not our business -- return untouched)
//  | {scope:'out'}                                        (the GEN-58 exemption)
//  | {scope:'in',    surface:'notion-rest', target, hash} (the ONE record path)
//  | {scope:'block', surface:'notion-rest', target, reason, why}   -- NO hash: every shell block
//    fires BEFORE a hash exists, which is why the escape is to reissue the command (or repair
//    something), never to obtain a record. Four of the seven reasons are clearable by rewriting;
//    three are not, and the refusal text says which.
//
// THE BINDING, when we get that far:
//   contentHash = sha256Hex(stableStringify({surface:'notion-rest', method, url, bodySha}))
// BOUND: the surface tag, the method, the URL verbatim, and the body bytes via their digest -- and,
// because the script takes exactly three mandatory parameters and nothing else, everything else in
// the request is fixed by the script FILE, which the pin covers.
// NOT BOUND by the hash: the client, the headers, the Notion-Version, the token/workspace, the
// script's own code, and the identity of the body file and the script at EXECUTION time. Those rest
// on the pin and on enforceVetting, not on the hash. `surface` is IN the hash input, so a REST hash
// can never collide with an MCP payload hash -- a different thing from the record's diagnostic
// `surface` FIELD, which is never matched on.
function ticketShellScope(command, cwd) {
  if (typeof command !== 'string' || command.trim() === '') return null;
  const cmd = command.trim();

  // ---- branch B first, as a guard clause: if the command has nothing to do with the script AND is
  // not a detected Notion write, we are not involved at all.
  if (!restReferencesScript(cmd, cwd)) {
    if (!restIsNotionMutatingHttp(cmd)) return null;                       // untouched
    const reason = restRefusalClass(cmd);
    return { scope: 'block', surface: 'notion-rest', reason: reason, target: 'notion-rest:not-canonical' };
  }

  // ---- branch A: the command names the script, so it must be the exact template.
  const m = REST_TEMPLATE_RE.exec(cmd);
  if (!m) {
    return { scope: 'block', surface: 'notion-rest', reason: 'rest-form-unrecognised',
             target: 'notion-rest:script-reference' };
  }

  // THE PIN IS CHECKED FIRST -- before the slots, the body read and the exemption -- because the
  // exempt lane returns with NO hash, and would otherwise let a GEN-58 append run under a modified
  // script, which is precisely what the pin exists to prevent.
  if (!restScriptPinOk()) {
    return { scope: 'block', surface: 'notion-rest', reason: 'rest-script-mismatch',
             target: 'notion-rest:pinned-script' };
  }

  const scriptSlot = m[1];
  const method = String(m[2]).toUpperCase();
  const url = m[3];
  const bodySlot = m[4];

  // The script slot must resolve to the pinned script, and be absolute.
  if (!path.isAbsolute(scriptSlot) || normPath(scriptSlot, cwd) !== REST_SCRIPT_KEY) {
    return { scope: 'block', surface: 'notion-rest', reason: 'rest-form-unrecognised',
             target: 'notion-rest:script-path' };
  }

  const target = 'notion-rest:' + method + ' ' + url;

  // The body: the literal NONE, or an absolute path we can read whole.
  let bodyBuf = null;
  if (bodySlot !== 'NONE') {
    if (!path.isAbsolute(bodySlot)) {
      return { scope: 'block', surface: 'notion-rest', reason: 'rest-form-unrecognised',
               target: target, why: 'relative-body-path' };
    }
    try {
      const stat = fs.statSync(bodySlot);
      if (!stat.isFile()) throw new Error('not a file');
      if (stat.size > TICKET_BODY_CAP_BYTES) {
        return { scope: 'block', surface: 'notion-rest', reason: 'body-file-unreadable',
                 target: target, why: 'over-cap' };
      }
      bodyBuf = fs.readFileSync(bodySlot);
    } catch (e) {
      return { scope: 'block', surface: 'notion-rest', reason: 'body-file-unreadable',
               target: target, why: 'missing-or-unreadable' };
    }
  }

  // The exemption file gets its OWN reasons on this path too. v7 left the shell path reading that
  // file with no reason of its own, so an unreadable or over-cap list would have inherited
  // internal-error, which is reserved for arm bugs.
  const exempt = readExemptPages();
  if (!exempt.ok) {
    return { scope: 'block', surface: 'notion-rest',
             reason: exempt.why === 'over-cap' ? 'exempt-list-overflow' : 'exempt-list-unreadable',
             target: target };
  }
  if (restIsGen58Exempt(method, url, bodyBuf, exempt)) return { scope: 'out' };

  const hash = sha256Hex(stableStringify({
    surface: 'notion-rest',
    method: method,
    url: url,
    bodySha: bodyBuf === null ? null : sha256HexBuf(bodyBuf)
  }));
  return { scope: 'in', surface: 'notion-rest', target: target, hash: hash, ids: [] };
}

// ============================================================================
// ---- the review record: what the hook verifies -----------------------------
// ============================================================================
// THREE FACTS, NOT TWO. An earlier binding was contentHash + reviewerAgentId, and the `verdict` field
// was written into the record and READ BY NOTHING -- so a record carrying `verdict: "REVISE"` passed
// every check. That is the identical defect the design had already fixed at the SKILL layer and never
// carried across to the hook, the one layer whose whole purpose is not to trust the skill. And a
// second attack needed no forgery: cite the agentId of a real check-reviewer from an unrelated /check
// run earlier in the same session, and both bindings are satisfied by an agent that never saw this
// ticket.
//
// Both close with ONE mechanism: the reviewer ends its reply with a machine-readable token, and this
// hook verifies it IN THE REVIEWER'S OWN TRANSCRIPT --
//     TICKET-REVIEW-VERDICT: PASS <contentHash>
// -- which establishes all three facts at once (this agent ran, it reviewed THIS content, it returned
// PASS) and cannot be satisfied by an unrelated reviewer, whose transcript carries a different hash
// or none.
//
// THE TRAP, and the structural fix. A naive whole-file substring search CANNOT WORK, and this was
// reproduced on a real transcript: line 1 of a reviewer transcript is `"type":"user"` -- the prompt --
// and contains the literal `STATUS: PASS` purely because the verdict template lists both options,
// while line 42 is `"type":"assistant"` and carries the reviewer's actual, opposite `STATUS: REVISE`.
// Three ways a flat search fails, none needing forgery: the reviewer's BRIEF is stored in the same
// file, and the hash is computed BEFORE the review, so a satisfied token can sit in the brief; a
// REVISE reviewer's own prose can quote the PASS form while explaining why it is not emitting it; and
// tickets in THIS project routinely quote this file's literal strings, so an innocent GEN-508 ticket
// could trip it by accident. An earlier version answered this with a DOCUMENTATION instruction
// ("never show the token filled in"), which was the deeper error: a standing rule says to prefer a
// guard the system executes over prose nobody re-reads, and the transcript format itself carries the
// fix.
//
// A FOURTH WAY, found 2026-08-05 and closed in ticketDeliveredText: restricting the scan to
// assistant-authored RECORDS is not the same as restricting it to what the reviewer DELIVERED. An
// assistant record also carries `thinking` and `tool_use` blocks, so the reviewer's private reasoning
// and its own grep arguments were being read as its verdict. The record boundary is the wrong unit;
// the block type is the right one.
const TICKET_TOKEN_PREFIX = 'TICKET-REVIEW-VERDICT:';

// Derive the session directory from `transcript_path` by stripping `.jsonl`, NEVER from a hand-built
// project slug -- GEN-518's lesson was that a hand-derived slug was wrong on Windows.
//
// AND CLIMB OUT OF `subagents` WHEN THE CALLER IS ITSELF A SUB-AGENT. A sub-agent's transcript_path is
// `<sessionDir>/subagents/agent-<self>.jsonl`, so stripping alone yielded
// `<sessionDir>/subagents/agent-<self>` -- one level too deep. Every sidecar lookup then resolved to
// `<...>/agent-<self>/subagents/agent-<reviewer>.meta.json`, a path that cannot exist, so a
// legitimately minted record was refused as `reviewer-unverified`: a block with a remedy that could
// not clear it, on the sub-agent path specifically. Verified against the real layout in this project
// (1,206 transcripts, all `<sessionDir>/subagents/agent-<id>.jsonl`).
//
// Whether PreToolUse fires for sub-agent-originated calls at all is still unverified and belongs to
// /vet-code's live verification step. This makes the path CORRECT if it fires; it does not settle it.
function ticketSessionDir(transcriptPath) {
  if (typeof transcriptPath !== 'string' || transcriptPath === '') return '';
  const stripped = transcriptPath.replace(/\.jsonl$/i, '');
  if (path.basename(path.dirname(stripped)).toLowerCase() === 'subagents') {
    return path.dirname(path.dirname(stripped));
  }
  return stripped;
}

// The sidecar carries `agentType` -- so this hook can require check-reviewer -- and NEVER a verdict,
// which is why the token is needed as well.
function ticketReviewerVerified(sessionDir, agentId) {
  if (!sessionDir || typeof agentId !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(agentId)) return false;
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(sessionDir, 'subagents', 'agent-' + agentId + '.meta.json'), 'utf8')
        .replace(/^\uFEFF/, ''));
    return !!meta && meta.agentType === 'check-reviewer';
  } catch (e) { return false; }
}

// Pull the DELIVERED text out of one assistant transcript record: the `text` blocks of
// `message.content`, in order, and nothing else. Returns null when the record delivered no text.
//
// AN ALLOW-LIST, DELIBERATELY. The previous version re-serialised the whole record and scanned that,
// which read the reviewer's `thinking` blocks as if they were its verdict -- confirmed against real
// transcripts, whose assistant records carry exactly `text`, `thinking` and `tool_use` blocks. So
// reasoning the reviewer chose NOT to deliver counted as the verdict, including a rehearsed PASS it
// then talked itself out of; and a `tool_use` input mentioning the token (a reviewer grepping for its
// own format) counted too, and being later in the record would have WON the last-occurrence rule.
// Naming the one block type that is delivered output closes both, and closes every block type a future
// schema adds -- `redacted_thinking` and anything after it are excluded by construction rather than by
// a deny-list somebody must remember to extend.
// A record whose delivered text is EMPTY OR WHITESPACE-ONLY counts as having delivered nothing, so it
// cannot become "the final message" and shadow a real verdict in the record before it. Found by a
// reviewer of the first version of this function and confirmed here: real transcripts write roughly one
// content block per record, so a trailing near-empty text record is not an exotic shape. Failure
// direction was a false refusal, not a false approve, but the remedy would have been an unexplained
// re-review. Whitespace carries no verdict, so skipping it loses nothing.
function ticketDeliveredText(rec) {
  const c = rec && rec.message && rec.message.content;
  if (typeof c === 'string') return c.trim() === '' ? null : c;   // older single-string form
  if (!Array.isArray(c)) return null;
  const parts = [];
  for (const b of c) {
    if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  if (parts.length === 0) return null;
  const joined = parts.join('\n');
  return joined.trim() === '' ? null : joined;
}

// -> 'ok' | 'no-token' | 'bad-record' | 'transcript-too-large'
// The verdict is read from the reviewer's FINAL DELIVERED MESSAGE -- the last assistant record that
// delivered any text -- and the LAST token occurrence within it must read exactly `PASS <contentHash>`.
//
// "Final message", not "last occurrence in the file", which is what this did before. It let a reviewer
// emit PASS early and then wander -- or, with the block filter above, put its real verdict in an earlier
// message and something else last. Message granularity is what the skill actually instructs: end your
// reply with the token.
//
// PRECISELY WHAT IS AND IS NOT ENFORCED, because the first version of this comment overstated it and a
// reviewer caught the overstatement: the token must be the LAST occurrence in the final delivered
// message, but the match is NOT anchored to the end of that message -- text may follow it. So "ends on
// the token" is the instruction given to the reviewer, not an invariant this function checks. Anchoring
// it was considered and rejected: a trailing newline, a closing sentence or a signature would then be a
// false refusal, and this gate's cheapest catastrophic failure is a lockout, not a slightly loose read.
// The refusal text is worded as the instruction for that reason.
//
// Grounded rather than assumed: across all 1,206 sub-agent transcripts in this project, 1,204 end with
// an `assistant [text]` record and nothing after it. Harness-authored assistant records are skipped
// (`isApiErrorMessage`), because all 14 of those in this project DO carry a text block -- API Error
// 529s from this very session -- and one landing after a valid verdict would otherwise shadow it.
//
// A cap-exceeded transcript is a DISTINCT diagnosis from a missing token and must not be logged as one.
function ticketTokenVerdict(sessionDir, agentId, hash) {
  if (!sessionDir || typeof agentId !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(agentId)) return 'bad-record';
  const file = path.join(sessionDir, 'subagents', 'agent-' + agentId + '.jsonl');
  let text;
  try {
    const stat = fs.statSync(file);
    if (stat.size > TICKET_TRANSCRIPT_CAP_BYTES) return 'transcript-too-large';
    text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) { return 'bad-record'; }

  let final = null;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let rec;
    try { rec = JSON.parse(line); } catch (e) { continue; }   // a partial trailing line is not fatal
    if (!rec || rec.type !== 'assistant' || rec.isApiErrorMessage === true) continue;
    const delivered = ticketDeliveredText(rec);
    if (delivered !== null) final = delivered;
  }
  if (final === null) return 'no-token';

  // Last occurrence WITHIN the final message: a reviewer may quote the form while explaining itself,
  // but what it signs off with is the verdict.
  let last = null;
  let from = 0;
  for (;;) {
    const at = final.indexOf(TICKET_TOKEN_PREFIX, from);
    if (at === -1) break;
    last = final.slice(at + TICKET_TOKEN_PREFIX.length, at + TICKET_TOKEN_PREFIX.length + 128);
    from = at + TICKET_TOKEN_PREFIX.length;
  }
  if (last === null) return 'no-token';
  const m = last.match(/^\s*(PASS|REVISE)\s+([0-9a-f]{64})/i);
  if (!m) return 'no-token';
  if (m[1].toUpperCase() !== 'PASS') return 'no-token';
  if (m[2].toLowerCase() !== String(hash).toLowerCase()) return 'no-token';
  return 'ok';
}

// ---- record matching and single-use consumption ----------------------------
// A separate dir keeps ticket records from cross-matching staging / vetting / check passes. Named
// wrapper over findPassInDir per the family convention -- and /vet-ticket's Step-0 gate-integrity
// grep looks for this name, so removing it would make the skill fail closed.
function findTicketPassFile(matchFn, exclude) {
  return findPassInDir(TICKET_PASS_DIR, matchFn, exclude);
}

// Matching is on `contentHash` ALONE -- but as of GEN-508 BLOCKING 2 the hash binds the TOOL as well
// as the payload (see ticketContentHash), so one record clears exactly one (tool, payload) pair and
// cannot be spent on the same object under a different tool (the update-record-on-a-duplicate hole).
// Requiring the hook-derived TARGET to match too would mean /vet-ticket had to reproduce the whole
// scoping scan or no record would ever match -- a failure whose only escape is break-glass. The batch
// `targets[]` array is GONE (there is no permission dialog to collapse), so this reads one hash per record.
function ticketRecordMatches(rec, hash) {
  if (!rec || rec.kind !== 'ticket' || !hash) return false;
  return typeof rec.contentHash === 'string' && rec.contentHash.trim().toLowerCase() === String(hash).toLowerCase();
}

// Does ANY live record name this hash's page ids? Used ONLY to tell the operator the difference
// between "you never got this reviewed" and "you got it reviewed and then changed the payload",
// which is otherwise a mysterious dead end costing a wasted re-mint to diagnose. It changes the
// MESSAGE, never the decision, and deliberately does NOT introduce a new reason string -- the
// monitored reason set is derived from the enforcement flow in one place and must not fork.
function ticketRecordExistsForIds(ids) {
  if (!ids || ids.length === 0) return false;
  return !!findTicketPassFile(rec => {
    if (!rec || rec.kind !== 'ticket') return false;
    const s = String(rec.target == null ? '' : rec.target).replace(/-/g, '').toLowerCase();
    return s !== '' && ids.some(id => s.indexOf(id) !== -1);
  });
}

function blockTicketVetting(sc) {
  const reason = sc.reason || 'no-pass';
  let why = '';
  if (reason === 'internal-error') {
    why = ' The gate hit an internal error while working out whether this call touches a Team-Tasks' +
          ' ticket, so it cannot claim the call is out of scope. This reason is reserved for a bug in' +
          ' the gate itself -- if it recurs, the arm is broken, not the traffic.';
  } else if (reason === 'unreadable-payload') {
    why = ' The payload could not be read end to end (' + (sc.why || 'unknown') + '), so the gate' +
          ' cannot claim it is out of scope. A record CAN clear this (the hash is taken over the raw' +
          ' input), but re-issuing the call in the ordinary shape is usually the right move.';
  } else if (reason === 'bad-target') {
    why = ' Its target is unreadable (' + (sc.why || 'unparseable-id') + '): a placeholder, a' +
          ' truncated uuid, a parent naming no id, or an unrecognised container. A malformed target' +
          ' is not evidence of harmlessness -- an unrecognised parent data source was a measured' +
          ' fail-open.';
  } else if (reason === 'bad-verdict') {
    why = ' A record exists for this content but its verdict is not PASS and it is not waived.' +
          ' Fix the findings and re-run /vet-ticket; do not hand-edit the record.';
  } else if (reason === 'reviewer-unverified') {
    why = ' The record names a reviewer whose sub-agent sidecar is missing, or whose agentType is' +
          ' not check-reviewer. The reviewer must be the independent read-only agent type.';
  } else if (reason === 'no-token') {
    why = ' The named reviewer\'s FINAL DELIVERED REPLY does not end on' +
          ' "TICKET-REVIEW-VERDICT: PASS <hash>" for THIS content. A record is not evidence; the' +
          ' reviewer\'s own sign-off is. Only delivered text counts -- a token that appears solely in' +
          ' the reviewer\'s internal reasoning, in a tool call, or in an earlier message is NOT a' +
          ' verdict, so have the reviewer end its reply with the token. If the content changed after' +
          ' the review, re-review it -- reviewed-then-edited content has not been reviewed.';
  } else if (reason === 'bad-record') {
    why = ' The reviewer transcript could not be read at all. Re-run /vet-ticket, which rewrites the' +
          ' record.';
  } else if (reason === 'transcript-too-large') {
    why = ' The reviewer transcript exceeds the 4 MB read cap. This is a DISTINCT diagnosis from a' +
          ' missing token: the review may well have happened. Re-run the review in a fresh sub-agent.';
  } else if (reason === 'expiry-too-far') {
    why = ' A matching record was found, but its expiry sits further in the future than the gate' +
          ' allows: a review record is deliberately short-lived, so an over-long TTL is not honoured.' +
          ' Re-run /vet-ticket to mint a fresh record; do not hand-edit the expiry.';
  } else if (reason === 'unknown-record-key') {
    why = ' The record carries a field the gate does not recognise, so it is not a shape /vet-ticket' +
          ' mints -- a stray field is treated as drift or tampering rather than silently ignored.' +
          ' Re-run /vet-ticket to mint a clean record; do not hand-edit it.';
  } else if (reason === 'consume-failed') {
    why = ' A matching record was found but could not be consumed, so the write is refused rather' +
          ' than allowed on a record that might be replayable.';
  } else if (reason === 'stale-content') {
    why = ' A ticket record EXISTS for this ticket, but it was minted for a DIFFERENT payload: the' +
          ' content changed after it was reviewed, or the same call is being sent in a different' +
          ' shape. Re-run /vet-ticket on the payload you are actually about to send. Do not' +
          ' hand-edit the record.';
  } else if (reason === 'exempt-list-overflow') {
    // The old wording ended "find that bug rather than trimming the list", which named no fix at all:
    // nothing prunes the list automatically, so while it is over-cap EVERY in-scope write is refused,
    // and the one route the text left open was break-glass. Trimming is ordinary, in-band and safe --
    // the file is a plain id list in the staging dir, not a data store -- so the message now says to do
    // both: find the appender, then trim. Diagnose first, but never leave the gate wedged.
    why = ' The GEN-58 exemption list is over its ' + TICKET_EXEMPT_CAP + '-id cap, so this gate is' +
          ' refusing every in-scope write until the list reads clean again. The cap is a tripwire, not' +
          ' a quota: nothing prunes the list automatically, so reaching it means something is appending' +
          ' ids that are not log volumes -- find that first, because trimming without it just refills.' +
          ' Then TRIM the list back to the real log volumes: that is the in-band fix, and it is an' +
          ' ordinary edit of ' + TICKET_EXEMPT_FILE + '. Do not reach for break-glass for this.';
  } else if (reason === 'exempt-list-unreadable') {
    why = ' The GEN-58 exemption list could not be read (' + TICKET_EXEMPT_FILE + '), so this gate is' +
          ' refusing every in-scope write until it reads clean. A gate that cannot read its own exemption' +
          ' list must stop rather than guess. If the file is CORRUPT, the safe recovery is to DELETE it' +
          ' (a MISSING file reverts to ordinary review-gated operation, not a bypass) and re-seed the' +
          ' current GEN-58 volume id via /vet-ticket. Do not reach for break-glass for this.';
  } else if (reason === 'rest-not-via-script') {
    why = ' This is a raw Notion REST WRITE issued directly. Reissue it as the canonical invocation:\n' +
          '   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + REST_SCRIPT_PATH + '"' +
          ' -Method <POST|PATCH|DELETE> -Url "https://api.notion.com/v1/..." -BodyFile "<absolute path|NONE>"\n' +
          ' Pass a LITERAL Windows path (not $(cygpath -w ...) -- the template rejects "$"), space or' +
          ' tab separators only, all on one line, and substitute the literal page id where the URL was' +
          ' a variable, because the reviewer must be able to see which page is written.';
  } else if (reason === 'rest-template-cannot-express') {
    why = ' This write names a Notion endpoint the canonical invocation cannot express (an unadmitted' +
          ' family such as /v1/comments, a query string, or only read-style URLs). Use the MCP tool' +
          ' instead, or extend BOTH the template and the script -- a reviewed change, not a rewrite.' +
          ' THIS is the over-gating signal the monitor watches: if it recurs, the template is too narrow.';
  } else if (reason === 'rest-signal-no-target') {
    why = ' This command mentions api.notion.com and carries a data-ish flag but NO method flag, so' +
          ' the gate cannot tell a read from a write. If it is a READ, use the long-form flag' +
          ' (tr --delete \'\\r\' rather than tr -d \'\\r\' -- the single-letter -d is what fired this).' +
          ' If it IS a write, add an explicit -X/-Method and reissue via the canonical invocation.';
  } else if (reason === 'rest-form-unrecognised') {
    why = ' This command references the Notion write script but is not the EXACT canonical invocation' +
          ' (' + (sc.why || 'extra token, missing or abbreviated parameter, wrong order, interpolated' +
          ' or relative path, or newline separation') + '). Reissue it exactly as printed above --' +
          ' parameter names in full, space or tab separators only, one line, absolute quoted paths.';
  } else if (reason === 'body-file-unreadable') {
    why = ' The body file named by -BodyFile is missing, unreadable, or over the 2 MB cap (' +
          (sc.why || 'unknown') + '). Nothing truncates: a partial body would be hashed as something' +
          ' Notion never receives. Fix the path or the file, then reissue.';
  } else if (reason === 'rest-script-mismatch') {
    why = ' The on-disk Notion write script does NOT match the hash pinned in this hook, so every' +
          ' gated REST write is refused until that is resolved. Restore the script, or update the pin' +
          ' through the locked-edit path. To compute or diagnose the digest, use the install fixture' +
          ' or configUnlocked() break-glass -- Get-FileHash on that path carries the script basename,' +
          ' which this arm blocks by design.';
  }
  process.stderr.write(
    'Refused (ticket-quality gate): no usable ticket review record for ' + sc.target + '.' + why +
    '\nA Team-Tasks create, duplicate, move, body edit, or substance-property edit -- and every raw' +
    ' Notion REST write -- must go through /vet-ticket: an independent check-reviewer passes the draft' +
    ' against the ticket bar and ends on TICKET-REVIEW-VERDICT: PASS <hash>, Erez approves the summary' +
    ' card, and that writes a single-use record. NOT gated: housekeeping-only property edits (status,' +
    ' assignee, type, project, reason) and content writes inside the GEN-58 log subtree.\n'
  );
  process.exit(2);
}

// ---- the enforcement flow --------------------------------------------------
// Ticket-quality guard. Hard-blocks (exit 2) an in-scope Notion write with no usable record;
// consumes the matching record and approves; returns (falls through) for everything else. Honors
// break-glass. Call site: in main, immediately after enforceCheckDue and BEFORE the allow-list check,
// so an allow-list entry cannot bypass it.
//
// EVERY BLOCKING STEP NAMES ITS OWN REASON, and that is deliberate rather than tidy. Two consecutive
// review rounds found the monitored reason set missing one for a real block path -- a failed sidecar
// check, a corrupt record, a failed unlink -- so all of them would have inherited `internal-error`,
// which is BOTH reserved for arm bugs AND monitored as "the arm is broken, not the traffic". A stale
// sidecar would then have reported the hook as broken when the staging directory was the cause: a
// false signal on the one channel built to catch real breakage.
function enforceTicketVetting(tool, input) {
  // Tool test FIRST and OUTSIDE the try: it cannot throw, so a bug anywhere below can never make an
  // unrelated call take the block path -- and the catch below can fail CLOSED without risking every
  // other tool call in the session.
  const isMcp = (tool === NOTION_CREATE_TOOL || tool === NOTION_UPDATE_TOOL ||
                 tool === NOTION_DUPLICATE_TOOL || tool === NOTION_MOVE_TOOL);
  // PIECE 1a SCOPE: the MCP surface ONLY. The raw REST/curl arm (§4.5) is built but DELIBERATELY NOT
  // WIRED -- shell tools are not in scope here, which makes ticketShellScope unreachable from this
  // hook. Read the NOT WIRED banner above §4.5 before reconnecting it; two of its findings are open.
  if (!isMcp) return;
  // GEN-508 #4: NO global break-glass here. It is scoped BELOW to the two MECHANICAL blocks only
  // (internal-error, unreadable-payload) via ticketBreakGlassSkip -- a content/auth decision (no-pass,
  // bad-verdict, reviewer-unverified, ...) is Erez's approval and stays unbreakable, mirroring
  // enforceStaging. The old unconditional `if (configUnlocked()) return` voided the whole gate, unlogged.

  const ti = input && input.tool_input;
  let sc;
  try {
    sc = ticketScope(tool, ti);
  } catch (e) {
    // A throw in our own scoping is NOT a reason to let a Notion write through. Under
    // bypassPermissions returning here would be a SILENT APPROVE of an unreviewed write, not a
    // prompt. Fail closed; break-glass clears this MECHANICAL block (logged + surfaced), never a content one.
    if (configUnlocked()) return ticketBreakGlassSkip(tool, '<internal-error>', 'internal-error');
    logTicketGateEvent({ event: 'block', tool: tool, target: '<internal-error>', reason: 'internal-error' });
    return blockTicketVetting({ target: '<internal-error>', reason: 'internal-error', ids: [] });
  }
  if (!sc || sc.scope === 'out') return;

  // A shell block fires BEFORE any hash exists, so no record can clear it: refuse now.
  if (sc.scope === 'block' && !sc.hash) {
    logTicketGateEvent({ event: 'block', tool: tool, surface: sc.surface, target: sc.target,
                         reason: sc.reason, why: sc.why });
    return blockTicketVetting(sc);
  }

  // A record can clear an 'in' verdict AND an MCP 'block' verdict, because the latter still carries a
  // hash (the raw-input fallback). An earlier version short-circuited every block before the record
  // directory was read, so the refusal text promised an escape the code did not implement.
  const file = findTicketPassFile(rec => ticketRecordMatches(rec, sc.hash));
  if (!file) {
    // No record. Report the ORIGINAL block reason where there was one; otherwise no-pass, refined to
    // stale-content when a record exists for this ticket under a different hash.
    let reason = sc.reason;
    if (!reason) reason = ticketRecordExistsForIds(sc.ids) ? 'stale-content' : 'no-pass';
    // GEN-508 #4: break-glass clears ONLY a MECHANICAL block (unreadable-payload) here, logged + surfaced;
    // no-pass / stale-content / bad-target / exempt-list-* are content/scope decisions and stay unbreakable.
    if (configUnlocked() && TICKET_BREAKGLASS_REASONS.has(reason)) return ticketBreakGlassSkip(tool, sc.target, reason);
    logTicketGateEvent({ event: 'block', tool: tool, surface: sc.surface, target: sc.target,
                         reason: reason === 'stale-content' ? 'no-pass' : reason,
                         why: sc.why, hash: sc.hash });
    return blockTicketVetting({ target: sc.target, reason: reason, why: sc.why, ids: sc.ids });
  }

  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    logTicketGateEvent({ event: 'block', tool: tool, surface: sc.surface, target: sc.target, reason: 'bad-record' });
    return blockTicketVetting({ target: sc.target, reason: 'bad-record', ids: sc.ids });
  }

  // GEN-508 second-review fix: findTicketPassFile matched the hash against its OWN read of this file
  // and then returned only the path, so every field trusted below comes from the SECOND read above.
  // Re-assert the binding here: without it, a file rewritten between the two reads is trusted on
  // fields that were never matched against this write's hash. On the PASS branch ticketTokenVerdict
  // re-checks sc.hash against the reviewer's token and largely closes this; on the WAIVED branch
  // nothing did, which is exactly where a mismatch is cheapest to exploit.
  //
  // Re-assert with ticketRecordMatches, NOT a bare `!==`. The first version of this guard used
  // `rec.contentHash !== sc.hash`, which the review after it caught as two defects in one line:
  //   1. STRICTER than the matcher above (2765 compares `.trim().toLowerCase()`), so a record whose
  //      hash carries the trailing newline `ticketHashCli` prints -- exactly what the trim exists to
  //      absorb -- matched the finder and then failed here as `bad-record`, whose remedy text says to
  //      re-run /vet-ticket. That regenerates an identical record, so it was a closed lockout loop
  //      whose only exit was break-glass. A re-assert must re-assert the SAME predicate.
  //   2. NOT null-safe. `JSON.parse('null')` succeeds, so `rec` can be null and `rec.contentHash`
  //      throws -- uncaught, i.e. exit 1, i.e. a silent approve. This line was the FIRST dereference
  //      of `rec`, so the bare form moved the crash site earlier rather than closing it.
  // ticketRecordMatches returns false on a null record, so one call fixes both.
  if (!ticketRecordMatches(rec, sc.hash)) {
    logTicketGateEvent({ event: 'block', tool: tool, surface: sc.surface, target: sc.target, reason: 'bad-record' });
    return blockTicketVetting({ target: sc.target, reason: 'bad-record', ids: sc.ids });
  }

  // GEN-508 closed-shape record validation: a matched pass may carry ONLY the keys the mint template
  // writes (TICKET_PASS_KEYS). A stray key is drift or tampering, not something to silently ignore --
  // refuse it. Checked here, after the hash re-assert (so `rec` is a matched kind:"ticket" object) and
  // before the verdict/waive/reviewer reads, so it governs BOTH branches.
  const unknownKey = Object.keys(rec).find(k => !TICKET_PASS_KEYS.has(k));
  if (unknownKey) {
    logTicketGateEvent({ event: 'block', tool: tool, surface: sc.surface, target: sc.target, reason: 'unknown-record-key' });
    return blockTicketVetting({ target: sc.target, reason: 'unknown-record-key', ids: sc.ids });
  }

  // GEN-508 expiry CEILING (upper bound). findPassInDir returns a pass only if it is not ALREADY
  // expired (the lower bound), but nothing capped how far into the FUTURE `expires` may sit -- so a
  // record minted with a 2099 expiry was honoured indefinitely and the skill's 15-minute discipline was
  // only advisory. Enforce the ceiling HERE (the ticket-scoped path), for BOTH the reviewed and the
  // waived branches, so an over-long TTL cannot outlive the review it stands for. NOT in findPassInDir
  // -- see TICKET_MAX_TTL_MS for why the shared reader must not carry a ticket-sized cap.
  const recExp = Date.parse(rec.expires || '');
  if (!recExp || recExp > Date.now() + TICKET_MAX_TTL_MS) {
    logTicketGateEvent({ event: 'block', tool: tool, surface: sc.surface, target: sc.target, reason: 'expiry-too-far' });
    return blockTicketVetting({ target: sc.target, reason: 'expiry-too-far', ids: sc.ids });
  }

  // Cheap pre-filter -- fail fast before opening a large transcript. TWO values, not three:
  // adjudication is no longer a hook input at all. These fields are NOT the authority; the token is.
  const waived = rec.waived === true;
  if (!(rec.verdict === 'PASS' || waived)) {
    logTicketGateEvent({ event: 'block', tool: tool, surface: sc.surface, target: sc.target, reason: 'bad-verdict' });
    return blockTicketVetting({ target: sc.target, reason: 'bad-verdict', ids: sc.ids });
  }

  // The reviewer checks are skipped ONLY on a waive, where Erez's explicit chat answer is the
  // authority. A waive is scoped to one write and never touches the global break-glass.
  if (!waived) {
    const sessionDir = ticketSessionDir(input && input.transcript_path);
    if (!ticketReviewerVerified(sessionDir, rec.reviewerAgentId)) {
      logTicketGateEvent({ event: 'block', tool: tool, surface: sc.surface, target: sc.target,
                           reason: 'reviewer-unverified' });
      return blockTicketVetting({ target: sc.target, reason: 'reviewer-unverified', ids: sc.ids });
    }
    const v = ticketTokenVerdict(sessionDir, rec.reviewerAgentId, sc.hash);
    if (v !== 'ok') {
      logTicketGateEvent({ event: 'block', tool: tool, surface: sc.surface, target: sc.target, reason: v });
      return blockTicketVetting({ target: sc.target, reason: v, ids: sc.ids });
    }
  }

  // Consume, and REFUSE unless the consume actually removed the record: an earlier implementation
  // returned success without checking, so one record could authorise a second write.
  if (!consumePassFile(file)) {
    logTicketGateEvent({ event: 'block', tool: tool, surface: sc.surface, target: sc.target, reason: 'consume-failed' });
    return blockTicketVetting({ target: sc.target, reason: 'consume-failed', ids: sc.ids });
  }

  logTicketGateEvent({ event: 'approve', tool: tool, surface: sc.surface, target: sc.target,
                       hash: sc.hash, waived: waived });
  return approve('Auto-approved: ticket review record consumed (' + sc.target + ').');
}

// ---- the shared content-hash CLIs ------------------------------------------
// `node auto-approve.js --ticket-hash <payload.json> --tool <create|update|duplicate|move>` -> MCP hash
// `node auto-approve.js --ticket-hash-shell <command.txt>`   -> the REST-surface hash
//
// WHY A CLI RATHER THAN A CITED FORMULA: the skill must use the SAME normaliser and the same hash
// assembly as the hook, and skill/hook drift is a failure whose only escape is break-glass. The
// normaliser is ~100 lines; reproducing it by hand would guarantee the drift. One definition, called
// by both, removes the failure mode instead of documenting it -- and as of 2026-08-05 that is true of
// the ASSEMBLY too, via ticketContentHash. It previously was not: this function held its own copy.
//
// Read-only by construction: parse a file, hash, print, exit. No fs write, no network.
function ticketHashCli(argv) {
  const file = argv[argv.indexOf('--ticket-hash') + 1];
  // GEN-508 BLOCKING 2: --tool is REQUIRED and folded into the hash, so a record can only clear a write
  // under the SAME tool. It is validated against the fixed tag enum here, and the allow-list regex
  // (isSafeTicketHash) pins the same enum, so the self-approved invocation can carry nothing else.
  const tIdx = argv.indexOf('--tool');
  const tag = tIdx !== -1 ? argv[tIdx + 1] : undefined;
  if (!file || !tag || !TICKET_TOOL_TAGS.has(tag)) {
    process.stderr.write('ticket-hash: usage: node auto-approve.js --ticket-hash <payload.json>' +
      ' --tool <create|update|duplicate|move>\n');
    return process.exit(3);
  }
  let ti;
  try {
    ti = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    process.stderr.write('ticket-hash: cannot read ' + file + ' as JSON.\n');
    return process.exit(3);
  }
  let norm, threw = false;
  try { norm = ticketNormalise(ti); } catch (e) { threw = true; norm = { ok: false, why: 'normalise-threw' }; }

  // A THROW AND A BUDGET BUST ARE DIFFERENT CASES, and the NOTE below was written as if they were one.
  // On a bust the normaliser RETURNS ok:false, the hook's ticketScope returns scope 'block' carrying a
  // hash, and the flow then reads the record directory -- so a record really can clear it, exactly as
  // the NOTE promises. On a throw, ticketScope itself throws, its caller catches, and the write is
  // refused as `internal-error` BEFORE any record is read: nothing can clear it. Printing a hash for
  // that case invites a full reviewer run that buys nothing, and then an unexplained block afterwards.
  // Refuse to print one, on the same reasoning ticketHashShellCli already uses for the surfaces its arm
  // will not hash: a refusal now beats a wasted review and a mystery later.
  if (threw) {
    process.stderr.write('ticket-hash: the normaliser THREW on this payload (' + (norm.why || 'unknown') +
      '). That is a bug in the gate, not in your payload: the hook refuses such a write as' +
      ' internal-error BEFORE it reads any record, so no record can clear it and there is nothing worth' +
      ' minting. Report it against GEN-508 -- re-running /vet-ticket will not help.\n');
    return process.exit(3);
  }

  const h = ticketContentHash(norm, ti, tag);
  if (!norm.ok) {
    // Reachable only for a genuine budget bust now, which is the case this text is true of.
    process.stderr.write('ticket-hash: NOTE this payload could not be read end to end (' +
      (norm.why || 'unknown') + '); the hook will hard-block it with reason unreadable-payload, and' +
      ' this hash is the raw-input fallback that a record CAN match. Prefer re-issuing the call in' +
      ' the ordinary shape.\n');
  }
  process.stdout.write(h + '\n');
  return process.exit(0);
}

// GEN-508 Step 3: batch scope-classifier over a payload corpus, for the fail-open sweep in the test
// suite. Read-only by construction -- read a JSONL corpus, run each payload through the SAME ticketScope
// the wired hook runs (no fs write, no network on any path), print one verdict line, exit. So the sweep
// tests what runs, not a re-implementation of it. It carries NO auto-approve allow-list entry: the suite
// spawns it directly with argv, never as a Bash tool call, so it is not a shell surface the gate must
// recognise and needs no isSafeTicketHash change.
//
// Input:  a JSONL file, one {tool, short, input} object per line (build-corpus.js's row shape).
// Output: one JSON line per non-blank input line, IN ORDER: {short, scope, reason, why}. A ticketScope
//         throw is reported as scope:'threw' (message in `why`) rather than crashing the batch, so the
//         sweep can assert it never happens -- ticketScope is written not to throw on anything JSON.parse
//         can produce, so a 'threw' is itself a finding. One output line per non-blank corpus line keeps
//         the sweep's index-join with the corpus exact.
function ticketScopeBatchCli(argv) {
  const file = argv[argv.indexOf('--ticket-scope-batch') + 1];
  if (!file) {
    process.stderr.write('ticket-scope-batch: usage: node auto-approve.js --ticket-scope-batch <corpus.jsonl>\n');
    return process.exit(3);
  }
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch (e) {
    process.stderr.write('ticket-scope-batch: cannot read ' + file + '.\n');
    return process.exit(3);
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); }
    catch (e) { process.stdout.write(JSON.stringify({ short: null, scope: 'unparsable-corpus-line', reason: null, why: null }) + '\n'); continue; }
    // A literal `null` (or any non-object) corpus line parses successfully but has no .tool/.short;
    // without this guard row.tool would throw inside the try below and the catch's row.short would
    // throw again, uncaught, crashing the whole sweep. Treat it as an unparsable line instead.
    if (!row || typeof row !== 'object') { process.stdout.write(JSON.stringify({ short: null, scope: 'unparsable-corpus-line', reason: null, why: null }) + '\n'); continue; }
    let out;
    try {
      const sc = ticketScope(row.tool, row.input);
      out = { short: row.short || null, scope: sc.scope, reason: sc.reason || null, why: sc.why || null };
    } catch (e) {
      out = { short: row.short || null, scope: 'threw', reason: null, why: String((e && e.message) || e) };
    }
    process.stdout.write(JSON.stringify(out) + '\n');
  }
  return process.exit(0);
}

// The shell surface's entry point. Its input is a file holding the CANONICAL INVOCATION LINE.
// It exits NON-ZERO -- printing nothing to stdout -- when the command is not an exact template match
// or its body file cannot be read: the two states in which the arm refuses to produce a hash at all.
// Without that, the CLI would hand back a hash for a command the arm will refuse to hash, and a
// reviewer run would be spent before the refusal text redirected the caller.
function ticketHashShellCli(argv) {
  const file = argv[argv.indexOf('--ticket-hash-shell') + 1];
  if (!file) {
    process.stderr.write('ticket-hash-shell: usage: node auto-approve.js --ticket-hash-shell <command.txt>\n');
    return process.exit(3);
  }
  let cmd;
  try {
    cmd = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    process.stderr.write('ticket-hash-shell: cannot read ' + file + '.\n');
    return process.exit(3);
  }
  let sc;
  try { sc = ticketShellScope(cmd, null); } catch (e) { sc = null; }
  if (!sc || sc.scope !== 'in' || !sc.hash) {
    const reason = (sc && sc.reason) ? sc.reason : (sc && sc.scope === 'out' ? 'exempt' : 'not-canonical');
    process.stderr.write('ticket-hash-shell: this command will NOT reach the record path (' + reason +
      '). Do not mint a record for it -- reissue it as the canonical invocation:\n' +
      '  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + REST_SCRIPT_PATH + '"' +
      ' -Method <POST|PATCH|DELETE> -Url "https://api.notion.com/v1/..." -BodyFile "<absolute path|NONE>"\n');
    return process.exit(3);
  }
  process.stdout.write(sc.hash + '\n');
  return process.exit(0);
}

// /vet-ticket has to call a hash CLI once per ticket. Deferring that call would either fall through
// to a SILENT approve (under Erez's bypassPermissions mode, where a non-allow-listed call is not
// prompted -- see the premise correction near TEAM_TASKS_IDS) or raise a dialog per mint in a
// prompting mode; approving the one exact __filename-pinned invocation outright gives the same
// no-friction result in every mode while binding the path. (An earlier version of this note said
// the deferred call "would raise a permission dialog" unconditionally -- the disproven premise.)
//
// The script path is pinned to THIS FILE via __filename, which is load-bearing rather than tidy:
// without it, `node <any>\auto-approve.js --ticket-hash x.json` would be approved, and since edits
// inside Erez's project folders are themselves auto-approved, that would be arbitrary code execution
// with no prompt anywhere in the chain. Both paths must be quoted and free of every shell
// metacharacter, so nothing can be chained, expanded or redirected onto the end. Reading one file and
// printing a hash of it is the entire blast radius that remains.
function isSafeTicketHash(command) {
  if (typeof command !== 'string' || /[\r\n]/.test(command)) return false;
  // PIECE 1a: `--ticket-hash` on a `.json` payload ONLY. `--ticket-hash-shell` is deliberately NOT
  // allow-listed while the REST arm is unwired -- it would hand back a hash binding a record to a
  // surface this hook does not gate, which is the "a record exists for a write nothing checked" shape
  // the gate exists to refuse. The literal `--ticket-hash` cannot match `--ticket-hash-shell`,
  // because the `\s+` after it requires whitespace where that form has a hyphen.
  // The trailing `--tool <tag>` is REQUIRED and pinned to the fixed enum (GEN-508 BLOCKING 2): the tag
  // carries no shell metacharacter, and the `$` anchor with no `m` flag keeps it the LAST token, so a
  // self-approved invocation can carry nothing chained, expanded or redirected after it.
  const m = command.trim().match(
    /^(?:&\s+)?"?node(?:\.exe)?"?\s+"([^"<>|&;`$]+auto-approve\.js)"\s+--ticket-hash\s+"([^"<>|&;`$]+\.json)"\s+--tool\s+"?(?:create|update|duplicate|move)"?$/i
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

// GEN-508: the shared content-hash CLIs, handled before the stdin listener is attached because they
// take their input from a file argument rather than from the hook envelope. Both always
// process.exit(), so nothing below runs in those modes. Unreachable in normal PreToolUse operation,
// where argv carries no flags at all.
if (process.argv.indexOf('--ticket-hash') !== -1) ticketHashCli(process.argv);
// GEN-508 Step 3: read-only batch scope-classifier for the test suite's fail-open corpus sweep. Like
// --ticket-hash it takes a file argument, always process.exit()s, and is unreachable in normal PreToolUse
// operation (argv carries no flags). NOT allow-listed -- the suite spawns it directly, never via Bash.
if (process.argv.indexOf('--ticket-scope-batch') !== -1) ticketScopeBatchCli(process.argv);
// PIECE 1a: `--ticket-hash-shell` is NOT dispatched -- the REST arm it serves is unwired (see the NOT
// WIRED banner above §4.5). ticketHashShellCli stays defined so piece 2 is a reconnection rather than
// a rebuild; with no dispatch here it is unreachable, and the flag is no longer allow-listed either.

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

  // GEN-508: ticket-quality gate for Notion writes -- the four MCP write tools ONLY. Piece 1a: the
  // raw REST/curl arm (§4.5) is present in this file but UNWIRED, so nothing here reaches it. An
  // earlier version of this comment said "AND raw REST/curl", which described the pre-narrowing
  // build and would have told whoever wires piece 2 that the work was already done.
  // Runs before the allow-list so an allow entry cannot bypass it; consumes a one-time review
  // record on match (approve), hard-blocks (exit 2) on an in-scope write with no usable record,
  // falls through otherwise. Takes the WHOLE envelope, not just tool_input: it needs
  // `transcript_path` to verify the named reviewer's own sub-agent transcript. (`cwd` is passed for
  // the REST script-token scan, which piece 2 reconnects; under piece 1a it is unused.)
  enforceTicketVetting(tool, input);

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
