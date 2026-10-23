import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAppRoot = path.resolve(__dirname, '..');

describe('Client Dashboard Recent Messages — Firebase Backend Connection', () => {
  const dashboardJsPath = path.join(webAppRoot, 'js/client/dashboard.js');
  const dashboardJs = fs.readFileSync(dashboardJsPath, 'utf8');

  let mockDOM;
  let virtualWindow;
  let queryListeners;

  beforeEach(() => {
    mockDOM = { innerHTML: '', querySelector: () => null };
    queryListeners = [];

    virtualWindow = {
      FirebaseBridge: {
        getUserUid: () => 'usr_whitfield_4417',
        getUserName: () => 'Nandan B',
        getEngagementId: (uid, taxYear = 2026) => `eng_2026_${uid}`,
        getDefaultEngagement: (uid) => ({
          clientUid: uid,
          taxYear: 2026,
          filingStatus: 'Married filing jointly',
          stage: 'in_prep',
          stageLabel: 'In Preparation',
          overallProgress: 68
        }),
        getDefaultDocumentRequests: () => [],
        getDefaultPreparedReturn: () => null,
        getDefaultMessages: () => [
          {
            id: 'msg_001',
            messageId: 'msg_001',
            clientId: 'usr_whitfield_4417',
            text: 'Initial inquiry regarding Maryland non-resident filing.',
            senderRole: 'client',
            senderName: 'Nandan B',
            avatar: 'NA',
            createdAt: '2026-10-20T08:02:00.000Z',
            readByClient: true
          }
        ],
        getLocalMessages: () => [],
        getDefaultInvoices: () => [],
        getDefaultUpdates: () => []
      },
      firebaseAuth: { currentUser: { uid: 'usr_whitfield_4417', displayName: 'Nandan B' } },
      firebaseDb: { type: 'cloud_firestore_db' },
      doc: (db, coll, id) => ({ path: `${coll}/${id}`, id }),
      collection: (db, name) => ({ name }),
      where: (field, op, val) => ({ field, op, val }),
      query: (coll, ...filters) => ({ collection: coll, filters }),
      onSnapshot: (refOrQuery, nextCb, errCb) => {
        if (!refOrQuery.path) {
          queryListeners.push({ query: refOrQuery, next: nextCb, error: errCb });
        }
        return () => {};
      },
      onAuthStateChanged: (auth, cb) => {
        cb({ uid: 'usr_whitfield_4417' });
        return () => {};
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      document: {
        getElementById: (id) => (id === 'dashboard-content-area' ? mockDOM : null),
        querySelector: () => null
      }
    };
  });

  test('1. ClientDashboard binds real-time Firestore query listener to /messages collection', () => {
    const fn = new Function('window', 'document', dashboardJs);
    fn(virtualWindow, virtualWindow.document);
    virtualWindow.ClientDashboard.init();

    const msgQueryListener = queryListeners.find(l => l.query && l.query.collection && l.query.collection.name === 'messages');
    assert.ok(msgQueryListener, 'Must bind real-time query listener to messages collection in Firestore');
  });

  test('2. Live Firestore message updates render dynamically with sender label, avatar initials, and SYNCED badge', () => {
    const fn = new Function('window', 'document', dashboardJs);
    fn(virtualWindow, virtualWindow.document);
    virtualWindow.ClientDashboard.init();

    const msgQueryListener = queryListeners.find(l => l.query && l.query.collection && l.query.collection.name === 'messages');
    assert.ok(msgQueryListener, 'Listener must be bound');

    // Simulate Firestore emitting a message sent by the client
    msgQueryListener.next({
      forEach: (cb) => {
        cb({
          id: 'msg_hi_001',
          data: () => ({
            id: 'msg_hi_001',
            clientId: 'usr_whitfield_4417',
            text: 'hi',
            senderRole: 'client',
            senderName: 'Nandan B',
            avatar: 'NA',
            createdAt: new Date().toISOString(),
            readByClient: true
          })
        });
      }
    });

    const html = mockDOM.innerHTML;
    assert.ok(html.includes('Recent Messages'), 'Must render Recent Messages header');
    assert.ok(html.includes('"hi"'), 'Must render dynamic message text "hi"');
    assert.ok(html.includes('You'), 'Must render sender label You');
    assert.ok(html.includes('NA'), 'Must render initials NA');
    assert.ok(html.includes('SYNCED ✓'), 'Must render SYNCED ✓ status badge');
    assert.ok(html.includes('Reply in Secure Thread'), 'Must render Reply in Secure Thread CTA link');
  });

  test('3. Unread practitioner message dynamically displays Unread badge count', () => {
    const fn = new Function('window', 'document', dashboardJs);
    fn(virtualWindow, virtualWindow.document);
    virtualWindow.ClientDashboard.init();

    const msgQueryListener = queryListeners.find(l => l.query && l.query.collection && l.query.collection.name === 'messages');
    assert.ok(msgQueryListener, 'Listener must be bound');

    // Emit practitioner message that is unread by client
    msgQueryListener.next({
      forEach: (cb) => {
        cb({
          id: 'msg_cpa_002',
          data: () => ({
            id: 'msg_cpa_002',
            clientId: 'usr_whitfield_4417',
            text: 'We reviewed your W-2. The Maryland return is ready.',
            senderRole: 'preparer',
            senderName: 'Denise R., CPA',
            avatar: 'DR',
            createdAt: new Date().toISOString(),
            readByClient: false
          })
        });
      }
    });

    const html = mockDOM.innerHTML;
    assert.ok(html.includes('1 Unread'), 'Must render 1 Unread badge when practitioner message is unread');
    assert.ok(html.includes('Denise R., CPA'), 'Must render preparer sender label');
    assert.ok(html.includes('DR'), 'Must render preparer initials DR');
  });

  test('4. Empty messages array renders authoritative No Messages Yet empty state card', () => {
    const fn = new Function('window', 'document', dashboardJs);
    fn(virtualWindow, virtualWindow.document);
    virtualWindow.ClientDashboard.init();

    const msgQueryListener = queryListeners.find(l => l.query && l.query.collection && l.query.collection.name === 'messages');
    assert.ok(msgQueryListener, 'Listener must be bound');

    // Emit empty snapshot
    msgQueryListener.next({
      forEach: () => {}
    });

    // Directly test renderRecentMessagesCard with empty array
    const emptyCardHtml = virtualWindow.ClientDashboard.renderRecentMessagesCard([]);
    assert.ok(emptyCardHtml.includes('No Messages Yet'), 'Must render No Messages Yet title');
    assert.ok(emptyCardHtml.includes('0 unread'), 'Must show 0 unread chip');
    assert.ok(emptyCardHtml.includes('Start a Conversation'), 'Must provide Start a Conversation button');
  });
});
