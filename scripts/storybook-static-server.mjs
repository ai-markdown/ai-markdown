/* global process, console */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { URL, pathToFileURL } from 'node:url';

export async function startStorybookServer(port = 0) {
  const root = resolve('storybook-static');
  const prefix = '/preview/storybook/';
  const mime = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith(prefix)) {
        res.writeHead(404).end();
        return;
      }
      let path = resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)) || '.');
      if (path !== root && !path.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      if ((await stat(path)).isDirectory()) path += '/index.html';
      res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
      res.end(await readFile(path));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, base: origin + prefix };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { base } = await startStorybookServer(Number(process.env.PORT ?? 6108));
  console.log(base);
}
