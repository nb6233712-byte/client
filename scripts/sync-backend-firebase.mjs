// scripts/sync-backend-firebase.mjs
// Synchronizes canonical practice engagements, signatures, and client profiles to Cloud Firestore (uk-client-d90d5)

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'uk-client-d90d5';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof val === 'string') {
      fields[key] = { stringValue: val };
    } else if (typeof val === 'number') {
      if (Number.isInteger(val)) {
        fields[key] = { integerValue: String(val) };
      } else {
        fields[key] = { doubleValue: val };
      }
    } else if (typeof val === 'boolean') {
      fields[key] = { booleanValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map(item => {
            if (typeof item === 'object') return { mapValue: { fields: toFirestoreFields(item) } };
            if (typeof item === 'string') return { stringValue: item };
            if (typeof item === 'number') return { doubleValue: item };
            if (typeof item === 'boolean') return { booleanValue: item };
            return { stringValue: String(item) };
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
  const url = `${BASE_URL}/${collection}/${encodeURIComponent(docId)}`;
  const body = JSON.stringify({ fields: toFirestoreFields(data) });
  const headers = { 'Content-Type': 'application/json' };
  const token = process.env.FIREBASE_ID_TOKEN || process.env.FIREBASE_AUTH_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`Failed to write ${collection}/${docId}:`, errText);
    return false;
  }
  return true;
}

// 24 Canonical Practice Engagements
const ENGAGEMENTS = [
  {
    id: "eng_2026_whitfield",
    clientUid: "usr_whitfield_4417",
    clientName: "Michael & Elena Whitfield",
    name: "Michael & Elena Whitfield",
    clientEmail: "m.whitfield@example.com",
    email: "m.whitfield@example.com",
    taxYear: 2026,
    filingType: "Form 1040 (Joint · MD/VA/PA)",
    stage: "in_preparation",
    stageName: "In preparation",
    stageNum: 3,
    overallProgress: 68,
    progressPct: 68,
    federalRefund: 3418.00,
    stateBalanceDue: 612.00,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Oct 15, 2026 (Extension)",
    status: "active"
  },
  {
    id: "eng_2026_usr_taylor_bennett_test_example_com",
    clientUid: "usr_taylor_bennett_test_example_com",
    clientName: "Taylor Bennett",
    name: "Taylor Bennett",
    clientEmail: "taylor.bennett.test@example.com",
    email: "taylor.bennett.test@example.com",
    taxYear: 2026,
    filingType: "Form 1040 (Single · MD)",
    stage: "in_preparation",
    stageName: "In preparation",
    stageNum: 3,
    overallProgress: 68,
    progressPct: 68,
    federalRefund: 3418.00,
    stateBalanceDue: 612.00,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Oct 15, 2026 (Extension)",
    status: "active"
  },
  {
    id: "eng_okonjo_2026",
    clientUid: "usr_okonjo_a",
    clientName: "Ada Okonjo",
    name: "Ada Okonjo",
    clientEmail: "a.okonjo@example.com",
    email: "a.okonjo@example.com",
    taxYear: 2026,
    filingType: "Form 1040 + Schedule C (Sole Prop)",
    stage: "signing_pending",
    stageName: "Signing pending",
    stageNum: 5,
    overallProgress: 85,
    progressPct: 85,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_brennan_2026",
    clientUid: "usr_brennan_llc",
    clientName: "Brennan Holdings LLC",
    name: "Brennan Holdings LLC",
    clientEmail: "c.brennan@brennan-holdings.example",
    email: "c.brennan@brennan-holdings.example",
    taxYear: 2026,
    filingType: "Form 1065 (Multi-Member Partnership)",
    stage: "signing_pending",
    stageName: "Signing pending (KBA Lockout)",
    stageNum: 5,
    overallProgress: 80,
    progressPct: 80,
    assignedPreparer: "Marcus Chen, EA",
    deadlines: "Sep 15, 2026",
    status: "active"
  },
  {
    id: "eng_ferrante_2026",
    clientUid: "usr_ferrante_l",
    clientName: "Liam Ferrante",
    name: "Liam Ferrante",
    clientEmail: "l.ferrante@example.com",
    email: "l.ferrante@example.com",
    taxYear: 2026,
    filingType: "Form 1040 + IRS CP2000 Response",
    stage: "review",
    stageName: "Practitioner review",
    stageNum: 4,
    overallProgress: 75,
    progressPct: 75,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Notice Response Due Thu",
    status: "active"
  },
  {
    id: "eng_jenkins_2026",
    clientUid: "usr_jenkins_s",
    clientName: "Sarah Jenkins (Jenkins Design Inc)",
    name: "Sarah Jenkins (Jenkins Design Inc)",
    clientEmail: "s.jenkins@example.com",
    email: "s.jenkins@example.com",
    taxYear: 2026,
    filingType: "Form 1120-S (S-Corporation)",
    stage: "docs_pending",
    stageName: "Documents pending",
    stageNum: 2,
    overallProgress: 35,
    progressPct: 35,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Sep 15, 2026",
    status: "active"
  },
  {
    id: "eng_sterling_2026",
    clientUid: "usr_sterling_d",
    clientName: "David Sterling",
    name: "David Sterling",
    clientEmail: "d.sterling@example.com",
    email: "d.sterling@example.com",
    taxYear: 2026,
    filingType: "Form 1040 + Schedule E (Rental)",
    stage: "in_preparation",
    stageName: "In preparation",
    stageNum: 3,
    overallProgress: 55,
    progressPct: 55,
    assignedPreparer: "Marcus Chen, EA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_apex_2026",
    clientUid: "usr_apex_corp",
    clientName: "Apex Logistics Corp",
    name: "Apex Logistics Corp",
    clientEmail: "billing@apex-logistics.example",
    email: "billing@apex-logistics.example",
    taxYear: 2026,
    filingType: "Form 1120-S Corporate Return",
    stage: "efile_ready",
    stageName: "IRS Transmitted",
    stageNum: 6,
    overallProgress: 100,
    progressPct: 100,
    assignedPreparer: "Managing Partner",
    deadlines: "Completed",
    status: "active"
  },
  {
    id: "eng_chen_2026",
    clientUid: "usr_chen_m",
    clientName: "Marcus & Wei Chen",
    name: "Marcus & Wei Chen",
    clientEmail: "w.chen@example.com",
    email: "w.chen@example.com",
    taxYear: 2026,
    filingType: "Form 1040 (Joint · CA/NY)",
    stage: "onboarding",
    stageName: "Intake Opened",
    stageNum: 1,
    overallProgress: 15,
    progressPct: 15,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_rodriguez_2026",
    clientUid: "usr_rodriguez_e",
    clientName: "Elena Rodriguez",
    name: "Elena Rodriguez",
    clientEmail: "e.rodriguez@example.com",
    email: "e.rodriguez@example.com",
    taxYear: 2026,
    filingType: "Form 1040 + Schedule C",
    stage: "onboarding",
    stageName: "Intake Opened",
    stageNum: 1,
    overallProgress: 10,
    progressPct: 10,
    assignedPreparer: "Marcus Chen, EA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_patel_2026",
    clientUid: "usr_patel_a",
    clientName: "Aarav Patel",
    name: "Aarav Patel",
    clientEmail: "a.patel@example.com",
    email: "a.patel@example.com",
    taxYear: 2026,
    filingType: "Form 1040 + Foreign Assets (FBAR)",
    stage: "docs_pending",
    stageName: "Documents pending",
    stageNum: 2,
    overallProgress: 40,
    progressPct: 40,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_kowalski_2026",
    clientUid: "usr_kowalski_j",
    clientName: "Jan Kowalski",
    name: "Jan Kowalski",
    clientEmail: "j.kowalski@example.com",
    email: "j.kowalski@example.com",
    taxYear: 2026,
    filingType: "Form 1040 (Single)",
    stage: "docs_pending",
    stageName: "Documents pending",
    stageNum: 2,
    overallProgress: 30,
    progressPct: 30,
    assignedPreparer: "Marcus Chen, EA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_dubois_2026",
    clientUid: "usr_dubois_c",
    clientName: "Claire Dubois",
    name: "Claire Dubois",
    clientEmail: "c.dubois@example.com",
    email: "c.dubois@example.com",
    taxYear: 2026,
    filingType: "Form 1040 + Schedule E",
    stage: "in_preparation",
    stageName: "In preparation",
    stageNum: 3,
    overallProgress: 60,
    progressPct: 60,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_vance_2026",
    clientUid: "usr_vance_v",
    clientName: "Vance Logistics Corp",
    name: "Vance Logistics Corp",
    clientEmail: "vance@vance-logistics.example",
    email: "vance@vance-logistics.example",
    taxYear: 2026,
    filingType: "Form 1120-S Corporate Return",
    stage: "review",
    stageName: "Practitioner review",
    stageNum: 4,
    overallProgress: 78,
    progressPct: 78,
    assignedPreparer: "Managing Partner",
    deadlines: "Sep 15, 2026",
    status: "active"
  },
  {
    id: "eng_morales_2026",
    clientUid: "usr_morales_s",
    clientName: "Sofia Morales",
    name: "Sofia Morales",
    clientEmail: "s.morales@example.com",
    email: "s.morales@example.com",
    taxYear: 2026,
    filingType: "Form 1040 (Single · IL)",
    stage: "onboarding",
    stageName: "Intake Opened",
    stageNum: 1,
    overallProgress: 20,
    progressPct: 20,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_zimmerman_2026",
    clientUid: "usr_zimmerman_r",
    clientName: "Robert Zimmerman",
    name: "Robert Zimmerman",
    clientEmail: "r.zimmerman@example.com",
    email: "r.zimmerman@example.com",
    taxYear: 2026,
    filingType: "Form 1040 + Form 8829 (Home Office)",
    stage: "in_preparation",
    stageName: "In preparation",
    stageNum: 3,
    overallProgress: 50,
    progressPct: 50,
    assignedPreparer: "Marcus Chen, EA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_foster_2026",
    clientUid: "usr_foster_h",
    clientName: "Harper Foster LLC",
    name: "Harper Foster LLC",
    clientEmail: "h.foster@example.com",
    email: "h.foster@example.com",
    taxYear: 2026,
    filingType: "Form 1065 Partnership",
    stage: "review",
    stageName: "Practitioner review",
    stageNum: 4,
    overallProgress: 72,
    progressPct: 72,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Sep 15, 2026",
    status: "active"
  },
  {
    id: "eng_sullivan_2026",
    clientUid: "usr_sullivan_p",
    clientName: "Patrick Sullivan",
    name: "Patrick Sullivan",
    clientEmail: "p.sullivan@example.com",
    email: "p.sullivan@example.com",
    taxYear: 2026,
    filingType: "Form 1040 (MFJ · MA)",
    stage: "docs_pending",
    stageName: "Documents pending",
    stageNum: 2,
    overallProgress: 45,
    progressPct: 45,
    assignedPreparer: "Marcus Chen, EA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_nielsen_2026",
    clientUid: "usr_nielsen_m",
    clientName: "Mette Nielsen",
    name: "Mette Nielsen",
    clientEmail: "m.nielsen@example.com",
    email: "m.nielsen@example.com",
    taxYear: 2026,
    filingType: "Form 1040 + Foreign Income (2555)",
    stage: "in_preparation",
    stageName: "In preparation",
    stageNum: 3,
    overallProgress: 58,
    progressPct: 58,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_alvarez_2026",
    clientUid: "usr_alvarez_j",
    clientName: "Jorge Alvarez",
    name: "Jorge Alvarez",
    clientEmail: "j.alvarez@example.com",
    email: "j.alvarez@example.com",
    taxYear: 2026,
    filingType: "Form 1040 (Single · TX)",
    stage: "onboarding",
    stageName: "Intake Opened",
    stageNum: 1,
    overallProgress: 18,
    progressPct: 18,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_kim_2026",
    clientUid: "usr_kim_s",
    clientName: "Sun-Hee Kim",
    name: "Sun-Hee Kim",
    clientEmail: "s.kim@example.com",
    email: "s.kim@example.com",
    taxYear: 2026,
    filingType: "Form 1040 + Schedule C",
    stage: "in_preparation",
    stageName: "In preparation",
    stageNum: 3,
    overallProgress: 62,
    progressPct: 62,
    assignedPreparer: "Marcus Chen, EA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_becker_2026",
    clientUid: "usr_becker_k",
    clientName: "Klaus Becker",
    name: "Klaus Becker",
    clientEmail: "k.becker@example.com",
    email: "k.becker@example.com",
    taxYear: 2026,
    filingType: "Form 1040 + Form 1116 Foreign Tax",
    stage: "onboarding",
    stageName: "Intake Opened",
    stageNum: 1,
    overallProgress: 12,
    progressPct: 12,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_trent_2026",
    clientUid: "usr_trent_b",
    clientName: "Trent BioTech Solutions",
    name: "Trent BioTech Solutions",
    clientEmail: "finance@trentbiotech.example",
    email: "finance@trentbiotech.example",
    taxYear: 2026,
    filingType: "Form 1120 Corporate + R&D Credit",
    stage: "review",
    stageName: "Practitioner review",
    stageNum: 4,
    overallProgress: 82,
    progressPct: 82,
    assignedPreparer: "Managing Partner",
    deadlines: "Oct 15, 2026",
    status: "active"
  },
  {
    id: "eng_gallagher_2026",
    clientUid: "usr_gallagher_m",
    clientName: "Megan Gallagher",
    name: "Megan Gallagher",
    clientEmail: "m.gallagher@example.com",
    email: "m.gallagher@example.com",
    taxYear: 2026,
    filingType: "Form 1040 (Head of Household)",
    stage: "docs_pending",
    stageName: "Documents pending",
    stageNum: 2,
    overallProgress: 38,
    progressPct: 38,
    assignedPreparer: "Denise R., CPA",
    deadlines: "Oct 15, 2026",
    status: "active"
  }
];

// Pending Signatures
const SIGNATURES = [
  {
    id: "sig_8879_whitfield",
    clientUid: "usr_whitfield_4417",
    clientName: "Michael & Elena Whitfield",
    engagementId: "eng_2026_whitfield",
    form: "Form 8879",
    taxYear: 2026,
    title: "IRS e-file Signature Authorization (Form 8879)",
    status: "pending",
    kbaRequired: true,
    primarySigner: {
      name: "Michael Whitfield",
      email: "m.whitfield@example.com",
      role: "primary",
      status: "pending",
      attemptsLeft: 3
    },
    secondarySigner: {
      name: "Elena Whitfield",
      email: "e.whitfield@example.com",
      role: "spouse",
      status: "pending",
      attemptsLeft: 3
    },
    createdAt: "2026-09-08T10:00:00.000Z"
  },
  {
    id: "sig_8879_taylor_bennett",
    clientUid: "usr_taylor_bennett_test_example_com",
    clientName: "Taylor Bennett",
    engagementId: "eng_2026_usr_taylor_bennett_test_example_com",
    form: "Form 8879",
    taxYear: 2026,
    title: "IRS e-file Signature Authorization (Form 8879)",
    status: "pending",
    kbaRequired: true,
    primarySigner: {
      name: "Taylor Bennett",
      email: "taylor.bennett.test@example.com",
      role: "primary",
      status: "pending",
      attemptsLeft: 3
    },
    createdAt: "2026-09-08T10:00:00.000Z"
  },
  {
    id: "sig_8879_okonjo",
    clientUid: "usr_okonjo_a",
    clientName: "Ada Okonjo",
    engagementId: "eng_okonjo_2026",
    form: "Form 8879",
    taxYear: 2026,
    title: "IRS e-file Signature Authorization (Form 8879)",
    status: "pending",
    kbaRequired: true,
    primarySigner: {
      name: "Ada Okonjo",
      email: "a.okonjo@example.com",
      role: "primary",
      status: "pending",
      attemptsLeft: 2
    },
    createdAt: "2026-08-28T10:00:00.000Z"
  },
  {
    id: "sig_8879_brennan",
    clientUid: "usr_brennan_llc",
    clientName: "Brennan Holdings LLC",
    engagementId: "eng_brennan_2026",
    form: "Form 8879-PE",
    taxYear: 2026,
    title: "IRS e-file Partnership Authorization (Form 8879-PE)",
    status: "pending",
    isLockedOut: true,
    primarySigner: {
      name: "Charles Brennan",
      email: "c.brennan@brennan-holdings.example",
      role: "primary",
      status: "pending",
      attemptsLeft: 0
    },
    createdAt: "2026-09-01T10:00:00.000Z"
  }
];

// Canonical Prepared Returns (5 Awaiting Publication / Review)
const TAX_RETURNS = [
  {
    id: "ret_whitfield_2026",
    returnId: "ret_whitfield_2026",
    client: "Michael & Elena Whitfield",
    clientName: "Michael & Elena Whitfield",
    clientUid: "usr_whitfield_4417",
    taxYear: 2026,
    returnType: "Form 1040 (MD Resident · VA/PA Non-Res)",
    formType: "Form 1040 (MD Resident · VA/PA Non-Res)",
    agi: "$148,600",
    refundOrDue: "Federal Refund: $4,850 · MD Due: $612",
    preparer: "Denise R., CPA",
    published: false,
    clientApproved: false,
    approvalStatus: "pending_review",
    createdAt: "2026-09-02T08:00:00Z"
  },
  {
    id: "ret_taylor_2026",
    returnId: "ret_taylor_2026",
    client: "Taylor Bennett",
    clientName: "Taylor Bennett",
    clientUid: "usr_taylor_bennett_test_example_com",
    taxYear: 2026,
    returnType: "Form 1040",
    formType: "Form 1040",
    agi: "$94,200",
    refundOrDue: "Awaiting Final Review",
    preparer: "Denise R., CPA",
    published: false,
    clientApproved: false,
    approvalStatus: "pending_review",
    createdAt: "2026-09-04T10:00:00Z"
  },
  {
    id: "ret_okonjo_2026",
    returnId: "ret_okonjo_2026",
    client: "Ada Okonjo",
    clientName: "Ada Okonjo",
    clientUid: "usr_okonjo_a",
    taxYear: 2026,
    returnType: "Form 1040 + Schedule C",
    formType: "Form 1040 + Schedule C",
    agi: "$112,400",
    refundOrDue: "Federal Due: $2,180 · VA Due: $340",
    preparer: "Denise R., CPA",
    published: false,
    clientApproved: false,
    approvalStatus: "pending_review",
    createdAt: "2026-08-28T12:00:00Z"
  },
  {
    id: "ret_sterling_2026",
    returnId: "ret_sterling_2026",
    client: "David Sterling",
    clientName: "David Sterling",
    clientUid: "usr_sterling_d",
    taxYear: 2026,
    returnType: "Form 1040 + Schedule E",
    formType: "Form 1040 + Schedule E",
    agi: "$184,200",
    refundOrDue: "Draft calculation in Lacerte",
    preparer: "Denise R., CPA",
    published: false,
    clientApproved: false,
    approvalStatus: "pending_review",
    createdAt: "2026-08-20T14:00:00Z"
  },
  {
    id: "ret_vance_2026",
    returnId: "ret_vance_2026",
    client: "Vance Logistics Corp",
    clientName: "Vance Logistics Corp",
    clientUid: "usr_vance_v",
    taxYear: 2026,
    returnType: "Form 1120-S",
    formType: "Form 1120-S",
    agi: "$890,500 Gross Receipts",
    refundOrDue: "State Franchise Tax: $1,450",
    preparer: "Denise R., CPA",
    published: true,
    clientApproved: true,
    approvalStatus: "approved",
    efileReady: true,
    createdAt: "2026-08-24T10:00:00Z"
  }
];

// Canonical Document Requests (Checklist Items)
const DOCUMENT_REQUESTS = [
  {
    id: "req_w2_whitfield",
    requestId: "req_w2_whitfield",
    clientId: "usr_whitfield_4417",
    clientName: "Michael & Elena Whitfield",
    title: "Form W-2 Wage & Tax Statement (Halstead Medical Group)",
    category: "Income",
    status: "accepted",
    dueDate: "2026-08-15"
  },
  {
    id: "req_1099misc_whitfield",
    requestId: "req_1099misc_whitfield",
    clientId: "usr_whitfield_4417",
    clientName: "Michael & Elena Whitfield",
    title: "Rental Property 1099-MISC (Keystone Property Group)",
    category: "Schedule E",
    status: "pending",
    dueDate: "2026-08-28"
  },
  {
    id: "req_k1_whitfield",
    requestId: "req_k1_whitfield",
    clientId: "usr_whitfield_4417",
    clientName: "Michael & Elena Whitfield",
    title: "Schedule K-1 (Blue Ridge Tech Partners LLC)",
    category: "Pass-Through",
    status: "pending",
    dueDate: "2026-08-28"
  },
  {
    id: "req_closing_whitfield",
    requestId: "req_closing_whitfield",
    clientId: "usr_whitfield_4417",
    clientName: "Michael & Elena Whitfield",
    title: "Closing Disclosure (Refinance Settlement)",
    category: "Real Estate",
    status: "review",
    dueDate: "2026-08-20"
  },
  {
    id: "req_1099k_okonjo",
    requestId: "req_1099k_okonjo",
    clientId: "usr_okonjo_a",
    clientName: "Ada Okonjo",
    title: "Form 1099-K Square Annual Processing",
    category: "Schedule C Gross Receipts",
    status: "review",
    dueDate: "2026-09-03"
  },
  {
    id: "req_deprec_brennan",
    requestId: "req_deprec_brennan",
    clientId: "usr_brennan_llc",
    clientName: "Brennan Holdings LLC",
    title: "2025 Depreciation Schedule & Fixed Assets",
    category: "Form 4562 Depreciation",
    status: "rejected",
    rejectionReason: "Missing acquisition dates and asset classifications on page 3",
    dueDate: "2026-08-28"
  }
];

// Canonical Uploaded Documents
const DOCUMENTS = [
  {
    id: "doc_closing_whitfield",
    documentId: "doc_closing_whitfield",
    requestId: "req_closing_whitfield",
    clientId: "usr_whitfield_4417",
    clientName: "Michael & Elena Whitfield",
    name: "Closing Disclosure Refinance 2026.pdf",
    fileName: "Closing Disclosure Refinance 2026.pdf",
    category: "Real Estate",
    fileSizeBytes: 2411724,
    pages: 5,
    uploadedAt: "2026-08-20T14:22:00Z",
    status: "pending_review",
    scanStatus: "Clean (0 Threats · ClamAV)"
  },
  {
    id: "doc_1099k_okonjo",
    documentId: "doc_1099k_okonjo",
    requestId: "req_1099k_okonjo",
    clientId: "usr_okonjo_a",
    clientName: "Ada Okonjo",
    name: "Form 1099-K Square Annual Processing.pdf",
    fileName: "Form 1099-K Square Annual Processing.pdf",
    category: "Schedule C Gross Receipts",
    fileSizeBytes: 1153433,
    pages: 4,
    uploadedAt: "2026-09-03T11:05:00Z",
    status: "pending_review",
    scanStatus: "Clean (0 Threats · ClamAV)"
  },
  {
    id: "doc_k1_sterling",
    documentId: "doc_k1_sterling",
    requestId: "req_k1_sterling",
    clientId: "usr_sterling_d",
    clientName: "David Sterling",
    name: "Schedule K-1 — Blue Ridge Syndicate LLC.pdf",
    fileName: "Schedule K-1 — Blue Ridge Syndicate LLC.pdf",
    category: "Pass-Through Entity",
    fileSizeBytes: 839680,
    pages: 5,
    uploadedAt: "2026-09-01T09:18:00Z",
    status: "pending_review",
    scanStatus: "Clean (0 Threats · ClamAV)"
  },
  {
    id: "doc_deprec_brennan",
    documentId: "doc_deprec_brennan",
    requestId: "req_deprec_brennan",
    clientId: "usr_brennan_llc",
    clientName: "Brennan Holdings LLC",
    name: "2025 Depreciation Schedule & Fixed Assets.pdf",
    fileName: "2025 Depreciation Schedule & Fixed Assets.pdf",
    category: "Form 4562 Depreciation",
    fileSizeBytes: 3355443,
    pages: 18,
    uploadedAt: "2026-08-28T16:40:00Z",
    status: "rejected",
    rejectionReason: "Missing acquisition dates and asset classifications on page 3",
    scanStatus: "Clean (0 Threats · ClamAV)"
  }
];

// Canonical Practice Invoices
const INVOICES = [
  {
    id: "inv_2026_001",
    invoiceId: "inv_2026_001",
    clientId: "usr_whitfield_4417",
    clientName: "Michael & Elena Whitfield",
    title: "TY2026 Tax Preparation (Joint Individual + Schedule C & E)",
    amount: 450.00,
    amountDue: 0.00,
    total: 450.00,
    status: "paid",
    paidAt: "2026-08-15T14:30:00Z"
  },
  {
    id: "inv_2026_002",
    invoiceId: "inv_2026_002",
    clientId: "usr_taylor_bennett_test_example_com",
    clientName: "Taylor Bennett",
    title: "TY2026 Form 1040 Extension & Prep Fee",
    amount: 120.00,
    amountDue: 120.00,
    total: 120.00,
    status: "failed",
    failureReason: "ACH Debit Return ($120.00 - R01 Insufficient Funds)",
    dueDate: "2026-08-30"
  },
  {
    id: "inv_2026_003",
    invoiceId: "inv_2026_003",
    clientId: "usr_okonjo_a",
    clientName: "Ada Okonjo",
    title: "TY2026 Schedule C Business Income Tax Prep",
    amount: 850.00,
    amountDue: 850.00,
    total: 850.00,
    status: "unpaid",
    dueDate: "2026-09-15"
  },
  {
    id: "inv_2026_004",
    invoiceId: "inv_2026_004",
    clientId: "usr_brennan_llc",
    clientName: "Brennan Holdings LLC",
    title: "TY2026 Form 1065 Partnership Tax Engagement",
    amount: 1450.00,
    amountDue: 0.00,
    total: 1450.00,
    status: "paid",
    paidAt: "2026-08-25T11:00:00Z"
  }
];

// Canonical WORM Audit Log Entries
const AUDIT_LOGS = [
  {
    id: "log_kba_lockout_brennan",
    action: "KBA Identity Challenge Lockout",
    eventType: "KBA_CHALLENGE_EVALUATED",
    details: "Failed 3 consecutive out-of-wallet identity questions. Remote e-sig revoked under IRS Pub 1345 § 5.2.2.",
    category: "Signatures",
    uid: "usr_brennan_llc",
    clientName: "Brennan Holdings LLC",
    recordedAt: "2026-09-01T10:15:00Z",
    actor: "IRS Pub 1345 KBA Verification Daemon",
    provenance: "system_security",
    sha256Seal: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
  },
  {
    id: "log_doc_review_whitfield",
    action: "Document Accepted under Circular 230 § 10.22",
    eventType: "DOCUMENT_ACCEPTED",
    details: "Form W-2 Wage Statement verified & cleared for Form 1040 draft preparation.",
    category: "Documents",
    uid: "usr_whitfield_4417",
    clientName: "Michael & Elena Whitfield",
    recordedAt: "2026-08-16T09:30:00Z",
    actor: "denise@pivot-aide.tax",
    provenance: "firm_staff",
    sha256Seal: "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"
  }
];

// Canonical Portal Updates
const UPDATES = [
  {
    id: "upd_deadline_q3",
    updateId: "upd_deadline_q3",
    type: "deadline_reminder",
    title: "Q3 2026 Estimated Tax Payment Due September 15",
    meta: "IRS and state estimated payments must be transmitted or postmarked by September 15, 2026.",
    scope: "practice_wide",
    isNew: true,
    isRead: false,
    createdAt: "2026-09-01T08:00:00Z"
  }
];

// Canonical Thread Messages
const MESSAGES = [
  {
    id: "msg_mw_001",
    messageId: "msg_mw_001",
    clientId: "usr_whitfield_4417",
    engagementId: "eng_2026_whitfield",
    senderId: "preparer_denise_cpa",
    senderName: "Denise R., CPA",
    senderRole: "preparer",
    avatar: "DR",
    text: "I have the closing disclosure — thank you. One question: was the Halcyon Row property let for the whole year, or was there a vacant stretch after the tenants left in March?",
    createdAt: "2026-09-02T09:14:00.000Z",
    readByClient: true,
    readByFirm: true
  },
  {
    id: "msg_mw_002",
    messageId: "msg_mw_002",
    clientId: "usr_whitfield_4417",
    engagementId: "eng_2026_whitfield",
    senderId: "usr_whitfield_4417",
    senderName: "Michael Whitfield",
    senderRole: "client",
    avatar: "MW",
    text: "Yes, it was vacant for 6 weeks in January/February, then re-let starting March 15th at $2,400/mo.",
    createdAt: "2026-09-02T09:31:00.000Z",
    readByClient: true,
    readByFirm: true
  },
  {
    id: "msg_mw_003",
    messageId: "msg_mw_003",
    clientId: "usr_whitfield_4417",
    engagementId: "eng_2026_whitfield",
    senderId: "preparer_denise_cpa",
    senderName: "Denise R., CPA",
    senderRole: "preparer",
    avatar: "DR",
    text: "Perfect, I have updated Schedule E line 2 (fair rental days = 291). We just need the 1099-MISC from Keystone and the return is ready for signature!",
    createdAt: "2026-10-13T10:05:00.000Z",
    readByClient: true,
    readByFirm: true
  },
  {
    id: "msg_bh_001",
    messageId: "msg_bh_001",
    clientId: "usr_brennan_llc",
    engagementId: "eng_brennan_2026",
    senderId: "usr_brennan_llc",
    senderName: "Charles Brennan",
    senderRole: "client",
    avatar: "CB",
    text: "Marcus, when do you expect the K-1 allocation schedules for our limited partners to be finalized?",
    createdAt: "2026-10-12T14:20:00.000Z",
    readByClient: true,
    readByFirm: true
  },
  {
    id: "msg_bh_002",
    messageId: "msg_bh_002",
    clientId: "usr_brennan_llc",
    engagementId: "eng_brennan_2026",
    senderId: "preparer_marcus_ea",
    senderName: "Marcus Chen, EA",
    senderRole: "preparer",
    avatar: "MC",
    text: "Hi Charles, K-1 allocations are ready. We are preparing the Form 8879-PE wet-ink signature packet following the KBA lockout review.",
    createdAt: "2026-10-12T16:45:00.000Z",
    readByClient: true,
    readByFirm: true
  },
  {
    id: "msg_tb_001",
    messageId: "msg_tb_001",
    clientId: "usr_taylor_bennett_test_example_com",
    engagementId: "eng_2026_usr_taylor_bennett_test_example_com",
    senderId: "preparer_denise_cpa",
    senderName: "Denise R., CPA",
    senderRole: "preparer",
    avatar: "DR",
    text: "Taylor, your Form 1040 draft is ready for review. Please inspect your return and provide updated payment account info for the prep fee.",
    createdAt: "2026-10-13T09:40:00.000Z",
    readByClient: false,
    readByFirm: true
  }
];

async function run() {
  console.log(`🚀 Writing ${ENGAGEMENTS.length} canonical engagements to Firestore...`);
  for (const eng of ENGAGEMENTS) {
    await writeDoc('engagements', eng.id, eng);
  }
  console.log(`✓ ${ENGAGEMENTS.length} engagements written!`);

  console.log(`🚀 Writing ${SIGNATURES.length} canonical signatures to Firestore...`);
  for (const sig of SIGNATURES) {
    await writeDoc('signatures', sig.id, sig);
  }
  console.log(`✓ ${SIGNATURES.length} signatures written!`);

  console.log(`🚀 Writing ${TAX_RETURNS.length} canonical tax returns to Firestore...`);
  for (const ret of TAX_RETURNS) {
    await writeDoc('tax_returns', ret.id, ret);
  }
  console.log(`✓ ${TAX_RETURNS.length} tax returns written!`);

  console.log(`🚀 Writing ${DOCUMENT_REQUESTS.length} canonical document requests to Firestore...`);
  for (const req of DOCUMENT_REQUESTS) {
    await writeDoc('documentRequests', req.id, req);
  }
  console.log(`✓ ${DOCUMENT_REQUESTS.length} document requests written!`);

  console.log(`🚀 Writing ${DOCUMENTS.length} canonical documents to Firestore...`);
  for (const doc of DOCUMENTS) {
    await writeDoc('documents', doc.id, doc);
  }
  console.log(`✓ ${DOCUMENTS.length} documents written!`);

  console.log(`🚀 Writing ${INVOICES.length} canonical invoices to Firestore...`);
  for (const inv of INVOICES) {
    await writeDoc('invoices', inv.id, inv);
  }
  console.log(`✓ ${INVOICES.length} invoices written!`);

  console.log(`🚀 Writing ${AUDIT_LOGS.length} canonical audit logs to Firestore...`);
  for (const log of AUDIT_LOGS) {
    await writeDoc('audit_logs', log.id, log);
  }
  console.log(`✓ ${AUDIT_LOGS.length} audit logs written!`);

  console.log(`🚀 Writing ${UPDATES.length} canonical updates to Firestore...`);
  for (const upd of UPDATES) {
    await writeDoc('updates', upd.id, upd);
  }
  console.log(`✓ ${UPDATES.length} updates written!`);

  console.log(`🚀 Writing ${MESSAGES.length} canonical messages to Firestore...`);
  for (const msg of MESSAGES) {
    await writeDoc('messages', msg.id, msg);
  }
  console.log(`✓ ${MESSAGES.length} messages written!`);

  console.log('\n🎉 ALL CANONICAL PRACTICE DATA SUCCESSFULLY COMMITTED TO CLOUD FIRESTORE!');
}

run();
