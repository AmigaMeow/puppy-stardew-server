/**
 * Authentication module
 * Handles login, JWT tokens, password management
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── State ───────────────────────────────────────────────────────
let panelConfig = null;
let configPath = '';

// Login rate limiting
const loginAttempts = new Map(); // ip -> { count, lastAttempt }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function normalizeConfig(config) {
  if (!config || typeof config !== 'object') {
    return { config: null, changed: false };
  }

  let changed = false;
  const normalized = { ...config };

  if (!normalized.jwtSecret) {
    normalized.jwtSecret = crypto.randomBytes(32).toString('hex');
    changed = true;
  }

  if (!Object.prototype.hasOwnProperty.call(normalized, 'passwordHash')) {
    normalized.passwordHash = null;
    changed = true;
  }

  if (!Object.prototype.hasOwnProperty.call(normalized, 'needsSetup')) {
    normalized.needsSetup = !normalized.passwordHash;
    changed = true;
  }

  if (normalized.needsSetup && normalized.passwordHash) {
    normalized.needsSetup = false;
    changed = true;
  }

  return { config: normalized, changed };
}

// ─── Initialize ──────────────────────────────────────────────────
async function initialize(dataDir) {
  configPath = path.join(dataDir, 'panel.json');

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Load or create config
  if (fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const { config: normalized, changed } = normalizeConfig(parsed);
      panelConfig = normalized;
      if (changed && panelConfig) {
        saveConfig();
      }
      console.log('[Auth] Loaded existing panel configuration');
    } catch (e) {
      console.error('[Auth] Failed to parse panel.json, recreating...');
      panelConfig = null;
    }
  }

  if (!panelConfig) {
    // First run - require explicit setup instead of bootstrapping a default password
    panelConfig = {
      passwordHash: null,
      jwtSecret: crypto.randomBytes(32).toString('hex'),
      needsSetup: true,
      createdAt: new Date().toISOString(),
    };
    saveConfig();
    console.log('[Auth] Created new panel configuration');
  }
}

function saveConfig() {
  if (!panelConfig) return;
  fs.writeFileSync(configPath, JSON.stringify(panelConfig, null, 2), 'utf-8');
}

// ─── Rate Limiting ───────────────────────────────────────────────
function checkRateLimit(ip) {
  const attempt = loginAttempts.get(ip);
  if (!attempt) return true;

  if (attempt.count >= MAX_ATTEMPTS) {
    const elapsed = Date.now() - attempt.lastAttempt;
    if (elapsed < LOCKOUT_MINUTES * 60 * 1000) {
      return false; // Still locked out
    }
    // Lockout expired, reset
    loginAttempts.delete(ip);
    return true;
  }
  return true;
}

function recordFailedLogin(ip) {
  const attempt = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
  attempt.count += 1;
  attempt.lastAttempt = Date.now();
  loginAttempts.set(ip, attempt);
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

// ─── JWT ─────────────────────────────────────────────────────────
function signToken() {
  return jwt.sign(
    { role: 'admin', iat: Math.floor(Date.now() / 1000) },
    panelConfig.jwtSecret,
    { expiresIn: '24h' }
  );
}

function verifyToken(token) {
  if (!panelConfig || !panelConfig.jwtSecret) {
    return false;
  }
  try {
    jwt.verify(token, panelConfig.jwtSecret);
    return true;
  } catch (e) {
    return false;
  }
}

function signDownloadToken(filename) {
  return jwt.sign(
    { purpose: 'download', filename, iat: Math.floor(Date.now() / 1000) },
    panelConfig.jwtSecret,
    { expiresIn: '60s' }
  );
}

function verifyDownloadToken(token, filename) {
  if (!panelConfig || !panelConfig.jwtSecret) {
    return false;
  }
  try {
    const payload = jwt.verify(token, panelConfig.jwtSecret);
    return payload.purpose === 'download' && payload.filename === filename;
  } catch (e) {
    return false;
  }
}

// ─── Route Handlers ──────────────────────────────────────────────

/**
 * GET /api/auth/status
 * Public setup status
 */
function getStatus(req, res) {
  res.json({ needsSetup: !!(panelConfig && panelConfig.needsSetup) });
}

/**
 * POST /api/auth/setup
 * Body: { password, confirmPassword }
 */
async function setup(req, res) {
  if (!(panelConfig && panelConfig.needsSetup)) {
    return res.status(403).json({ error: 'Setup already completed' });
  }

  // Rate limit setup attempts (same rules as login)
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    const attempt = loginAttempts.get(ip);
    const remainingMs = LOCKOUT_MINUTES * 60 * 1000 - (Date.now() - attempt.lastAttempt);
    const remainingMin = Math.ceil(remainingMs / 60000);
    return res.status(429).json({
      error: `Too many attempts. Try again in ${remainingMin} minutes.`,
      locked: true,
      retryAfter: remainingMin,
    });
  }

  const { password, confirmPassword } = req.body || {};

  if (!password || !confirmPassword) {
    return res.status(400).json({ error: 'Password and confirmation are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  panelConfig.passwordHash = await bcrypt.hash(password, 12);
  panelConfig.needsSetup = false;
  panelConfig.setupCompletedAt = new Date().toISOString();
  saveConfig();

  res.json({
    success: true,
    token: signToken(),
    expiresIn: '24h',
  });
}

/**
 * POST /api/auth/login
 * Body: { password }
 */
async function login(req, res) {
  const ip = req.ip || req.connection.remoteAddress;

  if (panelConfig && panelConfig.needsSetup) {
    return res.status(403).json({ error: 'Setup required', needsSetup: true });
  }

  // Check rate limit
  if (!checkRateLimit(ip)) {
    const attempt = loginAttempts.get(ip);
    const remainingMs = LOCKOUT_MINUTES * 60 * 1000 - (Date.now() - attempt.lastAttempt);
    const remainingMin = Math.ceil(remainingMs / 60000);
    return res.status(429).json({
      error: `Too many login attempts. Try again in ${remainingMin} minutes.`,
      locked: true,
      retryAfter: remainingMin,
    });
  }

  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  if (!panelConfig.passwordHash) {
    return res.status(500).json({ error: 'Server configuration error: no password set' });
  }

  const valid = await bcrypt.compare(password, panelConfig.passwordHash);
  if (!valid) {
    recordFailedLogin(ip);
    const attempt = loginAttempts.get(ip);
    const remaining = MAX_ATTEMPTS - attempt.count;
    return res.status(401).json({
      error: 'Invalid password',
      attemptsRemaining: remaining > 0 ? remaining : 0,
    });
  }

  // Success
  clearLoginAttempts(ip);
  const token = signToken();

  res.json({
    token,
    expiresIn: '24h',
  });
}

/**
 * GET /api/auth/verify
 * Verify if current token is valid
 */
function verify(req, res) {
  res.json({ valid: true });
}

/**
 * POST /api/auth/password
 * Body: { oldPassword, newPassword }
 */
async function changePassword(req, res) {
  if (panelConfig && panelConfig.needsSetup) {
    return res.status(403).json({ error: 'Setup required', needsSetup: true });
  }

  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Old and new passwords are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  if (!panelConfig.passwordHash) {
    return res.status(500).json({ error: 'Server configuration error: no password set' });
  }

  const valid = await bcrypt.compare(oldPassword, panelConfig.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  // Update password
  panelConfig.passwordHash = await bcrypt.hash(newPassword, 12);
  panelConfig.passwordChangedAt = new Date().toISOString();
  saveConfig();

  // Sign new token (invalidate old ones by changing secret would be too aggressive)
  const token = signToken();

  res.json({
    success: true,
    message: 'Password changed successfully',
    token,
  });
}

/**
 * Express middleware to verify JWT (header only — tokens in query strings are not accepted)
 */
function verifyMiddleware(req, res, next) {
  if (!panelConfig || !panelConfig.jwtSecret) {
    return res.status(401).json({ error: 'Server not initialized' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.slice(7);
  try {
    jwt.verify(token, panelConfig.jwtSecret);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = {
  initialize,
  getStatus,
  setup,
  login,
  verify,
  changePassword,
  verifyMiddleware,
  verifyToken,
  signDownloadToken,
  verifyDownloadToken,
};
