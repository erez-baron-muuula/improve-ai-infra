#!/usr/bin/env node
'use strict';

/*
 * deny-askuserquestion.js -- Claude Code PreToolUse hook. (GEN-337)
 *
 * Denies the AskUserQuestion popup tool outright and redirects the model to
 * asking inline in the conversation as prose. The resident pointer rule was
 * dropped from the global CLAUDE.md on 2026-10-21 (GEN-674 headroom step):
 * this hook's refusal text now carries the whole rule.
 *
 * Safety stance (one-directional invariant, same as confirm-send.js): this
 * hook only ever DENIES its one gated tool or defers. It never returns
 * "allow" and never silences a prompt another hook would raise. On any
 * parse/processing failure it defers (no output), matching auto-approve.js.
 */

const REASON =
  'AskUserQuestion (the popup question/button widget) is banned by ' +
  "Erez's standing instructions. Ask the question inline in the " +
  'conversation as prose instead — including multi-option decisions — ' +
  'laying out each option and its trade-offs, so the reasoning behind ' +
  'the question stays visible.';

function deny() {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: REASON
    }
  }));
  process.exit(0);
}

function defer() {
  // No output => normal permission flow applies (other hooks / classifier).
  process.exit(0);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    if (input && input.tool_name === 'AskUserQuestion') return deny();
  } catch (e) {
    // Cannot identify the tool -> defer; never block anything else.
  }
  return defer();
});
