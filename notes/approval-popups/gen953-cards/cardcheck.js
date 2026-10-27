// GEN-953 step 2 (design v2.5): the committed pop-up wording, written out independently of the code.
// leftover(card) removes every allowed sentence from the check's own part of a card and returns what is
// left ('' = every sentence allowed), so a milder or new phrase in the code fails. Used by tests.js and
// replay.js.
'use strict';
const H = '[a-z0-9.-]+';
const HS = '(…)?[a-z0-9.-]+'; // a site name, possibly shortened to its end
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEVERE_SQL = ['deletes data or database objects', 'changes who has access', 'sends data out of the database to outside storage',
  'replaces or changes live code or tables', 'runs a saved program that can change anything'];
const SEVERE_JS = ['runs hidden code', 'sends data to a server', 'clicks or submits things', 'opens another address, which can carry data',
  "changes the site's saved data"];
// Opening sentence per cause (at least the pre-GEN-953 meaning).
const FLOOR = {
  'word': /May change, send, delete, pay, share or grant something\./,
  'typed-write': /(Typing|A page script runs|Typing or a page script runs) a database command that changes or deletes data\./,
  'helper-args': /(A page script runs more than a lookup through code left on the page; it can change, delete or send data\.|(Typing|A page script runs|Typing or a page script runs) a database command that changes or deletes data\.)/,
  'risky-script': /A page script that can change the page or send data\./,
  'script-helper': /A page script reuses code left on the page; it can change the page or send data\./,
  'high-stakes': new RegExp('High-stakes site \\(' + H + '\\): every click, key and form fill asks\\.'),
  'follow-up': new RegExp('Right after a role, permission, owner or billing control on ' + H + '; often the action that applies it\\.'),
  'typed-enter': /Typing that ends in Enter, which can submit a form\./,
  'new-site': new RegExp('(First action on ' + H + ' this session\\.|Also the first action on ' + H + ' this session;)'),
  'deny-loop-stale-tab': /Claude could not confirm which page this tab is on\./,
  'deny-loop-unknown-tab': /Claude could not confirm which page this tab is on\./,
  'deny-loop-no-summary': /Claude did not say what this action does, so the check could not look at it\./,
  'always-file_upload': /File upload to a web page\./, 'always-upload_image': /Image upload to a web page\./,
  'always-shortcuts_execute': /Runs a saved browser shortcut\./, 'always-gif-drop': /Drops a recording onto a web page\./,
  'unreadable-url': /Opens an address the check cannot read\./, 'non-web-url': /Opens an address that is not a web page/,
  'non-web-tab': /Acts on a tab showing a page that is not an ordinary web site/, 'no-state': /The browser check could not read its records/,
  'unreadable-batch': /A batch of browser actions the check cannot read\./,
  'nav-history': /Goes back or forward in the tab's history/
};
const FLOOR_UNKNOWN = /A browser action the check cannot classify \(/;
const FIXED = ['File upload to a web page.', 'Image upload to a web page.', 'Runs a saved browser shortcut.', 'Drops a recording onto a web page.',
  "Goes back or forward in the tab's history, to a page the check cannot name.", 'Opens an address the check cannot read.',
  'Opens an address that is not a web page (for example a script or file address).',
  'Acts on a tab showing a page that is not an ordinary web site (a blank, file or data page, or a browser settings, extension or new-tab page).',
  'The browser check could not read its records for this session, so it asks.', 'A batch of browser actions the check cannot read.',
  'Claude did not say what this action does, so the check could not look at it.', 'Claude could not confirm which page this tab is on.',
  'The check could not read all of it.', 'Undo not guaranteed; allow only if expected.', 'If allowed, later calls to it go ahead unless the call itself has a database change or a risky step.',
  'A page script runs more than a lookup through code left on the page; it can change, delete or send data.'];
// (The new-site opening is only the start of its sentence: the two whole forms are listed below.)
const ALLOWED = Object.entries(FLOOR).filter(([c]) => ['word', 'typed-write', 'risky-script', 'script-helper', 'high-stakes', 'follow-up', 'typed-enter'].includes(c)).map(([, r]) => new RegExp('^' + r.source))
  .concat([new RegExp('^First action on ' + H + ' this session\\. If allowed, Claude can look around and search there without asking; changes, sends and deletes still ask\\.'),
    new RegExp('^Also the first action on ' + H + ' this session; if allowed, Claude can look around and search there without asking\\.'),
    new RegExp('^(On|Last seen on|Also on) ' + HS + '(, ' + HS + ')*( and \\d+ more)?(: |\\.)'),
    new RegExp('^All sites: ' + H + '(, ' + H + ')*\\.'),
    new RegExp('^Sites in this request: ' + HS + '(, ' + HS + ')*( and \\d+ more)?\\.'), /^A browser action the check cannot classify \([\w:.-]{0,60}\)\./])
  .concat(FIXED.map(f => new RegExp('^' + esc(f))));
function additionOk(list, kinds) {
  let rest = list;
  for (const k of kinds) rest = rest.split(k).join('#');
  return /^#((, #)* and #)?$/.test(rest);
}
// Claude's part: labelled, every quote in double quotes (quote marks inside are made plain), ends with ".".
const CLAUDE = /(^| )Claude says \(unverified\): "[^"]*"(; "[^"]*")*( and \d+ more)?\.(?= |$)/;
function leftover(card) {
  let rest = card.replace(CLAUDE, ' ').replace(/\s+/g, ' ').trim();
  if (!rest) return 'EMPTY';
  while (rest) {
    const add = /^Among other things, it (.+?)\.(?= |$)/.exec(rest);
    if (add) { if (!additionOk(add[1], SEVERE_SQL) && !additionOk(add[1], SEVERE_JS)) return rest; rest = rest.slice(add[0].length).trim(); continue; }
    const m = ALLOWED.map(r => r.exec(rest)).find(Boolean);
    if (!m) return rest;
    rest = rest.slice(m[0].length).trim();
  }
  return '';
}
// Claude's part appears at most once, right after the first sentence group: before the undo note and any
// other cause's opening sentence. A card opening on a stuck tab or a missing summary (which say little
// about the action) has the next cause's group before Claude's part too, and then the others.
const STUCK_OPEN = /^(Claude could not confirm which page this tab is on\.|Claude did not say what this action does)/;
function claudePlaced(res, card) {
  const m = card.match(new RegExp(CLAUDE.source, 'g')) || [];
  if (m.length > 1) return false;
  if (!m.length) return true;
  const before = card.slice(0, card.indexOf(m[0].trim()));
  if (/Undo not guaranteed/.test(before)) return false;
  // at most one cause's opening sentence before it (one group), not counting stuck-tab openings after one
  const stuck = STUCK_OPEN.test(card);
  const opens = Object.entries(FLOOR).filter(([c]) => !(stuck && c.startsWith('deny-loop-')))
    .map(([, r]) => { const x = r.exec(before); return x ? x[0] : null; }).filter(Boolean);
  if (new Set(opens).size > 1) return false;
  if (!stuck) return true;
  // after a stuck-tab opening, the next cause (when there is one besides a first visit) is before Claude's part
  const moreCauses = (res.causes || []).filter(c => !c.startsWith('deny-loop-') && c !== 'new-site' && FLOOR[c]);
  return !moreCauses.length || moreCauses.some(c => FLOOR[c].test(before));
}
const claudeLast = card => claudePlaced({ causes: [] }, card);
// A stuck tab never gets a site put in front of it (its page is not known).
const stuckOk = (res, card) => !(res.causes || []).some(c => c === 'deny-loop-stale-tab' || c === 'deny-loop-unknown-tab') || !/(^|\. )(On|Also on) /.test(card.replace(CLAUDE, ' '));
const cardOk = (res, card) => leftover(card) === '' && claudePlaced(res, card) && stuckOk(res, card) && res.causes.every(c => FLOOR[c] ? FLOOR[c].test(card) : !c.startsWith('unknown-tool:') || FLOOR_UNKNOWN.test(card));
module.exports = { SEVERE_SQL, SEVERE_JS, FLOOR, leftover, claudeLast, claudePlaced, cardOk };
