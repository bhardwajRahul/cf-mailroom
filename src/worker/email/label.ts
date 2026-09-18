export interface LabelRule {
  id: number;
  name: string;
  condition: string;
}

const LABEL_MODEL = "typesafe/jev";
const MATCH_THRESHOLD = 0.5;
const MAX_BODY_CHARS = 8_000;
const MAX_LABELS_PER_EVALUATION = 20;

export async function labelNewThread(
  env: Env,
  threadId: number,
  inboundMessageId: number,
): Promise<void> {
  if (!env.AI) return;

  const message = await env.DB.prepare(
    `SELECT msg.subject, msg.from_address, msg.from_name, msg.text_body,
            t.mailbox_id
     FROM messages msg
     JOIN threads t ON t.id = msg.thread_id
     WHERE msg.id = ? AND msg.thread_id = ?`,
  )
    .bind(inboundMessageId, threadId)
    .first<{
      subject: string;
      from_address: string;
      from_name: string | null;
      text_body: string | null;
      mailbox_id: number;
    }>();
  if (!message) return;

  const { results: labels } = await env.DB.prepare(
    "SELECT id, name, condition FROM labels WHERE mailbox_id = ? ORDER BY id",
  )
    .bind(message.mailbox_id)
    .all<LabelRule>();
  if (labels.length === 0) return;

  const response = await env.AI.run(LABEL_MODEL, {
    state: {
      from: message.from_name
        ? `${message.from_name} <${message.from_address}>`
        : message.from_address,
      subject: message.subject,
      body: (message.text_body ?? "").slice(0, MAX_BODY_CHARS),
    },
    questions: buildJevQuestions(labels.slice(0, MAX_LABELS_PER_EVALUATION)),
  });

  const matched = matchedLabelIds(labels, response);
  for (const labelId of matched) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO thread_labels (thread_id, label_id) VALUES (?, ?)",
    )
      .bind(threadId, labelId)
      .run();
  }
}

export function buildJevQuestions(labels: LabelRule[]): Record<string, unknown> {
  return Object.fromEntries(
    labels.map((label) => [
      questionKey(label.id),
      {
        type: "noul",
        instructions: `Does this email match the "${label.name}" label?`,
        criteria: {
          true: label.condition,
          false: `The email does not match: ${label.condition}`,
        },
      },
    ]),
  );
}

export function matchedLabelIds(
  labels: LabelRule[],
  response: unknown,
): number[] {
  return labels
    .filter(
      (label) => jevNoul(response, questionKey(label.id)) >= MATCH_THRESHOLD,
    )
    .map((label) => label.id);
}

function questionKey(labelId: number): string {
  return `label_${labelId}`;
}

function jevNoul(response: unknown, key: string): number {
  const answers = (response as { answers?: unknown } | null)?.answers;
  const answer = (answers as Record<string, unknown> | null)?.[key];
  const noul = (answer as { noul?: unknown } | null)?.noul;
  return typeof noul === "number" ? noul : 0;
}
