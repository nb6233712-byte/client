/**
 * ============================================================================
 * GOOGLE CLOUD SECRET MANAGER RESOLVER & ENVIRONMENT CONFIGURATION
 * ============================================================================
 * 
 * Statutory & Compliance Guidelines:
 * - FTC Safeguards Rule (16 CFR § 314.4(c)(1)): Cryptographic Key Management
 * - IRS Publication 1345 § 3: Protection of Electronic Filing Credentials
 * 
 * In production Cloud Functions, secrets are accessed via Secret Manager
 * or mounted via Cloud Functions Secret Manager environment injection.
 */

class SecretManagerService {
  constructor() {
    this._cache = new Map();
    this._cacheTtlMs = 15 * 60 * 1000; // 15 minute cache TTL
  }

  /**
   * Resolves a secret from Google Cloud Secret Manager or environment variable.
   * 
   * @param {string} secretName - Logical secret identifier (e.g. STRIPE_SECRET_KEY)
   * @param {string} [fallback] - Optional default for dev/test mock environments
   * @returns {Promise<string>} Secret value string
   */
  async getSecret(secretName, fallback = null) {
    if (!secretName) {
      throw new Error('Secret name must be specified.');
    }

    const cached = this._cache.get(secretName);
    if (cached && Date.now() - cached.timestamp < this._cacheTtlMs) {
      return cached.value;
    }

    // 1. Check direct process.env (injected by Cloud Functions secrets or local .env)
    if (process.env[secretName]) {
      const val = process.env[secretName];
      this._cache.set(secretName, { value: val, timestamp: Date.now() });
      return val;
    }

    // 2. If running in GCP Cloud Functions environment and Secret Manager client is available
    if (process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT) {
      try {
        const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
        const client = new SecretManagerServiceClient();
        const projectId = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
        const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
        
        const [version] = await client.accessSecretVersion({ name });
        const secretPayload = version.payload.data.toString('utf8');
        this._cache.set(secretName, { value: secretPayload, timestamp: Date.now() });
        return secretPayload;
      } catch (err) {
        // Fall through to fallback if secret not found or module not installed
      }
    }

    if (fallback !== null) {
      return fallback;
    }

    throw new Error(`Secret '${secretName}' not found in Secret Manager or environment.`);
  }

  /**
   * Clear cache (useful in tests)
   */
  clearCache() {
    this._cache.clear();
  }
}

export const secretManager = new SecretManagerService();

export const AppConfig = Object.freeze({
  isProduction: process.env.NODE_ENV === 'production',
  maxUploadSizeBytes: 25 * 1024 * 1024, // 25 MB strict
  kbaMaxAttempts: 3, // IRS Pub 1345 lockout limit
  sessionExpiryMinutes: 15
});
