/**
 * Seed Firestore Emulator directly via REST API on 127.0.0.1:8080
 */

const EMULATOR_BASE = 'http://127.0.0.1:8080/v1/projects/uk-client-d90d5/databases/(default)/documents';

function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof val === 'boolean') {
      fields[key] = { booleanValue: val };
    } else if (typeof val === 'number') {
      if (Number.isInteger(val)) {
        fields[key] = { integerValue: val.toString() };
      } else {
        fields[key] = { doubleValue: val };
      }
    } else if (typeof val === 'string') {
      fields[key] = { stringValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map(v => {
            if (typeof v === 'string') return { stringValue: v };
            if (typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
            return { stringValue: String(v) };
          })
        }
      };
    } else if (typeof val === 'object') {
      fields[key] = { mapValue: { fields: toFirestoreFields(val) } };
    }
  }
  return fields;
}

async function writeDoc(collection, docId, data) {
  const url = `${EMULATOR_BASE}/${collection}/${docId}`;
  const body = JSON.stringify({ fields: toFirestoreFields(data) });
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to seed ${collection}/${docId}:`, res.status, text);
  } else {
    console.log(`✓ Seeded ${collection}/${docId}`);
  }
}

async function main() {
  console.log('🌱 Seeding Firestore Emulator at 127.0.0.1:8080...');

  // 1. Clients
  await writeDoc('clients', 'usr_whitfield_4417', {
    uid: 'usr_whitfield_4417',
    clientUid: 'usr_whitfield_4417',
    displayName: 'Michael & Elena Whitfield',
    name: 'Michael & Elena Whitfield',
    primaryEmail: 'm.whitfield@example.com',
    role: 'client',
    filingStatus: 'Married Filing Jointly',
    taxYear: 2026,
    activeEngagementId: 'eng_2026_whitfield',
    mfaVerified: true,
    irc7216Consent: true,
    status: 'active'
  });

  await writeDoc('clients', 'usr_brennan_llc', {
    uid: 'usr_brennan_llc',
    clientUid: 'usr_brennan_llc',
    displayName: 'Brennan Holdings LLC',
    name: 'Charles Brennan',
    primaryEmail: 'cbrennan@brennanholdings.com',
    role: 'client',
    filingStatus: 'Partnership 1065',
    taxYear: 2026,
    activeEngagementId: 'eng_brennan_2026',
    mfaVerified: true,
    irc7216Consent: true,
    status: 'active'
  });

  // Authenticated Firebase Clients (uk-client-d90d5)
  await writeDoc('clients', 'j11ZvNVZf7Q2FeTrCVNStRM8', {
    uid: 'j11ZvNVZf7Q2FeTrCVNStRM8',
    clientUid: 'j11ZvNVZf7Q2FeTrCVNStRM8',
    displayName: 'Nandan',
    name: 'Nandan',
    primaryEmail: 'nandanfitnessvlog@gmail.com',
    email: 'nandanfitnessvlog@gmail.com',
    role: 'client',
    filingStatus: 'Single',
    taxYear: 2026,
    activeEngagementId: 'eng_2026_j11ZvNVZf7Q2FeTrCVNStRM8',
    mfaVerified: true,
    irc7216Consent: true,
    status: 'active'
  });

  await writeDoc('clients', 'usr_nandanfitnessvlog', {
    uid: 'usr_nandanfitnessvlog',
    clientUid: 'j11ZvNVZf7Q2FeTrCVNStRM8',
    displayName: 'Nandan',
    name: 'Nandan',
    primaryEmail: 'nandanfitnessvlog@gmail.com',
    email: 'nandanfitnessvlog@gmail.com',
    role: 'client',
    filingStatus: 'Single',
    taxYear: 2026,
    activeEngagementId: 'eng_2026_j11ZvNVZf7Q2FeTrCVNStRM8',
    mfaVerified: true,
    irc7216Consent: true,
    status: 'active'
  });

  await writeDoc('clients', 'WLvwiL2KC1hOyqo8XGTk88K', {
    uid: 'WLvwiL2KC1hOyqo8XGTk88K',
    clientUid: 'WLvwiL2KC1hOyqo8XGTk88K',
    displayName: 'Nandan B',
    name: 'Nandan B',
    primaryEmail: 'nandanb449@gmail.com',
    email: 'nandanb449@gmail.com',
    role: 'client',
    filingStatus: 'Single',
    taxYear: 2026,
    activeEngagementId: 'eng_2026_WLvwiL2KC1hOyqo8XGTk88K',
    mfaVerified: true,
    irc7216Consent: true,
    status: 'active'
  });

  // 2. Engagements
  await writeDoc('engagements', 'eng_2026_whitfield', {
    id: 'eng_2026_whitfield',
    clientUid: 'usr_whitfield_4417',
    clientName: 'Michael & Elena Whitfield',
    taxYear: 2026,
    filingType: 'Form 1040 Joint (MD, VA, PA)',
    stage: 'in_preparation',
    stageNum: 3,
    stageName: 'In Preparation',
    currentStage: 3,
    overallProgress: 68,
    progressPct: 68,
    federalRefund: 3418.00,
    federalRefundFormatted: '$3,418.00',
    stateBalanceDue: 612.00,
    stateBalanceDueFormatted: '$612.00',
    assignedCpa: {
      name: 'Denise Rosenthal, CPA',
      ptin: 'P01849201'
    },
    updatedAt: new Date().toISOString()
  });

  await writeDoc('engagements', 'eng_2026_usr_whitfield_4417', {
    id: 'eng_2026_usr_whitfield_4417',
    clientUid: 'usr_whitfield_4417',
    clientName: 'Michael & Elena Whitfield',
    taxYear: 2026,
    filingType: 'Form 1040 Joint',
    stage: 'in_preparation',
    stageNum: 3,
    stageName: 'In Preparation',
    currentStage: 3,
    overallProgress: 68,
    progressPct: 68,
    federalRefund: 3418.00,
    stateBalanceDue: 612.00,
    assignedCpa: {
      name: 'Denise Rosenthal, CPA',
      ptin: 'P01849201'
    },
    updatedAt: new Date().toISOString()
  });

  await writeDoc('engagements', 'eng_2026_j11ZvNVZf7Q2FeTrCVNStRM8', {
    id: 'eng_2026_j11ZvNVZf7Q2FeTrCVNStRM8',
    clientUid: 'j11ZvNVZf7Q2FeTrCVNStRM8',
    clientId: 'j11ZvNVZf7Q2FeTrCVNStRM8',
    clientName: 'Nandan',
    taxYear: 2026,
    filingType: 'Individual Form 1040',
    stage: 'in_preparation',
    stageNum: 3,
    stageName: 'In Preparation',
    currentStage: 3,
    overallProgress: 72,
    progressPct: 72,
    assignedCpa: {
      name: 'Denise R., CPA',
      ptin: 'P01849201'
    },
    updatedAt: new Date().toISOString()
  });

  // 3. Document Requests
  await writeDoc('documentRequests', 'req_whitfield_1099m', {
    id: 'req_whitfield_1099m',
    clientUid: 'usr_whitfield_4417',
    engagementId: 'eng_2026_whitfield',
    title: '1099-MISC Rental Income',
    issuer: 'Keystone Property Group',
    category: 'Income',
    status: 'missing',
    requestedDate: '2026-02-01',
    description: 'Annual rent distribution statement for Schedule E property.'
  });

  await writeDoc('documentRequests', 'req_whitfield_k1', {
    id: 'req_whitfield_k1',
    clientUid: 'usr_whitfield_4417',
    engagementId: 'eng_2026_whitfield',
    title: 'Schedule K-1 (Form 1065)',
    issuer: 'Blue Ridge Tech Partners',
    category: 'Partnership',
    status: 'missing',
    requestedDate: '2026-02-10',
    description: 'Partner share of income, deductions, and credits.'
  });

  await writeDoc('documentRequests', 'req_whitfield_closing', {
    id: 'req_whitfield_closing',
    clientUid: 'usr_whitfield_4417',
    engagementId: 'eng_2026_whitfield',
    title: 'Closing Disclosure Statement',
    issuer: 'Halcyon Title Escrow',
    category: 'Real Estate',
    status: 'review',
    uploadedDate: '2026-02-14',
    fileName: 'closing_disclosure_halcyon_2026.pdf',
    description: 'Refinance HUD-1 / Closing statement for primary residence.'
  });

  await writeDoc('documentRequests', 'req_whitfield_w2', {
    id: 'req_whitfield_w2',
    clientUid: 'usr_whitfield_4417',
    engagementId: 'eng_2026_whitfield',
    title: 'Form W-2 Wage Statement',
    issuer: 'Halstead Medical Group',
    category: 'Income',
    status: 'accepted',
    uploadedDate: '2026-01-20',
    fileName: 'w2_halstead_2026.pdf'
  });

  // 4. Documents in review
  await writeDoc('documents', 'doc_closing_001', {
    id: 'doc_closing_001',
    docId: 'doc_closing_001',
    clientUid: 'usr_whitfield_4417',
    clientName: 'Michael Whitfield',
    engagementId: 'eng_2026_whitfield',
    documentType: 'Closing Disclosure',
    fileName: 'closing_disclosure_halcyon_2026.pdf',
    fileSizeFormatted: '1.4 MB',
    status: 'review',
    stage: 'review',
    uploadedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    securityHash: 'sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  });

  // 5. Signatures (Form 8879)
  await writeDoc('signatures', 'sig_8879_whitfield', {
    id: 'sig_8879_whitfield',
    clientUid: 'usr_whitfield_4417',
    clientName: 'Michael & Elena Whitfield',
    form: 'Form 8879',
    formTitle: 'IRS e-file Signature Authorization (Form 8879)',
    taxYear: 2026,
    status: 'pending',
    kbaStatus: 'verified',
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    primarySigner: {
      name: 'Michael Whitfield',
      status: 'pending',
      attemptsLeft: 3,
      signedAt: null
    },
    secondarySigner: {
      name: 'Elena Whitfield',
      status: 'pending',
      attemptsLeft: 3,
      signedAt: null
    }
  });

  await writeDoc('signatures', 'sig_8879_usr_whitfield_4417', {
    id: 'sig_8879_usr_whitfield_4417',
    clientUid: 'usr_whitfield_4417',
    clientName: 'Michael & Elena Whitfield',
    form: 'Form 8879',
    formTitle: 'IRS e-file Signature Authorization (Form 8879)',
    taxYear: 2026,
    status: 'pending',
    kbaStatus: 'verified',
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    primarySigner: {
      name: 'Michael Whitfield',
      status: 'pending',
      attemptsLeft: 3,
      signedAt: null
    },
    secondarySigner: {
      name: 'Elena Whitfield',
      status: 'pending',
      attemptsLeft: 3,
      signedAt: null
    }
  });

  await writeDoc('signatures', 'sig_8879_WLvwIL2KC1h0yqo8XGTk88KzjNw1', {
    id: 'sig_8879_WLvwIL2KC1h0yqo8XGTk88KzjNw1',
    clientUid: 'WLvwIL2KC1h0yqo8XGTk88KzjNw1',
    clientName: 'Nandan B',
    form: 'Form 8879',
    formTitle: 'IRS e-file Signature Authorization (Form 8879)',
    taxYear: 2026,
    status: 'pending',
    kbaStatus: 'verified',
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    primarySigner: {
      name: 'Nandan B',
      status: 'pending',
      attemptsLeft: 3,
      signedAt: null
    },
    secondarySigner: {
      name: 'Elena Whitfield',
      status: 'pending',
      attemptsLeft: 3,
      signedAt: null
    }
  });

  await writeDoc('signatures', 'sig_8879_j11ZvNVZf7Q2FeTrCVNStRM8', {
    id: 'sig_8879_j11ZvNVZf7Q2FeTrCVNStRM8',
    clientUid: 'j11ZvNVZf7Q2FeTrCVNStRM8',
    clientName: 'Nandan',
    form: 'Form 8879',
    formTitle: 'IRS e-file Signature Authorization (Form 8879)',
    taxYear: 2026,
    status: 'pending',
    kbaStatus: 'verified',
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    primarySigner: {
      name: 'Nandan',
      status: 'pending',
      attemptsLeft: 3,
      signedAt: null
    },
    secondarySigner: {
      name: 'Elena Whitfield',
      status: 'pending',
      attemptsLeft: 3,
      signedAt: null
    }
  });

  // 5b. KBA Records (IRS Pub 1345 Identity Proofing Verification Gate)
  const kbaPayloadWLvw = {
    id: 'eng_WLvwIL2KC1h0yqo8XGTk88KzjNw1_2026',
    engagementId: 'eng_WLvwIL2KC1h0yqo8XGTk88KzjNw1_2026',
    clientUid: 'WLvwIL2KC1h0yqo8XGTk88KzjNw1',
    'Primary Taxpayer': {
      status: 'verified',
      passedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
      attemptsCount: 0,
      inquiryId: 'inq_lexisnexis_pub1345_wlvw',
      auditToken: 'inq_lexisnexis_pub1345_wlvw',
      kba_locked: false
    },
    'Spouse / Secondary Signer': {
      status: 'pending',
      attemptsCount: 0,
      kba_locked: false
    },
    primary: {
      status: 'verified',
      passedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
      attemptsCount: 0,
      inquiryId: 'inq_lexisnexis_pub1345_wlvw',
      auditToken: 'inq_lexisnexis_pub1345_wlvw',
      kba_locked: false
    },
    spouse: {
      status: 'pending',
      attemptsCount: 0,
      kba_locked: false
    }
  };
  await writeDoc('kba_records', 'eng_WLvwIL2KC1h0yqo8XGTk88KzjNw1_2026', kbaPayloadWLvw);
  await writeDoc('kba_records', 'eng_2026_WLvwIL2KC1h0yqo8XGTk88KzjNw1', kbaPayloadWLvw);

  const kbaPayloadJ11 = {
    id: 'eng_j11ZvNVZf7Q2FeTrCVNStRM8_2026',
    engagementId: 'eng_j11ZvNVZf7Q2FeTrCVNStRM8_2026',
    clientUid: 'j11ZvNVZf7Q2FeTrCVNStRM8',
    'Primary Taxpayer': {
      status: 'verified',
      passedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
      attemptsCount: 0,
      inquiryId: 'inq_lexisnexis_pub1345_j11',
      auditToken: 'inq_lexisnexis_pub1345_j11',
      kba_locked: false
    },
    'Spouse / Secondary Signer': {
      status: 'pending',
      attemptsCount: 0,
      kba_locked: false
    },
    primary: {
      status: 'verified',
      passedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
      attemptsCount: 0,
      inquiryId: 'inq_lexisnexis_pub1345_j11',
      auditToken: 'inq_lexisnexis_pub1345_j11',
      kba_locked: false
    },
    spouse: {
      status: 'pending',
      attemptsCount: 0,
      kba_locked: false
    }
  };
  await writeDoc('kba_records', 'eng_j11ZvNVZf7Q2FeTrCVNStRM8_2026', kbaPayloadJ11);
  await writeDoc('kba_records', 'eng_2026_j11ZvNVZf7Q2FeTrCVNStRM8', kbaPayloadJ11);

  const kbaPayloadWhitfield = {
    id: 'eng_whitfield_2026',
    engagementId: 'eng_whitfield_2026',
    clientUid: 'usr_whitfield_4417',
    'Primary Taxpayer': {
      status: 'verified',
      passedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
      attemptsCount: 0,
      inquiryId: 'inq_lexisnexis_pub1345_whitfield',
      auditToken: 'inq_lexisnexis_pub1345_whitfield',
      kba_locked: false
    },
    'Spouse / Secondary Signer': {
      status: 'pending',
      attemptsCount: 0,
      kba_locked: false
    },
    primary: {
      status: 'verified',
      passedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
      attemptsCount: 0,
      inquiryId: 'inq_lexisnexis_pub1345_whitfield',
      auditToken: 'inq_lexisnexis_pub1345_whitfield',
      kba_locked: false
    },
    spouse: {
      status: 'pending',
      attemptsCount: 0,
      kba_locked: false
    }
  };
  await writeDoc('kba_records', 'eng_whitfield_2026', kbaPayloadWhitfield);
  await writeDoc('kba_records', 'eng_2026_whitfield', kbaPayloadWhitfield);

  // 6. Messages
  await writeDoc('messages', 'msg_whitfield_001', {
    id: 'msg_whitfield_001',
    messageId: 'msg_whitfield_001',
    engagementId: 'eng_2026_whitfield',
    clientId: 'usr_whitfield_4417',
    clientUid: 'usr_whitfield_4417',
    taxYear: 2026,
    text: 'Hi Denise, we just uploaded our Closing Disclosure for the refinance. Let us know if you need anything else for Schedule E.',
    senderId: 'usr_whitfield_4417',
    senderUid: 'usr_whitfield_4417',
    senderName: 'Michael Whitfield',
    senderRole: 'client',
    avatar: 'MW',
    readByClient: true,
    readByFirm: false,
    createdAt: new Date(Date.now() - 3600000 * 6).toISOString()
  });

  await writeDoc('messages', 'msg_whitfield_002', {
    id: 'msg_whitfield_002',
    messageId: 'msg_whitfield_002',
    engagementId: 'eng_2026_whitfield',
    clientId: 'usr_whitfield_4417',
    clientUid: 'usr_whitfield_4417',
    taxYear: 2026,
    text: 'Thanks Nandan! I received the Closing Disclosure and am reviewing the loan origination points right now. Once Keystone sends the 1099-MISC, we will finalize Form 8879.',
    senderId: 'preparer_denise_cpa',
    senderUid: 'preparer_denise_cpa',
    senderName: 'Denise Rosenthal, CPA',
    senderRole: 'firm_staff',
    avatar: 'DR',
    readByClient: true,
    readByFirm: true,
    createdAt: new Date(Date.now() - 3600000 * 3).toISOString()
  });

  // Messages for Authenticated Client (j11ZvNVZf7Q2FeTrCVNStRM8 / nandanfitnessvlog@gmail.com)
  await writeDoc('messages', 'msg_nandan_001', {
    id: 'msg_nandan_001',
    messageId: 'msg_nandan_001',
    engagementId: 'eng_2026_j11ZvNVZf7Q2FeTrCVNStRM8',
    clientId: 'j11ZvNVZf7Q2FeTrCVNStRM8',
    clientUid: 'j11ZvNVZf7Q2FeTrCVNStRM8',
    taxYear: 2026,
    text: 'Hi Denise, we just uploaded our Closing Disclosure for the refinance. Let us know if you need anything else for Schedule E.',
    senderId: 'j11ZvNVZf7Q2FeTrCVNStRM8',
    senderUid: 'j11ZvNVZf7Q2FeTrCVNStRM8',
    senderName: 'Nandan',
    senderRole: 'client',
    senderEmail: 'nandanfitnessvlog@gmail.com',
    avatar: 'NF',
    readByClient: true,
    readByFirm: true,
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString()
  });

  await writeDoc('messages', 'msg_nandan_002', {
    id: 'msg_nandan_002',
    messageId: 'msg_nandan_002',
    engagementId: 'eng_2026_j11ZvNVZf7Q2FeTrCVNStRM8',
    clientId: 'j11ZvNVZf7Q2FeTrCVNStRM8',
    clientUid: 'j11ZvNVZf7Q2FeTrCVNStRM8',
    taxYear: 2026,
    text: 'Thanks Nandan! I received the Closing Disclosure and am reviewing the loan origination points right now.',
    senderId: 'preparer_denise_cpa',
    senderUid: 'preparer_denise_cpa',
    senderName: 'Denise R., CPA',
    senderRole: 'firm_staff',
    senderEmail: 'denise@pivot-aide.tax',
    avatar: 'DR',
    readByClient: true,
    readByFirm: true,
    createdAt: new Date(Date.now() - 3600000).toISOString()
  });

  // 7. Invoices
  await writeDoc('invoices', 'inv_2026_001', {
    id: 'inv_2026_001',
    invoiceId: 'inv_2026_001',
    clientUid: 'usr_whitfield_4417',
    clientName: 'Michael & Elena Whitfield',
    taxYear: 2026,
    invoiceNumber: 'INV-2026-0042',
    description: 'TY2026 Form 1040 Preparation, Multi-State (MD, VA, PA) & Schedule E',
    totalAmount: 1240.00,
    amountDue: 1240.00,
    status: 'unpaid',
    dueDate: '2026-03-15',
    issuedDate: '2026-02-01',
    items: [
      { desc: 'IRS Form 1040 Individual Return Preparation', amount: 650.00 },
      { desc: 'Schedule E Supplemental Income (Rental Property)', amount: 250.00 },
      { desc: 'Multi-State Filings (Maryland, Virginia, Pennsylvania)', amount: 240.00 },
      { desc: 'IRS Pub 1345 KBA Identity Verification & Form 8879 e-File', amount: 100.00 }
    ]
  });

  // 8. Updates & Notifications
  const updateClients = [
    'j11ZvNVZf7Q2FeTrCVNStRM8',
    'WLvwIL2KC1h0yqo8XGTk88KzjNw1',
    'WLvwiL2KC1hOyqo8XGTk88K',
    'usr_whitfield_4417'
  ];

  for (const cid of updateClients) {
    await writeDoc('updates', `${cid}_upd_sign`, {
      id: `${cid}_upd_sign`,
      updateId: `${cid}_upd_sign`,
      type: 'client_event',
      category: 'action',
      scope: 'client',
      clientId: cid,
      firmId: 'firm_pivot_aide',
      title: 'Your Form 8879 is ready to sign',
      meta: 'Once both signatures are in we transmit, usually the next business day.',
      time: 'Today, 8:02 AM',
      publishedAt: '2026-09-02T08:02:00.000Z',
      isNew: true,
      isRead: false,
      actionScreen: 'sign',
      actionText: 'Sign Form 8879'
    });

    await writeDoc('updates', `${cid}_upd_msg`, {
      id: `${cid}_upd_msg`,
      updateId: `${cid}_upd_msg`,
      type: 'client_event',
      category: 'messages',
      scope: 'client',
      clientId: cid,
      firmId: 'firm_pivot_aide',
      title: 'Denise replied about your Closing Disclosure',
      meta: 'Closing Disclosure verified · Loan origination points under active review.',
      time: 'Today, 10:05 AM',
      publishedAt: new Date(Date.now() - 3600000).toISOString(),
      isNew: true,
      isRead: false,
      actionScreen: 'msgs',
      actionText: 'Open Message Thread'
    });

    await writeDoc('updates', `${cid}_upd_pa`, {
      id: `${cid}_upd_pa`,
      updateId: `${cid}_upd_pa`,
      type: 'client_event',
      category: 'engagement',
      scope: 'client',
      clientId: cid,
      firmId: 'firm_pivot_aide',
      title: 'Tax Year 2026 engagement file initialized',
      meta: 'Circular 230 compliant engagement file opened with Denise R., CPA.',
      time: '29 Aug 2026',
      publishedAt: '2026-08-29T11:15:00.000Z',
      isNew: false,
      isRead: true,
      actionScreen: 'svcs',
      actionText: 'Review Scope'
    });
  }

  console.log('✨ Emulator successfully populated with live interlinked practice data!');
}

main().catch(console.error);
