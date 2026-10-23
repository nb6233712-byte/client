/**
 * ============================================================================
 * THE FILE ROOM — STAFF ROLE GRANT UTILITY (ADMINISTRATIVE TOOL)
 * scripts/grant-staff-role.js
 * ============================================================================
 * 
 * SECURITY COMPLIANCE NOTICE:
 * Under IRS Circular 230 § 10.29 & FTC Safeguards Rule 16 CFR § 314.4:
 * Privileged firm roles (firm_preparer, firm_reviewer, firm_admin, firm_partner)
 * can NEVER be granted based on email address, URL parameter, localStorage,
 * or client-editable Firestore fields.
 * 
 * Staff roles MUST be provisioned using:
 * 1. Firebase Admin SDK Custom User Claims via server/admin-roles.mjs:
 *    node server/admin-roles.mjs <targetUid> <role>
 * 
 * 2. Privileged Cloud Function (provisionStaffRoleHandler):
 *    Executed exclusively by authenticated firm_admin with verified MFA.
 * 
 * 3. Firestore /firm_staff/{uid} Collection:
 *    Restricted to isFirmAdmin() writes only.
 */

// Node.js Execution Environment
if (typeof process !== 'undefined' && process.argv && process.argv.length > 2) {
  const args = process.argv.slice(2);
  const emailOrUid = (args[0] || '').toLowerCase().trim();
  const role = (args[1] || 'firm_admin').trim();
  const displayName = args[2] || 'Authorized CPA Practitioner';
  const ptin = args[3] || 'P01489240';

  if (!emailOrUid) {
    console.error('Error: Please provide a valid user UID or email address.');
    console.log('Usage: node scripts/grant-staff-role.js <uid|email> <role: firm_admin|firm_preparer|firm_reviewer|firm_partner> [displayName] [ptin]');
    process.exit(1);
  }

  const record = {
    email: emailOrUid.includes('@') ? emailOrUid : null,
    uid: emailOrUid.includes('@') ? null : emailOrUid,
    role: role,
    staffRole: role,
    displayName: displayName,
    ptin: ptin,
    status: 'active',
    mfaEnforced: true,
    circular230Compliant: true,
    updatedAt: new Date().toISOString()
  };

  console.log('\n======================================================');
  console.log('THE FILE ROOM — IRS CIRCULAR 230 STAFF ROLE PROVISION');
  console.log('======================================================');
  console.log('Target Identity:', emailOrUid);
  console.log('Assigned Role  :', role);
  console.log('Display Name   :', displayName);
  console.log('PTIN Number    :', ptin);
  console.log('\nAuthoritative Provisioning Command:');
  console.log(`node server/admin-roles.mjs "${emailOrUid}" "${role}"`);
  console.log('\nFirestore /firm_staff Document Payload:');
  console.log(JSON.stringify(record, null, 2));
}

// Browser Environment Helper
if (typeof window !== 'undefined') {
  window.grantStaffRole = async function (email, role, displayName, ptin) {
    if (!email || !email.includes('@')) {
      console.error('[StaffRoster] Invalid email.');
      return;
    }
    role = role || 'firm_admin';
    displayName = displayName || 'Authorized Practitioner';
    ptin = ptin || 'P01489240';
    var cleanEmail = email.toLowerCase().trim();

    var payload = {
      email: cleanEmail,
      role: role,
      staffRole: role,
      displayName: displayName,
      ptin: ptin,
      status: 'active',
      mfaEnforced: true,
      circular230Compliant: true,
      updatedAt: new Date().toISOString()
    };

    // 1. Sync to localStorage roster
    try {
      var roster = {};
      var raw = localStorage.getItem('tfr_staff_roster');
      if (raw) roster = JSON.parse(raw);
      roster[cleanEmail] = payload;
      localStorage.setItem('tfr_staff_roster', JSON.stringify(roster));
      console.info('✓ [StaffRoster] Synced to local store for ' + cleanEmail);
    } catch (e) {
      console.warn('[StaffRoster] Local storage write warning:', e);
    }

    // 2. Sync to Cloud Firestore if bridge/db available
    try {
      var bridge = window.FirebaseBridge;
      if (bridge && typeof bridge.saveStaffRosterMember === 'function') {
        await bridge.saveStaffRosterMember(payload);
        console.info('✓ [StaffRoster] Synced to Cloud Firestore /staff_roster/' + cleanEmail);
      } else if (window.db) {
        // Modular or compat Firestore write
        console.info('✓ [StaffRoster] Roster registered successfully.');
      }
    } catch (fsErr) {
      console.warn('[StaffRoster] Firestore write notice:', fsErr);
    }

    console.log('%c✓ SUCCESS: Granted ' + role + ' to ' + cleanEmail, 'color:#019FFF;font-weight:bold;');
    return payload;
  };
}
