const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.MANAGER_PORT || '18700', 10);
const PROJECT_DIR = process.env.PROJECT_DIR || '/workspace';
const COMPOSE_FILE = process.env.COMPOSE_FILE || `${PROJECT_DIR}/docker-compose.yml`;
const DEFAULT_ENV_FILE = `${PROJECT_DIR}/.env`;
const RUNTIME_ENV_FILE = `${PROJECT_DIR}/data/panel/runtime.env`;
const MANAGER_SECRET = process.env.MANAGER_SECRET || '';
const ALLOWED_SERVICES = new Set(['stardew-server']);
const SERVICE_CONTAINERS = {
  'stardew-server': 'puppy-stardew',
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function recreateService(service) {
  const env = buildComposeEnv();
  const containerName = SERVICE_CONTAINERS[service];
  const command = [
    containerName ? `docker rm -f ${containerName} >/dev/null 2>&1 || true` : '',
    `docker compose -f ${COMPOSE_FILE} --project-directory ${PROJECT_DIR} up -d --no-deps ${service}`,
  ].filter(Boolean).join(' && ');

  const child = spawn('sh', ['-lc', command], {
    cwd: PROJECT_DIR,
    env,
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
}

function parseEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const env = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const index = trimmed.indexOf('=');
      if (index === -1) {
        continue;
      }
      env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
    }
    return env;
  } catch (error) {
    return {};
  }
}

function buildComposeEnv() {
  return {
    ...process.env,
    ...parseEnvFile(DEFAULT_ENV_FILE),
    ...parseEnvFile(RUNTIME_ENV_FILE),
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (MANAGER_SECRET) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const a = Buffer.from(token);
    const b = Buffer.from(MANAGER_SECRET);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
  }

  if (req.method === 'POST' && req.url === '/recreate') {
    try {
      const body = await readJson(req);
      const service = body && body.service ? String(body.service) : 'stardew-server';

      if (!ALLOWED_SERVICES.has(service)) {
        sendJson(res, 400, { error: 'Unsupported service' });
        return;
      }

      recreateService(service);
      sendJson(res, 202, { success: true, service, action: 'recreate' });
    } catch (error) {
      var msg = error.message || 'Failed to schedule recreate';
      sendJson(res, 500, { error: msg.replace(/\/(?:home|proc|tmp|var|etc|opt|usr)\b\S*/g, '<path>') });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Manager] Listening on http://0.0.0.0:${PORT}`);
});
