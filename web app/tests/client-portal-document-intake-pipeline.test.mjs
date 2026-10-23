/**
 * ============================================================================
 * TEST SUITE: RESILIENT DOCUMENT-INTAKE PIPELINE (FORMINIT & FIREBASE FALLBACK)
 * ============================================================================
 * 
 * Tests compliance with statutory and operational requirements:
 * 1. Primary Success: Forminit (https://forminit.com/f/rv02anqc45x) HTTP 200/201
 * 2. Timeout: Forminit bounded timeout triggers silent routing to Firebase fallback
 * 3. HTTP 500: Retryable server error routes to Firebase fallback
 * 4. HTTP 429: Rate-limit handled according to documented retry guidance -> fallback
 * 5. Permanent HTTP 4xx: Non-retryable permanent client errors (400, 403) fail fast without fallback
 * 6. Duplicate Submissions: Idempotent replay prevents duplicate records
 * 7. Fallback Failure: Accurate failure outcome and separate states tracked (storage, registration, delivery)
 * 8. Security Safeguards: Tenant isolation, no Admin SDK in browser, no sensitive data in audit logs
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Import backend fallback handler directly for backend contract verification
import { documentIntakeFallbackHandler } from '../functions/src/document-intake.mjs';
import { IdempotencyManager } from '../functions/src/idempotency.mjs';
import { ErrorCode } from '../functions/src/errors.mjs';

// Mock Firestore DB helper
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
  async add(data) {
    const id = 'gen_' + Math.random().toString(36).substring(2, 9);
    this.docs.set(id, data);
    return { id };
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

describe('Resilient Document-Intake Pipeline Architecture', () => {
  const baseDir = path.resolve('c:/Users/user/Desktop/web app1/web app');
  const docsJsPath = path.join(baseDir, 'js/client/documents.js');
  const docsJsCode = fs.readFileSync(docsJsPath, 'utf8');

  let virtualWindow;
  let clientDocs;
  let fetchCalls;
  let auditLogs;
  let firestoreMock;
  const originalFetch = globalThis.fetch;

  function setupVirtualEnv(customFetchImpl = null) {
    fetchCalls = [];
    auditLogs = [];
    firestoreMock = new MockFirestoreDb();

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

    virtualWindow = {
      fetch: mockFetch,
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
        querySelectorAll: () => []
      },
      FileRoomLayout: {
        showToast: (msg, type) => {}
      },
      FirebaseBridge: {
        getUserUid: () => 'usr_whitfield_4417',
        getUserName: () => 'Michael Whitfield',
        currentUser: {
          uid: 'usr_whitfield_4417',
          email: 'm.whitfield@example.com',
          displayName: 'Michael Whitfield',
          getIdToken: async () => 'mock_firebase_id_token_xyz'
        },
        db: firestoreMock,
        doc: (db, col, id) => ({ db, col, id }),
        setDoc: async (ref, data, opts) => {
          return firestoreMock.collection(ref.col).doc(ref.id).set(data, opts);
        },
        recordAuditLog: async (action, summary, category) => {
          auditLogs.push({ action, summary, category, timestamp: new Date().toISOString() });
        }
      }
    };

    const fn = new Function('window', 'document', docsJsCode);
    fn(virtualWindow, virtualWindow.document);
    clientDocs = virtualWindow.ClientDocuments;
  }

  beforeEach(() => {
    setupVirtualEnv();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── 1. PRIMARY SUCCESS: FORMINIT HTTP 200 / 201 ─────────────────────────
  test('1. Primary Route Success: Transmits to Forminit (rv02anqc45x) and confirms success', async () => {
    const validPdfBytes = [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37];
    const mockFile = {
      name: 'Form_W2_2026.pdf',
      size: 512 * 1024,
      type: 'application/pdf',
      bytes: validPdfBytes
    };

    const result = await clientDocs.submitDocumentIntake({
      file: mockFile,
      requestId: 'req_w2_whitfield',
      doc: {
        id: 'req_w2_whitfield',
        requestId: 'req_w2_whitfield',
        title: 'Form W-2 Statement',
        category: 'W-2',
        taxYear: 2026
      },
      skipStorageUpload: true,
      existingStoragePath: 'clients/usr_whitfield_4417/documents/req_w2_whitfield_12345.pdf'
    });

    assert.equal(result.success, true);
    assert.equal(result.outcome, 'primary_delivered');
    assert.equal(result.gateway, 'forminit');
    assert.equal(result.storageState, 'stored');
    assert.equal(result.registrationState, 'registered');
    assert.equal(result.downstreamDelivery, 'forminit_delivered');
    assert.ok(result.idempotencyKey.startsWith('ik_usr_whitfield_4417_req_w2_whitfield_2026'));

    // Assert Forminit URL was called, fallback was NOT called
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'https://forminit.com/f/rv02anqc45x');

    // Assert minimal audit event written without sensitive taxpayer data
    assert.ok(auditLogs.length >= 1);
    const auditItem = auditLogs.find(a => a.action.includes('Document Intake Completed'));
    assert.ok(auditItem);
    assert.match(auditItem.summary, /Form_W2_2026\.pdf/);
    assert.ok(!auditItem.summary.includes('password'));
    assert.ok(!auditItem.summary.includes('mock_firebase_id_token'));
  });

  // ── 2. BOUNDED TIMEOUT: FORMINIT TIMEOUT -> FIREBASE FALLBACK ───────────
  test('2. Bounded Timeout: Primary Forminit timeout automatically routes to Firebase Cloud Function fallback', async () => {
    setupVirtualEnv(async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url.includes('forminit.com')) {
        // Simulate network timeout via AbortError
        const err = new Error('The operation was aborted due to timeout.');
        err.name = 'AbortError';
        throw err;
      }
      if (url.includes('intakeDocumentFallback')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            submissionId: 'sub_timeout_01',
            deliveryStatus: 'fallback_delivered',
            storageState: 'stored',
            registrationState: 'registered',
            idempotentReplay: false
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const validPdfBytes = [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37];
    const mockFile = {
      name: 'Form_1099_NEC.pdf',
      size: 400 * 1024,
      type: 'application/pdf',
      bytes: validPdfBytes
    };

    const result = await clientDocs.submitDocumentIntake({
      file: mockFile,
      requestId: 'req_1099_nec',
      doc: {
        requestId: 'req_1099_nec',
        title: 'Form 1099-NEC Statement',
        category: '1099',
        taxYear: 2026
      },
      skipStorageUpload: true,
      existingStoragePath: 'clients/usr_whitfield_4417/documents/req_1099_nec_12345.pdf'
    });

    assert.equal(result.success, true);
    assert.equal(result.outcome, 'fallback_delivered');
    assert.equal(result.gateway, 'firebase_cloud_function');
    assert.equal(result.storageState, 'stored');
    assert.equal(result.registrationState, 'registered');
    assert.equal(result.downstreamDelivery, 'fallback_delivered');

    // Both primary and fallback endpoints were contacted
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0].url, 'https://forminit.com/f/rv02anqc45x');
    assert.equal(fetchCalls[1].url, 'https://us-central1-uk-client-d90d5.cloudfunctions.net/intakeDocumentFallback');

    // Fallback payload includes storage reference and auth token
    const fallbackCall = fetchCalls[1];
    assert.ok(fallbackCall.options.headers['Authorization'].includes('mock_firebase_id_token'));
    const parsedBody = JSON.parse(fallbackCall.options.body);
    assert.equal(parsedBody.storagePath, 'clients/usr_whitfield_4417/documents/req_1099_nec_12345.pdf');
    assert.equal(parsedBody.clientId, 'usr_whitfield_4417');
  });

  // ── 3. HTTP 500: FORMINIT SERVER ERROR -> FIREBASE FALLBACK ──────────────
  test('3. HTTP 500 Server Error: Forminit 500 automatically routes to Firebase Cloud Function fallback', async () => {
    setupVirtualEnv(async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url.includes('forminit.com')) {
        return {
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error'
        };
      }
      if (url.includes('intakeDocumentFallback')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            submissionId: 'sub_500_01',
            deliveryStatus: 'fallback_delivered',
            storageState: 'stored',
            registrationState: 'registered'
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const validPdfBytes = [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37];
    const mockFile = {
      name: 'Schedule_K1.pdf',
      size: 600 * 1024,
      type: 'application/pdf',
      bytes: validPdfBytes
    };

    const result = await clientDocs.submitDocumentIntake({
      file: mockFile,
      requestId: 'req_k1_01',
      skipStorageUpload: true,
      existingStoragePath: 'clients/usr_whitfield_4417/documents/req_k1_12345.pdf'
    });

    assert.equal(result.success, true);
    assert.equal(result.outcome, 'fallback_delivered');
    assert.equal(result.gateway, 'firebase_cloud_function');
    assert.equal(result.downstreamDelivery, 'fallback_delivered');
    assert.equal(fetchCalls.length, 2);
  });

  // ── 4. HTTP 429: FORMINIT RATE LIMITED -> FIREBASE FALLBACK ──────────────
  test('4. HTTP 429 Rate Limit: Forminit 429 handled according to retry guidance -> routes to Firebase fallback', async () => {
    setupVirtualEnv(async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url.includes('forminit.com')) {
        return {
          ok: false,
          status: 429,
          headers: new Map([['Retry-After', '60']]),
          text: async () => 'Too Many Requests - Rate limit exceeded'
        };
      }
      if (url.includes('intakeDocumentFallback')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            submissionId: 'sub_429_01',
            deliveryStatus: 'fallback_delivered',
            storageState: 'stored',
            registrationState: 'registered'
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const validPdfBytes = [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37];
    const mockFile = {
      name: 'Mortgage_1098.pdf',
      size: 300 * 1024,
      type: 'application/pdf',
      bytes: validPdfBytes
    };

    const result = await clientDocs.submitDocumentIntake({
      file: mockFile,
      requestId: 'req_1098_01',
      skipStorageUpload: true,
      existingStoragePath: 'clients/usr_whitfield_4417/documents/req_1098_12345.pdf'
    });

    assert.equal(result.success, true);
    assert.equal(result.outcome, 'fallback_delivered');
    assert.equal(result.gateway, 'firebase_cloud_function');
    assert.equal(result.downstreamDelivery, 'fallback_delivered');
    assert.equal(fetchCalls.length, 2);
  });

  // ── 5. PERMANENT HTTP 4XX ERRORS: NON-RETRYABLE CLIENT REJECTION ─────────
  test('5. Permanent HTTP 4xx: Rejection (HTTP 400 Bad Request) fails fast without routing to fallback', async () => {
    let fallbackWasCalled = false;
    setupVirtualEnv(async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url.includes('forminit.com')) {
        return {
          ok: false,
          status: 400,
          text: async () => 'Bad Request: Document schema field format error.'
        };
      }
      if (url.includes('intakeDocumentFallback')) {
        fallbackWasCalled = true;
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const validPdfBytes = [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37];
    const mockFile = {
      name: 'Malformed_Doc.pdf',
      size: 200 * 1024,
      type: 'application/pdf',
      bytes: validPdfBytes
    };

    const result = await clientDocs.submitDocumentIntake({
      file: mockFile,
      requestId: 'req_malformed_01',
      skipStorageUpload: true,
      existingStoragePath: 'clients/usr_whitfield_4417/documents/req_malformed_12345.pdf'
    });

    // Must be non-retryable failure
    assert.equal(result.success, false);
    assert.equal(result.nonRetryable, true);
    assert.equal(result.status, 400);
    assert.equal(result.downstreamDelivery, 'failed');
    assert.equal(fallbackWasCalled, false, 'Fallback must NOT be called for non-retryable permanent client errors');
  });

  // ── 6. DUPLICATE SUBMISSIONS: IDEMPOTENT REPLAY ─────────────────────────
  test('6. Duplicate Submissions: Stable idempotency key acknowledges repeated request without duplicate records', async () => {
    const validPdfBytes = [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37];
    const mockFile = {
      name: 'Form_W2_Repeat.pdf',
      size: 512 * 1024,
      type: 'application/pdf',
      bytes: validPdfBytes
    };

    const stableIdempotencyKey = 'ik_usr_whitfield_4417_req_repeat_2026_fixedkey';

    // First submission
    const res1 = await clientDocs.submitDocumentIntake({
      file: mockFile,
      requestId: 'req_repeat_01',
      idempotencyKey: stableIdempotencyKey,
      skipStorageUpload: true,
      existingStoragePath: 'clients/usr_whitfield_4417/documents/req_repeat_12345.pdf'
    });
    assert.equal(res1.success, true);
    assert.equal(res1.idempotencyKey, stableIdempotencyKey);

    // Verify backend IdempotencyManager directly
    const backendDb = new MockFirestoreDb();
    const idempManager = new IdempotencyManager(backendDb);
    const context = { uid: 'usr_whitfield_4417', role: 'client' };

    const backendPayload = {
      context,
      idempotencyKey: stableIdempotencyKey,
      storagePath: 'clients/usr_whitfield_4417/documents/req_repeat_12345.pdf',
      originalFileName: 'Form_W2_Repeat.pdf',
      taxYear: 2026
    };

    const bRes1 = await documentIntakeFallbackHandler(backendPayload, {
      firestoreDb: backendDb,
      idempotencyManager: idempManager
    });
    assert.equal(bRes1.success, true);
    assert.equal(bRes1.idempotentReplay, false);

    // Repeated call with the SAME idempotency key
    const bRes2 = await documentIntakeFallbackHandler(backendPayload, {
      firestoreDb: backendDb,
      idempotencyManager: idempManager
    });
    assert.equal(bRes2.success, true);
    assert.equal(bRes2.idempotentReplay, true, 'Repeated submission must return idempotentReplay: true without creating duplicates');
  });

  // ── 7. FALLBACK FAILURE: BOTH DESTINATIONS DOWN ─────────────────────────
  test('7. Fallback Failure: When both Forminit and Firebase fallback fail, returns accurate failure outcome and preserves storage state', async () => {
    setupVirtualEnv(async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url.includes('forminit.com')) {
        return { ok: false, status: 503, text: async () => 'Service Unavailable' };
      }
      if (url.includes('intakeDocumentFallback')) {
        return { ok: false, status: 502, text: async () => 'Bad Gateway' };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const validPdfBytes = [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37];
    const mockFile = {
      name: 'Disaster_Doc.pdf',
      size: 150 * 1024,
      type: 'application/pdf',
      bytes: validPdfBytes
    };

    const result = await clientDocs.submitDocumentIntake({
      file: mockFile,
      requestId: 'req_disaster_01',
      skipStorageUpload: true,
      existingStoragePath: 'clients/usr_whitfield_4417/documents/req_disaster_12345.pdf'
    });

    assert.equal(result.success, false);
    assert.equal(result.outcome, 'failed');
    assert.equal(result.storageState, 'stored', 'Storage bytes must remain stored and intact');
    assert.equal(result.registrationState, 'registered');
    assert.equal(result.downstreamDelivery, 'failed');
  });

  // ── 8. SECURITY & TENANT ISOLATION SAFEGUARDS ───────────────────────────
  test('8. Security Safeguards: Strict tenant isolation and absence of Admin SDK in browser code', async () => {
    // 1. Verify Browser Code contains NO Firebase Admin SDK
    assert.ok(!docsJsCode.includes('firebase-admin'), 'Browser code must never import firebase-admin');
    assert.ok(!docsJsCode.includes('admin.initializeApp'), 'Browser code must never initialize Firebase Admin');
    assert.ok(!docsJsCode.includes('private_key'), 'Browser code must never contain private credentials');

    // 2. Verify Backend Tenant Boundary Enforcement
    const backendDb = new MockFirestoreDb();
    const attackerContext = { uid: 'usr_attacker_666', role: 'client' };

    // Attacker attempts to reference storage belonging to usr_whitfield_4417
    const crossTenantPayload = {
      context: attackerContext,
      idempotencyKey: 'ik_exploit_01',
      clientId: 'usr_whitfield_4417', // Cross-tenant target!
      storagePath: 'clients/usr_whitfield_4417/documents/confidential_w2.pdf'
    };

    const crossTenantRes = await documentIntakeFallbackHandler(crossTenantPayload, { firestoreDb: backendDb });
    assert.equal(crossTenantRes.success, false);
    assert.equal(crossTenantRes.error.code, ErrorCode.PERMISSION_DENIED);

    // Attacker attempts directory traversal in storagePath
    const traversalPayload = {
      context: attackerContext,
      idempotencyKey: 'ik_traversal_01',
      clientId: 'usr_attacker_666',
      storagePath: 'clients/usr_attacker_666/../../root/secrets.pdf'
    };
    const traversalRes = await documentIntakeFallbackHandler(traversalPayload, { firestoreDb: backendDb });
    assert.equal(traversalRes.success, false);
    assert.equal(traversalRes.error.code, ErrorCode.INVALID_ARGUMENT);

    // 3. Unauthenticated request rejected
    const unauthRes = await documentIntakeFallbackHandler({ context: {} }, { firestoreDb: backendDb });
    assert.equal(unauthRes.success, false);
    assert.equal(unauthRes.error.code, ErrorCode.UNAUTHENTICATED);
  });
});
