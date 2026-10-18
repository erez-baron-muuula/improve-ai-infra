# GEN-677: /doctor prompt-audit vs our own checks (2026-10-18)

Audit report: `doctor-prompt-audit-2026-10-18.md` (this folder). Claude Code 2.1.299, run by Erez in a terminal session in this folder.

"Our checks" = config-health's automatic /wrap check today (CLAUDE.md files only; `~/.claude/skills/config-health/SKILL.md` checks 1-7 + `config-health-scan.ps1 -Action scan`) plus GEN-891's planned coverage (skills, agents, commands, hooks/refs: judgment checks on changed sections; weekly check for references to files, scripts, skills, commands, tickets that no longer exist).

Live test: `config-health-scan.ps1 -Action scan` on this project's CLAUDE.md returned no findings (missed H3) and extracted the path `C:\Users\Erez\AI Projects\...` as `C:\Users\Erez\AI` (cut at the first space).

| Class | Audit findings | Today (CLAUDE.md) | GEN-891 as planned | Gap? |
|---|---|---|---|---|
| 1. Reference to a missing file or folder | H3 (`rules/`, `prompts/`, `scripts/`) | Should catch; the scan missed bare folder names | Weekly dangling-reference check | **Yes**: the existence check only tests backticked slash commands, absolute `C:\` paths and .ps1/.js/.json/.jsonl/.md file names, never bare folder names (the space-cut is only in the non-finding candidate list) |
| 2. Claim that content lives somewhere it no longer does (target file exists) | H1, half of M11 | No | Only if the citing section changed; here the target changed, not the skill | **Yes** |
| 3. Wrong internal step/section number | H2 | Check 7 (CLAUDE.md only) | Not listed (it lists files, scripts, skills, commands, tickets) | **Yes** |
| 4. Ambiguous file name (two files match) | M9 | No | An existence check passes it | **Yes** (minor) |
| 5. Hardcoded time-varying facts (paths, counts, model names) | M1, M2, F5 | Check 1 (IDs, dates, paths; CLAUDE.md only; counts not extracted) | Not listed | **Yes** for skills, and counts anywhere |
| 6. Edit-history text ("corrected on…", "an earlier version…", "moved from…") | M10-M15, F8 | Not a check kind | Not listed ("stale wording" is the nearest) | **Yes** (largest class: about 15 spots) |
| 7. Instructions the model cannot scope ("first run only") | M3, M4 | Check 6 (CLAUDE.md only) | Not listed | **Yes** for skills |
| 8. Wording tuned for older models (shouting, heartbeat cadence, "think harder") | M5, M6, F4, F6 | No | No | **Yes** |
| 9. Behavior text inside a skill description (loads in every request) | M7, M8 | n/a | No (GEN-886 checks description length only) | **Yes** |
| 10. Contradictions between files that were already there | F1 (skill vs skill), F2 (skill vs global rules) | n/a | Only on changed sections, so existing ones never surface | **Yes**: needs a one-time full baseline sweep |
| 11. Contradiction inside one CLAUDE.md | F3 | Check 3, but auto mode reviews only changed rules; a full sweep has not caught it | n/a | Partly: covered by a full sweep (GEN-674 will run one on the global file) |
| 12. Possibly-both-true dated quotes | F7 | n/a | n/a | No ticket: low value, the audit itself rated it low |

Coverage the audit did not have: it skipped `~/.claude/hooks/refs/`, skill reference files and scheduled-task skills. GEN-891 includes `hooks/refs`; GEN-886 covers sizes. So GEN-891 stays needed after this run.

Side finding for F1: `~/.claude/settings.json` sets `"defaultMode": "auto"`, not `bypassPermissions`. So `/vet-ticket`'s "falls through silently under bypassPermissions" does not match the configured default. The mode a given session actually runs in (a launch flag or mid-session switch can differ) and whether the pass-file write prompts under auto mode are both unverified, so both sides of F1 may be wrong.

## Proposed homes
- Classes 1-10: widen GEN-891 (add these check kinds, a one-time full baseline sweep, and fix the scan's folder/space parsing). One ticket, since all of it changes the same skill and script.
- Class 11 and the global-file findings (M5, F3, F4, F5): already GEN-674's work (it waits for this run).
- Applying the audit's proposed edits to the skills (H1, H2, M1-M4, M6-M15) and settling F1/F2: no ticket yet; a new one.
- H3 (project CLAUDE.md): part of the new ticket.
