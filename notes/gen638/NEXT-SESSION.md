# Paste this as the first message of the next GEN-638 session

> Pick up GEN-638 (https://app.notion.com/p/3b26e495d07c81f68d1aebc8428e377b) in the Improve AI Infra project. Read `notes/gen638/HANDOFF.md` first — it is the cold-pickup record and says where every step stands. Step 3 finished on 2026-10-04: the key-leak tripwire is installed and `/wrap` runs it as Step 0b. Next is **step 4**: before I replace anything, list every exposed key and everything that still uses it (scripts, MCP connectors, Apps Script, scheduled tasks), so nothing breaks unnoticed — then walk me through replacing them one at a time. Re-read `notes/gen638/plan.md` step 4 and the "Step 4 inputs" section of the handoff first. Effort: medium.

## Facts the next session needs (all also in HANDOFF.md)

- **Tripwire baseline (2026-10-04):**
  - Of the keys stored on this PC, only the **Notion** key is still found in session logs (2 files).
  - The current Atlassian key and the current GitHub login are clean.
  - Slack is not stored on this PC.
  - The old exposed GitHub, Slack and Atlassian values are no longer stored here, so the tripwire can't see them. They still need cancelling at each service.
- **Until Notion is replaced, every `/wrap` reports it** and re-scans all logs (~7 s). This is expected.
- **After replacing keys:**
  - Erez stores each new value himself with `set-claude-key.ps1 -Key <name>`.
  - For GitHub, he signs in again through Git.
  - The Gemini key goes into Apps Script Script Properties `GEMINI_API_KEY`.
  - Then Claude runs `& "C:\Users\Erez\.claude\scripts\key-leak-tripwire.ps1" -All`. That is step 5's re-scan, and it must show no `found`.
- **Never open a log file the tripwire reports as `found`.** Doing so copies the key into the session.
- **Working rule:** never type the Atlassian write script's name in a shell command, not even in cat, grep, `git add <file>`, `git commit -m` or a `node -e` one-liner. It is refused with no override. Use the Read/Grep/Edit/Write tools, `git add -A <folder>`, and `git commit -F <file>`.
- **Remaining bundle steps:**
  - 4: list the users of each exposed key, then Erez replaces each key and Claude retires the old ones (medium; needs Erez).
  - 5: verify every key user still works, re-scan with `-All`, and update the titles, bodies and status of GEN-638, 639, 425 and 163 (medium).
- **Separate follow-up:** [GEN-766](https://app.notion.com/p/3ef6e495d07c8158a0fad3c85a2d40d9) covers the pass-reader weaknesses in `auto-approve.js`. It is not part of GEN-638.
