/**
 * ============================================================================
 * TEST SUITE: CLIENT PORTAL SIGNATURES (THE FILE ROOM)
 * ============================================================================
 * 
 * Verifies all requirements for client/signatures.html:
 * 1. File existence & linkage in client/signatures.html
 * 2. Cross-linking to all Client Portal modules
 * 3. Client authentication & data binding (usr_whitfield_4417 · Tax Year 2026)
 * 4. Dual-signer tracking (Primary Taxpayer & Spouse Form 8879)
 * 5. Verified provider status (DocuSign eSignature v2.1 & LexisNexis KBA)
 * 6. Explicit policy against simulated successful signatures (No fake quiz/drawing signatures)
 * 7. Physical wet-ink signature fallback (IRS Pub 1345 § 5.2.2)
 * 8. Statutory 3-year WORM custody disclosure (IRC § 6061)
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Client Portal Signatures & Verified Provider Architecture', () => {

  const baseDir = path.resolve('c:/Users/user/Desktop/web app1/web app');
  const signaturesJsPath = path.join(baseDir, 'js/client/signatures.js');
  const signaturesHtmlPath = path.join(baseDir, 'client/signatures.html');

  test('1. File existence & linkage in client/signatures.html', () => {
    assert.ok(fs.existsSync(signaturesJsPath), 'js/client/signatures.js must exist');
    assert.ok(fs.existsSync(signaturesHtmlPath), 'client/signatures.html must exist');

    const htmlContent = fs.readFileSync(signaturesHtmlPath, 'utf8');
    assert.ok(htmlContent.includes('src="../js/client/signatures.js"'), 'Must link js/client/signatures.js');
    assert.ok(htmlContent.includes('src="../js/core/layout.js"'), 'Must link js/core/layout.js');
    assert.ok(htmlContent.includes('src="../js/firebase.js"'), 'Must link js/firebase.js');
    assert.ok(htmlContent.includes('ClientSignatures.init()'), 'Must initialize ClientSignatures');
    assert.ok(htmlContent.includes('id="signatures-content-area"'), 'Must contain dynamic content area');
  });

  test('2. Working navigation to Client Portal pages', () => {
    const htmlContent = fs.readFileSync(signaturesHtmlPath, 'utf8');
    const jsContent = fs.readFileSync(signaturesJsPath, 'utf8');

    const requiredPages = [
      'dashboard.html',
      'documents.html',
      'tax-return.html',
      'messages.html'
    ];

    for (const page of requiredPages) {
      assert.ok(
        htmlContent.includes(`href="${page}"`) || jsContent.includes(`href="${page}"`) || jsContent.includes(`href: '${page}'`),
        `Signatures module must link to ${page}`
      );
    }
  });

  describe('3. Functional Signatures Engine Unit Tests', () => {
    let mockDOM;
    let ClientSignaturesEngine;

    beforeEach(() => {
      mockDOM = {
        innerHTML: '',
        querySelectorAll: () => [],
        getElementById: () => null
      };

      const code = fs.readFileSync(signaturesJsPath, 'utf8');
      const virtualWindow = {
        FirebaseBridge: {
          getUserUid: () => 'usr_whitfield_4417',
          getDefaultPreparedReturn: (uid, year) => ({
            clientUid: uid,
            taxYear: year || 2026,
            preparerName: 'Denise R., CPA',
            preparedDate: '2 September 2026',
            federalRefundFormatted: '$3,418',
            stateBalanceDueFormatted: '$612'
          })
        },
        document: {
          getElementById: (id) => (id === 'signatures-content-area' ? mockDOM : null)
        }
      };

      globalThis.document = virtualWindow.document;
      const fn = new Function('window', 'document', code);
      fn(virtualWindow, virtualWindow.document);
      ClientSignaturesEngine = virtualWindow.ClientSignatures;
    });

    test('Engine associates signature request with authenticated client UID and Tax Year 2026', () => {
      ClientSignaturesEngine.loadSignaturesData('usr_whitfield_4417');
      assert.equal(ClientSignaturesEngine.state.clientUid, 'usr_whitfield_4417');
      assert.equal(ClientSignaturesEngine.state.taxYear, 2026);
      assert.equal(ClientSignaturesEngine.state.signingRequest.form.includes('IRS Form 8879'), true);
      assert.equal(ClientSignaturesEngine.state.signingRequest.refundAmount, '$3,418');
    });

    test('Tracks dual-signers for Primary Taxpayer and Spouse', () => {
      ClientSignaturesEngine.loadSignaturesData('usr_whitfield_4417');
      const req = ClientSignaturesEngine.state.signingRequest;

      assert.equal(req.isJointReturn, true);
      assert.equal(req.signers.length, 2);

      const primary = req.signers[0];
      assert.equal(primary.role, 'Primary Taxpayer');
      assert.equal(primary.name, 'Michael Whitfield');
      assert.equal(primary.maxAttempts, 3);

      const spouse = req.signers[1];
      assert.equal(spouse.role, 'Spouse / Secondary Signer');
      assert.equal(spouse.name, 'Elena Whitfield');
      assert.equal(spouse.maxAttempts, 3);
    });

    test('Renders Verified Provider Status (DocuSign eSignature v2.1 & LexisNexis KBA)', () => {
      ClientSignaturesEngine.loadSignaturesData('usr_whitfield_4417');
      ClientSignaturesEngine.render();
      const output = mockDOM.innerHTML;

      assert.ok(output.includes('DocuSign eSignature v2.1'), 'Must display verified provider name');
      assert.ok(output.includes('LexisNexis Risk Solutions'), 'Must display out-of-wallet KBA engine');
      assert.ok(output.includes('IRS Publication 1345 § 5.2.2'), 'Must cite IRS Pub 1345 standard');
      assert.ok(output.includes('3 Years Statutory Custody'), 'Must state retention policy');
    });

    test('Marks unavailable live integrations clearly without simulated signatures', () => {
      ClientSignaturesEngine.loadSignaturesData('usr_whitfield_4417');
      ClientSignaturesEngine.render();
      const output = mockDOM.innerHTML;

      assert.ok(
        output.includes('Mandatory Statutory Policy') &&
        output.includes('browser-based mock signature simulations and trivial quizzes are prohibited'),
        'Must explicitly forbid fake in-browser mock signature simulations'
      );
    });

    test('Provides Physical Wet-Ink Signature Fallback under IRS Pub 1345 § 5.2.2', () => {
      ClientSignaturesEngine.loadSignaturesData('usr_whitfield_4417');
      ClientSignaturesEngine.render();
      const output = mockDOM.innerHTML;

      assert.ok(output.includes('Physical Handwritten (Wet-Ink) Form 8879 Execution'), 'Must render wet-ink signature fallback');
      assert.ok(output.includes('btn-download-form8879'), 'Must provide download blank Form 8879 button');
      assert.ok(output.includes('href="documents.html"'), 'Must link to documents.html for uploading signed copy');
    });

    test('Renders 3-Year Tamper-Evident WORM Custody Ledger Disclosure (IRC § 6061)', () => {
      ClientSignaturesEngine.loadSignaturesData('usr_whitfield_4417');
      ClientSignaturesEngine.render();
      const output = mockDOM.innerHTML;

      assert.ok(output.includes('Internal Revenue Code § 6061'), 'Must cite IRC § 6061');
      assert.ok(output.includes('tamper-evident Write Once Read Many (WORM) storage'), 'Must disclose WORM storage rule');
      assert.ok(output.includes('usr_whitfield_4417'), 'Must bind ledger to client UID');
    });
  });
});
