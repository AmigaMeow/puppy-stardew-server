# Repository Guidelines

## Project Structure & Module Organization

Core runtime files live at the repo root: [`docker-compose.yml`](docker-compose.yml), [`.env.example`](.env.example), and the one-click installers [`quick-start.sh`](quick-start.sh) and [`quick-start-zh.sh`](quick-start-zh.sh).  
Container build assets are under [`docker/`](docker): startup scripts in [`docker/scripts/`](docker/scripts), preinstalled mods in [`docker/mods/`](docker/mods), web panel backend/frontend in [`docker/web-panel/`](docker/web-panel), and the restart helper service in [`docker/manager/`](docker/manager).  
Tests are shell-based in [`tests/`](tests). Screenshots and docs assets live in [`screenshots/`](screenshots). Do not commit runtime data from `data/` or vendored code under `docker/web-panel/node_modules/`.

## Build, Test, and Development Commands

- `docker-compose up -d --build`: build and start the full stack locally.
- `docker-compose down`: stop containers before switching branches or test environments.
- `bash tests/test-new-features.sh`: run the repository’s shell test suite without launching the game.
- `bash -n docker/scripts/*.sh quick-start.sh quick-start-zh.sh`: syntax-check Bash scripts.
- `node --check docker/web-panel/server.js docker/web-panel/api/*.js docker/web-panel/public/js/*.js`: syntax-check panel JavaScript.
- `docker-compose config`: validate rendered Compose configuration before release.

## Coding Style & Naming Conventions

Use 2 spaces for JSON/HTML/CSS and 4 spaces only where an existing shell block already uses it. Keep shell scripts POSIX-friendly Bash; prefer lowercase snake_case for functions and variables like `get_player_count`. In the web panel, follow the existing plain-JS structure: API handlers in `api/*.js`, browser logic in `public/js/*.js`, and CSS variables/themes in `public/css/style.css`. Avoid adding new dependencies unless necessary.

## Testing Guidelines

Add or extend tests in [`tests/test-new-features.sh`](tests/test-new-features.sh) when changing shell/runtime behavior. Name test helpers after the script or feature they cover. For web panel changes, pair static checks (`node --check`) with a brief manual verification note in the PR if browser interaction is affected.

## Commit & Pull Request Guidelines

Recent history uses short, imperative summaries like `Release v1.0.77 status reporter hotfix` and `Improve web panel workflows and server operations`. Follow that style: lead with the user-facing outcome, keep the subject concise, and avoid noisy prefixes. PRs should include:

- a short summary of behavior changes;
- linked issue(s) when applicable;
- screenshots for UI changes;
- note of any Docker rebuild, migration, or config impact.

## Security & Configuration Tips

Never commit real secrets, Steam credentials, tokens, `.env`, or anything under `data/`. Use `.env.example` for placeholders only. If changing auth, config persistence, networking, or VNC exposure, verify both the web panel flow and the rendered Compose config before merging.
