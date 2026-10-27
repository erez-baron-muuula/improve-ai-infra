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
