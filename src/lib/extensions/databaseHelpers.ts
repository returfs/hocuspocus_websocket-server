/**
 * Database Extension Helpers
 *
 * Handles fetching and storing documents via the Returfs API.
 * Transforms between Yjs documents and plain text content.
 */

import axios from 'axios';
import * as Y from 'yjs';
import { api } from '../apiClient.js';
import { config } from '../../config/environment.js';
import type { AuthContext } from '../documentHelpers.js';
import { getDocumentType } from '../documentTypes.js';

// Base URL for API requests
const API_BASE_URL = config.apiUrl || 'https://project.test';

/** Append the document type so Laravel resolves the right rich sidecar. */
function withType(url: string, documentType: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}document_type=${encodeURIComponent(documentType)}`;
}

/**
 * Resolve the resource endpoint + auth header from the connection's auth context
 * (set by onAuthenticate). The route is built HERE from the document id, never
 * taken from client-supplied params, so a client cannot point us at another
 * resource. The path enforces auth: /collab is collab-token-only, /developer is
 * rfsk_-only, each scoped to the authenticated user server-side.
 */
function resourceEndpoint(
  documentName: string,
  context: AuthContext | undefined,
): { url: string; authHeader: string } {
  if (context?.mode === 'collab') {
    return {
      url: `${API_BASE_URL}/api/v1/collab/item-instances/${documentName}/resource`,
      authHeader: `Bearer ${context.token}`,
    };
  }

  if (context?.mode === 'developer') {
    return {
      url: `${API_BASE_URL}/api/v1/developer/item-instances/${documentName}/resource`,
      authHeader: `Bearer ${context.apiKey}`,
    };
  }

  throw new Error('No authentication context for resource access');
}

// ============================================================================
// Fetch Document
// ============================================================================

interface FetchDocumentParams {
  documentName: string;
  // Hocuspocus passes connection params as URLSearchParams (not a Map). Both
  // expose .get(key), but the types must match the @hocuspocus/server payload.
  requestParameters: URLSearchParams;
  // Auth context from onAuthenticate (collab token or dev rfsk_ key).
  context?: AuthContext;
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
  context,
}: FetchDocumentParams): Promise<Uint8Array> => {
  const documentType = getDocumentType(requestParameters.get('documentType'));

  // Transport-only types (word): the server never reads the resource; the
  // room starts empty and the first peer seeds it from the file client-side.
  // Auth has already run (onAuthenticate), so this is not a bypass.
  if (documentType.transportOnly) {
    console.log('[Hocuspocus] fetchDocument (transport-only, empty room):', {
      documentName,
      documentType: documentType.id,
    });
    return Y.encodeStateAsUpdate(documentType.empty());
  }

  const endpoint = resourceEndpoint(documentName, context);

  console.log('[Hocuspocus] fetchDocument:', {
    documentName,
    mode: context?.mode,
    documentType: documentType.id,
  });

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: endpoint.authHeader,
    };

    const fullUrl = withType(endpoint.url, documentType.id);
    console.log('[Hocuspocus] Fetching from:', fullUrl);

    const response = await api.get(fullUrl, { headers });
    const data = response.data;
    const item = data?.data?.item || data?.item;

    console.log('[Hocuspocus] API response:', {
      status: response.status,
      hasItem: !!item,
      contentType: item?.content_type,
      encoding: item?.encoding,
    });

    // Rich sidecar (.rtxt = Yjs document state). Full fidelity, restored with
    // NO server-side schema; apply the stored Yjs update directly. Preferred
    // over the plain content when present.
    if (item?.rich) {
      console.log('[Hocuspocus] Restoring rich Yjs state from sidecar');
      return new Uint8Array(Buffer.from(item.rich, 'base64'));
    }

    // Handle base64 encoded content (developer API format); plain fallback for
    // files never edited in the editor (no sidecar yet).
    if (item?.content && item?.encoding === 'base64') {
      const plainText = Buffer.from(item.content, 'base64').toString('utf-8');
      console.log('[Hocuspocus] Decoded text:', plainText.length, 'chars');
      return Y.encodeStateAsUpdate(documentType.hydrate(plainText));
    }

    // Handle plain string content
    if (typeof item?.content === 'string') {
      return Y.encodeStateAsUpdate(documentType.hydrate(item.content));
    }

    // Handle legacy resource response
    const resourceData = data?.item?.resource ?? data?.resource ?? data;
    if (typeof resourceData === 'string' && resourceData) {
      return Y.encodeStateAsUpdate(documentType.hydrate(resourceData));
    }

    // Handle raw bytes
    if (Array.isArray(resourceData?.data) && resourceData.data.length > 0) {
      return new Uint8Array(resourceData.data);
    }

    // A 2xx response with no content means a genuinely empty file; safe to
    // start from an empty document.
    console.log('[Hocuspocus] No content in response; starting empty document');
    return Y.encodeStateAsUpdate(documentType.empty());
  } catch (error) {
    // DATA-LOSS SAFETY: a load FAILURE (network error, 401/403/404/500) must NOT
    // silently seed an empty document; otherwise the user sees a blank editor,
    // edits it, and storeDocument overwrites the real file with empty content.
    // Re-throw so Hocuspocus fails the document load and the client shows a
    // connection error instead of a destructive blank state.
    console.error(
      '[Hocuspocus] Fetch FAILED; refusing to seed empty doc:',
      error,
    );
    throw error instanceof Error
      ? error
      : new Error('Failed to load document content');
  }
};

// ============================================================================
// Store Document
// ============================================================================

interface StoreDocumentParams {
  document: Y.Doc;
  documentName: string;
  // See FetchDocumentParams: Hocuspocus supplies URLSearchParams here.
  requestParameters: URLSearchParams;
  // Auth context from onAuthenticate (collab token or dev rfsk_ key).
  context?: AuthContext;
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
  context,
}: StoreDocumentParams): Promise<void> => {
  const documentType = getDocumentType(requestParameters.get('documentType'));

  // Transport-only types persist client-side (the typing peer exports the
  // file and writes the rich sidecar through the session API); storing the
  // flattened doc here would corrupt a binary format with an empty string.
  if (documentType.transportOnly) {
    return;
  }

  // A read-only collab connection must never persist; defence in depth (the
  // /collab PUT route also rejects read tokens, and Hocuspocus marks the
  // connection readOnly, but never even attempt the write here).
  if (context?.mode === 'collab' && context.perms !== 'write') {
    console.warn('[Hocuspocus] Skipping store; read-only connection');
    return;
  }

  let endpoint: { url: string; authHeader: string };
  try {
    endpoint = resourceEndpoint(documentName, context);
  } catch (e) {
    console.error('[Hocuspocus] No auth context for store; skipping', e);
    return;
  }

  console.log('[Hocuspocus] storeDocument:', {
    documentName,
    mode: context?.mode,
    documentType: documentType.id,
  });

  // Plain export: flatten the Yjs document per its document type (no full schema
  // needed to read the Yjs fragments). This is the portable export content.
  const plainText = documentType.flatten(document);
  const base64Content = Buffer.from(plainText, 'utf-8').toString('base64');

  // Rich sidecar: the full Yjs document state (base64). Restores full fidelity
  // + collab history on next open, with no server-side schema.
  const richState = Y.encodeStateAsUpdate(document);
  const base64Rich = Buffer.from(richState).toString('base64');

  console.log(
    '[Hocuspocus] Storing:',
    plainText.length,
    'chars text,',
    richState.length,
    'bytes rich',
  );

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: endpoint.authHeader,
  };

  try {
    const fullUrl = endpoint.url;
    console.log('[Hocuspocus] Storing to:', fullUrl);

    const response = await api.put(
      fullUrl,
      // encoding:'base64' is REQUIRED; without it the API stores the base64
      // string verbatim instead of decoding it (file corruption).
      {
        content: base64Content,
        encoding: 'base64',
        rich: base64Rich,
        document_type: documentType.id,
      },
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
