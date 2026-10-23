# Firebase Cloud Functions & Trusted Backend Architecture
## Pivot Aide Tax — The File Room

This document defines the server-side architecture, trust boundaries, secret management, and deployment procedures for the trusted backend operations of **The File Room**.

---

## 1. Trust Boundary Analysis: Browser vs. Server Execution

Under **Treasury Circular 230**, the **FTC Safeguards Rule (16 CFR Part 314)**, **IRC § 7216**, and **IRS Publication 1345**, client-side browser execution must be strictly demarcated from authoritative backend execution.

### Safe for Browser Client Execution
- **Reading Own Data:** Querying client checklists, uploaded files, invoices, and message history (restricted by `firestore.rules`).
- **File Upload to Storage:** Streaming encrypted bytes directly to Firebase Storage (`clients/{uid}/...`) using short-lived security credentials.
- **Client Message Sending:** Submitting a message to the taxpayer's own conversation thread.
- **Non-Authoritative Telemetry:** Logging user interface interactions, screen navigations, and preliminary drafting actions.
- **Taxpayer Form 8879 Review Acknowledgment:** Initiating the signing flow in the UI.

### Mandatory for Trusted Server Execution (Cloud Functions / Admin SDK)
The following 9 operations **must never** execute in the browser:

| # | Operation | Why Server Execution is Mandatory | Governing Standard |
|---|---|---|---|
| **1** | **Staff Role Provisioning** | Firebase Auth custom claims (`admin.auth().setCustomUserClaims`) can only be modified by the Firebase Admin SDK. Browser execution would allow privilege escalation. | FTC Safeguards § 314.4(c) |
| **2** | **Document Acceptance & Rejection** | Taxpayers cannot accept or reject their own documents. A licensed practitioner must perform due diligence before advancing status. | Circular 230 § 10.22 |
| **3** | **Return Approval & Publication** | Preparers publish returns; clients approve them. Transitioning to the IRS transmission queue locks the return against client tampering. | Treas. Reg. § 301.7216-2 |
| **4** | **Trusted Audit-Event Creation** | Authoritative regulatory events (`PAYMENT_CONFIRMED`, `SIGNATURE_COMPLETED`, etc.) must be signed by the server with SHA-256 hashes to prevent client spoofing. | IRS Pub 1345 & FTC § 314.4 |
| **5** | **Payment Checkout-Session Creation** | Gateway secret keys (`STRIPE_SECRET_KEY`) must never be bundled into browser code (PCI-DSS violation). Server verifies invoice status and generates short-lived session. | PCI-DSS v4.0.1 SAQ-A |
| **6** | **Payment Webhook Verification** | Browser cannot mark an invoice paid. Server verifies cryptographic HMAC (`stripe-signature`) and prevents duplicate reconciliation via idempotency keys. | PCI-DSS & IRC § 6694 |
| **7** | **Signing-Provider Callbacks & KBA** | Callback signatures from e-signing providers must be verified via HMAC. Server enforces the 3-attempt KBA lockout rule under IRS Pub 1345. | IRS Pub 1345 § 5.2.2 |
| **8** | **File Validation & Malware Scanning** | Clients must not declare their own uploads clean. Server-side triggers inspect file headers, run ClamAV scans, and quarantine threats. | FTC Safeguards § 314.4(c)(2) |
| **9** | **Authorized Notification Triggers** | Outbound emails must be sanitized to strip SSNs, EINs, and tax figures before reaching Postmark. API tokens must remain secure. | IRC § 7216 & FTC Safeguards |

---

## 2. Google Cloud Secret Manager Configuration

All privileged credentials are stored in **Google Cloud Secret Manager** and accessed at runtime. Secrets are never stored in plaintext code or environment config files committed to Git.

### Required Secrets

```bash
# 1. Stripe Secret API Key
gcloud secrets create STRIPE_SECRET_KEY --replication-policy="automatic"
echo -n "sk_live_..." | gcloud secrets versions add STRIPE_SECRET_KEY --data-file=-

# 2. Stripe Webhook Signing Secret
gcloud secrets create STRIPE_WEBHOOK_SECRET --replication-policy="automatic"
echo -n "whsec_..." | gcloud secrets versions add STRIPE_WEBHOOK_SECRET --data-file=-

# 3. Remote E-Signature Provider Webhook Secret
gcloud secrets create SIGNING_PROVIDER_WEBHOOK_SECRET --replication-policy="automatic"
echo -n "sig_sec_..." | gcloud secrets versions add SIGNING_PROVIDER_WEBHOOK_SECRET --data-file=-

# 4. Postmark Server API Token
gcloud secrets create POSTMARK_SERVER_TOKEN --replication-policy="automatic"
echo -n "pm_server_..." | gcloud secrets versions add POSTMARK_SERVER_TOKEN --data-file=-

# 5. Anti-Malware Scanner Daemon Shared Secret
gcloud secrets create SCANNER_SHARED_SECRET --replication-policy="automatic"
echo -n "clamav_shared_..." | gcloud secrets versions add SCANNER_SHARED_SECRET --data-file=-
```

### Granting Cloud Functions Access to Secrets

```bash
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Grant Secret Accessor role to the Cloud Functions execution service account
for SECRET in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET SIGNING_PROVIDER_WEBHOOK_SECRET POSTMARK_SERVER_TOKEN SCANNER_SHARED_SECRET; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 3. Idempotency & Error Handling Design

### Idempotency Controls
To protect against network retries, duplicate webhook deliveries, and double-charging:
- Every mutating handler accepts an `idempotencyKey` parameter.
- Handlers store completed results in `/idempotency_keys` with a 24-hour TTL.
- When an identical key is presented, the server returns the cached result with `_idempotentReplay: true` without executing duplicate database mutations or charges.

### Structured Error Codes
Errors follow safe, standardized gRPC/Firebase formats:
- `UNAUTHENTICATED` (401): Caller missing valid Firebase token.
- `PERMISSION_DENIED` (403): Caller lacks required role (`firm_admin`, `firm_preparer`) or cross-tenant ownership.
- `INVALID_ARGUMENT` (400): Malformed input, negative amounts, prohibited file extensions.
- `FAILED_PRECONDITION` (412): Operation invalid for current state (e.g. paying an already paid invoice, approving an unpublished return).
- `PROVIDER_ERROR` (502): External service disruption (Stripe, Postmark, ClamAV) without exposing internal keys or stack traces.

---

## 4. Deployment Instructions

### Prerequisites
1. Node.js v20+ installed.
2. Firebase CLI (`npm install -g firebase-tools`).
3. Logged in to Firebase (`firebase login`).

### Deployment Steps

```bash
# 1. Validate syntax and test suite
npm test

# 2. Deploy Cloud Functions only
firebase deploy --only functions

# 3. Deploy Firestore and Storage security rules
firebase deploy --only firestore:rules,storage:rules

# 4. Deploy Firestore composite indexes
firebase deploy --only firestore:indexes

# 5. Verify live deployment
firebase functions:log
```

---

## 5. Durable Document Delivery Queue & Dead-Letter Handling

The authoritative document delivery queue runs via the scheduled Cloud Function `processDeliveryQueue` (every 5 minutes via Cloud Scheduler) and the client intake fallback handler `intakeDocumentFallback`.

For complete architectural details, retry backoff algorithms, distributed lease specifications, and statutory retention hold behaviors, see:
👉 **[DOCUMENT_DELIVERY_QUEUE.md](./DOCUMENT_DELIVERY_QUEUE.md)**

### Key Requirements Checklist
- **Explicit States:** `uploaded`, `queued`, `processing`, `delivered`, `retry_pending`, `permanently_failed`, and `needs_review`.
- **Bounded Retries:** Exponential backoff with ±25% jitter and HTTP 429 `Retry-After` parsing.
- **Dead-Letter Office:** Bounded retry budget exhaustion transitions to `needs_review` with an immutable WORM audit log event.
- **Distributed Leases:** Transactional locking via `db.runTransaction` prevents concurrent worker processing and reclaims orphaned leases after a 60-second TTL.
- **Statutory Retention:** Under IRC § 6061 and IRS Pub 1345, documents in active delivery states are under a custody hold and cannot be purged from Cloud Storage.
- **Controlled Manual Retry:** Authorized firm staff can triage dead-lettered jobs in `firm/delivery-queue.html`, reset the attempt budget, and trigger immediate dispatch.
- **Client Storage Disclaimer:** Browser `localStorage`/`sessionStorage` is strictly a transient recovery aid and is never treated as encrypted storage or the authoritative copy of a taxpayer document. Never claim zero data loss solely because localStorage is enabled.

