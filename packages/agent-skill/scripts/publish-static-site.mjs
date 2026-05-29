#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

const [directoryArg, ...flags] = process.argv.slice(2);
if (!directoryArg) {
  console.error('Usage: divband-publish-static <directory> [--spa] [--anonymous]');
  process.exit(2);
}

const root = resolve(directoryArg);
const apiBaseUrl = (process.env.DIVBAND_API_BASE_URL ?? 'https://api.divband.local').replace(/\/+$/, '');
const token = process.env.DIVBAND_API_TOKEN;

await assertSafeRoot(root);
const files = await collectFiles(root);
const publish = await api('POST', '/api/v1/publish', {
  files,
  spaMode: flags.includes('--spa'),
  anonymous: flags.includes('--anonymous') || !token,
});

for (const upload of publish.upload.uploads) {
  const absolutePath = join(root, upload.path);
  const body = await readFile(absolutePath);
  const response = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body,
  });
  if (!response.ok) {
    throw new Error(`Upload failed for ${upload.path}: HTTP ${response.status}`);
  }
}

await fetch(publish.finalizeUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ versionId: publish.upload.versionId }),
});

console.log(JSON.stringify({ siteUrl: publish.siteUrl, slug: publish.slug, expiresAt: publish.expiresAt, claimToken: publish.claimToken }, null, 2));

async function api(method, path, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(json));
  }
  return json;
}

async function assertSafeRoot(rootPath) {
  const home = process.env.HOME ? resolve(process.env.HOME) : undefined;
  if (rootPath === '/' || (home && rootPath === home)) {
    throw new Error('Refusing to publish filesystem root or home directory.');
  }
  await stat(rootPath);
}

async function collectFiles(rootPath, current = rootPath) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (['.git', 'node_modules', '.env'].includes(entry.name) || entry.name.endsWith('.pem') || entry.name.endsWith('.key')) {
      throw new Error(`Refusing to publish sensitive or unsafe path: ${entry.name}`);
    }
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(rootPath, fullPath));
    } else if (entry.isFile()) {
      const body = await readFile(fullPath);
      files.push({
        path: relative(rootPath, fullPath).split(sep).join('/'),
        size: body.byteLength,
        contentType: contentTypeFor(fullPath),
        hash: `sha256-${createHash('sha256').update(body).digest('base64url')}`,
      });
    }
  }
  return files;
}

function contentTypeFor(path) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.txt': 'text/plain; charset=utf-8',
  }[extname(path).toLowerCase()] ?? 'application/octet-stream';
}
