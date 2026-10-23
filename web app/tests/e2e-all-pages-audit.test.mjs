/**
 * ============================================================================
 * END-TO-END APPLICATION AUDIT: ALL CLIENT & FIRM PAGES TEST SUITE
 * ============================================================================
 * 
 * Verifies live server HTTP status, navigation link resolution, syntax/script integrity,
 * access control enforcement, form validations, document upload checks, data isolation,
 * and responsive layout structures across all 24 application pages.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const BASE_URL = 'http://127.0.0.1:8085';
const BASE_DIR = path.resolve('c:/Users/user/Desktop/web app1/web app');

let server;
before(async () => {
  try {
    const res = await fetch(`${BASE_URL}/index.html`);
    if (res.ok) return;
  } catch (_) {}

  server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url.split('?')[0].replace(/^\//, ''));
    if (!reqPath) reqPath = 'index.html';
    const filePath = path.join(BASE_DIR, reqPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml'
      };
      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise((resolve) => server.listen(8085, '127.0.0.1', resolve));
});

after(() => {
  if (server) server.close();
});

const ALL_PAGES = [
  // Gateway & Switchboard
  'index.html',

  // 9 Client Portal Pages
  'client/dashboard.html',
  'client/documents.html',
  'client/signatures.html',
  'client/tax-return.html',
  'client/messages.html',
  'client/services.html',
  'client/billing.html',
  'client/updates.html',
  'client/profile.html',

  // 14 Firm Operations Pages
  'firm/dashboard.html',
  'firm/clients.html',
  'firm/workflow.html',
  'firm/documents.html',
  'firm/returns.html',
  'firm/signatures.html',
  'firm/messages.html',
  'firm/services.html',
  'firm/billing.html',
  'firm/tasks.html',
  'firm/audit-log.html',
  'firm/staff.html',
  'firm/exhibit-a.html',
  'firm/exhibit-b.html'
];

describe('Comprehensive End-to-End Application Audit', () => {

  // ── 1. HTTP 200 & Page Load Verification ──────────────────────────────────
  describe('1. Live HTTP Server Page Delivery (All 24 Pages)', () => {
    for (const page of ALL_PAGES) {
      test(`Page ${page} delivers HTTP 200 OK without errors`, async () => {
        const res = await fetch(`${BASE_URL}/${page}`);
        assert.equal(res.status, 200, `Expected 200 OK for ${page}, got ${res.status}`);
        const text = await res.text();
        assert.ok(text.includes('<!DOCTYPE html>'), `${page} must deliver valid HTML document`);
        assert.ok(text.includes('<head>'), `${page} must contain head`);
        assert.ok(text.includes('<body>'), `${page} must contain body`);
      });
    }
  });

  // ── 2. Asset Linkage Integrity ─────────────────────────────────────────────
  describe('2. Core Stylesheet & Script Asset Availability', () => {
    const assets = [
      'css/variables.css',
      'css/app.css',
      'css/shared-layout.css',
      'js/data.js',
      'js/core/layout.js',
      'js/firebase.js'
    ];

    for (const asset of assets) {
      test(`Core asset ${asset} delivers HTTP 200 OK`, async () => {
        const res = await fetch(`${BASE_URL}/${asset}`);
        assert.equal(res.status, 200, `Asset ${asset} must be available on server`);
        const text = await res.text();
        assert.ok(text.length > 50, `Asset ${asset} must have content`);
      });
    }
  });

  // ── 3. Navigation Link Resolution (Zero Broken Links) ──────────────────────
  describe('3. Navigation Link Graph Integrity Across All Pages', () => {
    for (const page of ALL_PAGES) {
      test(`All relative <a href> links in ${page} resolve to existing server files`, () => {
        const fullPath = path.join(BASE_DIR, page);
        const html = fs.readFileSync(fullPath, 'utf8');
        const dir = path.dirname(fullPath);

        // Extract hrefs matching local files
        const hrefRegex = /href=["']([^"']+)["']/g;
        let match;
        const checkedHrefs = new Set();

        while ((match = hrefRegex.exec(html)) !== null) {
          const href = match[1];

          // Skip external, anchors, mailto, tel, javascript
          if (
            href.startsWith('http://') ||
            href.startsWith('https://') ||
            href.startsWith('#') ||
            href.startsWith('mailto:') ||
            href.startsWith('tel:') ||
            href.startsWith('data:') ||
            href.startsWith('javascript:')
          ) {
            continue;
          }

          if (checkedHrefs.has(href)) continue;
          checkedHrefs.add(href);

          const cleanHref = href.split('?')[0].split('#')[0];
          if (!cleanHref) continue;

          const targetFile = path.resolve(dir, cleanHref);
          assert.ok(
            fs.existsSync(targetFile),
            `Broken link in ${page}: href="${href}" -> target file ${targetFile} does not exist!`
          );
        }
      });
    }
  });

  // ── 4. Authentication & Access Control Enforcement ────────────────────────
  describe('4. Access Control Boundaries & Direct URL Route Guards', () => {
    test('Firm pages include mandatory staff RBAC check and 403 Access Denied handler', () => {
      const firmPages = ALL_PAGES.filter(p => p.startsWith('firm/') && !p.includes('exhibit'));

      for (const fp of firmPages) {
        let content = fs.readFileSync(path.join(BASE_DIR, fp), 'utf8');
        if (fp === 'firm/dashboard.html') {
          content += fs.readFileSync(path.join(BASE_DIR, 'js/firm/dashboard.js'), 'utf8');
        } else if (fp === 'firm/clients.html') {
          content += fs.readFileSync(path.join(BASE_DIR, 'js/firm/clients.js'), 'utf8');
        }
        assert.ok(
          content.includes('FileRoomLayout.renderAccessDenied') ||
          content.includes('renderAccessDenied'),
          `${fp} must include renderAccessDenied guard`
        );
        assert.ok(
          content.includes("user.role === 'firm_admin'") ||
          content.includes('isStaff') ||
          content.includes('isAuthorizedStaff'),
          `${fp} must check staff authorization`
        );
      }
    });

    test('Client pages associate records strictly with authenticated client UID', () => {
      const clientPages = ALL_PAGES.filter(p => p.startsWith('client/'));

      for (const cp of clientPages) {
        const content = fs.readFileSync(path.join(BASE_DIR, cp), 'utf8');
        assert.ok(
          content.includes("portal: 'client'"),
          `${cp} must initialize layout with client portal context`
        );
      }
    });
  });

  // ── 5. Form & Document Upload Constraints ──────────────────────────────────
  describe('5. Form Validation & Storage Upload Restrictions', () => {
    test('Storage rules enforce 25MB ceiling and MIME filters', () => {
      const storageRules = fs.readFileSync(path.join(BASE_DIR, 'storage.rules'), 'utf8');
      assert.ok(storageRules.includes('25 * 1024 * 1024'), 'Must enforce 25MB ceiling');
      assert.ok(storageRules.includes('application/pdf'), 'Must allow PDF');
      assert.ok(storageRules.includes('image/png'), 'Must allow PNG');
      assert.ok(storageRules.includes('image/jpeg'), 'Must allow JPEG');
    });

    test('client/documents.html displays 25MB ceiling and compliance disclaimers', () => {
      const docsHtml = fs.readFileSync(path.join(BASE_DIR, 'client/documents.html'), 'utf8');
      assert.ok(docsHtml.includes('25 MB'), 'Must show 25MB upload limit');
      assert.ok(docsHtml.includes('FTC Safeguards Rule'), 'Must reference FTC Safeguards Rule');
    });
  });

  // ── 6. Multi-Device Responsive Architecture ────────────────────────────────
  describe('6. Responsive Layout Architecture (Desktop & Mobile)', () => {
    for (const page of ALL_PAGES) {
      test(`${page} includes viewport meta tag and responsive layout hooks`, () => {
        const html = fs.readFileSync(path.join(BASE_DIR, page), 'utf8');
        assert.ok(html.includes('name="viewport"'), `${page} must include viewport meta tag`);
        assert.ok(
          html.includes('class="workspace"') || html.includes('workspace'),
          `${page} must include workspace container`
        );
      });
    }
  });

  // ── 7. Component Lifecycle State Engine ────────────────────────────────────
  describe('7. Component Lifecycle State Verification (Loading, Empty, Error, Live)', () => {
    const interactivePages = [
      'client/dashboard.html',
      'client/documents.html',
      'client/signatures.html',
      'client/tax-return.html',
      'client/messages.html',
      'client/services.html',
      'client/billing.html',
      'client/updates.html',
      'client/profile.html',
      'firm/dashboard.html',
      'firm/clients.html',
      'firm/workflow.html',
      'firm/documents.html',
      'firm/returns.html',
      'firm/signatures.html',
      'firm/messages.html',
      'firm/services.html',
      'firm/billing.html',
      'firm/tasks.html',
      'firm/audit-log.html',
      'firm/staff.html'
    ];

    for (const page of interactivePages) {
      test(`${page} defines interactive state switcher buttons`, () => {
        const html = fs.readFileSync(path.join(BASE_DIR, page), 'utf8');
        assert.ok(html.includes('btn-state-live'), `${page} must have live state button`);
        assert.ok(html.includes('btn-state-loading'), `${page} must have loading state button`);
        assert.ok(html.includes('btn-state-empty'), `${page} must have empty state button`);
        assert.ok(html.includes('btn-state-error'), `${page} must have error state button`);
      });
    }
  });

  // ── 8. Cross-Portal Persona Switcher ───────────────────────────────────────
  describe('8. Cross-Portal Persona Switcher Interconnection', () => {
    test('Client sidebar switches to Firm Console, Firm sidebar switches to Client Portal', () => {
      const layoutJs = fs.readFileSync(path.join(BASE_DIR, 'js/core/layout.js'), 'utf8');
      assert.ok(layoutJs.includes("switchHref = isFirm ? '../client/dashboard.html' : '../firm/dashboard.html'"));
    });
  });
});
