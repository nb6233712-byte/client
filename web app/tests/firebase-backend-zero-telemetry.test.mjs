import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAppRoot = path.resolve(__dirname, '..');

describe('Backend Firebase Connection & Zero Telemetry Figures', () => {
  const dashboardJsPath = path.join(webAppRoot, 'js/client/dashboard.js');
  const firebaseJsPath = path.join(webAppRoot, 'js/firebase.js');
  const dashboardHtmlPath = path.join(webAppRoot, 'client/dashboard.html');
  const taxReturnHtmlPath = path.join(webAppRoot, 'client/tax-return.html');

  const dashboardJs = fs.readFileSync(dashboardJsPath, 'utf8');
  const firebaseJs = fs.readFileSync(firebaseJsPath, 'utf8');
  const dashboardHtml = fs.readFileSync(dashboardHtmlPath, 'utf8');
  const taxReturnHtml = fs.readFileSync(taxReturnHtmlPath, 'utf8');

  test('1. FirebaseBridge defines getDefaultEngagement with zero amounts ($0.00)', () => {
    assert.match(firebaseJs, /getDefaultEngagement\s*\(/);
    assert.match(firebaseJs, /federalRefund:\s*0\.00/);
    assert.match(firebaseJs, /federalRefundFormatted:\s*'\$0\.00'/);
    assert.match(firebaseJs, /stateBalanceDue:\s*0\.00/);
    assert.match(firebaseJs, /stateBalanceDueFormatted:\s*'\$0\.00'/);
  });

  test('2. FirebaseBridge defines setEngagementRefund to persist amounts to Firestore', () => {
    assert.match(firebaseJs, /setEngagementRefund\s*\(/);
    assert.match(firebaseJs, /engagements/);
  });

  test('3. ClientDashboard listens for deferred firebase-ready / firebase-bridge-ready events', () => {
    assert.match(dashboardJs, /addEventListener\s*\(\s*['"]firebase-ready['"]/);
    assert.match(dashboardJs, /addEventListener\s*\(\s*['"]firebase-bridge-ready['"]/);
  });

  test('4. ClientDashboard defaults Federal Refund & State Balance Due to 0.00 ($0.00)', () => {
    assert.match(dashboardJs, /federalRefund:\s*0\.00/);
    assert.match(dashboardJs, /stateBalanceDue:\s*0\.00/);
    assert.match(dashboardJs, /fedRefund\s*=\s*\(typeof eng\.federalRefund === 'number'\)\s*\?\s*eng\.federalRefund\s*:\s*0\.00/);
    assert.match(dashboardJs, /stateBal\s*=\s*\(typeof eng\.stateBalanceDue === 'number'\)\s*\?\s*eng\.stateBalanceDue\s*:\s*0\.00/);
  });

  test('5. Prepared return screen in tax-return.html displays $0.00 default values', () => {
    assert.match(taxReturnHtml, /id="tax-return-fed-refund">\s*\$0\.00\s*<\/div>/);
    assert.match(taxReturnHtml, /id="tax-return-state-due">\s*\$0\.00\s*<\/div>/);
  });

  test('6. Functional Test: ClientDashboard renders $0.00 in Federal Refund and State Balance Due callouts', () => {
    const mockDOM = { innerHTML: '' };
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
          federalRefund: 0.00,
          federalRefundFormatted: '$0.00',
          stateBalanceDue: 0.00,
          stateBalanceDueFormatted: '$0.00',
          steps: [],
          upcomingDeadlines: []
        }),
        getDefaultDocumentRequests: () => [],
        getDefaultPreparedReturn: () => ({ status: 'in_preparation', clientApproved: false }),
        getDefaultMessages: () => [],
        getDefaultInvoices: () => [],
        getDefaultUpdates: () => []
      },
      document: {
        getElementById: (id) => (id === 'dashboard-content-area' ? mockDOM : null)
      }
    };

    const fn = new Function('window', 'document', dashboardJs);
    fn(virtualWindow, virtualWindow.document);
    virtualWindow.ClientDashboard.init();

    const output = mockDOM.innerHTML;
    assert.ok(output.includes('Federal Refund Callout'), 'Must render Federal Refund Callout');
    assert.ok(output.includes('federal-refund-figure'), 'Must have federal refund figure element');
    assert.ok(output.includes('$0.00'), 'Must display $0.00 federal refund');
    assert.ok(output.includes('State Balance Due Callout'), 'Must render State Balance Due Callout');
    assert.ok(output.includes('state-balance-figure'), 'Must have state balance figure element');
    assert.ok(output.includes('>$0.00<'), 'Must display $0.00 state balance due');
  });
});
