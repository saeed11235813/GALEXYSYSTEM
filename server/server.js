'use strict';
// Agency HQ server: serves the office page and runs agents through the Claude Code CLI,
// which is signed in with a Claude subscription (CLAUDE_CODE_OAUTH_TOKEN), not an API key.
// No dependencies: Node 20+ only.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.ACCESS_TOKEN || '';
const MAX_JOBS = Math.max(1, Number(process.env.MAX_JOBS || 2));
const MAX_TURNS = process.env.MAX_TURNS || '';
const WORKSPACES = process.env.WORKSPACES || path.join(ROOT, 'workspaces');
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite']
  .concat(process.env.ALLOW_BASH === '1' ? ['Bash'] : []);

if (!TOKEN || TOKEN.length < 16) {
  console.error('ACCESS_TOKEN (16+ characters) must be set. See /etc/agency-hq.env');
  process.exit(1);
}

const agents = new Map(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'agents.json'), 'utf8')).agents.map((a) => [a.id, a]),
);

// ---------- jobs ----------
const jobs = new Map(); // id -> job
const queue = [];
let running = 0;

function publicJob(j, withText) {
  const o = { id: j.id, agentId: j.agentId, task: j.task.slice(0, 200), status: j.status, sessionId: j.sessionId,
    createdAt: j.createdAt, startedAt: j.startedAt, endedAt: j.endedAt, error: j.error, costUsd: j.costUsd };
  if (withText) o.text = j.text;
  return o;
}
function emit(j, event, data) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of j.clients) res.write(line);
}
function setStatus(j, status, extra = {}) {
  Object.assign(j, { status }, extra);
  emit(j, 'status', publicJob(j));
}

function systemPrompt(a) {
  return `${a.body}\n\n---\nYou are running as the "${a.name}" agent of Agency HQ, on a server. ` +
    'Always reply in the same language the user writes in (for Persian, answer in fluent Persian). ' +
    'Your working directory is your private workspace; save any deliverable files there and mention their names.';
}

function startJob(j) {
  running++;
  const a = agents.get(j.agentId);
  const cwd = path.join(WORKSPACES, j.agentId);
  fs.mkdirSync(cwd, { recursive: true });
  const args = ['-p', j.task, '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--append-system-prompt', systemPrompt(a), '--permission-mode', 'acceptEdits',
    '--allowedTools', TOOLS.join(',')];
  if (MAX_TURNS) args.push('--max-turns', String(MAX_TURNS));
  if (j.resume) args.push('--resume', j.resume);
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // force the subscription login, never API billing
  delete env.ACCESS_TOKEN;
  setStatus(j, 'running', { startedAt: Date.now() });
  const child = spawn(CLAUDE_BIN, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  j.child = child;
  let buf = '', stderr = '', sawDelta = false;
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.session_id && !j.sessionId) j.sessionId = m.session_id;
      if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') {
        sawDelta = true;
        j.text += m.event.delta.text;
        emit(j, 'delta', { text: m.event.delta.text });
      } else if (m.type === 'assistant' && !sawDelta) {
        const t = (m.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
        if (t) { j.text += t; emit(j, 'delta', { text: t }); }
      } else if (m.type === 'assistant') {
        // a turn finished; separate it from the next one and report tool use
        const tools = (m.message?.content || []).filter((c) => c.type === 'tool_use').map((c) => c.name);
        if (tools.length) emit(j, 'tool', { tools });
        sawDelta = false;
        if (j.text && !j.text.endsWith('\n\n')) { j.text += '\n\n'; emit(j, 'delta', { text: '\n\n' }); }
      } else if (m.type === 'result') {
        j.costUsd = m.total_cost_usd;
        if (m.is_error) j.error = String(m.result || m.subtype || 'error').slice(0, 500);
      }
    }
  });
  child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-2000); });
  child.on('close', (code) => {
    running--;
    j.child = null;
    if (j.status === 'stopped') { /* already reported */ }
    else if (code === 0 && !j.error) setStatus(j, 'done', { endedAt: Date.now() });
    else setStatus(j, 'error', { endedAt: Date.now(), error: j.error || stderr.trim().split('\n').pop() || `exit ${code}` });
    for (const res of j.clients) res.end();
    j.clients.clear();
    pump();
  });
  child.on('error', (err) => { j.error = `Could not start Claude Code: ${err.message}`; });
}
function pump() {
  while (running < MAX_JOBS && queue.length) startJob(queue.shift());
}
function prune() {
  const done = [...jobs.values()].filter((j) => !['queued', 'running'].includes(j.status));
  done.sort((a, b) => a.createdAt - b.createdAt);
  while (jobs.size > 300 && done.length) jobs.delete(done.shift().id);
}

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' };
const STATIC_OK = /^\/(index\.html|app\.js|data\/[\w./-]+\.json)$/;

function authed(req, url) {
  const got = req.headers['x-agency-token'] || url.searchParams.get('token') || '';
  const a = Buffer.from(String(got)), b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 100000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/health') return send(res, 200, { ok: true, server: 'agency-hq', maxJobs: MAX_JOBS, tools: TOOLS });
    if (p.startsWith('/api/')) {
      if (!authed(req, url)) return send(res, 401, { error: 'bad_token' });
      if (p === '/api/auth') return send(res, 200, { ok: true });
      if (p === '/api/jobs' && req.method === 'GET') {
        return send(res, 200, { running, queued: queue.length, jobs: [...jobs.values()].slice(-100).map((j) => publicJob(j)) });
      }
      if (p === '/api/run' && req.method === 'POST') {
        const b = await body(req);
        const task = String(b.task || '').trim();
        if (!agents.has(b.agentId)) return send(res, 400, { error: 'unknown_agent' });
        if (!task || task.length > 20000) return send(res, 400, { error: 'bad_task' });
        const resume = b.sessionId && /^[\w-]{8,80}$/.test(b.sessionId) ? b.sessionId : null;
        const j = { id: crypto.randomUUID(), agentId: b.agentId, task, resume, status: 'queued', text: '', sessionId: resume,
          createdAt: Date.now(), clients: new Set() };
        jobs.set(j.id, j); prune();
        queue.push(j); pump();
        return send(res, 200, publicJob(j));
      }
      const m = p.match(/^\/api\/jobs\/([\w-]+)(\/events|\/stop)?$/);
      if (m && jobs.has(m[1])) {
        const j = jobs.get(m[1]);
        if (!m[2]) return send(res, 200, publicJob(j, true));
        if (m[2] === '/stop' && req.method === 'POST') {
          if (j.status === 'queued') { queue.splice(queue.indexOf(j), 1); setStatus(j, 'stopped', { endedAt: Date.now() }); }
          else if (j.child) { setStatus(j, 'stopped', { endedAt: Date.now() }); j.child.kill('SIGTERM'); }
          return send(res, 200, publicJob(j));
        }
        if (m[2] === '/events') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
          res.write(`event: status\ndata: ${JSON.stringify(publicJob(j))}\n\n`);
          if (j.text) res.write(`event: delta\ndata: ${JSON.stringify({ text: j.text })}\n\n`);
          if (['queued', 'running'].includes(j.status)) { j.clients.add(res); req.on('close', () => j.clients.delete(res)); }
          else res.end();
          return;
        }
      }
      return send(res, 404, { error: 'not_found' });
    }
    // static files
    const rel = p === '/' ? '/index.html' : p;
    if (!STATIC_OK.test(rel) || rel.includes('..')) { res.writeHead(404); return res.end('Not found'); }
    const file = path.join(ROOT, rel);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});
server.listen(PORT, HOST, () => console.log(`Agency HQ on http://${HOST}:${PORT} (max ${MAX_JOBS} parallel agents)`));
