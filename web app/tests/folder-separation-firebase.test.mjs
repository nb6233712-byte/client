import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = 'c:/Users/user/Desktop/web app1';
const CLIENT_DIR = path.join(ROOT_DIR, 'client');
const FIRM_DIR = path.join(ROOT_DIR, 'firm');

test('Folder Separation & Firebase Configuration Verification', async (t) => {
  await t.test('1. Client Folder Structure and Standalone Files', () => {
    assert.ok(fs.existsSync(CLIENT_DIR), 'client directory must exist in workspace root');
    
    // Core entry points & configurations
    assert.ok(fs.existsSync(path.join(CLIENT_DIR, 'index.html')), 'client/index.html must exist');
    assert.ok(fs.existsSync(path.join(CLIENT_DIR, 'firebase.js')), 'client/firebase.js must exist');
    assert.ok(fs.existsSync(path.join(CLIENT_DIR, 'firebase.json')), 'client/firebase.json must exist');
    assert.ok(fs.existsSync(path.join(CLIENT_DIR, '.firebaserc')), 'client/.firebaserc must exist');
    assert.ok(fs.existsSync(path.join(CLIENT_DIR, 'firestore.rules')), 'client/firestore.rules must exist');
    assert.ok(fs.existsSync(path.join(CLIENT_DIR, 'storage.rules')), 'client/storage.rules must exist');

    // Subdirectories
    assert.ok(fs.existsSync(path.join(CLIENT_DIR, 'css')), 'client/css must exist');
    assert.ok(fs.existsSync(path.join(CLIENT_DIR, 'js')), 'client/js must exist');
    assert.ok(fs.existsSync(path.join(CLIENT_DIR, 'owl.png')), 'client/owl.png must exist');

    // Client Pages
    const expectedPages = [
      'dashboard.html',
      'login.html',
      'documents.html',
      'tax-return.html',
      'signatures.html',
      'messages.html',
      'billing.html',
      'services.html',
      'updates.html',
      'profile.html'
    ];
    for (const page of expectedPages) {
      assert.ok(fs.existsSync(path.join(CLIENT_DIR, page)), `client/${page} must exist`);
    }
  });

  await t.test('2. Firm Folder Structure and Standalone Files', () => {
    assert.ok(fs.existsSync(FIRM_DIR), 'firm directory must exist in workspace root');

    // Core entry points & configurations
    assert.ok(fs.existsSync(path.join(FIRM_DIR, 'index.html')), 'firm/index.html must exist');
    assert.ok(fs.existsSync(path.join(FIRM_DIR, 'firebase.js')), 'firm/firebase.js must exist');
    assert.ok(fs.existsSync(path.join(FIRM_DIR, 'firebase.json')), 'firm/firebase.json must exist');
    assert.ok(fs.existsSync(path.join(FIRM_DIR, '.firebaserc')), 'firm/.firebaserc must exist');
    assert.ok(fs.existsSync(path.join(FIRM_DIR, 'firestore.rules')), 'firm/firestore.rules must exist');
    assert.ok(fs.existsSync(path.join(FIRM_DIR, 'storage.rules')), 'firm/storage.rules must exist');

    // Subdirectories
    assert.ok(fs.existsSync(path.join(FIRM_DIR, 'css')), 'firm/css must exist');
    assert.ok(fs.existsSync(path.join(FIRM_DIR, 'js')), 'firm/js must exist');
    assert.ok(fs.existsSync(path.join(FIRM_DIR, 'owl.png')), 'firm/owl.png must exist');

    // Firm Pages
    const expectedPages = [
      'dashboard.html',
      'login.html',
      'clients.html',
      'documents.html',
      'signatures.html',
      'returns.html',
      'messages.html',
      'billing.html',
      'services.html',
      'staff.html',
      'tasks.html',
      'workflow.html',
      'audit-log.html',
      'exhibit-a.html',
      'exhibit-b.html'
    ];
    for (const page of expectedPages) {
      assert.ok(fs.existsSync(path.join(FIRM_DIR, page)), `firm/${page} must exist`);
    }
  });

  await t.test('3. Firebase Config Project ID & Independence in Both Folders', () => {
    // Client Firebase Config
    const clientRc = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, '.firebaserc'), 'utf8'));
    assert.equal(clientRc.projects.default, 'uk-client-d90d5', 'client/.firebaserc must point to uk-client-d90d5');

    const clientFbJson = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'firebase.json'), 'utf8'));
    assert.equal(clientFbJson.hosting.public, '.', 'client/firebase.json must configure public hosting to current folder');
    assert.equal(clientFbJson.firestore.rules, 'firestore.rules', 'client/firebase.json must reference firestore.rules');
    assert.equal(clientFbJson.storage.rules, 'storage.rules', 'client/firebase.json must reference storage.rules');

    // Firm Firebase Config
    const firmRc = JSON.parse(fs.readFileSync(path.join(FIRM_DIR, '.firebaserc'), 'utf8'));
    assert.equal(firmRc.projects.default, 'uk-client-d90d5', 'firm/.firebaserc must point to uk-client-d90d5');

    const firmFbJson = JSON.parse(fs.readFileSync(path.join(FIRM_DIR, 'firebase.json'), 'utf8'));
    assert.equal(firmFbJson.hosting.public, '.', 'firm/firebase.json must configure public hosting to current folder');
    assert.equal(firmFbJson.firestore.rules, 'firestore.rules', 'firm/firebase.json must reference firestore.rules');
    assert.equal(firmFbJson.storage.rules, 'storage.rules', 'firm/firebase.json must reference storage.rules');

    // JS Firebase modules contain project uk-client-d90d5
    const clientJsFirebase = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'firebase.js'), 'utf8');
    assert.ok(clientJsFirebase.includes('uk-client-d90d5'), 'client/js/firebase.js must contain uk-client-d90d5');

    const firmJsFirebase = fs.readFileSync(path.join(FIRM_DIR, 'js', 'firebase.js'), 'utf8');
    assert.ok(firmJsFirebase.includes('uk-client-d90d5'), 'firm/js/firebase.js must contain uk-client-d90d5');
  });

  await t.test('4. Self-Contained Asset and Script Paths in Client Folder', () => {
    const htmlFiles = fs.readdirSync(CLIENT_DIR).filter(f => f.endsWith('.html'));
    for (const f of htmlFiles) {
      const content = fs.readFileSync(path.join(CLIENT_DIR, f), 'utf8');
      assert.ok(!content.includes('href="../css/'), `${f} in client must not reference ../css/`);
      assert.ok(!content.includes('src="../js/'), `${f} in client must not reference ../js/`);
      assert.ok(content.includes('css/variables.css') || content.includes('css/app.css') || f === 'index.html', `${f} must link to local css/`);
    }
  });

  await t.test('5. Self-Contained Asset and Script Paths in Firm Folder', () => {
    const htmlFiles = fs.readdirSync(FIRM_DIR).filter(f => f.endsWith('.html'));
    for (const f of htmlFiles) {
      const content = fs.readFileSync(path.join(FIRM_DIR, f), 'utf8');
      assert.ok(!content.includes('href="../css/'), `${f} in firm must not reference ../css/`);
      assert.ok(!content.includes('src="../js/'), `${f} in firm must not reference ../js/`);
      assert.ok(content.includes('css/variables.css') || content.includes('css/app.css') || f === 'index.html', `${f} must link to local css/`);
    }
  });
});
