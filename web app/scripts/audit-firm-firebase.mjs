import fs from 'node:fs';
import path from 'node:path';

const firmDir = path.resolve('firm');
const files = fs.readdirSync(firmDir).filter(f => f.endsWith('.html'));

console.log('Auditing firm pages for Firebase integration:');
console.log('--------------------------------------------------------------------------------');

const results = [];

for (const file of files) {
  const fullPath = path.join(firmDir, file);
  const html = fs.readFileSync(fullPath, 'utf8');

  const hasFirebaseScript = html.includes('firebase.js');
  const hasLayoutScript = html.includes('layout.js');
  const hasAuthGuardScript = html.includes('auth-guard.js');
  const hasDataScript = html.includes('data.js');
  const referencesBridge = html.includes('FirebaseBridge');
  const hasRbacOrMfa = html.includes('isStaff') || html.includes('MFA') || html.includes('AuthGuard');
  const hasToastOrBadge = html.includes('FileRoomLayout');

  results.push({
    file,
    hasFirebaseScript,
    hasLayoutScript,
    hasAuthGuardScript,
    hasDataScript,
    referencesBridge,
    hasRbacOrMfa
  });

  console.log(
    file.padEnd(18),
    `firebase.js: ${hasFirebaseScript ? '✓' : '✗'}`.padEnd(16),
    `layout.js: ${hasLayoutScript ? '✓' : '✗'}`.padEnd(14),
    `authGuard: ${hasAuthGuardScript ? '✓' : '✗'}`.padEnd(13),
    `bridge: ${referencesBridge ? '✓' : '✗'}`.padEnd(11),
    `rbac/mfa: ${hasRbacOrMfa ? '✓' : '✗'}`
  );
}
