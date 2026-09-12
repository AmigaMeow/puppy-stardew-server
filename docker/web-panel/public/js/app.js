/**
 * Main Application - Navigation, WebSocket, Dashboard, all page logic
 */

// ─── Auth Check ──────────────────────────────────────────────────
(function authCheck() {
  if (!API.token) {
    window.location.href = '/login.html';
    return;
  }
  // Verify token
  API.get('/api/auth/verify').then(data => {
    if (!data || !data.valid) {
      window.location.href = '/login.html';
      return;
    }
    document.getElementById('app').style.display = 'flex';
    init();
  }).catch(() => {
    window.location.href = '/login.html';
  });
})();

// ─── Global State ────────────────────────────────────────────────
let ws = null;
let currentPage = 'dashboard';
let logAutoScroll = true;
let statusInterval = null;
let lastStatusData = null;
let backupStatusPoll = null;
let lastBackupStatus = null;

function detectTheme() {
  const saved = localStorage.getItem('panel_theme');
  if (saved === 'dark' || saved === 'light') {
    return saved;
  }

  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

let currentTheme = detectTheme();
document.documentElement.dataset.theme = currentTheme;

// ─── i18n ────────────────────────────────────────────────────────
function detectLanguage() {
  const saved = localStorage.getItem('panel_lang');
  if (saved === 'zh' || saved === 'en') {
    return saved;
  }

  return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let currentLang = detectLanguage();
const translations = {
  zh: {
    'nav.dashboard': '仪表盘', 'nav.logs': '日志', 'nav.terminal': '终端',
    'nav.players': '玩家', 'nav.saves': '存档', 'nav.config': '配置', 'nav.mods': '模组',
    'dash.status': '服务器状态', 'dash.players': '在线玩家', 'dash.uptime': '运行时间',
    'dash.gameDay': '游戏日期', 'dash.backups': '备份数量', 'dash.mods': '已加载Mod',
    'dash.resources': '系统资源', 'dash.quickActions': '快捷操作',
    'dash.details': '服务器详情', 'dash.joinIp': '联机 IP', 'dash.joinPort': '联机端口',
    'dash.localIps': '容器 IP', 'dash.version': '版本', 'dash.scriptHealth': '自动化脚本',
    'dash.metricsPort': '监控端口', 'dash.events': '自动化事件',
    'dash.passout': '昏倒处理', 'dash.readyCheck': '准备检查', 'dash.offlineEvents': '离线恢复',
    'dash.joinHint': '游戏内通常只需要输入 IP 地址。', 'dash.portHint': '星露谷联机输入框里不要追加端口号。',
    'dash.healthy': '正常', 'dash.unhealthy': '异常',
    'dash.paused': '暂停游戏',
    'dash.viewLogs': '查看日志', 'dash.restart': '重启服务器', 'dash.backup': '立即备份',
    'term.title': 'SMAPI 控制台（非系统终端）', 'term.hint': '点击“连接”后会附着到正在运行的 SMAPI 进程。这里只能输入 SMAPI 命令或 Steam Guard 验证码，不能执行 Linux 命令。',
    'term.connect': '连接', 'term.disconnect': '断开', 'term.send': '发送', 'term.input': '输入 SMAPI 命令或 Steam Guard 验证码...',
    'players.title': '在线玩家', 'players.loading': '加载中...',
    'players.none': '当前没有在线玩家', 'players.online': '在线：{online}/{max}', 'players.farm': '农场：{farm}',
    'saves.title': '存档文件', 'saves.backups': '备份列表', 'saves.noFiles': '未找到存档文件', 'saves.noBackups': '未找到备份',
    'saves.backupNow': '立即备份', 'saves.unknown': '未知',
    'saves.upload': '上传存档', 'saves.uploading': '上传中...', 'saves.uploadHint': '上传星露谷存档 zip。面板会校验并解压到服务器存档目录，重启容器后可自动加载。',
    'saves.setDefaultAfterUpload': '上传后设为默认存档', 'saves.setDefault': '设为默认', 'saves.defaultBadge': '默认自动载入',
    'saves.restartHint': '重启 Docker 容器后生效。', 'saves.overwriteBackup': '已为同名旧存档创建备份：{name}',
    'saves.multipleImported': '压缩包包含多个存档，已导入但未自动设置默认存档。',
    'saves.backupRunning': '备份进行中，请勿重复点击或反复刷新页面。',
    'saves.backupCompleted': '最近一次备份已完成。',
    'saves.backupFailed': '最近一次备份失败。',
    'saves.backupProgress': '进度 {current}/{total} · {percent}%',
    'saves.backupStartedAt': '开始于 {time}',
    'saves.backupCompletedAt': '完成于 {time}',
    'saves.backupFile': '文件 {name}',
    'saves.backupSize': '大小 {size}',
    'config.password': '修改面板密码', 'config.currentPassword': '当前密码', 'config.newPassword': '新密码',
    'config.update': '更新', 'config.saveChanges': '保存更改', 'mods.title': '已安装模组', 'mods.none': '未找到模组',
    'mods.custom': '自定义', 'mods.builtin': '内置',
    'mods.upload': '上传模组', 'mods.delete': '删除', 'mods.confirmDelete': '确定要删除模组 {name} 吗？',
    'mods.uploadHint': '选择 .zip 模组文件', 'mods.uploading': '上传中...',
    'mods.uploadInstalled': '模组已上传并安装到游戏目录。重启服务器后会加载新模组。',
    'mods.uploadNoManifest': '模组压缩包已上传，但未找到 manifest.json，请检查压缩包结构。',
    'mods.uploadFallback': '模组压缩包已上传，但自动安装失败。重启后仍会尝试从压缩包安装。',
    'mods.deleteNeedsRestart': '模组已删除。重启服务器后将完全卸载。',
    'toast.modUploadOk': '模组上传成功！重启服务器后生效。', 'toast.modUploadFail': '模组上传失败',
    'toast.modDeleteOk': '模组已删除', 'toast.modDeleteFail': '模组删除失败',
    'config.group.Steam': 'Steam 设置', 'config.group.VNC': 'VNC 设置',
    'config.group.Display': '显示设置', 'config.group.Performance': '性能优化',
    'config.group.Backup': '备份设置', 'config.group.Stability': '稳定性',
    'config.group.Monitoring': '监控', 'config.group.Game': '游戏', 'config.group.Other': '其他',
    'config.autoDetect': '自动检测',
    'config.readonlySecret': '由 Docker Secrets 管理，面板中不可修改。',
    'config.help.SAVE_NAME': '选择要自动加载的现有存档。留空时将使用默认存档加载逻辑。',
    'config.help.BACKUP_COMPRESSION_LEVEL': 'gzip 压缩级别，范围 1-9。1 占用 CPU 最低、备份更快，但文件会更大。',
    'config.help.PUBLIC_IP': '公网联机时填写你的公网 IP 或域名。留空时仪表盘会显示当前访问面板所用的地址，或容器检测到的内网 IP。',
    'config.help.STEAM_USERNAME': '非 Docker Secrets 模式下可直接修改 Steam 登录账号。保存后重启容器生效。',
    'config.help.STEAM_PASSWORD': '可在这里写入新的 Steam 密码。出于安全原因不会回显旧密码；留空表示保持现有密码不变。',
    'login.subtitle': '服务器管理面板', 'login.password': '密码', 'login.button': '登录',
    'setup.title': '设置管理密码', 'setup.subtitle': '首次使用，请设置您的管理密码',
    'setup.password': '设置密码', 'setup.confirm': '确认密码', 'setup.button': '开始使用',
    'setup.minLength': '密码至少需要6个字符', 'setup.mismatch': '两次输入的密码不一致',
    'setup.success': '密码设置成功！', 'setup.failed': '设置失败',
    'status.running': '运行中', 'status.stopped': '已停止', 'status.checking': '检查中...',
    'logs.all': '全部', 'logs.errors': '错误', 'logs.mods': '模组', 'logs.server': '服务器', 'logs.game': '游戏',
    'logs.search': '搜索日志...', 'logs.auto': '自动', 'logs.clear': '清空',
    'logs.notFound': '日志文件尚未生成，服务器可能仍在启动中...',
    'toast.backupOk': '备份创建成功！', 'toast.backupFail': '备份失败',
    'toast.saveUploadOk': '存档上传成功。', 'toast.saveUploadDefaultOk': '存档上传成功，已设为默认自动载入存档。', 'toast.saveUploadFail': '存档上传失败',
    'toast.saveDefaultOk': '默认存档已更新。', 'toast.saveDefaultFail': '设置默认存档失败',
    'toast.backupStarted': '备份任务已在后台开始，可以离开当前页面。',
    'toast.backupRunning': '已有备份任务正在进行中。',
    'toast.restartOk': '重启指令已发送', 'toast.restartFail': '重启失败',
    'toast.containerRestarting': '容器正在重启，页面会自动重新连接。',
    'toast.containerRestartFail': '容器重启失败',
    'toast.pwdOk': '密码修改成功', 'toast.pwdFail': '密码修改失败',
    'toast.configOk': '配置已保存，重启 Docker 容器后生效', 'toast.configFail': '配置保存失败',
    'toast.creatingBackup': '正在创建备份...', 'toast.passwordFields': '请填写两个密码字段',
    'actions.confirmRestart': '确定要重启服务器吗？',
    'config.restartTitle': '需要重启容器', 'config.restartMessage': '配置已保存。你可以现在直接重启 Docker 容器来应用这些更改；仪表盘里的“重启服务器”按钮仍然只负责重启游戏进程。', 'config.restartNow': '立即重启容器', 'config.restartLater': '稍后',
    'config.showPassword': '显示密码', 'config.hidePassword': '隐藏密码',
    'github.open': '打开项目 GitHub 仓库',
    'lang.toggle': '切换语言', 'logout.title': '退出登录',
    'theme.light': '切换到亮色模式', 'theme.dark': '切换到暗色模式',
  },
  en: {
    'nav.dashboard': 'Dashboard', 'nav.logs': 'Logs', 'nav.terminal': 'Terminal',
    'nav.players': 'Players', 'nav.saves': 'Saves', 'nav.config': 'Config', 'nav.mods': 'Mods',
    'dash.status': 'Server Status', 'dash.players': 'Online Players', 'dash.uptime': 'Uptime',
    'dash.gameDay': 'Game Day', 'dash.backups': 'Backups', 'dash.mods': 'Loaded Mods',
    'dash.resources': 'System Resources', 'dash.quickActions': 'Quick Actions',
    'dash.details': 'Server Details', 'dash.joinIp': 'Join IP', 'dash.joinPort': 'Join Port',
    'dash.localIps': 'Container IPs', 'dash.version': 'Version', 'dash.scriptHealth': 'Automation',
    'dash.metricsPort': 'Metrics Port', 'dash.events': 'Automation Events',
    'dash.passout': 'Passout', 'dash.readyCheck': 'Ready Check', 'dash.offlineEvents': 'Offline Recovery',
    'dash.joinHint': 'In-game usually only needs the IP address.', 'dash.portHint': 'Do not append the port in Stardew\'s join field.',
    'dash.healthy': 'Healthy', 'dash.unhealthy': 'Unhealthy',
    'dash.paused': 'Paused',
    'dash.viewLogs': 'View Logs', 'dash.restart': 'Restart Server', 'dash.backup': 'Backup Now',
    'term.title': 'SMAPI Console (Not a System Shell)', 'term.hint': 'Click "Connect" to attach to the running SMAPI process. This accepts SMAPI commands and Steam Guard codes, not Linux shell commands.',
    'term.connect': 'Connect', 'term.disconnect': 'Disconnect', 'term.send': 'Send', 'term.input': 'Type a SMAPI command or Steam Guard code...',
    'players.title': 'Online Players', 'players.loading': 'Loading...',
    'players.none': 'No players online', 'players.online': 'Online: {online}/{max}', 'players.farm': 'Farm: {farm}',
    'saves.title': 'Save Files', 'saves.backups': 'Backups', 'saves.noFiles': 'No save files found', 'saves.noBackups': 'No backups found',
    'saves.backupNow': 'Backup Now', 'saves.unknown': 'unknown',
    'saves.upload': 'Upload Save', 'saves.uploading': 'Uploading...', 'saves.uploadHint': 'Upload a Stardew Valley save zip. The panel will validate it, extract it into the server save directory, and it can auto-load after a container restart.',
    'saves.setDefaultAfterUpload': 'Set imported save as default', 'saves.setDefault': 'Set Default', 'saves.defaultBadge': 'Auto-load Default',
    'saves.restartHint': 'Takes effect after restarting the Docker container.', 'saves.overwriteBackup': 'Created a backup for overwritten saves: {name}',
    'saves.multipleImported': 'The archive contained multiple saves, so the default save was not changed automatically.',
    'saves.backupRunning': 'Backup is in progress. Avoid repeated clicks or refreshes.',
    'saves.backupCompleted': 'The latest backup completed successfully.',
    'saves.backupFailed': 'The latest backup failed.',
    'saves.backupProgress': 'Progress {current}/{total} · {percent}%',
    'saves.backupStartedAt': 'Started at {time}',
    'saves.backupCompletedAt': 'Completed at {time}',
    'saves.backupFile': 'File {name}',
    'saves.backupSize': 'Size {size}',
    'config.password': 'Change Panel Password', 'config.currentPassword': 'Current password', 'config.newPassword': 'New password',
    'config.update': 'Update', 'config.saveChanges': 'Save Changes', 'mods.title': 'Installed Mods', 'mods.none': 'No mods found',
    'mods.custom': 'Custom', 'mods.builtin': 'Built-in',
    'mods.upload': 'Upload Mod', 'mods.delete': 'Delete', 'mods.confirmDelete': 'Are you sure you want to delete mod {name}?',
    'mods.uploadHint': 'Select a .zip mod file', 'mods.uploading': 'Uploading...',
    'mods.uploadInstalled': 'Mod uploaded and installed into the game Mods directory. Restart the server to load it.',
    'mods.uploadNoManifest': 'Mod archive uploaded, but no manifest.json was found. Check the archive structure.',
    'mods.uploadFallback': 'Mod archive uploaded, but automatic installation failed. Restart may still install it from the archive.',
    'mods.deleteNeedsRestart': 'Mod deleted. Restart the server to fully unload it.',
    'toast.modUploadOk': 'Mod uploaded! Restart server to apply.', 'toast.modUploadFail': 'Mod upload failed',
    'toast.modDeleteOk': 'Mod deleted', 'toast.modDeleteFail': 'Mod delete failed',
    'config.group.Steam': 'Steam', 'config.group.VNC': 'VNC',
    'config.group.Display': 'Display', 'config.group.Performance': 'Performance',
    'config.group.Backup': 'Backup', 'config.group.Stability': 'Stability',
    'config.group.Monitoring': 'Monitoring', 'config.group.Game': 'Game', 'config.group.Other': 'Other',
    'config.autoDetect': 'Auto-detect',
    'config.readonlySecret': 'Managed by Docker Secrets and cannot be edited in the panel.',
    'config.help.SAVE_NAME': 'Choose an existing save to auto-load. Leave it empty to use the default save loading behavior.',
    'config.help.BACKUP_COMPRESSION_LEVEL': 'gzip compression level from 1 to 9. Level 1 uses the least CPU and finishes faster, but creates larger backups.',
    'config.help.PUBLIC_IP': 'Enter your public IP or domain for internet play. Leave it empty to show the current panel host or the container-detected LAN IP instead.',
    'config.help.STEAM_USERNAME': 'In non-Secrets mode, you can update the Steam login account here. Takes effect after a container restart.',
    'config.help.STEAM_PASSWORD': 'Write a new Steam password here. The current password is never shown back; leave it empty to keep the existing password.',
    'login.subtitle': 'Server Management Panel', 'login.password': 'Password', 'login.button': 'Login',
    'setup.title': 'Set Admin Password', 'setup.subtitle': 'First time setup - please create your admin password',
    'setup.password': 'Password', 'setup.confirm': 'Confirm Password', 'setup.button': 'Get Started',
    'setup.minLength': 'Password must be at least 6 characters', 'setup.mismatch': 'Passwords do not match',
    'setup.success': 'Password set successfully!', 'setup.failed': 'Setup failed',
    'status.running': 'Running', 'status.stopped': 'Stopped', 'status.checking': 'Checking...',
    'logs.all': 'All', 'logs.errors': 'Errors', 'logs.mods': 'Mods', 'logs.server': 'Server', 'logs.game': 'Game',
    'logs.search': 'Search logs...', 'logs.auto': 'Auto', 'logs.clear': 'Clear',
    'logs.notFound': 'Log file not found yet. Server may still be starting...',
    'toast.backupOk': 'Backup created!', 'toast.backupFail': 'Backup failed',
    'toast.saveUploadOk': 'Save uploaded.', 'toast.saveUploadDefaultOk': 'Save uploaded and set as the default auto-load save.', 'toast.saveUploadFail': 'Save upload failed',
    'toast.saveDefaultOk': 'Default save updated.', 'toast.saveDefaultFail': 'Failed to set default save',
    'toast.backupStarted': 'Backup started in the background. You can leave this page.',
    'toast.backupRunning': 'A backup is already in progress.',
    'toast.restartOk': 'Restart initiated', 'toast.restartFail': 'Restart failed',
    'toast.containerRestarting': 'Container is restarting. This page will reconnect automatically.',
    'toast.containerRestartFail': 'Container restart failed',
    'toast.pwdOk': 'Password changed', 'toast.pwdFail': 'Password change failed',
    'toast.configOk': 'Config saved. Restart the Docker container to apply.', 'toast.configFail': 'Failed to save config',
    'toast.creatingBackup': 'Creating backup...', 'toast.passwordFields': 'Please fill in both password fields',
    'actions.confirmRestart': 'Are you sure you want to restart the server?',
    'config.restartTitle': 'Container Restart Required', 'config.restartMessage': 'Configuration has been saved. You can restart the Docker container now to apply these changes; the dashboard "Restart Server" button still only restarts the game process.', 'config.restartNow': 'Restart Container Now', 'config.restartLater': 'Later',
    'config.showPassword': 'Show password', 'config.hidePassword': 'Hide password',
    'github.open': 'Open project GitHub repository',
    'lang.toggle': 'Switch language', 'logout.title': 'Log out',
    'theme.light': 'Switch to light mode', 'theme.dark': 'Switch to dark mode',
  },
};

function t(key) {
  return (translations[currentLang] && translations[currentLang][key]) || key;
}

function tf(key, params = {}) {
  return Object.entries(params).reduce(
    (result, [param, value]) => result.replace(`{${param}}`, value),
    t(key)
  );
}

function icon(name, className = 'icon') {
  return `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function statusOrb(state) {
  return `<span class="status-orb ${state}" aria-hidden="true"></span>`;
}

function statusDot(state) {
  return `<span class="status-dot ${state}" aria-hidden="true"></span>`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = currentTheme;
  const themeIcon = document.querySelector('#themeToggle use');
  if (themeIcon) {
    themeIcon.setAttribute('href', currentTheme === 'dark' ? '#icon-theme-light' : '#icon-theme-dark');
  }
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.setAttribute('title', t(currentTheme === 'dark' ? 'theme.light' : 'theme.dark'));
  }
}

function applyTranslations() {
  document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
  document.getElementById('pageTitle').textContent = t(`nav.${currentPage}`) || t('nav.dashboard');
  applyTheme();
  if (lastStatusData) {
    updateDashboardUI(lastStatusData);
  }
  if (lastBackupStatus) {
    renderBackupStatus(lastBackupStatus);
  }
}

// ─── Init ────────────────────────────────────────────────────────
function init() {
  applyTheme();
  applyTranslations();
  setupNavigation();
  setupWebSocket();
  loadDashboard();
  loadBackupStatus();

  // Logout
  document.getElementById('logoutBtn').onclick = () => {
    localStorage.removeItem('panel_token');
    window.location.href = '/login.html';
  };

  // Language toggle
  document.getElementById('langToggle').onclick = () => {
    currentLang = currentLang === 'en' ? 'zh' : 'en';
    localStorage.setItem('panel_lang', currentLang);
    applyTranslations();
    reloadCurrentPage();
  };

  document.getElementById('themeToggle').onclick = () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('panel_theme', currentTheme);
    applyTheme();
  };

  // Mobile menu toggle
  document.getElementById('menuToggle').onclick = () => {
    document.getElementById('sidebar').classList.toggle('open');
  };

  // Log controls
  document.getElementById('logAutoScroll').onclick = () => {
    logAutoScroll = !logAutoScroll;
    document.getElementById('logAutoScroll').style.opacity = logAutoScroll ? '1' : '0.5';
  };

  document.getElementById('logClear').onclick = () => {
    document.getElementById('logOutput').innerHTML = '';
  };

  // Log filters
  document.querySelectorAll('.log-filter').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.log-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadLogs(btn.dataset.filter);
      subscribeToLogs(btn.dataset.filter);
    };
  });

  // Log search
  let searchTimeout;
  document.getElementById('logSearch').oninput = (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const activeFilter = document.querySelector('.log-filter.active')?.dataset.filter || 'all';
      loadLogs(activeFilter, e.target.value);
    }, 300);
  };

  // Auto-refresh dashboard
  statusInterval = setInterval(loadDashboard, 10000);
}

function reloadCurrentPage() {
  switch (currentPage) {
    case 'dashboard':
      if (lastStatusData) {
        updateDashboardUI(lastStatusData);
      } else {
        loadDashboard();
      }
      break;
    case 'logs':
      loadLogs(
        document.querySelector('.log-filter.active')?.dataset.filter || 'all',
        document.getElementById('logSearch')?.value || ''
      );
      break;
    case 'players':
      loadPlayers();
      break;
    case 'saves':
      loadSaves();
      break;
    case 'config':
      loadConfig();
      break;
    case 'mods':
      loadMods();
      break;
    default:
      break;
  }
}

// ─── Navigation ──────────────────────────────────────────────────
function setupNavigation() {
  // Sidebar nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.onclick = () => navigateTo(item.dataset.page);
  });
  // Mobile nav
  document.querySelectorAll('.mob-nav-item').forEach(item => {
    item.onclick = () => navigateTo(item.dataset.page);
  });
}

function navigateTo(page) {
  currentPage = page;

  // Update sidebar active
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.mob-nav-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.querySelector(`.mob-nav-item[data-page="${page}"]`)?.classList.add('active');

  // Show page
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');

  // Update title
  const titleMap = {
    dashboard: t('nav.dashboard'), logs: t('nav.logs'), terminal: t('nav.terminal'),
    players: t('nav.players'), saves: t('nav.saves'), config: t('nav.config'), mods: t('nav.mods'),
  };
  document.getElementById('pageTitle').textContent = titleMap[page] || page;

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');

  // Load page data
  switch (page) {
    case 'dashboard': loadDashboard(); break;
    case 'logs': loadLogs('all'); subscribeToLogs('all'); break;
    case 'players': loadPlayers(); break;
    case 'saves': loadSaves(); break;
    case 'config': loadConfig(); break;
    case 'mods': loadMods(); break;
  }
}

// ─── WebSocket ───────────────────────────────────────────────────
function setupWebSocket() {
  if (ws) {
    ws.close();
  }

  ws = new WebSocket(API.getWsUrl());

  ws.onopen = () => {
    console.log('[WS] Connected');
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleWsMessage(msg);
    } catch (err) {
      console.error('[WS] Parse error:', err);
    }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected, reconnecting in 5s...');
    setTimeout(setupWebSocket, 5000);
  };

  ws.onerror = () => {
    // Will trigger onclose
  };
}

function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'status':
      updateDashboardUI(msg.data);
      break;
    case 'log':
      appendLogLine(msg.line);
      break;
    case 'log:subscribed':
      // Already subscribed
      break;
    case 'terminal:output':
      appendTerminalOutput(msg.data);
      break;
    case 'terminal:opened':
      appendTerminalOutput(msg.data);
      document.getElementById('termInput').disabled = false;
      document.getElementById('termSendBtn').disabled = false;
      document.getElementById('termConnect').style.display = 'none';
      document.getElementById('termDisconnect').style.display = '';
      break;
    case 'terminal:closed':
      appendTerminalOutput(msg.data);
      document.getElementById('termInput').disabled = true;
      document.getElementById('termSendBtn').disabled = true;
      document.getElementById('termConnect').style.display = '';
      document.getElementById('termDisconnect').style.display = 'none';
      break;
    case 'terminal:error':
      appendTerminalOutput(`[Error] ${msg.data}\r\n`);
      break;
  }
}

// ─── Dashboard ───────────────────────────────────────────────────
async function loadDashboard() {
  const data = await API.get('/api/status');
  if (data) updateDashboardUI(data);
}

function updateDashboardUI(data) {
  lastStatusData = data;

  // Status
  const statusEl = document.getElementById('stat-status');
  const statusIcon = document.getElementById('stat-status-icon');
  const statusBadge = document.getElementById('serverStatus');

  if (data.gameRunning) {
    statusEl.textContent = t('status.running');
    statusIcon.innerHTML = statusOrb('online');
    statusBadge.innerHTML = `${statusDot('online')}<span>${t('status.running')}</span>`;
    statusBadge.className = 'status-badge online';
  } else {
    statusEl.textContent = t('status.stopped');
    statusIcon.innerHTML = statusOrb('offline');
    statusBadge.innerHTML = `${statusDot('offline')}<span>${t('status.stopped')}</span>`;
    statusBadge.className = 'status-badge offline';
  }

  // Players
  document.getElementById('stat-players').textContent =
    `${data.players?.online || 0}/${data.players?.max || 4}`;

  // Uptime
  document.getElementById('stat-uptime').textContent = formatUptime(data.uptime || 0);

  // Game day
  document.getElementById('stat-day').textContent = data.paused ? t('dash.paused') : (data.day || '--');

  // Backups & Mods
  document.getElementById('stat-backups').textContent = data.backupCount || 0;
  document.getElementById('stat-mods').textContent = data.modCount || 0;

  // CPU
  const cpu = Math.round(data.cpu || 0);
  document.getElementById('cpu-value').textContent = cpu + '%';
  const cpuBar = document.getElementById('cpu-bar');
  cpuBar.style.width = Math.min(cpu, 100) + '%';
  cpuBar.className = 'progress-fill' + (cpu > 80 ? ' danger' : cpu > 60 ? ' warn' : '');

  // RAM
  const memUsed = Math.round(data.memory?.used || 0);
  const memLimit = data.memory?.limit || 2048;
  const memPct = Math.round((memUsed / memLimit) * 100);
  document.getElementById('ram-value').textContent = `${memUsed} / ${memLimit} MB`;
  const ramBar = document.getElementById('ram-bar');
  ramBar.style.width = Math.min(memPct, 100) + '%';
  ramBar.className = 'progress-fill' + (memPct > 80 ? ' danger' : memPct > 60 ? ' warn' : '');

  const network = data.network || {};
  setText('detail-join-ip', network.joinIp || '--');
  setText('detail-join-port', `${network.joinPort || 24642}/UDP`);
  setText('detail-local-ips', network.localIps && network.localIps.length ? network.localIps.join(', ') : '--');
  setText('detail-version', data.version || '--');
  setText('detail-script-health', data.scriptsHealthy ? t('dash.healthy') : t('dash.unhealthy'));
  setText('detail-metrics-port', network.metricsPort ? String(network.metricsPort) : '--');
  setText('detail-event-passout', String(data.events?.passout || 0));
  setText('detail-event-readycheck', String(data.events?.readycheck || 0));
  setText('detail-event-offline', String(data.events?.offline || 0));
}

function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Logs ────────────────────────────────────────────────────────
async function loadLogs(filter, search) {
  const params = new URLSearchParams({ type: filter || 'all', lines: 300 });
  if (search) params.set('search', search);

  const data = await API.get(`/api/logs?${params}`);
  if (!data) return;

  const output = document.getElementById('logOutput');
  output.innerHTML = '';

  if (!data.exists) {
    output.innerHTML = `<div class="log-line info">${t('logs.notFound')}</div>`;
    return;
  }

  for (const line of data.lines) {
    appendLogLine(line);
  }
}

function appendLogLine(line) {
  const output = document.getElementById('logOutput');
  const div = document.createElement('div');
  div.className = `log-line ${line.level || 'info'}`;
  div.textContent = line.text || line;
  output.appendChild(div);

  // Keep max 2000 lines
  while (output.children.length > 2000) {
    output.removeChild(output.firstChild);
  }

  if (logAutoScroll) {
    output.scrollTop = output.scrollHeight;
  }
}

function subscribeToLogs(filter) {
  wsSend({ type: 'subscribe', channel: 'logs', filter });
}

// ─── Terminal ────────────────────────────────────────────────────
function terminalConnect() {
  wsSend({ type: 'terminal:open' });
}

function terminalDisconnect() {
  wsSend({ type: 'terminal:close' });
  document.getElementById('termInput').disabled = true;
  document.getElementById('termSendBtn').disabled = true;
  document.getElementById('termConnect').style.display = '';
  document.getElementById('termDisconnect').style.display = 'none';
}

function terminalSend() {
  const input = document.getElementById('termInput');
  const text = input.value.trim();
  if (!text) return;

  wsSend({ type: 'terminal:input', data: text });
  input.value = '';
}

function appendTerminalOutput(text) {
  const output = document.getElementById('termOutput');
  // Remove hint on first output
  const hint = output.querySelector('.terminal-hint');
  if (hint) hint.remove();

  output.textContent += text;
  output.scrollTop = output.scrollHeight;
}

// ─── Players ─────────────────────────────────────────────────────
async function loadPlayers() {
  const data = await API.get('/api/players');
  if (!data) return;

  const list = document.getElementById('playersList');

  if (!data.players || data.players.length === 0) {
    list.innerHTML = `<div class="empty-state">
      ${icon('players', 'icon empty-icon')}
      <div>${t('players.none')}</div>
      <div style="margin-top:8px;color:var(--text-muted)">${tf('players.online', { online: data.online, max: data.max })}</div>
    </div>`;
    return;
  }

  list.innerHTML = data.players.map(p => `
    <div class="player-card">
      <div class="player-avatar">${icon('player', 'icon')}</div>
      <div>
        <div class="player-name">${escapeHtml(p.name)}</div>
        <div class="player-info">${p.farm ? tf('players.farm', { farm: escapeHtml(p.farm) }) : ''}</div>
      </div>
    </div>
  `).join('');
}

// ─── Saves ───────────────────────────────────────────────────────
async function loadSaves() {
  const [savesData, backupsData] = await Promise.all([
    API.get('/api/saves'),
    API.get('/api/saves/backups'),
  ]);

  if (savesData) {
    const list = document.getElementById('savesList');
    if (!savesData.saves || savesData.saves.length === 0) {
      list.innerHTML = `<div class="empty-state">${t('saves.noFiles')}</div>`;
    } else {
      list.innerHTML = savesData.saves.map(s => `
        <div class="save-item">
          <div class="save-info">
            <div class="save-name">${icon('sprout', 'icon save-name-icon')}<span>${escapeHtml(s.farm || s.name)}</span>${s.isDefault ? `<span class="save-badge">${t('saves.defaultBadge')}</span>` : ''}</div>
            <div class="save-meta">${formatSize(s.size)} · ${s.lastModified ? new Date(s.lastModified).toLocaleString(currentLang === 'zh' ? 'zh-CN' : 'en-US') : t('saves.unknown')}</div>
          </div>
          <div class="save-actions">
            ${s.isDefault ? '' : `<button class="btn btn-sm save-default-btn" data-save-name="${escapeHtml(s.name)}">${t('saves.setDefault')}</button>`}
          </div>
        </div>
      `).join('');

      list.querySelectorAll('.save-default-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          setDefaultSave(btn.dataset.saveName);
        });
      });
    }
  }

  if (backupsData) {
    const list = document.getElementById('backupsList');
    if (!backupsData.backups || backupsData.backups.length === 0) {
      list.innerHTML = `<div class="empty-state">${t('saves.noBackups')}</div>`;
    } else {
      list.innerHTML = backupsData.backups.map(b => `
        <div class="backup-item">
          <div class="save-info">
            <div class="save-name">${icon('package', 'icon save-name-icon')}<span>${escapeHtml(b.filename)}</span></div>
            <div class="save-meta">${formatSize(b.size)} · ${new Date(b.date).toLocaleString(currentLang === 'zh' ? 'zh-CN' : 'en-US')}</div>
          </div>
          <a href="#" class="btn btn-sm btn-primary" onclick="downloadBackup('${escapeHtml(b.filename)}', event); return false;">${icon('download', 'icon')}</a>
        </div>
      `).join('');
    }
  }
}

async function downloadBackup(filename, event) {
  if (event) event.preventDefault();
  try {
    var data = await API.post('/api/saves/download-token', { filename: filename });
    if (data && data.token) {
      window.location.href = '/api/saves/download/' + encodeURIComponent(filename) + '?token=' + data.token;
    }
  } catch (e) {
    showToast(t('saves.downloadFailed') || 'Download failed', 'error');
  }
}

function getSaveUploadToast(data) {
  var parts = [];

  if (data && data.defaultApplied) {
    parts.push(t('toast.saveUploadDefaultOk'));
  } else if (data && data.defaultSkipped) {
    parts.push(t('saves.multipleImported'));
  } else {
    parts.push(t('toast.saveUploadOk'));
  }

  if (data && data.overwriteBackup) {
    parts.push(tf('saves.overwriteBackup', { name: data.overwriteBackup }));
  }

  parts.push(t('saves.restartHint'));
  return parts.join(' ');
}

async function handleSaveUpload(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];

  if (!file.name.endsWith('.zip')) {
    showToast('Only .zip files are supported', 'error');
    return;
  }

  if (file.size > 40 * 1024 * 1024) {
    showToast('File too large (max 40MB)', 'error');
    return;
  }

  var setAsDefault = document.getElementById('saveUploadSetDefault').checked;
  document.getElementById('saveUploadStatus').textContent = t('saves.uploading');

  var reader = new FileReader();
  reader.onload = async function() {
    var base64 = reader.result.split(',')[1];
    var data = await API.post('/api/saves/upload', {
      filename: file.name,
      data: base64,
      setAsDefault: setAsDefault,
    });

    document.getElementById('saveUploadStatus').textContent = '';
    input.value = '';

    if (data && data.success) {
      showToast(getSaveUploadToast(data), 'success');
      loadSaves();
      loadConfig();
    } else {
      showToast(((data && data.error) || t('toast.saveUploadFail')) + ((data && data.details) ? (': ' + data.details) : ''), 'error');
    }
  };
  reader.readAsDataURL(file);
}

async function setDefaultSave(saveName) {
  var data = await API.post('/api/saves/default', { saveName: saveName });
  if (data && data.success) {
    showToast(t('toast.saveDefaultOk') + ' ' + t('saves.restartHint'), 'success');
    loadSaves();
    loadConfig();
  } else {
    showToast(((data && data.error) || t('toast.saveDefaultFail')) + ((data && data.details) ? (': ' + data.details) : ''), 'error');
  }
}

function getBackupActionButtons() {
  return document.querySelectorAll('.backup-action-btn');
}

function formatBackupTimestamp(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(currentLang === 'zh' ? 'zh-CN' : 'en-US');
}

function setBackupButtonsDisabled(disabled) {
  getBackupActionButtons().forEach(function(btn) {
    btn.disabled = disabled;
  });
}

function buildBackupStatusMeta(status) {
  const meta = [];

  if (status.state === 'running' && status.totalEntries > 0) {
    meta.push(tf('saves.backupProgress', {
      current: String(status.processedEntries || 0),
      total: String(status.totalEntries || 0),
      percent: String(status.progress || 0),
    }));
  }

  if (status.startedAt) {
    meta.push(tf('saves.backupStartedAt', { time: formatBackupTimestamp(status.startedAt) }));
  }

  if (status.completedAt) {
    meta.push(tf('saves.backupCompletedAt', { time: formatBackupTimestamp(status.completedAt) }));
  }

  if (status.backupName) {
    meta.push(tf('saves.backupFile', { name: status.backupName }));
  }

  if (status.state === 'completed' && status.size) {
    meta.push(tf('saves.backupSize', { size: formatSize(status.size) }));
  }

  return meta;
}

function renderBackupStatus(status) {
  lastBackupStatus = status;

  const targets = [
    document.getElementById('dashboardBackupStatus'),
    document.getElementById('savesBackupStatus'),
  ];
  const active = status && status.state && status.state !== 'idle';

  setBackupButtonsDisabled(!!(status && status.state === 'running'));

  targets.forEach(function(el) {
    if (!el) return;

    if (!active) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }

    const tone = status.state === 'failed'
      ? 'error'
      : (status.state === 'completed' ? 'success' : 'running');
    const titleKey = status.state === 'failed'
      ? 'saves.backupFailed'
      : (status.state === 'completed' ? 'saves.backupCompleted' : 'saves.backupRunning');
    const meta = buildBackupStatusMeta(status);
    const errorText = status.state === 'failed' && status.error
      ? '<div class="backup-status-error">' + escapeHtml(status.error) + '</div>'
      : '';
    const progressHtml = status.state === 'running'
      ? '<div class="backup-progress"><div class="backup-progress-fill" style="width:' + Math.max(1, status.progress || 0) + '%"></div></div>'
      : '';

    el.className = 'backup-status ' + tone;
    el.style.display = '';
    el.innerHTML =
      '<div class="backup-status-title">' + escapeHtml(t(titleKey)) + '</div>' +
      progressHtml +
      (meta.length > 0 ? '<div class="backup-status-meta">' + escapeHtml(meta.join(' · ')) + '</div>' : '') +
      errorText;
  });
}

function stopBackupStatusPolling() {
  if (backupStatusPoll) {
    clearInterval(backupStatusPoll);
    backupStatusPoll = null;
  }
}

function startBackupStatusPolling() {
  if (backupStatusPoll) {
    return;
  }

  backupStatusPoll = setInterval(function() {
    loadBackupStatus(true);
  }, 2000);
}

function applyBackupStatus(status, silent) {
  const previousState = lastBackupStatus && lastBackupStatus.state;
  renderBackupStatus(status);

  if (status && status.state === 'running') {
    startBackupStatusPolling();
    return;
  }

  stopBackupStatusPolling();

  if (!silent && previousState === 'running' && status && status.state === 'completed') {
    showToast(t('toast.backupOk'), 'success');
  } else if (!silent && previousState === 'running' && status && status.state === 'failed') {
    showToast(status.error || t('toast.backupFail'), 'error');
  }

  if (status && status.state && status.state !== 'running') {
    loadDashboard();
    if (currentPage === 'saves') {
      loadSaves();
    }
  }
}

async function loadBackupStatus(silent) {
  const data = await API.get('/api/saves/backup/status');
  if (!data) return;
  applyBackupStatus(data, !!silent);
}

// ─── Config ──────────────────────────────────────────────────────
async function loadConfig() {
  const data = await API.get('/api/config');
  if (!data) return;

  const container = document.getElementById('configContainer');
  container.innerHTML = '';

  for (const group of data.groups) {
    const card = document.createElement('div');
    card.className = 'card config-group';
    var groupLabel = t('config.group.' + group.name) || group.name;
    card.innerHTML = '<div class="config-group-title">' + escapeHtml(groupLabel) + '</div>';

    for (const item of group.items) {
      const row = document.createElement('div');
      row.className = 'config-item';

      let valueHtml;
      if (item.readonly) {
        valueHtml = '<span style="color:var(--text-muted)">' + (item.sensitive ? '••••••••' : escapeHtml(item.value || '--')) + '</span>';
      } else if (item.type === 'boolean') {
        const checked = item.value === 'true' || item.hasValue && item.value !== 'false' ? 'checked' : '';
        valueHtml = '<label class="toggle">' +
          '<input type="checkbox" data-key="' + item.key + '" ' + checked + ' onchange="configChanged()">' +
          '<span class="toggle-slider"></span>' +
        '</label>';
      } else if (item.options && item.options.length > 0) {
        valueHtml = '<select class="input" data-key="' + item.key + '" style="width:220px" onchange="configChanged()">' +
          item.options.map(function(option) {
            var selected = option === (item.value || '') ? ' selected' : '';
            var label = option === '' ? t('config.autoDetect') : option;
            return '<option value="' + escapeHtml(option) + '"' + selected + '>' + escapeHtml(label) + '</option>';
          }).join('') +
          '</select>';
      } else if (item.viewable) {
        // Viewable password field (e.g. VNC_PASSWORD) - show real value with toggle
        valueHtml = '<div class="password-wrapper">' +
          '<input type="password" class="input" data-key="' + item.key + '"' +
          ' value="' + escapeHtml(item.value || '') + '"' +
          ' placeholder="' + escapeHtml(item.default || '') + '"' +
          (item.maxLength ? ' maxlength="' + item.maxLength + '"' : '') +
          ' style="width:150px" onchange="configChanged()" oninput="configChanged()">' +
          '<button type="button" class="password-toggle" onclick="togglePasswordVisibility(this)" title="' + t('config.showPassword') + '">' +
          icon('eye', 'icon') +
          '</button>' +
        '</div>';
      } else if (item.sensitive) {
        // Truly sensitive fields (e.g. STEAM_PASSWORD) - never show value
        valueHtml = '<input type="password" class="input" data-key="' + item.key + '" placeholder="••••••••" style="width:150px" onchange="configChanged()">';
      } else {
        valueHtml = '<input type="' + (item.type === 'number' ? 'number' : 'text') + '" class="input" data-key="' + item.key + '"' +
          ' value="' + escapeHtml(item.value || '') + '" placeholder="' + escapeHtml(item.default || '') + '"' +
          ' style="width:150px" onchange="configChanged()" oninput="configChanged()">';
      }

      row.innerHTML =
        '<div>' +
          '<div class="config-label">' + escapeHtml(item.label) + '</div>' +
          '<div class="config-key">' + item.key + '</div>' +
          (item.descriptionKey ? '<div class="config-help">' + escapeHtml(t(item.descriptionKey)) + '</div>' : '') +
          (item.secretManaged ? '<div class="config-help">' + escapeHtml(t('config.readonlySecret')) + '</div>' : '') +
        '</div>' +
        '<div class="config-value">' + valueHtml + '</div>';
      card.appendChild(row);
    }

    container.appendChild(card);
  }

  // Add save button (always visible but starts hidden, shown on change)
  const saveBtn = document.createElement('div');
  saveBtn.style.textAlign = 'right';
  saveBtn.innerHTML = '<button class="btn btn-success" id="saveConfigBtn" onclick="saveConfig()" style="display:none">' + t('config.saveChanges') + '</button>';
  container.appendChild(saveBtn);
}

function configChanged() {
  var btn = document.getElementById('saveConfigBtn');
  if (btn) btn.style.display = '';
}

function togglePasswordVisibility(btn) {
  var wrapper = btn.parentElement;
  var input = wrapper.querySelector('input');
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerHTML = icon('eye-off', 'icon');
    btn.title = t('config.hidePassword');
  } else {
    input.type = 'password';
    btn.innerHTML = icon('eye', 'icon');
    btn.title = t('config.showPassword');
  }
}

async function saveConfig() {
  const updates = {};
  document.querySelectorAll('[data-key]').forEach(function(el) {
    const key = el.dataset.key;
    if (el.type === 'checkbox') {
      updates[key] = el.checked ? 'true' : 'false';
    } else {
      // Include all values, even empty strings (to allow clearing fields)
      updates[key] = el.value;
    }
  });

  if (Object.keys(updates).length === 0) return;

  const data = await API.put('/api/config', updates);
  if (data && data.success) {
    document.getElementById('saveConfigBtn').style.display = 'none';
    // Show restart confirmation dialog instead of just a toast
    showRestartModal();
  } else {
    showToast((data && data.error) || t('toast.configFail'), 'error');
  }
}

function showRestartModal() {
  var modal = document.getElementById('restartModal');
  var title = document.getElementById('restartModalTitle');
  var message = document.getElementById('restartModalMessage');
  var laterBtn = document.getElementById('restartLaterBtn');
  var restartBtn = document.getElementById('restartNowBtn');

  title.textContent = t('config.restartTitle');
  message.textContent = t('config.restartMessage');
  laterBtn.textContent = t('config.restartLater');
  restartBtn.textContent = t('config.restartNow');
  restartBtn.style.display = '';
  restartBtn.disabled = false;

  modal.style.display = '';

  // Close on overlay click
  modal.onclick = function(e) {
    if (e.target === modal) closeRestartModal();
  };
}

function closeRestartModal(silent) {
  document.getElementById('restartModal').style.display = 'none';
  if (!silent) {
    showToast(t('toast.configOk'), 'success');
  }
}

async function confirmRestart() {
  var restartBtn = document.getElementById('restartNowBtn');
  if (restartBtn) {
    restartBtn.disabled = true;
  }

  try {
    const data = await API.post('/api/container/restart');
    if (data && data.success) {
      showToast(t('toast.containerRestarting'), 'success');
      startContainerReconnectPolling();
      return;
    }
    showToast((data && data.error) || t('toast.containerRestartFail'), 'error');
  } catch (error) {
    // If the container stopped before the response fully returned, assume restart is underway.
    showToast(t('toast.containerRestarting'), 'success');
    startContainerReconnectPolling();
    return;
  }

  if (restartBtn) {
    restartBtn.disabled = false;
  }
}

let containerReconnectPoll = null;

function startContainerReconnectPolling() {
  closeRestartModal(true);

  if (containerReconnectPoll) {
    clearInterval(containerReconnectPoll);
  }

  const startedAt = Date.now();
  containerReconnectPoll = setInterval(async function() {
    try {
      const resp = await fetch('/api/auth/status', { cache: 'no-store' });
      if (resp && resp.ok) {
        clearInterval(containerReconnectPoll);
        containerReconnectPoll = null;
        window.location.reload();
        return;
      }
    } catch (error) {}

    if (Date.now() - startedAt > 120000) {
      clearInterval(containerReconnectPoll);
      containerReconnectPoll = null;
      window.location.reload();
    }
  }, 2000);
}

// ─── Mods ────────────────────────────────────────────────────────
async function loadMods() {
  const data = await API.get('/api/mods');
  if (!data) return;

  const list = document.getElementById('modsList');

  // Upload section
  var uploadHtml = `
    <div class="card" style="margin-bottom:16px;padding:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <input type="file" id="modFileInput" accept=".zip" style="display:none" onchange="handleModUpload(this)">
      <button class="btn btn-primary" onclick="document.getElementById('modFileInput').click()">
        ${icon('mods', 'icon')} ${t('mods.upload')}
      </button>
      <span style="color:var(--text-muted);font-size:13px">${t('mods.uploadHint')}</span>
      <span id="modUploadStatus" style="color:var(--text-muted);font-size:13px"></span>
    </div>
  `;

  if (!data.mods || data.mods.length === 0) {
    list.innerHTML = uploadHtml + '<div class="empty-state">' + t('mods.none') + '</div>';
    return;
  }

  list.innerHTML = uploadHtml + data.mods.map(function(m) {
    var deleteBtn = m.isCustom
      ? '<button class="btn btn-sm mod-delete-btn" style="color:#ef4444;border-color:#ef4444" data-folder="' + escapeHtml(m.folder) + '" data-name="' + escapeHtml(m.name) + '">' + icon('trash', 'icon') + ' ' + t('mods.delete') + '</button>'
      : '';
    return '<div class="mod-item">' +
      '<div class="mod-info">' +
        '<div class="mod-name">' + escapeHtml(m.name) + '</div>' +
        '<div class="mod-meta">v' + escapeHtml(m.version) + ' · ' + escapeHtml(m.author || '') + ' · ' + escapeHtml(m.id) + '</div>' +
        (m.description ? '<div class="mod-meta">' + escapeHtml(m.description) + '</div>' : '') +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span class="mod-badge ' + (m.isCustom ? 'custom' : '') + '">' + (m.isCustom ? t('mods.custom') : t('mods.builtin')) + '</span>' +
        deleteBtn +
      '</div>' +
    '</div>';
  }).join('');

  list.querySelectorAll('.mod-delete-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      deleteMod(btn.dataset.folder, btn.dataset.name);
    });
  });
}

async function handleModUpload(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];

  if (!file.name.endsWith('.zip')) {
    showToast('Only .zip files are supported', 'error');
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    showToast('File too large (max 50MB)', 'error');
    return;
  }

  document.getElementById('modUploadStatus').textContent = t('mods.uploading');

  var reader = new FileReader();
  reader.onload = async function() {
    var base64 = reader.result.split(',')[1];
    var data = await API.post('/api/mods/upload', {
      filename: file.name,
      data: base64,
    });

    document.getElementById('modUploadStatus').textContent = '';
    input.value = '';

    if (data && data.success) {
      showToast(getModUploadToast(data), 'success');
      loadMods();
    } else {
      showToast((data && data.error) || t('toast.modUploadFail'), 'error');
    }
  };
  reader.readAsDataURL(file);
}

async function deleteMod(folder, name) {
  if (!confirm(tf('mods.confirmDelete', { name: name }))) return;

  var data = await API.del('/api/mods/' + encodeURIComponent(folder));
  if (data && data.success) {
    showToast(getModDeleteToast(data), 'success');
    loadMods();
  } else {
    showToast((data && data.error) || t('toast.modDeleteFail'), 'error');
  }
}

function getModUploadToast(data) {
  if (data && data.success) {
    if (data.hasManifest) {
      return t('mods.uploadInstalled');
    }
    if (data.noManifest) {
      return t('mods.uploadNoManifest');
    }
    if (data.autoInstallFailed) {
      return t('mods.uploadFallback');
    }
    return t('toast.modUploadOk');
  }

  return t('toast.modUploadOk');
}

function getModDeleteToast(data) {
  if (data && data.success && data.needsRestart) {
    return t('mods.deleteNeedsRestart');
  }

  return t('toast.modDeleteOk');
}

// ─── Actions ─────────────────────────────────────────────────────
async function restartServer() {
  if (!confirm(t('actions.confirmRestart'))) return;
  const data = await API.post('/api/server/restart');
  if (data && data.success) {
    showToast(t('toast.restartOk'), 'success');
  } else {
    showToast(data?.error || t('toast.restartFail'), 'error');
  }
}

async function createBackup() {
  if (lastBackupStatus && lastBackupStatus.state === 'running') {
    showToast(t('toast.backupRunning'), 'warn');
    startBackupStatusPolling();
    return;
  }

  showToast(t('toast.backupStarted'), 'warn');
  const data = await API.post('/api/saves/backup');
  if (data && data.success && data.status) {
    applyBackupStatus(data.status, true);
    startBackupStatusPolling();
    if (data.alreadyRunning) {
      showToast(t('toast.backupRunning'), 'warn');
    }
  } else {
    showToast(data?.error || t('toast.backupFail'), 'error');
  }
}

async function changePassword() {
  const oldPwd = document.getElementById('oldPassword').value;
  const newPwd = document.getElementById('newPassword').value;

  if (!oldPwd || !newPwd) {
    showToast(t('toast.passwordFields'), 'error');
    return;
  }

  const data = await API.post('/api/auth/password', { oldPassword: oldPwd, newPassword: newPwd });
  if (data && data.success) {
    showToast(t('toast.pwdOk'), 'success');
    // Update token
    if (data.token) {
      API.token = data.token;
      localStorage.setItem('panel_token', data.token);
    }
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
  } else {
    showToast(data?.error || t('toast.pwdFail'), 'error');
  }
}

// ─── Utilities ───────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}
