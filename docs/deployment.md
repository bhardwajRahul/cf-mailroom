# Deploy your own Mailroom

The recommended path is Cloudflare's guided deployment, followed by Access and
email domain setup. No local CLI or API keys are needed for the initial web app.

## Before you start

- A GitHub account and a Cloudflare account.
- A domain using Cloudflare DNS for receiving and sending email.
- R2 enabled on the Cloudflare account (Cloudflare may ask for billing details).
- Workers Paid (~$5/month) for sending email to arbitrary recipients through
  [Email Sending](https://developers.cloudflare.com/email-service/).
- A Cloudflare Zero Trust team for protecting the web app with Access (the free
  plan is enough).

Workers, D1, R2, Queues, and Workers AI usage belongs to your account and is
subject to Cloudflare's quotas and billing. This is not a promise of free hosting.

## At a glance

1. Deploy with the button — storage, queues, and migrations are automatic.
2. Put the app behind Cloudflare Access. Until you do, it is publicly readable.
3. Connect your email domain (Email Routing in, Email Sending out).
4. Add an Inbox in Settings and send yourself a test email.
5. Optionally connect an agent over MCP and enable browser notifications.

## 1. Deploy the web app

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wong2/cf-mailroom)

1. Sign in to Cloudflare and connect GitHub when prompted. The source repository
   must be public for other users to use this button.
2. Choose the destination account, repository, and Worker name. For your first
   instance, the default names are fine. For additional instances, use different
   Worker, database, bucket, and queue names.
3. Review the resource bindings: `DB` (D1), `RAW` (R2), `AI` (Workers AI),
   `EMAIL` (Email Sending; onboard the sender domain after deploy — the binding
   does not verify it), `DRAFT_QUEUE`, and `DRAFT_DLQ` (two distinct queues).
   Cloudflare provisions the resources in your account and writes their values
   into your new repository.
   In `wrangler.jsonc`, the consumer's `queue` must match `DRAFT_QUEUE` and its
   `dead_letter_queue` must match `DRAFT_DLQ`, including if you rename them.

   The repository Cloudflare creates belongs to you — your instance lives there.
   Upstream changes do not arrive automatically; see [Updates](#updates).
4. Set the **deploy command** to `npm run deploy`. You can leave the **build
   command** empty because the deploy script builds the app itself. If Cloudflare
   pre-fills `npm run build`, clearing it avoids building twice.
5. Deploy and wait for Workers Builds to finish. The script builds the app,
   applies pending D1 migrations, then deploys the generated Worker and assets.
   No VAPID secrets are required yet.

Cloudflare's [Deploy to Cloudflare documentation](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
describes resource provisioning and repository creation. The button deploys the
web/email Worker only; the separate MCP Worker is covered below.

### Database binding without an account-specific ID

The shared configs intentionally omit `database_id`. The project pins Wrangler
to 4.124.0, which resolves `database_name` in the authenticated Cloudflare account
for deployments and remote migrations. An existing database with that name is
reused. Use a distinct name for each independent instance in the same account.
No environment-variable injection script is needed.

The deployment button provisions resources before the deploy command runs. For
manual setup, create the database first as described below: this project's
deploy command runs migrations before uploading the Worker, and migrations
cannot create a missing database. If Cloudflare writes an explicit database ID
into your instance's config, keep it consistent with the database name; Wrangler
uses that ID when present.

## 2. Protect the web app before adding email

The web API has no built-in login. `wrangler.jsonc` sets `workers_dev` to true
and `preview_urls` to false, so the deploy publishes
`https://<worker>.<account>.workers.dev` and does not publish preview URLs.
Until Access covers that hostname, **anyone who opens it can read all mail**.
Do this step before registering an Inbox or routing mail.

1. In **Zero Trust → Access → Applications**, add a **Self-hosted** application
   for the whole `workers.dev` hostname (all paths, including `/api/*`). Add an
   Allow policy restricted to your email address; do not use an Everyone or
   Bypass policy.
2. Leave these flags as they are in the template:

   ```jsonc
   "workers_dev": true,
   "preview_urls": false
   ```

   `preview_urls` stays off because each preview URL is another public hostname,
   and Access on the main `workers.dev` hostname does not cover it.
3. A custom domain is optional. If you add one, list it in `routes` and add a
   second Access application for that hostname. Access on one hostname does not
   cover the other. A custom domain added only in the dashboard does not survive
   the next deploy unless it is in `routes`.
4. Open the web app in a private browser window: both the app and
   `/api/mailboxes` must require Access login. Sign in with your allowed email
   and verify the app loads.

See [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/access/).
Access protects HTTP requests; it does not require inbound email or queue
events to sign in.

## 3. Connect your email domain

1. Enable **Email Routing** for the receiving domain and install the DNS records
   Cloudflare requests. Check existing mail hosting before changing MX records.
   Do not point a routing rule at the Worker yet.
2. Enable **Email Sending** in Email Service and onboard the sender domain,
   completing the DNS verification shown by Cloudflare. The `EMAIL` Worker
   binding alone does not verify a domain or grant sending access.
3. In Mailroom **Settings**, add an Inbox such as `support@example.com`. For a
   new domain, the dialog asks you to confirm Email Routing is enabled and Email
   Sending is active before it saves the Inbox. Leave **Draft replies to new
   messages** off until delivery looks right. Turning it on writes a draft for
   your approval; nothing is sent automatically.
4. Then point that address (or a catch-all rule) at your deployed Worker using
   **Send to Worker**. Unknown recipient addresses are rejected, so a rule that
   exists before the Inbox bounces mail. A catch-all does not create Inboxes.
5. Send a message from an external mailbox, confirm it appears in the app, then
   reply and verify delivery back to that mailbox.

Repeat for additional addresses or domains; they can share the same Worker.

## Optional: connect an AI agent over MCP

The MCP Worker uses its own hostname and OAuth, sharing the web Worker's D1 and
R2 resources. Do not create an empty second database or bucket for MCP.

1. Clone the repository Cloudflare created for you and run `npm ci` using
   Node.js 22.18+ or 24+, then `npx wrangler login`.
2. Copy `wrangler.mcp.example.jsonc` to `wrangler.mcp.jsonc` (gitignored — it
   holds your Access AUD, owner emails, and hostnames). Copy the actual `DB`
   and `RAW` values from your web Worker's `wrangler.jsonc`. Use the same
   Cloudflare account and database name so MCP reuses the existing database.
3. Run `npx wrangler kv namespace create mailroom-mcp-oauth` and copy the
   returned ID into `OAUTH_KV`. OAuth clients, grants, authorization codes, and
   tokens live there. Pick a hostname on a domain in your Cloudflare account
   (e.g. `mcp.example.com`) and set it in both `routes` and `MCP_HOSTNAME`.
   Set `WEB_APP_URL` to the origin Access protects (for example
   `https://mailroom.<account>.workers.dev`), plus `TEAM_DOMAIN` and
   `MCP_ALLOWED_EMAILS`. MCP conversation links use `WEB_APP_URL`.
4. In Cloudflare Zero Trust, create a Self-hosted Access application for the
   exact destination `<MCP_HOSTNAME>/authorize` — this works before the Worker
   exists. Restrict its Allow policy to the instance owner's email and leave
   **Managed OAuth off**. The discovery, client registration, token,
   revocation, and `/v1` endpoints must remain publicly reachable; only the
   interactive consent page is behind Access. Do not protect the whole MCP
   hostname: that would intercept standards-based OAuth endpoints before MCP
   clients can discover or register.
5. Copy that Access application's **AUD tag** into `POLICY_AUD`, then deploy
   once with `npm run deploy:mcp` (the custom domain is created for you).
   `POLICY_AUD` is application-specific and safe to publish, but it must match
   the Access application protecting `/authorize`. If you deploy before setting
   the real AUD, owner consent fails until you set it and redeploy.
6. Add `https://<your-mcp-hostname>/v1` to your MCP client and authorize it.

On every consent request the Worker independently validates the
`Cf-Access-Jwt-Assertion` against the team JWKS, issuer, AUD, and owner
allowlist before issuing a grant. The MCP config is gitignored;
`npm run deploy:mcp` is a separate manual deployment — the web Worker's Git
integration does not deploy it.

## Optional: browser notifications

From your instance's cloned repository:

```sh
npm run vapid:generate
npx wrangler secret put VAPID_PUBLIC_KEY --config wrangler.jsonc
npx wrangler secret put VAPID_PRIVATE_JWK --config wrangler.jsonc
npx wrangler secret put VAPID_SUBJECT --config wrangler.jsonc
```

Paste the matching generated keys at the prompts and use a subject such as
`mailto:admin@example.com`. Keep the private key out of Git. In **Settings →
General**, enable browser notifications and grant permission in each browser.

## Updates

Commit changes to the connected repository's production branch (normally `main`)
and push. Workers Builds runs `npm run deploy`, including pending database
migrations, for each production deployment. Keep your instance's resource IDs,
names, domains, and Access settings when bringing in upstream changes.

Do not point preview branches or a second instance at the production database
and queues. Schema migrations change stored data; a Worker rollback does not
undo a database migration.

### Pull upstream changes

The button created your own repository, so upstream fixes do not arrive
automatically. To update:

```sh
git remote add upstream https://github.com/wong2/cf-mailroom.git
git fetch upstream
git merge upstream/main
git push
```

Keep your own values when conflicts touch instance-specific files:
`wrangler.jsonc` holds your Worker and resource names, and `wrangler.mcp.jsonc`
is not tracked at all.

## Manual setup / an existing fork

If you already forked the repository instead of using the button, create and
bind your own resources before connecting Workers Builds:

```sh
npm ci
npx wrangler login
npx wrangler d1 create mailroom
npx wrangler r2 bucket create mailroom-raw
npx wrangler queues create mailroom-drafts
npx wrangler queues create mailroom-drafts-dlq
```

No database ID needs to be copied: Wrangler looks up `database_name` in your
account. If the database already exists, skip its create command and reuse it
only if it belongs to this instance. If you chose different resource names,
update the database, bucket, producer queues, consumer queue, and dead-letter
queue in `wrangler.jsonc`. Local development uses `wrangler.dev.jsonc` and does
not need a Cloudflare database.

Commit your instance configuration, connect that GitHub repository through
**Workers & Pages → Create → Import a repository**, and use `npm run deploy` as
the deploy command with an empty build command. Future production-branch pushes
deploy automatically. Continue with Access and domain setup above.

## Troubleshooting

- **Button cannot import the repository:** the upstream repository must be public.
- **A push did not trigger a deployment:** check that the repository is still
  connected under the Worker's **Settings → Build** and that the deploy command
  is `npm run deploy`. Builds only run on the production branch (normally
  `main`).
- **D1 database not found:** check the `DB` binding in your instance's config;
  `database_name` must match a database in the authenticated Cloudflare account.
  For manual setup, create it before running migrations. If an explicit
  `database_id` was added by Cloudflare, verify it matches that database too.
- **Local data appears empty after removing an old database ID:** Wrangler's
  local storage identity changes when the ID is removed. The previous local
  files remain under `.wrangler/state`; they are not deleted. Run
  `npm run db:migrate:local` to initialize the new local database and optionally
  `npm run db:seed:local` for demo data. Back up/export any local data you need
  before switching configurations; production data is unaffected.
- **Missing queue / dead-letter queue:** check both queues exist and the
  consumer names match the producer bindings, especially after renaming them.
- **R2 binding fails:** enable R2 in the destination account first.
- **App loads but replies fail:** check Email Sending access, the paid plan,
  sender-domain verification, and the Inbox's sending address.
- **Inbound mail does not appear:** check Email Routing targets this Worker and
  the recipient has already been added as an Inbox.
- **MCP OAuth redirects to Access before discovery:** protect `/authorize` only,
  not the entire MCP hostname.
