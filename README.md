# Agentic Inbox

A self-hosted email system shared by humans and AI agents. Humans read and reply
through a Gmail-style web UI; agents read and reply through MCP. Inbound support
email can be triaged and answered autonomously — the agent looks things up
(Stripe, your database) and drafts a reply for one-click human approval.

Runs entirely on Cloudflare: Workers, Email Routing, D1, R2.

## Architecture

```
inbound email ──► Email Routing ──► email() handler ──► D1 (threads/messages) + R2 (raw MIME)
                                                          │
web UI (React SPA) ──► /api (Hono) ───────────────────────┤
external agents ──► /mcp (MCP server, planned) ───────────┤
auto-reply agent (planned) ◄── triage ◄───────────────────┘
outbound ──► Cloudflare Email Sending (beta; provider swappable behind email/send.ts)
```

- **Multiple inboxes, one workspace.** Every receiving address is a row in
  `mailboxes`; the unified view queries across all of them. Mailboxes are added
  explicitly in Settings, and unknown recipient addresses are rejected. Each
  mailbox has its own agent mode (`off` / `draft` / `auto`) and instructions.
- **Threading** follows RFC headers (`In-Reply-To` / `References`) with a
  normalized-subject fallback.
- **Loop prevention**: auto-submitted senders (RFC 3834, `Precedence: bulk`,
  list mail) are flagged and must never receive automated replies.

## Setup

```sh
npm install

# 1. Create resources
wrangler d1 create agentic-inbox     # paste database_id into wrangler.jsonc
wrangler r2 bucket create agentic-inbox-raw

# 2. Apply schema (+ optional demo data)
npm run db:migrate:local
npm run db:seed:local

# 3. Local dev (web UI + API at http://localhost:5173)
npm run dev

# 4. Deploy
npm run db:migrate
npm run deploy
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
```

This POSTs `scripts/test-email.eml` to the local email handler endpoint.

### Web routes

- `/inbox` and `/inbox/:threadId` — unified inbox and a selected conversation
- `/mailboxes/:mailboxId` — one Inbox
- `/mailboxes/:mailboxId/threads/:threadId` — a conversation within that Inbox
- `/settings/inboxes/:mailboxId` — Base Instructions and Playbooks for an Inbox

Search and conversation filters are URL parameters (`?q=...&filter=unread|drafts`),
so refresh, browser history, and shared links preserve the current view.

> **Security note**: the web UI has no authentication. For a real deployment,
> put the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
> before exposing it.

## Roadmap

- [ ] MCP server at `/mcp` — `list_threads` / `get_thread` / `reply` for external agents
- [ ] Triage: rules + small-model classification on inbound mail
- [ ] Auto-reply agent (per-mailbox instructions + external MCP tools, e.g. Stripe), draft mode first
- [ ] Full-text search UI (backend `/api/search` already works)
- [ ] Attachments (stored in R2, rendered in UI)

## License

Apache-2.0
