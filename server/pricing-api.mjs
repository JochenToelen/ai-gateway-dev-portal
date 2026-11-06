import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Shared AI model pricing document API (GET / PUT /api/pricing).
 *
 * Storage backend, chosen by environment:
 *  - PRICING_BLOB_URL set  -> Azure Blob Storage, accessed with the managed identity of the Container App
 *                             (DefaultAzureCredential; locally it falls back to `az login`).
 *  - otherwise             -> a JSON file on disk (PRICING_FILE, default ./data/ai-model-pricing.json).
 *
 * Optimistic concurrency uses ETag / If-Match in both backends.
 * Editing can be limited with PRICING_EDITORS (comma-separated object ids, e-mails or names as supplied by
 * Container Apps authentication in X-MS-CLIENT-PRINCIPAL-ID / -NAME). Unset = anyone who can reach the app.
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const BLOB_API_VERSION = '2023-11-03';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const etagOf = (text) => `"${createHash('sha256').update(text).digest('hex').slice(0, 32)}"`;

function fileBackend(path) {
  const file = resolve(path);
  return {
    source: 'file',
    async read() {
      try {
        const text = await readFile(file, 'utf8');
        return { text, etag: etagOf(text) };
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async write(text, ifMatch, ifNoneMatch) {
      const current = await this.read();
      if (ifNoneMatch === '*' && current) throw new HttpError(412, 'The pricing table already exists.');
      if (ifMatch && (!current || current.etag !== ifMatch)) throw new HttpError(412, 'The pricing table was changed by someone else.');
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${randomUUID()}.tmp`;
      await writeFile(tmp, text, 'utf8');
      await rename(tmp, file);
      return etagOf(text);
    },
  };
}

function blobBackend(url) {
  let credential;
  const headers = async () => {
    if (!credential) {
      const { DefaultAzureCredential } = await import('@azure/identity');
      credential = new DefaultAzureCredential();
    }
    const token = await credential.getToken('https://storage.azure.com/.default');
    return { Authorization: `Bearer ${token.token}`, 'x-ms-version': BLOB_API_VERSION };
  };
  const fail = (status) => {
    if (status === 401 || status === 403) {
      throw new HttpError(502, 'The server identity has no access to the pricing blob (needs Storage Blob Data Contributor).');
    }
    if (status === 409 || status === 412) throw new HttpError(412, 'The pricing table was changed by someone else.');
    throw new HttpError(502, `Blob storage returned HTTP ${status}.`);
  };
  return {
    source: 'blob',
    async read() {
      const res = await fetch(url, { headers: await headers(), cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) fail(res.status);
      return { text: await res.text(), etag: res.headers.get('etag') ?? '' };
    },
    async write(text, ifMatch, ifNoneMatch) {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          ...(await headers()),
          'x-ms-blob-type': 'BlockBlob',
          'Content-Type': 'application/json',
          ...(ifMatch ? { 'If-Match': ifMatch } : {}),
          ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}),
        },
        body: text,
      });
      if (!res.ok) fail(res.status);
      return res.headers.get('etag') ?? '';
    },
  };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'The pricing document is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function validateDocument(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'The body is not valid JSON.');
  }
  if (!doc || doc.schemaVersion !== 1 || !Array.isArray(doc.rules) || (doc.audit !== undefined && !Array.isArray(doc.audit))) {
    throw new HttpError(400, 'The pricing document has an unexpected format.');
  }
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createPricingHandler(env = process.env) {
  const backend = env.PRICING_BLOB_URL ? blobBackend(env.PRICING_BLOB_URL) : fileBackend(env.PRICING_FILE || './data/ai-model-pricing.json');
  const editors = (env.PRICING_EDITORS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

  const canEdit = (req) => {
    if (editors.length === 0) return true;
    const id = String(req.headers['x-ms-client-principal-id'] ?? '').toLowerCase();
    const name = String(req.headers['x-ms-client-principal-name'] ?? '').toLowerCase();
    return editors.includes(id) || (name !== '' && editors.includes(name));
  };

  const send = (res, status, headers, body) => {
    res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };

  return async (req, res) => {
    const meta = { 'x-pricing-source': backend.source, 'x-pricing-can-edit': String(canEdit(req)) };
    try {
      if (req.method === 'GET') {
        const current = await backend.read();
        if (!current) return send(res, 404, { ...meta, 'Content-Type': 'application/json' }, '{}');
        return send(res, 200, { ...meta, 'Content-Type': 'application/json', ETag: current.etag }, current.text);
      }
      if (req.method === 'PUT') {
        if (!canEdit(req)) throw new HttpError(403, 'You are not allowed to maintain AI model pricing.');
        const text = await readBody(req);
        validateDocument(text);
        const etag = await backend.write(text, req.headers['if-match'], req.headers['if-none-match']);
        return send(res, 200, { ...meta, ETag: etag }, '');
      }
      return send(res, 405, { ...meta, Allow: 'GET, PUT' }, '');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (!(e instanceof HttpError)) console.error('Pricing API error:', e instanceof Error ? e.message : e);
      const message = e instanceof HttpError ? e.message : 'The pricing store failed unexpectedly.';
      return send(res, status, { ...meta, 'Content-Type': 'application/json' }, JSON.stringify({ error: message }));
    }
  };
}
