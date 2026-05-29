/**
 * Logs API - Log reading and WebSocket streaming
 */

const fs = require('fs');
const path = require('path');
const config = require('../server');

// Log file mapping
const LOG_FILES = {
  all: 'smapi-latest.log',
  error: 'errors.log',
  mod: 'mods.log',
  server: 'server.log',
  game: 'game.log',
};

function getCategorizedLogPath(filter) {
  const filename = LOG_FILES[filter] || LOG_FILES.all;
  return path.join(config.LOG_DIR, 'categorized', filename);
}

function getLogSource(filter) {
  if (filter === 'all' || filter === 'smapi') {
    return { path: config.SMAPI_LOG, filtered: false };
  }

  if (filter === 'mod' || filter === 'server' || filter === 'game') {
    return { path: config.SMAPI_LOG, filtered: true };
  }

  const categorizedPath = getCategorizedLogPath(filter);
  if (fs.existsSync(categorizedPath)) {
    return { path: categorizedPath, filtered: false };
  }

  return { path: config.SMAPI_LOG, filtered: true };
}

function matchesFilter(filter, line) {
  if (!line || filter === 'all' || filter === 'smapi') return true;
  if (filter === 'error') return /ERROR|FATAL|Exception/i.test(line);
  if (filter === 'mod') {
    return /\[\d{2}:\d{2}:\d{2}\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+(?!SMAPI\b|game\b)([^\]]+)\]/i.test(line);
  }
  if (filter === 'server') {
    return /Starting LAN server|Starting server\. Protocol|ServerOfflineMode|Multiplayer|Connection|joined the game|left the game|farmhand|player connected|player disconnected|peer .* joined|peer .* left|client .* connected|client .* disconnected/i.test(line);
  }
  if (filter === 'game') {
    return /\[\d{2}:\d{2}:\d{2}\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+game\]/i.test(line) &&
      !matchesFilter('server', line);
  }
  return true;
}

function parseLogLevel(line) {
  if (/\bERROR\b/i.test(line)) return 'error';
  if (/\bWARN\b/i.test(line)) return 'warn';
  if (/\bDEBUG\b/i.test(line)) return 'debug';
  return 'info';
}

// ─── HTTP Handler ────────────────────────────────────────────────

function getLogs(req, res) {
  const filter = req.query.type || 'all';
  const lines = parseInt(req.query.lines || '200', 10);
  const search = req.query.search || '';

  const source = getLogSource(filter);
  const logPath = source.path;

  if (!fs.existsSync(logPath)) {
    return res.json({ lines: [], total: 0, file: logPath, exists: false });
  }

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    let allLines = content.split('\n').filter(l => l.trim());

    if (source.filtered) {
      allLines = allLines.filter(line => matchesFilter(filter, line));
    }

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      allLines = allLines.filter(l => l.toLowerCase().includes(searchLower));
    }

    // Get last N lines
    const result = allLines.slice(-lines).map(line => ({
      text: line,
      level: parseLogLevel(line),
    }));

    res.json({
      lines: result,
      total: allLines.length,
      file: path.basename(logPath),
      exists: true,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read log file', details: config.sanitizeErrorMessage(e.message) });
  }
}

// ─── WebSocket Log Streaming ─────────────────────────────────────

function subscribeLogs(ws, filter) {
  const source = getLogSource(filter);
  const logPath = source.path;

  // Close existing watcher
  if (ws._logWatcher) {
    ws._logWatcher.close();
    ws._logWatcher = null;
  }

  if (!fs.existsSync(logPath)) {
    ws.send(JSON.stringify({
      type: 'log',
      line: { text: `Log file not found: ${path.basename(logPath)}`, level: 'warn' },
    }));
    return;
  }

  // Get current file size to only send new lines
  let fileSize = 0;
  try {
    fileSize = fs.statSync(logPath).size;
  } catch (e) {}

  // Watch for changes
  const watcher = fs.watch(logPath, (eventType) => {
    if (eventType !== 'change') return;

    try {
      const stat = fs.statSync(logPath);
      if (stat.size <= fileSize) {
        // File was truncated, reset
        fileSize = 0;
      }

      // Read new content
      const stream = fs.createReadStream(logPath, {
        start: fileSize,
        encoding: 'utf-8',
      });

      let newData = '';
      stream.on('data', (chunk) => { newData += chunk; });
      stream.on('end', () => {
        fileSize = stat.size;
        const lines = newData.split('\n').filter(l => l.trim());
        for (const line of lines) {
          if (source.filtered && !matchesFilter(filter, line)) {
            continue;
          }
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'log',
              line: { text: line, level: parseLogLevel(line) },
            }));
          }
        }
      });
    } catch (e) {
      // File may have been deleted/rotated
    }
  });

  ws._logWatcher = watcher;

  ws.send(JSON.stringify({
    type: 'log:subscribed',
    filter,
    file: path.basename(logPath),
  }));
}

module.exports = { getLogs, subscribeLogs };
