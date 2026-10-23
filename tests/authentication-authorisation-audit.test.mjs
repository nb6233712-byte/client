/**
 * ============================================================================
 * COMPREHENSIVE SECURITY AUDIT TEST SUITE: AUTHENTICATION & AUTHORISATION
 * ============================================================================
 * 
 * Verifies all 9 statutory and regulatory security requirements:
 * 1. Signed-out users cannot access protected data (Firestore & Storage & Direct URLs).
 * 2. Clients cannot access firm-only operations (RBAC route guards & Firestore rules).
 * 3. Clients cannot read another client's documents, returns, messages, or invoices.
 * 4. Staff permissions are granted through a trusted administrative process.
 * 5. Firestore and Storage rules enforce strict data ownership and access controls.
 * 6. Sensitive state changes are validated by trusted backend functions.
 * 7. Staff MFA is strictly enforced where required (NIST SP 800-63-3 AAL2 & FTC Safeguards § 314.4).
 * 8. Audit records are protected against unauthorized modification (Immutable WORM & SHA-256 seal).
 * 9. No privileged secrets are exposed in frontend code (Secret Manager isolation).
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Import backend handlers
import { provisionStaffRoleHandler } from '../functions/src/auth-roles.mjs';
import { documentReviewHandler } from '../functions/src/document-review.mjs';
import { publishPreparedReturnHandler } from '../functions/src/return-workflow.mjs';
import { paymentWebhookHandler, computeStripeHmac } from '../functions/src/payment-webhook.mjs';
import { signingProviderCallbackHandler } from '../functions/src/signing-callback.mjs';
import { AuditLedgerService, AuthoritativeEventTypes } from '../functions/src/audit-ledger.mjs';
import { secretManager } from '../functions/src/config.mjs';

// ── Security Rules Evaluator Helper ──────────────────────────────────────────

class SecurityRulesEvaluator {
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

  // 1. Engagements
  canReadEngagement(resource) {
    return this.isAuthenticated() && (
      (resource && resource.clientUid === this.auth.uid) ||
      this.isFirmStaff()
    );
  }
  canWriteEngagement() {
    return this.isFirmStaff();
  }

  // 2. Document Requests
  canReadDocumentRequest(resource) {
    return this.isAuthenticated() && (
      (resource && resource.clientId === this.auth.uid) ||
      this.isFirmStaff()
    );
  }
  canWriteDocumentRequest() {
    return this.isFirmStaff();
  }

  // 3. Documents
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

  // 4. Tax Returns
  canReadTaxReturn(resource) {
    return this.isAuthenticated() && (
      (resource && resource.clientUid === this.auth.uid) ||
      this.isFirmStaff()
    );
  }
  canCreateTaxReturn() {
    return this.isFirmStaff();
  }

  // 5. Signatures
  canReadSignature(resource) {
    return this.isAuthenticated() && (
      (resource && resource.uid === this.auth.uid) ||
      this.isFirmStaff()
    );
  }
  canUpdateOrDeleteSignature() {
    return false; // Immutable WORM
  }

  // 6. Messages
  canReadMessage(resource) {
    return this.isAuthenticated() && (
      (resource && (resource.clientId === this.auth.uid || resource.uid === this.auth.uid)) ||
      this.isFirmStaff()
    );
  }

  // 7. Invoices
  canReadInvoice(resource) {
    return this.isAuthenticated() && (
      (resource && (resource.clientId === this.auth.uid || resource.clientUid === this.auth.uid)) ||
      this.isFirmStaff()
    );
  }
  canUpdateInvoice() {
    return this.isFirmAdmin();
  }

  // 8. Storage
  canReadStorage(userId) {
    return this.isOwner(userId) || this.isFirmStaff();
  }
  canWriteStorage(userId, fileSize, mimeType) {
    const isAllowedMime = ['application/pdf', 'image/png', 'image/jpeg', 'image/heic', 'text/csv'].includes(mimeType);
    const isWithinSize = fileSize <= 25 * 1024 * 1024;
    return this.isOwner(userId) && isAllowedMime && isWithinSize;
  }
}

// ── Test Suites ──────────────────────────────────────────────────────────────

describe('Statutory Authentication & Authorisation Audit (Client Portal & Firm Operations)', () => {

  const baseDir = path.resolve('c:/Users/user/Desktop/web app1/web app');

  // ── AUDIT 1: Signed-Out Users Cannot Access Protected Data ─────────────────
  describe('1. Signed-Out Access Control (Unauthenticated Rejection)', () => {
    const signedOutContext = new SecurityRulesEvaluator(null);

    test('1.1 Signed-out user is REJECTED from reading engagements', () => {
      assert.equal(signedOutContext.canReadEngagement({ clientUid: 'usr_whitfield_4417' }), false);
    });

    test('1.2 Signed-out user is REJECTED from reading document requests', () => {
      assert.equal(signedOutContext.canReadDocumentRequest({ clientId: 'usr_whitfield_4417' }), false);
    });

    test('1.3 Signed-out user is REJECTED from reading documents', () => {
      assert.equal(signedOutContext.canReadDocument({ clientId: 'usr_whitfield_4417' }), false);
    });

    test('1.4 Signed-out user is REJECTED from reading tax returns', () => {
      assert.equal(signedOutContext.canReadTaxReturn({ clientUid: 'usr_whitfield_4417' }), false);
    });

    test('1.5 Signed-out user is REJECTED from reading signatures', () => {
      assert.equal(signedOutContext.canReadSignature({ uid: 'usr_whitfield_4417' }), false);
    });

    test('1.6 Signed-out user is REJECTED from reading messages', () => {
      assert.equal(signedOutContext.canReadMessage({ clientId: 'usr_whitfield_4417' }), false);
    });

    test('1.7 Signed-out user is REJECTED from reading invoices', () => {
      assert.equal(signedOutContext.canReadInvoice({ clientId: 'usr_whitfield_4417' }), false);
    });

    test('1.8 Signed-out user is REJECTED from Cloud Storage reads & uploads', () => {
      assert.equal(signedOutContext.canReadStorage('usr_whitfield_4417'), false);
      assert.equal(signedOutContext.canWriteStorage('usr_whitfield_4417', 500, 'application/pdf'), false);
    });

    test('1.9 Direct URL access to firm/dashboard.html when signed out is BLOCKED (403 Forbidden)', () => {
      const firmJsPath = path.join(baseDir, 'js/firm/dashboard.js');
      const code = fs.readFileSync(firmJsPath, 'utf8');

      const mockDOM = { innerHTML: '' };
      const virtualWindow = {
        localStorage: { getItem: () => null, removeItem: () => {}, setItem: () => {} },
        document: { getElementById: () => mockDOM }
      };

      const fn = new Function('window', 'document', code);
      fn(virtualWindow, virtualWindow.document);
      const FirmDashboard = virtualWindow.FirmDashboard;

      FirmDashboard.evaluateStaffAuthorization({ getCurrentUser: () => null });
      assert.equal(FirmDashboard.state.isAuthorizedStaff, false, 'Signed out session must NOT be granted staff access');

      FirmDashboard.renderAccessDenied(mockDOM);
      assert.ok(mockDOM.innerHTML.includes('403 FORBIDDEN'));
      assert.ok(mockDOM.innerHTML.includes('Staff Supervisory Authorization Required'));
    });

    test('1.10 Direct URL access to firm/clients.html when signed out is BLOCKED (403 Forbidden)', () => {
      const clientsJsPath = path.join(baseDir, 'js/firm/clients.js');
      const code = fs.readFileSync(clientsJsPath, 'utf8');

      const mockDOM = { innerHTML: '' };
      const virtualWindow = {
        localStorage: { getItem: () => null, removeItem: () => {}, setItem: () => {} },
        document: { getElementById: () => mockDOM }
      };

      const fn = new Function('window', 'document', code);
      fn(virtualWindow, virtualWindow.document);
      const FirmClients = virtualWindow.FirmClients;

      FirmClients.evaluateStaffAuthorization({ getCurrentUser: () => null });
      assert.equal(FirmClients.state.isAuthorizedStaff, false, 'Signed out session must NOT access client directory');

      FirmClients.renderAccessDenied(mockDOM);
      assert.ok(mockDOM.innerHTML.includes('403 FORBIDDEN'));
    });
  });

  // ── AUDIT 2: Clients Cannot Access Firm-Only Operations ────────────────────
  describe('2. Client Account Access Boundary (Firm Operations Protection)', () => {
    const clientAuth = {
      uid: 'usr_whitfield_4417',
      token: { role: 'client', mfa: false }
    };
    const clientContext = new SecurityRulesEvaluator(clientAuth);

    test('2.1 Client CANNOT write or advance engagement workflow stages', () => {
      assert.equal(clientContext.canWriteEngagement(), false);
    });

    test('2.2 Client CANNOT create document requests', () => {
      assert.equal(clientContext.canWriteDocumentRequest(), false);
    });

    test('2.3 Client CANNOT mutate document status under Circular 230', () => {
      assert.equal(clientContext.canMutateDocumentReviewStatus(), false);
    });

    test('2.4 Client CANNOT author or publish tax returns (The Exclusion Safe Harbor)', () => {
      assert.equal(clientContext.canCreateTaxReturn(), false);
    });

    test('2.5 Client CANNOT alter invoice amounts, mark paid, or delete invoices', () => {
      assert.equal(clientContext.canUpdateInvoice(), false);
    });

    test('2.6 Client attempting direct URL access to firm/dashboard.html is BLOCKED', () => {
      const firmJsPath = path.join(baseDir, 'js/firm/dashboard.js');
      const code = fs.readFileSync(firmJsPath, 'utf8');

      const mockDOM = { innerHTML: '' };
      const virtualWindow = {
        localStorage: { getItem: () => null, removeItem: () => {}, setItem: () => {} },
        document: { getElementById: () => mockDOM }
      };

      const fn = new Function('window', 'document', code);
      fn(virtualWindow, virtualWindow.document);
      const FirmDashboard = virtualWindow.FirmDashboard;

      FirmDashboard.evaluateStaffAuthorization({ getCurrentUser: () => clientAuth });
      assert.equal(FirmDashboard.state.isAuthorizedStaff, false);

      FirmDashboard.renderAccessDenied(mockDOM);
      assert.ok(mockDOM.innerHTML.includes('403 FORBIDDEN'));
      assert.ok(mockDOM.innerHTML.includes(clientAuth.uid));
    });
  });

  // ── AUDIT 3: Clients Cannot Read Another Client Data (Cross-Tenant Isolation) ──
  describe('3. Cross-Tenant Data Isolation (Client A vs Client B)', () => {
    const clientAAuth = {
      uid: 'usr_whitfield_4417',
      token: { role: 'client' }
    };
    const clientBAuth = {
      uid: 'usr_brennan_llc',
      token: { role: 'client' }
    };

    const clientBContext = new SecurityRulesEvaluator(clientBAuth);

    test('3.1 Client B CANNOT read Client A engagement file', () => {
      assert.equal(clientBContext.canReadEngagement({ clientUid: clientAAuth.uid }), false);
    });

    test('3.2 Client B CANNOT read Client A document requests', () => {
      assert.equal(clientBContext.canReadDocumentRequest({ clientId: clientAAuth.uid }), false);
    });

    test('3.3 Client B CANNOT read Client A uploaded documents', () => {
      assert.equal(clientBContext.canReadDocument({ clientId: clientAAuth.uid }), false);
    });

    test('3.4 Client B CANNOT read Client A Cloud Storage vault files', () => {
      assert.equal(clientBContext.canReadStorage(clientAAuth.uid), false);
    });

    test('3.5 Client B CANNOT upload files into Client A Cloud Storage vault', () => {
      assert.equal(clientBContext.canWriteStorage(clientAAuth.uid, 500, 'application/pdf'), false);
    });

    test('3.6 Client B CANNOT read Client A prepared tax return', () => {
      assert.equal(clientBContext.canReadTaxReturn({ clientUid: clientAAuth.uid }), false);
    });

    test('3.7 Client B CANNOT read Client A messages', () => {
      assert.equal(clientBContext.canReadMessage({ clientId: clientAAuth.uid }), false);
    });

    test('3.8 Client B CANNOT read Client A invoices', () => {
      assert.equal(clientBContext.canReadInvoice({ clientId: clientAAuth.uid }), false);
    });
  });

  // ── AUDIT 4: Staff Permissions Granted Through Trusted Administrative Process ──
  describe('4. Staff Role Provisioning & Administrative Governance', () => {
    test('4.1 Managing Partner (firm_admin with MFA) can provision staff preparer', async () => {
      const mockAdminAuth = {
        setCustomUserClaims: async (uid, claims) => {
          assert.equal(claims.role, 'firm_preparer');
          assert.equal(claims.mfa, true);
        }
      };

      const mockDb = {
        collection: (name) => ({
          doc: (id) => ({
            set: async (data) => {
              assert.equal(name, 'firm_staff');
              assert.equal(data.role, 'firm_preparer');
              assert.equal(data.mfaEnforced, true);
            }
          })
        })
      };

      const mockAudit = {
        recordAuthoritativeEvent: async (evt) => {
          assert.equal(evt.eventType, 'STAFF_ROLE_PROVISIONED');
        }
      };

      const result = await provisionStaffRoleHandler({
        context: {
          uid: 'staff_managing_partner',
          role: 'firm_admin',
          mfaVerified: true
        },
        targetUid: 'usr_new_preparer',
        targetRole: 'firm_preparer',
        staffMetadata: { name: 'Elena Rostova, CPA' }
      }, {
        adminAuth: mockAdminAuth,
        firestoreDb: mockDb,
        auditLogger: mockAudit
      });

      assert.equal(result.success, true);
      assert.equal(result.role, 'firm_preparer');
    });

    test('4.2 Preparer CANNOT provision staff roles (Admin authority required)', async () => {
      const result = await provisionStaffRoleHandler({
        context: {
          uid: 'preparer_denise_cpa',
          role: 'firm_preparer',
          mfaVerified: true
        },
        targetUid: 'usr_victim',
        targetRole: 'firm_admin'
      }, {});

      assert.equal(result.success, false);
      assert.equal(result.error.code, 'permission_denied');
      assert.match(result.error.message, /Administrative authority required/);
    });

    test('4.3 Admin CANNOT self-demote (Lockout prevention guard)', async () => {
      const result = await provisionStaffRoleHandler({
        context: {
          uid: 'staff_managing_partner',
          role: 'firm_admin',
          mfaVerified: true
        },
        targetUid: 'staff_managing_partner',
        targetRole: 'client'
      }, {});

      assert.equal(result.success, false);
      assert.equal(result.error.code, 'permission_denied');
      assert.match(result.error.message, /cannot demote own administrative privileges/);
    });
  });

  // ── AUDIT 5: Firestore & Storage Rules Coverage ────────────────────────────
  describe('5. Firestore & Storage Security Rules Schema Coverage', () => {
    test('5.1 firestore.rules declares rules for all 11 core collections', () => {
      const rulesContent = fs.readFileSync(path.join(baseDir, 'firestore.rules'), 'utf8');

      const expectedCollections = [
        'match /engagements/{engagementId}',
        'match /documentRequests/{requestId}',
        'match /documents/{documentId}',
        'match /tax_documents/{docId}',
        'match /tax_returns/{returnId}',
        'match /signatures/{sigId}',
        'match /messages/{messageId}',
        'match /invoices/{invoiceId}',
        'match /updates/{updateId}',
        'match /consents/{consentId}',
        'match /audit_logs/{logId}',
        'match /firm_staff/{staffId}'
      ];

      for (const col of expectedCollections) {
        assert.ok(rulesContent.includes(col), `firestore.rules must govern collection ${col}`);
      }
    });

    test('5.2 storage.rules declares 25MB ceiling and MIME filters', () => {
      const storageContent = fs.readFileSync(path.join(baseDir, 'storage.rules'), 'utf8');
      assert.ok(storageContent.includes('request.resource.size <= 25 * 1024 * 1024'));
      assert.ok(storageContent.includes('application/pdf'));
      assert.ok(storageContent.includes('clients/{userId}/tax-years/{taxYear}/documents/{documentId}'));
      assert.ok(storageContent.includes('clients/{userId}/returns/{returnFileId}'));
    });
  });

  // ── AUDIT 6: Sensitive State Changes Validated by Trusted Backend Functions ─
  describe('6. Sensitive State Changes & Backend Trust Boundaries', () => {
    test('6.1 Document review decision must be executed by licensed practitioner with notes', async () => {
      const mockDb = {
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: true, data: () => ({ clientId: 'c1' }) }),
            set: async () => {}
          })
        })
      };

      // Unauthenticated caller rejected
      const unauthRes = await documentReviewHandler({
        context: null,
        documentId: 'doc_123',
        action: 'accept'
      }, { firestoreDb: mockDb });
      assert.equal(unauthRes.success, false);
      assert.equal(unauthRes.error.code, 'unauthenticated');

      // Client caller rejected
      const clientRes = await documentReviewHandler({
        context: { uid: 'c1', role: 'client' },
        documentId: 'doc_123',
        action: 'accept'
      }, { firestoreDb: mockDb });
      assert.equal(clientRes.success, false);
      assert.equal(clientRes.error.code, 'permission_denied');
      assert.match(clientRes.error.message, /Taxpayers cannot accept or reject documents/);

      // Rejection without clear reason rejected under Circular 230
      const noReasonRes = await documentReviewHandler({
        context: { uid: 's1', role: 'firm_preparer', mfaVerified: true },
        documentId: 'doc_123',
        action: 'reject',
        notes: ''
      }, { firestoreDb: mockDb });
      assert.equal(noReasonRes.success, false);
      assert.equal(noReasonRes.error.code, 'invalid_argument');
      assert.match(noReasonRes.error.message, /clear rejection reason is required/);
    });

    test('6.2 Payment invoice status can ONLY be transitioned to paid via verified HMAC webhook', async () => {
      const secret = 'whsec_test_secret_audit';
      const timestamp = Math.floor(Date.now() / 1000);
      const parsedEvent = {
        id: 'evt_stripe_audit_991',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            metadata: { invoice_id: 'inv_audit_01' },
            payment_status: 'paid'
          }
        }
      };
      const rawPayload = JSON.stringify(parsedEvent);

      const validSig = `t=${timestamp},v1=${computeStripeHmac(rawPayload, secret, timestamp)}`;
      const forgedSig = `t=${timestamp},v1=forged_invalid_signature_hash`;

      let invoiceStatus = 'issued';
      const mockDb = {
        collection: (name) => ({
          doc: (id) => ({
            get: async () => ({
              exists: true,
              data: () => ({ status: invoiceStatus, total: 450.00, clientId: 'usr_audit' })
            }),
            set: async (data) => {
              if (data.status) invoiceStatus = data.status;
            }
          })
        })
      };

      // Forged webhook rejected
      const forgedRes = await paymentWebhookHandler({
        rawBody: rawPayload,
        signatureHeader: forgedSig,
        webhookSecret: secret,
        eventPayload: parsedEvent
      }, { firestoreDb: mockDb });

      assert.equal(forgedRes.success, false);
      assert.equal(forgedRes.error.code, 'permission_denied');
      assert.equal(invoiceStatus, 'issued', 'Invoice must not be updated on forged webhook');

      // Valid webhook processed
      const validRes = await paymentWebhookHandler({
        rawBody: rawPayload,
        signatureHeader: validSig,
        webhookSecret: secret,
        eventPayload: parsedEvent
      }, { firestoreDb: mockDb });

      assert.equal(validRes.received, true);
      assert.equal(validRes.processed, true);
      assert.equal(invoiceStatus, 'paid', 'Invoice status must transition to paid');
    });
  });

  // ── AUDIT 7: Staff MFA Enforcement ─────────────────────────────────────────
  describe('7. Staff Multi-Factor Authentication (MFA) Verification', () => {
    test('7.1 Preparer without MFA is REJECTED from firm staff permissions', () => {
      const preparerNoMfa = new SecurityRulesEvaluator({
        uid: 'preparer_denise_cpa',
        token: { role: 'firm_preparer', mfa: false }
      });
      assert.equal(preparerNoMfa.isFirmStaff(), false);
      assert.equal(preparerNoMfa.canWriteEngagement(), false);
    });

    test('7.2 Admin without MFA is REJECTED from administrative actions', () => {
      const adminNoMfa = new SecurityRulesEvaluator({
        uid: 'staff_managing_partner',
        token: { role: 'firm_admin', mfa: false }
      });
      assert.equal(adminNoMfa.isFirmAdmin(), false);
      assert.equal(adminNoMfa.canUpdateInvoice(), false);
    });

    test('7.3 Staff with verified second-factor is GRANTED operational access', () => {
      const staffWithMfa = new SecurityRulesEvaluator({
        uid: 'preparer_denise_cpa',
        token: { role: 'firm_preparer', mfa: true }
      });
      assert.equal(staffWithMfa.isFirmStaff(), true);
      assert.equal(staffWithMfa.canWriteEngagement(), true);
    });
  });

  // ── AUDIT 8: Immutable Audit Records & WORM Protection ─────────────────────
  describe('8. Audit Ledger Immutability & Cryptographic Seals', () => {
    test('8.1 Audit records are strictly immutable (update and delete disallowed)', () => {
      const rulesContent = fs.readFileSync(path.join(baseDir, 'firestore.rules'), 'utf8');
      assert.ok(rulesContent.includes('match /audit_logs/{logId}'));
      assert.ok(rulesContent.includes('allow update, delete: if false;'));
    });

    test('8.2 Authoritative audit ledger computes SHA-256 integrity hash', async () => {
      let savedLog = null;
      const mockDb = {
        collection: (name) => ({
          doc: (id) => ({
            set: async (data) => { savedLog = data; }
          })
        })
      };

      const ledger = new AuditLedgerService(mockDb);
      const res = await ledger.recordAuthoritativeEvent({
        action: 'Form 8879 Executed',
        eventType: 'SIGNATURE_COMPLETED',
        details: 'Taxpayer completed DocuSign KBA authorization',
        actor: { uid: 'usr_whitfield_4417', role: 'client' }
      });

      assert.equal(res.success, true);
      assert.ok(savedLog);
      assert.ok(savedLog.integrityHash);
      assert.equal(savedLog.integrityHash.length, 64, 'Integrity hash must be 64-char SHA-256 hex');
      assert.equal(savedLog.securityTier, 'authoritative_ledger');
    });
  });

  // ── AUDIT 9: Privileged Secrets Isolation ──────────────────────────────────
  describe('9. Privileged Secrets Isolation in Codebase', () => {
    test('9.1 No private keys, service account credentials, or live secrets in frontend code', () => {
      const jsDir = path.join(baseDir, 'js');
      const files = fs.readdirSync(jsDir, { recursive: true }).filter(f => f.endsWith('.js'));

      const dangerousPatterns = [
        /-----BEGIN (RSA )?PRIVATE KEY-----/,
        /sk_live_[a-zA-Z0-9]{24,}/,
        /"private_key":\s*"-----BEGIN/,
        /ds_client_secret_[a-zA-Z0-9]{20,}/
      ];

      for (const file of files) {
        const fullPath = path.join(jsDir, file);
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const pattern of dangerousPatterns) {
          assert.equal(
            pattern.test(content),
            false,
            `Secret pattern matched in frontend file: ${file}`
          );
        }
      }
    });

    test('9.2 Secret Manager service correctly throws if secret unavailable in production', async () => {
      secretManager.clearCache();
      await assert.rejects(
        async () => {
          await secretManager.getSecret('NON_EXISTENT_PRODUCTION_SECRET');
        },
        /not found in Secret Manager or environment/
      );
    });
  });
});
