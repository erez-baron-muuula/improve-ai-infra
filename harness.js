
const path = require('path'); const crypto = require('crypto'); const fs = require('fs');
const STAGING_DIR = 'C:/nope-staging';
let RESOLVE_CALLS = 0;
let FAKE_DELAY_MS = 1200;              // simulated per-subprocess latency
function execFileSync(){ throw new Error('no subprocess in harness'); }
function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}
// MAINTENANCE: the Notion MCP server UUID, the Team-Tasks ids, the GEN-58 page id and the
// housekeeping property names are hardcoded -- the same latent-rotation risk the sibling Notion
// hooks document. If ticket writes ever stop being gated, re-check these first.
const TICKET_PASS_DIR = path.join(STAGING_DIR, 'ticket-passes');
const TICKET_EVENTS_LOG = path.join(STAGING_DIR, 'ticket-gate-events.jsonl');
const PAGE_PARENT_CACHE = path.join(STAGING_DIR, 'notion-page-parents.json');
const NOTION_MCP_PREFIX = 'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__';
const NOTION_CREATE_TOOL = NOTION_MCP_PREFIX + 'notion-create-pages';
const NOTION_UPDATE_TOOL = NOTION_MCP_PREFIX + 'notion-update-page';
const NOTION_DUPLICATE_TOOL = NOTION_MCP_PREFIX + 'notion-duplicate-page';
const NOTION_MOVE_TOOL = NOTION_MCP_PREFIX + 'notion-move-pages';
// The four gated tools are the complete set of Notion MCP tools that can create or materially change
// a Team-Tasks ROW. The other six mutating tools are scoped out with a stated reason rather than left
// unnoticed: notion-update-data-source is schema-only (its grammar is ADD/DROP/RENAME/ALTER COLUMN
// plus title/description/in_trash/is_inline -- it cannot write a row's values; its destructive subset
// is already ask-gated by notion-schema-guard.js and a non-destructive ADD COLUMN fails safe here,
// since a renamed property drops out of the housekeeping deny-list and becomes substance);
// notion-create-comment touches neither body nor properties; notion-create-database creates a
// container, not a row; notion-create-view / notion-update-view change display only;
// notion-create-attachment attaches a file.
// Team-Tasks: REST database id + MCP collection (data source) id, dashless lowercase.
const TEAM_TASKS_IDS = new Set(['fe198002661848d7ae0456f8cee479f3', 'bd2cd17bf58f49938b95468e881272fa']);
// GEN-58 (QA Layer 5). The ticket page itself; its log-volume children are found by resolution.
const GEN58_PAGE_ID = '36d6e495d07c816e9e0cce265d694ab3';
// Live Team-Tasks property set (GET /v1/databases/<id>, 2026-08-02): Priority, Status, Urgency,
// Date Created, Assignee, Reason, Parent item, Attachment, Project, Type, Text, Children,
// Gain ratio, Remind me (days before), Due Date, ID, Name. Housekeeping = pure workflow metadata.
//
// SUBSTANCE IS A DENY-LIST, not an allow-list: anything not named here counts as substance. An
// allow-list would silently UN-gate a field the moment a Team-Tasks property is renamed; the
// deny-list rotates the safe way (an unknown key becomes substance -> gated). It also catches
// `Children`, the inverse-of-parent relation whose write silently re-parents pages.
const TICKET_HOUSEKEEPING_PROPS = new Set([
  'status', 'assignee', 'project', 'type', 'reason', 'due date',
  'remind me (days before)', 'date created', 'id', 'parent item'
]);
// Stage 2's closed shape: the ONLY root keys a housekeeping-exempt payload may carry.
const TICKET_HK_ROOT_KEYS = new Set(['page_id', 'pageId', 'id', 'command', 'properties']);
// Stage 4: id-ish keys whose value names a CONTAINER (a database / data source), not a page. Never
// resolved as pages. Matched on the WHOLE key name, so `page_or_database_ids` -- a list of pages --
// is not swallowed by the `database_id` entry. `data_source_url` is listed for completeness; its key
// name contains no "id", so it never reaches stage 4 at all and is covered by stage 3 instead.
const TICKET_CONTAINER_ID_KEYS = new Set(['data_source_id', 'database_id', 'data_source_url', 'collection_id']);
// Stage 1 budgets. Exceeding ANY of them sets ok = false, which hard-blocks.
const TN_MAX_DEPTH = 12;
const TN_MAX_NODES = 4000;
const TN_MAX_STRING_BYTES = 2 * 1024 * 1024;
const TN_MAX_UNWRAP = 8;
const TN_CPU_DEADLINE_MS = 2000;                                // covers stages 1-3 (the CPU stages)
// Known envelope key names. This one list IS a list of known names; the invariant that makes it safe
// -- and that a maintainer must re-check before ever adding a name -- is that the hoist can only
// discard a SOLE root key, and no name here is a field of any gated tool's schema (verified against
// the four live schemas and all 1,313 corpus payloads: `data` and `raw` occur only as envelopes,
// `input` and `arguments` never occur). Failing to hoist an unknown future wrapper is the SAFE
// direction: it is still walked, so stages 3 and 4 see through it, and the only cost is a pass that
// no longer matches -- which blocks and asks for a re-mint. Hoisting something that is NOT a wrapper
// is the unsafe direction, because stage 2 reads the hoisted root, and the invariant rules that out.
// `__unparsedToolInput` is here for uniformity only and is inert: it hoists to `{raw, len}`, which
// has two keys and so never reaches the plain form.
const TN_ENVELOPE_KEYS = new Set(['data', 'raw', 'input', 'arguments', '__unparsedToolInput']);
// Stage 4 cost bounds. One SHARED monotonic wall-clock budget for the whole call, checked before
// each subprocess -- not N independent timers -- so the arm cannot be killed by the hook's 60 s
// timeout, which under defaultMode "auto" would be a silent approve.
const TICKET_RESOLVE_MAX_IDS = 8;
const TICKET_RESOLVE_WALL_MS = 20000;
const TICKET_RESOLVE_PROC_MS = 5000;
// Pass-claim race: a batch pass being rewritten by another hook process is briefly absent from the
// dir, so a single scan can spuriously conclude "no pass" for a ticket Erez already approved.
const TICKET_PASS_RETRIES = 3;
const TICKET_PASS_RETRY_MS = 50;
// POSITIVES ONLY, and only as a speed-up. An earlier draft also cached negatives for 24h; that was a
// silent fail-open on an ordinary workflow -- a page edited while it was an ordinary page caches
// false, Erez then drags it into Team-Tasks IN THE NOTION UI (no notion-move-pages call, so no
// seeding), and for the next 24h every edit to that live ticket is waved through with no pass and no
// resolver call. A stale-known-negative must not be treated better than an unknown, which this gate
// hard-blocks. So a miss ALWAYS re-resolves; only a fresh positive short-circuits.
const TICKET_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;          // a ticket stays a ticket

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

// Dashless lowercase 32-hex, or '' if the value is not a Notion id.
function normNotionId(v) {
  const s = String(v == null ? '' : v).replace(/-/g, '').trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(s) ? s : '';
}

// Strip the qualifier forms notion-update-page uses for some property types
// (`date:Due Date:start`, `userDefined:ID`, `place:X:latitude`) down to the bare property name.
function ticketPropName(key) {
  let k = String(key == null ? '' : key);
  k = k.replace(/^(?:date|place|userDefined):/i, '');
  k = k.replace(/:(?:start|end|is_datetime|name|address|latitude|longitude|google_place_id)$/i, '');
  return k.trim().toLowerCase();
}

function ticketPropIsSubstance(key) {
  const n = ticketPropName(key);
  if (!n) return true;                  // an unreadable property name is not provably housekeeping
  return !TICKET_HOUSEKEEPING_PROPS.has(n);
}

// ---- stage 1: normalise -----------------------------------------------------
// ticketNormalise(tool_input) -> {ok, why, root, strings, keys, idish, deadline}
//
//   root     the payload with every embedded JSON string parsed in place and any single-key envelope
//            hoisted away. This is what stage 2 reads and what the content hash is taken over.
//   strings  every string encountered, key or value, parsed wrapper text included (stage 3 scans it).
//   keys     the set of every object key name in the tree (used to tell a content write from a
//            property write without reading a field path).
//   idish    every string value reached under a key whose name contains "id", tagged with the
//            nearest such key name (stage 4 resolves these).
//
// ok === false is a HARD BLOCK, never a fall-through. It means we could not read the payload end to
// end, so we cannot claim it is out of scope. Under defaultMode "auto" a fall-through would be a
// SILENT APPROVE of an unreviewed ticket write.
//
// SECURITY PROPERTIES, not style:
//  - the walk REBUILDS the tree rather than mutating `tool_input`, so nothing here can perturb the
//    guards that run after this one, and reconstructed objects are `Object.create(null)` so that a
//    payload key of `__proto__` becomes an ordinary own property instead of touching a prototype.
//  - the only plain-object write keyed by payload data is the page cache, and that key is a
//    validated 32-hex string by construction (see cachePageFlag).
//  - every regex applied to payload text is fixed-width and non-backtracking (`[0-9a-f]{32}` on a
//    dash-stripped copy). No alternation-with-repetition, no nested quantifiers, so no catastrophic
//    backtracking; the 2 MB string cap and the 2 s deadline bound the scan regardless.
function ticketNormalise(ti) {
  const strings = [];
  const keys = new Set();
  const idish = [];
  const st = { ok: true, why: '', nodes: 0, bytes: 0, deadline: Date.now() + TN_CPU_DEADLINE_MS };

  function bust(why) { st.ok = false; if (!st.why) st.why = why; return false; }

  function withinBudget() {
    if (st.nodes > TN_MAX_NODES) return bust('node-budget');
    if (st.bytes > TN_MAX_STRING_BYTES) return bust('string-budget');
    if (Date.now() > st.deadline) return bust('cpu-deadline');
    return true;
  }

  // The parse of a string that IS a JSON object/array, else undefined. Deliberately NOT "anything
  // JSON.parse accepts": a bare number or quoted string is data, not a wrapper.
  function asJson(s) {
    const t = s.trim();
    if (t === '' || (t[0] !== '{' && t[0] !== '[')) return undefined;
    let v;
    try { v = JSON.parse(t); } catch (e) { return undefined; }
    return (v && typeof v === 'object') ? v : undefined;
  }

  // wrapperPos: this string sits where only serialised JSON belongs (the whole tool_input, or a
  // value under an envelope key). Failing to parse THERE means the payload was truncated or mangled
  // and we are blind -> ok = false. Failing to parse anywhere else means nothing: five corpus
  // payloads carry ordinary body text opening with a markdown link or a bracketed tag
  // ("[Vol. 3](https://...)", "[D recurrence - scope-mis-assignment] 2026-07-15"), two of them
  // GEN-58 log writes, and a blanket "JSON-looking strings must parse" rule hard-blocked all five.
  function walk(node, depth, unwraps, idKey, wrapperPos) {
    st.nodes++;
    if (!withinBudget()) return node;
    if (depth > TN_MAX_DEPTH) { bust('depth-budget'); return node; }

    if (typeof node === 'string') {
      st.bytes += node.length;
      strings.push(node);
      if (!withinBudget()) return node;
      const parsed = asJson(node);
      if (parsed === undefined) {
        if (wrapperPos) bust('wrapper-unparsable');
        if (idKey) idish.push({ key: idKey, value: node });
        return node;
      }
      if (unwraps + 1 > TN_MAX_UNWRAP) { bust('unwrap-budget'); return node; }
      return walk(parsed, depth + 1, unwraps + 1, idKey, false);
    }

    if (Array.isArray(node)) {
      const out = [];
      for (let i = 0; i < node.length; i++) {
        if (!withinBudget()) return out;
        // An array index is not a key, so an id-ish key propagates through the array: the ids in
        // `page_or_database_ids: [...]` are reached under that key.
        out.push(walk(node[i], depth + 1, unwraps, idKey, false));
      }
      return out;
    }

    if (node && typeof node === 'object') {
      // Proof the harness truncated the payload before we ever saw it -- true in all 3 captured
      // `__unparsedToolInput` cases. Read by name off the original node; the truncated `raw` will
      // also fail the wrapper parse below, so this is belt-and-braces on a case we know is real.
      const un = node['__unparsedToolInput'];
      if (un && typeof un === 'object' && typeof un.raw === 'string' &&
          typeof un.len === 'number' && un.len > un.raw.length) bust('harness-truncated');

      const out = Object.create(null);
      for (const k of Object.keys(node)) {
        if (!withinBudget()) return out;
        st.bytes += k.length;
        strings.push(k);
        keys.add(k);
        // Innermost id-ish key wins; an id-ish key also propagates into nested containers, so an id
        // buried one level under `page_id` is still collected. Over-collecting only costs resolution
        // (bounded, and more gating); under-collecting would be a fail-open.
        const childIdKey = /id/i.test(k) ? k : idKey;
        out[k] = walk(node[k], depth + 1, unwraps, childIdKey, TN_ENVELOPE_KEYS.has(k));
      }
      return out;
    }
    return node;                                   // number, boolean, null
  }

  // A gated tool whose payload is not even an object/array/string is not provably out of scope.
  if (ti === null || (typeof ti !== 'object' && typeof ti !== 'string')) {
    return { ok: false, why: 'not-an-object', root: null, strings: strings, keys: keys, idish: idish, deadline: st.deadline };
  }

  let root = walk(ti, 0, 0, '', true);

  // Envelope hoisting. The walk substitutes a parsed wrapper IN PLACE, so a top-level `{data:"<json>"}`
  // becomes `{data:{...}}` -- the wrapper key survives and the enveloped and plain forms of the same
  // call do NOT produce the same tree. Stages 3 and 4 do not care (they read the whole tree either
  // way) but stage 2 and the content hash both read the root, so the wrapper has to go.
  let hoists = 0;
  while (root && typeof root === 'object' && !Array.isArray(root)) {
    const ks = Object.keys(root);
    if (ks.length !== 1 || !TN_ENVELOPE_KEYS.has(ks[0])) break;
    if (++hoists > TN_MAX_UNWRAP) { st.ok = false; if (!st.why) st.why = 'hoist-budget'; break; }
    root = root[ks[0]];
  }

  return { ok: st.ok, why: st.why, root: root, strings: strings, keys: keys, idish: idish, deadline: st.deadline };
}

// ---- stage 2: the housekeeping exemption (closed shape, no network) ---------
// The ONE path that lets a Team-Tasks write through without a pass, so it is written as a closed
// shape: exempt only on an exact match, and ANYTHING unrecognised gates. No list of dangerous names
// is needed or wanted -- that list is the anti-pattern this rebuild deletes.
//
// The captured alternate schema `{pages:[{id, properties:{Status}, content:{...edits}}]}` fails
// clause 1 on its root key `pages` and is gated, as it must be.
//
// design-converged.md's `update_verification` exemption is dropped: zero occurrences in 1,313
// payloads, i.e. exempt surface with no traffic behind it.
function ticketIsHousekeepingOnly(R) {
  if (!R || typeof R !== 'object' || Array.isArray(R)) return false;
  const keys = Object.keys(R);
  // 1 -- every root key is one of the five. An unknown key anywhere at the root fails.
  for (const k of keys) if (!TICKET_HK_ROOT_KEYS.has(k)) return false;
  // 2 -- a command, if present, is exactly update_properties.
  if (keys.indexOf('command') !== -1 && R.command !== 'update_properties') return false;
  // 3 -- properties must EXIST and be a plain object (clause 3 of the design presupposes it), and
  // every key of it must be housekeeping after the qualifier strip.
  if (keys.indexOf('properties') === -1) return false;
  const props = R.properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return false;
  for (const pk of Object.keys(props)) {
    if (ticketPropIsSubstance(pk)) return false;
    // 4 -- no nested object, which is what a content structure looks like. `null` counts as a
    // primitive: real housekeeping edits clear a relation with `"Assignee": null` / `"Parent item":
    // null`, and a naive `typeof v !== 'object'` test would exclude them (typeof null === 'object').
    const v = props[pk];
    if (v === null) continue;
    if (Array.isArray(v)) {
      if (!v.every(x => x === null || typeof x !== 'object')) return false;
      continue;
    }
    if (typeof v === 'object') return false;
  }
  return true;
}

// A write that touches the body and no database property. Decided from the KEY SET of the whole
// normalised tree, not a field path, so the alternate inner schema (whose `properties` sits inside
// `pages[0]`) is correctly seen as property-bearing and stays gated even on the GEN-58 page.
function ticketIsContentOnly(norm) {
  return !norm.keys.has('properties');
}

// ---- stage 3: marker scan (free, no network) --------------------------------
// true (a Team-Tasks id appears somewhere in the payload) / false / null (CPU deadline -> the caller
// treats it as unreadable and blocks). Dash- and case-insensitive, anywhere in any string, which is
// the direct expression of "look for the marker in the whole payload rather than at a field path".
// Over-gating is possible (a body that quotes the ids in prose -- this project's own docs do) and is
// the safe direction; the GEN-58 carve-out runs first precisely to spare the one case where a
// standing rule requires the write to be immediate.
function ticketMarkerScan(norm) {
  for (let i = 0; i < norm.strings.length; i++) {
    if ((i & 63) === 0 && Date.now() > norm.deadline) return null;
    const s = norm.strings[i];
    if (typeof s !== 'string' || s.length < 32) continue;
    const bare = s.replace(/-/g, '').toLowerCase();
    for (const m of TEAM_TASKS_IDS) if (bare.indexOf(m) !== -1) return true;
  }
  return false;
}

// ---- stage 4: id extraction and resolution ---------------------------------
// Every 32-hex id in a value -- dashed, bare, or inside a URL. A truncated uuid yields NOTHING,
// which is the point: it is a malformed target, not an absent one, and the caller blocks on it.
//
// A canonically dashed uuid is matched FIRST, on the raw value, because the dashes pin the id's
// boundaries exactly and no surrounding text can bleed into it. Only when there is no dashed form
// does the value get dash-stripped and scanned for hex runs -- which is what a bare id, an odd
// dashing, and a `/p/<id32>` URL all need.
//
// Measured over the 1,387 id-ish values in the corpus: 976 canonically dashed, 394 bare 32-hex, 9
// oddly dashed but still 32-hex once stripped, 6 `/p/<id32>` URLs, 2 malformed (the placeholder and
// the truncated uuid). NOT ONE dash-strips into a hex run longer than 32, so the ambiguous case is
// hypothetical -- it is handled by emitting the run's leading AND trailing 32-char window (a Notion
// share URL puts the id at the end of a title-derived slug, so a slug ending in hex characters would
// otherwise yield a wrong id), which costs one extra bounded candidate in a case that never occurs.
//
// Either error direction is safe: a missing id makes the target malformed (block) and a wrong id
// fails to resolve (unknown -> block). Neither can produce an out-of-scope verdict.
//
// Both patterns are character classes with a single quantifier -- no alternation, no nesting, so
// linear time with no backtracking, which is the property the 2 s deadline only has to backstop.
function ticketIdsIn(value) {
  const raw = String(value == null ? '' : value).toLowerCase();
  const out = [];
  const seen = new Set();
  const add = id => { if (!seen.has(id)) { seen.add(id); out.push(id); } };

  const dashed = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
  if (dashed) {
    for (const d of dashed) add(d.replace(/-/g, ''));
    return out;
  }
  const bare = raw.replace(/-/g, '');
  const re = /[0-9a-f]+/g;
  let m;
  while ((m = re.exec(bare)) !== null) {
    if (m[0].length < 32) continue;
    add(m[0].slice(0, 32));
    add(m[0].slice(-32));
  }
  return out;
}

// Split the id-ish values into candidate PAGES (resolved) and CONTAINERS (never resolved -- if a
// container were Team-Tasks, stage 3 already fired on the same string, so no separate local compare
// is needed here). `sawCandidateKey` distinguishes "no target field at all" from "a target field
// that yields no valid id", which are different verdicts.
function ticketSplitIds(idish) {
  const pageIds = [];
  const seen = new Set();
  let sawCandidateKey = false;
  let containerTeamTasks = false;
  for (const e of idish) {
    const ids = ticketIdsIn(e.value);
    if (TICKET_CONTAINER_ID_KEYS.has(String(e.key).toLowerCase())) {
      for (const id of ids) if (TEAM_TASKS_IDS.has(id)) containerTeamTasks = true;
      continue;
    }
    sawCandidateKey = true;
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      pageIds.push(id);
    }
  }
  return { pageIds: pageIds, sawCandidateKey: sawCandidateKey, containerTeamTasks: containerTeamTasks };
}

// ---- page cache (lives OUTSIDE ~/.claude on purpose) ------------------------
// settings.json allow-lists Write(C:\Users\Erez\.claude\*), so a cache inside that tree could be
// silently rewritten by a tool call to mark a real ticket out-of-scope with NO prompt. The hook's
// own fs writes are unaffected by the allow-list, so nothing is lost by keeping it in
// ~/.claude-staging alongside the pass dirs.
//
// Two positive flags per page: `tt` (confirmed Team-Tasks row) and `g58` (confirmed GEN-58 log
// volume). Both are positives-only; see TICKET_CACHE_TTL_MS.
function readPageParentCache() {
  try {
    const j = JSON.parse(fs.readFileSync(PAGE_PARENT_CACHE, 'utf8').replace(/^\uFEFF/, ''));
    return (j && typeof j === 'object') ? j : {};
  } catch (e) { return {}; }
}

// Record a CONFIRMED flag, pruning expired and flagless entries on the way so the file stays bounded
// at roughly the live working set instead of growing for every page ever touched. The 32-hex guard
// is what makes `c[id] = ...` safe: the only plain-object write keyed by payload-derived data in this
// whole layer cannot be `__proto__` or any other special name.
function cachePageFlag(){}

// true (fresh confirmed flag) or null (unknown -- caller must resolve). Never returns false.
function cachedPageFlag(){ return null; }

// Names kept from the previous build: design-converged.md and the ticket both refer to them.
function cachePageParent(id) { return cachePageFlag(id, 'tt'); }
function cachedPageParent(id) { return cachedPageFlag(id, 'tt'); }

// One shared resolution budget per gated call.
function ticketResolveBudget() {
  return { until: Date.now() + TICKET_RESOLVE_WALL_MS, left: TICKET_RESOLVE_MAX_IDS, pages: new Map() };
}

// The Credential-Manager token, fetched at most ONCE per process. undefined = not tried yet,
// null = unavailable (every id then resolves to unknown, which blocks).
let TICKET_TOKEN_MEMO;
function notionTokenOnce() {
  if (TICKET_TOKEN_MEMO !== undefined) return TICKET_TOKEN_MEMO;
  TICKET_TOKEN_MEMO = null;
  try {
    const ps =
      "$v=[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new();" +
      "$c=$v.Retrieve('claude-notion-token','claude-notion-token');$c.RetrievePassword();$c.Password";
    const tok = String(execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', timeout: TICKET_RESOLVE_PROC_MS }) || '').trim();
    if (tok) TICKET_TOKEN_MEMO = tok;
  } catch (e) { /* stays null */ }
  return TICKET_TOKEN_MEMO;
}

// ONE fetch per id per call, memoised on the budget, so the Team-Tasks question and the GEN-58
// question share a single round-trip. -> {ok, parentId} where parentId is the dashless id of
// whatever the page hangs off (data source, database, page or block), or '' for a workspace parent.
//
// The catch is TOTAL by design -- no token, network error, non-JSON, unexpected shape, timeout,
// 401/403/404/429/5xx, AND any bug in this function's own code all yield ok:false, which the callers
// turn into 'unknown' and the arm turns into a BLOCK. So a resolver fault can never widen into a
// silent approve. In particular there is no `404 => not a ticket` shortcut: a Notion 404 also means
// no-access-to-this-page and archived/trashed, so treating it as out-of-scope would silently
// reclassify a real ticket on the highest-volume path (edits are 1,043 of 1,313 corpus payloads).
function resolveNotionPage(id, budget) {
     if (budget.pages.has(id)) return budget.pages.get(id);
     RESOLVE_CALLS++;
     const until = Date.now() + FAKE_DELAY_MS; while (Date.now() < until) {}   // simulate subprocess
     const r = { ok: true, parentId: 'fe198002661848d7ae0456f8cee479f3' };     // a real Team-Tasks row
     budget.pages.set(id, r); return r;
   }

// 'team-tasks' | 'other' | 'unknown'.
function classifyNotionId(id, budget) {
  if (cachedPageFlag(id, 'tt') === true) return 'team-tasks';
  const r = resolveNotionPage(id, budget);
  if (!r.ok) return 'unknown';
  if (r.parentId && TEAM_TASKS_IDS.has(r.parentId)) { cachePageFlag(id, 'tt'); return 'team-tasks'; }
  return 'other';
}

// 'in' | 'out' | 'unknown' -- is this page the GEN-58 ticket page or one of its log volumes?
// Hardcoding the volume ids instead was rejected: they roll over every ~25 entries and a stale id is
// a silently dead carve-out.
function gen58Subtree(id, budget) {
  if (id === GEN58_PAGE_ID) return 'in';
  if (cachedPageFlag(id, 'g58') === true) return 'in';
  // A page already confirmed to be a Team-Tasks ROW hangs off the data source, not off the GEN-58
  // page, so it cannot be a log volume -- and the GEN-58 row itself was caught on the line above.
  // Without this short-circuit every content edit to a known ticket would pay a round-trip forever.
  if (cachedPageFlag(id, 'tt') === true) return 'out';
  const r = resolveNotionPage(id, budget);
  if (!r.ok) return 'unknown';
  if (r.parentId === GEN58_PAGE_ID) { cachePageFlag(id, 'g58'); return 'in'; }
  return 'out';
}

// WHO READS THIS FILE, stated because a log nobody reads is not a signal.
//
// Five event kinds land here, and they split cleanly:
//  - the four `block` reasons (scope-error, scope-unreadable, no-target, bad-target, unresolved,
//    no-pass, stale-hash) are SELF-SURFACING and need no reader: each one is immediately followed by
//    blockTicketVetting, which exits 2 and prints why, so the call stops and Claude has to act on it
//    in the same turn. That is why piece 1 needs no aggregate monitor -- the failure mode here is
//    loud by construction, not silent. (Round 1 of the design claimed an aggregate monitor already
//    existed; it did not, and the fix was to make every failure loud rather than to build one.)
//  - `approve` and `claim-lost` are AGGREGATE-ONLY and are the reason this file exists. `claim-lost`
//    followed by a successful retry is the one genuinely silent event in the whole arm: it means two
//    hook processes contended over one batch pass, the write went through correctly, and nobody
//    hears about it.
//
// Their reader is piece 3 (the `/wrap` aggregate line), which MUST surface, in the wrap-up Erez
// already reads: the count of blocks by reason since the previous wrap, and -- separately -- a flag
// if any `claim-lost` occurred at all, since a single occurrence is what turns the pass-claim race
// from theoretical into observed. RE-EVALUATE BAR: if `claim-lost` is still zero after 50 gated
// writes have been logged here, the 3-attempt retry loop in enforceTicketVetting is dead weight and
// should be dropped rather than maintained.
//
// Until piece 3 ships, that is a NAMED GAP: these two event kinds accumulate unread. It is the right
// trade only because nothing in it can hide a bad write -- every write that fails to satisfy the
// gate has already stopped loudly by the time it is logged.
function logTicketGateEvent(entry) {
  try {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
    fs.appendFileSync(TICKET_EVENTS_LOG, JSON.stringify(Object.assign({ ts: new Date().toISOString() }, entry)) + '\n');
  } catch (e) { /* logging must never break a tool call */ }
}

// A short human-readable label for the block message and the audit log. NOT part of pass matching --
// that is the content hash alone -- so it is free to be readable rather than canonical.
function ticketLabel(tool, ids) {
  const short = (tool.indexOf(NOTION_MCP_PREFIX) === 0 ? tool.slice(NOTION_MCP_PREFIX.length) : tool).replace(/^notion-/, '');
  if (ids.length === 0) return short + ':in-payload';
  return short + ':' + ids.slice(0, 4).join('+') + (ids.length > 4 ? '+' + (ids.length - 4) + '-more' : '');
}

// ---- the scope verdict ------------------------------------------------------
// -> {scope:'out'}
//  | {scope:'in',    target, hash, ids, seedIds}
//  | {scope:'block', target, hash, ids, reason, why}
//
// PURE apart from the resolver's cache writes and its own memo: its caller wraps it in a catch, and a
// throw is treated as a BLOCK, so nothing here may leave the gate in a state that depends on having
// completed. The cache is only ever written with CONFIRMED positives, which a later block cannot
// invalidate (a blocked write does not change what the page is).
function ticketScope(tool, ti) {
  // Stage 1.
  const norm = ticketNormalise(ti);
  if (!norm.ok) {
    return { scope: 'block', reason: 'scope-unreadable', why: norm.why, target: ticketLabel(tool, []), hash: '', ids: [] };
  }
  const hash = sha256Hex(stableStringify(norm.root === undefined ? null : norm.root));

  // Stage 2 -- free, and BEFORE any resolution, so a housekeeping status change can never be
  // blocked by a Notion outage.
  if (ticketIsHousekeepingOnly(norm.root)) return { scope: 'out' };

  const split = ticketSplitIds(norm.idish);
  const label = ticketLabel(tool, split.pageIds);
  const budget = ticketResolveBudget();

  // GEN-58 carve-out. Content-bearing writes only: a property write on the GEN-58 ROW is still a
  // ticket-property write and stays gated. Runs BEFORE the marker scan, because over-gating a log
  // write-up that quotes a Team-Tasks id is exactly what it exists to prevent, and a standing rule
  // requires those writes to be immediate. 'unknown' does not exempt: a cold cache during a Notion
  // outage blocks a log write, whose escape is one /vet-ticket mint, not break-glass.
  if (tool === NOTION_UPDATE_TOOL && split.pageIds.length > 0 && ticketIsContentOnly(norm)) {
    let allIn = true;
    for (const id of split.pageIds) { if (gen58Subtree(id, budget) !== 'in') { allIn = false; break; } }
    if (allIn) return { scope: 'out' };
  }

  // Stage 3.
  const marker = ticketMarkerScan(norm);
  if (marker === null) {
    return { scope: 'block', reason: 'scope-unreadable', why: 'cpu-deadline', target: label, hash: '', ids: split.pageIds };
  }
  if (marker === true) {
    return { scope: 'in', target: label, hash: hash, ids: split.pageIds, seedIds: ticketSeedIds(tool, split) };
  }

  // Stage 4. Zero ids is not one case but two.
  if (split.pageIds.length === 0) {
    if (!split.sawCandidateKey) {
      // No target field anywhere. For a create this is the parentless workspace-level page the
      // corpus contains, and it is genuinely out of scope. For the other three tools a target is
      // structurally mandatory, so its absence means we misread the payload.
      if (tool === NOTION_CREATE_TOOL) return { scope: 'out' };
      return { scope: 'block', reason: 'no-target', target: label, hash: hash, ids: [] };
    }
    // A target field exists but yields no valid 32-hex (`page_id: "placeholder"`, a truncated uuid --
    // both real in the corpus). A malformed target is not evidence of harmlessness.
    return { scope: 'block', reason: 'bad-target', target: label, hash: hash, ids: [] };
  }
  let anyTicket = false, anyUnknown = false;
  for (const id of split.pageIds) {
    const v = classifyNotionId(id, budget);
    if (v === 'team-tasks') anyTicket = true;
    else if (v === 'unknown') anyUnknown = true;
  }
  if (anyTicket) return { scope: 'in', target: label, hash: hash, ids: split.pageIds, seedIds: ticketSeedIds(tool, split) };
  if (anyUnknown) return { scope: 'block', reason: 'unresolved', target: label, hash: hash, ids: split.pageIds };
  return { scope: 'out' };
}

// Ids worth seeding into the cache once a write is authorised. Only a move INTO Team-Tasks has any:
// the moved pages become tickets, so their first EDIT needs no round-trip. A create or a duplicate
// has NOTHING to seed -- Notion assigns the new page's id server-side and the payload never carries
// it -- so design-converged.md's "Seeding" paragraph, which claims seeding "on every gated
// create/duplicate/move", is wrong about what is possible rather than wrong about the code
// (design-scoping-v3 §7 left this open at build time; this is the resolution). A duplicate's SOURCE
// is already cached by classifyNotionId.
//
// The destination is read from CONTAINER-key ids, not from `new_parent` by path, and not from the
// bare marker scan: a move-OUT whose body merely mentions Team-Tasks must not poison the cache with
// 30-day false positives for pages it never moved in. If a future payload expresses the destination
// some other way we simply do not seed, costing one round-trip later.
function ticketSeedIds(tool, split) {
  if (tool !== NOTION_MOVE_TOOL || !split.containerTeamTasks) return [];
  return split.pageIds.slice();
}
module.exports = { ticketScope, ticketNormalise, ticketMarkerScan, get RESOLVE_CALLS(){return RESOLVE_CALLS;},
                   NOTION_UPDATE_TOOL, NOTION_CREATE_TOOL };
