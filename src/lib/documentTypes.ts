/**
 * Server-side document-type registry (Phase D5)
 *
 * The editor packages send a `documentType` id (e.g. 'text', 'form'). This
 * registry maps that id to the server-side behaviour that differs per type:
 * how a Yjs document is flattened to its portable plain export, and how a plain
 * export is hydrated back into a Yjs document for seeding.
 *
 * It mirrors the editor-side `DocumentType` descriptor. A new type (e.g. the
 * form builder) registers one entry here — no other change to the sync server.
 */

import { TiptapTransformer } from '@hocuspocus/transformer';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { generateJSON } from '@tiptap/html';
import * as Y from 'yjs';

export interface ServerDocumentType {
  /** Matches the editor-side DocumentType.id. */
  id: string;
  /** Rich sidecar extension (no dot), forwarded to Laravel. */
  richExtension: string;
  /** Flatten a Yjs document into its portable plain export. */
  flatten: (doc: Y.Doc) => string;
  /** Seed a fresh Yjs document from the plain export. */
  hydrate: (plain: string) => Y.Doc;
  /** A minimal empty document (genuinely empty file / new doc). */
  empty: () => Y.Doc;
}

// ---------------------------------------------------------------------------
// text — the schema-light flatten/hydrate the editor has always used. Only the
// Document/Paragraph/Text nodes are needed to read Yjs fragments as plain text,
// so no full (Tiptap Pro) schema is required on the server.
// ---------------------------------------------------------------------------

const TEXT_SCHEMA = [Document, Paragraph, Text];

function extractTextFromTiptap(json: Record<string, unknown>): string {
  if (!json || typeof json !== 'object') return '';

  const lines: string[] = [];

  function processNode(node: Record<string, unknown>): string {
    if (node.type === 'text') {
      return (node.text as string) || '';
    }
    if (node.content && Array.isArray(node.content)) {
      return node.content.map(processNode).join('');
    }
    return '';
  }

  const content =
    (json.default as Record<string, unknown>)?.content ||
    (json.content as unknown[]) ||
    [];

  for (const node of content as Record<string, unknown>[]) {
    lines.push(processNode(node));
  }

  return lines.join('\n');
}

const textDocumentType: ServerDocumentType = {
  id: 'text',
  richExtension: 'rtxt',
  flatten: doc => {
    const json = TiptapTransformer.fromYdoc(doc) as Record<string, unknown>;
    return extractTextFromTiptap(json);
  },
  hydrate: plain => {
    const json = generateJSON(plain, TEXT_SCHEMA);
    return TiptapTransformer.toYdoc(json, 'default', TEXT_SCHEMA);
  },
  empty: () =>
    TiptapTransformer.toYdoc(
      { type: 'doc', content: [{ type: 'paragraph' }] },
      'default',
      TEXT_SCHEMA,
    ),
};

// ---------------------------------------------------------------------------

const registry: Record<string, ServerDocumentType> = {
  [textDocumentType.id]: textDocumentType,
};

/** Resolve a document type by id, falling back to 'text'. */
export function getDocumentType(id?: string | null): ServerDocumentType {
  return (id && registry[id]) || textDocumentType;
}
