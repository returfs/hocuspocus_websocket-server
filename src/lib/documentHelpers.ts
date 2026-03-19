/**
 * Document Authentication Helpers
 */

import type { onAuthenticatePayload } from '@hocuspocus/server';

/**
 * Authenticate incoming WebSocket connections
 *
 * This function is called when a client connects to the WebSocket server.
 * For now, it allows all connections (authentication happens via API key
 * passed in query params). In production, you may want to validate tokens here.
 */
export const onAuthenticate = async (_data: onAuthenticatePayload) => {
  // Authentication is handled via API key in request parameters
  // The fetch/store functions use this to authenticate with the Returfs API
  return {};
};
