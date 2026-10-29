// SessionStart hook (matcher "compact") — GEN-845 Layer 1: after-compaction skill reminder.
// After compaction Claude Code re-attaches only the first ~5,000 tokens of each invoked skill
// (25,000 shared, oldest dropped first — code.claude.com/docs/en/skills.md "Skill content lifecycle"),
// so a long gate skill's later steps are no longer in context. This hook reads the session transcript,
// collects the user skills (~/.claude/skills/<name>/SKILL.md) that actually loaded so far, and injects
// one short factual note naming them, most recent first.
// Detection: every skill load — typed /<name> or a Skill tool call — writes a main-thread user message
// flagged isMeta whose text starts "Base directory for this skill: <skill folder>". Matching the load,
// not the request, skips refused calls (e.g. disable-model-invocation skills). The format is not
// documented; checked 2026-10-19 against 282 local transcripts (879 markers, all isMeta).
// Documented pattern: code.claude.com/docs/en/hooks-guide.md "Re-inject context after compaction".
// Fails open: any error, a missing or oversized transcript -> no output, exit 0.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_SKILLS = 8;
const MAX_TRANSCRIPT_BYTES = 200 * 1024 * 1024;
const MARKER = 'Base directory for this skill:';
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// The amount of each skill kept after compaction. Since GEN-892 it follows notes/anthropic-guidelines.json
// (skill-after-compaction) through guidelines-limits.js; FALLBACK_SKILL_TOKENS is used when that cannot be read.
const FALLBACK_SKILL_TOKENS = 5000;
function skillTokens() {
  try {
    const v = require('./guidelines-limits.js').readLimit('skill-after-compaction', { fallback: FALLBACK_SKILL_TOKENS, min: 1000, max: 20000 }).value;
    return Number.isInteger(v) ? v : FALLBACK_SKILL_TOKENS;
  } catch (e) {
    return FALLBACK_SKILL_TOKENS;
  }
}

const skillsDir = path.join(os.homedir(), '.claude', 'skills');

// Skill folder name from a load-marker text, or null if it is not a user skill under ~/.claude/skills.
function userSkillFromMarker(text) {
  const firstLine = text.trimStart().split('\n', 1)[0];
  if (!firstLine.startsWith(MARKER)) return null;
  const dir = path.resolve(firstLine.slice(MARKER.length).trim());
  if (path.dirname(dir).toLowerCase() !== skillsDir.toLowerCase()) return null;
  const name = path.basename(dir);
  if (!SKILL_NAME_RE.test(name) || !fs.existsSync(path.join(skillsDir, name, 'SKILL.md'))) return null;
  return name;
}

// Records the last line index at which each user skill loaded.
function collectLoads(text) {
  const lastSeen = new Map();
  const lines = text.replace(/^\uFEFF/, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes(MARKER)) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    if (!entry || entry.type !== 'user' || entry.isMeta !== true || entry.isSidechain || !entry.message) continue;
    const content = entry.message.content;
    const texts = typeof content === 'string' ? [content]
      : Array.isArray(content) ? content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text)
      : [];
    for (const t of texts) {
      const name = userSkillFromMarker(t);
      if (name) lastSeen.set(name, i);
    }
  }
  return lastSeen;
}

function mostRecentFirst(lastSeen) {
  return [...lastSeen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SKILLS)
    .map(([name]) => '/' + name);
}

function buildNote(names) {
  return 'Context was just compacted. Skills used earlier in this session, most recent first: ' +
    names.join(', ') + '. After compaction Claude Code keeps only the opening part of each skill\'s ' +
    'instructions (about ' + String(skillTokens()).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' tokens each, 25,000 in total), and older ones can be dropped entirely, so ' +
    'steps past that opening part are no longer in context. A session part-way through one of these skills ' +
    're-reads its file (~/.claude/skills/<name>/SKILL.md, in chunks if large) and the reference file for its ' +
    'current step, then continues from the step it had reached rather than starting over. The compaction ' +
    'summary and the skill\'s on-disk records show which step that was; when neither shows it, the step is ' +
    'unknown and Erez is asked.';
}

let input = '';
const stdinGuard = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('error', () => process.exit(0));
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  clearTimeout(stdinGuard);
  let additionalContext = null;
  try {
    const data = JSON.parse(input || '{}');
    const transcriptPath = data.transcript_path;
    if ((data.source === undefined || data.source === 'compact') && typeof transcriptPath === 'string') {
      const stat = fs.statSync(transcriptPath);
      if (stat.isFile() && stat.size <= MAX_TRANSCRIPT_BYTES) {
        const names = mostRecentFirst(collectLoads(fs.readFileSync(transcriptPath, 'utf8')));
        if (names.length) additionalContext = buildNote(names);
      }
    }
  } catch (e) {
    // fail open
  }

  if (additionalContext) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext,
        },
      })
    );
  }
  process.exit(0);
});
