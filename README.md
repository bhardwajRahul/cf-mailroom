# Agentic Inbox

A self-hosted email system shared by humans and AI agents. Humans read and reply
through a Gmail-style web UI; agents read and reply through MCP. Inbound support
email can be triaged and answered autonomously — the agent looks things up
(Stripe, your database) and drafts a reply for one-click human approval.

Runs entirely on Cloudflare: Workers, Email Routing, D1, R2, and Web Push.

## Architecture

```
inbound email ──► Email Routing ──► email() handler ──► D1 + R2 (raw MIME / attachments)
                                                          │
                                              Queue ──► Draft Run ──► Agent Draft
                                                          │
web UI (React SPA) ──► /api (Hono) ───────────────────────┤
external agents ──► OAuth 2.1 ──► MCP 2026-07-28 ────────┤
                              └─ /authorize ──► Access (owner only)
outbound Reply Attempt ──► Cloudflare Email Sending ──────┤
outbound Send Attempt ──► Cloudflare Email Sending ───────┘
new inbound Message ──► Web Push ──► subscribed browsers
```

- **Multiple inboxes, one workspace.** Every receiving address is a row in
  `mailboxes`; the unified view queries across all of them. Mailboxes are added
  explicitly in Settings, and unknown recipient addresses are rejected. Each
  mailbox has its own agent mode (`off` / `draft` / `auto`) and instructions.
- **Threading** follows RFC headers (`In-Reply-To` / `References`) with a
  sender-aware, reply-only normalized-subject fallback. New inbound mail
  reopens an archived Conversation.
- **Loop prevention**: auto-submitted senders (RFC 3834, `Precedence: bulk`,
  list mail) are flagged and must never receive automated replies.
- **Reliable drafting**: each latest inbound Message gets a retryable Draft Run
  on Cloudflare Queues. Stale runs cannot overwrite a newer Agent Draft.
- **At-most-once replies**: every approved send is a durable Reply Attempt.
  Browser retries reuse it rather than sending the customer another email.
- **MCP sends stay visible**: external agents use durable Reply/Send Attempts,
  so new mail and replies are written to the same Conversations the Web UI
  reads. Stable idempotency keys prevent retries from sending twice.
- **Attachments and Reply-To**: inbound files are stored in R2 and downloadable
  from the Conversation; outbound replies and new mail can carry attachments
  (≤3 MB total, staged in R2 alongside the attempt) and replies prefer the
  sender's `Reply-To` address.
- **Auto labels**: each Inbox can define labels (e.g. `guest-post`,
  `link-exchange`) with a natural-language match condition. New inbound mail is
  evaluated once with the `typesafe/jev` model and tagged with every matching
  label; replies are never labeled. The conversation list filters by label and
  supports multi-select mark-read/archive.

## Setup

```sh
npm install

# 0. Create local configs from the examples (the real files are gitignored)
cp wrangler.example.jsonc wrangler.jsonc
cp wrangler.dev.example.jsonc wrangler.dev.jsonc
cp wrangler.mcp.example.jsonc wrangler.mcp.jsonc
cp .dev.vars.example .dev.vars

# 1. Create resources
wrangler d1 create agentic-inbox     # paste database_id into wrangler.jsonc
wrangler r2 bucket create agentic-inbox-raw
wrangler kv namespace create agentic-inbox-mcp-oauth # bind as OAUTH_KV in wrangler.mcp.jsonc

# 2. Apply schema (+ optional demo data)
npm run db:migrate:local
npm run db:seed:local

# Create the production drafting queues once
wrangler queues create agentic-inbox-drafts
wrangler queues create agentic-inbox-drafts-dlq

# Generate one VAPID key pair, then store each printed value as a Worker secret
npm run vapid:generate
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_JWK
wrangler secret put VAPID_SUBJECT  # e.g. https://inbox.example.com or mailto:admin@example.com

# 3. Local dev (web UI + API at http://localhost:5173)
npm run dev

# 4. Deploy
npm run db:migrate
npm run deploy
npm run deploy:mcp
```

### Wire up a domain

For each domain that should receive mail:

1. Move the domain's DNS to Cloudflare and enable **Email Routing**.
2. Set the catch-all rule (or specific addresses) to **Send to Worker →
   agentic-inbox**. Multiple domains can all point at this one Worker.
3. Onboard the same domain to **Email Service** (dashboard → Email Service) so
   replies can be sent from it. Requires the Workers paid plan while Email
   Sending is in beta.
4. Add the Inbox in **Settings**. The app infers its Domain and only asks for
   these Cloudflare steps when that Domain has not been configured before.

> Local development uses `wrangler.dev.jsonc`, which omits the AI and outbound
> email bindings. Inbound handling, the API, and the web UI remain available;
> sending a real reply requires the deployed Worker.

### Test the inbound pipeline locally

With `wrangler dev` running:

```sh
npm run email:test
npm run email:test:attachment
```

This POSTs `scripts/test-email.eml` to the local email handler endpoint.

### Web routes

- `/inbox` and `/inbox/:threadId` — unified inbox and a selected conversation
- `/mailboxes/:mailboxId` — one Inbox
- `/mailboxes/:mailboxId/threads/:threadId` — a conversation within that Inbox
- `/settings/inboxes/:mailboxId` — Base Instructions and Playbooks for an Inbox
- `/settings/general` — workspace-wide settings, including browser notifications

Search and conversation filters are URL parameters (`?q=...&filter=unread|drafts`),
so refresh, browser history, and shared links preserve the current view.

> **Security note**: the web UI has no authentication. For a real deployment,
> put the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
> before exposing it.

Browser notifications are off by default. After configuring the VAPID secrets,
turn them on under **Settings → General**. Every browser that should receive
notifications must grant permission and subscribe once; turning the global
switch off removes all stored subscriptions.

## MCP server

The MCP server is a separate Worker on its own hostname (e.g.
`https://mcp.example.com/v1`). It
shares D1, Cloudflare Email Sending, and the R2 bucket (for outbound attachment
staging) with the Web Worker, but has no access to the Web API, assets, AI
binding, queues, or Push secrets.

It uses the stateless MCP `2026-07-28` handler and keeps compatibility with
published 2025 stateless clients. Its tools are:

- `list_inboxes`
- `search_conversations`
- `get_conversation`
- `reply_to_conversation`
- `send_email`

The two send tools are an explicit owner-level capability: they send
immediately, require a stable `idempotency_key`, and only send from an Inbox
already registered in Agentic Inbox. Replies require the exact inbound Message
and reviewed reply target, then calculate RFC threading on the server. Send
Attempts are limited to `MCP_DAILY_SEND_LIMIT` per Access identity per UTC day.

The MCP Worker is its own OAuth 2.1 authorization server. It supports Client ID
Metadata Documents (the MCP 2026 preferred registration mechanism) and Dynamic
Client Registration as a compatibility fallback, so standards-compliant MCP
clients do not need their callback URLs preconfigured. Authorization Code uses
S256 PKCE; access tokens last 15 minutes and refresh tokens last 30 days.

Tokens have real `inbox.read` and `inbox.send` scopes. Read access is required;
the two write tools are registered only when the token includes `inbox.send`
and the instance-level emergency switch `MCP_SEND_ENABLED=true`. Set that
variable to `false` to remove write tools from every client immediately.

### Configure OAuth

1. Create a KV namespace and bind it as `OAUTH_KV` in `wrangler.mcp.jsonc`.
   OAuth clients, grants, authorization codes, and tokens live there.
2. Deploy the MCP Worker once with `npm run deploy:mcp` so its custom hostname
   exists.
3. In Cloudflare Zero Trust, create a Self-hosted Access application for the
   exact destination `<MCP_HOSTNAME>/authorize`. Restrict its Allow
   policy to the instance owner's email and leave **Managed OAuth off**. The
   discovery, client registration, token, revocation, and `/v1` endpoints must
   remain publicly reachable; only the interactive consent page is behind
   Access.
4. Copy that Access application's **AUD tag** into `POLICY_AUD`, set the owner
   email in `MCP_ALLOWED_EMAILS`, then redeploy.

`POLICY_AUD` is application-specific and is safe to publish, but it must match
the Access application protecting `/authorize`. A first deploy with a
placeholder can create the hostname; owner consent works only after the real
AUD is configured and the Worker is redeployed.

The OAuth Worker performs discovery, client registration, token exchange,
refresh, and revocation. On every consent request it independently validates
the `Cf-Access-Jwt-Assertion` against the team JWKS, issuer, AUD, and owner
allowlist before issuing a grant. Do not protect the whole MCP hostname with
Access: that would intercept standards-based OAuth endpoints before MCP clients
can discover or register.

## Roadmap

- [x] Triage: per-inbox auto labels via `typesafe/jev` classification on new inbound mail
- [ ] External tools for the draft agent (for example Stripe or product databases)
- [ ] Delivery and bounce status inside the Conversation (available today in Cloudflare Email Logs)
- [ ] Full-text search UI (backend `/api/search` already works)

## License

Apache-2.0
