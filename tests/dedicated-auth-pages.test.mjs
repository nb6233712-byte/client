/**
 * ============================================================================
 * UNIT TEST SUITE: DEDICATED DISTINCT CLIENT & FIRM AUTH PAGES
 * ============================================================================
 * 
 * Verifies:
 * 1. Dedicated & Distinct Client Login & Sign-Up Page (client/login.html)
 * 2. Dedicated & Distinct Firm Operations Login & Sign-Up Page (firm/login.html)
 * 3. High-Contrast Text Legibility & Visual Visibility Safeguards
 * 4. Distinct Role-Specific Form Fields (Client Form 1040/7216 vs Firm Circular 230/PTIN)
 * 5. Gateway Direct Navigation to Dedicated Pages
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Dedicated Distinct Client & Firm Auth Pages', () => {
  const clientLoginPath = path.resolve('c:/Users/user/Desktop/web app1/web app/client/login.html');
  const firmLoginPath = fs.existsSync(path.resolve('c:/Users/user/Desktop/web app1/web app/firm/login.html'))
    ? path.resolve('c:/Users/user/Desktop/web app1/web app/firm/login.html')
    : path.resolve('c:/Users/user/Desktop/firm/login.html');
  const indexPath = path.resolve('c:/Users/user/Desktop/web app1/web app/index.html');
  const appJsPath = path.resolve('c:/Users/user/Desktop/web app1/web app/js/app.js');

  let clientLoginHtml = '';
  let firmLoginHtml = '';
  let indexHtml = '';
  let appJs = '';

  beforeEach(() => {
    assert.ok(fs.existsSync(clientLoginPath), 'client/login.html must exist');
    assert.ok(fs.existsSync(firmLoginPath), 'firm/login.html must exist');
    assert.ok(fs.existsSync(indexPath), 'index.html must exist');
    assert.ok(fs.existsSync(appJsPath), 'js/app.js must exist');

    clientLoginHtml = fs.readFileSync(clientLoginPath, 'utf8');
    firmLoginHtml = fs.readFileSync(firmLoginPath, 'utf8');
    indexHtml = fs.readFileSync(indexPath, 'utf8');
    appJs = fs.readFileSync(appJsPath, 'utf8');
  });

  describe('1. Client Portal Dedicated Login & Sign-Up Page', () => {
    test('Contains dual tabs for Sign In and Create Account (Sign Up)', () => {
      assert.ok(clientLoginHtml.includes('id="tab-btn-signin"'), 'Must contain #tab-btn-signin');
      assert.ok(clientLoginHtml.includes('id="tab-btn-signup"'), 'Must contain #tab-btn-signup');
      assert.ok(clientLoginHtml.includes('id="card-signin"'), 'Must contain #card-signin');
      assert.ok(clientLoginHtml.includes('id="card-signup"'), 'Must contain #card-signup');
    });

    test('Includes taxpayer-specific onboarding fields (SSN/ITIN, IRC § 7216 Consent)', () => {
      assert.ok(clientLoginHtml.includes('id="signup-ssn"'), 'Must contain masked SSN field');
      assert.ok(clientLoginHtml.includes('signup-consent'), 'Must contain IRC § 7216 consent checkbox');
      assert.ok(clientLoginHtml.includes('Taxpayer Engagement Portal'), 'Must display Taxpayer Portal brand context');
    });

    test('Includes high-contrast tab styles and cross-portal link to firm operations', () => {
      assert.ok(clientLoginHtml.includes('.auth-tabs'), 'Must define .auth-tabs styling');
      assert.ok(clientLoginHtml.includes('href="../firm/login.html"'), 'Must link to firm login page');
    });
  });

  describe('2. Firm Operations Dedicated Login & Sign-Up Page', () => {
    test('Contains dual tabs for Practitioner Sign In and Request Staff Access (Sign Up)', () => {
      assert.ok(firmLoginHtml.includes('id="tab-btn-firm-signin"'), 'Must contain #tab-btn-firm-signin');
      assert.ok(firmLoginHtml.includes('id="tab-btn-firm-signup"'), 'Must contain #tab-btn-firm-signup');
      assert.ok(firmLoginHtml.includes('id="card-practitioner-signin"'), 'Must contain #card-practitioner-signin');
      assert.ok(firmLoginHtml.includes('id="card-practitioner-signup"'), 'Must contain #card-practitioner-signup');
    });

    test('Includes practitioner-specific onboarding fields (PTIN, Staff Role dropdown, Circular 230 pledge)', () => {
      assert.ok(firmLoginHtml.includes('id="practitioner-signup-role"'), 'Must contain supervisory role selector');
      assert.ok(firmLoginHtml.includes('id="practitioner-signup-ptin"'), 'Must contain IRS PTIN field');
      assert.ok(firmLoginHtml.includes('practitioner-signup-pledge'), 'Must contain Circular 230 pledge checkbox');
      assert.ok(firmLoginHtml.includes('@pivot-aide-tax.com'), 'Must restrict registration to authorized domain');
    });

    test('Includes high-contrast tab styles and cross-portal link to client portal', () => {
      assert.ok(firmLoginHtml.includes('.firm-auth-tabs'), 'Must define .firm-auth-tabs styling');
      assert.ok(firmLoginHtml.includes('href="../client/login.html"'), 'Must link to client login page');
    });
  });

  describe('3. Contrast & Visibility Defect Safeguards', () => {
    test('Auth Modal title in index.html is styled with bright high-contrast color', () => {
      assert.ok(
        indexHtml.includes('.auth-modal-title') && indexHtml.includes('color: #FFFFFF !important'),
        '.auth-modal-title CSS must enforce bright pure white text'
      );
      assert.ok(
        indexHtml.includes('id="auth-modal-title"'),
        'index.html must contain #auth-modal-title'
      );
    });

    test('js/app.js explicitly wraps Pivot Aide in white span on modal open/switch', () => {
      assert.ok(
        appJs.includes('<span style="color:#FFFFFF !important;font-weight:700;">Pivot Aide </span>'),
        'Modal title controller must enforce bright white text on dynamically rendered title'
      );
    });
  });

  describe('4. Gateway Direct Navigation to Dedicated Pages', () => {
    test('Gateway buttons have direct hrefs to dedicated pages', () => {
      assert.ok(indexHtml.includes('href="client/login.html"'), 'Client button must link to client/login.html');
      assert.ok(indexHtml.includes('href="firm/login.html"'), 'Firm button must link to firm/login.html');
    });

    test('Gateway click listeners in app.js direct-navigate to dedicated login pages', () => {
      assert.ok(
        appJs.includes("window.location.href = 'client/login.html'"),
        'Must route unauthenticated taxpayers to client/login.html'
      );
      assert.ok(
        appJs.includes("window.location.href = 'firm/login.html'"),
        'Must route unauthenticated practitioners to firm/login.html'
      );
    });
  });

  describe('5. Visible Scrollbar & Page Scrolling Safeguards', () => {
    test('Firm login page enables scrolling and defines visible custom scrollbar', () => {
      assert.ok(
        firmLoginHtml.includes('overflow-y: scroll !important') || firmLoginHtml.includes('overflow-y: auto !important'),
        'firm/login.html must override app.css overflow:hidden'
      );
      assert.ok(
        firmLoginHtml.includes('scrollbar-color: #019FFF') || firmLoginHtml.includes('::-webkit-scrollbar'),
        'firm/login.html must style visible scrollbar'
      );
    });

    test('Client login page enables scrolling and defines visible custom scrollbar', () => {
      assert.ok(
        clientLoginHtml.includes('overflow-y: scroll !important') || clientLoginHtml.includes('overflow-y: auto !important'),
        'client/login.html must override app.css overflow:hidden'
      );
      assert.ok(
        clientLoginHtml.includes('scrollbar-color: #EAE42F') || clientLoginHtml.includes('::-webkit-scrollbar'),
        'client/login.html must style visible scrollbar'
      );
    });
  });

  describe('6. Canonical Uncle Pat Mascot Illustration Completeness', () => {
    test('Firm login page contains full Uncle Pat mascot with suit, collar flaps, and gold tie', () => {
      assert.ok(firmLoginHtml.includes('<symbol id="pat"'), 'firm/login.html must include symbol id="pat"');
      assert.ok(firmLoginHtml.includes('fill="#EAE42F"'), 'firm/login.html mascot must have gold tie / beak fill');
      assert.ok(firmLoginHtml.includes('fill="#CFC922"'), 'firm/login.html mascot must have gold tie knot');
      assert.ok(firmLoginHtml.includes('M52 46 L46 10 L88 34 Z'), 'firm/login.html mascot must have ear tufts');
      assert.ok(firmLoginHtml.includes('M63 141 L100 170 L79 199 L43 161 Z'), 'firm/login.html mascot must have white collar flaps');
    });

    test('Client login page contains full Uncle Pat mascot with suit, collar flaps, and gold tie', () => {
      assert.ok(clientLoginHtml.includes('<symbol id="pat"'), 'client/login.html must include symbol id="pat"');
      assert.ok(clientLoginHtml.includes('fill="#EAE42F"'), 'client/login.html mascot must have gold tie / beak fill');
      assert.ok(clientLoginHtml.includes('fill="#CFC922"'), 'client/login.html mascot must have gold tie knot');
      assert.ok(clientLoginHtml.includes('M52 46 L46 10 L88 34 Z'), 'client/login.html mascot must have ear tufts');
      assert.ok(clientLoginHtml.includes('M63 141 L100 170 L79 199 L43 161 Z'), 'client/login.html mascot must have white collar flaps');
    });
  });
});

