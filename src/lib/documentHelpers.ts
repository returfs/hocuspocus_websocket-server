/**
 * Document Authentication
 */

import type { onAuthenticatePayload } from '@hocuspocus/server';
import { verifyCollabToken } from './collabToken.js';

/**
 * The auth context attached to a connection and passed to fetch/store.
 *  - 'collab':     production end-user — a per-user collaboration token signed
 *                  by Laravel. fetch/store call the /collab API as that user.
 *  - 'developer':  a developer testing their own extension with their own rfsk_
 *                  key (standalone/dev). fetch/store call the /developer API.
 */
export type AuthContext =
  | { mode: 'collab'; userId: string; perms: 'read' | 'write'; token: string }
  | { mode: 'developer'; apiKey: string };

/**
 * Authenticate an incoming WebSocket connection.
 *
 * Registering this hook puts Hocuspocus in "token required" mode — every client
 * MUST present a token, and it is validated here before any document access.
 *
 * - rfsk_… → developer key (dev/standalone). Ownership is enforced server-side
 *   by the developer API, so we accept the key and carry it in the context.
 * - otherwise → a collaboration token: verified locally (HMAC), bound to THIS
 *   document (rid === documentName), and read-only perms downgrade the
 *   connection to read-only. Invalid/expired/mismatched tokens are rejected.
 */
export const onAuthenticate = async (
  data: onAuthenticatePayload,
): Promise<AuthContext> => {
  const { token, documentName } = data;

  if (token && token.startsWith('rfsk_')) {
    return { mode: 'developer', apiKey: token };
  }

  const payload = verifyCollabToken(token);

  if (!payload) {
    throw new Error('Invalid or expired collaboration token');
  }

  // Bind the token to this document — a token for another resource is rejected.
  if (payload.rid !== documentName) {
    throw new Error('Token does not authorize this document');
  }

  // Read-only tokens may observe + receive updates but not persist changes.
  if (payload.perms !== 'write') {
    data.connection.readOnly = true;
  }

  return {
    mode: 'collab',
    userId: payload.uid,
    perms: payload.perms,
    token,
  };
};
