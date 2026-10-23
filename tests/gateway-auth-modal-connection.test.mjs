/**
 * ============================================================================
 * UNIT TEST SUITE: GATEWAY LAUNCH BUTTONS & AUTH MODAL CONNECTION
 * ============================================================================
 * 
 * Verifies:
 * 1. Gateway Launch Button Attributes & Direct Fallbacks (client/login.html & firm/login.html)
 * 2. Auth Modal Dual Portal Tab Architecture (#tab-modal-client & #tab-modal-firm)
 * 3. Practitioner Credential Fields & NIST AAL2 2FA Challenge in Firm Operations Tab
 * 4. CSS Smooth Transition Animations (@keyframes authFadeSlide, .auth-tab-enter, .is-hidden)
 * 5. JavaScript Modal Controller Execution & Tab Switching Lifecycle
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Gateway Launch Buttons & Auth Modal Interconnection', () => {
  const indexPath = path.resolve('c:/Users/user/Desktop/web app1/web app/index.html');
  const appJsPath = path.resolve('c:/Users/user/Desktop/web app1/web app/js/app.js');
  let indexHtml = '';
  let appJs = '';

  beforeEach(() => {
    assert.ok(fs.existsSync(indexPath), 'index.html must exist on disk');
    assert.ok(fs.existsSync(appJsPath), 'js/app.js must exist on disk');
    indexHtml = fs.readFileSync(indexPath, 'utf8');
    appJs = fs.readFileSync(appJsPath, 'utf8');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Gateway Launch Buttons Markup & Fallback Navigation
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Gateway Launch Buttons Markup & Direct Fallback Links', () => {
    test('Client Gateway button connects to Client Portal with fallback href="client/login.html"', () => {
      assert.ok(
        indexHtml.includes('id="btn-demo-client-dash"'),
        'index.html must contain #btn-demo-client-dash'
      );
      assert.ok(
        indexHtml.includes('href="client/login.html"'),
        'Client gateway button must have direct navigation fallback href="client/login.html"'
      );
      assert.ok(
        indexHtml.includes('Launch Client Portal'),
        'Client gateway button must display "Launch Client Portal"'
      );
      assert.ok(
        indexHtml.includes('data-portal="client"'),
        'Client gateway button must specify data-portal="client"'
      );
    });

    test('Firm Dashboard card is removed from gateway switchboard', () => {
      assert.ok(
        !indexHtml.includes('id="btn-demo-firm-dash"'),
        'index.html gateway must not contain #btn-demo-firm-dash firm dashboard card'
      );
      assert.ok(
        !indexHtml.includes('Firm Operations Console</h2>'),
        'index.html gateway must not contain Firm Operations Console card'
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Auth Modal Primary Tab Architecture & Practitioner Credential Fields
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Auth Modal Primary Tab Architecture & Practitioner Credential Fields', () => {
    test('#auth-modal contains primary portal tab switcher (Client Portal vs Firm Operations)', () => {
      assert.ok(
        indexHtml.includes('id="auth-portal-tabs"'),
        'Auth modal must contain #auth-portal-tabs navigation'
      );
      assert.ok(
        indexHtml.includes('id="tab-modal-client"'),
        'Auth modal must contain #tab-modal-client tab button'
      );
      assert.ok(
        indexHtml.includes('id="tab-modal-firm"'),
        'Auth modal must contain #tab-modal-firm tab button'
      );
    });

    test('#auth-modal contains secondary taxpayer sub-tab switcher', () => {
      assert.ok(
        indexHtml.includes('id="auth-client-tabs"'),
        'Auth modal must contain #auth-client-tabs'
      );
      assert.ok(
        indexHtml.includes('id="tab-client-signin"'),
        'Auth modal must contain #tab-client-signin'
      );
      assert.ok(
        indexHtml.includes('id="tab-client-signup"'),
        'Auth modal must contain #tab-client-signup'
      );
    });

    test('Firm Operations tab contains complete practitioner credential fields', () => {
      assert.ok(
        indexHtml.includes('id="form-modal-practitioner"'),
        'Must contain practitioner authentication form'
      );
      assert.ok(
        indexHtml.includes('id="modal-firm-email"'),
        'Must contain IRS Registered Practitioner Email input'
      );
      assert.ok(
        indexHtml.includes('id="modal-firm-pass"'),
        'Must contain Master Password input'
      );
      assert.ok(
        indexHtml.includes('id="modal-firm-ptin"'),
        'Must contain IRS PTIN / Staff Badge ID input'
      );
      assert.ok(
        indexHtml.includes('id="otp-firm-signin"'),
        'Must contain NIST AAL2 2FA OTP code challenge container'
      );
      assert.ok(
        indexHtml.includes('id="modal-btn-google-firm"'),
        'Must contain domain-restricted Google Workspace button'
      );
      assert.ok(
        indexHtml.includes('id="modal-guardrail-403"'),
        'Must contain 403 Forbidden unauthorized role banner'
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. CSS Smooth Transition Animations
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. CSS Smooth Transition Animations for Tabs & Card', () => {
    test('Defines auth-portal-tabs and active pill styling', () => {
      assert.ok(
        indexHtml.includes('.auth-portal-tabs'),
        'CSS must define .auth-portal-tabs container'
      );
      assert.ok(
        indexHtml.includes('.auth-portal-tab'),
        'CSS must define .auth-portal-tab buttons'
      );
      assert.ok(
        indexHtml.includes('.auth-portal-tab.active[data-portal="client"]'),
        'CSS must style active client portal tab with gold accent'
      );
      assert.ok(
        indexHtml.includes('.auth-portal-tab.active[data-portal="firm"]'),
        'CSS must style active firm portal tab with cyan accent'
      );
    });

    test('Defines smooth collapse transition for client sub-tabs (.is-hidden)', () => {
      assert.ok(
        indexHtml.includes('.auth-modal-tabs.is-hidden'),
        'CSS must define .auth-modal-tabs.is-hidden for smooth collapse'
      );
      assert.ok(
        indexHtml.includes('max-height'),
        'Sub-tabs must animate max-height for fluid accordion motion'
      );
    });

    test('Defines smooth fade and slide transition animation (@keyframes authFadeSlide)', () => {
      assert.ok(
        indexHtml.includes('@keyframes authFadeSlide'),
        'CSS must define @keyframes authFadeSlide'
      );
      assert.ok(
        indexHtml.includes('.auth-modal-form'),
        'Forms must animate with smooth fade and slide'
      );
      assert.ok(
        indexHtml.includes('.auth-tab-enter'),
        'CSS must provide .auth-tab-enter class for dynamic JS re-triggering'
      );
    });

    test('Modal card transitions border-color and box-shadow smoothly', () => {
      assert.ok(
        indexHtml.includes('border-color 0.28s ease') || indexHtml.includes('box-shadow 0.28s ease'),
        'Modal card must transition border-color and box-shadow smoothly'
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. JavaScript Gateway Interconnection & Tab Switching Controller
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. JavaScript Gateway Interconnection & Controller Engine', () => {
    test('Gateway buttons in js/app.js open auth-modal via FileRoomAuthModal', () => {
      assert.ok(
        appJs.includes("window.FileRoomAuthModal.open('client')"),
        'Client gateway click must open modal in client mode'
      );
      assert.ok(
        appJs.includes("window.FileRoomAuthModal.open('firm')"),
        'Firm gateway click must open modal in firm mode'
      );
    });

    test('Maintains fallback navigation routes for test and browser compatibility', () => {
      assert.ok(
        appJs.includes("window.location.href = 'client/dashboard.html'"),
        'Must retain client/dashboard.html navigation path'
      );
      assert.ok(
        appJs.includes("window.location.href = 'firm/dashboard.html'"),
        'Must retain firm/dashboard.html navigation path'
      );
      assert.ok(
        appJs.includes("window.location.href = 'client/login.html'"),
        'Must retain fallback to client/login.html'
      );
      assert.ok(
        appJs.includes("window.location.href = 'firm/login.html'"),
        'Must retain fallback to firm/login.html'
      );
    });

    test('FileRoomAuthModal exports open, close, switchPortal, and setClientTab APIs', () => {
      assert.ok(
        appJs.includes('window.FileRoomAuthModal = {') &&
        appJs.includes('switchPortal:') &&
        appJs.includes('setClientTab:'),
        'FileRoomAuthModal must expose full tab navigation API'
      );
    });

    test('Primary portal switcher attaches click listeners to #tab-modal-client and #tab-modal-firm', () => {
      assert.ok(
        appJs.includes("tabPortalClient.addEventListener('click'") &&
        appJs.includes("tabPortalFirm.addEventListener('click'"),
        'Controller must wire tabPortalClient and tabPortalFirm click listeners'
      );
    });

    test('triggerTransition forces reflow to play smooth CSS animations on tab switch', () => {
      assert.ok(
        appJs.includes('triggerTransition') && appJs.includes('auth-tab-enter'),
        'Controller must implement triggerTransition with auth-tab-enter class'
      );
    });
  });
});
