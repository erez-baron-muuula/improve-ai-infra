// GEN-674 headroom step: build working copies of every file the rule moves touch, from the live files.
// Each replacement must match exactly once; the script aborts otherwise. Output goes to OUT_DIR,
// one file per target, named after the target. Usage: node headroom-build.js <outDir>
const fs = require('fs');
const path = require('path');
const HOME = process.env.USERPROFILE;
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node headroom-build.js <outDir>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

function apply(src, pairs, label) {
  let s = src;
  for (const [oldT, newT] of pairs) {
    const n = s.split(oldT).length - 1;
    if (n !== 1) { console.error(label + ': expected 1 match, got ' + n + ' for: ' + oldT.slice(0, 70)); process.exit(2); }
    s = s.replace(oldT, () => newT);
  }
  return s;
}

// ---------- global CLAUDE.md ----------
const OLD_STATUS = "When creating a ticket, the status you set or propose is the one actually true of it, never a fixed default: waiting on something else to happen first, including a decision Erez hasn't been asked for → Backlog; ready to be worked → To Do; held by a specific blocker, including one awaiting Erez's own input on a question already put to him → Blocked; work already begun → In Progress; only recording work already finished → Done; existing so someone or something can review it → Review; decided against → Wont Do. This supplies the value, not the authority: outside a flow already exempt from the draft-for-approval step in \"Before creating or materially changing a ticket in a tracker\", this status is part of the proposal Erez approves, not one set outright. Read the tracker's live status options first (names can change) and honour any project-specific exception that fixes a ticket type's status. Where a procedure names a single status for the tickets it files, treat it as the fallback for an item whose right status is genuinely undeterminable, not as an override.";
const NEW_TICKET_RULE = "When creating a ticket, the status you set or propose is the one actually true of it, never a fixed default; read the tracker's live status options first. Route a ticket by the domain the problem belongs to, not by who fixes it, and name it by the goal/outcome, not a presumed solution or technology, retitling it if what gets built departs from an approach the title names. For a follow-up action item, create a ticket, assigned to Erez only if it needs a manual action from him, otherwise unassigned; assignee is the authoritative ownership signal. For a Team-Tasks ticket, `/vet-ticket` holds the full detail (status mapping, template, routing) in its Step 1, which its runbook reads before drafting.";

const RULES = [
  // Ticket-creation cluster: L53, L57, L59, L61, L63 become one rule; Team-Tasks detail moves to /vet-ticket.
  ["For a follow-up action item, create a ticket: assign it to the user if it needs a manual user action, leave it unassigned if Claude can do it in a future session. Assignee is the authoritative ownership signal.\n\n", ""],
  [OLD_STATUS, NEW_TICKET_RULE],
  ["Route a ticket by the domain the problem belongs to, not by who fixes it: a problem existing only because of a specific tool/platform's behavior (Notion, Jira, Git, etc.) goes under that platform's epic/area even when Claude does the fix. Reserve the AI-infra / process area for genuinely cross-platform issues or ones about Claude's own reasoning, prompts, or workflow.\n\n", ""],
  ["Name a ticket by the goal/outcome, not a presumed solution or technology (e.g. \"Enable write access to the sheet,\" not \"Build a Sheets MCP\"). If implementation later deviates from an approach named in the title, update the title to match what was built — don't leave the old approach in the title with only a note in the body.\n\n", ""],
  ["When creating a Team-Tasks item, check whether a template exists for its type and apply it.\n\n", ""],
  // Rule-drafting style moves into the /check rule-check lens; a pointer stays in the /check-before-edit rule.
  ["(`/check` revises text in chat, not the file, so its own revisions don't re-trigger this step.)",
   "(`/check` revises text in chat, not the file, so its own revisions don't re-trigger this step.) Draft the text to the style the `/check` rule-check lens checks: state the behavior to take, use examples only where they change behavior, and cite other rules by a distinctive quoted phrase, never by position."],
  ["When drafting or revising a rule, state the behavior to take rather than to avoid, where that preserves meaning without materially adding length; keep genuine prohibitions (safety, scope limits, hard constraints) as explicit negatives. Omit illustrative examples by default — keep a concrete instance only when removing it would change the behavior the rule produces (the wording would otherwise be genuinely ambiguous, or the instance shows a literal form prose cannot reproduce); if its substance can instead be stated as a qualifier in prose, do that and drop the example; never use the real-world event that prompted the rule as its example. When one rule in a `CLAUDE.md` file references another rule, identify the target by a distinctive quoted phrase from it (e.g. its opening words) — or, for a whole section, by its heading — never by position (\"the rule above/below\"): positional references break silently on reorder or consolidation — the text still reads fine but points at the wrong rule, or nothing.\n\n", ""],
  // AskUserQuestion pointer: the hook's refusal carries the whole rule.
  ["AskUserQuestion (the popup question/button widget) is blocked by the `deny-askuserquestion.js` hook, whose refusal message carries the full inline-prose redirect (options and trade-offs spelled out).\n\n", ""],
];

// ---------- vet-ticket/SKILL.md ----------
const VT_SKILL = [
  ["Draft the exact `tool_input` (a Team-Tasks create or material body change carries `Urgency`,\n`Gain ratio` and the derived `Priority`). Write it to a temp `.json` file and get the hash from the\nhook, never by hand:",
   "Draft the exact `tool_input` (a Team-Tasks create or material body change carries `Urgency`,\n`Gain ratio` and the derived `Priority`). A create also sets the status actually true of it and its\nassignee, and applies the template for its Type when one exists (the creation fields in\n`review.md`). Write it to a temp `.json` file and get the hash from the hook, never by hand:"],
];

// ---------- vet-ticket/review.md ----------
const VT_REVIEW = [
  ["Full detail for runbook (`SKILL.md`) Steps 0b, 1 and 2. Read the section for the step you are on\nbefore doing it, every run.\n",
   "Full detail for runbook (`SKILL.md`) Steps 0b, 1 and 2. Read the section for the step you are on\nbefore doing it, every run.\n\n**Contents:** Step 0b (search for an existing home) · Step 1 (draft and hash, creation fields) ·\nStep 2 (independent review).\n"],
  ["the write blocks with `no-token`.\n\n## Step 2 — Independent review\n",
   "the write blocks with `no-token`.\n\n" +
   "### Creation fields\n\n" +
   "- **Status:** the one actually true of it, never a fixed default: waiting on something else to happen\n" +
   "  first, including a decision Erez hasn't been asked for → Backlog; ready to be worked → To Do; held by\n" +
   "  a specific blocker, including one awaiting Erez's own input on a question already put to him →\n" +
   "  Blocked; work already begun → In Progress; only recording work already finished → Done; existing so\n" +
   "  someone or something can review it → Review; decided against → Wont Do. This supplies the value, not\n" +
   "  the authority: outside a flow already exempt from the draft-for-approval step in the global rule\n" +
   "  \"Before creating or materially changing a ticket in a tracker\", this status is part of the proposal\n" +
   "  Erez approves (his Step 5 card approval covers it, though the card does not show it), not one set\n" +
   "  outright. Read the live status options first (names can change) and honour any project-specific\n" +
   "  exception that fixes a ticket type's status. Where a procedure names a single status for the tickets\n" +
   "  it files, treat it as the fallback for an item whose right status is genuinely undeterminable, not\n" +
   "  as an override.\n" +
   "- **Template:** check whether a template exists for the ticket's Type (a fetch of the Team-Tasks data\n" +
   "  source lists them under `page_templates`) and apply it. The create tool takes it as `template_id`,\n" +
   "  and then takes no `content`; add the body with a follow-up gated edit.\n" +
   "- **Assignee:** Erez if the ticket needs a manual action from him, otherwise unassigned, unless Erez\n" +
   "  names an owner; assignee is the authoritative ownership signal.\n" +
   "- **Home and name:** route by the domain the problem belongs to, not by who fixes it: a problem\n" +
   "  existing only because of a specific tool/platform's behaviour (Notion, Jira, Git, etc.) goes under\n" +
   "  that platform's epic even when Claude does the fix; the AI-infra / process area is for genuinely\n" +
   "  cross-platform issues or ones about Claude's own reasoning, prompts, or workflow. Name it by the\n" +
   "  goal/outcome, not a presumed solution or technology (e.g. \"Enable write access to the sheet,\" not\n" +
   "  \"Build a Sheets MCP\"). Review items 3 and 4 (Step 2) check both.\n\n" +
   "## Step 2 — Independent review\n"],
];

// ---------- check/SKILL.md (rule-check lens) ----------
const CHECK = [
  ["flag any example that is decorative or merely restates the incident that prompted the rule);",
   "flag any example that is decorative, could instead be stated as a qualifier in prose, or uses the real-world event that prompted the rule);"],
  ["positively phrased (states the behavior to take, not only what to avoid — unless a genuine prohibition, which stays an explicit negative);",
   "positively phrased (states the behavior to take, not only what to avoid, where that keeps the meaning without materially adding length — unless a genuine prohibition [safety, scope limits, hard constraints], which stays an explicit negative); cross-references (a rule that refers to another rule names it by a distinctive quoted phrase from it, such as its opening words, or a whole section by its heading — never by position, which breaks silently when rules are reordered or merged);"],
];

// ---------- wrap/step1-capture.md ----------
const WRAP = [
  ["Route by domain per the global rule \"route it by the domain the problem belongs to, not by who fixes it\"",
   "Route by domain per the global rule \"Route a ticket by the domain the problem belongs to, not by who fixes it\""],
  ["Task template applied (check the template exists and apply it, per the standing Team-Tasks rule).",
   "Task template applied (check the template exists and apply it, per `/vet-ticket` Step 1)."],
];

// ---------- InvoiceAutomation/CLAUDE.md ----------
const INVOICE = [
  ["- Ticket status, Done-vs-Review, follow-up tickets and assignee-as-ownership follow the global rules. Keep only project facts and the exceptions below here.",
   "- Ticket rules follow the global rules and `/vet-ticket`; keep only project facts and the exceptions below here."],
  ["**narrows** the global rule, which counts \"awaiting Erez's own input\" as Blocked:",
   "**narrows** `/vet-ticket`'s status mapping, which counts \"awaiting Erez's own input\" as Blocked:"],
];

const TARGETS = [
  ['CLAUDE.md', path.join(HOME, '.claude', 'CLAUDE.md'), RULES],
  ['vet-ticket-SKILL.md', path.join(HOME, '.claude', 'skills', 'vet-ticket', 'SKILL.md'), VT_SKILL],
  ['vet-ticket-review.md', path.join(HOME, '.claude', 'skills', 'vet-ticket', 'review.md'), VT_REVIEW],
  ['check-SKILL.md', path.join(HOME, '.claude', 'skills', 'check', 'SKILL.md'), CHECK],
  ['wrap-step1-capture.md', path.join(HOME, '.claude', 'skills', 'wrap', 'step1-capture.md'), WRAP],
  ['InvoiceAutomation-CLAUDE.md', path.join(HOME, 'AI Projects', 'InvoiceAutomation', 'CLAUDE.md'), INVOICE],
];

function size(s) {
  const lines = s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
  return lines + ' lines, ' + [...s].length + ' chars';
}

for (const [name, live, pairs] of TARGETS) {
  const src = fs.readFileSync(live, 'utf8');
  const out = apply(src, pairs, name);
  fs.writeFileSync(path.join(OUT, name), out, 'utf8');
  console.log(name + ': ' + size(src) + ' -> ' + size(out));
}
