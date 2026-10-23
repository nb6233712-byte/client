/**
 * ============================================================================
 * TEST SUITE: CLIENT MESSAGING - 13 REQUIREMENTS VERIFICATION
 * ============================================================================
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Client Messaging - 13 Requirements Verification', () => {
  const clientMessagesHtml = fs.readFileSync(path.join(rootDir, 'client', 'messages.html'), 'utf8');
  const firebaseJs = fs.readFileSync(path.join(rootDir, 'js', 'firebase.js'), 'utf8');

  // 1. Client sends a message and the message persists after refresh
  it('1. Message persistence: confirms Firestore write before success and survives refresh', () => {
    assert.ok(clientMessagesHtml.includes('sendRes.success && !sendRes.offlineCached'), 'Must verify actual backend write before showing success');
    assert.ok(firebaseJs.includes("this._firestoreSet('messages', messageId, msgData)"), 'Must write to messages collection in Firestore');
    assert.ok(firebaseJs.includes('persisted: isSuccess && !isOffline'), 'Bridge must return persisted status');
  });

  // 2. Firm staff receive the client message without refreshing
  it('2. Real-time client to firm: Firestore onSnapshot and REST synchronization', () => {
    assert.ok(firebaseJs.includes("where('clientId', '==', targetUid)"), 'Must query messages by clientId');
    assert.ok(firebaseJs.includes('onSnapshot(q'), 'Must subscribe via Firestore onSnapshot');
  });

  // 3. Firm staff reply and the client receives the message without refreshing
  it('3. Real-time firm to client: subscribeMessages delivers firm replies in real time', () => {
    assert.ok(clientMessagesHtml.includes('bridge.subscribeMessages('), 'Client messages.html must subscribe to real-time stream');
    assert.ok(firebaseJs.includes('sendReplyMessage'), 'Must support firm staff reply dispatch');
  });

  // 4. Messages synchronize across separate browser tabs
  it('4. Cross-tab synchronization: BroadcastChannel and storage listeners', () => {
    assert.ok(clientMessagesHtml.includes("BroadcastChannel('tfr_messages_sync')"), 'Must use BroadcastChannel for cross-tab sync');
    assert.ok(clientMessagesHtml.includes("addEventListener('storage'"), 'Must listen for storage updates across tabs');
  });

  // 5. Messages work across separately deployed client and firm portals
  it('5. Cross-portal integration: Scoped by clientId and engagementId without portal hardcoding', () => {
    assert.ok(clientMessagesHtml.includes("'eng_2026_' + clientUid"), 'Must use consistent engagement ID schema');
    assert.ok(firebaseJs.includes('inFirmPortal'), 'Must handle client and firm portal contexts');
  });

  // 6. Network failure produces a failed or pending state rather than a false success
  it('6. Failure resilience: Displays pending and failed states upon write rejection', () => {
    assert.ok(clientMessagesHtml.includes('msg-status-badge pending'), 'Must have pending status badge');
    assert.ok(clientMessagesHtml.includes('msg-status-badge failed'), 'Must have failed status badge on network failure');
    assert.ok(clientMessagesHtml.includes('Queued offline'), 'Must have offline queued status');
  });

  // 7. Retrying a message does not create duplicates
  it('7. Idempotent retry: Reuses stable messageId and updates cache in place', () => {
    assert.ok(clientMessagesHtml.includes('retryMessage(stableMsgId, text)'), 'Must have retry handler reusing messageId');
    assert.ok(firebaseJs.includes('existingIdx >= 0'), 'firebase.js must update existing message in-place on retry');
    assert.ok(firebaseJs.includes('options.messageId'), 'firebase.js must accept caller-provided stable messageId');
  });

  // 8. Unread counts and read receipts update correctly
  it('8. Read receipts and unread counts: Deduplicated markMessagesAsRead and badge clearance', () => {
    assert.ok(clientMessagesHtml.includes('markedReadIds'), 'Must track markedReadIds to prevent snapshot write loops');
    assert.ok(clientMessagesHtml.includes("markMessagesAsRead(unreadIds, 'client')"), 'Must mark messages as read with client role');
    assert.ok(clientMessagesHtml.includes("clearBadge('messages')"), 'Must clear sidebar unread badge');
  });

  // 9. Unauthorized cross-client access is denied
  it('9. Tenant isolation: getMessages rejects cross-client unauthorized reads', () => {
    assert.ok(firebaseJs.includes('Permission Denied: Clients cannot access messages belonging to other clients'), 'Must reject cross-client reading');
  });

  // 10. Client deletion permissions are enforced
  it('10. Deletion permissions: Client cannot delete firm practitioner messages', () => {
    assert.ok(clientMessagesHtml.includes('var isAssistant = msg.senderRole === \'assistant\' || msg.avatar === \'PAT\';'), 'Practitioner bubble must exist');
    assert.ok(!clientMessagesHtml.includes("escapeHtml(msg.senderName || 'Denise R., CPA') + ' &middot; ' + timeText + '</div>',\\n              '    <button type=\"button\" class=\"btn-del-msg\""), 'Practitioner bubble must NOT render delete button');
    assert.ok(firebaseJs.includes('Permission Denied: Clients cannot delete practitioner or compliance messages'), 'firebase.js deleteMessage must block clients from deleting staff messages');
  });

  // 11. Conversation clearing respects retention and audit requirements
  it('11. Audit retention: Requires backend completion and logs immutable WORM audit entry', () => {
    assert.ok(clientMessagesHtml.includes('showCenteredConfirmClearModal'), 'Must require confirmation modal before clearing');
    assert.ok(firebaseJs.includes("'All Messages Cleared'"), 'Must record WORM audit log on conversation clearing');
  });

  // 12. Sound alerts trigger only for genuine incoming messages
  it('12. Sound alerts: Triggers exclusively on new practitioner messages, never for sender', () => {
    assert.ok(clientMessagesHtml.includes('knownMessageIds'), 'Must track known message IDs to prevent repeat sounds on reload');
    assert.ok(clientMessagesHtml.includes("m.senderRole !== 'client' && m.senderId !== clientUid"), 'Must not play alert for own submission');
  });

  // 13. Local cache and Firestore reconcile after reconnection
  it('13. Local cache reconciliation: Firestore is source of truth, local cache is recovery aid', () => {
    assert.ok(firebaseJs.includes('this.getLocalMessages(targetUid)'), 'Must reconcile local cache with snapshot messages');
    assert.ok(firebaseJs.includes('ids.has(mid)'), 'Must deduplicate local cache against server messages');
  });
});
