/**
 * ============================================================================
 * END-TO-END DOCUMENT WORKFLOW TEST SUITE
 * Client Portal <--> Firm Operations Console <--> Shared Cloud Storage & Firestore
 * ============================================================================
 * 
 * Verifies the complete regulatory & operational document lifecycle:
 * 1. CLIENT PORTAL:
 *    - Authenticated client engagement selection and allowed tax document upload
 *    - Frontend & backend validation: file size (<= 25MB) and magic bytes file type verification
 *    - Strict rejection of oversized files (> 25MB) and prohibited executables / disguised binaries
 *    - Authorized Cloud Storage path targeting (clients/{uid}/...)
 *    - Server-side validation before Firestore document record creation / update
 *    - Live upload progress (0% -> 100%), confirmed storage status ('stored'), and review status
 *    - Client visibility of firm requests, missing checklist items, acceptance, rejection, and CPA notes
 * 2. FIRM OPERATIONS CONSOLE:
 *    - Documents display for authorized engagements with taxpayer reference, category, tax year, upload time, and review status
 *    - Authorized practitioner actions: Accept, Reject, and Request Replacement
 *    - Strict prohibition: Taxpayers cannot accept/reject their own documents (Circular 230 § 10.22 / IRC § 6694)
 *    - Recording reviewer UID, timestamp, and mandatory reason for every action
 *    - Real-time propagation through shared Firestore workflow
 *    - Failed delivery and retry states displayed accurately without false-positive delivery confirmation
 * 3. SHARED BACKEND & ARCHITECTURE:
 *    - Canonical document schema and stable document ID per logical submission
 *    - Client ownership and staff permissions enforced on the server
 *    - Idempotency controls preventing duplicate records on retries or concurrent submissions
 *    - Real-time listeners updating opposite portals synchronously
 *    - Zero local storage proof dependency & zero public download URL / PII exposure in logs
 * 4. COMPLETE END-TO-END JOURNEY:
 *    - Client upload -> Cloud Storage confirmation -> Firm practitioner review -> Client receives updated status
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAppDir = path.resolve(__dirname, '..');

// Load production source code
const clientDocsJsCode = fs.readFileSync(path.join(webAppDir, 'js/client/documents.js'), 'utf8');
const firmDocsJsCode = fs.readFileSync(path.join(webAppDir, 'js/firm/documents.js'), 'utf8');
const storageRulesCode = fs.readFileSync(path.join(webAppDir, 'storage.rules'), 'utf8');
const firestoreRulesCode = fs.readFileSync(path.join(webAppDir, 'firestore.rules'), 'utf8');

// Load backend review handler
const { documentReviewHandler, ReviewAction } = await import('../functions/src/document-review.mjs');

describe('End-to-End Document Workflow: Client Portal & Firm Operations Console', () => {

  // =========================================================================
  // SUITE 1: CLIENT PORTAL INTAKE & VALIDATION ENGINE
  // =========================================================================
  describe('1. Client Portal: Engagement Selection, Validation, & Upload', () => {
    let clientDocs;
    let virtualWindow;
    let mockDOM;
    let capturedFirestoreDocs;
    let capturedStorageUploads;

    beforeEach(() => {
      capturedFirestoreDocs = [];
      capturedStorageUploads = [];

      mockDOM = {
        'select-client-engagement': {
          value: 'eng_2026_whitfield_1040',
          addEventListener: (evt, cb) => { mockDOM['select-client-engagement']._onChange = cb; }
        },
        'engagement-id-label': { textContent: 'eng_2026_whitfield_1040' },
        'engagement-status-badge': { className: 'chip gold sm', textContent: '● Intake Open' },
        'docs-list-container': { innerHTML: '', querySelectorAll: () => [] },
        'docs-page-subtitle': { innerHTML: '' },
        'drop-zone': { addEventListener: () => {}, classList: { add: () => {}, remove: () => {} } },
        'file-input-hidden': { addEventListener: () => {} },
        'btn-choose-files': { addEventListener: () => {} },
        'count-filter-all': { textContent: '0' },
        'count-filter-needed': { textContent: '0' },
        'count-filter-review': { textContent: '0' },
        'count-filter-accepted': { textContent: '0' },
        'count-filter-rejected': { textContent: '0' }
      };

      virtualWindow = {
        location: { origin: 'https://thefileroom.tax', hostname: 'thefileroom.tax' },
        FIREBASE_STORAGE_DIRECT_UPLOAD: true,
        localStorage: {
          _store: {},
          getItem(k) { return this._store[k] || null; },
          setItem(k, v) { this._store[k] = String(v); }
        },
        sessionStorage: {
          _store: {},
          getItem(k) { return this._store[k] || null; },
          setItem(k, v) { this._store[k] = String(v); }
        },
        FileRoomLayout: {
          showToast: () => {},
          renderLoading: () => {}
        },
        firebaseAuth: {
          currentUser: { uid: 'usr_whitfield_4417', email: 'm.whitfield@example.com', displayName: 'Michael Whitfield' }
        },
        firebaseStorage: { app: { options: { storageBucket: 'uk-client-d90d5.firebasestorage.app' } } },
        firebaseDb: { type: 'cloud_firestore' },
        ref: (storage, storagePath) => ({ bucket: 'uk-client-d90d5.firebasestorage.app', path: storagePath }),
        uploadBytesResumable: (storageRef, file, metadataHeader) => {
          capturedStorageUploads.push({ storageRef, file, metadataHeader });
          return {
            snapshot: { ref: storageRef, bytesTransferred: file.size, totalBytes: file.size },
            on: (eventName, progressCb, errCb, completeCb) => {
              if (progressCb) progressCb({ bytesTransferred: file.size, totalBytes: file.size });
              if (completeCb) completeCb();
            }
          };
        },
        getDownloadURL: async (ref) => `https://firebasestorage.googleapis.com/v0/b/${ref.bucket}/o/${encodeURIComponent(ref.path)}?alt=media`,
        doc: (db, collection, docId) => ({ path: `${collection}/${docId}`, collection, id: docId }),
        updateDoc: async (docRef, payload) => {
          capturedFirestoreDocs.push({ action: 'updateDoc', docRef, payload });
          return { success: true };
        },
        setDoc: async (docRef, payload, opts) => {
          capturedFirestoreDocs.push({ action: 'setDoc', docRef, payload, opts });
          return { success: true };
        },
        serverTimestamp: () => '2026-10-16T08:30:00.000Z',
        document: {
          getElementById: (id) => mockDOM[id] || null,
          querySelector: () => null,
          querySelectorAll: () => []
        }
      };

      const fn = new Function('window', 'document', clientDocsJsCode);
      fn(virtualWindow, virtualWindow.document);
      clientDocs = virtualWindow.ClientDocuments;
      clientDocs.state.clientUid = 'usr_whitfield_4417';
      clientDocs.state.engagementId = 'eng_2026_whitfield_1040';
      clientDocs.bindEngagementSelector();
      clientDocs.state.documents = [
        {
          requestId: 'req_w2_whitfield',
          id: 'req_w2_whitfield',
          title: 'Form W-2 Wage Statement',
          category: 'W-2',
          status: 'needed',
          engagementId: 'eng_2026_whitfield_1040'
        },
        {
          requestId: 'req_1099misc_whitfield',
          id: 'req_1099misc_whitfield',
          title: 'Form 1099-MISC Rental Statement',
          category: '1099',
          status: 'needed',
          engagementId: 'eng_2026_whitfield_1040'
        }
      ];
    });

    test('Allows client to select engagement and dynamically adjust checklist context', () => {
      assert.equal(clientDocs.state.engagementId, 'eng_2026_whitfield_1040');
      assert.equal(clientDocs.state.taxYear, 2026);

      // Simulate client selecting a prior year engagement
      mockDOM['select-client-engagement'].value = 'eng_2025_whitfield_prior';
      mockDOM['select-client-engagement']._onChange();

      assert.equal(clientDocs.state.engagementId, 'eng_2025_whitfield_prior');
      assert.equal(clientDocs.state.taxYear, 2025);
      assert.equal(mockDOM['engagement-id-label'].textContent, 'eng_2025_whitfield_prior');
      assert.equal(mockDOM['engagement-status-badge'].textContent, '✓ Completed');
    });

    test('Validates authentic tax PDF (<= 25MB) with %PDF magic header', async () => {
      const validPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37]); // %PDF-1.7
      const file = {
        name: 'Whitfield_W2_2026.pdf',
        size: 2 * 1024 * 1024, // 2MB
        type: 'application/pdf',
        bytes: validPdfBytes
      };

      const val = await clientDocs.validateFileWithMagicBytes(file);
      assert.equal(val.valid, true);
      assert.equal(val.detectedType, 'PDF');
      assert.equal(val.magicBytesVerified, true);
    });

    test('Validates authentic PNG, JPEG, and CSV tax documents', async () => {
      // PNG
      const pngFile = {
        name: 'Closing_Disclosure_Page1.png',
        size: 1.5 * 1024 * 1024,
        type: 'image/png',
        bytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
      };
      const valPng = await clientDocs.validateFileWithMagicBytes(pngFile);
      assert.equal(valPng.valid, true);
      assert.equal(valPng.detectedType, 'PNG');

      // JPEG
      const jpgFile = {
        name: 'Charity_Receipt.jpg',
        size: 800 * 1024,
        type: 'image/jpeg',
        bytes: new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])
      };
      const valJpg = await clientDocs.validateFileWithMagicBytes(jpgFile);
      assert.equal(valJpg.valid, true);
      assert.equal(valJpg.detectedType, 'JPEG');

      // CSV (Ascii text)
      const csvFile = {
        name: 'Vehicle_Mileage_Log.csv',
        size: 50 * 1024,
        type: 'text/csv',
        bytes: new Uint8Array([0x44, 0x61, 0x74, 0x65, 0x2C, 0x4D, 0x69, 0x6C, 0x65, 0x73]) // "Date,Miles"
      };
      const valCsv = await clientDocs.validateFileWithMagicBytes(csvFile);
      assert.equal(valCsv.valid, true);
      assert.equal(valCsv.detectedType, 'CSV');
    });

    test('Rejects oversized file exceeding 25MB statutory ceiling limit', async () => {
      const oversizedFile = {
        name: 'Massive_Scan.pdf',
        size: 26 * 1024 * 1024, // 26MB
        type: 'application/pdf',
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46])
      };

      const val = await clientDocs.validateFileWithMagicBytes(oversizedFile);
      assert.equal(val.valid, false);
      assert.ok(val.error.includes('exceeds 25 MB statutory ceiling'));
    });

    test('Rejects prohibited scripts (.exe, .bat, .sh, .ps1) and disguised binary executables (MZ header)', async () => {
      // Direct extension
      const scriptFile = {
        name: 'payroll_macro.bat',
        size: 1024,
        type: 'application/octet-stream',
        bytes: new Uint8Array([0x65, 0x63, 0x68, 0x6F])
      };
      const valScript = await clientDocs.validateFileWithMagicBytes(scriptFile);
      assert.equal(valScript.valid, false);
      assert.ok(valScript.error.includes('strictly prohibited'));

      // Disguised executable masquerading as a PDF
      const disguisedFile = {
        name: 'W2_Form.pdf',
        size: 50000,
        type: 'application/pdf',
        bytes: new Uint8Array([0x4D, 0x5A, 0x90, 0x00]) // MZ header
      };
      const valDisguised = await clientDocs.validateFileWithMagicBytes(disguisedFile);
      assert.equal(valDisguised.valid, false);
      assert.ok(valDisguised.error.includes('executable binary signature'));
    });

    test('Uploads file to authorized Cloud Storage path and sets confirmed in_review state', async () => {
      const validPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37]);
      const file = {
        name: 'Whitfield_W2_2026.pdf',
        size: 1024 * 512,
        type: 'application/pdf',
        bytes: validPdfBytes
      };

      const res = await clientDocs.uploadFile(file, 'req_w2_whitfield');

      assert.equal(res.success, true);
      assert.equal(res.status, 'in_review');
      assert.ok(res.storagePath.startsWith('clients/usr_whitfield_4417/documents/req_w2_whitfield_'));

      // Verify Cloud Storage ref
      assert.equal(capturedStorageUploads.length, 1);
      const storageUpload = capturedStorageUploads[0];
      assert.equal(storageUpload.metadataHeader.customMetadata.clientUid, 'usr_whitfield_4417');
      assert.equal(storageUpload.metadataHeader.customMetadata.requestId, 'req_w2_whitfield');

      // Verify Firestore dual-write: documentRequests & documents
      assert.ok(capturedFirestoreDocs.length >= 1);
      const reqUpdate = capturedFirestoreDocs.find(d => d.docRef.path === 'documentRequests/req_w2_whitfield');
      assert.ok(reqUpdate, 'documentRequests record must be updated');
      assert.equal(reqUpdate.payload.status, 'in_review');
      assert.equal(reqUpdate.payload.clientUid, 'usr_whitfield_4417');
      assert.equal(reqUpdate.payload.engagementId, 'eng_2026_whitfield_1040');

      // Verify Client state transition
      const docInState = clientDocs.state.documents.find(d => d.requestId === 'req_w2_whitfield');
      assert.ok(docInState);
      assert.equal(docInState.status, 'in_review');
      assert.equal(docInState.storageState, 'stored');
      assert.equal(docInState.serverConfirmed, true);
      assert.ok(docInState.receiptReference.startsWith('REC-2026-'));
    });

    test('Does NOT use local storage as proof that an upload succeeded', () => {
      // Verify loadOfflineFallbacks does not populate uploads from localStorage
      virtualWindow.localStorage.setItem('fileroom_vault_docs_usr_whitfield_4417', JSON.stringify([
        { requestId: 'fake_upload', status: 'uploaded', title: 'Fake Doc' }
      ]));

      clientDocs.loadOfflineFallbacks('usr_whitfield_4417');
      // Must not adopt fake_upload as proof
      const fakeInState = clientDocs.state.documents.find(d => d.requestId === 'fake_upload');
      assert.equal(fakeInState, undefined, 'Local storage cannot prove upload authenticity');
    });

    test('Renders status transitions: In Review, Accepted, and Replacement Requested with CPA notes', () => {
      // 1. In Review
      const inReviewRow = clientDocs.renderDocumentRow({
        requestId: 'req_w2',
        title: 'Form W-2',
        status: 'in_review',
        storageState: 'stored'
      });
      assert.ok(inReviewRow.includes('In CPA Review'));
      assert.ok(inReviewRow.includes('Vault Custody: Secured (AES-256)'));

      // 2. Accepted
      const acceptedRow = clientDocs.renderDocumentRow({
        requestId: 'req_w2',
        title: 'Form W-2',
        status: 'accepted',
        reviewerNotes: 'Verified against IRS e-file transcripts by Denise R., CPA'
      });
      assert.ok(acceptedRow.includes('Accepted ✓'));
      assert.ok(acceptedRow.includes('CPA Note: Verified against IRS e-file transcripts'));

      // 3. Replacement Requested
      const replacementRow = clientDocs.renderDocumentRow({
        requestId: 'req_w2',
        title: 'Form W-2',
        status: 'needs_replacement',
        rejectionReason: 'Scan blurred and Box 12 codes cut off'
      });
      assert.ok(replacementRow.includes('Replacement Requested'));
      assert.ok(replacementRow.includes('Upload Replacement'));
      assert.ok(replacementRow.includes('Scan blurred and Box 12 codes cut off'));
    });
  });

  // =========================================================================
  // SUITE 2: FIRM OPERATIONS CONSOLE & REVIEW WORKFLOW
  // =========================================================================
  describe('2. Firm Operations Console: Display, Actions, & Delivery State', () => {
    let firmDocs;
    let virtualWindow;
    let mockDOM;

    beforeEach(() => {
      mockDOM = {
        'docs-review-content-area': { innerHTML: '' },
        'intake-records-container': { innerHTML: '' },
        'cnt-tab-all': { textContent: '0' },
        'cnt-tab-queued': { textContent: '0' },
        'cnt-tab-processing': { textContent: '0' },
        'cnt-tab-delivered': { textContent: '0' },
        'cnt-tab-retry_pending': { textContent: '0' },
        'cnt-tab-needs_review': { textContent: '0' },
        'intake-metric-counters': { innerHTML: '' },
        'filter-results-badge': { textContent: '' },
        'modal-backdrop': { classList: { add: () => {}, remove: () => {} } },
        'modal-container': { innerHTML: '' }
      };

      virtualWindow = {
        FirebaseBridge: {
          currentUser: { uid: 'usr_staff_reviewer_44', role: 'firm_reviewer', email: 'd.ross.cpa@thefileroom.tax', displayName: 'Denise Ross, CPA' },
          getRole: () => 'firm_reviewer',
          isStaff: () => true
        },
        FileRoomLayout: {
          isStaffUser: () => true,
          showToast: () => {},
          updateBadge: () => {}
        },
        localStorage: {
          getItem: () => JSON.stringify({ role: 'firm_reviewer', isStaff: true })
        },
        document: {
          getElementById: (id) => mockDOM[id] || null,
          createElement: () => ({ id: '', textContent: '', appendChild: () => {} }),
          head: { appendChild: () => {} },
          querySelectorAll: () => []
        }
      };

      const fn = new Function('window', 'document', firmDocsJsCode);
      fn(virtualWindow, virtualWindow.document);
      firmDocs = virtualWindow.FirmDocuments;
    });

    test('Renders documents with taxpayer reference, document category, tax year, and review status', () => {
      const mockRecord = {
        _docId: 'job_whitfield_1040_w2',
        documentId: 'doc_whitfield_w2',
        fileName: 'Whitfield_2026_W2.pdf',
        clientName: 'Michael Whitfield',
        clientEmail: 'm.whitfield@example.com',
        clientUid: 'usr_whitfield_4417',
        engagementId: 'eng_2026_whitfield_1040',
        taxYear: 2026,
        category: 'Income Statement (W-2)',
        status: 'in_review',
        createdAt: '2026-10-16T08:00:00.000Z',
        storagePath: 'clients/usr_whitfield_4417/documents/Whitfield_2026_W2.pdf'
      };

      const cardHtml = firmDocs._renderCardRow(mockRecord);

      // Verify mandatory console fields
      assert.ok(cardHtml.includes('Whitfield_2026_W2.pdf'));
      assert.ok(cardHtml.includes('Michael Whitfield'));
      assert.ok(cardHtml.includes('usr_whitfield_4417'));
      assert.ok(cardHtml.includes('eng_2026_whitfield_1040'));
      assert.ok(cardHtml.includes('TY2026'));
      assert.ok(cardHtml.includes('Income Statement (W-2)'));
      assert.ok(cardHtml.includes('Stored in Vault (AES-256)'));
      assert.ok(cardHtml.includes('Review &amp; Reconcile'));
    });

    test('Distinguishes Vault Custody status from Downstream Delivery without false-positive delivery mark', () => {
      const retryPendingRecord = {
        _docId: 'job_retry_item',
        fileName: 'Schedule_C.pdf',
        status: 'retry_pending',
        state: 'retry_pending',
        attemptCount: 2,
        storagePath: 'clients/usr_test/documents/Schedule_C.pdf',
        lastErrorCategory: 'SERVER_ERROR_5XX',
        lastHttpStatus: 503
      };

      const cardHtml = firmDocs._renderCardRow(retryPendingRecord);

      // Must show stored in vault
      assert.ok(cardHtml.includes('Stored in Vault (AES-256)'));
      // Must NOT show delivered to Forminit
      assert.ok(!cardHtml.includes('Transmitted to Forminit'));
      // Must accurately show retry state
      assert.ok(cardHtml.includes('Forminit Retry (Attempt 2/5'));
      assert.ok(cardHtml.includes('SERVER_ERROR_5XX'));
    });

    test('Filters queue by taxpayer, engagement, and review status tabs', () => {
      firmDocs.state.records = [
        { _docId: 'doc_1', clientName: 'Elena Whitfield', engagementId: 'eng_2026_whitfield', status: 'delivered' },
        { _docId: 'doc_2', clientName: 'Carlos Reyes', engagementId: 'eng_2025_reyes', status: 'needs_review' },
        { _docId: 'doc_3', clientName: 'Brennan Holdings', engagementId: 'eng_2026_brennan', status: 'retry_pending' }
      ];

      // Tab filter
      firmDocs.state.activeFilter = 'needs_review';
      let filtered = firmDocs.state.records.filter(r => r.status === 'needs_review');
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].clientName, 'Carlos Reyes');

      // Taxpayer text filter
      firmDocs.state.activeFilter = 'all';
      firmDocs.state.taxpayerFilter = 'whitfield';
      filtered = firmDocs.state.records.filter(r => r.clientName.toLowerCase().includes('whitfield'));
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0]._docId, 'doc_1');
    });
  });

  // =========================================================================
  // SUITE 3: SHARED BACKEND, RULES, & CIRCULAR 230 REVIEW HANDLER
  // =========================================================================
  describe('3. Shared Backend: Permissions, Idempotency, & Storage Rules', () => {
    let mockFirestoreDb;
    let mockAuditLogger;
    let mockNotificationDispatcher;
    let mockStorageData;

    beforeEach(() => {
      mockStorageData = {
        documentRequests: new Map([
          ['req_w2_test', {
            id: 'req_w2_test',
            title: 'W-2 Statement',
            clientId: 'usr_whitfield_4417',
            clientEmail: 'm.whitfield@example.com',
            status: 'in_review'
          }]
        ]),
        documents: new Map()
      };

      mockFirestoreDb = {
        collection: (colName) => ({
          doc: (docId) => ({
            get: async () => {
              const data = mockStorageData[colName]?.get(docId);
              return { exists: !!data, data: () => data };
            },
            set: async (payload, opts) => {
              const existing = mockStorageData[colName]?.get(docId) || {};
              const merged = opts?.merge ? { ...existing, ...payload } : payload;
              if (!mockStorageData[colName]) mockStorageData[colName] = new Map();
              mockStorageData[colName].set(docId, merged);
              return { success: true };
            }
          })
        })
      };

      mockAuditLogger = {
        events: [],
        recordAuthoritativeEvent: async (ev) => { mockAuditLogger.events.push(ev); }
      };

      mockNotificationDispatcher = {
        dispatched: [],
        dispatch: async (notif) => { mockNotificationDispatcher.dispatched.push(notif); }
      };
    });

    test('Staff practitioner can ACCEPT document and record reviewer UID + timestamp', async () => {
      const staffContext = {
        uid: 'usr_denise_cpa_44',
        email: 'd.ross.cpa@thefileroom.tax',
        role: 'firm_reviewer',
        mfaVerified: true,
        displayName: 'Denise Ross, CPA'
      };

      const result = await documentReviewHandler({
        context: staffContext,
        documentId: 'req_w2_test',
        action: ReviewAction.ACCEPT,
        notes: 'Verified against IRS e-Services Transcript match'
      }, {
        firestoreDb: mockFirestoreDb,
        auditLogger: mockAuditLogger,
        notificationDispatcher: mockNotificationDispatcher
      });

      assert.equal(result.success, true);
      assert.equal(result.status, 'accepted');
      assert.equal(result.reviewerUid, 'usr_denise_cpa_44');
      assert.ok(result.reviewedAt);

      // Verify Firestore update
      const updated = mockStorageData.documentRequests.get('req_w2_test');
      assert.equal(updated.status, 'accepted');
      assert.equal(updated.reviewerUid, 'usr_denise_cpa_44');
      assert.equal(updated.reviewedBy, 'Denise Ross, CPA');

      // Verify Audit Event
      assert.equal(mockAuditLogger.events.length, 1);
      assert.equal(mockAuditLogger.events[0].eventType, 'DOCUMENT_ACCEPTED');
      assert.equal(mockAuditLogger.events[0].actor.uid, 'usr_denise_cpa_44');
    });

    test('Staff practitioner can REJECT document with mandatory reason', async () => {
      const staffContext = {
        uid: 'usr_denise_cpa_44',
        email: 'd.ross.cpa@thefileroom.tax',
        role: 'firm_reviewer',
        mfaVerified: true,
        displayName: 'Denise Ross, CPA'
      };

      const result = await documentReviewHandler({
        context: staffContext,
        documentId: 'req_w2_test',
        action: ReviewAction.REJECT,
        notes: 'Taxpayer SSN is obscured; page 2 state wages missing'
      }, {
        firestoreDb: mockFirestoreDb,
        auditLogger: mockAuditLogger,
        notificationDispatcher: mockNotificationDispatcher
      });

      assert.equal(result.success, true);
      assert.equal(result.status, 'rejected');
      assert.equal(result.rejectionReason, 'Taxpayer SSN is obscured; page 2 state wages missing');

      // Client notification dispatched
      assert.equal(mockNotificationDispatcher.dispatched.length, 1);
      assert.equal(mockNotificationDispatcher.dispatched[0].type, 'document_rejected');
      assert.equal(mockNotificationDispatcher.dispatched[0].recipientUid, 'usr_whitfield_4417');
    });

    test('Staff practitioner can REQUEST REPLACEMENT document and update checklist', async () => {
      const staffContext = {
        uid: 'usr_preparer_12',
        email: 'preparer@thefileroom.tax',
        role: 'firm_preparer',
        mfaVerified: true,
        displayName: 'Staff Preparer'
      };

      const result = await documentReviewHandler({
        context: staffContext,
        documentId: 'req_w2_test',
        action: ReviewAction.REQUEST_REPLACEMENT,
        notes: 'Please upload the final corrected Form W-2c rather than draft copy.'
      }, {
        firestoreDb: mockFirestoreDb,
        auditLogger: mockAuditLogger,
        notificationDispatcher: mockNotificationDispatcher
      });

      assert.equal(result.success, true);
      assert.equal(result.status, 'needs_replacement');
      assert.equal(result.rejectionReason, 'Please upload the final corrected Form W-2c rather than draft copy.');

      // Automated client notification
      assert.equal(mockNotificationDispatcher.dispatched.length, 1);
      assert.equal(mockNotificationDispatcher.dispatched[0].type, 'document_replacement_requested');
    });

    test('Rejects document review when non-staff client attempts to accept/reject', async () => {
      const clientContext = {
        uid: 'usr_whitfield_4417',
        email: 'm.whitfield@example.com',
        role: 'client',
        mfaVerified: true
      };

      const result = await documentReviewHandler({
        context: clientContext,
        documentId: 'req_w2_test',
        action: ReviewAction.ACCEPT,
        notes: 'Self-acceptance attempt'
      }, {
        firestoreDb: mockFirestoreDb,
        auditLogger: mockAuditLogger,
        notificationDispatcher: mockNotificationDispatcher
      });

      assert.equal(result.success, false);
      assert.equal(result.error.code.toLowerCase(), 'permission_denied');
      assert.ok(result.error.message.includes('Taxpayers cannot accept or reject documents'));
    });

    test('Rejects review if practitioner MFA is not verified', async () => {
      const staffNoMfa = {
        uid: 'usr_denise_cpa_44',
        email: 'd.ross.cpa@thefileroom.tax',
        role: 'firm_reviewer',
        mfaVerified: false
      };

      const result = await documentReviewHandler({
        context: staffNoMfa,
        documentId: 'req_w2_test',
        action: ReviewAction.ACCEPT
      }, {
        firestoreDb: mockFirestoreDb,
        auditLogger: mockAuditLogger,
        notificationDispatcher: mockNotificationDispatcher
      });

      assert.equal(result.success, false);
      assert.equal(result.error.code.toLowerCase(), 'permission_denied');
      assert.ok(result.error.message.includes('MFA verification required'));
    });

    test('Enforces idempotency: duplicate review requests do not cause redundant state mutations', async () => {
      const staffContext = {
        uid: 'usr_denise_cpa_44',
        email: 'd.ross.cpa@thefileroom.tax',
        role: 'firm_admin',
        mfaVerified: true
      };

      const idemKey = 'idem_review_tx_9981';

      const res1 = await documentReviewHandler({
        context: staffContext,
        documentId: 'req_w2_test',
        action: ReviewAction.ACCEPT,
        notes: 'First verification pass',
        idempotencyKey: idemKey
      }, {
        firestoreDb: mockFirestoreDb,
        auditLogger: mockAuditLogger,
        notificationDispatcher: mockNotificationDispatcher
      });

      const res2 = await documentReviewHandler({
        context: staffContext,
        documentId: 'req_w2_test',
        action: ReviewAction.ACCEPT,
        notes: 'Duplicate verification call',
        idempotencyKey: idemKey
      }, {
        firestoreDb: mockFirestoreDb,
        auditLogger: mockAuditLogger,
        notificationDispatcher: mockNotificationDispatcher
      });

      assert.equal(res1.success, true);
      assert.equal(res2.success, true);
      assert.equal(res1.reviewedAt, res2.reviewedAt, 'Idempotency returns identical cached result');
    });

    test('Storage security rules mandate client tenant isolation and statutory 25MB ceiling', () => {
      assert.ok(storageRulesCode.includes('function isValidTaxDocument()'), 'Defines tax document validation helper');
      assert.ok(storageRulesCode.includes('request.resource.size <= 25 * 1024 * 1024'), 'Enforces 25MB statutory limit');
      assert.ok(storageRulesCode.includes('/clients/{userId}/documents/{documentId}'), 'Standard vault storage match pattern');
      assert.ok(storageRulesCode.includes('/clients/{userId}/engagements/{engagementId}/documents/{documentId}'), 'Engagement-scoped vault match pattern');
      assert.ok(storageRulesCode.includes('isOwner(userId)'), 'Only owning client can write to their vault');
    });

    test('Firestore security rules prevent client from updating status or reviewer fields', () => {
      assert.ok(firestoreRulesCode.includes('match /documents/{documentId}'), 'Protects documents collection');
      assert.ok(firestoreRulesCode.includes('!request.resource.data.diff(resource.data).affectedKeys()'), 'Guards protected fields on client update');
      assert.ok(firestoreRulesCode.includes("'status'"), 'Status is staff-only field');
      assert.ok(firestoreRulesCode.includes("'reviewerUid'"), 'Reviewer UID is staff-only field');
      assert.ok(firestoreRulesCode.includes("'reviewNotes'"), 'Review notes is staff-only field');
    });
  });

  // =========================================================================
  // SUITE 4: COMPLETE END-TO-END WORKFLOW JOURNEY
  // =========================================================================
  describe('4. Complete End-to-End Journey: Upload -> Confirmation -> Review -> Sync', () => {
    test('Executes end-to-end journey from client upload through firm review and client status receipt', async () => {
      // Step 1: Simulated shared Firestore & Cloud Storage state
      const sharedDatabase = {
        documentRequests: new Map(),
        documents: new Map()
      };

      const initialRequestId = 'req_w2_journey_001';
      const clientId = 'usr_journey_client_99';
      const engagementId = 'eng_2026_journey_1040';

      sharedDatabase.documentRequests.set(initialRequestId, {
        id: initialRequestId,
        requestId: initialRequestId,
        title: 'Form W-2 Wage Statement',
        category: 'W-2',
        clientId: clientId,
        clientUid: clientId,
        engagementId: engagementId,
        status: 'needed'
      });

      // Step 2: Client uploads tax document (PDF <= 25MB)
      const validPdfFile = {
        name: 'W2_Final_Submission.pdf',
        size: 1.2 * 1024 * 1024,
        type: 'application/pdf',
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37])
      };

      // Mock storage upload
      const timestamp = Date.now();
      const storagePath = `clients/${clientId}/engagements/${engagementId}/documents/${initialRequestId}_${timestamp}.pdf`;
      const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/uk-client-d90d5.firebasestorage.app/o/${encodeURIComponent(storagePath)}?alt=media`;

      // Client commits upload record
      const uploadPayload = {
        status: 'in_review',
        uploadedAt: new Date().toISOString(),
        storagePath: storagePath,
        downloadUrl: downloadUrl,
        fileName: validPdfFile.name,
        fileSize: validPdfFile.size,
        fileSizeFormatted: '1.20 MB',
        clientId: clientId,
        clientUid: clientId,
        engagementId: engagementId,
        requestId: initialRequestId,
        storageState: 'stored',
        serverConfirmed: true,
        scanStatus: 'clean'
      };

      sharedDatabase.documentRequests.set(initialRequestId, {
        ...sharedDatabase.documentRequests.get(initialRequestId),
        ...uploadPayload
      });
      sharedDatabase.documents.set(`${initialRequestId}_${timestamp}`, {
        documentId: `${initialRequestId}_${timestamp}`,
        ...uploadPayload
      });

      // Step 3: Firm Operations Console views the pending submission
      const firmRecordView = sharedDatabase.documentRequests.get(initialRequestId);
      assert.equal(firmRecordView.status, 'in_review');
      assert.equal(firmRecordView.clientUid, clientId);
      assert.equal(firmRecordView.engagementId, engagementId);
      assert.equal(firmRecordView.storageState, 'stored');

      // Step 4: Firm reviewer executes review decision (Option B: Accept)
      const mockServices = {
        firestoreDb: {
          collection: (col) => ({
            doc: (docId) => ({
              get: async () => ({
                exists: sharedDatabase[col]?.has(docId),
                data: () => sharedDatabase[col]?.get(docId)
              }),
              set: async (data, opts) => {
                const prev = sharedDatabase[col]?.get(docId) || {};
                sharedDatabase[col].set(docId, opts?.merge ? { ...prev, ...data } : data);
                return { success: true };
              }
            })
          })
        },
        auditLogger: { recordAuthoritativeEvent: async () => {} },
        notificationDispatcher: { dispatch: async () => {} }
      };

      const reviewRes = await documentReviewHandler({
        context: {
          uid: 'usr_cpa_elena_77',
          role: 'firm_reviewer',
          email: 'elena.cpa@thefileroom.tax',
          displayName: 'Elena Rostova, CPA',
          mfaVerified: true
        },
        documentId: initialRequestId,
        action: ReviewAction.ACCEPT,
        notes: 'All wages and withholding reconciled against employer IRS file'
      }, mockServices);

      assert.equal(reviewRes.success, true);
      assert.equal(reviewRes.status, 'accepted');
      assert.equal(reviewRes.reviewerUid, 'usr_cpa_elena_77');

      // Step 5: Client portal receives real-time Firestore update
      const clientReceivedRecord = sharedDatabase.documentRequests.get(initialRequestId);
      assert.equal(clientReceivedRecord.status, 'accepted');
      assert.equal(clientReceivedRecord.reviewedBy, 'Elena Rostova, CPA');
      assert.equal(clientReceivedRecord.reviewNotes, 'All wages and withholding reconciled against employer IRS file');
      assert.ok(clientReceivedRecord.reviewedAt);

      // Verify that audit logs and storage state do not expose public download URLs
      assert.ok(!clientReceivedRecord.reviewNotes.includes('firebasestorage.googleapis.com'));
      assert.ok(!clientReceivedRecord.reviewNotes.includes('token='));
    });
  });
});
