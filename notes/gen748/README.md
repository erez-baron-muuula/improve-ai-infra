# GEN-748 / GEN-684: For-you follow-up re-nudge and marker-regex bound

Installed 2026-09-29 via /vet-code into `~/.claude/hooks/stop-foryou-nudge.js` and `~/.claude/hooks/stop-cred-denial-surface.js`. The design and its evidence are in each hook's header comment (FOLLOW-UP RE-NUDGE; the MARKER_RE comment).

## Scripts (all read-only unless noted)
| Script | What it answers | Last figure (2026-09-29) |
|---|---|---|
| `run-fixtures.js` | Regression suite. It drives the installed hooks, or `HOOK_UNDER_TEST` / `CRED_UNDER_TEST`, through stdin using transcripts cut from real sessions. It writes fixtures to `%TEMP%\gen748-fixtures`. Set `BASELINE_HOOK` to a pre-GEN-748 copy to also run F1b. | 44/44 |
| `renudge-replay.js <hook>` | Replays the re-nudge decision over every real hook-opened follow-up Stop. | 4 fires / 243 follow-ups whose content the transcripts show in order: 1 true, 1 borderline, 2 cheap false |
| `renudge-scan.js <boundary-ISO> [hook]` | Production reader for the one-time `gen748-renudge-verify` scheduled task. It counts actual re-nudge fires, misses and suspect duplicates since the boundary, and checks the harness still writes Stop summaries before the follow-up. | Pre-install baseline: 0 fires, 4 misses |
| `gen684-replay.js [file]` | Compares the old and new MARKER_RE over every real assistant text. | 13,140 texts, 1,273 matches both, 0 lost |
| `survey-followups.js` | Census of Stop-hook-opened follow-ups. | 899 For-you-opened; 243 with in-order content |
| `build-reply-corpus.js` → `regress-firststop.js` | First-Stop regression: `BASELINE_HOOK` vs the hook under test must give byte-identical output on real turn-final replies. The corpus is written to `%TEMP%\gen748-fixtures\`; run `run-fixtures.js` first. | 261 identical, 0 differ: 200 via the shared-fixture path plus 61 on the replies' own transcripts (`--modeB-only`) |
| `trimend-equiv.js` | Checks that `trimEnd()` equals `replace(/\s+$/, '')` for every BMP code unit, and compares their timing. | equal; 0 ms vs 4.78 s at 100K |

## Caveat on the corpus
Claude Code up to 2.1.260 wrote Stop summaries in a batch after the follow-up. From 2.1.270 on, each summary is written before the follow-up it opens. Only follow-ups written in the newer order can be judged, and the re-nudge anchor depends on that order. `renudge-scan.js`'s anchor bar watches for a regression.

Claude Code prunes old transcripts. `run-fixtures.js` cuts specific real transcripts, so a pruned source makes that case throw "transcript not found". Rebuild the case from a newer transcript of the same shape.
