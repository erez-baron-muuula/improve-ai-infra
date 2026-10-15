// Fixture tests for release-review-tool.js: copies the tool into a temp dir and exercises
// pending / record-run / readout / collect --out against fixture state.
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const SRC = 'C:/Users/Erez/AI Projects/Improve AI Infra/notes/release-review/release-review-tool.js';
const D = fs.mkdtempSync(path.join(os.tmpdir(), 'rrtest-'));
fs.copyFileSync(SRC, path.join(D, 'tool.js'));
const run = (...a) => { const r = cp.spawnSync(process.execPath, [path.join(D, 'tool.js'), ...a], { encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; };
let fails = 0;
const t = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(info))); if (!cond) fails++; };
const W = (f, o) => fs.writeFileSync(path.join(D, f), typeof o === 'string' ? o : JSON.stringify(o));
const ago = d => new Date(Date.now() - d * 86400000).toISOString();

W('state.json', { lastReviewedVersion: '2.1.300', installedUtc: ago(1) });
let r = run('readout'); t('readout quiet after fresh install', r.code === 0 && r.out === '', r);
W('state.json', { lastReviewedVersion: '2.1.300', installedUtc: ago(12) });
r = run('readout'); t('readout alerts after 12 days with no run', /no run in 12 days/.test(r.out), r);

W('findings.jsonl', [{ key: 'a', target: 'GEN-1', status: 'pending' }, { key: 'b', target: 'new', status: 'pending' }, { key: 'b', target: 'new', status: 'filed' }].map(JSON.stringify).join('\n') + '\n');
r = run('pending'); t('pending lists only unresolved', r.code === 0 && JSON.parse(r.out).length === 1 && JSON.parse(r.out)[0].key === 'a', r);
W('run.json', { run: 'x', mode: 'live', from: '2.1.300', through: '2.1.301', outcome: 'ok' });
r = run('record-run', path.join(D, 'run.json')); t('record-run refuses ok with pending', r.code === 1 && /pending/.test(r.err), r);
t('state not advanced on refusal', JSON.parse(fs.readFileSync(path.join(D, 'state.json'))).lastReviewedVersion === '2.1.300', {});
W('run.json', { run: 'x', mode: 'live', from: '2.1.300', through: '2.1.301', outcome: 'failed', note: 'crash' });
r = run('record-run', path.join(D, 'run.json')); t('record-run accepts failed with pending', r.code === 0 && JSON.parse(r.out).lastReviewedVersion === '2.1.300', r);
r = run('readout'); t('readout reports unfinished run', /did not finish \(crash\)/.test(r.out), r);

fs.appendFileSync(path.join(D, 'findings.jsonl'), JSON.stringify({ key: 'a', target: 'GEN-1', status: 'appended' }) + '\n');
W('run.json', { run: 'y', mode: 'live', from: '2.1.300', through: '2.1.301', outcome: 'ok', filed: ['GEN-9'], appended: ['GEN-1'], waiting: 2, digestTicket: 'GEN-900' });
r = run('record-run', path.join(D, 'run.json')); t('record-run ok advances state', r.code === 0 && JSON.parse(r.out).lastReviewedVersion === '2.1.301' && JSON.parse(r.out).digestTicket === 'GEN-900', r);
r = run('readout'); t('readout summary line', /1 new ticket\(s\), 1 note\(s\) added, 0 moved Blocked → To Do, 2 waiting for your yes\/no as of that run in GEN-900, 0 not filed/.test(r.out), r);
W('run.json', { run: 'z', mode: 'live', from: '2.1.301', through: '2.1.300', outcome: 'ok' });
r = run('record-run', path.join(D, 'run.json')); t('record-run refuses moving backwards', r.code !== 0, r);
W('run.json', { run: 'z', mode: 'live', from: '2.1.301', through: '2.1.301', outcome: 'ok', digestTicket: { id: 'GEN-1' } });
r = run('record-run', path.join(D, 'run.json')); t('record-run refuses object digestTicket', r.code !== 0, r);
W('run.json', { run: 'd', mode: 'dry', from: '2.1.294', through: '2.1.300', outcome: 'ok' });
r = run('record-run', path.join(D, 'run.json')); t('dry run never advances', r.code === 0 && JSON.parse(r.out).lastReviewedVersion === '2.1.301', r);
W('unfiled-202610150000.md', 'x');
r = run('readout'); t('readout names unfiled file', /1 not filed/.test(r.out), r);

const out = path.join(D, 'c.json');
r = run('collect', '--after', '2.1.296', '--out', out);
const s = r.code === 0 ? JSON.parse(r.out) : null;
t('collect --out writes file and summary', s && s.versions.join() === '2.1.299,2.1.300' && JSON.parse(fs.readFileSync(out)).versions.length === 2 && s.lines > 0, r);
console.log(fails ? fails + ' FAILED' : 'ALL PASS', D);
process.exit(fails ? 1 : 0);
