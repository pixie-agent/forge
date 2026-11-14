# Forge Connectors Design

> Status: **v0 (framework + GA4) and v0.1 (`apikey` form + Stripe bring-your-own-key) are implemented and deployed to staging** (2026-10-19). For the platform-side implementation and runtime constraints see `docs/FORGE2.md` §19.
> This document answers four things: what connectors are, how this version of Forge does them, why the interactions are designed this way, and **what is explicitly out of scope**.
> For background and trade-offs see `docs/DESIGN.md` (thin-bearer model) and `docs/FORGE2.md` (generation pipeline and data layer).

---

## 0. TL;DR

| Question | Answer |
| --- | --- |
| Is this MCP? | **No.** MCP is a tool protocol for LLM clients; a static page in a browser is not an MCP client, and agent-side pi explicitly says "No MCP" (`pi-coding-agent/README.md:446`). Connectors = platform-written provider adapters. |
| Do third-party systems generally offer MCP? | First-tier SaaS (Stripe/Linear/Notion/GitHub/Cloudflare/Sentry) mostly do, **the long tail basically does not**; and even where it exists, it is a channel for "letting the agent operate *your own* account", **not a visitor payment channel**. So "wait for them to offer MCP" is not a dependable extension path. |
| Does every connector need platform-side adaptation? | **No.** Two categories: the `oauth` form requires the platform to register an OAuth client for that provider (approval/callback overhead); the **`apikey` form requires zero platform-side registration** — the user generates a key in the provider's console and pastes it in; the platform only does encrypted storage and generation-time delivery. **The long tail always goes through `apikey`.** |
| Does the platform custody payment keys for users? | **No custody of funds closure**: no runtime proxy, never touches money. But keys users **bring themselves** (e.g. their own Stripe `sk_`) are stored encrypted on the platform, used **only during generation**, discarded after; payments go straight into the user's own account. |
| Are connections account-level or project-level? | Account-level connections + project-level bindings. One Stripe/Google account can serve multiple projects, avoiding n integrations for n projects. |
| Do users pick connectors on every generation? | **No.** Once bound, everything applies by default; per-turn toggles only "temporarily disable / temporarily enable". **Read-only defaults on; writable defaults to asking.** |
| Why was GA4 first? | Read-only, zero funds risk, validates both the "inject public values" and "read real data during generation" paths, and **provokes no platform-side backend at all**. |
| Why was Stripe (bring-your-own-key) second? | It is the template case for the `apikey` form: the key is created in the provider's own console, needs no platform registration, and naturally splits into "publishable (delivered to the page) + secret (generation-time only)" — validating both channels in one shot. |

Admission criteria (two rules; every future provider follows them):

1. **Capabilities without external side effects default to on; those with side effects default to ask** (writable = create products / push repos / refunds).
2. **Only things requiring authorization are connectors; entering an ID is configuration** (the latter stays out of the `connections` table and has no OAuth flow).

---

## 1. Two axes: don't use MCP in the wrong place

| Axis | Who calls the external system | When | MCP's place |
| --- | --- | --- | --- |
| **A. Generation time** | the agent (the model writing code in Cloud Run) | the minutes spent generating/editing code | Plausible, but unused in v0 (see §3) |
| **B. Run time** | the generated site (static page visitors open) | every visit after launch | Not applicable |

Industry state (as of 2026-09): first-tier SaaS mostly ship official MCP servers (Stripe `mcp.stripe.com`, Linear / Notion / GitHub / Cloudflare / Sentry), an ecosystem of 130k+ servers — but that is **for agents operating your own account** (creating products, refunds, reading reports), **not a visitor payment channel**. Visitor payments go through Checkout / Payment Links and have nothing to do with MCP. Long-tail small systems generally have no MCP and would have to be wrapped yourself.

**So the answer to "is it MCP?" is: the connector panel is not an MCP store, and a short list is the norm** — every provider takes manual integration work, documentation, and quirk-handling, regardless of whether they have MCP.

---

## 2. Three connector forms (an order of magnitude apart in cost)

| Form | Examples | Credentials required | Platform backend needed at run time? |
| --- | --- | --- | --- |
| **A. Pure injection** | GA4's `G-XXXX`, Stripe Payment Link, map keys | all public values | No |
| **B. Generation-time auth** | GA4 Data API, Search Console, GitHub | OAuth, **used once and discarded** | No |
| **C. Run-time closure** | Stripe Checkout + webhook, Supabase | contains secrets, **must be held server-side** | platform proxy **or** user-supplied |

Phasing follows A → B → C.

### 2.1 The other axis: auth method `auth` (decides platform-side cost)

Form describes "what the connector does"; **auth method describes "how much the platform must do for it"** — the two are orthogonal:

| `auth` | Who provides credentials | Platform-side cost | Examples |
| --- | --- | --- | --- |
| `config` | user enters a non-secret value | zero (doesn't even enter the schema) | GA4 `measurementId`, payment links |
| `oauth` | user authorizes an external account | **platform must register an OAuth client + callback URL** (often with approval) | GA4, GitHub |
| `apikey` | **user generates the key in the provider's console and pastes it** | **zero registration, zero approval, no schema change** | Stripe, Supabase, all kinds of long-tail SaaS |

**This is the single most important extension strategy in this design**: `oauth` is reserved for the few providers that "only support OAuth / are worth the platform registering"; **everything else is `apikey`**. Since the user already has an account in the provider's console, the cost of copying a key is far lower than the platform running client applications and callback registration for every provider — the latter can never scale to the long tail.

`apikey` reuses the entire `oauth` storage chain (same `connections` table, same AES-GCM encryption, same `resolveGrants`); the only difference is where credentials come from: an "upstream-exchanged token" becomes a "user-pasted key".

---

## 3. Why not implement with MCP

- **pi has no MCP, deliberately**: `pi-coding-agent/README.md:446` "**No MCP.** Build an extension that adds MCP support". The current session mounts only `createCodingTools` (`agent/src/session.ts:94`); the tool set is read/write/edit/bash/find/grep/ls.
- Wiring MCP means writing a pi extension (`defineTool` / `ExtensionFactory`, `pi-coding-agent/dist/core/extensions/types.d.ts:311,913`) — **possible, but not worth it in v0**. The same capability is validated with "platform-injected credentials + prompt explanation + agent's own bash", while an MCP client drags in three new problem domains: process lifecycle, auth, and tool-name collisions.
- **An escape hatch remains**: if generation-time providers exceed 3 and the prompt starts ballooning, fold them into a platform pi extension (or an MCP client). The trigger is "the connectors section of the prompt exceeds ~1KB" or "providers ≥ 4", not "everyone else is doing it".

---

## 4. Data model

```sql
-- Account level: one Google/Stripe account reusable by many projects; switching accounts changes it here only
CREATE TABLE IF NOT EXISTS connections (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  provider      TEXT NOT NULL,                    -- ga4 | stripe | github | supabase
  account_label TEXT NOT NULL,                    -- "acme.com" / "me@x.com", display only
  scopes        TEXT NOT NULL DEFAULT '',         -- stored so "read-only / writable" can be shown
  credentials   TEXT NOT NULL,                    -- JSON, AES-GCM ciphertext (public values take the same path, for uniformity)
  status        TEXT NOT NULL DEFAULT 'active',   -- active | revoked | error
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, provider, account_label)
);

-- Project level: decides "what this project's next generation automatically includes"
CREATE TABLE IF NOT EXISTS project_connectors (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  provider    TEXT NOT NULL,
  env         TEXT NOT NULL DEFAULT 'live',       -- draft | live, same convention as the data layer
  config_json TEXT NOT NULL DEFAULT '{}',         -- non-secret config: measurementId / paymentLink / connectionId
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, provider, env)
);
```

Three deliberate decisions:

1. **The `env` dimension is mandatory**, exactly matching `p:{projectId}:{env}:` (KV), `appdata/{projectId}/{env}/` (R2), `${projectId}:${env}` (DO). Without this column, "draft test payments hitting the real account" will happen eventually.
2. **Credentials live in D1, not Worker secrets.** Worker secrets are **global and write-only** (AGENTS.md §2); they physically cannot hold per-user credentials. The cost: the platform master key (`CONNECTOR_KEK`, a new secret) can decrypt everyone's tokens — **this trust model must be stated on the authorization page, not hidden** (see §8).
3. **Public values and secrets share one storage path**, distinguished by provider-declared `secretFields` that mark what gets delivered to the frontend — so adding a provider never requires a schema change.

---

## 5. Provider definitions: adding a provider = adding a file

```ts
// src/lib/connectors/providers/ga4.ts
export default {
  id: 'ga4',
  name: 'Google Analytics 4',
  blurb: '让 agent 读到真实访问数据,生成的应用也能上报',
  auth: 'oauth',                     // 'oauth' | 'apikey' | 'config'
  scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  writeScopes: [],                   // non-empty → "writable", not auto-included by default (§7)
  configFields: [                    // non-secret; public:true entries get injected into generated pages (§6a)
    { key: 'measurementId', label: '数据流 ID', public: true },
  ],
  secretFields: ['accessToken', 'refreshToken'], // → never enters the bundle
  agentHint: '...',                  // generation-time prompt fragment (§6b)
}
```

The `apikey` form adds a `secretInputs`: declares "which secret items the user should paste", and the panel renders password boxes accordingly:

```ts
// src/lib/connectors/providers/stripe.ts
export default {
  id: 'stripe',
  auth: 'apikey',
  writeScopes: ['payment_links.write'],   // creating payment links with sk_ is a real side effect → writable, not included by default
  configFields: [{ key: 'publishableKey', public: true }],   // pk_ → delivered with the page
  secretInputs: [{ key: 'secretKey', label: 'Secret key', required: true, hint: '…' }],
  secretFields: ['secretKey'],            // → only into .forge/connectors.json, never into the bundle
  agentHint: '用 curl 建 product/price/payment_link,把返回的公开 URL 写进按钮…',
}
```

**Form A is not called a connector**: providers with `auth: 'config'` (GA4's measurementId, Stripe Payment Link) are just **project configuration** — no row in `connections`, no OAuth flow, just an input box in the UI. Only `auth: 'oauth'` / `'apikey'` go through "connect".

---

## 6. Three runtime paths

### a) public values → injected into generated pages

`injectRuntime()` in `src/lib/artifacts.ts` injects one more global:

```js
window.__FORGE_CONNECTORS__ = { ga4: { measurementId: "G-XXXX" } }
```

The SDK lives at `agent/template/src/lib/connectors.js` — that directory is **chosen deliberately**: `restorePlatformFiles()` force-restores `src/lib/*`, so the model can only "use" it and cannot break it — the same guarantee as `forge.js`.

### b) the agent reads real data during generation

`AgentRunRequest` (`src/lib/agent.ts`) gains a field, assembled by `launchJob` in `src/routes/generate.ts`:

```ts
connectors?: { provider: string; accountLabel: string; scopes: string[]; token?: string }[]
```

The agent side writes credentials into `.forge/connectors.json` in the working directory (that directory is in `SKIP_DIRS`: not in the source tree, not in artifacts), and lists "connectors available this run + what they can do" in the system prompt. **Tokens die with the container: never in D1, never in R2, never in versions.**

### c) run-time secrets → `ext` proxy (not in this phase)

By design this lands as an `ext` branch in the switch in `src/lib/appdata.ts` (`/s/:slug/api/ext/:provider/*`), proxied and signature-verified by the platform. **Not in this phase**; reasoning in §0 and §8.

---

## 7. Interaction design: inherit by default; act only to override

### Core rule

> **Inherit from context by default; only overrides require action.**

This rule exists to kill "the user must re-select on every interaction". Today's worst victim inside Forge is **attachments** (re-selected on every message, re-uploaded on retry). Connectors must never become the second one.

### Capability bar (above the Composer)

`web/src/components/ChatPanel.tsx`, same row area as the attachment entry — no second row of controls:

```
┌──────────────────────────────────────────────────┐
│ 🔌 GA4 read-only ✓   Stripe test ✓   + Connect   │  ← highlighted = active this turn
├──────────────────────────────────────────────────┤
│ [ input box                                   ] [Send] │
└──────────────────────────────────────────────────┘
```

| State | Behavior |
| --- | --- |
| Not bound | just a `+ Connect` chip; tapping opens the provider list |
| Bound (read-only) | **all lit by default**, zero user action; tap to grey out = temporarily off this turn, **not persisted** |
| Bound (writable) | not auto-included by default; must be lit for the turn, and a confirmation card pops when the agent triggers a write |
| Job running | chips read-only (steering credentials were fixed at dispatch; no mid-flight swap); hover explains why |
| Turn ended | temporary toggles auto-reset to defaults (same mechanism as the steer input box resetting) |

Chips always carry a permission badge: `read-only` / `writable`.

### Full management lives at project level

A "Connectors" entry in the top bar (alongside "Publish") manages slow variables: switching accounts, revoking authorization, re-uploading keys, what draft/live each use, Form-A configuration. **The conversation bar only toggles; it never configures** — that's a division of labor, not duplication.

### But "the first connection" must not send people to the panel — the in-conversation credential card

The user's own words were "I don't want users filling these in on a settings page". So it splits into two layers:

| Scenario | Completed where | Component |
| --- | --- | --- |
| **First connection of a system** (frequent, one-time) | **in the conversation flow**, without leaving the chat | `web/src/components/ConnectorCard.tsx` |
| Switch accounts / revoke / re-upload / separate draft & live config (infrequent, slow) | top-bar "Connectors" panel | `web/src/components/ConnectorsPanel.tsx` |

Flow: the capability bar's "+ Connect" expands an **inline provider list** (no overlay — mobile viewports would clip it) → pick a provider → a card expands at the end of the conversation flow:

```text
┌─ Connect Stripe ─────────────────────── ✕ ┐
│ Writable · build payment entry with your own key │
│ Connect to:  (draft/test)  (live)                │
│ Credentials for Stripe already saved in your account: │
│   [ 🔑 My Stripe (test)        Connect ▸ ]       │
│ or paste a new key:                              │
│ Secret key *  [ ••••••••••• ]  keep secret       │
│ Name (optional)    [ My Stripe ]                 │
│ Publishable key  [ pk_live_… ] will be public on the page │
│ [Save & connect] [Cancel]                        │
│ The key is only used to call Stripe during generation, stored encrypted… │
└────────────────────────────────────────────┘
```

**Security boundary (the real reason this card exists)**: keys **only go up, never echo back**, and **never travel through the conversation message chain** —
the card POSTs directly to `/api/connections/:provider/secret`; the plaintext **never enters the `messages` table, never enters a prompt, never enters `agent_log`**.
If this were instead "type the key to the agent in the chat box", the same text would simultaneously: land in the D1 messages table, get concatenated into the prompt sent to the model vendor,
and stream back to the frontend via `agent_log` — a triple leak. Identical convenience from the user's view; an order of magnitude apart in security.

Two companion decisions for the card:

- **Default bind is `draft`** (test environment); going live requires explicitly tapping "live" and seeing the reminder "takes effect when visitors open the public page" — consistent with the intent of the `env` column.
- **The card only handles "create new" for the `apikey` / `config` forms; `oauth` gets only a "Go authorize" button** — authorization must jump to the provider's page and can't complete inside the card, but at least you don't have to hunt for the panel.
- **Reuse comes before new creation**: when credentials for that provider already exist on the account, the card's top lists "🔑 <name> → Connect ▸"; one tap writes only a project-level binding — **no key re-upload**; applies to `oauth` too: picking an already-authorized account **skips re-authorization** (the common case of connecting a second project to the same account). Only switching accounts / uploading a new key goes to the input boxes or the authorization page below.
- **Required config is completed inside the card**: the card renders non-secret config inputs for all three forms (`oauth` / `apikey` / `config`); required fields missing keeps "Go authorize / Save & connect" disabled. `oauth` config round-trips with `state` (see §8) and is merged with `connectionId` on callback — otherwise the user returns from tapping "Allow" to "required config missing" and gets sent to the panel anyway.
- On success the card **flips in place to a completed state** (green "🔑 Stripe connected · <name>"), leaving a trace for this turn; it auto-collapses on the next job.

In the panel, the three `auth` forms map to three interactions:

| Form | Panel entry |
| --- | --- |
| `oauth` | "Connect" button → jumps to the external authorization page (on failure the panel offers a copyable callback URL) |
| `apikey` | password box for pasting the key + optional name → "Save & bind"; once saved it collapses, "Re-upload" overwrites/rotates; "Use existing key" binds the account-level connection straight to this project |
| `config` | plain input boxes (non-secret config) |

Saved keys **never echo back** — the panel only knows "key saved · <name>"; the value travels up exactly once, at save time.

### Fixing "per-message re-selection" along the way

- The attachment area gains "reuse previous message's attachments" (reuse when possible, prompt re-upload when not);
- The failure card's "Retry" marks "attachments need re-upload" when the original job carried attachments, instead of silently dropping them.

---

## 8. Security and abuse

| Item | Approach |
| --- | --- |
| OAuth callback | reuse the Google-login machinery in `src/routes/auth.ts`: random `state` in an HttpOnly cookie, compared on callback. `state` additionally carries `projectId~env~non-secret config (base64url)`; on callback it merges with `connectionId` into the DB (without overwriting existing config); config is filtered through a per-provider whitelist, treated as empty if undecodable |
| Default permissions | always read-only; write access requested separately, with an in-conversation second confirmation |
| Revocation | user-initiated revoke + provider returning 401/403 → `status='error'`, frontend prompts to reconnect (no silently generating piles of broken code) |
| Platform proxy rate limits | once the `ext` branch exists it must carry rate limiting + per-project quotas, otherwise it hands users a free outbound gateway (cf. FORGE2 §15.3's existing stance) |
| Prompts | the line at `agent/src/prompt.ts:59` — "forbidden to collect passwords or payment info" — **becomes tiered**: "external payment buttons" allowed; "collecting/storing card numbers, CVC" stays forbidden |
| Agent-side credentials | land only in `.forge/connectors.json` (SKIP_DIRS); prompts explicitly forbid writing credentials into source; die with the container |
| Bring-your-own keys | **same storage path as OAuth credentials** (same table, same `CONNECTOR_KEK`, same AES-GCM); the upload endpoint accepts only provider-declared keys, values are **write-only, never echoed**, and list endpoints never return `credentials` |
| Environment isolation | `CONNECTOR_KEK` must be written **twice** in `wrangler.jsonc` — top level and `env.staging` (binding-type config does not inherit; a miss only surfaces as runtime `undefined`) |
| Trust model | the platform master key can decrypt every user's connection credentials — the authorization page must say so; avoiding it means waiting for Workers for Platforms |

---

## 9. Phasing and acceptance

| Phase | Content | Why this order | Acceptance criteria (staging) |
| --- | --- | --- | --- |
| **v0** | framework + GA4 (read-only, oauth) | zero funds risk; validates both the A and B paths; never touches form C | the generated app reads **real** GA numbers, not model-invented ones |
| **v0.1** | **`apikey` form + Stripe (user's own key)** | opens the "zero platform-side registration" extension path; validates publishable delivery + secret generation-time use in one shot | paste `sk_test_` → capability bar lights up → generated app contains a real, clickable payment link; no `sk_` found in source |
| **v2** | GitHub (oauth) | the most useful of account authorizations: push straight to the user's repo after generating | one authorization → generate → code appears in the user's repo |
| **v3** | Supabase (user's own backend, apikey) | responsibility pushed upstream; the platform only does encrypted storage and generation-time delivery | user pastes URL + service key → agent creates tables → page reads/writes with the anon key |

**Explicitly out of scope**: the platform custodies `sk_live` to run a funds closure. Reason: the blast radius is every user's payment keys, and the Worker has no KMS; it conflicts with Forge's thin-bearer model (`docs/DESIGN.md` §II.3), and the upside is far smaller than the risk.

---

## 10. Implementation checklist

**New**
- `src/lib/connectors/{crypto,registry,store}.ts` + `providers/{ga4,stripe}.ts`
- `src/routes/connections.ts` (list / oauth start / callback / **apikey upload** / revoke / Form-A config)
- `agent/template/src/lib/connectors.js`
- `schema.migrate-connectors.sql` (incremental migration, two CREATE TABLEs)
- `web/src/components/{ConnectorChips,ConnectorsPanel}.tsx`

**Changed**
- `src/types.ts` (`Env` gains `CONNECTOR_KEK`)
- `wrangler.jsonc` (written twice: top level and `env.staging`)
- `src/index.ts` (mount `/api/connections`)
- `package.json` (migration scripts)
- `injectRuntime()` in `src/lib/artifacts.ts` (inject `__FORGE_CONNECTORS__`)
- `src/routes/serve.ts` (fetch project config for `injectRuntime`)
- `src/lib/agent.ts` + `src/routes/generate.ts` (dispatch carries connectors)
- `agent/src/{types,runner,prompt}.ts` (write `.forge/connectors.json` + SKIP_DIRS + tiered prompts)
- `agent/template/src/lib/forge.js` (connectors read entry)
- `web/src/{lib/api.ts,components/ChatPanel.tsx,pages/Workspace.tsx}`

**Docs**
- after completion sync `docs/FORGE2.md` (new section); once the rules settle, promote into `AGENTS.md` as needed

---

## 11. Configuration the user must complete platform-side (v0 dependencies)

1. **Google Cloud Console**: add the two callback URIs of the current deployment to your own OAuth client
   - `${STAGING_PUBLIC_BASE_URL}/api/connections/ga4/callback` (staging)
   - `${PRODUCTION_PUBLIC_BASE_URL}/api/connections/ga4/callback` (production)
   - keep the old callbacks only while callers still use them; the effective address is decided by each environment's `PUBLIC_BASE_URL`.
2. **Enable the Google Analytics Data API** (`analyticsdata.googleapis.com`) — generation-time reads 403 without it.
3. Write `CONNECTOR_KEK` once per environment (`wrangler secret put`; any random 32 bytes work, **rotating it forces every connection to re-authorize**).
4. If `analytics.readonly` triggers Google's sensitive-scope review: unverified apps are limited to test users — this only affects "who can connect", not the generation pipeline.

---

## 12. Primary sources

- pi does not enable MCP: per the upstream docs of the matching `@earendil-works/pi-coding-agent` version; this project also registers no MCP tools.
- Extension API: per the types exported by `@earendil-works/pi-coding-agent` and upstream docs; do not cite pinned line numbers from untracked `node_modules`.
- Generated apps' current backend capabilities are `db|kv|blob` only: `src/lib/appdata.ts:285`
- Published-page sandbox CSP: `src/routes/serve.ts:16`
- Runtime injection: `injectRuntime()` in `src/lib/artifacts.ts`
- Prompt forbidden zones: `agent/src/prompt.ts:59` (payments/passwords), `:86,:140` (external CDN/img)
- Comparable products: Atoms' connector panel (**version-level** binding — the part we deliberately don't copy); Lovable's two Stripe tiers (official docs: Payment Link direct-paste vs Supabase Edge Function + secret)
