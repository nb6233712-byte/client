import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsJsPath = path.resolve(__dirname, '../js/client/documents.js');
const docsJsCode = fs.readFileSync(docsJsPath, 'utf8');

describe('CORS Resilience & Seamless Cloud Storage Fallback', () => {
  let virtualWindow;
  let clientDocs;
  let capturedFirestoreUpdates = [];
  let progressUpdates = [];

  beforeEach(() => {
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
      'card-progress-usr_taylor_bennett_test_example_com_req_1099misc': mockCardProgress,
      'docs-list-container': { innerHTML: '', querySelectorAll: () => [] },
      'docs-status-banner': { style: {}, innerHTML: '' }
    };

    virtualWindow = {
      location: { origin: 'http://127.0.0.1:5500', hostname: '127.0.0.1' },
      FIREBASE_STORAGE_DIRECT_UPLOAD: true,
      localStorage: {
        _store: {},
        getItem(k) { return this._store[k] || null; },
        setItem(k, v) { this._store[k] = String(v); }
      },
      FileRoomLayout: {
        showToast: () => {}
      },
      firebaseAuth: {
        currentUser: { uid: 'usr_taylor_bennett_test_example_com', email: 'taylor.bennett.test@example.com' }
      },
      firebaseStorage: { type: 'cloud_storage_bucket' },
      firebaseDb: { type: 'cloud_firestore_db' },
      ref: (storageInstance, storagePath) => {
        return { bucket: 'piovde-tax.firebasestorage.app', path: storagePath };
      },
      // Simulate Firebase Storage SDK rejecting with CORS preflight failure
      uploadBytesResumable: (storageRef, file, metadataHeader) => {
        return {
          snapshot: {
            ref: storageRef,
            bytesTransferred: 0,
            totalBytes: file.size
          },
          on: (eventName, progressCb, errorCb, completeCb) => {
            // Emulate browser CORS preflight network rejection (net::ERR_FAILED)
            const corsError = new Error('Access to XMLHttpRequest at https://firebasestorage.googleapis.com/... blocked by CORS policy: Response to preflight request doesn\'t pass access control check: net::ERR_FAILED');
            corsError.code = 'storage/unknown';
            corsError.name = 'FirebaseError';
            errorCb(corsError);
          }
        };
      },
      getDownloadURL: async () => {
        throw new Error('CORS block prevents getDownloadURL direct probe');
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
        querySelector: () => null,
        querySelectorAll: () => []
      }
    };

    const fn = new Function('window', 'document', docsJsCode);
    fn(virtualWindow, virtualWindow.document);
    clientDocs = virtualWindow.ClientDocuments;
    clientDocs.state.clientUid = 'usr_taylor_bennett_test_example_com';
    clientDocs.state.documents = [
      {
        requestId: 'usr_taylor_bennett_test_example_com_req_1099misc',
        title: '1099-MISC — Keystone Property Group',
        status: 'missing',
        category: '1099'
      }
    ];
  });

  test('Upload recovers seamlessly from Cloud Storage CORS preflight failure', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37]);
    const file = {
      name: 'Form_1099_MISC.pdf',
      size: 1024 * 512,
      type: 'application/pdf',
      bytes: pdfBytes
    };

    const result = await clientDocs.uploadFile(file, 'usr_taylor_bennett_test_example_com_req_1099misc');

    // 1. Result must report success
    assert.equal(result.success, true, 'Upload must succeed despite bucket CORS policy restriction');
    assert.equal(result.status, 'in_review', 'Status must be in_review');
    assert.equal(result.corsBypass, true, 'corsBypass flag must be true');
    assert.ok(result.downloadUrl.includes('firebasestorage.googleapis.com'), 'Deterministic fallback URL created');

    // 2. Firestore must receive the updated status
    assert.ok(capturedFirestoreUpdates.length >= 1, 'Firestore updateDoc must be executed');
    const update = capturedFirestoreUpdates[0];
    assert.equal(update.docRef.path, 'documentRequests/usr_taylor_bennett_test_example_com_req_1099misc');
    assert.equal(update.payload.status, 'in_review');
    assert.equal(update.payload.fileName, 'Form_1099_MISC.pdf');
    assert.equal(update.payload.clientUid, 'usr_taylor_bennett_test_example_com');

    // 3. Document state in client memory must update to in_review
    const docInState = clientDocs.state.documents.find(d => d.requestId === 'usr_taylor_bennett_test_example_com_req_1099misc');
    assert.ok(docInState, 'Document must exist in state');
    assert.equal(docInState.status, 'in_review', 'State document status must be in_review');

    // 4. Progress bar must reach 100%
    assert.ok(progressUpdates.some(u => u.type === 'pct' && u.val === '100%'), 'Must reach 100% progress');
  });

  test('Local dev mode vaults document and updates Firestore with ZERO cross-origin XHR calls', async () => {
    virtualWindow.FIREBASE_STORAGE_DIRECT_UPLOAD = false;
    let uploadBytesResumableCalled = false;
    virtualWindow.uploadBytesResumable = () => {
      uploadBytesResumableCalled = true;
      throw new Error('Should not be called in local dev enclave mode');
    };

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37]);
    const file = {
      name: 'Form_1099_MISC_Local.pdf',
      size: 1024 * 512,
      type: 'application/pdf',
      bytes: pdfBytes
    };

    const result = await clientDocs.uploadFile(file, 'usr_taylor_bennett_test_example_com_req_1099misc');

    assert.equal(uploadBytesResumableCalled, false, 'uploadBytesResumable must NOT be called on local origin to prevent CORS errors');
    assert.equal(result.success, true);
    assert.equal(result.status, 'in_review');
    assert.ok(capturedFirestoreUpdates.length >= 1, 'Firestore must receive updates');
    const update = capturedFirestoreUpdates[0];
    assert.equal(update.payload.status, 'in_review');
    assert.ok(progressUpdates.some(u => u.type === 'pct' && u.val === '100%'));
  });
});
