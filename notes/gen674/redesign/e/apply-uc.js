// GEN-674 option E install step 1: write the vetted working copy of the Drive update script over the live
// one (it is not vetting-locked until the new auto-approve.js lands), then re-read and compare bytes.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SRC = path.join(__dirname, 'wc', 'update-config.ps1');
const DST = 'G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1';
const want = fs.readFileSync(SRC);
fs.writeFileSync(DST, want);
const got = fs.readFileSync(DST);
const h = b => crypto.createHash('sha256').update(b).digest('hex');
console.log(Buffer.compare(got, want) === 0 ? 'INSTALLED byte-identical' : 'MISMATCH', got.length, h(got));
process.exit(Buffer.compare(got, want) === 0 ? 0 : 1);
