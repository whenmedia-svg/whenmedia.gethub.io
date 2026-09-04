/**
 * dev.js — local preview server with automatic rebuild + browser reload.
 *
 * Usage: npm run dev   →   http://localhost:3000
 *
 * Watches settings.toml, the media/ folder, and the generator itself.
 * When anything changes it rebuilds and tells the browser to refresh.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.js';
import { SettingsError } from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '_site');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

let lastBuildError = null;
const sseClients = new Set();

async function rebuild() {
  try {
    await build({ quiet: false });
    lastBuildError = null;
  } catch (err) {
    lastBuildError = err instanceof SettingsError ? err.message : String(err.stack || err);
    console.error('\nBuild failed:\n' + lastBuildError + '\n');
  }
  for (const res of sseClients) res.write('data: reload\n\n');
}

// Debounced watcher
let timer = null;
function scheduleRebuild(reason) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`\n↻ Change detected (${reason}) — rebuilding…`);
    rebuild();
  }, 150);
}

function watchDir(dir, label) {
  if (!fs.existsSync(dir)) return;
  fs.watch(dir, { recursive: true }, (_event, filename) => scheduleRebuild(`${label}${filename ? ': ' + filename : ''}`));
}

const LIVE_RELOAD_SNIPPET = `<script>new EventSource('/__reload').onmessage=()=>location.reload();</script>`;

function errorPage(message) {
  return `<!doctype html><meta charset="utf-8"><title>Build error</title>
<body style="font-family:ui-monospace,Menlo,monospace;background:#2b1d1d;color:#ffd9d9;padding:3rem;line-height:1.6">
<h1 style="color:#ff8a8a">The site could not be built</h1>
<pre style="white-space:pre-wrap;font-size:15px">${message.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>
<p style="color:#caa">Fix settings.toml and save — this page will refresh itself.</p>${LIVE_RELOAD_SNIPPET}</body>`;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

  if (urlPath === '/__reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (lastBuildError && (urlPath === '/' || urlPath === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(errorPage(lastBuildError));
    return;
  }

  let filePath = path.join(OUT, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(OUT)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found: ' + urlPath);
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  let data = fs.readFileSync(filePath);
  if (ext === '.html') data = Buffer.from(data.toString().replace('</body>', LIVE_RELOAD_SNIPPET + '</body>'));
  res.end(data);
});

await rebuild();
watchDir(path.join(ROOT, 'media'), 'media');
watchDir(path.join(ROOT, 'generator'), 'generator');
fs.watchFile(path.join(ROOT, 'settings.toml'), { interval: 300 }, () => scheduleRebuild('settings.toml'));

server.listen(PORT, () => {
  console.log(`\n★ Preview running at  http://localhost:${PORT}\n  (Press Ctrl+C to stop)\n`);
});
