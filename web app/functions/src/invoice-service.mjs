/**
 * ============================================================================
 * INVOICE MANAGEMENT SERVICE (TRUSTED BACKEND OPERATIONS)
 * ============================================================================
 * 
 * Statutory & Security Compliance:
 * - FTC Safeguards Rule § 314.4 & Treasury Circular 230
 * - Staff Authorization: Only authorized practitioners with MFA can issue invoices
 * - Admin Authorization: Only firm administrators can issue refunds
 * 
 * Trust Boundary:
 * Clients can view and pay invoices, but cannot issue invoices or execute refunds.
 */

import { unauthenticated, permissionDenied, invalidArgument, notFound, failedPrecondition, safeErrorResponse } from './errors.mjs';
import { idempotency } from './idempotency.mjs';

/**
 * Step 1: Authorized firm user issues an invoice to a client.
 * 
 * @param {object} params
 * @param {object} params.context - Caller authentication context { uid, email, role, mfaVerified, displayName }
 * @param {string} params.clientId - Target client UID
 * @param {string} [params.engagementId] - Associated engagement ID
 * @param {Array<{ desc: string, amount: number }>} params.items - Line items
 * @param {string} params.dueDate - Payment due date (YYYY-MM-DD)
 * @param {string} [params.customInvoiceId] - Optional custom ID
 * @param {string} [params.idempotencyKey]
 * @param {object} services - { firestoreDb, auditLogger, notificationDispatcher }
 */
export async function staffIssueInvoiceHandler(params, services) {
  const { context, clientId, engagementId, items, dueDate, customInvoiceId, idempotencyKey } = params;
  const { firestoreDb, auditLogger, notificationDispatcher } = services;

  try {
    // 1. Authenticate caller
    if (!context || !context.uid) {
      throw unauthenticated('Authentication required to issue invoices.');
    }

    // 2. Authorize caller — Must be firm_preparer or firm_admin with MFA
    const isStaff = (context.role === 'firm_preparer' || context.role === 'firm_admin');
    if (!isStaff) {
      throw permissionDenied('Only authorized firm staff can issue billing invoices.');
    }
    if (!context.mfaVerified) {
      throw permissionDenied('MFA verification required for billing operations.');
    }

    // 3. Validate input
    if (!clientId || typeof clientId !== 'string') {
      throw invalidArgument('Valid client ID is required.');
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw invalidArgument('Invoice requires at least one billing line item.');
    }

    let calculatedTotal = 0;
    const validatedItems = items.map((it, idx) => {
      const desc = (it.desc || it.description || '').trim();
      const amount = Number(it.amount);
      if (!desc) {
        throw invalidArgument(`Item #${idx + 1} requires a valid description.`);
      }
      if (isNaN(amount) || amount <= 0) {
        throw invalidArgument(`Item #${idx + 1} amount must be greater than zero.`);
      }
      calculatedTotal += amount;
      return { desc, amount: Number(amount.toFixed(2)) };
    });

    const now = new Date().toISOString();
    const invoiceId = customInvoiceId || `inv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const issuerName = context.displayName || context.email || 'Denise R., CPA';

    const key = idempotencyKey || `iss_inv_${clientId}_${invoiceId}`;
    return await idempotency.executeIdempotent(key, async () => {
      const invoiceData = {
        invoiceId,
        id: invoiceId,
        firmId: 'firm_pivot_aide',
        clientId,
        clientUid: clientId,
        engagementId: engagementId || `eng_2026_${clientId}`,
        items: validatedItems,
        subtotal: Number(calculatedTotal.toFixed(2)),
        fees: 0.00,
        total: Number(calculatedTotal.toFixed(2)),
        amountPaid: 0.00,
        amountDue: Number(calculatedTotal.toFixed(2)),
        currency: 'USD',
        status: 'issued', // issued | pending | partially_paid | paid | failed | void | refunded | partially_refunded
        dueDate: dueDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        createdAt: now,
        issuedBy: issuerName,
        issuedByUid: context.uid,
        paidAt: null,
        paidMethod: null,
        transactionRef: null,
        settlementRef: null
      };

      if (firestoreDb && typeof firestoreDb.collection === 'function') {
        await firestoreDb.collection('invoices').doc(invoiceId).set(invoiceData);
      }

      // Record authoritative INVOICE_ISSUED audit event
      if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
        await auditLogger.recordAuthoritativeEvent({
          action: 'Billing Statement Issued',
          eventType: 'INVOICE_ISSUED',
          category: 'Billing',
          targetId: invoiceId,
          clientId,
          details: `Invoice ${invoiceId} issued for $${invoiceData.total.toFixed(2)} to client ${clientId} by ${issuerName}`,
          actor: context
        });
      }

      // Dispatch notification to client
      if (notificationDispatcher) {
        await notificationDispatcher.dispatch({
          type: 'invoice_issued',
          recipientUid: clientId,
          metadata: {
            invoiceId,
            dueDate: invoiceData.dueDate,
            totalFormatted: `$${invoiceData.total.toFixed(2)}`
          }
        });
      }

      return {
        success: true,
        invoiceId,
        total: invoiceData.total,
        status: 'issued',
        dueDate: invoiceData.dueDate,
        issuedBy: issuerName
      };
    });

  } catch (err) {
    return safeErrorResponse(err);
  }
}

/**
 * Administrative Refund Handler:
 * Firm administrator executes a refund against a paid invoice.
 * 
 * @param {object} params
 * @param {object} params.context - Caller authentication context { uid, email, role, mfaVerified }
 * @param {string} params.invoiceId - Invoice to refund
 * @param {number} [params.refundAmount] - Amount to refund (defaults to full total)
 * @param {string} params.reason - Explanation for refund
 * @param {object} services - { firestoreDb, auditLogger, stripeClientMock }
 */
export async function staffRefundInvoiceHandler(params, services) {
  const { context, invoiceId, refundAmount, reason, idempotencyKey } = params;
  const { firestoreDb, auditLogger, stripeClientMock } = services;

  try {
    if (!context || !context.uid) {
      throw unauthenticated('Authentication required to process refunds.');
    }

    // Authorize caller — ONLY firm_admin can refund
    if (context.role !== 'firm_admin') {
      throw permissionDenied('Administrative authority required to issue refunds. Preparers cannot process refunds.');
    }
    if (!context.mfaVerified) {
      throw permissionDenied('MFA verification required for administrative refund processing.');
    }

    if (!invoiceId || typeof invoiceId !== 'string') {
      throw invalidArgument('Valid invoice ID is required.');
    }

    let invoice = null;
    if (firestoreDb && typeof firestoreDb.collection === 'function') {
      const snap = await firestoreDb.collection('invoices').doc(invoiceId).get();
      if (snap.exists) invoice = snap.data();
    }

    if (!invoice) {
      throw notFound(`Invoice '${invoiceId}' was not found.`);
    }

    if (invoice.status !== 'paid') {
      throw failedPrecondition(`Cannot refund unpaid invoice '${invoiceId}' (Current status: ${invoice.status}).`);
    }

    const key = idempotencyKey || `ref_inv_${invoiceId}_${Date.now()}`;
    return await idempotency.executeIdempotent(key, async () => {
      const now = new Date().toISOString();
      const refundDollars = Number(refundAmount || invoice.total);
      const isFull = refundDollars >= invoice.total;
      const refId = `ref_stripe_${Date.now()}`;

      // Call payment provider refund API if mock/client available
      if (stripeClientMock && typeof stripeClientMock.createRefund === 'function') {
        await stripeClientMock.createRefund({
          paymentIntentId: invoice.transactionRef,
          amountCents: Math.round(refundDollars * 100),
          reason: reason || 'Requested by practice administrator'
        });
      }

      const updateData = {
        status: isFull ? 'refunded' : 'partially_refunded',
        refundedAt: now,
        refundAmount: refundDollars,
        refundRef: refId,
        refundReason: reason || 'Administrative fee adjustment',
        refundedBy: context.email || context.uid,
        updatedAt: now
      };

      if (firestoreDb && typeof firestoreDb.collection === 'function') {
        await firestoreDb.collection('invoices').doc(invoiceId).set(updateData, { merge: true });
      }

      if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
        await auditLogger.recordAuthoritativeEvent({
          action: 'Invoice Payment Refunded',
          eventType: 'PAYMENT_REFUNDED',
          category: 'Billing',
          targetId: invoiceId,
          clientId: invoice.clientId || null,
          details: `Invoice ${invoiceId} refunded $${refundDollars.toFixed(2)} by Admin ${context.email}. Reason: ${reason || 'Administrative adjustment'}`,
          actor: context
        });
      }

      return {
        success: true,
        invoiceId,
        status: updateData.status,
        refundAmount: refundDollars,
        refundRef: refId
      };
    });

  } catch (err) {
    return safeErrorResponse(err);
  }
}

/**
 * Reconciles invoice balance against payment and refund records in Firestore.
 */
export async function reconcileInvoiceBalanceHandler(params, services) {
  const { invoiceId } = params;
  const { firestoreDb, auditLogger } = services;

  try {
    if (!invoiceId) {
      throw invalidArgument('Valid invoiceId is required.');
    }

    let invoice = null;
    if (firestoreDb && typeof firestoreDb.collection === 'function') {
      const snap = await firestoreDb.collection('invoices').doc(invoiceId).get();
      if (snap.exists || typeof snap.data === 'function') {
        invoice = typeof snap.data === 'function' ? snap.data() : snap.data;
      }
    }

    if (!invoice) {
      throw notFound(`Invoice '${invoiceId}' was not found.`);
    }

    const total = Number(invoice.total || invoice.amount || 0);
    const amountPaid = Number(invoice.amountPaid || (invoice.status === 'paid' ? total : 0));
    const refundAmount = Number(invoice.refundAmount || 0);
    const netPaid = Math.max(0, Number((amountPaid - refundAmount).toFixed(2)));
    const amountDue = Math.max(0, Number((total - netPaid).toFixed(2)));

    let status = invoice.status;
    if (refundAmount > 0 && netPaid <= 0.005) {
      status = 'refunded';
    } else if (refundAmount > 0 && netPaid > 0) {
      status = 'partially_refunded';
    } else if (amountDue <= 0.005 && total > 0) {
      status = 'paid';
    } else if (netPaid > 0 && amountDue > 0) {
      status = 'partially_paid';
    }

    const now = new Date().toISOString();
    const updates = {
      total,
      amountPaid: netPaid,
      amountDue,
      status,
      reconciledAt: now,
      updatedAt: now
    };

    if (firestoreDb && typeof firestoreDb.collection === 'function') {
      await firestoreDb.collection('invoices').doc(invoiceId).set(updates, { merge: true });
    }

    if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
      await auditLogger.recordAuthoritativeEvent({
        action: 'Invoice Balance Reconciled',
        eventType: 'INVOICE_RECONCILED',
        category: 'Billing',
        targetId: invoiceId,
        clientId: invoice.clientId || null,
        details: `Reconciliation for ${invoiceId}: total=$${total.toFixed(2)}, paid=$${netPaid.toFixed(2)}, due=$${amountDue.toFixed(2)}, status=${status}`,
        actor: { uid: 'billing_reconciliation_worker', role: 'system' }
      });
    }

    return {
      success: true,
      invoiceId,
      total,
      amountPaid: netPaid,
      amountDue,
      status
    };

  } catch (err) {
    return safeErrorResponse(err);
  }
}
