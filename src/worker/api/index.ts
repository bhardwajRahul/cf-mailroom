import { Hono } from "hono";
import { sendEmail } from "../email/send";
import type { Domain, Mailbox, Message, PlaybookInput } from "../../shared/types";

export const api = new Hono<{ Bindings: Env }>();

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
       (SELECT COALESCE(msg.from_name, msg.from_address) FROM messages msg
        WHERE msg.thread_id = t.id AND msg.direction = 'inbound'
        ORDER BY msg.created_at DESC LIMIT 1) AS last_from,
       (SELECT COUNT(*) FROM drafts d
        WHERE d.thread_id = t.id AND d.status = 'pending') AS pending_draft_count
     FROM threads t JOIN mailboxes m ON m.id = t.mailbox_id
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
    `SELECT t.*, m.address AS mailbox_address, m.color AS mailbox_color
     FROM threads t JOIN mailboxes m ON m.id = t.mailbox_id WHERE t.id = ?`,
  )
    .bind(id)
    .first();
  if (!thread) return c.json({ error: "thread not found" }, 404);

  const [messages, drafts] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at").bind(id).all(),
    c.env.DB.prepare(
      `SELECT d.*, p.name AS playbook_name
       FROM drafts d LEFT JOIN playbooks p ON p.id = d.playbook_id
       WHERE d.thread_id = ? AND d.status = 'pending'
       ORDER BY d.created_at`,
    )
      .bind(id)
      .all(),
  ]);
  return c.json({ thread, messages: messages.results, drafts: drafts.results });
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
  const threadId = c.req.param("id");
  const { text, draft_id } = await c.req.json<{ text: string; draft_id?: number }>();
  if (!text?.trim()) return c.json({ error: "text is required" }, 400);

  const thread = await c.env.DB.prepare(
    `SELECT t.id, t.subject, t.mailbox_id, m.address AS mailbox_address
     FROM threads t JOIN mailboxes m ON m.id = t.mailbox_id WHERE t.id = ?`,
  )
    .bind(threadId)
    .first<{
      id: number;
      subject: string;
      mailbox_id: number;
      mailbox_address: string;
    }>();
  if (!thread) return c.json({ error: "thread not found" }, 404);

  const lastInbound = await c.env.DB.prepare(
    `SELECT * FROM messages WHERE thread_id = ? AND direction = 'inbound'
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(threadId)
    .first<Message & { message_id: string; references_ids: string }>();
  if (!lastInbound) return c.json({ error: "no inbound message to reply to" }, 400);

  const references = [
    ...(JSON.parse(lastInbound.references_ids || "[]") as string[]),
    lastInbound.message_id,
  ];
  const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;

  const { messageId } = await sendEmail(c.env, {
    from: { address: thread.mailbox_address },
    to: [lastInbound.from_address],
    subject,
    text,
    inReplyTo: lastInbound.message_id,
    references,
  });

  const now = new Date().toISOString();
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO messages
         (thread_id, message_id, in_reply_to, references_ids, direction, sent_by,
          from_address, from_name, to_addresses, subject, text_body, created_at)
       VALUES (?, ?, ?, ?, 'outbound', 'human', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      threadId,
      messageId,
      lastInbound.message_id,
      JSON.stringify(references),
      thread.mailbox_address,
      null,
      JSON.stringify([lastInbound.from_address]),
      subject,
      text,
      now,
    ),
    c.env.DB.prepare(
      `UPDATE threads SET snippet = ?, message_count = message_count + 1, last_message_at = ?, is_read = 1
       WHERE id = ?`,
    ).bind(text.replace(/\s+/g, " ").trim().slice(0, 140), now, threadId),
  ];
  if (draft_id) {
    statements.push(
      c.env.DB.prepare("UPDATE drafts SET status = 'sent' WHERE id = ? AND thread_id = ?").bind(
        draft_id,
        threadId,
      ),
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ ok: true, message_id: messageId });
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
       (SELECT COALESCE(msg.from_name, msg.from_address) FROM messages msg
        WHERE msg.thread_id = t.id AND msg.direction = 'inbound'
        ORDER BY msg.created_at DESC LIMIT 1) AS last_from,
       (SELECT COUNT(*) FROM drafts d
        WHERE d.thread_id = t.id AND d.status = 'pending') AS pending_draft_count
     FROM messages_fts f
     JOIN messages msg ON msg.id = f.rowid
     JOIN threads t ON t.id = msg.thread_id
     JOIN mailboxes m ON m.id = t.mailbox_id
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
