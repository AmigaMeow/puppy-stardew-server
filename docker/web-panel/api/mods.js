/**
 * Mods API - List, upload and delete mods
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('../server');

const CUSTOM_MODS_DIR = '/home/steam/custom-mods';
const GAME_MODS_DIR = path.join(config.GAME_DIR, 'Mods');
const PREINSTALLED_MODS_DIR = '/home/steam/preinstalled-mods';
const METADATA_SUFFIX = '.panel-meta.json';

function isSuccessful(result) {
  return result && result.status === 0;
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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readManifest(modDir, fallbackName) {
  const manifestPath = path.join(modDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return {
      id: manifest.UniqueID || fallbackName,
      name: manifest.Name || fallbackName,
      version: manifest.Version || 'unknown',
      author: manifest.Author || 'unknown',
      description: manifest.Description || '',
    };
  } catch (error) {
    return {
      id: fallbackName,
      name: fallbackName,
      version: 'unknown',
      author: 'unknown',
      description: '',
    };
  }
}

function getPreinstalledModFolders() {
  const folders = new Set();

  if (!fs.existsSync(PREINSTALLED_MODS_DIR)) {
    return folders;
  }

  const entries = fs.readdirSync(PREINSTALLED_MODS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      folders.add(entry.name);
    }
  }

  return folders;
}

function getMetadataPath(baseName) {
  return path.join(CUSTOM_MODS_DIR, `${baseName}${METADATA_SUFFIX}`);
}

function loadMetadataByBaseName(baseName) {
  const metadataPath = getMetadataPath(baseName);
  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    metadata._path = metadataPath;
    return metadata;
  } catch (error) {
    return null;
  }
}

function loadAllMetadata() {
  if (!fs.existsSync(CUSTOM_MODS_DIR)) {
    return [];
  }

  return fs.readdirSync(CUSTOM_MODS_DIR)
    .filter(name => name.endsWith(METADATA_SUFFIX))
    .map(name => loadMetadataByBaseName(name.slice(0, -METADATA_SUFFIX.length)))
    .filter(Boolean);
}

function findManifestDirectories(rootDir, maxDepth = 3, depth = 0) {
  if (depth > maxDepth || !fs.existsSync(rootDir)) {
    return [];
  }

  const manifestPath = path.join(rootDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    return [rootDir];
  }

  const found = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    found.push(...findManifestDirectories(path.join(rootDir, entry.name), maxDepth, depth + 1));
  }

  return found;
}

function installArchiveToGameMods(zipPath) {
  ensureDir(GAME_MODS_DIR);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'puppy-mod-'));

  try {
    runCommand('unzip', ['-q', '-o', zipPath, '-d', tempRoot], { timeout: 30000 });

    const manifestDirs = findManifestDirectories(tempRoot);
    const installedFolders = [];

    for (const manifestDir of manifestDirs) {
      const folderName = path.basename(manifestDir);
      const destDir = path.join(GAME_MODS_DIR, folderName);
      fs.rmSync(destDir, { recursive: true, force: true });
      fs.cpSync(manifestDir, destDir, { recursive: true });
      installedFolders.push(folderName);
    }

    return {
      installedFolders,
      hasManifest: installedFolders.length > 0,
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function getMods(req, res) {
  const mods = [];
  const seenFolders = new Set();
  const preinstalledFolders = getPreinstalledModFolders();

  // Scan installed game mods. Anything not in the preinstalled set is treated as custom.
  try {
    if (fs.existsSync(GAME_MODS_DIR)) {
      const entries = fs.readdirSync(GAME_MODS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const manifest = readManifest(path.join(GAME_MODS_DIR, entry.name), entry.name);
        if (!manifest) continue;

        mods.push({
          ...manifest,
          enabled: true,
          isCustom: !preinstalledFolders.has(entry.name),
          folder: entry.name,
        });
        seenFolders.add(entry.name);
      }
    }
  } catch (e) {}

  // Scan pending custom source entries which are not already installed into the game Mods directory.
  try {
    if (fs.existsSync(CUSTOM_MODS_DIR)) {
      const entries = fs.readdirSync(CUSTOM_MODS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.endsWith(METADATA_SUFFIX)) {
          continue;
        }

        if (entry.isDirectory()) {
          if (seenFolders.has(entry.name)) continue;

          const manifest = readManifest(path.join(CUSTOM_MODS_DIR, entry.name), entry.name);
          if (!manifest) continue;

          mods.push({
            ...manifest,
            enabled: true,
            isCustom: true,
            folder: entry.name,
          });
          seenFolders.add(entry.name);
        } else if (entry.name.endsWith('.zip')) {
          const baseName = entry.name.replace(/\.zip$/i, '');
          const metadata = loadMetadataByBaseName(baseName);
          if (metadata && Array.isArray(metadata.installedFolders) && metadata.installedFolders.every(folder => seenFolders.has(folder))) {
            continue;
          }

          mods.push({
            id: entry.name,
            name: baseName,
            version: 'zip',
            author: '',
            description: 'Uploaded mod archive (pending restart or manual setup)',
            enabled: true,
            isCustom: true,
            folder: baseName,
          });
        }
      }
    }
  } catch (e) {}

  res.json({ mods, total: mods.length });
}

/**
 * POST /api/mods/upload
 * Upload a mod zip file to custom-mods directory
 * Expects multipart/form-data with a 'modfile' field
 */
function uploadMod(req, res) {
  try {
    var body = req.body || {};
    var filename = body.filename;
    var data = body.data;

    if (!filename || !data) {
      return res.status(400).json({ error: 'Missing filename or data' });
    }

    // Sanitize filename
    filename = path.basename(filename);
    if (!filename.endsWith('.zip')) {
      return res.status(400).json({ error: 'Only .zip files are supported' });
    }

    try {
      ensureDir(CUSTOM_MODS_DIR);
      ensureDir(GAME_MODS_DIR);
    } catch (e) {
      return res.status(500).json({ error: 'Cannot create mods directory', details: config.sanitizeErrorMessage(e.message) });
    }

    var destPath = path.join(CUSTOM_MODS_DIR, filename);
    var metadataPath = getMetadataPath(filename.replace(/\.zip$/i, ''));

    // Check if already exists
    if (fs.existsSync(destPath) || fs.existsSync(metadataPath)) {
      return res.status(409).json({ error: 'A mod with this filename already exists' });
    }

    // Write file from base64
    var buffer = Buffer.from(data, 'base64');

    // Size limit: 50MB
    if (buffer.length > 50 * 1024 * 1024) {
      return res.status(413).json({ error: 'File too large (max 50MB)' });
    }

    fs.writeFileSync(destPath, buffer);

    try {
      const installResult = installArchiveToGameMods(destPath);

      if (installResult.installedFolders.length > 0) {
        fs.writeFileSync(metadataPath, JSON.stringify({
          filename: filename,
          installedFolders: installResult.installedFolders,
          uploadedAt: new Date().toISOString(),
        }, null, 2));
      }

      res.json({
        success: true,
        message: installResult.hasManifest
          ? 'Mod uploaded successfully. Restart the server to load the new mod.'
          : 'Mod archive uploaded, but no manifest.json was found. Check the archive structure.',
        filename: filename,
        extracted: installResult.hasManifest,
        hasManifest: installResult.hasManifest,
        noManifest: !installResult.hasManifest,
        autoInstallFailed: false,
        needsRestart: true,
        installedFolders: installResult.installedFolders,
      });
    } catch (e) {
      fs.rmSync(metadataPath, { force: true });
      res.json({
        success: true,
        message: 'Mod archive uploaded, but automatic installation failed. Restart may still install it from the archive.',
        filename: filename,
        extracted: false,
        hasManifest: false,
        noManifest: false,
        autoInstallFailed: true,
        needsRestart: true,
      });
    }
  } catch (e) {
    res.status(500).json({ error: 'Upload failed: ' + config.sanitizeErrorMessage(e.message) });
  }
}

/**
 * DELETE /api/mods/:folder
 * Delete a custom mod (only custom mods can be deleted)
 */
function deleteMod(req, res) {
  var folder = req.params.folder;
  if (!folder) {
    return res.status(400).json({ error: 'Mod folder name is required' });
  }

  folder = path.basename(folder);
  const preinstalledFolders = getPreinstalledModFolders();
  if (preinstalledFolders.has(folder)) {
    return res.status(403).json({ error: 'Built-in mods cannot be deleted from the web panel' });
  }

  const metadataEntries = loadAllMetadata();
  const matchingMetadata = metadataEntries.filter(entry =>
    entry.filename === `${folder}.zip` ||
    (Array.isArray(entry.installedFolders) && entry.installedFolders.includes(folder))
  );

  const sourcePaths = new Set([
    path.join(CUSTOM_MODS_DIR, folder),
    path.join(CUSTOM_MODS_DIR, `${folder}.zip`),
  ]);
  const gamePaths = new Set([
    path.join(GAME_MODS_DIR, folder),
  ]);

  for (const metadata of matchingMetadata) {
    sourcePaths.add(path.join(CUSTOM_MODS_DIR, metadata.filename));
    sourcePaths.add(metadata._path);

    if (Array.isArray(metadata.installedFolders)) {
      for (const installedFolder of metadata.installedFolders) {
        gamePaths.add(path.join(GAME_MODS_DIR, installedFolder));
      }
    }
  }

  const hasExistingTarget = [...sourcePaths, ...gamePaths].some(target => fs.existsSync(target));
  if (!hasExistingTarget) {
    return res.status(404).json({ error: 'Custom mod not found' });
  }

  try {
    for (const target of [...sourcePaths, ...gamePaths]) {
      fs.rmSync(target, { recursive: true, force: true });
    }

    res.json({ success: true, message: 'Mod deleted successfully', needsRestart: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete mod: ' + config.sanitizeErrorMessage(e.message) });
  }
}

module.exports = { getMods, uploadMod, deleteMod };
