import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const packageRoot = path.resolve(import.meta.dirname, '..');
const distRoot = path.join(packageRoot, 'dist');
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? '0.0.0.0';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function resolveAsset(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://${host}:${port}`).pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const candidate = path.resolve(distRoot, relativePath);
  if (!candidate.startsWith(distRoot)) {
    return undefined;
  }
  return candidate;
}

const server = createServer(async (request, response) => {
  const assetPath = resolveAsset(request.url ?? '/');
  const fallbackPath = path.join(distRoot, 'index.html');
  const filePath = assetPath && existsSync(assetPath) ? assetPath : fallbackPath;

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': contentTypes.get(path.extname(filePath)) ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, host, () => {
  console.log(`Serving ${distRoot} at http://${host}:${port}`);
});
