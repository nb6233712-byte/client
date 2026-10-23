/**
 * ============================================================================
 * IDEMPOTENCY CONTROLS & REPLAY PREVENTION ENGINE
 * ============================================================================
 * 
 * Ensures non-repudiation and prevents duplicate side-effects (e.g. double charging,
 * duplicate signature certificates, duplicate notification deliveries, repeated state changes).
 */

import crypto from 'node:crypto';

export class IdempotencyManager {
  constructor(firestoreDb = null) {
    this.firestoreDb = firestoreDb;
    this.memoryCache = new Map();
    this.defaultTtlMs = 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Generates a deterministic hash for payload when caller doesn't provide key.
   */
  hashPayload(data) {
    return crypto.createHash('sha256').update(JSON.stringify(data || {})).digest('hex');
  }

  /**
   * Checks if an operation has already been executed.
   * 
   * @param {string} idempotencyKey - Unique operation key
   * @returns {Promise<{ found: boolean, status: string, response: any }>}
   */
  async check(idempotencyKey) {
    if (!idempotencyKey) return { found: false };

    // Check memory cache
    const memoryRecord = this.memoryCache.get(idempotencyKey);
    if (memoryRecord && Date.now() < memoryRecord.expiresAt) {
      return {
        found: true,
        status: memoryRecord.status,
        response: memoryRecord.response,
        recordedAt: memoryRecord.recordedAt
      };
    }

    // Check Firestore /idempotency_keys collection if available
    if (this.firestoreDb && typeof this.firestoreDb.collection === 'function') {
      try {
        const docRef = this.firestoreDb.collection('idempotency_keys').doc(idempotencyKey);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          const data = docSnap.data();
          return {
            found: true,
            status: data.status,
            response: data.response,
            recordedAt: data.recordedAt
          };
        }
      } catch (_) {}
    }

    return { found: false };
  }

  /**
   * Records completed idempotent result.
   */
  async commit(idempotencyKey, response, ttlMs = this.defaultTtlMs) {
    if (!idempotencyKey) return;

    const record = {
      status: 'completed',
      response,
      recordedAt: new Date().toISOString(),
      expiresAt: Date.now() + ttlMs
    };

    this.memoryCache.set(idempotencyKey, record);

    if (this.firestoreDb && typeof this.firestoreDb.collection === 'function') {
      try {
        await this.firestoreDb.collection('idempotency_keys').doc(idempotencyKey).set(record);
      } catch (_) {}
    }
  }

  /**
   * Wraps an asynchronous operation with idempotency guard.
   */
  async executeIdempotent(idempotencyKey, fn) {
    if (!idempotencyKey) {
      return fn();
    }

    const existing = await this.check(idempotencyKey);
    if (existing.found && existing.status === 'completed') {
      return {
        ...existing.response,
        idempotent: true,
        idempotentReplay: true,
        _idempotentReplay: true,
        _originalTimestamp: existing.recordedAt
      };
    }

    const result = await fn();
    await this.commit(idempotencyKey, result);
    return result;
  }
}

export const idempotency = new IdempotencyManager();
