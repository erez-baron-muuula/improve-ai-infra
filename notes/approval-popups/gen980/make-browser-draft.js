// GEN-980: build the proposed browser notes (refs/browser.md) as a draft in this folder, for the size check.
// Reads the live notes and writes browser.md.draft here; changes nothing live.
'use strict';
const fs = require('fs'), path = require('path');
const live = path.join(process.env.USERPROFILE, '.claude', 'hooks', 'refs', 'browser.md');
let s = fs.readFileSync(live, 'utf8');
const BT = String.fromCharCode(96);
const oldSnow = "Insert with `document.querySelector('iframe').contentDocument.querySelector('.cm-content').cmView.view.dispatch({changes:{from:0,to:v.state.doc.length,insert:sql}})` (`v` = that view), then click Run.";
const newSnow = "Fill it with exactly this script, changing only the SQL: " + BT + BT + " (v => { v.dispatch({changes: {from: 0, to: v.state.doc.length, insert: " + BT + "<SQL>" + BT + "}}); v.focus(); return v.state.doc.length; })(document.querySelector('iframe').contentDocument.querySelector('.cm-content').cmView.view) " + BT + BT + ". Then press Ctrl+Enter, with nothing else on that site in between (screenshots and read-only scripts are fine), within 10 minutes: the browser check then runs a read-only query without a pop-up. One fill, one run; no backslashes, comments or $$ in the SQL.";
const oldTab = "Read data through the page's session API: `fetch('/vizportal/api/web/v1/<method>')`, POST `{method, params}`, header `X-XSRF-TOKEN` from the `XSRF-TOKEN` cookie. Methods: getExtractTasks, getWorkbooks, getDataConnections, getDataAlerts, getDatasources, getSessionInfo.";
const newTab = "Read data through the page's session API, declaring in each script `const x = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/)||[])[1]||''); const vz = async (m, p) => (await fetch('/vizportal/api/web/v1/' + m, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-XSRF-TOKEN': x}, body: JSON.stringify({method: m, params: p})})).json();` and calling it only as `vz('<method>', {...})` with the name in quotes (not stored on `window`, not in a variable): the browser check then lets it through. Methods: getExtractTasks, getWorkbooks, getDataConnections, getDataAlerts, getDatasources, getSessionInfo, getSchedules, getFlows, getUsers, getBackgroundJobs.";
// node make-browser-draft.js        -> Tableau change only (the recommended option)
// node make-browser-draft.js --both -> Tableau and Snowsight changes
const pairs = process.argv.includes('--both') ? [[oldSnow, newSnow], [oldTab, newTab]] : [[oldTab, newTab]];
for (const [a, b] of pairs) {
  if (s.split(a).length !== 2) throw new Error('anchor not found once: ' + a.slice(0, 50));
  s = s.split(a).join(b);
}
fs.writeFileSync(path.join(__dirname, process.argv.includes('--both') ? 'browser.md.both.draft' : 'browser.md.draft'), s);
console.log('draft chars', [...s].length);
