// Builds the proposed ~/.claude/hooks/refs/browser.md (live text + a "Task approval" section before
// "Signing in to websites") into ./refs-browser.md, for the size check and the install.
'use strict';
const fs = require('fs'), path = require('path');
const live = fs.readFileSync(path.join(process.env.USERPROFILE, '.claude', 'hooks', 'refs', 'browser.md'), 'utf8');
const section = [
  '**Task approval (GEN-953).** Before a multi-step change job on one site, end your message text (no HTML) with lines `Browser task: <job>`, `Site: <host>`, `Step: <exact action_summary>` (1-20), `Text: "<exact typed text>"` (0-10, no backslash, backtick or asterisk), say what still asks, and ask "Ready?". The first pop-up after his reply offers it; then for 10 min / 30 actions that turn a click, key, typing or fill whose summary is a Step word for word (and typed text a Text) needs no pop-up. Still asks: steps worded as a send, delete, payment or access change ("approved" counts), typed deleting/access SQL, pastes, letter keys, uploads, scripts, first visits, follow-ups, mail/Slack/Notion/Jira/banks. A hook note says if it was refused: tell Erez.',
  ''
].join('\n');
const anchor = '**Signing in to websites.**';
if (!live.includes(anchor)) throw new Error('anchor not found');
const out = live.replace(anchor, section + '\n' + anchor);
fs.writeFileSync(path.join(__dirname, 'refs-browser.md'), out);
console.log('live', [...live].length, 'proposed', [...out].length);
