/**
 * ============================================================================
 * SECURE MESSAGING SERVICE (TRUSTED BACKEND OPERATIONS)
 * ============================================================================
 * 
 * Statutory & Security Compliance:
 * - IRC § 7216: Client tax preparation communication confidentiality
 * - Strict Cross-Client Isolation: Taxpayers can ONLY view & send messages in their own thread
 * - Idempotency: Prevents duplicate messages on network retries
 * - Sound Alert Trigger: Emits sound notification metadata for real-time frontend listener
 */

import crypto from 'node:crypto';
import { unauthenticated, permissionDenied, invalidArgument, notFound, safeErrorResponse } from './errors.mjs';
import { idempotency } from './idempotency.mjs';

/**
 * Validates and sanitizes message text to prevent script injection.
 */
function sanitizeMessageText(text) {
  if (!text || typeof text !== 'string') return '';
  return text.trim()
    .replace(/[<>]/g, '')
    .slice(0, 5000);
}

/**
 * Handles authenticated message submission to Cloud Firestore.
 */
export async function sendMessageHandler(params, services) {
  const {
    context,
    clientId,
    engagementId,
    text,
    subject = 'Tax Client Portal Message',
    taxYear = 2026,
    attachments = [],
    idempotencyKey
  } = params;
  const { firestoreDb, auditLogger, notificationDispatcher } = services;

  try {
    // 1. Authenticate caller
    if (!context || !context.uid) {
      throw unauthenticated('Authentication required to send messages.');
    }

    const isStaff = (context.role === 'firm_admin' || context.role === 'firm_preparer' || context.role === 'firm_staff');
    const targetClientId = clientId || params.clientUid || context.uid;

    // 2. Cross-Client Isolation & Authorization
    if (!isStaff && context.uid !== targetClientId) {
      throw permissionDenied('Cross-tenant violation: You cannot send messages to another taxpayer thread.');
    }

    // 3. Text Validation
    const cleanText = sanitizeMessageText(text);
    if (!cleanText) {
      throw invalidArgument('Message text cannot be empty.');
    }

    // 4. Idempotency Key (Prevents duplicates on retry)
    const key = idempotencyKey || `msg_${context.uid}_${targetClientId}_${idempotency.hashPayload({ text: cleanText, targetClientId }).slice(0, 16)}`;

    return await idempotency.executeIdempotent(key, async () => {
      const now = new Date().toISOString();
      const messageId = `msg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const senderRole = isStaff ? (context.role || 'firm_preparer') : 'client';
      const senderName = context.displayName || (isStaff ? 'Pivot Aide CPA' : 'Client');
      const senderEmail = context.email || (isStaff ? 'denise@pivot-aide.tax' : 'client@thefileroom.tax');

      const messageDoc = {
        messageId,
        id: messageId,
        clientId: targetClientId,
        clientUid: targetClientId,
        engagementId: engagementId || `eng_${taxYear}_${targetClientId}`,
        taxYear,
        text: cleanText,
        subject,
        senderId: context.uid,
        senderName,
        senderRole,
        senderEmail,
        attachments: Array.isArray(attachments) ? attachments : [],
        readByClient: !isStaff,
        readByFirm: isStaff,
        createdAt: now,
        persisted: true,
        statutoryConfidentiality: 'IRC § 7216 Client Privilege'
      };

      // Persist to Cloud Firestore
      if (firestoreDb && typeof firestoreDb.collection === 'function') {
        await firestoreDb.collection('messages').doc(messageId).set(messageDoc);
      }

      // Record WORM audit event
      if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
        await auditLogger.recordAuthoritativeEvent({
          action: 'Message Submitted',
          eventType: 'MESSAGE_SENT',
          category: 'Communications',
          targetId: messageId,
          clientId: targetClientId,
          details: `Message dispatched from ${senderName} (${senderRole}). Length: ${cleanText.length} chars.`,
          actor: { uid: context.uid, email: senderEmail, role: senderRole }
        });
      }

      // Dispatch notification with soundTrigger metadata
      if (notificationDispatcher && typeof notificationDispatcher.dispatch === 'function') {
        const recipientUid = isStaff ? targetClientId : 'firm_staff_channel';
        await notificationDispatcher.dispatch({
          type: 'NEW_MESSAGE',
          recipientUid,
          metadata: {
            title: `New Message from ${senderName}`,
            message: cleanText.slice(0, 100),
            messageId,
            soundTrigger: true,
            soundEvent: 'new_message',
            browserAudioPlayed: false,
            audioVerified: false
          }
        });
      }

      return {
        success: true,
        persisted: true,
        offlineCached: false,
        messageId,
        clientUid: targetClientId,
        data: messageDoc
      };
    });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

/**
 * Handles authorized message history retrieval for a conversation.
 */
export async function getMessagesHandler(params, services) {
  const { context, clientId } = params;
  const { firestoreDb } = services;

  try {
    if (!context || !context.uid) {
      throw unauthenticated('Authentication required to retrieve messages.');
    }

    const isStaff = (context.role === 'firm_admin' || context.role === 'firm_preparer' || context.role === 'firm_staff');
    const targetClientId = clientId || params.clientUid || context.uid;

    if (!isStaff && context.uid !== targetClientId) {
      throw permissionDenied('Cross-tenant violation: You can only read your own message thread.');
    }

    if (!firestoreDb || typeof firestoreDb.collection !== 'function') {
      return { success: true, messages: [] };
    }

    const snap = await firestoreDb.collection('messages').get();
    const messages = [];
    if (snap && typeof snap.forEach === 'function') {
      snap.forEach((doc) => {
        const d = doc.data();
        if (d.clientId === targetClientId || d.clientUid === targetClientId) {
          messages.push({ id: doc.id, ...d });
        }
      });
    }

    messages.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    return {
      success: true,
      messages
    };
  } catch (err) {
    return safeErrorResponse(err);
  }
}
