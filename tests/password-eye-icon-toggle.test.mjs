import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAppRoot = path.resolve(__dirname, '..');

describe('Passphrase & Password Eye Icon Toggle Implementation', () => {
  const firmHtmlPath = path.join(webAppRoot, 'firm', 'login.html');
  const firmHtml = fs.existsSync(firmHtmlPath) ? fs.readFileSync(firmHtmlPath, 'utf8') : '';
  const clientHtml = fs.readFileSync(path.join(webAppRoot, 'client', 'login.html'), 'utf8');
  const rootIndex = path.join(webAppRoot, '..', 'index.html');
  const indexHtml = fs.existsSync(rootIndex) ? fs.readFileSync(rootIndex, 'utf8') : fs.readFileSync(path.join(webAppRoot, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(webAppRoot, 'js', 'app.js'), 'utf8');

  describe('1. Firm Operations Login & Staff Access (firm/login.html)', { skip: !fs.existsSync(firmHtmlPath) }, () => {
    test('Defines .pwd-toggle-wrap and .pwd-toggle-btn CSS rules with right padding and hover styles', () => {
      assert.match(firmHtml, /\.pwd-toggle-wrap\s*\{[^}]*position:\s*relative/i);
      assert.match(firmHtml, /\.pwd-toggle-wrap\s+input\s*\{[^}]*padding-right:\s*42px\s*!important/i);
      assert.match(firmHtml, /\.pwd-toggle-btn\s*\{[^}]*position:\s*absolute/i);
    });

    test('Includes eye icon on Master Passphrase (practitioner-signup-password)', () => {
      assert.match(firmHtml, /id="practitioner-signup-password"/);
      assert.match(firmHtml, /data-target="practitioner-signup-password"/);
    });

    test('Includes eye icon on Confirm Master Passphrase (practitioner-signup-confirm)', () => {
      assert.match(firmHtml, /id="practitioner-signup-confirm"/);
      assert.match(firmHtml, /data-target="practitioner-signup-confirm"/);
    });

    test('Includes eye icon on Practitioner Master Password (practitioner-password)', () => {
      assert.match(firmHtml, /id="practitioner-password"/);
      assert.match(firmHtml, /data-target="practitioner-password"/);
    });

    test('All firm eye buttons include clean SVG vectors and accessibility attributes', () => {
      const matches = firmHtml.match(/class="pwd-toggle-btn"/g);
      assert.ok(matches && matches.length >= 3, 'Must have at least 3 password toggle buttons');
      assert.match(firmHtml, /aria-label="(?:Show|Toggle)\s*(?:password|passphrase)"/i);
      assert.match(firmHtml, /<svg\s+viewBox="0\s+0\s+24\s+24"/);
    });

    test('Includes setupPasswordToggles function and initializes it in script block', () => {
      assert.match(firmHtml, /function\s+setupPasswordToggles\s*\(\)/);
      assert.match(firmHtml, /setupPasswordToggles\(\);/);
      assert.match(firmHtml, /input\.type\s*=\s*isPassword\s*\?\s*'text'\s*:\s*'password'/);
    });
  });

  describe('2. Client Portal Authentication (client/login.html)', () => {
    test('Includes eye icon toggles on signin and signup password fields', () => {
      assert.match(clientHtml, /data-target="signin-password"/);
      assert.match(clientHtml, /data-target="signup-password"/);
      assert.match(clientHtml, /data-target="signup-confirm"/);
    });

    test('Includes setupPasswordToggles function and initializes it', () => {
      assert.match(clientHtml, /function\s+setupPasswordToggles\s*\(\)/);
      assert.match(clientHtml, /setupPasswordToggles\(\);/);
    });
  });

  describe('3. Gateway Auth Modal (index.html & js/app.js)', () => {
    test('Modal contains eye icon buttons for all password fields in index.html', () => {
      assert.match(indexHtml, /data-target="modal-client-pass"/);
      assert.match(indexHtml, /data-target="modal-signup-pass"/);
      assert.match(indexHtml, /data-target="modal-signup-confirm"/);
      assert.match(indexHtml, /data-target="modal-firm-pass"/);
    });

    test('js/app.js handles .pwd-toggle-btn interactions dynamically', () => {
      assert.match(appJs, /toggleBtns\.forEach/);
      assert.match(appJs, /input\.type\s*=\s*isPassword\s*\?\s*'text'\s*:\s*'password'/);
    });
  });
});
