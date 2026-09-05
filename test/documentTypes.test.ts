import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getDocumentType } from '../src/lib/documentTypes.js';

/**
 * The sync server both seeds a room from a file and writes the file back from
 * the room, so `hydrate` and `flatten` are inverses of each other. When they
 * are not, the damage is silent and total: the next debounced save overwrites
 * the user's file with whatever the round trip produced.
 *
 * That is not hypothetical. `text` used to hydrate with `generateJSON`, which
 * parses its input as HTML — every run of whitespace collapsed, so opening a
 * plain text file and touching nothing rewrote it as a single line.
 */
function roundTrip(id: string, source: string): string {
  const documentType = getDocumentType(id);

  // Through the wire, not just through memory: the room a second client joins
  // is rebuilt from an encoded update, and an encoding that loses something is
  // just as destructive as a conversion that does.
  const update = Y.encodeStateAsUpdate(documentType.hydrate(source));
  const landed = new Y.Doc();
  Y.applyUpdate(landed, update);

  return documentType.flatten(landed);
}

describe('text documents', () => {
  it.each([
    ['newlines', 'line one\nline two\nline three'],
    ['blank lines', 'first\n\nsecond\n\n\nthird'],
    ['leading indentation', 'top\n    four spaces\n\tone tab'],
    ['interior runs of spaces', 'a     b\tc'],
    ['a single line', 'just the one line'],
    ['a trailing newline', 'ends with a break\n'],
  ])('survives %s', (_label, source) => {
    expect(roundTrip('text', source)).toBe(source);
  });

  it('opens an empty file as an empty document', () => {
    expect(roundTrip('text', '')).toBe('');
  });
});

describe('code documents', () => {
  const php = [
    '<?php',
    '',
    'declare(strict_types=1);',
    '',
    'final class Example',
    '{',
    '\tpublic function run(): void',
    '\t{',
    '\t\t// A trailing space follows this comment.   ',
    '\t}',
    '}',
    '',
  ].join('\n');

  it('is byte-exact, tabs and trailing whitespace included', () => {
    expect(roundTrip('code', php)).toBe(php);
  });

  it('keeps CRLF line endings', () => {
    const source = 'first\r\nsecond\r\nthird\r\n';
    expect(roundTrip('code', source)).toBe(source);
  });

  it('keeps a file that has no trailing newline', () => {
    expect(roundTrip('code', 'no newline at end')).toBe('no newline at end');
  });

  it('keeps characters markdown would have escaped', () => {
    const source = '# not a heading\n*not emphasis*\n- not a list\n[a](b)';
    expect(roundTrip('code', source)).toBe(source);
  });

  it('opens an empty file as an empty document', () => {
    expect(roundTrip('code', '')).toBe('');
  });

  it('stores the file under the field CodeMirror binds to', () => {
    const documentType = getDocumentType('code');
    const doc = documentType.hydrate('hello');

    expect(doc.getText('codemirror').toString()).toBe('hello');
  });
});

describe('the registry', () => {
  it.each([
    ['text', 'rtxt'],
    ['markdown', 'rtxt'],
    ['code', 'rtxt'],
    ['word', 'rdocx'],
    ['sheet', 'rxlsx'],
    ['slides', 'rpptx'],
  ])('gives %s the %s sidecar', (id, richExtension) => {
    expect(getDocumentType(id).richExtension).toBe(richExtension);
  });

  it.each(['word', 'sheet', 'slides'])('keeps %s transport-only', id => {
    expect(getDocumentType(id).transportOnly).toBe(true);
  });

  it('falls back to text for an unknown id', () => {
    expect(getDocumentType('nonsense').id).toBe('text');
    expect(getDocumentType(null).id).toBe('text');
  });
});
