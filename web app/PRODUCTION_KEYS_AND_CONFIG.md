# The File Room — Production Keys, Secrets & Configuration Manual
**Pivot Aide Tax — Authoritative Infrastructure & Provider Specification**  
*Document Version: 1.0 (Production Release Guide)*  
*Statutory Compliance: FTC Safeguards Rule (16 CFR Part 314) · IRS Pub 1345 § 5.2.2 · IRC § 7216 · PCI-DSS SAQ-A*

---

## 1. Quick Reference: Master Secrets Inventory

All sensitive credentials **must be stored in Google Cloud Secret Manager** and injected into Firebase Cloud Functions at runtime. **Never hardcode secrets in JavaScript, HTML, or Git repositories.**

| # | Secret / Key Name | Target Service | Purpose & Location | Format / Sample Value |
|---|---|---|---|---|
| **1** | `KBA_API_KEY` | **Persona** Identity API | Server-to-server dynamic KBA identity proofing (IRS Pub 1345) | `persona_live_xxxxxxxxxxxxxxxxxxxxxxxx` |
| **2** | `KBA_WEBHOOK_SECRET` | **Persona** Webhook Receiver | Cryptographic HMAC-SHA256 signature verification for identity events | `whsec_xxxxxxxxxxxxxxxxxxxxxxxx` |
| **3** | `KBA_TEMPLATE_ID` | **Persona** Inquiries | Pre-configured IRS Pub 1345 KBA Inquiry flow template | `itmpl_xxxxxxxxxxxxxxxx` |
| **4** | `STRIPE_SECRET_KEY` | **Stripe** Payments | Server-side invoice checkout session creation (PCI-DSS SAQ-A) | `sk_live_51xxxxxxxxxxxxxxxxxxxx` |
| **5** | `STRIPE_WEBHOOK_SECRET` | **Stripe** Webhooks | Cryptographic signature verification for payment completion events | `whsec_xxxxxxxxxxxxxxxxxxxxxxxx` |
| **6** | `POSTMARK_SERVER_TOKEN` | **Postmark** Transactional | Sending sanitized email receipts & MFA notifications | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| **7** | `DOCUSIGN_WEBHOOK_SECRET` | **DocuSign** Connect | Cryptographic HMAC validation for electronic signature callbacks | Base64-encoded 256-bit secret string |
| **8** | `SCANNER_SHARED_SECRET` | **Malware Scanner** | Shared secret between ClamAV daemon trigger and Cloud Function | 32-character random hex token |

---

## 2. Google Cloud & Firebase Project Configuration

### A. Firebase Web App Client Configuration
This configuration is embedded in `js/firebase.js` and `client/js/firebase.js`. It contains public identifiers used by the browser to connect to Firebase services:

```javascript
export const firebaseConfig = {
  apiKey: "AIzaSy...",                     // Firebase Web API Key (Restricted in Google Cloud Console)
  authDomain: "uk-client-d90d5.firebaseapp.com",
  projectId: "uk-client-d90d5",
  storageBucket: "uk-client-d90d5.appspot.com",
  messagingSenderId: "367375635817",
  appId: "1:367375635817:web:2c77d07c08ce8a7bcff686"
};
```

> **Security Note:** In Google Cloud Console (`APIs & Services > Credentials`), apply an **API Key Restriction** to `apiKey` restricting HTTP referrers strictly to:
> - `https://thefileroom.com/*`
> - `https://pivot-aide-tax.com/*`
> - `https://uk-client-d90d5.web.app/*`
> - `https://uk-client-d90d5.firebaseapp.com/*`

---

## 3. Third-Party Provider Credentials & Setup

### A. Persona (IRS Pub 1345 § 5.2.2 Identity Verification)
* **Website:** [https://withpersona.com](https://withpersona.com)
* **Required Plan:** Enterprise (with LexisNexis / Credit Bureau dynamic KBA add-on)
* **Prerequisites:** Executed Business Associate Agreement (BAA) and IRC § 7216 compliance agreement.
* **Credentials to Obtain from Persona Dashboard:**
  1. **API Key**: Found under *Settings > API Keys*. Create an active key with `Inquiries: Create, Read` permissions.
  2. **Webhook Signing Secret**: Under *Settings > Webhooks*, click *Add Webhook*:
     - **URL:** `https://thefileroom.com/api/webhooks/persona` (or `https://us-central1-uk-client-d90d5.cloudfunctions.net/handleKbaWebhook`)
     - **Events:** `inquiry.completed`, `inquiry.failed`, `inquiry.expired`
     - Copy the generated Webhook Secret (`whsec_...`).
  3. **Template ID**: Under *Inquiry Templates*, configure:
     - 3 to 5 dynamic questions from 30-year credit bureau databases.
     - 120-second session expiration timeout.
     - 80% passing threshold.
     - Copy the Template ID (`itmpl_...`).

---

### B. Forminit (Primary Document Intake Gateway)
* **Website:** [https://forminit.com](https://forminit.com)
* **Current Configured Endpoint:**  
  `https://forminit.com/f/rv02anqc45x`
* **Form ID:** `rv02anqc45x`
* **Details:**
  - Used as the Tier-1 transmission destination for vaulted taxpayer PDF documents.
  - Guarded in code by a bounded **6000ms timeout** (`AbortController`).
  - If Forminit is unreachable, times out, or returns HTTP 429/5xx, submissions automatically route to the secondary fallback:
    `https://us-central1-uk-client-d90d5.cloudfunctions.net/intakeDocumentFallback`

---

### C. Stripe (Client Invoicing & Payment Processing)
* **Website:** [https://stripe.com](https://stripe.com)
* **Compliance:** PCI-DSS Level 4 / SAQ-A (Hosted Checkout Redirect)
* **Credentials to Obtain from Stripe Dashboard:**
  1. **Secret Key**: `sk_live_...` (under *Developers > API Keys*). Stored in Secret Manager.
  2. **Webhook Signing Secret**: Under *Developers > Webhooks*, add an endpoint:
     - **URL:** `https://thefileroom.com/api/webhooks/stripe`
     - **Events to Listen:** `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`
     - Copy the Signing Secret (`whsec_...`).

---

### D. Postmark (Statutory Notifications & Email Receipts)
* **Website:** [https://postmarkapp.com](https://postmarkapp.com)
* **Compliance:** IRC § 7216 compliant email dispatch (all PII, SSNs, and tax numbers redacted).
* **Credentials to Obtain:**
  1. **Server API Token**: Under *Servers > [Server Name] > API Tokens*.
  2. **Sender Signature / DKIM**: Verify `notifications@pivot-aide.tax` or `support@thefileroom.com` with DNS SPF & DKIM records.

---

## 4. Firm Statutory Identifiers (IRS Authorized E-File Provider)

These legal credentials must be configured in Firestore `/firm_profile/statutory_credentials` or entered by practice administrators:

| Identifier | Description | Authority / Statute | Format |
|---|---|---|---|
| **EFIN** | Electronic Filing Identification Number | IRS e-file Provider Office | 6-digit numeric (e.g. `123456`) |
| **ETIN** | Electronic Transmitter Identification Number | IRS MeF Transmission Gateway | 5-digit numeric (e.g. `12345`) |
| **Firm EIN** | Employer Identification Number | IRS Federal Tax ID | 9-digit `XX-XXXXXXX` |
| **PTIN** | Preparer Tax Identification Number | Per CPA / Tax Preparer | `P` followed by 8 digits (e.g. `P01234567`) |
| **Circular 230 License** | State Board of Accountancy / Bar ID | State Licensing Board | CPA License State & Number |

---

## 5. Google Cloud Secret Manager Provisioning Commands

Run these exact terminal commands using the Google Cloud CLI (`gcloud`) or Firebase CLI to seed your production credentials into the Google Cloud project:

```bash
# 1. Login to your Firebase / Google Cloud project
firebase login
gcloud config set project uk-client-d90d5

# 2. Seed Persona KBA Identity Proofing Credentials
firebase functions:secrets:set KBA_API_KEY
# (When prompted, paste your Persona production API key: persona_live_...)

firebase functions:secrets:set KBA_WEBHOOK_SECRET
# (When prompted, paste your Persona webhook secret: whsec_...)

# 3. Seed Stripe Payment Credentials
firebase functions:secrets:set STRIPE_SECRET_KEY
# (When prompted, paste your Stripe production secret key: sk_live_...)

firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
# (When prompted, paste your Stripe webhook signing secret: whsec_...)

# 4. Seed Postmark Email Notification Token
firebase functions:secrets:set POSTMARK_SERVER_TOKEN
# (When prompted, paste your Postmark server token)

# 5. Seed Anti-Malware / Scanner Shared Secret
firebase functions:secrets:set SCANNER_SHARED_SECRET
# (When prompted, paste a secure 32-character hex secret)
```

### Granting Access to the Cloud Functions Execution Service Account:
```bash
PROJECT_ID="uk-client-d90d5"
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Grant Secret Accessor role to the execution identity
for SECRET in KBA_API_KEY KBA_WEBHOOK_SECRET STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET POSTMARK_SERVER_TOKEN SCANNER_SHARED_SECRET; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 6. Production Domain & OAuth Configuration

### A. Google Cloud Console — OAuth 2.0 Client ID (Google Sign-In)
Navigate to **Google Cloud Console > APIs & Services > Credentials > OAuth 2.0 Client IDs**:
* **Authorized JavaScript Origins:**
  - `https://thefileroom.com`
  - `https://pivot-aide-tax.com`
  - `https://uk-client-d90d5.web.app`
  - `https://uk-client-d90d5.firebaseapp.com`
* **Authorized Redirect URIs:**
  - `https://uk-client-d90d5.firebaseapp.com/__/auth/handler`
  - `https://thefileroom.com/__/auth/handler`

### B. Firebase Authentication — Authorized Domains
In Firebase Console under **Authentication > Settings > Authorized Domains**, ensure these domains are listed:
1. `uk-client-d90d5.firebaseapp.com`
2. `uk-client-d90d5.web.app`
3. `thefileroom.com`
4. `pivot-aide-tax.com`
