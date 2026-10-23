import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Document Receipt Action & Icon Click Functionality', () => {
  const rootDir = 'c:/Users/user/Desktop/web app1';
  const webAppDir = path.join(rootDir, 'web app');

  const filesToCheck = [
    path.join(webAppDir, 'js/client/documents.js'),
    path.join(webAppDir, 'client/js/client/documents.js'),
    path.join(rootDir, 'client/js/client/documents.js'),
    path.join(rootDir, 'firm/client/js/client/documents.js'),
    path.join(rootDir, 'js/client/documents.js')
  ];

  test('All client documents.js mirrors contain .btn-view-receipt event bindings and fallback modal renderer', () => {
    for (const filePath of filesToCheck) {
      assert.ok(fs.existsSync(filePath), `File must exist: ${filePath}`);
      const code = fs.readFileSync(filePath, 'utf8');

      assert.ok(code.includes('.btn-view-receipt'), `${filePath} must include .btn-view-receipt selector`);
      assert.ok(code.includes('viewSubmissionReceipt: function (requestId, receiptRefOverride)'), `${filePath} must accept receiptRefOverride in viewSubmissionReceipt`);
      assert.ok(code.includes('renderDirectReceiptModal: function'), `${filePath} must define renderDirectReceiptModal fallback`);
      assert.ok(code.includes('_globalRowDelegationAttached'), `${filePath} must contain global delegated action dispatcher`);
    }
  });

  test('DocumentDeliveryClient contains renderReceiptModal with resilient modal DOM fallback', () => {
    const ddcPath = path.join(webAppDir, 'js/client/document-delivery-client.js');
    assert.ok(fs.existsSync(ddcPath));
    const code = fs.readFileSync(ddcPath, 'utf8');

    assert.ok(code.includes('renderReceiptModal: function'), 'Must define renderReceiptModal');
    assert.ok(code.includes('modal-backdrop'), 'Must have fallback to modal-backdrop');
    assert.ok(code.includes('modal-container'), 'Must have fallback to modal-container');
  });

  test('Simulating click on [🧾 Receipt (REC-2026-NSGVM2-99MISC-G6ZX)] opens the receipt modal', () => {
    const code = fs.readFileSync(path.join(webAppDir, 'js/client/documents.js'), 'utf8');

    let modalRenderedHtml = '';
    let modalOpened = false;

    const mockDOM = {
      'docs-list-container': { innerHTML: '', querySelectorAll: () => [] },
      'modal-backdrop': {
        style: {},
        classList: {
          add: () => {},
          remove: () => {}
        }
      },
      'modal-container': {
        innerHTML: '',
        querySelectorAll: () => []
      }
    };

    const virtualWindow = {
      location: { hostname: 'localhost' },
      FileRoomLayout: {
        openModal: (html) => {
          modalOpened = true;
          modalRenderedHtml = html;
        },
        closeModal: () => {
          modalOpened = false;
        },
        showToast: () => {}
      },
      FileRoomData: {
        documents: [
          {
            id: 'doc-1099-misc',
            requestId: 'doc-1099-misc',
            title: 'Form 1099-MISC — Keystone Property Group',
            fileName: 'Form_1099_MISC.pdf',
            status: 'accepted',
            submissionReceipt: 'REC-2026-NSGVM2-99MISC-G6ZX',
            receiptReference: 'REC-2026-NSGVM2-99MISC-G6ZX'
          }
        ]
      },
      document: {
        getElementById: (id) => mockDOM[id] || null,
        querySelectorAll: () => [],
        addEventListener: () => {}
      }
    };

    const fn = new Function('window', 'document', code);
    fn(virtualWindow, virtualWindow.document);

    const clientDocs = virtualWindow.ClientDocuments;
    assert.ok(clientDocs, 'ClientDocuments must be initialized');

    // Simulate clicking the receipt button for REC-2026-NSGVM2-99MISC-G6ZX
    clientDocs.viewSubmissionReceipt('doc-1099-misc', 'REC-2026-NSGVM2-99MISC-G6ZX');

    assert.ok(modalOpened, 'Receipt modal must be opened');
    assert.ok(modalRenderedHtml.includes('REC-2026-NSGVM2-99MISC-G6ZX'), 'Modal HTML must include the exact receipt reference');
    assert.ok(modalRenderedHtml.includes('Document Vault Intake Receipt'), 'Modal HTML must include title');
    assert.ok(modalRenderedHtml.includes('FTC Safeguards'), 'Modal HTML must reference FTC Safeguards custody');
    assert.ok(modalRenderedHtml.includes('Copy Receipt Reference'), 'Modal HTML must have copy button');
  });

  test('Direct render fallback works even when FileRoomLayout is undefined', () => {
    const code = fs.readFileSync(path.join(webAppDir, 'js/client/documents.js'), 'utf8');

    let renderedIntoContainer = '';
    const mockBackdrop = {
      style: {},
      classList: {
        add: () => {},
        remove: () => {}
      }
    };
    const mockContainer = {
      innerHTML: '',
      querySelectorAll: () => []
    };

    const virtualWindow = {
      location: { hostname: 'localhost' },
      FileRoomLayout: null, // Null to test direct fallback
      DocumentDeliveryClient: null,
      FileRoomData: {
        documents: []
      },
      document: {
        getElementById: (id) => {
          if (id === 'modal-backdrop') return mockBackdrop;
          if (id === 'modal-container') return mockContainer;
          return null;
        },
        querySelectorAll: () => [],
        addEventListener: () => {}
      }
    };

    const fn = new Function('window', 'document', code);
    fn(virtualWindow, virtualWindow.document);

    const clientDocs = virtualWindow.ClientDocuments;

    // Trigger receipt view directly
    clientDocs.viewSubmissionReceipt('doc-1099-misc', 'REC-2026-NSGVM2-99MISC-G6ZX');

    assert.ok(mockContainer.innerHTML.includes('REC-2026-NSGVM2-99MISC-G6ZX'), 'Fallback container must receive receipt reference');
    assert.equal(mockBackdrop.style.display, 'flex', 'Backdrop display must be set to flex');
  });

  test('FileRoomLayout.showCenteredAlert creates a centered in-app modal and formats receipt reference', () => {
    const layoutCode = fs.readFileSync(path.join(webAppDir, 'js/core/layout.js'), 'utf8');

    let createdElements = [];
    const mockDoc = {
      getElementById: (id) => null,
      createElement: (tag) => {
        const el = {
          tagName: tag.toUpperCase(),
          id: '',
          className: '',
          style: {},
          innerHTML: '',
          childNodes: [],
          appendChild: function (child) {
            this.childNodes.push(child);
            return child;
          },
          parentNode: null
        };
        createdElements.push(el);
        return el;
      },
      body: {
        appendChild: (el) => {
          el.parentNode = mockDoc.body;
        }
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    const virtualWindow = {
      document: mockDoc,
      location: { hostname: 'localhost' },
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    const fn = new Function('window', 'document', layoutCode);
    fn(virtualWindow, mockDoc);

    const layout = virtualWindow.FileRoomLayout;
    assert.ok(layout && typeof layout.showCenteredAlert === 'function', 'showCenteredAlert must be defined on Layout');

    layout.showCenteredAlert('Receipt reference REC-2026-NSGVM2-99MISC-G6ZX copied to clipboard.', 'Receipt Copied');

    const backdrop = createdElements.find(e => e.id === 'tfr-centered-alert-backdrop');
    assert.ok(backdrop, 'Centered alert backdrop must be created');
    assert.ok(backdrop.style.cssText.includes('justify-content:center'), 'Backdrop must center horizontally');
    assert.ok(backdrop.style.cssText.includes('align-items:center'), 'Backdrop must center vertically');

    const card = createdElements.find(e => e.className === 'modal-card');
    assert.ok(card, 'Alert card must be created');
    assert.ok(card.innerHTML.includes('REC-2026-NSGVM2-99MISC-G6ZX'), 'Must format the receipt reference');
    assert.ok(card.innerHTML.includes('Receipt Copied'), 'Must include alert title');
    assert.ok(card.innerHTML.includes('tfr-centered-alert-ok-btn'), 'Must have centered OK button');
  });
});

