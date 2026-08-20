import { Hono } from "hono";
import { sendEmail } from "../email/send";
import type { Message } from "../../shared/types";

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

api.get("/threads", async (c) => {
  const mailboxId = c.req.query("mailbox_id");
  const status = c.req.query("status") ?? "open";
  const conditions = ["t.status = ?2"];
  if (mailboxId) conditions.push("t.mailbox_id = ?1");
  const { results } = await c.env.DB.prepare(
    `SELECT t.*, m.address AS mailbox_address, m.color AS mailbox_color
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
    c.env.DB.prepare("SELECT * FROM drafts WHERE thread_id = ? AND status = 'pending' ORDER BY created_at")
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
    `SELECT t.id, t.subject, t.mailbox_id, m.address AS mailbox_address, m.display_name
     FROM threads t JOIN mailboxes m ON m.id = t.mailbox_id WHERE t.id = ?`,
  )
    .bind(threadId)
    .first<{
      id: number;
      subject: string;
      mailbox_id: number;
      mailbox_address: string;
      display_name: string | null;
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
    from: { address: thread.mailbox_address, name: thread.display_name ?? undefined },
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
      thread.display_name,
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
  if (!q) return c.json([]);
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT t.*, m.address AS mailbox_address, m.color AS mailbox_color
     FROM messages_fts f
     JOIN messages msg ON msg.id = f.rowid
     JOIN threads t ON t.id = msg.thread_id
     JOIN mailboxes m ON m.id = t.mailbox_id
     WHERE messages_fts MATCH ?
     ORDER BY t.last_message_at DESC LIMIT 50`,
  )
    .bind(q)
    .all();
  return c.json(results);
});
