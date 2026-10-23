/**
 * ============================================================================
 * TEST SUITE: STATUTORY COMPLIANCE & FTC SAFEGUARDS WORKFLOWS
 * ============================================================================
 * 
 * Verifies the production compliance controls:
 * 1. IRC § 7216 Affirmative Electronic Consent & Revocation Workflow
 * 2. Cross-Tenant Protection on Statutory Consents
 * 3. Pre-Disclosure Verification (Treas. Reg. § 301.7216-3)
 * 4. IRS Publication 1345 § 6 3-Year Statutory Retention Lock on Form 8879
 * 5. FTC Safeguards Rule 16 CFR § 314.4(c)(6)(i) 2-Year Disposal Schedule
 * 6. Secure Data Disposal (NIST SP 800-88) Privileged RBAC & Audit Trails
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  grantConsentHandler,
  revokeConsentHandler,
  verifyActiveConsentHandler,
  MANDATORY_7216_STATUTORY_WARNING
} from '../functions/src/consent-service.mjs';
import {
  evaluateRetentionScheduleHandler,
  executeSecureDisposalHandler,
  RETENTION_POLICIES
} from '../functions/src/data-retention-service.mjs';

// ── Mock Services Engine ────────────────────────────────────────────────────

class MockFirestoreDb {
  constructor() {
    this.storage = new Map();
  }

  collection(collName) {
    return {
      doc: (docId) => ({
        get: async () => {
          const key = `${collName}/${docId}`;
          const data = this.storage.get(key);
          return {
            exists: Boolean(data),
            data: () => data
          };
        },
        set: async (val, options = {}) => {
          const key = `${collName}/${docId}`;
          if (options.merge && this.storage.has(key)) {
            const existing = this.storage.get(key);
            this.storage.set(key, { ...existing, ...val });
          } else {
            this.storage.set(key, val);
          }
        }
      })
    };
  }
}

class MockAuditLogger {
  constructor() {
    this.events = [];
  }

  async recordAuthoritativeEvent(event) {
    this.events.push(event);
    return { success: true, logId: `log_${this.events.length}` };
  }
}

// ── Test Suites ─────────────────────────────────────────────────────────────

describe('1. IRC § 7216 Statutory Electronic Consent Engine', () => {
  test('Taxpayer successfully grants formal consent with mandatory statutory disclosure warning', async () => {
    const db = new MockFirestoreDb();
    const audit = new MockAuditLogger();

    const clientContext = { uid: 'usr_whitfield_4417', role: 'client', ip: '172.56.21.84' };
    const res = await grantConsentHandler({
      context: clientContext,
      consentData: {
        clientUid: 'usr_whitfield_4417',
        taxYear: 2026,
        consentType: 'use_tax_planning',
        purposeDescription: 'Multi-year advisory and estimated quarterly projections',
        warningAcknowledged: true
      }
    }, { firestoreDb: db, auditLogger: audit });

    assert.equal(res.success, true);
    assert.equal(res.status, 'granted');
    assert.ok(res.expiresAt);

    // Verify stored record
    const stored = await db.collection('consents').doc(res.consentId).get();
    assert.equal(stored.exists, true);
    assert.equal(stored.data().warningAcknowledged, true);
    assert.match(stored.data().statutoryWarningText, /Federal law requires this consent form/);

    // Verify authoritative audit log
    const log = audit.events.find(e => e.eventType === 'CONSENT_GRANTED');
    assert.ok(log);
    assert.equal(log.clientId, 'usr_whitfield_4417');
  });

  test('Rejects consent attempt if statutory warning is not affirmatively acknowledged', async () => {
    const db = new MockFirestoreDb();
    const audit = new MockAuditLogger();

    const clientContext = { uid: 'usr_whitfield_4417', role: 'client' };
    const res = await grantConsentHandler({
      context: clientContext,
      consentData: {
        clientUid: 'usr_whitfield_4417',
        consentType: 'use_tax_planning',
        warningAcknowledged: false // Fails requirement
      }
    }, { firestoreDb: db, auditLogger: audit });

    assert.equal(res.success, false);
    assert.equal(res.error.code, 'failed_precondition');
    assert.match(res.error.message, /affirmatively acknowledge the statutory warning/);
  });

  test('Cross-tenant block: Client CANNOT grant consent on another client tax return file', async () => {
    const db = new MockFirestoreDb();
    const audit = new MockAuditLogger();

    const rogueClient = { uid: 'usr_rogue_9999', role: 'client' };
    const res = await grantConsentHandler({
      context: rogueClient,
      consentData: {
        clientUid: 'usr_whitfield_4417', // Target victim
        consentType: 'disclosure_third_party',
        warningAcknowledged: true
      }
    }, { firestoreDb: db, auditLogger: audit });

    assert.equal(res.success, false);
    assert.equal(res.error.code, 'permission_denied');
  });

  test('Taxpayer can affirmatively revoke previously granted consent at any time', async () => {
    const db = new MockFirestoreDb();
    const audit = new MockAuditLogger();

    const clientContext = { uid: 'usr_whitfield_4417', role: 'client' };
    const grantRes = await grantConsentHandler({
      context: clientContext,
      consentData: {
        clientUid: 'usr_whitfield_4417',
        taxYear: 2026,
        consentType: 'disclosure_third_party',
        warningAcknowledged: true
      }
    }, { firestoreDb: db, auditLogger: audit });

    // Taxpayer revokes consent
    const revokeRes = await revokeConsentHandler({
      context: clientContext,
      consentId: grantRes.consentId,
      reason: 'Mortgage refinance closed; third party access withdrawn'
    }, { firestoreDb: db, auditLogger: audit });

    assert.equal(revokeRes.success, true);
    assert.equal(revokeRes.status, 'revoked');

    const updated = await db.collection('consents').doc(grantRes.consentId).get();
    assert.equal(updated.data().status, 'revoked');

    const log = audit.events.find(e => e.eventType === 'CONSENT_REVOKED');
    assert.ok(log);
  });

  test('verifyActiveConsent blocks tax information release when consent is missing or revoked', async () => {
    const db = new MockFirestoreDb();
    const audit = new MockAuditLogger();

    // 1. Check unconsented
    const unconsented = await verifyActiveConsentHandler({
      clientUid: 'usr_brennan_llc',
      consentType: 'disclosure_third_party',
      taxYear: 2026
    }, { firestoreDb: db });
    assert.equal(unconsented.allowed, false);

    // 2. Grant and verify allowed
    const clientContext = { uid: 'usr_brennan_llc', role: 'client' };
    const grantRes = await grantConsentHandler({
      context: clientContext,
      consentData: {
        clientUid: 'usr_brennan_llc',
        taxYear: 2026,
        consentType: 'disclosure_third_party',
        warningAcknowledged: true
      }
    }, { firestoreDb: db, auditLogger: audit });

    const verified = await verifyActiveConsentHandler({
      clientUid: 'usr_brennan_llc',
      consentType: 'disclosure_third_party',
      taxYear: 2026
    }, { firestoreDb: db });
    assert.equal(verified.allowed, true);

    // 3. Revoke and verify blocked
    await revokeConsentHandler({
      context: clientContext,
      consentId: grantRes.consentId
    }, { firestoreDb: db, auditLogger: audit });

    const postRevoke = await verifyActiveConsentHandler({
      clientUid: 'usr_brennan_llc',
      consentType: 'disclosure_third_party',
      taxYear: 2026
    }, { firestoreDb: db });
    assert.equal(postRevoke.allowed, false);
    assert.equal(postRevoke.status, 'revoked');
  });
});

describe('2. IRS Pub 1345 § 6 & Form 8879 Statutory Retention Lock', () => {
  test('Form 8879 signature package within 3-year statutory custody is strictly locked from purging', () => {
    // 1 year old signed Form 8879
    const createdDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const schedule = evaluateRetentionScheduleHandler('form_8879_signature', createdDate);

    assert.equal(schedule.immutableWorm, true);
    assert.equal(schedule.purgeEligible, false);
    assert.equal(schedule.legalHoldActive, true);
    assert.match(schedule.complianceNote, /IRS Pub 1345 § 6 Lock Active/);
  });

  test('Form 8879 that has satisfied 3 statutory years is eligible for scheduled archival', () => {
    // 3.5 years old signed Form 8879
    const createdDate = new Date(Date.now() - 3.5 * 365.25 * 24 * 60 * 60 * 1000).toISOString();
    const schedule = evaluateRetentionScheduleHandler('form_8879_signature', createdDate);

    assert.equal(schedule.purgeEligible, true);
    assert.equal(schedule.legalHoldActive, false);
  });

  test('Disposal attempt on locked Form 8879 is BLOCKED with FAILED_PRECONDITION', async () => {
    const db = new MockFirestoreDb();
    const audit = new MockAuditLogger();

    const adminContext = { uid: 'usr_admin_managing_partner', role: 'firm_admin', mfaVerified: true };
    const recentDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();

    const res = await executeSecureDisposalHandler({
      context: adminContext,
      targetRecordId: 'sig_env_whitfield_2026',
      recordType: 'form_8879_signature',
      recordCreatedIso: recentDate
    }, { firestoreDb: db, auditLogger: audit });

    assert.equal(res.success, false);
    assert.equal(res.error.code, 'failed_precondition');
    assert.match(res.error.message, /DISPOSAL BLOCKED/);
  });
});

describe('3. FTC Safeguards Rule 16 CFR § 314.4 Secure Disposal & NIST SP 800-88', () => {
  test('Customer financial records evaluate disposal mandate at 2-year post-engagement closure', () => {
    // File closed 2.5 years ago
    const schedule = evaluateRetentionScheduleHandler('customer_financial_records', new Date().toISOString(), {
      engagementClosedYears: 2.5
    });

    assert.equal(schedule.purgeEligible, true);
    assert.match(schedule.complianceNote, /FTC Safeguards Rule 16 CFR § 314.4\(c\)\(6\)\(i\) Mandate/);
  });

  test('Only Firm Administrator with verified MFA can execute authorized secure disposal', async () => {
    const db = new MockFirestoreDb();
    const audit = new MockAuditLogger();

    // 1. Preparer tries to execute disposal -> BLOCKED
    const prepContext = { uid: 'usr_prep_denise', role: 'firm_preparer', mfaVerified: true };
    const oldDate = new Date(Date.now() - 4 * 365.25 * 24 * 60 * 60 * 1000).toISOString();

    const prepRes = await executeSecureDisposalHandler({
      context: prepContext,
      targetRecordId: 'doc_old_w2_1998',
      recordType: 'customer_financial_records',
      recordCreatedIso: oldDate,
      options: { engagementClosedYears: 3 }
    }, { firestoreDb: db, auditLogger: audit });

    assert.equal(prepRes.success, false);
    assert.equal(prepRes.error.code, 'permission_denied');

    // 2. Admin without MFA tries to execute disposal -> BLOCKED
    const adminNoMfa = { uid: 'usr_admin', role: 'firm_admin', mfaVerified: false };
    const noMfaRes = await executeSecureDisposalHandler({
      context: adminNoMfa,
      targetRecordId: 'doc_old_w2_1998',
      recordType: 'customer_financial_records',
      recordCreatedIso: oldDate,
      options: { engagementClosedYears: 3 }
    }, { firestoreDb: db, auditLogger: audit });

    assert.equal(noMfaRes.success, false);
    assert.equal(noMfaRes.error.code, 'permission_denied');
    assert.match(noMfaRes.error.message, /MFA verification strictly required/);

    // 3. Admin WITH MFA authorizes disposal -> SUCCESS with cryptographic shred receipt
    const adminMfa = { uid: 'usr_admin', role: 'firm_admin', mfaVerified: true };
    const successRes = await executeSecureDisposalHandler({
      context: adminMfa,
      targetRecordId: 'doc_old_w2_1998',
      recordType: 'customer_financial_records',
      recordCreatedIso: oldDate,
      options: { engagementClosedYears: 3 }
    }, { firestoreDb: db, auditLogger: audit });

    assert.equal(successRes.success, true);
    assert.match(successRes.shredReceipt, /^SHRED_NIST800-88_/);

    const log = audit.events.find(e => e.eventType === 'SECURE_DISPOSAL_EXECUTED');
    assert.ok(log);
    assert.equal(log.targetId, 'doc_old_w2_1998');
  });
});
