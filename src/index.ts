/**
 * Hocuspocus WebSocket Server
 *
 * Real-time collaboration server for Returfs extensions.
 * Uses Yjs for conflict-free document synchronization.
 */

import { Database } from '@hocuspocus/extension-database';
import { Logger } from '@hocuspocus/extension-logger';
import { Server } from '@hocuspocus/server';
import { config } from './config/environment';
import { onAuthenticate } from './lib/documentHelpers';
import { fetchDocument, storeDocument } from './lib/extensions/databaseHelpers';

const server = Server.configure({
  name: config.name || 'hocuspocus',
  port: Number(config.port) || 1234,
  extensions: [
    new Logger(),
    new Database({
      fetch: fetchDocument,
      store: storeDocument,
    }),
  ],
  onAuthenticate,
});

console.log(`[Hocuspocus] Server running at ${config.host || 'localhost'}:${config.port || 1234}`);

server.listen();
