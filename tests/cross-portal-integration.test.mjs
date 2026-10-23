/**
 * ============================================================================
 * INTEGRATION TEST SUITE: CLIENT PORTAL & FIRM OPERATIONS CONSOLE INTERCONNECTION
 * ============================================================================
 * 
 * Verifies all 9 statutory and operational workflows connecting the Client Portal
 * and Firm Operations Console across the shared Firebase backend:
 * 
 * 1. Firm creates a document request → it appears in the correct client's portal.
 * 2. Client uploads a document → it appears in the authorised firm's review queue.
 * 3. Staff updates document status → the client sees the updated status.
 * 4. Staff publishes a prepared return → the correct client can view it.
 * 5. Staff requests a signature → both dashboards show the appropriate status.
 * 6. Client sends a message → authorised staff can reply in the same conversation.
 * 7. Firm creates an invoice → the correct client can view it.
 * 8. Verified payment events update the invoice status (rejecting redirects, query params, localStorage).
 * 9. Workflow events produce appropriate notifications and audit records.
 * 
 * Enforces:
 * - Stable record IDs across clients, engagements, tax years, documents, messages, returns, invoices, and events.
 * - Strict multi-tenant data isolation: Client B (Brennan Holdings LLC) CANNOT access Client A (Whitfield) records.
 * - Circular 230 § 10.22, IRS Pub 1345, FTC Safeguards 16 CFR § 314.4, and PCI-DSS SAQ A controls.
 * - Rejection of unverified client assertions, query parameters, or browser redirects as payment/signature proof.
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

// ── Integration Test Suites ──────────────────────────────────────────────────

describe('Cross-Portal Integration & End-to-End Workflows (Client Portal ↔ Firm Operations)', () => {

  beforeEach(() => {
    resetDatabase();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 1: Firm Creates Document Request → Appears in Correct Client Portal
  // ──────────────────────────────────────────────────────────────────────────
  describe('Workflow 1: Firm Creates Document Request', () => {
    test('1.1 Staff creates document request: appears in target client portal with notification & audit log', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      const reqData = {
        requestId: 'dreq_2026_closing_disc',
        clientId: PERSONA_CLIENT_A.uid,
        taxYear: 2026,
        category: 'Real Estate / Schedule E',
        title: 'Closing Disclosure — 214 Halcyon Row',
        description: 'HUD-1 / Closing Disclosure statement for property let in mid-May',
        dueAt: '15 Sep 2026'
      };

      const result = await bridge.staffCreateDocumentRequest(reqData);
      assert.equal(result.success, true);
      assert.equal(result.requestId, 'dreq_2026_closing_disc');

      // Switch to Client A: verify request appears in client portal stream
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      let clientReceived = null;
      const unsub = bridge.subscribeDocumentRequests((reqs) => {
        clientReceived = reqs;
      });

      await new Promise(r => queueMicrotask(r));
      unsub();

      assert.ok(Array.isArray(clientReceived));
      const found = clientReceived.find(r => r.requestId === 'dreq_2026_closing_disc');
      assert.ok(found, 'Client A must see the created document request');
      assert.equal(found.title, 'Closing Disclosure — 214 Halcyon Row');
      assert.equal(found.status, 'pending');

      // Verify client notification in updates collection
      const updates = getCollectionDocs('updates');
      const clientNotice = updates.find(u => u.clientId === PERSONA_CLIENT_A.uid && u.type === 'document_request');
      assert.ok(clientNotice, 'Updates collection must contain notification for client');
      assert.match(clientNotice.title, /Closing Disclosure/);

      // Verify authoritative audit log
      const auditLogs = getCollectionDocs('audit_logs');
      const log = auditLogs.find(l => l.eventType === 'DOCUMENT_REQUEST_CREATED');
      assert.ok(log, 'Audit log must record DOCUMENT_REQUEST_CREATED');
      assert.equal(log.provenance, 'firm_staff');
      assert.equal(log.securityTier, 'authoritative_ledger');
    });

    test('1.2 Cross-Tenant Isolation: Client B CANNOT see Client A document request', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);
      await bridge.staffCreateDocumentRequest({
        requestId: 'dreq_confidential_whitfield',
        clientId: PERSONA_CLIENT_A.uid,
        title: 'Confidential Whitfield Document'
      });

      // Switch to Client B (Brennan Holdings LLC)
      bridge.setCurrentUser(PERSONA_CLIENT_B);
      let clientBReqs = null;
      const unsub = bridge.subscribeDocumentRequests((reqs) => {
        clientBReqs = reqs;
      });

      await new Promise(r => queueMicrotask(r));
      unsub();

      const leaked = (clientBReqs || []).find(r => r.requestId === 'dreq_confidential_whitfield');
      assert.equal(leaked, undefined, 'Client B must NEVER receive Client A document requests');
    });

    test('1.3 Non-staff client CANNOT create document requests (RBAC guard)', async () => {
      bridge.setCurrentUser(PERSONA_CLIENT_A);

      await assert.rejects(
        async () => {
          await bridge.staffCreateDocumentRequest({
            clientId: PERSONA_CLIENT_B.uid,
            title: 'Malicious Request'
          });
        },
        /Permission Denied/
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 2: Client Uploads Document → Appears in Firm Review Queue
  // ──────────────────────────────────────────────────────────────────────────
  describe('Workflow 2: Client Uploads Document to Review Queue', () => {
    test('2.1 Client uploads valid PDF: stored in isolated vault and appears in firm review queue', async () => {
      bridge.setCurrentUser(PERSONA_CLIENT_A);

      const mockPdfFile = {
        name: 'closing_disclosure_final.pdf',
        size: 1024 * 512, // 512 KB (< 25MB)
        type: 'application/pdf'
      };

      const uploadRes = await bridge.uploadDocumentToStorage(mockPdfFile, {
        taxYear: 2026,
        requestId: 'dreq_2026_closing_disc'
      });

      assert.equal(uploadRes.success, true);
      assert.ok(uploadRes.documentId.startsWith('doc_'));
      assert.match(uploadRes.storagePath, new RegExp(`^clients/${PERSONA_CLIENT_A.uid}/tax-years/2026/documents/`));

      // Switch to Staff: verify firm operations dashboard telemetry
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);
      const firmData = await bridge.getFirmOperationsData();

      assert.ok(firmData.documentsQueue.length > 0);
      const inQueue = firmData.documentsQueue.find(d => d.docId === uploadRes.documentId);
      assert.ok(inQueue, 'Uploaded document must appear in firm documentsQueue');
      assert.equal(inQueue.clientUid, PERSONA_CLIENT_A.uid);
      assert.equal(inQueue.status, 'review');

      // Verify audit log custody entry
      const auditLogs = getCollectionDocs('audit_logs');
      const uploadLog = auditLogs.find(l => l.action.includes('Document Uploaded'));
      assert.ok(uploadLog, 'Storage upload must be recorded in audit ledger');
    });

    test('2.2 Client-side guard blocks files exceeding 25MB statutory limit', async () => {
      bridge.setCurrentUser(PERSONA_CLIENT_A);

      const oversizedFile = {
        name: 'huge_tax_scan.pdf',
        size: 30 * 1024 * 1024, // 30 MB (> 25MB limit)
        type: 'application/pdf'
      };

      const result = await bridge.uploadDocumentToStorage(oversizedFile);
      assert.equal(result.success, false);
      assert.equal(result.code, 'validation/file-too-large');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 3: Staff Updates Document Status → Client Sees Updated Status
  // ──────────────────────────────────────────────────────────────────────────
  describe('Workflow 3: Staff Updates Document Status (Circular 230 § 10.22)', () => {
    test('3.1 Staff accepts document: client receives approval notice & updated status', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      const reviewRes = await bridge.staffUpdateDocumentStatus(
        'doc_closing_214',
        'accepted',
        'Verified HUD-1 closing figures with title agency. All schedules clear.',
        { clientId: PERSONA_CLIENT_A.uid }
      );

      assert.equal(reviewRes.success, true);
      assert.equal(reviewRes.status, 'accepted');

      // Verify updates collection contains approval notice for client
      const updates = getCollectionDocs('updates');
      const docNotice = updates.find(u => u.clientId === PERSONA_CLIENT_A.uid && u.type === 'document_update');
      assert.ok(docNotice);
      assert.equal(docNotice.title, 'Document Approved');

      // Verify audit log
      const auditLogs = getCollectionDocs('audit_logs');
      const log = auditLogs.find(l => l.eventType === 'DOCUMENT_ACCEPTED');
      assert.ok(log);
      assert.equal(log.provenance, 'firm_staff');
    });

    test('3.2 Staff rejects document: client receives resubmission alert with rejection reason', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      const reviewRes = await bridge.staffRejectDocument(
        'doc_k1_blueridge',
        'Illegible scan: missing Page 3 Schedule K-1 Partner Capital Account analysis.',
        { clientId: PERSONA_CLIENT_A.uid }
      );

      assert.equal(reviewRes.success, true);
      assert.equal(reviewRes.status, 'rejected');

      const updates = getCollectionDocs('updates');
      const rejNotice = updates.find(u => u.clientId === PERSONA_CLIENT_A.uid && u.title.includes('Rejected'));
      assert.ok(rejNotice);
      assert.match(rejNotice.meta, /missing Page 3/);

      const auditLogs = getCollectionDocs('audit_logs');
      const log = auditLogs.find(l => l.eventType === 'DOCUMENT_REJECTED');
      assert.ok(log);
    });

    test('3.3 Unauthorized client CANNOT update document status (Circular 230 guard)', async () => {
      bridge.setCurrentUser(PERSONA_CLIENT_A);

      await assert.rejects(
        async () => {
          await bridge.staffUpdateDocumentStatus('doc_k1_blueridge', 'accepted', 'Self-approved');
        },
        /Circular 230/
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 4: Staff Publishes Prepared Return → Correct Client Can View It
  // ──────────────────────────────────────────────────────────────────────────
  describe('Workflow 4: Prepared Return Publication & Multi-Tenant Access', () => {
    test('4.1 Staff publishes Form 1040 return: Client A views it; Client B cannot', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      const pubRes = await bridge.staffPublishPreparedReturn('return_2026_usr_whitfield_4417', {
        clientId: PERSONA_CLIENT_A.uid,
        taxYear: 2026,
        formType: 'Form 1040 Individual Income Tax Return',
        federalRefund: 3418.00,
        stateBalanceDue: 612.00,
        summaryFigures: { agi: 214806, refund: 3418 }
      });

      assert.equal(pubRes.success, true);
      assert.equal(pubRes.return.published, true);

      // Verify client notification in updates
      const updates = getCollectionDocs('updates');
      const retNotice = updates.find(u => u.clientId === PERSONA_CLIENT_A.uid && u.type === 'return_published');
      assert.ok(retNotice, 'Client A must receive return published notification');

      // Verify audit log
      const auditLogs = getCollectionDocs('audit_logs');
      const retLog = auditLogs.find(l => l.eventType === 'RETURN_PUBLISHED');
      assert.ok(retLog);
      assert.equal(retLog.provenance, 'firm_staff');

      // Test Client A access
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      const clientAReturn = await bridge.getPreparedReturn(2026);
      assert.equal(clientAReturn.success, true);
      assert.equal(clientAReturn.data.clientId, PERSONA_CLIENT_A.uid);
      assert.equal(clientAReturn.data.federalRefund, 3418.00);

      // Test Client B access: must NOT see Client A's return
      bridge.setCurrentUser(PERSONA_CLIENT_B);
      const clientBReturn = await bridge.getPreparedReturn(2026);
      assert.equal(clientBReturn.success, false, 'Client B must not retrieve unpublished/cross-tenant return');
      assert.equal(clientBReturn.notFound, true);
    });

    test('4.2 Client cannot publish own tax return', async () => {
      bridge.setCurrentUser(PERSONA_CLIENT_A);

      await assert.rejects(
        async () => {
          await bridge.staffPublishPreparedReturn('return_2026_usr_whitfield_4417', {
            clientId: PERSONA_CLIENT_A.uid
          });
        },
        /Permission Denied/
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 5: Staff Requests Signature → Both Dashboards Show Status
  // ──────────────────────────────────────────────────────────────────────────
  describe('Workflow 5: Staff Requests Form 8879 Signature (IRS Pub 1345)', () => {
    test('5.1 Staff requests signature: records in signatures, updates engagement, alerts client', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      const sigRes = await bridge.staffRequestSignature({
        signatureId: 'sig_8879_whitfield_2026',
        clientId: PERSONA_CLIENT_A.uid,
        taxYear: 2026,
        form: 'IRS Form 8879',
        primarySignerName: 'Michael Whitfield',
        dueAt: '15 Oct 2026'
      });

      assert.equal(sigRes.success, true);
      assert.equal(sigRes.signature.status, 'pending');
      assert.equal(sigRes.signature.kbaRequired, true);

      // Check Firm Dashboard telemetry: signature request appears in kbaList
      const firmData = await bridge.getFirmOperationsData();
      const inKbaList = firmData.kbaList.find(k => k.id === 'sig_8879_whitfield_2026');
      assert.ok(inKbaList, 'Signature request must appear in firm kbaList');
      assert.equal(inKbaList.status, 'Pending Signature');

      // Verify client notification
      const updates = getCollectionDocs('updates');
      const sigNotice = updates.find(u => u.clientId === PERSONA_CLIENT_A.uid && u.type === 'signature_request');
      assert.ok(sigNotice);

      // Verify audit log
      const auditLogs = getCollectionDocs('audit_logs');
      const log = auditLogs.find(l => l.eventType === 'SIGNATURE_REQUESTED');
      assert.ok(log);
      assert.equal(log.provenance, 'firm_staff');
    });

    test('5.2 Non-staff client CANNOT request signatures', async () => {
      bridge.setCurrentUser(PERSONA_CLIENT_A);

      await assert.rejects(
        async () => {
          await bridge.staffRequestSignature({
            clientId: PERSONA_CLIENT_B.uid
          });
        },
        /Permission Denied/
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 6: Client Sends Message → Authorised Staff Replies in Thread
  // ──────────────────────────────────────────────────────────────────────────
  describe('Workflow 6: Client Messaging & Authorised Staff Reply', () => {
    test('6.1 Client sends message: appears in firm console; staff replies; Client B isolated', async () => {
      // 1. Client A sends message
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      const msgRes = await bridge.sendMessage('I uploaded the Closing Disclosure — did you receive all 12 pages?');
      assert.equal(msgRes.success, true);
      assert.equal(msgRes.data.readByFirm, false);
      assert.equal(msgRes.data.clientId, PERSONA_CLIENT_A.uid);

      // 2. Switch to Staff: firm sees message in clientMessages queue
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);
      const firmData = await bridge.getFirmOperationsData();
      const inMsgList = firmData.clientMessages.find(m => m.clientId === PERSONA_CLIENT_A.uid);
      assert.ok(inMsgList, 'Client A message must be visible to firm staff');
      assert.equal(inMsgList.unreadCount, 1);

      // 3. Staff replies in the same conversation
      const replyRes = await bridge.sendReplyMessage(
        'Yes, Michael! Received all 12 pages. Closing figures match Title Agency records.',
        'preparer',
        { clientId: PERSONA_CLIENT_A.uid }
      );
      assert.equal(replyRes.success, true);
      assert.equal(replyRes.data.readByClient, false);
      assert.equal(replyRes.data.readByFirm, true);

      // 4. Client A views conversation
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      const clientAMsgs = await bridge.getMessages(PERSONA_CLIENT_A.uid);
      assert.equal(clientAMsgs.success, true);
      const staffReply = clientAMsgs.data.find(m => m.senderRole === 'preparer');
      assert.ok(staffReply, 'Client A must see the staff reply');
      assert.match(staffReply.text, /Received all 12 pages/);

      // 5. Client B attempts to view messages: must NOT see Client A messages
      bridge.setCurrentUser(PERSONA_CLIENT_B);
      const clientBMsgs = await bridge.getMessages(PERSONA_CLIENT_B.uid);
      const leakedMsg = clientBMsgs.data.find(m => m.clientId === PERSONA_CLIENT_A.uid);
      assert.equal(leakedMsg, undefined, 'Client B must NEVER see Client A messages');

      // Verify audit logs & updates
      const updates = getCollectionDocs('updates');
      const msgNotice = updates.find(u => u.clientId === PERSONA_CLIENT_A.uid && u.type === 'new_message');
      assert.ok(msgNotice);

      const auditLogs = getCollectionDocs('audit_logs');
      const log = auditLogs.find(l => l.eventType === 'STAFF_MESSAGE_SENT');
      assert.ok(log);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 7: Firm Creates Invoice → Correct Client Can View It
  // ──────────────────────────────────────────────────────────────────────────
  describe('Workflow 7: Firm Issues Invoice & Multi-Tenant Billing Isolation', () => {
    test('7.1 Staff issues invoice: Client A views it; Client B isolated', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      const invRes = await bridge.staffIssueInvoice({
        invoiceId: 'inv_2026_0940_whitfield',
        clientId: PERSONA_CLIENT_A.uid,
        total: 1240.00,
        dueDate: '2026-09-30',
        items: [
          { desc: 'Form 1040 Individual Income Tax Preparation', amount: 890.00 },
          { desc: 'Schedule E Rental Property Real Estate Analysis', amount: 350.00 }
        ]
      });

      assert.equal(invRes.success, true);
      assert.equal(invRes.invoice.status, 'issued');
      assert.equal(invRes.invoice.total, 1240.00);

      // Verify notification in updates
      const updates = getCollectionDocs('updates');
      const invNotice = updates.find(u => u.clientId === PERSONA_CLIENT_A.uid && u.type === 'invoice_issued');
      assert.ok(invNotice);

      // Verify audit log
      const auditLogs = getCollectionDocs('audit_logs');
      const invLog = auditLogs.find(l => l.eventType === 'INVOICE_ISSUED');
      assert.ok(invLog);
      assert.equal(invLog.provenance, 'firm_staff');

      // Client A checks invoices
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      const clientAInvoices = await bridge.getInvoices(PERSONA_CLIENT_A.uid);
      assert.equal(clientAInvoices.success, true);
      const found = clientAInvoices.data.find(i => i.invoiceId === 'inv_2026_0940_whitfield');
      assert.ok(found, 'Client A must view issued invoice');
      assert.equal(found.total, 1240.00);

      // Client B checks invoices: must NOT see Client A's invoice
      bridge.setCurrentUser(PERSONA_CLIENT_B);
      const clientBInvoices = await bridge.getInvoices(PERSONA_CLIENT_B.uid);
      const leakedInv = clientBInvoices.data.find(i => i.invoiceId === 'inv_2026_0940_whitfield');
      assert.equal(leakedInv, undefined, 'Client B must NOT see Client A invoices');
    });

    test('7.2 Non-staff client CANNOT issue invoices', async () => {
      bridge.setCurrentUser(PERSONA_CLIENT_A);

      await assert.rejects(
        async () => {
          await bridge.staffIssueInvoice({
            clientId: PERSONA_CLIENT_A.uid,
            total: 50.00
          });
        },
        /Permission Denied/
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 8: Verified Payment Events Update Invoice Status
  // ──────────────────────────────────────────────────────────────────────────
  describe('Workflow 8: Verified Payment Events (PCI-DSS & Security Controls)', () => {
    test('8.1 REJECTS browser redirects, localStorage, and unverified client assertions', async () => {
      bridge.setCurrentUser(PERSONA_CLIENT_A);

      // Adversarial attempt 1: URL redirect spoofing (?payment_success=true)
      await assert.rejects(
        async () => {
          await bridge.verifyPaymentEvent({
            invoiceId: 'inv_2026_0940_whitfield',
            redirectProof: true,
            status: 'paid'
          });
        },
        /Security Violation: Browser redirects/
      );

      // Adversarial attempt 2: Local storage spoofing (localStorage.getItem('payment_done'))
      await assert.rejects(
        async () => {
          await bridge.verifyPaymentEvent({
            invoiceId: 'inv_2026_0940_whitfield',
            localStorageProof: true,
            status: 'paid'
          });
        },
        /Security Violation: Browser redirects/
      );

      // Adversarial attempt 3: Client asserting paid without webhook signature or settlement reference
      await assert.rejects(
        async () => {
          await bridge.verifyPaymentEvent({
            invoiceId: 'inv_2026_0940_whitfield',
            status: 'paid'
          });
        },
        /Security Violation: Browser redirects/
      );
    });

    test('8.2 Authoritative provider settlement reference successfully marks invoice as paid', async () => {
      // Setup issued invoice
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);
      await bridge.staffIssueInvoice({
        invoiceId: 'inv_settle_test_884',
        clientId: PERSONA_CLIENT_A.uid,
        total: 450.00
      });

      // Execute verified payment event with authoritative settlement reference
      const verifyRes = await bridge.verifyPaymentEvent({
        invoiceId: 'inv_settle_test_884',
        clientId: PERSONA_CLIENT_A.uid,
        settlementRef: 'ch_stripe_settle_994182',
        provider: 'stripe_pci_dss_verified',
        paidMethod: 'ACH Direct Debit (Settled)'
      });

      assert.equal(verifyRes.success, true);
      assert.equal(verifyRes.status, 'paid');
      assert.equal(verifyRes.settlementRef, 'ch_stripe_settle_994182');

      // Verify invoice in Firestore is now paid
      bridge.setCurrentUser(PERSONA_CLIENT_A);
      const invoices = await bridge.getInvoices(PERSONA_CLIENT_A.uid);
      const paidInv = invoices.data.find(i => i.invoiceId === 'inv_settle_test_884');
      assert.ok(paidInv);
      assert.equal(paidInv.status, 'paid');

      // Verify payment settled notification in updates
      const updates = getCollectionDocs('updates');
      const payNotice = updates.find(u => u.clientId === PERSONA_CLIENT_A.uid && u.type === 'payment_settled');
      assert.ok(payNotice);
      assert.match(payNotice.title, /Payment Confirmed/);

      // Verify audit log stamped with webhook_verified provenance
      const auditLogs = getCollectionDocs('audit_logs');
      const payLog = auditLogs.find(l => l.eventType === 'PAYMENT_SETTLED');
      assert.ok(payLog);
      assert.equal(payLog.provenance, 'webhook_verified');
    });

    test('8.3 Firm Admin can manually reconcile & settle invoice with authoritative admin provenance', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_ADMIN);

      await bridge.staffReconcileInvoice('inv_reconcile_412', {
        clientId: PERSONA_CLIENT_A.uid,
        ref: 'wire_settle_bank_of_america_294'
      });

      const auditLogs = getCollectionDocs('audit_logs');
      const recLog = auditLogs.find(l => l.eventType === 'INVOICE_RECONCILED');
      assert.ok(recLog);
      assert.equal(recLog.provenance, 'firm_staff');
    });

    test('8.4 Preparer CANNOT reconcile invoices (Admin-only privilege separation)', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      await assert.rejects(
        async () => {
          await bridge.staffReconcileInvoice('inv_reconcile_412', { ref: 'wire_123' });
        },
        /Only Firm Admin/
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WORKFLOW 9: Workflow Events Produce Notifications & Immutable Audit Records
  // ──────────────────────────────────────────────────────────────────────────
  describe('Workflow 9: Workflow Events, Notifications & Audit Resilience', () => {
    test('9.1 Workflow events produce scoped client notifications in updates collection', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      // Trigger several workflow events
      await bridge.staffCreateDocumentRequest({
        clientId: PERSONA_CLIENT_A.uid,
        title: 'Form 1099-DIV'
      });

      await bridge.staffFollowUpMissingDocument('dreq_1099div', PERSONA_CLIENT_A.uid, 'Form 1099-DIV Brokerage');

      await bridge.staffChaseSigner(PERSONA_CLIENT_A.uid, 'Michael Whitfield');

      const updates = getCollectionDocs('updates');
      const clientAUpdates = updates.filter(u => u.clientId === PERSONA_CLIENT_A.uid);
      assert.ok(clientAUpdates.length >= 3, 'Client A must have received distinct updates');

      // Verify all updates have scope: client and proper action links
      for (const u of clientAUpdates) {
        assert.equal(u.scope, 'client');
        assert.ok(u.actionScreen, 'Must provide target navigation screen');
      }
    });

    test('9.2 Client CANNOT spoof authoritative audit events (FTC Safeguards Rule § 314.4)', async () => {
      bridge.setCurrentUser(PERSONA_CLIENT_A);

      // Client attempts to emit 'Payment Confirmed' or 'Return Approved'
      await bridge.recordAuditLog('Payment Confirmed', 'Client asserts invoice paid', 'Billing', {
        eventType: 'PAYMENT_CONFIRMED'
      });

      const auditLogs = getCollectionDocs('audit_logs');
      const spoofed = auditLogs.find(l => l.details && l.details.includes('Client asserts invoice paid'));
      assert.ok(spoofed);
      assert.equal(spoofed.eventType, 'SIGNATURE_STARTED', 'Untrusted client event must be downgraded to telemetry');
      assert.equal(spoofed.securityTier, 'non_authoritative_telemetry');
      assert.equal(spoofed.provenance, 'client_reported');
      assert.equal(spoofed.clientReported, true);
    });

    test('9.3 Staff operations carry authoritative ledger status', async () => {
      bridge.setCurrentUser(PERSONA_STAFF_PREPARER);

      await bridge.recordAuditLog('Document Accepted by CPA', 'Verified closing disclosure', 'Documents', {
        isStaff: true,
        eventType: 'DOCUMENT_ACCEPTED',
        provenance: 'firm_staff'
      });

      const auditLogs = getCollectionDocs('audit_logs');
      const staffLog = auditLogs.find(l => l.eventType === 'DOCUMENT_ACCEPTED');
      assert.ok(staffLog);
      assert.equal(staffLog.securityTier, 'authoritative_ledger');
      assert.equal(staffLog.provenance, 'firm_staff');
      assert.equal(staffLog.clientReported, false);
    });
  });
});
