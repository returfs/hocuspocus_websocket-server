import * as Y from 'yjs';
import fs from 'node:fs';
import { getDocumentType } from '/Users/badasukerubin/code/laravel/returfs/marketplace/internal/services/hocuspocus/src/lib/documentTypes.js';

const bytes = new Uint8Array(fs.readFileSync(process.argv[2]));
const doc = new Y.Doc();
Y.applyUpdate(doc, bytes);
const plain = getDocumentType('markdown').flatten(doc);
console.log('flattened length:', plain.length, 'newlines:', (plain.match(/\n/g) ?? []).length);
console.log('--- first 240 chars ---');
console.log(JSON.stringify(plain.slice(0, 240)));
