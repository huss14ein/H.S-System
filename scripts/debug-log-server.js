#!/usr/bin/env node
/**
 * Local debug log server for cursor debug mode.
 * Receives POST /ingest/:id and appends NDJSON to .cursor/debug-f02c55.log
 * Run: npm run debug-log-server (or node scripts/debug-log-server.js)
 * Then run the app and reproduce; logs will appear in .cursor/debug-f02c55.log
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 7588;
const LOG_DIR = path.join(__dirname, '..', '.cursor');
const LOG_FILE = path.join(LOG_DIR, 'debug-f02c55.log');

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !/^\/ingest\/.+/.test(req.url)) {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const line = JSON.stringify({ ...payload, timestamp: payload.timestamp || Date.now() }) + '\n';
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.appendFileSync(LOG_FILE, line);
    } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Debug log server: http://127.0.0.1:${PORT} -> ${LOG_FILE}`);
});
