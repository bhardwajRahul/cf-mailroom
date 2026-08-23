import test from "node:test";
import assert from "node:assert/strict";
import { ReplyIntentError, sendReplyAttempt } from "../src/worker/email/reply.ts";

class FakeStatement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new FakeStatement(this.db, this.sql, args);
  }

  first() {
    return this.db.first(this.sql, this.args);
  }

  run() {
    return this.db.run(this.sql, this.args);
  }
}

class FakeDb {
  attempts = new Map();

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async first(sql, args) {
    if (sql.includes("SELECT * FROM reply_attempts")) return this.attempts.get(args[0]) ?? null;
    if (sql.includes("SELECT t.id, t.subject")) {
      return { id: 1, subject: "Help", mailbox_address: "support@example.com" };
    }
    if (sql.includes("SELECT id, message_id, from_address")) {
      return {
        id: 9,
        message_id: "<inbound@example.com>",
        from_address: "form@example.com",
        reply_to_addresses: JSON.stringify(["customer@example.com"]),
        references_ids: "[]",
      };
    }
    if (sql.includes("UPDATE reply_attempts") && sql.includes("RETURNING id")) {
      const attempt = this.attempts.get(args[0]);
      if (!attempt || attempt.status !== "pending") return null;
      attempt.status = "sending";
      return { id: attempt.id };
    }
    return null;
  }

  async run(sql, args) {
    if (sql.includes("INSERT INTO reply_attempts")) {
      if (this.attempts.has(args[0])) throw new Error("UNIQUE constraint failed");
      this.attempts.set(args[0], {
        id: args[0],
        thread_id: args[1],
        inbound_message_id: args[2],
        draft_id: args[3],
        status: "pending",
        text_body: args[4],
        to_addresses: args[5],
        message_id: null,
        error: null,
      });
    } else if (sql.includes("SET status = 'failed'")) {
      const attempt = this.attempts.get(args[1]);
      attempt.status = "failed";
      attempt.error = args[0];
    } else if (sql.includes("SET status = 'sent'")) {
      const attempt = this.attempts.get(args[2]);
      attempt.status = "sent";
      attempt.message_id = args[0];
      attempt.error = null;
    }
    return { success: true, meta: { changes: 1, last_row_id: 1 } };
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

function makeEnv({ fail = false } = {}) {
  const db = new FakeDb();
  let sends = 0;
  return {
    env: {
      DB: db,
      EMAIL: {
        async send() {
          sends += 1;
          if (fail) throw new Error("provider unavailable");
          return { messageId: "outbound@example.com" };
        },
      },
    },
    sends: () => sends,
  };
}

test("replaying one Reply Attempt returns the stored result without sending twice", async () => {
  const fixture = makeEnv();
  const intent = { attemptId: "attempt-1", threadId: 1, text: "Hello" };

  const first = await sendReplyAttempt(fixture.env, intent);
  const replay = await sendReplyAttempt(fixture.env, intent);

  assert.equal(first.status, "sent");
  assert.deepEqual(replay, first);
  assert.equal(fixture.sends(), 1);
});

test("a failed Reply Attempt is not automatically sent again", async () => {
  const fixture = makeEnv({ fail: true });
  const intent = { attemptId: "attempt-2", threadId: 1, text: "Hello" };

  const first = await sendReplyAttempt(fixture.env, intent);
  const replay = await sendReplyAttempt(fixture.env, intent);

  assert.equal(first.status, "failed");
  assert.equal(replay.status, "failed");
  assert.equal(fixture.sends(), 1);
});

test("a Reply Attempt id cannot be reused for different content", async () => {
  const fixture = makeEnv();
  await sendReplyAttempt(fixture.env, { attemptId: "attempt-3", threadId: 1, text: "First" });

  await assert.rejects(
    sendReplyAttempt(fixture.env, { attemptId: "attempt-3", threadId: 1, text: "Changed" }),
    (error) => error instanceof ReplyIntentError && error.status === 409,
  );
  assert.equal(fixture.sends(), 1);
});

test("a pending Reply Attempt resumes safely after an interrupted request", async () => {
  const fixture = makeEnv();
  fixture.env.DB.attempts.set("attempt-4", {
    id: "attempt-4",
    thread_id: 1,
    inbound_message_id: 9,
    draft_id: null,
    status: "pending",
    text_body: "Resume me",
    to_addresses: JSON.stringify(["customer@example.com"]),
    message_id: null,
    error: null,
  });

  const result = await sendReplyAttempt(fixture.env, {
    attemptId: "attempt-4",
    threadId: 1,
    text: "Resume me",
  });

  assert.equal(result.status, "sent");
  assert.equal(fixture.sends(), 1);
});
