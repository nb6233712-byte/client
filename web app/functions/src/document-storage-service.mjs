/**
 * ============================================================================
 * DOCUMENT STORAGE & SECURE RETRIEVAL SERVICE
 * ============================================================================
 * 
 * Statutory & Security Compliance:
 * - FTC Safeguards Rule § 314.4: Data in transit & at rest encryption
 * - IRC § 7216: Tax return confidentiality & cross-client isolation
 * - IRS Pub 1345: ERO custody, document retention & non-repudiation
 * 
 * Trust Boundary:
 * Documents stored in Cloud Storage (tax returns, W-2s, 1099s, Form 8879)
 * are NEVER given public-read access. Every retrieval requires caller
 * authentication and strict verification against client tenant boundaries.
 */

import { unauthenticated, permissionDenied, invalidArgument, notFound, safeErrorResponse } from './errors.mjs';

/**
 * Extracts client UID from authorized storage path.
 * Supported patterns:
 * - clients/{clientUid}/documents/...
 * - clients/{clientUid}/tax-years/...
 * - clients/{clientUid}/form8879/...
 * - intake_submissions/{clientUid}/...
 * - returns/{clientUid}/...
 */
export function extractClientUidFromPath(storagePath) {
  if (!storagePath || typeof storagePath !== 'string') return null;
  const normalized = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/');
  if (segments.length >= 2) {
    if (segments[0] === 'clients' || segments[0] === 'intake_submissions' || segments[0] === 'returns') {
      return segments[1];
    }
  }
  return null;
}

/**
 * Validates storage path format and rejects path traversal.
 */
export function validateStoragePath(storagePath) {
  if (!storagePath || typeof storagePath !== 'string') {
    throw invalidArgument('Storage path is required.');
  }
  if (storagePath.includes('..') || storagePath.includes('\\') || storagePath.startsWith('/')) {
    throw invalidArgument('Invalid storage path format: directory traversal prohibited.');
  }
  const clientUid = extractClientUidFromPath(storagePath);
  if (!clientUid) {
    throw invalidArgument('Storage path must conform to authorized client bucket prefix.');
  }
  return clientUid;
}

/**
 * Handles secure document retrieval and streaming with compliant response headers.
 * 
 * @param {object} params
 * @param {object} params.context - Caller authentication context { uid, email, role }
 * @param {string} params.storagePath - Target path in storage bucket
 * @param {string} [params.customFilename] - Optional override filename for Content-Disposition
 * @param {object} services - { storageBucket, firestoreDb, auditLogger }
 */
export async function retrieveDocumentHandler(params, services) {
  const { context, storagePath, customFilename } = params;
  const { storageBucket, firestoreDb, auditLogger } = services;

  try {
    // 1. Authenticate caller
    if (!context || !context.uid) {
      throw unauthenticated('Authentication required to access documents.');
    }

    // 2. Validate path syntax & extract tenant ID
    const targetClientUid = validateStoragePath(storagePath);

    // 3. Authorize caller against tenant boundary
    const isStaff = context.role === 'firm_admin' || context.role === 'firm_preparer';
    if (!isStaff && context.uid !== targetClientUid) {
      throw permissionDenied('Access Denied: Cross-client document retrieval prohibited by IRC § 7216.');
    }

    // 4. Retrieve object from storage bucket or mock storage
    let fileBuffer = null;
    let fileMetadata = {};

    if (storageBucket && typeof storageBucket.file === 'function') {
      const file = storageBucket.file(storagePath);
      const [exists] = await file.exists();
      if (!exists) {
        throw notFound(`Document not found at path: ${storagePath}`);
      }
      const [buffer] = await file.download();
      const [metadata] = await file.getMetadata();
      fileBuffer = buffer;
      fileMetadata = metadata || {};
    } else if (services.storageService && typeof services.storageService.getFile === 'function') {
      const result = await services.storageService.getFile(storagePath);
      if (!result || !result.exists) {
        throw notFound(`Document not found at path: ${storagePath}`);
      }
      fileBuffer = result.data;
      fileMetadata = result.metadata || {};
    } else {
      // Default fallback for test environment or in-memory stub
      throw notFound(`Document storage service unavailable or file missing at: ${storagePath}`);
    }

    // 5. Derive clean filename for Content-Disposition
    const pathParts = storagePath.split('/');
    const defaultName = pathParts[pathParts.length - 1] || 'document.pdf';
    const filename = (customFilename || defaultName).replace(/[^a-zA-Z0-9._-]/g, '_');

    // 6. Enforce strict, secure HTTP response headers
    const headers = {
      'Content-Type': fileMetadata.contentType || 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': fileBuffer.length,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Frame-Options': 'DENY'
    };

    // 7. Record WORM audit event for document access
    if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
      await auditLogger.recordAuthoritativeEvent({
        action: 'Document Retrieved',
        eventType: 'DOCUMENT_ACCESSED',
        category: 'Document Management',
        targetId: storagePath,
        clientId: targetClientUid,
        details: `Document ${filename} retrieved by ${context.email || context.uid} (Role: ${context.role || 'client'})`,
        actor: context
      });
    }

    return {
      success: true,
      storagePath,
      filename,
      headers,
      data: fileBuffer,
      contentType: headers['Content-Type'],
      sizeBytes: fileBuffer.length
    };

  } catch (err) {
    return safeErrorResponse(err);
  }
}

/**
 * Generates an authenticated, short-lived v4 signed URL for secure download.
 */
export async function getSignedDocumentUrlHandler(params, services) {
  const { context, storagePath, expiresInMinutes = 15 } = params;
  const { storageBucket, auditLogger } = services;

  try {
    if (!context || !context.uid) {
      throw unauthenticated('Authentication required.');
    }

    const targetClientUid = validateStoragePath(storagePath);
    const isStaff = context.role === 'firm_admin' || context.role === 'firm_preparer';
    if (!isStaff && context.uid !== targetClientUid) {
      throw permissionDenied('Access Denied: Cross-client signed URL request prohibited.');
    }

    let downloadUrl = null;
    if (storageBucket && typeof storageBucket.file === 'function') {
      const file = storageBucket.file(storagePath);
      const [exists] = await file.exists();
      if (!exists) {
        throw notFound(`Requested file not found in storage: ${storagePath}`);
      }

      const expiresAt = Date.now() + expiresInMinutes * 60 * 1000;
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: expiresAt
      });
      downloadUrl = url;
    } else {
      // In-memory / mock signed URL
      downloadUrl = `https://storage.googleapis.com/pivot-aide-tax-vault/${storagePath}?signed=mock_${Date.now()}`;
    }

    if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
      await auditLogger.recordAuthoritativeEvent({
        action: 'Signed Download URL Generated',
        eventType: 'DOCUMENT_URL_GENERATED',
        category: 'Document Management',
        targetId: storagePath,
        clientId: targetClientUid,
        details: `Short-lived signed URL (${expiresInMinutes}m) issued to ${context.email || context.uid}`,
        actor: context
      });
    }

    return {
      success: true,
      storagePath,
      downloadUrl,
      expiresInMinutes
    };

  } catch (err) {
    return safeErrorResponse(err);
  }
}

/**
 * Reconciles partial failures safely: verifies physical storage against database metadata.
 * If file does not exist in Storage, marks Firestore record as missing/failed rather than valid.
 */
export async function reconcileStoragePartialFailureHandler(params, services) {
  const { documentId, storagePath } = params;
  const { storageBucket, firestoreDb, auditLogger } = services;

  try {
    if (!documentId || !storagePath) {
      throw invalidArgument('documentId and storagePath are required.');
    }

    let physicalExists = false;
    if (storageBucket && typeof storageBucket.file === 'function') {
      const [exists] = await storageBucket.file(storagePath).exists();
      physicalExists = exists;
    }

    const now = new Date().toISOString();
    let reconciledStatus = physicalExists ? 'verified_stored' : 'missing_storage_reference';

    if (firestoreDb && typeof firestoreDb.collection === 'function') {
      await firestoreDb.collection('documents').doc(documentId).set({
        reconciledAt: now,
        storageVerified: physicalExists,
        status: physicalExists ? 'active' : 'upload_failed',
        failureReason: physicalExists ? null : 'Physical storage object missing from bucket'
      }, { merge: true });
    }

    if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
      await auditLogger.recordAuthoritativeEvent({
        action: 'Storage Reference Reconciled',
        eventType: 'STORAGE_RECONCILIATION',
        category: 'Document Management',
        targetId: documentId,
        details: `Document ${documentId} reconciliation: physicalExists=${physicalExists}, status=${reconciledStatus}`,
        actor: { uid: 'system_reconciliation_worker', role: 'system' }
      });
    }

    return {
      success: true,
      documentId,
      storagePath,
      physicalExists,
      reconciledStatus
    };

  } catch (err) {
    return safeErrorResponse(err);
  }
}
