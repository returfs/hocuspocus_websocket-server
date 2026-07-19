/**
 * Collaboration-token verification (mirror of the Laravel CollabTokenService).
 *
 * Token format:  base64url(payloadJson) "." base64url(HMAC_SHA256(part1, secret))
 * The HMAC is computed over the base64url payload STRING (the part before the
 * dot) using the shared secret (config.collabSecret == Laravel HOCUSPOCUS_SECRET).
 */

import crypto from 'crypto';
import { config } from '../config/environment.js';

export interface CollabPayload {
  uid: string;
  rid: string;
  perms: 'read' | 'write';
  iat: number;
  exp: number;
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Verify a collab token's signature + expiry. Returns the payload, or null if
 * the token is malformed, tampered, expired, or the secret isn't configured.
 */
export function verifyCollabToken(
  token: string | undefined | null,
): CollabPayload | null {
  const secret = config.collabSecret;

  if (!secret || !token) {
    return null;
  }

  const parts = token.split('.');

  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, signature] = parts;
  const expected = base64UrlEncode(
    crypto.createHmac('sha256', secret).update(encodedPayload).digest(),
  );

  // Constant-time compare (lengths must match first to avoid throwing).
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      base64UrlDecode(encodedPayload).toString('utf-8'),
    ) as Partial<CollabPayload>;

    if (
      !payload ||
      typeof payload.uid !== 'string' ||
      typeof payload.rid !== 'string' ||
      (payload.perms !== 'read' && payload.perms !== 'write') ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }

    if (Date.now() / 1000 >= payload.exp) {
      return null;
    }

    return payload as CollabPayload;
  } catch {
    return null;
  }
}
