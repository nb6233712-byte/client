/**
 * ============================================================================
 * TEST SUITE: LIVE FIREBASE CLOUD STORAGE RESUMABLE UPLOADS & DASHBOARD SYNC
 * ============================================================================
 * 
 * Verifies Cloud Storage & Security Specialist requirements:
 * 1. Client-side validation: file size <= 25MB and MIME type / magic bytes.
 * 2. Upload to Cloud Storage path:
 *    clients/${auth.currentUser.uid}/documents/${requestId}_${Date.now()}.pdf
 *    using uploadBytesResumable with metadata header.
 * 3. Live upload progress percentage displayed inside the card (.card-upload-pct / .card-upload-bar).
 * 4. Completion workflow:
 *    - Retrieves download URL from storage reference.
 *    - Updates Firestore (/documentRequests/${requestId}) changing status from 'missing' to 'in_review'
 *      and recording uploadedAt: serverTimestamp().
 * 5. Dashboard reactive verification:
 *    - client/dashboard.html snapshot listener immediately updates checklist count when item status
 *      transitions to 'in_review'.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Live Firebase Cloud Storage Upload & Reactive Dashboard Sync', () => {
  const baseDir = path.resolve('c:/Users/user/Desktop/web app1/web app');
  const docsJsPath = path.join(baseDir, 'js/client/documents.js');
  const dashboardJsPath = path.join(baseDir, 'js/client/dashboard.js');
  const docsJsCode = fs.readFileSync(docsJsPath, 'utf8');
  const dashboardJsCode = fs.readFileSync(dashboardJsPath, 'utf8');

  // ── 1. Client-Side Validation (MIME & 25MB statutory ceiling) ───
  describe('1. Client-Side Validation Engine', () => {
    let virtualWindow;
    let clientDocs;

    beforeEach(() => {
      virtualWindow = {
        FileRoomData: { documents: [] },
        document: {
          getElementById: () => null,
          querySelectorAll: () => []
        }
      };
      const fn = new Function('window', 'document', docsJsCode);
      fn(virtualWindow, virtualWindow.document);
      clientDocs = virtualWindow.ClientDocuments;
    });

    test('Validates authentic PDF file (<= 25MB) with %PDF magic header', async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37]);
      const file = {
        name: 'Form_1099_MISC.pdf',
        size: 2.4 * 1024 * 1024,
        type: 'application/pdf',
        bytes: pdfBytes
      };

      const result = await clientDocs.validateFileWithMagicBytes(file);
      assert.equal(result.valid, true);
      assert.equal(result.detectedType, 'PDF');
      assert.equal(result.magicBytesVerified, true);
    });

    test('Validates authentic PNG image (<= 25MB) with PNG magic header', async () => {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      const file = {
        name: 'receipt_scan.png',
        size: 1.1 * 1024 * 1024,
        type: 'image/png',
        bytes: pngBytes
      };

      const result = await clientDocs.validateFileWithMagicBytes(file);
      assert.equal(result.valid, true);
      assert.equal(result.detectedType, 'PNG');
      assert.equal(result.magicBytesVerified, true);
    });

    test('Validates authentic JPEG image (<= 25MB) with SOI magic header', async () => {
      const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
      const file = {
        name: 'closing_disclosure.jpg',
        size: 3.5 * 1024 * 1024,
        type: 'image/jpeg',
        bytes: jpegBytes
      };

      const result = await clientDocs.validateFileWithMagicBytes(file);
      assert.equal(result.valid, true);
      assert.equal(result.detectedType, 'JPEG');
      assert.equal(result.magicBytesVerified, true);
    });

    test('REJECTS file exceeding 25MB statutory ceiling limit', async () => {
      const file = {
        name: 'oversized_scan.pdf',
        size: 26 * 1024 * 1024, // 26 MB
        type: 'application/pdf'
      };

      const result = await clientDocs.validateFileWithMagicBytes(file);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('exceeds 25 MB statutory ceiling'));
    });

    test('REJECTS executable script or disguised binary extensions', async () => {
      const file = {
        name: 'trojan_payload.exe',
        size: 1024,
        type: 'application/x-msdownload'
      };

      const result = await clientDocs.validateFileWithMagicBytes(file);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('strictly prohibited under FTC Safeguards'));
    });
  });

  // ── 2. Cloud Storage Resumable Upload & Card Progress Engine ───
  describe('2. uploadBytesResumable & Live Card Progress', () => {
    let virtualWindow;
    let clientDocs;
    let capturedUploadCalls = [];
    let capturedFirestoreUpdates = [];
    let progressUpdates = [];

    beforeEach(() => {
      capturedUploadCalls = [];
      capturedFirestoreUpdates = [];
      progressUpdates = [];

      const mockCardProgress = {
        style: { display: 'none' },
        querySelector: (selector) => {
          if (selector === '.card-upload-pct') {
            return {
              set textContent(val) {
                progressUpdates.push({ type: 'pct', val });
              }
            };
          }
          if (selector === '.card-upload-bar') {
            return {
              style: {
                set width(val) {
                  progressUpdates.push({ type: 'bar', val });
                }
              }
            };
          }
          return null;
        }
      };

      const mockDOM = {
        'drop-zone': { addEventListener: () => {}, classList: { add: () => {}, remove: () => {} } },
        'file-input-hidden': { addEventListener: () => {} },
        'btn-choose-files': { addEventListener: () => {} },
        'btn-use-camera': { addEventListener: () => {} },
        'card-progress-req_1099misc': mockCardProgress,
        'docs-list-container': { innerHTML: '' },
        'docs-status-banner': { style: {}, innerHTML: '' }
      };

      virtualWindow = {
        firebaseAuth: {
          currentUser: { uid: 'usr_whitfield_4417', email: 'michael@whitfield.test' }
        },
        firebaseStorage: { type: 'cloud_storage_bucket' },
        firebaseDb: { type: 'cloud_firestore_db' },
        ref: (storageInstance, storagePath) => {
          return { bucket: 'piovde-tax.firebasestorage.app', path: storagePath };
        },
        uploadBytesResumable: (storageRef, file, metadataHeader) => {
          const callRecord = {
            storageRef,
            file,
            metadataHeader,
            listeners: {}
          };
          capturedUploadCalls.push(callRecord);

          return {
            snapshot: {
              ref: storageRef,
              bytesTransferred: file.size,
              totalBytes: file.size
            },
            on: (eventName, progressCb, errorCb, completeCb) => {
              callRecord.listeners.progress = progressCb;
              callRecord.listeners.error = errorCb;
              callRecord.listeners.complete = completeCb;

              // Emit incremental live progress
              progressCb({ bytesTransferred: Math.round(file.size * 0.35), totalBytes: file.size });
              progressCb({ bytesTransferred: Math.round(file.size * 0.75), totalBytes: file.size });
              progressCb({ bytesTransferred: file.size, totalBytes: file.size });

              // Complete upload
              completeCb();
            }
          };
        },
        getDownloadURL: async (refObj) => {
          return `https://firebasestorage.googleapis.com/v0/b/piovde-tax.firebasestorage.app/o/${encodeURIComponent(refObj.path)}?alt=media&token=sec_token_9918`;
        },
        doc: (dbInstance, collectionName, docId) => {
          return { path: `${collectionName}/${docId}`, collection: collectionName, id: docId };
        },
        updateDoc: async (docRef, payload) => {
          capturedFirestoreUpdates.push({ docRef, payload });
          return { success: true };
        },
        serverTimestamp: () => 'SERVER_TIMESTAMP_SENTINEL',
        document: {
          getElementById: (id) => mockDOM[id] || null,
          querySelectorAll: () => []
        }
      };

      const fn = new Function('window', 'document', docsJsCode);
      fn(virtualWindow, virtualWindow.document);
      clientDocs = virtualWindow.ClientDocuments;
      clientDocs.state.clientUid = 'usr_whitfield_4417';
      clientDocs.state.documents = [
        {
          requestId: 'req_1099misc',
          title: '1099-MISC',
          status: 'missing',
          category: '1099'
        }
      ];
    });

    test('Uploads to Cloud Storage path clients/${uid}/documents/${requestId}_${Date.now()}.pdf', async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37]);
      const file = {
        name: 'Form_1099_MISC.pdf',
        size: 1024 * 512,
        type: 'application/pdf',
        bytes: pdfBytes
      };

      const result = await clientDocs.uploadFile(file, 'req_1099misc');

      assert.equal(capturedUploadCalls.length, 1, 'uploadBytesResumable must be invoked exactly once');
      const uploadRecord = capturedUploadCalls[0];

      // Verify Cloud Storage destination path pattern
      const expectedPrefix = 'clients/usr_whitfield_4417/documents/req_1099misc_';
      assert.ok(uploadRecord.storageRef.path.startsWith(expectedPrefix), `Path must start with ${expectedPrefix}`);
      assert.ok(uploadRecord.storageRef.path.endsWith('.pdf'), 'Path must end with .pdf');

      // Verify metadata header
      assert.equal(uploadRecord.metadataHeader.contentType, 'application/pdf');
      assert.equal(uploadRecord.metadataHeader.customMetadata.clientUid, 'usr_whitfield_4417');
      assert.equal(uploadRecord.metadataHeader.customMetadata.requestId, 'req_1099misc');

      // Verify live upload progress percentage updates inside the card
      assert.ok(progressUpdates.some(u => u.type === 'pct' && u.val === '35%'), 'Must emit 35% progress');
      assert.ok(progressUpdates.some(u => u.type === 'pct' && u.val === '75%'), 'Must emit 75% progress');
      assert.ok(progressUpdates.some(u => u.type === 'pct' && u.val === '100%'), 'Must emit 100% progress');
    });

    test('Updates Firestore /documentRequests/${requestId} with status: "in_review" and serverTimestamp()', async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37]);
      const file = {
        name: 'Form_1099_MISC.pdf',
        size: 1024 * 512,
        type: 'application/pdf',
        bytes: pdfBytes
      };

      const result = await clientDocs.uploadFile(file, 'req_1099misc');

      assert.equal(result.success, true);
      assert.equal(result.status, 'in_review');
      assert.ok(result.downloadUrl.includes('firebasestorage.googleapis.com'));

      assert.equal(capturedFirestoreUpdates.length, 1, 'updateDoc must be invoked on Firestore');
      const fsUpdate = capturedFirestoreUpdates[0];

      assert.equal(fsUpdate.docRef.path, 'documentRequests/req_1099misc');
      assert.equal(fsUpdate.payload.status, 'in_review', 'Status must transition to "in_review"');
      assert.equal(fsUpdate.payload.uploadedAt, 'SERVER_TIMESTAMP_SENTINEL', 'Must record uploadedAt: serverTimestamp()');
      assert.ok(fsUpdate.payload.downloadUrl.includes('firebasestorage.googleapis.com'), 'Must record valid downloadUrl');
      assert.ok(fsUpdate.payload.storagePath.startsWith('clients/usr_whitfield_4417/documents/req_1099misc_'), 'Must record storagePath');
    });
  });

  // ── 3. Reactive Verification with client/dashboard.html ─────────
  describe('3. Reactive Dashboard Snapshot Synchronization', () => {
    let virtualDashboardWindow;
    let clientDashboard;
    let dashboardDOM;
    let registeredAuthCallback;
    let queryListeners;
    let docListeners;

    beforeEach(() => {
      dashboardDOM = { innerHTML: '', querySelector: () => null };
      queryListeners = [];
      docListeners = {};

      virtualDashboardWindow = {
        firebaseAuth: { currentUser: { uid: 'usr_whitfield_4417' } },
        firebaseDb: { type: 'cloud_firestore_db' },
        onAuthStateChanged: (auth, cb) => {
          registeredAuthCallback = cb;
          return () => {};
        },
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
        document: {
          getElementById: (id) => (id === 'dashboard-content-area' ? dashboardDOM : null)
        }
      };

      const fn = new Function('window', 'document', dashboardJsCode);
      fn(virtualDashboardWindow, virtualDashboardWindow.document);
      clientDashboard = virtualDashboardWindow.ClientDashboard;
    });

    test('Dashboard immediately decrements missing count and updates view via onSnapshot', () => {
      clientDashboard.initDashboard();
      registeredAuthCallback({ uid: 'usr_whitfield_4417' });

      // Find the documentRequests query listener
      const docReqListener = queryListeners.find(l => l.query.collection && l.query.collection.name === 'documentRequests');
      assert.ok(docReqListener, 'Must bind query listener to collection "documentRequests"');

      // 1. Initial State: 2 missing documents (1099-MISC & Schedule K-1)
      let currentMissingDocs = [
        {
          id: 'req_1099misc',
          title: '1099-MISC',
          name: '1099-MISC — Keystone Property Group',
          status: 'missing',
          category: '1099 Form'
        },
        {
          id: 'req_k1',
          title: 'Schedule K-1',
          name: 'Schedule K-1 — Blue Ridge Tech Partners',
          status: 'missing',
          category: 'Partnership'
        }
      ];

      docReqListener.next({
        forEach: (cb) => {
          currentMissingDocs.forEach(d => cb({ id: d.id, data: () => ({ ...d }) }));
        }
      });

      let html = dashboardDOM.innerHTML;
      assert.ok(html.includes('Missing Documents'), 'Must display Missing Documents card');
      assert.ok(html.includes('2 items holding up Form 1040 drafting'), 'Count must show 2 items holding up drafting');
      assert.ok(html.includes('1099-MISC — Keystone Property Group'), 'Must display 1099-MISC item');
      assert.ok(html.includes('Schedule K-1 — Blue Ridge Tech Partners'), 'Must display Schedule K-1 item');

      // 2. Taxpayer uploads Form 1099-MISC:
      // Firestore status transitions from 'missing' to 'in_review'.
      // Firestore query where('status', '==', 'missing') now excludes req_1099misc!
      currentMissingDocs = [
        {
          id: 'req_k1',
          title: 'Schedule K-1',
          name: 'Schedule K-1 — Blue Ridge Tech Partners',
          status: 'missing',
          category: 'Partnership'
        }
      ];

      // Live Firestore onSnapshot fires with updated missing result:
      docReqListener.next({
        forEach: (cb) => {
          currentMissingDocs.forEach(d => cb({ id: d.id, data: () => ({ ...d }) }));
        }
      });

      html = dashboardDOM.innerHTML;
      assert.ok(html.includes('1 item holding up Form 1040 drafting'), 'Checklist count must immediately drop to 1 item');
      assert.ok(!html.includes('1099-MISC — Keystone Property Group'), 'Uploaded 1099-MISC must no longer appear in missing list');
      assert.ok(html.includes('Schedule K-1 — Blue Ridge Tech Partners'), 'Schedule K-1 remains missing');

      // 3. Taxpayer uploads Schedule K-1:
      // Zero missing documents left.
      currentMissingDocs = [];

      docReqListener.next({
        forEach: (cb) => {}
      });

      html = dashboardDOM.innerHTML;
      assert.ok(html.includes('All Requested Documents Received'), 'Must immediately display "All Requested Documents Received"');
      assert.ok(html.includes('Complete ✓'), 'Must display "Complete ✓" badge');
    });
  });
});
