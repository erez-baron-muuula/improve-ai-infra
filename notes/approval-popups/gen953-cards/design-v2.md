# GEN-953 step 2, rework: pop-up wording that can never read milder than today (design v2)

## In plain words (for Erez)

**What changes from the first build.** Each browser pop-up for a change opens with a fixed sentence for its kind of action, never milder than today's wording, for example "Typing a database command that can change or delete data." What the check recognizes is then *added* ("It spotted that it deletes data"), and when it reads something it cannot name it says so ("and other commands it cannot name"). A case the check misses therefore only loses detail; it can no longer make a dangerous action look mild. That is the one property the last three review rounds kept breaking.

**Same layout every time, most important first:** what kind of change it is, then the site, then "Undo is not guaranteed. Allow only if this matches what Claude told you it would do.", and **Claude's own description last**, labelled as not checked. Nothing the check says comes after Claude's words, so Claude's words cannot pose as the check's.

**Unchanged:** when a pop-up appears (same number of pop-ups), and everything about the decision.

**Effort:** xhigh. About 45-60 minutes including a design review and both code reviews, then your install approval and a short live test.

---

## Technical detail

### Goal and the invariant
Goal (Erez, 2026-10-25): pop-ups must not look trivial when they are not, and must not be too technical. Erez, 2026-10-26: "I tend to say rework, unless you think there's a better alternative we are missing. search for best practices for this topic in official and unofficial sites, take into account all that we have tried working on this topic, and in general in our project, and come up with the best solution possible once it has converged."

**Invariant (new, mechanically tested):** for every ask, the card contains the floor sentence of every change cause it carries. Specific labels are only additions. A property test enforces it over the 702 real asks in the replay corpus plus generated hostile inputs (quotes of every style, comments, cut texts, odd Unicode), so review no longer has to predict each miss.

### Why (what we tried, and what the sources say)
- **v1 failed by construction.** Three code-review rounds (in-session `/code-review` high + an independent Opus reviewer each round, 2026-10-26) each found the next pattern miss: a comment marker or quote hiding a later DROP; the 6-summary cap hiding a danger; then an apostrophe inside `$$`, `"…"`, a backtick name or a separate script string hiding a DELETE, and a danger word after Claude's summary was cut to 80 characters (round-3 probe output, `scratchpad/r3probe.js`: `insert…; select $$it's$$; drop table t; select 'x'` → "adds or changes data"). No round found a decision change. Root: each specific label *replaced* today's general sentence (`wc.diff`, `plainReason`).
- **Same lesson, seventh time.** GEN-58 Class E element "enumerate-vs-whitelist", now seen 7x (GEN-58 index, updated 2026-10-26), including four GEN-924 browser-gate rounds (Vol. 11 traces 2026-10-20/21): when a rule enumerates known cases, make a miss fall to the safe side by construction rather than predicting the next case.
- **Microsoft warning-message guidance** (learn.microsoft.com/en-us/windows/win32/uxguide/mess-warn, "Be specific"): when the cause is not known for sure, "be specific by giving the most likely information or the most common example. However, in such cases, use wording that indicates that there are other possibilities. Otherwise, users might be misled." Also: be specific about the condition and the problem; one concise main sentence; don't overwarn; don't use the words "warning"/"caution".
- **NN/g confirmation dialogs** (nngroup.com/articles/confirmation-dialog): be specific about what the action will do, in user terms; generic "are you sure" prompts get a reflexive yes; don't overuse.
- **Habituation research** (Anderson et al., "From Warning to Wallpaper", MISQ / researchgate 311504173; Bravo-Lillo SOUPS'14): identical repeated warnings become wallpaper; variation tied to the actual risk reduces habituation. Supports keeping specific labels (not only fixed sentences).
- **Approval fatigue** (anthropic.com/engineering/claude-code-auto-mode): users accept 93% of manual prompts; "people stop paying close attention to what they're approving". Supports few, specific prompts; the count is step 3's job.
- **Approval text must match the action** ("Loopjacking", arXiv 2609.21081 abstract): approval is only meaningful if what is shown is what runs; misrepresentation at approval time is the attack. Supports: the check's own words come from what it reads, never from Claude, and Claude's words are positioned and labelled as unverified.
- **SQL classification practice** (search 2026-10-26: sqlparse-based validator commit at git.supported.systems; DuckDB/posit-dev issue 58): regex misses structure; parsers/lexers handle quote and comment boundaries; anything that fails to parse should get the *strict* outcome, never a weaker fallback. Here the strict outcome is the floor.

### The design
1. **Floors per cause** (plain versions of today's meaning; today's text is `ASK_TEXT` in the live `~/.claude/hooks/browser-site-gate.js:479-498`, e.g. typed-write "Typing a database command that changes or deletes data.", word "This action may change, send, delete, pay, share or grant something: …"):
   - typed-write: "{Typing | The script runs | Typing or a page script runs} a database command that can change or delete data."
   - helper-args: "The script hands code an earlier script left on the page something other than a look-only database query, which can change or delete data."
   - risky-script: "A page script that can change the page or send data." (as v1)
   - word, when the decision's own danger lists match Claude's full summary (`wordHit`): "This may change, send, delete, pay, share or grant something." When they do not (strict mode asked only because it was not a recognised look): "The check cannot confirm this only looks at the page."
   - high-stakes, follow-up, new-site, typed-enter, uploads, unclassified causes: as v1.
2. **Additions, never replacements:** after the floor, "It spotted that it …" listing every recognised kind, worst first (SQL kinds, script kinds, the danger kind named in Claude's summary). If a write statement remains that no kind names: "… and other commands it cannot name". If the text was cut, or a quoted value never closes: "The check could not read all of it."
3. **SQL reading fixes:** read each typed text and each script string on its own (never across a join); the scanner consumes `'…'`, `"…"`, `` `…` `` and `$$…$$` spans whole, so an apostrophe inside one cannot open a fake string; per statement (split on `;` after blanking), a statement starting with a write verb from the decision's own list (`STATEMENT_WRITE`) that no kind names triggers "other commands it cannot name".
4. **Claude's words:** kinds are worked out from the full summary in `decide()` (in memory only, capped at 2,000 characters, never saved or logged, as v1's `texts`); shown up to 120 characters with "…" when shortened; every summary with a danger word is shown, plain ones fill up to 6.
5. **Order and source:** card opens "Browser safety check:"; then change sentences (worst cause first), then the new-site sentence, then "Site: …", then "Undo is not guaranteed. Allow only if this matches what Claude told you it would do." (any change cause), and **last** "Claude says (not checked): …". v1's "Claude says first" variant for plain clicks is dropped. Unicode control and format characters (`\p{Cc}`, `\p{Cf}`, which include the text-direction overrides; checked in Node 22.16: U+202E and U+200F match `\p{Cf}`) are removed from Claude's words; quote look-alikes are mapped to `'` (property `\p{Quotation_Mark}` plus the ones it misses, checked in Node: ״ ʺ ˮ ❝ ❞).
6. **Unchanged from v1:** text built after the decision is made and logged; any error falls back to the legacy text; texts/claims never saved or logged; `TEXT_CAP` 20,000.

### Alternatives considered
- **Fixed sentences only, no specific labels.** Cannot understate and needs no classifiers. Strongest case: zero pattern code to maintain, reviews end. Rejected as the main design because every change would read the same (habituation research above) and the approved plan asked for "replaces live code"-style specifics; it is the fallback if v2 also fails review.
- **A real SQL parser package.** More accurate labels. The hooks use only Node built-ins (checked: `require` calls across `~/.claude/hooks/*.js` are fs/path/os/child_process/crypto/assert/https and local files); a Snowflake-dialect parser would bring a large third-party package into a safety hook. With the floor, a miss only loses detail, so the extra accuracy is not worth that.
- **An AI-written explanation (a model call from the hook).** Best readability for odd actions. Rejected: page text or SQL comments could talk it into a reassuring line (the misrepresentation attack above); adds delay and cost; Anthropic's own classifier misses 17% of overeager actions (auto-mode post).
- **A danger marker (emoji) on the worst kinds.** Makes the worst stand out, but an unmarked miss then looks safe by contrast; rendering in the pop-up is unverified.
- **Showing the raw command in the reason line.** The app's details box under it already shows Claude's raw request; repeating SQL is the jargon Erez asked to remove.
- **Complementary, not instead:** step 4 (a look-only Snowflake login for Claude) removes most risky typed-SQL pop-ups at the source (least privilege, OWASP LLM06:2025 "Excessive Agency"). Recommended as the next decision after this step.

### Verification
- Property test of the invariant over the 702 real asks and generated hostile inputs; the round-3 cases (`$$`, `"…"`, backtick, cross-string apostrophe, late danger word, REPLACE INTO, U+202E) as named tests.
- Existing 117 tests updated; replay of 3,232 real calls: 0 decision and 0 state differences; card length stats reported.
- Both code-review passes; secret scan; pass-consumption fixture.
- Live test with Erez: a Snowflake change card, a page-script card, and one long card (only ~160-character reasons have been seen in full on screen so far; longer ones are unverified).

### Size
size: skipped (no limit in `notes/anthropic-guidelines.json` applies to a hook source file or its ask text).

### Residual
- For ordinary clicks the specific kind still comes from Claude's own description; a misleading description gives no specific label (the floor and "not checked" label remain).
- Pattern-based specifics still miss cases; now a miss only loses detail.
- Display of cards longer than ~160 characters is unverified until the live test; the order puts the check's own words first so any cut falls on Claude's words.
- Text only: a dangerous action still gets a pop-up only when the decision rules ask (unchanged; step 3 and the 8 Nov count cover frequency).
