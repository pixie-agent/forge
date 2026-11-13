# Changelog

This file records user-visible platform, deployment, security, and licensing changes. Forge does not yet publish a stable release series; changes remain under `Unreleased` until the first tagged release.

## Unreleased

### Added

- PolyForm Noncommercial 1.0.0 platform licensing and a separate commercial-licensing path.
- Added the generated template lockfile and complete runtime dependency notices to source exports and published artifacts.
- Public contribution, security, support, conduct, issue, pull-request, ownership, CI, and dependency-update configuration.
- Reproducible local bootstrap with Node.js 22.19+, all-package validation, and self-hosting documentation.
- A generic `wrangler.example.jsonc` for independent deployments.

### Changed

- Migrated the Agent SDK from the deprecated `@mariozechner` package scope to `@earendil-works/pi-coding-agent`.
- Added production guards to both Cloud Run production deployment commands.
- Switched Agent container dependency installation to `npm ci` and the final process to a non-root user.
- Removed 1forgen email identity fallbacks; sending now requires explicit runtime configuration.
- Fixed local Agent startup to compile TypeScript before running `dist/index.js`; direct strip-types execution could not resolve the source `.js` import specifiers.
- Fixed local free-channel dispatch so `.dev.vars.example` explicitly overrides the maintainer production `AGENT_URL_FREE` with `http://localhost:8080`.
- Added an explicit `pending → running` handshake, immediate settlement for definitive Agent response errors, and request/SSE-driven stale-job settlement so users cannot wait indefinitely when cron is absent.

### Security

- Updated compatible dependency versions until all four npm projects report zero known vulnerabilities through `npm audit`.
