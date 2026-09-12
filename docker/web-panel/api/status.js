/**
 * Status API - Server status and metrics
 */

const fs = require('fs');
const { execSync, execFileSync, spawnSync } = require('child_process');
const http = require('http');
const https = require('https');
const config = require('../server');

// Status history (in-memory, last 1 hour, every 15s = 240 entries)
const statusHistory = [];
const MAX_HISTORY = 240;

// WebSocket subscribers
const statusSubscribers = new Set();

// Cache
let cachedStatus = null;
let cacheTime = 0;
const CACHE_TTL = 3000; // 3 seconds

function readRecentLogLines(limit = 400) {
  try {
    if (!fs.existsSync(config.SMAPI_LOG)) {
      return [];
    }

    return fs.readFileSync(config.SMAPI_LOG, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit);
  } catch (error) {
    return [];
  }
}

function extractLogHints() {
  const lines = readRecentLogLines(500);
  let day = '';
  const connectedPlayers = new Set();
  let paused = false;

  function addPlayer(id) {
    if (id && id !== 'Server' && id !== 'SMAPI') {
      connectedPlayers.add(id);
    }
  }

  function removePlayer(id) {
    if (id) {
      connectedPlayers.delete(id);
    }
  }

  for (const line of lines) {
    const contextMatch = line.match(/Context:\s+loaded save '.*?', starting ([a-z]+ \d+ Y\d+)/i);
    if (contextMatch) {
      day = contextMatch[1];
    }

    const seasonMatch = line.match(/Season:\s*([a-z]+, Day \d+, Year \d+)/i);
    if (seasonMatch) {
      day = seasonMatch[1];
    }

    if (/Disconnected:\s*ServerOfflineMode/i.test(line)) {
      paused = true;
      connectedPlayers.clear();
    }

    if (/Starting LAN server|Starting server\. Protocol/i.test(line)) {
      paused = false;
    }

    let match = line.match(/Received connection for vanilla player ([A-Za-z0-9_]+)/i) ||
      line.match(/Approved request for farmhand ([A-Za-z0-9_]+)/i) ||
      line.match(/([A-Za-z0-9_]+) joined the game/i) ||
      line.match(/farmhand ([A-Za-z0-9_]+) connected/i) ||
      line.match(/client ([A-Za-z0-9_]+) connected/i) ||
      line.match(/peer ([A-Za-z0-9_]+) joined/i) ||
      line.match(/([A-Za-z0-9_]+) connected/i);
    if (match) {
      addPlayer(match[1]);
      paused = false;
      continue;
    }

    match = line.match(/([A-Za-z0-9_]+) left the game/i) ||
      line.match(/farmhand ([A-Za-z0-9_]+) disconnected/i) ||
      line.match(/client ([A-Za-z0-9_]+) disconnected/i) ||
      line.match(/peer ([A-Za-z0-9_]+) left/i) ||
      line.match(/connection ([A-Za-z0-9_]+) disconnected/i) ||
      line.match(/player ([A-Za-z0-9_]+) disconnected/i) ||
      line.match(/([A-Za-z0-9_]+) disconnected/i);
    if (match) {
      removePlayer(match[1]);
      if (connectedPlayers.size === 0) {
        paused = true;
      }
    }
  }

  return { day, players: connectedPlayers.size, paused };
}

function normalizeJoinHost(host) {
  if (!host) return '';

  const firstHost = host.split(',')[0].trim();
  const match = firstHost.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (match) {
    return match[1];
  }

  return firstHost.replace(/:\d+$/, '');
}

function getNetworkInfo(requestHost = '') {
  const configuredPublicIp = process.env.PUBLIC_IP || process.env.SERVER_IP || '';
  let localIps = [];

  try {
    localIps = execSync('hostname -I 2>/dev/null', { encoding: 'utf-8' })
      .trim()
      .split(/\s+/)
      .filter(ip => ip && ip !== '127.0.0.1' && ip !== '::1');
  } catch (error) {}

  const hostFromRequest = normalizeJoinHost(requestHost);
  const derivedJoinIp = hostFromRequest && hostFromRequest !== 'localhost' && hostFromRequest !== '127.0.0.1'
    ? hostFromRequest
    : '';

  return {
    joinIp: configuredPublicIp || derivedJoinIp || localIps[0] || '',
    localIps,
    joinPort: 24642,
    metricsPort: parseInt(process.env.METRICS_PORT || '9090', 10),
  };
}

function collectStatus(req = null) {
  const now = Date.now();
  if (cachedStatus && now - cacheTime < CACHE_TTL) {
    return cachedStatus;
  }

  const requestHost = (req && req.headers && (req.headers['x-forwarded-host'] || req.headers['host'])) || '';

  const status = {
    timestamp: new Date().toISOString(),
    gameRunning: false,
    uptime: 0,
    players: { online: 0, max: 4 },
    cpu: 0,
    memory: { used: 0, limit: 2048 },
    day: 'Unknown',
    season: 'Unknown',
    backupCount: 0,
    modCount: 0,
    version: 'v1.1.0',
    scriptsHealthy: false,
    paused: false,
    events: {
      passout: 0,
      readycheck: 0,
      offline: 0,
    },
    network: getNetworkInfo(requestHost),
  };

  // Read status.json from status-reporter.sh
  // The JSON has nested structure: { server: { game_running, uptime_seconds }, game: { day, players_online }, resources: { memory_mb, cpu_percent } }
  try {
    if (fs.existsSync(config.STATUS_FILE)) {
      const data = JSON.parse(fs.readFileSync(config.STATUS_FILE, 'utf-8'));
      // Support nested structure from status-reporter.sh
      if (data.server) {
        status.gameRunning = data.server.game_running === true || data.server.game_running === 1;
        status.uptime = data.server.uptime_seconds || 0;
      }
      if (data.game) {
        status.players.online = data.game.players_online || 0;
        if (data.game.day) status.day = data.game.day;
        if (typeof data.game.paused === 'boolean') status.paused = data.game.paused;
      }
      if (data.resources) {
        status.cpu = parseFloat(data.resources.cpu_percent) || 0;
        status.memory.used = data.resources.memory_mb || 0;
      }
      if (data.events) {
        status.events.passout = data.events.passout || 0;
        status.events.readycheck = data.events.readycheck || 0;
        status.events.offline = data.events.offline || 0;
      }
      if (typeof data.scripts_healthy === 'boolean') {
        status.scriptsHealthy = data.scripts_healthy;
      }
      // Also support flat structure for backward compatibility
      if (!data.server && !data.game && !data.resources) {
        status.gameRunning = data.server_status === 'running' || data.game_running === 1;
        status.uptime = data.uptime_seconds || 0;
        status.players.online = data.players_online || 0;
        status.cpu = data.cpu_usage_percent || 0;
        status.memory.used = data.memory_usage_mb || 0;
        if (data.game_day) status.day = data.game_day;
        if (data.season) status.season = data.season;
        if (typeof data.paused === 'boolean') status.paused = data.paused;
        status.events.passout = data.passout || 0;
        status.events.readycheck = data.readycheck || 0;
        status.events.offline = data.offline || 0;
        if (typeof data.scripts_healthy === 'boolean') {
          status.scriptsHealthy = data.scripts_healthy;
        }
      }
    }
  } catch (e) {
    // status.json may not exist yet
  }

  // Check if game process is running (and collect live metrics if no status.json)
  try {
    const pidStr = execFileSync('pgrep', ['-f', 'StardewModdingAPI'], { encoding: 'utf-8' }).trim().split('\n')[0];
    status.gameRunning = true;

    // Only use pgrep output in file/command access when it is a bare numeric PID
    const pid = /^\d+$/.test(pidStr) ? pidStr : '';

    // If we didn't get data from status.json, collect live
    if (status.cpu === 0 && status.memory.used === 0 && pid) {
      try {
        const cpuStr = execFileSync('ps', ['-p', pid, '-o', '%cpu='], { encoding: 'utf-8' }).trim();
        status.cpu = parseFloat(cpuStr) || 0;
      } catch (e2) {}
      try {
        const procStatus = fs.readFileSync(`/proc/${pid}/status`, 'utf-8');
        const rssMatch = procStatus.match(/^VmRSS:\s+(\d+)\s+kB$/m);
        if (rssMatch) status.memory.used = Math.round(parseInt(rssMatch[1], 10) / 1024);
      } catch (e2) {}
    }

    // If no uptime from status.json, compute from process start time
    if (status.uptime === 0 && pid) {
      try {
        const startTime = Math.floor(fs.statSync(`/proc/${pid}`).mtimeMs / 1000);
        status.uptime = Math.floor(Date.now() / 1000) - startTime;
      } catch (e2) {}
    }
  } catch (e) {
    // Process not found
  }

  const hints = extractLogHints();
  if ((status.day === 'Unknown' || !status.day) && hints.day) {
    status.day = hints.day;
  }
  if (status.players.online === 0 && hints.players > 0) {
    status.players.online = hints.players;
  }
  if (hints.paused) {
    status.paused = true;
  }

  if (!status.scriptsHealthy) {
    try {
      execSync('pgrep -f "event-handler.sh" >/dev/null 2>&1');
      status.scriptsHealthy = true;
    } catch (error) {}
  }

  // Count backups
  try {
    if (fs.existsSync(config.BACKUPS_DIR)) {
      status.backupCount = fs.readdirSync(config.BACKUPS_DIR)
        .filter(f => f.endsWith('.tar.gz') || f.endsWith('.zip')).length;
    }
  } catch (e) {}

  // Count mods
  try {
    const modsDir = `${config.GAME_DIR}/Mods`;
    if (fs.existsSync(modsDir)) {
      status.modCount = fs.readdirSync(modsDir)
        .filter(f => {
          const manifestPath = `${modsDir}/${f}/manifest.json`;
          return fs.existsSync(manifestPath);
        }).length;
    }
  } catch (e) {}

  // Get system uptime
  try {
    const uptimeStr = execSync('cat /proc/uptime', { encoding: 'utf-8' });
    status.systemUptime = Math.floor(parseFloat(uptimeStr.split(' ')[0]));
  } catch (e) {}

  cachedStatus = status;
  cacheTime = now;

  // Push to history
  statusHistory.push({
    timestamp: status.timestamp,
    cpu: status.cpu,
    memory: status.memory.used,
    players: status.players.online,
  });
  if (statusHistory.length > MAX_HISTORY) {
    statusHistory.shift();
  }

  return status;
}

// Periodically broadcast status to WebSocket subscribers
setInterval(() => {
  if (statusSubscribers.size === 0) return;
  const status = collectStatus();
  const msg = JSON.stringify({ type: 'status', data: status });
  for (const ws of statusSubscribers) {
    if (ws.readyState === 1) {
      ws.send(msg);
    } else {
      statusSubscribers.delete(ws);
    }
  }
}, 5000);

// ─── Route Handlers ──────────────────────────────────────────────

function getStatus(req, res) {
  const status = collectStatus(req);
  res.json(status);
}

function subscribeStatus(ws) {
  statusSubscribers.add(ws);
  // Send current status immediately
  const status = collectStatus();
  ws.send(JSON.stringify({ type: 'status', data: status }));

  ws.on('close', () => statusSubscribers.delete(ws));
}

function restartServer(req, res) {
  try {
    const result = spawnSync('sh', ['-lc', 'pkill -f "StardewModdingAPI|Stardew Valley" >/dev/null 2>&1 || true'], {
      encoding: 'utf-8',
      timeout: 10000,
    });

    if (result.error) {
      throw result.error;
    }

    res.json({ success: true, message: 'Game restart initiated' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to restart server', details: config.sanitizeErrorMessage(e.message) });
  }
}

function restartContainer(req, res) {
  const managerUrl = process.env.MANAGER_URL || '';

  if (managerUrl) {
    scheduleContainerRecreate(managerUrl).then(() => {
      res.json({ success: true, message: 'Container recreate initiated' });
    }).catch((error) => {
      res.status(500).json({ error: 'Failed to recreate container', details: config.sanitizeErrorMessage(error.message) });
    });
    return;
  }

  try {
    const result = spawnSync('sh', ['-lc', '(sleep 1; kill -TERM 1) >/dev/null 2>&1 &'], {
      encoding: 'utf-8',
      timeout: 5000,
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || 'Unable to schedule container restart').trim());
    }

    res.json({ success: true, message: 'Container restart initiated' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to restart container', details: config.sanitizeErrorMessage(e.message) });
  }
}

function scheduleContainerRecreate(managerUrl) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL('/recreate', managerUrl);
    } catch (error) {
      reject(new Error('Invalid manager URL'));
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const payload = JSON.stringify({ service: 'stardew-server' });

    const request = client.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(process.env.MANAGER_SECRET ? { 'Authorization': `Bearer ${process.env.MANAGER_SECRET}` } : {}),
      },
      timeout: 5000,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
          return;
        }

        reject(new Error(body || `Manager returned HTTP ${response.statusCode}`));
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('Manager request timed out'));
    });

    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

module.exports = { getStatus, subscribeStatus, restartServer, restartContainer };
