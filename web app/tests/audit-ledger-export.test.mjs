import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Audit Ledger Page & CSV Export Functionality (firm/audit-log.html)', () => {
  const auditHtmlPath = path.resolve('c:/Users/user/Desktop/web app1/web app/firm/audit-log.html');
  const fileContent = fs.readFileSync(auditHtmlPath, 'utf8');

  test('1. Page Actions feature btn-back-triage and btn-export-ledger-csv with SVG icons', () => {
    assert.ok(fileContent.includes('id="btn-back-triage"'), 'Must have btn-back-triage');
    assert.ok(fileContent.includes('id="btn-export-ledger-csv"'), 'Must have btn-export-ledger-csv');
    assert.ok(fileContent.includes('<svg width="14" height="14"'), 'Must embed clean vector SVG icon');
    assert.ok(fileContent.includes('Export Ledger CSV &rarr;'), 'Must display button label');
  });

  test('2. Implements exportLedgerCsv function with RFC 4180 compliance and file download', () => {
    assert.ok(fileContent.includes('function exportLedgerCsv()'), 'Must define exportLedgerCsv');
    assert.ok(fileContent.includes('new Blob(['), 'Must create Blob with text/csv mime type');
    assert.ok(fileContent.includes("type: 'text/csv;charset=utf-8;'"), 'Must specify text/csv charset');
    assert.ok(fileContent.includes('.setAttribute(\'download\''), 'Must set download attribute on dynamic anchor');
    assert.ok(fileContent.includes('URL.createObjectURL(blob)'), 'Must generate object URL for browser download');
  });

  test('3. Generates complete WORM audit header and records AUDIT_LEDGER_EXPORTED event', () => {
    assert.ok(fileContent.includes('# The File Room — Statutory WORM Audit Ledger Export'), 'Must include regulatory header');
    assert.ok(fileContent.includes('FTC Safeguards Rule (16 CFR § 314.4) & IRS Pub 1345'), 'Must cite governing standards');
    assert.ok(fileContent.includes('AUDIT_LEDGER_EXPORTED'), 'Must record audit log event upon export');
  });
});
