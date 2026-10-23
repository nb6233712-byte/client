/**
 * ============================================================================
 * TEST SUITE: DOCUSIGN ESIGNATURE & LEXISNEXIS KBA INTEGRATION (FORM 8879)
 * ============================================================================
 * 
 * Verifies production-provider integration for IRS Form 8879:
 * 1. Trusted backend creates DocuSign envelope with LexisNexis KBA
 * 2. Dual-signer support (Primary Taxpayer & Secondary Spouse independently verified)
 * 3. Cryptographic HMAC verification of DocuSign Connect webhooks (x-docusign-signature-1)
 * 4. 3-attempt KBA threshold enforcement (IRS Pub 1345 § 5.2.2 physical wet-ink lockout)
 * 5. Full execution records X.509 certificate in /signatures with 3-year WORM retention
 * 6. Idempotency prevents duplicate side-effects on webhook replay
 * 7. Handles expired, voided, and declined envelopes
 * 8. Cross-tenant and unauthenticated security guards
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  createDocuSignEnvelopeSessionHandler,
  docuSignConnectWebhookHandler,
  computeDocuSignHmac
} from '../functions/src/docusign-service.mjs';
import { AuditLedgerService } from '../functions/src/audit-ledger.mjs';
import { NotificationDispatcherService } from '../functions/src/notification-dispatcher.mjs';
import { ErrorCode } from '../functions/src/errors.mjs';

// ── Mock Firestore Implementation ───────────────────────────────────────────

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

// ── Tests ───────────────────────────────────────────────────────────────────

describe('DocuSign & LexisNexis KBA Production Integration', () => {
  let db, auditLogger, notifService, services;
  const webhookSecret = 'ds_webhook_secret_sandbox';
  const clientUid = 'usr_whitfield_4417';

  beforeEach(() => {
    db = new MockFirestoreDb();
    auditLogger = new AuditLedgerService(db);
    notifService = new NotificationDispatcherService(db);
    services = { firestoreDb: db, auditLogger, notificationDispatcher: notifService };
  });

  test('1. Backend creates DocuSign envelope with LexisNexis KBA for Primary & Spouse', async () => {
    const clientContext = {
      uid: clientUid,
      displayName: 'Michael Whitfield',
      email: 'm.whitfield@example.com',
      role: 'client'
    };

    const res = await createDocuSignEnvelopeSessionHandler({
      context: clientContext,
      clientUid,
      taxYear: 2026,
      isJointReturn: true,
      spouseInfo: { name: 'Elena Whitfield', email: 'elena.whitfield@example.com' }
    }, services);

    assert.equal(res.success, true);
    assert.ok(res.envelopeId);
    assert.match(res.provider, /DocuSign eSignature v2.1/);
    assert.equal(res.signers.length, 2);
    assert.equal(res.signers[0].role, 'Primary Taxpayer');
    assert.equal(res.signers[1].role, 'Secondary Spouse');
    assert.equal(res.environment, 'sandbox_pending_production_efin');

    // Stored in Firestore /signing_envelopes
    const envDoc = await db.collection('signing_envelopes').doc(res.envelopeId).get();
    assert.equal(envDoc.exists, true);
    assert.equal(envDoc.data().form, 'IRS Form 8879');
    assert.equal(envDoc.data().isJointReturn, true);
    assert.equal(envDoc.data().kbaLockoutLimit, 3);
  });

  test('2. Unauthenticated caller is BLOCKED from initiating envelope', async () => {
    const res = await createDocuSignEnvelopeSessionHandler({
      context: null,
      clientUid
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.UNAUTHENTICATED);
  });

  test('3. Cross-tenant block: Client cannot initiate envelope on another client file', async () => {
    const maliciousContext = { uid: 'usr_other_client', role: 'client' };
    const res = await createDocuSignEnvelopeSessionHandler({
      context: maliciousContext,
      clientUid: 'usr_brennan_llc'
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.PERMISSION_DENIED);
  });

  test('4. Precondition check: KBA locked-out filers cannot create new remote envelopes', async () => {
    await db.collection('engagements').doc(clientUid).set({
      kbaLockout: true,
      signatureMethod: 'physical_wet_sign'
    });

    const clientContext = { uid: clientUid, role: 'client' };
    const res = await createDocuSignEnvelopeSessionHandler({
      context: clientContext,
      clientUid
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.FAILED_PRECONDITION);
    assert.match(res.error.message, /locked out due to 3 failed KBA attempts/);
  });

  test('5. DocuSign Connect webhook: 3 failed KBA attempts triggers mandatory wet-ink lockout', async () => {
    const envelopeId = 'env_kba_lockout_test';
    const rawBody = JSON.stringify({
      envelopeId,
      event: 'authentication-failed',
      clientUid,
      recipientName: 'Michael Whitfield',
      kbaAttempts: 3
    });

    const sigHeader = computeDocuSignHmac(rawBody, webhookSecret);

    const res = await docuSignConnectWebhookHandler({
      rawBody,
      signatureHeader: sigHeader,
      eventPayload: JSON.parse(rawBody)
    }, services);

    assert.equal(res.received, true);
    assert.equal(res.status, 'kba_locked_out');
    assert.equal(res.wetSignatureRequired, true);

    const eng = await db.collection('engagements').doc(clientUid).get();
    assert.equal(eng.data().kbaLockout, true);
    assert.equal(eng.data().signatureMethod, 'physical_wet_sign');

    const auditDocs = Array.from(db.collection('audit_logs').docs.values());
    const lockAudit = auditDocs.find(a => a.eventType === 'KBA_LOCKOUT_TRIGGERED');
    assert.ok(lockAudit);
  });

  test('6. DocuSign Connect webhook: Tampered HMAC signature is REJECTED', async () => {
    const rawBody = JSON.stringify({ envelopeId: 'env_tampered', event: 'envelope-completed' });
    const forgedSig = 'invalid_base64_forged_hash=';

    const res = await docuSignConnectWebhookHandler({
      rawBody,
      signatureHeader: forgedSig,
      eventPayload: JSON.parse(rawBody)
    }, services);

    assert.equal(res.success, false);
    assert.equal(res.error.code, ErrorCode.PERMISSION_DENIED);
  });

  test('7. DocuSign Connect webhook: Execution records certificate in /signatures with 3-year WORM retention', async () => {
    const envelopeId = 'env_whitfield_completed';
    const certId = 'cert_docusign_x509_998124';

    const rawBody = JSON.stringify({
      envelopeId,
      event: 'envelope-completed',
      clientUid,
      recipientId: '1',
      recipientName: 'Michael Whitfield',
      recipientEmail: 'm.whitfield@example.com',
      role: 'Primary Taxpayer',
      certificateId: certId,
      ipAddress: '73.142.19.82'
    });

    const sigHeader = computeDocuSignHmac(rawBody, webhookSecret);

    const res = await docuSignConnectWebhookHandler({
      rawBody,
      signatureHeader: sigHeader,
      eventPayload: JSON.parse(rawBody)
    }, services);

    assert.equal(res.received, true);
    assert.equal(res.status, 'envelope_completed');
    assert.equal(res.certificateId, certId);

    // Verify stored in /signatures with IRS Pub 1345 WORM metadata
    const sigDoc = await db.collection('signatures').doc(res.sigId).get();
    assert.equal(sigDoc.exists, true);
    assert.equal(sigDoc.data().form, 'IRS Form 8879');
    assert.equal(sigDoc.data().kbaVerified, true);
    assert.equal(sigDoc.data().kbaProvider, 'LexisNexis Risk Solutions');
    assert.equal(sigDoc.data().retentionPeriod, '3 Years WORM Storage');
    assert.equal(sigDoc.data().certificateId, certId);

    // Verify engagement advanced to efile_ready
    const eng = await db.collection('engagements').doc(clientUid).get();
    assert.equal(eng.data().stage, 'efile_ready');
    assert.equal(eng.data().form8879Signed, true);

    // Verify authoritative SIGNATURE_COMPLETED audit event
    const auditDocs = Array.from(db.collection('audit_logs').docs.values());
    const sigAudit = auditDocs.find(a => a.eventType === 'SIGNATURE_COMPLETED');
    assert.ok(sigAudit);
  });

  test('8. Duplicate webhook is handled idempotently without re-execution', async () => {
    const envelopeId = 'env_idemp_wh_01';
    const rawBody = JSON.stringify({
      envelopeId,
      event: 'envelope-completed',
      clientUid,
      recipientId: '1',
      recipientName: 'Michael Whitfield'
    });

    const sigHeader = computeDocuSignHmac(rawBody, webhookSecret);

    const res1 = await docuSignConnectWebhookHandler({
      rawBody,
      signatureHeader: sigHeader,
      eventPayload: JSON.parse(rawBody)
    }, services);
    assert.equal(res1.status, 'envelope_completed');

    // Duplicate delivery retry
    const res2 = await docuSignConnectWebhookHandler({
      rawBody,
      signatureHeader: sigHeader,
      eventPayload: JSON.parse(rawBody)
    }, services);
    assert.equal(res2.status, 'envelope_completed');
    assert.equal(res2._idempotentReplay, true);
  });

  test('9. Handles envelope-voided / expired state', async () => {
    const envelopeId = 'env_voided_01';
    const rawBody = JSON.stringify({
      envelopeId,
      event: 'envelope-voided',
      clientUid,
      reason: 'Signer requested corrections to tax schedule'
    });

    const sigHeader = computeDocuSignHmac(rawBody, webhookSecret);

    const res = await docuSignConnectWebhookHandler({
      rawBody,
      signatureHeader: sigHeader,
      eventPayload: JSON.parse(rawBody)
    }, services);

    assert.equal(res.status, 'envelope-voided');

    const env = await db.collection('signing_envelopes').doc(envelopeId).get();
    assert.equal(env.data().status, 'expired');
    assert.match(env.data().voidReason, /Signer requested corrections/);
  });
});
