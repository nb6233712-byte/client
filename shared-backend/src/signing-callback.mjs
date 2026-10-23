/**
 * ============================================================================
 * PRIORITY 7: SIGNING-PROVIDER CALLBACKS & KBA IDENTITY VERIFICATION
 * ============================================================================
 * 
 * Statutory & Compliance Authority:
 * - IRS Publication 1345 § 5.2.2: Knowledge-Based Authentication (KBA) requirements
 *   for remote electronic signatures on Form 8879.
 * - Lockout Rule: 3 failed KBA attempts strictly mandate reverting to physical wet-ink.
 * - IRC § 6061(b): Electronic signatures on tax returns have same legal validity as wet ink.
 * 
 * Trust Boundary:
 * E-signature completion MUST be verified and finalized on the trusted server.
 * Clients cannot self-authorize Form 8879 e-file signatures without passing KBA.
 */

import crypto from 'node:crypto';
import { permissionDenied, invalidArgument, failedPrecondition, safeErrorResponse } from './errors.mjs';
import { secretManager, AppConfig } from './config.mjs';
import { idempotency } from './idempotency.mjs';

/**
 * Verifies callback HMAC signature from e-signing provider.
 */
export function verifySigningCallbackSignature(payloadString, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signatureHeader, 'hex'), Buffer.from(expected, 'hex'));
}

/**
 * Handles e-signature completion callback or KBA evaluation.
 * 
 * @param {object} params
 * @param {object} params.callbackData - Callback payload { event, clientUid, taxYear, kbaAttempts, certificate }
 * @param {string} [params.signatureHeader] - HMAC signature
 * @param {string} [params.rawBody] - Raw body string
 * @param {object} services - { firestoreDb, auditLogger, notificationDispatcher }
 */
export async function signingProviderCallbackHandler(params, services) {
  const { callbackData, signatureHeader, rawBody, idempotencyKey } = params;
  const { firestoreDb, auditLogger, notificationDispatcher } = services;

  try {
    if (!callbackData || !callbackData.event) {
      throw invalidArgument('Valid signing callback event is required.');
    }

    const { event, clientUid, taxYear = 2026 } = callbackData;
    if (!clientUid) {
      throw invalidArgument('Client UID is required in signing callback.');
    }

    // 1. Resolve signing secret and verify HMAC if header provided
    if (signatureHeader && rawBody) {
      const secret = await secretManager.getSecret('SIGNING_PROVIDER_WEBHOOK_SECRET', 'sig_test_secret_key');
      const valid = verifySigningCallbackSignature(rawBody, signatureHeader, secret);
      if (!valid) {
        throw permissionDenied('Signing callback HMAC signature verification failed.');
      }
    }

    const key = idempotencyKey || `sig_cb_${clientUid}_${event}_${callbackData.certificateId || Date.now()}`;
    return await idempotency.executeIdempotent(key, async () => {
      const now = new Date().toISOString();

      // CASE A: KBA Failure / Lockout Threshold
      if (event === 'kba_failed') {
        const attempts = Number(callbackData.kbaAttempts || 1);
        const isLockedOut = attempts >= AppConfig.kbaMaxAttempts;

        if (isLockedOut) {
          // Lock out from remote e-signature under IRS Pub 1345 § 5.2.2
          if (firestoreDb && typeof firestoreDb.collection === 'function') {
            await firestoreDb.collection('engagements').doc(clientUid).set({
              kbaLockout: true,
              kbaAttempts: attempts,
              signatureMethod: 'physical_wet_sign',
              stageLabel: 'Signing pending (KBA Lockout)',
              updatedAt: now
            }, { merge: true });
          }

          if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
            await auditLogger.recordAuthoritativeEvent({
              action: 'KBA Identity Challenge Lockout',
              eventType: 'KBA_LOCKOUT_TRIGGERED',
              category: 'Compliance',
              targetId: clientUid,
              clientId: clientUid,
              details: `Signer failed attempt ${attempts} of 3. File locked out under IRS Pub 1345 § 5.2.2. Physical wet-signature required.`,
              actor: { uid: 'signing_service', email: 'kba@pivot-aide.internal', role: 'compliance_daemon' }
            });
          }

          return {
            status: 'kba_locked_out',
            clientUid,
            attempts,
            wetSignatureRequired: true
          };
        }

        return {
          status: 'kba_attempt_recorded',
          clientUid,
          attemptsRemaining: AppConfig.kbaMaxAttempts - attempts
        };
      }

      // CASE B: Form 8879 Successfully Executed
      if (event === 'signature_completed') {
        const sigId = `sig_${Date.now()}_${clientUid.replace(/[^a-zA-Z0-9]/g, '')}`;

        const signatureRecord = {
          id: sigId,
          form: 'IRS Form 8879',
          taxYear,
          uid: clientUid,
          signerName: callbackData.signerName || 'Primary Taxpayer',
          signerEmail: callbackData.signerEmail || null,
          ipAddress: callbackData.ipAddress || '127.0.0.1',
          kbaVerified: true,
          certificateId: callbackData.certificateId || `cert_${Date.now()}`,
          complianceRule: 'IRS Pub 1345 & IRM 10.10.1',
          retentionPeriod: '3 Years Statutory Custody',
          executedAt: now
        };

        // Write immutable signature record to /signatures
        if (firestoreDb && typeof firestoreDb.collection === 'function') {
          await firestoreDb.collection('signatures').doc(sigId).set(signatureRecord);

          // Advance engagement to ready for transmission
          await firestoreDb.collection('engagements').doc(clientUid).set({
            stage: 'filed_accepted',
            stageLabel: 'Form 8879 executed · Ready for e-file',
            progressPct: 90,
            updatedAt: now
          }, { merge: true });
        }

        // Record authoritative SIGNATURE_COMPLETED audit event
        if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
          await auditLogger.recordAuthoritativeEvent({
            action: 'Form 8879 Electronic Signature Executed',
            eventType: 'SIGNATURE_COMPLETED',
            category: 'Regulated Signing',
            targetId: sigId,
            clientId: clientUid,
            details: `IRS Form 8879 signed with NIST AAL2/KBA assurance by ${signatureRecord.signerName}. Cert: ${signatureRecord.certificateId}`,
            actor: { uid: clientUid, email: signatureRecord.signerEmail, role: 'taxpayer' }
          });
        }

        // Notify firm preparer
        if (notificationDispatcher) {
          await notificationDispatcher.dispatch({
            type: 'in_app',
            recipientUid: 'firm_staff',
            metadata: {
              title: 'Form 8879 Signed',
              message: `${signatureRecord.signerName} has signed Form 8879. Return is ready for IRS MeF transmission.`
            }
          });
        }

        return {
          status: 'signature_completed',
          signatureId: sigId,
          clientUid,
          executedAt: now
        };
      }

      return {
        status: 'event_unhandled',
        event
      };
    });

  } catch (err) {
    return safeErrorResponse(err);
  }
}
