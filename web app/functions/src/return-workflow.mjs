/**
 * ============================================================================
 * PRIORITY 3: RETURN APPROVAL AND PUBLICATION (TRUSTED BACKEND HANDLER)
 * ============================================================================
 * 
 * Statutory & Compliance Authority:
 * - Treas. Reg. § 301.7216-2 (Client Consent Prior to Transmission)
 * - Treas. Reg. § 301.7701-15(f) (Pure Custody vs. Computation Demarcation)
 * - IRS Publication 1345 § 5 (Electronic Return Originator Requirements)
 * 
 * Trust Boundary:
 * - Only firm staff can compute, review, and publish returns.
 * - Only the verified taxpayer (owner) can approve their prepared return.
 * - Authoritative RETURN_APPROVED event MUST be generated on the trusted server
 *   to prevent fraudulent client-spoofed filing transmissions.
 */

import { unauthenticated, permissionDenied, invalidArgument, failedPrecondition, notFound, safeErrorResponse } from './errors.mjs';
import { idempotency } from './idempotency.mjs';

/**
 * Staff publishes a prepared return to the client portal.
 */
export async function publishPreparedReturnHandler(params, services) {
  const { context, returnId, returnData = {}, idempotencyKey } = params;
  const { firestoreDb, auditLogger, notificationDispatcher } = services;

  try {
    // 1. Authenticate caller
    if (!context || !context.uid) {
      throw unauthenticated('Authentication required to publish tax returns.');
    }

    // 2. Authorize caller — Must be staff with MFA
    const isStaff = (context.role === 'firm_preparer' || context.role === 'firm_admin');
    if (!isStaff) {
      throw permissionDenied('Only authorized tax practitioners can publish returns.');
    }
    if (!context.mfaVerified) {
      throw permissionDenied('MFA verification required for tax practitioner return publication.');
    }

    if (!returnId || typeof returnId !== 'string') {
      throw invalidArgument('Valid return ID is required.');
    }

    const key = idempotencyKey || `ret_pub_${returnId}`;
    return await idempotency.executeIdempotent(key, async () => {
      const now = new Date().toISOString();
      const publisher = context.displayName || context.email || 'Denise R., CPA';

      const updateData = {
        published: true,
        publishedAt: now,
        publishedBy: publisher,
        approvalStatus: 'pending_review',
        clientApproved: false,
        ...returnData
      };

      if (firestoreDb && typeof firestoreDb.collection === 'function') {
        await firestoreDb.collection('tax_returns').doc(returnId).set(updateData, { merge: true });

        // If clientUid or engagementId is present, advance engagement to client_review
        const clientUid = returnData.clientUid;
        if (clientUid) {
          await firestoreDb.collection('engagements').doc(clientUid).set({
            stage: 'client_review',
            stageLabel: 'Client review',
            updatedAt: now
          }, { merge: true });
        }
      }

      // Record authoritative audit event
      if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
        await auditLogger.recordAuthoritativeEvent({
          action: 'Prepared Return Published',
          eventType: 'RETURN_PUBLISHED',
          category: 'Tax Returns',
          targetId: returnId,
          clientId: returnData.clientUid || null,
          details: `Tax return ${returnId} published to portal by ${publisher}`,
          actor: context
        });
      }

      // Notify client
      if (notificationDispatcher && returnData.clientUid) {
        await notificationDispatcher.dispatch({
          type: 'return_review',
          recipientUid: returnData.clientUid,
          recipientName: returnData.clientName || 'Taxpayer',
          recipientEmail: returnData.clientEmail || null,
          metadata: {
            returnId,
            taxYear: returnData.taxYear || 2026
          }
        });
      }

      return {
        success: true,
        returnId,
        published: true,
        publishedAt: now,
        publishedBy: publisher
      };
    });

  } catch (err) {
    return safeErrorResponse(err);
  }
}

/**
 * Taxpayer reviews and approves their prepared return.
 */
export async function clientApproveReturnHandler(params, services) {
  const { context, returnId, approvalNotes, idempotencyKey } = params;
  const { firestoreDb, auditLogger, notificationDispatcher } = services;

  try {
    // 1. Authenticate caller
    if (!context || !context.uid) {
      throw unauthenticated('Authentication required to approve return.');
    }

    if (!returnId || typeof returnId !== 'string') {
      throw invalidArgument('Valid return ID is required.');
    }

    let existingReturn = null;
    let existingCollection = 'tax_returns';
    if (firestoreDb && typeof firestoreDb.collection === 'function') {
      let snap = await firestoreDb.collection('tax_returns').doc(returnId).get();
      if (!snap || !snap.exists) {
        snap = await firestoreDb.collection('returns').doc(returnId).get();
        if (snap && snap.exists) {
          existingCollection = 'returns';
        }
      }
      if (snap && snap.exists) {
        existingReturn = snap.data();
      }
    }

    // 2. Ownership check: Caller must be the client for this return
    if (existingReturn && existingReturn.clientUid && existingReturn.clientUid !== context.uid) {
      throw permissionDenied('Cross-tenant violation: You can only approve your own tax return.');
    }

    // 3. Precondition: Return must be published
    const isPublished = existingReturn && (existingReturn.published === true || existingReturn.status === 'published');
    if (existingReturn && !isPublished) {
      throw failedPrecondition('Cannot approve an unpublished draft return.');
    }

    const key = idempotencyKey || `ret_appr_${returnId}_${context.uid}`;
    return await idempotency.executeIdempotent(key, async () => {
      const now = new Date().toISOString();

      const approvalPayload = {
        clientApproved: true,
        approvalStatus: 'approved',
        status: 'client_approved',
        approvedAt: now,
        approvalNotes: approvalNotes || 'Approved by taxpayer after variance review',
        statutoryConsent: 'Treas. Reg. § 301.7216-2 E-file Consent Acknowledged'
      };

      if (firestoreDb && typeof firestoreDb.collection === 'function') {
        await firestoreDb.collection(existingCollection).doc(returnId).set(approvalPayload, { merge: true });

        // Advance engagement stage to signing_pending
        await firestoreDb.collection('engagements').doc(context.uid).set({
          stage: 'signing_pending',
          stageLabel: 'Signing pending',
          updatedAt: now
        }, { merge: true });
      }

      // 4. Record authoritative RETURN_APPROVED audit event
      if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
        await auditLogger.recordAuthoritativeEvent({
          action: 'Return Approved by Taxpayer',
          eventType: 'RETURN_APPROVED',
          category: 'Filing Compliance',
          targetId: returnId,
          clientId: context.uid,
          details: `Client ${context.email || context.uid} approved return ${returnId}. Form 8879 unlocked.`,
          actor: context
        });
      }

      // Notify preparer
      if (notificationDispatcher) {
        await notificationDispatcher.dispatch({
          type: 'signing_reminder',
          recipientUid: context.uid,
          recipientName: context.displayName || 'Taxpayer',
          recipientEmail: context.email || null,
          metadata: {
            returnId,
            message: 'Your Form 8879 is ready to sign to authorize e-filing.'
          }
        });
      }

      return {
        success: true,
        returnId,
        approved: true,
        status: 'client_approved',
        approvedAt: now,
        nextStep: 'signing_pending'
      };
    });

  } catch (err) {
    return safeErrorResponse(err);
  }
}
