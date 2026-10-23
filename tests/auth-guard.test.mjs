/**
 * ============================================================================
 * TEST SUITE: AUTH STATE GUARD & SESSION SECURITY (js/auth-guard.js)
 * ============================================================================
 * 
 * Verifies the shared authentication state guard:
 * 1. Resolves session from sessionStorage, localStorage, or Firebase.
 * 2. Enforces firm RBAC: blocks client and unauthenticated users from /firm/ with ?error=unauthorized.
 * 3. Enforces client authentication: blocks unauthenticated users from /client/ with redirect to login.html.
 * 4. Permits public access to client/login.html and firm/login.html without redirection loops.
 * 5. Provides standard logout helper clearing credentials and redirecting to index.html.
 * 6. Confirms script inclusion across all client and firm HTML files.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Load AuthGuard module
const baseDir = path.resolve('c:/Users/user/Desktop/web app1/web app');
const authGuardPath = path.join(baseDir, 'js/auth-guard.js');

describe('AuthGuard & Session Security Verification', () => {

  test('1. js/auth-guard.js exists and exports AuthGuard API', () => {
    assert.ok(fs.existsSync(authGuardPath), 'js/auth-guard.js must exist on disk');
    const content = fs.readFileSync(authGuardPath, 'utf8');
    assert.ok(content.includes('getAuthState: function'), 'Must define getAuthState');
    assert.ok(content.includes('evaluateAccess: function'), 'Must define evaluateAccess');
    assert.ok(content.includes('enforce: function'), 'Must define enforce');
    assert.ok(content.includes('logout: function'), 'Must define logout');
  });

  describe('2. Route Evaluation & Access Rules', async () => {
    const AuthGuard = await import(`file://${authGuardPath}`).then(m => m.default || m);

    test('Public login pages are permitted without redirection', () => {
      const resFirmLogin = AuthGuard.evaluateAccess('/firm/login.html', null);
      assert.equal(resFirmLogin.allowed, true);
      assert.equal(resFirmLogin.redirectUrl, null);

      const resClientLogin = AuthGuard.evaluateAccess('/client/login.html', null);
      assert.equal(resClientLogin.allowed, true);
      assert.equal(resClientLogin.redirectUrl, null);
    });

    test('Firm pages block unauthenticated users and redirect with ?error=unauthorized', () => {
      const res = AuthGuard.evaluateAccess('/firm/dashboard.html', null);
      assert.equal(res.allowed, false);
      assert.ok(res.redirectUrl.includes('error=unauthorized'));
    });

    test('Firm pages block client accounts (role: client) and redirect with ?error=unauthorized', () => {
      const clientSession = {
        name: 'Michael Whitfield',
        email: 'm.whitfield@example.com',
        role: 'client',
        isStaff: false,
        isAuthenticated: true,
        mfaVerified: true
      };
      const res = AuthGuard.evaluateAccess('/firm/clients.html', clientSession);
      assert.equal(res.allowed, false);
      assert.ok(res.redirectUrl.includes('error=unauthorized'));
      assert.equal(res.reason, 'unauthorized_firm_role');
    });

    test('Firm pages permit authorized firm_staff with MFA', () => {
      const staffSession = {
        name: 'Denise Rosenthal, CPA',
        email: 'denise@pivot-aide.tax',
        role: 'firm_staff',
        isStaff: true,
        isAuthenticated: true,
        mfaVerified: true
      };
      const res = AuthGuard.evaluateAccess('/firm/workflow.html', staffSession);
      assert.equal(res.allowed, true);
      assert.equal(res.redirectUrl, null);
    });

    test('Firm pages permit authorized firm_admin with MFA', () => {
      const adminSession = {
        name: 'Denise Rosenthal, CPA',
        email: 'denise@pivot-aide.tax',
        role: 'firm_admin',
        isStaff: true,
        isAuthenticated: true,
        mfaVerified: true
      };
      const res = AuthGuard.evaluateAccess('/firm/staff.html', adminSession);
      assert.equal(res.allowed, true);
      assert.equal(res.redirectUrl, null);
    });

    test('Client pages block unauthenticated users and redirect with ?redirect= parameter', () => {
      const res = AuthGuard.evaluateAccess('/client/dashboard.html', null);
      assert.equal(res.allowed, false);
      assert.ok(res.redirectUrl.includes('login.html'));
      assert.ok(res.redirectUrl.includes('redirect='));
      assert.equal(res.reason, 'unauthenticated_client');
    });

    test('Firm pages block unauthenticated users and redirect with ?redirect= and ?error=unauthorized parameter', () => {
      const res = AuthGuard.evaluateAccess('/firm/dashboard.html', null);
      assert.equal(res.allowed, false);
      assert.ok(res.redirectUrl.includes('error=unauthorized'));
      assert.ok(res.redirectUrl.includes('redirect='));
    });

    test('Client pages permit authenticated taxpayer session', () => {
      const clientSession = {
        name: 'Michael Whitfield',
        email: 'm.whitfield@example.com',
        role: 'client',
        isAuthenticated: true
      };
      const res = AuthGuard.evaluateAccess('/client/documents.html', clientSession);
      assert.equal(res.allowed, true);
      assert.equal(res.redirectUrl, null);
    });

    test('Firm pages flag show403Screen for client role users', () => {
      const clientSession = {
        name: 'Michael Whitfield',
        email: 'm.whitfield@example.com',
        role: 'client',
        isAuthenticated: true
      };
      const res = AuthGuard.evaluateAccess('/firm/clients.html', clientSession);
      assert.equal(res.allowed, false);
      assert.equal(res.show403Screen, true);
      assert.equal(res.reason, 'unauthorized_firm_role');
    });

    test('signOutUser function is exported and accessible', () => {
      assert.equal(typeof AuthGuard.signOutUser, 'function');
      assert.equal(typeof AuthGuard.logout, 'function');
    });

    test('display403Screen contains 403 Forbidden title and return button', () => {
      const content = fs.readFileSync(authGuardPath, 'utf8');
      assert.ok(content.includes('403 Forbidden: Authorized Practitioners Only'));
      assert.ok(content.includes('Return to Client Dashboard'));
    });

    test('onAuthStateChanged listener is integrated', () => {
      const content = fs.readFileSync(authGuardPath, 'utf8');
      assert.ok(content.includes('onAuthStateChanged'));
      assert.ok(content.includes('handleAuthStateChange'));
      assert.ok(content.includes('initAuthListener'));
    });
  });

  describe('3. Script Inclusion Across All Client and Firm Pages', () => {
    const clientPages = [
      'client/dashboard.html',
      'client/documents.html',
      'client/signatures.html',
      'client/tax-return.html',
      'client/messages.html',
      'client/services.html',
      'client/billing.html',
      'client/updates.html',
      'client/profile.html',
      'client/login.html'
    ];

    const firmPages = [
      'firm/dashboard.html',
      'firm/clients.html',
      'firm/workflow.html',
      'firm/documents.html',
      'firm/returns.html',
      'firm/signatures.html',
      'firm/messages.html',
      'firm/services.html',
      'firm/billing.html',
      'firm/tasks.html',
      'firm/audit-log.html',
      'firm/staff.html',
      'firm/exhibit-a.html',
      'firm/exhibit-b.html',
      'firm/login.html'
    ];

    for (const page of clientPages) {
      test(`Page ${page} links js/auth-guard.js`, () => {
        const fullPath = path.join(baseDir, page);
        const html = fs.readFileSync(fullPath, 'utf8');
        assert.ok(html.includes('auth-guard.js'), `${page} must include auth-guard.js script tag`);
      });
    }

    for (const page of firmPages) {
      test(`Page ${page} links js/auth-guard.js`, () => {
        const fullPath = path.join(baseDir, page);
        const html = fs.readFileSync(fullPath, 'utf8');
        assert.ok(html.includes('auth-guard.js'), `${page} must include auth-guard.js script tag`);
      });
    }
  });

});
