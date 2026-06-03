const { Client } = require('@notionhq/client');
const https = require('https');

// Disable SSL verification (corporate proxy with self-signed cert)
https.globalAgent.options.rejectUnauthorized = false;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// READ-ONLY audit. Never writes. Compares the two parent relations for full
// equality so we can certify it is safe to drop PROP_SOURCE during consolidation.
const DATABASE_ID = 'fe198002661848d7ae0456f8cee479f3';
const PROP_SOURCE = 'Parent item';      // relation we plan to RETIRE
const PROP_TARGET = 'Parent item 1';    // native relation we plan to KEEP
const PAGE_SIZE = 100;

// ─── CLIENT ───────────────────────────────────────────────────────────────────
const token = process.env.NOTION_TOKEN;
if (!token) {
  console.error('ERROR: NOTION_TOKEN env var is not set.');
  process.exit(1);
}
const notion = new Client({ auth: token });

// ─── SCHEMA VERIFICATION ──────────────────────────────────────────────────────
async function verifySchema() {
  console.log('Verifying schema via first page sample...');
  const sample = await notion.databases.query({ database_id: DATABASE_ID, page_size: 1 });
  if (!sample.results || sample.results.length === 0) {
    console.error('ERROR: Database is empty — cannot verify schema from page sample.');
    process.exit(1);
  }
  const p = sample.results[0].properties;
  const hasSource = Object.prototype.hasOwnProperty.call(p, PROP_SOURCE) && p[PROP_SOURCE].type === 'relation';
  const hasTarget = Object.prototype.hasOwnProperty.call(p, PROP_TARGET) && p[PROP_TARGET].type === 'relation';
  if (!hasSource || !hasTarget) {
    console.error('\nERROR: Required relation properties not found on page sample.');
    console.error(`  Expected: "${PROP_SOURCE}" and "${PROP_TARGET}"`);
    console.error('  Relation properties found:');
    Object.entries(p).filter(([, v]) => v.type === 'relation').forEach(([n]) => console.error(`    - "${n}"`));
    process.exit(1);
  }
  console.log(`  ✓ "${PROP_SOURCE}" found`);
  console.log(`  ✓ "${PROP_TARGET}" found`);
}

// ─── PAGINATION ───────────────────────────────────────────────────────────────
async function fetchAllPages() {
  const pages = [];
  let cursor = undefined;
  do {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      page_size: PAGE_SIZE,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
    process.stdout.write(`\r  Fetched ${pages.length} pages...`);
  } while (cursor);
  console.log(`\r  Fetched ${pages.length} pages total.`);
  return pages;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function pageLabel(page) {
  const titleProp = Object.values(page.properties).find(p => p.type === 'title');
  if (titleProp && titleProp.title && titleProp.title.length > 0) {
    return titleProp.title.map(t => t.plain_text).join('') || page.id;
  }
  return page.id;
}

function relationIds(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'relation') return [];
  return prop.relation.map(r => r.id).sort();
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]); // both pre-sorted
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Notion Parent-Relation Equality Audit (READ-ONLY) ===`);
  console.log(`Database: ${DATABASE_ID}`);
  console.log(`Comparing: "${PROP_SOURCE}" (to retire)  vs  "${PROP_TARGET}" (to keep)\n`);

  await verifySchema();
  console.log('');

  const pages = await fetchAllPages();
  console.log('');

  // id -> label map so parent IDs print as readable names (all items share this DB)
  const idToLabel = {};
  for (const page of pages) idToLabel[page.id] = pageLabel(page);
  const show = ids => ids.length ? ids.map(id => idToLabel[id] || id).join(', ') : '(empty)';

  const missing = [];   // source set, target empty  -> needs backfill (migrate.js fixes)
  const mismatch = [];  // both set, differ          -> SILENT DIVERGENCE, manual fix
  const extra = [];     // source empty, target set  -> safe for drop, but report
  let equalCount = 0;

  for (const page of pages) {
    const s = relationIds(page, PROP_SOURCE);
    const t = relationIds(page, PROP_TARGET);
    if (sameSet(s, t)) { equalCount++; continue; }
    const rec = { label: pageLabel(page), id: page.id, s, t };
    if (s.length && t.length === 0) missing.push(rec);
    else if (s.length && t.length) mismatch.push(rec);
    else extra.push(rec);
  }

  console.log('─── RESULTS ───────────────────────────────────────────────');
  console.log(`Total pages:                         ${pages.length}`);
  console.log(`Equal (source == target):            ${equalCount}`);
  console.log(`MISSING  (source set, target empty): ${missing.length}`);
  console.log(`MISMATCH (both set, DIFFERENT):      ${mismatch.length}`);
  console.log(`EXTRA    (source empty, target set): ${extra.length}\n`);

  if (missing.length) {
    console.log('--- MISSING (run migrate.js to backfill these) ---');
    missing.forEach(r => console.log(`  "${r.label}" (${r.id})\n      ${PROP_SOURCE}=[${show(r.s)}]  ${PROP_TARGET}=[empty]`));
    console.log('');
  }
  if (mismatch.length) {
    console.log('--- MISMATCH (DANGER: dropping source would silently re-parent these) ---');
    mismatch.forEach(r => console.log(`  "${r.label}" (${r.id})\n      ${PROP_SOURCE}=[${show(r.s)}]  ${PROP_TARGET}=[${show(r.t)}]`));
    console.log('');
  }
  if (extra.length) {
    console.log('--- EXTRA (target has a parent source lacks; safe to drop source, but note) ---');
    extra.forEach(r => console.log(`  "${r.label}" (${r.id})\n      ${PROP_SOURCE}=[empty]  ${PROP_TARGET}=[${show(r.t)}]`));
    console.log('');
  }

  const safe = missing.length === 0 && mismatch.length === 0;
  console.log('─── VERDICT ───────────────────────────────────────────────');
  if (safe) {
    console.log(`SAFE TO DROP "${PROP_SOURCE}": every row's "${PROP_TARGET}" already covers it.`);
    if (extra.length) console.log(`(${extra.length} EXTRA rows noted above — these only exist in the surviving relation, which is fine.)`);
  } else {
    console.log(`NOT SAFE TO DROP "${PROP_SOURCE}" yet:`);
    if (missing.length) console.log(`  • ${missing.length} MISSING — run migrate.js to backfill.`);
    if (mismatch.length) console.log(`  • ${mismatch.length} MISMATCH — reconcile by hand first (decide the correct parent).`);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
