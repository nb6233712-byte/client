/**
 * ============================================================================
 * CLIENT PORTAL DOCUMENT INTAKE & IDENTITY VERIFICATION UI TEST SUITE
 * Pivot Aide Tax / The File Room — Statutory Compliance & Client Experience
 * ============================================================================
 *
 * Verifies:
 * 1. Successful upload with separate stages (upload, vault, downstream) & receipt reference.
 * 2. Pending delivery showing document securely received ONLY when storage + registration confirmed.
 * 3. Network loss / offline before server registration stating pending synchronization and unconfirmed by server.
 * 4. Duplicate submission prevention during retries via in-flight mutex & stable idempotency keys.
 * 5. Rejected document displaying practitioner note and accessible replacement workflow.
 * 6. Failed or expired identity verification displaying server-confirmed status, plain language, and approved manual-signature alternative.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');

const docsJsPath = path.join(baseDir, 'js/client/documents.js');
const sigsJsPath = path.join(baseDir, 'js/client/signatures.js');
const docsJsCode = fs.readFileSync(docsJsPath, 'utf8');
const sigsJsCode = fs.readFileSync(sigsJsPath, 'utf8');

describe('Client Portal Document Intake & Verification Experience UI Suite', () => {
  let virtualWindow;
  let clientDocs;
  let clientSigs;
  let fetchCalls;
  let auditLogs;

  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;

  function setupVirtualEnv(isOnline = true, customFetchImpl = null) {
    fetchCalls = [];
    auditLogs = [];

    const mockFetch = customFetchImpl || (async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url.includes('forminit.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, formId: 'rv02anqc45x' }),
          text: async () => '{"success":true}'
        };
      }
      if (url.includes('intakeDocumentFallback')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            submissionId: 'sub_test_01',
            deliveryStatus: 'fallback_delivered',
            storageState: 'stored',
            registrationState: 'registered'
          }),
          text: async () => '{"success":true}'
        };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    });

    globalThis.fetch = mockFetch;
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: isOnline },
        configurable: true,
        writable: true
      });
    } catch (_) {}

    virtualWindow = {
      fetch: mockFetch,
      navigator: { onLine: isOnline },
      sessionStorage: {
        _store: {},
        getItem(k) { return this._store[k] || null; },
        setItem(k, v) { this._store[k] = String(v); },
        removeItem(k) { delete this._store[k]; }
      },
      localStorage: {
        _store: {},
        getItem(k) { return this._store[k] || null; },
        setItem(k, v) { this._store[k] = String(v); },
        removeItem(k) { delete this._store[k]; }
      },
      document: {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: (tag) => ({
          tag,
          style: {},
          setAttribute: () => {},
          addEventListener: () => {},
          click: () => {}
        }),
        body: { appendChild: () => {}, removeChild: () => {} }
      },
      FileRoomLayout: {
        showToast: (msg, type) => {},
        openModal: () => {},
        renderLoading: () => {}
      },
      FirebaseBridge: {
        getUserUid: () => 'usr_whitfield_4417',
        getUserName: () => 'Michael Whitfield',
        currentUser: {
          uid: 'usr_whitfield_4417',
          email: 'm.whitfield@example.com',
          displayName: 'Michael Whitfield',
          getIdToken: async () => 'mock_firebase_id_token'
        },
        db: {
          collection: () => ({ doc: () => ({ set: async () => {} }) })
        },
        doc: (db, col, id) => ({ db, col, id }),
        setDoc: async () => {},
        recordAuditLog: async (action, summary, category) => {
          auditLogs.push({ action, summary, category, timestamp: new Date().toISOString() });
        }
      }
    };

    const docFn = new Function('window', 'document', 'navigator', docsJsCode);
    docFn(virtualWindow, virtualWindow.document, virtualWindow.navigator);
    clientDocs = virtualWindow.ClientDocuments;

    const sigFn = new Function('window', 'document', 'navigator', sigsJsCode);
    sigFn(virtualWindow, virtualWindow.document, virtualWindow.navigator);
    clientSigs = virtualWindow.ClientSignatures;
  }

  beforeEach(() => {
    setupVirtualEnv(true);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
        writable: true
      });
    } catch (_) {}
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: SUCCESSFUL UPLOAD & 3-STAGE STATUS DISPLAY WITH RECEIPT
  // ──────────────────────────────────────────────────────────────────────────
  test('1. Successful Upload: Shows upload progress, vault storage, downstream status separately, and stable receipt reference', async () => {
    const validPdfBytes = [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37];
    const mockFile = {
      name: 'Form_W2_Whitfield.pdf',
      size: 512 * 1024,
      type: 'application/pdf',
      bytes: validPdfBytes
    };

    const result = await clientDocs.submitDocumentIntake({
      file: mockFile,
      requestId: 'req_w2_2026',
      doc: {
        id: 'req_w2_2026',
        requestId: 'req_w2_2026',
        title: 'Form W-2 Wage Statement',
        category: 'W-2',
        taxYear: 2026
      },
      skipStorageUpload: true,
      existingStoragePath: 'clients/usr_whitfield_4417/documents/req_w2_2026.pdf'
    });

    // Check pipeline return values
    assert.equal(result.success, true);
    assert.equal(result.storageState, 'stored');
    assert.equal(result.registrationState, 'registered');
    assert.equal(result.downstreamDelivery, 'forminit_delivered');
    assert.equal(result.serverConfirmed, true);
    assert.ok(result.receiptReference, 'Must generate a receipt reference');
    assert.ok(result.receiptReference.startsWith('REC-2026-'), 'Receipt format must start with REC-2026-');

    // Test UI row rendering with confirmed document
    const docItem = {
      id: 'req_w2_2026',
      requestId: 'req_w2_2026',
      title: 'Form W-2 Wage Statement',
      category: 'W-2',
      taxYear: 2026,
      status: 'uploaded',
      storageState: 'stored',
      registrationState: 'registered',
      downstreamDelivery: 'forminit_delivered',
      forminitStatus: 'sent',
      serverConfirmed: true,
      receiptReference: result.receiptReference
    };

    const rowHtml = clientDocs.renderDocumentRow(docItem);

    // Verify 3 distinct stage indicators are rendered separately
    assert.ok(rowHtml.includes('1. Upload: Complete'), 'Must display Stage 1 upload completion');
    assert.ok(rowHtml.includes('2. Vault Custody: Secured (AES-256)'), 'Must display Stage 2 AES-256 vault confirmation');
    assert.ok(rowHtml.includes('3. Downstream: Delivered (Forminit)'), 'Must display Stage 3 downstream transmission');

    // Verify stable receipt reference pill is displayed
    assert.ok(rowHtml.includes('Receipt: ' + result.receiptReference), 'Must display server-confirmed receipt pill');
    assert.ok(rowHtml.includes('receipt-pill'), 'Must include receipt pill class');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: PENDING DELIVERY ONLY SHOWN WHEN STORAGE + REGISTRATION SUCCEED
  // ──────────────────────────────────────────────────────────────────────────
  test('2. Pending Delivery: Displays secure vault reception only when storage and intake registration have succeeded', () => {
    // Case A: Storage and registration succeeded, downstream transmission is pending
    const docWithConfirmedVault = {
      id: 'req_1099_misc',
      requestId: 'req_1099_misc',
      title: 'Form 1099-MISC',
      category: '1099',
      taxYear: 2026,
      status: 'review',
      storageState: 'stored',
      registrationState: 'registered',
      serverConfirmed: true,
      downstreamDelivery: 'pending',
      forminitStatus: 'pending',
      receiptReference: 'REC-2026-MISC01'
    };

    const rowHtmlConfirmed = clientDocs.renderDocumentRow(docWithConfirmedVault);

    assert.ok(rowHtmlConfirmed.includes('1. Upload: Complete'));
    assert.ok(rowHtmlConfirmed.includes('2. Vault Custody: Secured (AES-256)'));
    assert.ok(rowHtmlConfirmed.includes('3. Downstream: Securely Received · Processing'));
    assert.ok(
      rowHtmlConfirmed.includes('Document Securely Received') &&
      rowHtmlConfirmed.includes('Downstream delivery processing continues'),
      'Must state document is securely received when vault storage and registration succeeded'
    );
    assert.ok(rowHtmlConfirmed.includes('Receipt: REC-2026-MISC01'), 'Must show receipt when server confirmed');

    // Case B: Storage failed or has not completed — must NOT claim secure reception or delivery
    const docWithoutConfirmedVault = {
      id: 'req_1099_unconfirmed',
      requestId: 'req_1099_unconfirmed',
      title: 'Form 1099-K',
      category: '1099',
      taxYear: 2026,
      status: 'pending',
      storageState: 'failed',
      registrationState: 'pending',
      serverConfirmed: false,
      downstreamDelivery: 'failed'
    };

    const rowHtmlUnconfirmed = clientDocs.renderDocumentRow(docWithoutConfirmedVault);
    assert.ok(!rowHtmlUnconfirmed.includes('Document Securely Received'), 'Must not claim secure reception when storage failed');
    assert.ok(!rowHtmlUnconfirmed.includes('Receipt: REC-'), 'Must not display server receipt when storage failed');
    assert.ok(rowHtmlUnconfirmed.includes('2. Vault Custody: Storage Failed'));
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: NETWORK LOSS / OFFLINE BEFORE SERVER REGISTRATION
  // ──────────────────────────────────────────────────────────────────────────
  test('3. Network Loss: Browser offline before server registration states submission is pending synchronization and unconfirmed', async () => {
    // Set environment to offline
    setupVirtualEnv(false);

    const validPdfBytes = [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37];
    const mockFile = {
      name: 'Form_1099_DIV.pdf',
      size: 256 * 1024,
      type: 'application/pdf',
      bytes: validPdfBytes
    };

    const result = await clientDocs.submitDocumentIntake({
      file: mockFile,
      requestId: 'req_1099_div',
      doc: {
        id: 'req_1099_div',
        requestId: 'req_1099_div',
        title: 'Form 1099-DIV',
        category: '1099',
        taxYear: 2026
      }
    });

    // Check return shape
    assert.equal(result.success, false);
    assert.equal(result.offlinePending, true);
    assert.equal(result.serverConfirmed, false);
    assert.equal(result.storageState, 'buffered_offline');
    assert.equal(result.registrationState, 'unconfirmed_offline');
    assert.match(result.message, /pending synchronization/i);
    assert.match(result.message, /not yet been confirmed by the server/i);

    // Verify UI Row Rendering during offline pending sync
    const offlineDoc = {
      id: 'req_1099_div',
      requestId: 'req_1099_div',
      title: 'Form 1099-DIV',
      category: '1099',
      status: 'pending_sync',
      isOfflinePending: true,
      storageState: 'buffered_offline',
      registrationState: 'unconfirmed_offline',
      downstreamDelivery: 'unconfirmed_offline'
    };

    const rowHtml = clientDocs.renderDocumentRow(offlineDoc);

    // Must clearly state submission is pending synchronization and NOT confirmed
    assert.ok(rowHtml.includes('Submission Pending Synchronization — Unconfirmed by Server'));
    assert.ok(rowHtml.includes('not yet been confirmed by the server'));
    assert.ok(rowHtml.includes('No delivery has occurred'));
    assert.ok(rowHtml.includes('Synchronize Now'), 'Must provide a Synchronize Now button');

    // Must NOT show false vault or receipt claims
    assert.ok(!rowHtml.includes('Receipt: REC-'), 'Must not display server-confirmed receipt when offline');
    assert.ok(rowHtml.includes('1. Upload: Buffered Offline'));
    assert.ok(rowHtml.includes('2. Vault Custody: Pending Synchronization'));
    assert.ok(rowHtml.includes('3. Downstream: Unconfirmed (Offline)'));
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: DUPLICATE SUBMISSION PREVENTION DURING RETRIES
  // ──────────────────────────────────────────────────────────────────────────
  test('4. Duplicate Submissions: In-flight mutex blocks concurrent submissions and safely retries with stable idempotency key', async () => {
    let callCount = 0;
    setupVirtualEnv(true, async (url, options = {}) => {
      fetchCalls.push({ url, options });
      callCount++;
      // Simulate artificial latency
      await new Promise(r => setTimeout(r, 50));
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, submissionId: 'sub_concurrent_01' }),
        text: async () => '{"success":true}'
      };
    });

    const mockFile = {
      name: 'Schedule_C.pdf',
      size: 300 * 1024,
      type: 'application/pdf',
      bytes: [0x25, 0x50, 0x44, 0x46]
    };

    // Dispatch two concurrent submission calls with the exact same request
    const p1 = clientDocs.submitDocumentIntake({
      file: mockFile,
      requestId: 'req_sched_c',
      clientUid: 'usr_whitfield_4417',
      taxYear: 2026,
      skipStorageUpload: true,
      existingStoragePath: 'clients/usr_whitfield_4417/documents/req_sched_c.pdf'
    });

    const p2 = clientDocs.submitDocumentIntake({
      file: mockFile,
      requestId: 'req_sched_c',
      clientUid: 'usr_whitfield_4417',
      taxYear: 2026,
      skipStorageUpload: true,
      existingStoragePath: 'clients/usr_whitfield_4417/documents/req_sched_c.pdf'
    });

    // Both should resolve to the exact same outcome
    const [res1, res2] = await Promise.all([p1, p2]);

    assert.equal(res1.success, true);
    assert.equal(res2.success, true);
    assert.equal(res1.idempotencyKey, res2.idempotencyKey);
    // Because p2 joined the in-flight promise of p1, fetch was only called once for Forminit
    const forminitCalls = fetchCalls.filter(c => c.url.includes('forminit.com'));
    assert.equal(forminitCalls.length, 1, 'Concurrent duplicate submissions must be coalesced into 1 request');

    // Safe Retry verification
    assert.ok(typeof clientDocs.safeClientRetry === 'function', 'Must provide safeClientRetry method');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: REJECTED DOCUMENT DISPLAY & ACTIONABLE REPLACEMENT
  // ──────────────────────────────────────────────────────────────────────────
  test('5. Rejected Document: Explains rejection in plain language and provides replacement workflow', () => {
    const rejectedDoc = {
      id: 'req_1098_mortgage',
      requestId: 'req_1098_mortgage',
      title: 'Form 1098 Mortgage Interest Statement',
      category: '1098',
      taxYear: 2026,
      status: 'rejected',
      rejectionReason: 'The scanned document is missing Box 1 (Mortgage interest received) and Box 2 (Outstanding principal). Please provide complete page 1.'
    };

    const rowHtml = clientDocs.renderDocumentRow(rejectedDoc);

    // Assert status pill
    assert.ok(rowHtml.includes('Resubmission Needed'));

    // Assert rejection explanation in plain language
    assert.ok(rowHtml.includes('CPA Review Note:'));
    assert.ok(rowHtml.includes('missing Box 1'));
    assert.ok(rowHtml.includes('Please provide complete page 1'));

    // Assert actionable replacement button
    assert.ok(rowHtml.includes('Replace &amp; Resubmit Document') || rowHtml.includes('Replace & Resubmit Document'));
    assert.ok(rowHtml.includes('Prior PDF'));

    // Assert zero raw stack traces or internal errors
    assert.ok(!rowHtml.includes('TypeError'));
    assert.ok(!rowHtml.includes('NullPointerException'));
    assert.ok(!rowHtml.includes('stack'));
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: IDENTITY VERIFICATION: SERVER-CONFIRMED, FAILED/EXPIRED & MANUAL SIGNATURE
  // ──────────────────────────────────────────────────────────────────────────
  test('6. Identity Verification: Shows server-confirmed status, plain language failure/expiry, and 4-step manual signature', () => {
    clientSigs.loadSignaturesData('usr_whitfield_4417');

    // Case A: Primary signer has failed attempt (1 attempt remaining)
    clientSigs.state.signingRequest.signers[0].kbaStatus = 'failed';
    // Case B: Spouse signer session expired
    clientSigs.state.signingRequest.signers[1].kbaStatus = 'expired';

    const cardsHtml = clientSigs.renderDualSignerCards(clientSigs.state.signingRequest);

    // Verify Server-Confirmed Status Badges
    assert.ok(cardsHtml.includes('Server Confirmed: Verification Unsuccessful (1 Attempt Remaining)'));
    assert.ok(cardsHtml.includes('Server Confirmed: Session Expired'));

    // Verify Plain Language Explanations
    assert.ok(
      cardsHtml.includes('We were unable to verify your identity with the responses provided') &&
      cardsHtml.includes('you have 1 remaining attempt'),
      'Must explain failed verification in plain language with attempt count'
    );
    assert.ok(
      cardsHtml.includes('120-second security limit') &&
      cardsHtml.includes('protect your sensitive tax data'),
      'Must explain session expiry in plain language with security timeout explanation'
    );

    // Verify absence of sensitive data, raw risk scores, or provider secrets
    assert.ok(!cardsHtml.includes('risk_score'), 'Never expose raw risk scores');
    assert.ok(!cardsHtml.includes('bureau_mismatch'), 'Never expose provider risk factors');
    assert.ok(!cardsHtml.includes('SSN'), 'Never show unmasked SSN');

    // Verify Approved Manual Wet-Ink Signature Alternative
    const wetSigCardHtml = clientSigs.renderWetSignatureCard(clientSigs.state.signingRequest);
    assert.ok(wetSigCardHtml.includes('Physical Handwritten (Wet-Ink) Form 8879 Execution'));
    assert.ok(wetSigCardHtml.includes('APPROVED MANUAL SIGNATURE INSTRUCTIONS (IRS PUB 1345 § 5.2.2)'));
    assert.ok(wetSigCardHtml.includes('1. Download Form 8879'));
    assert.ok(wetSigCardHtml.includes('2. Physical Pen Signature'));
    assert.ok(wetSigCardHtml.includes('3. Scan or Photograph'));
    assert.ok(wetSigCardHtml.includes('4. Upload to Vault'));
    assert.ok(wetSigCardHtml.includes('btn-download-form8879'));
    assert.ok(wetSigCardHtml.includes('href="documents.html"'));
  });
});
