import { EMPTY_DOCUMENT, type PricingDocument } from './types';

/**
 * Browser side of the shared AI model pricing document. The browser never talks to storage and holds
 * no storage credentials: it calls the same-origin /api/pricing endpoint (server/pricing-api.mjs), which
 * reads and writes a local JSON file in development, or the blob with the Container App managed identity.
 * Optimistic concurrency uses the ETag so concurrent admins never overwrite each other.
 */

const ENDPOINT = '/api/pricing';

export type StoreErrorKind = 'forbidden' | 'conflict' | 'invalid' | 'network';
export type StoreSource = 'file' | 'blob';

export class PricingStoreError extends Error {
  kind: StoreErrorKind;
  constructor(kind: StoreErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface LoadedPricing {
  doc: PricingDocument;
  etag: string | null;
  canEdit: boolean;
  source: StoreSource | null;
}

function parseDocument(text: string): PricingDocument {
  let raw: Partial<PricingDocument>;
  try {
    raw = JSON.parse(text) as Partial<PricingDocument>;
  } catch {
    throw new PricingStoreError('invalid', 'The pricing document is not valid JSON.');
  }
  if (Object.keys(raw).length === 0) return structuredClone(EMPTY_DOCUMENT);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.rules)) throw new PricingStoreError('invalid', 'The pricing document has an unexpected format.');
  return { schemaVersion: 1, currency: raw.currency ?? null, rules: raw.rules, audit: Array.isArray(raw.audit) ? raw.audit : [] };
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: string };
    if (body.error) return body.error;
  } catch { /* not JSON */ }
  return `The pricing service returned HTTP ${res.status.toString()}.`;
}

async function call(init?: RequestInit): Promise<Response> {
  try {
    return await fetch(ENDPOINT, { cache: 'no-store', ...init });
  } catch {
    throw new PricingStoreError('network', 'Could not reach the pricing service (/api/pricing).');
  }
}

const sourceOf = (res: Response): StoreSource | null => {
  const s = res.headers.get('x-pricing-source');
  return s === 'file' || s === 'blob' ? s : null;
};

export async function loadPricingDocument(): Promise<LoadedPricing> {
  const res = await call();
  const meta = { canEdit: res.headers.get('x-pricing-can-edit') !== 'false', source: sourceOf(res) };
  // A missing document is a valid, empty pricing table
  if (res.status === 404 && meta.source) return { doc: structuredClone(EMPTY_DOCUMENT), etag: null, ...meta };
  if (!res.ok) throw new PricingStoreError(res.status === 403 ? 'forbidden' : 'network', await errorMessage(res));
  const text = await res.text();
  // A dev server without the API answers with the SPA's index.html
  if (!meta.source) throw new PricingStoreError('network', 'The pricing service is not available on this host.');
  return { doc: parseDocument(text), etag: res.headers.get('ETag'), ...meta };
}

/** etag null = the document does not exist yet (create-only), otherwise replace only that version */
export async function savePricingDocument(doc: PricingDocument, etag: string | null): Promise<string | null> {
  const res = await call({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }) },
    body: JSON.stringify(doc, null, 2),
  });
  if (res.status === 412) throw new PricingStoreError('conflict', 'The pricing table was changed by someone else. It has been reloaded; review and retry.');
  if (res.status === 403) throw new PricingStoreError('forbidden', await errorMessage(res));
  if (!res.ok) throw new PricingStoreError('network', await errorMessage(res));
  return res.headers.get('ETag');
}
