// Build insert_content payloads for the two weekly-check tickets' bodies.
const fs = require('fs');
const dir = 'C:/Users/Erez/AppData/Local/Temp/claude/C--Users-Erez-AI-Projects-Improve-AI-Infra/190ca257-572e-4b57-b1a6-9fb97c36c582/scratchpad/';
for (const [md, pageId, out] of [['weekly-body-ch.md', '4056e495-d07c-8171-bf6e-d66e6fa85b9f', 'weekly-body-ch.json'],
  ['weekly-body-rr.md', '4056e495-d07c-8188-8fc4-c2be70dbf395', 'weekly-body-rr.json']]) {
  const body = fs.readFileSync(dir + md, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  if (body.includes('\\')) { console.log('BACKSLASH in ' + md); process.exit(1); }
  fs.writeFileSync(dir + out, JSON.stringify({ page_id: pageId, command: 'insert_content', position: { type: 'end' }, content: body }, null, 2));
  console.log(out, body.length);
}
