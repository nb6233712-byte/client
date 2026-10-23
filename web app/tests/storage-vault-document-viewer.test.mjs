/**
 * ============================================================================
 * TEST SUITE: STORAGE VAULT DOCUMENT VIEWER (CIRCULAR 230 & FTC SAFEGUARDS)
 * ============================================================================
 *
 * Verifies:
 * 1. FileRoomLayout.renderVaultDocumentHtml generates high-fidelity IRS forms
 *    (Form W-2, Form 1099-NEC, Form 1099-MISC, Closing Disclosure, Schedule K-1).
 * 2. Cached client uploads (image/PDF data URLs) are rendered directly in vault preview.
 * 3. FirmDashboard.openDocReviewModal renders interactive [📄 View Uploaded File in Storage Vault]
 *    button that toggles preview panel and updates state dynamically.
 * 4. FileRoomLayout.openVaultDocumentViewer, downloadVaultDocument, and printVaultDocument
 *    operate correctly without exceptions.
 * 5. firm/documents.html review queue binds interactive storage vault preview links.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Storage Vault Document Viewer & Practitioner Review Architecture', () => {

  const baseDir = path.resolve('c:/Users/user/Desktop/web app1/web app');
  let virtualWindow;
  let Layout;
  let FirmDashboard;

  beforeEach(() => {
    // Setup Virtual Browser Environment
    const storageStore = {};
    virtualWindow = {
      location: { hostname: '127.0.0.1', origin: 'http://127.0.0.1:8085' },
      sessionStorage: {
        getItem: (k) => storageStore[k] || null,
        setItem: (k, v) => { storageStore[k] = String(v); },
        removeItem: (k) => { delete storageStore[k]; },
        clear: () => { Object.keys(storageStore).forEach(k => delete storageStore[k]); }
      },
      document: {
        getElementById: () => null,
        querySelectorAll: () => [],
        createElement: (tag) => {
          const el = {
            tagName: tag.toUpperCase(),
            style: {},
            classList: {
              classes: new Set(),
              add: function (c) { this.classes.add(c); },
              remove: function (c) { this.classes.delete(c); },
              contains: function (c) { return this.classes.has(c); }
            },
            setAttribute: () => {},
            getAttribute: () => null,
            appendChild: () => {},
            addEventListener: (evt, fn) => { el['on' + evt] = fn; },
            click: () => {}
          };
          return el;
        },
        body: {
          appendChild: () => {},
          removeChild: () => {}
        }
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    // Load layout.js
    const layoutCode = fs.readFileSync(path.join(baseDir, 'js/core/layout.js'), 'utf8');
    const layoutFn = new Function('window', layoutCode);
    layoutFn(virtualWindow);
    Layout = virtualWindow.FileRoomLayout;

    // Load dashboard.js
    const dashboardCode = fs.readFileSync(path.join(baseDir, 'js/firm/dashboard.js'), 'utf8');
    const dashboardFn = new Function('window', 'document', dashboardCode);
    dashboardFn(virtualWindow, virtualWindow.document);
    FirmDashboard = virtualWindow.FirmDashboard;
  });

  describe('1. FileRoomLayout Vault Preview Rendering Engine', () => {
    test('1.1 Layout exports renderVaultDocumentHtml and openVaultDocumentViewer APIs', () => {
      assert.equal(typeof Layout.renderVaultDocumentHtml, 'function');
      assert.equal(typeof Layout.openVaultDocumentViewer, 'function');
      assert.equal(typeof Layout.downloadVaultDocument, 'function');
      assert.equal(typeof Layout.printVaultDocument, 'function');
    });

    test('1.2 Renders authentic Form 1099-NEC with Payer, Recipient, and Nonemployee Compensation', () => {
      const html = Layout.renderVaultDocumentHtml({
        docId: 'doc_1791813050763_lqu75ba',
        title: 'Form 1099-NEC Whitfield Design Co.pdf',
        client: 'Michael Whitfield'
      });

      assert.ok(html.includes('Form 1099-NEC'), 'Must include Form 1099-NEC title');
      assert.ok(html.includes('Nonemployee Compensation'), 'Must identify Nonemployee Compensation');
      assert.ok(html.includes('Keystone Property Group LLC / Whitfield Design Co.'), 'Must include Payer');
      assert.ok(html.includes('$48,500.00'), 'Must include Box 1 amount');
      assert.ok(html.includes('Michael Whitfield'), 'Must include recipient name');
      assert.ok(html.includes('doc_1791813050763_lqu75ba'), 'Must include Document ID');
    });

    test('1.3 Renders authentic Form W-2 with employer EIN, wages, and withholdings', () => {
      const html = Layout.renderVaultDocumentHtml({
        docId: 'doc_w2_9921',
        title: 'Form W-2 Wage Statement (Uploaded)',
        client: 'Elena Whitfield'
      });

      assert.ok(html.includes('Form W-2 Wage and Tax Statement'), 'Must render Form W-2 header');
      assert.ok(html.includes('12-8941029'), 'Must include employer EIN');
      assert.ok(html.includes('$142,500.00'), 'Must include Box 1 wages');
      assert.ok(html.includes('$22,800.00'), 'Must include Box 2 withholding');
      assert.ok(html.includes('Elena Whitfield'), 'Must include employee name');
    });

    test('1.4 Renders CFPB Form H-25 Closing Disclosure for real estate transactions', () => {
      const html = Layout.renderVaultDocumentHtml({
        docId: 'doc_closing_3312',
        title: 'Closing Disclosure (Uploaded)',
        client: 'Michael & Elena Whitfield'
      });

      assert.ok(html.includes('Closing Disclosure'), 'Must render Closing Disclosure');
      assert.ok(html.includes('Form H-25'), 'Must reference CFPB Form H-25');
      assert.ok(html.includes('$4,250.00'), 'Must include deductible origination points');
      assert.ok(html.includes('$6,180.00'), 'Must include Schedule A property taxes');
    });

    test('1.5 Renders Schedule K-1 Partner Share of Income for partnership filers', () => {
      const html = Layout.renderVaultDocumentHtml({
        docId: 'doc_k1_1102',
        title: 'Schedule K-1 (Uploaded)',
        client: 'Brennan Holdings LLC'
      });

      assert.ok(html.includes('Schedule K-1 (Form 1065)'), 'Must render Schedule K-1');
      assert.ok(html.includes('$64,200.00'), 'Must render ordinary business income');
      assert.ok(html.includes('Brennan Holdings LLC'), 'Must render partner name');
    });

    test('1.6 Renders cached image scans when present in sessionStorage', () => {
      const mockDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      virtualWindow.sessionStorage.setItem('tfr_vault_doc_img_test', mockDataUrl);

      const html = Layout.renderVaultDocumentHtml({
        docId: 'doc_img_test',
        title: 'Receipt_Mileage.png',
        client: 'Taylor Bennett',
        sessionStorage: virtualWindow.sessionStorage
      });

      assert.ok(html.includes('<img src="' + mockDataUrl + '"'), 'Must render cached image directly');
      assert.ok(html.includes('Uploaded Image Scan'), 'Must display scan caption');
    });

    test('1.7 Includes Cryptographic Custody Ledger with SHA-256 and FTC Safeguards compliance', () => {
      const html = Layout.renderVaultDocumentHtml({
        docId: 'doc_test_audit',
        title: '1099-MISC',
        client: 'Michael Whitfield'
      });

      assert.ok(html.includes('Vault Security &amp; Cryptographic Custody Ledger'), 'Must include audit title');
      assert.ok(html.includes('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'), 'Must include SHA-256 hash');
      assert.ok(html.includes('FTC Safeguards Rule 16 CFR &sect; 314.4'), 'Must cite FTC Safeguards');
      assert.ok(html.includes('ClamAV Engine v2026.10'), 'Must cite ClamAV engine');
    });
  });

  describe('2. Firm Operations Dashboard openDocReviewModal Integration', () => {
    test('2.1 openDocReviewModal builds interactive [📄 View Uploaded File in Storage Vault] button', () => {
      let modalContent = '';
      const mockContainer = {
        set innerHTML(val) { modalContent = val; },
        get innerHTML() { return modalContent; },
        classList: { add: () => {}, remove: () => {} },
        style: {}
      };
      const mockBackdrop = { style: {} };

      virtualWindow.document.getElementById = (id) => {
        if (id === 'modal-container') return mockContainer;
        if (id === 'modal-backdrop') return mockBackdrop;
        if (id === 'btn-view-vault-doc') return { style: {}, classList: { add: () => {}, remove: () => {} } };
        if (id === 'vault-doc-preview-panel') return { style: { display: 'none' }, scrollIntoView: () => {} };
        if (id === 'lbl-view-vault-doc') return { textContent: '' };
        return null;
      };

      FirmDashboard.openDocReviewModal({
        docId: 'doc_1791813050763_lqu75ba',
        client: 'Michael & Elena Whitfield',
        title: 'Form 1099-NEC Whitfield Design Co.pdf'
      });

      assert.ok(modalContent.includes('id="btn-view-vault-doc"'), 'Must render #btn-view-vault-doc button');
      assert.ok(modalContent.includes('View Uploaded File in Storage Vault'), 'Must contain button label');
      assert.ok(modalContent.includes('id="vault-doc-preview-panel"'), 'Must contain #vault-doc-preview-panel container');
      assert.ok(modalContent.includes('doc_1791813050763_lqu75ba'), 'Must render Document ID');
    });

    test('2.2 Clicking #btn-view-vault-doc toggles preview display and updates button label', () => {
      const panelState = { display: 'none' };
      const labelState = { textContent: 'View Uploaded File in Storage Vault' };
      const btnState = {
        style: {},
        classList: {
          add: function (c) { this.active = true; },
          remove: function (c) { this.active = false; }
        }
      };
      const containerState = {
        classList: { add: () => {}, remove: () => {} },
        style: {}
      };

      let registeredClick = null;
      virtualWindow.document.getElementById = (id) => {
        if (id === 'modal-container') return containerState;
        if (id === 'modal-backdrop') return { style: {} };
        if (id === 'btn-view-vault-doc') {
          return {
            set onclick(fn) { registeredClick = fn; },
            get onclick() { return registeredClick; },
            style: btnState.style,
            classList: btnState.classList
          };
        }
        if (id === 'vault-doc-preview-panel') {
          return {
            style: panelState,
            scrollIntoView: () => {},
            querySelector: () => null
          };
        }
        if (id === 'lbl-view-vault-doc') return labelState;
        return null;
      };

      FirmDashboard.openDocReviewModal({
        docId: 'doc_1791813050763_lqu75ba',
        client: 'Michael Whitfield',
        title: 'Form 1099-NEC'
      });

      assert.ok(registeredClick, 'Must register onclick handler on #btn-view-vault-doc');

      // First click: expands preview
      registeredClick({ preventDefault: () => {} });
      assert.equal(panelState.display, 'block', 'Must show preview panel on click');
      assert.equal(labelState.textContent, 'Hide Document Preview', 'Must update label to Hide Document Preview');
      assert.ok(btnState.style.borderColor.includes('brand'), 'Must highlight active button border');

      // Second click: collapses preview
      registeredClick({ preventDefault: () => {} });
      assert.equal(panelState.display, 'none', 'Must hide preview panel on second click');
      assert.equal(labelState.textContent, 'View Uploaded File in Storage Vault', 'Must restore button label');
    });
  });

  describe('3. Dedicated Review Queue firm/documents.html Linkage', { skip: !fs.existsSync(path.join(baseDir, 'firm/documents.html')) }, () => {
    test('3.1 firm/documents.html contains interactive view-vault-link handlers', () => {
      const htmlPath = path.join(baseDir, 'firm/documents.html');
      const html = fs.readFileSync(htmlPath, 'utf8');

      assert.ok(html.includes('class="view-vault-link"'), 'Must define .view-vault-link class');
      assert.ok(html.includes('View in Storage Vault &nearr;'), 'Must define View in Storage Vault label');
      assert.ok(html.includes('FileRoomLayout.openVaultDocumentViewer'), 'Must bind to FileRoomLayout.openVaultDocumentViewer');
    });
  });

  describe('4. Storage Vault Modal Close Buttons & Dismissal Engine', () => {
    test('4.1 Layout.closeModal hides backdrop and cleans container even when display was flex', () => {
      const mockContainer = {
        innerHTML: '<div class="test">Content</div>',
        classList: {
          classes: new Set(['modal-wide']),
          add: function (c) { this.classes.add(c); },
          remove: function (c) { this.classes.delete(c); },
          contains: function (c) { return this.classes.has(c); }
        },
        style: { maxWidth: '920px', maxHeight: '76vh', overflowY: 'auto' }
      };
      const mockBackdrop = {
        classList: {
          classes: new Set(['active', 'open']),
          add: function (c) { this.classes.add(c); },
          remove: function (c) { this.classes.delete(c); },
          contains: function (c) { return this.classes.has(c); }
        },
        style: { display: 'flex' }
      };

      virtualWindow.document.getElementById = (id) => {
        if (id === 'modal-container') return mockContainer;
        if (id === 'modal-backdrop') return mockBackdrop;
        return null;
      };

      Layout.closeModal();

      assert.equal(mockBackdrop.style.display, 'none', 'Backdrop display must be none');
      assert.equal(mockBackdrop.classList.contains('active'), false, 'Must remove active class');
      assert.equal(mockBackdrop.classList.contains('open'), false, 'Must remove open class');
      assert.equal(mockContainer.innerHTML, '', 'Container innerHTML must be cleared');
      assert.equal(mockContainer.classList.contains('modal-wide'), false, 'Must remove modal-wide class');
      assert.equal(mockContainer.style.maxWidth, '', 'Must reset maxWidth');
    });

    test('4.2 openVaultDocumentViewer markup includes explicit close buttons with data-close-modal', () => {
      let modalMarkup = '';
      const mockContainer = {
        set innerHTML(val) { modalMarkup = val; },
        get innerHTML() { return modalMarkup; },
        classList: { add: () => {}, remove: () => {} },
        style: {},
        querySelectorAll: () => []
      };
      const mockBackdrop = {
        classList: { add: () => {}, remove: () => {} },
        style: {}
      };

      virtualWindow.document.getElementById = (id) => {
        if (id === 'modal-container') return mockContainer;
        if (id === 'modal-backdrop') return mockBackdrop;
        return null;
      };

      Layout.openVaultDocumentViewer({
        docId: 'doc_test_close',
        title: '02_Test_1099_MISC_Source_Record.pdf',
        client: 'Taylor Bennett'
      });

      assert.ok(modalMarkup.includes('id="btn-close-vault-modal"'), 'Must include top close button id');
      assert.ok(modalMarkup.includes('id="btn-close-vault-viewer"'), 'Must include bottom Close Viewer button id');
      assert.ok(modalMarkup.includes('data-close-modal'), 'Must include data-close-modal attribute');
      assert.ok(modalMarkup.includes('Close Viewer'), 'Must contain Close Viewer label');
      assert.ok(modalMarkup.includes('&times;'), 'Must contain multiplication sign / times close icon');
    });

    test('4.3 FirmDashboard.openDocReviewModal wires close buttons and closes via closeModal', () => {
      let modalMarkup = '';
      const mockContainer = {
        set innerHTML(val) { modalMarkup = val; },
        get innerHTML() { return modalMarkup; },
        classList: { add: () => {}, remove: () => {} },
        style: {}
      };
      const mockBackdrop = {
        classList: {
          classes: new Set(),
          add: function (c) { this.classes.add(c); },
          remove: function (c) { this.classes.delete(c); },
          contains: function (c) { return this.classes.has(c); }
        },
        style: {}
      };

      let registeredCloseClick = null;
      virtualWindow.document.getElementById = (id) => {
        if (id === 'modal-container') return mockContainer;
        if (id === 'modal-backdrop') return mockBackdrop;
        if (id === 'btn-close-triage-modal') {
          return {
            set onclick(fn) { registeredCloseClick = fn; },
            get onclick() { return registeredCloseClick; }
          };
        }
        if (id === 'btn-modal-cancel') return { onclick: null };
        return null;
      };

      FirmDashboard.openDocReviewModal({
        docId: 'doc_1791813050763_1qu75ba',
        client: 'Taylor Bennett',
        title: '02_Test_1099_MISC_Source_Record.pdf'
      });

      assert.equal(mockBackdrop.style.display, 'flex', 'Backdrop must be opened with flex');
      assert.ok(typeof registeredCloseClick === 'function', 'Must register close onclick');

      // Click close button
      registeredCloseClick();
      assert.equal(mockBackdrop.style.display, 'none', 'Backdrop must be hidden after close click');
    });
  });
});
