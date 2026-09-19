interface OutboundEmailBinding {
  send(message: {
    from: string | { email: string; name?: string };
    to: string | Array<string | { email: string; name?: string }>;
    subject: string;
    text?: string;
    html?: string;
    attachments?: Array<{
      content: string | ArrayBuffer | ArrayBufferView;
      filename: string;
      type: string;
      disposition: "attachment" | "inline";
      contentId?: string;
    }>;
    headers?: Record<string, string>;
  }): Promise<{ messageId: string }>;
}

interface Env {
  DB: D1Database;
  RAW: R2Bucket;
  EMAIL: OutboundEmailBinding;
  AI: Ai;
  DRAFT_QUEUE: Queue<{ runId: number }>;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_JWK?: string;
  VAPID_SUBJECT?: string;
}
