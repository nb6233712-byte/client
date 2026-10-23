/**
 * ============================================================================
 * TEST SUITE: SHARED LAYOUT & NAVIGATION ARCHITECTURE (PIVOT AIDE TAX)
 * ============================================================================
 * 
 * Verifies:
 * 1. Client Portal & Firm Console Navigation Configurations
 * 2. Shared Header, Appbar, and Interactive User Menu Dropdown
 * 3. Responsive Sidebar Navigation and Active Page Indicators
 * 4. Interconnection & Persona Switcher Buttons
 * 5. Breadcrumb Navigation Rendering
 * 6. Component Lifecycle States (Loading, Empty, Error, Live)
 * 7. HTML File Structural Integrity for client/dashboard.html & firm/dashboard.html
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Shared Layout & Navigation Architecture', () => {

  const baseDir = path.resolve('c:/Users/user/Desktop/web app1/web app');

  describe('1. File Integrity & Asset Linkage', () => {
    test('css/shared-layout.css exists and defines core layout classes', () => {
      const cssPath = path.join(baseDir, 'css/shared-layout.css');
      assert.ok(fs.existsSync(cssPath), 'shared-layout.css must exist');
      const content = fs.readFileSync(cssPath, 'utf8');
      assert.ok(content.includes('.breadcrumbs'), 'Must define .breadcrumbs');
      assert.ok(content.includes('.user-menu-dropdown'), 'Must define .user-menu-dropdown');
      assert.ok(content.includes('.loading-spinner'), 'Must define .loading-spinner');
      assert.ok(content.includes('.empty-state-card'), 'Must define .empty-state-card');
      assert.ok(content.includes('.error-state-card'), 'Must define .error-state-card');
    });

    test('js/core/layout.js exists and exports FileRoomLayout API', () => {
      const jsPath = path.join(baseDir, 'js/core/layout.js');
      assert.ok(fs.existsSync(jsPath), 'layout.js must exist');
      const content = fs.readFileSync(jsPath, 'utf8');
      assert.ok(content.includes('FileRoomLayout = Layout'), 'Must export FileRoomLayout');
      assert.ok(content.includes('CLIENT_NAV_CONFIG'), 'Must define CLIENT_NAV_CONFIG');
      assert.ok(content.includes('FIRM_NAV_CONFIG'), 'Must define FIRM_NAV_CONFIG');
    });

    test('client/dashboard.html exists and links all shared dependencies', () => {
      const htmlPath = path.join(baseDir, 'client/dashboard.html');
      assert.ok(fs.existsSync(htmlPath), 'client/dashboard.html must exist');
      const content = fs.readFileSync(htmlPath, 'utf8');
      assert.ok(content.includes('href="../css/variables.css"'), 'Must link variables.css');
      assert.ok(content.includes('href="../css/app.css"'), 'Must link app.css');
      assert.ok(content.includes('href="../css/shared-layout.css"'), 'Must link shared-layout.css');
      assert.ok(content.includes('src="../js/core/layout.js"'), 'Must link layout.js');
      assert.ok(content.includes('id="page-breadcrumbs"'), 'Must contain breadcrumbs container');
      assert.ok(content.includes('id="dashboard-content-area"'), 'Must contain main content area');
    });

    test('firm/dashboard.html exists and links all shared dependencies', () => {
      const htmlPath = path.join(baseDir, 'firm/dashboard.html');
      assert.ok(fs.existsSync(htmlPath), 'firm/dashboard.html must exist');
      const content = fs.readFileSync(htmlPath, 'utf8');
      assert.ok(content.includes('href="../css/variables.css"'), 'Must link variables.css');
      assert.ok(content.includes('href="../css/app.css"'), 'Must link app.css');
      assert.ok(content.includes('href="../css/shared-layout.css"'), 'Must link shared-layout.css');
      assert.ok(content.includes('src="../js/core/layout.js"'), 'Must link layout.js');
      assert.ok(content.includes('id="page-breadcrumbs"'), 'Must contain breadcrumbs container');
      assert.ok(content.includes('id="dashboard-content-area"'), 'Must contain main content area');
    });
  });

  describe('2. Navigation Configurations & Route Alignment', () => {
    test('Client Navigation targets all 9 proposed client modules', () => {
      const jsContent = fs.readFileSync(path.join(baseDir, 'js/core/layout.js'), 'utf8');
      const expectedPages = [
        'dashboard.html',
        'documents.html',
        'signatures.html',
        'tax-return.html',
        'messages.html',
        'services.html',
        'billing.html',
        'updates.html',
        'profile.html'
      ];

      for (const page of expectedPages) {
        assert.ok(jsContent.includes(`path: '${page}'`), `Client nav must include target page ${page}`);
      }
    });

    test('Firm Navigation targets all 12 proposed firm modules + 2 exhibits', () => {
      const jsContent = fs.readFileSync(path.join(baseDir, 'js/core/layout.js'), 'utf8');
      const expectedPages = [
        'dashboard.html',
        'clients.html',
        'workflow.html',
        'documents.html',
        'returns.html',
        'signatures.html',
        'messages.html',
        'services.html',
        'billing.html',
        'tasks.html',
        'audit-log.html',
        'staff.html',
        'exhibit-a.html',
        'exhibit-b.html'
      ];

      for (const page of expectedPages) {
        assert.ok(jsContent.includes(`path: '${page}'`), `Firm nav must include target page ${page}`);
      }
    });
  });

  describe('3. Interconnection & Persona Switcher', () => {
    test('Client Portal header & sidebar point switcher to ../firm/dashboard.html', () => {
      const jsContent = fs.readFileSync(path.join(baseDir, 'js/core/layout.js'), 'utf8');
      assert.ok(
        jsContent.includes("isFirm ? '../client/dashboard.html' : '../firm/dashboard.html'"),
        'Dashboard switcher must route between client and firm workspaces'
      );
    });

    test('Gateway demo buttons in js/app.js navigate to dedicated dashboard landing pages', () => {
      const appJs = fs.readFileSync(path.join(baseDir, 'js/app.js'), 'utf8');
      assert.ok(appJs.includes("window.location.href = 'client/dashboard.html'"), 'Client demo button must navigate to client/dashboard.html');
      assert.ok(appJs.includes("window.location.href = 'firm/dashboard.html'"), 'Firm demo button must navigate to firm/dashboard.html');
    });
  });

  describe('4. Component State Lifecycle Engine', () => {
    test('Layout API exposes renderLoading, renderEmpty, and renderError', () => {
      const jsContent = fs.readFileSync(path.join(baseDir, 'js/core/layout.js'), 'utf8');
      assert.ok(jsContent.includes('renderLoading: function'), 'Must expose renderLoading');
      assert.ok(jsContent.includes('renderEmpty: function'), 'Must expose renderEmpty');
      assert.ok(jsContent.includes('renderError: function'), 'Must expose renderError');
      assert.ok(jsContent.includes('showToast: function'), 'Must expose showToast');
      assert.ok(jsContent.includes('openModal: function'), 'Must expose openModal');
      assert.ok(jsContent.includes('closeModal: function'), 'Must expose closeModal');
    });

    test('Client dashboard implements interactive state switcher controls', () => {
      const clientHtml = fs.readFileSync(path.join(baseDir, 'client/dashboard.html'), 'utf8');

      for (const html of [clientHtml]) {
        assert.ok(html.includes('id="btn-state-live"'), 'Must have Live State toggle');
        assert.ok(html.includes('id="btn-state-loading"'), 'Must have Loading State toggle');
        assert.ok(html.includes('id="btn-state-empty"'), 'Must have Empty State toggle');
        assert.ok(html.includes('id="btn-state-error"'), 'Must have Error State toggle');
      }
    });
  });

  describe('5. Back-Forward Cache (bfcache) & WebSocket Lifecycle Guard', () => {
    test('js/core/layout.js defines bfcache lifecycle guard and pagehide cleanup', () => {
      const jsContent = fs.readFileSync(path.join(baseDir, 'js/core/layout.js'), 'utf8');
      assert.ok(jsContent.includes('initBfcacheLifecycleGuard'), 'Must define initBfcacheLifecycleGuard');
      assert.ok(jsContent.includes("addEventListener('pagehide'"), 'Must handle pagehide event for bfcache');
      assert.ok(jsContent.includes("ws.close(1000, 'Page entered Back-Forward Cache')"), 'Must cleanly close sockets on pagehide');
      assert.ok(jsContent.includes("addEventListener('pageshow'"), 'Must handle pageshow event for bfcache restoration');
    });

    test('js/firebase.js observer re-broadcasts auth state upon bfcache restoration', () => {
      const fbContent = fs.readFileSync(path.join(baseDir, 'js/firebase.js'), 'utf8');
      assert.ok(fbContent.includes("addEventListener('pageshow'"), 'Must observe pageshow in firebase.js');
      assert.ok(fbContent.includes('maintaining active session after bfcache restore'), 'Must log and restore session');
    });
  });

  describe('6. Header Appbar Firebase Backend Integration', () => {
    test('layout.js exports connection lifecycle and user context updater helpers', () => {
      const jsContent = fs.readFileSync(path.join(baseDir, 'js/core/layout.js'), 'utf8');
      assert.ok(jsContent.includes('bindConnectionLifecycle: function'), 'Must define bindConnectionLifecycle');
      assert.ok(jsContent.includes('updateConnectionStatus: function'), 'Must define updateConnectionStatus');
      assert.ok(jsContent.includes('updateUserContext: function'), 'Must define updateUserContext');
    });

    test('firebase-status-badge is interactive and reflects piovde-tax project', () => {
      const jsContent = fs.readFileSync(path.join(baseDir, 'js/core/layout.js'), 'utf8');
      assert.ok(jsContent.includes('id="firebase-status-badge"'), 'Must define firebase-status-badge');
      assert.ok(jsContent.includes("style=\"cursor:pointer\""), 'Badge must be clickable for ping test');
      assert.ok(jsContent.includes('piovde-tax'), 'Badge must reference piovde-tax project');
    });

    test('notification bell queries live updates and exposes unread dot', () => {
      const jsContent = fs.readFileSync(path.join(baseDir, 'js/core/layout.js'), 'utf8');
      assert.ok(jsContent.includes('id="appbar-bell-dot"'), 'Must define appbar-bell-dot');
      assert.ok(jsContent.includes('getUnreadUpdatesCount'), 'Must check getUnreadUpdatesCount');
      assert.ok(jsContent.includes("collFn(db, 'updates')"), 'Must bind to live Firestore updates collection');
    });

    test('signoutHandler flushes all auth tokens and invokes FirebaseBridge.signOut', () => {
      const jsContent = fs.readFileSync(path.join(baseDir, 'js/core/layout.js'), 'utf8');
      assert.ok(jsContent.includes('localStorage.removeItem(\'tfr_user_session\')'), 'Must purge session cache');
      assert.ok(jsContent.includes('FirebaseBridge.signOut()'), 'Must invoke FirebaseBridge.signOut');
    });

    test('showArchitectureRulesModal features live Firebase backend status', () => {
      const jsContent = fs.readFileSync(path.join(baseDir, 'js/core/layout.js'), 'utf8');
      assert.ok(jsContent.includes('Live Firebase Backend: Connected'), 'Rules modal must display live Firebase Backend status');
      assert.ok(jsContent.includes('piovde-tax'), 'Rules modal must display piovde-tax project name');
    });

    test('css/shared-layout.css defines .firebase-badge.offline styling', () => {
      const cssContent = fs.readFileSync(path.join(baseDir, 'css/shared-layout.css'), 'utf8');
      assert.ok(cssContent.includes('.firebase-badge.offline'), 'Must style .firebase-badge.offline state');
      assert.ok(cssContent.includes('#e74c3c'), 'Offline badge must display red indicator');
    });

    test('Firm Console appbar omits Client Portal switcher button while preserving online badge', () => {
      const jsContent = fs.readFileSync(path.join(baseDir, 'js/core/layout.js'), 'utf8');
      assert.ok(jsContent.includes("switchButtonHtml = isFirm ? '' :"), 'Firm console must omit the Client Portal button');
      assert.ok(jsContent.includes('firebase-status-badge'), 'Online status badge must remain present');
    });

    test('Client Portal appbar omits both switcher button and online badge', () => {
      const jsContent = fs.readFileSync(path.join(baseDir, 'js/core/layout.js'), 'utf8');
      assert.ok(jsContent.includes("switchButtonHtml = isFirm ? '' : ''"), 'Client Portal must omit switcher button');
      assert.ok(jsContent.includes("statusBadgeHtml = isFirm ?"), 'Client Portal must omit online status badge');
    });
  });
});

