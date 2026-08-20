interface OutboundEmailBinding {
  send(message: {
    from: string | { email: string; name?: string };
    to: string | Array<string | { email: string; name?: string }>;
    subject: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
  }): Promise<{ messageId: string }>;
}

interface Env {
  DB: D1Database;
  RAW: R2Bucket;
  EMAIL: OutboundEmailBinding;
  AI: Ai;
}
