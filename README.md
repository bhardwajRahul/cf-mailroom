# Mailroom

A self-hosted email system shared by humans and AI agents. Humans read and reply
through a Gmail-style web UI; agents read and reply through MCP. Inbound mail
can be triaged with automatic labels and answered by an agent-drafted reply,
held for one-click human approval.

Runs entirely on Cloudflare: Workers, Email Routing, D1, R2, and Web Push.

![Mailroom: three inboxes in one workspace, with an agent draft awaiting approval](docs/screenshot.png)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wong2/cf-mailroom)

Deploy the web app into your own Cloudflare account, with storage and drafting
queues provisioned for you and database migrations applied automatically.
Then protect it with Cloudflare Access and connect your email domain.
The MCP server and browser notifications are optional, separate setup steps.

**Start here: [Cloudflare deployment guide](docs/deployment.md).** You need a
domain on Cloudflare, R2 enabled, and Workers Paid for outbound email. The
deploy button requires this repository to be public.

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
  mailbox has its own instructions. AI drafting stays off until you enable
  **Draft replies to new messages**; that writes a draft for approval and never
  sends on its own.
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

For production, use the [deployment guide](docs/deployment.md). For local development
(Node.js 22.18+ or 24+):

```sh
npm ci
cp .dev.vars.example .dev.vars

# Local resources are emulated; no Cloudflare login or resource creation needed.
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

> Local development uses `wrangler.dev.jsonc`, which omits the AI and outbound
> email bindings. Inbound handling, the API, and the web UI remain available;
> sending a real reply requires the deployed Worker.

### Connect a receiving domain

Production setup, including Access, is in the [deployment guide](docs/deployment.md).
For each domain that should receive mail:

1. Move the domain's DNS to Cloudflare and enable **Email Routing**. Install the
   DNS records Cloudflare asks for. Do not point a routing rule at the Worker yet.
2. Onboard the domain in **Email Sending** (dashboard → Email Service → Sending)
   so replies can be sent from it. Requires the Workers paid plan while Email
   Sending is in beta.
3. Add the Inbox in **Settings**. The app infers its Domain and asks you to
   confirm those Cloudflare steps only when that Domain has not been confirmed
   before. New inboxes leave **Draft replies to new messages** off.
4. Then point that address (or a catch-all) at **Send to Worker → your Mailroom
   Worker**. Unknown recipient addresses are rejected, so a rule that arrives
   before the Inbox bounces mail. A catch-all does not create Inboxes. Multiple
   domains can share this one Worker.

### Test the inbound pipeline locally

With `npm run dev` running (Vite on port 5173):

```sh
npm run email:test
npm run email:test:attachment
```

This POSTs `scripts/test-email.eml` to the local email handler. Use `npm run dev`,
not `npx wrangler dev`: the test always targets port 5173 and `wrangler.dev.jsonc`.

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
already registered in Mailroom. Replies require the exact inbound Message
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

### Deploy the MCP server

Setup lives in the deployment guide: [connect an AI agent over
MCP](docs/deployment.md#optional-connect-an-ai-agent-over-mcp). The MCP Worker
is configured in `wrangler.mcp.jsonc` (gitignored), protected by a separate
Access application that covers **only `/authorize`**, and deployed manually
with `npm run deploy:mcp`.

## Roadmap

- [x] Triage: per-inbox auto labels via `typesafe/jev` classification on new inbound mail
- [ ] External tools for the draft agent (for example Stripe or product databases)
- [ ] Delivery and bounce status inside the Conversation (available today in Cloudflare Email Logs)
- [x] Full-text search in the conversation list (`/api/search` on `messages_fts`)

## License

Apache-2.0
