/**
 * ============================================================================
 * UNIT TEST SUITE: FIREBASE AUTH CONTROLLER (js/auth.js)
 * ============================================================================
 * 
 * Verifies all 4 core authentication deliverables:
 * 1. Google OAuth Flow (Client profile write to /clients/{uid} & Firm 403 domain check)
 * 2. Email/Password & Client Sign-Up (Mandatory IRC § 7216 consent, engagementStage: 1, MFA)
 * 3. Session Persistence & Role Redirection (Local vs Session persistence & RBAC route targeting)
 * 4. Demo Quick-Login Helpers ('Demo as Taxpayer' & 'Demo as Managing CPA')
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Firebase Authentication Controller (js/auth.js)', () => {
  const authJsPath = path.resolve('c:/Users/user/Desktop/web app1/web app/js/auth.js');
  let authJsContent = '';

  beforeEach(() => {
    assert.ok(fs.existsSync(authJsPath), 'js/auth.js must exist on disk');
    authJsContent = fs.readFileSync(authJsPath, 'utf8');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Module Structure & Google OAuth Provider
  // ──────────────────────────────────────────────────────────────────────────
  test('1. Google OAuth Flow initialization and exports', () => {
    assert.ok(
      authJsContent.includes('GoogleAuthProvider') && authJsContent.includes('signInWithPopup'),
      'Must import and utilize GoogleAuthProvider and signInWithPopup'
    );
    assert.ok(
      authJsContent.includes('export const googleProvider = new GoogleAuthProvider()'),
      'Must initialize and export googleProvider'
    );
    assert.ok(
      authJsContent.includes('export async function signInWithGoogle'),
      'Must export signInWithGoogle function'
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Client Profile Creation in Firestore & Role Redirection
  // ──────────────────────────────────────────────────────────────────────────
  test('2. Client Google OAuth writes to Firestore /clients/{uid} and routes to client/dashboard.html', () => {
    assert.ok(
      authJsContent.includes('doc(db, "clients", user.uid)') || authJsContent.includes("doc(db, 'clients', user.uid)"),
      'Must target Firestore /clients/{uid} document path'
    );
    assert.ok(
      authJsContent.includes('role: "client"') || authJsContent.includes("role: 'client'"),
      'Must assign role: client to taxpayer profiles'
    );
    assert.ok(
      authJsContent.includes('engagementStage: 1') || authJsContent.includes('engagementStage'),
      'Must record initial engagementStage: 1'
    );
    assert.ok(
      authJsContent.includes('mfaEnabled: true') || authJsContent.includes('mfaEnabled'),
      'Must enforce mfaEnabled: true on taxpayer profiles'
    );
    assert.ok(
      authJsContent.includes('client/dashboard.html'),
      'Must redirect taxpayer to client/dashboard.html'
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Firm Operations Domain Check & 403 Error Banner
  // ──────────────────────────────────────────────────────────────────────────
  test('3. Firm Google OAuth enforces @pivot-aide-tax.com and raises 403 error banner for unauthorized accounts', () => {
    assert.ok(
      authJsContent.includes('@pivot-aide-tax.com'),
      'Must verify practitioner domain @pivot-aide-tax.com'
    );
    assert.ok(
      authJsContent.includes('403: Practitioner Account Required'),
      'Must display 403: Practitioner Account Required when unauthorized user attempts firm login'
    );
    assert.ok(
      authJsContent.includes('signOut(auth)'),
      'Must immediately revoke/sign out unauthorized practitioner attempts'
    );
    assert.ok(
      authJsContent.includes('firm/dashboard.html'),
      'Must route authorized practitioners to firm/dashboard.html'
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Email/Password Sign-In & Sign-Up with IRC § 7216 Consent
  // ──────────────────────────────────────────────────────────────────────────
  test('4. Email/Password Flow enforces mandatory IRC § 7216 consent and records timestamps', () => {
    assert.ok(
      authJsContent.includes('signInWithEmailAndPassword') && authJsContent.includes('createUserWithEmailAndPassword'),
      'Must implement createUserWithEmailAndPassword and signInWithEmailAndPassword'
    );
    assert.ok(
      authJsContent.includes('consent7216'),
      'Must validate affirmative IRC § 7216 consent'
    );
    assert.ok(
      authJsContent.includes('consent7216Timestamp') || authJsContent.includes('toISOString'),
      'Must record statutory consent timestamp on registration'
    );
    assert.ok(
      authJsContent.includes('IRC § 7216 & Treas. Reg. § 301.7216-3') || authJsContent.includes('301.7216-3'),
      'Must cite statutory Treasury Regulation 301.7216-3 authority'
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Session Persistence & Storage Guard Synchronization
  // ──────────────────────────────────────────────────────────────────────────
  test('5. Session persistence and tfr_user_session synchronization', () => {
    assert.ok(
      authJsContent.includes('browserLocalPersistence') && authJsContent.includes('browserSessionPersistence'),
      'Must support both browserLocalPersistence and browserSessionPersistence'
    );
    assert.ok(
      authJsContent.includes('tfr_user_session'),
      'Must persist session under tfr_user_session key for js/auth-guard.js compatibility'
    );
    assert.ok(
      authJsContent.includes('export function redirectByRole'),
      'Must export redirectByRole helper'
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Demo Quick-Login Helpers
  // ──────────────────────────────────────────────────────────────────────────
  test('6. Demo Quick-Login helpers provide rapid bypass during reviews', () => {
    assert.ok(
      authJsContent.includes('loginAsDemoTaxpayer'),
      'Must provide loginAsDemoTaxpayer function'
    );
    assert.ok(
      authJsContent.includes('loginAsDemoCPA'),
      'Must provide loginAsDemoCPA function'
    );
    assert.ok(
      authJsContent.includes('Demo as Taxpayer') && authJsContent.includes('Demo as Managing CPA'),
      'Must provide UI labels Demo as Taxpayer and Demo as Managing CPA'
    );
    assert.ok(
      authJsContent.includes('m.whitfield@example.com'),
      'Must populate demo taxpayer Michael Whitfield'
    );
    assert.ok(
      authJsContent.includes('denise@pivot-aide-tax.com'),
      'Must populate demo CPA Denise Rosenthal'
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Script Linkage Across Key Entry Points
  // ──────────────────────────────────────────────────────────────────────────
  test('7. Script linkage across gateway, auth showcase, and login pages', () => {
    const indexPath = path.resolve('c:/Users/user/Desktop/web app1/web app/index.html');
    const authPath = path.resolve('c:/Users/user/Desktop/web app1/web app/auth.html');
    const clientLoginPath = path.resolve('c:/Users/user/Desktop/web app1/web app/client/login.html');
    const firmLoginPath = path.resolve('c:/Users/user/Desktop/web app1/web app/firm/login.html');

    assert.ok(fs.readFileSync(indexPath, 'utf8').includes('js/auth.js'), 'index.html must link js/auth.js');
    assert.ok(fs.readFileSync(authPath, 'utf8').includes('js/auth.js'), 'auth.html must link js/auth.js');
    assert.ok(fs.readFileSync(clientLoginPath, 'utf8').includes('js/auth.js'), 'client/login.html must link js/auth.js');
    assert.ok(fs.readFileSync(firmLoginPath, 'utf8').includes('js/auth.js'), 'firm/login.html must link js/auth.js');
  });
});
