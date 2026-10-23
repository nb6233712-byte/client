/**
 * ============================================================================
 * PRIORITY 4: TRUSTED AUDIT-EVENT CREATION (AUTHORITATIVE WORM LEDGER)
 * ============================================================================
 * 
 * Statutory & Compliance Authority:
 * - FTC Safeguards Rule (16 CFR § 314.4(c)(8)): Maintain audit trails to detect
 *   and respond to unauthorized system access.
 * - IRS Publication 1345 § 6: Retain electronic filing signature logs for 3 years
 *   in an unalterable, tamper-evident format.
 * 
 * Trust Boundary:
 * Browser clients are completely barred by Firestore security rules from writing
 * authoritative regulatory events directly. Only trusted Cloud Functions with
 * the Firebase Admin SDK can record authoritative audit entries.
 */

import crypto from 'node:crypto';
import { unauthenticated, invalidArgument, safeErrorResponse } from './errors.mjs';
import { idempotency } from './idempotency.mjs';

export const AuthoritativeEventTypes = Object.freeze([
  'STAFF_ROLE_PROVISIONED',
  'STAFF_ROLE_MODIFIED',
  'DOCUMENT_ACCEPTED',
  'DOCUMENT_REJECTED',
  'DOCUMENT_SCAN_CLEARED',
  'DOCUMENT_QUARANTINED',
  'RETURN_PUBLISHED',
  'RETURN_APPROVED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECONCILED',
  'SIGNATURE_COMPLETED',
  'KBA_VERIFIED',
  'KBA_LOCKOUT_TRIGGERED',
  'WET_SIGNATURE_GENERATED',
  'ENGAGEMENT_STAGE_UPDATED'
]);

export class AuditLedgerService {
  constructor(firestoreDb = null) {
    this.firestoreDb = firestoreDb;
    this.inMemoryLedger = [];
  }

  /**
   * Computes SHA-256 cryptographic seal for WORM integrity.
   */
  computeAuditHash(logPayload) {
    const raw = `${logPayload.action}|${logPayload.eventType}|${logPayload.targetId}|${logPayload.recordedAt}|${logPayload.actor?.uid}|${logPayload.details}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Records an authoritative audit event to the permanent ledger.
   * 
   * @param {object} event
   * @param {string} event.action - Human-readable action name
   * @param {string} event.eventType - Member of AuthoritativeEventTypes
   * @param {string} event.category - 'Security' | 'Governance' | 'Documents' | 'Tax Returns' | 'Billing' | 'Compliance'
   * @param {string} [event.targetId] - ID of affected document, invoice, user, etc.
   * @param {string} [event.clientId] - Associated client UID for multi-tenant isolation
   * @param {string} event.details - Detailed log text
   * @param {object} event.actor - { uid, email, role }
   * @param {string} [event.idempotencyKey]
   */
  async recordAuthoritativeEvent(event) {
    try {
      if (!event.action || !event.eventType || !event.details) {
        throw invalidArgument('action, eventType, and details are required for audit logging.');
      }

      const key = event.idempotencyKey || `aud_${event.eventType}_${event.targetId || 'sys'}_${idempotency.hashPayload(event).slice(0, 16)}`;
      return await idempotency.executeIdempotent(key, async () => {
        const recordedAt = new Date().toISOString();
        const logId = `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

        const logRecord = {
          id: logId,
          action: event.action,
          eventType: event.eventType,
          category: event.category || 'Compliance',
          targetId: event.targetId || null,
          clientId: event.clientId || null,
          details: event.details,
          actorUid: event.actor?.uid || 'trusted_system',
          actorEmail: event.actor?.email || 'system@pivot-aide.internal',
          actorRole: event.actor?.role || 'system_service',
          statutoryAuthority: 'FTC Safeguards Rule 16 CFR § 314.4 & IRS Pub 1345',
          provenance: 'backend_trusted_cloud_function',
          securityTier: 'authoritative_ledger',
          recordedAt
        };

        logRecord.integrityHash = this.computeAuditHash(logRecord);

        // Commit to Firestore WORM collection
        if (this.firestoreDb && typeof this.firestoreDb.collection === 'function') {
          await this.firestoreDb.collection('audit_logs').doc(logId).set(logRecord);
        }

        this.inMemoryLedger.push(logRecord);

        return {
          success: true,
          logId,
          recordedAt,
          integrityHash: logRecord.integrityHash
        };
      });

    } catch (err) {
      return safeErrorResponse(err);
    }
  }
}

export const auditLedger = new AuditLedgerService();
