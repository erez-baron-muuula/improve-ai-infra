# GEN-703 — Step 1 test results (2026-10-20)

Plan: `C:\Users\Erez\.claude\plans\investigate-why-we-having-parsed-meerkat.md` (approved 2026-10-20).

Baseline (step 0): median 11.5 s from first user message to Claude's first reply over 25 recent sessions (range 4.6–17.3 s).

Test rig: scratch folder with a project `settings.local.json` registering one `async: true` SessionStart hook (`probe.js`: node → attached `spawnSync` PowerShell, `windowsHide`, 60 s sleep, logs start/end). Two desktop-app sessions opened by Erez.

| Check | Result | Evidence |
|---|---|---|
| (a) runs on session start | yes | probe-log start 08:04:52Z (session ba28a756), 08:07:05Z (b52c7a5a) |
| (b) no window / antivirus | yes | Erez: "done, no window or antivirus warning" |
| (c) first reply does not wait | yes | ba28a756: msg 08:05:24.7, reply 08:05:30.0, hook ended 08:05:54; b52c7a5a: msg 08:07:10.0, reply 08:07:18.7 |
| (d) survives while open | yes | ba28a756 hook ran full 62 s, exit 0 |
| (e) session archived early | killed silently | b52c7a5a: no end/SIGTERM record; pid 30700 gone at 08:08:47Z |

Consequence: build includes the interrupted-run marker and leftover-safety-ref cleanup (plan Step 2, last bullet).

To fold into the GEN-703 body at close-out (body edits need /vet-ticket).
