// Read-only: print a character slice of a big saved tool result, or find a phrase's offset.
// Usage: node slice.js <file> <start> <len>   |   node slice.js <file> find "<phrase>"
const fs = require('fs');
const [f, a, b] = process.argv.slice(2);
const s = fs.readFileSync(f, 'utf8');
if (a === 'find') {
  let i = s.indexOf(b), out = [];
  while (i !== -1 && out.length < 20) { out.push(i); i = s.indexOf(b, i + 1); }
  console.log('length', s.length, 'hits', JSON.stringify(out));
} else {
  console.log(s.slice(Number(a), Number(a) + Number(b)).replace(/\\n/g, '\n'));
}
