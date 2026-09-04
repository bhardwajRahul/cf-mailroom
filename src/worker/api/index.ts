import { Hono } from "hono";
import { enqueueDraftRun } from "../agent/runs";
import { ReplyIntentError, sendReplyAttempt } from "../email/reply";
import {
  deleteInbox,
  InboxDeletionError,
  purgeInboxObjects,
} from "../inbox/delete";
import { validatePushSubscription } from "../notifications/push";
import type {
  Attachment,
  BrowserPushSubscription,
  Domain,
  DraftRun,
  GeneralSettings,
  Mailbox,
  Message,
  PlaybookInput,
} from "../../shared/types";

export const api = new Hono<{ Bindings: Env }>();

api.get("/settings/general", async (c) => {
  const [settings, subscriptions] = await Promise.all([
    c.env.DB.prepare(
      "SELECT browser_notifications_enabled FROM global_settings WHERE id = 1",
    ).first<{ browser_notifications_enabled: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM push_subscriptions")
      .first<{ count: number }>(),
  ]);
  const configured = Boolean(
    c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_JWK && c.env.VAPID_SUBJECT,
  );
  const result: GeneralSettings = {
    browser_notifications_enabled: Boolean(settings?.browser_notifications_enabled),
    browser_notifications_configured: configured,
    push_subscription_count: Number(subscriptions?.count ?? 0),
    vapid_public_key: configured ? c.env.VAPID_PUBLIC_KEY! : null,
  };
  return c.json(result);
});

api.post("/settings/browser-notifications", async (c) => {
  if (!c.env.VAPID_PUBLIC_KEY || !c.env.VAPID_PRIVATE_JWK || !c.env.VAPID_SUBJECT) {
    return c.json({ error: "Browser notifications are not configured on this server" }, 503);
  }

  const subscription = await c.req.json<BrowserPushSubscription>();
  if (!validatePushSubscription(subscription)) {
    return c.json({ error: "The browser returned an invalid Push Subscription" }, 400);
  }

  const userAgent = c.req.header("User-Agent")?.slice(0, 512) ?? null;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO push_subscriptions
         (endpoint, expiration_time, p256dh, auth, user_agent)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         expiration_time = excluded.expiration_time,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).bind(
      subscription.endpoint,
      subscription.expirationTime ?? null,
      subscription.keys.p256dh,
      subscription.keys.auth,
      userAgent,
    ),
    c.env.DB.prepare(
      `UPDATE global_settings
       SET browser_notifications_enabled = 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = 1`,
    ),
  ]);
  return c.json({ ok: true });
});

api.delete("/settings/browser-notifications", async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE global_settings
       SET browser_notifications_enabled = 0,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = 1`,
    ),
    c.env.DB.prepare("DELETE FROM push_subscriptions"),
  ]);
  return c.json({ ok: true });
});

api.get("/mailboxes", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.*,
       (SELECT COUNT(*) FROM threads t
        WHERE t.mailbox_id = m.id AND t.is_read = 0 AND t.status != 'archived') AS unread_count
     FROM mailboxes m ORDER BY m.address`,
  ).all();
  return c.json(results);
});

api.get("/domains", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT d.*,
       (SELECT COUNT(*) FROM mailboxes m WHERE m.domain_id = d.id) AS inbox_count
     FROM domains d
     ORDER BY d.name`,
  ).all<Domain>();
  return c.json(results);
});

api.post("/domains", async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = normalizeDomain(body.name ?? "");
  if (!isDomainName(name)) {
    return c.json({ error: "Enter a valid domain, such as example.com" }, 400);
  }

  const existing = await c.env.DB.prepare(
    `SELECT d.*,
       (SELECT COUNT(*) FROM mailboxes m WHERE m.domain_id = d.id) AS inbox_count
     FROM domains d WHERE d.name = ?`,
  )
    .bind(name)
    .first<Domain>();
  if (existing) return c.json(existing);

  const domain = await c.env.DB.prepare(
    `INSERT INTO domains (name) VALUES (?) RETURNING *`,
  )
    .bind(name)
    .first<Domain>();
  return c.json({ ...domain!, inbox_count: 0 }, 201);
});

api.post("/domains/:id/activate", async (c) => {
  const id = parsePositiveId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid domain" }, 400);

  const domain = await c.env.DB.prepare(
    `UPDATE domains
     SET status = 'active', activated_at = COALESCE(activated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     WHERE id = ? RETURNING *`,
  )
    .bind(id)
    .first<Domain>();
  if (!domain) return c.json({ error: "Domain not found" }, 404);
  return c.json({ ...domain, inbox_count: 0 });
});

api.post("/mailboxes", async (c) => {
  const body = await c.req.json<{ local_part?: string; domain_id?: number }>();
  const localPart = body.local_part?.trim().toLowerCase() ?? "";
  const domainId = Number(body.domain_id);

  if (!isLocalPart(localPart)) {
    return c.json({ error: "Use letters, numbers, dots, dashes, or underscores" }, 400);
  }
  if (!Number.isInteger(domainId) || domainId <= 0) {
    return c.json({ error: "Choose a domain" }, 400);
  }

  const domain = await c.env.DB.prepare(
    "SELECT id, name, status FROM domains WHERE id = ?",
  )
    .bind(domainId)
    .first<{ id: number; name: string; status: "pending" | "active" }>();
  if (!domain) return c.json({ error: "Domain not found" }, 404);
  if (domain.status !== "active") {
    return c.json({ error: "Finish setting up this domain first" }, 409);
  }

  const address = `${localPart}@${domain.name}`;

  const existing = await c.env.DB.prepare("SELECT id FROM mailboxes WHERE address = ?")
    .bind(address)
    .first();
  if (existing) return c.json({ error: "This inbox already exists" }, 409);

  let mailbox: Mailbox | null;
  try {
    mailbox = await c.env.DB.prepare(
      `INSERT INTO mailboxes (address, domain_id)
       VALUES (?, ?) RETURNING *`,
    )
      .bind(address, domain.id)
      .first<Mailbox>();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return c.json({ error: "This inbox already exists" }, 409);
    }
    throw error;
  }

  return c.json({ ...mailbox!, unread_count: 0 }, 201);
});

api.patch("/mailboxes/:id", async (c) => {
  const body = await c.req.json<{
    agent_mode?: "off" | "draft" | "auto";
    agent_instructions?: string;
  }>();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.agent_mode !== undefined) {
    if (!["off", "draft", "auto"].includes(body.agent_mode)) {
      return c.json({ error: "invalid agent_mode" }, 400);
    }
    fields.push("agent_mode = ?");
    values.push(body.agent_mode);
  }
  if (body.agent_instructions !== undefined) {
    fields.push("agent_instructions = ?");
    values.push(body.agent_instructions || null);
  }
  if (fields.length === 0) return c.json({ error: "no fields to update" }, 400);
  await c.env.DB.prepare(`UPDATE mailboxes SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values, c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

api.delete("/mailboxes/:id", async (c) => {
  const id = parsePositiveId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid inbox" }, 400);

  const body = await c.req.json<{ confirm_address?: unknown }>().catch(() => null);
  if (!body || typeof body.confirm_address !== "string") {
    return c.json({ error: "Type the inbox address to confirm deletion" }, 400);
  }

  try {
    const deleted = await deleteInbox(c.env, {
      id,
      confirmAddress: body.confirm_address,
    });
    c.executionCtx.waitUntil(
      purgeInboxObjects(c.env.RAW, deleted.id).catch((error) => {
        console.error("Inbox object cleanup failed", {
          inboxId: deleted.id,
          error,
        });
      }),
    );
    return c.json({
      ok: true,
      deleted_id: deleted.id,
      domain_id: deleted.domainId,
    });
  } catch (error) {
    if (error instanceof InboxDeletionError) {
      return c.json({ error: error.message }, error.status);
    }
    throw error;
  }
});

api.get("/playbooks", async (c) => {
  const mailboxId = Number(c.req.query("mailbox_id"));
  if (!Number.isInteger(mailboxId) || mailboxId <= 0) {
    return c.json({ error: "mailbox_id is required" }, 400);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM playbooks
     WHERE mailbox_id = ?
     ORDER BY enabled DESC, updated_at DESC, id DESC`,
  )
    .bind(mailboxId)
    .all();
  return c.json(results);
});

api.post("/playbooks", async (c) => {
  const body = await c.req.json<PlaybookInput>();
  const validation = validatePlaybook(body);
  if (validation) return c.json({ error: validation }, 400);

  const playbook = await c.env.DB.prepare(
    `INSERT INTO playbooks
       (mailbox_id, name, when_to_use, instructions, example_reply, enabled)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(
      body.mailbox_id,
      body.name.trim(),
      body.when_to_use.trim(),
      body.instructions.trim(),
      body.example_reply?.trim() || null,
      body.enabled === false ? 0 : 1,
    )
    .first();
  return c.json(playbook, 201);
});

api.patch("/playbooks/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "invalid playbook id" }, 400);

  const body = await c.req.json<Partial<PlaybookInput>>();
  const fields: string[] = [];
  const values: unknown[] = [];
  const textFields = ["name", "when_to_use", "instructions", "example_reply"] as const;

  for (const field of textFields) {
    if (body[field] === undefined) continue;
    const value = body[field]?.trim() ?? "";
    if (field !== "example_reply" && !value) {
      return c.json({ error: `${field} cannot be empty` }, 400);
    }
    fields.push(`${field} = ?`);
    values.push(value || null);
  }
  if (body.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(body.enabled ? 1 : 0);
  }
  if (fields.length === 0) return c.json({ error: "no fields to update" }, 400);

  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  const playbook = await c.env.DB.prepare(
    `UPDATE playbooks SET ${fields.join(", ")} WHERE id = ? RETURNING *`,
  )
    .bind(...values, id)
    .first();
  if (!playbook) return c.json({ error: "playbook not found" }, 404);
  return c.json(playbook);
});

api.delete("/playbooks/:id", async (c) => {
  const result = await c.env.DB.prepare("DELETE FROM playbooks WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  if (!result.meta.changes) return c.json({ error: "playbook not found" }, 404);
  return c.json({ ok: true });
});

api.get("/threads", async (c) => {
  const mailboxId = c.req.query("mailbox_id");
  const status = c.req.query("status") ?? "open";
  const conditions = ["t.status = ?2"];
  if (mailboxId) conditions.push("t.mailbox_id = ?1");
  const { results } = await c.env.DB.prepare(
    `SELECT t.*, m.address AS mailbox_address, m.color AS mailbox_color,
       m.agent_mode AS mailbox_agent_mode,
       COALESCE(
         latest_inbound.from_name,
         latest_inbound.from_address,
         CASE WHEN latest_message.direction = 'outbound'
           THEN 'To: ' || COALESCE(json_extract(latest_message.to_addresses, '$[0]'), '')
         END
       ) AS last_from,
       latest_inbound.from_address AS last_from_address,
       (SELECT COUNT(*) FROM drafts d
        WHERE d.thread_id = t.id AND d.status = 'pending'
          AND d.source_inbound_message_id = latest_inbound.id) AS pending_draft_count,
       latest_run.status AS draft_run_status,
       latest_run.error AS draft_run_error,
       COALESCE(latest_inbound.is_auto_submitted, 0) AS latest_inbound_is_auto_submitted,
       latest_message.direction AS last_message_direction
     FROM threads t
     JOIN mailboxes m ON m.id = t.mailbox_id
     LEFT JOIN messages latest_message ON latest_message.id = (
       SELECT lm.id FROM messages lm WHERE lm.thread_id = t.id
       ORDER BY lm.created_at DESC, lm.id DESC LIMIT 1
     )
     LEFT JOIN messages latest_inbound ON latest_inbound.id = (
       SELECT li.id FROM messages li
       WHERE li.thread_id = t.id AND li.direction = 'inbound'
       ORDER BY li.created_at DESC, li.id DESC LIMIT 1
     )
     LEFT JOIN draft_runs latest_run ON latest_run.id = (
       SELECT dr.id FROM draft_runs dr
       WHERE dr.inbound_message_id = latest_inbound.id
       ORDER BY dr.created_at DESC, dr.id DESC LIMIT 1
     )
     WHERE ${conditions.join(" AND ")}
     ORDER BY t.last_message_at DESC LIMIT 100`,
  )
    .bind(mailboxId ?? 0, status)
    .all();
  return c.json(results);
});

api.get("/threads/:id", async (c) => {
  const id = c.req.param("id");
  const thread = await c.env.DB.prepare(
    `SELECT t.*, m.address AS mailbox_address, m.color AS mailbox_color,
       m.agent_mode AS mailbox_agent_mode,
       COALESCE(
         latest_inbound.from_name,
         latest_inbound.from_address,
         CASE WHEN latest_message.direction = 'outbound'
           THEN 'To: ' || COALESCE(json_extract(latest_message.to_addresses, '$[0]'), '')
         END
       ) AS last_from,
       latest_inbound.from_address AS last_from_address,
       (SELECT COUNT(*) FROM drafts d
        WHERE d.thread_id = t.id AND d.status = 'pending'
          AND d.source_inbound_message_id = latest_inbound.id) AS pending_draft_count,
       latest_run.status AS draft_run_status,
       latest_run.error AS draft_run_error,
       COALESCE(latest_inbound.is_auto_submitted, 0) AS latest_inbound_is_auto_submitted,
       latest_message.direction AS last_message_direction
     FROM threads t
     JOIN mailboxes m ON m.id = t.mailbox_id
     LEFT JOIN messages latest_message ON latest_message.id = (
       SELECT lm.id FROM messages lm WHERE lm.thread_id = t.id
       ORDER BY lm.created_at DESC, lm.id DESC LIMIT 1
     )
     LEFT JOIN messages latest_inbound ON latest_inbound.id = (
       SELECT li.id FROM messages li
       WHERE li.thread_id = t.id AND li.direction = 'inbound'
       ORDER BY li.created_at DESC, li.id DESC LIMIT 1
     )
     LEFT JOIN draft_runs latest_run ON latest_run.id = (
       SELECT dr.id FROM draft_runs dr
       WHERE dr.inbound_message_id = latest_inbound.id
       ORDER BY dr.created_at DESC, dr.id DESC LIMIT 1
     )
     WHERE t.id = ?`,
  )
    .bind(id)
    .first();
  if (!thread) return c.json({ error: "thread not found" }, 404);

  const [messages, drafts, draftRun] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at").bind(id).all(),
    c.env.DB.prepare(
      `SELECT d.*, p.name AS playbook_name
       FROM drafts d LEFT JOIN playbooks p ON p.id = d.playbook_id
       WHERE d.thread_id = ? AND d.status = 'pending'
         AND d.source_inbound_message_id = (
           SELECT id FROM messages
           WHERE thread_id = ? AND direction = 'inbound'
           ORDER BY created_at DESC, id DESC LIMIT 1
         )
       ORDER BY d.created_at`,
    )
      .bind(id, id)
      .all(),
    c.env.DB.prepare(
      `SELECT * FROM draft_runs
       WHERE inbound_message_id = (
         SELECT id FROM messages
         WHERE thread_id = ? AND direction = 'inbound'
         ORDER BY created_at DESC, id DESC LIMIT 1
       )
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
      .bind(id)
      .first<DraftRun>(),
  ]);

  const messageRows = messages.results as unknown as Message[];
  const messageIds = messageRows.map((message) => message.id);
  let attachments: Attachment[] = [];
  if (messageIds.length > 0) {
    const placeholders = messageIds.map(() => "?").join(", ");
    const result = await c.env.DB.prepare(
      `SELECT id, message_id, filename, content_type, size, disposition, content_id
       FROM attachments WHERE message_id IN (${placeholders}) ORDER BY id`,
    )
      .bind(...messageIds)
      .all<Attachment>();
    attachments = result.results;
  }
  const attachmentsByMessage = new Map<number, Attachment[]>();
  for (const attachment of attachments) {
    const list = attachmentsByMessage.get(attachment.message_id) ?? [];
    list.push(attachment);
    attachmentsByMessage.set(attachment.message_id, list);
  }
  const enrichedMessages = messageRows.map((message) => ({
    ...message,
    attachments: attachmentsByMessage.get(message.id) ?? [],
  }));
  return c.json({
    thread,
    messages: enrichedMessages,
    drafts: drafts.results,
    draft_run: draftRun ?? null,
  });
});

api.get("/attachments/:id", async (c) => {
  const id = parsePositiveId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid attachment" }, 400);
  const attachment = await c.env.DB.prepare(
    `SELECT filename, content_type, size, r2_key FROM attachments WHERE id = ?`,
  )
    .bind(id)
    .first<{ filename: string | null; content_type: string; size: number; r2_key: string }>();
  if (!attachment) return c.json({ error: "Attachment not found" }, 404);
  const object = await c.env.RAW.get(attachment.r2_key);
  if (!object) return c.json({ error: "Attachment file is unavailable" }, 404);

  const filename = attachment.filename || `attachment-${id}`;
  const headers = new Headers({
    "Content-Type": attachment.content_type || "application/octet-stream",
    "Content-Length": String(attachment.size),
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  return new Response(object.body, { headers });
});

api.post("/draft-runs/:id/retry", async (c) => {
  const id = parsePositiveId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid Draft Run" }, 400);
  const run = await c.env.DB.prepare(
    "SELECT id, thread_id, inbound_message_id, status FROM draft_runs WHERE id = ?",
  )
    .bind(id)
    .first<{ id: number; thread_id: number; inbound_message_id: number; status: string }>();
  if (!run) return c.json({ error: "Draft Run not found" }, 404);
  if (run.status === "superseded") {
    return c.json({ error: "A newer customer message has replaced this Draft Run" }, 409);
  }
  if (run.status === "ready") return c.json({ error: "This draft is already ready" }, 409);
  await enqueueDraftRun(c.env, run.thread_id, run.inbound_message_id);
  return c.json({ ok: true });
});

api.post("/threads/:id/draft", async (c) => {
  const threadId = parsePositiveId(c.req.param("id"));
  if (threadId === null) return c.json({ error: "Invalid conversation" }, 400);

  const thread = await c.env.DB.prepare(
    `SELECT t.id, m.agent_mode
     FROM threads t JOIN mailboxes m ON m.id = t.mailbox_id
     WHERE t.id = ?`,
  )
    .bind(threadId)
    .first<{ id: number; agent_mode: Mailbox["agent_mode"] }>();
  if (!thread) return c.json({ error: "Conversation not found" }, 404);
  if (thread.agent_mode === "off") {
    return c.json({ error: "Turn on AI drafting for this inbox first" }, 409);
  }

  const latestMessage = await c.env.DB.prepare(
    `SELECT id, direction, is_auto_submitted
     FROM messages WHERE thread_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  )
    .bind(threadId)
    .first<{ id: number; direction: "inbound" | "outbound"; is_auto_submitted: number }>();
  if (!latestMessage || latestMessage.direction !== "inbound") {
    return c.json({ error: "The latest message does not need an AI draft" }, 409);
  }
  if (latestMessage.is_auto_submitted) {
    return c.json({ error: "Automated messages are not drafted" }, 409);
  }

  const runId = await enqueueDraftRun(c.env, threadId, latestMessage.id);
  return c.json({ ok: true, run_id: runId }, 202);
});

api.post("/threads/:id/read", async (c) => {
  await c.env.DB.prepare("UPDATE threads SET is_read = 1 WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

api.post("/threads/:id/archive", async (c) => {
  await c.env.DB.prepare("UPDATE threads SET status = 'archived' WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

api.post("/threads/:id/reply", async (c) => {
  const threadId = parsePositiveId(c.req.param("id"));
  if (threadId === null) return c.json({ error: "Invalid conversation" }, 400);

  const { text, draft_id, attempt_id } = await c.req.json<{
    text: string;
    draft_id?: number;
    attempt_id?: string;
  }>();
  if (!text?.trim()) return c.json({ error: "text is required" }, 400);
  if (!attempt_id || attempt_id.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(attempt_id)) {
    return c.json({ error: "attempt_id is required" }, 400);
  }
  if (draft_id !== undefined && (!Number.isInteger(draft_id) || draft_id <= 0)) {
    return c.json({ error: "invalid draft_id" }, 400);
  }

  try {
    const result = await sendReplyAttempt(c.env, {
      attemptId: attempt_id,
      threadId,
      text,
      draftId: draft_id,
    });
    if (result.status === "failed") return c.json(result, 502);
    if (result.status === "pending" || result.status === "sending") return c.json(result, 202);
    return c.json(result);
  } catch (error) {
    if (error instanceof ReplyIntentError) {
      if (error.status === 404) return c.json({ error: error.message }, 404);
      if (error.status === 409) return c.json({ error: error.message }, 409);
      if (error.status === 400) return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

api.post("/drafts/:id/discard", async (c) => {
  await c.env.DB.prepare("UPDATE drafts SET status = 'discarded' WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

api.get("/search", async (c) => {
  const q = c.req.query("q")?.trim();
  const mailboxId = c.req.query("mailbox_id");
  if (!q) return c.json([]);
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT t.*, m.address AS mailbox_address, m.color AS mailbox_color,
       m.agent_mode AS mailbox_agent_mode,
       COALESCE(
         latest_inbound.from_name,
         latest_inbound.from_address,
         CASE WHEN latest_message.direction = 'outbound'
           THEN 'To: ' || COALESCE(json_extract(latest_message.to_addresses, '$[0]'), '')
         END
       ) AS last_from,
       latest_inbound.from_address AS last_from_address,
       (SELECT COUNT(*) FROM drafts d
        WHERE d.thread_id = t.id AND d.status = 'pending'
          AND d.source_inbound_message_id = latest_inbound.id) AS pending_draft_count,
       latest_run.status AS draft_run_status,
       latest_run.error AS draft_run_error,
       COALESCE(latest_inbound.is_auto_submitted, 0) AS latest_inbound_is_auto_submitted,
       latest_message.direction AS last_message_direction
     FROM messages_fts f
     JOIN messages msg ON msg.id = f.rowid
     JOIN threads t ON t.id = msg.thread_id
     JOIN mailboxes m ON m.id = t.mailbox_id
     LEFT JOIN messages latest_message ON latest_message.id = (
       SELECT lm.id FROM messages lm WHERE lm.thread_id = t.id
       ORDER BY lm.created_at DESC, lm.id DESC LIMIT 1
     )
     LEFT JOIN messages latest_inbound ON latest_inbound.id = (
       SELECT li.id FROM messages li
       WHERE li.thread_id = t.id AND li.direction = 'inbound'
       ORDER BY li.created_at DESC, li.id DESC LIMIT 1
     )
     LEFT JOIN draft_runs latest_run ON latest_run.id = (
       SELECT dr.id FROM draft_runs dr
       WHERE dr.inbound_message_id = latest_inbound.id
       ORDER BY dr.created_at DESC, dr.id DESC LIMIT 1
     )
     WHERE messages_fts MATCH ?1
       AND (?2 = 0 OR t.mailbox_id = ?2)
     ORDER BY t.last_message_at DESC LIMIT 50`,
  )
    .bind(q, mailboxId ?? 0)
    .all();
  return c.json(results);
});

function validatePlaybook(body: PlaybookInput): string | null {
  if (!Number.isInteger(body.mailbox_id) || body.mailbox_id <= 0) {
    return "mailbox_id is required";
  }
  if (!body.name?.trim()) return "name is required";
  if (!body.when_to_use?.trim()) return "when_to_use is required";
  if (!body.instructions?.trim()) return "instructions are required";
  if (body.name.length > 120) return "name is too long";
  if (body.when_to_use.length > 4000) return "when_to_use is too long";
  if (body.instructions.length > 12000) return "instructions are too long";
  if ((body.example_reply?.length ?? 0) > 12000) return "example_reply is too long";
  return null;
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.$/, "");
}

function isDomainName(name: string): boolean {
  if (name.length < 3 || name.length > 253 || !name.includes(".")) return false;
  return name.split(".").every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
}

function isLocalPart(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 64 &&
    !value.startsWith(".") &&
    !value.endsWith(".") &&
    !value.includes("..") &&
    /^[a-z0-9._+-]+$/.test(value)
  );
}

function parsePositiveId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
