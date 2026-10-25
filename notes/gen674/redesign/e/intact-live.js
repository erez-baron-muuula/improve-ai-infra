// GEN-674 option E: run the INSTALLED session-start hook's rules-file checks against the real files, read-only
// (the hook itself is not run, so its backup-notice cursor is untouched). Expect both lines null.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const src = fs.readFileSync('C:/Users/Erez/.claude/hooks/sessionstart-backup-surfacer.js', 'utf8');
const grab = re => { const m = re.exec(src); if (!m) throw new Error('not found: ' + re); return m[0]; };
const fns = new Function('fs', 'path', 'require', [
  grab(/^const RULES_LINE_CAP = .*$/m), 'let pendingRulesAck = null;', grab(/^const stripBomText = .*$/m),
  grab(/^function clean\([\s\S]*?^}/m), grab(/^function rulesFileSizeLine\([\s\S]*?^}/m),
  grab(/^const SIZE_STOP_DRIVE_DIR = .*$/m), grab(/^const SIZE_ASK_RULES = .*$/m), grab(/^const DRIVE_READ_TIMEOUT_MS = .*$/m),
  grab(/^function readDriveFiles\([\s\S]*?^}/m), grab(/^function sizeStopIntactLine\([\s\S]*?^}/m),
  'return { rulesFileSizeLine, sizeStopIntactLine };'].join('\n'))(fs, path, require);
const cl = path.join(os.homedir(), '.claude');
console.log('size line:', fns.rulesFileSizeLine(cl, Date.now()));
console.log('stop-intact line:', fns.sizeStopIntactLine(cl, Date.now()));
