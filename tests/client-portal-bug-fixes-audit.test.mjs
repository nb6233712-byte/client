import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAppRoot = path.resolve(__dirname, '..');
const rootDir = path.resolve(webAppRoot, '..');

describe('Client Portal 8 Bug Fixes Verification Suite', () => {

  test('Bug 1: Google Integration & HTTP 403/404 Resilience', () => {
    // 1. Verify layout.js no longer latches _firestoreRulesDenied = true
    const layoutJs = fs.readFileSync(path.join(webAppRoot, 'js/core/layout.js'), 'utf8');
    assert.ok(!layoutJs.includes('window.FirebaseBridge._firestoreRulesDenied = true'), 'Layout must not latch firestore rules denial');

    // 2. Verify firebase.js does not permanently latch offline on permission-denied
    const fbJs = fs.readFileSync(path.join(webAppRoot, 'js/firebase.js'), 'utf8');
    assert.ok(!fbJs.includes('this._firestoreRulesDenied = true'), 'FirebaseBridge must not latch firestore rules denial');

    // 3. Verify messages.html does not overwrite authenticated UID with mock WLvwIL2KC1h0yqo8XGTk88KzjNw1
    const messagesHtml = fs.readFileSync(path.join(webAppRoot, 'client/messages.html'), 'utf8');
    assert.ok(!messagesHtml.includes('WLvwIL2KC1h0yqo8XGTk88KzjNw1'), 'messages.html must not use hardcoded mock UID');

    // 4. Verify auth.js directs staff roles to firm/dashboard.html and client to client/dashboard.html
    const authJs = fs.readFileSync(path.join(webAppRoot, 'js/auth.js'), 'utf8');
    assert.ok(authJs.includes("role.startsWith('firm_')"), 'auth.js must include staff role redirect');
    assert.ok(authJs.includes('firm/dashboard.html'), 'auth.js must redirect staff to firm/dashboard.html');
  });

  test('Bug 2: PDF Upload, Safe Concurrency Retries & Document Download', () => {
    const docsJs = fs.readFileSync(path.join(webAppRoot, 'js/client/documents.js'), 'utf8');

    // 1. Concurrency deduplication and safe release in finally
    assert.ok(docsJs.includes('activeSubmissions.add(submissionKey1)'), 'activeSubmissions must track submissionKey1');
    assert.ok(docsJs.includes('activeSubmissions.delete(submissionKey1)'), 'activeSubmissions must release submissionKey1 in finally');
    assert.ok(docsJs.includes('_inFlightUploads.delete(uploadLockKey)'), '_inFlightUploads must delete lock key');

    // 2. Authoritative downloadUrl prioritized in resolvePdfUrl
    assert.ok(docsJs.includes('Prioritize authoritative downloadUrl if available'), 'resolvePdfUrl must prioritize downloadUrl');
    assert.ok(docsJs.includes("doc.downloadUrl.indexOf('http') === 0"), 'resolvePdfUrl must check for http');

    // 3. Exact binary Blob downloading
    assert.ok(docsJs.includes('downloadDocument: async function'), 'downloadDocument must be async function');
    assert.ok(docsJs.includes('URL.createObjectURL(blob)'), 'downloadDocument must create blob object URL');

    // 4. Verify test-pdfs directory exists in root and contains required files
    const rootTestPdfsDir = path.join(rootDir, 'test-pdfs');
    assert.ok(fs.existsSync(rootTestPdfsDir), 'test-pdfs directory must exist in root');
    const w2File = path.join(rootTestPdfsDir, '01_Test_W2_Source_Record.pdf');
    assert.ok(fs.existsSync(w2File), '01_Test_W2_Source_Record.pdf must exist in root');
  });

  test('Bug 3: IRS Publication 1345 Identity Verification Integrity', () => {
    const sigJs = fs.readFileSync(path.join(webAppRoot, 'js/client/signatures.js'), 'utf8');

    // 1. No fake inq_verified_irs1345 string fallback
    assert.ok(!sigJs.includes('inq_verified_irs1345'), 'signatures.js must not contain fake inq_verified_irs1345 fallback');

    // 2. Genuine inquiryId or auditToken required for verification records
    assert.ok(sigJs.includes('sData.inquiryId || sData.lastInquiryId || sData.auditToken'), 'signatures.js must require authoritative inquiry ID');
  });

  test('Bug 4: Form 8879 Printable PDF Generation & Financial Fidelity', () => {
    const sigJs = fs.readFileSync(path.join(webAppRoot, 'js/client/signatures.js'), 'utf8');

    // 1. Form 8879 PDF generation function defined
    assert.ok(sigJs.includes('generateForm8879PdfBlob: function'), 'generateForm8879PdfBlob must be defined');

    // 2. Valid %PDF-1.4 header and EOF footer
    assert.ok(sigJs.includes('%PDF-1.4'), 'generateForm8879PdfBlob must synthesize %PDF-1.4');
    assert.ok(sigJs.includes('%%EOF'), 'generateForm8879PdfBlob must include %%EOF');

    // 3. Official Part I figures
    assert.ok(sigJs.includes('214,806'), 'Part I must include AGI 214,806');
    assert.ok(sigJs.includes('30,491'), 'Part I must include Tax 30,491');
    assert.ok(sigJs.includes('3,418'), 'Part I must include Refund 3,418');

    // 4. Physical signature declaration (Part II) and ERO certification (Part III)
    assert.ok(sigJs.includes('Part II: Taxpayer Declaration'), 'Part II declaration must be present');
    assert.ok(sigJs.includes('Part III: Certification of Electronic Return Originator'), 'Part III certification must be present');

    // 5. No missing sample-return.pdf 404 without valid test PDF fallback
    assert.ok(!sigJs.includes('href="test-pdfs/sample-return.pdf"'), 'No dead sample-return.pdf link');
    assert.ok(sigJs.includes('12_Test_Form_8879_Authorization_Demo.pdf'), 'Must reference valid Form 8879 demo PDF');
  });

  test('Bug 5: Client Messages Backend Persistence & Verified Sent Status', () => {
    const fbJs = fs.readFileSync(path.join(webAppRoot, 'js/firebase.js'), 'utf8');
    const msgHtml = fs.readFileSync(path.join(webAppRoot, 'client/messages.html'), 'utf8');

    // 1. sendMessage returns authoritative persistence response
    assert.ok(fbJs.includes('persisted: isSuccess && !isOffline'), 'sendMessage must compute persisted: isSuccess && !isOffline');
    assert.ok(fbJs.includes('offlineCached: isOffline'), 'sendMessage must set offlineCached: isOffline');

    // 2. messages.html checks for success and real backend persistence before showing sent
    assert.ok(msgHtml.includes('sendRes.success && !sendRes.offlineCached'), 'messages.html must check persistence');
    assert.ok(msgHtml.includes('Queued offline'), 'messages.html must show queued offline when offline');
  });

  test('Bug 6: Invoice and Payment Display Reconciled with Backend', () => {
    const billingHtml = fs.readFileSync(path.join(webAppRoot, 'client/billing.html'), 'utf8');

    // 1. No direct client-side mutation marking invoice paid
    assert.ok(!/status:\s*'paid'/.test(billingHtml), 'billing.html must not directly mutate status to paid');

    // 2. Client transitions to pending_webhook_confirmation awaiting backend webhook
    assert.ok(billingHtml.includes("status: 'pending_webhook_confirmation'"), 'billing.html must set pending_webhook_confirmation');
    assert.ok(billingHtml.includes('Stripe Payments (PCI-DSS SAQ-A Sandbox)'), 'billing.html must describe Stripe sandbox provider');
  });

  test('Bug 7: Optional Practice Add-Ons Interactive Request Flow', () => {
    const servicesHtml = fs.readFileSync(path.join(webAppRoot, 'client/services.html'), 'utf8');

    // 1. Authorized add-on buttons and prices
    assert.ok(servicesHtml.includes('data-service-id="srv_audit_defense"'), 'srv_audit_defense button must exist');
    assert.ok(servicesHtml.includes('data-fee="350"'), 'Audit Defense fee must be 350');
    assert.ok(servicesHtml.includes('data-service-id="srv_planning_call"'), 'srv_planning_call button must exist');
    assert.ok(servicesHtml.includes('data-fee="275"'), 'Tax Planning Call fee must be 275');

    // 2. Interactive modal and persistence
    assert.ok(servicesHtml.includes('bridge.createEngagementRequest'), 'services.html must call createEngagementRequest');
    assert.ok(servicesHtml.includes('bridge.sendMessage'), 'services.html must send notification message');
    assert.ok(servicesHtml.includes('bridge.getEngagementRequests'), 'services.html must query getEngagementRequests');
    assert.ok(servicesHtml.includes('✓ Requested · In CPA Review'), 'services.html must show verified requested state');
  });

  test('Bug 8: Sound Alerts Web Audio API Synthesis & Preference Toggle', () => {
    const layoutJs = fs.readFileSync(path.join(webAppRoot, 'js/core/layout.js'), 'utf8');
    const profileHtml = fs.readFileSync(path.join(webAppRoot, 'client/profile.html'), 'utf8');

    // 1. Layout implements playNotificationSound with Web Audio API
    assert.ok(layoutJs.includes('playNotificationSound: function (force)'), 'layout.js must implement playNotificationSound');
    assert.ok(layoutJs.includes('window.AudioContext || window.webkitAudioContext'), 'layout.js must use AudioContext');

    // 2. Auto-resumes suspended AudioContext for browser autoplay policies
    assert.ok(layoutJs.includes('ctx.resume()'), 'layout.js must resume suspended AudioContext');

    // 3. Melodic dual-tone chime (587.33Hz -> 880Hz)
    assert.ok(layoutJs.includes('587.33'), 'D5 frequency 587.33 must be used');
    assert.ok(layoutJs.includes('880'), 'A5 frequency 880 must be used');

    // 4. Respects user preference setting
    assert.ok(layoutJs.includes('tfr_sound_notifications'), 'layout.js must inspect tfr_sound_notifications');

    // 5. Test sound button in profile calls playNotificationSound(true)
    assert.ok(profileHtml.includes('playNotificationSound(true)'), 'profile.html must call playNotificationSound(true)');
  });
});
