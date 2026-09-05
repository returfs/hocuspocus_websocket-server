/**
 * Server-side document-type registry (Phase D5)
 *
 * The editor packages send a `documentType` id (e.g. 'text', 'code', 'form').
 * This registry maps that id to the server-side behaviour that differs per type:
 * how a Yjs document is flattened to its portable plain export, and how a plain
 * export is hydrated back into a Yjs document for seeding.
 *
 * It mirrors the editor-side `DocumentType` descriptor. A new type (e.g. the
 * form builder) registers one entry here; no other change to the sync server.
 */

import { docToMarkdown, markdownToDoc } from '@returfs/markdown-doc';
import { ydocFromJson, type JsonNode } from './yjsFromJson.js';
import { TiptapTransformer } from '@hocuspocus/transformer';
import * as Y from 'yjs';

export interface ServerDocumentType {
  /** Matches the editor-side DocumentType.id. */
  id: string;
  /** Rich sidecar extension (no dot), forwarded to Laravel. */
  richExtension: string;
  /**
   * Transport-only types never touch the API: the server relays Yjs updates
   * between peers and nothing else. Clients own all persistence (the file
   * bytes and the rich sidecar ride the session API from the editor), so
   * fetch seeds an empty room and store is a no-op. Used for binary formats
   * (docx) whose exports cannot ride the UTF-8 flatten/hydrate path.
   */
  transportOnly?: boolean;
  /** Flatten a Yjs document into its portable plain export. */
  flatten: (doc: Y.Doc) => string;
  /** Seed a fresh Yjs document from the plain export. */
  hydrate: (plain: string) => Y.Doc;
  /** A minimal empty document (genuinely empty file / new doc). */
  empty: () => Y.Doc;
}

// ---------------------------------------------------------------------------
// text: a rich-text room whose portable export is the plain characters. The
// formatting a user applies to a `.txt` lives in the rich sidecar; the file
// itself stays the lines they typed.
// ---------------------------------------------------------------------------

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

/**
 * Plain text → one paragraph per line, the exact inverse of the flatten above.
 *
 * This used to be `generateJSON(plain, [Document, Paragraph, Text])`, which
 * parses its input as HTML. Every run of whitespace collapsed into a single
 * space, so seeding a room from a file threw away its newlines, blank lines and
 * indentation — and the next debounced save wrote that one line back over the
 * file. Splitting on newlines is the only structure a plain text file has.
 */
function docFromText(plain: string): JsonNode {
  const lines = plain.length === 0 ? [''] : plain.split('\n');

  return {
    type: 'doc',
    content: lines.map(line => ({
      type: 'paragraph',
      ...(line === '' ? {} : { content: [{ type: 'text', text: line }] }),
    })),
  };
}

const textDocumentType: ServerDocumentType = {
  id: 'text',
  richExtension: 'rtxt',
  flatten: doc => {
    const json = TiptapTransformer.fromYdoc(doc) as Record<string, unknown>;
    return extractTextFromTiptap(json);
  },
  hydrate: plain => ydocFromJson(docFromText(plain)),
  empty: () => ydocFromJson({ type: 'doc', content: [{ type: 'paragraph' }] }),
};

// ---------------------------------------------------------------------------
// markdown: the same Yjs room as text, but the plain export IS markdown rather
// than the stripped text `text` produces. Flattening a `.md` file the text way
// would drop every heading, list and link from the file on the first save and
// leave them only in the hidden rich sidecar — the file would stop being the
// document. The conversion is shared with the editor (@returfs/markdown-doc) so
// what the browser renders and what this server writes cannot drift apart.
//
// The rich sidecar stays `.rtxt`: it holds Yjs state, which is the same shape
// whatever the plain export looks like.
// ---------------------------------------------------------------------------

const markdownDocumentType: ServerDocumentType = {
  id: 'markdown',
  richExtension: 'rtxt',
  flatten: doc => docToMarkdown(TiptapTransformer.fromYdoc(doc)),
  // Seeded schema-free (see ydocFromJson): a markdown file becomes headings,
  // lists and tables, none of which a server-side schema could name.
  hydrate: plain => ydocFromJson(markdownToDoc(plain)),
  empty: () => ydocFromJson({ type: 'doc', content: [{ type: 'paragraph' }] }),
};

// ---------------------------------------------------------------------------
// code: source files, logs, JSON, config — anything whose bytes ARE the
// document. The room is a single Y.Text holding the file verbatim, so there is
// no schema, no conversion and nothing to escape: what is typed is what is
// written, tabs, trailing spaces and all. That byte fidelity is the whole point
// — a `.php` file that came back subtly reformatted would be a broken file.
//
// The field name is the one y-codemirror.next binds to on the client.
// ---------------------------------------------------------------------------

export const CODE_FIELD = 'codemirror';

const codeDocumentType: ServerDocumentType = {
  id: 'code',
  richExtension: 'rtxt',
  flatten: doc => doc.getText(CODE_FIELD).toString(),
  hydrate: plain => {
    const doc = new Y.Doc();
    if (plain) doc.getText(CODE_FIELD).insert(0, plain);
    return doc;
  },
  empty: () => new Y.Doc(),
};

// ---------------------------------------------------------------------------
// word: transport-only. A docx is binary, so it cannot ride the UTF-8
// Database store; the first peer seeds the room from the file client-side
// (SuperDoc's isNewFile path) and the typing peer persists by exporting docx
// back through the host bridge. The empty doc here is only ever the blank
// room a fresh connection syncs against.
// ---------------------------------------------------------------------------

const wordDocumentType: ServerDocumentType = {
  id: 'word',
  richExtension: 'rdocx',
  transportOnly: true,
  flatten: () => '',
  hydrate: () => new Y.Doc(),
  empty: () => new Y.Doc(),
};

// ---------------------------------------------------------------------------
// sheet: transport-only, the word entry verbatim. The room mirrors Univer's
// workbook model (cells, merges, dimensions, sheet order) as Yjs maps; the
// typing peer exports xlsx back through the session API and persists the
// Yjs state in the document's `.rxlsx` sidecar. Nothing binary rides Node.
// ---------------------------------------------------------------------------

const sheetDocumentType: ServerDocumentType = {
  id: 'sheet',
  richExtension: 'rxlsx',
  transportOnly: true,
  flatten: () => '',
  hydrate: () => new Y.Doc(),
  empty: () => new Y.Doc(),
};

// ---------------------------------------------------------------------------
// slides: transport-only, the sheet entry verbatim. The room mirrors the
// slides engine's model per slide (`pptx:slides`, one Y.Map per slide with
// per-element maps and Y.Text bodies); the editing peer splices the changed
// slides into the pptx through the session API and persists the Yjs state
// in the document's `.rpptx` sidecar. Nothing binary rides Node.
// ---------------------------------------------------------------------------

const slidesDocumentType: ServerDocumentType = {
  id: 'slides',
  richExtension: 'rpptx',
  transportOnly: true,
  flatten: () => '',
  hydrate: () => new Y.Doc(),
  empty: () => new Y.Doc(),
};

// ---------------------------------------------------------------------------

const registry: Record<string, ServerDocumentType> = {
  [textDocumentType.id]: textDocumentType,
  [markdownDocumentType.id]: markdownDocumentType,
  [codeDocumentType.id]: codeDocumentType,
  [wordDocumentType.id]: wordDocumentType,
  [sheetDocumentType.id]: sheetDocumentType,
  [slidesDocumentType.id]: slidesDocumentType,
};

/** Resolve a document type by id, falling back to 'text'. */
export function getDocumentType(id?: string | null): ServerDocumentType {
  return (id && registry[id]) || textDocumentType;
}
