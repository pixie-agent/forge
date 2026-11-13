# Security policy

## Supported version

Security fixes are made on the current `main` branch. Older commits and self-hosted deployments are not maintained as separate supported release lines unless a commercial agreement says otherwise.

## Reporting a vulnerability

Send a private report to **security@1forgen.site** with:

- the affected commit or deployed URL;
- reproduction steps and expected impact;
- whether credentials or personal data may be exposed;
- any suggested mitigation.

Do not open a public issue for an unpatched vulnerability. Do not include production secrets, access tokens, private user content, or unredacted database exports. You may open a minimal public issue asking for a private contact channel if email is unavailable.

We will acknowledge a report when practical, investigate it, and coordinate disclosure after a fix is available. This repository does not currently promise a fixed response SLA or a bug bounty.

## Deployment security notes

- `.dev.vars`, `.env`, cloud credentials, service-account keys, database exports, and local Wrangler state must never be committed.
- `AGENT_SECRET`, all `LLM_API_KEY*` values, `ADMIN_PASSWORD`, OAuth client secrets, Creem secrets, `RESEND_API_KEY`, and `CONNECTOR_KEK` must be stored in Cloudflare secrets or Google Secret Manager.
- Cloud Run is currently network-accessible in the maintainer deployment and protects `/run` with `X-Agent-Secret`. Self-hosters should prefer an identity-aware ingress where possible and rotate the shared secret regularly.
- Generated applications run in a CSP sandbox. Their `/s/:slug/api` data endpoints are intentionally accessible without the Forge account cookie. Do not store confidential data there, and review `src/lib/appdata.ts` before exposing write-capable applications to untrusted visitors.
- The admin interface is disabled when `ADMIN_PASSWORD` is absent. If enabled, use a high-entropy value and add deployment-level rate limiting.

## Scope

The licenses in this repository provide no authorization to test systems, accounts, data, or deployments you do not own or have explicit permission to assess.
