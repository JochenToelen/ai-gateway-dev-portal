import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPricingHandler } from './pricing-api.mjs';

async function withServer(env, run) {
  const handler = createPricingHandler(env);
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base);
  } finally {
    server.close();
  }
}

const doc = (n) => JSON.stringify({ schemaVersion: 1, currency: 'EUR', rules: [], audit: [], n });

describe('pricing API (file backend)', () => {
  it('returns 404 before the first save, then stores with ETag concurrency', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pricing-'));
    const file = join(dir, 'p.json');
    await withServer({ PRICING_FILE: file }, async (base) => {
      const first = await fetch(`${base}/`);
      expect(first.status).toBe(404);
      expect(first.headers.get('x-pricing-source')).toBe('file');

      const created = await fetch(base, { method: 'PUT', headers: { 'If-None-Match': '*' }, body: doc(1) });
      expect(created.status).toBe(200);
      const etag = created.headers.get('etag');

      const again = await fetch(base, { method: 'PUT', headers: { 'If-None-Match': '*' }, body: doc(2) });
      expect(again.status).toBe(412);

      const stale = await fetch(base, { method: 'PUT', headers: { 'If-Match': '"stale"' }, body: doc(3) });
      expect(stale.status).toBe(412);

      const updated = await fetch(base, { method: 'PUT', headers: { 'If-Match': etag }, body: doc(4) });
      expect(updated.status).toBe(200);
      expect(JSON.parse(await readFile(file, 'utf8')).n).toBe(4);
      expect((await fetch(base)).headers.get('etag')).toBe(updated.headers.get('etag'));
    });
  });

  it('rejects malformed documents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pricing-'));
    await withServer({ PRICING_FILE: join(dir, 'p.json') }, async (base) => {
      expect((await fetch(base, { method: 'PUT', body: 'nope' })).status).toBe(400);
      expect((await fetch(base, { method: 'PUT', body: '{"schemaVersion":2}' })).status).toBe(400);
    });
  });

  it('limits editing to PRICING_EDITORS', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pricing-'));
    await withServer({ PRICING_FILE: join(dir, 'p.json'), PRICING_EDITORS: 'admin@contoso.com' }, async (base) => {
      const denied = await fetch(base, { method: 'PUT', body: doc(1) });
      expect(denied.status).toBe(403);
      expect(denied.headers.get('x-pricing-can-edit')).toBe('false');
      const ok = await fetch(base, { method: 'PUT', headers: { 'x-ms-client-principal-name': 'Admin@contoso.com' }, body: doc(1) });
      expect(ok.status).toBe(200);
    });
  });
});
