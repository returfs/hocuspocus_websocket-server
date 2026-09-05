import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the CA that signed the local https certs (Herd/Valet self-signed), so
 * API calls to a secured local domain can be verified. Null when none is found.
 */
function findCaCert(): string | null {
  const homeDir = process.env.HOME || `/Users/${process.env.USER || 'user'}`;

  const candidates = [
    process.env.RETURFS_CA_CERT,
    process.env.NODE_EXTRA_CA_CERTS,
    `${homeDir}/Library/Application Support/Herd/config/valet/CA/LaravelValetCASelfSigned.pem`,
    `${homeDir}/.config/valet/CA/LaravelValetCASelfSigned.pem`,
    // Wildcard dev cert bundle kept alongside the frontend
    resolve(__dirname, '../../../../../../frontend/.certs/ca.pem'),
  ].filter((path): path is string => Boolean(path));

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }

  return null;
}

export const config = {
  name: process.env.APP_NAME || 'hocuspocus',
  env: process.env.APP_ENV || 'development',
  // PORT is what the Extension Manager injects from the port configured in the
  // admin, so honouring it makes that field actually drive the service. An
  // explicit APP_PORT in .env still wins, for running this outside the manager.
  port: process.env.APP_PORT || process.env.PORT || '1234',
  host: process.env.APP_HOST || 'localhost',
  debug: process.env.APP_DEBUG === 'true',
  apiUrl: process.env.RETURFS_API_URL || 'https://project.test',
  apiKey: process.env.RETURFS_API_KEY,
  // Shared HMAC secret for verifying per-user collaboration tokens. MUST match
  // the Laravel app's HOCUSPOCUS_SECRET (config services.hocuspocus.secret).
  collabSecret: process.env.HOCUSPOCUS_SECRET,
  // PEM trusted when calling the API over https (dev CA), if one was found.
  caCertPath: findCaCert(),
};
