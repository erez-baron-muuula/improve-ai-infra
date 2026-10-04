# Paste this as the first message of the next GEN-638 session

> Pick up GEN-638 (https://app.notion.com/p/3b26e495d07c81f68d1aebc8428e377b) in the Improve AI Infra project. Read `notes/gen638/HANDOFF.md` and `notes/gen638/step4-inventory.md` first. Step 4 is in progress: Notion and Gemini were replaced on 2026-10-04. Continue with **key 3 of 6, Slack**, then Atlassian, GitHub, and the rest of the key sheet — walk me through them one at a time. Effort: medium.

## Facts the next session needs (all also in HANDOFF.md / step4-inventory.md)

- **This is Erez's only PC** — each key is stored once.
- **Notion:** new "Muuula 1" token stored and verified; tripwire `-All` clean (4,275 files). Old token stays valid until 2026-10-11 21:16 GMT+3 (Erez chose the 7-day grace) — step 5 confirms it is gone.
- **Gemini:** new key in Script Property `GEMINI_API_KEY`, old key deleted in AI Studio. Proof is the first daily run after the switch: scheduled task `gen638-gemini-key-check` (2026-10-05 10:00) reads the logs and appends the result to `step4-inventory.md`. Check that result first.
- **Slack:** used only by `G:\My Drive\AI Projects\_Tooling\Claude\slack-post.js` / `slack-pin.js` (Credential Manager `claude-slack-token`, NOT stored on this PC yet).
- **Atlassian:** current scripts use the new token ("Claude Code – Erez PC – 2026-10 2", clean). Revoke the 3 old ones. Forge CLI has its own Atlassian login (Credential Manager `Atlassian/Ecosystem`); unknown whether it is one of the exposed values — safest is a fresh `forge login` by Erez.
- **GitHub:** the 2 exposed PATs are old; Git on this PC uses a clean login; no workflow reads a secret. Revoke the old PATs at github.com.
- **Rest of the key sheet:** the 2026-09-27 leak captured the whole sheet; Erez reviews its rows himself (never open it in a session).
- **After all replacements:** `& "C:\Users\Erez\.claude\scripts\key-leak-tripwire.ps1" -All` (its own tool call — chaining it with another command is refused) must show no `found`.
- **Never open a log file the tripwire reports as `found`.** Never type the Atlassian write script's name in a shell command.
