/**
 * ============================================================================
 * THE FILE ROOM — PERSONA IDENTITY VERIFICATION ADAPTER
 * ============================================================================
 * Production implementation of IdentityVerificationProvider targeting
 * Persona Inquiries API (v2023-01-05) under IRS Publication 1345 § 5.2.2.
 */

'use strict';

const crypto = require('node:crypto');
const IdentityVerificationProvider = require('../provider-interface');
const { KbaStatus, StatutoryLimits } = require('../types');

class PersonaAdapter extends IdentityVerificationProvider {
  /**
   * @param {Object} options
   * @param {string} options.apiKey - Persona API key (from Secret Manager)
   * @param {string} [options.templateId] - Inquiry template ID (starts with 'itmpl_')
   * @param {string} [options.apiBase] - API Base URL (defaults to https://withpersona.com/api/v1)
   */
  constructor(options = {}) {
    super('persona');
    this.apiKey = options.apiKey;
    this.templateId = options.templateId || process.env.KBA_TEMPLATE_ID || 'itmpl_irs_pub1345_kba_prod';
    this.apiBase = options.apiBase || process.env.KBA_PROVIDER_URL || 'https://withpersona.com/api/v1';
  }

  /**
   * Dispatches inquiry creation to Persona API.
   */
  async createSession(params) {
    if (!this.apiKey) {
      throw new Error('PersonaAdapter requires an API key.');
    }

    const { taxpayer, context } = params;
    const referenceId = `${context.engagementId}_${context.signerRole}_att${context.attemptNumber}_${Date.now().toString(36)}`;
    
    // Prepare field prefill conforming to Persona schema
    const fields = {};
    if (taxpayer.firstName) fields['name-first'] = { value: taxpayer.firstName };
    if (taxpayer.lastName) fields['name-last'] = { value: taxpayer.lastName };
    if (taxpayer.dob) fields['birthdate'] = { value: taxpayer.dob };
    if (taxpayer.address) {
      if (taxpayer.address.street) fields['address-street-1'] = { value: taxpayer.address.street };
      if (taxpayer.address.city) fields['address-city'] = { value: taxpayer.address.city };
      if (taxpayer.address.state) fields['address-subdivision'] = { value: taxpayer.address.state };
      if (taxpayer.address.zip) fields['address-postal-code'] = { value: taxpayer.address.zip };
    }
    if (taxpayer.ssnFull) {
      fields['identification-number'] = { value: taxpayer.ssnFull };
    }

    const payload = {
      data: {
        type: 'inquiry',
        attributes: {
          'inquiry-template-id': this.templateId,
          'reference-id': referenceId,
          'redirect-url': context.returnUrl || null,
          fields: fields
        },
        meta: {
          irs_pub_1345_compliant: true,
          max_duration_seconds: StatutoryLimits.MAX_DURATION_SECONDS,
          pass_threshold_percentage: StatutoryLimits.MIN_PASS_PERCENTAGE,
          engagement_id: context.engagementId,
          signer_role: context.signerRole,
          attempt_number: context.attemptNumber,
          tax_year: context.taxYear || 2026
        }
      }
    };

    const res = await fetch(`${this.apiBase}/inquiries`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Persona-Version': '2023-01-05',
        'Key-Inflection': 'camel'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[PersonaAdapter] Create inquiry error:', res.status, errText);
      throw new Error(`Persona API responded with status ${res.status}`);
    }

    const data = await res.json();
    const inquiry = data.data || {};
    const inquiryId = inquiry.id;
    const sessionToken = (inquiry.meta && inquiry.meta.sessionToken) || inquiry.attributes?.sessionToken || inquiryId;
    const hostedUrl = inquiry.attributes?.hostedUrl || `https://withpersona.com/verify?inquiry-id=${inquiryId}`;
    const expiresAt = new Date(Date.now() + StatutoryLimits.MAX_DURATION_SECONDS * 1000).toISOString();

    return {
      providerSessionId: inquiryId,
      sessionToken: sessionToken,
      clientLaunchUrl: hostedUrl,
      expiresAt: expiresAt,
      rawStatus: inquiry.attributes?.status || 'created'
    };
  }

  /**
   * Retrieves status of an Inquiry by ID.
   */
  async getSessionStatus(providerSessionId) {
    if (!this.apiKey) {
      throw new Error('PersonaAdapter requires an API key.');
    }

    const res = await fetch(`${this.apiBase}/inquiries/${encodeURIComponent(providerSessionId)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Persona-Version': '2023-01-05',
        'Key-Inflection': 'camel'
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[PersonaAdapter] Get inquiry error:', res.status, errText);
      throw new Error(`Persona API responded with status ${res.status}`);
    }

    const data = await res.json();
    const inquiry = data.data || {};
    const rawStatus = inquiry.attributes?.status || 'unknown';
    const normalized = this._normalizePersonaStatus(rawStatus);

    return {
      providerSessionId: inquiry.id || providerSessionId,
      normalizedStatus: normalized,
      score: null, // Persona manages question scoring internally against the configured 80% threshold
      completedAt: inquiry.attributes?.completedAt || null,
      rawStatus: rawStatus
    };
  }

  /**
   * Verifies Persona HMAC-SHA256 signature using timing-safe comparison.
   */
  verifyWebhookSignature(rawBody, headers, secret) {
    if (!secret) return false;
    const signatureHeader = headers['persona-signature'] || headers['Persona-Signature'];
    if (!signatureHeader) return false;

    // Format: t=<timestamp>,v1=<signature>
    const parts = signatureHeader.split(',');
    let timestamp = null;
    let signature = null;

    for (const part of parts) {
      const [key, val] = part.split('=');
      if (key === 't') timestamp = val;
      if (key === 'v1') signature = val;
    }

    if (!timestamp || !signature) return false;

    // Check clock drift (reject if older than 5 minutes)
    const headerTime = parseInt(timestamp, 10) * 1000;
    if (Math.abs(Date.now() - headerTime) > 5 * 60 * 1000) {
      console.warn('[PersonaAdapter] Webhook signature timestamp expired');
      return false;
    }

    const payload = `${timestamp}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    try {
      const sigBuffer = Buffer.from(signature, 'hex');
      const expBuffer = Buffer.from(expected, 'hex');
      if (sigBuffer.length !== expBuffer.length) return false;
      return crypto.timingSafeEqual(sigBuffer, expBuffer);
    } catch (_) {
      return false;
    }
  }

  /**
   * Parses webhook event payload.
   */
  parseWebhookEvent(parsedBody, headers) {
    const event = parsedBody.data || {};
    const eventType = event.type || parsedBody.type || 'inquiry.event';
    const attributes = event.attributes || {};
    const payload = attributes.payload || {};
    const inquiry = payload.data || {};

    const providerSessionId = inquiry.id || attributes.inquiryId || 'unknown';
    const rawStatus = inquiry.attributes?.status || attributes.status || 'unknown';
    const referenceId = inquiry.attributes?.referenceId || null;
    const normalizedStatus = this._normalizePersonaStatus(rawStatus);

    return {
      eventType: eventType,
      providerSessionId: providerSessionId,
      referenceId: referenceId,
      normalizedStatus: normalizedStatus,
      score: null,
      completedAt: inquiry.attributes?.completedAt || new Date().toISOString(),
      rawPayload: parsedBody
    };
  }

  /**
   * Maps Persona inquiry statuses to normalized KbaStatus allowlist.
   * @private
   */
  _normalizePersonaStatus(personaStatus) {
    switch (String(personaStatus).toLowerCase()) {
      case 'created':
        return KbaStatus.PENDING;
      case 'pending':
        return KbaStatus.IN_PROGRESS;
      case 'completed':
      case 'passed':
        return KbaStatus.VERIFIED;
      case 'failed':
      case 'declined':
        return KbaStatus.FAILED;
      case 'expired':
      case 'canceled':
        return KbaStatus.EXPIRED;
      case 'needs_review':
        return KbaStatus.MANUAL_REVIEW;
      default:
        return KbaStatus.IN_PROGRESS;
    }
  }
}

module.exports = PersonaAdapter;
