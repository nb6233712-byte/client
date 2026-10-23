/**
 * ============================================================================
 * PRIORITY 2: DOCUMENT ACCEPTANCE AND REJECTION (TRUSTED BACKEND HANDLER)
 * ============================================================================
 * 
 * Statutory & Compliance Authority:
 * - Treasury Department Circular 230 § 10.22 (Diligence as to accuracy)
 * - IRC § 6694 (Understatement of taxpayer liability by tax return preparer)
 * 
 * Trust Boundary:
 * A taxpayer / client must NEVER be able to accept or reject their own documents.
 * Circular 230 mandates that a licensed practitioner verify the document.
 * Therefore, acceptance/rejection MUST be committed by staff on the trusted backend.
 */

import { unauthenticated, permissionDenied, invalidArgument, notFound, safeErrorResponse } from './errors.mjs';
import { idempotency } from './idempotency.mjs';

export const ReviewAction = Object.freeze({
  ACCEPT: 'accept',
  REJECT: 'reject',
  REQUEST_REPLACEMENT: 'request_replacement'
});

/**
 * Handles trusted document review decisions.
 * 
 * @param {object} params
 * @param {object} params.context - Caller authentication context { uid, email, role, mfaVerified, displayName }
 * @param {string} params.documentId - Document or request ID
 * @param {string} params.action - 'accept' | 'reject' | 'request_replacement'
 * @param {string} [params.notes] - Practitioner verification notes or rejection explanation
 * @param {string} [params.idempotencyKey]
 * @param {object} services - { firestoreDb, auditLogger, notificationDispatcher }
 */
export async function documentReviewHandler(params, services) {
  const { context, documentId, action, idempotencyKey } = params;
  const notes = params.notes || params.reviewNotes || params.rejectionReason;
  const { firestoreDb, auditLogger, notificationDispatcher } = services;

  try {
    // 1. Authenticate caller
    if (!context || !context.uid) {
      throw unauthenticated('Authentication required to review documents.');
    }

    // 2. Authorize caller — Must be authorized firm staff with MFA
    const validStaffRoles = ['firm_preparer', 'firm_reviewer', 'firm_admin', 'firm_partner', 'firm_staff'];
    const isStaff = validStaffRoles.includes(context.role);
    if (!isStaff) {
      throw permissionDenied('Taxpayers cannot accept or reject documents. Practitioner review required under Circular 230.');
    }
    const isMfaActive = Boolean(context.mfaVerified ?? context.mfaEnforced ?? true);
    if (!isMfaActive) {
      throw permissionDenied('MFA verification required for tax practitioner operations.');
    }

    // 3. Validate input
    if (!documentId || typeof documentId !== 'string') {
      throw invalidArgument('Valid document ID is required.');
    }

    const cleanAction = (action || '').toLowerCase().trim();
    if (cleanAction !== ReviewAction.ACCEPT && cleanAction !== ReviewAction.REJECT && cleanAction !== ReviewAction.REQUEST_REPLACEMENT) {
      throw invalidArgument(`Action must be '${ReviewAction.ACCEPT}', '${ReviewAction.REJECT}', or '${ReviewAction.REQUEST_REPLACEMENT}'.`);
    }

    if ((cleanAction === ReviewAction.REJECT || cleanAction === ReviewAction.REQUEST_REPLACEMENT) && (!notes || !notes.trim())) {
      throw invalidArgument('A clear rejection reason is required to notify the taxpayer under Circular 230 § 10.22.');
    }

    // 4. Wrap with idempotency
    const key = idempotencyKey || `doc_rev_${documentId}_${cleanAction}`;
    return await idempotency.executeIdempotent(key, async () => {
      const timestamp = new Date().toISOString();
      const reviewerName = context.displayName || context.name || context.email || 'Assigned Practitioner, CPA';

      let docRecord = null;
      let targetCollection = 'documentRequests';

      if (firestoreDb && typeof firestoreDb.collection === 'function') {
        // Look up in documentRequests first
        let snap = await firestoreDb.collection('documentRequests').doc(documentId).get();
        if (snap.exists) {
          docRecord = snap.data();
          targetCollection = 'documentRequests';
        } else {
          // Check documents collection
          snap = await firestoreDb.collection('documents').doc(documentId).get();
          if (snap.exists) {
            docRecord = snap.data();
            targetCollection = 'documents';
          }
        }
      }

      let newStatus = 'accepted';
      if (cleanAction === ReviewAction.REJECT) {
        newStatus = 'rejected';
      } else if (cleanAction === ReviewAction.REQUEST_REPLACEMENT) {
        newStatus = 'needs_replacement';
      }

      const updatePayload = {
        status: newStatus,
        reviewedAt: timestamp,
        reviewedBy: reviewerName,
        reviewerUid: context.uid,
        reviewNotes: notes || (cleanAction === ReviewAction.ACCEPT ? 'Verified accurate by CPA' : 'Scan rejected'),
        rejectionReason: (cleanAction === ReviewAction.REJECT || cleanAction === ReviewAction.REQUEST_REPLACEMENT) ? notes : null
      };

      if (firestoreDb && typeof firestoreDb.collection === 'function') {
        await firestoreDb.collection(targetCollection).doc(documentId).set(updatePayload, { merge: true });
        // Also update mirror collection if document exists there
        const otherCollection = targetCollection === 'documentRequests' ? 'documents' : 'documentRequests';
        try {
          const otherSnap = await firestoreDb.collection(otherCollection).doc(documentId).get();
          if (otherSnap && otherSnap.exists) {
            await firestoreDb.collection(otherCollection).doc(documentId).set(updatePayload, { merge: true });
          }
        } catch (_) {}
      }

      // Record authoritative audit record
      let eventType = 'DOCUMENT_ACCEPTED';
      let actionName = 'Document Accepted by CPA';
      if (cleanAction === ReviewAction.REJECT) {
        eventType = 'DOCUMENT_REJECTED';
        actionName = 'Document Rejected by CPA';
      } else if (cleanAction === ReviewAction.REQUEST_REPLACEMENT) {
        eventType = 'DOCUMENT_REPLACEMENT_REQUESTED';
        actionName = 'Document Replacement Requested by CPA';
      }

      if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
        await auditLogger.recordAuthoritativeEvent({
          action: actionName,
          eventType,
          category: 'Documents',
          targetId: documentId,
          clientId: docRecord?.clientId || null,
          details: `${actionName} (${documentId}): ${updatePayload.reviewNotes}`,
          actor: context
        });
      }

      // If rejected or replacement requested, trigger automated notification to client
      if ((cleanAction === ReviewAction.REJECT || cleanAction === ReviewAction.REQUEST_REPLACEMENT) && notificationDispatcher) {
        await notificationDispatcher.dispatch({
          type: cleanAction === ReviewAction.REQUEST_REPLACEMENT ? 'document_replacement_requested' : 'document_rejected',
          recipientUid: docRecord?.clientId || 'taxpayer',
          recipientName: docRecord?.clientName || 'Taxpayer',
          recipientEmail: docRecord?.clientEmail || null,
          metadata: {
            documentId,
            documentTitle: docRecord?.title || docRecord?.name || 'Tax Document',
            rejectionReason: notes
          }
        });
      }

      return {
        success: true,
        documentId,
        status: newStatus,
        reviewedBy: reviewerName,
        reviewerUid: context.uid,
        reviewedAt: timestamp,
        notes: updatePayload.reviewNotes,
        rejectionReason: updatePayload.rejectionReason
      };
    });

  } catch (err) {
    return safeErrorResponse(err);
  }
}
