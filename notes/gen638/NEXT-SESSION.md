# Paste this as the first message of the next GEN-638 session

> Pick up GEN-638 (https://app.notion.com/p/3b26e495d07c81f68d1aebc8428e377b) in the Improve AI Infra project. Read `notes/gen638/HANDOFF.md` first — it is the cold-pickup record and says where every step stands. Step 2 finished on 2026-10-04 (GEN-765 Done: the Atlassian write path was redesigned, installed and live-verified). Next is **step 3**: the end-of-session tripwire that flags any key stored in Credential Manager if its value appears in the session log. Start by re-reading the approved bundle plan `notes/gen638/plan.md` step 3, then form a design with /suggest and run /check on it before showing me. Effort: xhigh.

## Facts the next session needs (all also in HANDOFF.md)

- **Shipped and live:** the key helper `set-claude-key.ps1`; `atlassian-get.ps1`; `atlassian-put.ps1` (takes `-Jira <KEY>` or `-ConfluencePage <id>`, never a URL); the staging-gate changes in `auto-approve.js`; the staging skill text; the key-sheet guard. Don't re-install any of it.
- **Keys stored on this PC:** Notion and Atlassian (Atlassian is a NEW token, "Claude Code – Erez PC – 2026-10 2"). Slack is NOT stored yet: Slack pin/post stops and names the command until Erez runs `set-claude-key.ps1 -Key slack`.
- **Old Atlassian keys are still valid** (they were exposed in old logs). Revoking them belongs to step 4, after checking what still uses them.
- **Working rule:** never type the Atlassian write script's name in a shell command (not in cat, grep, `git add <file>`, `git commit -m`, or a `node -e` one-liner). It is refused with no override. Use the Read/Grep/Edit/Write tools, `git add -A <folder>`, and `git commit -F <file>`.
- **Remaining bundle steps:** 3 tripwire (xhigh) → 4 Erez replaces every exposed key and Claude retires the old ones (medium; needs Erez) → 5 verify every key user still works and re-scan the logs (medium).
- **Separate follow-up:** [GEN-766](https://app.notion.com/p/3ef6e495d07c8158a0fad3c85a2d40d9) covers older fail-open weaknesses in the shared approval-file ("pass") reader in `auto-approve.js`. They are not part of GEN-638.
