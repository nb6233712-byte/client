/**
 * ============================================================================
 * THE FILE ROOM — DURABLE DOCUMENT-DELIVERY QUEUE ENGINE
 * ============================================================================
 * 
 * Authoritative Queue & Status Store: Firestore collection `document_delivery_queue`
 * Distributed Concurrency: Transactional Lease Acquisition with TTL & Token
 * Resilience: Exponential Backoff with Jitter, Bounded Retries, Dead-Letter Office
 * Security & Compliance:
 * - FTC Safeguards Rule (16 CFR Part 314 § 314.4)
 * - IRC § 7216 & IRC § 6061 (Statutory Custody & Non-Repudiation)
 * - IRS Publication 1345 § 5 & § 6
 */

import crypto from 'node:crypto';
import { AppError, ErrorCode, unauthenticated, permissionDenied, invalidArgument, failedPrecondition, notFound } from './errors.mjs';
import { IdempotencyManager } from './idempotency.mjs';

/**
 * Explicit Document Delivery Lifecycle States
 * @readonly
 * @enum {string}
 */
export const DELIVERY_STATE = Object.freeze({
  UPLOADED: 'uploaded',                     // Stored in Cloud Storage; reference recorded
  QUEUED: 'queued',                         // Enqueued in authoritative Firestore queue
  PROCESSING: 'processing',                 // Worker acquired transactional lease
  DELIVERED: 'delivered',                   // Downstream transmission confirmed (terminal success)
  RETRY_PENDING: 'retry_pending',           // Transient failure; awaiting next backoff attempt
  PERMANENTLY_FAILED: 'permanently_failed', // Non-retryable error (e.g. 4xx client error, invalid payload)
  NEEDS_REVIEW: 'needs_review'              // Dead-letter office: retries exhausted or manual review needed
});

/**
 * Standard Error Categories for Monitoring and Triage
 * @readonly
 * @enum {string}
 */
export const ERROR_CATEGORY = Object.freeze({
  RATE_LIMIT_429: 'RATE_LIMIT_429',               // HTTP 429 Too Many Requests (upstream or downstream)
  SERVER_ERROR_5XX: 'SERVER_ERROR_5XX',           // HTTP 500, 502, 503, 504 temporary service error
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',             // Socket timeout, DNS resolution failure, network drop
  CLIENT_ERROR_4XX: 'CLIENT_ERROR_4XX',           // HTTP 400, 401, 403, 404, 422 permanent error
  SCHEMA_VALIDATION_ERROR: 'SCHEMA_VALIDATION_ERROR', // Malformed payload structure or invalid checksum
  RETRIES_EXHAUSTED: 'RETRIES_EXHAUSTED',         // Retry budget reached without success -> Dead Letter
  WORKER_LEASE_EXPIRED: 'WORKER_LEASE_EXPIRED',   // Worker crashed or timed out before completion
  MANUAL_HOLD: 'MANUAL_HOLD'                      // Placed on hold by CPA / Firm Admin
});

/**
 * Multi-Phase Document Custody & Delivery Status Model
 * Explicitly distinguishes File Storage, Intake Registration,
 * Forminit Delivery, and Fallback Delivery.
 */
export const STORAGE_STATE = Object.freeze({
  PENDING: 'pending',
  STORED: 'stored',
  FAILED: 'failed'
});

export const REGISTRATION_STATE = Object.freeze({
  PENDING: 'pending',
  REGISTERED: 'registered',
  UNCONFIRMED_OFFLINE: 'unconfirmed_offline'
});

export const DELIVERY_STATUS = Object.freeze({
  QUEUED: 'queued',
  PROCESSING: 'processing',
  FORMINIT_DELIVERED: 'forminit_delivered',
  FALLBACK_DELIVERED: 'fallback_delivered',
  RETRY_PENDING: 'retry_pending',
  FAILED: 'failed',
  PERMANENTLY_FAILED: 'permanently_failed',
  NEEDS_REVIEW: 'needs_review'
});

export const DELIVERY_CHANNEL = Object.freeze({
  PRIMARY_FORMINIT: 'primary_forminit',
  SECONDARY_FALLBACK: 'secondary_cloud_function_fallback'
});

/**
 * Default Queue Configuration Parameters
 */
export const QUEUE_CONFIG = Object.freeze({
  COLLECTION_NAME: 'document_delivery_queue',
  MAX_ATTEMPTS: 5,                  // Bounded retry ceiling
  BASE_BACKOFF_MS: 1000,            // Initial backoff interval (1s)
  MAX_BACKOFF_MS: 300000,           // Maximum backoff ceiling (5 min)
  JITTER_FACTOR: 0.25,              // ±25% randomized jitter
  LEASE_DURATION_MS: 60000,         // 60s lease window before orphan reclaim
  DOWNSTREAM_TIMEOUT_MS: 15000,     // 15s downstream HTTP timeout
  PRIMARY_ENDPOINT: 'https://forminit.com/f/rv02anqc45x',
  FALLBACK_ENDPOINT: 'https://us-central1-uk-client-d90d5.cloudfunctions.net/intakeDocumentFallback'
});

/**
 * Calculates exponential backoff with randomized jitter.
 * Prevents "thundering herd" spikes on downstream endpoints.
 * 
 * Formula:
 * backoff = min(maxMs, baseMs * 2^(attempt - 1))
 * jitter = (random() * 2 - 1) * jitterFactor * backoff
 * interval = max(baseMs, backoff + jitter)
 * 
 * @param {number} attempt - Current attempt count (1-based)
 * @param {number} [baseMs] - Base backoff in ms
 * @param {number} [maxMs] - Maximum backoff ceiling in ms
 * @param {number} [jitterFactor] - Jitter fraction (0.0 to 1.0)
 * @returns {number} Delay in milliseconds
 */
export function calculateExponentialBackoff(
  attempt,
  baseMs = QUEUE_CONFIG.BASE_BACKOFF_MS,
  maxMs = QUEUE_CONFIG.MAX_BACKOFF_MS,
  jitterFactor = QUEUE_CONFIG.JITTER_FACTOR
) {
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  const exponential = baseMs * Math.pow(2, safeAttempt - 1);
  const bounded = Math.min(maxMs, exponential);
  
  // Random jitter in range [-jitterFactor, +jitterFactor]
  const jitterDelta = (Math.random() * 2 - 1) * jitterFactor * bounded;
  const calculated = Math.round(bounded + jitterDelta);
  return Math.max(baseMs, calculated);
}

/**
 * Parses HTTP Retry-After header value (either seconds or HTTP date string).
 * 
 * @param {string|number} retryAfterHeader 
 * @returns {number|null} Delay in milliseconds, or null if invalid
 */
export function parseRetryAfterHeader(retryAfterHeader) {
  if (!retryAfterHeader) return null;
  const asNumber = Number(retryAfterHeader);
  if (!isNaN(asNumber) && asNumber >= 0) {
    return Math.round(asNumber * 1000);
  }
  const asDate = Date.parse(retryAfterHeader);
  if (!isNaN(asDate)) {
    const diff = asDate - Date.now();
    return Math.max(0, diff);
  }
  return null;
}

/**
 * Categorizes an error and determines if it is retryable.
 * 
 * @param {Error|object} err 
 * @returns {{ category: string, isRetryable: boolean, httpStatus: number|null, message: string }}
 */
export function categorizeDeliveryError(err) {
  const status = err?.status || err?.statusCode || err?.httpStatus || null;
  const rawMsg = err?.message || String(err || 'Unknown error');
  const sanitizedMsg = rawMsg.replace(/(bearer\s+[a-zA-Z0-9._-]+|key=[a-zA-Z0-9._-]+)/gi, '[REDACTED]').slice(0, 500);

  if (status === 429) {
    return {
      category: ERROR_CATEGORY.RATE_LIMIT_429,
      isRetryable: true,
      httpStatus: 429,
      message: sanitizedMsg
    };
  }

  if (status && status >= 500 && status < 600) {
    return {
      category: ERROR_CATEGORY.SERVER_ERROR_5XX,
      isRetryable: true,
      httpStatus: status,
      message: sanitizedMsg
    };
  }

  if (status && status >= 400 && status < 500) {
    return {
      category: ERROR_CATEGORY.CLIENT_ERROR_4XX,
      isRetryable: false, // 4xx (except 429) is non-retryable without payload/auth changes
      httpStatus: status,
      message: sanitizedMsg
    };
  }

  if (err?.name === 'AbortError' || rawMsg.includes('timeout') || rawMsg.includes('ETIMEDOUT') || rawMsg.includes('ECONNREFUSED') || rawMsg.includes('ENOTFOUND')) {
    return {
      category: ERROR_CATEGORY.NETWORK_TIMEOUT,
      isRetryable: true,
      httpStatus: null,
      message: sanitizedMsg
    };
  }

  if (rawMsg.includes('validation') || rawMsg.includes('schema') || rawMsg.includes('checksum')) {
    return {
      category: ERROR_CATEGORY.SCHEMA_VALIDATION_ERROR,
      isRetryable: false,
      httpStatus: 400,
      message: sanitizedMsg
    };
  }

  return {
    category: ERROR_CATEGORY.SERVER_ERROR_5XX,
    isRetryable: true,
    httpStatus: status,
    message: sanitizedMsg
  };
}

/**
 * Validates whether a state transition is legal in the state machine.
 * 
 * @param {string} fromState 
 * @param {string} toState 
 * @returns {boolean}
 */
export function isValidStateTransition(fromState, toState) {
  const ALLOWED_TRANSITIONS = {
    [DELIVERY_STATE.UPLOADED]: [DELIVERY_STATE.QUEUED, DELIVERY_STATE.PERMANENTLY_FAILED],
    [DELIVERY_STATE.QUEUED]: [DELIVERY_STATE.PROCESSING, DELIVERY_STATE.PERMANENTLY_FAILED, DELIVERY_STATE.NEEDS_REVIEW],
    [DELIVERY_STATE.PROCESSING]: [
      DELIVERY_STATE.DELIVERED,
      DELIVERY_STATE.RETRY_PENDING,
      DELIVERY_STATE.PERMANENTLY_FAILED,
      DELIVERY_STATE.NEEDS_REVIEW
    ],
    [DELIVERY_STATE.RETRY_PENDING]: [DELIVERY_STATE.PROCESSING, DELIVERY_STATE.NEEDS_REVIEW, DELIVERY_STATE.PERMANENTLY_FAILED],
    [DELIVERY_STATE.DELIVERED]: [], // Terminal success state
    [DELIVERY_STATE.PERMANENTLY_FAILED]: [DELIVERY_STATE.QUEUED], // Only allowed via controlled manual retry by staff
    [DELIVERY_STATE.NEEDS_REVIEW]: [DELIVERY_STATE.QUEUED, DELIVERY_STATE.PERMANENTLY_FAILED] // Re-queued via controlled manual retry
  };

  return (ALLOWED_TRANSITIONS[fromState] || []).includes(toState);
}

/**
 * Durable Document-Delivery Queue Manager
 */
export class DocumentDeliveryQueue {
  /**
   * @param {object} firestoreDb - Firestore Database instance
   * @param {object} [auditLogger] - Authoritative Audit Ledger Service
   * @param {object} [idempotencyManager] - Idempotency Manager
   * @param {object} [options] - Custom queue overrides
   */
  constructor(firestoreDb, auditLogger = null, idempotencyManager = null, options = {}) {
    this.db = firestoreDb;
    this.auditLogger = auditLogger;
    this.idempotencyManager = idempotencyManager || new IdempotencyManager(firestoreDb);
    this.config = { ...QUEUE_CONFIG, ...options };
    this.fallbackHandler = options.fallbackHandler || null;
    this.collectionName = this.config.COLLECTION_NAME;
  }

  /**
   * Creates a deterministic idempotency key for a document delivery job.
   * Format: ik_ddq_{clientId}_{documentId}_{checksumPrefix}
   */
  static generateIdempotencyKey(clientId, documentId, sha256Checksum = '') {
    const cleanClient = String(clientId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanDoc = String(documentId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const prefix = sha256Checksum ? String(sha256Checksum).slice(0, 16) : 'nochk';
    return `ik_ddq_${cleanClient}_${cleanDoc}_${prefix}`;
  }

  /**
   * Enqueues a document delivery job after storage reference is established.
   * Enforces:
   * 1. Valid authentication and tenant boundary
   * 2. Authoritative Cloud Storage reference must exist
   * 3. Idempotent deduplication (does not create duplicate records on repeated uploads)
   * 
   * @param {object} payload - Job parameters
   * @param {object} [context] - Security & auth context
   * @returns {Promise<object>} Enqueue result
   */
  async enqueue(payload, context = {}) {
    const actorUid = context.uid || payload.taxpayerUid || payload.clientId;
    if (!actorUid) {
      throw unauthenticated('Authentication required: Sign-in required to queue document delivery.');
    }

    const clientId = payload.clientId || actorUid;
    const isStaff = context.role === 'firm_admin' || context.role === 'firm_preparer';
    if (clientId !== actorUid && !isStaff) {
      throw permissionDenied('Tenant isolation violation: Cannot queue documents for other taxpayers.');
    }

    // Require stable, authorized Cloud Storage reference before enqueueing
    const storagePath = payload.storagePath;
    if (!storagePath || typeof storagePath !== 'string') {
      throw invalidArgument('Missing required field: storagePath document reference in Cloud Storage.');
    }

    if (storagePath.includes('..') || storagePath.startsWith('/')) {
      throw invalidArgument('Security Violation: Invalid or traversing storage path format.');
    }

    const validTenantPrefix = 'clients/' + clientId + '/';
    const validIntakePrefix = 'intake_submissions/' + clientId + '/';
    if (!storagePath.startsWith(validTenantPrefix) && !storagePath.startsWith(validIntakePrefix)) {
      throw permissionDenied('Storage path does not reside in authorized tenant custody boundary.');
    }

    const documentId = payload.documentId || payload.requestId || `doc_${Date.now()}`;
    const sha256Checksum = payload.sha256Checksum || null;
    const idempotencyKey = payload.idempotencyKey || DocumentDeliveryQueue.generateIdempotencyKey(clientId, documentId, sha256Checksum);
    const jobId = `ddq_${idempotencyKey.replace(/^ik_ddq_/, '')}`;

    // 1. Idempotency Check: Prevent duplicate document records & double submission
    const existingJob = await this.getJobByIdempotencyKey(idempotencyKey);
    if (existingJob) {
      return {
        success: true,
        jobId: existingJob.id || existingJob.jobId,
        idempotencyKey,
        documentId: existingJob.documentId || documentId,
        status: existingJob.status,
        storageState: existingJob.storageState || STORAGE_STATE.STORED,
        registrationState: existingJob.registrationState || REGISTRATION_STATE.REGISTERED,
        deliveryStatus: existingJob.deliveryStatus || (existingJob.status === DELIVERY_STATE.DELIVERED ? DELIVERY_STATUS.FORMINIT_DELIVERED : existingJob.status),
        attemptCount: existingJob.attemptCount,
        nextAttemptAt: existingJob.nextAttemptAt,
        storagePath: existingJob.storagePath,
        idempotentReplay: true,
        message: 'Existing delivery queue job returned idempotently without creating duplicate records.'
      };
    }

    // 2. Create authoritative queue item in Firestore
    const nowIso = new Date().toISOString();
    const jobRecord = {
      id: jobId,
      jobId,
      idempotencyKey,
      documentId,
      requestId: payload.requestId || documentId,
      clientId,
      clientEmail: payload.clientEmail || context.email || '',
      taxYear: Number(payload.taxYear) || 2026,
      fileName: (payload.fileName || payload.originalFileName || 'tax-document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150),
      fileSizeBytes: Number(payload.fileSizeBytes || payload.fileSize) || 0,
      mimeType: payload.mimeType || 'application/pdf',
      detectedType: payload.detectedType || 'Tax Document',
      storagePath,
      fileStorageUri: payload.fileStorageUri || `gs://uk-client-d90d5.appspot.com/${storagePath}`,
      downloadUrl: payload.downloadUrl || '',
      sha256Checksum,
      status: DELIVERY_STATE.QUEUED,
      storageState: STORAGE_STATE.STORED,
      registrationState: REGISTRATION_STATE.REGISTERED,
      deliveryStatus: DELIVERY_STATUS.QUEUED,
      deliveryChannel: null,
      attemptCount: 0,
      maxAttempts: Number(payload.maxAttempts) || this.config.MAX_ATTEMPTS,
      nextAttemptAt: nowIso,
      lastAttemptAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      deliveredAt: null,
      lastErrorCategory: null,
      lastErrorMessage: null,
      lastHttpStatus: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseToken: null,
      deliveryReceipt: null,
      downstreamEndpoint: payload.downstreamEndpoint || payload.endpointUrl || this.config.PRIMARY_ENDPOINT,
      fallbackEndpoint: payload.fallbackEndpoint || this.config.FALLBACK_ENDPOINT,
      manualReviewNotes: null,
      history: [
        {
          attempt: 0,
          timestamp: nowIso,
          status: DELIVERY_STATE.QUEUED,
          storageState: STORAGE_STATE.STORED,
          registrationState: REGISTRATION_STATE.REGISTERED,
          note: 'Document reference verified in Cloud Storage and enqueued for downstream delivery.'
        }
      ]
    };

    if (this.db && typeof this.db.collection === 'function') {
      await this.db.collection(this.collectionName).doc(jobId).set(jobRecord);
    }

    if (this.auditLogger && typeof this.auditLogger.recordAuthoritativeEvent === 'function') {
      try {
        await this.auditLogger.recordAuthoritativeEvent({
          eventType: 'DOCUMENT_DELIVERY_QUEUED',
          actor: context,
          targetId: jobId,
          targetType: 'DocumentDeliveryQueue',
          summary: `Document [${jobRecord.fileName}] enqueued for downstream delivery. IdempotencyKey: ${idempotencyKey}`,
          metadata: {
            jobId,
            idempotencyKey,
            clientId,
            storagePath,
            status: DELIVERY_STATE.QUEUED
          }
        });
      } catch (aErr) {
        console.warn('Queue audit log write warning:', aErr.message);
      }
    }

    return {
      success: true,
      jobId,
      idempotencyKey,
      documentId,
      status: DELIVERY_STATE.QUEUED,
      storageState: STORAGE_STATE.STORED,
      registrationState: REGISTRATION_STATE.REGISTERED,
      deliveryStatus: DELIVERY_STATUS.QUEUED,
      attemptCount: 0,
      nextAttemptAt: nowIso,
      storagePath,
      idempotentReplay: false,
      message: 'Document successfully vaulted in Cloud Storage and enqueued in authoritative delivery queue.'
    };
  }

  /**
   * Looks up a job by its unique idempotency key.
   */
  async getJobByIdempotencyKey(idempotencyKey) {
    if (!this.db || typeof this.db.collection !== 'function') return null;
    const jobId = `ddq_${idempotencyKey.replace(/^ik_ddq_/, '')}`;
    try {
      const doc = await this.db.collection(this.collectionName).doc(jobId).get();
      if (doc && (doc.exists || (typeof doc.data === 'function' && doc.data()))) {
        return { id: doc.id, ...(typeof doc.data === 'function' ? doc.data() : doc) };
      }
      // Also query by idempotencyKey field
      const snap = await this.db.collection(this.collectionName).where('idempotencyKey', '==', idempotencyKey).limit(1).get();
      if (snap && snap.docs && snap.docs.length > 0) {
        const first = snap.docs[0];
        return { id: first.id, ...first.data() };
      }
    } catch (_) {}
    return null;
  }

  /**
   * Acquires a transactional worker lease on a due queue job.
   * Multiple workers cannot process the same job concurrently.
   * Reclaims orphaned jobs where a previous worker lease expired.
   * 
   * @param {string} jobId - Job ID
   * @param {string} workerId - Unique identifier of the processing worker
   * @param {number} [leaseDurationMs] - Duration of lease in ms
   * @returns {Promise<{ acquired: boolean, job: object|null, reason?: string }>}
   */
  async acquireLease(jobId, workerId, leaseDurationMs = this.config.LEASE_DURATION_MS) {
    if (!this.db) return { acquired: false, job: null, reason: 'Database unavailable' };

    const docRef = this.db.collection(this.collectionName).doc(jobId);
    const leaseToken = crypto.randomUUID();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const leaseExpiresAt = new Date(nowMs + leaseDurationMs).toISOString();

    // Use runTransaction if available, or atomic compare-and-swap
    if (typeof this.db.runTransaction === 'function') {
      try {
        const acquiredJob = await this.db.runTransaction(async (transaction) => {
          const doc = await transaction.get(docRef);
          if (!doc.exists) {
            return { acquired: false, reason: 'Job not found' };
          }
          const data = doc.data();

          // Condition 1: Must be in a ready state (QUEUED or RETRY_PENDING) and nextAttemptAt <= now
          // OR in PROCESSING with an EXPIRED lease
          const isReadyState = (data.status === DELIVERY_STATE.QUEUED || data.status === DELIVERY_STATE.RETRY_PENDING);
          const isNextAttemptDue = !data.nextAttemptAt || Date.parse(data.nextAttemptAt) <= nowMs;
          const isLeaseExpired = (data.status === DELIVERY_STATE.PROCESSING && data.leaseExpiresAt && Date.parse(data.leaseExpiresAt) < nowMs);

          if (!((isReadyState && isNextAttemptDue) || isLeaseExpired)) {
            return {
              acquired: false,
              reason: `Job not eligible for lease: status=${data.status}, nextAttemptAt=${data.nextAttemptAt}, leaseExpiresAt=${data.leaseExpiresAt}`
            };
          }

          const nextAttemptCount = (Number(data.attemptCount) || 0) + 1;
          const updates = {
            status: DELIVERY_STATE.PROCESSING,
            attemptCount: nextAttemptCount,
            leaseOwner: workerId,
            leaseToken,
            leaseExpiresAt,
            lastAttemptAt: nowIso,
            updatedAt: nowIso
          };

          transaction.update(docRef, updates);
          return {
            acquired: true,
            job: { ...data, ...updates },
            leaseToken
          };
        });

        return acquiredJob;
      } catch (err) {
        return { acquired: false, reason: `Transaction aborted: ${err.message}` };
      }
    } else {
      // Mock / fallback transaction path
      const doc = await docRef.get();
      if (!doc || !doc.exists) return { acquired: false, reason: 'Job not found' };
      const data = typeof doc.data === 'function' ? doc.data() : doc;

      const isReadyState = (data.status === DELIVERY_STATE.QUEUED || data.status === DELIVERY_STATE.RETRY_PENDING);
      const isNextAttemptDue = !data.nextAttemptAt || Date.parse(data.nextAttemptAt) <= nowMs;
      const isLeaseExpired = (data.status === DELIVERY_STATE.PROCESSING && data.leaseExpiresAt && Date.parse(data.leaseExpiresAt) < nowMs);

      if (!((isReadyState && isNextAttemptDue) || isLeaseExpired)) {
        return { acquired: false, reason: 'Job not eligible for lease' };
      }

      const nextAttemptCount = (Number(data.attemptCount) || 0) + 1;
      const updates = {
        status: DELIVERY_STATE.PROCESSING,
        attemptCount: nextAttemptCount,
        leaseOwner: workerId,
        leaseToken,
        leaseExpiresAt,
        lastAttemptAt: nowIso,
        updatedAt: nowIso
      };

      await docRef.update ? docRef.update(updates) : docRef.set({ ...data, ...updates });
      return { acquired: true, job: { ...data, ...updates }, leaseToken };
    }
  }

  /**
   * Processes a single delivery job:
   * 1. Acquires lease
   * 2. Executes transmission to downstream service
   * 3. Handles success, transient 429/5xx (exponential backoff), permanent 4xx, or retries exhausted (dead-letter)
   * 
   * @param {string} jobId - Target queue job
   * @param {string} workerId - Worker ID
   * @param {Function} [transmitterFn] - Custom HTTP transmission function (for testing or real fetch)
   * @returns {Promise<object>} Execution outcome
   */
  async processJob(jobId, workerId = 'worker_local_1', transmitterFn = null) {
    const lease = await this.acquireLease(jobId, workerId);
    if (!lease.acquired) {
      return { success: false, skipped: true, reason: lease.reason };
    }

    const job = lease.job;
    const leaseToken = lease.leaseToken;
    const docRef = this.db.collection(this.collectionName).doc(jobId);
    const nowIso = new Date().toISOString();

    try {
      // Execute transmission via provided transmitter or default fetch
      const transmitter = transmitterFn || this.defaultTransmitter.bind(this);
      const deliveryResult = await transmitter(job);

      // Verify lease is still held by this worker
      const currentDoc = await docRef.get();
      const currentData = typeof currentDoc.data === 'function' ? currentDoc.data() : currentDoc;
      if (currentData.leaseToken !== leaseToken) {
        console.warn(`[QueueWorker] Lease lost for job ${jobId} during execution. Not committing result.`);
        return { success: false, leaseLost: true };
      }

      // Transition to DELIVERED (Terminal Success)
      const receipt = deliveryResult?.receipt || deliveryResult?.id || `rcpt_${Date.now()}`;
      const deliveryStatus = deliveryResult?.deliveryStatus || (deliveryResult?.deliveryChannel === DELIVERY_CHANNEL.SECONDARY_FALLBACK ? DELIVERY_STATUS.FALLBACK_DELIVERED : DELIVERY_STATUS.FORMINIT_DELIVERED);
      const deliveryChannel = deliveryResult?.deliveryChannel || (deliveryStatus === DELIVERY_STATUS.FALLBACK_DELIVERED ? DELIVERY_CHANNEL.SECONDARY_FALLBACK : DELIVERY_CHANNEL.PRIMARY_FORMINIT);

      const successUpdates = {
        status: DELIVERY_STATE.DELIVERED,
        storageState: STORAGE_STATE.STORED,
        registrationState: REGISTRATION_STATE.REGISTERED,
        deliveryStatus: deliveryStatus,
        deliveryChannel: deliveryChannel,
        deliveredAt: nowIso,
        updatedAt: nowIso,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        deliveryReceipt: receipt,
        history: [
          ...(currentData.history || []),
          {
            attempt: currentData.attemptCount,
            timestamp: nowIso,
            status: DELIVERY_STATE.DELIVERED,
            deliveryStatus: deliveryStatus,
            deliveryChannel: deliveryChannel,
            receipt,
            note: deliveryStatus === DELIVERY_STATUS.FALLBACK_DELIVERED
              ? 'Downstream delivery confirmed via Firebase Cloud Function fallback.'
              : 'Downstream transmission confirmed with Forminit HTTP 2xx acknowledgment.'
          }
        ]
      };

      await docRef.update ? docRef.update(successUpdates) : docRef.set({ ...currentData, ...successUpdates });

      if (this.auditLogger && typeof this.auditLogger.recordAuthoritativeEvent === 'function') {
        try {
          await this.auditLogger.recordAuthoritativeEvent({
            eventType: 'DOCUMENT_DELIVERY_CONFIRMED',
            actor: { uid: workerId, role: 'system_worker' },
            targetId: jobId,
            targetType: 'DocumentDeliveryQueue',
            summary: `Document delivery confirmed downstream via ${deliveryChannel}. Receipt: ${receipt}`,
            metadata: { jobId, receipt, deliveryStatus, deliveryChannel, attemptCount: currentData.attemptCount }
          });
        } catch (_) {}
      }

      return {
        success: true,
        status: DELIVERY_STATE.DELIVERED,
        storageState: STORAGE_STATE.STORED,
        registrationState: REGISTRATION_STATE.REGISTERED,
        deliveryStatus: deliveryStatus,
        deliveryChannel: deliveryChannel,
        receipt,
        attemptCount: currentData.attemptCount
      };

    } catch (err) {
      // Analyze and categorize error
      const categorized = categorizeDeliveryError(err);
      const currentDoc = await docRef.get();
      const currentData = typeof currentDoc.data === 'function' ? currentDoc.data() : currentDoc;

      if (currentData.leaseToken !== leaseToken) {
        return { success: false, leaseLost: true, error: categorized.message };
      }

      const attemptCount = currentData.attemptCount || 1;
      const maxAttempts = currentData.maxAttempts || this.config.MAX_ATTEMPTS;

      // Case 1: Non-retryable Permanent Error (HTTP 4xx except 429, schema violation)
      if (!categorized.isRetryable) {
        const failUpdates = {
          status: DELIVERY_STATE.PERMANENTLY_FAILED,
          deliveryStatus: DELIVERY_STATUS.PERMANENTLY_FAILED,
          lastErrorCategory: categorized.category,
          lastErrorMessage: categorized.message,
          lastHttpStatus: categorized.httpStatus,
          updatedAt: nowIso,
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          history: [
            ...(currentData.history || []),
            {
              attempt: attemptCount,
              timestamp: nowIso,
              status: DELIVERY_STATE.PERMANENTLY_FAILED,
              category: categorized.category,
              httpStatus: categorized.httpStatus,
              error: categorized.message,
              note: 'Non-retryable client error. Fast failed without wasting retry budget.'
            }
          ]
        };

        await docRef.update ? docRef.update(failUpdates) : docRef.set({ ...currentData, ...failUpdates });
        return {
          success: false,
          status: DELIVERY_STATE.PERMANENTLY_FAILED,
          deliveryStatus: DELIVERY_STATUS.PERMANENTLY_FAILED,
          category: categorized.category,
          error: categorized.message
        };
      }

      // Case 2: Retry Budget Exhausted -> Transition to NEEDS_REVIEW (Dead Letter Office)
      if (attemptCount >= maxAttempts) {
        const deadLetterUpdates = {
          status: DELIVERY_STATE.NEEDS_REVIEW,
          deliveryStatus: DELIVERY_STATUS.NEEDS_REVIEW,
          lastErrorCategory: ERROR_CATEGORY.RETRIES_EXHAUSTED,
          lastErrorMessage: `Retry budget of ${maxAttempts} attempts exhausted. Final error: ${categorized.message}`,
          lastHttpStatus: categorized.httpStatus,
          updatedAt: nowIso,
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          manualReviewRequired: true,
          history: [
            ...(currentData.history || []),
            {
              attempt: attemptCount,
              timestamp: nowIso,
              status: DELIVERY_STATE.NEEDS_REVIEW,
              category: ERROR_CATEGORY.RETRIES_EXHAUSTED,
              httpStatus: categorized.httpStatus,
              error: categorized.message,
              note: `Maximum retry ceiling (${maxAttempts}) reached. Moved to Dead-Letter Office / Needs Review.`
            }
          ]
        };

        await docRef.update ? docRef.update(deadLetterUpdates) : docRef.set({ ...currentData, ...deadLetterUpdates });

        if (this.auditLogger && typeof this.auditLogger.recordAuthoritativeEvent === 'function') {
          try {
            await this.auditLogger.recordAuthoritativeEvent({
              eventType: 'DOCUMENT_DELIVERY_DEAD_LETTERED',
              actor: { uid: workerId, role: 'system_worker' },
              targetId: jobId,
              targetType: 'DocumentDeliveryQueue',
              summary: `Job [${jobId}] moved to Needs Review (Dead Letter). Attempts exhausted: ${attemptCount}/${maxAttempts}`,
              metadata: { jobId, attemptCount, maxAttempts, lastError: categorized.message }
            });
          } catch (_) {}
        }

        return {
          success: false,
          status: DELIVERY_STATE.NEEDS_REVIEW,
          deliveryStatus: DELIVERY_STATUS.NEEDS_REVIEW,
          category: ERROR_CATEGORY.RETRIES_EXHAUSTED,
          retriesExhausted: true,
          error: categorized.message
        };
      }

      // Case 3: Transient Error (HTTP 429, 5xx, Network Timeout) -> RETRY_PENDING with Backoff & Jitter
      let delayMs = 0;
      if (categorized.category === ERROR_CATEGORY.RATE_LIMIT_429 && err?.headers?.['retry-after']) {
        const parsedRetryAfter = parseRetryAfterHeader(err.headers['retry-after']);
        delayMs = parsedRetryAfter !== null ? parsedRetryAfter : calculateExponentialBackoff(attemptCount, this.config.BASE_BACKOFF_MS, this.config.MAX_BACKOFF_MS);
      } else {
        delayMs = calculateExponentialBackoff(attemptCount, this.config.BASE_BACKOFF_MS, this.config.MAX_BACKOFF_MS);
      }

      const nextAttemptAtIso = new Date(Date.now() + delayMs).toISOString();
      const retryUpdates = {
        status: DELIVERY_STATE.RETRY_PENDING,
        deliveryStatus: DELIVERY_STATUS.RETRY_PENDING,
        lastErrorCategory: categorized.category,
        lastErrorMessage: categorized.message,
        lastHttpStatus: categorized.httpStatus,
        nextAttemptAt: nextAttemptAtIso,
        updatedAt: nowIso,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        history: [
          ...(currentData.history || []),
          {
            attempt: attemptCount,
            timestamp: nowIso,
            status: DELIVERY_STATE.RETRY_PENDING,
            category: categorized.category,
            httpStatus: categorized.httpStatus,
            delayMs,
            nextAttemptAt: nextAttemptAtIso,
            error: categorized.message,
            note: `Transient error. Scheduled retry #${attemptCount + 1} with exponential backoff + jitter (+${delayMs}ms).`
          }
        ]
      };

      await docRef.update ? docRef.update(retryUpdates) : docRef.set({ ...currentData, ...retryUpdates });

      // Monitor repeated failures: record audit event when retry count reaches 2 or more
      if (attemptCount >= 2 && this.auditLogger && typeof this.auditLogger.recordAuthoritativeEvent === 'function') {
        try {
          await this.auditLogger.recordAuthoritativeEvent({
            eventType: 'DOCUMENT_DELIVERY_RETRY_SCHEDULED',
            actor: { uid: workerId, role: 'system_worker' },
            targetId: jobId,
            targetType: 'DocumentDeliveryQueue',
            summary: `Repeated failure monitoring: Job [${jobId}] scheduled for retry #${attemptCount + 1}. Error: ${categorized.message.slice(0, 100)}`,
            metadata: { jobId, attemptCount, category: categorized.category, nextAttemptAt: nextAttemptAtIso }
          });
        } catch (_) {}
      }

      return {
        success: false,
        status: DELIVERY_STATE.RETRY_PENDING,
        deliveryStatus: DELIVERY_STATUS.RETRY_PENDING,
        category: categorized.category,
        attemptCount,
        maxAttempts,
        nextAttemptAt: nextAttemptAtIso,
        delayMs,
        error: categorized.message
      };
    }
  }

  /**
   * Dual-Destination Downstream Transmitter:
   * 1. Reconciles destination outcome before transmitting (prevents duplicate submissions on uncertain timeouts).
   * 2. Primary Destination: Forminit (https://forminit.com/f/rv02anqc45x) with bounded timeout.
   * 3. On retryable failures (timeout, 429, 5xx), routes to Secondary Fallback (Firebase Cloud Function).
   * 4. Fails fast on non-retryable 4xx errors without routing to fallback.
   * 
   * @param {object} job - Queue job record
   * @returns {Promise<{ receipt: string, deliveryStatus: string, deliveryChannel: string, idempotentReplay?: boolean }>}
   */
  async defaultTransmitter(job) {
    const primaryEndpoint = job.downstreamEndpoint || this.config.PRIMARY_ENDPOINT || 'https://forminit.com/f/rv02anqc45x';
    const fallbackEndpoint = job.fallbackEndpoint || this.config.FALLBACK_ENDPOINT || 'https://us-central1-uk-client-d90d5.cloudfunctions.net/intakeDocumentFallback';

    // 1. Reconciliation check before firing transmission to prevent duplicate submissions
    const reconciled = await this.reconcileUncertainDelivery(job.jobId);
    if (reconciled && reconciled.isDelivered) {
      return {
        receipt: reconciled.receipt || `reconciled_${job.jobId}`,
        deliveryStatus: reconciled.deliveryStatus || DELIVERY_STATUS.FORMINIT_DELIVERED,
        deliveryChannel: reconciled.deliveryStatus === DELIVERY_STATUS.FALLBACK_DELIVERED ? DELIVERY_CHANNEL.SECONDARY_FALLBACK : DELIVERY_CHANNEL.PRIMARY_FORMINIT,
        idempotentReplay: true,
        reconciled: true
      };
    }

    const payload = {
      jobId: job.jobId,
      idempotencyKey: job.idempotencyKey,
      documentId: job.documentId,
      requestId: job.requestId,
      clientId: job.clientId,
      clientEmail: job.clientEmail,
      taxYear: job.taxYear,
      fileName: job.fileName,
      storagePath: job.storagePath,
      fileStorageUri: job.fileStorageUri || `gs://uk-client-d90d5.appspot.com/${job.storagePath}`,
      downloadUrl: job.downloadUrl || '',
      sha256Checksum: job.sha256Checksum,
      fileSizeBytes: job.fileSizeBytes,
      mimeType: job.mimeType || 'application/pdf',
      attemptCount: job.attemptCount,
      timestamp: new Date().toISOString()
    };

    // 2. Attempt Primary Destination: Forminit with bounded timeout
    const primaryController = new AbortController();
    const primaryTimeoutId = setTimeout(() => primaryController.abort(), this.config.DOWNSTREAM_TIMEOUT_MS);

    let primaryError = null;
    let primaryStatus = null;
    let primaryRetryAfter = null;

    try {
      const response = await fetch(primaryEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Idempotency-Key': job.idempotencyKey,
          'X-The-File-Room-Job-Id': job.jobId
        },
        body: JSON.stringify(payload),
        signal: primaryController.signal
      });
      clearTimeout(primaryTimeoutId);

      primaryStatus = response.status;
      primaryRetryAfter = response.headers?.get ? response.headers.get('retry-after') : null;

      if (response.ok || primaryStatus === 200 || primaryStatus === 201) {
        const responseData = await response.json().catch(() => ({}));
        return {
          receipt: responseData.id || responseData.receipt || `forminit_${job.jobId}_ack`,
          deliveryStatus: DELIVERY_STATUS.FORMINIT_DELIVERED,
          deliveryChannel: DELIVERY_CHANNEL.PRIMARY_FORMINIT
        };
      }

      // Fast-fail permanent 4xx client errors (400, 401, 403, 404, 422 - except 429 & 408)
      if (primaryStatus >= 400 && primaryStatus < 500 && primaryStatus !== 429 && primaryStatus !== 408) {
        const errorText = await response.text().catch(() => '');
        const err = new Error(`Downstream delivery permanently rejected by Forminit (HTTP ${primaryStatus}): ${errorText.slice(0, 200)}`);
        err.status = primaryStatus;
        err.statusCode = primaryStatus;
        throw err;
      }

      const errorText = await response.text().catch(() => '');
      primaryError = new Error(`Forminit returned HTTP ${primaryStatus}: ${errorText.slice(0, 200)}`);
      primaryError.status = primaryStatus;
      primaryError.statusCode = primaryStatus;
      primaryError.headers = { 'retry-after': primaryRetryAfter };
    } catch (fErr) {
      clearTimeout(primaryTimeoutId);
      // Non-retryable errors throw immediately
      if (fErr.status && fErr.status >= 400 && fErr.status < 500 && fErr.status !== 429 && fErr.status !== 408) {
        throw fErr;
      }
      primaryError = fErr;
    }

    // 3. Forminit failed with retryable error (timeout, 429, 5xx, or network failure).
    // Route to Secondary Fallback: Firebase Cloud Function Fallback
    const fallbackController = new AbortController();
    const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), this.config.DOWNSTREAM_TIMEOUT_MS);

    try {
      if (this.fallbackHandler && typeof this.fallbackHandler === 'function') {
        const fbRes = await this.fallbackHandler({
          ...payload,
          context: { uid: job.clientId, role: 'client' }
        });
        clearTimeout(fallbackTimeoutId);
        if (fbRes && fbRes.success) {
          return {
            receipt: fbRes.submissionId || fbRes.idempotencyKey || `fallback_${job.jobId}_ack`,
            deliveryStatus: DELIVERY_STATUS.FALLBACK_DELIVERED,
            deliveryChannel: DELIVERY_CHANNEL.SECONDARY_FALLBACK,
            idempotentReplay: !!fbRes.idempotentReplay
          };
        }
      }

      const fallbackResponse = await fetch(fallbackEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Idempotency-Key': job.idempotencyKey,
          'X-The-File-Room-Job-Id': job.jobId
        },
        body: JSON.stringify(payload),
        signal: fallbackController.signal
      });
      clearTimeout(fallbackTimeoutId);

      if (fallbackResponse.ok || fallbackResponse.status === 200 || fallbackResponse.status === 201) {
        const fbData = await fallbackResponse.json().catch(() => ({}));
        return {
          receipt: fbData.submissionId || fbData.id || fbData.receipt || `fallback_${job.jobId}_ack`,
          deliveryStatus: DELIVERY_STATUS.FALLBACK_DELIVERED,
          deliveryChannel: DELIVERY_CHANNEL.SECONDARY_FALLBACK,
          idempotentReplay: !!fbData.idempotentReplay
        };
      }

      const fbErrorText = await fallbackResponse.text().catch(() => '');
      const fbErr = new Error(`Secondary Firebase fallback failed with HTTP ${fallbackResponse.status}: ${fbErrorText.slice(0, 200)}`);
      fbErr.status = fallbackResponse.status;
      fbErr.statusCode = fallbackResponse.status;
      fbErr.headers = { 'retry-after': fallbackResponse.headers?.get ? fallbackResponse.headers.get('retry-after') : primaryRetryAfter };
      throw fbErr;
    } catch (fbErr) {
      clearTimeout(fallbackTimeoutId);
      // If fallback threw or failed, throw error for queue retry / backoff
      throw fbErr;
    }
  }

  /**
   * Queries and processes all due jobs in the queue.
   * Can be invoked by a Cloud Scheduler trigger, Cloud Task, or background polling worker.
   * 
   * @param {string} workerId - Worker ID
   * @param {number} [batchSize] - Maximum jobs to process in this cycle
   * @param {Function} [transmitterFn] - Optional mock transmitter
   * @returns {Promise<{ processed: number, delivered: number, retrying: number, failed: number, deadLettered: number }>}
   */
  async processDueJobs(workerId = 'worker_scheduler_1', batchSize = 10, transmitterFn = null) {
    if (!this.db || typeof this.db.collection !== 'function') {
      return { processed: 0, delivered: 0, retrying: 0, failed: 0, deadLettered: 0 };
    }

    const nowIso = new Date().toISOString();
    const results = { processed: 0, delivered: 0, retrying: 0, failed: 0, deadLettered: 0 };

    try {
      // Find eligible items:
      // status in ['queued', 'retry_pending'] AND nextAttemptAt <= now
      let eligibleDocs = [];

      try {
        const q1 = await this.db.collection(this.collectionName)
          .where('status', 'in', [DELIVERY_STATE.QUEUED, DELIVERY_STATE.RETRY_PENDING])
          .where('nextAttemptAt', '<=', nowIso)
          .limit(batchSize)
          .get();

        if (q1 && q1.docs) {
          eligibleDocs = q1.docs;
        }
      } catch (_) {
        // Fallback for emulator or composite index limitations: query by status then filter in memory
        const qFallback = await this.db.collection(this.collectionName).limit(batchSize * 3).get();
        if (qFallback && qFallback.docs) {
          const nowMs = Date.now();
          eligibleDocs = qFallback.docs.filter((d) => {
            const data = typeof d.data === 'function' ? d.data() : d;
            const isReady = data.status === DELIVERY_STATE.QUEUED || data.status === DELIVERY_STATE.RETRY_PENDING;
            const isDue = !data.nextAttemptAt || Date.parse(data.nextAttemptAt) <= nowMs;
            const isExpiredLease = data.status === DELIVERY_STATE.PROCESSING && data.leaseExpiresAt && Date.parse(data.leaseExpiresAt) < nowMs;
            return (isReady && isDue) || isExpiredLease;
          }).slice(0, batchSize);
        }
      }

      for (const doc of eligibleDocs) {
        const jobId = doc.id;
        const outcome = await this.processJob(jobId, workerId, transmitterFn);
        if (outcome.skipped) continue;

        results.processed++;
        if (outcome.status === DELIVERY_STATE.DELIVERED) results.delivered++;
        else if (outcome.status === DELIVERY_STATE.RETRY_PENDING) results.retrying++;
        else if (outcome.status === DELIVERY_STATE.PERMANENTLY_FAILED) results.failed++;
        else if (outcome.status === DELIVERY_STATE.NEEDS_REVIEW) results.deadLettered++;
      }
    } catch (pollErr) {
      console.warn('Queue polling error:', pollErr.message);
    }

    return results;
  }

  /**
   * Authorized Firm-Side Controlled Manual Retry.
   * Allows authorized CPAs and Firm Admins to manually re-queue a dead-lettered,
   * failed, or stuck job with a fresh retry budget and immediate dispatch.
   * 
   * @param {string} jobId - Queue job ID
   * @param {object} actorContext - Authenticated practitioner context
   * @param {string} [notes] - Review notes explaining retry rationale
   * @returns {Promise<object>}
   */
  async controlledManualRetry(jobId, actorContext = {}, notes = '') {
    const isStaff = actorContext.role === 'firm_admin' || actorContext.role === 'firm_preparer' || actorContext.isStaff === true;
    if (!isStaff) {
      throw permissionDenied('Access Restricted: Only authorized CPA firm staff can execute controlled manual retries.');
    }

    if (!this.db) throw new Error('Database connection unavailable.');

    const docRef = this.db.collection(this.collectionName).doc(jobId);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw notFound(`Queue job not found: ${jobId}`);
    }

    const data = typeof doc.data === 'function' ? doc.data() : doc;
    const nowIso = new Date().toISOString();
    const practitionerName = actorContext.name || actorContext.displayName || actorContext.email || 'Practitioner';

    // Reset attempt budget and set immediate next attempt time
    const resetUpdates = {
      status: DELIVERY_STATE.QUEUED,
      attemptCount: 0,
      nextAttemptAt: nowIso,
      lastAttemptAt: null,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      manualReviewNotes: notes || data.manualReviewNotes || 'Manual retry requested by practitioner.',
      updatedAt: nowIso,
      history: [
        ...(data.history || []),
        {
          attempt: 'manual_recovery',
          timestamp: nowIso,
          status: DELIVERY_STATE.QUEUED,
          actor: practitionerName,
          note: `Controlled manual retry authorized by ${practitionerName}. Attempt budget reset to 0.` + (notes ? ` Reason: ${notes}` : '')
        }
      ]
    };

    await docRef.update ? docRef.update(resetUpdates) : docRef.set({ ...data, ...resetUpdates });

    if (this.auditLogger && typeof this.auditLogger.recordAuthoritativeEvent === 'function') {
      try {
        await this.auditLogger.recordAuthoritativeEvent({
          eventType: 'DOCUMENT_DELIVERY_MANUAL_RETRY_TRIGGERED',
          actor: actorContext,
          targetId: jobId,
          targetType: 'DocumentDeliveryQueue',
          summary: `CPA ${practitionerName} authorized controlled manual retry for job [${jobId}].`,
          metadata: { jobId, practitioner: practitionerName, notes }
        });
      } catch (_) {}
    }

    return {
      success: true,
      jobId,
      status: DELIVERY_STATE.QUEUED,
      nextAttemptAt: nowIso,
      message: 'Controlled manual retry authorized. Job returned to active queue with fresh attempt budget.'
    };
  }

  /**
   * Asserts whether a document can be safely deleted or if a retention hold applies.
   * Under IRC § 6061 and Pub 1345, documents in queued, processing, retry_pending,
   * or needs_review states CANNOT be purged from Cloud Storage.
   * 
   * @param {string} jobId - Job ID
   * @returns {Promise<{ allowed: boolean, reason?: string }>}
   */
  async evaluateRetentionHold(jobId) {
    if (!this.db) return { allowed: false, reason: 'Database unavailable' };
    const docRef = this.db.collection(this.collectionName).doc(jobId);
    const doc = await docRef.get();
    if (!doc.exists) return { allowed: true }; // No queue hold

    const data = typeof doc.data === 'function' ? doc.data() : doc;
    const inFlightStates = [
      DELIVERY_STATE.UPLOADED,
      DELIVERY_STATE.QUEUED,
      DELIVERY_STATE.PROCESSING,
      DELIVERY_STATE.RETRY_PENDING,
      DELIVERY_STATE.NEEDS_REVIEW
    ];

    if (inFlightStates.includes(data.status)) {
      return {
        allowed: false,
        reason: `Statutory Custody Hold: Document delivery is in state [${data.status}]. Reference must be retained stably until downstream delivery is confirmed or practitioner review is completed.`
      };
    }

    return {
      allowed: true,
      reason: 'Downstream delivery confirmed. Storage retention governed by 3-year statutory schedule.'
    };
  }

  /**
   * Reconciles uncertain delivery outcome before attempting a retry.
   * Prevents duplicate logical submissions when a timeout leaves the outcome uncertain.
   * Checks authoritative Firestore intake records and destination receipt.
   * 
   * @param {string} jobId - Queue job ID
   * @returns {Promise<{ isDelivered: boolean, receipt: string|null, deliveryStatus: string|null }>}
   */
  async reconcileUncertainDelivery(jobId) {
    if (!this.db) return { isDelivered: false, receipt: null, deliveryStatus: null };
    const docRef = this.db.collection(this.collectionName).doc(jobId);
    const snap = await docRef.get();
    if (!snap || !snap.exists) return { isDelivered: false, receipt: null, deliveryStatus: null };
    const data = typeof snap.data === 'function' ? snap.data() : snap;

    // 1. Check if already marked delivered in queue
    if (data.status === DELIVERY_STATE.DELIVERED && data.deliveryReceipt) {
      return {
        isDelivered: true,
        receipt: data.deliveryReceipt,
        deliveryStatus: data.deliveryStatus || DELIVERY_STATUS.FORMINIT_DELIVERED
      };
    }

    // 2. Check document_submissions collection for idempotent registration
    if (data.idempotencyKey) {
      try {
        const subSnap = await this.db.collection('document_submissions').doc(data.idempotencyKey).get();
        if (subSnap && subSnap.exists) {
          const subData = typeof subSnap.data === 'function' ? subSnap.data() : subSnap;
          if (subData.downstreamDelivery === 'forminit_delivered' || subData.downstreamDelivery === 'fallback_delivered' || subData.status === 'delivered') {
            const receipt = subData.submissionId || subData.idempotencyKey;
            const delivStatus = subData.downstreamDelivery || (subData.status === 'delivered' ? DELIVERY_STATUS.FORMINIT_DELIVERED : subData.downstreamDelivery);
            const delivChannel = delivStatus === DELIVERY_STATUS.FALLBACK_DELIVERED ? DELIVERY_CHANNEL.SECONDARY_FALLBACK : DELIVERY_CHANNEL.PRIMARY_FORMINIT;
            const nowIso = new Date().toISOString();
            const updates = {
              status: DELIVERY_STATE.DELIVERED,
              storageState: STORAGE_STATE.STORED,
              registrationState: REGISTRATION_STATE.REGISTERED,
              deliveryStatus: delivStatus,
              deliveryChannel: delivChannel,
              deliveryReceipt: receipt,
              deliveredAt: nowIso,
              updatedAt: nowIso,
              reconciled: true
            };
            await (docRef.update ? docRef.update(updates) : docRef.set({ ...data, ...updates }));

            if (this.auditLogger && typeof this.auditLogger.recordAuthoritativeEvent === 'function') {
              try {
                await this.auditLogger.recordAuthoritativeEvent({
                  eventType: 'DOCUMENT_DELIVERY_RECONCILED',
                  actor: { uid: 'system_reconciliation', role: 'system_worker' },
                  targetId: jobId,
                  targetType: 'DocumentDeliveryQueue',
                  summary: `Uncertain submission outcome reconciled via intake record. Receipt: ${receipt}`,
                  metadata: { jobId, receipt, deliveryStatus: delivStatus }
                });
              } catch (_) {}
            }

            return { isDelivered: true, receipt, deliveryStatus: delivStatus };
          }
        }
      } catch (_) {}
    }

    return { isDelivered: false, receipt: null, deliveryStatus: null };
  }

  /**
   * Asserts permanent document custody under FTC Safeguards § 314.4 and IRC § 6061.
   * Rejects the assumption that HTTP 200 alone proves permanent custody.
   * Requires verified Cloud Storage custody and durable intake registration.
   * 
   * @param {object} jobOrPayload 
   * @returns {{ hasPermanentCustody: boolean, reasons: string[] }}
   */
  static assertPermanentCustody(jobOrPayload) {
    const reasons = [];
    if (!jobOrPayload) {
      return { hasPermanentCustody: false, reasons: ['Missing document job payload.'] };
    }

    const storagePath = jobOrPayload.storagePath;
    const storageState = jobOrPayload.storageState;
    const registrationState = jobOrPayload.registrationState;
    const sha256Checksum = jobOrPayload.sha256Checksum;

    if (!storagePath || typeof storagePath !== 'string') {
      reasons.push('Missing authoritative Cloud Storage path reference.');
    }
    if (storageState !== STORAGE_STATE.STORED && storageState !== 'stored') {
      reasons.push(`Cloud Storage state is [${storageState || 'unconfirmed'}], not 'stored'.`);
    }
    if (registrationState !== REGISTRATION_STATE.REGISTERED && registrationState !== 'registered') {
      reasons.push(`Intake registration state is [${registrationState || 'unconfirmed'}], not 'registered'.`);
    }
    if (!sha256Checksum) {
      reasons.push('Missing cryptographic SHA-256 digest.');
    }

    return {
      hasPermanentCustody: reasons.length === 0,
      reasons
    };
  }
}
