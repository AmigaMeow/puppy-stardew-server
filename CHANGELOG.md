# Changelog

## v1.1.1 (September 2026)

First release since the project was frozen as best-effort maintained (v1.1.0 was an unreleased version bump). Ships the accumulated security hardening, dependency updates, and bug fixes.

### Security
- Hardened the web panel and manager service: optional manager shared secret (`MANAGER_SECRET`), security response headers, sanitized error messages, and hardened backup download path resolution (#7, #8).
- Backup downloads now use short-lived signed download tokens instead of long-lived JWTs in URLs (#7).
- Added per-IP API rate limiting for the web panel, configurable via `API_RATE_LIMIT` (default 120 req/min) (#7).
- Prometheus metrics port now binds to `127.0.0.1` by default; set `METRICS_BIND_HOST=0.0.0.0` to expose it to a remote scraper (#8).
- Status endpoint validates `pgrep` output as a bare numeric PID before use.

### Updated
- SMAPI 4.3.2 → 4.5.2 (requires Stardew Valley 1.6.14+; server ships game 1.6.15) (#9).
- VNC password is auto-generated when `VNC_PASSWORD` is left empty and persisted to `web-panel/data/vnc_password.txt` (#10, #11).

### Bug Fixes
- Fixed ~25% CPU busy-loop in the status reporter when `nc` (netcat) is missing from the image (#4): the metrics loop now warns once and polls slowly, and backs off if `nc` fails immediately.
- Fixed player count arithmetic error in the status reporter when the SMAPI log has zero join/quit matches (follow-up to #9).

## v1.0.77 (March 2026)

### Bug Fixes
- Fixed `status.json` player count output so the web panel status file stays valid JSON when no players are connected.

## v1.0.76 (March 2026)

### New Features
- Added first-run password bootstrap for the web panel with persistent auth data storage.
- Added save archive upload, default save selection, and direct backup download from the web panel.
- Added a manager service so runtime config changes from the panel can trigger a real container rebuild/restart.

### Improvements
- Refined one-click setup output to match the new panel-first workflow and prefer IPv4 connection hints.
- Improved dashboard, logs, mod management, backup UX, and runtime status reporting in the web panel.
- Added default headless audio/OpenAL environment fallbacks to reduce noisy startup errors in clean Docker environments.

### Bug Fixes
- Fixed categorized log routing and fallback parsing when pre-split log files are missing.
- Fixed player counting and display for the current SMAPI connection log formats.
- Fixed config persistence paths, VNC exposure handling, and custom mod write/delete behavior.

## v1.0.66 (March 2026)

### New Features
- **Crash Auto-Restart**: Game automatically restarts on crash with rate limiting (max 5 restarts per 5 minutes). Enable via `ENABLE_CRASH_RESTART=true`
- **Prometheus Metrics**: Real-time server metrics exposed on port 9090 (`/metrics` endpoint). Tracks players online, uptime, CPU/memory, game events
- **Save Selector**: Auto-load specific saves via `SAVE_NAME` environment variable
- **Custom Mods Support**: Install your own mods by placing them in `data/custom-mods/` (supports directories and .zip files)
- **Player Access Control**: Whitelist/blacklist players via `player-access.conf` config file
- **Init Container**: Separate init container handles permission fixes before main server starts
- **Docker Secrets**: Support for `/run/secrets/` as secure alternative to plaintext `.env` credentials

### Improvements
- **Optimized Docker Image**: Consolidated layers, removed unused packages (tmux, expect, x11-apps), aggressive cleanup of docs/locale/man
- **Reduced Container Privileges**: Dropped NET_RAW, SYS_ADMIN, MKNOD capabilities
- **Simplified Root Phase**: Entrypoint Phase 1 only handles GPU Xorg + user switch; permission fixes delegated to init container

### Bug Fixes
- Fixed 7 scripts missing executable permissions (auto-enable-server.sh, etc.)
- Fixed netcat `-p` flag incompatible with netcat-openbsd on Ubuntu 22.04
- Fixed entrypoint.sh step numbering mismatch (Step 4 labeled as Step 5)
- Fixed VNC_PASSWORD default inconsistency between docker-compose.yml and .env.example
- Fixed Dockerfile COPY wildcard duplicating entrypoint.sh to scripts/ directory
- Removed redundant permission-fixing code from entrypoint.sh (now handled by init container)

### Configuration Changes
- New env vars: `ENABLE_CRASH_RESTART`, `MAX_CRASH_RESTARTS`, `SAVE_NAME`, `METRICS_PORT`
- New port: `9090/tcp` (Prometheus metrics)
- New volume: `data/custom-mods` (read-only mount)
- New docker-compose service: `stardew-init` (init container)
- Unified VNC_PASSWORD default to `stardew1` across all files

---

# v1.0.21 Release Notes

## 主要改进

### 自动权限修复
- 容器以 root 启动，自动修复挂载卷权限
- 无需手动运行 init.sh 或 chown 命令
- 自动切换到 steam 用户运行游戏

### 提升可靠性
- 修复游戏存在时的容器重启循环问题
- 改进错误处理和日志输出

## 升级说明

从 v1.0.20 升级到 v1.0.21：
```bash
docker-compose down
docker-compose pull
docker-compose up -d
```

无需其他操作！
