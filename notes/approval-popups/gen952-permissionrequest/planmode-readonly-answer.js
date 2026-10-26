#!/usr/bin/env node
'use strict';

/*
 * planmode-readonly-answer.js -- Claude Code PermissionRequest hook. (GEN-952)
 *
 * Plan mode prompts for any MCP tool that is not marked read-only (readOnlyHint), even when
 * permissions.allow lists it, and a PreToolUse "allow" has no effect there (permissions docs,
 * "Hook approvals in plan mode"; changelog 2.1.299). Five vendor-built read-only tools carry no
 * such marking, so Erez was asked about them in plan mode only. A PermissionRequest hook runs at
 * the moment Claude Code is about to show that prompt, and its "allow" answers it.
 *
 * Invariants (keep them when editing):
 *  - Allow-only: never "deny", never updatedInput or updatedPermissions.
 *  - Answers only when permission_mode is "plan", the tool is one of TOOLS, and the tool is still
 *    a bare entry in settings.json permissions.allow (removing it there restores the prompt).
 *    TOOLS repeats the settings.json matcher on purpose (defence in depth): change both together.
 *  - tabs_context_mcp is answered only without createIfEmpty, which would open a tab group.
 *  - PermissionRequest also runs where a call cannot prompt and would be auto-denied (background or
 *    non-interactive subagents); in plan mode those calls to these tools are now allowed too.
 *  - Anything else, or any error, exits 0 with no output, so the normal prompt shows.
 *  - The hook cannot tell WHY a prompt was raised, so no other hook may ever return "ask" for
 *    these tools: in plan mode this hook would answer that prompt too.
 *
 * Diagnostic trace: only while <os temp dir>/planmode-answer-trace.on exists, each call appends
 * one line to <os temp dir>/planmode-answer-trace.jsonl, up to TRACE_MAX_BYTES. A trace failure
 * never changes the answer.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TOOLS = new Set([
  'mcp__scheduled-tasks__list_scheduled_tasks',
  'mcp__scheduled-tasks__list_task_runs',
  'mcp__ccd_session_mgmt__list_events',
  'mcp__ccd_settings__get_settings',
  'mcp__claude-in-chrome__tabs_context_mcp',
]);
const SETTINGS_FILE = path.join(__dirname, '..', 'settings.json');
const TRACE_ON = path.join(os.tmpdir(), 'planmode-answer-trace.on');
const TRACE_FILE = path.join(os.tmpdir(), 'planmode-answer-trace.jsonl');
const TRACE_MAX_BYTES = 256 * 1024;

function stillAllowListed(tool) {
  try {
    // Strip a UTF-8 byte-order mark: JSON.parse rejects one, which would silently disable the hook.
    const json = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8').replace(/^\uFEFF/, ''));
    const allow = (json.permissions && json.permissions.allow) || [];
    return Array.isArray(allow) && allow.indexOf(tool) !== -1;
  } catch (e) {
    return false;
  }
}

function trace(input, answered, reason) {
  try {
    if (!fs.existsSync(TRACE_ON)) return;
    if (fs.existsSync(TRACE_FILE) && fs.statSync(TRACE_FILE).size > TRACE_MAX_BYTES) return;
    fs.appendFileSync(TRACE_FILE, JSON.stringify({
      ts: new Date().toISOString(),
      tool_name: input && typeof input.tool_name === 'string' ? input.tool_name : null,
      permission_mode: input && typeof input.permission_mode === 'string' ? input.permission_mode : null,
      answered: answered,
      reason: reason
    }) + '\n');
  } catch (e) {
    // Diagnostic only -- never affects the answer.
  }
}

function decide(input) {
  if (!input || typeof input !== 'object') return 'not an object';
  if (input.hook_event_name !== 'PermissionRequest') return 'not PermissionRequest';
  if (input.permission_mode !== 'plan') return 'not plan mode';
  if (!TOOLS.has(input.tool_name)) return 'tool not listed';
  if (input.tool_name === 'mcp__claude-in-chrome__tabs_context_mcp' &&
      input.tool_input && input.tool_input.createIfEmpty) return 'would open a tab group';
  if (!stillAllowListed(input.tool_name)) return 'not in permissions.allow';
  return null;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  let input = null;
  let reason;
  try {
    input = JSON.parse(raw);
    reason = decide(input);
  } catch (e) {
    reason = 'unreadable input';
  }
  if (reason === null) {
    trace(input, true, 'answered');
    // Exit only once the answer is flushed, so it can never reach Claude Code truncated.
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' }
      }
    }), () => process.exit(0));
    return;
  }
  trace(input, false, reason);
  process.exit(0);
});
