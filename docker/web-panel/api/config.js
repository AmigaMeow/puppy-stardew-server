/**
 * Config API - Environment configuration management
 */

const fs = require('fs');
const path = require('path');
const config = require('../server');

// Config field definitions with metadata
const CONFIG_SCHEMA = {
  'Steam': [
    { key: 'STEAM_USERNAME', label: 'Steam Username', type: 'text', sensitive: false, readonly: false, descriptionKey: 'config.help.STEAM_USERNAME' },
    { key: 'STEAM_PASSWORD', label: 'Steam Password', type: 'password', sensitive: true, readonly: false, preserveIfBlank: true, descriptionKey: 'config.help.STEAM_PASSWORD' },
  ],
  'VNC': [
    { key: 'ENABLE_VNC', label: 'Enable VNC', type: 'boolean', default: 'true' },
    { key: 'VNC_PASSWORD', label: 'VNC Password', type: 'password', viewable: true, default: 'stardew1', maxLength: 8 },
  ],
  'Display': [
    { key: 'RESOLUTION_WIDTH', label: 'Resolution Width', type: 'number', default: '1280' },
    { key: 'RESOLUTION_HEIGHT', label: 'Resolution Height', type: 'number', default: '720' },
    { key: 'REFRESH_RATE', label: 'Refresh Rate', type: 'number', default: '60' },
    { key: 'USE_GPU', label: 'Use GPU', type: 'boolean', default: 'false' },
  ],
  'Performance': [
    { key: 'LOW_PERF_MODE', label: 'Low Performance Mode', type: 'boolean', default: 'false' },
    { key: 'TARGET_FPS', label: 'Target FPS', type: 'number', default: '' },
  ],
  'Backup': [
    { key: 'ENABLE_AUTO_BACKUP', label: 'Auto Backup', type: 'boolean', default: 'false' },
    { key: 'MAX_BACKUPS', label: 'Max Backups', type: 'number', default: '7' },
    { key: 'BACKUP_HOUR', label: 'Backup Hour (0-23)', type: 'number', default: '4', min: 0, max: 23 },
    { key: 'BACKUP_COMPRESSION_LEVEL', label: 'Backup Compression Level', type: 'number', default: '1', min: 1, max: 9, descriptionKey: 'config.help.BACKUP_COMPRESSION_LEVEL' },
  ],
  'Stability': [
    { key: 'ENABLE_CRASH_RESTART', label: 'Auto Crash Restart', type: 'boolean', default: 'false' },
    { key: 'MAX_CRASH_RESTARTS', label: 'Max Restarts', type: 'number', default: '5' },
  ],
  'Monitoring': [
    { key: 'ENABLE_LOG_MONITOR', label: 'Log Monitor', type: 'boolean', default: 'true' },
    { key: 'METRICS_PORT', label: 'Metrics Port', type: 'number', default: '9090' },
  ],
  'Game': [
    { key: 'SAVE_NAME', label: 'Save Name', type: 'text', default: '', descriptionKey: 'config.help.SAVE_NAME' },
    { key: 'PUBLIC_IP', label: 'Public Join IP', type: 'text', default: '', descriptionKey: 'config.help.PUBLIC_IP' },
  ],
  'Other': [
    { key: 'TZ', label: 'Timezone', type: 'text', default: 'UTC' },
  ],
};

function detectCurrentSaveName() {
  try {
    const markerPath = path.join(config.SAVES_DIR, '.selected_save');
    if (fs.existsSync(markerPath)) {
      const selected = fs.readFileSync(markerPath, 'utf-8').trim();
      if (selected && fs.existsSync(path.join(config.SAVES_DIR, selected))) {
        return selected;
      }
    }

    if (!fs.existsSync(config.SAVES_DIR)) {
      return '';
    }

    const candidates = fs.readdirSync(config.SAVES_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => {
        const saveDir = path.join(config.SAVES_DIR, entry.name);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(saveDir).mtimeMs;
        } catch (error) {}
        return { name: entry.name, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return candidates.length > 0 ? candidates[0].name : '';
  } catch (error) {
    return '';
  }
}

function listAvailableSaves() {
  try {
    if (!fs.existsSync(config.SAVES_DIR)) {
      return [];
    }

    return fs.readdirSync(config.SAVES_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    return [];
  }
}

function parseEnvFile() {
  const env = {};

  const candidates = [
    config.ENV_FILE,
    '/home/steam/.env',
    path.join(process.cwd(), '.env'),
  ];

  for (const envPath of candidates) {
    if (!envPath || !fs.existsSync(envPath)) continue;

    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      env[key] = value;
    }
  }

  return env;
}

function hasDockerSecret(name) {
  try {
    return fs.existsSync(path.join('/run/secrets', name));
  } catch (error) {
    return false;
  }
}

function isSecretsManaged(fieldKey) {
  if (fieldKey === 'STEAM_USERNAME') {
    return hasDockerSecret('steam_username');
  }

  if (fieldKey === 'STEAM_PASSWORD') {
    return hasDockerSecret('steam_password');
  }

  return false;
}

function findEnvFile() {
  return config.ENV_FILE || '/home/steam/web-panel/data/runtime.env';
}

function writeEnvFile(envData) {
  const envPath = findEnvFile();
  if (!envPath) throw new Error('.env file not found');

  const envDir = path.dirname(envPath);
  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
  }

  if (!fs.existsSync(envPath)) {
    const seed = parseEnvFile();
    const lines = ['# Managed by Puppy Stardew Server web panel', ''];
    for (const [key, value] of Object.entries(seed)) {
      lines.push(`${key}=${value}`);
    }
    fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
  }

  // Read original file to preserve comments and order
  const original = fs.readFileSync(envPath, 'utf-8');
  const lines = original.split('\n');
  const updatedKeys = new Set();

  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return line;

    const key = trimmed.slice(0, eqIndex).trim();
    if (key in envData) {
      updatedKeys.add(key);
      return `${key}=${envData[key]}`;
    }
    return line;
  });

  // Append any new keys not in original file
  for (const [key, value] of Object.entries(envData)) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(envPath, newLines.join('\n'), 'utf-8');
}

// ─── Route Handlers ──────────────────────────────────────────────

function getConfig(req, res) {
  const env = parseEnvFile();
  const groups = [];
  const detectedSaveName = detectCurrentSaveName();
  const availableSaves = listAvailableSaves();

  for (const [groupName, fields] of Object.entries(CONFIG_SCHEMA)) {
    const items = fields.map(field => {
      const secretManaged = isSecretsManaged(field.key);
      // Try .env file first, then process.env, then default
      let value = env[field.key] || process.env[field.key] || field.default || '';

      if (!value && field.key === 'SAVE_NAME') {
        value = detectedSaveName;
      }

      let options;
      if (field.key === 'SAVE_NAME' && availableSaves.length > 0) {
        options = [''].concat(availableSaves);
        if (value && options.indexOf(value) === -1) {
          options.push(value);
        }
      }

      // Mask sensitive fields (e.g. STEAM_PASSWORD) but NOT viewable fields (e.g. VNC_PASSWORD)
      if (field.sensitive && !field.viewable && value) {
        value = '••••••••';
      }

      return {
        ...field,
        readonly: field.readonly || secretManaged,
        value: (field.sensitive && !field.viewable) ? undefined : value,
        hasValue: !!(env[field.key] || process.env[field.key]),
        secretManaged,
        options,
      };
    });

    groups.push({ name: groupName, items });
  }

  res.json({ groups });
}

function updateConfig(req, res) {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const fieldMap = new Map();
    for (const fields of Object.values(CONFIG_SCHEMA)) {
      for (const field of fields) {
        fieldMap.set(field.key, field);
      }
    }

    for (const key of Object.keys(updates)) {
      const field = fieldMap.get(key);
      if (!field) {
        continue;
      }

      if (field.readonly || isSecretsManaged(key)) {
        return res.status(400).json({ error: `Field '${key}' is read-only` });
      }
    }

    const normalizedUpdates = { ...updates };
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'ENABLE_VNC')) {
      normalizedUpdates.VNC_BIND_HOST = normalizedUpdates.ENABLE_VNC === 'true' ? '0.0.0.0' : '127.0.0.1';
    }

    for (const [key, field] of fieldMap.entries()) {
      if (!Object.prototype.hasOwnProperty.call(normalizedUpdates, key)) {
        continue;
      }

      if (field.preserveIfBlank && normalizedUpdates[key] === '') {
        delete normalizedUpdates[key];
      }
    }

    writeEnvFile(normalizedUpdates);
    res.json({
      success: true,
      message: 'Configuration updated. Recreate the container to apply these changes.',
      needsRestart: true,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update config', details: config.sanitizeErrorMessage(e.message) });
  }
}

module.exports = { getConfig, updateConfig };
