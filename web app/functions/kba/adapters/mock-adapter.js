/**
 * ============================================================================
 * THE FILE ROOM — ISOLATED MOCK IDENTITY VERIFICATION ADAPTER
 * ============================================================================
 * Strictly for automated testing suites and local emulator development.
 * Isolated from production routes (IRS Pub 1345 § 5.2.2 compliance).
 */

'use strict';

const crypto = require('node:crypto');
const IdentityVerificationProvider = require('../provider-interface');
const { KbaStatus, StatutoryLimits } = require('../types');

class MockAdapter extends IdentityVerificationProvider {
  constructor(options = {}) {
    super('mock');
    this.simulatedOutcome = options.simulatedOutcome || 'passed'; // 'passed', 'failed', 'expired', 'review'
  }

  async createSession(params) {
    const { context } = params;
    const inquiryId = `inq_mock_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const expiresAt = new Date(Date.now() + StatutoryLimits.MAX_DURATION_SECONDS * 1000).toISOString();

    return {
      providerSessionId: inquiryId,
      sessionToken: `tok_mock_${inquiryId}`,
      clientLaunchUrl: `https://withpersona.com/verify?inquiry-id=${inquiryId}&mock=true`,
      expiresAt: expiresAt,
      rawStatus: 'created'
    };
  }

  async getSessionStatus(providerSessionId) {
    let normalized = KbaStatus.VERIFIED;
    if (this.simulatedOutcome === 'failed') normalized = KbaStatus.FAILED;
    if (this.simulatedOutcome === 'expired') normalized = KbaStatus.EXPIRED;
    if (this.simulatedOutcome === 'review') normalized = KbaStatus.MANUAL_REVIEW;

    return {
      providerSessionId: providerSessionId,
      normalizedStatus: normalized,
      score: normalized === KbaStatus.VERIFIED ? 100 : 40,
      completedAt: new Date().toISOString(),
      rawStatus: normalized
    };
  }

  verifyWebhookSignature(rawBody, headers, secret) {
    // For mock testing, allow mock signature or validate test HMAC
    const sig = headers['x-mock-signature'] || headers['persona-signature'];
    if (sig === 'valid_test_signature') return true;
    if (!secret) return true;

    try {
      const expected = crypto.createHmac('sha256', secret).update(String(rawBody)).digest('hex');
      return sig === expected;
    } catch (_) {
      return false;
    }
  }

  parseWebhookEvent(parsedBody, headers) {
    const inquiryId = parsedBody.inquiryId || parsedBody.data?.id || `inq_mock_${Date.now()}`;
    const status = parsedBody.status || this.simulatedOutcome;

    let normalized = KbaStatus.VERIFIED;
    if (status === 'failed') normalized = KbaStatus.FAILED;
    if (status === 'expired') normalized = KbaStatus.EXPIRED;
    if (status === 'needs_review') normalized = KbaStatus.MANUAL_REVIEW;

    return {
      eventType: parsedBody.type || 'inquiry.completed',
      providerSessionId: inquiryId,
      referenceId: parsedBody.referenceId || null,
      normalizedStatus: normalized,
      score: normalized === KbaStatus.VERIFIED ? 100 : 50,
      completedAt: new Date().toISOString(),
      rawPayload: parsedBody
    };
  }
}

module.exports = MockAdapter;
