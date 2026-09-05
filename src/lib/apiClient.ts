/**
 * HTTP client for the Returfs API.
 *
 * Local Herd/Valet serves the API over https with a self-signed cert, which the
 * default Node trust store rejects (UNABLE_TO_VERIFY_LEAF_SIGNATURE). That fails
 * every document load/store and surfaces to the editor as "cannot connect to the
 * collaboration server", so we trust the dev CA explicitly here.
 *
 * NODE_EXTRA_CA_CERTS is read by Node before dotenv runs and so cannot come from
 * .env — the CA is resolved in config and handed to an https agent instead.
 */

import axios from 'axios';
import { Agent } from 'https';
import { readFileSync } from 'fs';
import { config } from '../config/environment.js';

function buildHttpsAgent(): Agent | undefined {
  if (config.caCertPath) {
    try {
      return new Agent({ ca: readFileSync(config.caCertPath) });
    } catch (error) {
      console.warn(
        `[Hocuspocus] Could not read CA cert at ${config.caCertPath}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (config.env === 'development') {
    console.warn(
      '[Hocuspocus] No dev CA found — skipping TLS verification for the Returfs API.',
    );
    console.warn(
      '[Hocuspocus] Set RETURFS_CA_CERT to the CA pem to verify properly.',
    );
    return new Agent({ rejectUnauthorized: false });
  }

  return undefined;
}

// The agent only applies to https requests, so it is safe to always attach it:
// an http API URL that redirects to https still gets a trusted handshake.
export const api = axios.create({ httpsAgent: buildHttpsAgent() });
