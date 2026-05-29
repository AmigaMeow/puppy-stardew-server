/**
 * Puppy Stardew Server - Web Management Panel
 * Main server entry point
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const auth = require('./auth');

// ─── Configuration ───────────────────────────────────────────────
const PORT = parseInt(process.env.PANEL_PORT || '18642', 10);

// Paths (inside container)
const DATA_DIR = process.env.PANEL_DATA_DIR || path.join(__dirname, 'data');
const STATUS_FILE = process.env.STATUS_FILE || '/home/steam/.local/share/puppy-stardew/status.json';
const LOG_DIR = process.env.LOG_DIR || '/home/steam/.local/share/puppy-stardew/logs';
const SAVES_DIR = process.env.SAVES_DIR || '/home/steam/.config/StardewValley/Saves';
const BACKUPS_DIR = process.env.BACKUPS_DIR || '/home/steam/.local/share/puppy-stardew/backups';
const GAME_DIR = process.env.GAME_DIR || '/home/steam/stardewvalley';
const SMAPI_LOG = process.env.SMAPI_LOG || '/home/steam/.config/StardewValley/ErrorLogs/SMAPI-latest.txt';
const ENV_FILE = process.env.ENV_FILE || '/home/steam/web-panel/data/runtime.env';

function sanitizeErrorMessage(msg) {
  if (typeof msg !== 'string') return 'Internal error';
  return msg.replace(/\/home\/\S+/g, '<path>').replace(/\/proc\/\S+/g, '<path>');
}

// Export paths for use by API modules
const config = {
  PORT,
  DATA_DIR,
  STATUS_FILE,
  LOG_DIR,
  SAVES_DIR,
  BACKUPS_DIR,
  GAME_DIR,
  SMAPI_LOG,
  ENV_FILE,
  sanitizeErrorMessage,
};
module.exports = config;

// ─── Express App ─────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// Security headers (equivalent to helmet defaults, no extra dependency)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.removeHeader('X-Powered-By');
  next();
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// ─── API Rate Limiting ──────────────────────────────────────────
const apiHits = new Map(); // ip -> { count, resetAt }
const API_RATE_WINDOW_MS = 60 * 1000;
const API_RATE_MAX = parseInt(process.env.API_RATE_LIMIT || '120', 10);

function apiRateLimiter(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  let bucket = apiHits.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + API_RATE_WINDOW_MS };
    apiHits.set(ip, bucket);
  }
  bucket.count += 1;
  res.setHeader('X-RateLimit-Limit', API_RATE_MAX);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, API_RATE_MAX - bucket.count));
  if (bucket.count > API_RATE_MAX) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({ error: 'Too many requests, try again later' });
  }
  next();
}
app.use(apiRateLimiter);

// Periodically clean up stale rate-limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of apiHits) {
    if (now >= bucket.resetAt) apiHits.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// ─── Auth Routes (no JWT required) ───────────────────────────────
app.get('/api/auth/status', auth.getStatus);
app.post('/api/auth/setup', auth.setup);
app.post('/api/auth/login', auth.login);
app.get('/api/auth/verify', auth.verifyMiddleware, auth.verify);
app.post('/api/auth/password', auth.verifyMiddleware, auth.changePassword);

// ─── API Routes (JWT required) ──────────────────────────────────
// Status API
const statusAPI = require('./api/status');
app.get('/api/status', auth.verifyMiddleware, statusAPI.getStatus);

// Logs API
const logsAPI = require('./api/logs');
app.get('/api/logs', auth.verifyMiddleware, logsAPI.getLogs);

// Players API
const playersAPI = require('./api/players');
app.get('/api/players', auth.verifyMiddleware, playersAPI.getPlayers);

// Saves API
const savesAPI = require('./api/saves');
app.get('/api/saves', auth.verifyMiddleware, savesAPI.getSaves);
app.get('/api/saves/backups', auth.verifyMiddleware, savesAPI.getBackups);
app.get('/api/saves/backup/status', auth.verifyMiddleware, savesAPI.getBackupStatus);
app.post('/api/saves/backup', auth.verifyMiddleware, savesAPI.createBackup);
app.post('/api/saves/upload', auth.verifyMiddleware, savesAPI.uploadSave);
app.post('/api/saves/default', auth.verifyMiddleware, savesAPI.setDefaultSave);
app.post('/api/saves/download-token', auth.verifyMiddleware, savesAPI.createDownloadToken);
app.get('/api/saves/download/:filename', savesAPI.downloadBackup);

// Config API
const configAPI = require('./api/config');
app.get('/api/config', auth.verifyMiddleware, configAPI.getConfig);
app.put('/api/config', auth.verifyMiddleware, configAPI.updateConfig);

// Server control API
app.post('/api/server/restart', auth.verifyMiddleware, statusAPI.restartServer);
app.post('/api/container/restart', auth.verifyMiddleware, statusAPI.restartContainer);

// Mods API
const modsAPI = require('./api/mods');
app.get('/api/mods', auth.verifyMiddleware, modsAPI.getMods);
app.post('/api/mods/upload', auth.verifyMiddleware, modsAPI.uploadMod);
app.delete('/api/mods/:folder', auth.verifyMiddleware, modsAPI.deleteMod);

// ─── Static Files ────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── WebSocket Server ────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  // Parse token from query string
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');

  if (!token || !auth.verifyToken(token)) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  console.log('[WebSocket] Client connected');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleWebSocketMessage(ws, msg);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected');
    // Clean up any log subscriptions or terminal sessions
    if (ws._logWatcher) {
      ws._logWatcher.close();
      ws._logWatcher = null;
    }
    if (ws._terminalProc) {
      ws._terminalProc.kill();
      ws._terminalProc = null;
    }
  });
});

function handleWebSocketMessage(ws, msg) {
  switch (msg.type) {
    case 'subscribe':
      if (msg.channel === 'logs') {
        logsAPI.subscribeLogs(ws, msg.filter || 'all');
      } else if (msg.channel === 'status') {
        statusAPI.subscribeStatus(ws);
      }
      break;

    case 'unsubscribe':
      if (msg.channel === 'logs' && ws._logWatcher) {
        ws._logWatcher.close();
        ws._logWatcher = null;
      }
      break;

    case 'terminal:input':
      const terminalAPI = require('./api/terminal');
      terminalAPI.handleInput(ws, msg.data);
      break;

    case 'terminal:open':
      const terminalAPI2 = require('./api/terminal');
      terminalAPI2.openTerminal(ws);
      break;

    case 'terminal:close':
      if (ws._terminalProc) {
        ws._terminalProc.kill();
        ws._terminalProc = null;
      }
      break;

    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
  }
}

// ─── Initialize & Start ──────────────────────────────────────────
async function start() {
  // Initialize auth and detect whether first-run setup is required.
  await auth.initialize(DATA_DIR);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Web Panel] ✅ Management panel running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[Web Panel] Failed to start:', err);
  process.exit(1);
});
