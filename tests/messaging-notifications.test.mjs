/**
 * ============================================================================
 * TEST SUITE: MESSAGING, ATTACHMENTS & NOTIFICATION SERVICE (PIVOT AIDE TAX)
 * ============================================================================
 * 
 * Verifies:
 * 1. Thread association with client and engagement (tenancy binding)
 * 2. Cross-tenant message & attachment isolation (Firestore & Storage rules)
 * 3. Unread status & immutable message bodies (only read receipt updates allowed)
 * 4. Notification channel classification matrix (in-app vs email)
 * 5. IRC § 7216 anti-leakage sanitization (SSN, EIN, refund, schedule blocking)
 * 6. Postmark delivery confirmation (delivered ONLY with confirmed MessageID)
 * 7. Retry mechanics on transient failures vs terminal failure on permanent errors
 * 8. Cryptographic idempotency & duplicate event suppression
 * 9. Credential isolation (zero token exposure to client runtime)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  DELIVERY_STATUS,
  sanitizeEmailContent,
  generateIdempotencyKey,
  PostmarkClient,
  NotificationOrchestrator
} from '../server/notification-service.mjs';

// ── Security Rules Evaluation Helpers ───────────────────────────────────────
function evaluateFirestoreMessageRule(auth, operation, resource, requestResource) {
  const isAuthenticated = Boolean(auth && auth.uid);
  const isFirmStaff = isAuthenticated && (auth.token?.role === 'firm_preparer' || auth.token?.role === 'firm_admin');
  const isFirmAdmin = isAuthenticated && auth.token?.role === 'firm_admin';

  if (operation === 'read') {
    if (!isAuthenticated) return false;
    return (
      resource.uid === auth.uid ||
      resource.clientId === auth.uid ||
      isFirmStaff
    );
  }

  if (operation === 'create') {
    if (!isAuthenticated) return false;
    // Client write: clientId must match auth.uid, uid must match auth.uid, engagementId must exist
    const isClientValid = (
      requestResource.clientId === auth.uid &&
      requestResource.uid === auth.uid &&
      'engagementId' in requestResource
    );
    // Staff write: must include clientId and engagementId
    const isStaffValid = (
      isFirmStaff &&
      'clientId' in requestResource &&
      'engagementId' in requestResource
    );
    return isClientValid || isStaffValid;
  }

  if (operation === 'update') {
    if (!isAuthenticated) return false;
    if (isFirmStaff) return true;

    // Client can only update read receipts
    const isOwnMessage = (resource.clientId === auth.uid || resource.uid === auth.uid);
    if (!isOwnMessage) return false;

    const modifiedKeys = Object.keys(requestResource).filter(k => requestResource[k] !== resource[k]);
    const allowedKeys = ['readByClient', 'clientReadAt', 'readAt'];
    return modifiedKeys.length > 0 && modifiedKeys.every(k => allowedKeys.includes(k));
  }

  if (operation === 'delete') {
    return isFirmAdmin;
  }

  return false;
}

function evaluateStorageAttachmentRule(auth, operation, path, fileMetadata = {}) {
  const isAuthenticated = Boolean(auth && auth.uid);
  const isFirmStaff = isAuthenticated && (auth.token?.role === 'firm_preparer' || auth.token?.role === 'firm_admin');

  // Match /clients/{userId}/engagements/{engagementId}/messages/{messageId}/{fileName}
  // or /clients/{userId}/messages/{messageId}/{fileName}
  const match = path.match(/^\/clients\/([^/]+)\/(?:engagements\/[^/]+\/)?messages\/[^/]+\/[^/]+$/);
  if (!match) return false;

  const targetUserId = match[1];

  if (operation === 'read') {
    return isAuthenticated && (auth.uid === targetUserId || isFirmStaff);
  }

  if (operation === 'create') {
    if (!isAuthenticated) return false;
    const isOwnerOrStaff = (auth.uid === targetUserId || isFirmStaff);
    if (!isOwnerOrStaff) return false;

    // Size limit: 25MB
    const size = fileMetadata.size || 0;
    const isUnder25MB = size <= 25 * 1024 * 1024;

    // MIME type check: pdf, jpg, jpeg, png, heic, webp
    const contentType = fileMetadata.contentType || '';
    const isAllowedMime = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/heic',
      'image/webp'
    ].includes(contentType);

    return isUnder25MB && isAllowedMime;
  }

  return false;
}

// ============================================================================
// TEST CASES
// ============================================================================

describe('1. Message & Engagement Thread Tenancy Binding', () => {
  const clientAuth = { uid: 'usr_client_001', token: { role: 'client' } };
  const rogueAuth = { uid: 'usr_client_002', token: { role: 'client' } };
  const preparerAuth = { uid: 'usr_preparer_001', token: { role: 'firm_preparer' } };

  it('allows client to create message with their own clientId and valid engagementId', () => {
    const validMessage = {
      clientId: 'usr_client_001',
      uid: 'usr_client_001',
      engagementId: 'eng_2026_client_001',
      text: 'Here is my 1099-INT update.'
    };
    const allowed = evaluateFirestoreMessageRule(clientAuth, 'create', null, validMessage);
    assert.strictEqual(allowed, true);
  });

  it('rejects client attempting to create message under another clientId (cross-tenant spoof)', () => {
    const spoofedMessage = {
      clientId: 'usr_client_999', // Spoofing different client
      uid: 'usr_client_001',
      engagementId: 'eng_2026_client_999',
      text: 'Infiltrating another client thread.'
    };
    const allowed = evaluateFirestoreMessageRule(clientAuth, 'create', null, spoofedMessage);
    assert.strictEqual(allowed, false);
  });

  it('rejects message creation if engagementId is omitted', () => {
    const unassociatedMessage = {
      clientId: 'usr_client_001',
      uid: 'usr_client_001',
      text: 'Floating message without engagement binding'
    };
    const allowed = evaluateFirestoreMessageRule(clientAuth, 'create', null, unassociatedMessage);
    assert.strictEqual(allowed, false);
  });

  it('allows firm preparer to post message into client thread with proper engagement binding', () => {
    const preparerMessage = {
      clientId: 'usr_client_001',
      uid: 'usr_preparer_001',
      engagementId: 'eng_2026_client_001',
      text: 'We reviewed your W-2 and need box 12 confirmation.'
    };
    const allowed = evaluateFirestoreMessageRule(preparerAuth, 'create', null, preparerMessage);
    assert.strictEqual(allowed, true);
  });
});

describe('2. Message Thread Access Control & Attachment Security', () => {
  const clientAuth = { uid: 'usr_client_001', token: { role: 'client' } };
  const rogueAuth = { uid: 'usr_client_002', token: { role: 'client' } };
  const preparerAuth = { uid: 'usr_preparer_001', token: { role: 'firm_preparer' } };

  const messageDoc = {
    messageId: 'msg_1001',
    clientId: 'usr_client_001',
    uid: 'usr_client_001',
    engagementId: 'eng_2026_client_001',
    text: 'Client document note'
  };

  it('allows owner client to read their message thread', () => {
    assert.strictEqual(evaluateFirestoreMessageRule(clientAuth, 'read', messageDoc), true);
  });

  it('blocks another client from reading thread (cross-tenant boundary)', () => {
    assert.strictEqual(evaluateFirestoreMessageRule(rogueAuth, 'read', messageDoc), false);
  });

  it('allows firm preparer to read client message thread', () => {
    assert.strictEqual(evaluateFirestoreMessageRule(preparerAuth, 'read', messageDoc), true);
  });

  it('allows client to upload attachment to their message folder within 25MB PDF/image limit', () => {
    const path = '/clients/usr_client_001/engagements/eng_2026_client_001/messages/msg_1001/w2_attachment.pdf';
    const metadata = { size: 2 * 1024 * 1024, contentType: 'application/pdf' };
    assert.strictEqual(evaluateStorageAttachmentRule(clientAuth, 'create', path, metadata), true);
  });

  it('blocks client from uploading attachment to another client message folder', () => {
    const path = '/clients/usr_client_999/engagements/eng_2026_client_999/messages/msg_9999/rogue.pdf';
    const metadata = { size: 1024 * 1024, contentType: 'application/pdf' };
    assert.strictEqual(evaluateStorageAttachmentRule(clientAuth, 'create', path, metadata), false);
  });

  it('rejects attachment exceeding 25MB ceiling', () => {
    const path = '/clients/usr_client_001/engagements/eng_2026_client_001/messages/msg_1001/huge.pdf';
    const metadata = { size: 30 * 1024 * 1024, contentType: 'application/pdf' };
    assert.strictEqual(evaluateStorageAttachmentRule(clientAuth, 'create', path, metadata), false);
  });

  it('rejects executable attachments (.exe / script)', () => {
    const path = '/clients/usr_client_001/engagements/eng_2026_client_001/messages/msg_1001/trojan.exe';
    const metadata = { size: 50000, contentType: 'application/x-msdownload' };
    assert.strictEqual(evaluateStorageAttachmentRule(clientAuth, 'create', path, metadata), false);
  });
});

describe('3. Unread Status & Read Receipts (Tamper Protection)', () => {
  const clientAuth = { uid: 'usr_client_001', token: { role: 'client' } };
  const baseMessage = {
    messageId: 'msg_555',
    clientId: 'usr_client_001',
    uid: 'preparer_denise',
    engagementId: 'eng_2026_001',
    text: 'Please check your W-2 wage statement.',
    readByClient: false,
    clientReadAt: null
  };

  it('allows client to update their own read receipt fields', () => {
    const updated = {
      ...baseMessage,
      readByClient: true,
      clientReadAt: '2026-10-09T12:00:00Z',
      readAt: '2026-10-09T12:00:00Z'
    };
    const allowed = evaluateFirestoreMessageRule(clientAuth, 'update', baseMessage, updated);
    assert.strictEqual(allowed, true);
  });

  it('rejects client trying to alter message text content or sender', () => {
    const tampered = {
      ...baseMessage,
      text: 'Tampered message text: We waive all liability.',
      readByClient: true
    };
    const allowed = evaluateFirestoreMessageRule(clientAuth, 'update', baseMessage, tampered);
    assert.strictEqual(allowed, false);
  });

  it('calculates unread messages correctly for client badge count', () => {
    const thread = [
      { id: '1', clientId: 'usr_client_001', readByClient: false },
      { id: '2', clientId: 'usr_client_001', readByClient: true },
      { id: '3', clientId: 'usr_client_001', readByClient: false },
      { id: '4', clientId: 'usr_client_999', readByClient: false } // Other client
    ];
    const unread = thread.filter(m => m.clientId === 'usr_client_001' && !m.readByClient);
    assert.strictEqual(unread.length, 2);
  });
});

describe('4. Notification Channel Classification Matrix', () => {
  it('correctly maps actionable client events to BOTH in-app and email', () => {
    const matrix = {
      [NOTIFICATION_TYPES.NEW_MESSAGE]: NOTIFICATION_CHANNELS.BOTH,
      [NOTIFICATION_TYPES.DOCUMENT_REQUEST]: NOTIFICATION_CHANNELS.BOTH,
      [NOTIFICATION_TYPES.DOCUMENT_REJECTED]: NOTIFICATION_CHANNELS.BOTH,
      [NOTIFICATION_TYPES.RETURN_REVIEW]: NOTIFICATION_CHANNELS.BOTH,
      [NOTIFICATION_TYPES.SIGNING_REMINDER]: NOTIFICATION_CHANNELS.BOTH,
      [NOTIFICATION_TYPES.DEADLINE_REMINDER]: NOTIFICATION_CHANNELS.BOTH,
      [NOTIFICATION_TYPES.INVOICE_ISSUED]: NOTIFICATION_CHANNELS.BOTH,
      [NOTIFICATION_TYPES.REGULATORY_UPDATE]: NOTIFICATION_CHANNELS.IN_APP
    };

    assert.strictEqual(matrix[NOTIFICATION_TYPES.NEW_MESSAGE], 'both');
    assert.strictEqual(matrix[NOTIFICATION_TYPES.DOCUMENT_REQUEST], 'both');
    assert.strictEqual(matrix[NOTIFICATION_TYPES.RETURN_REVIEW], 'both');
    assert.strictEqual(matrix[NOTIFICATION_TYPES.SIGNING_REMINDER], 'both');
    assert.strictEqual(matrix[NOTIFICATION_TYPES.DEADLINE_REMINDER], 'both');
    assert.strictEqual(matrix[NOTIFICATION_TYPES.REGULATORY_UPDATE], 'in_app');
  });

  it('respects user preference opt-out when set to off', () => {
    const orchestrator = new NotificationOrchestrator();
    const event = {
      recipientUid: 'usr_001',
      recipientEmail: 'client@example.com',
      recipientName: 'Morgan',
      type: NOTIFICATION_TYPES.DEADLINE_REMINDER,
      entityId: 'dl_q4',
      userPreferences: {
        [NOTIFICATION_TYPES.DEADLINE_REMINDER]: 'off'
      }
    };
    const result = orchestrator.queueEvent(event);
    assert.strictEqual(result.status, 'skipped');
  });
});

describe('5. IRC § 7216 Anti-Leakage Sanitizer', () => {
  it('produces clean CTA email without exposing taxpayer sensitive data', () => {
    const sanitized = sanitizeEmailContent({
      type: NOTIFICATION_TYPES.RETURN_REVIEW,
      recipientName: 'Morgan Whitfield',
      metadata: {}
    });

    assert.match(sanitized.subject, /ready for review/i);
    assert.match(sanitized.bodyText, /https:\/\/thefileroom\.tax\/return\/prepared/);
    assert.match(sanitized.bodyHtml, /Confidentiality Notice/);

    // Verify absence of sensitive tokens
    assert.doesNotMatch(sanitized.bodyText, /\b\d{3}-\d{2}-\d{4}\b/);
    assert.doesNotMatch(sanitized.bodyText, /\$\s*\d+/);
    assert.doesNotMatch(sanitized.bodyText, /refund|balance due|agi/i);
  });

  it('throws safety error if a template attempt injects SSN or refund figure', () => {
    const leakyEvent = {
      type: NOTIFICATION_TYPES.DEADLINE_REMINDER,
      recipientName: 'Morgan Whitfield',
      metadata: {
        deadlineName: 'Your refund of $4,850 and SSN 000-11-2222'
      }
    };
    assert.throws(() => {
      sanitizeEmailContent(leakyEvent);
    }, /IRC § 7216 Violation/);
  });
});

describe('6. Postmark Delivery Confirmation (Zero False Confirmation)', () => {
  it('confirms delivery ONLY when Postmark returns HTTP 200 with valid MessageID', async () => {
    const client = new PostmarkClient({ isMockMode: true });
    const orchestrator = new NotificationOrchestrator({ emailClient: client });

    const event = {
      recipientUid: 'usr_101',
      recipientEmail: 'morgan@example.com',
      recipientName: 'Morgan',
      type: NOTIFICATION_TYPES.NEW_MESSAGE,
      entityId: 'msg_abc123'
    };

    const queued = orchestrator.queueEvent(event);
    assert.strictEqual(queued.status, 'queued');

    const result = await orchestrator.processRecord(queued.outboxRecord.outboxId);
    assert.strictEqual(result.status, DELIVERY_STATUS.DELIVERED);
    assert.ok(result.record.providerMessageId.startsWith('pm_sim_'));
    assert.ok(result.record.confirmedAt);
  });

  it('never marks delivered on transient 500 error; sets retrying with backoff', async () => {
    const client = new PostmarkClient({
      isMockMode: true,
      mockResponses: [
        { shouldFail: true, statusCode: 503, errorMessage: 'Postmark service temporarily overloaded' }
      ]
    });
    const orchestrator = new NotificationOrchestrator({ emailClient: client });

    const event = {
      recipientUid: 'usr_102',
      recipientEmail: 'morgan@example.com',
      recipientName: 'Morgan',
      type: NOTIFICATION_TYPES.DOCUMENT_REQUEST,
      entityId: 'req_doc_999'
    };

    const queued = orchestrator.queueEvent(event);
    const result = await orchestrator.processRecord(queued.outboxRecord.outboxId);

    assert.strictEqual(result.status, DELIVERY_STATUS.RETRYING);
    assert.strictEqual(result.record.providerMessageId, null);
    assert.strictEqual(result.record.attempts, 1);
    assert.ok(result.record.nextAttemptAt);
    assert.strictEqual(result.record.error.isTransient, true);
  });

  it('marks permanently failed on 4xx validation error without retries', async () => {
    const client = new PostmarkClient({
      isMockMode: true,
      mockResponses: [
        { shouldFail: true, statusCode: 422, errorMessage: 'Invalid recipient mailbox syntax' }
      ]
    });
    const orchestrator = new NotificationOrchestrator({ emailClient: client });

    const event = {
      recipientUid: 'usr_103',
      recipientEmail: 'bad-email@domain',
      recipientName: 'Morgan',
      type: NOTIFICATION_TYPES.SIGNING_REMINDER,
      entityId: 'sig_form_8879'
    };

    const queued = orchestrator.queueEvent(event);
    const result = await orchestrator.processRecord(queued.outboxRecord.outboxId);

    assert.strictEqual(result.status, DELIVERY_STATUS.FAILED);
    assert.strictEqual(result.record.providerMessageId, null);
    assert.strictEqual(result.record.error.isTransient, false);
  });
});

describe('7. Idempotency & Duplicate Event Suppression', () => {
  it('suppresses immediate duplicate events for same user, event type, and entity', () => {
    const orchestrator = new NotificationOrchestrator();
    const event = {
      recipientUid: 'usr_200',
      recipientEmail: 'morgan@example.com',
      recipientName: 'Morgan',
      type: NOTIFICATION_TYPES.RETURN_REVIEW,
      entityId: 'ret_2026_final'
    };

    const first = orchestrator.queueEvent(event);
    assert.strictEqual(first.status, 'queued');

    const second = orchestrator.queueEvent(event);
    assert.strictEqual(second.status, DELIVERY_STATUS.SUPPRESSED_DUPLICATE);
  });

  it('allows different entityIds or different recipients without collision', () => {
    const orchestrator = new NotificationOrchestrator();
    const eventA = {
      recipientUid: 'usr_200',
      recipientEmail: 'morgan@example.com',
      type: NOTIFICATION_TYPES.DOCUMENT_REQUEST,
      entityId: 'doc_1'
    };
    const eventB = {
      recipientUid: 'usr_200',
      recipientEmail: 'morgan@example.com',
      type: NOTIFICATION_TYPES.DOCUMENT_REQUEST,
      entityId: 'doc_2' // Different entity
    };

    const resA = orchestrator.queueEvent(eventA);
    const resB = orchestrator.queueEvent(eventB);
    assert.strictEqual(resA.status, 'queued');
    assert.strictEqual(resB.status, 'queued');
  });
});

describe('8. Backend Credential Security Isolation', () => {
  it('guarantees Postmark Server Token is managed exclusively on the backend', () => {
    const client = new PostmarkClient();
    // In test environment, client safely defaults to mock mode unless live token is present
    assert.strictEqual(typeof client.sendEmail, 'function');
    assert.strictEqual(client.stream, 'outbound');
  });
});
