# Self-hosting Forge

This guide deploys an independent Forge installation. It does not grant commercial-use rights. Review the repository [license](../LICENSE) and obtain a [commercial license](../COMMERCIAL-LICENSE.md) before any commercial deployment or business use.

## 1. Prerequisites

- Node.js 22.19+ (below 23) and npm 10+
- A Cloudflare account with Workers, D1, R2, KV, and Durable Objects
- A Google Cloud project with Cloud Run, Cloud Build, Artifact Registry, and Secret Manager
- A supported LLM endpoint and API key
- `npx wrangler` authenticated to your Cloudflare account
- `gcloud` authenticated to the intended Google Cloud project

Optional integrations require separate Google OAuth, Resend, Creem, GA4, or Stripe accounts.

## 2. Prepare the source

```bash
nvm use
npm run bootstrap
cp wrangler.example.jsonc wrangler.jsonc
```

Before building a branded deployment, replace the Pixie Agent hosted-service identity in `web/src/lib/site.ts` with your actual site URL, support contact, legal operator, business name, and country. These values appear on public legal pages. Do not publish false operator details.

Do not place secrets in `wrangler.jsonc`, source files, package scripts, or GitHub Actions YAML.

## 3. Create Cloudflare resources

Choose unique names for your installation:

```bash
npx wrangler d1 create forge-self-hosted
npx wrangler r2 bucket create forge-self-hosted-artifacts
npx wrangler r2 bucket create forge-self-hosted-prompts
npx wrangler kv namespace create forge-self-hosted-appdata
```

Create separate staging resources if you will use `env.staging`:

```bash
npx wrangler d1 create forge-self-hosted-staging
npx wrangler r2 bucket create forge-self-hosted-artifacts-staging
npx wrangler r2 bucket create forge-self-hosted-prompts-staging
npx wrangler kv namespace create forge-self-hosted-appdata-staging
```

Copy the returned D1 and KV IDs into `wrangler.jsonc`. Keep production and staging bindings separate. Wrangler environment bindings do not inherit, so every D1, R2, KV, Durable Object, and variable binding must exist in both sections.

Set `PUBLIC_BASE_URL` to the final Worker URL or custom domain and set `AGENT_URL` after deploying the Agent. Custom-domain routes are optional; when adding `routes`, keep `workers_dev: true` if the workers.dev URL must remain available, and override routes explicitly in staging.

Initialize only a new database with `schema.sql`:

```bash
yes | npx wrangler d1 execute DB --remote --file=schema.sql
yes | npx wrangler d1 execute DB --remote --env staging --file=schema.sql
```

For an existing database, use the required incremental `schema.migrate-*.sql` files instead. Never run `schema.sql` as an upgrade procedure. The orchestration feature in particular needs `schema.migrate-pipeline.sql` (creates the `platform_pipeline` table behind `/admin/pipeline`):

```bash
yes | npx wrangler d1 execute DB --remote --file=schema.migrate-pipeline.sql
yes | npx wrangler d1 execute DB --remote --env staging --file=schema.migrate-pipeline.sql
```

The `PROMPTS` R2 bucket hosts the prompt tree, named-agent registry, and MCP config (`promptset.zip`, `agentset.json`, `mcpset.json`); create it even if you do not plan to customize those yet, since the Worker resolves `env.PROMPTS` at runtime.

## 4. Create shared secrets

Generate a high-entropy shared secret, for example:

```bash
openssl rand -hex 32
```

Store the same value as `AGENT_SECRET` in Cloudflare and Google Secret Manager. Do not paste it into shell history when avoidable.

Cloudflare production:

```bash
npx wrangler secret put AGENT_SECRET
npx wrangler secret put ADMIN_PASSWORD       # optional admin interface
npx wrangler secret put RESEND_API_KEY        # optional email verification
npx wrangler secret put GOOGLE_CLIENT_ID      # optional Google sign-in
npx wrangler secret put GOOGLE_CLIENT_SECRET  # optional Google sign-in
npx wrangler secret put CONNECTOR_KEK         # optional connectors
npx wrangler secret put CREEM_API_KEY          # optional billing
npx wrangler secret put CREEM_WEBHOOK_SECRET   # optional billing
```

Repeat each enabled secret with `--env staging` for staging. Wrangler secrets do not inherit between environments.

When Resend is enabled, `EMAIL_FROM` is also required and its domain must be verified. Forge no longer falls back to the Pixie Agent hosted-service sender.

## 5. Deploy the Agent

Enable the required Google Cloud APIs:

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

Create secrets using your own values:

```bash
printf '%s' "$LLM_API_KEY" | gcloud secrets create forge-llm-api-key --data-file=-
printf '%s' "$AGENT_SECRET" | gcloud secrets create forge-agent-secret --data-file=-
```

If a secret already exists, add a new version rather than creating it again.

A minimal Cloud Run deployment is:

```bash
gcloud run deploy forge-self-hosted-agent \
  --project "$PROJECT_ID" \
  --source agent \
  --region "$REGION" \
  --timeout 3600 \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 1 \
  --cpu 1 \
  --memory 1Gi \
  --allow-unauthenticated \
  --set-env-vars "LLM_BASE_URL=$LLM_BASE_URL,LLM_MODEL=$LLM_MODEL,PI_LLM_API=$PI_LLM_API,PI_PROVIDER_ID=forge,AGENT_MAX_RUN_MS=1500000,WORKSPACE_ROOT=/tmp/forge-agent" \
  --set-secrets "LLM_API_KEY=forge-llm-api-key:latest,AGENT_SECRET=forge-agent-secret:latest"
```

The current Worker authenticates Agent requests with `X-Agent-Secret`, so the basic deployment uses publicly reachable Cloud Run ingress. Cloud Run IAM/OIDC invocation requires an additional identity integration that this repository does not currently provide. Treat the shared secret as a production credential, rotate it, monitor rejected requests, and limit ingress upstream where practical.

Set the resulting service URL as `vars.AGENT_URL` in `wrangler.jsonc`. `AGENT_URL_FREE` is optional; when absent, both channels use `AGENT_URL`.

## 6. Deploy the Worker

Review the target account and every resource ID before continuing. The production deployment guard requires the `main` branch and a clean worktree, so commit your non-secret resource configuration first.

```bash
npm run typecheck
npm run build
npm run deploy
```

Deploy staging independently:

```bash
npm run deploy:staging
```

Do not reuse Pixie Agent's Worker names, domains, D1 databases, R2 buckets, KV namespaces, Cloud Run services, products, analytics tokens, or secrets.

## 7. Optional integrations

### Email verification

Set `RESEND_API_KEY` as a Worker secret and `EMAIL_FROM` as a variable. The sender domain must be verified by Resend. Without the key, registration records can be created but verification messages cannot be delivered. For local-only development without an email provider, README documents how to mark a newly created local D1 account as verified; never use that command against a remote database.

### Google sign-in

Create a Web OAuth client with this redirect URI:

```text
${PUBLIC_BASE_URL}/api/auth/google/callback
```

Set both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; the login option is hidden if either value is absent.

### Billing

Creem requires `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, `CREEM_API_BASE`, and a `CREEM_PRODUCTS` mapping containing your own product IDs. An empty mapping leaves checkout unavailable.

### Connectors

Set a random `CONNECTOR_KEK`. Rotating it invalidates existing encrypted connector credentials. Provider-specific OAuth clients must use callback URLs under your own `PUBLIC_BASE_URL`.

## 8. Security checks

Before exposing an installation:

- use distinct production and staging secrets;
- confirm no `.dev.vars`, `.env`, service-account JSON, database, or Wrangler state is tracked;
- protect the admin login with a high-entropy password and deployment-level rate limiting;
- review `src/lib/appdata.ts`: published application data APIs are anonymous by design and support writes;
- do not store confidential data in generated-application DB, KV, counter, or blob endpoints;
- configure Cloudflare rate limits and alerts appropriate to your traffic;
- scan the final Worker bundle and Cloud Run image for vulnerabilities and licenses;
- back up D1 and R2 before applying migrations.

See [SECURITY.md](../SECURITY.md) for reporting and trust-boundary details.
