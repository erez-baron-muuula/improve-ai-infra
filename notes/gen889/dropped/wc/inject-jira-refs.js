// UserPromptSubmit hook — deterministic prompt-time injection of Jira reference notes.
// Sibling of inject-notion-refs.js (GEN-400): the Jira gotchas were moved OUT of the
// always-loaded global CLAUDE.md into hooks/refs/jira.md, and this hook injects them
// for THIS turn only when the user's prompt looks like Jira work.
//
// Scope + limits (same as the Notion sibling): fires only on UserPromptSubmit, so it
// sees only the user's prompt text — Jira work arising mid-turn without a prompt cue
// is NOT covered here (the consolidated pointer in the global CLAUDE.md is the fallback).
//
// Ticket-key cue: any ALL-CAPS-key-dash-number token (e.g. MD-1234, QA-7) rather than a
// hardcoded list of today's Jira project keys (which would rot as projects are added).
// A small stoplist excludes known non-Jira tokens: GEN- (Notion Team-Tasks ids, covered
// by inject-notion-refs.js) and common technical tokens (UTF-8, SHA-256, ISO-8601).
// A false positive just injects a few lines of Jira notes — cheap; a false negative
// still has the word "jira" / an atlassian.net URL as fallback cues.
//
// Never blocks the prompt. A missing/empty refs file is a distinguished condition that
// injects a one-line warning instead of silence (no marker, so the warning repeats on
// each matching prompt — deliberate: louder while broken, self-clears once fixed); any
// OTHER error (e.g. malformed stdin) fails open silently via the outer catch.

const fs = require('fs');
const path = require('path');

// Jira signals in the user's prompt. Word-boundary / explicit tokens to avoid false hits.
const JIRA_PATTERNS = [
  /\bjira\b/i,                                          // the word "Jira"
  /atlassian\.net/i,                                    // Jira/Confluence URLs
  // Ticket keys (MD-1234, QA-7, ...). Case-sensitive by design: lowercase "md-1234"
  // won't match — the case-insensitive "jira"/atlassian.net cues are the fallback.
  /\b(?!GEN-|UTF-|SHA-|ISO-)[A-Z][A-Z0-9]{1,9}-\d+\b/,
];

let input = '';
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  let additionalContext = null;
  try {
    const data = JSON.parse(input || '{}');
    const prompt = typeof data.prompt === 'string' ? data.prompt : '';

    if (prompt && JIRA_PATTERNS.some(re => re.test(prompt))) {
      const refFile = path.join(__dirname, 'refs', 'jira.md');
      // Explicit missing/empty check -- a distinguished, expected condition that
      // warns instead of the outer catch-all's silent fail-open.
      if (!fs.existsSync(refFile)) {
        additionalContext = 'inject-jira-refs: refs/jira.md is missing or empty, so the Jira reference notes are not in this session; Erez has not been told.';
      } else {
        const refText = fs.readFileSync(refFile, 'utf8');
        if (refText && refText.trim()) {
          additionalContext = refText;
        } else {
          additionalContext = 'inject-jira-refs: refs/jira.md is missing or empty, so the Jira reference notes are not in this session; Erez has not been told.';
        }
      }
    }
  } catch (e) {
    // fail open — inject nothing
  }

  if (additionalContext) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext,
        },
      })
    );
  }
  process.exit(0);
});
