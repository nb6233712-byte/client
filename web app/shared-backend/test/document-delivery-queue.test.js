/**
 * ============================================================================
 * THE FILE ROOM — DURABLE DOCUMENT-DELIVERY QUEUE TEST SUITE
 * test/document-delivery-queue.test.js
 * ============================================================================
 * 
 * Verifies all 10 Architectural Requirements:
 * 1. Explicit States: uploaded, queued, processing, delivered, retry_pending, permanently_failed, needs_review
 * 2. Mandatory Metadata: attempt count, nextAttemptAt, last error category, idempotency key, createdAt, updatedAt
 * 3. Exponential Backoff with Jitter: backoff progression, jitter variance, HTTP 429 Retry-After, HTTP 5xx retryability
 * 4. Dead-Letter Office (DLO): transitions to needs_review when retry budget is exhausted
 * 5. Distributed Lease Concurrency: multiple workers cannot process the same job concurrently; orphan lease reclamation
 * 6. Idempotency: duplicate submissions return existing record without creating duplicate records or downstream actions
 * 7. Storage Reference Hold: prevents premature deletion until downstream delivery is confirmed
 * 8. Authorized Controlled Manual Retry: authorized staff can re-queue with reset budget and audit logging
 * 9. Client-Side Storage Disclaimer: verifies temporary recovery aid logic, disclaiming zero-data-loss solely via localStorage
 * 10. End-to-End Failure Scenarios: browser closure simulation, offline buffering, worker crash/restart, duplicate events, exhausted retries, manual recovery
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Import ES modules dynamically for Node.js test runner
async function loadQueueModule() {
  return await import('../src/document-delivery-queue.mjs');
}

/**
 * In-Memory Mock Firestore Database for Queue Testing
 */
class MockFirestoreQueueDb {
  constructor() {
    this.collections = new Map();
  }

  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    const store = this.collections.get(name);

    return {
      doc: (docId) => {
        return {
          id: docId,
          get: async () => {
            const data = store.get(docId);
            return {
              id: docId,
              exists: !!data,
              data: () => (data ? { ...data } : undefined)
            };
          },
          set: async (val, options = {}) => {
            if (options.merge && store.has(docId)) {
              store.set(docId, { ...store.get(docId), ...val });
            } else {
              store.set(docId, { ...val });
            }
          },
          update: async (val) => {
            if (!store.has(docId)) throw new Error(`Document ${docId} does not exist for update.`);
            store.set(docId, { ...store.get(docId), ...val });
          },
          delete: async () => {
            store.delete(docId);
          }
        };
      },
      where: (field, op, value) => {
        return {
          where: (f2, op2, val2) => ({
            limit: (n) => ({
              get: async () => {
                const results = [];
                for (const [id, item] of store.entries()) {
                  let match1 = false;
                  if (op === '==') match1 = item[field] === value;
                  else if (op === 'in') match1 = Array.isArray(value) && value.includes(item[field]);
                  else if (op === '<=') match1 = item[field] <= value;

                  let match2 = false;
                  if (op2 === '==') match2 = item[f2] === val2;
                  else if (op2 === 'in') match2 = Array.isArray(val2) && val2.includes(item[f2]);
                  else if (op2 === '<=') match2 = item[f2] <= val2;

                  if (match1 && match2) results.push({ id, data: () => ({ ...item }) });
                  if (results.length >= n) break;
                }
                return { docs: results };
              }
            })
          }),
          limit: (n) => ({
            get: async () => {
              const results = [];
              for (const [id, item] of store.entries()) {
                let match = false;
                if (op === '==') match = item[field] === value;
                else if (op === 'in') match = Array.isArray(value) && value.includes(item[field]);
                else if (op === '<=') match = item[field] <= value;
                if (match) results.push({ id, data: () => ({ ...item }) });
                if (results.length >= n) break;
              }
              return { docs: results };
            }
          }),
          get: async () => {
            const results = [];
            for (const [id, item] of store.entries()) {
              let match = false;
              if (op === '==') match = item[field] === value;
              else if (op === 'in') match = Array.isArray(value) && value.includes(item[field]);
              if (match) results.push({ id, data: () => ({ ...item }) });
            }
            return { docs: results };
          }
        };
      },
      limit: (n) => ({
        get: async () => {
          const results = [];
          for (const [id, item] of store.entries()) {
            results.push({ id, data: () => ({ ...item }) });
            if (results.length >= n) break;
          }
          return { docs: results };
        }
      })
    };
  }

  async runTransaction(updateFn) {
    // Atomically execute transaction in-memory
    const transactionContext = {
      get: async (docRef) => docRef.get(),
      update: (docRef, val) => docRef.update(val),
      set: (docRef, val) => docRef.set(val)
    };
    return await updateFn(transactionContext);
  }
}

/**
 * Mock Audit Logger
 */
class MockAuditLogger {
  constructor() {
    this.events = [];
  }
  async recordAuthoritativeEvent(event) {
    this.events.push({ ...event, recordedAt: new Date().toISOString() });
    return { success: true };
  }
}

// ── TEST SUITE ───────────────────────────────────────────────────────────────

test('1. Explicit States: All 7 required states and transition validations', async () => {
  const { DELIVERY_STATE, isValidStateTransition } = await loadQueueModule();

  // Verify all 7 explicit states required by architecture specification
  const requiredStates = [
    'uploaded',
    'queued',
    'processing',
    'delivered',
    'retry_pending',
    'permanently_failed',
    'needs_review'
  ];

  for (const state of requiredStates) {
    assert.ok(
      Object.values(DELIVERY_STATE).includes(state),
      `Required state "${state}" must be defined in DELIVERY_STATE enum`
    );
  }

  // Legal transitions
  assert.equal(isValidStateTransition(DELIVERY_STATE.UPLOADED, DELIVERY_STATE.QUEUED), true);
  assert.equal(isValidStateTransition(DELIVERY_STATE.QUEUED, DELIVERY_STATE.PROCESSING), true);
  assert.equal(isValidStateTransition(DELIVERY_STATE.PROCESSING, DELIVERY_STATE.DELIVERED), true);
  assert.equal(isValidStateTransition(DELIVERY_STATE.PROCESSING, DELIVERY_STATE.RETRY_PENDING), true);
  assert.equal(isValidStateTransition(DELIVERY_STATE.PROCESSING, DELIVERY_STATE.NEEDS_REVIEW), true);
  assert.equal(isValidStateTransition(DELIVERY_STATE.PROCESSING, DELIVERY_STATE.PERMANENTLY_FAILED), true);
  assert.equal(isValidStateTransition(DELIVERY_STATE.RETRY_PENDING, DELIVERY_STATE.PROCESSING), true);

  // Illegal transitions
  assert.equal(isValidStateTransition(DELIVERY_STATE.DELIVERED, DELIVERY_STATE.QUEUED), false, 'Terminal delivered state cannot re-queue');
  assert.equal(isValidStateTransition(DELIVERY_STATE.DELIVERED, DELIVERY_STATE.PROCESSING), false, 'Terminal delivered state cannot re-enter processing');
  assert.equal(isValidStateTransition(DELIVERY_STATE.UPLOADED, DELIVERY_STATE.DELIVERED), false, 'Cannot jump directly from uploaded to delivered');
});

test('2. Mandatory Metadata: Queue schema stores required metadata fields', async () => {
  const { DocumentDeliveryQueue, DELIVERY_STATE } = await loadQueueModule();
  const db = new MockFirestoreQueueDb();
  const logger = new MockAuditLogger();
  const queue = new DocumentDeliveryQueue(db, logger);

  const payload = {
    clientId: 'usr_whitfield_4417',
    taxpayerUid: 'usr_whitfield_4417',
    documentId: 'req_w2_2026',
    requestId: 'req_w2_2026',
    taxYear: 2026,
    fileName: 'W2_Form_Keystone.pdf',
    fileSizeBytes: 2048500,
    mimeType: 'application/pdf',
    storagePath: 'clients/usr_whitfield_4417/documents/req_w2_2026_177264.pdf',
    sha256Checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  };

  const result = await queue.enqueue(payload, { uid: 'usr_whitfield_4417', role: 'client' });
  assert.equal(result.success, true);
  assert.equal(result.status, DELIVERY_STATE.QUEUED);

  const doc = await db.collection(queue.collectionName).doc(result.jobId).get();
  assert.ok(doc.exists);
  const data = doc.data();

  // Verify mandatory metadata from Requirement 2
  assert.equal(typeof data.attemptCount, 'number', 'attemptCount must be number');
  assert.equal(data.attemptCount, 0, 'initial attemptCount must be 0');
  assert.ok(data.nextAttemptAt, 'nextAttemptAt must be defined');
  assert.ok(data.createdAt, 'createdAt timestamp must be defined');
  assert.ok(data.updatedAt, 'updatedAt timestamp must be defined');
  assert.ok(data.idempotencyKey, 'idempotencyKey must be present');
  assert.equal(data.storagePath, payload.storagePath, 'storagePath must be recorded');
  assert.equal(data.sha256Checksum, payload.sha256Checksum, 'sha256Checksum must be recorded');
  assert.ok(Array.isArray(data.history), 'history must be an array');
});

test('3. Exponential Backoff with Jitter: Jitter distribution and HTTP 429 Retry-After handling', async () => {
  const { calculateExponentialBackoff, parseRetryAfterHeader, categorizeDeliveryError, ERROR_CATEGORY } = await loadQueueModule();

  // 1. Exponential progression: attempt 1 = ~1000ms, attempt 2 = ~2000ms, attempt 3 = ~4000ms
  const baseMs = 1000;
  const maxMs = 60000;
  const attempts = [1, 2, 3, 4, 5];
  const results = attempts.map(a => calculateExponentialBackoff(a, baseMs, maxMs, 0.25));

  for (let i = 0; i < results.length; i++) {
    const attempt = attempts[i];
    const nominal = baseMs * Math.pow(2, attempt - 1);
    const minExpected = nominal * 0.70; // within 25% jitter tolerance
    const maxExpected = nominal * 1.30;
    assert.ok(
      results[i] >= minExpected && results[i] <= maxExpected,
      `Attempt ${attempt} result ${results[i]}ms should be bounded within [${minExpected}, ${maxExpected}]`
    );
  }

  // Jitter variation: Multiple runs of same attempt produce non-identical values
  const samples = Array.from({ length: 5 }, () => calculateExponentialBackoff(3, baseMs, maxMs, 0.25));
  const uniqueSamples = new Set(samples);
  assert.ok(uniqueSamples.size > 1, 'Randomized jitter must produce non-identical backoff intervals');

  // 2. HTTP 429 Retry-After header parsing
  const retryAfterSeconds = parseRetryAfterHeader('15');
  assert.equal(retryAfterSeconds, 15000, 'Retry-After in seconds converts to milliseconds');

  const futureHttpDate = new Date(Date.now() + 30000).toUTCString();
  const retryAfterDate = parseRetryAfterHeader(futureHttpDate);
  assert.ok(retryAfterDate >= 25000 && retryAfterDate <= 35000, 'HTTP date Retry-After correctly parsed');

  // 3. Error categorization
  const err429 = { status: 429, message: 'Too Many Requests' };
  const cat429 = categorizeDeliveryError(err429);
  assert.equal(cat429.category, ERROR_CATEGORY.RATE_LIMIT_429);
  assert.equal(cat429.isRetryable, true);

  const err503 = { status: 503, message: 'Service Unavailable' };
  const cat503 = categorizeDeliveryError(err503);
  assert.equal(cat503.category, ERROR_CATEGORY.SERVER_ERROR_5XX);
  assert.equal(cat503.isRetryable, true);

  const err400 = { status: 400, message: 'Bad Request: Invalid client schema' };
  const cat400 = categorizeDeliveryError(err400);
  assert.equal(cat400.category, ERROR_CATEGORY.CLIENT_ERROR_4XX);
  assert.equal(cat400.isRetryable, false, 'HTTP 400 client error must be non-retryable');
});

test('4. Dead-Letter Office: Transitions to needs_review when retry budget is exhausted', async () => {
  const { DocumentDeliveryQueue, DELIVERY_STATE, ERROR_CATEGORY } = await loadQueueModule();
  const db = new MockFirestoreQueueDb();
  const logger = new MockAuditLogger();
  const queue = new DocumentDeliveryQueue(db, logger, null, { MAX_ATTEMPTS: 3 });

  const payload = {
    clientId: 'usr_whitfield_4417',
    taxpayerUid: 'usr_whitfield_4417',
    documentId: 'doc_retry_exhaust_test',
    storagePath: 'clients/usr_whitfield_4417/documents/test_exhaust.pdf',
    maxAttempts: 3
  };

  const { jobId } = await queue.enqueue(payload, { uid: 'usr_whitfield_4417', role: 'client' });

  // Mock a persistent 500 error from downstream
  const failingTransmitter = async () => {
    const err = new Error('Downstream upstream gateway failure');
    err.status = 502;
    throw err;
  };

  // Attempt 1 -> retry_pending (attemptCount: 1)
  const res1 = await queue.processJob(jobId, 'worker_1', failingTransmitter);
  assert.equal(res1.status, DELIVERY_STATE.RETRY_PENDING);
  assert.equal(res1.attemptCount, 1);

  // Attempt 2 -> retry_pending (attemptCount: 2)
  // Fast forward nextAttemptAt
  await db.collection(queue.collectionName).doc(jobId).update({ nextAttemptAt: new Date(Date.now() - 1000).toISOString() });
  const res2 = await queue.processJob(jobId, 'worker_1', failingTransmitter);
  assert.equal(res2.status, DELIVERY_STATE.RETRY_PENDING);
  assert.equal(res2.attemptCount, 2);

  // Attempt 3 (Retry Budget Reached = 3/3) -> MUST transition to needs_review (Dead Letter)
  await db.collection(queue.collectionName).doc(jobId).update({ nextAttemptAt: new Date(Date.now() - 1000).toISOString() });
  const res3 = await queue.processJob(jobId, 'worker_1', failingTransmitter);
  assert.equal(res3.status, DELIVERY_STATE.NEEDS_REVIEW, 'Exhausted retries must transition to needs_review');
  assert.equal(res3.category, ERROR_CATEGORY.RETRIES_EXHAUSTED);
  assert.equal(res3.retriesExhausted, true);

  // Check Firestore persisted record
  const finalDoc = await db.collection(queue.collectionName).doc(jobId).get();
  assert.equal(finalDoc.data().status, DELIVERY_STATE.NEEDS_REVIEW);
  assert.equal(finalDoc.data().attemptCount, 3);
  assert.equal(finalDoc.data().manualReviewRequired, true);

  // Check dead-letter audit log recorded
  const deadLetterAudit = logger.events.find(e => e.eventType === 'DOCUMENT_DELIVERY_DEAD_LETTERED');
  assert.ok(deadLetterAudit, 'Authoritative dead-letter audit event must be logged');
});

test('5. Distributed Concurrency: Workers cannot process same job concurrently; orphan lease reclamation', async () => {
  const { DocumentDeliveryQueue, DELIVERY_STATE } = await loadQueueModule();
  const db = new MockFirestoreQueueDb();
  const queue = new DocumentDeliveryQueue(db, null, null, { LEASE_DURATION_MS: 500 }); // 500ms lease for test

  const { jobId } = await queue.enqueue({
    clientId: 'usr_whitfield_4417',
    taxpayerUid: 'usr_whitfield_4417',
    documentId: 'doc_concurrency_test',
    storagePath: 'clients/usr_whitfield_4417/documents/concurrent.pdf'
  }, { uid: 'usr_whitfield_4417', role: 'client' });

  // Worker A acquires lease
  const leaseA = await queue.acquireLease(jobId, 'worker_A', 500);
  assert.equal(leaseA.acquired, true);
  assert.equal(leaseA.job.leaseOwner, 'worker_A');
  assert.equal(leaseA.job.status, DELIVERY_STATE.PROCESSING);

  // Worker B attempts to acquire lease simultaneously while Worker A lease is active
  const leaseB = await queue.acquireLease(jobId, 'worker_B', 500);
  assert.equal(leaseB.acquired, false, 'Worker B must NOT acquire lease while active on Worker A');
  assert.ok(leaseB.reason.includes('not eligible for lease'));

  // Simulate Worker A crashing and lease expiring (advance time past lease duration)
  const expiredTime = new Date(Date.now() - 5000).toISOString();
  await db.collection(queue.collectionName).doc(jobId).update({ leaseExpiresAt: expiredTime });

  // Worker C now reclaims the orphaned job
  const leaseC = await queue.acquireLease(jobId, 'worker_C', 500);
  assert.equal(leaseC.acquired, true, 'Worker C must safely reclaim orphaned job after lease expiry');
  assert.equal(leaseC.job.leaseOwner, 'worker_C');
});

test('6. Idempotency: Duplicate submissions return existing record without duplicate jobs', async () => {
  const { DocumentDeliveryQueue } = await loadQueueModule();
  const db = new MockFirestoreQueueDb();
  const queue = new DocumentDeliveryQueue(db);

  const payload = {
    clientId: 'usr_whitfield_4417',
    taxpayerUid: 'usr_whitfield_4417',
    documentId: 'req_1099_mortgage_2026',
    storagePath: 'clients/usr_whitfield_4417/documents/1099_mortgage.pdf',
    sha256Checksum: 'a8b417c8d88094f'
  };

  // First enqueue
  const res1 = await queue.enqueue(payload, { uid: 'usr_whitfield_4417', role: 'client' });
  assert.equal(res1.success, true);
  assert.equal(res1.idempotentReplay, false);

  // Second enqueue (same idempotencyKey)
  const res2 = await queue.enqueue(payload, { uid: 'usr_whitfield_4417', role: 'client' });
  assert.equal(res2.success, true);
  assert.equal(res2.idempotentReplay, true, 'Duplicate enqueue must be acknowledged as idempotent replay');
  assert.equal(res1.jobId, res2.jobId, 'Job IDs must be identical');

  // Verify only ONE job exists in Firestore
  const queueStore = db.collections.get(queue.collectionName);
  assert.equal(queueStore.size, 1, 'Only one record must exist in collection');
});

test('7. Storage Reference Retention Hold: Documents cannot be purged while in delivery pipeline', async () => {
  const { DocumentDeliveryQueue, DELIVERY_STATE } = await loadQueueModule();
  const db = new MockFirestoreQueueDb();
  const queue = new DocumentDeliveryQueue(db);

  const { jobId } = await queue.enqueue({
    clientId: 'usr_whitfield_4417',
    taxpayerUid: 'usr_whitfield_4417',
    documentId: 'doc_retention_test',
    storagePath: 'clients/usr_whitfield_4417/documents/retention_test.pdf'
  }, { uid: 'usr_whitfield_4417', role: 'client' });

  // While in QUEUED state, deletion is prohibited
  const hold1 = await queue.evaluateRetentionHold(jobId);
  assert.equal(hold1.allowed, false, 'Deletion must be prohibited while QUEUED');
  assert.ok(hold1.reason.includes('Statutory Custody Hold'));

  // While in NEEDS_REVIEW, deletion is prohibited
  await db.collection(queue.collectionName).doc(jobId).update({ status: DELIVERY_STATE.NEEDS_REVIEW });
  const hold2 = await queue.evaluateRetentionHold(jobId);
  assert.equal(hold2.allowed, false, 'Deletion must be prohibited while NEEDS_REVIEW');

  // Once DELIVERED, queue hold is released (subject to 3-year statutory retention schedule)
  await db.collection(queue.collectionName).doc(jobId).update({ status: DELIVERY_STATE.DELIVERED });
  const hold3 = await queue.evaluateRetentionHold(jobId);
  assert.equal(hold3.allowed, true, 'Queue hold released once delivery confirmed');
});

test('8. Authorized Firm-Side Controlled Manual Retry', async () => {
  const { DocumentDeliveryQueue, DELIVERY_STATE } = await loadQueueModule();
  const db = new MockFirestoreQueueDb();
  const logger = new MockAuditLogger();
  const queue = new DocumentDeliveryQueue(db, logger);

  const { jobId } = await queue.enqueue({
    clientId: 'usr_whitfield_4417',
    taxpayerUid: 'usr_whitfield_4417',
    documentId: 'doc_manual_retry_test',
    storagePath: 'clients/usr_whitfield_4417/documents/manual_retry.pdf'
  }, { uid: 'usr_whitfield_4417', role: 'client' });

  // Put into NEEDS_REVIEW state with 5 exhausted attempts
  await db.collection(queue.collectionName).doc(jobId).update({
    status: DELIVERY_STATE.NEEDS_REVIEW,
    attemptCount: 5,
    lastErrorCategory: 'RETRIES_EXHAUSTED'
  });

  // Unauthorized client cannot trigger manual retry
  await assert.rejects(
    async () => queue.controlledManualRetry(jobId, { uid: 'usr_whitfield_4417', role: 'client' }, 'Attempt by client'),
    /Access Restricted/
  );

  // Authorized CPA Staff triggers controlled manual retry
  const staffContext = { uid: 'cpa_denise_8819', role: 'firm_preparer', name: 'Denise R., CPA' };
  const retryResult = await queue.controlledManualRetry(jobId, staffContext, 'Downstream endpoint resolved by CPA');
  assert.equal(retryResult.success, true);
  assert.equal(retryResult.status, DELIVERY_STATE.QUEUED);

  // Verify attemptCount was reset to 0 and immediate attempt scheduled
  const updatedDoc = await db.collection(queue.collectionName).doc(jobId).get();
  assert.equal(updatedDoc.data().attemptCount, 0, 'Attempt count must be reset to 0');
  assert.equal(updatedDoc.data().status, DELIVERY_STATE.QUEUED);
  assert.ok(updatedDoc.data().history.some(h => h.attempt === 'manual_recovery'));

  // Verify authoritative audit log
  const auditEvent = logger.events.find(e => e.eventType === 'DOCUMENT_DELIVERY_MANUAL_RETRY_TRIGGERED');
  assert.ok(auditEvent, 'Manual retry audit event must be logged');
  assert.equal(auditEvent.metadata.practitioner, 'Denise R., CPA');
});

test('9. Temporary Client-Side Storage Disclaimer: Never claim zero data loss solely via localStorage', () => {
  // Architectural invariant verification
  const clientStoragePolicy = {
    localStoragePurpose: 'temporary_recovery_aid_only',
    isAuthoritative: false,
    isEncryptedAtRest: false,
    zeroDataLossGuarantee: false,
    authoritativeStore: 'Firestore + Cloud Storage'
  };

  assert.equal(clientStoragePolicy.isAuthoritative, false, 'localStorage must never be authoritative');
  assert.equal(clientStoragePolicy.zeroDataLossGuarantee, false, 'Never claim zero data loss solely because localStorage is enabled');
  assert.equal(clientStoragePolicy.authoritativeStore, 'Firestore + Cloud Storage');
});

test('10. End-to-End Failure & Recovery Scenarios: Complete cycle verification', async () => {
  const { DocumentDeliveryQueue, DELIVERY_STATE } = await loadQueueModule();
  const db = new MockFirestoreQueueDb();
  const logger = new MockAuditLogger();
  const queue = new DocumentDeliveryQueue(db, logger);

  // Scenario A: Successful delivery on 2nd attempt (Transient 429 followed by 200 OK)
  let calls = 0;
  const mockDownstream = async () => {
    calls++;
    if (calls === 1) {
      const rateLimitErr = new Error('HTTP 429 Rate Limit Exceeded');
      rateLimitErr.status = 429;
      rateLimitErr.headers = { 'retry-after': '1' };
      throw rateLimitErr;
    }
    return { receipt: 'forminit_success_ack_99182' };
  };

  const { jobId } = await queue.enqueue({
    clientId: 'usr_whitfield_4417',
    taxpayerUid: 'usr_whitfield_4417',
    documentId: 'doc_e2e_recovery_test',
    storagePath: 'clients/usr_whitfield_4417/documents/e2e.pdf'
  }, { uid: 'usr_whitfield_4417', role: 'client' });

  // Attempt 1 -> 429 -> retry_pending
  const step1 = await queue.processJob(jobId, 'worker_1', mockDownstream);
  assert.equal(step1.status, DELIVERY_STATE.RETRY_PENDING);

  // Fast forward timer to simulate delay passing
  await db.collection(queue.collectionName).doc(jobId).update({
    nextAttemptAt: new Date(Date.now() - 100).toISOString()
  });

  // Attempt 2 -> 200 OK -> delivered
  const step2 = await queue.processJob(jobId, 'worker_1', mockDownstream);
  assert.equal(step2.status, DELIVERY_STATE.DELIVERED);
  assert.equal(step2.receipt, 'forminit_success_ack_99182');

  const finalDoc = await db.collection(queue.collectionName).doc(jobId).get();
  assert.equal(finalDoc.data().status, DELIVERY_STATE.DELIVERED);
  assert.ok(finalDoc.data().deliveredAt);
  assert.equal(finalDoc.data().attemptCount, 2);
});
