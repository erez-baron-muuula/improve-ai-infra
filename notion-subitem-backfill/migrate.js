const { Client } = require('@notionhq/client');
const https = require('https');

// Disable SSL verification (corporate proxy with self-signed cert)
https.globalAgent.options.rejectUnauthorized = false;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const DRY_RUN = false;
const DATABASE_ID = 'fe198002661848d7ae0456f8cee479f3';
const PROP_SOURCE = 'Parent item';
const PROP_TARGET = 'Parent item 1';
const PAGE_SIZE = 100;
const WRITE_DELAY_MS = 340; // ~3 req/s

// ─── CLIENT ───────────────────────────────────────────────────────────────────
const token = process.env.NOTION_TOKEN;
if (!token) {
  console.error('ERROR: NOTION_TOKEN env var is not set.');
  process.exit(1);
}
const notion = new Client({ auth: token });

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── SCHEMA VERIFICATION ──────────────────────────────────────────────────────
async function verifySchema() {
  console.log('Verifying schema via first page sample...');
  // The view DB (fe198002...) doesn't expose properties directly; its source DB
  // is inaccessible to this integration. So we verify by sampling a single page.
  const sample = await notion.databases.query({
    database_id: DATABASE_ID,
    page_size: 1,
  });

  if (!sample.results || sample.results.length === 0) {
    console.error('ERROR: Database is empty — cannot verify schema from page sample.');
    process.exit(1);
  }

  const sampleProps = sample.results[0].properties;
  const relationProps = Object.entries(sampleProps)
    .filter(([, v]) => v.type === 'relation')
    .map(([name]) => name);

  const hasSource = Object.prototype.hasOwnProperty.call(sampleProps, PROP_SOURCE) && sampleProps[PROP_SOURCE].type === 'relation';
  const hasTarget = Object.prototype.hasOwnProperty.call(sampleProps, PROP_TARGET) && sampleProps[PROP_TARGET].type === 'relation';

  if (!hasSource || !hasTarget) {
    console.error('\nERROR: Required relation properties not found on page sample.');
    console.error(`  Expected: "${PROP_SOURCE}" and "${PROP_TARGET}"`);
    console.error(`  Relation properties found on sample page:`);
    relationProps.forEach(n => console.error(`    - "${n}"`));
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

// ─── LABEL HELPER ─────────────────────────────────────────────────────────────
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
  return prop.relation.map(r => r.id);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Notion Parent Item Backfill ===`);
  console.log(`DRY_RUN: ${DRY_RUN}`);
  console.log(`Database: ${DATABASE_ID}\n`);

  await verifySchema();
  console.log('');

  const pages = await fetchAllPages();
  console.log('');

  let toUpdate = [];
  let skippedAlreadySet = 0;
  let skippedNoSource = 0;

  for (const page of pages) {
    const sourceIds = relationIds(page, PROP_SOURCE);
    const targetIds = relationIds(page, PROP_TARGET);

    if (sourceIds.length === 0) {
      skippedNoSource++;
      continue;
    }
    if (targetIds.length > 0) {
      skippedAlreadySet++;
      continue;
    }
    toUpdate.push({ page, sourceIds });
  }

  console.log(`Pages to update:        ${toUpdate.length}`);
  console.log(`Skipped (target set):   ${skippedAlreadySet}`);
  console.log(`Skipped (no source):    ${skippedNoSource}`);
  console.log('');

  if (toUpdate.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (DRY_RUN) {
    console.log('--- DRY RUN: intended changes ---');
    for (const { page, sourceIds } of toUpdate) {
      const label = pageLabel(page);
      console.log(`  "${label}": would set "${PROP_TARGET}" -> [${sourceIds.join(', ')}]`);
    }
    console.log(`\nTotal: ${toUpdate.length} page(s) would be updated.`);
  } else {
    console.log('--- WRITING CHANGES ---');
    let successCount = 0;
    for (const { page, sourceIds } of toUpdate) {
      const label = pageLabel(page);
      try {
        await notion.pages.update({
          page_id: page.id,
          properties: {
            [PROP_TARGET]: {
              relation: sourceIds.map(id => ({ id })),
            },
          },
        });
        console.log(`  ✓ "${label}": set "${PROP_TARGET}" -> [${sourceIds.join(', ')}]`);
        successCount++;
      } catch (err) {
        console.error(`  ✗ "${label}" (${page.id}): ${err.message}`);
      }
      await sleep(WRITE_DELAY_MS);
    }
    console.log(`\nDone. ${successCount}/${toUpdate.length} page(s) updated.`);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
