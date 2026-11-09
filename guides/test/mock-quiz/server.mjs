// Serves a local replica of a Moodle quiz attempt page so the extension's
// content scripts (which match *://*/mod/quiz/attempt.php*) run against it.
//
//   node guides/test/mock-quiz/server.mjs
//   open http://localhost:8781/mod/quiz/attempt.php?attempt=990001&page=0
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, 'attempt.html'), 'utf8');
const port = Number(process.env.MOCK_QUIZ_PORT || 8781);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === '/mod/quiz/attempt.php' || url.pathname === '/mod/quiz/review.php') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found. Use /mod/quiz/attempt.php?attempt=990001&page=0');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`mock quiz on http://localhost:${port}/mod/quiz/attempt.php?attempt=990001&page=0`);
});
