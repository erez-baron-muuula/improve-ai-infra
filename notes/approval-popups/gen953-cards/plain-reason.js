// ---------------------------------------------------------------- pop-up text (GEN-953)
// Erez reads this at the top of the pop-up, above Claude's raw request. Each change cause opens with a
// sentence that keeps at least the meaning of the earlier wording (legacyReasonFor), so no card reads
// milder than before, whatever the patterns below miss. What the check itself reads in a typed command
// or a page script can only ADD a line ("Among other things, it ..."), and only from
// a closed list of serious kinds. The card opens with the site; Claude's own summaries, marked unverified,
// come right after the first sentence (on a click they are the only part naming it). The order puts what
// matters first, because the pop-up shows only about 3 lines. Labels only: nothing here changes a decision.

// Serious kinds of database command, worst first. Milder kinds (adding or changing rows, creating an
// object) are never named: the opening sentence already says the command changes or deletes data, and
// naming only a milder kind would read as the whole story.
const SQL_KINDS = [
  [/\b(drop|truncate)\s+[\w`"\[]|\bdelete\s+(from\s+)?[\w`"\[.]|\b(remove|rm)\s+@|\binsert\s+overwrite\b|\bthen\s+delete\b/i, 'deletes data or database objects'],
  [/\b(grant|revoke)\s+\w|\b(create|alter)\s+(or\s+replace\s+)?(user|role|share)\b/i, 'changes who has access'],
  [/\bcopy\s+into\s+(@|'|"?(s3|gcs|azure)\b)/i, 'sends data out of the database to outside storage'],
  [/\bcreate\s+or\s+replace\b|\balter\s+(table|schema|database|warehouse|task|integration|pipe|stream|view|account)\b/i, 'replaces or changes live code or tables'],
  [/\b(call|execute|exec)\s+[\w`"\[.(]|\bsystem\$\w+\s*\(/i, 'runs a saved program that can change anything']
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
  [/\beval\s*\(|\bFunction\s*\(|\bimport\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]|\\u(?!00a0)[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}|\batob\s*\(|\bReflect\.|\bProxy\b|\bwith\s*\(|\[\s*['"`][^'"`]*['"`]\s*\+|\[\s*[a-zA-Z_$][\w$]*\s*\]\s*\(/, 'runs hidden code'],
  [/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|postMessage|navigator\.(share|credentials)|(\$|jQuery)\s*\.\s*(ajax|post|get|getJSON)\s*\(|\.(src|href|action)\s*=[^=]/, 'sends data to a server'],
  [/\.click\s*\(|\.submit\s*\(|requestSubmit|dispatchEvent|\bdispatch\s*\(|new\s+\w*Event\b|\.reset\s*\(/, 'clicks or submits things'],
  [/\blocation\s*=[^=]|\blocation\.(href|host|hostname|pathname|search|hash|port|protocol)\s*=[^=]|\blocation\.(assign|replace)\s*\(|\bwindow\s*\.\s*open\s*\(|(?<![\w$.])open\s*\(|history\.(push|replace)State|history\.(back|forward|go)\s*\(|navigation\.navigate/, 'opens another address, which can carry data'],
  [/(local|session)Storage\.(setItem|removeItem|clear)|document\.cookie\s*=|indexedDB|caches\.|navigator\.(clipboard|serviceWorker)/, "changes the site's saved data"]
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
// Order on the card: the most serious first (a tab whose page is unconfirmed first of all: it puts what
// follows in doubt); the first-visit note last.
const CAUSE_ORDER = ['deny-loop-stale-tab', 'deny-loop-unknown-tab', 'deny-loop-no-summary', 'typed-write', 'helper-args', 'risky-script', 'script-helper', 'high-stakes', 'follow-up', 'word', 'typed-enter'];
const causeRank = c => c === 'new-site' ? 99 : CAUSE_ORDER.includes(c) ? CAUSE_ORDER.indexOf(c) : c.startsWith('deny-loop-') ? 2.5 : 50;
// Claude's words as shown: one line, no control or invisible characters (text-direction overrides among
// them), at most 80 characters (as before GEN-953). Punctuation, symbols, modifier letters, combining
// marks, letters outside the Latin, Greek, Cyrillic and Hebrew scripts, and letters of those drawn as
// quote-like strokes all become one apostrophe (an allow-list), and a run of them one, so a closing double
// quote is hard to fake. (Accepted: Hebrew letters such as yod stay, and two of them can look like a quote.)
const PLAIN_MARK = /[^\p{Lu}\p{Ll}\p{Lt}\p{Lo}\p{N}\p{Zs}.,;:!?()\[\]{}@#%&*+=\/\\_<>|~^$€£₪…-]|(?![\p{sc=Latin}\p{sc=Greek}\p{sc=Cyrillic}\p{sc=Hebrew}])\p{L}|[ǀ-ǃװ-ײꞋꞌ]/gu;
function claimText(q) {
  const t = Array.from(String(q).replace(/\s+/g, ' ').replace(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, '').replace(PLAIN_MARK, "'").replace(/'{2,}/g, "'").trim());
  return '"' + (t.length > 80 ? t.slice(0, 80).join('') + '…' : t.join('')) + '"';
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
  const groups = [];
  const add = t => { if (!groups.length) groups.push([]); groups[groups.length - 1].push(t); };
  let cur;
  const sentence = (t, h) => { const g = [t]; g.host = h; g.cause = cur; groups.push(g); };
  // A text longer than the part the check reads (one text, or a batch's texts together).
  const cut = texts.some(x => x && x.cut) || texts.reduce((n, x) => n + String((x && x.text) || '').length, 0) > TEXT_CAP;
  let sqlShown = false, jsShown = false;
  const addSql = () => {
    if (sqlShown) return; sqlShown = true;
    const sql = sqlKind(texts);
    if (sql.kinds.length) add('Among other things, it ' + andJoin(sql.kinds) + '.');
    if (cut || sql.open) add('The check could not read all of it.');
  };
  const addJs = () => {
    if (jsShown) return; jsShown = true;
    const js = scriptKinds(texts);
    if (js.length) add('Among other things, it ' + andJoin(js) + '.');
    if (cut) add('The check could not read all of it.');
  };
  for (const c of causes) {
    cur = c;
    if (c === 'new-site') {
      for (const h of hosts.filter(x => !x.startsWith('helper:'))) {
        sentence(change ? 'Also the first action on ' + h + ' this session; if allowed, Claude can look around and search there without asking.'
          : 'First action on ' + h + ' this session. If allowed, Claude can look around and search there without asking; changes, sends and deletes still ask.', h);
      }
    } else if (c === 'high-stakes') {
      for (const h of noteSites.filter(x => isHigh(x, highOpts))) {
        sentence('High-stakes site (' + h + '): every click, key and form fill asks.', h);
      }
    } else if (c === 'word') {
      sentence('May change, send, delete, pay, share or grant something.');
    } else if (c === 'typed-write') {
      const typedHere = texts.some(x => x.kind === 'typed'), scriptHere = texts.some(x => x.kind === 'script');
      sentence((typedHere && scriptHere ? 'Typing or a page script runs' : typedHere ? 'Typing' : 'A page script runs') + ' a database command that changes or deletes data.');
      addSql();
    } else if (c === 'helper-args') {
      // (with typed-write and one page script and no typed text, the typed-write sentence already says that
      // script runs a database command that changes or deletes data)
      if (!(causes.includes('typed-write') && !texts.some(x => x.kind === 'typed') && texts.filter(x => x.kind === 'script').length === 1)) sentence('A page script runs more than a lookup through code left on the page; it can change, delete or send data.');
      addSql();
    } else if (c === 'risky-script') {
      sentence('A page script that can change the page or send data.');
      addJs();
    } else if (c === 'script-helper') {
      const reused = hosts.some(h => h.startsWith('helper:'));
      sentence('A page script reuses code left on the page; it can change the page or send data.' +
        (reused ? ' If allowed, later calls to it go ahead unless the call itself has a database change or a risky step.' : ''));
      addJs();
    } else if (c === 'follow-up') {
      for (const h of noteSites.filter(x => !isHigh(x, highOpts))) {
        sentence('Right after a role, permission, owner or billing control on ' + h + '; often the action that applies it.', h);
      }
    } else if (c === 'typed-enter') {
      sentence('Typing that ends in Enter, which can submit a form.');
    } else if (c === 'deny-loop-no-summary') {
      sentence('Claude did not say what this action does, so the check could not look at it.');
    } else if (c.startsWith('deny-loop-')) {
      sentence('Claude could not confirm which page this tab is on.');
    } else if (ASK_TEXT[c]) {
      sentence(ASK_TEXT[c]().replace(/\bgate\b/g, 'check'));
    } else {
      sentence('A browser action the check cannot classify (' + String(c).replace(/[^\w:.-]/g, '').slice(0, 60) + ').');
    }
  }
  // Claude's own summaries: every one that names a danger to the decision's own word lists or made its own
  // click ask (as the old text showed every such summary), then the others up to 6 in all; a count of the
  // rest is given after them.
  const claims = (Array.isArray(res.claims) && res.claims.length ? res.claims : quotes.map(q => ({ text: q })))
    .map(x => typeof x === 'string' ? { text: x } : x);
  let claude = '';
  if (claims.length) {
    const danger = x => x.danger === undefined ? wordHit(String(x.text)) : !!x.danger;
    const d = claims.filter(danger), p = claims.filter(x => !danger(x));
    const shown = d.concat(p.slice(0, Math.max(0, 6 - d.length)));
    const hidden = claims.length - shown.length;
    claude = 'Claude says (unverified): ' + shown.map(x => claimText(x.text)).join('; ') + (hidden ? ' and ' + hidden + ' more' : '') + '.';
  }
  // Most important first, to fit the pop-up's few visible lines: the site; the most serious cause with what
  // the check sees in it; Claude's own words (on a click, the only part naming it); the other causes; the
  // undo note. A stuck tab or a missing summary says little about the action itself, so the next cause
  // (with what the check sees in it) and the tab's last-seen site come before Claude's words.
  const seen = new Set(), out = [];
  const put = list => { for (const t of list) if (t && !seen.has(t)) { seen.add(t); out.push(t); } };
  // The site leads the card ("On h:") when the first sentence is about an action on a known page and does
  // not name its own site; when it names its own, other sites follow Claude's words ("Also on h."). When
  // the first sentence is about an action whose page is unknown or not a web site (a stuck tab, no
  // summary, a non-web page, an unreadable batch), no site is put in front of it: a stuck tab's recorded
  // site follows as "Last seen on h." (as before GEN-953) and others as "Sites in this request: …". A long
  // name shows its end (where the registered domain is); at most two names are listed; when a name is
  // shortened or left out, the full list ends the card.
  const firstHost = groups[0] && groups[0].host;
  const allSites = [...new Set(sites.concat(change ? hosts.filter(x => !x.startsWith('helper:')) : []))].filter(Boolean);
  const unnamed = allSites.filter(h => h !== firstHost);
  const short = h => h.length > 40 ? '…' + h.slice(-39) : h;
  const siteList = unnamed.slice(0, 2).map(short).join(', ') + (unnamed.length > 2 ? ' and ' + (unnamed.length - 2) + ' more' : '');
  const SITED = ['word', 'typed-write', 'helper-args', 'risky-script', 'script-helper', 'typed-enter', 'always-file_upload', 'always-upload_image', 'always-shortcuts_execute', 'always-gif-drop'];
  const sited = causes.length && SITED.includes(causes[0]);
  const stuckCause = g => String(g.cause || '').startsWith('deny-loop-');
  const stuck = causes.length && causes[0].startsWith('deny-loop-');
  const next = stuck ? groups.find(g => !stuckCause(g) && g.cause !== 'new-site') : null;
  // (a site the next cause's sentence names is not listed again as last seen or as a site in the request)
  const lastSeen = causes.includes('deny-loop-stale-tab') ? noteSites.filter(h => h !== firstHost && !(next && next.host === h)) : [];
  const first = (groups[0] || []).slice();
  if (first.length) seen.add(first[0]); // (so a later group repeating it, unprefixed, is not shown again)
  let also = '', seenLine = '';
  const listOf = a => a.slice(0, 2).map(short).join(', ') + (a.length > 2 ? ' and ' + (a.length - 2) + ' more' : '');
  const others = unnamed.filter(h => !lastSeen.includes(h));
  if (unnamed.length && first.length && sited) first[0] = 'On ' + siteList + ': ' + first[0];
  else if (unnamed.length && firstHost) also = 'Also on ' + siteList + '.';
  else if (unnamed.length) {
    seenLine = lastSeen.length ? 'Last seen on ' + listOf(lastSeen) + '.' : '';
    const rest = others.filter(h => !(next && next.host === h));
    also = rest.length ? 'Sites in this request: ' + listOf(rest) + '.' : '';
  }
  if (first.length) out.push(first[0]);
  put(first.slice(1));
  if (stuck) {
    for (const g of groups.slice(1)) if (stuckCause(g)) put(g);
    put(next || []);
  }
  put([seenLine]);
  put([claude]);
  put([also]);
  for (const g of groups.slice(1)) put(g);
  if (change) put(['Undo not guaranteed; allow only if expected.']);
  if (unnamed.length > 2 || unnamed.some(h => h.length > 40)) put(['All sites: ' + unnamed.join(', ') + '.']);
  return out.join(' ');
}

function reasonFor(res) {
  try { return plainReason(res); } catch (e) { return legacyReasonFor(res); }
}
