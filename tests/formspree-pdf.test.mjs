import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FORMINIT_KEY,
  FORMINIT_ENDPOINT,
  FORMSPREE_ENDPOINT,
  DEFAULT_FORMSPREE_KEY,
  getForminitEndpoint,
  getFormspreeEndpoint,
  setForminitApiKey,
  setFormspreeApiKey,
  submitPdfToForminit,
  submitPdfToFormspree,
  resolveClientEmail,
  resolveClientName
} from '../js/formspree.js';

test('Forminit PDF Transmission Service', async (t) => {
  await t.test('1. Endpoint Configuration: Defaults to Forminit rv02anqc45x', () => {
    assert.equal(FORMINIT_ENDPOINT, 'https://forminit.com/f/rv02anqc45x');
    assert.equal(DEFAULT_FORMINIT_KEY, 'rv02anqc45x');
    assert.equal(FORMSPREE_ENDPOINT, 'https://forminit.com/f/rv02anqc45x');
    assert.equal(DEFAULT_FORMSPREE_KEY, 'rv02anqc45x');
  });

  await t.test('2. File Validation: Requires a PDF file', async () => {
    await assert.rejects(
      async () => submitPdfToForminit(null),
      /Please select a PDF document/
    );

    const nonPdf = {
      name: 'spreadsheet.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 1024
    };
    await assert.rejects(
      async () => submitPdfToForminit(nonPdf),
      /Invalid file format.*PDF/
    );
  });

  await t.test('3. File Validation: Enforces 10MB ceiling', async () => {
    const hugePdf = {
      name: 'large_tax_bundle.pdf',
      type: 'application/pdf',
      size: 11 * 1024 * 1024 // 11MB
    };
    await assert.rejects(
      async () => submitPdfToForminit(hugePdf),
      /exceeds the 10 MB limit/
    );
  });

  await t.test('4. Successful AJAX submission dispatches FormData to Forminit and parses response', async () => {
    const originalFetch = globalThis.fetch;
    let interceptedUrl = null;
    let interceptedOptions = null;

    globalThis.fetch = async (url, options) => {
      interceptedUrl = url;
      interceptedOptions = options;
      return {
        ok: true,
        json: async () => ({ ok: true, status: 'success' })
      };
    };

    try {
      const mockBlob = new Blob(['%PDF-1.4 dummy pdf content'], { type: 'application/pdf' });
      mockBlob.name = 'Form_1040_2026.pdf';

      const result = await submitPdfToForminit(mockBlob, {
        name: 'Denise Vance',
        email: 'denise@pivot-aide.tax',
        taxYear: '2026',
        message: 'Final signed return'
      });

      assert.equal(result.success, true);
      assert.equal(interceptedUrl, 'https://forminit.com/f/rv02anqc45x');
      assert.equal(interceptedOptions.method, 'POST');
      assert.equal(interceptedOptions.headers['Accept'], 'application/json');
      // Verify Content-Type is NOT manually set so browser boundary works
      assert.equal(interceptedOptions.headers['Content-Type'], undefined);
      assert.ok(interceptedOptions.body instanceof FormData);
      assert.equal(interceptedOptions.body.get('email'), 'denise@pivot-aide.tax');
      assert.equal(interceptedOptions.body.get('_replyto'), 'denise@pivot-aide.tax');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('5. Error Handling: Forminit error responses', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => ({
      ok: false,
      json: async () => ({
        errors: [{ field: 'attachment', message: 'File could not be processed' }]
      })
    });

    try {
      const mockBlob = new Blob(['%PDF-1.4 dummy'], { type: 'application/pdf' });
      mockBlob.name = 'Form_W2.pdf';

      const result = await submitPdfToForminit(mockBlob);
      assert.equal(result.success, false);
      assert.match(result.message, /File could not be processed/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('6. Configurable Forminit API Key & Endpoint Resolution', async () => {
    // Default endpoint
    assert.equal(getForminitEndpoint(), 'https://forminit.com/f/rv02anqc45x');
    assert.equal(getFormspreeEndpoint(), 'https://forminit.com/f/rv02anqc45x');

    // Clean key string
    assert.equal(getForminitEndpoint('custom_key_abc'), 'https://forminit.com/f/custom_key_abc');

    // Form ID with leading /f/
    assert.equal(getForminitEndpoint('/f/rv02anqc45x'), 'https://forminit.com/f/rv02anqc45x');

    // Full URL passthrough
    assert.equal(getForminitEndpoint('https://forminit.com/f/rv02anqc45x'), 'https://forminit.com/f/rv02anqc45x');

    // Global setter function
    const resolved = setForminitApiKey('forminit_live_key');
    assert.equal(resolved, 'https://forminit.com/f/forminit_live_key');
    assert.equal(getForminitEndpoint(), 'https://forminit.com/f/forminit_live_key');

    // Reset back to default
    setForminitApiKey('rv02anqc45x');
  });

  await t.test('7. Client-Side Email Resolution & _replyto Binding', async () => {
    // Explicit email override
    assert.equal(resolveClientEmail('taxpayer.client@example.org'), 'taxpayer.client@example.org');

    // Mock localStorage session
    const originalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (key) => (key === 'tfr_user_session' ? JSON.stringify({ email: 'client.session@pivot-aide.tax', name: 'Jordan Client' }) : null)
    };

    try {
      assert.equal(resolveClientEmail(), 'client.session@pivot-aide.tax');
      assert.equal(resolveClientName(), 'Jordan Client');
    } finally {
      globalThis.localStorage = originalStorage;
    }
  });

  await t.test('8. Transmits client email and Forminit endpoint with attached PDF', async () => {
    const originalFetch = globalThis.fetch;
    let postedEndpoint = null;
    let postedFormData = null;

    globalThis.fetch = async (url, options) => {
      postedEndpoint = url;
      postedFormData = options.body;
      return {
        ok: true,
        json: async () => ({ ok: true, submissionId: 'sub_init_771' })
      };
    };

    try {
      const mockBlob = new Blob(['%PDF-1.4 1040 test content'], { type: 'application/pdf' });
      mockBlob.name = 'Form_1040_Whitfield.pdf';

      const result = await submitPdfToForminit(mockBlob, {
        apiKey: 'https://forminit.com/f/rv02anqc45x',
        clientEmail: 'm.whitfield@example.com',
        clientName: 'Michael Whitfield',
        taxYear: 2026,
        category: 'Form 1040 Schedule C',
        requestId: 'req_1040_2026'
      });

      assert.equal(result.success, true);
      assert.equal(postedEndpoint, 'https://forminit.com/f/rv02anqc45x');
      assert.equal(postedFormData.get('email'), 'm.whitfield@example.com');
      assert.equal(postedFormData.get('_replyto'), 'm.whitfield@example.com');
      assert.equal(postedFormData.get('name'), 'Michael Whitfield');
      assert.equal(postedFormData.get('taxYear'), '2026');
      assert.equal(postedFormData.get('category'), 'Form 1040 Schedule C');
      assert.equal(postedFormData.get('requestId'), 'req_1040_2026');
      assert.ok(postedFormData.get('attachment') !== null);
      assert.ok(postedFormData.get('file') !== null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
