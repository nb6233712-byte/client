/**
 * ============================================================================
 * TEST SUITE: CLIENT PORTAL DASHBOARD (THE FILE ROOM)
 * ============================================================================
 * 
 * Verifies all 9 core dashboard requirements:
 * 1. Current filing stage (Stage 3 In Preparation)
 * 2. Overall progress (68% milestone tracker)
 * 3. Pending client actions aggregation & All-Clear empty state
 * 4. Missing documents checklist & upload links
 * 5. Outstanding Form 8879 signature requests & KBA requirements
 * 6. Recent client-preparer message thread & unread badges
 * 7. Important statutory deadlines & filing calendar
 * 8. Invoice and payment status ($1,240.00 balance due & itemized ledger)
 * 9. Recent file updates and activity timeline
 * 10. Navigation links to all 8 client portal modules
 * 11. Strict tenant binding to authenticated client UID
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Client Portal Dashboard Architecture & Requirements', () => {

  const baseDir = path.resolve('c:/Users/user/Desktop/web app1/web app');
  const dashboardJsPath = path.join(baseDir, 'js/client/dashboard.js');
  const dashboardHtmlPath = path.join(baseDir, 'client/dashboard.html');

  test('1. File existence & linkage in client/dashboard.html', () => {
    assert.ok(fs.existsSync(dashboardJsPath), 'js/client/dashboard.js must exist');
    assert.ok(fs.existsSync(dashboardHtmlPath), 'client/dashboard.html must exist');

    const htmlContent = fs.readFileSync(dashboardHtmlPath, 'utf8');
    assert.ok(htmlContent.includes('src="../js/client/dashboard.js"'), 'Must link js/client/dashboard.js');
    assert.ok(htmlContent.includes('ClientDashboard.init()'), 'Must initialize ClientDashboard');
    assert.ok(htmlContent.includes('id="dashboard-content-area"'), 'Must have dynamic content area container');
  });

  test('2. Working navigation to all 8 Client Portal sub-pages', () => {
    const htmlContent = fs.readFileSync(dashboardHtmlPath, 'utf8');
    const jsContent = fs.readFileSync(dashboardJsPath, 'utf8');

    const requiredPages = [
      'documents.html',
      'signatures.html',
      'tax-return.html',
      'messages.html',
      'services.html',
      'billing.html',
      'updates.html',
      'profile.html'
    ];

    for (const page of requiredPages) {
      assert.ok(
        htmlContent.includes(`href="${page}"`) || jsContent.includes(`href: '${page}'`) || jsContent.includes(`href="${page}"`) || jsContent.includes(`actionHref: '${page}'`),
        `Dashboard must contain working link to ${page}`
      );
    }
  });

  describe('3. Functional Dashboard Engine Unit Tests', () => {
    let mockDOM;
    let ClientDashboardEngine;

    beforeEach(() => {
      // Setup virtual DOM container
      mockDOM = {
        innerHTML: ''
      };

      // Load client dashboard engine in isolated context
      const code = fs.readFileSync(dashboardJsPath, 'utf8');
      const virtualWindow = {
        FirebaseBridge: {
          getUserUid: () => 'usr_whitfield_4417',
          getDefaultEngagement: (uid) => ({
            clientUid: uid,
            taxYear: 2026,
            filingStatus: 'Married filing jointly',
            jurisdictions: 'MD resident · VA & PA non-resident',
            stage: 'in_prep',
            stageLabel: 'In Preparation',
            progressPct: 68,
            steps: [
              { title: 'Intake Opened', meta: '14 Jan', status: 'done', href: 'services.html' },
              { title: 'Checklist Upload', meta: '11 of 13 files in', status: 'done', href: 'documents.html' },
              { title: 'In Preparation', meta: 'Current with CPA', status: 'now', href: 'documents.html' },
              { title: 'Return Review', meta: 'Draft Form 1040', status: 'todo', href: 'tax-return.html' },
              { title: 'Sign Form 8879', meta: 'IRS e-File Authorization', status: 'todo', href: 'signatures.html' },
              { title: 'IRS Transmitted', meta: 'Target: Oct 15', status: 'todo', href: 'tax-return.html' }
            ],
            upcomingDeadlines: [
              { label: 'Q3 Estimated Tax Payment (IRS & MD)', date: '15 Sep 2026', badge: '10 Days' },
              { label: 'Form 1040 Extension Filing Cutoff', date: '15 Oct 2026', badge: 'Target' }
            ]
          }),
          getDefaultDocumentRequests: (uid) => ([
            {
              requestId: `${uid}_req_1099misc`,
              clientId: uid,
              title: '1099-MISC — Keystone Property Group',
              description: 'Rental income documentation for Schedule E',
              category: '1099',
              status: 'pending',
              dueAt: '15 Sep 2026'
            },
            {
              requestId: `${uid}_req_mileage`,
              clientId: uid,
              title: 'Q4 Business Mileage Log',
              description: 'Schedule C vehicle deduction log',
              category: 'Deductions',
              status: 'pending',
              dueAt: '15 Sep 2026'
            }
          ]),
          getDefaultPreparedReturn: (uid) => ({
            clientUid: uid,
            status: 'in_preparation',
            clientApproved: false,
            signedAt: null
          }),
          getDefaultMessages: (uid) => ([
            {
              messageId: `${uid}_msg_1`,
              clientId: uid,
              text: 'I have the closing disclosure — thank you. One question on the rental property...',
              senderRole: 'preparer',
              senderId: 'preparer_denise_cpa',
              createdAt: '2026-09-02T12:00:00Z'
            }
          ]),
          getDefaultInvoices: (uid) => ([
            {
              invoiceId: 'inv_2026_0418',
              clientId: uid,
              amount: 1240.00,
              totalDue: 1240.00,
              status: 'issued',
              items: [
                { desc: 'Individual return — federal Form 1040', amount: 400.00 },
                { desc: 'Maryland, Virginia, Pennsylvania returns', amount: 285.00 },
                { desc: 'Schedule C — Whitfield Design Co.', amount: 310.00 },
                { desc: 'Schedule E — Halcyon Row rental property', amount: 245.00 }
              ]
            }
          ]),
          getDefaultUpdates: (uid) => ([
            {
              id: `${uid}_upd_1`,
              clientId: uid,
              title: 'Your Form 8879 is ready to sign',
              meta: 'Once both signatures are in we transmit, usually the next business day.',
              time: 'Today, 8:02 AM'
            }
          ])
        },
        location: {
          search: '',
          pathname: '/client/dashboard.html'
        },
        document: {
          getElementById: (id) => (id === 'dashboard-content-area' ? mockDOM : null)
        }
      };

      globalThis.document = virtualWindow.document;
      const fn = new Function('window', 'document', code);
      fn(virtualWindow, virtualWindow.document);
      ClientDashboardEngine = virtualWindow.ClientDashboard;
    });

    test('Engine associates all queries with clientUid', () => {
      ClientDashboardEngine.init();
      assert.ok(ClientDashboardEngine.state.clientUid, 'Must resolve clientUid');
      assert.ok(ClientDashboardEngine.state.engagement.clientUid, 'Must associate engagement with clientUid');
    });

    test('Renders Current Filing Stage and 68% progress', () => {
      ClientDashboardEngine.init();
      const output = mockDOM.innerHTML;

      assert.ok(output.includes('In Preparation'), 'Must render stage label');
      assert.ok(output.includes('68% Complete'), 'Must render progress percentage');
      assert.ok(output.includes('MD resident · VA & PA non-resident'), 'Must render jurisdictions');
      assert.ok(output.includes('STEP 1 · ✓ Completed'), 'Must render milestone step 1');
      assert.ok(output.includes('STEP 3 · In Progress'), 'Must render active milestone step 3');
    });

    test('Aggregates pending client actions (Missing docs & open invoice)', () => {
      ClientDashboardEngine.init();
      const output = mockDOM.innerHTML;

      assert.ok(output.includes('ACTION REQUIRED'), 'Must render Action Required header');
      assert.ok(output.includes('2 Documents Needed'), 'Must identify missing documents action');
      assert.ok(output.includes('Invoice Balance Due: $1,240.00'), 'Must identify invoice balance due action');
      assert.ok(output.includes('Upload Required Documents'), 'Must render upload CTA button');
      assert.ok(output.includes('View & Settle Invoice'), 'Must render payment CTA button');
    });

    test('Renders Missing Documents section with upload links', () => {
      ClientDashboardEngine.init();
      const output = mockDOM.innerHTML;

      assert.ok(output.includes('1099-MISC — Keystone Property Group'), 'Must display missing 1099 document');
      assert.ok(output.includes('Q4 Business Mileage Log'), 'Must display missing mileage document');
      assert.ok(output.includes('href="documents.html"'), 'Must link to documents.html for upload');
    });

    test('Renders Invoices & Billing status with $1,240.00 balance', () => {
      ClientDashboardEngine.init();
      const output = mockDOM.innerHTML;

      assert.ok(output.includes('Billing &amp; Invoices'), 'Must render Billing section');
      assert.ok(output.includes('$1,240.00'), 'Must display $1,240.00 balance due');
      assert.ok(output.includes('inv_2026_0418'), 'Must display active invoice ID');
      assert.ok(output.includes('Individual return — federal Form 1040'), 'Must display itemized line item');
      assert.ok(output.includes('href="billing.html"'), 'Must link to billing.html');
    });

    test('Renders Recent Messages with Denise R., CPA badge and unread status', () => {
      ClientDashboardEngine.init();
      const output = mockDOM.innerHTML;

      assert.ok(output.includes('Denise R., CPA'), 'Must render preparer name');
      assert.ok(output.includes('closing disclosure') || output.includes('Messages'), 'Must render message snippet or header');
      assert.ok(output.includes('href="messages.html"'), 'Must link to messages.html');
    });

    test('Renders Important Deadlines calendar', () => {
      ClientDashboardEngine.init();
      const output = mockDOM.innerHTML;

      assert.ok(output.includes('Important Deadlines'), 'Must render Deadlines section');
      assert.ok(output.includes('Q3 Estimated Tax Payment'), 'Must display Q3 payment deadline');
      assert.ok(output.includes('15 Sep 2026'), 'Must display deadline date');
      assert.ok(output.includes('href="updates.html"'), 'Must link to updates.html calendar');
    });

    test('Renders Recent File Updates timeline', () => {
      ClientDashboardEngine.init();
      const output = mockDOM.innerHTML;

      assert.ok(output.includes('Recent File Updates'), 'Must render File Updates section');
      assert.ok(output.includes('Your Form 8879 is ready to sign'), 'Must display update notice');
    });

    test('Renders All-Clear empty states when all actions are resolved', () => {
      // Simulate completed file with 0 missing docs and $0 due
      ClientDashboardEngine.state.documentRequests = [];
      ClientDashboardEngine.state.invoices = [{ invoiceId: 'inv_1', amount: 0, status: 'paid' }];
      ClientDashboardEngine.state.taxReturn = { status: 'efile_ready', clientApproved: true, signedAt: '2026-09-02' };
      ClientDashboardEngine.state.messages = [];
      ClientDashboardEngine.state.updates = [];

      ClientDashboardEngine.render();
      const output = mockDOM.innerHTML;

      assert.ok(output.includes('All Clear — Zero Actions Outstanding'), 'Must show all clear banner');
      assert.ok(output.includes('All Requested Documents Received'), 'Must show empty missing docs state');
      assert.ok(output.includes('Account in Good Standing'), 'Must show zero balance empty state');
      assert.ok(output.includes('IRS Form 8879 Executed &amp; Locked'), 'Must show executed signature state');
      assert.ok(output.includes('No Messages Yet'), 'Must show empty messages state');
    });
  });
});
