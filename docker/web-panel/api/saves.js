/**
 * Saves API - Save file and backup management
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const config = require('../server');

const BACKUP_STATUS_FILE = path.join(config.DATA_DIR, 'backup-status.json');
let activeBackup = null;

function isSuccessful(result) {
  return result && result.status === 0;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    ...options,
  });

  if (!isSuccessful(result)) {
    const reason = result.error ? result.error.message : (result.stderr || result.stdout || 'unknown error').trim();
    throw new Error(`${command} failed: ${reason}`);
  }

  return result.stdout || '';
}

function removePath(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  runCommand('rm', ['-rf', targetPath]);
}

function getBackupCompressionLevel() {
  const raw = parseInt(process.env.BACKUP_COMPRESSION_LEVEL || '1', 10);
  if (Number.isNaN(raw)) {
    return 1;
  }

  return Math.min(9, Math.max(1, raw));
}

function getTarGzipArgs(outputPath, sourceBaseDir, sourceNames, verbose) {
  const level = getBackupCompressionLevel();
  const args = ['-I', `gzip -${level}`];

  if (verbose) {
    args.push('-cvf');
  } else {
    args.push('-cf');
  }

  args.push(outputPath, '-C', sourceBaseDir);
  return args.concat(sourceNames);
}

function parseEnvFile() {
  const envPath = findEnvFile();
  if (!envPath || !fs.existsSync(envPath)) return {};

  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

function findEnvFile() {
  const candidates = [
    config.ENV_FILE,
    '/home/steam/.env',
    path.join(process.cwd(), '.env'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return config.ENV_FILE || '/home/steam/.env';
}

function writeEnvFile(envData) {
  const envPath = findEnvFile();
  const envDir = path.dirname(envPath);

  ensureDir(envDir);

  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, '# Managed by Puppy Stardew Server web panel\n', 'utf-8');
  }

  const original = fs.readFileSync(envPath, 'utf-8');
  const lines = original.split('\n');
  const updatedKeys = new Set();

  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return line;

    const key = trimmed.slice(0, eqIndex).trim();
    if (Object.prototype.hasOwnProperty.call(envData, key)) {
      updatedKeys.add(key);
      return `${key}=${envData[key]}`;
    }

    return line;
  });

  Object.keys(envData).forEach(key => {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${envData[key]}`);
    }
  });

  fs.writeFileSync(envPath, newLines.join('\n'), 'utf-8');
}

function getSelectedSaveName() {
  try {
    const markerPath = path.join(config.SAVES_DIR, '.selected_save');
    if (fs.existsSync(markerPath)) {
      const selected = fs.readFileSync(markerPath, 'utf-8').trim();
      if (selected) {
        return selected;
      }
    }
  } catch (error) {}

  try {
    const env = parseEnvFile();
    if (env.SAVE_NAME) {
      return env.SAVE_NAME;
    }
  } catch (error) {}

  return '';
}

function setSelectedSaveName(saveName) {
  if (!saveName) {
    throw new Error('Save name is required');
  }

  ensureDir(config.SAVES_DIR);

  const saveDir = path.join(config.SAVES_DIR, saveName);
  if (!fs.existsSync(saveDir)) {
    throw new Error('Selected save does not exist');
  }

  writeEnvFile({ SAVE_NAME: saveName });
  fs.writeFileSync(path.join(config.SAVES_DIR, '.selected_save'), `${saveName}\n`, 'utf-8');
}

function isValidSaveDirectory(saveDir) {
  if (!fs.existsSync(saveDir)) {
    return false;
  }

  const folderName = path.basename(saveDir);
  return fs.existsSync(path.join(saveDir, 'SaveGameInfo')) &&
    fs.existsSync(path.join(saveDir, folderName));
}

function findSaveDirectories(rootDir, maxDepth = 4, depth = 0) {
  if (depth > maxDepth || !fs.existsSync(rootDir)) {
    return [];
  }

  if (isValidSaveDirectory(rootDir)) {
    return [rootDir];
  }

  const found = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }

    found.push(...findSaveDirectories(path.join(rootDir, entry.name), maxDepth, depth + 1));
  }

  return found;
}

function createOverwriteBackup(saveNames) {
  if (!saveNames || saveNames.length === 0) {
    return '';
  }

  ensureDir(config.BACKUPS_DIR);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupName = `pre-upload-overwrite-${timestamp}.tar.gz`;
  const backupPath = path.join(config.BACKUPS_DIR, backupName);
  const existingNames = saveNames.filter(name => fs.existsSync(path.join(config.SAVES_DIR, name)));

  if (existingNames.length === 0) {
    return '';
  }

  runCommand('tar', getTarGzipArgs(backupPath, config.SAVES_DIR, existingNames, false), {
    timeout: 30000,
  });

  return backupName;
}

function installSaveArchive(zipPath, setAsDefault) {
  ensureDir(config.SAVES_DIR);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'puppy-save-'));
  try {
    runCommand('unzip', ['-q', '-o', zipPath, '-d', tempRoot], { timeout: 30000 });

    const saveDirs = findSaveDirectories(tempRoot);
    if (saveDirs.length === 0) {
      throw new Error('No valid Stardew Valley save folders were found in the archive');
    }

    const importedSaves = [];
    const overwrittenSaves = [];
    const collidingNames = [];

    saveDirs.forEach(saveDir => {
      const saveName = path.basename(saveDir);
      if (fs.existsSync(path.join(config.SAVES_DIR, saveName))) {
        collidingNames.push(saveName);
      }
    });

    const overwriteBackup = createOverwriteBackup(collidingNames);

    saveDirs.forEach(saveDir => {
      const saveName = path.basename(saveDir);
      const destDir = path.join(config.SAVES_DIR, saveName);

      if (fs.existsSync(destDir)) {
        overwrittenSaves.push(saveName);
        removePath(destDir);
      }

      runCommand('cp', ['-a', saveDir, destDir], { timeout: 30000 });
      importedSaves.push(saveName);
    });

    let defaultSaveName = '';
    let defaultApplied = false;
    let defaultSkipped = false;

    if (setAsDefault && importedSaves.length === 1) {
      defaultSaveName = importedSaves[0];
      setSelectedSaveName(defaultSaveName);
      defaultApplied = true;
    } else if (setAsDefault) {
      defaultSkipped = true;
    }

    return {
      importedSaves,
      overwrittenSaves,
      overwriteBackup,
      defaultSaveName,
      defaultApplied,
      defaultSkipped,
    };
  } finally {
    removePath(tempRoot);
  }
}

function createEmptyStatus() {
  return {
    id: null,
    state: 'idle',
    progress: 0,
    processedEntries: 0,
    totalEntries: 0,
    backupName: '',
    backupPath: '',
    startedAt: null,
    completedAt: null,
    message: '',
    error: '',
    pid: null,
    size: 0,
  };
}

function readBackupStatus() {
  try {
    if (!fs.existsSync(BACKUP_STATUS_FILE)) {
      return createEmptyStatus();
    }

    const data = JSON.parse(fs.readFileSync(BACKUP_STATUS_FILE, 'utf-8'));
    return { ...createEmptyStatus(), ...data };
  } catch (error) {
    return createEmptyStatus();
  }
}

function writeBackupStatus(status) {
  ensureDir(config.DATA_DIR);
  fs.writeFileSync(BACKUP_STATUS_FILE, JSON.stringify({
    ...createEmptyStatus(),
    ...status,
  }, null, 2));
}

function isProcessRunning(pid) {
  if (!pid || Number.isNaN(Number(pid))) {
    return false;
  }

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return false;
  }
}

function countEntries(rootDir) {
  let total = 0;

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      total += 1;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      }
    }
  }

  if (fs.existsSync(rootDir)) {
    walk(rootDir);
  }

  return total;
}

function cleanupOldBackups() {
  const maxBackups = parseInt(process.env.MAX_BACKUPS || '7', 10);
  if (!maxBackups || maxBackups < 1 || !fs.existsSync(config.BACKUPS_DIR)) {
    return;
  }

  const backupFiles = fs.readdirSync(config.BACKUPS_DIR)
    .filter(file => file.endsWith('.tar.gz') || file.endsWith('.zip'))
    .map(file => {
      const fullPath = path.join(config.BACKUPS_DIR, file);
      return {
        file,
        fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  backupFiles.slice(maxBackups).forEach(item => {
    try {
      fs.unlinkSync(item.fullPath);
    } catch (error) {}
  });
}

function getBackupStatusSnapshot() {
  const status = readBackupStatus();

  if (status.state === 'running' && status.pid && !isProcessRunning(status.pid)) {
    if (status.backupPath && fs.existsSync(status.backupPath)) {
      const stat = fs.statSync(status.backupPath);
      const completedStatus = {
        ...status,
        state: 'completed',
        progress: 100,
        completedAt: status.completedAt || new Date().toISOString(),
        message: status.message || 'Backup completed',
        size: stat.size,
        pid: null,
        error: '',
      };
      writeBackupStatus(completedStatus);
      return completedStatus;
    }

    const failedStatus = {
      ...status,
      state: 'failed',
      progress: status.progress || 0,
      completedAt: new Date().toISOString(),
      message: 'Backup process stopped unexpectedly',
      error: status.error || 'Backup process stopped unexpectedly',
      pid: null,
    };
    writeBackupStatus(failedStatus);
    return failedStatus;
  }

  return status;
}

function startBackupJob() {
  if (!fs.existsSync(config.SAVES_DIR)) {
    throw new Error('Save directory not found');
  }

  ensureDir(config.BACKUPS_DIR);
  ensureDir(config.DATA_DIR);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupName = `manual-backup-${timestamp}.tar.gz`;
  const backupPath = path.join(config.BACKUPS_DIR, backupName);
  const totalEntries = Math.max(1, countEntries(config.SAVES_DIR) + 1);
  const taskId = `backup-${Date.now()}`;

  const initialStatus = {
    id: taskId,
    state: 'running',
    progress: 1,
    processedEntries: 0,
    totalEntries,
    backupName,
    backupPath,
    startedAt: new Date().toISOString(),
    completedAt: null,
    message: 'Preparing backup',
    error: '',
    pid: null,
    size: 0,
  };
  writeBackupStatus(initialStatus);

  const tarProc = spawn('tar', getTarGzipArgs(
    backupPath,
    path.dirname(config.SAVES_DIR),
    [path.basename(config.SAVES_DIR)],
    true
  ), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  activeBackup = { id: taskId, pid: tarProc.pid, backupPath };
  writeBackupStatus({
    ...initialStatus,
    pid: tarProc.pid,
    message: 'Archiving save files',
  });

  let processedEntries = 0;
  let stdoutBuffer = '';
  let stderrOutput = '';
  let lastPersistAt = 0;

  function persistRunningStatus(force) {
    const now = Date.now();
    if (!force && now - lastPersistAt < 250) {
      return;
    }
    lastPersistAt = now;

    writeBackupStatus({
      ...initialStatus,
      pid: tarProc.pid,
      state: 'running',
      processedEntries,
      totalEntries,
      progress: Math.min(99, Math.max(1, Math.round((processedEntries / totalEntries) * 100))),
      message: 'Archiving save files',
    });
  }

  function processStdoutChunk(chunk) {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop();

    for (const line of lines) {
      if (line.trim()) {
        processedEntries += 1;
      }
    }

    persistRunningStatus(false);
  }

  tarProc.stdout.on('data', processStdoutChunk);
  tarProc.stderr.on('data', chunk => {
    stderrOutput += chunk.toString();
    if (stderrOutput.length > 4000) {
      stderrOutput = stderrOutput.slice(-4000);
    }
  });

  tarProc.on('error', error => {
    activeBackup = null;
    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    } catch (unlinkError) {}

    writeBackupStatus({
      ...initialStatus,
      state: 'failed',
      progress: 0,
      completedAt: new Date().toISOString(),
      message: 'Backup failed to start',
      error: error.message,
      pid: null,
    });
  });

  tarProc.on('close', code => {
    if (stdoutBuffer.trim()) {
      processedEntries += 1;
    }

    activeBackup = null;

    if (code === 0 && fs.existsSync(backupPath)) {
      const stat = fs.statSync(backupPath);
      cleanupOldBackups();
      writeBackupStatus({
        ...initialStatus,
        state: 'completed',
        progress: 100,
        processedEntries: totalEntries,
        totalEntries,
        completedAt: new Date().toISOString(),
        message: 'Backup completed',
        pid: null,
        size: stat.size,
        error: '',
      });
      return;
    }

    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    } catch (unlinkError) {}

    writeBackupStatus({
      ...initialStatus,
      state: 'failed',
      progress: Math.min(99, Math.max(0, Math.round((processedEntries / totalEntries) * 100))),
      processedEntries,
      totalEntries,
      completedAt: new Date().toISOString(),
      message: 'Backup failed',
      error: stderrOutput.trim() || `tar exited with code ${code}`,
      pid: null,
    });
  });

  return getBackupStatusSnapshot();
}

function getSaves(req, res) {
  try {
    if (!fs.existsSync(config.SAVES_DIR)) {
      return res.json({ saves: [], defaultSaveName: '' });
    }

    const entries = fs.readdirSync(config.SAVES_DIR, { withFileTypes: true });
    const saves = [];
    const defaultSaveName = getSelectedSaveName();

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const saveDir = path.join(config.SAVES_DIR, entry.name);
      const saveFile = path.join(saveDir, entry.name);

      const info = {
        name: entry.name,
        farm: entry.name.split('_')[0] || entry.name,
        size: 0,
        lastModified: null,
        files: 0,
        isDefault: entry.name === defaultSaveName,
      };

      try {
        if (fs.existsSync(saveFile)) {
          const stat = fs.statSync(saveFile);
          info.size = stat.size;
          info.lastModified = stat.mtime.toISOString();
        }
        info.files = fs.readdirSync(saveDir).length;
      } catch (e) {}

      saves.push(info);
    }

    // Sort by last modified
    saves.sort((a, b) => {
      if (!a.lastModified) return 1;
      if (!b.lastModified) return -1;
      return new Date(b.lastModified) - new Date(a.lastModified);
    });

    res.json({ saves, defaultSaveName });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list saves', details: config.sanitizeErrorMessage(e.message) });
  }
}

function getBackups(req, res) {
  try {
    if (!fs.existsSync(config.BACKUPS_DIR)) {
      return res.json({ backups: [] });
    }

    const files = fs.readdirSync(config.BACKUPS_DIR);
    const backups = files
      .filter(f => f.endsWith('.tar.gz') || f.endsWith('.zip'))
      .map(f => {
        const stat = fs.statSync(path.join(config.BACKUPS_DIR, f));
        return {
          filename: f,
          size: stat.size,
          date: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ backups });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list backups', details: config.sanitizeErrorMessage(e.message) });
  }
}

function getBackupStatus(req, res) {
  try {
    res.json(getBackupStatusSnapshot());
  } catch (e) {
    res.status(500).json({ error: 'Failed to read backup status', details: config.sanitizeErrorMessage(e.message) });
  }
}

function createBackup(req, res) {
  try {
    const currentStatus = getBackupStatusSnapshot();
    if (currentStatus.state === 'running') {
      return res.status(202).json({
        success: true,
        alreadyRunning: true,
        message: 'Backup already in progress',
        status: currentStatus,
      });
    }

    const status = startBackupJob();
    res.status(202).json({
      success: true,
      accepted: true,
      message: 'Backup started',
      status,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create backup', details: config.sanitizeErrorMessage(e.message) });
  }
}

function uploadSave(req, res) {
  try {
    const body = req.body || {};
    let filename = body.filename;
    const data = body.data;
    const setAsDefault = body.setAsDefault === true || body.setAsDefault === 'true';

    if (!filename || !data) {
      return res.status(400).json({ error: 'Missing filename or data' });
    }

    filename = path.basename(filename);
    if (!/\.zip$/i.test(filename)) {
      return res.status(400).json({ error: 'Only .zip save archives are supported' });
    }

    const buffer = Buffer.from(data, 'base64');
    if (!buffer.length) {
      return res.status(400).json({ error: 'Invalid archive data' });
    }
    if (buffer.length > 40 * 1024 * 1024) {
      return res.status(413).json({ error: 'File too large (max 40MB)' });
    }

    const tempZip = path.join(os.tmpdir(), `puppy-save-upload-${Date.now()}.zip`);
    fs.writeFileSync(tempZip, buffer);

    try {
      const result = installSaveArchive(tempZip, setAsDefault);
      const messageParts = [
        result.importedSaves.length === 1
          ? `Imported save ${result.importedSaves[0]}`
          : `Imported ${result.importedSaves.length} save folders`,
      ];

      if (result.overwrittenSaves.length > 0) {
        messageParts.push(`overwrote ${result.overwrittenSaves.length} existing save(s)`);
      }
      if (result.overwriteBackup) {
        messageParts.push(`backup created: ${result.overwriteBackup}`);
      }
      if (result.defaultApplied) {
        messageParts.push(`default save set to ${result.defaultSaveName}`);
      } else if (result.defaultSkipped) {
        messageParts.push('default save was not changed because the archive contained multiple saves');
      }

      res.json({
        success: true,
        message: messageParts.join(', '),
        importedSaves: result.importedSaves,
        overwrittenSaves: result.overwrittenSaves,
        overwriteBackup: result.overwriteBackup,
        defaultSaveName: result.defaultSaveName,
        defaultApplied: result.defaultApplied,
        defaultSkipped: result.defaultSkipped,
        needsRestart: true,
      });
    } finally {
      removePath(tempZip);
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to upload save', details: config.sanitizeErrorMessage(e.message) });
  }
}

function setDefaultSave(req, res) {
  try {
    const saveName = req.body && typeof req.body.saveName === 'string'
      ? req.body.saveName.trim()
      : '';

    if (!saveName) {
      return res.status(400).json({ error: 'Missing saveName' });
    }

    if (saveName.includes('..') || saveName.includes('/')) {
      return res.status(400).json({ error: 'Invalid save name' });
    }

    setSelectedSaveName(saveName);
    res.json({
      success: true,
      message: `Default save set to ${saveName}`,
      saveName,
      needsRestart: true,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to set default save', details: config.sanitizeErrorMessage(e.message) });
  }
}

function downloadBackup(req, res) {
  const raw = req.params.filename;
  const filename = path.basename(raw);

  if (!filename || filename !== raw || filename.startsWith('.')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.join(config.BACKUPS_DIR, filename);
  if (!filePath.startsWith(config.BACKUPS_DIR + path.sep)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Backup not found' });
  }

  res.download(filePath, filename);
}

module.exports = {
  getSaves,
  getBackups,
  getBackupStatus,
  createBackup,
  uploadSave,
  setDefaultSave,
  downloadBackup,
};
