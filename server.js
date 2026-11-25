// Жергілікті тексеруге арналған сервер (Vercel-сіз): node server.js
// Іске қосу алдында: GEMINI_API_KEY ортасының айнымалысын орнатыңыз (.env.example-ді қараңыз).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import handler from './api/ask.js';

if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const PORT = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/ask') {
    let raw = ''; for await (const c of req) { raw += c; if (raw.length > 5e6) break; }
    try { req.body = JSON.parse(raw || '{}'); } catch { req.body = null; }
    res.status = c => { res.statusCode = c; return res; };
    res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    return handler(req, res);
  }
  const file = path.join('public', path.normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, ''));
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(PORT, () => console.log(`AI Safety: http://localhost:${PORT}`));
