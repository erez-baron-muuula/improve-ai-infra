// UserPromptSubmit hook — deterministic prompt-time injection of Notion reference notes.
// Part of the CLAUDE.md-shrink reliability work (GEN-86): the non-dangerous Notion gotchas
// were moved OUT of the always-loaded global CLAUDE.md into hooks/refs/notion.md, and this
// hook injects them into the model's context for THIS turn only when the user's prompt looks
// like Notion work. Reliable (deterministic), unlike model-invoked skills.
//
// Scope + limits (see GEN-334): fires only on UserPromptSubmit, so it sees only the user's
// prompt text — Notion work arising mid-turn without a prompt cue is NOT covered here.
// The notion-duplicate-page safety note deliberately STAYS in the always-loaded CLAUDE.md.
// The destructive-op incident classes (GEN-337) were moved INTO refs/notion.md and ARE carried
// by this hook — but only prompt-cued, so mid-turn Notion work is still uncovered (above).
// GEN-825: the read, write, REST and /vet-ticket notes were split out into refs/notion-*.md
// (listed at the end of notion.md) and are injected once per session by inject-topic-refs.js,
// which also fires on the first Notion tool call; this file keeps the per-prompt core.
//
// Size guard (GEN-825): Claude Code caps each injected string at 10,000 characters and shows
// only a file path + 2,000-char preview above that, so an oversized notion.md is cut after the
// whole lines that fit in 9,000, with a line telling the session to Read the file in full and
// (once per session) to tell Erez it needs splitting.
//
// Never blocks the prompt. A missing/empty refs file (GEN-336) is a distinguished condition
// that injects a one-line warning instead of silence; any OTHER error (e.g. malformed stdin)
// still fails open silently via the outer catch. Reference text lives in a separate data
// file so it can be edited without touching this code.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Notion signals in the user's prompt. Word-boundary / explicit tokens to avoid false hits.
const NOTION_PATTERNS = [
  /\bnotion\b/i,               // the word "Notion"
  /\bGEN-\d+\b/,               // Team-Tasks ticket IDs (GEN-123)
  /notion\.so\//i,             // notion.so URLs
  /\bnotion-[a-z-]+\b/i,       // Notion MCP tool names (notion-create-pages, notion-fetch, ...)
  /\bTeam-Tasks\b/i,           // the Team-Tasks board
  /collection:\/\//i,          // data-source URLs
];

const CAP = 10000;  // Claude Code's per-string limit on injected text
const KEEP = 9000;  // over the cap, keep whole lines up to this many characters

// Copied from inject-topic-refs.js (fitToCap) until GEN-697 consolidates the inject hooks.
function fitToCap(text, refFile, flagErez, cap = CAP) {
  if (text.length <= cap) return text;
  const keep = cap - (CAP - KEEP);
  let kept = '';
  for (const line of text.split('\n')) {
    const next = kept ? kept + '\n' + line : line;
    if (next.length > keep) break;
    kept = next;
  }
  let note = '\n\n(Notes cut here: this file is ' + text.length + ' characters, over the 10,000-character limit on injected text, so only the lines above are included. The full file is ' + refFile + ' and should be read in full before relying on these notes.)';
  if (flagErez) note += '\n(Erez should be told that refs/' + path.basename(refFile) + ' needs splitting: it is over the 10,000-character limit.)';
  return kept + note;
}

// Once per session (or every time when there is no session_id): claim the "needs splitting" flag.
function claimOversizeFlag(sessionId) {
  const safeId = sessionId.replace(/[^A-Za-z0-9_-]/g, '');
  if (!safeId) return true;
  try {
    fs.writeFileSync(path.join(os.tmpdir(), 'claude-refs-oversize-notion-' + safeId), new Date().toISOString(), { flag: 'wx' });
    return true;
  } catch (e) {
    return false;
  }
}

let input = '';
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  let additionalContext = null;
  try {
    const data = JSON.parse(input || '{}');
    const prompt = typeof data.prompt === 'string' ? data.prompt : '';
    const sessionId = typeof data.session_id === 'string' ? data.session_id : '';

    if (prompt && NOTION_PATTERNS.some(re => re.test(prompt))) {
      const refFile = path.join(__dirname, 'refs', 'notion.md');
      // Explicit missing/empty check (GEN-336) -- a distinguished, expected
      // condition that warns instead of the outer catch-all's silent fail-open.
      // No marker for this hook, so the warning repeats on each matching prompt
      // (deliberate: louder while broken, self-clears once the file is fixed).
      if (!fs.existsSync(refFile)) {
        additionalContext = 'inject-notion-refs: refs/notion.md missing or empty — Notion reference notes were NOT loaded; flag this to Erez.';
      } else {
        const refText = fs.readFileSync(refFile, 'utf8');
        if (refText && refText.trim()) {
          additionalContext = fitToCap(refText, refFile, refText.length > CAP && claimOversizeFlag(sessionId));
        } else {
          additionalContext = 'inject-notion-refs: refs/notion.md missing or empty — Notion reference notes were NOT loaded; flag this to Erez.';
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
