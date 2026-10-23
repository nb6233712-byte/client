/**
 * ============================================================================
 * THE FILE ROOM — FIREBASE CLOUD FUNCTIONS ENTRY POINT (TRUSTED BACKEND)
 * ============================================================================
 * 
 * Production Deployment:
 * firebase deploy --only functions
 * 
 * Governing Standards:
 * - FTC Safeguards Rule (16 CFR Part 314 § 314.4)
 * - Internal Revenue Code § 7216 & § 6694
 * - IRS Publication 1345 & IRM 10.10.1
 * - PCI-DSS v4.0.1 SAQ-A
 * - Treasury Department Circular 230 § 10.22
 */

// Priority Modules
export { provisionStaffRoleHandler, assignDefaultClientRoleHandler } from './src/auth-roles.mjs';
export { documentReviewHandler } from './src/document-review.mjs';
export { publishPreparedReturnHandler, clientApproveReturnHandler } from './src/return-workflow.mjs';
export { auditLedger, AuditLedgerService } from './src/audit-ledger.mjs';
export { createPaymentCheckoutSessionHandler } from './src/payment-checkout.mjs';
export { paymentWebhookHandler } from './src/payment-webhook.mjs';
export { signingProviderCallbackHandler } from './src/signing-callback.mjs';
export { createDocuSignEnvelopeSessionHandler, docuSignConnectWebhookHandler } from './src/docusign-service.mjs';
export { fileScanStatusHandler } from './src/malware-scanner.mjs';
export { notificationDispatcher, NotificationDispatcherService } from './src/notification-dispatcher.mjs';
export { staffIssueInvoiceHandler, staffRefundInvoiceHandler } from './src/invoice-service.mjs';
export { grantConsentHandler, revokeConsentHandler, verifyActiveConsentHandler, MANDATORY_7216_STATUTORY_WARNING } from './src/consent-service.mjs';
export { evaluateRetentionScheduleHandler, executeSecureDisposalHandler, RETENTION_POLICIES } from './src/data-retention-service.mjs';
export { secretManager } from './src/config.mjs';
export { idempotency } from './src/idempotency.mjs';
export { documentIntakeFallbackHandler } from './src/document-intake.mjs';
export {
  generateForm8879PdfStream,
  generateAndStoreForm8879Handler,
  retrieveForm8879Handler
} from './src/form-8879-service.mjs';
export {
  sendMessageHandler,
  getMessagesHandler
} from './src/messaging-service.mjs';
export {
  submitAddonRequest,
  reviewAddonRequest,
  PRACTICE_ADDON_CATALOG
} from './src/addon-service.mjs';
export {
  retrieveDocumentHandler,
  getSignedDocumentUrlHandler,
  reconcileStoragePartialFailureHandler,
  extractClientUidFromPath,
  validateStoragePath
} from './src/document-storage-service.mjs';
export {
  deriveAuthoritativeInvoiceBalance
} from './src/payment-webhook.mjs';
export {
  reconcileInvoiceBalanceHandler
} from './src/invoice-service.mjs';
export {
  DocumentDeliveryQueue,
  DELIVERY_STATE,
  ERROR_CATEGORY,
  QUEUE_CONFIG,
  STORAGE_STATE,
  REGISTRATION_STATE,
  DELIVERY_STATUS,
  DELIVERY_CHANNEL,
  calculateExponentialBackoff,
  categorizeDeliveryError,
  parseRetryAfterHeader,
  isValidStateTransition
} from './src/document-delivery-queue.mjs';
export { ErrorCode, AppError, safeErrorResponse } from './src/errors.mjs';

/**
 * Convenience Firebase Cloud Functions v2 Handler Registry
 * For use when running inside live Firebase Functions runtime.
 */
export function createFunctionHandlers(services = {}) {
  const {
    adminAuth,
    firestoreDb,
    storageBucket,
    auditLogger,
    notificationDispatcher: notifService,
    stripeMock,
    postmarkMock
  } = services;

  return {
    // 1. Staff Role Provisioning (Callable)
    provisionStaffRole: async (data, context) => {
      const { provisionStaffRoleHandler } = await import('./src/auth-roles.mjs');
      return provisionStaffRoleHandler({ context, ...data }, { adminAuth, firestoreDb, auditLogger });
    },

    // 2. Document Review (Callable)
    reviewDocument: async (data, context) => {
      const { documentReviewHandler } = await import('./src/document-review.mjs');
      return documentReviewHandler({ context, ...data }, { firestoreDb, auditLogger, notificationDispatcher: notifService });
    },

    // 3. Return Publication & Approval (Callable)
    publishReturn: async (data, context) => {
      const { publishPreparedReturnHandler } = await import('./src/return-workflow.mjs');
      return publishPreparedReturnHandler({ context, ...data }, { firestoreDb, auditLogger, notificationDispatcher: notifService });
    },
    approveReturn: async (data, context) => {
      const { clientApproveReturnHandler } = await import('./src/return-workflow.mjs');
      return clientApproveReturnHandler({ context, ...data }, { firestoreDb, auditLogger, notificationDispatcher: notifService });
    },

    // 4. Trusted Audit Event (Callable)
    recordAuditEvent: async (data, context) => {
      const { auditLedger } = await import('./src/audit-ledger.mjs');
      return auditLedger.recordAuthoritativeEvent({ ...data, actor: context });
    },

    // 5. Payment Checkout Session (Callable)
    createPaymentCheckoutSession: async (data, context) => {
      const { createPaymentCheckoutSessionHandler } = await import('./src/payment-checkout.mjs');
      return createPaymentCheckoutSessionHandler({ context, ...data }, { firestoreDb, auditLogger, stripeClientMock: stripeMock });
    },

    // 6. Payment Webhook (Raw HTTP)
    stripePaymentWebhook: async (req, res) => {
      const { paymentWebhookHandler } = await import('./src/payment-webhook.mjs');
      const result = await paymentWebhookHandler(
        {
          rawBody: req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body),
          signatureHeader: req.headers['stripe-signature'],
          eventPayload: req.body
        },
        { firestoreDb, auditLogger, notificationDispatcher: notifService }
      );
      res.status(result.success === false ? 400 : 200).json(result);
    },

    // 7. Signing Callback (Raw HTTP / Callable)
    signingCallback: async (data, context) => {
      const { signingProviderCallbackHandler } = await import('./src/signing-callback.mjs');
      return signingProviderCallbackHandler(data, { firestoreDb, auditLogger, notificationDispatcher: notifService });
    },

    // 8. Malware Scan Status (Storage Trigger / Webhook)
    updateFileScanStatus: async (data, context) => {
      const { fileScanStatusHandler } = await import('./src/malware-scanner.mjs');
      return fileScanStatusHandler(data, { firestoreDb, auditLogger });
    },

    // 9. Notification Trigger (Callable / Background)
    dispatchNotification: async (data, context) => {
      const { notificationDispatcher } = await import('./src/notification-dispatcher.mjs');
      return notificationDispatcher.dispatch(data);
    },

    // 10. Form 8879 Generation & Retrieval (Callable & HTTP)
    generateForm8879: async (data, context) => {
      const { generateAndStoreForm8879Handler } = await import('./src/form-8879-service.mjs');
      return generateAndStoreForm8879Handler({ context, ...data }, { firestoreDb, storageBucket, auditLogger });
    },
    getForm8879: async (req, res) => {
      const { retrieveForm8879Handler } = await import('./src/form-8879-service.mjs');
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const context = req.user || { uid: req.query.clientUid, role: req.query.role || 'client' };
      const result = await retrieveForm8879Handler(
        { context, clientUid: req.query.clientUid, taxYear: req.query.taxYear, returnVersion: req.query.returnVersion },
        { firestoreDb, storageBucket, auditLogger }
      );
      if (!result.success) {
        return res.status(result.error?.code === 'not_found' ? 404 : 403).json(result);
      }
      res.set(result.headers);
      res.status(200).send(result.pdfBuffer);
    },

    // 11. Secure Document Retrieval (Raw HTTP)
    retrieveDocument: async (req, res) => {
      const { retrieveDocumentHandler } = await import('./src/document-storage-service.mjs');
      const context = req.user || { uid: req.query.uid || req.query.clientUid, role: req.query.role || 'client' };
      const result = await retrieveDocumentHandler(
        { context, storagePath: req.query.path || req.query.storagePath },
        { storageBucket, firestoreDb, auditLogger }
      );
      if (!result.success) {
        const status = result.error?.code === 'not_found' ? 404 : (result.error?.code === 'unauthenticated' ? 401 : 403);
        return res.status(status).json(result);
      }
      res.set(result.headers);
      res.status(200).send(result.data);
    },

    // 12. Cross-Client Isolated Messaging (Callable)
    sendMessage: async (data, context) => {
      const { sendMessageHandler } = await import('./src/messaging-service.mjs');
      return sendMessageHandler({ context, ...data }, { firestoreDb, auditLogger, notificationDispatcher: notifService });
    },
    getMessages: async (data, context) => {
      const { getMessagesHandler } = await import('./src/messaging-service.mjs');
      return getMessagesHandler({ context, ...data }, { firestoreDb, auditLogger });
    },

    // 13. Practice Add-Ons (Callable)
    submitAddonRequest: async (data, context) => {
      const { submitAddonRequest } = await import('./src/addon-service.mjs');
      return submitAddonRequest({ context, ...data }, { firestoreDb, auditLogger, notificationDispatcher: notifService });
    },
    reviewAddonRequest: async (data, context) => {
      const { reviewAddonRequest } = await import('./src/addon-service.mjs');
      return reviewAddonRequest({ context, ...data }, { firestoreDb, auditLogger, notificationDispatcher: notifService });
    }
  };
}
