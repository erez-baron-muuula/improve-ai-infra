// GEN-889: rewords the "missing or empty ... flag this to Erez" notice in the inject-*-refs.js
// working copies as a statement of fact. Exact-text replace; reports the count per file.
const fs = require('fs');
const path = require('path');
const WC = path.join(__dirname, 'wc', 'hooks');
const RE = /'(inject-[a-z-]+-refs): (refs\/[a-z.-]+) missing or empty — ([A-Za-z -]+?) reference notes were NOT loaded; flag this to Erez\.'/g;
for (const name of ['inject-notion-refs.js', 'inject-jira-refs.js', 'inject-shell-refs.js', 'inject-deployment-refs.js']) {
  const f = path.join(WC, name);
  const before = fs.readFileSync(f, 'utf8');
  let n = 0;
  const after = before.replace(RE, (m, hook, file, what) => {
    n++;
    return "'" + hook + ': ' + file + ' is missing or empty, so the ' + what + " reference notes are not in this session; Erez has not been told.'";
  });
  fs.writeFileSync(f, after, 'utf8');
  console.log(name, 'replaced', n);
}
