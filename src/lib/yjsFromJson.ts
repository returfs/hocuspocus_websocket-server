/**
 * Tiptap document JSON → a seeded Yjs document, without a ProseMirror schema.
 *
 * `TiptapTransformer.toYdoc` builds a real ProseMirror document first, which
 * means every node it meets must exist in a schema handed to it. That is fine
 * for plain text (paragraphs only) but impossible for markdown: the editor's
 * schema is assembled from the Tiptap Pro extensions, which this Node service
 * neither has nor is licensed for, and any server-side copy of it would drift
 * from the editor the first time someone adds a node type.
 *
 * So we write the Yjs structure directly. This mirrors y-prosemirror's own
 * `createTypeFromElementNode` / `createTypeFromTextNodes` exactly — element per
 * node keyed by type name, attributes minus nulls, and runs of adjacent text
 * collapsed into one `Y.XmlText` whose delta carries marks as attributes — so
 * what the editor binds to is byte-for-byte what it would have built itself.
 *
 * The consequence to keep in mind: an attribute only survives a later edit if
 * the EDITOR's schema declares it too, because from then on the browser is what
 * writes the document. `codeBlock`'s `frontmatter` flag is declared there for
 * exactly this reason.
 */

import * as Y from 'yjs';

interface JsonMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface JsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  marks?: JsonMark[];
  text?: string;
}

/** Seed a fresh Yjs document from Tiptap JSON, under the given fragment. */
export function ydocFromJson(json: JsonNode, field = 'default'): Y.Doc {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(field);

  fragment.insert(0, childTypes(json.content ?? []));

  return doc;
}

/**
 * Children of one node. Adjacent text nodes MUST become a single `Y.XmlText`:
 * y-prosemirror groups them that way, and splitting them produces a document
 * that syncs but compares unequal, which shows up as phantom remote edits.
 */
function childTypes(nodes: JsonNode[]): (Y.XmlElement | Y.XmlText)[] {
  const types: (Y.XmlElement | Y.XmlText)[] = [];
  let run: JsonNode[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    types.push(textType(run));
    run = [];
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      run.push(node);
      continue;
    }

    flushRun();
    types.push(elementType(node));
  }

  flushRun();

  return types;
}

function elementType(node: JsonNode): Y.XmlElement {
  const element = new Y.XmlElement(node.type);

  for (const [key, value] of Object.entries(node.attrs ?? {})) {
    // Null means "unset" in ProseMirror, and y-prosemirror skips those rather
    // than storing a literal null the editor would then read back as a value.
    if (value === null || value === undefined) continue;
    element.setAttribute(key, value as never);
  }

  element.insert(0, childTypes(node.content ?? []));

  return element;
}

function textType(nodes: JsonNode[]): Y.XmlText {
  const text = new Y.XmlText();

  text.applyDelta(
    nodes.map(node => ({
      insert: node.text ?? '',
      attributes: markAttributes(node.marks),
    })),
  );

  return text;
}

/** Marks ride a text delta as `{ [markName]: markAttrs }`. */
function markAttributes(
  marks: JsonMark[] | undefined,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};

  for (const mark of marks ?? []) {
    attributes[mark.type] = mark.attrs ?? {};
  }

  return attributes;
}
