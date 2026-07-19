/**
 * Hocuspocus WebSocket Server
 *
 * Real-time collaboration server for Returfs extensions.
 * Uses Yjs for conflict-free document synchronization.
 */

import { Database } from '@hocuspocus/extension-database';
import { Logger } from '@hocuspocus/extension-logger';
import { Server } from '@hocuspocus/server';
import { config } from './config/environment.js';
import { onAuthenticate } from './lib/documentHelpers.js';
import {
  fetchDocument,
  storeDocument,
} from './lib/extensions/databaseHelpers.js';

const server = Server.configure({
  name: config.name || 'hocuspocus',
  port: Number(config.port) || 1234,
  // Keep a document in memory after the last client disconnects instead of
  // unloading it immediately (the default). A tab switch unmounts the editor
  // and drops the connection; without this, returning to the tab cold-fetches
  // from the API and can race the store-on-disconnect — losing the last edits
  // and re-seeding a stale doc. Staying warm means the reconnect rejoins the
  // authoritative in-memory doc with the latest edits.
  unloadImmediately: false,
  extensions: [
    new Logger(),
    new Database({
      fetch: fetchDocument,
      store: storeDocument,
    }),
  ],
  // Per-user auth: validates the collaboration token (or a dev rfsk_ key),
  // binds the connection to this document, and sets read-only for read tokens.
  // The returned context flows to fetch/store so they act as the real user.
  onAuthenticate,
});

console.log(
  `[Hocuspocus] Server running at ${config.host || 'localhost'}:${config.port || 1234}`,
);

server.listen();

// Graceful shutdown: on deploy/restart the process manager sends SIGTERM. Docs
// are held in memory (unloadImmediately:false) with debounced stores, so an
// abrupt kill would drop the latest un-stored edits. server.destroy() closes
// connections and unloads every document, which flushes the Database store —
// so the last edits are persisted before exit. A hard timeout guards against a
// hung store so the orchestrator's SIGKILL grace window isn't exceeded.
let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Hocuspocus] ${signal} received — flushing documents…`);

  const force = setTimeout(() => {
    console.error('[Hocuspocus] Shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);

  try {
    await server.destroy();
    clearTimeout(force);
    console.log('[Hocuspocus] Shutdown complete');
    process.exit(0);
  } catch (error) {
    clearTimeout(force);
    console.error('[Hocuspocus] Shutdown error:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
