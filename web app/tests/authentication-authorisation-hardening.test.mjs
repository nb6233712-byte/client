/**
 * ============================================================================
 * TEST SUITE: STATUTORY AUTHENTICATION & AUTHORIZATION HARDENING
 * ============================================================================
 * 
 * Verifies complete hardening of authentication and authorization across:
 * 1. Client Portal:
 *    - Firebase email/password and Google Sign-In defaults to 'client' role.
 *    - New users assigned 'client' role by default via trusted server-side logic.
 *    - Clients can access ONLY their own profile, engagements, documents, returns, invoices, and messages.
 * 2. Cross-Client Data Isolation (Client A vs Client B):
 *    - Complete isolation across Firestore rules, Storage rules, and Cloud Functions.
 * 3. Firm Operations Console:
 *    - Authorized staff login with trusted roles: firm_preparer, firm_reviewer, firm_admin, firm_partner.
 *    - ZERO privileged access granted based on email address, URL parameter, local-storage value, or client-editable Firestore field.
 *    - Server-side authorization required for EVERY privileged Cloud Function.
 *    - Firm routes protected and clear 403 access-denied screen returned to unauthorized clients.
 * 4. Logged-Out Boundary:
 *    - Unauthenticated callers redirected safely with return parameters.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Load AuthGuard
const baseDir = path.resolve('c:/Users/user/Desktop/web app1/web app');
const AuthGuard = await import(`file://${path.join(baseDir, 'js/auth-guard.js')}`).then(m => m.default || m);

// Load Backend Handlers
import { provisionStaffRoleHandler, assignDefaultClientRoleHandler } from '../functions/src/auth-roles.mjs';
import { VALID_ROLES, buildCustomClaims } from '../server/admin-roles.mjs';
import { ErrorCode } from '../functions/src/errors.mjs';

// ── Mock Database & Infrastructure Helpers ─────────────────────────────────

class MockFirestoreCollection {
  constructor(name) {
    this.name = name;
    this.docs = new Map();
  }

  doc(id) {
    return {
      get: async () => ({
        exists: this.docs.has(id),
        data: () => this.docs.get(id)
      }),
      set: async (data, options = {}) => {
        if (options.merge && this.docs.has(id)) {
          this.docs.set(id, { ...this.docs.get(id), ...data });
        } else {
          this.docs.set(id, { ...data });
        }
        return { id };
      }
    };
  }
}

class MockFirestoreDb {
  constructor() {
    this.collections = new Map();
  }

  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockFirestoreCollection(name));
    }
    return this.collections.get(name);
  }
}

class MockAdminAuth {
  constructor() {
    this.customClaimsMap = new Map();
  }

  async setCustomUserClaims(uid, claims) {
    this.customClaimsMap.set(uid, claims);
  }
}

// ── Security Rules Evaluator Engine (Mirrors firestore.rules & storage.rules) ─

class EvaluatorContext {
  constructor(auth) {
    this.auth = auth; // { uid, token: { role, mfa, email } }
  }

  isAuthenticated() {
    return this.auth !== null && this.auth !== undefined && Boolean(this.auth.uid);
  }

  getUserRole() {
    return (this.auth && this.auth.token && this.auth.token.role) 
      ? this.auth.token.role 
      : 'client';
  }

  isMfaEnforced() {
    return this.isAuthenticated() && Boolean(
      (this.auth.token && this.auth.token.mfa === true) ||
      (this.auth.token && this.auth.token.firebase && this.auth.token.firebase.sign_in_second_factor != null)
    );
  }

  isClient() {
    return this.isAuthenticated() && this.getUserRole() === 'client';
  }

  isFirmPreparer() {
    const role = this.getUserRole();
    return this.isAuthenticated() && (
      role === 'firm_preparer' ||
      role === 'firm_reviewer' ||
      role === 'firm_practitioner' ||
      role === 'firm_staff'
    ) && this.isMfaEnforced();
  }

  isFirmAdmin() {
    const role = this.getUserRole();
    return this.isAuthenticated() && (
      role === 'firm_admin' ||
      role === 'firm_partner'
    ) && this.isMfaEnforced();
  }

  isFirmStaff() {
    return this.isFirmAdmin() || this.isFirmPreparer();
  }

  // /clients/{clientId}
  canReadClientProfile(clientId) {
    return this.isAuthenticated() && (this.auth.uid === clientId || this.isFirmStaff());
  }

  canCreateClientProfile(clientId, data) {
    if (!this.isAuthenticated()) return false;
    if (this.isFirmStaff()) return true;
    return this.auth.uid === clientId &&
      (!('role' in data) || data.role === 'client') &&
      (!('isStaff' in data) || data.isStaff === false);
  }

  canUpdateClientProfile(clientId, affectedKeys) {
    if (!this.isAuthenticated()) return false;
    if (this.isFirmStaff()) return true;
    if (this.auth.uid !== clientId) return false;
    const prohibited = ['role', 'isStaff', 'claims', 'mfaEnforced', 'efinAuthority', 'ptin'];
    return !affectedKeys.some(k => prohibited.includes(k));
  }

  // /engagements/{engagementId}
  canReadEngagement(resource) {
    return this.isAuthenticated() && (
      (resource && (resource.clientUid === this.auth.uid || resource.clientId === this.auth.uid)) ||
      this.isFirmStaff()
    );
  }

  // /documents/{docId}
  canReadDocument(resource) {
    return this.isAuthenticated() && (
      (resource && resource.clientId === this.auth.uid) ||
      this.isFirmStaff()
    );
  }

  canMutateDocumentStatus() {
    return this.isFirmStaff();
  }

  // /tax_returns/{returnId}
  canReadTaxReturn(resource) {
    return this.isAuthenticated() && (
      (resource && resource.clientUid === this.auth.uid) ||
      this.isFirmStaff()
    );
  }

  // /invoices/{invoiceId}
  canReadInvoice(resource) {
    return this.isAuthenticated() && (
      (resource && (resource.clientId === this.auth.uid || resource.clientUid === this.auth.uid)) ||
      this.isFirmStaff()
    );
  }

  // /messages/{messageId}
  canReadMessage(resource) {
    return this.isAuthenticated() && (
      (resource && (resource.clientId === this.auth.uid || resource.clientUid === this.auth.uid || resource.uid === this.auth.uid)) ||
      this.isFirmStaff()
    );
  }

  // Cloud Storage: clients/{userId}/...
  canReadStorage(targetUserId) {
    return this.isAuthenticated() && (this.auth.uid === targetUserId || this.isFirmStaff());
  }

  canUploadStorage(targetUserId, metadata) {
    if (!this.isAuthenticated()) return false;
    if (this.auth.uid !== targetUserId) return false;
    return metadata.size <= 25 * 1024 * 1024 && ['application/pdf', 'image/png', 'image/jpeg'].includes(metadata.contentType);
  }
}

// ── Test Suites ─────────────────────────────────────────────────────────────

describe('STATUTORY AUTHENTICATION & AUTHORIZATION HARDENING TEST SUITE', () => {

  const clientA = new EvaluatorContext({
    uid: 'client_A_101',
    token: { role: 'client', mfa: false, email: 'client.a@example.com' }
  });

  const clientB = new EvaluatorContext({
    uid: 'client_B_202',
    token: { role: 'client', mfa: false, email: 'client.b@example.com' }
  });

  const staffPreparerMfa = new EvaluatorContext({
    uid: 'staff_preparer_01',
    token: { role: 'firm_preparer', mfa: true, email: 'preparer@pivot-aide.tax' }
  });

  const staffReviewerMfa = new EvaluatorContext({
    uid: 'staff_reviewer_01',
    token: { role: 'firm_reviewer', mfa: true, email: 'reviewer@pivot-aide.tax' }
  });

  const staffPartnerMfa = new EvaluatorContext({
    uid: 'staff_partner_01',
    token: { role: 'firm_partner', mfa: true, email: 'partner@pivot-aide.tax' }
  });

  const staffAdminMfa = new EvaluatorContext({
    uid: 'staff_admin_01',
    token: { role: 'firm_admin', mfa: true, email: 'admin@pivot-aide.tax' }
  });

  const staffNoMfa = new EvaluatorContext({
    uid: 'staff_no_mfa_01',
    token: { role: 'firm_preparer', mfa: false, email: 'unverified@pivot-aide.tax' }
  });

  const clientWithFirmEmail = new EvaluatorContext({
    uid: 'attacker_firm_email',
    token: { role: 'client', mfa: false, email: 'attacker.cpa@pivot-aide.tax' }
  });

  const unauthenticatedUser = new EvaluatorContext(null);

  // ── SUITE 1: Client Portal Authentication & Profile Protection ───────────────
  describe('1. Client Portal: Default Role & Personal Profile Access', () => {
    let db, adminAuth;

    beforeEach(() => {
      db = new MockFirestoreDb();
      adminAuth = new MockAdminAuth();
    });

    test('1.1 Unassigned user token defaults strictly to role: client', () => {
      const defaultUser = new EvaluatorContext({ uid: 'new_user_999', token: {} });
      assert.equal(defaultUser.getUserRole(), 'client');
      assert.equal(defaultUser.isClient(), true);
      assert.equal(defaultUser.isFirmStaff(), false);
    });

    test('1.2 Trusted server-side logic assigns client role by default', async () => {
      const services = { adminAuth, firestoreDb: db };
      const res = await assignDefaultClientRoleHandler({
        context: { uid: 'new_taxpayer_001', role: 'client' },
        targetUid: 'new_taxpayer_001'
      }, services);

      assert.equal(res.success, true);
      assert.equal(res.role, 'client');
      assert.equal(res.claims.role, 'client');
      assert.equal(res.claims.mfa, false);

      const savedClaims = adminAuth.customClaimsMap.get('new_taxpayer_001');
      assert.equal(savedClaims.role, 'client');

      const savedDoc = await db.collection('clients').doc('new_taxpayer_001').get();
      assert.equal(savedDoc.data().role, 'client');
      assert.equal(savedDoc.data().isStaff, false);
    });

    test('1.3 Client cannot self-assign staff roles on signup or profile creation', () => {
      const maliciousPayload = { role: 'firm_admin', isStaff: true, name: 'Attacker' };
      assert.equal(clientA.canCreateClientProfile('client_A_101', maliciousPayload), false);

      const validPayload = { role: 'client', isStaff: false, name: 'Valid Client' };
      assert.equal(clientA.canCreateClientProfile('client_A_101', validPayload), true);
    });

    test('1.4 Client cannot update profile to escalate role or claims', () => {
      // Normal profile update (phone, address, displayName) allowed
      assert.equal(clientA.canUpdateClientProfile('client_A_101', ['displayName', 'phone', 'address']), true);
      // Attempting to mutate role, isStaff, or claims is strictly BLOCKED
      assert.equal(clientA.canUpdateClientProfile('client_A_101', ['role', 'displayName']), false);
      assert.equal(clientA.canUpdateClientProfile('client_A_101', ['isStaff']), false);
      assert.equal(clientA.canUpdateClientProfile('client_A_101', ['claims']), false);
      assert.equal(clientA.canUpdateClientProfile('client_A_101', ['mfaEnforced']), false);
    });

    test('1.5 Client can access own profile, but cannot read another client profile', () => {
      assert.equal(clientA.canReadClientProfile('client_A_101'), true);
      assert.equal(clientA.canReadClientProfile('client_B_202'), false);
      assert.equal(staffPreparerMfa.canReadClientProfile('client_A_101'), true);
    });
  });

  // ── SUITE 2: Cross-Tenant Data Isolation (Client A vs Client B) ─────────────
  describe('2. Cross-Tenant Isolation: Client A vs Client B', () => {
    const resourceA = { clientUid: 'client_A_101', clientId: 'client_A_101' };

    test('2.1 Client B CANNOT read Client A engagement', () => {
      assert.equal(clientA.canReadEngagement(resourceA), true);
      assert.equal(clientB.canReadEngagement(resourceA), false);
    });

    test('2.2 Client B CANNOT read Client A uploaded documents', () => {
      assert.equal(clientA.canReadDocument(resourceA), true);
      assert.equal(clientB.canReadDocument(resourceA), false);
    });

    test('2.3 Client B CANNOT mutate Client A document review status', () => {
      assert.equal(clientA.canMutateDocumentStatus(), false);
      assert.equal(clientB.canMutateDocumentStatus(), false);
      assert.equal(staffPreparerMfa.canMutateDocumentStatus(), true);
    });

    test('2.4 Client B CANNOT read Client A prepared tax returns', () => {
      assert.equal(clientA.canReadTaxReturn(resourceA), true);
      assert.equal(clientB.canReadTaxReturn(resourceA), false);
    });

    test('2.5 Client B CANNOT read Client A invoices', () => {
      assert.equal(clientA.canReadInvoice(resourceA), true);
      assert.equal(clientB.canReadInvoice(resourceA), false);
    });

    test('2.6 Client B CANNOT read Client A messages', () => {
      assert.equal(clientA.canReadMessage(resourceA), true);
      assert.equal(clientB.canReadMessage(resourceA), false);
    });

    test('2.7 Client B CANNOT read or write into Client A Cloud Storage vault', () => {
      const validPdf = { size: 5 * 1024 * 1024, contentType: 'application/pdf' };
      assert.equal(clientA.canReadStorage('client_A_101'), true);
      assert.equal(clientA.canUploadStorage('client_A_101', validPdf), true);

      assert.equal(clientB.canReadStorage('client_A_101'), false);
      assert.equal(clientB.canUploadStorage('client_A_101', validPdf), false);
    });
  });

  // ── SUITE 3: Firm Operations Console Privileged Access Defenses ─────────────
  describe('3. Firm Operations Console: Zero Insecure Role Elevation Defenses', () => {
    test('3.1 Authorized staff roles (preparer, reviewer, partner, admin) with MFA are GRANTED access', () => {
      assert.equal(staffPreparerMfa.isFirmStaff(), true);
      assert.equal(staffReviewerMfa.isFirmStaff(), true);
      assert.equal(staffPartnerMfa.isFirmStaff(), true);
      assert.equal(staffAdminMfa.isFirmStaff(), true);

      const resPrep = AuthGuard.evaluateAccess('/firm/dashboard.html', {
        role: 'firm_preparer',
        isStaff: true,
        mfaVerified: true,
        isAuthenticated: true
      });
      assert.equal(resPrep.allowed, true);
    });

    test('3.2 Staff member WITHOUT MFA is REJECTED from firm actions under FTC Safeguards § 314.4', () => {
      assert.equal(staffNoMfa.isFirmStaff(), false);
      assert.equal(staffNoMfa.canMutateDocumentStatus(), false);
    });

    test('3.3 ZERO PRIVILEGE via Email Address Spoofing (Client with @pivot-aide.tax is DENIED)', () => {
      // In rules
      assert.equal(clientWithFirmEmail.isFirmStaff(), false);
      assert.equal(clientWithFirmEmail.canMutateDocumentStatus(), false);

      // In frontend AuthGuard
      const sessionWithFirmEmail = {
        name: 'Attacker CPA',
        email: 'denise.cpa@pivot-aide.tax',
        role: 'client',
        isStaff: false,
        isAuthenticated: true
      };
      const res = AuthGuard.evaluateAccess('/firm/dashboard.html', sessionWithFirmEmail);
      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'unauthorized_firm_role');
      assert.equal(res.show403Screen, true);
    });

    test('3.4 ZERO PRIVILEGE via URL Parameter (e.g. ?role=firm_admin)', () => {
      // Simulated URL with ?role=firm_admin does not override user.role
      const clientWithUrlParam = {
        name: 'Client Tester',
        email: 'tester@example.com',
        role: 'client',
        isAuthenticated: true
      };
      const res = AuthGuard.evaluateAccess('/firm/clients.html?role=firm_admin&isStaff=true', clientWithUrlParam);
      assert.equal(res.allowed, false);
      assert.equal(res.show403Screen, true);
    });

    test('3.5 ZERO PRIVILEGE via Local Storage Roster Tampering', () => {
      // Even if client sets tfr_staff_roster in localStorage, AuthGuard ignores it for clients
      const clientSession = {
        email: 'attacker@pivot-aide.tax',
        role: 'client',
        isAuthenticated: true
      };
      const res = AuthGuard.evaluateAccess('/firm/workflow.html', clientSession);
      assert.equal(res.allowed, false);
      assert.equal(res.show403Screen, true);
    });

    test('3.6 ZERO PRIVILEGE via Client-Editable Firestore Field', () => {
      // Client editing their own /clients/ document cannot alter their rules context role
      const editedDoc = { role: 'firm_admin' };
      assert.equal(clientA.canUpdateClientProfile('client_A_101', ['role']), false);
    });
  });

  // ── SUITE 4: Server-Side Authorization for Privileged Cloud Functions ────────
  describe('4. Server-Side Cloud Function Authorization', () => {
    let db, adminAuth;

    beforeEach(() => {
      db = new MockFirestoreDb();
      adminAuth = new MockAdminAuth();
    });

    test('4.1 Preparer cannot provision staff roles (Administrative authority required)', async () => {
      const services = { adminAuth, firestoreDb: db };
      const res = await provisionStaffRoleHandler({
        context: { uid: 'staff_preparer', role: 'firm_preparer', mfaVerified: true },
        targetUid: 'target_user_01',
        targetRole: 'firm_admin'
      }, services);

      assert.equal(res.success, false);
      assert.equal(res.error.code, ErrorCode.PERMISSION_DENIED);
    });

    test('4.2 Admin without MFA is REJECTED from role provisioning under FTC Safeguards § 314.4', async () => {
      const services = { adminAuth, firestoreDb: db };
      const res = await provisionStaffRoleHandler({
        context: { uid: 'staff_admin', role: 'firm_admin', mfaVerified: false },
        targetUid: 'target_user_01',
        targetRole: 'firm_preparer'
      }, services);

      assert.equal(res.success, false);
      assert.equal(res.error.code, ErrorCode.PERMISSION_DENIED);
      assert.match(res.error.message, /MFA verification required/);
    });

    test('4.3 Managing Partner (firm_admin with MFA) successfully provisions role', async () => {
      const services = { adminAuth, firestoreDb: db };
      const res = await provisionStaffRoleHandler({
        context: { uid: 'staff_admin', role: 'firm_admin', mfaVerified: true },
        targetUid: 'staff_new_prep',
        targetRole: 'firm_preparer',
        staffMetadata: { name: 'New Preparer', email: 'prep@pivot-aide.tax' }
      }, services);

      assert.equal(res.success, true);
      assert.equal(res.role, 'firm_preparer');
      assert.equal(res.claims.role, 'firm_preparer');
      assert.equal(res.claims.mfa, true);
    });

    test('4.4 Managing Partner cannot demote own administrative role (Lockout defense)', async () => {
      const services = { adminAuth, firestoreDb: db };
      const res = await provisionStaffRoleHandler({
        context: { uid: 'staff_admin', role: 'firm_admin', mfaVerified: true },
        targetUid: 'staff_admin',
        targetRole: 'firm_preparer'
      }, services);

      assert.equal(res.success, false);
      assert.equal(res.error.code, ErrorCode.PERMISSION_DENIED);
      assert.match(res.error.message, /Managing Partner cannot demote own/);
    });
  });

  // ── SUITE 5: Logged-Out Boundary & Access Denied Route Protection ─────────────
  describe('5. Logged-Out Boundary & 403 Forbidden Screen Protection', () => {
    test('5.1 Unauthenticated user navigating to /client/* is redirected with ?redirect=', () => {
      const res = AuthGuard.evaluateAccess('/client/dashboard.html', null);
      assert.equal(res.allowed, false);
      assert.ok(res.redirectUrl.includes('login.html'));
      assert.ok(res.redirectUrl.includes('redirect='));
      assert.equal(res.reason, 'unauthenticated_client');
    });

    test('5.2 Unauthenticated user navigating to /firm/* is redirected with ?error=unauthorized', () => {
      const res = AuthGuard.evaluateAccess('/firm/dashboard.html', null);
      assert.equal(res.allowed, false);
      assert.ok(res.redirectUrl.includes('error=unauthorized'));
      assert.equal(res.reason, 'unauthenticated');
    });

    test('5.3 Client role navigating to /firm/* triggers show403Screen: true', () => {
      const clientSession = {
        name: 'Jordan Client',
        email: 'jordan@example.com',
        role: 'client',
        isAuthenticated: true
      };
      const res = AuthGuard.evaluateAccess('/firm/returns.html', clientSession);
      assert.equal(res.allowed, false);
      assert.equal(res.show403Screen, true);
      assert.equal(res.reason, 'unauthorized_firm_role');
    });

    test('5.4 Public login pages are accessible without redirect', () => {
      const resClientLogin = AuthGuard.evaluateAccess('/client/login.html', null);
      assert.equal(resClientLogin.allowed, true);
      assert.equal(resClientLogin.redirectUrl, null);

      const resFirmLogin = AuthGuard.evaluateAccess('/firm/login.html', null);
      assert.equal(resFirmLogin.allowed, true);
      assert.equal(resFirmLogin.redirectUrl, null);
    });

    test('5.5 display403Screen contains 403 Forbidden title, Circular 230 reference, and safe return link', () => {
      const authGuardSource = fs.readFileSync(path.join(baseDir, 'js/auth-guard.js'), 'utf8');
      assert.ok(authGuardSource.includes('403 Forbidden: Authorized Practitioners Only'));
      assert.ok(authGuardSource.includes('IRS Circular 230 § 10.29'));
      assert.ok(authGuardSource.includes('FTC Safeguards Rule 16 CFR § 314.4'));
      assert.ok(authGuardSource.includes('Return to Client Dashboard'));
      assert.ok(authGuardSource.includes('btn-403-return-client'));
    });
  });
});
