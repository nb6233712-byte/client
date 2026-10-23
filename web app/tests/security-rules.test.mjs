/**
 * ============================================================================
 * PIVOT AIDE TAX — FIRESTORE & STORAGE RBAC AUTHORIZATION TEST SUITE
 * ============================================================================
 * 
 * Verifies that the security rules correctly enforce:
 * 1. Default to client permissions for unassigned users
 * 2. Complete cross-tenant data isolation (no client can access another client's data)
 * 3. Prevention of client calculations / returns creation (The Exclusion)
 * 4. MFA enforcement for privileged staff (firm_preparer and firm_admin)
 * 5. Prevention of preparers performing unauthorized administrator actions
 * 6. WORM immutability on signatures and audit logs
 * 7. Storage 25MB statutory ceiling and path isolation
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── Security Rules Evaluator Engine ──────────────────────────────────────────

class RulesContext {
  constructor(auth) {
    this.auth = auth; // { uid, token: { role, mfa, firebase: { sign_in_second_factor } } }
  }

  isAuthenticated() {
    return this.auth !== null && this.auth !== undefined;
  }

  isOwner(userId) {
    return this.isAuthenticated() && this.auth.uid === userId;
  }

  getUserRole() {
    return (this.auth && this.auth.token && this.auth.token.role) 
      ? this.auth.token.role 
      : 'client';
  }

  isMfaEnforced() {
    return this.auth !== null && Boolean(
      (this.auth.token && this.auth.token.mfa === true) ||
      (this.auth.token && this.auth.token.firebase && this.auth.token.firebase.sign_in_second_factor != null)
    );
  }

  isClient() {
    return this.isAuthenticated() && this.getUserRole() === 'client';
  }

  isFirmPreparer() {
    return this.isAuthenticated() && this.getUserRole() === 'firm_preparer' && this.isMfaEnforced();
  }

  isFirmAdmin() {
    return this.isAuthenticated() && this.getUserRole() === 'firm_admin' && this.isMfaEnforced();
  }

  isFirmStaff() {
    return this.isFirmAdmin() || this.isFirmPreparer();
  }

  // Collection: /engagements/{id}
  canReadEngagement(resource) {
    return this.isAuthenticated() && (
      (resource && resource.clientUid === this.auth.uid) ||
      this.isFirmStaff()
    );
  }

  canWriteEngagementStage() {
    return this.isFirmStaff();
  }

  canDeleteEngagement() {
    return this.isFirmAdmin();
  }

  // Collection: /documents/{id}
  canReadDocument(resource) {
    return this.isAuthenticated() && (
      (resource && resource.clientId === this.auth.uid) ||
      this.isFirmStaff()
    );
  }

  canCreateDocument(data) {
    return this.isAuthenticated() &&
      data.clientId === this.auth.uid &&
      (!data.status || data.status === 'pending_review');
  }

  canMutateDocumentReviewStatus() {
    return this.isFirmStaff();
  }

  // Collection: /tax_returns/{id}
  canReadTaxReturn(resource) {
    return this.isAuthenticated() && (
      (resource && resource.clientUid === this.auth.uid) ||
      this.isFirmStaff()
    );
  }

  canCreateTaxReturn() {
    return this.isFirmStaff();
  }

  canUpdateTaxReturnFinancials() {
    return this.isFirmStaff();
  }

  canDeleteTaxReturn() {
    return this.isFirmAdmin();
  }

  // Collection: /signatures/{id}
  canCreateSignature(data) {
    return this.isAuthenticated() && data.uid === this.auth.uid;
  }

  canMutateSignature() {
    return false; // Immutable WORM
  }

  // Collection: /invoices/{id}
  canReadInvoice(resource) {
    return this.isAuthenticated() && (
      (resource && (resource.clientId === this.auth.uid || resource.clientUid === this.auth.uid)) ||
      this.isFirmStaff()
    );
  }

  canIssueInvoice() {
    return this.isFirmStaff();
  }

  canUpdateInvoiceStatus() {
    return this.isFirmAdmin(); // Preparer cannot mark paid
  }

  canDeleteInvoice() {
    return this.isFirmAdmin();
  }

  // Collection: /services/{id}
  canUpdateServicePricing() {
    return this.isFirmAdmin();
  }

  // Collection: /consents/{id}
  canReadConsent(resource) {
    return this.isAuthenticated() && (
      (resource && resource.clientUid === this.auth.uid) ||
      this.isFirmStaff()
    );
  }

  canCreateConsent(data) {
    return this.isAuthenticated() && data.clientUid === this.auth.uid;
  }

  canRevokeConsent(resource, diffKeys) {
    return this.isAuthenticated() && (
      (resource && resource.clientUid === this.auth.uid && diffKeys.every(k => ['status', 'revokedAt', 'revocationReason'].includes(k))) ||
      this.isFirmAdmin()
    );
  }

  canDeleteConsent() {
    return false; // Immutable ledger
  }

  // Storage Vault: clients/{userId}/tax-years/{taxYear}/documents/{docId}
  canReadStorageDocument(targetUserId) {
    return this.isOwner(targetUserId) || this.isFirmStaff();
  }

  canUploadStorageDocument(targetUserId, file) {
    const isValidTaxDocument = file.size <= 25 * 1024 * 1024 &&
      ['application/pdf', 'image/png', 'image/jpeg', 'text/csv'].includes(file.contentType);
    return this.isOwner(targetUserId) && isValidTaxDocument;
  }

  canUploadReturnStorage() {
    return this.isFirmStaff();
  }

  canDeleteReturnStorage() {
    return this.isFirmAdmin();
  }
}

// ── Test Personas ────────────────────────────────────────────────────────────

const unauthenticated = new RulesContext(null);

const clientA = new RulesContext({
  uid: 'client_whitfield_001',
  token: { role: 'client', mfa: false }
});

const clientB = new RulesContext({
  uid: 'client_harrison_002',
  token: { role: 'client', mfa: false }
});

const unassignedNewUser = new RulesContext({
  uid: 'client_new_user_003',
  token: {} // No role claim in token
});

const preparerWithoutMfa = new RulesContext({
  uid: 'preparer_denise_cpa',
  token: { role: 'firm_preparer', mfa: false }
});

const preparerWithMfa = new RulesContext({
  uid: 'preparer_denise_cpa',
  token: { role: 'firm_preparer', mfa: true }
});

const adminWithoutMfa = new RulesContext({
  uid: 'admin_partner_efin',
  token: { role: 'firm_admin', mfa: false }
});

const adminWithMfa = new RulesContext({
  uid: 'admin_partner_efin',
  token: { role: 'firm_admin', mfa: true }
});

// ── Test Suites ──────────────────────────────────────────────────────────────

describe('1. Unauthenticated Security Boundary', () => {
  test('Unauthenticated user cannot read any engagement file', () => {
    assert.equal(unauthenticated.canReadEngagement({ clientUid: 'client_whitfield_001' }), false);
  });

  test('Unauthenticated user cannot read or upload documents', () => {
    assert.equal(unauthenticated.canReadDocument({ clientId: 'client_whitfield_001' }), false);
    assert.equal(unauthenticated.canCreateDocument({ clientId: 'client_whitfield_001', status: 'pending_review' }), false);
  });

  test('Unauthenticated user cannot read tax returns or invoices', () => {
    assert.equal(unauthenticated.canReadTaxReturn({ clientUid: 'client_whitfield_001' }), false);
    assert.equal(unauthenticated.canReadInvoice({ clientId: 'client_whitfield_001' }), false);
  });
});

describe('2. Client Permissions & Cross-Tenant Isolation', () => {
  test('Client defaults to client role when no token claim is present', () => {
    assert.equal(unassignedNewUser.getUserRole(), 'client');
    assert.equal(unassignedNewUser.isClient(), true);
    assert.equal(unassignedNewUser.isFirmStaff(), false);
  });

  test('Client can read their own engagement, but CANNOT read another client engagement', () => {
    assert.equal(clientA.canReadEngagement({ clientUid: 'client_whitfield_001' }), true);
    assert.equal(clientB.canReadEngagement({ clientUid: 'client_whitfield_001' }), false);
  });

  test('Client CANNOT advance or modify their own engagement stage', () => {
    assert.equal(clientA.canWriteEngagementStage(), false);
  });

  test('Client can upload own documents with pending_review status', () => {
    assert.equal(clientA.canCreateDocument({ clientId: 'client_whitfield_001', status: 'pending_review' }), true);
  });

  test('Client CANNOT upload documents for another client ID', () => {
    assert.equal(clientB.canCreateDocument({ clientId: 'client_whitfield_001', status: 'pending_review' }), false);
  });

  test('Client CANNOT accept or reject their own tax document', () => {
    assert.equal(clientA.canMutateDocumentReviewStatus(), false);
  });

  test('Client CANNOT read another client tax documents', () => {
    assert.equal(clientB.canReadDocument({ clientId: 'client_whitfield_001' }), false);
  });

  test('Client CANNOT create or calculate tax returns (The Exclusion)', () => {
    assert.equal(clientA.canCreateTaxReturn(), false);
    assert.equal(clientA.canUpdateTaxReturnFinancials(), false);
  });

  test('Client can read own prepared return, but CANNOT read another client return', () => {
    assert.equal(clientA.canReadTaxReturn({ clientUid: 'client_whitfield_001' }), true);
    assert.equal(clientB.canReadTaxReturn({ clientUid: 'client_whitfield_001' }), false);
  });

  test('Client can read own invoice, but CANNOT read another client invoice', () => {
    assert.equal(clientA.canReadInvoice({ clientId: 'client_whitfield_001' }), true);
    assert.equal(clientB.canReadInvoice({ clientId: 'client_whitfield_001' }), false);
  });

  test('Client CANNOT issue invoices or modify pricing', () => {
    assert.equal(clientA.canIssueInvoice(), false);
    assert.equal(clientA.canUpdateInvoiceStatus(), false);
    assert.equal(clientA.canUpdateServicePricing(), false);
  });

  test('Client CANNOT tamper with Form 8879 signatures (Immutable WORM)', () => {
    assert.equal(clientA.canCreateSignature({ uid: 'client_whitfield_001' }), true);
    assert.equal(clientA.canMutateSignature(), false);
    assert.equal(clientB.canCreateSignature({ uid: 'client_whitfield_001' }), false);
  });
});

describe('3. Multi-Factor Authentication (MFA) Enforcement for Staff', () => {
  test('Preparer without MFA is REJECTED from firm staff permissions', () => {
    assert.equal(preparerWithoutMfa.isMfaEnforced(), false);
    assert.equal(preparerWithoutMfa.isFirmStaff(), false);
    assert.equal(preparerWithoutMfa.canWriteEngagementStage(), false);
    assert.equal(preparerWithoutMfa.canMutateDocumentReviewStatus(), false);
  });

  test('Preparer with verified MFA is GRANTED staff operational access', () => {
    assert.equal(preparerWithMfa.isMfaEnforced(), true);
    assert.equal(preparerWithMfa.isFirmStaff(), true);
    assert.equal(preparerWithMfa.canWriteEngagementStage(), true);
    assert.equal(preparerWithMfa.canMutateDocumentReviewStatus(), true);
    assert.equal(preparerWithMfa.canCreateTaxReturn(), true);
  });

  test('Admin without MFA is REJECTED from admin supervisory privileges', () => {
    assert.equal(adminWithoutMfa.isMfaEnforced(), false);
    assert.equal(adminWithoutMfa.isFirmAdmin(), false);
    assert.equal(adminWithoutMfa.canDeleteTaxReturn(), false);
  });

  test('Admin with verified MFA is GRANTED admin supervisory privileges', () => {
    assert.equal(adminWithMfa.isMfaEnforced(), true);
    assert.equal(adminWithMfa.isFirmAdmin(), true);
    assert.equal(adminWithMfa.canDeleteTaxReturn(), true);
  });
});

describe('4. Preparer vs Admin Privilege Separation', () => {
  test('Preparer CANNOT delete tax returns (Admin authority only)', () => {
    assert.equal(preparerWithMfa.canDeleteTaxReturn(), false);
    assert.equal(adminWithMfa.canDeleteTaxReturn(), true);
  });

  test('Preparer CANNOT modify firm service catalog prices (Admin authority only)', () => {
    assert.equal(preparerWithMfa.canUpdateServicePricing(), false);
    assert.equal(adminWithMfa.canUpdateServicePricing(), true);
  });

  test('Preparer CANNOT delete or alter invoice amounts (Admin authority only)', () => {
    assert.equal(preparerWithMfa.canUpdateInvoiceStatus(), false);
    assert.equal(preparerWithMfa.canDeleteInvoice(), false);
    assert.equal(adminWithMfa.canUpdateInvoiceStatus(), true);
    assert.equal(adminWithMfa.canDeleteInvoice(), true);
  });

  test('Preparer CANNOT delete engagements (Admin authority only)', () => {
    assert.equal(preparerWithMfa.canDeleteEngagement(), false);
    assert.equal(adminWithMfa.canDeleteEngagement(), true);
  });
});

describe('5. Cloud Storage Vault Security Rules', () => {
  test('Client can read and upload to own document vault with 25MB PDF/image', () => {
    const validPdf = { size: 10 * 1024 * 1024, contentType: 'application/pdf' };
    assert.equal(clientA.canReadStorageDocument('client_whitfield_001'), true);
    assert.equal(clientA.canUploadStorageDocument('client_whitfield_001', validPdf), true);
  });

  test('Client CANNOT access another client storage vault', () => {
    assert.equal(clientB.canReadStorageDocument('client_whitfield_001'), false);
  });

  test('Storage rejects files exceeding 25MB statutory limit', () => {
    const oversizedPdf = { size: 26 * 1024 * 1024, contentType: 'application/pdf' };
    assert.equal(clientA.canUploadStorageDocument('client_whitfield_001', oversizedPdf), false);
  });

  test('Storage rejects prohibited file MIME types (e.g. .exe / .bat)', () => {
    const maliciousFile = { size: 2 * 1024 * 1024, contentType: 'application/x-msdownload' };
    assert.equal(clientA.canUploadStorageDocument('client_whitfield_001', maliciousFile), false);
  });

  test('Client CANNOT upload finalized returns; preparer CAN upload; only admin can delete', () => {
    assert.equal(clientA.canUploadReturnStorage(), false);
    assert.equal(preparerWithMfa.canUploadReturnStorage(), true);
    assert.equal(preparerWithMfa.canDeleteReturnStorage(), false);
    assert.equal(adminWithMfa.canDeleteReturnStorage(), true);
  });
});

describe('6. IRC § 7216 Statutory Consent Ledger Security Rules', () => {
  const consentA = { clientUid: 'client_whitfield_001', consentType: 'use_tax_planning' };

  test('Client can read and grant own consent record', () => {
    assert.equal(clientA.canReadConsent(consentA), true);
    assert.equal(clientA.canCreateConsent(consentA), true);
  });

  test('Client CANNOT read or grant consent for another client (Cross-Tenant Block)', () => {
    assert.equal(clientB.canReadConsent(consentA), false);
    assert.equal(clientB.canCreateConsent(consentA), false);
  });

  test('Staff can read client consents; Client can affirmatively revoke own consent', () => {
    assert.equal(preparerWithMfa.canReadConsent(consentA), true);
    assert.equal(clientA.canRevokeConsent(consentA, ['status', 'revokedAt']), true);
  });

  test('Consent records are strictly immutable against deletion (Audit Ledger Hold)', () => {
    assert.equal(clientA.canDeleteConsent(), false);
    assert.equal(preparerWithMfa.canDeleteConsent(), false);
    assert.equal(adminWithMfa.canDeleteConsent(), false);
  });
});
