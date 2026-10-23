# The File Room — Client Portal Execution & Test Guide

This document explains how to run the Client Portal application and tests locally.

---

## 1. Running Locally (VS Code Live Server / Local HTTP Server)

When serving the repository on port **5501**:

* **Main Landing & Gateway:** [`http://localhost:5501/web%20app/index.html`](http://localhost:5501/web%20app/index.html)
* **Client Login & Sign Up:** [`http://localhost:5501/web%20app/client/login.html`](http://localhost:5501/web%20app/client/login.html)
* **Client Engagement Dashboard:** [`http://localhost:5501/web%20app/client/dashboard.html`](http://localhost:5501/web%20app/client/dashboard.html)

### Running via Python or Node:
```powershell
# From the workspace root:
python -m http.server 5501 --bind 127.0.0.1
```
Open [`http://localhost:5501/web%20app/index.html`](http://localhost:5501/web%20app/index.html) in your browser.

---

## 2. Running with Firebase Emulator Suite (Optional)

To test rules and database queries against the local Firestore emulator:

```powershell
cd "web app"
firebase emulators:start --only firestore
```
* **Firestore Emulator:** `127.0.0.1:8080`
* **Emulator UI Dashboard:** [`http://localhost:4000`](http://localhost:4000)

---

## 3. Running Automated Tests

Run the client architecture and navigation test suite:

```powershell
node --test "tests/shared-layout-navigation.test.mjs"
node --test "tests/client-portal-dashboard.test.mjs"
```

---

## 4. Primary URLs

| Page | URL | Purpose |
|---|---|---|
| **Gateway Landing** | `http://localhost:5501/web%20app/index.html` | Taxpayer overview & direct launch point |
| **Taxpayer Portal Home** | `http://localhost:5501/web%20app/client/index.html` | Client portal homepage |
| **Sign In / Registration** | `http://localhost:5501/web%20app/client/login.html` | Taxpayer authentication & MFA |
| **Active File Dashboard** | `http://localhost:5501/web%20app/client/dashboard.html` | 16-stage return tracking |
| **Document Vault** | `http://localhost:5501/web%20app/client/documents.html` | W-2, 1099, & tax document uploads |
| **Form 8879 Signing** | `http://localhost:5501/web%20app/client/signatures.html` | DocuSign & IRS KBA e-signature |
| **Tax Return Review** | `http://localhost:5501/web%20app/client/tax-return.html` | Read-only return inspection |
| **Client Messages** | `http://localhost:5501/web%20app/client/messages.html` | Secure preparer messaging |
| **Billing & Invoices** | `http://localhost:5501/web%20app/client/billing.html` | Itemized invoice & payment settlement |
