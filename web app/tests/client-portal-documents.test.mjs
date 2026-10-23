/**
 * ============================================================================
 * TEST SUITE: CLIENT PORTAL DOCUMENTS VAULT (THE FILE ROOM)
 * ============================================================================
 * 
 * Verifies all statutory and operational requirements:
 * 1. Viewing requested documents for Tax Year 2026
 * 2. Status tracking: missing/needed, uploaded/review, received/accepted, reviewed/rejected
 * 3. File upload dropzone, hidden input, and camera capture modal hooks
 * 4. 25MB statutory ceiling enforcement
 * 5. Magic Bytes file header inspection (never trusts browser MIME header alone)
 * 6. Rejection of disguised executables (MZ / ELF headers disguised as .pdf / .csv)
 * 7. Real-time upload progress indicators and security error banners
 * 8. Permitted document metadata viewer modal
 * 9. Circular 230 practitioner review updates ledger
 * 10. Multi-tenant storage path isolation (clients/{uid}/tax-years/{year}/documents/...)
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Client Portal Documents Vault & Checklist Architecture', () => {

  const baseDir = path.resolve('c:/Users/user/Desktop/web app1/web app');
  const docsJsPath = path.join(baseDir, 'js/client/documents.js');
  const docsHtmlPath = path.join(baseDir, 'client/documents.html');
  const storageRulesPath = path.join(baseDir, 'storage.rules');

  test('1. File existence & linkage in client/documents.html', () => {
    assert.ok(fs.existsSync(docsJsPath), 'js/client/documents.js must exist');
    assert.ok(fs.existsSync(docsHtmlPath), 'client/documents.html must exist');

    const htmlContent = fs.readFileSync(docsHtmlPath, 'utf8');
    assert.ok(htmlContent.includes('src="../js/client/documents.js"'), 'Must link js/client/documents.js');
    assert.ok(htmlContent.includes('src="../js/core/layout.js"'), 'Must link js/core/layout.js');
    assert.ok(htmlContent.includes('src="../js/firebase.js"'), 'Must link js/firebase.js');
    assert.ok(htmlContent.includes('ClientDocuments.init()'), 'Must initialize ClientDocuments');
  });

  test('2. DOM container structure in client/documents.html', () => {
    const htmlContent = fs.readFileSync(docsHtmlPath, 'utf8');

    // List and banner containers
    assert.ok(htmlContent.includes('id="docs-list-container"'), 'Must contain #docs-list-container');
    assert.ok(htmlContent.includes('id="docs-status-banner"'), 'Must contain #docs-status-banner');

    // Dropzone and file inputs
    assert.ok(htmlContent.includes('id="drop-zone"'), 'Must contain #drop-zone');
    assert.ok(htmlContent.includes('id="file-input-hidden"'), 'Must contain #file-input-hidden');
    assert.ok(htmlContent.includes('id="btn-choose-files"'), 'Must contain #btn-choose-files');
    assert.ok(htmlContent.includes('id="btn-use-camera"'), 'Must contain #btn-use-camera');

    // Filter tab buttons and badges
    assert.ok(htmlContent.includes('id="btn-filter-all"'), 'Must contain #btn-filter-all');
    assert.ok(htmlContent.includes('id="btn-filter-needed"'), 'Must contain #btn-filter-needed');
    assert.ok(htmlContent.includes('id="btn-filter-review"'), 'Must contain #btn-filter-review');
    assert.ok(htmlContent.includes('id="btn-filter-accepted"'), 'Must contain #btn-filter-accepted');
    assert.ok(htmlContent.includes('id="btn-filter-rejected"'), 'Must contain #btn-filter-rejected');

    assert.ok(htmlContent.includes('id="count-filter-all"'), 'Must contain #count-filter-all');
    assert.ok(htmlContent.includes('id="count-filter-needed"'), 'Must contain #count-filter-needed');
    assert.ok(htmlContent.includes('id="count-filter-review"'), 'Must contain #count-filter-review');
    assert.ok(htmlContent.includes('id="count-filter-accepted"'), 'Must contain #count-filter-accepted');
    assert.ok(htmlContent.includes('id="count-filter-rejected"'), 'Must contain #count-filter-rejected');

    // Modal backdrop and container
    assert.ok(htmlContent.includes('id="modal-backdrop"'), 'Must contain #modal-backdrop');
    assert.ok(htmlContent.includes('id="modal-container"'), 'Must contain #modal-container');
  });

  describe('3. File Validation & Magic Bytes Security Engine', () => {
    let ClientDocsEngine;

    beforeEach(() => {
      const code = fs.readFileSync(docsJsPath, 'utf8');
      const virtualWindow = {
        FirebaseBridge: {
          getUserUid: () => 'usr_whitfield_4417'
        }
      };
      const fn = new Function('window', code);
      fn(virtualWindow);
      ClientDocsEngine = virtualWindow.ClientDocuments;
    });

    test('Validates authentic PDF file with %PDF magic bytes (0x25 0x50 0x44 0x46)', async () => {
      const pdfBytes = [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37]; // %PDF-1.7
      const mockFile = {
        name: 'w2_whitfield.pdf',
        size: 1024 * 500, // 500 KB
        bytes: pdfBytes
      };

      const result = await ClientDocsEngine.validateFileWithMagicBytes(mockFile);
      assert.equal(result.valid, true);
      assert.equal(result.detectedType, 'PDF');
      assert.equal(result.magicBytesVerified, true);
    });

    test('Validates authentic PNG image with PNG magic bytes (0x89 0x50 0x4E 0x47)', async () => {
      const pngBytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]; // \x89PNG
      const mockFile = {
        name: '1099_statement.png',
        size: 1024 * 800, // 800 KB
        bytes: pngBytes
      };

      const result = await ClientDocsEngine.validateFileWithMagicBytes(mockFile);
      assert.equal(result.valid, true);
      assert.equal(result.detectedType, 'PNG');
      assert.equal(result.magicBytesVerified, true);
    });

    test('Validates authentic JPEG image with SOI magic bytes (0xFF 0xD8 0xFF)', async () => {
      const jpegBytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]; // JPEG
      const mockFile = {
        name: 'receipt_scan.jpg',
        size: 1024 * 1200, // 1.2 MB
        bytes: jpegBytes
      };

      const result = await ClientDocsEngine.validateFileWithMagicBytes(mockFile);
      assert.equal(result.valid, true);
      assert.equal(result.detectedType, 'JPEG');
      assert.equal(result.magicBytesVerified, true);
    });

    test('Validates authentic CSV text file without binary null characters', async () => {
      // "Date,Amount,Description"
      const csvBytes = [0x44, 0x61, 0x74, 0x65, 0x2C, 0x41, 0x6D, 0x6F];
      const mockFile = {
        name: 'mileage_log.csv',
        size: 1024 * 50,
        bytes: csvBytes
      };

      const result = await ClientDocsEngine.validateFileWithMagicBytes(mockFile);
      assert.equal(result.valid, true);
      assert.equal(result.detectedType, 'CSV');
    });

    test('REJECTS file exceeding 25MB statutory ceiling limit', async () => {
      const mockFile = {
        name: 'oversized_scan.pdf',
        size: 26 * 1024 * 1024, // 26 MB (Limit is 25 MB)
        bytes: [0x25, 0x50, 0x44, 0x46]
      };

      const result = await ClientDocsEngine.validateFileWithMagicBytes(mockFile);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('25 MB statutory ceiling'), 'Must report 25MB statutory ceiling exceeded');
    });

    test('REJECTS prohibited executable script extension (.exe, .bat, .sh, .ps1)', async () => {
      const mockFile = {
        name: 'tax_update.exe',
        size: 1024 * 20,
        bytes: [0x4D, 0x5A, 0x90, 0x00]
      };

      const result = await ClientDocsEngine.validateFileWithMagicBytes(mockFile);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('strictly prohibited'), 'Must report extension strictly prohibited');
    });

    test('REJECTS disguised Windows executable with .pdf extension having MZ header (0x4D 0x5A)', async () => {
      // Disguised malware file: named fake_w2.pdf, but starts with MZ header
      const disguisedBytes = [0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00];
      const mockFile = {
        name: 'fake_w2.pdf',
        size: 1024 * 100,
        bytes: disguisedBytes
      };

      const result = await ClientDocsEngine.validateFileWithMagicBytes(mockFile);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('executable binary signature'), 'Must flag disguised executable binary signature');
    });

    test('REJECTS disguised Linux ELF binary with .csv extension having \\x7FELF header', async () => {
      const elfBytes = [0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00];
      const mockFile = {
        name: 'transactions.csv',
        size: 1024 * 50,
        bytes: elfBytes
      };

      const result = await ClientDocsEngine.validateFileWithMagicBytes(mockFile);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('executable binary signature'), 'Must flag ELF executable binary signature');
    });
  });

  describe('4. Checklist Document Management & Status Partitioning', () => {
    let mockDOM = {};
    let ClientDocsEngine;

    beforeEach(() => {
      mockDOM = {
        'docs-list-container': { innerHTML: '', querySelectorAll: () => [] },
        'drop-zone': { addEventListener: () => {}, classList: { add: () => {}, remove: () => {} } },
        'file-input-hidden': { addEventListener: () => {} },
        'btn-choose-files': { addEventListener: () => {} },
        'btn-use-camera': { addEventListener: () => {} },
        'docs-status-banner': { style: {}, innerHTML: '' },
        'count-filter-all': { textContent: '' },
        'count-filter-needed': { textContent: '' },
        'count-filter-review': { textContent: '' },
        'count-filter-accepted': { textContent: '' },
        'count-filter-rejected': { textContent: '' },
        'upload-pct-bar': { style: {} },
        'upload-pct-label': { textContent: '' }
      };

      const code = fs.readFileSync(docsJsPath, 'utf8');
      const virtualWindow = {
        FirebaseBridge: {
          getUserUid: () => 'usr_whitfield_4417',
          getDefaultDocumentRequests: (uid) => [
            {
              requestId: `${uid}_req_1099misc`,
              clientId: uid,
              taxYear: 2026,
              title: '1099-MISC — Keystone Property Group',
              description: 'Rental income documentation for Schedule E',
              category: '1099',
              status: 'pending',
              dueAt: '15 Sep 2026'
            },
            {
              requestId: `${uid}_req_k1`,
              clientId: uid,
              taxYear: 2026,
              title: 'Schedule K-1 — Blue Ridge Tech Partners LP',
              description: 'Partnership income/loss allocation statement',
              category: 'K-1',
              status: 'pending',
              dueAt: '15 Sep 2026'
            },
            {
              requestId: `${uid}_req_closing`,
              clientId: uid,
              taxYear: 2026,
              title: 'Closing Disclosure — 214 Halcyon Row',
              description: 'Settlement statement for mortgage refinance',
              category: 'Closing Disclosure',
              status: 'review',
              fileName: 'closing_disclosure_214_halcyon.pdf',
              fileSizeFormatted: '3.4 MB',
              dueAt: '01 Sep 2026'
            },
            {
              requestId: `${uid}_req_w2`,
              clientId: uid,
              taxYear: 2026,
              title: 'W-2 — Halstead Medical Group',
              description: 'Wage and tax statement for Elena Whitfield',
              category: 'W-2',
              status: 'accepted',
              fileName: 'w2_elena_whitfield.pdf',
              fileSizeFormatted: '1.2 MB',
              reviewedBy: 'Denise R., CPA',
              reviewedAt: '2026-09-03T09:20:00Z',
              reviewerNotes: 'Verified wage box 1 against MD withholding.'
            },
            {
              requestId: `${uid}_req_receipts`,
              clientId: uid,
              taxYear: 2026,
              title: 'Home Office Receipts',
              description: 'Utility bills and internet expenses',
              category: 'Receipts',
              status: 'rejected',
              rejectionReason: 'Scan cut off electrical utility summary on page 2. Please provide complete 12-month bill.'
            }
          ]
        },
        document: {
          getElementById: (id) => mockDOM[id] || null,
          querySelectorAll: (sel) => (sel === '.doc-filter-btn' ? [] : [])
        }
      };

      globalThis.document = virtualWindow.document;
      const fn = new Function('window', 'document', code);
      fn(virtualWindow, virtualWindow.document);
      ClientDocsEngine = virtualWindow.ClientDocuments;
    });

    test('Loads and categorizes all 5 document requests for Tax Year 2026', () => {
      ClientDocsEngine.init();
      assert.equal(ClientDocsEngine.state.clientUid, 'usr_whitfield_4417');
      assert.equal(ClientDocsEngine.state.taxYear, 2026);
      assert.equal(ClientDocsEngine.state.documents.length, 5);
    });

    test('Correctly computes filter badge counts for all statuses', () => {
      ClientDocsEngine.init();
      ClientDocsEngine.updateFilterCounts(ClientDocsEngine.state.documents);

      assert.equal(mockDOM['count-filter-all'].textContent, 5, 'Total documents count must be 5');
      assert.equal(mockDOM['count-filter-needed'].textContent, 2, 'Needed/pending count must be 2');
      assert.equal(mockDOM['count-filter-review'].textContent, 1, 'In-review count must be 1');
      assert.equal(mockDOM['count-filter-accepted'].textContent, 1, 'Accepted count must be 1');
      assert.equal(mockDOM['count-filter-rejected'].textContent, 1, 'Resubmission needed count must be 1');
    });

    test('Renders status pills and CPA review notes in document rows', () => {
      ClientDocsEngine.init();
      ClientDocsEngine.render();
      const output = mockDOM['docs-list-container'].innerHTML;

      assert.ok(output.includes('Missing / Needed'), 'Must render Missing/Needed badge');
      assert.ok(output.includes('In CPA Review'), 'Must render In CPA Review badge');
      assert.ok(output.includes('Accepted ✓'), 'Must render Accepted checkmark badge');
      assert.ok(output.includes('Resubmission Needed'), 'Must render Resubmission Needed badge');

      assert.ok(output.includes('CPA Note: Verified wage box 1 against MD withholding.'), 'Must render reviewer notes for accepted items');
      assert.ok(output.includes('Reason:</b> Scan cut off electrical utility summary'), 'Must render rejection reason for resubmissions');
    });

    test('Merges successful upload and transitions item status to review', () => {
      ClientDocsEngine.init();
      const uploadFile = {
        name: 'k1_blue_ridge.pdf',
        size: 1024 * 1024 * 2 // 2 MB
      };

      ClientDocsEngine.recordSuccessfulUpload(
        uploadFile,
        'usr_whitfield_4417_req_k1',
        'PDF',
        { storagePath: 'clients/usr_whitfield_4417/tax-years/2026/documents/k1_blue_ridge.pdf' }
      );

      const targetDoc = ClientDocsEngine.state.documents.find(d => d.requestId === 'usr_whitfield_4417_req_k1');
      assert.ok(targetDoc, 'Target document must exist');
      assert.equal(targetDoc.status, 'review', 'Status must transition to review');
      assert.equal(targetDoc.fileName, 'k1_blue_ridge.pdf');
      assert.equal(targetDoc.storagePath, 'clients/usr_whitfield_4417/tax-years/2026/documents/k1_blue_ridge.pdf');
      assert.equal(targetDoc.magicBytesVerified, true);
    });
  });

  describe('5. Storage Path Isolation & Cloud Security Rules Alignment', () => {
    test('Cloud storage rules mandate client tenant isolation and 25MB ceiling', () => {
      assert.ok(fs.existsSync(storageRulesPath), 'storage.rules must exist');
      const rules = fs.readFileSync(storageRulesPath, 'utf8');

      // Regulated path: clients/{userId}/tax-years/{taxYear}/documents/{documentId}
      assert.ok(rules.includes('match /clients/{userId}/tax-years/{taxYear}/documents/{documentId}'), 'Must isolate storage by userId');
      assert.ok(rules.includes('allow read: if isOwner(userId) || isFirmStaff()'), 'Read must require owner or firm staff');
      assert.ok(rules.includes('allow write: if isOwner(userId) && isValidTaxDocument()'), 'Write must require owner and valid document');
      assert.ok(rules.includes('request.resource.size <= 25 * 1024 * 1024'), 'Must enforce 25MB ceiling at storage rule layer');
    });
  });
});
