# GEN-871 Phase 1 — Claude Code release review, 2026-06-01 → 2026-10-14

Scope: Claude Code changelog versions 2.1.160 (Jun 1) → 2.1.300 (Oct 14), 117 versions, 4,286 lines after dropping 320 IDE-plugin lines (2,475 of them "Fixed"). Dates from the npm registry. Reviewed in 6 parallel slices against our setup inventory (hooks, skills, scripts, scheduled tasks, settings) and all 415 open non-game tickets. Installed version on this PC: **2.1.295** (from the latest session transcript) — 2.1.296–2.1.300 not yet installed.

Docs spot-checks done in the main session (2026-10-15): mods overview (code.claude.com/docs/en/plugins/mods), hooks reference (onFailure, PreCompact triggers, subagent hooks, PostModelSwitch, async), memory (/doctor prompt-audit), env-vars (idle compaction). Local checks: no plugins installed (`~/.claude/plugins` has no installed-plugins file); settings.json has none of `idleCompaction`, `blockReadsOutsideWorkingDirectories`, `syncClaudeAiSkills`, `disableAllHooks`, `onFailure`.

Auto-unblock candidates: **none.** All 21 Blocked tickets checked by title; none waits on a missing Claude Code capability (GEN-388's body read: blocked on evidence that the warning is ignored, not on a capability).

## A. Risks to what we built

| # | Change | Version | Affects | Action |
|---|---|---|---|---|
| A1 | **Mods** (plugins running code inside Claude Code) can approve a tool call that our own PreToolUse hooks blocked; on by default, Desktop from 2.1.286. Plugins now activate immediately on install. | 2.1.286–2.1.292, 2.1.221+ | auto-approve.js gates, confirm-send.js | Append to GEN-718; raise urgency. Docs verified. |
| A2 | Transcripts will record every request's system prompt, tools and parameters — much larger files, new record type. | 2.1.300 (not installed) | ticket gate's 4 MB reviewer-transcript cap; stop-foryou-nudge tail read; GEN-860 backup size | New ticket: re-test transcript readers right after upgrading. |
| A3 | UserPromptSubmit hooks now run before a skill/slash command expands. | 2.1.299 (not installed) | inject-notion-refs.js / inject-jira-refs.js may stop firing on bare `/wrap`, `/vet-ticket` | Append to GEN-334. |
| A4 | Idle compaction: a 200K+ token conversation idle ~54 min is compacted automatically; on by default; `"idleCompaction": false` turns it off. Changelog says "in the terminal"; Desktop behaviour unverified. PreCompact docs list only `manual`/`auto` triggers; our compact gate fires on manual only. | 2.1.299 (not installed) | compact gate (precompact-loggate.js), HISTORY logging | Append to GEN-208. |
| A5 | Claude can no longer start `/code-review` itself (likely cause of GEN-546; 2.1.246 re-allows it on Bedrock/Vertex/Foundry, via the apps gateway, or with telemetry/non-essential traffic off — check which applies here); `/code-review` runs as a background agent, and for models without tuned settings reviews inline — independence of /vet-code Pass A needs re-checking; bare `/code-review` reuses the last level. | 2.1.215, 2.1.232, 2.1.274, 2.1.223 | /vet-code Steps 0 and 3 | Append to GEN-546. |
| A6 | One-time auto-mode prompt before the first read outside the working folders, offering to block such reads for good. Answering "block" would break /wrap and the gates that read `~/.claude`. | 2.1.257+ | most workflows | Tell Erez: answer "allow". |
| A7 | Auto mode now blocks tampering with session transcript files. | 2.1.205 | GEN-860 restore steps | Append to GEN-860: test restore before it's needed. |

## B. Native features that can replace or simplify our hand-built pieces

| # | Change | Version | Affects | Action |
|---|---|---|---|---|
| B1 | `/doctor prompt-audit`: audits CLAUDE.md, skills, agents, commands under `~/.claude` for stale references, contradictions, old-model wording; report only. Docs verified. | 2.1.283 | config-health skill; GEN-677, GEN-674, GEN-291 | Append to GEN-677: widen to this audit. |
| B2 | `onFailure: "block"` on command/HTTP hooks: a hook that crashes, times out or exits oddly blocks the action. Not for Stop or async hooks. Docs verified. | 2.1.295 (installed) | GEN-835 | Append to GEN-835: smallest fix is available now; needs a recovery path first (see B9). |
| B3 | Sessions can list and message each other (ListAgents/SendMessage), incl. Windows. | 2.1.224–2.1.239 | GEN-615, GEN-620 | Append to both. |
| B4 | Each reply in the transcript records its effort level. | 2.1.212 | GEN-784, effort tags in stop-foryou-nudge.js | Append to GEN-784. |
| B5 | "You should know": built-in side agent that flags things Claude or the user missed (off until turned on; needs telemetry). | 2.1.287+ | GEN-246, GEN-716, GEN-333 | Append to GEN-716 (try it before building our own). |
| B6 | PostModelSwitch hook event (`from_model`/`to_model`, can add context). Docs verified. | 2.1.251 | GEN-470, model tag directive | Append to GEN-470. |
| B7 | Skills enabled on the claude.ai account sync to terminal sessions and load in cloud sessions (hooks and CLAUDE.md not covered; claude.ai copy becomes the source). | 2.1.275+ | GEN-794 | Append to GEN-794. |
| B8 | `async` / `asyncRewake` hooks run in the background with no timeout; asyncRewake wakes Claude on failure. SessionStart support unverified. | docs; fixes 2.1.285–2.1.287 | backup sweep spawner; GEN-703 | Append to GEN-703. |
| B9 | `--safe-mode` / `CLAUDE_CODE_SAFE_MODE=1` starts with all hooks, CLAUDE.md, skills off — a documented way out of a broken gate. Desktop equivalent unverified. | 2.1.169 | GEN-389, break-glass | Append to GEN-389. |
| B10 | Agent tool `effort` parameter; agent frontmatter `effort:` now honoured. | 2.1.292, 2.1.267 | check-reviewer and vet reviewers | New opportunity: pin reviewer effort. Fold into GEN-871 Phase 2 notes (no separate ticket). |

## C. Tickets that are now stale, answered, or partly fixed upstream

| # | Change | Version | Ticket | Action |
|---|---|---|---|---|
| C1 | Sub-agents can run shell commands (two reviewers ran Bash live; our hooks fire inside them); sub-agents inherit the main session's permission mode. The global CLAUDE.md line "Sub-agents … can't run Bash/PowerShell" is stale. | 2.1.186, 2.1.198, 2.1.212 | GEN-830, GEN-370 | Append evidence to GEN-830; GEN-370 question 1 answered. |
| C2 | Auto-mode "temporarily unavailable" denials: several fixes (large sessions, brief overload, 401 after token expiry, server-side classifier, back-off). | 2.1.216–2.1.282 | GEN-423 | Append: check the denial log since 2026-08-24, then close or narrow. |
| C3 | Docs now state settings hooks run inside sub-agents (with agent_id); custom sub-agents load CLAUDE.md, built-in Explore/Plan don't. Docs verified. | 2.1.288 + docs | GEN-354, GEN-678 | Append to GEN-354. |
| C4 | Tools that silently returned "nothing found" on failure now report errors (Grep/Glob unreadable path, bad regex, WebFetch truncation, sub-agent errors). | 2.1.199–2.1.292 | GEN-297 | Append: scope narrowed. |
| C5 | Two dead allow rules in settings.json: `Write(...)` (file rules match only `Edit(...)`) and `TaskOutput` (tool removed). | 2.1.275, 2.1.277 | GEN-290 | Append as concrete cases. |
| C6 | Remote MCP server could stay broken while shown connected; ~5-minute HTTP tool timeout. | 2.1.273–2.1.283 | GEN-360 | Append: re-test before investigating. |
| C7 | Desktop sessions no longer deleted after 30 days; memory-folder cleanup bug fixed (pre-2.1.228); transcript-write failures now warned. | 2.1.248, 2.1.228 | GEN-860 | Append memory-folder point (rest already in ticket). |

## Lesson for Phase 2
The six parallel chunk reviewers attached the wrong version number to 4 of about 25 claims that reached ticket notes (e.g. Windows cross-session messaging 2.1.239, not 2.1.225; back-off fix 2.1.280, not 2.1.281). The independent ticket reviewers caught each one, but the `/release-review` procedure should look up every quoted version mechanically against the changelog (heading above the quoted line) before drafting, rather than trusting the reviewer's attribution.

## Lower-value notes (not acted on)
Built-in Concise output style overlaps our narration rules (overlap check only); /skill-doctor and /usage context-cost warnings (GEN-845, GEN-674); OpenTelemetry per-skill cost and /cost cache diagnostics (GEN-138, GEN-93); AGENTS.md support (GEN-169); a skill named `verify` auto-runs before commits; Write may overwrite an unread file on newer models (conflicts with this session's tool description — untested); PowerShell 5.1 `>` now writes UTF-8 and Write keeps BOMs (shell refs may be partly stale); Claude Tag in Slack needs Team/Enterprise (GEN-199); cloud routines can use only claude.ai connectors (GEN-175).
