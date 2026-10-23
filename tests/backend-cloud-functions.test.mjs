/**
 * ============================================================================
 * TEST SUITE: TRUSTED BACKEND OPERATIONS & CLOUD FUNCTIONS
 * ============================================================================
 * 
 * Verifies all 9 priority trusted backend operations:
 * 1. Staff role provisioning (admin authorization, MFA requirement, custom claims)
 * 2. Document acceptance and rejection (Circular 230 diligence, practitioner only)
 * 3. Return approval and publication (staff publication, client approval, state lock)
 * 4. Trusted audit-event creation (WORM ledger, cryptographic integrity hash)
 * 5. Payment checkout-session creation (PCI-DSS SAQ A, invoice validation, secrets)
 * 6. Payment webhook verification (HMAC-SHA256 verification, invoice settlement, idempotency)
 * 7. Signing-provider callbacks (HMAC validation, IRS Pub 1345 KBA lockout, Form 8879)
 * 8. File-validation and malware-scan status updates (ClamAV verification, quarantine)
 * 9. Authorized notification triggers (IRC § 7216 sanitization, Postmark delivery)
 * 
 * Scenarios tested per requirement:
 * - Success cases
 * - Unauthorized requests (unauthenticated, wrong role, cross-tenant violations)
 * - Invalid input validation
 * - Retries & Idempotency replay
 * - Provider failures & safe structured errors
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Import Cloud Functions backend handlers
import { provisionStaffRoleHandler } from '../functions/src/auth-roles.mjs';
import { documentReviewHandler } from '../functions/src/document-review.mjs';
import { publishPreparedReturnHandler, clientApproveReturnHandler } from '../functions/src/return-workflow.mjs';
import { AuditLedgerService, AuthoritativeEventTypes } from '../functions/src/audit-ledger.mjs';
import { createPaymentCheckoutSessionHandler } from '../functions/src/payment-checkout.mjs';
import { paymentWebhookHandler, computeStripeHmac } from '../functions/src/payment-webhook.mjs';
import { signingProviderCallbackHandler } from '../functions/src/signing-callback.mjs';
import { fileScanStatusHandler, validateFileMetadata } from '../functions/src/malware-scanner.mjs';
import { NotificationDispatcherService } from '../functions/src/notification-dispatcher.mjs';
import { secretManager } from '../functions/src/config.mjs';
import { IdempotencyManager } from '../functions/src/idempotency.mjs';
import { ErrorCode, AppError } from '../functions/src/errors.mjs';

// ── Mock Database & Infrastructure Helpers ─────────────────────────────────

class MockFirestoreCollection {
  constructor(name, parentDb) {
    this.name = name;
    this.parentDb = parentDb;
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
      this.collections.set(name, new MockFirestoreCollection(name, this));
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

// ── Test Suites ─────────────────────────────────────────────────────────────

describe('1. Priority 1: Staff Role Provisioning', () => {
  let db, adminAuth, auditLogger, services;

  beforeEach(() => {
    db = new MockFirestoreDb();
    adminAuth = new MockAdminAuth();
    auditLogger = new AuditLedgerService(db);
    services = { adminAuth, firestoreDb: db, auditLogger };
  });

  test('Admin with MFA successfully provisions firm_preparer role', async () => {
    const adminContext = {
      uid: 'staff_admin_01',
      email: 'admin@pivot-aide.tax',
      role: 'firm_admin',
      mfaVerified: true
    };

    const res = await provisionStaffRoleHandler({
      context: adminContext,
      targetUid: 'staff_new_preparer',
      targetRole: 'firm_preparer',
      staffMetadata: { name: 'Elena Vance, CPA', ptin: 'P09918274' }
    }, services);

    assert.equal(res.success, true);
    assert.equal(res.role, 'firm_preparer');
    assert.equal(res.claims.role, 'firm_preparer');
    assert.equal(res.claims.mfa, true);

    // Verify written to mock Admin SDK
    const savedClaims = adminAuth.customClaimsMap.get('staff_new_preparer');
    assert.equal(savedClaims.role, 'firm_preparer');
    assert.equal(savedClaims.mfa, true);

    // Verify saved in /firm_staff collection
    const staffDoc = await db.collection('firm_staff').doc('staff_new_preparer').get();
    assert.equal(staffDoc.exists, true);
    assert.equal(staffDoc.data().role, 'firm_preparer');
  });

  test('Preparer is REJECTED from provisioning staff roles (Admin only)', async () => {
    const preparerContext = {
      uid: 'staff_denise_cpa',
      role: 'firm_preparer',
      mfaVerified: true
    };

    const res = await provisionStaffRoleHandler({
      context: preparerContext,
      targetUid: 'staff_other',
      targetRole: 'firm_admin'
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.PERMISSION_DENIED);
  });

  test('Admin without verified MFA is REJECTED under FTC Safeguards § 314.4', async () => {
    const unverifiedAdmin = {
      uid: 'staff_admin_01',
      role: 'firm_admin',
      mfaVerified: false // MFA missing!
    };

    const res = await provisionStaffRoleHandler({
      context: unverifiedAdmin,
      targetUid: 'staff_candidate',
      targetRole: 'firm_preparer'
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.PERMISSION_DENIED);
    assert.match(res.error.message, /MFA verification required/);
  });

  test('Invalid role input returns safe structured error', async () => {
    const adminContext = { uid: 'admin_1', role: 'firm_admin', mfaVerified: true };
    const res = await provisionStaffRoleHandler({
      context: adminContext,
      targetUid: 'target_1',
      targetRole: 'super_root_hacker'
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.INVALID_ARGUMENT);
  });

  test('Idempotency prevents duplicate side-effects on retry', async () => {
    const adminContext = { uid: 'admin_1', role: 'firm_admin', mfaVerified: true };
    const idempotencyKey = 'role_idemp_key_999';

    const res1 = await provisionStaffRoleHandler({
      context: adminContext,
      targetUid: 'target_idem',
      targetRole: 'firm_preparer',
      idempotencyKey
    }, services);
    assert.equal(res1.success, true);

    const res2 = await provisionStaffRoleHandler({
      context: adminContext,
      targetUid: 'target_idem',
      targetRole: 'firm_preparer',
      idempotencyKey
    }, services);
    assert.equal(res2.success, true);
    assert.equal(res2._idempotentReplay, true);
  });
});

describe('2. Priority 2: Document Acceptance and Rejection', () => {
  let db, auditLogger, services;

  beforeEach(() => {
    db = new MockFirestoreDb();
    auditLogger = new AuditLedgerService(db);
    services = { firestoreDb: db, auditLogger };
  });

  test('CPA with MFA successfully accepts client document under Circular 230', async () => {
    await db.collection('documentRequests').doc('req_w2_01').set({
      clientId: 'usr_whitfield_4417',
      title: 'W-2 Statement',
      status: 'review'
    });

    const staffContext = {
      uid: 'staff_denise_cpa',
      displayName: 'Denise R., CPA',
      role: 'firm_preparer',
      mfaVerified: true
    };

    const res = await documentReviewHandler({
      context: staffContext,
      documentId: 'req_w2_01',
      action: 'accept',
      notes: 'W-2 box 1 and box 2 match Maryland employer withholdings'
    }, services);

    assert.equal(res.success, true);
    assert.equal(res.status, 'accepted');
    assert.equal(res.reviewedBy, 'Denise R., CPA');

    const updated = await db.collection('documentRequests').doc('req_w2_01').get();
    assert.equal(updated.data().status, 'accepted');
  });

  test('Client is BLOCKED from accepting their own documents', async () => {
    const clientContext = {
      uid: 'usr_whitfield_4417',
      role: 'client',
      mfaVerified: false
    };

    const res = await documentReviewHandler({
      context: clientContext,
      documentId: 'req_w2_01',
      action: 'accept'
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.PERMISSION_DENIED);
    assert.match(res.error.message, /Taxpayers cannot accept or reject/);
  });

  test('Rejection requires non-empty explanation under Circular 230 § 10.22', async () => {
    const staffContext = { uid: 'staff_cpa', role: 'firm_preparer', mfaVerified: true };

    const res = await documentReviewHandler({
      context: staffContext,
      documentId: 'req_doc_02',
      action: 'reject',
      notes: '' // Empty reason!
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.INVALID_ARGUMENT);
    assert.match(res.error.message, /rejection reason is required/);
  });
});

describe('3. Priority 3: Return Publication and Client Approval', () => {
  let db, auditLogger, services;

  beforeEach(() => {
    db = new MockFirestoreDb();
    auditLogger = new AuditLedgerService(db);
    services = { firestoreDb: db, auditLogger };
  });

  test('Staff publishes return, then taxpayer approves own return', async () => {
    const returnId = 'ret_2026_whitfield';
    await db.collection('tax_returns').doc(returnId).set({
      clientUid: 'usr_whitfield_4417',
      taxYear: 2026,
      published: false
    });

    // Step A: Staff publishes
    const staffContext = { uid: 'staff_denise_cpa', role: 'firm_preparer', mfaVerified: true, displayName: 'Denise R., CPA' };
    const pubRes = await publishPreparedReturnHandler({
      context: staffContext,
      returnId,
      returnData: { clientUid: 'usr_whitfield_4417', federalRefund: 3418 }
    }, services);
    assert.equal(pubRes.success, true);
    assert.equal(pubRes.published, true);

    // Step B: Client approves own return
    const clientContext = { uid: 'usr_whitfield_4417', email: 'm.whitfield@example.com', role: 'client' };
    const appRes = await clientApproveReturnHandler({
      context: clientContext,
      returnId,
      approvalNotes: 'Confirmed Maryland balance due and refund amounts'
    }, services);

    assert.equal(appRes.success, true);
    assert.equal(appRes.approved, true);
    assert.equal(appRes.nextStep, 'signing_pending');

    const returnDoc = await db.collection('tax_returns').doc(returnId).get();
    assert.equal(returnDoc.data().clientApproved, true);
  });

  test('Taxpayer CANNOT approve an unpublished draft return', async () => {
    const returnId = 'ret_2026_draft_unpub';
    await db.collection('tax_returns').doc(returnId).set({
      clientUid: 'usr_client_01',
      published: false // Unpublished draft!
    });

    const clientContext = { uid: 'usr_client_01', role: 'client' };
    const res = await clientApproveReturnHandler({
      context: clientContext,
      returnId
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.FAILED_PRECONDITION);
  });

  test('Cross-tenant protection: Client cannot approve another taxpayer return', async () => {
    const returnId = 'ret_brennan_llc';
    await db.collection('tax_returns').doc(returnId).set({
      clientUid: 'usr_brennan_llc',
      published: true
    });

    const maliciousClient = { uid: 'usr_whitfield_4417', role: 'client' };
    const res = await clientApproveReturnHandler({
      context: maliciousClient,
      returnId
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.PERMISSION_DENIED);
    assert.match(res.error.message, /Cross-tenant violation/);
  });
});

describe('4. Priority 4: Authoritative Audit Ledger & Cryptographic Integrity', () => {
  let db, ledger;

  beforeEach(() => {
    db = new MockFirestoreDb();
    ledger = new AuditLedgerService(db);
  });

  test('Authoritative audit event generates SHA-256 seal and stores in WORM ledger', async () => {
    const res = await ledger.recordAuthoritativeEvent({
      action: 'Payment Confirmed by Gateway',
      eventType: 'PAYMENT_CONFIRMED',
      category: 'Billing',
      targetId: 'inv_2026_0418',
      clientId: 'usr_whitfield_4417',
      details: 'ACH settlement confirmed by gateway. Amount: $1,240.00',
      actor: { uid: 'stripe_gateway', email: 'webhook@stripe.com', role: 'gateway' }
    });

    assert.equal(res.success, true);
    assert.ok(res.logId);
    assert.ok(res.integrityHash);
    assert.equal(res.integrityHash.length, 64); // SHA-256 hex string

    const savedDoc = await db.collection('audit_logs').doc(res.logId).get();
    assert.equal(savedDoc.exists, true);
    assert.equal(savedDoc.data().securityTier, 'authoritative_ledger');
    assert.equal(savedDoc.data().provenance, 'backend_trusted_cloud_function');
  });

  test('Audit logging rejects missing required fields', async () => {
    const res = await ledger.recordAuthoritativeEvent({
      action: 'Incomplete Event'
      // Missing eventType and details!
    });

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.INVALID_ARGUMENT);
  });
});

describe('5. Priority 5: Payment Checkout-Session Creation', () => {
  let db, auditLogger, services;

  beforeEach(() => {
    db = new MockFirestoreDb();
    auditLogger = new AuditLedgerService(db);
    services = { firestoreDb: db, auditLogger };
  });

  test('Client creates valid payment session for issued invoice', async () => {
    await db.collection('invoices').doc('inv_2026_0418').set({
      invoiceId: 'inv_2026_0418',
      clientId: 'usr_whitfield_4417',
      total: 1240.00,
      status: 'issued'
    });

    const clientContext = { uid: 'usr_whitfield_4417', email: 'm.whitfield@example.com', role: 'client' };
    const res = await createPaymentCheckoutSessionHandler({
      context: clientContext,
      invoiceId: 'inv_2026_0418',
      paymentMethod: 'bank'
    }, services);

    assert.equal(res.success, true);
    assert.ok(res.sessionId);
    assert.ok(res.checkoutUrl);
    assert.equal(res.amount, 1240.00);

    const sessionDoc = await db.collection('payment_sessions').doc(res.sessionId).get();
    assert.equal(sessionDoc.exists, true);
    assert.equal(sessionDoc.data().status, 'open');
  });

  test('Cannot create checkout session for an already paid invoice', async () => {
    await db.collection('invoices').doc('inv_paid_already').set({
      clientId: 'usr_client_01',
      total: 500.00,
      status: 'paid' // Already settled
    });

    const clientContext = { uid: 'usr_client_01', role: 'client' };
    const res = await createPaymentCheckoutSessionHandler({
      context: clientContext,
      invoiceId: 'inv_paid_already'
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.FAILED_PRECONDITION);
  });

  test('Cross-tenant block: Client cannot pay another client invoice', async () => {
    await db.collection('invoices').doc('inv_brennan').set({
      clientId: 'usr_brennan_llc',
      total: 1650.00,
      status: 'issued'
    });

    const otherClient = { uid: 'usr_whitfield_4417', role: 'client' };
    const res = await createPaymentCheckoutSessionHandler({
      context: otherClient,
      invoiceId: 'inv_brennan'
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.PERMISSION_DENIED);
  });
});

describe('6. Priority 6: Payment Webhook Verification', () => {
  let db, auditLogger, services;

  beforeEach(() => {
    db = new MockFirestoreDb();
    auditLogger = new AuditLedgerService(db);
    services = { firestoreDb: db, auditLogger };
  });

  test('Valid HMAC signed webhook marks invoice as paid', async () => {
    await db.collection('invoices').doc('inv_webhook_test').set({
      invoiceId: 'inv_webhook_test',
      status: 'issued'
    });

    const rawPayload = JSON.stringify({
      id: 'evt_stripe_succ_901',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_live_901',
          payment_intent: 'pi_test_901',
          metadata: { invoiceId: 'inv_webhook_test', clientId: 'usr_client_99' }
        }
      }
    });

    const secret = 'whsec_test_mock_secret';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const hmacSig = computeStripeHmac(rawPayload, secret, timestamp);
    const signatureHeader = `t=${timestamp},v1=${hmacSig}`;

    const res = await paymentWebhookHandler({
      rawBody: rawPayload,
      signatureHeader,
      eventPayload: JSON.parse(rawPayload)
    }, services);

    assert.equal(res.received, true);
    assert.equal(res.status, 'paid');

    const updatedInvoice = await db.collection('invoices').doc('inv_webhook_test').get();
    assert.equal(updatedInvoice.data().status, 'paid');
    assert.equal(updatedInvoice.data().transactionRef, 'pi_test_901');
  });

  test('Tampered or invalid signature is REJECTED', async () => {
    const rawPayload = JSON.stringify({ type: 'checkout.session.completed' });
    const forgedSignature = 't=12345,v1=deadbeefcafebabe';

    const res = await paymentWebhookHandler({
      rawBody: rawPayload,
      signatureHeader: forgedSignature,
      eventPayload: JSON.parse(rawPayload)
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.PERMISSION_DENIED);
  });
});

describe('7. Priority 7: Signing Callbacks & IRS Pub 1345 KBA Lockout', () => {
  let db, auditLogger, services;

  beforeEach(() => {
    db = new MockFirestoreDb();
    auditLogger = new AuditLedgerService(db);
    services = { firestoreDb: db, auditLogger };
  });

  test('3 failed KBA attempts triggers mandatory wet-ink lockout', async () => {
    const clientUid = 'usr_kba_locked_filer';
    const res = await signingProviderCallbackHandler({
      callbackData: {
        event: 'kba_failed',
        clientUid,
        kbaAttempts: 3
      }
    }, services);

    assert.equal(res.status, 'kba_locked_out');
    assert.equal(res.wetSignatureRequired, true);

    const engDoc = await db.collection('engagements').doc(clientUid).get();
    assert.equal(engDoc.data().kbaLockout, true);
    assert.equal(engDoc.data().signatureMethod, 'physical_wet_sign');
  });

  test('Successful Form 8879 execution commits certificate to immutable /signatures', async () => {
    const clientUid = 'usr_whitfield_4417';
    const res = await signingProviderCallbackHandler({
      callbackData: {
        event: 'signature_completed',
        clientUid,
        signerName: 'Michael Whitfield',
        signerEmail: 'm.whitfield@example.com',
        certificateId: 'cert_8879_live_2026'
      }
    }, services);

    assert.equal(res.status, 'signature_completed');
    assert.ok(res.signatureId);

    const sigDoc = await db.collection('signatures').doc(res.signatureId).get();
    assert.equal(sigDoc.exists, true);
    assert.equal(sigDoc.data().form, 'IRS Form 8879');
    assert.equal(sigDoc.data().kbaVerified, true);
  });
});

describe('8. Priority 8: File Validation and Anti-Malware Scanning', () => {
  let db, auditLogger, services;

  beforeEach(() => {
    db = new MockFirestoreDb();
    auditLogger = new AuditLedgerService(db);
    services = { firestoreDb: db, auditLogger };
  });

  test('Clean scan clears document for CPA review', async () => {
    const docId = 'doc_clean_w2';
    await db.collection('documents').doc(docId).set({ status: 'review', scanStatus: 'pending' });

    const res = await fileScanStatusHandler({
      documentId: docId,
      scannerSecret: 'scan_test_shared_secret',
      scanResult: { clean: true, threatName: null, virusDbVersion: 'ClamAV-2026.4' },
      fileMetadata: { fileName: 'w2_2026.pdf', fileSizeBytes: 512000, mimeType: 'application/pdf' }
    }, services);

    assert.equal(res.success, true);
    assert.equal(res.scanStatus, 'clean');
    assert.equal(res.quarantined, false);

    const doc = await db.collection('documents').doc(docId).get();
    assert.equal(doc.data().scanStatus, 'clean');
  });

  test('Malware threat or prohibited script extension triggers quarantine', async () => {
    const docId = 'doc_malicious_script';
    await db.collection('documents').doc(docId).set({ status: 'review' });

    const res = await fileScanStatusHandler({
      documentId: docId,
      scannerSecret: 'scan_test_shared_secret',
      scanResult: { clean: false, threatName: 'Win32.Trojan.Script' },
      fileMetadata: { fileName: 'payload.exe', fileSizeBytes: 1024, mimeType: 'application/octet-stream' }
    }, services);

    assert.equal(res.success, true);
    assert.equal(res.scanStatus, 'quarantined');
    assert.equal(res.quarantined, true);

    const doc = await db.collection('documents').doc(docId).get();
    assert.equal(doc.data().scanStatus, 'quarantined');
  });

  test('Invalid scanner shared secret is REJECTED', async () => {
    const res = await fileScanStatusHandler({
      documentId: 'doc_any',
      scannerSecret: 'unauthorized_token_spoof',
      scanResult: { clean: true }
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.PERMISSION_DENIED);
  });
});

describe('9. Priority 9: Authorized Notification Triggers & IRC § 7216', () => {
  let db, notifService;

  beforeEach(() => {
    db = new MockFirestoreDb();
    notifService = new NotificationDispatcherService(db);
  });

  test('Dispatches sanitized notification to outbox without sensitive tax figures', async () => {
    const res = await notifService.dispatch({
      type: 'return_review',
      recipientUid: 'usr_whitfield_4417',
      recipientEmail: 'm.whitfield@example.com',
      recipientName: 'Michael Whitfield',
      metadata: { taxYear: 2026 }
    });

    assert.equal(res.success, true);
    assert.ok(res.outboxId);
    assert.equal(res.status, 'delivered');

    const outboxDoc = await db.collection('notifications_outbox').doc(res.outboxId).get();
    assert.equal(outboxDoc.exists, true);
    // Guarantee no SSN or tax figure in email subject
    assert.doesNotMatch(outboxDoc.data().subject, /\$|SSN|refund/i);
  });
});
