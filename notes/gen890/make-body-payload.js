// Build the insert_content payload for the new YAML ticket's body from the reviewed body file.
const fs = require('fs');
const dir = 'C:/Users/Erez/AppData/Local/Temp/claude/C--Users-Erez-AI-Projects-Improve-AI-Infra/190ca257-572e-4b57-b1a6-9fb97c36c582/scratchpad/';
const body = fs.readFileSync(dir + 'wrap-yaml-body.md', 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
const p = { page_id: '4056e495-d07c-8183-a714-dd591cd4fc89', command: 'insert_content', position: { type: 'end' }, content: body };
fs.writeFileSync(dir + 'wrap-yaml-bodypayload.json', JSON.stringify(p, null, 2));
console.log('chars', body.length);
