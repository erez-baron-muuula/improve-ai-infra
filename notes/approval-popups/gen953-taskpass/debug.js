// Scratch debugging for tests.js failures (not part of the build).
'use strict';
const path = require('path');
const G = require(path.join(__dirname, 'wc', 'browser-site-gate.js'));
const SITE = 'app.snowflake.com', T = 'mcp__claude-in-chrome__';
const s = G.newState(); s.approved[SITE] = true; s.tabs['7'] = { url: 'https://' + SITE + '/x', stale: false, taint: false };
const tk = { pid: 'p', status: 'active', site: SITE, task: 't', steps: ['runs the rule update'], texts: [], start: Date.now(), used: 0 };
const click = sum => ({ action: 'left_click', coordinate: [1, 1], tabId: 7, action_summary: sum });
const r = G.decide(s, T + 'browser_batch', { actions: [{ name: 'computer', input: click('Runs the rule update') }, { name: 'computer', input: click('Clicks Delete for the alert') }] }, { task: tk });
console.log(JSON.stringify({ d: r.decision, w: r.taskWaived, causes: r.causes, claims: r.claims, denies: r.denyCause }));
const r2 = G.decide(s, T + 'computer', click('Runs the rule update'), { task: tk });
console.log(JSON.stringify({ d: r2.decision, w: r2.taskWaived, causes: r2.causes }));
