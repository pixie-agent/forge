# Contributing to Forge

Forge is maintained by [Pixie Agent](https://github.com/pixie-agent). Issues and pull requests are welcome, subject to the licensing note below.

## Before contributing

1. Search existing issues and pull requests.
2. Keep changes focused; do not include unrelated refactors.
3. Never commit secrets, production data, `.dev.vars`, `.env`, `.wrangler`, database files, or cloud credentials.
4. For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development setup

Use Node.js 22.19 or newer (below 23) and npm 10. From the repository root:

```bash
npm run bootstrap
cp .dev.vars.example .dev.vars
cp agent/.env.example agent/.env
npm run db:init:local
```

Then run the agent, Worker, and web app in separate terminals as described in [README.md](README.md). Before submitting a pull request, run:

```bash
npm run check
```

## Project rules

- Existing databases must use incremental `schema.migrate-*.sql` migrations. `schema.sql` is for new databases.
- Add every Cloudflare binding to both the top-level environment and `env.staging`; bindings do not inherit.
- Keep production and staging differences in runtime configuration, never Vite build-time variables.
- User-facing Web copy must use `web/src/lib/i18n/`; the seven `/admin` pages intentionally remain Chinese-only.
- Update `docs/FORGE2.md` whenever platform behavior, deployment, or resource topology changes.
- Do not run production deployment commands from a contribution branch. External contributors do not need access to Pixie Agent's staging or production accounts.

## Pull requests

Include the purpose, affected components, validation output, schema/config impact, screenshots for visible UI changes, and rollback notes where relevant. Maintainers may request smaller commits or a focused follow-up.

## Contribution licensing

The platform is source-available under PolyForm Noncommercial 1.0.0 and Pixie Agent also offers separate commercial licenses. To preserve the ability to issue those licenses, Pixie Agent must establish an appropriate contributor license agreement before merging third-party code contributions.

Until that process is published, external code pull requests may be reviewed but will not be merged. Documentation, issue reports, and design feedback that do not contribute copyrightable code are still welcome. Do not interpret submission of a pull request as acceptance or as transfer of copyright.
