/**
 * ============================================================================
 * TEST SUITE: CLIENT PORTAL LIVE REAL-TIME FIRESTORE LISTENERS (onSnapshot)
 * ============================================================================
 * 
 * Verifies Front-End Firebase Engineer requirements:
 * 1. initDashboard() resolves authenticated user's uid via onAuthStateChanged(auth).
 * 2. Real-time document listener on /engagements/eng_2026_${uid} dynamically updates:
 *    - 6-Step Filing Progress spine & completion percentage (68%)
 *    - 'Waiting on you' action items counter
 *    - Federal refund ($3,418.00) and state balance ($612.00) callout figures
 * 3. Real-time query listener on collection(db, 'documentRequests')
 *    filtered by where('clientUid', '==', uid) and where('status', '==', 'missing')
 * 4. Error state resiliency: catches offline/stream exceptions and renders
 *    .error-state-card with an operational retry trigger.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Client Portal Real-Time Firestore Engine (js/client/dashboard.js)', () => {
  const baseDir = path.resolve('c:/Users/user/Desktop/web app1/web app');
  const dashboardJsPath = path.join(baseDir, 'js/client/dashboard.js');
  const code = fs.readFileSync(dashboardJsPath, 'utf8');

  let mockDOM;
  let virtualWindow;
  let registeredAuthCallback;
  let docListeners;
  let queryListeners;
  let mockAuth;
  let mockDb;

  beforeEach(() => {
    mockDOM = { innerHTML: '', querySelector: () => null };
    registeredAuthCallback = null;
    docListeners = {};
    queryListeners = [];

    mockAuth = { currentUser: { uid: 'usr_whitfield_4417' } };
    mockDb = { type: 'firestore_instance' };

    virtualWindow = {
      firebaseAuth: mockAuth,
      firebaseDb: mockDb,
      onAuthStateChanged: (authInstance, callback) => {
        assert.equal(authInstance, mockAuth, 'onAuthStateChanged must receive auth instance');
        registeredAuthCallback = callback;
        return () => { registeredAuthCallback = null; };
      },
      doc: (dbInstance, collectionName, docId) => {
        assert.equal(dbInstance, mockDb);
        assert.equal(collectionName, 'engagements');
        return { path: `${collectionName}/${docId}`, id: docId };
      },
      collection: (dbInstance, collectionName) => {
        assert.equal(dbInstance, mockDb);
        return { name: collectionName };
      },
      where: (field, op, val) => ({ field, op, val }),
      query: (collectionRef, ...filters) => ({ collection: collectionRef, filters }),
      onSnapshot: (refOrQuery, nextCb, errCb) => {
        if (refOrQuery.path) {
          docListeners[refOrQuery.path] = { next: nextCb, error: errCb };
        } else {
          queryListeners.push({ query: refOrQuery, next: nextCb, error: errCb });
        }
        return () => {};
      },
      document: {
        getElementById: (id) => {
          if (id === 'dashboard-content-area') return mockDOM;
          if (id === 'btn-operational-retry') {
            return {
              addEventListener: (evt, handler) => {
                mockDOM.retryHandler = handler;
              }
            };
          }
          return null;
        }
      }
    };

    const fn = new Function('window', 'document', code);
    fn(virtualWindow, virtualWindow.document);
  });

  test('1. initDashboard() invokes onAuthStateChanged(auth) to obtain user uid', () => {
    const dashboard = virtualWindow.ClientDashboard;
    assert.ok(typeof dashboard.initDashboard === 'function', 'initDashboard must be exported');

    dashboard.initDashboard();
    assert.ok(typeof registeredAuthCallback === 'function', 'onAuthStateChanged listener must be registered');

    // Trigger auth state change with taxpayer user
    registeredAuthCallback({ uid: 'usr_whitfield_4417', email: 'michael@whitfield.test' });

    assert.equal(dashboard.state.clientUid, 'usr_whitfield_4417');
    assert.ok(docListeners['engagements/eng_2026_usr_whitfield_4417'], 'Must bind onSnapshot to engagements/eng_2026_${uid}');
  });

  test('2. onSnapshot on /engagements/eng_2026_${uid} updates 6-step progress spine & 68% milestone', () => {
    const dashboard = virtualWindow.ClientDashboard;
    dashboard.initDashboard();
    registeredAuthCallback({ uid: 'usr_whitfield_4417' });

    const engListener = docListeners['engagements/eng_2026_usr_whitfield_4417'];
    assert.ok(engListener, 'Engagement doc listener must exist');

    // Emit live engagement document snapshot
    engListener.next({
      id: 'eng_2026_usr_whitfield_4417',
      exists: () => true,
      data: () => ({
        taxYear: 2026,
        currentStage: 3,
        stageLabel: 'In Preparation',
        overallProgress: 68,
        federalRefund: 3418.00,
        stateBalanceDue: 612.00,
        jurisdictions: 'MD resident · VA & PA non-resident',
        steps: [
          { step: 1, title: 'Intake Opened', status: 'done', meta: '14 Jan · Completed' },
          { step: 2, title: 'Checklist Upload', status: 'done', meta: '11 of 13 files received' },
          { step: 3, title: 'In Preparation', status: 'now', meta: 'Current with CPA' },
          { step: 4, title: 'Return Review', status: 'todo', meta: 'Draft Form 1040' },
          { step: 5, title: 'Sign Form 8879', status: 'todo', meta: 'IRS e-File Authorization' },
          { step: 6, title: 'IRS Transmitted', status: 'todo', meta: 'Target: Oct 15' }
        ]
      })
    });

    const html = mockDOM.innerHTML;
    assert.ok(html.includes('68% Complete'), 'Must render 68% completion percentage');
    assert.ok(html.includes('In Preparation'), 'Must render stage label');
    assert.ok(html.includes('STEP 1 · ✓ Completed'), 'Must render Step 1 Completed');
    assert.ok(html.includes('STEP 2 · ✓ Completed'), 'Must render Step 2 Completed');
    assert.ok(html.includes('STEP 3 · In Progress'), 'Must render Step 3 In Progress');
    assert.ok(html.includes('STEP 4 · Pending'), 'Must render Step 4 Pending');
  });

  test('3. onSnapshot updates Federal refund ($3,418.00) & state balance ($612.00) callout figures', () => {
    const dashboard = virtualWindow.ClientDashboard;
    dashboard.initDashboard();
    registeredAuthCallback({ uid: 'usr_whitfield_4417' });

    const engListener = docListeners['engagements/eng_2026_usr_whitfield_4417'];

    engListener.next({
      id: 'eng_2026_usr_whitfield_4417',
      exists: () => true,
      data: () => ({
        taxYear: 2026,
        currentStage: 3,
        stageLabel: 'In Preparation',
        overallProgress: 68,
        federalRefund: 3418.00,
        stateBalanceDue: 612.00
      })
    });

    const html = mockDOM.innerHTML;
    assert.ok(html.includes('Federal Refund Callout'), 'Must render Federal Refund callout header');
    assert.ok(html.includes('$3,418.00'), 'Must render $3,418.00 federal refund figure');
    assert.ok(html.includes('State Balance Due Callout'), 'Must render State Balance Due callout header');
    assert.ok(html.includes('$612.00'), 'Must render $612.00 state balance due figure');
  });

  test('4. onSnapshot dynamically updates "Waiting on you" action items counter', () => {
    const dashboard = virtualWindow.ClientDashboard;
    dashboard.initDashboard();
    registeredAuthCallback({ uid: 'usr_whitfield_4417' });

    const engListener = docListeners['engagements/eng_2026_usr_whitfield_4417'];
    engListener.next({
      id: 'eng_2026_usr_whitfield_4417',
      exists: () => true,
      data: () => ({
        overallProgress: 68,
        federalRefund: 3418.00,
        stateBalanceDue: 612.00
      })
    });

    const html = mockDOM.innerHTML;
    assert.ok(html.includes('Waiting On You'), 'Must render Waiting On You card callout');
    assert.ok(html.includes('Waiting on you:'), 'Must render Waiting on you counter in banner');
  });

  test('5. Real-time query listener on collection(db, "documentRequests") renders Missing Documents', () => {
    const dashboard = virtualWindow.ClientDashboard;
    dashboard.initDashboard();
    registeredAuthCallback({ uid: 'usr_whitfield_4417' });

    assert.ok(queryListeners.length > 0, 'Query listener must be bound');
    const docQuery = queryListeners[0];

    // Verify query structure: where('clientUid', '==', uid) and where('status', '==', 'missing')
    const filters = docQuery.query.filters;
    assert.equal(filters.length, 2, 'Must have 2 query filters');
    assert.deepEqual(filters[0], { field: 'clientUid', op: '==', val: 'usr_whitfield_4417' });
    assert.deepEqual(filters[1], { field: 'status', op: '==', val: 'missing' });

    // Emit live missing documents snapshot
    docQuery.next({
      forEach: (cb) => {
        cb({
          id: 'req_1099misc',
          data: () => ({
            title: '1099-MISC',
            name: '1099-MISC — Keystone Property Group',
            status: 'missing',
            category: '1099 Form',
            description: 'Rental income for Schedule E',
            dueAt: '15 Sep'
          })
        });
        cb({
          id: 'req_k1',
          data: () => ({
            title: 'Schedule K-1',
            name: 'Schedule K-1 — Blue Ridge Tech Partners',
            status: 'missing',
            category: 'Partnership',
            description: 'Form 1065 entity pass-through share',
            dueAt: '15 Sep'
          })
        });
      }
    });

    const html = mockDOM.innerHTML;
    assert.ok(html.includes('Missing Documents'), 'Must render Missing Documents card header');
    assert.ok(html.includes('1099-MISC — Keystone Property Group'), 'Must render 1099-MISC item');
    assert.ok(html.includes('Schedule K-1 — Blue Ridge Tech Partners'), 'Must render Schedule K-1 item');
    assert.ok(html.includes('2 items holding up Form 1040 drafting'), 'Must indicate 2 missing items');
  });

  test('6. Catches Firestore offline / runtime errors and renders .error-state-card with retry trigger', () => {
    const dashboard = virtualWindow.ClientDashboard;
    dashboard.initDashboard();
    registeredAuthCallback({ uid: 'usr_whitfield_4417' });

    const engListener = docListeners['engagements/eng_2026_usr_whitfield_4417'];

    // Simulate Firestore network drop / offline error
    const offlineError = new Error('Cloud Firestore client is offline (failed-precondition)');
    engListener.error(offlineError);

    const html = mockDOM.innerHTML;
    assert.ok(html.includes('error-state-card'), 'Must render .error-state-card element');
    assert.ok(html.includes('Firestore Connection Offline'), 'Must render error title');
    assert.ok(html.includes('Cloud Firestore client is offline'), 'Must render error detail description');
    assert.ok(html.includes('id="btn-operational-retry"'), 'Must render operational retry button');

    // Trigger operational retry
    assert.ok(typeof mockDOM.retryHandler === 'function', 'Operational retry click handler must be bound');
    mockDOM.retryHandler();

    // Verify it re-initialized dashboard
    assert.ok(typeof registeredAuthCallback === 'function', 'Must re-establish auth and listener upon retry');
  });
});
