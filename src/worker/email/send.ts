/**
 * Outbound mail via Cloudflare Email Sending (send_email binding).
 * Callers only see this interface, so swapping providers (e.g. Resend)
 * means reimplementing this one function.
 */
export interface OutgoingEmail {
  from: { address: string; name?: string };
  to: string[];
  subject: string;
  text: string;
  /** RFC Message-ID of the message being replied to */
  inReplyTo?: string;
  /** Full References chain, oldest first */
  references?: string[];
  /** Set for agent-sent mail so recipients' auto-responders stay quiet (RFC 3834) */
  autoSubmitted?: boolean;
}

export interface SendResult {
  /**
   * Message-ID assigned by Cloudflare (it cannot be set manually), stored so
   * future inbound replies can be matched back to this thread via References.
   */
  messageId: string;
}

export async function sendEmail(env: Env, mail: OutgoingEmail): Promise<SendResult> {
  const headers: Record<string, string> = {};
  if (mail.inReplyTo) headers["In-Reply-To"] = mail.inReplyTo;
  if (mail.references?.length) headers["References"] = mail.references.join(" ");
  if (mail.autoSubmitted) headers["Auto-Submitted"] = "auto-replied";

  const result = await env.EMAIL.send({
    from: mail.from.name
      ? { email: mail.from.address, name: mail.from.name }
      : mail.from.address,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    headers,
  });

  const messageId = result.messageId.startsWith("<")
    ? result.messageId
    : `<${result.messageId}>`;
  return { messageId };
}
