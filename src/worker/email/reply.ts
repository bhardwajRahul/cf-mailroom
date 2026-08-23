import type { ReplyAttemptResult } from "../../shared/types";
import { sendEmail } from "./send.ts";

export interface ReplyIntent {
  attemptId: string;
  threadId: number;
  text: string;
  draftId?: number;
}

interface StoredAttempt {
  id: string;
  thread_id: number;
  inbound_message_id: number;
  draft_id: number | null;
  status: "pending" | "sending" | "sent" | "failed";
  text_body: string;
  to_addresses: string;
  message_id: string | null;
  error: string | null;
}

export async function sendReplyAttempt(env: Env, intent: ReplyIntent): Promise<ReplyAttemptResult> {
  const existing = await getAttempt(env, intent.attemptId);
  if (existing && existing.status !== "pending") return existingResult(existing, intent);
  if (existing) existingResult(existing, intent);

  const thread = await env.DB.prepare(
    `SELECT t.id, t.subject, m.address AS mailbox_address
     FROM threads t JOIN mailboxes m ON m.id = t.mailbox_id WHERE t.id = ?`,
  )
    .bind(intent.threadId)
    .first<{ id: number; subject: string; mailbox_address: string }>();
  if (!thread) throw new ReplyIntentError("Conversation not found", 404);

  const lastInbound = await env.DB.prepare(
    `SELECT id, message_id, from_address, reply_to_addresses, references_ids
     FROM messages
     WHERE thread_id = ? AND direction = 'inbound'
       AND (? = 0 OR id = ?)
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  )
    .bind(intent.threadId, existing?.inbound_message_id ?? 0, existing?.inbound_message_id ?? 0)
    .first<{
      id: number;
      message_id: string;
      from_address: string;
      reply_to_addresses: string;
      references_ids: string;
    }>();
  if (!lastInbound) throw new ReplyIntentError("No inbound message to reply to", 400);

  const recipients = parseAddresses(lastInbound.reply_to_addresses);
  if (recipients.length === 0) recipients.push(lastInbound.from_address);

  if (!existing) {
    try {
      await env.DB.prepare(
        `INSERT INTO reply_attempts
           (id, thread_id, inbound_message_id, draft_id, status, text_body, to_addresses)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
        .bind(
          intent.attemptId,
          intent.threadId,
          lastInbound.id,
          intent.draftId ?? null,
          intent.text.trim(),
          JSON.stringify(recipients),
        )
        .run();
    } catch (error) {
      const raced = await getAttempt(env, intent.attemptId);
      if (raced) return existingResult(raced, intent);
      throw error;
    }
  }

  const claimed = await env.DB.prepare(
    `UPDATE reply_attempts
     SET status = 'sending', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND status = 'pending' RETURNING id`,
  )
    .bind(intent.attemptId)
    .first<{ id: string }>();
  if (!claimed) {
    const raced = await getAttempt(env, intent.attemptId);
    if (!raced) throw new ReplyIntentError("Reply Attempt disappeared", 500);
    return existingResult(raced, intent);
  }

  const references = [
    ...parseAddresses(lastInbound.references_ids),
    lastInbound.message_id,
  ];
  const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;

  let messageId: string;
  try {
    ({ messageId } = await sendEmail(env, {
      from: { address: thread.mailbox_address },
      to: recipients,
      subject,
      text: intent.text.trim(),
      inReplyTo: lastInbound.message_id,
      references,
      attemptId: intent.attemptId,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email provider rejected the reply";
    await env.DB.prepare(
      `UPDATE reply_attempts
       SET status = 'failed', error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
      .bind(message.slice(0, 2000), intent.attemptId)
      .run();
    return {
      ok: false,
      attempt_id: intent.attemptId,
      status: "failed",
      message_id: null,
      error: message,
    };
  }

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO messages
         (thread_id, message_id, in_reply_to, references_ids, direction, sent_by,
          from_address, from_name, to_addresses, reply_to_addresses,
          subject, text_body, created_at)
       VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, ?, '[]', ?, ?, ?)`,
    ).bind(
      intent.threadId,
      messageId,
      lastInbound.message_id,
      JSON.stringify(references),
      intent.draftId ? "agent" : "human",
      thread.mailbox_address,
      null,
      JSON.stringify(recipients),
      subject,
      intent.text.trim(),
      now,
    ),
    env.DB.prepare(
      `UPDATE threads
       SET snippet = ?, message_count = message_count + 1, last_message_at = ?, is_read = 1
       WHERE id = ?`,
    ).bind(intent.text.replace(/\s+/g, " ").trim().slice(0, 140), now, intent.threadId),
    env.DB.prepare(
      `UPDATE reply_attempts
       SET status = 'sent', message_id = ?, error = NULL, updated_at = ?
       WHERE id = ?`,
    ).bind(messageId, now, intent.attemptId),
  ];
  if (intent.draftId) {
    statements.push(
      env.DB.prepare(
        "UPDATE drafts SET status = 'sent' WHERE id = ? AND thread_id = ?",
      ).bind(intent.draftId, intent.threadId),
    );
  }
  await env.DB.batch(statements);

  return {
    ok: true,
    attempt_id: intent.attemptId,
    status: "sent",
    message_id: messageId,
  };
}

async function getAttempt(env: Env, id: string): Promise<StoredAttempt | null> {
  return env.DB.prepare("SELECT * FROM reply_attempts WHERE id = ?")
    .bind(id)
    .first<StoredAttempt>();
}

function existingResult(existing: StoredAttempt, intent: ReplyIntent): ReplyAttemptResult {
  if (
    existing.thread_id !== intent.threadId ||
    existing.text_body !== intent.text.trim() ||
    existing.draft_id !== (intent.draftId ?? null)
  ) {
    throw new ReplyIntentError("Reply Attempt id was already used for different content", 409);
  }
  return {
    ok: existing.status === "sent",
    attempt_id: existing.id,
    status: existing.status,
    message_id: existing.message_id,
    ...(existing.error ? { error: existing.error } : {}),
  };
}

function parseAddresses(raw: string): string[] {
  try {
    const values = JSON.parse(raw) as unknown;
    return Array.isArray(values)
      ? [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))]
      : [];
  } catch {
    return [];
  }
}

export class ReplyIntentError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
