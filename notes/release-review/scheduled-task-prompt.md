taskId: release-review-weekly
title: Weekly Claude Code release review
cron: 0 9 * * 4   (Thursdays 09:00 local; Erez chose Thursday 2026-10-15)
description: Weekly unattended review of new Claude Code releases against our setup and open tickets (GEN-871)

PROMPT:
# Weekly Claude Code release review (GEN-871)

Unattended weekly run. Nobody is watching: never ask a question or wait for an answer.

Invoke the Skill tool with skill `release-review` and args `scheduled`, and follow that skill
exactly — it is the whole procedure (collect new Claude Code versions since the last one reviewed,
match them against our hooks/skills/scripts/scheduled tasks and the open Team-Tasks tickets, verify,
then file through the ticket-quality gate within its caps, append the digest, record the run).

Context, in case the skill cannot be loaded: the skill file is
`C:\Users\Erez\.claude\skills\release-review\SKILL.md`; its state and logs live in
`C:\Users\Erez\AI Projects\Improve AI Infra\notes\release-review\`. The parent ticket is GEN-871
(Notion page id 3fa6e495-d07c-8142-97aa-de075c87b739). If the skill is missing or unreadable, do
NOT improvise the review: append a run row with outcome "failed" and note "skill not found" by
writing a run JSON file and running
`node "C:/Users/Erez/AI Projects/Improve AI Infra/notes/release-review/release-review-tool.js" record-run "<that file>"`
(mode "live", from and through both = the lastReviewedVersion in state.json), then stop — the
/wrap readout will surface it.

End with the skill's short final report.
