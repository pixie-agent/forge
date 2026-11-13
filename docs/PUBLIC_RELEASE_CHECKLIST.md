# Public repository release checklist

Use this checklist before changing the repository visibility or transferring it to the `pixie-agent` GitHub Organization.

## Licensing and ownership

- [ ] Confirm that Pixie Agent controls the copyright in all platform code being published.
- [ ] Confirm that the PolyForm Noncommercial license and template Apache-2.0 exception match the intended business model.
- [ ] Confirm the commercial licensing contact in `COMMERCIAL-LICENSE.md`.
- [ ] Have counsel confirm how the GitHub Organization is represented in commercial agreements.
- [ ] Establish a contributor license agreement before merging external code.

## Secrets and private data

- [ ] Run a full-history secret scan against every remote ref.
- [ ] Check GitHub Actions artifacts, releases, package registries, container images, Cloud Build logs, and pull-request refs separately.
- [ ] Confirm `.dev.vars`, `.env`, `.wrangler`, service-account JSON, database exports, logs, and marketing source assets are untracked.
- [ ] Rotate any credential found in history before rewriting or deleting that history.
- [ ] Publish from a clean clone or Git transfer, never from an archive of the working directory.

## Repository configuration

- [ ] Create or transfer the repository to `https://github.com/pixie-agent/forge`.
- [ ] Update the local remote only after the Organization repository exists.
- [ ] Enable GitHub secret scanning and push protection.
- [ ] Enable Dependabot alerts and security updates.
- [ ] Protect `main` and `staging` with GitHub rulesets.
- [ ] Require the `CI / check` status and at least one maintainer review on `main`.
- [ ] Prevent force pushes and branch deletion for protected branches.
- [ ] Create a `pixie-agent/maintainers` team, then replace the temporary individual entries in `.github/CODEOWNERS`.
- [ ] Configure private vulnerability reporting if available for the repository.

## Documentation and configuration

- [ ] Verify every README command in a clean clone.
- [ ] Decide whether real production resource IDs remain public in `wrangler.jsonc` or move to a private operations repository.
- [ ] Confirm `web/src/lib/site.ts` contains the intended hosted-service legal identity.
- [ ] Confirm public docs contain no unnecessary cloud IAM member addresses, customer counts, test-user details, or private operational notes.
- [ ] Validate `wrangler.example.jsonc` with `wrangler deploy --dry-run`.

## Validation

- [ ] `npm run bootstrap` succeeds in a clean clone.
- [ ] `npm run check` succeeds.
- [ ] All four package directories report zero known vulnerabilities with `npm audit`.
- [ ] The Agent container builds and starts as the non-root `node` user.
- [ ] A staging generation completes after the pi SDK migration.
- [ ] Generated source export contains `LICENSE` and `THIRD_PARTY_NOTICES.md`.
- [ ] No production deployment is performed as part of repository publication.

## Release

- [ ] Merge this preparation branch through a reviewed pull request.
- [ ] Tag the first public release only after staging acceptance.
- [ ] Publish release notes from `CHANGELOG.md`.
- [ ] Recheck repository visibility, topics, description, homepage, discussions, issues, and security settings after transfer.
