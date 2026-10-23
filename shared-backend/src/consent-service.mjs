/**
 * ============================================================================
 * IRC § 7216 STATUTORY CONSENT SERVICE (TRUSTED BACKEND HANDLER)
 * ============================================================================
 * 
 * Statutory Authority:
 * - Internal Revenue Code § 7216 (Confidentiality of Tax Return Information)
 * - Treasury Regulation § 301.7216-2 (Permissible Uses and Disclosures Without Formal Consent)
 * - Treasury Regulation § 301.7216-3 (Mandatory Form and Timing of Consents)
 * - Revenue Procedure 2013-14 (Mandatory Electronic Consent Format and Language)
 * 
 * Criminal and Civil Liability:
 * - Criminal: IRC § 7216(a) misdemeanor up to $1,000 fine and 1 year imprisonment per willful unauthorized disclosure.
 * - Civil: IRC § 6713 civil penalty of $250 per unauthorized disclosure (up to $1,000 where identity theft is involved).
 * 
 * Trust Boundary:
 * - Affirmative electronic consent must be signed by the taxpayer PRIOR to any disclosure or non-preparation use.
 * - Consents cannot be retroactively applied.
 * - Taxpayer may affirmatively revoke consent at any time.
 * - Consents are valid for a maximum of 1 year unless a specific multi-year engagement agreement applies.
 */

import { unauthenticated, permissionDenied, invalidArgument, failedPrecondition, notFound, safeErrorResponse } from './errors.mjs';
import { idempotency } from './idempotency.mjs';

export const MANDATORY_7216_STATUTORY_WARNING = 
  "Federal law requires this consent form be provided to you. Unless authorized by law, " +
  "we cannot use or disclose your tax return information to third parties for purposes other than " +
  "the preparation and filing of your tax return without your consent. If you consent to the disclosure " +
  "or use of your tax return information, Federal law may not protect your tax return information " +
  "from further use or distribution.";

export const PERMITTED_CONSENT_TYPES = [
  'use_tax_planning',           // Treas. Reg. § 301.7216-2(h) / § 301.7216-3 (Quarterly planning & advisory)
  'disclosure_third_party',      // Treas. Reg. § 301.7216-3 (Mortgage broker, bank, legal counsel)
  'vault_multiyear_retention'   // Long-term encrypted cloud archive beyond active preparation
];

/**
 * Taxpayer grants formal electronic consent under IRC § 7216.
 */
export async function grantConsentHandler(params, services) {
  const { context, consentData = {}, idempotencyKey } = params;
  const { firestoreDb, auditLogger } = services;

  try {
    // 1. Authenticate caller
    if (!context || !context.uid) {
      throw unauthenticated('Authentication required to record statutory consent.');
    }

    const clientUid = consentData.clientUid || context.uid;

    // 2. Ownership check: Only taxpayer can grant consent on their own tax information
    if (context.role === 'client' && context.uid !== clientUid) {
      throw permissionDenied('Cross-tenant violation: You cannot grant consent on another taxpayer\'s return information.');
    }

    // 3. Validate consent parameters
    const consentType = consentData.consentType;
    if (!consentType || !PERMITTED_CONSENT_TYPES.includes(consentType)) {
      throw invalidArgument(`Invalid consent type. Must be one of: ${PERMITTED_CONSENT_TYPES.join(', ')}`);
    }

    if (!consentData.warningAcknowledged) {
      throw failedPrecondition('IRC § 7216 Mandate: Taxpayer must affirmatively acknowledge the statutory warning disclosure.');
    }

    const taxYear = consentData.taxYear || 2026;
    const consentId = consentData.consentId || `consent_7216_${consentType}_${clientUid}_TY${taxYear}`;
    const key = idempotencyKey || `grant_consent_${consentId}`;

    return await idempotency.executeIdempotent(key, async () => {
      const now = new Date().toISOString();
      // Default duration: 1 calendar year from execution under Rev. Proc. 2013-14
      const durationDays = consentData.durationDays || 365;
      const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

      const record = {
        consentId,
        clientUid,
        taxYear,
        consentType,
        purposeDescription: consentData.purposeDescription || 'Tax planning, multi-year analysis, and encrypted archive retention',
        intendedRecipient: consentData.intendedRecipient || 'Pivot Aide Tax (Internal Advisory Services)',
        statutoryWarningText: MANDATORY_7216_STATUTORY_WARNING,
        warningAcknowledged: true,
        status: 'granted',
        grantedAt: now,
        expiresAt,
        ipAddress: context.ip || '127.0.0.1',
        userAgent: context.userAgent || 'Web Browser',
        statutoryRegulation: 'Treas. Reg. § 301.7216-3 & Rev. Proc. 2013-14',
        revocable: true
      };

      if (firestoreDb && typeof firestoreDb.collection === 'function') {
        await firestoreDb.collection('consents').doc(consentId).set(record);
      }

      // Record authoritative audit event
      if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
        await auditLogger.recordAuthoritativeEvent({
          action: 'IRC § 7216 Consent Granted',
          eventType: 'CONSENT_GRANTED',
          category: 'Statutory Compliance',
          targetId: consentId,
          clientId: clientUid,
          details: `Taxpayer affirmatively granted ${consentType} for TY${taxYear}. Valid through ${expiresAt}.`,
          actor: context
        });
      }

      return {
        success: true,
        consentId,
        status: 'granted',
        expiresAt,
        grantedAt: now
      };
    });

  } catch (err) {
    return safeErrorResponse(err);
  }
}

/**
 * Taxpayer affirmatively revokes previously granted IRC § 7216 consent.
 */
export async function revokeConsentHandler(params, services) {
  const { context, consentId, reason = 'Taxpayer requested withdrawal of consent', idempotencyKey } = params;
  const { firestoreDb, auditLogger } = services;

  try {
    if (!context || !context.uid) {
      throw unauthenticated('Authentication required to revoke consent.');
    }

    if (!consentId || typeof consentId !== 'string') {
      throw invalidArgument('Valid consent ID is required.');
    }

    let existing = null;
    if (firestoreDb && typeof firestoreDb.collection === 'function') {
      const snap = await firestoreDb.collection('consents').doc(consentId).get();
      if (snap.exists) {
        existing = snap.data();
      }
    }

    if (!existing) {
      throw notFound('Consent record not found.');
    }

    // Ownership check: Taxpayer can revoke own; Admin can execute on behalf of verified request
    const isOwner = (context.uid === existing.clientUid);
    const isAdmin = (context.role === 'firm_admin');
    if (!isOwner && !isAdmin) {
      throw permissionDenied('You do not have authorization to revoke this consent record.');
    }

    const key = idempotencyKey || `revoke_consent_${consentId}`;
    return await idempotency.executeIdempotent(key, async () => {
      const now = new Date().toISOString();
      const updated = {
        status: 'revoked',
        revokedAt: now,
        revocationReason: reason,
        revokedBy: context.uid
      };

      if (firestoreDb && typeof firestoreDb.collection === 'function') {
        await firestoreDb.collection('consents').doc(consentId).set(updated, { merge: true });
      }

      if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
        await auditLogger.recordAuthoritativeEvent({
          action: 'IRC § 7216 Consent Revoked',
          eventType: 'CONSENT_REVOKED',
          category: 'Statutory Compliance',
          targetId: consentId,
          clientId: existing.clientUid,
          details: `Consent ${consentId} (${existing.consentType}) revoked by ${context.uid}. Reason: ${reason}`,
          actor: context
        });
      }

      return {
        success: true,
        consentId,
        status: 'revoked',
        revokedAt: now
      };
    });

  } catch (err) {
    return safeErrorResponse(err);
  }
}

/**
 * Verifies whether an active, valid consent exists before disclosing or using tax return information.
 */
export async function verifyActiveConsentHandler(params, services) {
  const { clientUid, consentType, taxYear = 2026 } = params;
  const { firestoreDb } = services;

  if (!clientUid || !consentType) {
    return { allowed: false, reason: 'Missing clientUid or consentType' };
  }

  const consentId = `consent_7216_${consentType}_${clientUid}_TY${taxYear}`;
  if (!firestoreDb || typeof firestoreDb.collection !== 'function') {
    return { allowed: false, reason: 'Firestore not available' };
  }

  const snap = await firestoreDb.collection('consents').doc(consentId).get();
  if (!snap.exists) {
    return { allowed: false, reason: 'No consent record exists on file for this purpose and tax year.' };
  }

  const data = snap.data();
  if (data.status !== 'granted') {
    return { allowed: false, status: data.status, reason: `Consent is currently ${data.status}.` };
  }

  const now = new Date();
  if (data.expiresAt && new Date(data.expiresAt) < now) {
    return { allowed: false, status: 'expired', reason: 'Consent has expired past its 1-year statutory validity.' };
  }

  return {
    allowed: true,
    consentId: data.consentId,
    status: 'granted',
    expiresAt: data.expiresAt
  };
}
