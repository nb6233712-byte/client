# The File Room — Role-Based Access Control (RBAC) & 403 Intercept Manual Test Script

**Statutory Authority**: IRS Circular 230 § 10.29 & FTC Safeguards Rule § 314.4  
**Test Environment**: Local Live Server (`http://localhost:5501` for Firm Console, `http://localhost:5500` for Client Portal)

---

## Pre-Flight Checklist

1. Ensure Live Server is serving the application on port `5501` (Firm) and/or `5500` (Client).
2. Open an Incognito / Private browser window to avoid stale session cookies.
3. Open DevTools (**F12**) &rarr; Console tab to monitor `[AuthGuard]` and `[Auth]` events.

---

## Test Suite Matrix

### Test Case 1: Taxpayer Sign-In & Client Portal Access (Success)

* **Objective**: Verify that signing in with a standard Google account (`@gmail.com`) defaults to the `'client'` role and grants access to taxpayer document pages while blocking firm operational routes.

| Step | Action | Expected Output | Verification Point |
| :--- | :--- | :--- | :--- |
| **1.1** | Navigate to `http://localhost:5500/client/login.html`. | Client login screen loads with "Client Portal — Sign In" header. | Status is 200 OK. |
| **1.2** | Click **"Continue with Google"** and authenticate using a test Google account (e.g. `taxpayer.test@gmail.com`). | OAuth popup closes; session token is written to storage. | Console logs `[Auth] Google OAuth Verified. Entering Client Portal...` |
| **1.3** | Verify automatic redirect. | Browser automatically redirects to `/client/documents.html`. | URL bar reflects `http://localhost:5500/client/documents.html`. |
| **1.4** | In DevTools Console, inspect session: `JSON.parse(localStorage.getItem('tfr_user_session'))`. | Session object contains: <br>• `role: "client"`<br>• `isStaff: false`<br>• `isAuthenticated: true` | Client role is established without admin privileges. |
| **1.5** | Confirm UI components. | Tax intake categories (Form W-2, 1099, 1098) render; upload dropzones are interactive. | No firm administrative controls or client lists are visible. |

---

### Test Case 2: Client Navigates to `/dashboard.html` &rarr; 403 Forbidden Intercept (Success)

* **Objective**: Confirm that an active taxpayer session attempting to access the Firm Operations Console is immediately stopped by `js/auth-guard.js` before any sensitive tax data or client ledgers render.

| Step | Action | Expected Output | Verification Point |
| :--- | :--- | :--- | :--- |
| **2.1** | With the client session active from Test 1, type `http://localhost:5501/dashboard.html` into the URL bar and press **Enter**. | `js/auth-guard.js` intercepts page evaluation before dashboard DOM paints. | Page content is replaced with security intercept barrier. |
| **2.2** | Inspect security intercept screen. | A dedicated full-page 403 card displays: <br>• **"403 Forbidden: Authorized Practitioners Only"**<br>• Statutory citation: *IRS Circular 230 § 10.29 & FTC Safeguards Rule § 314.4*<br>• Credential indicator: *Your active credential (taxpayer.test@gmail.com) is authenticated as a Taxpayer / Client.* | Circular 230 statutory notice is prominently visible. |
| **2.3** | Check DevTools Console. | Log reads: `[AuthGuard] Access denied to firm area for role: client`. | No privileged Firestore listeners (`subscribeFirmOperations`) are invoked. |
| **2.4** | Click the button: **"Return to My Client Dashboard"**. | Browser smoothly navigates back to `http://localhost:5500/client/dashboard.html`. | Client session remains intact; no session corruption occurs. |

---

### Test Case 3: Firm Staff Sign-In & Document Review Ledger (Success)

* **Objective**: Confirm that an authorized CPA or Partner account bypasses the 403 gate and loads the firm operations ledger.

#### Option A: Dynamic Role Grant via Admin Console Utility
If testing with a personal `@gmail.com` that should have CPA permissions:
1. Open DevTools Console on `http://localhost:5501/login.html`.
2. Run:
   ```javascript
   window.grantStaffRole("cpa.user@gmail.com", "firm_admin", "Eleanor Vance, CPA", "P01984210");
   ```
3. Sign in via Google with `cpa.user@gmail.com`.

#### Option B: Managing CPA Launcher
1. On `http://localhost:5501/login.html`, click **"Demo as Managing CPA"**.

| Step | Action | Expected Output | Verification Point |
| :--- | :--- | :--- | :--- |
| **3.1** | Observe navigation after firm authentication. | Browser redirects to `http://localhost:5501/dashboard.html`. | URL reflects firm operations console. |
| **3.2** | Inspect `localStorage.getItem('tfr_user_session')` in Console. | Object contains: <br>• `role: "firm_admin"` (or `"firm_preparer"`)<br>• `isStaff: true`<br>• `mfaVerified: true` | Practitioner credentials verified. |
| **3.3** | Check Document Review Ledger. | Review queue displays client returns (e.g. *Brennan LLC*, *Michael Whitfield*) with e-file statuses, intake counts, and review badges. | Full practitioner interface renders without any 403 obstruction. |
| **3.4** | Click sidebar navigation (*Clients*, *Returns*, *Billing*, *Audit Log*). | Each page loads seamlessly with practitioner breadcrumbs and controls. | All `/firm/` subroutes allow access. |

---

## Test Results Sign-Off

- [ ] **Test Case 1 (Taxpayer Client Access)**: Passed
- [ ] **Test Case 2 (Circular 230 403 Intercept)**: Passed
- [ ] **Test Case 3 (Practitioner Ledger Access)**: Passed
