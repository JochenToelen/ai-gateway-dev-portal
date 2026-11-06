import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { createPricingHandler } from './pricing-api.mjs';

/** Production server (Azure Container Apps): static SPA from ./dist plus the pricing API. */
const root = resolve(process.env.STATIC_DIR || 'dist');
const port = Number(process.env.PORT || 8080);
const pricing = createPricingHandler();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

async function serveFile(res, file, cache) {
  const body = await readFile(file);
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache });
  res.end(body);
}

createServer((req, res) => {
  void (async () => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (path === '/api/pricing') { await pricing(req, res); return; }
    if (path === '/healthz') { res.writeHead(200); res.end('ok'); return; }
    const file = normalize(join(root, path));
    try {
      if (file.startsWith(root + sep) && (await stat(file)).isFile()) {
        await serveFile(res, file, path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
        return;
      }
    } catch { /* fall through to the SPA entry point */ }
    await serveFile(res, join(root, 'index.html'), 'no-cache');
  })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
}).listen(port, () => { console.log(`Listening on ${port.toString()}`); });
