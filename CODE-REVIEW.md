# Code Review

Date: 2026-03-09

> **Update (wrap-up):** The three High-severity findings (#1, #2, #3) have been
> addressed. See the per-finding **Status** notes below. The Medium/Low items
> remain open and are documented for future reference (the project is now
> feature-frozen — see the README "Project Status" section).

## Findings

### 1. High: `PUT /api/config` allows arbitrary `.env` injection and persistence of unsupported keys

Files:
- [docker/web-panel/api/config.js](/root/puppy-stardew-server/docker/web-panel/api/config.js#L141)
- [docker/web-panel/api/config.js](/root/puppy-stardew-server/docker/web-panel/api/config.js#L79)

`updateConfig()` only blocks keys marked `readonly`, then passes the remaining request body straight into `writeEnvFile()`. `writeEnvFile()` writes `key=value` lines without any allowlist, type validation, or CR/LF sanitization. An authenticated caller can therefore:

- add arbitrary environment variables that the UI never exposes,
- inject newlines into a value and append extra variables,
- corrupt the `.env` format for subsequent restarts.

This is a real privilege-expansion path inside the app because the config endpoint is intended to edit a narrow schema, but currently persists any key/value pair the caller sends.

Recommended fix:
- reject any key not present in `CONFIG_SCHEMA`,
- validate values by field type and range,
- reject `\r` / `\n` in keys and values before writing,
- write through a temp file and rename to avoid partial writes.

**Status: Resolved.** `updateConfig()` now builds the write set strictly from the `CONFIG_SCHEMA` allowlist (unknown keys are ignored), rejects values containing CR/LF, and `writeEnvFile()` writes atomically via a temp file + rename with a defensive CR/LF guard.

### 2. High: the panel still ships with a known default password and logs it in plaintext

Files:
- [docker/web-panel/auth.js](/root/puppy-stardew-server/docker/web-panel/auth.js#L41)
- [docker/web-panel/server.js](/root/puppy-stardew-server/docker/web-panel/server.js#L174)
- [docker-compose.yml](/root/puppy-stardew-server/docker-compose.yml#L91)
- [README.md](/root/puppy-stardew-server/README.md)
- [README_CN.md](/root/puppy-stardew-server/README_CN.md)

First boot hashes `PANEL_PASSWORD` or falls back to `admin123`, and startup logs print the password back out. That means anyone with access to container logs, default docs, or an unchanged deployment can authenticate as admin. This is the highest-risk issue in the current web panel.

Recommended fix:
- remove the default password bootstrap entirely,
- require a first-run setup flow,
- never print panel secrets to logs,
- update docs and compose examples to stop advertising a shared default secret.

**Status: Resolved (in an earlier release).** `auth.js` now requires a first-run setup flow (`needsSetup`, `passwordHash: null`) with no `admin123` fallback, and `server.js` no longer prints the panel password. Verified no `admin123` references remain in code.

### 3. High: VNC access defaults to a weak password and the password is echoed to logs

Files:
- [docker/scripts/entrypoint.sh](/root/puppy-stardew-server/docker/scripts/entrypoint.sh#L378)
- [docker/scripts/entrypoint.sh](/root/puppy-stardew-server/docker/scripts/entrypoint.sh#L396)
- [docker-compose.yml](/root/puppy-stardew-server/docker-compose.yml#L57)

When `ENABLE_VNC=true`, the container defaults to `stardew1`, then prints the effective password to stdout. That exposes a remotely reachable control channel through normal container logs and gives deployments a well-known default credential.

Recommended fix:
- require an explicit VNC password when VNC is enabled or generate a one-time secret,
- stop logging the password,
- document VNC as an optional, temporary setup surface rather than a default-on service.

**Status: Resolved.** When `VNC_PASSWORD` is unset, `entrypoint.sh` now generates a random password at startup and writes it to `web-panel/data/vnc_password.txt` (mode 0600) instead of printing it to logs. The weak `stardew1` default was removed from `entrypoint.sh`, `vnc-monitor.sh`, `docker-compose.yml`, `.env.example`, the config-panel schema, and the README examples.

### 4. Medium: backup downloads from the UI are broken, and the current token flow would leak if fixed naively

Files:
- [docker/web-panel/public/js/app.js](/root/puppy-stardew-server/docker/web-panel/public/js/app.js#L449)
- [docker/web-panel/server.js](/root/puppy-stardew-server/docker/web-panel/server.js#L70)
- [docker/web-panel/auth.js](/root/puppy-stardew-server/docker/web-panel/auth.js#L197)

The saves page builds download links as `/api/saves/download/<file>?token=<jwt>`, but the backend only accepts `Authorization: Bearer ...`. As shipped, the button cannot authenticate successfully. If the server were later changed to accept `?token=`, the JWT would be exposed in browser history, logs, and referrers.

Recommended fix:
- download through `fetch()` with the bearer header and stream a blob to the browser, or
- mint a short-lived one-time download token specifically for file downloads.

### 5. Medium: log reads are synchronous whole-file loads, which will block the panel on large SMAPI logs

Files:
- [docker/web-panel/api/logs.js](/root/puppy-stardew-server/docker/web-panel/api/logs.js#L37)

`getLogs()` loads the entire log file into memory on every request, splits it, filters it, then slices the tail. SMAPI logs can grow large enough that this blocks the Node event loop and spikes memory use, especially with the current 300-line polling/search behavior in the UI.

Recommended fix:
- implement bounded tail reading instead of `readFileSync`,
- cap search requests or index logs separately,
- avoid synchronous file I/O on request paths.

### 6. Medium: documented container resource limits may not apply in normal `docker compose` deployments

Files:
- [docker-compose.yml](/root/puppy-stardew-server/docker-compose.yml#L154)

The compose file uses `deploy.resources`, which is not enforced in many non-Swarm `docker compose` setups. Users can believe the container is capped at 2 CPU / 2 GB when it may actually run unconstrained.

Recommended fix:
- use Compose settings that are enforced in the target runtime, or
- document clearly that these limits require Swarm or compatibility mode.

## Open Questions

- Whether the panel is intended to be exposed directly to the public internet or only behind a reverse proxy/VPN materially changes the urgency of the VNC and JWT transport issues.
- The config editor appears intended for a fixed schema, so I treated arbitrary key persistence as a bug rather than an advanced feature.

## Testing Gaps

- No automated tests cover auth bootstrap, password changes, config writes, or backup download flows.
- The frontend has no regression coverage for token handling, localization, or file download behavior.
