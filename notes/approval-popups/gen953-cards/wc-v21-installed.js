#!/usr/bin/env node
'use strict';
/*
 * browser-site-gate.js -- PreToolUse / PostToolUse / PostToolUseFailure hook for the Claude in
 * Chrome browser tools (GEN-924).
 *
 * Why: in auto mode, Claude Code lets the classifier approve browser actions and the extension then
 * skips its own per-site check, so nothing reached Erez before Claude clicked or typed on a site he
 * is signed in to. Erez: "There needs to be a middle ground. I don't want to approve everything, and
 * I don't want to give you a blank check".
 *
 * What it does (rules in decide(); measured against 30 days of real browser use before shipping):
 *  - Reading a page never asks.
 *  - The first click, key, typing, drag, form fill or navigate on a site this session asks Erez once.
 *    The site counts as approved only after the call actually ran (PostToolUse / PostToolUseFailure),
 *    so a prompt he refuses approves nothing.
 *  - On an approved site, a click, key, typing, drag or form fill goes ahead only when Claude's
 *    action_summary is a single plain look written in plain characters (opens, shows, scrolls, filters,
 *    searches, selects a tab ...: HARMLESS, PLAIN) AND names nothing that sends, deletes, pays, shares,
 *    grants or changes access/billing/visibility
 *    (wordHit). Anything else asks, every time (SUMMARY_MODE 'whitelist', Erez's choice: wording the
 *    rules don't know asks instead of passing).
 *  - Asks every time: uploads, saved shortcuts, page scripts that can change the page or send data,
 *    typed or scripted database writes. On HIGH_STAKES sites every click, key, typing and form fill asks.
 *  - Follow-up: a click whose summary names a role, permission, owner, billing or similar control makes
 *    the NEXT interaction on that tab ask, whatever it says ("toggle, then save").
 *  - A helper a page script stores on window asks the first time a later script calls it, once per
 *    helper per site per session (HELPER_ONCE; every time on high-stakes sites); after that a call goes
 *    ahead only if every quoted text in it is a read-only query (READ_START) and it carries no database
 *    write or risky pattern. If the gate cannot read its records (no lock, unreadable file), it asks.
 *  - Typing that contains a newline (an Enter) asks unless it is a read-only query or a search.
 *  - Denies with an instruction to Claude (Erez sees nothing): a click/key/type/drag/form fill with no
 *    action_summary, a tab whose page is unknown, or a tab an earlier click may have moved. The third
 *    such deny in a row becomes an ask, so it can never loop.
 *
 * Safety stance: this hook only ADDS oversight. It never returns "allow". Any internal error on a
 * browser call answers "ask". Registered with "onFailure": "block" for PreToolUse, so a crash or
 * timeout blocks the call. No network calls.
 *
 * State: one JSON file per session in STATE_DIR (outside ~/.claude), changed under an exclusive-create
 * lock and written by atomic rename. auto-approve.js refuses Claude's own tools writing that folder.
 * The folder name is built from two parts so no file holds it whole (the guard matches it in text).
 * Accepted, told to Erez: on ordinary approved sites a click goes ahead on Claude's own one-line
 * action_summary, so a misleading summary gets past; a script written to dodge the pattern list gets
 * past the script rule; a helper approved once can later be called for a non-database change; a
 * program running as Erez could edit the state file (same accepted risk as the hook files, GEN-903).
 *
 * Pop-up text (GEN-953): the reason Erez reads at the top of the pop-up opens, for each cause, with a
 * sentence at least as strong as the earlier wording; what the gate itself reads in a typed command or a
 * page script can only add a sharper line from a closed list of serious kinds. Then the site, "Undo is
 * not guaranteed" and a caution, and Claude's own summaries last, marked as not checked. Text only: it
 * is built after the decision is made and logged, and any error building it falls back to the earlier
 * wording (legacyReasonFor).
 *
 * Signals: each ask/deny is logged (cause + site, no page text) to browser-gate-asks.jsonl, and each
 * interaction that went ahead on an ordinary approved site is logged as its site + the first six words
 * of Claude's summary ("pass": a sampling aid for wording the rules don't know, read at the live check
 * and whenever the alert below fires). After 30 browser actions in a session (each batch item counts),
 * if non-site asks exceed 1 per 10 actions, Claude is told once (added context) to report it to Erez
 * in its next For-you block.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = /^mcp__(claude-in-chrome|Claude_in_Chrome)__/;

// Test hooks (environment of the hook process only, which Claude's own tools cannot set).
const STATE_DIR = process.env.BROWSER_GATE_STATE_DIR ||
  path.join(os.homedir(), '.claude-staging', 'browser-gate' + '-sites');
const LOG_FILE = process.env.BROWSER_GATE_LOG || path.join(__dirname, 'browser-gate-asks.jsonl');

const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOG_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const LOG_PRUNE_BYTES = 1024 * 1024;
const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 15000;
const PENDING_TTL_MS = 6 * 60 * 60 * 1000;
const SHAPE_LOG_MAX = 20;
const TEXT_CAP = 20000; // characters of a script or typed text the pop-up text reads (GEN-953)

// Erez's choice (GEN-924): admin consoles get the same once-per-site + word rules as ordinary sites.
const ADMIN_CONSOLES_HIGH_STAKES = false;

const READ_COMPUTER = new Set(['screenshot', 'wait', 'scroll', 'zoom', 'scroll_to', 'hover']);
const INTERACT_COMPUTER = new Set(['left_click', 'right_click', 'double_click', 'triple_click', 'type', 'key', 'left_click_drag']);
const CLICKS = new Set(['left_click', 'right_click', 'double_click', 'triple_click', 'left_click_drag']);
const ALWAYS = new Set(['file_upload', 'upload_image', 'shortcuts_execute']);
const READ_TOOLS = new Set(['find', 'read_page', 'get_page_text', 'tabs_context_mcp', 'tabs_create_mcp', 'tabs_close_mcp',
  'read_console_messages', 'read_network_requests', 'list_connected_browsers', 'select_browser', 'switch_browser',
  'shortcuts_list', 'resize_window', 'gif_creator', 'screenshot', 'zoom']);

// Every click, key, typing and form fill asks on these, whatever Claude says it does.
const HIGH_STAKES = [/^mail\.google\.com$/, /^outlook\.(live|office|office365)\.com$/, /^outlook\.cloud\.microsoft$/,
  /(^|\.)slack\.com$/, /^(www\.)?notion\.so$/, /^app\.notion\.com$/, /\.atlassian\.net$/,
  /(^|\.)(bankhapoalim|leumi|bankleumi|discountbank|telebank|mizrahi-tefahot|fibi|bankjerusalem|mercantile|unionbank|otsar-hahayal|bankotsar|bank-massad|pagi|isracard|max|cal-online)\.co\.il$/,
  /(^|\.)paypal\.com$/, /(^|\.)payoneer\.com$/];
const ADMIN_CONSOLES = [/^admin\.google\.com$/, /^console\.cloud\.google\.com$/, /^portal\.azure\.com$/,
  /^entra\.microsoft\.com$/, /^admin\.microsoft\.com$/, /^play\.google\.com$/, /^appstoreconnect\.apple\.com$/,
  /^console\.aws\.amazon\.com$/, /^dash\.cloudflare\.com$/];

// action_summary words that mean the action sends, deletes, pays, uploads, shares, accepts or grants.
const WORDS_EN = /\b(send|sent|resend|post(s|ed|ing)?|submit|delet|remov|buy|bought|pays?\b|paying|paid|payment (is )?(made|sent)|makes? (a )?payment|purchas|order(s|ed|ing)? (the|a|an|now)\b|places? (the |an |your )?order|upload|share|sharing|accept|agree(s|d|ing)?\b|grant|allow|publish|confirm|transfer|invit|approv|repl(y|ies|ied|ying)\b|forward(s|ed|ing)?\b|e-?mails? (the|a|an|it|them|this|him|her)\b|messages? (the|a|an|him|her|them)\b|merg|terminat|sav(e|es|ed|ing)\b|archiv|trash|discard|revok|cancel|unsubscrib|install|authori[sz]|signs?\b(?![ -]?(in|up|out|on)\b)|signed|signing\b(?![ -]?(in|up|out|on)\b)|reset|disabl|deactivat|suspend|block(s|ed|ing)?\b|ban(s|ned)?\b|wipe|erase|empty (the )?trash|leave(s)? (the )?(channel|group|workspace|team)|\b(plans?|tiers?|subscriptions?)\b|charg(e|es|ed|ing)\b)/i;
const HE_PREFIX = '(?:^|[^\\u0590-\\u05FF])(?:[והלבמש]{0,2})';
const WORDS_HE = new RegExp(HE_PREFIX + '(?:שלח|שולח|שליחה|נשלח|תשלח|פרסם|מפרסם|פרסום|מחק|מוחק|מחיקה|נמחק|הסר|מסיר|הסרה|קנה|קונה|רכוש|רכישה|שלם|משלם|תשלום|העלה|מעלה|העלאה|שתף|משתף|שיתוף|אשר|מאשר|אישור|הסכם|מסכים|הרשאה|הענק|מעניק|בטל|מבטל|ביטול|חסום|חוסם)');
// Changes to who can do what, who pays, or what runs on a server also count (measured against 30 days
// of real summaries: "Turns on Super Admin role for ...", "Selects Erez Baron as the new owner",
// "Starts a full extract refresh of ...").
const WORDS_ACCESS = new RegExp([
  '\\b(sets?|changes?|moves?|assigns?|adds?|makes?|gives?|switch(es)?|transfers?|selects?|chooses?|picks?|ticks?|checks?|turns? (on|off)|toggles?|enables?|grants?|enters?)\\b[^\\n]{0,80}\\b(roles?|permissions?|access|billing|owners?|admins?|read and write|editors?|members?|credentials?|passwords?|tokens?|api keys?|expiration|scopes?)\\b',
  '\\b(turns? (on|off)|toggles?|enables?|activates?)\\b',
  '\\b(starts?|triggers?|launches?|kicks? off|schedules?)\\b[^\\n]{0,60}\\b(refresh|run|job|export|import|sync|deploy(ment)?|build|backup|restore|migration|extract|pipeline|task)\\b',
  '\\bcreates?\\b[^\\n]{0,60}\\b(tasks?|jobs?|tokens?|keys?|users?|accounts?|projects?|triggers?|schedules?|credentials?|rules?|webhooks?|integrations?|invites?|links?|secrets?)\\b',
  '\\bretr(y|ies|ied)\\b', '\\brun now\\b', 'subscrib', '\\bupgrad', '\\bdowngrad', '\\bcommits?\\b', '\\bcomments? (on|to)\\b',
  '\\bpurg', '\\bclears? (all|the )?(site|browsing|cache|cookies|data|history)', '\\bgenerat', '\\b(changes?|resets?) (the )?password',
  '\\bupdates? (the )?credentials?', '\\bshuts? down\\b', '\\bstops?\\b[^\\n]{0,40}\\b(instance|server|service|vm|project|job|task)\\b',
  // who can see it: sharing dropdowns that apply the moment they are picked
  '\\b(anyone|everyone|public(ly)?|private|visibility|restricted|can (view|edit|comment)|view[- ]only|viewers?|commenters?)\\b'
].join('|'), 'i');
// Typed or scripted text that is a database write (a query box is a common way to change data).
// Comments are removed first, so DELETE/**/FROM still matches; identifiers may be quoted any way.
const TYPED_WRITE = /\b(delete\s+(from\s+)?[\w`"\[.]|drop\s+(table|schema|database|user|role|view|warehouse|stage|task|procedure|function|integration|share|pipe|stream|index|column)|truncate\s+(table\s+)?[\w`"\[]|update\s+[\w`"\[\].-]+\s+set|insert\s+(into|overwrite)|alter\s+(table|user|role|warehouse|schema|database|account|task|integration|pipe|stream|view)|grant\s+\w|revoke\s+\w|merge\s+into|create\s+(or\s+replace|((temp|temporary|transient|volatile|secure|materialized|external|dynamic|hybrid|iceberg|recursive|unique|local|global)\s+)*(user|role|integration|share|table|view|database|schema|warehouse|function|procedure|task|stage|pipe|stream|index|sequence))|copy\s+into|(remove|rm)\s+@|execute\s+(task|immediate)|call\s+[\w`"\[.]+\s*\(|undrop\s+\w|put\s+file:)/i;
// Whatever the object type: a statement (at the start, or after ; a newline, a quote or a bracket) that
// begins with a writing keyword, an aliased UPDATE, or a Snowflake SYSTEM$ function (several change
// state). Measured: no false fires on 30 days of real scripts and typed text beyond TYPED_WRITE's.
const STATEMENT_WRITE = /(?:^|[;\n\r`'"(])\s*(insert|update|delete|merge|create|alter(?!\s+session\b)|drop|undrop|truncate|grant|revoke|call|execute|exec|copy|put|remove|rm|comment\s+on|replace|upsert|unset|begin|commit|rollback)\s+[\w"`\[(@*]|\bupdate\s+[\w`"\[\].-]+(\s+(as\s+)?\w+)?\s+set\b|\bsystem\$\w+\s*\(/i;
const stripSqlComments = t => String(t).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
// Checked on the raw text too: in a page script "--" is JavaScript (i-- or a '---' string), and
// stripping it as a SQL comment would hide a write later on that line.
const typedWrite = t => [String(t), stripSqlComments(t)].some(s => TYPED_WRITE.test(s) || STATEMENT_WRITE.test(s));

// A page script with any of these can change the page, send data or run hidden code.
const RISKY_SCRIPT = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|\.click\s*\(|\.submit\s*\(|requestSubmit|dispatchEvent|\bdispatch\s*\(|new\s+\w*Event\b|\.(value|checked|selected|innerHTML|outerHTML|innerText|textContent|src|href|action)\s*=[^=]|insertAdjacent|\.(append|prepend|appendChild|insertBefore|replaceChild|replaceWith|remove|removeChild|setAttribute|removeAttribute)\s*\(|\blocation\s*=[^=]|\blocation\.(host|hostname|pathname|search|hash|port|protocol)\s*=[^=]|\blocation\.(assign|replace)\s*\(|\.on[A-Za-z]+\s*\(|window\.open|\bopen\s*\(|\beval\s*\(|\bFunction\s*\(|\bimport\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]|postMessage|(local|session)Storage\.(setItem|removeItem|clear)|document\.cookie\s*=|indexedDB|caches\.|execCommand|navigator\.(clipboard|serviceWorker|credentials|share)|history\.(push|replace)State|history\.(back|forward|go)\s*\(|navigation\.navigate|document\.write|\.reset\s*\(|\.(setValue|executeEdits|applyEdits|pushEditOperations|replaceRange|replaceSelection|insertText|setRangeText|setContent|setData)\s*\(|\.(value|innerHTML|innerText|textContent)\s*\+=|\b(window|globalThis|self)\s*(\.\s*[\w$]+|\[[^\]]*\])\s*=[^=]|\[\s*['"`][^'"`]*['"`]\s*\+|\[\s*[a-zA-Z_$][\w$]*\s*\]\s*\(|\\u(?!00a0)[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}|\batob\s*\(|\$\s*\(|jQuery|\bReflect\.|\bProxy\b|\bwith\s*\(/;

// A reload sends and deletes nothing, so it does not ask, but the page may come back as another one
// (an expired sign-in redirects), so the tab must be read again.
const RELOAD_SCRIPT = /\blocation\.reload\s*\(|\bhistory\.go\s*\(\s*0?\s*\)/;

// ---------------------------------------------------------------- pure rules

function shortName(tool) { return (typeof tool === 'string' && PREFIX.test(tool)) ? tool.replace(PREFIX, '') : null; }

// Host of a URL: lowercase hostname for http(s); '' for a browser-internal page (new tab, settings,
// extension pages, about:blank); null for anything else (unreadable, or a script/data/file address).
// "host:port/path" with no scheme is a web address, not a scheme named "host".
const KNOWN_SCHEME = /^(https?|about|data|javascript|vbscript|file|blob|view-source|mailto|ftp|wss?|chrome|chrome-extension|chrome-untrusted|chrome-search|edge|brave|opera|vivaldi|comet|devtools|filesystem):/i;
// about: is not here: a page can open about:blank and fill it with its own form.
const INTERNAL_SCHEME = /^(chrome|chrome-extension|chrome-untrusted|chrome-search|edge|brave|opera|vivaldi|comet|devtools):$/;
function hostOf(u) {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const t = u.trim();
    const s = (KNOWN_SCHEME.test(t) || /^[a-z][a-z0-9+.-]*:\/\//i.test(t)) ? t : 'https://' + t;
    const x = new URL(s);
    if (/^https?:$/.test(x.protocol)) return x.hostname.toLowerCase().replace(/\.+$/, '') || null;
    return INTERNAL_SCHEME.test(x.protocol.toLowerCase()) ? '' : null;
  } catch (e) { return null; }
}

function isHigh(host, opts) {
  return HIGH_STAKES.some(r => r.test(host)) || (!!opts.adminConsolesHighStakes && ADMIN_CONSOLES.some(r => r.test(host)));
}
// Every summary gets the danger-word lists, a look too: there is no exemption for "Opens the ... dialog"
// (each wording rule for one kept letting the next honest phrasing through, GEN-58). Opening a dialog
// named after a dangerous action ("Opens the Change Owner dialog") therefore asks as well.
function wordHit(summary) {
  return WORDS_EN.test(summary) || WORDS_HE.test(summary) || WORDS_ACCESS.test(summary);
}
// A click on a control about who can do what (a role toggle, an owner picker, a permission box)
// makes the NEXT interaction on that tab ask, whatever it says: "toggle, then save" is caught even
// when the save button's wording is not on any list.
const DANGER_NOUN = /\b(roles?|permissions?|access|billing|owners?|ownership|admins?|privileges?|credentials?|passwords?|tokens?|api keys?|members?|membership|sharing|2fa|mfa|two-factor|security keys?)\b/i;
// The click that commits such a change: the summary's own leading verb or the button it clicks, not a
// word further on ("... of the Update user form"). A miss here only means one extra ask.
const COMMITS = /^\s*(?:(?:clicks|presses|taps|hits)\s+(?:on\s+)?(?:the\s+)?["'“]?)?(confirm|save|submit|appl(y|ies|ied)|done|finish|updat)/i;

// Summary-checking mode (measured on 30 days of real use before shipping, GEN-924):
// 'list' = ask when the summary names a dangerous effect (a list of dangerous things);
// 'whitelist' = pass only summaries that are a single look (a list of harmless things), ask on the rest;
// 'hybrid' = 'whitelist' on ADMIN_CONSOLES, 'list' elsewhere.
const SUMMARY_MODE = 'whitelist';
// The no-prompt list holds only actions whose effect cannot depend on WHAT they act on: looking,
// opening, scrolling, sorting, filtering, searching, focusing. An action whose effect depends on its
// target (selecting or choosing a value, closing or dismissing something, switching or going to
// something, typing a value, "Next" on a multi-step form, which submits the step) always asks:
// reading the target out of the summary's wording failed each time the wording changed ("Closes the
// ticket in the side panel", "Selects Done below the Status field"; GEN-58). Entries that name a fixed
// object ("Clears the SQL editor", "Switches charts to 30 days") must be the whole summary (CLOSED_LOOKS):
// nothing may follow the object ("Clears the search history" deletes data). Opening a link or a button
// can act on load (an unsubscribe or invite link), so "opens" does not cover those.
const HARMLESS = new RegExp('^\\s*(' + [
  'opens(?!\\s+(a|an|new|another|up|some|one)\\b)(?![^\\n]*(links?|buttons?|urls?)\\b)', 'shows', 'expands', 'collapses', 'views', 'hovers', 'scrolls', 'focuses',
  // (copying to a bucket or folder shares it, so only the clipboard)
  'filters', 'sorts', 'searches', 'narrows', 'widens', 'zooms', 'copies (?![^\\n]*(links?|urls?|share)\\b)[^\\n]{0,60}\\bclipboard', 'places (the )?cursor',
  'moves (the )?cursor',
  'types (a |the )?(read-only|search|filter)'
].join('|') + ')\\b', 'i');
const CLOSED_LOOKS = new RegExp('^\\s*(' + [
  'clears (the )?(sql )?(editor|search|filter)( text| box| field)?',
  'clicks into (the )?(sql )?(search |query |filter )?(box|field|cell|editor|input)',
  'switches (the )?(charts?|views?) to (the )?(last |past )?\\d+ ?(minutes?|hours?|days?|weeks?|months?|years?)'
].join('|') + ')\\.?\\s*$', 'iu');
// A second clause after the look: a sentence break, a comma, colon or spaced dash, a joining word ("by
// choosing Use Query", "which saves", "with Delete"), or "to" + a dangerous verb.
const HARMLESS_BREAK = /[.!?;:]\s+\S|,|\(|&|\+|\s[–—]\s|\b(and|then|after|before|by|which|that|while|also|plus|thereby|so|with|without|using|via)\b|\bto (send|pay|delete|submit|confirm|buy|share|remove|grant|save|publish|approve|transfer)\b/i;
// A lowercase "-ing" word after the first word is a second action ("choosing Discard", "deleting the
// draft", "archiving this one"): not a look. Not counted: a few nouns ending in -ing, and the
// description of a typed read-only query or search (the typed text has its own checks).
const ING_NOUNS = /^(billing|settings?|pending|pricing|heading|headings|thing|things|string|strings|meeting|meetings|mapping|mappings|morning|evening|building|booking|bookings|listing|listings|ring|spring|shipping|incoming|upcoming|outgoing|existing|remaining|everything|nothing|anything|something|during|onboarding|marketing|loading|landing|trending)$/;
function ingClause(summary) {
  if (/^\s*types (a |the )?(read-only|search)\b/i.test(summary)) return false;
  return (String(summary).replace(/^\s*\S+/, '').match(/\b[a-z]{2,}ing\b/g) || []).some(w => !ING_NOUNS.test(w));
}
// A single plain look is written in plain characters: letters, digits, spaces, quotes, @ . # _ and a
// hyphen inside a word. Any other mark (a dash between words, an arrow, a bracket, "|", ">", a line
// break ...) may start a second clause, so the summary is not a plain look; listing the separators
// one by one kept missing the next one (GEN-58).
const PLAIN = /^[\p{L}\p{N} '"“”‘’@.#_]*$/u;
function plainText(summary) { return PLAIN.test(String(summary).replace(/([\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, '$1')); }
function harmless(summary) {
  if (!plainText(summary) || HARMLESS_BREAK.test(summary) || ingClause(summary)) return false;
  return HARMLESS.test(summary) || CLOSED_LOOKS.test(summary);
}
const isAdminConsole = h => ADMIN_CONSOLES.some(r => r.test(h));
// Does this summary need Erez, in the given mode? (Never consulted on high-stakes sites: every click asks there.)
function summaryAsks(summary, host, mode) {
  const m = mode === 'hybrid' ? (isAdminConsole(host) ? 'whitelist' : 'list') : mode;
  // The harmless list is ON TOP of the dangerous-word list: a summary passes only if it is a single
  // look AND names nothing dangerous ("Chooses Delete for the ... task" asks in both modes).
  return m === 'whitelist' ? (!harmless(summary) || wordHit(summary)) : wordHit(summary);
}
// Names a page script stores on window/globalThis/self (a helper later scripts can call).
function helperNames(text) {
  const out = [];
  for (const mm of String(text).matchAll(/\b(?:window|globalThis|self)\s*\.\s*([A-Za-z_$][\w$]{0,60})\s*=[^=]/g)) out.push(mm[1]);
  for (const mm of String(text).matchAll(/\b(?:window|globalThis|self)\s*\[\s*['"`]([A-Za-z_$][\w$]{0,60})['"`]\s*\]\s*=[^=]/g)) out.push(mm[1]);
  return out;
}
const escapeRe = s => s.replace(/[$]/g, '\\$');
// The stored helpers a script calls: the name followed by "(", "?.(", or a method call (".call(",
// ".send(" ...), or passed along as an argument ("(name)", ", name,"). A mere read of a stored value
// (name.length, name[0]) is not a call.
function helperCalls(text, helpers) {
  if (!helpers || !helpers.length) return [];
  const t = String(text);
  return helpers.filter(h => {
    const n = escapeRe(h);
    return new RegExp('(^|[^\\w$])' + n + '\\s*(\\(|\\?\\.\\s*\\(|\\.\\s*[A-Za-z_$][\\w$]*\\s*\\()').test(t) ||
      new RegExp('[(,]\\s*' + n + '\\s*[),]').test(t);
  });
}
// What a call to a stored helper may pass: once a helper is approved, a call to it goes ahead only if
// every quoted text in the script that holds a space starts with a read keyword (a SELECT-type query);
// anything else (another statement, a phrase, a fragment) asks. A list of read starts, so a writing
// statement nobody listed asks instead of passing.
const READ_START = /^(select|with|show|desc|describe|explain|list|ls|use)\b/i;
const QUOTED = /`([^`]*)`|"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'/g;
const quotedTexts = t => [...String(t).matchAll(QUOTED)].map(m => m[1] ?? m[2] ?? m[3] ?? '');
// A quote left over once every quoted text is taken out: a text the matcher could not read.
const strayQuote = t => /["'`]/.test(String(t).replace(QUOTED, ''));
// Every statement counts, not just the first: ";" splits statements once SQL string values ('a ;; b')
// are set aside, so "SELECT 1; LOAD DATA ..." asks.
// A text with a space or a backslash inside is checked; any escape (\t, \x20, \u0020 ...) becomes a
// space first: written in the script, it is whitespace when the script runs ("DROP\tTABLE" is two words).
const statementsOf = s => s.replace(/\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|[\s\S])/g, ' ').replace(/'(?:[^']|'')*'/g, "''").split(';').map(x => x.trim()).filter(Boolean);
// (Spaces around a text with no space or backslash inside are fine: real scripts label and join results
// with " ", " at ", " | ", "(eq)". A query built by joining such texts is a script written to dodge the
// check, an accepted limit; a comment used as a separator, DROP/**/TABLE, is caught by typedWrite.)
// A space-free text skips the read-query check unless it is or holds a write command: a request helper
// called as api("DELETE", "/v1/apps/42"), or SQL glued together with quotes ('TRUNCATE"t"').
const WRITE_WORD = /(^|[^a-z])(delete|drop|truncate|update|insert|merge|alter|create|replace|grant|revoke|call|exec|execute|undrop|post|put|patch)([^a-z]|$)/i;
const helperArgsOk = t => !strayQuote(t) && !/\\["'`]|\$\{/.test(String(t)) && quotedTexts(t).every(s => { if (!/[\s\\]/.test(s.trim())) return !WRITE_WORD.test(s); const st = statementsOf(s); return st.length > 0 && st.every(x => READ_START.test(x)); });
const callsHelper = (text, helpers) => helperCalls(text, helpers).length > 0;
// Each helper asks the first time it is called on each site in a session (Erez then sees which site and helper);
// after that, calls to it go ahead unless they carry a database write or a risky pattern themselves.
const HELPER_ONCE = true;

function newState() {
  return { approved: {}, tabs: {}, pending: {}, helpers: [], streak: { cause: null, n: 0 },
    counts: { calls: 0, actions: 0, asked: 0, nonSiteAsked: 0, denied: 0, ask: {}, deny: {} }, alerted: false };
}

// Coerce a loaded state into the expected shape; anything odd becomes empty (every site new).
function normalizeState(s) {
  const d = newState();
  if (!s || typeof s !== 'object') return d;
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
  d.approved = obj(s.approved) || {};
  d.tabs = obj(s.tabs) || {};
  d.pending = obj(s.pending) || {};
  d.helpers = Array.isArray(s.helpers) ? s.helpers.filter(x => typeof x === 'string' && /^[A-Za-z_$][\w$]{0,60}$/.test(x)).slice(-200) : [];
  if (obj(s.streak) && typeof s.streak.n === 'number') d.streak = { cause: typeof s.streak.cause === 'string' ? s.streak.cause : null, n: s.streak.n };
  if (obj(s.counts)) {
    for (const k of ['calls', 'actions', 'asked', 'nonSiteAsked', 'denied']) if (typeof s.counts[k] === 'number') d.counts[k] = s.counts[k];
    d.counts.ask = obj(s.counts.ask) || {};
    d.counts.deny = obj(s.counts.deny) || {};
  }
  d.alerted = s.alerted === true;
  if (s.lostRecords === true) d.lostRecords = true;
  return d;
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Tab ids in one form: a whole number or a digit string becomes its plain digits, the form tab reports
// use; anything else ("0123", " 123", 1.5) becomes ODD_TAB, which no tab matches and which counts as
// possibly moving every tab.
const ODD_TAB = '?odd';
function canonTab(v) {
  if (v == null) return v;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === 'string' && /^(0|[1-9]\d{0,15})$/.test(v)) return v;
  return ODD_TAB;
}
function itemInput(v) {
  const inp = (v && typeof v === 'object') ? { ...v } : {}; // (spread keeps a "__proto__" key a plain key)
  if (inp.tabId != null) inp.tabId = canonTab(inp.tabId);
  return inp;
}
// Items of one call: a batch is checked item by item, a single call is one item.
function itemsOf(name, input) {
  if (name === 'browser_batch') {
    if (input && typeof input === 'object' && has(input, '__proto__')) return null;
    const a = input && input.actions;
    if (!Array.isArray(a)) return null;
    if (a.some(x => x && typeof x === 'object' && (has(x, '__proto__') || (x.input && typeof x.input === 'object' && has(x.input, '__proto__'))))) return null;
    return a.map(x => (x && typeof x === 'object') ? { name: String(x.name || ''), input: itemInput(x.input) } : { name: '', input: {} });
  }
  // (an input with its own "__proto__" key may be read differently further on: unreadable, so it asks)
  if (input && typeof input === 'object' && has(input, '__proto__')) return null;
  return [{ name, input: itemInput(input) }];
}

// Can this item move its tab to another page without the hook knowing where?
function mayMove(it) {
  if (it.name === 'form_input') return true;
  if (it.name !== 'computer') return false;
  const a = it.input.action;
  if (CLICKS.has(a)) return true;
  if (a === 'key') return /enter|return|\b(space|browser_?back|browser_?forward|browser_?home|f5)\b|alt\+(left|right|home)|^\s*$/i.test(String(it.input.text || ''));
  if (a === 'type') return /[\r\n]/.test(String(it.input.text || '')); // a typed newline is an Enter
  return false;
}

const isHistory = u => typeof u === 'string' && /^\s*(back|forward)\s*$/i.test(u);

// Did this item leave its tab on a page the gate cannot be sure of? Besides clicks and keys:
// any navigate (its own result is read before the page loads and before redirects), a page script
// that can change the page, a shortcut, and an upload.
function known(it) {
  const n = it.name;
  return ALWAYS.has(n) || n === 'gif_creator' || n === 'javascript_tool' || n === 'navigate' || n === 'form_input' ||
    READ_TOOLS.has(n) || (n === 'computer' && (READ_COMPUTER.has(it.input.action) || INTERACT_COMPUTER.has(it.input.action)));
}
function moves(it, helpers) {
  if (!known(it)) return true; // an unfamiliar tool or action: assume it may move every tab
  if (mayMove(it) || it.name === 'navigate' || ALWAYS.has(it.name)) return true;
  if (it.name === 'gif_creator') return it.input.action === 'export' && !!it.input.coordinate;
  if (it.name === 'javascript_tool') { const t = String(it.input.text || ''); return RISKY_SCRIPT.test(t) || RELOAD_SCRIPT.test(t) || typedWrite(t) || callsHelper(t, helpers); }
  return false;
}
const SWITCHES_BROWSER = new Set(['select_browser', 'switch_browser']);

// Decide one call. Returns { decision: 'ask'|'deny'|'none', causes, hosts, notes, actions }.
// 'none' means this hook has no objection; it never approves.
function decide(state, tool, input, opts) {
  opts = opts || {};
  const name = shortName(tool);
  if (!name) return { decision: 'none', causes: [], hosts: [], notes: [], actions: 0 };
  const items = itemsOf(name, input);
  if (!items) return { decision: 'ask', causes: ['unreadable-batch'], hosts: [], notes: [], actions: 1, interactive: 1, moved: [], allMoved: true };
  const tabs = {};
  for (const k of Object.keys(state.tabs)) tabs[k] = Object.assign({}, state.tabs[k]);
  const asks = [], denies = [], newHosts = [], notes = [], moved = new Set(), tainted = new Set(), untainted = new Set(), passed = [];
  // For the pop-up text only (GEN-953): what an asking script or typed text says, and Claude's summaries.
  const texts = [], claims = [], where = [];
  let actions = 0, interactive = 0, allMoved = false;
  const mode = opts.mode || SUMMARY_MODE;
  let helpers = Array.isArray(state.helpers) ? state.helpers : [];
  // After a browser switch inside a batch, the old browser's approvals and helpers no longer apply.
  let switched = false;
  const approved = h => (!switched && has(state.approved, h)) || newHosts.includes(h);
  const siteNote = id => { const t = has(tabs, String(id)) ? tabs[id] : null; const h = t && hostOf(t.url); if (h) notes.push(h); };
  // One item; its effect on the simulated tabs is applied after it, by markMoves.
  const check = it => {
    const n = it.name, inp = it.input;
    if (ALWAYS.has(n)) { asks.push('always-' + n); siteNote(inp.tabId); return; }
    if (n === 'gif_creator') { if (inp.action === 'export' && inp.coordinate) { asks.push('always-gif-drop'); siteNote(inp.tabId); } return; }
    if (n === 'javascript_tool') {
      const t = String(inp.text || '');
      const jsBefore = asks.length;
      if (RISKY_SCRIPT.test(t)) asks.push('risky-script');
      else {
        // Approved per site: a helper of the same name on another site is another function.
        const st = has(tabs, String(inp.tabId)) ? tabs[inp.tabId] : null;
        const site = (st && hostOf(st.url)) || '?';
        const hc = helperCalls(t, helpers).map(x => 'helper:' + site + ':' + x);
        // On a high-stakes site, or a tab whose site is not known, every helper call asks.
        const once = (opts.helperOnce != null ? opts.helperOnce : HELPER_ONCE) && site !== '?' && !isHigh(site, opts);
        const fresh = once ? hc.filter(k => !approved(k)) : hc;
        if (fresh.length) { asks.push('script-helper'); for (const k of fresh) if (!newHosts.includes(k)) newHosts.push(k); }
        if (hc.length && !helperArgsOk(t)) asks.push('helper-args');
      }
      if (typedWrite(t)) asks.push('typed-write');
      if (asks.length > jsBefore) texts.push({ kind: 'script', text: t.slice(0, TEXT_CAP), cut: t.length > TEXT_CAP });
      if (asks.length) siteNote(inp.tabId);
      return;
    }
    if (n === 'computer' && READ_COMPUTER.has(inp.action)) return;
    if (READ_TOOLS.has(n)) return;
    if (n === 'navigate') {
      interactive++;
      if (isHistory(inp.url)) { asks.push('nav-history'); return; }
      const h = hostOf(inp.url);
      if (h === null) { asks.push('unreadable-url'); return; }
      if (h === '') { asks.push('non-web-url'); return; }
      if (!approved(h)) { asks.push('new-site'); newHosts.push(h); notes.push(h); }
      return;
    }
    if (!(n === 'form_input' || (n === 'computer' && INTERACT_COMPUTER.has(inp.action)))) {
      asks.push('unknown-tool:' + (n || '?') + (n === 'computer' ? ':' + inp.action : ''));
      return;
    }
    interactive++;
    const t = has(tabs, String(inp.tabId)) ? tabs[inp.tabId] : null;
    if (!t || !t.url) { denies.push('unknown-tab'); return; }
    if (t.stale) { denies.push('stale-tab'); const lh = hostOf(t.url); if (lh) notes.push(lh); return; }
    const h = hostOf(t.url);
    // A tab on a page that is not a web site (about:blank, a file, a data address): re-reading cannot
    // make it known, so ask instead of sending Claude back to read it.
    // The same for a browser-internal page (settings, extensions, new tab): nothing checks it, so ask.
    if (h === null || h === '') { asks.push('non-web-tab'); return; }
    const before = asks.length;
    const high = isHigh(h, opts);
    if (high) { asks.push('high-stakes'); notes.push(h); }
    else if (!approved(h)) { asks.push('new-site'); newHosts.push(h); notes.push(h); }
    if (!high && t.taint) { asks.push('follow-up'); notes.push(h); } // the action after a role/permission/billing control
    const sum = inp.action_summary;
    if (typeof sum !== 'string' || !sum.trim()) denies.push('no-summary');
    else if (!high && summaryAsks(sum, h, mode)) { asks.push('word'); notes.push('"' + sum.slice(0, 80) + '"'); }
    const typed = n === 'computer' && inp.action === 'type' ? inp.text : (n === 'form_input' ? inp.value : null);
    if (!high && typed != null && typedWrite(typed)) { asks.push('typed-write'); texts.push({ kind: 'typed', text: String(typed).slice(0, TEXT_CAP), cut: String(typed).length > TEXT_CAP }); }
    // A typed newline is an Enter, which can submit a form; only a query editor or a search box is a look.
    if (!high && n === 'computer' && inp.action === 'type' && /[\r\n]/.test(String(inp.text || '')) &&
      !asks.slice(before).includes('word') && !/^\s*types (a |the )?(read-only|search)\b/i.test(String(sum || ''))) asks.push('typed-enter');
    const askedHere = asks.slice(before).some(c => c !== 'new-site');
    if ((high || askedHere) && typeof sum === 'string' && sum.trim()) { claims.push({ text: sum.trim().slice(0, 2000), danger: wordHit(sum) || asks.slice(before).includes('word') }); where.push(h); }
    if (!high && !askedHere && typeof sum === 'string') passed.push({ host: h, words: sum.trim().split(/\s+/).slice(0, 6).join(' ').slice(0, 80) });
    // Follow-up: a control naming a danger noun makes the next interaction on the tab ask, even when this
    // one asked too (Erez approving the toggle has not seen the click that applies it), unless this one
    // asked and is itself the commit (confirm, save, apply ...): then Erez approved the change itself.
    const id = String(inp.tabId);
    if (!high && typeof sum === 'string' && DANGER_NOUN.test(sum) && !(askedHere && COMMITS.test(sum))) { tabs[id].taint = true; tainted.add(id); untainted.delete(id); }
    else if (t.taint) { tabs[id].taint = false; untainted.add(id); tainted.delete(id); }
  };
  // Later items in the same call cannot trust a tab this item may have moved.
  const markMoves = it => {
    if (SWITCHES_BROWSER.has(it.name)) { switched = true; allMoved = true; for (const k of Object.keys(tabs)) tabs[k].stale = true; return; }
    if (!moves(it, helpers)) return;
    const id = it.input.tabId;
    // No tab named (or an odd tab id), or an unfamiliar tool/action: any tab may have moved.
    if (id == null || id === ODD_TAB || !known(it)) { allMoved = true; for (const k of Object.keys(tabs)) tabs[k].stale = true; return; }
    const prev = has(tabs, String(id)) ? tabs[id] : null;
    const url = it.name === 'navigate' && !isHistory(it.input.url) ? String(it.input.url) : (prev && prev.url) || null;
    tabs[id] = { url, stale: true, taint: !!(prev && prev.taint) };
    moved.add(String(id));
  };
  for (const it of items) { actions++; check(it); markMoves(it); }
  // Helpers this call's scripts store on window (recorded before the call runs, see applyDecision).
  const newHelpers = [];
  for (const it of items) if (it.name === 'javascript_tool') for (const hn of helperNames(it.input.text || '')) if (!newHelpers.includes(hn)) newHelpers.push(hn);
  const res = { actions, interactive, hosts: newHosts, notes: [...new Set(notes)], moved: [...moved], allMoved,
    tainted: [...tainted], untainted: [...untainted], passed, newHelpers,
    texts, claims: claims.reduce((a, c) => { const o = a.find(x => x.text === c.text); if (o) o.danger = o.danger || c.danger; else a.push(c); return a; }, []), where: [...new Set(where)],
    switchesBrowser: items.some(it => SWITCHES_BROWSER.has(it.name)) };
  if (denies.length) {
    const cause = denies[0];
    const streak = state.streak.cause === cause ? state.streak.n : 0;
    if (streak >= 2) { res.decision = 'ask'; res.causes = [...new Set(['deny-loop-' + cause].concat(asks))]; }
    else { res.decision = 'deny'; res.causes = [...new Set(denies)]; res.denyCause = cause; }
  } else if (asks.length) { res.decision = 'ask'; res.causes = [...new Set(asks)]; }
  else { res.decision = 'none'; res.causes = []; }
  return res;
}

const DENY_TEXT = {
  'unknown-tab': 'Browser gate (GEN-924): this tab\'s page is not known yet. Call tabs_context_mcp (or take a screenshot of the tab) first, then repeat the action.',
  'stale-tab': 'Browser gate (GEN-924): an earlier click, key or form fill may have moved this tab to another page, which the gate cannot see yet. End a call after such an action with a screenshot of the tab, then send the next actions in a new call.',
  'no-summary': 'Browser gate (GEN-924): add action_summary (the effect only, accurately) to every click, key, typing, drag and form_input item, then repeat the call.'
};

const ASK_TEXT = {
  'new-site': h => 'First action on ' + h + ' this session. Approving lets Claude open, look around and search there without asking again this session; anything that may change, send or delete something still asks.',
  'high-stakes': h => 'High-stakes site (' + h + '): every click, key and form fill asks.',
  'word': s => 'This action may change, send, delete, pay, share or grant something: ' + s + '.',
  'risky-script': () => 'A page script that can change the page or send data.',
  'script-helper': () => 'A page script that calls a helper an earlier script set up, which can change the page or send data.',
  'follow-up': h => 'The action right after a role, permission, owner or billing control on ' + h + ' (often the one that applies it).',
  'typed-write': () => 'Typing a database command that changes or deletes data.',
  'typed-enter': () => 'Typing that ends in Enter, which can submit a form.',
  'helper-args': () => 'A page script passes a helper something other than a read-only query.',
  'always-file_upload': () => 'File upload to a web page.',
  'always-upload_image': () => 'Image upload to a web page.',
  'always-shortcuts_execute': () => 'Runs a saved browser shortcut.',
  'always-gif-drop': () => 'Drops a recording onto a web page.',
  'nav-history': () => 'Goes back or forward in the tab\'s history, to a page the gate cannot name.',
  'unreadable-url': () => 'Opens an address the gate cannot read.',
  'non-web-url': () => 'Opens an address that is not a web page (for example a script or file address).',
  'non-web-tab': () => 'Acts on a tab showing a page that is not an ordinary web site (a blank, file or data page, or a browser settings, extension or new-tab page).',
  'no-state': () => 'The browser gate could not read its records for this session, so it asks.',
  'unreadable-batch': () => 'A batch of browser actions the gate cannot read.'
};

// ---------------------------------------------------------------- pop-up text (GEN-953)
// Erez reads this at the top of the pop-up, above Claude's raw request. Each change cause opens with a
// sentence that keeps at least the meaning of the earlier wording (legacyReasonFor), so no card reads
// milder than before, whatever the patterns below miss. What the check itself reads in a typed command
// or a page script can only ADD a line ("Among other things, the check sees that it ..."), and only from
// a closed list of serious kinds. Claude's own summaries come last, marked as not checked, with nothing
// from the check after them. Labels only: nothing here changes a decision.

// Serious kinds of database command, worst first. Milder kinds (adding or changing rows, creating an
// object) are never named: the opening sentence already says the command changes or deletes data, and
// naming only a milder kind would read as the whole story.
const SQL_KINDS = [
  [/\b(drop|truncate)\s+[\w`"\[]|\bdelete\s+(from\s+)?[\w`"\[.]|\b(remove|rm)\s+@|\binsert\s+overwrite\b|\bthen\s+delete\b/i, 'deletes tables, rows or other database objects'],
  [/\b(grant|revoke)\s+\w|\b(create|alter)\s+(or\s+replace\s+)?(user|role|share)\b/i, 'changes who has access'],
  [/\bcopy\s+into\s+(@|'|"?(s3|gcs|azure)\b)/i, 'copies data to or from storage outside the database, which can send data out'],
  [/\bcreate\s+or\s+replace\b|\balter\s+(table|schema|database|warehouse|task|integration|pipe|stream|view|account)\b/i, 'replaces or changes live tables, views or code'],
  [/\b(call|execute|exec)\s+[\w`"\[.(]|\bsystem\$\w+\s*\(/i, 'runs a saved database program, which can change anything']
];
// The text a database command is read from: typed text whole; in a script only its quoted texts
// (JavaScript has its own "delete"). Comments and SQL string values are set aside, so a read query that
// searches for 'create or replace%' is not labelled as one. Read several ways and every kind any read
// finds is named: with and without backslash escapes ('a\'b'), comments stripped before and after the
// values are set aside (a '--' inside a value, a quote inside a comment), comments kept (MySQL runs
// "1--1" and "/*! ... */", as typedWrite assumes), and each text both on its own and joined with the rest.
// One pass, no regex backtracking: each quoted value becomes '' ('' inside is a quote; with bs, a
// backslash escapes the next character). A value left open is kept as it is, so a stray apostrophe
// cannot hide the statements after it.
function blankQuoted(t, bs) {
  let out = '', i = 0, open = false;
  while (i < t.length) {
    const q = t.indexOf("'", i);
    if (q < 0) { out += t.slice(i); break; }
    let j = q + 1, closed = false;
    while (j < t.length) {
      const ch = t[j];
      if (bs && ch === '\\') { j += 2; continue; }
      if (ch === "'") { if (t[j + 1] === "'") { j += 2; continue; } closed = true; break; }
      j++;
    }
    if (!closed) { out += t.slice(i); open = true; break; }
    out += t.slice(i, q) + "''";
    i = j + 1;
  }
  return { out, open };
}
// Each typed text and each quoted text of a script on its own, and all of them joined.
function sqlSources(texts) {
  const one = [];
  for (const x of texts || []) {
    if (x.kind === 'script') for (const q of quotedTexts(x.text)) one.push({ src: q, typed: false });
    else one.push({ src: String(x.text), typed: true });
  }
  // (the joined text is read only up to TEXT_CAP, so a large batch costs no more than one long text)
  return one.length > 1 ? one.concat({ src: one.map(x => x.src).join('\n').slice(0, TEXT_CAP), typed: false }) : one;
}
// Every serious kind found, worst first; and whether a typed text left a quoted value open in every
// reading (in a script, a quote inside one text is ordinary prose, read on its own).
function sqlKind(texts) {
  const found = new Set();
  let open = false;
  for (const { src, typed } of sqlSources(texts)) {
    const a = blankQuoted(src, false), b = blankQuoted(src, true);
    if (typed && a.open && b.open) open = true;
    const reads = [false, true].flatMap(bs => [blankQuoted(stripSqlComments(src), bs).out, stripSqlComments(blankQuoted(src, bs).out)])
      .concat([a.out, b.out]);
    for (const [re, label] of SQL_KINDS) if (reads.some(t => re.test(t))) found.add(label);
  }
  return { kinds: SQL_KINDS.map(k => k[1]).filter(l => found.has(l)), open };
}

// Serious things the check sees a page script do, worst first. "Changes the page or a form" is never
// named: the opening sentence already says the script can change the page or send data.
const SCRIPT_KINDS = [
  [/\beval\s*\(|\bFunction\s*\(|\bimport\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]|\\u(?!00a0)[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}|\batob\s*\(|\bReflect\.|\bProxy\b|\bwith\s*\(|\[\s*['"`][^'"`]*['"`]\s*\+|\[\s*[a-zA-Z_$][\w$]*\s*\]\s*\(/, 'runs code that is hidden or hard to read'],
  [/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|postMessage|navigator\.(share|credentials)|(\$|jQuery)\s*\.\s*(ajax|post|get|getJSON)\s*\(|\.(src|href|action)\s*=[^=]/, 'sends data from the page to a server'],
  [/\.click\s*\(|\.submit\s*\(|requestSubmit|dispatchEvent|\bdispatch\s*\(|new\s+\w*Event\b|\.reset\s*\(/, 'clicks, submits or presses things on the page'],
  [/\blocation\s*=[^=]|\blocation\.(href|host|hostname|pathname|search|hash|port|protocol)\s*=[^=]|\blocation\.(assign|replace)\s*\(|\bwindow\s*\.\s*open\s*\(|(?<![\w$.])open\s*\(|history\.(push|replace)State|history\.(back|forward|go)\s*\(|navigation\.navigate/, 'opens another address, which can carry page data there'],
  [/(local|session)Storage\.(setItem|removeItem|clear)|document\.cookie\s*=|indexedDB|caches\.|navigator\.(clipboard|serviceWorker)/, "changes the site's data saved on this computer"]
];
function scriptKinds(texts) {
  const src = (texts || []).filter(x => x.kind === 'script').map(x => String(x.text)).join('\n');
  return SCRIPT_KINDS.filter(([re]) => re.test(src)).map(([, label]) => label);
}

const andJoin = a => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
// Causes that are a change (the pop-up then adds the undo note and the caution).
const CHANGE_CAUSES = new Set(['high-stakes', 'word', 'typed-write', 'risky-script', 'script-helper', 'helper-args', 'follow-up',
  'typed-enter', 'always-file_upload', 'always-upload_image', 'always-shortcuts_execute', 'always-gif-drop',
  // actions the check cannot classify may change something too
  'no-state', 'non-web-tab', 'unreadable-batch', 'unreadable-url', 'non-web-url']);
const isChangeCause = c => CHANGE_CAUSES.has(c) || c.startsWith('unknown-tool:') || c.startsWith('deny-loop-');
// Order on the card: the most serious first; the first-visit note last.
const CAUSE_ORDER = ['typed-write', 'helper-args', 'risky-script', 'script-helper', 'high-stakes', 'follow-up', 'word', 'typed-enter'];
const causeRank = c => c === 'new-site' ? 99 : (CAUSE_ORDER.includes(c) ? CAUSE_ORDER.indexOf(c) : 50);
// Claude's words as shown: one line, no control or invisible formatting characters (text-direction
// overrides among them), quote marks made plain so a quote cannot appear to close early, at most 100
// characters.
const QUOTE_LIKE = /[\p{Quotation_Mark}″‶״ʺˮ˝❝❞〃\u{1F676}-\u{1F678}]/gu;
function claimText(q) {
  const t = Array.from(String(q).replace(/\s+/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(QUOTE_LIKE, "'").trim());
  return '"' + (t.length > 100 ? t.slice(0, 100).join('') + '…' : t.join('')) + '"';
}

function plainReason(res) {
  const highOpts = { adminConsolesHighStakes: ADMIN_CONSOLES_HIGH_STAKES };
  const notes = Array.isArray(res.notes) ? res.notes : [];
  // Sites the decision noted (as the old text used them), and with them the sites of asked interactions.
  const noteSites = [...new Set(notes.filter(x => !x.startsWith('"')))];
  const sites = [...new Set(noteSites.concat(Array.isArray(res.where) ? res.where : []))].filter(Boolean);
  const quotes = notes.filter(x => x.startsWith('"')).map(x => x.replace(/^"|"$/g, ''));
  const texts = Array.isArray(res.texts) ? res.texts : [];
  const hosts = Array.isArray(res.hosts) ? res.hosts : [];
  const causes = res.causes.slice().sort((a, b) => causeRank(a) - causeRank(b));
  const change = causes.some(isChangeCause);
  const parts = [], named = new Set();
  // A text longer than the part the check reads (one text, or a batch's texts together).
  const cut = texts.some(x => x && x.cut) || texts.reduce((n, x) => n + String((x && x.text) || '').length, 0) > TEXT_CAP;
  let sqlShown = false, jsShown = false;
  const addSql = () => {
    if (sqlShown) return; sqlShown = true;
    const sql = sqlKind(texts);
    if (sql.kinds.length) parts.push('Among other things, the check sees that it ' + andJoin(sql.kinds) + '.');
    if (cut || sql.open) parts.push('The check could not read all of it.');
  };
  const addJs = () => {
    if (jsShown) return; jsShown = true;
    const js = scriptKinds(texts);
    if (js.length) parts.push('Among other things, the check sees that it ' + andJoin(js) + '.');
    if (cut) parts.push('The check could not read all of it.');
  };
  for (const c of causes) {
    if (c === 'new-site') {
      for (const h of hosts.filter(x => !x.startsWith('helper:'))) {
        parts.push(change ? "It is also Claude's first action on " + h + ' this session; if you allow it, Claude can look around there without asking again.'
          : 'First action on ' + h + ' this session. If you allow it, Claude can look around there without asking again; anything that may change, send or delete something still asks.');
        named.add(h);
      }
    } else if (c === 'high-stakes') {
      for (const h of noteSites.filter(x => isHigh(x, highOpts))) {
        parts.push(h + ' is a high-stakes site, so every click, key and form fill there asks.');
        named.add(h);
      }
    } else if (c === 'word') {
      parts.push('This may change, send, delete, pay, share or grant something.');
    } else if (c === 'typed-write') {
      const typedHere = texts.some(x => x.kind === 'typed'), scriptHere = texts.some(x => x.kind === 'script');
      parts.push((typedHere && scriptHere ? 'Typing or a page script runs' : typedHere ? 'Typing' : 'The script runs') + ' a database command that changes or deletes data.');
      addSql();
    } else if (c === 'helper-args') {
      parts.push('A page script hands code an earlier script left on the page something other than a look-only query, which can change or delete data or send it.');
      addSql();
    } else if (c === 'risky-script') {
      parts.push('A page script that can change the page or send data.');
      addJs();
    } else if (c === 'script-helper') {
      const reused = hosts.some(h => h.startsWith('helper:'));
      parts.push('A page script reuses code an earlier script left on the page, which can change the page or send data.' +
        (reused ? ' If you allow it, later uses of that code this session go ahead unless they carry a database change or a risky step.' : ''));
      addJs();
    } else if (c === 'follow-up') {
      for (const h of noteSites.filter(x => !isHigh(x, highOpts))) {
        parts.push('This comes right after a click on a role, permission, owner or billing control on ' + h + ', and is often the click that applies it.');
        named.add(h);
      }
    } else if (c === 'typed-enter') {
      parts.push('Typing that ends in Enter, which can submit a form.');
    } else if (c === 'deny-loop-no-summary') {
      parts.push('Claude did not say what this action does, so the check could not look at it.');
    } else if (c.startsWith('deny-loop-')) {
      parts.push('Claude could not confirm which page this tab is on.');
    } else if (ASK_TEXT[c]) {
      parts.push(ASK_TEXT[c]().replace(/\bgate\b/g, 'check'));
    } else {
      parts.push('A browser action the check cannot classify (' + String(c).replace(/[^\w:.-]/g, '').slice(0, 60) + ').');
    }
  }
  let s = 'Browser safety check: ' + [...new Set(parts)].join(' ');
  const unnamed = sites.filter(h => !named.has(h));
  if (unnamed.length) s += ' Site: ' + unnamed.join(', ') + '.';
  if (change) s += ' Undo is not guaranteed; allow only if Claude told you in the chat it would do this.';
  // Claude's own summaries, last: every one that names a danger to the decision's own word lists or made
  // its own click ask (as the old text showed every such summary), then the others up to 6 in all; a
  // count of the rest goes inside the label.
  const claims = (Array.isArray(res.claims) && res.claims.length ? res.claims : quotes.map(q => ({ text: q })))
    .map(x => typeof x === 'string' ? { text: x } : x);
  if (claims.length) {
    const danger = x => x.danger === undefined ? wordHit(String(x.text)) : !!x.danger;
    const d = claims.filter(danger), p = claims.filter(x => !danger(x));
    const shown = d.concat(p.slice(0, Math.max(0, 6 - d.length)));
    const hidden = claims.length - shown.length;
    s += ' Claude says (not checked' + (hidden ? '; ' + hidden + ' more not shown' : '') + '): ' + shown.map(x => claimText(x.text)).join('; ') + '.';
  }
  return s;
}

function reasonFor(res) {
  try { return plainReason(res); } catch (e) { return legacyReasonFor(res); }
}

function legacyReasonFor(res) {
  const sites = res.notes.filter(x => !x.startsWith('"'));
  const quotes = res.notes.filter(x => x.startsWith('"'));
  const parts = [];
  for (const c of res.causes) {
    if (c === 'new-site' || c === 'high-stakes') {
      const list = c === 'high-stakes' ? sites.filter(h => isHigh(h, { adminConsolesHighStakes: ADMIN_CONSOLES_HIGH_STAKES })) : res.hosts.filter(h => !h.startsWith('helper:'));
      for (const h of list) parts.push(ASK_TEXT[c](h));
    } else if (c === 'word') { for (const q of quotes) parts.push(ASK_TEXT.word(q)); }
    else if (c === 'script-helper') {
      const names = res.hosts.filter(h => h.startsWith('helper:')).map(h => h.slice(h.lastIndexOf(':') + 1));
      parts.push(ASK_TEXT['script-helper']() + (names.length ? ' Helper: ' + names.join(', ') + '; approving lets later calls to it go ahead this session unless they carry a database write or a risky pattern.' : ''));
    }
    else if (c === 'follow-up') { for (const h of sites.filter(x => !isHigh(x, { adminConsolesHighStakes: ADMIN_CONSOLES_HIGH_STAKES }))) parts.push(ASK_TEXT['follow-up'](h)); }
    else if (c === 'deny-loop-no-summary') parts.push('Claude did not say what this action does (no action summary), so the gate could not check it.');
    else if (c.startsWith('deny-loop-')) parts.push('Claude could not confirm which page this tab is on' + (sites.length ? ' (last seen: ' + sites.join(', ') + ')' : '') + '.');
    else if (ASK_TEXT[c]) parts.push(ASK_TEXT[c]());
    else parts.push('A browser action the gate cannot classify (' + c + ').');
  }
  const where = sites.length ? ' Site: ' + [...new Set(sites)].join(', ') + '.' : '';
  return [...new Set(parts)].join(' ') + where + ' (browser gate, GEN-924)';
}

// Tab pages a result reports, or null if it reports none the gate can trust.
// Only the "Tab Context:" block the extension appends (exactly one per result: page text, a script's
// return value or a title could hold a look-alike, and two blocks means one is not genuine). Its
// lines are "tabId N: "title" ("url")"; the title is page-controlled and may contain `" ("...")`, so
// the URL is the LAST group, which holds no quote. availableTabs JSON is trusted only as the whole
// result of tabs_context_mcp (on other results it is the list from BEFORE a navigate).
// Returns { tabs } when the report reads cleanly, { bad: true } when something in it is off (then
// every tab becomes unsure), or null when the result carries no report.
// The block is read line by line on "\n" only: a title holding U+2028/U+2029 or "\r" (which other line
// rules treat as a line end) makes the whole report untrusted, as do a repeated tab id or any line
// mentioning a tab that does not read in full.
const TAB_LINE = /^\s*\S?\s*tabId (\d+): "(.*)" \("([^"]*)"\)\s*$/;
function tabsFromText(txt, fromTabsContext) {
  if (typeof txt !== 'string') return null;
  const m = {};
  const marks = txt.split('Tab Context:').length - 1;
  if (marks === 1) {
    const block = txt.slice(txt.indexOf('Tab Context:')).split(/<system-reminder>|\n[ \t]*\n/)[0];
    if (/[\u2028\u2029\r]/.test(block)) return { bad: true };
    for (const line of block.split('\n')) {
      if (!/tabId \d+:/.test(line)) continue;
      const mm = TAB_LINE.exec(line);
      if (!mm || has(m, mm[1])) return { bad: true };
      m[mm[1]] = mm[3];
    }
  } else if (marks === 0 && fromTabsContext) {
    const js = /\{\s*"availableTabs"\s*:\s*\[[\s\S]*?\]\s*(,\s*"tabGroupId"\s*:\s*\d+\s*)?\}/.exec(txt);
    let j; try { j = js ? JSON.parse(js[0]) : null; } catch (e) { j = null; }
    const list = j && Array.isArray(j.availableTabs) ? j.availableTabs : null;
    if (!list) return null;
    for (const t of list) {
      if (!t || typeof t.tabId !== 'number' || typeof t.url !== 'string') return { bad: true };
      if (has(m, String(t.tabId))) return { bad: true };
      m[String(t.tabId)] = t.url;
    }
  } else if (marks > 1) return { bad: true };
  else return null;
  return Object.keys(m).length ? { tabs: m } : null;
}

// Text of a tool response, whatever its shape (string, content-part array, {content: [...]}).
function responseText(resp) {
  const parts = [];
  const walk = (v, depth) => {
    if (v == null || depth > 6) return;
    if (typeof v === 'string') { parts.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === 'object') {
      if (typeof v.text === 'string') parts.push(v.text);
      else if (v.content != null) walk(v.content, depth + 1);
      else if (v.result != null) walk(v.result, depth + 1);
    }
  };
  walk(resp, 0);
  return parts.join('\n');
}

// Mark tabs unsure: the ones this call may have moved, or all of them.
function markStale(state, ids, all) {
  const list = all ? Object.keys(state.tabs) : ids;
  for (const id of list) {
    if (id === '__proto__') continue;
    const prev = has(state.tabs, id) ? state.tabs[id] : null;
    state.tabs[id] = { url: (prev && prev.url) || null, stale: true, taint: !!(prev && prev.taint) };
  }
}

// What a call that goes ahead does to the state before it runs (PreToolUse): tabs it may move become
// unsure at once (so a call running alongside can't use their old pages), and the follow-up marks.
// A mark is cleared here only for a call that goes ahead without a prompt; for an asked call it is
// cleared after the call ran (record), so a prompt Erez refuses leaves the mark and the retry asks.
function applyDecision(state, res) {
  if (res.decision === 'deny') return;
  // Tab ids and approvals belong to one browser: forget them before the switch runs (a lost
  // PostToolUse must not carry them over to the other browser). Helper NAMES are kept, and this call's
  // are added: they only ever make a later script ask (their approvals are per site and are dropped).
  if (res.switchesBrowser) {
    state.tabs = {}; state.approved = {};
    rememberHelpers(state, res.newHelpers);
    return;
  }
  markStale(state, res.moved || [], !!res.allMoved);
  for (const id of res.tainted || []) if (id !== '__proto__' && has(state.tabs, id)) state.tabs[id].taint = true;
  if (res.decision !== 'ask') unmark(state, res.untainted);
  // A helper is remembered as soon as a script that stores it may run (a lost PostToolUse must not forget it).
  rememberHelpers(state, res.newHelpers);
}
// Remember helper names a script stores on window (the newest 200).
function rememberHelpers(state, names) {
  for (const hn of names || []) if (!state.helpers.includes(hn)) state.helpers.push(hn);
  if (state.helpers.length > 200) state.helpers = state.helpers.slice(-200);
}
function unmark(state, ids) {
  for (const id of ids || []) if (typeof id === 'string' && id !== '__proto__' && has(state.tabs, id)) state.tabs[id].taint = false;
}

// After a call ran: approve its pending hosts and clear its pending follow-up marks (Erez answered the
// prompt and the call ran), then update the tab pages. A tab is "sure" again only when a successful
// result reports its page AND nothing in the call could have moved it after its last read.
function record(state, tool, input, resultText, pendingHosts, failed, pendingUnmark) {
  const name = shortName(tool);
  if (!name) return;
  for (const h of pendingHosts || []) if (typeof h === 'string' && h && h !== '__proto__') state.approved[h] = true;
  unmark(state, pendingUnmark);
  const items = itemsOf(name, input) || [];
  // Tab ids and site approvals belong to one browser (and its signed-in accounts), also inside a batch;
  // helper names are kept (and this call's added), since they only ever make a later script ask.
  if (items.some(it => SWITCHES_BROWSER.has(it.name))) {
    state.tabs = {}; state.approved = {};
    for (const it of items) if (it.name === 'javascript_tool') rememberHelpers(state, helperNames(it.input.text || ''));
    return;
  }
  const lastMove = {}, lastAny = {};
  let noTabMove = -1;
  items.forEach((it, i) => {
    const id = it.input && it.input.tabId;
    const mv = moves(it, state.helpers);
    if (id != null && id !== ODD_TAB) { lastAny[id] = i; if (mv) lastMove[id] = i; }
    else if (mv) noTabMove = i;
    // A helper a script stored on window is remembered: later scripts calling it count as risky.
    if (it.name === 'javascript_tool') rememberHelpers(state, helperNames(it.input.text || ''));
  });
  const touched = Object.keys(lastAny);
  // A failed call may have stopped anywhere: every tab it touched is unsure, and its error text is not a page report.
  if (failed) { markStale(state, touched, noTabMove >= 0); return; }
  markStale(state, Object.keys(lastMove), noTabMove >= 0);
  const seen = tabsFromText(resultText, name === 'tabs_context_mcp');
  if (!seen) return;
  if (seen.bad) { markStale(state, [], true); return; }
  for (const [id, url] of Object.entries(seen.tabs)) {
    if (id === '__proto__') continue;
    const movedAfterLastRead = has(lastMove, id) && lastMove[id] === lastAny[id];
    const readAfterNoTabMove = has(lastAny, id) && lastAny[id] > noTabMove;
    const unsure = movedAfterLastRead || (noTabMove >= 0 && !readAfterNoTabMove);
    const prev = has(state.tabs, id) ? state.tabs[id] : null;
    const sameSite = prev && prev.url && hostOf(prev.url) === hostOf(url);
    state.tabs[id] = { url, stale: !!unsure, taint: !!(sameSite && prev.taint) };
  }
}

function countCall(state, res) {
  const c = state.counts;
  // Actions count only for a call that goes ahead: a denied call's actions run later, once, when Claude
  // resends it (counting them twice would flatter the per-action bar and make its alert late).
  c.calls++; if (res.decision !== 'deny') c.actions += res.actions || 0;
  if (res.decision === 'ask') {
    c.asked++;
    if (!res.causes.every(x => x === 'new-site')) c.nonSiteAsked++;
    for (const x of res.causes) c.ask[x] = (c.ask[x] || 0) + 1;
  } else if (res.decision === 'deny') {
    c.denied++;
    for (const x of res.causes) c.deny[x] = (c.deny[x] || 0) + 1;
  }
  // Reads between denies don't reset the run (Claude's "screenshot, then retry" must still end in an
  // ask if the tab stays unrecognised); an interaction that goes ahead, or an ask, does.
  if (res.decision === 'deny') state.streak = { cause: res.denyCause, n: state.streak.cause === res.denyCause ? state.streak.n + 1 : 1 };
  else if (res.decision === 'ask' || (res.interactive || 0) > 0) state.streak = { cause: null, n: 0 };
}

// The ticket's bar: more than about 1 non-site ask per 10 browser actions means the rules need revisiting.
const BAR = { minActions: 30, nonSitePerAction: 0.1 };
function overBar(state) {
  const c = state.counts;
  return c.actions >= BAR.minActions && c.nonSiteAsked / c.actions > BAR.nonSitePerAction;
}

// ---------------------------------------------------------------- state files

function stateFile(sessionId) {
  const safe = String(sessionId || 'nosession').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'nosession';
  return path.join(STATE_DIR, safe + '.json');
}

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Exclusive-create lock; returns a release function, or null if the lock could not be taken.
function lock(file) {
  const lk = file + '.lock';
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lk, 'wx');
      fs.closeSync(fd);
      return () => { try { fs.unlinkSync(lk); } catch (e) { /* already gone */ } };
    } catch (e) {
      // EPERM/EACCES/EBUSY: Windows "delete pending" or a scanner holding the file; retry like a held lock.
      if (!['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(e.code)) return null;
      if (Date.now() > until) return null;
      try { if (Date.now() - fs.statSync(lk).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lk); continue; } } catch (e2) { sleepMs(25); continue; }
      sleepMs(25);
    }
  }
}

// Missing (ENOENT): a new session, every site new. Not readable right now (another program holding it,
// after a few tries): null, so this call is decided without records, asks, and saves nothing, and the
// good file is kept. Bad JSON: every site new, and the page-script helpers it held are lost, so every
// script asks for the rest of the session (lostRecords).
function loadState(file) {
  let raw;
  for (let i = 0; ; i++) {
    try { raw = fs.readFileSync(file, 'utf8'); break; } catch (e) {
      if (e.code === 'ENOENT') return newState();
      if (i >= 3) return null;
      sleepMs(50);
    }
  }
  try { return normalizeState(JSON.parse(raw)); } catch (e) { const s = newState(); s.lostRecords = true; return s; }
}

function saveState(file, state) {
  const now = Date.now();
  for (const [k, v] of Object.entries(state.pending)) if (!v || typeof v.ts !== 'number' || now - v.ts > PENDING_TTL_MS) delete state.pending[k];
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(state));
    // A scanner briefly holding the file (Windows EPERM/EACCES/EBUSY): retry a few times.
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, file); break; } catch (e) {
        if (i >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
        sleepMs(50);
      }
    }
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* never written */ }
    throw e;
  }
}

function pruneStateDir() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(STATE_DIR)) {
      const p = path.join(STATE_DIR, f);
      try { if (now - fs.statSync(p).mtimeMs > STATE_TTL_MS) fs.unlinkSync(p); } catch (e) { /* skip */ }
    }
  } catch (e) { /* skip */ }
}

function logLine(obj) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(Object.assign({ ts: new Date().toISOString() }, obj)) + '\n');
    // Pruning reads the whole file, so it runs on about 1 in 20 writes, and rewrites only when old lines go.
    if (Math.random() < 0.05 && fs.statSync(LOG_FILE).size > LOG_PRUNE_BYTES) {
      const cut = Date.now() - LOG_KEEP_MS;
      const all = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(l => l);
      const keep = all.filter(l => { try { return Date.parse(JSON.parse(l).ts) >= cut; } catch (e) { return false; } });
      if (keep.length === all.length) return;
      const tmp = LOG_FILE + '.' + process.pid + '.tmp';
      try {
        fs.writeFileSync(tmp, keep.join('\n') + (keep.length ? '\n' : ''));
        fs.renameSync(tmp, LOG_FILE);
      } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* never written */ } }
    }
  } catch (e) { /* logging never changes a decision */ }
}

// For the first live calls: what a PostToolUse payload looks like (no page text).
function logShape(event, resp, text) {
  try {
    const marker = path.join(STATE_DIR, '_shape-count');
    let n = 0;
    try { n = parseInt(fs.readFileSync(marker, 'utf8'), 10) || 0; } catch (e) { /* first */ }
    if (n >= SHAPE_LOG_MAX) return;
    fs.writeFileSync(marker, String(n + 1));
    const shape = Array.isArray(resp) ? 'array[' + resp.length + ']:' + resp.map(x => (x && typeof x === 'object') ? Object.keys(x).join('+') : typeof x).join(',').slice(0, 120)
      : (resp && typeof resp === 'object') ? 'object:' + Object.keys(resp).join('+').slice(0, 120) : typeof resp;
    logLine({ event: 'shape', hook: event, shape, textChars: text.length, hasTabContext: /Tab Context|availableTabs/.test(text), tabsFound: (() => { const r = tabsFromText(text, false); return r ? (r.bad ? 'bad' : Object.keys(r.tabs).length) : 0; })() });
  } catch (e) { /* skip */ }
}

// ---------------------------------------------------------------- hook entry

function out(obj) { process.stdout.write(JSON.stringify(obj)); }
function askOut(reason) { out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } }); }
function denyOut(reason) { out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }); }

function handlePre(input) {
  const tool = input.tool_name;
  if (!shortName(tool)) return; // not a browser tool: no opinion
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (Math.random() < 0.02) pruneStateDir();
  const file = stateFile(input.session_id);
  const release = lock(file);
  const loaded = release ? loadState(file) : null;
  // No records this call (no lock, or the file is held by another program): decide on an empty state,
  // save nothing, and keep the file as it is.
  const noRecords = !loaded;
  const state = loaded || newState();
  let res;
  try {
    res = decide(state, tool, input.tool_input, { adminConsolesHighStakes: ADMIN_CONSOLES_HIGH_STAKES });
    // Without its records the gate cannot know which page-script helpers exist, so a script asks; and
    // without saving its deny count is never kept, so a deny would repeat forever: ask instead.
    if (((noRecords || state.lostRecords) && res.decision === 'none' && (itemsOf(shortName(tool), input.tool_input) || []).some(it => it.name === 'javascript_tool')) ||
      (noRecords && res.decision === 'deny')) {
      res.decision = 'ask'; res.causes = ['no-state'];
    }
    countCall(state, res);
    if (res.decision === 'ask' && (res.hosts.length || (res.untainted || []).length) && input.tool_use_id) {
      state.pending[String(input.tool_use_id)] = { hosts: res.hosts, unmark: res.untainted || [], ts: Date.now() };
    }
    // A call that goes ahead may move tabs while it runs: other calls running at the same time must
    // not act on those tabs' old pages. Its own PostToolUse makes them sure again if it can.
    applyDecision(state, res);
    if (!noRecords) {
      try { saveState(file, state); } catch (e) {
        // A read that changes nothing may go ahead without its count saved; anything else asks (the
        // error reaches main(), which answers "ask").
        const changesNothing = res.decision === 'none' && !res.interactive && !(res.moved || []).length && !res.allMoved &&
          !(res.newHelpers || []).length && !res.switchesBrowser;
        if (!changesNothing) throw e;
      }
    }
  } finally { if (release) release(); }
  if (res.decision !== 'none') logLine({ event: res.decision, session: input.session_id, tool: shortName(tool), causes: res.causes, hosts: res.notes.filter(x => !x.startsWith('"')) });
  // What went ahead on an ordinary approved site without its own ask: site + the first six words of
  // Claude's own summary (no page text). A sampling aid, read at the live check, not a live watch.
  if (res.decision !== 'deny' && res.passed && res.passed.length) logLine({ event: 'pass', session: input.session_id, items: res.passed.slice(0, 10) });
  if (res.decision === 'ask') return askOut(reasonFor(res));
  if (res.decision === 'deny') return denyOut(DENY_TEXT[res.denyCause] || 'Browser gate (GEN-924): repeat the action after reading the tab.');
}

function handlePost(input, event) {
  const tool = input.tool_name;
  if (!shortName(tool)) return;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = stateFile(input.session_id);
  const release = lock(file);
  if (!release) return; // a lost update only means an extra ask later
  let alert = null;
  try {
    const state = loadState(file);
    if (!state) return; // held by another program: keep the file; a lost update only means an extra ask later
    const id = String(input.tool_use_id || '');
    const pend = id && has(state.pending, id) ? state.pending[id] : null;
    if (pend) delete state.pending[id];
    const failed = event !== 'PostToolUse';
    const resp = failed ? (input.error != null ? input.error : input.tool_response) : input.tool_response;
    const text = responseText(resp);
    logShape(event, resp, text);
    record(state, tool, input.tool_input, text, pend && Array.isArray(pend.hosts) ? pend.hosts : [], failed,
      pend && Array.isArray(pend.unmark) ? pend.unmark : []);
    if (!state.alerted && overBar(state)) {
      state.alerted = true;
      const c = state.counts;
      const top = Object.entries(c.ask).filter(([k]) => k !== 'new-site').sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + ' ' + v).join(', ');
      alert = 'Browser gate (GEN-924): this session has asked Erez ' + c.nonSiteAsked + ' times in ' + c.actions +
        ' browser actions for reasons other than a new site (' + top + '), above the bar of 1 per 10 actions. Tell Erez in ' +
        'your next For-you block, with these causes, so the browser gate\'s rules can be revisited.';
      logLine({ event: 'over-bar', session: input.session_id, calls: c.calls, actions: c.actions, nonSiteAsked: c.nonSiteAsked, causes: c.ask });
    }
    saveState(file, state);
  } finally { release(); }
  if (alert) out({ hookSpecificOutput: { hookEventName: event, additionalContext: alert } });
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw); } catch (e) {
      // Cannot tell which tool this is. Registered only on browser tools, so ask.
      return askOut('The browser gate could not read this call, so it asks (browser gate, GEN-924).');
    }
    const event = input && input.hook_event_name;
    try {
      if (event === 'PostToolUse' || event === 'PostToolUseFailure') return handlePost(input, event);
      return handlePre(input);
    } catch (e) {
      if (event === 'PostToolUse' || event === 'PostToolUseFailure') return; // never blocks after the fact
      if (shortName(input && input.tool_name)) return askOut('The browser gate hit an internal error, so it asks (browser gate, GEN-924): ' + String(e && e.message || e).slice(0, 120));
    }
  });
}

if (require.main === module) main();
module.exports = { PREFIX, shortName, hostOf, decide, record, countCall, reasonFor, DENY_TEXT, newState, normalizeState,
  tabsFromText, responseText, overBar, BAR, wordHit, harmless, summaryAsks, RISKY_SCRIPT, typedWrite, isHigh, applyDecision,
  ADMIN_CONSOLES_HIGH_STAKES, SUMMARY_MODE, plainReason, legacyReasonFor, sqlKind, scriptKinds };
