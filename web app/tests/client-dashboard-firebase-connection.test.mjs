import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAppRoot = path.resolve(__dirname, '..');

describe('Client Dashboard Filing Stage & Milestone Progress — Firebase Backend Connection', () => {
  const dashboardJsPath = path.join(webAppRoot, 'js/client/dashboard.js');
  const firebaseJsPath = path.join(webAppRoot, 'js/firebase.js');

  const dashboardJs = fs.readFileSync(dashboardJsPath, 'utf8');
  const firebaseJs = fs.readFileSync(firebaseJsPath, 'utf8');

  let mockDOM;
  let virtualWindow;
  let docListeners;
  let queryListeners;
  let savedEngagements;
  let savedDocRequests;

  beforeEach(() => {
    mockDOM = { innerHTML: '', querySelector: () => null };
    docListeners = {};
    queryListeners = [];
    savedEngagements = [];
    savedDocRequests = [];

    virtualWindow = {
      FirebaseBridge: {
        getUserUid: () => 'usr_whitfield_4417',
        getUserName: () => 'Michael Whitfield',
        getEngagementId: (uid, taxYear = 2026) => `eng_whitfield_${taxYear}`,
        getDefaultEngagement: (uid) => ({
          clientUid: uid,
          taxYear: 2026,
          filingStatus: 'Married filing jointly',
          jurisdictions: 'MD resident · VA and PA non-resident',
          stage: 'in_prep',
          stageLabel: 'In Preparation',
          overallProgress: 68,
          progressPct: 68,
          federalRefund: 0.00,
          federalRefundFormatted: '$0.00',
          stateBalanceDue: 0.00,
          stateBalanceDueFormatted: '$0.00',
          steps: [
            { step: 1, title: 'Engagement letter signed', meta: '14 January', status: 'done' },
            { step: 2, title: 'Documents received — 11 of 13', meta: 'Last upload 2 September', status: 'done' },
            { step: 3, title: 'Two documents still needed', meta: 'Rental 1099-MISC and the Q4 mileage log', status: 'now' },
            { step: 4, title: 'Return prepared and reviewed', meta: 'Estimated 9–11 September', status: 'todo' },
            { step: 5, title: 'You approve and sign Form 8879', meta: 'Takes about four minutes', status: 'todo' },
            { step: 6, title: 'Filed and accepted', meta: 'We watch for the acceptance and tell you', status: 'todo' }
          ],
          upcomingDeadlines: []
        }),
        saveEngagement: async (data) => {
          savedEngagements.push(data);
          return { success: true, id: data.id || 'eng_2026_usr_whitfield_4417', data };
        },
        setEngagementRefund: async (uid, fed, state) => {
          const payload = {
            federalRefund: Number(fed),
            federalRefundFormatted: '$' + Number(fed).toLocaleString('en-US', { minimumFractionDigits: 2 }),
            stateBalanceDue: Number(state),
            stateBalanceDueFormatted: '$' + Number(state).toLocaleString('en-US', { minimumFractionDigits: 2 })
          };
          savedEngagements.push(payload);
          return payload;
        },
        subscribeEngagement: (uid, cb) => {
          virtualWindow._engagementSubCallback = cb;
          return () => {};
        },
        getDefaultDocumentRequests: (uid) => [
          { requestId: 'req_1099misc', title: '1099-MISC — Keystone Property Group', status: 'missing', clientUid: uid },
          { requestId: 'req_k1', title: 'Schedule K-1 — Blue Ridge Tech Partners', status: 'missing', clientUid: uid }
        ],
        _firestoreSet: async (coll, docId, data) => {
          if (coll === 'engagements') savedEngagements.push({ id: docId, ...data });
          if (coll === 'documentRequests') savedDocRequests.push({ id: docId, ...data });
          return { success: true, id: docId };
        },
        getDefaultPreparedReturn: () => ({ status: 'in_preparation', clientApproved: false }),
        getDefaultMessages: () => [],
        getDefaultInvoices: () => [],
        getDefaultUpdates: () => []
      },
      firebaseAuth: { currentUser: { uid: 'usr_whitfield_4417' } },
      firebaseDb: { type: 'cloud_firestore_db' },
      doc: (db, coll, id) => ({ path: `${coll}/${id}`, id }),
      collection: (db, name) => ({ name }),
      where: (field, op, val) => ({ field, op, val }),
      query: (coll, ...filters) => ({ collection: coll, filters }),
      onSnapshot: (refOrQuery, nextCb, errCb) => {
        if (refOrQuery.path) {
          docListeners[refOrQuery.path] = { next: nextCb, error: errCb };
        } else {
          queryListeners.push({ query: refOrQuery, next: nextCb, error: errCb });
        }
        return () => {};
      },
      onAuthStateChanged: (auth, cb) => {
        cb({ uid: 'usr_whitfield_4417' });
        return () => {};
      },
      document: {
        getElementById: (id) => (id === 'dashboard-content-area' ? mockDOM : null),
        querySelector: () => null
      }
    };
  });

  test('1. ClientDashboard binds real-time Firestore listener to /engagements/eng_2026_${uid}', () => {
    const fn = new Function('window', 'document', dashboardJs);
    fn(virtualWindow, virtualWindow.document);
    virtualWindow.ClientDashboard.init();

    assert.ok(docListeners['engagements/eng_2026_usr_whitfield_4417'], 'Must bind onSnapshot to engagements/eng_2026_${uid}');
  });

  test('2. Live Firestore onSnapshot updates Federal Refund to $3,418.00 & State Balance Due to $612.00', () => {
    const fn = new Function('window', 'document', dashboardJs);
    fn(virtualWindow, virtualWindow.document);
    virtualWindow.ClientDashboard.init();

    const listener = docListeners['engagements/eng_2026_usr_whitfield_4417'];
    assert.ok(listener, 'Listener must be bound');

    // Simulate Firestore emitting live authoritative return amounts
    listener.next({
      id: 'eng_2026_usr_whitfield_4417',
      exists: () => true,
      data: () => ({
        overallProgress: 68,
        federalRefund: 3418.00,
        federalRefundFormatted: '$3,418.00',
        stateBalanceDue: 612.00,
        stateBalanceDueFormatted: '$612.00',
        currentStage: 3,
        stageLabel: 'In preparation'
      })
    });

    const html = mockDOM.innerHTML;
    assert.ok(html.includes('$3,418.00'), 'Must render $3,418.00 federal refund in callout card');
    assert.ok(html.includes('$612.00'), 'Must render $612.00 state balance due in callout card');
    assert.ok(html.includes('Federal Refund Callout'), 'Must render Federal Refund Callout header');
    assert.ok(html.includes('State Balance Due Callout'), 'Must render State Balance Due Callout header');
  });

  test('3. Live Firestore query on /documentRequests updates Waiting On You counter dynamically', () => {
    const fn = new Function('window', 'document', dashboardJs);
    fn(virtualWindow, virtualWindow.document);
    virtualWindow.ClientDashboard.init();

    const docReqListener = queryListeners.find(l => l.query && l.query.collection && l.query.collection.name === 'documentRequests');
    assert.ok(docReqListener, 'Must bind query listener to documentRequests');

    // Emit 2 missing documents from Firestore
    docReqListener.next({
      forEach: (cb) => {
        cb({
          id: 'req_1099misc',
          data: () => ({
            title: '1099-MISC',
            name: '1099-MISC — Keystone Property Group',
            status: 'missing'
          })
        });
        cb({
          id: 'req_k1',
          data: () => ({
            title: 'Schedule K-1',
            name: 'Schedule K-1 — Blue Ridge Tech Partners',
            status: 'missing'
          })
        });
      }
    });

    const html = mockDOM.innerHTML;
    assert.ok(html.includes('Waiting On You'), 'Must render Waiting On You card');
    assert.ok(html.includes('2 Action Items') || html.includes('2 Documents Needed'), 'Must render 2 action items');
    assert.ok(html.includes('Requires Taxpayer Action'), 'Must render Requires Taxpayer Action note');
  });

  test('4. Dual stream via subscribeEngagement receives updates from Firm Console writes', () => {
    const fn = new Function('window', 'document', dashboardJs);
    fn(virtualWindow, virtualWindow.document);
    virtualWindow.ClientDashboard.init();

    assert.ok(typeof virtualWindow._engagementSubCallback === 'function', 'Must register subscribeEngagement callback');

    // Simulate Firm Console updating stage and refund
    virtualWindow._engagementSubCallback({
      overallProgress: 85,
      stageLabel: 'Review Completed',
      federalRefund: 4250.00,
      federalRefundFormatted: '$4,250.00',
      stateBalanceDue: 500.00,
      stateBalanceDueFormatted: '$500.00'
    });

    const html = mockDOM.innerHTML;
    assert.ok(html.includes('85% Complete'), 'Must render updated 85% progress from Firm Console');
    assert.ok(html.includes('Review Completed'), 'Must render updated stage label from Firm Console');
    assert.ok(html.includes('$4,250.00'), 'Must render updated refund from Firm Console');
  });

  test('5. Non-existent Firestore document triggers auto-seeding of canonical engagement', () => {
    const fn = new Function('window', 'document', dashboardJs);
    fn(virtualWindow, virtualWindow.document);
    virtualWindow.ClientDashboard.init();

    const listener = docListeners['engagements/eng_2026_usr_whitfield_4417'];
    assert.ok(listener, 'Listener must be bound');
    // Emit non-existent document
    listener.next({
      id: 'eng_2026_usr_whitfield_4417',
      exists: () => false,
      data: () => null
    });

    assert.ok(savedEngagements.length > 0, 'Must auto-seed engagement into Firestore when not found');
    const seeded = savedEngagements[0];
    assert.equal(seeded.federalRefund, 3418.00);
    assert.equal(seeded.stateBalanceDue, 612.00);
    assert.equal(seeded.overallProgress, 68);
  });
});
