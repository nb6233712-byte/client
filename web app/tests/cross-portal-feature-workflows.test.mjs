/**
 * ============================================================================
 * TEST SUITE: Cross-Portal Feature Workflows (Client Portal ↔ Firm Console)
 * ============================================================================
 * 
 * Verifies the 7 regulatory and operational workflows connecting the Client Portal
 * and Firm Operations Console across the shared Firebase backend:
 * 
 * 1. ENGAGEMENTS: Staff create/assign; clients see only their own engagement status;
 *    stable client UID and assigned staff reference.
 * 2. DOCUMENT REQUESTS: Staff request missing tax documents; clients see and submit;
 *    firm sees received document and updates request status.
 * 3. TAX RETURNS: Authorized staff prepare/update; clients view only their own engagement's return;
 *    clients cannot modify tax calculations or firm-controlled filing statuses.
 * 4. MESSAGES: Client communicates with firm team; staff see authorized messages;
 *    unread counts and chronological ordering maintained.
 * 5. SIGNATURES: Signature requests associated with engagement & taxpayer; backend identity
 *    verification (IRS Pub 1345 KBA) enforced; signature evidence & audit history preserved.
 * 6. INVOICES: Consistent invoice & payment status in both portals; authoritative provider
 *    settlement events authoritative; browser redirects/localStorage/query params rejected.
 * 7. AUDIT LOGS: Sensitive workflow changes recorded with actor UID, action, recordRef,
 *    timestamp, outcome; restricted access to authorized firm roles.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// ── In-Memory Datastore & Bridge Environment ────────────────────────────────

const tables = new Map();
function getTable(name) {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name);
}

function getCollectionDocs(name) {
  return Array.from(getTable(name).values());
}

function resetDatabase() {
  tables.clear();
  storageFiles.clear();
  listeners.length = 0;
  localStorageStore.clear();
}

const listeners = [];

function doc(db, collName, docId) {
  return { collName, docId };
}

function collection(db, collName) {
  return { collName };
}

async function getDoc(ref) {
  const tbl = getTable(ref.collName);
  const data = tbl.get(ref.docId);
  return {
    exists: () => Boolean(data),
    data: () => (data ? { ...data } : undefined),
    id: ref.docId
  };
}

async function setDoc(ref, data, opts = {}) {
  const tbl = getTable(ref.collName);
  const existing = tbl.get(ref.docId) || {};
  const merged = opts.merge ? { ...existing, ...data } : data;
  tbl.set(ref.docId, merged);
  notifyListeners(ref.collName);
  return { success: true };
}

async function updateDoc(ref, data) {
  const tbl = getTable(ref.collName);
  const existing = tbl.get(ref.docId) || {};
  const merged = { ...existing, ...data };
  tbl.set(ref.docId, merged);
  notifyListeners(ref.collName);
  return { success: true };
}

async function addDoc(collRef, data) {
  const id = data.id || `auto_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const tbl = getTable(collRef.collName);
  tbl.set(id, { ...data, id });
  notifyListeners(collRef.collName);
  return { id };
}

async function getDocs(queryOrColl) {
  const collName = queryOrColl.collName || (queryOrColl._coll && queryOrColl._coll.collName);
  const tbl = getTable(collName);
  let docs = Array.from(tbl.entries()).map(([id, d]) => ({ id, ...d }));

  if (queryOrColl._wheres) {
    for (const w of queryOrColl._wheres) {
      docs = docs.filter(d => {
        if (w.op === '==') return d[w.field] === w.val;
        return true;
      });
    }
  }

  return {
    empty: docs.length === 0,
    size: docs.length,
    forEach: (cb) => docs.forEach(d => cb({ id: d.id, data: () => ({ ...d }) }))
  };
}

function query(collRef, ...ops) {
  const q = { _coll: collRef, collName: collRef.collName, _wheres: [] };
  for (const op of ops) {
    if (op && op.type === 'where') q._wheres.push(op);
  }
  return q;
}

function where(field, op, val) {
  return { type: 'where', field, op, val };
}

function orderBy() { return { type: 'orderBy' }; }
function limit() { return { type: 'limit' }; }
function serverTimestamp() { return new Date().toISOString(); }

function onSnapshot(target, onNext, onError) {
  const listener = { target, onNext, onError };
  listeners.push(listener);
  getDocs(target).then(snap => onNext(snap)).catch(err => onError && onError(err));
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

function notifyListeners(collName) {
  for (const l of listeners) {
    const targetColl = l.target.collName || (l.target._coll && l.target._coll.collName);
    if (targetColl === collName) {
      getDocs(l.target).then(snap => l.onNext(snap)).catch(err => l.onError && l.onError(err));
    }
  }
}

// Storage Mock
const storageFiles = new Map();
function ref(storage, p) { return { path: p }; }
function uploadBytesResumable(storageRef, file, meta) {
  storageFiles.set(storageRef.path, { file, meta });
  return {
    on: (evt, onProgress, onError, onComplete) => {
      if (onProgress) onProgress({ bytesTransferred: 100, totalBytes: 100 });
      if (onComplete) queueMicrotask(onComplete);
    },
    snapshot: { ref: storageRef }
  };
}
async function getDownloadURL(storageRef) {
  return `https://firebasestorage.googleapis.com/v0/b/uk-client-d90d5.appspot.com/o/${encodeURIComponent(storageRef.path)}?alt=media`;
}

const localStorageStore = new Map();
const mockLocalStorage = {
  getItem: (k) => localStorageStore.get(k) || null,
  setItem: (k, v) => localStorageStore.set(k, String(v)),
  removeItem: (k) => localStorageStore.delete(k)
};

const mockWindow = {
  localStorage: mockLocalStorage,
  dispatchEvent: () => {},
  addEventListener: () => {},
  CustomEvent: class { constructor(type, detail) { this.type = type; this.detail = detail; } }
};

// Compile FirebaseBridge once
const firebaseJsPath = path.resolve('c:/Users/user/Desktop/web app1/web app/js/firebase.js');
let rawCode = fs.readFileSync(firebaseJsPath, 'utf8');

rawCode = rawCode.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];/g, '');
rawCode = rawCode.replace(/export\s+(const|let|var)\s+/g, '$1 ');
rawCode = rawCode.replace(/export\s+default\s+/g, 'const _default = ');
rawCode = rawCode.replace(/export\s+\{/g, 'const __exp = {');

const scope = {
  window: mockWindow,
  localStorage: mockLocalStorage,
  document: { querySelector: () => null, getElementById: () => null },
  console,
  initializeApp: () => ({}),
  getAnalytics: () => null,
  isAnalyticsSupported: async () => false,
  logEvent: () => {},
  initializeAuth: () => ({ currentUser: null }),
  indexedDBLocalPersistence: {},
  browserLocalPersistence: {},
  browserSessionPersistence: {},
  getAuth: () => ({ currentUser: null }),
  signInWithEmailAndPassword: async () => {},
  createUserWithEmailAndPassword: async () => {},
  signOut: async () => {},
  onAuthStateChanged: (auth, cb) => { cb(null); return () => {}; },
  updateProfile: async () => {},
  getFirestore: () => ({ _tables: tables }),
  initializeFirestore: () => ({ _tables: tables }),
  persistentLocalCache: () => ({}),
  persistentMultipleTabManager: () => ({}),
  collection,
  doc,
  setDoc,
  addDoc,
  getDocs,
  getDoc,
  serverTimestamp,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getStorage: () => ({ files: storageFiles }),
  ref,
  uploadBytesResumable,
  uploadBytes: async () => {},
  getDownloadURL,
  getApps: () => [],
  getApp: () => ({}),
  GoogleAuthProvider: class GoogleAuthProvider {},
  signInWithPopup: async () => ({ user: null }),
  browserPopupRedirectResolver: {},
  deleteDoc: async () => {},
  setLogLevel: () => {},
  FormspreeModule: {},
  setTimeout,
  clearTimeout,
  queueMicrotask,
  Promise
};

const bridgeRunner = new Function(...Object.keys(scope), `${rawCode}; return FirebaseBridge;`);
const bridge = bridgeRunner(...Object.values(scope));

// ── Test User Personas ───────────────────────────────────────────────────────

const PERSONA_STAFF_PREPARER = {
  uid: 'preparer_denise_cpa',
  email: 'denise@pivot-aide.tax',
  displayName: 'Denise R., CPA',
  role: 'firm_preparer',
  mfaVerified: true,
  claims: { role: 'firm_preparer', mfa: true }
};

const PERSONA_STAFF_ADMIN = {
  uid: 'staff_managing_partner',
  email: 'admin@pivot-aide.tax',
  displayName: 'Managing Partner, CPA',
  role: 'firm_admin',
  mfaVerified: true,
  claims: { role: 'firm_admin', mfa: true }
};

const PERSONA_CLIENT_A = {
  uid: 'usr_whitfield_4417',
  email: 'm.whitfield@example.com',
  displayName: 'Michael & Elena Whitfield',
  role: 'client',
  claims: { role: 'client' }
};

const PERSONA_CLIENT_B = {
  uid: 'usr_brennan_llc',
  email: 'c.brennan@brennan-holdings.example',
  displayName: 'Brennan Holdings LLC',
  role: 'client',
  claims: { role: 'client' }
};

// ── Test Suites ─────────────────────────────────────────────────────────────

describe('Cross-Portal Feature Workflows Specification', () => {

  beforeEach(() => {
    resetDatabase();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 1: ENGAGEMENTS
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. ENGAGEMENTS Workflow', () => {
    test('1.1 Firm staff create or assign engagements with stable client UID and staff reference', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      const res = await bridge.staffCreateOrAssignEngagement({
        clientUid: PERSONA_CLIENT_A.uid,
        clientName: PERSONA_CLIENT_A.displayName,
        taxYear: 2026,
        stage: 'in_preparation',
        stageNum: 3,
        assignedStaffId: PERSONA_STAFF_PREPARER.uid,
        assignedPreparer: PERSONA_STAFF_PREPARER.displayName,
        federalRefund: 4320,
        stateBalanceDue: 0
      });

      assert.equal(res.success, true);
      assert.equal(res.engagement.clientUid, PERSONA_CLIENT_A.uid);
      assert.equal(res.engagement.clientId, PERSONA_CLIENT_A.uid);
      assert.equal(res.engagement.assignedStaffId, PERSONA_STAFF_PREPARER.uid);
      assert.equal(res.engagement.assignedPreparer, PERSONA_STAFF_PREPARER.displayName);

      // Verify client notification
      const updates = getCollectionDocs('updates');
      const notice = updates.find(u => u.clientId === PERSONA_CLIENT_A.uid && u.type === 'engagement_assigned');
      assert.ok(notice, 'Engagement assignment notification must be emitted');

      // Verify audit log
      const auditLogs = getCollectionDocs('audit_logs');
      const log = auditLogs.find(l => l.eventType === 'ENGAGEMENT_CREATED');
      assert.ok(log, 'Audit log must record ENGAGEMENT_CREATED');
      assert.equal(log.actorUid, PERSONA_STAFF_PREPARER.uid);
      assert.equal(log.recordRef, res.engagementId);
      assert.equal(log.outcome, 'SUCCESS');
    });

    test('1.2 Client sees only their own engagement status; tenant isolation enforced', async () => {
      // Setup Client A engagement
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);
      await bridge.staffCreateOrAssignEngagement({
        clientUid: PERSONA_CLIENT_A.uid,
        clientName: PERSONA_CLIENT_A.displayName,
        taxYear: 2026,
        stage: 'in_preparation',
        assignedPreparer: 'Denise R., CPA'
      });

      // Client A queries own engagement
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      const clientAEng = await bridge.getEngagement(2026, PERSONA_CLIENT_A.uid);
      assert.equal(clientAEng.success, true);
      assert.equal(clientAEng.data.clientUid, PERSONA_CLIENT_A.uid);

      // Client B queries Client A engagement: strictly blocked
      bridge.setCurrentUser(PERSONA_CLIENT_B);
      await assert.rejects(
        async () => {
          await bridge.getEngagement(2026, PERSONA_CLIENT_A.uid);
        },
        /Permission Denied/
      );
    });

    test('1.3 Staff can re-assign engagement with authoritative audit log', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_ADMIN);

      await bridge.staffCreateOrAssignEngagement({
        clientUid: PERSONA_CLIENT_A.uid,
        taxYear: 2026,
        assignedPreparer: 'Initial Preparer',
        assignedStaffId: 'stf_init'
      });

      const assignRes = await bridge.staffAssignEngagement(`eng_2026_${PERSONA_CLIENT_A.uid}`, {
        assignedPreparer: 'Elena Rostova, CPA',
        assignedStaffId: 'stf_elena_cpa',
        ptin: 'P01849202'
      });

      assert.equal(assignRes.success, true);
      assert.equal(assignRes.assignedPreparer, 'Elena Rostova, CPA');
      assert.equal(assignRes.assignedStaffId, 'stf_elena_cpa');

      const auditLogs = getCollectionDocs('audit_logs');
      const assignLog = auditLogs.find(l => l.eventType === 'ENGAGEMENT_ASSIGNED');
      assert.ok(assignLog, 'Audit log must record ENGAGEMENT_ASSIGNED');
      assert.equal(assignLog.provenance, 'firm_staff');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 2: DOCUMENT REQUESTS
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. DOCUMENT REQUESTS Workflow', () => {
    test('2.1 Staff requests missing tax document → client submits → firm updates status', async () => {
      // 1. Staff requests missing document
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);
      const reqRes = await bridge.staffCreateDocumentRequest({
        requestId: 'dreq_2026_k1_estate',
        clientId: PERSONA_CLIENT_A.uid,
        taxYear: 2026,
        category: 'Pass-Through Entities',
        title: 'Schedule K-1 (Form 1065) Estate Investment',
        description: 'Complete federal Schedule K-1 including capital account reconciliation',
        dueAt: '30 Sep 2026'
      });
      assert.equal(reqRes.success, true);
      assert.equal(reqRes.requestId, 'dreq_2026_k1_estate');

      // 2. Client sees the request
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      const clientReqs = await bridge.getDocumentRequests(2026, PERSONA_CLIENT_A.uid);
      assert.equal(clientReqs.success, true);
      const targetReq = clientReqs.data.find(r => r.requestId === 'dreq_2026_k1_estate' || r.id === 'dreq_2026_k1_estate');
      assert.ok(targetReq, 'Client must see the requested checklist item');
      assert.equal(targetReq.status, 'pending');

      // 3. Client uploads and submits the required document
      const mockDoc = {
        name: 'schedule_k1_partnership.pdf',
        size: 1024 * 350,
        type: 'application/pdf'
      };
      const uploadRes = await bridge.uploadDocumentToStorage(mockDoc, {
        taxYear: 2026,
        requestId: 'dreq_2026_k1_estate'
      });
      assert.equal(uploadRes.success, true);
      assert.ok(uploadRes.documentId);

      // 4. Firm staff sees document and accepts it
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);
      const updateRes = await bridge.staffUpdateDocumentStatus(
        uploadRes.documentId,
        'accepted',
        'CPA verified: capital accounts and ordinary income match partner statement.',
        null
      );
      assert.equal(updateRes.success, true);
      assert.equal(updateRes.status, 'accepted');

      // Verify audit trail for document acceptance
      const auditLogs = getCollectionDocs('audit_logs');
      const acceptLog = auditLogs.find(l => l.recordRef === uploadRes.documentId && l.action.includes('Accepted'));
      assert.ok(acceptLog, 'Document acceptance must be recorded in audit log');
      assert.equal(acceptLog.provenance, 'firm_staff');
    });

    test('2.2 Staff rejects document: client receives rejection notification and reason', async () => {
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      const mockDoc = {
        name: 'blurry_statement.pdf',
        size: 1024 * 100,
        type: 'application/pdf'
      };
      const uploadRes = await bridge.uploadDocumentToStorage(mockDoc, {
        taxYear: 2026,
        requestId: 'dreq_2026_w2'
      });

      // Staff rejects the document due to illegibility
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);
      const rejectRes = await bridge.staffRejectDocument(
        uploadRes.documentId,
        'Document scan is blurry and Box 12 codes are illegible. Please submit high-resolution PDF.'
      );
      assert.equal(rejectRes.success, true);
      assert.equal(rejectRes.status, 'rejected');

      // Client sees rejection notification with reason
      const updates = getCollectionDocs('updates');
      const notice = updates.find(u => u.clientId === PERSONA_CLIENT_A.uid && (u.title.includes('Rejected') || u.type === 'document_rejected'));
      assert.ok(notice, 'Client must receive rejection notice');
      assert.match(notice.meta, /blurry and Box 12 codes are illegible/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 3: TAX RETURNS
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. TAX RETURNS Workflow', () => {
    test('3.1 Authorized firm staff prepare tax return; client views only own return', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      const prepRes = await bridge.staffPrepareTaxReturn('return_2026_usr_whitfield_4417', {
        clientUid: PERSONA_CLIENT_A.uid,
        taxYear: 2026,
        agi: 154200,
        federalRefund: 4320,
        stateBalanceDue: 180,
        totalIncome: '$162,000',
        totalTax: '$28,450',
        effectiveRate: '18.4%',
        filingStatus: 'Married Filing Jointly'
      });

      assert.equal(prepRes.success, true);
      assert.equal(prepRes.return.agi, 154200);
      assert.equal(prepRes.return.federalRefund, 4320);

      // Client A views own return
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      const clientARet = await bridge.getPreparedReturn(2026, PERSONA_CLIENT_A.uid);
      assert.equal(clientARet.success, true);
      assert.equal(clientARet.data.agi, 154200);

      // Client B cannot view Client A's return
      bridge.setCurrentUser(PERSONA_CLIENT_B);
      await assert.rejects(
        async () => {
          await bridge.getPreparedReturn(2026, PERSONA_CLIENT_A.uid);
        },
        /Permission Denied/
      );
    });

    test('3.2 Client CANNOT modify tax calculations or firm filing statuses (Circular 230 guard)', async () => {
      // Prepare return
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);
      await bridge.staffPrepareTaxReturn('return_2026_usr_whitfield_4417', {
        clientUid: PERSONA_CLIENT_A.uid,
        taxYear: 2026,
        agi: 154200,
        federalRefund: 4320
      });

      // Client attempts to tamper with federal refund or AGI
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      await assert.rejects(
        async () => {
          await bridge.saveReturnApproval('return_2026_usr_whitfield_4417', 'Client approval note', {
            federalRefund: 99999,
            agi: 1000,
            efileStatus: 'transmitted'
          });
        },
        /Permission Denied: Clients cannot alter tax calculations or firm-controlled filing status/
      );

      // Client can legitimately submit review approval
      const approvalRes = await bridge.saveReturnApproval('return_2026_usr_whitfield_4417', 'Approved as prepared', {
        clientApproved: true,
        clientAuthorized: true
      });
      assert.equal(approvalRes.success, true);
      assert.equal(approvalRes.clientApproved, true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 4: MESSAGES
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. MESSAGES Workflow', () => {
    test('4.1 Client communicates with authorized firm team; unread counts maintained', async () => {
      // Client sends message
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      const msgRes = await bridge.sendMessage('Can we review Schedule E depreciation before final submission?');
      assert.equal(msgRes.success, true);
      assert.equal(msgRes.data.readByFirm, false);
      assert.equal(msgRes.data.readByClient, true);

      // Check firm unread count
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);
      const unreadCount = await bridge.getUnreadMessagesCount(PERSONA_CLIENT_A.uid, 'firm');
      assert.ok(unreadCount >= 1, 'Firm must have unread messages');

      // Staff replies
      const replyRes = await bridge.sendReplyMessage(
        'Certainly Michael, I have scheduled 15 minutes this afternoon to walk through the asset schedules.',
        'preparer',
        { clientId: PERSONA_CLIENT_A.uid }
      );
      assert.equal(replyRes.success, true);
      assert.equal(replyRes.data.readByClient, false);
      assert.equal(replyRes.data.readByFirm, true);

      // Client marks messages as read
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      await bridge.markMessagesAsRead([replyRes.messageId], 'client');
      const clientUnread = await bridge.getUnreadMessagesCount(PERSONA_CLIENT_A.uid, 'client');
      assert.equal(clientUnread, 0);

      // Client B cannot see Client A's thread
      bridge.setCurrentUser(PERSONA_CLIENT_B);
      await assert.rejects(
        async () => {
          await bridge.getMessages(PERSONA_CLIENT_A.uid);
        },
        /Permission Denied/
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 5: SIGNATURES
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. SIGNATURES Workflow', () => {
    test('5.1 Associate signature request with engagement and enforce IRS Pub 1345 KBA', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      const sigRes = await bridge.staffRequestSignature({
        signatureId: 'sig_8879_whitfield_spec_2026',
        clientId: PERSONA_CLIENT_A.uid,
        taxYear: 2026,
        form: 'IRS Form 8879',
        primarySignerName: 'Michael Whitfield',
        dueAt: '15 Oct 2026'
      });

      assert.equal(sigRes.success, true);
      assert.equal(sigRes.signature.engagementId, `eng_2026_${PERSONA_CLIENT_A.uid}`);
      assert.equal(sigRes.signature.clientUid, PERSONA_CLIENT_A.uid);
      assert.equal(sigRes.signature.kbaRequired, true);

      // Verify signature status query
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      const sigStatus = await bridge.getSignatureStatus(`eng_2026_${PERSONA_CLIENT_A.uid}`, PERSONA_CLIENT_A.uid);
      assert.equal(sigStatus.success, true);
      assert.equal(sigStatus.kbaLocked, false);
      assert.equal(sigStatus.requiresWetSignature, false);

      // Client B cannot inspect Client A signature status
      bridge.setCurrentUser(PERSONA_CLIENT_B);
      await assert.rejects(
        async () => {
          await bridge.getSignatureStatus(`eng_2026_${PERSONA_CLIENT_A.uid}`, PERSONA_CLIENT_A.uid);
        },
        /Permission Denied/
      );
    });

    test('5.2 Three failed KBA attempts mandates wet ink signature (IRS Pub 1345)', async () => {
      const engId = `eng_2026_${PERSONA_CLIENT_A.uid}`;

      // Simulate 3 failed KBA attempts recorded in kba_records
      await setDoc(doc({}, 'kba_records', engId), {
        engagementId: engId,
        primary: {
          status: 'failed',
          kba_locked: true,
          attemptsCount: 3,
          lockoutReason: '3 consecutive knowledge-based authentication failures under IRS Pub 1345 § 5.2.2'
        }
      });

      bridge.setCurrentUser(PERSONA_CLIENT_A);
      const status = await bridge.getSignatureStatus(engId, PERSONA_CLIENT_A.uid);
      assert.equal(status.kbaLocked, true);
      assert.equal(status.requiresWetSignature, true);
      assert.equal(status.kbaStatus, 'locked_out');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 6: INVOICES
  // ──────────────────────────────────────────────────────────────────────────
  describe('6. INVOICES Workflow', () => {
    test('6.1 Firm issues invoice; displayed consistently in both portals; client isolated', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      const invRes = await bridge.staffIssueInvoice({
        invoiceId: 'inv_spec_2026_01',
        clientId: PERSONA_CLIENT_A.uid,
        clientName: PERSONA_CLIENT_A.displayName,
        total: 650.00,
        serviceName: 'Form 1040 Preparation & Schedule E Advisory',
        dueDate: '2026-10-01'
      });

      assert.equal(invRes.success, true);
      assert.equal(invRes.invoice.status, 'issued');
      assert.equal(invRes.invoice.amountDue, 650.00);

      // Client A sees the invoice
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      const clientInvs = await bridge.getInvoices(PERSONA_CLIENT_A.uid);
      assert.equal(clientInvs.success, true);
      const foundInv = clientInvs.data.find(i => (i.invoiceId || i.id) === 'inv_spec_2026_01');
      assert.ok(foundInv, 'Client A must see the issued invoice');
      assert.equal(foundInv.status, 'issued');

      // Client B cannot see Client A's invoice
      bridge.setCurrentUser(PERSONA_CLIENT_B);
      const clientBInvs = await bridge.getInvoices(PERSONA_CLIENT_A.uid); // Pass A's UID as unprivileged client
      const leaked = clientBInvs.data.find(i => (i.invoiceId || i.id) === 'inv_spec_2026_01');
      assert.equal(leaked, undefined, 'Client B must never see Client A invoice');
    });

    test('6.2 Payment security: rejects browser redirects and unverified client assertions', async () => {
      bridge.setCurrentUser(PERSONA_CLIENT_A);

      // Attempt 1: Browser redirect spoofing
      await assert.rejects(
        async () => {
          await bridge.verifyPaymentEvent({
            invoiceId: 'inv_spec_2026_01',
            browserRedirect: true,
            status: 'paid'
          });
        },
        /Security Violation/
      );

      // Attempt 2: LocalStorage assertion spoofing
      await assert.rejects(
        async () => {
          await bridge.verifyPaymentEvent({
            invoiceId: 'inv_spec_2026_01',
            localStorageProof: 'paid_true',
            status: 'paid'
          });
        },
        /Security Violation/
      );

      // Authoritative Webhook settlement: SUCCESS
      const webhookRes = await bridge.verifyPaymentEvent({
        invoiceId: 'inv_spec_2026_01',
        webhookSignature: 'sig_sec_wh_verified_948271',
        settlementRef: 'ch_stripe_settle_849201',
        provider: 'stripe_authoritative_webhook'
      });
      assert.equal(webhookRes.success, true);
      assert.equal(webhookRes.status, 'paid');
      assert.equal(webhookRes.settlementRef, 'ch_stripe_settle_849201');

      // Authoritative verification helper confirms settlement
      const checkRes = await bridge.verifyInvoicePaymentAuthoritative('inv_spec_2026_01');
      assert.equal(checkRes.success, true);
      assert.equal(checkRes.isPaid, true);
      assert.equal(checkRes.settlementRef, 'ch_stripe_settle_849201');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 7: AUDIT LOGS
  // ──────────────────────────────────────────────────────────────────────────
  describe('7. AUDIT LOGS Workflow', () => {
    test('7.1 Sensitive actions capture actor UID, action, record reference, timestamp, outcome', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      const logRes = await bridge.recordAuditLog(
        'Tax Return Published',
        'TY2026 Form 1040 published for client review',
        'Tax Returns',
        {
          isStaff: true,
          eventType: 'RETURN_PUBLISHED',
          recordRef: 'return_2026_usr_whitfield_4417',
          outcome: 'SUCCESS'
        }
      );

      assert.equal(logRes.success, true);
      assert.equal(logRes.log.actorUid, PERSONA_STAFF_PREPARER.uid);
      assert.equal(logRes.log.action, 'Tax Return Published');
      assert.equal(logRes.log.recordRef, 'return_2026_usr_whitfield_4417');
      assert.ok(logRes.log.timestamp);
      assert.equal(logRes.log.outcome, 'SUCCESS');
      assert.equal(logRes.log.securityTier, 'authoritative_ledger');
    });

    test('7.2 Restrict authoritative audit ledger access to authorized firm roles', async () => {
      // Staff access: allowed
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);
      const staffLogs = await bridge.getAuthoritativeAuditLogs({ category: 'Tax Returns' });
      assert.equal(staffLogs.success, true);
      assert.ok(Array.isArray(staffLogs.logs));

      // Client access: strictly forbidden
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      await assert.rejects(
        async () => {
          await bridge.getAuthoritativeAuditLogs();
        },
        /Permission Denied/
      );
    });
  });
});
