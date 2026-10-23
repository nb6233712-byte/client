/**
 * ============================================================================
 * PIVOT AIDE TAX — TRUSTED FIREBASE ADMIN SDK ROLE ASSIGNMENT SERVICE
 * ============================================================================
 * 
 * SECURITY COMPLIANCE NOTICE:
 * This module is executed EXCLUSIVELY in a trusted backend / server environment
 * (Node.js Admin Worker or Firebase Cloud Functions).
 * 
 * NEVER import this file into frontend client code.
 * NEVER bundle service account private keys into client applications.
 * 
 * Governing Standards:
 * - FTC Safeguards Rule (16 CFR Part 314 § 314.4(c))
 * - IRS Publication 1345 § 3 & § 6
 * - NIST SP 800-63-3 Authenticator Assurance Level 2 (AAL2)
 */

export const VALID_ROLES = Object.freeze({
  CLIENT: 'client',
  FIRM_PREPARER: 'firm_preparer',
  FIRM_REVIEWER: 'firm_reviewer',
  FIRM_PRACTITIONER: 'firm_practitioner',
  FIRM_ADMIN: 'firm_admin',
  FIRM_PARTNER: 'firm_partner',
  FIRM_STAFF: 'firm_staff'
});

/**
 * Validates role input and prepares cryptographically enforced custom claims.
 * 
 * @param {string} role - Target role: 'client', 'firm_preparer', or 'firm_admin'
 * @param {object} options - Options including mfaEnforced flag
 * @returns {object} Claims payload to commit via admin.auth().setCustomUserClaims()
 */
export function buildCustomClaims(role, options = {}) {
  const targetRole = (role || '').trim().toLowerCase();

  if (!Object.values(VALID_ROLES).includes(targetRole)) {
    throw new Error(
      `Invalid role '${role}'. Role must be one of: ${Object.values(VALID_ROLES).join(', ')}`
    );
  }

  // New accounts or unprivileged filers default to 'client' with mfa optional
  if (targetRole === VALID_ROLES.CLIENT) {
    return {
      role: VALID_ROLES.CLIENT,
      mfa: Boolean(options.mfaEnforced),
      assignedAt: new Date().toISOString()
    };
  }

  // Privileged staff roles (firm_preparer, firm_admin) REQUIRE Multi-Factor Authentication
  const isMfaEnforced = options.mfaEnforced !== false; // Default true for staff
  if (!isMfaEnforced) {
    throw new Error(
      `MFA Requirement Violation: Privileged staff role '${targetRole}' requires MFA enforcement under FTC Safeguards § 314.4.`
    );
  }

  return {
    role: targetRole,
    mfa: true,
    assignedAt: new Date().toISOString(),
    assignedBy: options.operatorUid || 'system_admin'
  };
}

/**
 * Assigns a role to a user using Firebase Admin SDK.
 * 
 * @param {object} adminAuth - Initialized Firebase Admin Auth instance (admin.auth())
 * @param {string} uid - Firebase Auth User UID
 * @param {string} role - 'client' | 'firm_preparer' | 'firm_admin'
 * @param {object} options - Configuration options { mfaEnforced, operatorUid }
 */
export async function assignStaffRole(adminAuth, uid, role, options = {}) {
  if (!uid || typeof uid !== 'string') {
    throw new Error('Valid target user UID is required.');
  }

  const claims = buildCustomClaims(role, options);

  if (!adminAuth || typeof adminAuth.setCustomUserClaims !== 'function') {
    throw new Error('Firebase Admin Auth instance with setCustomUserClaims is required.');
  }

  // Write cryptographically signed custom claims to user token
  await adminAuth.setCustomUserClaims(uid, claims);

  return {
    success: true,
    uid,
    claims,
    message: `Successfully assigned role '${claims.role}' (MFA: ${claims.mfa}) to UID ${uid}`
  };
}

// ── CLI / Script Runner for Practice Administrators ──────────────────────────
if (process.argv[1] && process.argv[1].endsWith('admin-roles.mjs')) {
  const [,, targetUid, targetRole, mfaFlag] = process.argv;
  if (!targetUid || !targetRole) {
    console.log(`
Usage: node server/admin-roles.mjs <UID> <ROLE> [--no-mfa]

Available Roles:
  client          (Default individual taxpayer)
  firm_preparer   (Assigned tax preparer; requires MFA)
  firm_admin      (Managing Partner / EFIN supervisor; requires MFA)
    `);
    process.exit(0);
  }

  try {
    const claims = buildCustomClaims(targetRole, { mfaEnforced: mfaFlag !== '--no-mfa' });
    console.log(`✓ Computed Valid Claims Payload for UID [${targetUid}]:`);
    console.log(JSON.stringify(claims, null, 2));
  } catch (err) {
    console.error(`✗ Error: ${err.message}`);
    process.exit(1);
  }
}
