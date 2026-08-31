const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * GHL webhook signature verification — mirrors GHL's official Webhook Integration Guide.
 *
 * During the transition, requests may carry EITHER header:
 *   - X-GHL-Signature  → Ed25519 (new; preferred). Verified against the Ed25519 public key.
 *   - X-WH-Signature    → RSA-SHA256 (legacy; deprecated Sept 1, 2026). Fallback.
 * We prefer GHL, fall back to legacy — so valid webhooks aren't rejected during the overlap.
 * After Sept 1 only X-GHL-Signature is sent, and legacy verification simply stops being used.
 *
 * NOTE (matches the docs exactly): the signed payload is `JSON.stringify(req.body)`, NOT the raw
 * request bytes. Uses Node's built-in crypto — no external dependency.
 *
 * Mode (env GHL_WEBHOOK_VERIFY_MODE):
 *   'enforce' (default) → reject unsigned/invalid webhooks with 401.
 *   'log'               → verify + log the result, but still process (safe rollout / debugging).
 *   'off'               → skip verification entirely.
 */

// Ed25519 public key for X-GHL-Signature — supplied via env (no hardcoded fallback).
// Newlines may arrive escaped ("\n") from some env loaders; normalize them.
const GHL_PUBLIC_KEY = (process.env.GHL_WEBHOOK_ED25519_PUBLIC_KEY || '').replace(/\\n/g, '\n');

const LEGACY_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpv
uxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF
3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKU
J062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXp
IocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzN
h/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhC
HULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJ
PQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAyk
T1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

const GHL_WEBHOOK_VERIFY_MODE = (process.env.GHL_WEBHOOK_VERIFY_MODE || 'enforce').toLowerCase();

// Ed25519 (X-GHL-Signature) — pass null as the algorithm to crypto.verify.
function verifyGhl(payload, signature) {
  if (!signature || signature === 'N/A') return { ok: false, reason: 'no signature' };
  if (!GHL_PUBLIC_KEY) return { ok: false, reason: 'GHL_WEBHOOK_ED25519_PUBLIC_KEY not set' };
  try {
    const ok = crypto.verify(null, Buffer.from(payload, 'utf8'), GHL_PUBLIC_KEY, Buffer.from(signature, 'base64'));
    return { ok, reason: ok ? null : 'verify failed' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// RSA-SHA256 (legacy X-WH-Signature).
function verifyLegacy(payload, signature) {
  if (!signature || signature === 'N/A') return { ok: false, reason: 'no signature' };
  try {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(payload);
    const ok = verifier.verify(LEGACY_PUBLIC_KEY, signature, 'base64');
    return { ok, reason: ok ? null : 'verify failed' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Verify a webhook's signature. Prefers X-GHL-Signature (Ed25519), falls back to the legacy
 * X-WH-Signature (RSA) during the transition.
 * @param {string} payload - JSON.stringify(req.body)
 * @param {object} headers - req.headers
 */
function verifyWebhookSignature(payload, headers) {
  const ghlSig = headers['x-ghl-signature'];
  const legacySig = headers['x-wh-signature'];
  if (ghlSig) return verifyGhl(payload, ghlSig);
  if (legacySig) return verifyLegacy(payload, legacySig);
  return { ok: false, reason: 'no signature' };
}

/**
 * Express middleware guarding a GHL webhook route.
 */
function ghlSignatureGuard(req, res, next) {
  if (GHL_WEBHOOK_VERIFY_MODE === 'off') return next();

  const payload = JSON.stringify(req.body);
  const { ok, reason } = verifyWebhookSignature(payload, req.headers);

  if (ok) return next();

  if (GHL_WEBHOOK_VERIFY_MODE === 'log') {
    logger.warn('⚠️ GHL webhook signature NOT verified (log mode, processing anyway)', {
      reason, type: req.body?.type, appId: req.body?.appId
    });
    return next();
  }

  logger.warn('🚫 Rejected unsigned/invalid GHL webhook', {
    reason, type: req.body?.type, appId: req.body?.appId
  });
  return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
}

module.exports = { ghlSignatureGuard, verifyWebhookSignature, GHL_WEBHOOK_VERIFY_MODE };
