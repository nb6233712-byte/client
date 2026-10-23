import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const files = fs.readdirSync('tests').filter(f => f.endsWith('.test.mjs') || f.endsWith('.test.js'));
let passed = 0;
let failed = 0;
const failures = [];

for (const f of files) {
  const res = spawnSync('node', ['--test', 'tests/' + f], { encoding: 'utf8' });
  if (res.status === 0) {
    passed++;
    console.log('PASS:', f);
  } else {
    failed++;
    failures.push({ file: f, output: res.stderr || res.stdout });
    console.log('FAIL:', f);
  }
}

console.log('\n================================');
console.log(`TOTAL SUITES: ${files.length} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('================================');
if (failures.length > 0) {
  for (const fail of failures) {
    console.log(`\nFailure in ${fail.file}:\n${fail.output.slice(0, 500)}`);
  }
  process.exit(1);
}
