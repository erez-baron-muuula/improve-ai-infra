# GEN-860 local handoff (written 2026-10-14 from a cloud session)

Why this exists: GEN-860 needs files on Erez's PC. The 2026-10-14 cloud session could not reach them, so the work moves to a local session in the Claude desktop app (Code tab, Improve AI Infra folder). The prompt below is meant to be pasted as-is.

## Prompt to paste

```
Project: Improve AI Infra. Work on GEN-860 (Notion Team-Tasks, not Jira): https://app.notion.com/p/3f96e495d07c81678c90ecb5b9695f05
Run on Opus at high effort. This must be a local PC session; stop and tell me if it isn't.

Step 0 - pick up the cloud session's leftovers:
1. git fetch origin ccr-8d1116c4-q7734g, then merge it into the current branch. It adds two files only: HISTORY.pending-noSID-20261014T1000Z.md and notes/gen860-local-handoff.md.
2. Prepend that pending entry to HISTORY.md with prepend-log.ps1 (the /wrap Step 4 procedure), delete the pending file, commit, push.
3. Log two mistakes from that cloud session on GEN-58 (current volume): (a) looked for GEN-860 in Jira before Notion, because cloud sessions have no global CLAUDE.md; (b) asked me a decision I had already answered, because the 2026-10-14 (1) session's record split or dropped my answer. Then propose (via the normal rule-change process, not applied without my approval) this global rule: "When recording a decision, quote Erez's answer verbatim and name the exact question it answered. If one answer could cover more than one open decision, ask which ones before recording it."

Read before anything else: GEN-860; GEN-859 (https://app.notion.com/p/3f96e495d07c8105a256f6ef8469af9d); notes/two-account-session-sharing-handoff.md; the two 2026-10-14 entries in HISTORY.md.

Decisions already made (do not ask again):
- Backup goes to Google Drive, in a folder only erez@muuula.com and info@muuula.com can open (second account named 2026-10-14).
- No age limit on the desktop app's local sessions for now (option A).

Still open, ask one at a time, recommended option first:
1. How long the Drive copy is kept. I said I answered this already, but no record has it. Ask once: did my "no limit" answer also mean the Drive copy keeps everything (add-only, nothing deleted automatically)? Record my answer verbatim in GEN-860.
2. Whether to set cleanupPeriodDays 90 in C:\Users\Erez\.claude\settings.json as a safety net (GEN-860 open decision 1).
3. Where the Drive folder sits inside the private _Tooling area (GEN-860 step 1 says to confirm the location with me first).

Order of work once those are answered:
1. Before any GEN-859 edit: back up the app's two session-list folders, C:\Users\Erez\AppData\Roaming\Claude\claude-code-sessions\a47791bc-f28c-4025-a47f-f39d0eee57dd and \c68119fc-d3d6-4fe0-a413-6ebbed20cbb0. The handoff note proposed notes\ in this project and I never confirmed that; GEN-860 step 1 already puts this whole claude-code-sessions folder in the Drive backup, so propose doing it there.
2. GEN-860 step 1: copy C:\Users\Erez\.claude\projects (about 1.3 GB) plus claude-code-sessions to the Drive folder, add-only (never mirror deletions), share it only with info@muuula.com, check one sample file restores byte-identical, record the location and refresh method in notes. The recurring copy is its own step.
3. GEN-860 step 3 (can run any time): check the 150 server-side copies of lost sessions and the 4-14 Oct file-date rewrite.

My standing preferences apply: before writing any script or automation, list every assumption as a numbered checklist and wait for my confirmation; one question at a time.
```

## Context the prompt relies on
- GEN-794 (cloud sessions should match PC sessions) got a 2026-10-14 section from this cloud session: https://app.notion.com/p/3f36e495d07c81f7850fed2e26e378b8
- GEN-860 was updated on 2026-10-14 with the second account (info@muuula.com).
