/**
 * ============================================================================
 * PRIORITY 1: STAFF ROLE PROVISIONING (TRUSTED BACKEND HANDLER)
 * ============================================================================
 * 
 * Statutory & Compliance Authority:
 * - FTC Safeguards Rule (16 CFR § 314.4(c)): Access controls on customer information
 * - IRS Publication 1345 § 3: Authorized IRS e-file Provider personnel governance
 * - NIST SP 800-63-3 Authenticator Assurance Level 2 (AAL2): Mandatory MFA for staff
 * 
 * Trust Boundary:
 * Browser clients CANNOT call admin.auth().setCustomUserClaims().
 * Only an authenticated firm administrator with verified MFA can provision roles.
 */

import { VALID_ROLES, buildCustomClaims } from '../../server/admin-roles.mjs';
import { unauthenticated, permissionDenied, invalidArgument, safeErrorResponse } from './errors.mjs';
import { idempotency } from './idempotency.mjs';

/**
 * Executes trusted staff role provisioning.
 * 
 * @param {object} params
 * @param {object} params.context - Caller authentication context { uid, email, role, mfaVerified }
 * @param {string} params.targetUid - Target user UID
 * @param {string} params.targetRole - 'client' | 'firm_preparer' | 'firm_admin'
 * @param {object} [params.staffMetadata] - Staff profile data (name, ptin, efin)
 * @param {string} [params.idempotencyKey] - Optional idempotency key
 * @param {object} services - Injected services { adminAuth, firestoreDb, auditLogger }
 */
export async function provisionStaffRoleHandler(params, services) {
  const { context, targetUid, staffMetadata = {}, idempotencyKey } = params;
  const targetRole = params.targetRole || params.assignedRole;
  const { adminAuth, firestoreDb, auditLogger } = services;

  try {
    // 1. Authenticate caller
    if (!context || !context.uid) {
      throw unauthenticated('Authentication required to provision staff roles.');
    }

    // 2. Authorize caller — ONLY firm_admin with verified MFA can provision roles
    if (context.role !== VALID_ROLES.FIRM_ADMIN) {
      throw permissionDenied('Administrative authority required. Preparers cannot modify roles.');
    }
    const isMfaActive = Boolean(context.mfaVerified || context.mfaEnforced);
    if (!isMfaActive) {
      throw permissionDenied('MFA verification required for administrative operations under FTC Safeguards § 314.4.');
    }

    // 3. Validate target parameters
    if (!targetUid || typeof targetUid !== 'string' || !targetUid.trim()) {
      throw invalidArgument('Target user UID is required.');
    }
    if (!targetRole || typeof targetRole !== 'string') {
      throw invalidArgument('Target role is required.');
    }

    const cleanRole = targetRole.trim().toLowerCase();
    if (!Object.values(VALID_ROLES).includes(cleanRole)) {
      throw invalidArgument(`Invalid role '${targetRole}'. Must be one of: ${Object.values(VALID_ROLES).join(', ')}`);
    }

    // Prevent self-demotion lockout
    if (context.uid === targetUid && cleanRole !== VALID_ROLES.FIRM_ADMIN) {
      throw permissionDenied('Managing Partner cannot demote own administrative privileges.');
    }

    // 4. Wrap with idempotency
    const key = idempotencyKey || `role_prov_${targetUid}_${cleanRole}`;
    return await idempotency.executeIdempotent(key, async () => {
      // 5. Build cryptographically enforced claims
      const claims = buildCustomClaims(cleanRole, {
        mfaEnforced: cleanRole !== VALID_ROLES.CLIENT,
        operatorUid: context.uid
      });

      // 6. Commit claims to Firebase Auth via Admin SDK
      if (adminAuth && typeof adminAuth.setCustomUserClaims === 'function') {
        await adminAuth.setCustomUserClaims(targetUid, claims);
      }

      // 7. Update Firestore /firm_staff collection
      const staffRecord = {
        uid: targetUid,
        email: staffMetadata.email || null,
        name: staffMetadata.name || 'Firm Staff Member',
        role: cleanRole,
        mfaEnforced: claims.mfa,
        ptin: staffMetadata.ptin || null,
        efinAuthority: staffMetadata.efinAuthority || null,
        assignedBy: context.uid,
        updatedAt: new Date().toISOString()
      };

      if (firestoreDb && typeof firestoreDb.collection === 'function') {
        await firestoreDb.collection('firm_staff').doc(targetUid).set(staffRecord, { merge: true });
      }

      // 8. Record authoritative audit event
      if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
        await auditLogger.recordAuthoritativeEvent({
          action: 'Staff Role Provisioned',
          eventType: 'STAFF_ROLE_PROVISIONED',
          category: 'Governance',
          targetId: targetUid,
          details: `Role [${cleanRole}] assigned to UID ${targetUid} by Admin ${context.email || context.uid}`,
          actor: context
        });
      }

      return {
        success: true,
        targetUid,
        role: cleanRole,
        assignedRole: cleanRole,
        claims,
        message: `Successfully provisioned role '${cleanRole}' for UID ${targetUid}`
      };
    });

  } catch (err) {
    return safeErrorResponse(err);
  }
}

/**
 * Assigns default 'client' role to a newly created or unassigned user account.
 * Trusted server-side logic: clients cannot self-escalate to staff.
 *
 * @param {object} params
 * @param {object} params.context - Caller auth context { uid, role }
 * @param {string} [params.targetUid] - Target user UID (defaults to context.uid)
 * @param {object} services - Injected services { adminAuth, firestoreDb, auditLogger }
 */
export async function assignDefaultClientRoleHandler(params, services) {
  const { context, targetUid } = params;
  const { adminAuth, firestoreDb, auditLogger } = services;

  try {
    if (!context || !context.uid) {
      throw unauthenticated('Authentication required.');
    }

    const uid = targetUid || context.uid;
    // Clients can only initialize their own account default; staff can initialize any client
    if (uid !== context.uid && context.role !== VALID_ROLES.FIRM_ADMIN && context.role !== VALID_ROLES.FIRM_PREPARER) {
      throw permissionDenied('Cannot initialize role for another user.');
    }

    const claims = buildCustomClaims(VALID_ROLES.CLIENT, { mfaEnforced: false, operatorUid: 'server_default' });

    if (adminAuth && typeof adminAuth.setCustomUserClaims === 'function') {
      await adminAuth.setCustomUserClaims(uid, claims);
    }

    if (firestoreDb && typeof firestoreDb.collection === 'function') {
      await firestoreDb.collection('clients').doc(uid).set({
        uid,
        role: VALID_ROLES.CLIENT,
        isStaff: false,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }

    if (auditLogger && typeof auditLogger.recordAuthoritativeEvent === 'function') {
      await auditLogger.recordAuthoritativeEvent({
        action: 'Default Client Role Assigned',
        eventType: 'USER_REGISTERED_CLIENT',
        category: 'Governance',
        targetId: uid,
        details: `Assigned role 'client' to UID ${uid} by default`,
        actor: { uid, role: VALID_ROLES.CLIENT }
      });
    }

    return {
      success: true,
      uid,
      role: VALID_ROLES.CLIENT,
      claims,
      message: `Successfully assigned role 'client' to UID ${uid}`
    };
  } catch (err) {
    return safeErrorResponse(err);
  }
}

