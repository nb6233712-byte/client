/**
 * ============================================================================
 * THE FILE ROOM · FIRESTORE SEEDING ARCHITECTURE (STANDALONE NODE.JS SCRIPT)
 * File: scripts/seed-firestore.mjs
 * ============================================================================
 * 
 * Standalone NoSQL Database Seeding Script using Firebase Admin SDK.
 * 
 * Target Persona:
 * - Client: Michael & Elena Whitfield (`usr_whitfield_4417`)
 * - Practitioner: Denise Rosenthal, CPA (`preparer_denise_cpa`, PTIN: P01849201)
 * 
 * Collections & Schemas:
 * 1. /engagements/eng_2026_whitfield
 * 2. /documentRequests (Root & Subcollection checklist)
 * 3. /signatures/sig_8879_whitfield
 * 4. /messages (Thread between Denise R., CPA & Michael Whitfield)
 * 5. /invoices/inv_2026_001
 * 6. /clients/usr_whitfield_4417 & /staff/preparer_denise_cpa
 * 
 * Execution:
 * node scripts/seed-firestore.mjs
 * node scripts/seed-firestore.mjs --dry-run
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Canonical Seed Data Specification ────────────────────────────────────────

export const SEED_DATA = {
  // 1. Client Identity Record
  client: {
    uid: 'usr_whitfield_4417',
    clientUid: 'usr_whitfield_4417',
    displayName: 'Michael & Elena Whitfield',
    primaryEmail: 'm.whitfield@example.com',
    spouseEmail: 'e.whitfield@example.com',
    role: 'client',
    filingStatus: 'Married Filing Jointly',
    taxYear: 2026,
    activeEngagementId: 'eng_2026_whitfield',
    mfaVerified: true,
    irc7216Consent: true,
    status: 'active',
    createdAt: '2026-01-14T10:00:00.000Z',
    updatedAt: new Date().toISOString()
  },

  // 2. Practitioner Identity Record
  practitioner: {
    uid: 'preparer_denise_cpa',
    name: 'Denise Rosenthal, CPA',
    email: 'denise@pivot-aide.tax',
    role: 'firm_preparer',
    ptin: 'P01849201',
    firmName: 'Pivot Aide Tax',
    circular230Verified: true,
    mfaVerified: true,
    status: 'active',
    createdAt: '2025-11-01T08:00:00.000Z',
    updatedAt: new Date().toISOString()
  },

  // 3. /engagements/eng_2026_whitfield
  engagement: {
    id: 'eng_2026_whitfield',
    clientUid: 'usr_whitfield_4417',
    taxYear: 2026,
    filingStatus: 'Married Filing Jointly',
    currentStage: 3,
    stageLabel: 'In Preparation',
    overallProgress: 68,
    federalRefund: 3418.00,
    stateBalanceDue: 612.00,
    assignedCpa: {
      name: 'Denise Rosenthal, CPA',
      ptin: 'P01849201'
    },
    jurisdictions: [
      'IRS Form 1040',
      'MD Form 502 (Resident)',
      'VA Form 760 (Non-Resident Reciprocity)',
      'PA Form PA-40 (Non-Resident Reciprocity)'
    ],
    notes: 'Draft Form 1040 Schedule C & Schedule E in progress. Awaiting 1099-MISC & K-1.',
    steps: [
      { step: 1, title: 'Intake Opened', status: 'done', meta: '14 Jan · Completed' },
      { step: 2, title: 'Checklist Upload', status: 'done', meta: '11 of 13 files received' },
      { step: 3, title: 'In Preparation', status: 'now', meta: 'Current with Denise R., CPA' },
      { step: 4, title: 'Return Review', status: 'todo', meta: 'Draft Form 1040' },
      { step: 5, title: 'Sign Form 8879', status: 'todo', meta: 'IRS e-File Authorization' },
      { step: 6, title: 'IRS Transmitted', status: 'todo', meta: 'Target: Oct 15, 2026' }
    ],
    upcomingDeadlines: [
      { label: 'Q3 Estimated Tax Payment (IRS & MD)', date: '15 Sep 2026', badge: 'Upcoming' },
      { label: 'Form 1040 Extension Filing Cutoff', date: '15 Oct 2026', badge: 'Target' },
      { label: 'IRC § 7216 Annual Consent Renewal', date: '31 Dec 2026', badge: 'Compliance' }
    ],
    createdAt: '2026-01-14T10:00:00.000Z',
    updatedAt: new Date().toISOString()
  },

  // 4. /documentRequests (Checklist Items)
  documentRequests: [
    {
      id: 'doc_req_1099misc_whitfield',
      clientUid: 'usr_whitfield_4417',
      engagementId: 'eng_2026_whitfield',
      title: '1099-MISC (Keystone Property Group)',
      form: '1099-MISC',
      issuer: 'Keystone Property Group',
      category: '1099 / Income Records',
      status: 'missing',
      priority: 'high',
      dueAt: '15 Sep 2026',
      description: 'Required for Schedule E rental property income calculation.',
      actionRequired: true
    },
    {
      id: 'doc_req_k1_whitfield',
      clientUid: 'usr_whitfield_4417',
      engagementId: 'eng_2026_whitfield',
      title: 'Schedule K-1 (Blue Ridge Tech Partners)',
      form: 'Schedule K-1 (Form 1065)',
      issuer: 'Blue Ridge Tech Partners',
      category: 'Pass-Through Partnership',
      status: 'missing',
      priority: 'high',
      dueAt: '15 Sep 2026',
      description: 'Required for pass-through partnership income and self-employment calculation.',
      actionRequired: true
    },
    {
      id: 'doc_req_closing_whitfield',
      clientUid: 'usr_whitfield_4417',
      engagementId: 'eng_2026_whitfield',
      title: 'Closing Disclosure (Halcyon Row)',
      form: 'Closing Disclosure',
      issuer: 'Halcyon Row Rental Settlement',
      category: 'Real Estate / Rental Statement',
      status: 'in_review',
      priority: 'medium',
      dueAt: '15 Sep 2026',
      description: 'Settlement statement under CPA diligence to determine rental property basis and depreciation.',
      fileName: 'Halcyon_Row_Closing_Disclosure_2026.pdf',
      fileSize: 4820192,
      mimeType: 'application/pdf',
      uploadedAt: '2026-09-08T14:22:00.000Z',
      actionRequired: false
    },
    {
      id: 'doc_req_w2_whitfield',
      clientUid: 'usr_whitfield_4417',
      engagementId: 'eng_2026_whitfield',
      title: 'W-2 (Halstead Medical Group)',
      form: 'Form W-2',
      issuer: 'Halstead Medical Group',
      category: 'Wage & Tax Statement',
      status: 'accepted',
      priority: 'standard',
      dueAt: 'Completed',
      description: 'Wage and tax statement diligence completed under Circular 230 § 10.22.',
      fileName: 'W2_Halstead_Elena_Whitfield_2026.pdf',
      fileSize: 1248900,
      mimeType: 'application/pdf',
      uploadedAt: '2026-09-01T09:15:00.000Z',
      acceptedAt: '2026-09-02T11:05:00.000Z',
      acceptedBy: 'Denise Rosenthal, CPA',
      actionRequired: false
    }
  ],

  // 5. /signatures/sig_8879_whitfield
  signature: {
    id: 'sig_8879_whitfield',
    clientUid: 'usr_whitfield_4417',
    engagementId: 'eng_2026_whitfield',
    form: 'Form 8879',
    taxYear: 2026,
    title: 'IRS e-file Signature Authorization (Form 8879)',
    status: 'pending',
    kbaRequired: true,
    statutoryAuthority: 'IRS Publication 1345 § 5',
    primarySigner: {
      name: 'Michael Whitfield',
      email: 'm.whitfield@example.com',
      role: 'primary',
      status: 'pending',
      attemptsLeft: 3,
      signedAt: null
    },
    secondarySigner: {
      name: 'Elena Whitfield',
      email: 'e.whitfield@example.com',
      role: 'spouse',
      status: 'pending',
      attemptsLeft: 3,
      signedAt: null
    },
    retentionYears: 3,
    createdAt: '2026-09-08T10:00:00.000Z',
    updatedAt: new Date().toISOString()
  },

  // 6. /messages (File-Linked Thread)
  messages: [
    {
      id: 'msg_whitfield_001',
      engagementId: 'eng_2026_whitfield',
      clientUid: 'usr_whitfield_4417',
      senderId: 'preparer_denise_cpa',
      senderName: 'Denise Rosenthal, CPA',
      senderRole: 'staff',
      recipientId: 'usr_whitfield_4417',
      recipientName: 'Michael Whitfield',
      text: 'Welcome Michael & Elena. I have started drafting your multi-state return for Maryland, Virginia, and Pennsylvania. Please upload your remaining 1099-MISC and K-1 when available.',
      timestamp: '2026-09-07T09:30:00.000Z',
      read: true
    },
    {
      id: 'msg_whitfield_002',
      engagementId: 'eng_2026_whitfield',
      clientUid: 'usr_whitfield_4417',
      senderId: 'usr_whitfield_4417',
      senderName: 'Michael Whitfield',
      senderRole: 'client',
      recipientId: 'preparer_denise_cpa',
      recipientName: 'Denise Rosenthal, CPA',
      text: 'Thanks Denise! Just uploaded the settlement statement / Closing Disclosure for the Halcyon Row rental property. Reaching out to Keystone for the revised 1099-MISC.',
      timestamp: '2026-09-08T14:30:00.000Z',
      read: true
    },
    {
      id: 'msg_whitfield_003',
      engagementId: 'eng_2026_whitfield',
      clientUid: 'usr_whitfield_4417',
      senderId: 'preparer_denise_cpa',
      senderName: 'Denise Rosenthal, CPA',
      senderRole: 'staff',
      recipientId: 'usr_whitfield_4417',
      recipientName: 'Michael Whitfield',
      text: 'I have the closing disclosure — thank you. One question on the rental property: did you make any improvements prior to placing it in service on August 1st?',
      timestamp: '2026-09-09T08:02:00.000Z',
      read: true
    },
    {
      id: 'msg_whitfield_004',
      engagementId: 'eng_2026_whitfield',
      clientUid: 'usr_whitfield_4417',
      senderId: 'usr_whitfield_4417',
      senderName: 'Michael Whitfield',
      senderRole: 'client',
      recipientId: 'preparer_denise_cpa',
      recipientName: 'Denise Rosenthal, CPA',
      text: 'Yes, we replaced the HVAC system for $7,200 right before tenants moved in. I will upload the contractor invoice today.',
      timestamp: '2026-09-10T11:45:00.000Z',
      read: false
    }
  ],

  // 7. /invoices/inv_2026_001
  invoice: {
    id: 'inv_2026_001',
    invoiceNumber: 'INV-2026-0418',
    clientUid: 'usr_whitfield_4417',
    engagementId: 'eng_2026_whitfield',
    totalAmount: 1240.00,
    amountDue: 1240.00,
    status: 'unpaid',
    currency: 'USD',
    dueDate: '2026-09-15',
    issuedDate: '2026-08-28',
    paymentTerms: 'Net 15 · Due upon return delivery',
    pciDssCompliance: 'PCI-DSS v4.0.1 SAQ-A (Hosted Fields)',
    items: [
      { desc: 'Individual return — federal Form 1040', amount: 400.00 },
      { desc: 'Maryland, Virginia, Pennsylvania returns', amount: 285.00 },
      { desc: 'Schedule C — Whitfield Design Co.', amount: 310.00 },
      { desc: 'Schedule E — Halcyon Row rental property', amount: 245.00 }
    ],
    createdAt: '2026-08-28T09:00:00.000Z',
    updatedAt: new Date().toISOString()
  }
};

// ── NoSQL Seeding Engine ─────────────────────────────────────────────────────

/**
 * Commits the canonical seed dataset to Firestore using Firebase Admin SDK batch operations.
 *
 * @param {Object} db - Firestore database instance from Firebase Admin SDK
 * @param {Object} admin - Firebase Admin module
 * @returns {Promise<{success: boolean, committedCount: number, collections: string[]}>}
 */
export async function seedFirestoreDatabase(db, admin) {
  console.log('🚀 Initiating atomic NoSQL seed for The File Room...');
  const batch = db.batch();
  let writeCount = 0;

  const serverTimestamp = admin?.firestore?.FieldValue?.serverTimestamp
    ? admin.firestore.FieldValue.serverTimestamp()
    : new Date().toISOString();

  // 1. Commit /clients/usr_whitfield_4417
  const clientRef = db.collection('clients').doc(SEED_DATA.client.uid);
  batch.set(clientRef, {
    ...SEED_DATA.client,
    updatedAt: serverTimestamp
  }, { merge: true });
  writeCount++;

  // 2. Commit /staff/preparer_denise_cpa
  const staffRef = db.collection('staff').doc(SEED_DATA.practitioner.uid);
  batch.set(staffRef, {
    ...SEED_DATA.practitioner,
    updatedAt: serverTimestamp
  }, { merge: true });
  writeCount++;

  // 3. Commit /engagements/eng_2026_whitfield
  const engagementRef = db.collection('engagements').doc(SEED_DATA.engagement.id);
  batch.set(engagementRef, {
    ...SEED_DATA.engagement,
    updatedAt: serverTimestamp
  }, { merge: true });
  writeCount++;

  // 4. Commit /documentRequests (Root Collection and Subcollection)
  for (const docReq of SEED_DATA.documentRequests) {
    // A. Root Collection: /documentRequests/{id}
    const rootDocRef = db.collection('documentRequests').doc(docReq.id);
    batch.set(rootDocRef, {
      ...docReq,
      updatedAt: serverTimestamp
    }, { merge: true });
    writeCount++;

    // B. Subcollection: /engagements/eng_2026_whitfield/documentRequests/{id}
    const subDocRef = engagementRef.collection('documentRequests').doc(docReq.id);
    batch.set(subDocRef, {
      ...docReq,
      updatedAt: serverTimestamp
    }, { merge: true });
    writeCount++;
  }

  // 5. Commit /signatures/sig_8879_whitfield
  const sigRef = db.collection('signatures').doc(SEED_DATA.signature.id);
  batch.set(sigRef, {
    ...SEED_DATA.signature,
    updatedAt: serverTimestamp
  }, { merge: true });
  writeCount++;

  // 6. Commit /messages (Thread)
  for (const msg of SEED_DATA.messages) {
    const msgRef = db.collection('messages').doc(msg.id);
    batch.set(msgRef, {
      ...msg,
      createdTimestamp: msg.timestamp
    }, { merge: true });
    writeCount++;
  }

  // 7. Commit /invoices/inv_2026_001
  const invRef = db.collection('invoices').doc(SEED_DATA.invoice.id);
  batch.set(invRef, {
    ...SEED_DATA.invoice,
    updatedAt: serverTimestamp
  }, { merge: true });
  writeCount++;

  // Execute atomic commit
  await batch.commit();

  console.log(`✓ Atomic commit successful: ${writeCount} documents written across 6 collections.`);
  return {
    success: true,
    committedCount: writeCount,
    collections: ['clients', 'staff', 'engagements', 'documentRequests', 'signatures', 'messages', 'invoices']
  };
}

// ── Standalone CLI Runner ────────────────────────────────────────────────────

async function runCli() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  console.log('============================================================');
  console.log('THE FILE ROOM · NO-SQL FIRESTORE SEED GENERATOR');
  console.log('Project Target: uk-client-d90d5');
  console.log('Client: Michael & Elena Whitfield (usr_whitfield_4417)');
  console.log('Lead CPA: Denise Rosenthal, CPA (P01849201)');
  console.log('============================================================');

  // Generate local snapshot JSON
  const snapshotPath = path.join(__dirname, 'seed-snapshot.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(SEED_DATA, null, 2), 'utf8');
  console.log(`✓ Seed snapshot written to: ${snapshotPath}`);

  if (isDryRun) {
    console.log('ℹ️ Running in --dry-run mode. Skipping remote Firestore write.');
    printSummary();
    process.exit(0);
  }

  // Attempt to load Firebase Admin SDK
  let admin;
  try {
    admin = await import('firebase-admin');
    if (admin.default) admin = admin.default;
  } catch (_) {
    console.warn('⚠️ firebase-admin module is not yet installed in node_modules.');
    console.log('ℹ️ To run live seed against remote Cloud Firestore:');
    console.log('   npm install firebase-admin');
    console.log('   node scripts/seed-firestore.mjs');
    console.log('\nDisplaying seeded schema specification:');
    printSummary();
    process.exit(0);
  }

  try {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'uk-client-d90d5';

    if (!admin.apps.length) {
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          projectId
        });
      } else {
        admin.initializeApp({ projectId });
      }
    }

    const db = admin.firestore();
    const result = await seedFirestoreDatabase(db, admin);
    console.log('🎉 Seeding successfully completed!');
    printSummary();
  } catch (err) {
    console.error('❌ Firestore seeding error:', err.message);
    printSummary();
  }
}

function printSummary() {
  console.log('\n── Seeding Verification Summary ───────────────────────────');
  console.log(`• Engagement:  /engagements/${SEED_DATA.engagement.id}`);
  console.log(`  - Stage:      ${SEED_DATA.engagement.currentStage} (${SEED_DATA.engagement.stageLabel}) - ${SEED_DATA.engagement.overallProgress}%`);
  console.log(`  - Refund:     Federal $${SEED_DATA.engagement.federalRefund.toFixed(2)} | State Due $${SEED_DATA.engagement.stateBalanceDue.toFixed(2)}`);
  console.log(`  - CPA:        ${SEED_DATA.engagement.assignedCpa.name} (PTIN: ${SEED_DATA.engagement.assignedCpa.ptin})`);
  console.log(`• Checklist:   ${SEED_DATA.documentRequests.length} Document Requests`);
  SEED_DATA.documentRequests.forEach(d => {
    console.log(`  - [${d.status.toUpperCase()}] ${d.title}`);
  });
  console.log(`• Signatures:  /signatures/${SEED_DATA.signature.id}`);
  console.log(`  - Primary:    ${SEED_DATA.signature.primarySigner.name} (${SEED_DATA.signature.primarySigner.status}, ${SEED_DATA.signature.primarySigner.attemptsLeft} attempts left)`);
  console.log(`  - Secondary:  ${SEED_DATA.signature.secondarySigner.name} (${SEED_DATA.signature.secondarySigner.status}, ${SEED_DATA.signature.secondarySigner.attemptsLeft} attempts left)`);
  console.log(`• Messages:    ${SEED_DATA.messages.length} File-Linked Thread Messages`);
  console.log(`• Invoices:    /invoices/${SEED_DATA.invoice.id} - $${SEED_DATA.invoice.totalAmount.toFixed(2)} (${SEED_DATA.invoice.status})`);
  console.log('───────────────────────────────────────────────────────────');
}

// Execute CLI when directly executed
if (process.argv[1] && process.argv[1].endsWith('seed-firestore.mjs')) {
  runCli();
}
