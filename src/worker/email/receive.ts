import PostalMime, { type Email } from "postal-mime";
import { generateDraft } from "../agent/draft";
import { splitQuotedTail } from "../../shared/quote";

export async function receiveEmail(
  message: ForwardableEmailMessage,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const mailbox = await findMailbox(env, message.to.trim().toLowerCase());
  if (!mailbox) {
    message.setReject("Inbox not configured");
    return;
  }

  const rawBuffer = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(rawBuffer);

  const messageId = parsed.messageId ?? `<missing-${crypto.randomUUID()}@agentic-inbox>`;

  const duplicate = await env.DB.prepare("SELECT id FROM messages WHERE message_id = ?")
    .bind(messageId)
    .first();
  if (duplicate) return;

  const rawKey = `raw/${mailbox.id}/${crypto.randomUUID()}.eml`;
  await env.RAW.put(rawKey, rawBuffer, {
    httpMetadata: { contentType: "message/rfc822" },
  });

  const subject = parsed.subject ?? "";
  const textBody = parsed.text ?? htmlToText(parsed.html ?? "");
  const referencesIds = extractMessageIds(parsed);
  const existingThreadId = await resolveThread(env, mailbox.id, subject, referencesIds);
  const now = new Date().toISOString();
  const snippet = splitQuotedTail(textBody).main.replace(/\s+/g, " ").trim().slice(0, 140);
  let threadId: number;

  if (existingThreadId !== null) {
    threadId = existingThreadId;
    await env.DB.batch([
      insertMessage(env, {
        threadId,
        messageId,
        parsed,
        subject,
        textBody,
        rawKey,
        now,
      }),
      env.DB.prepare(
        `UPDATE threads
         SET snippet = ?, is_read = 0, message_count = message_count + 1, last_message_at = ?
         WHERE id = ?`,
      ).bind(snippet, now, threadId),
    ]);
  } else {
    const thread = await env.DB.prepare(
      `INSERT INTO threads (mailbox_id, subject, normalized_subject, snippet, message_count, last_message_at)
       VALUES (?, ?, ?, ?, 1, ?) RETURNING id`,
    )
      .bind(mailbox.id, subject, normalizeSubject(subject), snippet, now)
      .first<{ id: number }>();
    threadId = thread!.id;
    await insertMessage(env, {
      threadId,
      messageId,
      parsed,
      subject,
      textBody,
      rawKey,
      now,
    }).run();
  }

  // Draft agent runs in the background after the email is stored. Guards:
  // mailbox opt-in, automated senders (RFC 3834), and mail from one of our own
  // addresses — all three protect against reply loops.
  if (mailbox.agent_mode !== "off" && !isAutoSubmitted(parsed)) {
    const fromOurAddress = await env.DB.prepare("SELECT id FROM mailboxes WHERE address = ?")
      .bind((parsed.from?.address ?? "").toLowerCase())
      .first();
    if (!fromOurAddress) ctx.waitUntil(generateDraft(env, threadId));
  }
}

async function findMailbox(
  env: Env,
  address: string,
): Promise<{ id: number; agent_mode: string } | null> {
  return env.DB.prepare("SELECT id, agent_mode FROM mailboxes WHERE address = ?")
    .bind(address)
    .first<{ id: number; agent_mode: string }>();
}

/**
 * Find the thread this message belongs to: first by RFC threading headers
 * (In-Reply-To / References matched against stored Message-IDs), then by
 * normalized subject within the same mailbox in the last 7 days.
 */
async function resolveThread(
  env: Env,
  mailboxId: number,
  subject: string,
  referencesIds: string[],
): Promise<number | null> {
  if (referencesIds.length > 0) {
    const placeholders = referencesIds.map(() => "?").join(", ");
    const byHeader = await env.DB.prepare(
      `SELECT m.thread_id AS id FROM messages m
       JOIN threads t ON t.id = m.thread_id
       WHERE t.mailbox_id = ? AND m.message_id IN (${placeholders})
       ORDER BY m.created_at DESC LIMIT 1`,
    )
      .bind(mailboxId, ...referencesIds)
      .first<{ id: number }>();
    if (byHeader) return byHeader.id;
  }

  const normalized = normalizeSubject(subject);
  if (!normalized) return null;
  const bySubject = await env.DB.prepare(
    `SELECT id FROM threads
     WHERE mailbox_id = ? AND normalized_subject = ?
       AND last_message_at > datetime('now', '-7 days')
     ORDER BY last_message_at DESC LIMIT 1`,
  )
    .bind(mailboxId, normalized)
    .first<{ id: number }>();
  return bySubject?.id ?? null;
}

function insertMessage(
  env: Env,
  args: {
    threadId: number;
    messageId: string;
    parsed: Email;
    subject: string;
    textBody: string;
    rawKey: string;
    now: string;
  },
) {
  const { parsed } = args;
  return env.DB.prepare(
    `INSERT INTO messages
       (thread_id, message_id, in_reply_to, references_ids, direction, sent_by,
        from_address, from_name, to_addresses, cc_addresses, subject,
        text_body, html_body, raw_key, is_auto_submitted, created_at)
     VALUES (?, ?, ?, ?, 'inbound', 'external', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    args.threadId,
    args.messageId,
    parsed.inReplyTo ?? null,
    JSON.stringify(extractMessageIds(parsed)),
    parsed.from?.address ?? "unknown",
    parsed.from?.name ?? null,
    JSON.stringify((parsed.to ?? []).map((a) => a.address)),
    JSON.stringify((parsed.cc ?? []).map((a) => a.address)),
    args.subject,
    args.textBody,
    parsed.html ?? null,
    args.rawKey,
    isAutoSubmitted(parsed) ? 1 : 0,
    args.now,
  );
}

/** Collect every Message-ID mentioned in In-Reply-To and References. */
function extractMessageIds(parsed: Email): string[] {
  const raw = `${parsed.inReplyTo ?? ""} ${parsed.references ?? ""}`;
  return [...new Set(raw.match(/<[^<>\s]+>/g) ?? [])];
}

/**
 * Detect automated senders (RFC 3834). Threads started by these must never
 * receive an automated reply, or two robots will talk forever.
 */
function isAutoSubmitted(parsed: Email): boolean {
  for (const header of parsed.headers ?? []) {
    const key = header.key.toLowerCase();
    const value = header.value.toLowerCase();
    if (key === "auto-submitted" && value !== "no") return true;
    if (key === "precedence" && ["bulk", "junk", "list", "auto_reply"].includes(value)) return true;
    if (key === "x-auto-response-suppress") return true;
    if (key === "list-id" || key === "list-unsubscribe") return true;
  }
  return false;
}

export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|fwd?|aw|回复|转发)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
