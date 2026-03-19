/**
 * Database Extension Helpers
 *
 * Handles fetching and storing documents via the Returfs API.
 * Transforms between Yjs documents and plain text content.
 */

import { TiptapTransformer } from '@hocuspocus/transformer';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { generateJSON } from '@tiptap/html';
import axios from 'axios';
import * as Y from 'yjs';
import { config } from '../../config/environment';

// Base URL for API requests
const API_BASE_URL = config.apiUrl || 'http://project.test';

/**
 * Build full URL from potentially relative path
 */
function buildUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

// ============================================================================
// Helper Functions
// ============================================================================

function emptyYDoc(): Y.Doc {
  const json = {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  };

  return TiptapTransformer.toYdoc(json, 'default', [Document, Paragraph, Text]);
}

function textDoc(text: string): Y.Doc {
  const jsonData = generateJSON(text, [Document, Paragraph, Text]);
  return TiptapTransformer.toYdoc(jsonData, 'default', [
    Document,
    Paragraph,
    Text,
  ]);
}

/**
 * Extract plain text from Tiptap JSON structure
 */
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

  // Handle the default fragment structure from TiptapTransformer.fromYdoc
  const content =
    (json.default as Record<string, unknown>)?.content ||
    (json.content as unknown[]) ||
    [];

  for (const node of content as Record<string, unknown>[]) {
    if (node.type === 'paragraph') {
      lines.push(processNode(node));
    } else {
      lines.push(processNode(node));
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Fetch Document
// ============================================================================

interface FetchDocumentParams {
  documentName: string;
  requestParameters: Map<string, string>;
}

/**
 * Fetch document content from Returfs API
 *
 * Called when a client connects to a document for the first time.
 * Retrieves the current content from the API and converts it to a Yjs document.
 */
export const fetchDocument = async ({
  documentName,
  requestParameters,
}: FetchDocumentParams): Promise<Uint8Array> => {
  const resourceRoute = requestParameters.get('resourceRoute');
  const apiKey = requestParameters.get('apiKey');

  console.log('[Hocuspocus] fetchDocument:', {
    documentName,
    resourceRoute,
    hasApiKey: !!apiKey,
  });

  if (!resourceRoute) {
    throw new Error('No resource route provided');
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    // Include API key for developer authentication (Bearer token format)
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const fullUrl = buildUrl(resourceRoute);
    console.log('[Hocuspocus] Fetching from:', fullUrl);

    const response = await axios.get(fullUrl, { headers });
    const data = response.data;
    const item = data?.data?.item || data?.item;

    console.log('[Hocuspocus] API response:', {
      status: response.status,
      hasItem: !!item,
      contentType: item?.content_type,
      encoding: item?.encoding,
    });

    // Handle base64 encoded content (developer API format)
    if (item?.content && item?.encoding === 'base64') {
      const plainText = Buffer.from(item.content, 'base64').toString('utf-8');
      console.log('[Hocuspocus] Decoded text:', plainText.length, 'chars');
      return Y.encodeStateAsUpdate(textDoc(plainText));
    }

    // Handle plain string content
    if (typeof item?.content === 'string') {
      return Y.encodeStateAsUpdate(textDoc(item.content));
    }

    // Handle legacy resource response
    const resourceData = data?.item?.resource ?? data?.resource ?? data;
    if (typeof resourceData === 'string' && resourceData) {
      return Y.encodeStateAsUpdate(textDoc(resourceData));
    }

    // Handle raw bytes
    if (Array.isArray(resourceData?.data) && resourceData.data.length > 0) {
      return new Uint8Array(resourceData.data);
    }

    console.log('[Hocuspocus] Returning empty document');
    return Y.encodeStateAsUpdate(emptyYDoc());
  } catch (error) {
    console.error('[Hocuspocus] Fetch error:', error);
    return Y.encodeStateAsUpdate(emptyYDoc());
  }
};

// ============================================================================
// Store Document
// ============================================================================

interface StoreDocumentParams {
  document: Y.Doc;
  documentName: string;
  requestParameters: Map<string, string>;
}

/**
 * Store document content to Returfs API
 *
 * Called when document changes need to be persisted.
 * Converts the Yjs document back to plain text and sends to the API.
 */
export const storeDocument = async ({
  document,
  documentName,
  requestParameters,
}: StoreDocumentParams): Promise<void> => {
  const resourceUpdateRoute = requestParameters.get('resourceUpdateRoute');
  const apiKey = requestParameters.get('apiKey');

  console.log('[Hocuspocus] storeDocument:', {
    documentName,
    resourceUpdateRoute,
    hasApiKey: !!apiKey,
  });

  if (!resourceUpdateRoute) {
    console.error('[Hocuspocus] No update route provided');
    return;
  }

  // Convert Yjs document to JSON, then extract plain text
  const documentJson = TiptapTransformer.fromYdoc(document) as Record<
    string,
    unknown
  >;
  const plainText = extractTextFromTiptap(documentJson);
  const base64Content = Buffer.from(plainText, 'utf-8').toString('base64');

  console.log('[Hocuspocus] Storing:', plainText.length, 'chars');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // Include API key for developer authentication (Bearer token format)
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const fullUrl = buildUrl(resourceUpdateRoute);
    console.log('[Hocuspocus] Storing to:', fullUrl);

    const response = await axios.put(
      fullUrl,
      { content: base64Content },
      { headers },
    );
    console.log('[Hocuspocus] Store successful:', response.status);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        '[Hocuspocus] Store error:',
        error.response?.status,
        error.response?.data,
      );
    } else {
      console.error('[Hocuspocus] Store error:', error);
    }
  }
};
