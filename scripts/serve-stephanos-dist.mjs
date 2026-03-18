import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { repoRoot } from './stephanos-build-utils.mjs';

const host = process.env.STEPHANOS_SERVE_HOST || '0.0.0.0';
const port = Number(process.env.STEPHANOS_SERVE_PORT || 4173);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function sendNotFound(response) {
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

const server = createServer((request, response) => {
  const requestPath = new URL(request.url || '/', `http://${host}:${port}`).pathname;
  const safeRelativePath = normalize(requestPath).replace(/^([.][.][/\\])+/, '');
  let filePath = resolve(repoRoot, `.${safeRelativePath}`);

  if (!filePath.startsWith(repoRoot)) {
    sendNotFound(response);
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (!existsSync(filePath)) {
    sendNotFound(response);
    return;
  }

  const contentType = mimeTypes[extname(filePath)] || 'application/octet-stream';
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Stephanos static server running at http://${host}:${port}/`);
  console.log(`Open the built runtime at http://127.0.0.1:${port}/apps/stephanos/dist/`);
  console.log(`Open the launcher shell at http://127.0.0.1:${port}/`);
});
