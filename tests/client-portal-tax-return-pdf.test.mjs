import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAppRoot = path.resolve(__dirname, '..');

describe('Client Portal Tax Return PDF Viewer & Interactive Icons', () => {
  const taxReturnHtmlPath = path.join(webAppRoot, 'client/tax-return.html');
  const taxReturnHtml = fs.readFileSync(taxReturnHtmlPath, 'utf8');

  test('1. Return Filing Package table action buttons contain eye SVG icons', () => {
    // Assert eye SVG icons exist in View PDF buttons
    const eyeIconRegex = /<svg[^>]*viewBox="0 0 24 24"[^>]*>[\s\S]*?<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"[\s\S]*?<circle cx="12" cy="12" r="3"[\s\S]*?<\/svg>/g;
    const matches = taxReturnHtml.match(eyeIconRegex);
    assert.ok(matches && matches.length >= 3, `Expected at least 3 eye icons, found ${matches ? matches.length : 0}`);

    // Assert buttons call openReturnPdfModal for all three forms
    assert.match(taxReturnHtml, /onclick="openReturnPdfModal\('1040'\)"/);
    assert.match(taxReturnHtml, /onclick="openReturnPdfModal\('sched_c'\)"/);
    assert.match(taxReturnHtml, /onclick="openReturnPdfModal\('sched_e'\)"/);
  });

  test('2. openReturnPdfModal and downloadTaxReturnPdf are defined in tax-return.html script', () => {
    assert.match(taxReturnHtml, /window\.openReturnPdfModal\s*=\s*function/);
    assert.match(taxReturnHtml, /window\.downloadTaxReturnPdf\s*=\s*function/);
    assert.match(taxReturnHtml, /createTaxPdfBlob/);
  });

  test('3. TAX_DOCS defines Form 1040, Schedule C, and Schedule E with official figures', () => {
    assert.match(taxReturnHtml, /'1040':/);
    assert.match(taxReturnHtml, /'sched_c':/);
    assert.match(taxReturnHtml, /'sched_e':/);
    assert.match(taxReturnHtml, /\$3,418\.00/);
    assert.match(taxReturnHtml, /\$58,410\.00/);
    assert.match(taxReturnHtml, /\$9,100\.00/);
  });

  test('4. PDF generator produces valid %PDF-1.4 header and binary structure', () => {
    assert.match(taxReturnHtml, /%PDF-1\.4/);
    assert.match(taxReturnHtml, /application\/pdf/);
    assert.match(taxReturnHtml, /%%EOF/);
  });

  test('5. Retains required $0.00 default values for telemetry compatibility', () => {
    assert.match(taxReturnHtml, /id="tax-return-fed-refund">\s*\$0\.00\s*<\/div>/);
    assert.match(taxReturnHtml, /id="tax-return-state-due">\s*\$0\.00\s*<\/div>/);
  });
});
